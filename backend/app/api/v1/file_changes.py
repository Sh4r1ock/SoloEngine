# -*- coding: utf-8 -*-
"""
SoloEngine : 文件变更API模块

@file file_changes.py
@description 文件变更相关API端点
@author Sh4rlock
@date 2026-04-13

功能描述：
本模块提供文件变更相关的API端点：
    - 获取会话的文件变更列表（轻量级元信息）
    - 获取消息的文件内容（before/after完整内容）
    - 获取消息的diff_data（hunks，回退预览专用）
    - 撤回操作
    - 接受/拒绝变更
    - 获取文件变更分组列表

核心原则：
1. 净diff和增量diff完全分离
2. API层不做任何合并操作
3. 净diff由后端计算并存储，前端直接显示
4. 增量diff可选显示（用于工具调用详情）
5. 三个API各司其职：
   - getSessionFileChanges: 轻量级元信息（不含diff_data、不含内部hash）
   - getMessageFileContent(session_id, message_id): 完整before/after内容
   - getDiffHunks(session_id): diff_data（hunks），回退预览专用
"""

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager
from app.core.auth import User
from app.api.v1.auth import get_current_user
from app.core.content_addressable_storage import cas
from app.models.file_change import FileChangeModel
from app.utils.timezone_utils import format_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/file-changes", tags=["file_changes"])


class RevertRequest(BaseModel):
    session_id: str = Field(..., description="会话ID")
    message_id: str = Field(..., description="消息ID")
    file_paths: Optional[List[str]] = Field(None, description="指定撤回的文件路径列表（可选）")


class RewindRequest(BaseModel):
    session_id: str = Field(..., description="会话ID")
    from_message_id: str = Field(..., description="从该消息开始撤回")


class DeleteMessagesRequest(BaseModel):
    session_id: str = Field(..., description="会话ID")
    from_message_id: str = Field(..., description="从该消息开始删除（包含此消息）")


class UpdateChangeStatusRequest(BaseModel):
    """更新变更状态请求"""
    change_id: str = Field(..., description="变更ID")
    status: str = Field(..., description="状态：accepted/rejected")


class FileChangeResponse(BaseModel):
    id: str
    session_id: str
    message_id: str
    agent_id: Optional[str]
    file_path: str
    operation: str
    tool_call_id: Optional[str]
    content_type: str
    lines_added: int
    lines_removed: int
    status: str
    created_at: Optional[str]


class FileChangesSummary(BaseModel):
    """文件变更汇总"""
    total_changes: int
    created_count: int
    modified_count: int
    deleted_count: int
    total_lines_added: int
    total_lines_removed: int


@router.get("/session/{session_id}")
async def get_session_file_changes(
    session_id: str,
    limit: int = Query(100, description="返回数量限制"),
    message_ids: Optional[str] = Query(None, description="逗号分隔的message_id列表"),
    diff_type: str = Query("net", description="diff类型：net(净diff)/incremental(增量diff)/all(全部)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    获取会话的文件变更（轻量级元信息）。
    
    职责：仅返回元信息，不含diff_data(hunks)、不含内部hash。
    用于消息加载时的轻量级预加载，显示变更摘要条和文件列表。
    """
    session = db_manager.get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    
    query = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == session_id
    )
    
    if message_ids:
        mid_list = [m.strip() for m in message_ids.split(",") if m.strip()]
        if mid_list:
            query = query.filter(FileChangeModel.message_id.in_(mid_list))

    if diff_type == "net":
        query = query.filter(FileChangeModel.tool_call_id == None)
    elif diff_type == "incremental":
        query = query.filter(FileChangeModel.tool_call_id != None)

    changes_query = query.order_by(FileChangeModel.created_at.desc()).limit(limit).all()
    
    changes = []
    for c in changes_query:
        changes.append({
            "id": c.id,
            "session_id": c.session_id,
            "message_id": c.message_id,
            "agent_id": c.agent_id,
            "file_path": c.file_path,
            "operation": c.operation,
            "tool_call_id": c.tool_call_id,
            "content_type": c.content_type,
            "lines_added": c.lines_added,
            "lines_removed": c.lines_removed,
            "status": c.status,
            "created_at": format_iso(c.created_at),
        })
    
    created_count = sum(1 for c in changes if c.get("operation") == "created")
    modified_count = sum(1 for c in changes if c.get("operation") == "modified")
    deleted_count = sum(1 for c in changes if c.get("operation") == "deleted")
    total_lines_added = sum(c.get("lines_added", 0) for c in changes)
    total_lines_removed = sum(c.get("lines_removed", 0) for c in changes)
    
    return {
        "code": 200,
        "message": "File changes retrieved",
        "data": {
            "changes": changes,
            "summary": {
                "total_changes": len(changes),
                "created_count": created_count,
                "modified_count": modified_count,
                "deleted_count": deleted_count,
                "total_lines_added": total_lines_added,
                "total_lines_removed": total_lines_removed
            }
        }
    }


@router.get("/summaries/{session_id}")
async def get_session_file_change_summaries(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db_manager.get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    from sqlalchemy import func as sqlfunc

    message_ids_query = db.query(FileChangeModel.message_id).filter(
        FileChangeModel.session_id == session_id,
        FileChangeModel.tool_call_id == None
    ).distinct().all()

    change_groups = []
    for (mid,) in message_ids_query:
        changes = db.query(FileChangeModel).filter(
            FileChangeModel.session_id == session_id,
            FileChangeModel.message_id == mid,
            FileChangeModel.tool_call_id == None
        ).all()

        is_reverted = all(c.status == "reverted" for c in changes) if changes else False

        file_paths = [c.file_path for c in changes]
        operations = {c.file_path: c.operation for c in changes}

        change_groups.append({
            "session_id": session_id,
            "message_id": mid,
            "is_reverted": is_reverted,
            "file_paths": file_paths,
            "operations": operations,
            "changes_count": len(changes),
            "created_at": format_iso(changes[0].created_at) if changes else None,
        })

    return {
        "code": 200,
        "message": "File change groups retrieved",
        "data": sorted(change_groups, key=lambda x: x.get("created_at") or "", reverse=True)
    }


@router.post("/revert")
async def revert_file_changes(
    request: RevertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db_manager.get_session(db, request.session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    working_dir = None
    if session.run_project_id:
        project = db_manager.get_run_project(db, session.run_project_id, current_user.id)
        if project:
            working_dir = project.folder_path

    if not working_dir or not os.path.exists(working_dir):
        raise HTTPException(status_code=500, detail="Working directory not found")

    all_changes = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == request.session_id,
        FileChangeModel.message_id == request.message_id,
        FileChangeModel.status != "reverted"
    )

    if request.file_paths:
        all_changes = all_changes.filter(
            FileChangeModel.file_path.in_(request.file_paths)
        )

    all_changes = all_changes.all()
    if not all_changes:
        raise HTTPException(status_code=400, detail="No changes to revert")

    incremental = [c for c in all_changes if c.tool_call_id is not None]

    from app.services.file_change import file_change_manager
    aggregated = file_change_manager.aggregate_incremental_to_net_view_from_models(incremental)

    reverted_files = []
    failed_files = []

    for change in aggregated:
        try:
            file_path = os.path.join(working_dir, change.file_path)

            if change.operation == "created":
                if os.path.exists(file_path):
                    os.remove(file_path)
                reverted_files.append(change.file_path)

            elif change.operation == "deleted":
                if change.old_hash:
                    content = cas.get_content(change.old_hash)
                    if content is not None:
                        os.makedirs(os.path.dirname(file_path), exist_ok=True)
                        with open(file_path, 'wb') as f:
                            f.write(content)
                        reverted_files.append(change.file_path)
                    else:
                        failed_files.append(change.file_path)
                else:
                    failed_files.append(change.file_path)

            elif change.operation == "modified":
                if change.old_hash:
                    content = cas.get_content(change.old_hash)
                    if content is not None:
                        with open(file_path, 'wb') as f:
                            f.write(content)
                        reverted_files.append(change.file_path)
                    else:
                        failed_files.append(change.file_path)
                else:
                    failed_files.append(change.file_path)

        except Exception as e:
            logger.error(f"Failed to revert {change.file_path}: {e}")
            failed_files.append(change.file_path)

    for c in all_changes:
        c.status = "reverted"

    if request.file_paths:
        extra_incremental = db.query(FileChangeModel).filter(
            FileChangeModel.session_id == request.session_id,
            FileChangeModel.message_id == request.message_id,
            FileChangeModel.tool_call_id != None,
            FileChangeModel.file_path.in_(request.file_paths),
            FileChangeModel.status != "reverted"
        ).all()
        for inc in extra_incremental:
            inc.status = "reverted"

    db.commit()

    return {
        "code": 200,
        "message": "Reverted successfully",
        "data": {
            "reverted_files": reverted_files,
            "failed_files": failed_files,
            "total_reverted": len(reverted_files),
            "total_failed": len(failed_files)
        }
    }


RECALL_ACTION_MAP = {
    "created": "删除",
    "modified": "修改",
    "deleted": "新建",
}


@router.post("/rewind/preview")
async def preview_rewind_file_changes(
    request: RewindRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from app.core.database import SessionMessageModel

    session = db_manager.get_session(db, request.session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    working_dir = ""
    if session.run_project_id:
        project = db_manager.get_run_project(db, session.run_project_id, current_user.id)
        if project:
            working_dir = project.folder_path

    from_msg = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.id == request.from_message_id
    ).first()

    if not from_msg:
        raise HTTPException(status_code=404, detail="Message not found")

    target_index = from_msg.message_index

    deleted_messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.message_index >= target_index
    ).all()

    deleted_message_ids = [m.id for m in deleted_messages]

    if not deleted_message_ids:
        return {
            "code": 200,
            "message": "No files to preview",
            "data": {
                "files": [],
                "total_files": 0,
                "working_dir": working_dir,
            }
        }

    file_changes = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == request.session_id,
        FileChangeModel.message_id.in_(deleted_message_ids),
        FileChangeModel.tool_call_id == None
    ).order_by(FileChangeModel.message_id.asc()).all()

    deduped_changes = {}
    for fc in file_changes:
        if fc.file_path not in deduped_changes:
            deduped_changes[fc.file_path] = fc

    files = []
    for file_path, change in deduped_changes.items():
        abs_path = os.path.join(working_dir, file_path) if working_dir else file_path
        files.append({
            "file_path": file_path,
            "absolute_path": abs_path,
            "original_operation": change.operation,
            "recall_action": RECALL_ACTION_MAP.get(change.operation, change.operation),
            "lines_added": change.lines_added,
            "lines_removed": change.lines_removed,
        })

    return {
        "code": 200,
        "message": "Preview generated",
        "data": {
            "files": files,
            "total_files": len(files)
        }
    }


@router.post("/rewind")
async def rewind_file_changes(
    request: RewindRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from app.core.database import SessionMessageModel
    from SoloAgent.solo_agent.compiler import CompiledFlowFactory
    from sqlalchemy import func as sqlfunc

    session = db_manager.get_session(db, request.session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    working_dir = None
    if session.run_project_id:
        project = db_manager.get_run_project(db, session.run_project_id, current_user.id)
        if project:
            working_dir = project.folder_path

    if not working_dir or not os.path.exists(working_dir):
        raise HTTPException(status_code=500, detail="Working directory not found")

    from_msg = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.id == request.from_message_id
    ).first()

    if not from_msg:
        raise HTTPException(status_code=404, detail="Message not found")

    target_index = from_msg.message_index

    deleted_messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.message_index >= target_index
    ).all()

    deleted_message_ids = [m.id for m in deleted_messages]

    if not deleted_message_ids:
        return {
            "code": 200,
            "message": "No messages to rewind",
            "data": {
                "files": [],
                "failed_files": [],
                "total_reverted": 0,
                "total_failed": 0,
                "recalled_message_count": 0,
                "rewinded_token_delta": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0
                }
            }
        }

    file_changes = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == request.session_id,
        FileChangeModel.message_id.in_(deleted_message_ids),
        FileChangeModel.tool_call_id == None
    ).order_by(FileChangeModel.message_id.asc()).all()

    deduped_changes = {}
    for fc in file_changes:
        if fc.file_path not in deduped_changes:
            deduped_changes[fc.file_path] = fc

    reverted_files = []
    failed_files = []

    for file_path, change in deduped_changes.items():
        try:
            abs_path = os.path.join(working_dir, file_path)

            if change.operation == "created":
                if os.path.exists(abs_path):
                    os.remove(abs_path)
                reverted_files.append({
                    "file_path": file_path,
                    "absolute_path": abs_path,
                    "operation": change.operation,
                    "lines_added": change.lines_added,
                    "lines_removed": change.lines_removed,
                })

            elif change.operation == "deleted":
                if change.before_content_hash:
                    content = cas.get_content(change.before_content_hash)
                    if content is not None:
                        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                        with open(abs_path, 'wb') as f:
                            f.write(content)
                        reverted_files.append({
                            "file_path": file_path,
                            "absolute_path": abs_path,
                            "operation": change.operation,
                            "lines_added": change.lines_added,
                            "lines_removed": change.lines_removed,
                        })
                    else:
                        failed_files.append(file_path)
                else:
                    failed_files.append(file_path)

            elif change.operation == "modified":
                if change.before_content_hash:
                    content = cas.get_content(change.before_content_hash)
                    if content is not None:
                        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                        with open(abs_path, 'wb') as f:
                            f.write(content)
                        reverted_files.append({
                            "file_path": file_path,
                            "absolute_path": abs_path,
                            "operation": change.operation,
                            "lines_added": change.lines_added,
                            "lines_removed": change.lines_removed,
                        })
                    else:
                        failed_files.append(file_path)
                else:
                    failed_files.append(file_path)

        except Exception as e:
            logger.error(f"Failed to rewind {file_path}: {e}")
            failed_files.append(file_path)

    db.query(FileChangeModel).filter(
        FileChangeModel.message_id.in_(deleted_message_ids)
    ).delete(synchronize_session=False)

    token_sum = db.query(
        sqlfunc.sum(SessionMessageModel.prompt_tokens),
        sqlfunc.sum(SessionMessageModel.completion_tokens),
        sqlfunc.sum(SessionMessageModel.total_tokens)
    ).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.message_index > target_index
    ).first()

    rewinded_token_delta = {
        "prompt_tokens": token_sum[0] or 0,
        "completion_tokens": token_sum[1] or 0,
        "total_tokens": token_sum[2] or 0,
    }

    db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.message_index >= target_index
    ).update({"is_deleted": True}, synchronize_session=False)

    db.commit()

    cas.cleanup_orphan_blobs()

    CompiledFlowFactory.remove(
        current_user.id,
        session.agentic_flow_id,
        request.session_id,
        session.run_project_id
    )

    return {
        "code": 200,
        "message": "Rewind completed",
        "data": {
            "files": reverted_files,
            "failed_files": failed_files,
            "total_reverted": len(reverted_files),
            "total_failed": len(failed_files),
            "recalled_message_count": len(deleted_message_ids),
            "rewinded_token_delta": rewinded_token_delta,
            "working_dir": working_dir,
        }
    }


@router.post("/delete-messages")
async def delete_messages(
    request: DeleteMessagesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """仅删除消息记录，不触碰文件变更。完全复用撤回机制的 is_deleted 软删除标记。"""
    from app.core.database import SessionMessageModel

    # 1. 验证会话归属
    session = db_manager.get_session(db, request.session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. 查找起始消息
    from_msg = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.id == request.from_message_id
    ).first()
    if not from_msg:
        raise HTTPException(status_code=404, detail="Message not found")

    target_index = from_msg.message_index

    # 3. 查找截止边界——下一条用户消息
    next_user_msg = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.message_index > target_index,
        SessionMessageModel.role == 'user',
        SessionMessageModel.is_deleted == False
    ).order_by(SessionMessageModel.message_index.asc()).first()

    # 4. 构建删除查询
    delete_query = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.message_index >= target_index
    )
    if next_user_msg:
        delete_query = delete_query.filter(
            SessionMessageModel.message_index < next_user_msg.message_index
        )

    deleted_messages = delete_query.all()
    deleted_message_ids = [m.id for m in deleted_messages]

    if not deleted_message_ids:
        return {"code": 200, "message": "No messages to delete", "data": {"deleted_ids": []}}

    # 5. 标记 is_deleted = True（与撤回机制完全一致）
    db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == request.session_id,
        SessionMessageModel.id.in_(deleted_message_ids)
    ).update({"is_deleted": True}, synchronize_session=False)

    db.commit()

    return {
        "code": 200,
        "message": "Messages deleted",
        "data": {"deleted_ids": deleted_message_ids}
    }


@router.post("/update-status")
async def update_change_status(
    request: UpdateChangeStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新变更状态"""
    change = db.query(FileChangeModel).filter(
        FileChangeModel.id == request.change_id
    ).first()
    
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    
    session = db_manager.get_session(db, change.session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    
    change.status = request.status
    db.commit()
    
    return {
        "code": 200,
        "message": "Status updated",
        "data": {
            "change_id": request.change_id,
            "status": request.status
        }
    }


@router.get("/diff/{change_id}")
async def get_change_diff(
    change_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取变更的diff内容"""
    change = db.query(FileChangeModel).filter(
        FileChangeModel.id == change_id
    ).first()
    
    if not change:
        raise HTTPException(status_code=404, detail="Change not found")
    
    session = db_manager.get_session(db, change.session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    
    old_content = ""
    new_content = ""
    
    if change.before_content_hash:
        old_bytes = cas.get_content(change.before_content_hash)
        if old_bytes:
            old_content = old_bytes.decode('utf-8', errors='replace')
    
    if change.after_content_hash:
        new_bytes = cas.get_content(change.after_content_hash)
        if new_bytes:
            new_content = new_bytes.decode('utf-8', errors='replace')
    
    return {
        "code": 200,
        "message": "Diff retrieved",
        "data": {
            "change_id": change_id,
            "file_path": change.file_path,
            "operation": change.operation,
            "old_content": old_content,
            "new_content": new_content,
            "diff_data": change.diff_data
        }
    }


@router.get("/content/{content_hash}")
async def get_file_content(
    content_hash: str,
    current_user: User = Depends(get_current_user)
):
    """获取文件内容（通过hash，撤回操作内部使用）"""
    content = cas.get_content(content_hash)
    if content is None:
        raise HTTPException(status_code=404, detail="Content not found")
    
    return {
        "code": 200,
        "message": "Content retrieved",
        "data": {
            "content_hash": content_hash,
            "content": content.decode('utf-8', errors='replace')
        }
    }


@router.get("/message-content/{session_id}/{message_id}")
async def get_message_file_content(
    session_id: str,
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定消息的净diff文件内容（before/after完整内容）"""
    session = db_manager.get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    
    changes = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == session_id,
        FileChangeModel.message_id == message_id,
        FileChangeModel.tool_call_id == None
    ).all()
    
    result = []
    for c in changes:
        old_content = ""
        new_content = ""
        if c.before_content_hash:
            old_bytes = cas.get_content(c.before_content_hash)
            if old_bytes:
                old_content = old_bytes.decode('utf-8', errors='replace')
        if c.after_content_hash:
            new_bytes = cas.get_content(c.after_content_hash)
            if new_bytes:
                new_content = new_bytes.decode('utf-8', errors='replace')
        
        result.append({
            "file_path": c.file_path,
            "operation": c.operation,
            "before_content": old_content,
            "after_content": new_content,
            "lines_added": c.lines_added,
            "lines_removed": c.lines_removed,
        })
    
    return {
        "code": 200,
        "message": "File content retrieved",
        "data": {
            "changes": result
        }
    }


@router.get("/stats/{session_id}")
async def get_session_stats(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话统计信息"""
    session = db_manager.get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    
    total_changes = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == session_id
    ).count()
    
    created_count = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == session_id,
        FileChangeModel.operation == "created"
    ).count()
    
    modified_count = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == session_id,
        FileChangeModel.operation == "modified"
    ).count()
    
    deleted_count = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == session_id,
        FileChangeModel.operation == "deleted"
    ).count()
    
    return {
        "code": 200,
        "message": "Stats retrieved",
        "data": {
            "total_changes": total_changes,
            "created_count": created_count,
            "modified_count": modified_count,
            "deleted_count": deleted_count
        }
    }


@router.get("/file-diff/{session_id}")
async def get_file_diff_hunks(
    session_id: str,
    file_path: str = Query(..., description="文件路径"),
    status: str = Query("pending", description="变更状态过滤：pending/accepted/reverted/all"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定文件在当前session中的所有diff hunks（编辑器装饰用）。"""
    session = db_manager.get_session(db, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    query = db.query(FileChangeModel).filter(
        FileChangeModel.session_id == session_id,
        FileChangeModel.file_path == file_path,
        FileChangeModel.tool_call_id == None
    )

    if status == "pending":
        query = query.filter(FileChangeModel.status == "pending")
    elif status == "accepted":
        query = query.filter(FileChangeModel.status == "accepted")
    elif status == "reverted":
        query = query.filter(FileChangeModel.status == "reverted")

    changes_query = query.order_by(FileChangeModel.created_at.asc()).all()

    changes = []
    for c in changes_query:
        item = {
            "id": c.id,
            "file_path": c.file_path,
            "operation": c.operation,
            "content_type": c.content_type,
            "diff_data": c.diff_data,
            "lines_added": c.lines_added,
            "lines_removed": c.lines_removed,
            "status": c.status,
            "message_id": c.message_id,
            "created_at": format_iso(c.created_at),
        }
        changes.append(item)

    return {
        "code": 200,
        "message": "File diff hunks retrieved",
        "data": {
            "changes": changes,
            "file_path": file_path,
            "total_pending": sum(1 for c in changes if c.get("status") == "pending"),
        }
    }
