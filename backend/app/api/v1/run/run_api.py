# -*- coding: utf-8 -*-
import asyncio
import json
import logging
import os
import time
from typing import Dict, List, Optional, Any, Set
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.core.database import get_db, db_manager, AgenticFlowSessionModel, SessionMessageModel
from app.core.execution_context import execution_context_manager
from SoloAgent.solo_agent.compiler import FlowRunner, CompiledFlowFactory
from SoloAgent.exception.exceptions import SoloEngineException
from SoloAgent.message.message_base import Msg
from app.api.v1.auth import get_current_user
from app.core.auth import User, auth_service
from app.core.config import settings
from app.utils.timezone_utils import format_iso

logger = logging.getLogger("SoloEngine")

from .run_context import AgenticFlowRunContext
from .run_collector import ChunkCollector
from .run_save import aggregate_incremental_to_net_view, save_session_message, load_and_distribute_memories, aggregate_token_totals

router = APIRouter(prefix="/api/v1/run", tags=["run"])


class ExecuteJSONRequest(BaseModel):
    canvas_data: Dict[str, Any] = Field(..., description="画布JSON数据")
    input_message: str = Field(..., description="输入消息")
    project_name: Optional[str] = Field(None, description="项目名称")
    context: Optional[Dict[str, Any]] = Field(None, description="执行上下文")
    agentic_flow_id: str = Field(..., description="AgenticFlow ID（必需）")
    session_id: str = Field(..., description="会话ID（必需）")
    run_project_id: str = Field(..., description="项目ID（必需）")


class ExecuteNodeRequest(BaseModel):
    canvas_data: Dict[str, Any] = Field(..., description="画布JSON数据")
    node_id: str = Field(..., description="节点ID")
    input_message: str = Field(..., description="输入消息")
    context: Optional[Dict[str, Any]] = Field(None, description="执行上下文")
    agentic_flow_id: str = Field(..., description="AgenticFlow ID（必需，用于数据隔离）")
    session_id: str = Field(..., description="会话ID（必需，用于数据隔离）")
    run_project_id: str = Field(..., description="项目ID（必需，用于数据隔离）")
    user_id: Optional[str] = Field(None, description="用户ID（可选，不传则使用当前登录用户）")


_active_websockets: Dict[str, WebSocket] = {}
_websocket_keys: Dict[str, Dict[str, str]] = {}
_websocket_timestamps: Dict[str, float] = {}
_cleanup_task: Optional[asyncio.Task] = None


def _make_websocket_key(user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> str:
    from app.utils.common_utils import make_cache_key
    return make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)


async def _cleanup_stale_connections():
    """定期清理超时的WebSocket连接。"""
    while True:
        try:
            await asyncio.sleep(settings.WEBSOCKET_CLEANUP_INTERVAL)
            current_time = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).timestamp()
            stale_keys = []
            
            for ws_key, ws in list(_active_websockets.items()):
                try:
                    if hasattr(ws, 'client_state') and ws.client_state.name == "DISCONNECTED":
                        stale_keys.append(ws_key)
                    elif ws_key in _websocket_timestamps:
                        if current_time - _websocket_timestamps[ws_key] > settings.RUN_SESSION_TIMEOUT:
                            stale_keys.append(ws_key)
                except Exception:
                    stale_keys.append(ws_key)
            
            for ws_key in stale_keys:
                ws = _active_websockets.pop(ws_key, None)
                _websocket_timestamps.pop(ws_key, None)
                _websocket_keys.pop(ws_key, None)
                if ws:
                    try:
                        await ws.close(code=1001, reason="Connection timeout")
                    except Exception:
                        pass
                logger.info(f"Cleaned up stale WebSocket connection: {ws_key}")
                
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in WebSocket cleanup task: {e}")


@router.on_event("startup")
async def startup_event():
    """应用启动时启动清理任务。"""
    global _cleanup_task
    _cleanup_task = asyncio.create_task(_cleanup_stale_connections())
    logger.info("WebSocket cleanup task started")


@router.on_event("shutdown")
async def shutdown_event():
    """应用关闭时停止清理任务。"""
    global _cleanup_task
    if _cleanup_task:
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
    logger.info("WebSocket cleanup task stopped")


def _get_timestamp() -> float:
    return datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).timestamp()


@router.post("/execute")
async def execute_workflow(
    request: ExecuteJSONRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        run_context = AgenticFlowRunContext(
            user_id=current_user.id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
        )
        
        # ★ str→Msg: 包装 str 为 Msg 对象
        input_msg = Msg(name="user", content=request.input_message, role="user")
        # 完全复用 WebSocket 路径：start_execution（保存 user 消息 + 设置
        # _last_user_message_id + 注册执行上下文）→ 等待执行完成 → on_execution_done
        # （更新 session 状态/token 聚合/发送终态事件）。不再手动 save_user_message。
        await run_context.start_execution({
            "input_message": input_msg,
            "canvas_data": request.canvas_data,
            "context": request.context or {},
        })
        await run_context._current_execution_task
        events = await run_context.on_execution_done()
        
        return {
            "code": 200,
            "message": "Workflow executed",
            "data": run_context._last_execute_result or events,
        }
    except Exception as e:
        logger.error(f"Workflow execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute-node")
async def execute_single_node(
    request: ExecuteNodeRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        user_id = current_user.id
        run_context = AgenticFlowRunContext(
            user_id=user_id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
        )
        await run_context.load_memories()
        
        # ★ str→Msg: 包装 str 为 Msg 对象
        input_msg = Msg(name="user", content=request.input_message, role="user")
        result = await run_context.execute_node(
            canvas_data=request.canvas_data,
            node_id=request.node_id,
            input_message=input_msg,
            context=request.context or {},
        )
        
        return {
            "code": 200,
            "message": "Node executed",
            "data": result
        }
    except Exception as e:
        logger.error(f"Node execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stream")
async def stream_workflow(
    http_request: Request,
    request: ExecuteJSONRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    import asyncio

    stream_queue = asyncio.Queue()
    execution_result = None
    execution_error = None

    run_context = AgenticFlowRunContext(
        user_id=current_user.id,
        agentic_flow_id=request.agentic_flow_id,
        session_id=request.session_id,
        run_project_id=request.run_project_id,
    )

    def stream_callback(delta: dict, agent_id=None, agent_name=None, message_id=None):
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(stream_queue.put(delta))
        except Exception as e:
            logger.error(f"Stream callback error: {e}")

    async def run_execution():
        nonlocal execution_result, execution_error
        try:
            # ★ str→Msg: 包装 str 为 Msg 对象
            input_msg = Msg(name="user", content=request.input_message, role="user")
            # 完全复用 WebSocket 路径：start_execution（保存 user 消息 + 设置
            # _last_user_message_id + 注册执行上下文 + 透传 stream_callback）
            # → 等待执行完成 → on_execution_done（session 状态/token 聚合/终态事件）。
            # 不再手动 save_user_message（C5 路径合并）。
            await run_context.start_execution({
                "input_message": input_msg,
                "canvas_data": request.canvas_data,
                "context": request.context or {},
            }, stream_callback=stream_callback)
            await run_context._current_execution_task
            await run_context.on_execution_done()
            execution_result = run_context._last_execute_result
        except Exception as e:
            execution_error = e
        finally:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(stream_queue.put(None))
            except:
                pass

    async def event_generator():
        execution_task = asyncio.create_task(run_execution())

        try:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Starting execution...'}, ensure_ascii=False)}\n\n"

            while True:
                # 检测客户端断开（AbortController.abort 触发），复用现有 stop_execution 机制真正停止 LLM
                if await http_request.is_disconnected():
                    logger.info("[SSE] Client disconnected, stopping execution")
                    await run_context.stop_execution()
                    break

                try:
                    delta = await asyncio.wait_for(stream_queue.get(), timeout=settings.WEBSOCKET_STREAM_QUEUE_TIMEOUT)
                    if delta is None:
                        break
                    yield f"data: {json.dumps({'type': 'stream', 'delta': delta}, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    if execution_task.done():
                        break
                    continue

            await execution_task

            if execution_error:
                yield f"data: {json.dumps({'type': 'error', 'message': str(execution_error)}, ensure_ascii=False)}\n\n"
            else:
                openai_message = execution_result.get("message", {"role": "assistant", "content": execution_result.get("output", "")}) if execution_result else {"role": "assistant", "content": ""}
                # M6：flow_runner 已剪除 token_usage 死字段，tokens 为唯一读取键
                tokens = execution_result.get("tokens") if execution_result else None
                yield f"data: {json.dumps({'type': 'execution_complete', 'message': openai_message, 'data': execution_result, 'tokens': tokens}, ensure_ascii=False)}\n\n"

        except asyncio.CancelledError:
            logger.info("[SSE] Generator cancelled, stopping execution")
            await run_context.stop_execution()
            raise
        except Exception as e:
            logger.error(f"SSE stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/sessions")
async def get_sessions(
    agentic_flow_id: str = Query(..., description="流程ID，必需"),
    run_project_id: str = Query(..., description="项目ID，必需"),
    status: Optional[str] = Query(None, description="状态过滤"),
    limit: int = Query(50, description="返回数量限制"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取运行会话列表。
    
    必须传入 agentic_flow_id、user_id、run_project_id 进行隔离。
    """
    query = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.user_id == current_user.id,
        AgenticFlowSessionModel.agentic_flow_id == agentic_flow_id,
        AgenticFlowSessionModel.run_project_id == run_project_id
    )
    
    if status:
        query = query.filter(AgenticFlowSessionModel.status == status)
    
    sessions = query.order_by(AgenticFlowSessionModel.updated_at.desc()).limit(limit).all()
    
    first_content_map = {}
    if sessions:
        session_ids = [s.id for s in sessions]
        min_index_subquery = db.query(
            SessionMessageModel.session_id,
            sqlfunc.min(SessionMessageModel.message_index).label('min_index')
        ).filter(
            SessionMessageModel.session_id.in_(session_ids),
            SessionMessageModel.role == 'assistant',
            SessionMessageModel.parent_agent_id.is_(None),
            SessionMessageModel.is_deleted == False
        ).group_by(SessionMessageModel.session_id).subquery()

        first_messages = db.query(SessionMessageModel).join(
            min_index_subquery,
            (SessionMessageModel.session_id == min_index_subquery.c.session_id) &
            (SessionMessageModel.message_index == min_index_subquery.c.min_index)
        ).filter(
            SessionMessageModel.is_deleted == False
        ).all()

        for msg in first_messages:
            if msg.data:
                for block in msg.data:
                    if block.get('type') == 'content' and block.get('content'):
                        first_content_map[msg.session_id] = block['content'][:50]
                        break

    result = []
    for s in sessions:
        result.append({
            "id": s.id,
            "agentic_flow_id": s.agentic_flow_id,
            "run_project_id": s.run_project_id,
            "status": s.status,
            "error": s.error,
            "token_usage": s.token_usage,
            "started_at": format_iso(s.started_at),
            "completed_at": format_iso(s.completed_at),
            "created_at": format_iso(s.created_at),
            "updated_at": format_iso(s.updated_at),
            "duration_ms": s.duration_ms,
            "first_assistant_content": first_content_map.get(s.id),
        })

    return {
        "code": 200,
        "message": "Sessions retrieved",
        "data": result
    }


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取运行会话详情。"""
    session = db_manager.get_session(db, session_id, user_id=current_user.id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "code": 200,
        "message": "Session retrieved",
        "data": {
            "id": session.id,
            "status": session.status,
            "error": session.error,
            "token_usage": session.token_usage,
            "started_at": format_iso(session.started_at),
            "completed_at": format_iso(session.completed_at),
            "created_at": format_iso(session.created_at),
            "updated_at": format_iso(session.updated_at),
            "duration_ms": session.duration_ms
        }
    }


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除运行会话及其所有消息。"""
    from app.core.database import SessionMessageModel
    from app.api.v1.file_changes import delete_messages, DeleteMessagesRequest

    session = db_manager.get_session(db, session_id, user_id=current_user.id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # 1. 获取所有未删除的消息
    all_messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.is_deleted == False
    ).all()

    # 2. 调用delete_messages处理消息和file_changes（统一路径）
    if all_messages:
        first_msg = all_messages[0]
        delete_request = DeleteMessagesRequest(
            session_id=session_id,
            from_message_id=first_msg.id
        )
        await delete_messages(delete_request, db, current_user)

    # 3. 物理删除session（级联删除消息）
    db.delete(session)
    db.commit()
    
    return {
        "code": 200,
        "message": "Session deleted successfully",
        "data": {"id": session_id}
    }


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话消息列表（统一格式）。
    
    所有消息的 data 都包含 agent_level 字段：
    - user 消息：agent_level = 0
    - assistant 消息：根据层级计算 agent_level
    
    注意：在扁平化拼接过程中被使用的 SubAgent 消息不会单独返回，
    而是作为其父消息的一部分返回。
    """
    session = db_manager.get_session(db, session_id, user_id=current_user.id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # 从 canvas_data 构建 agent_id -> agent_name 映射（subagent 嵌套块的 agent_name 来源；
    # 数据库消息无 agent_name 字段，前端组名依赖 block.agent_name）
    agent_name_map: Dict[str, str] = {}
    try:
        flow_model = session.agentic_flow
        if flow_model and flow_model.canvas_data:
            canvas = json.loads(flow_model.canvas_data) if isinstance(flow_model.canvas_data, str) else flow_model.canvas_data
            for node in (canvas.get("nodes") or []):
                node_id = node.get("id")
                node_name = (node.get("data") or {}).get("name")
                if node_id and node_name:
                    agent_name_map[str(node_id)] = str(node_name)
    except Exception as e:
        logger.warning(f"[get_session_messages] Failed to parse canvas_data for agent_name map: {e}")

    # 查询所有消息
    messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == current_user.id,
        SessionMessageModel.is_deleted == False
    ).order_by(SessionMessageModel.message_index).offset(offset).limit(limit).all()

    # 构建 parent_message_id -> [children] 映射（用于找 mainagent）
    children_map: Dict[str, List[SessionMessageModel]] = {}
    for m in messages:
        pid = str(m.parent_message_id) if m.parent_message_id else None
        if pid not in children_map:
            children_map[pid] = []
        children_map[pid].append(m)
    # 对每个 parent 的 children 按 message_index 排序
    for pid in children_map:
        children_map[pid].sort(key=lambda m: m.message_index or 0)

    matched_ids: set = set()  # 已通过 message_id 精确匹配的 subagent id

    def build_flattened_blocks(msg: SessionMessageModel, agent_level: int,
                               group_agent_tokens: Optional[int] = None,
                               group_agent_totals: Optional[Dict[str, Any]] = None,
                               group_agent_history: Optional[List[Dict[str, Any]]] = None,
                               source_tool_call_id: str = None,
                               instance_message_id: str = None) -> List[Dict[str, Any]]:
        """为单条 assistant 消息构建扁平化 blocks（含 subagent 嵌套）。

        遍历 msg.data blocks，遇产生子执行的 tool_call（tc.id 匹配 task 消息的
        source_tool_call_id）时精确匹配 subagent，将该 subagent 在本任务下的全部
        assistant 消息（stop → compacted → completed，按 message_index 排序）的 blocks
        插入到该 tool_call 之后——即 subagent 的压缩块嵌套在 subagent 层级
        （agent_level+1），而非顶层独立返回（问题 2 修复：压缩块应放在 subagent 层级）。

        实例标识（session_message_id）：每个块注入 message_id = msg.id（消息记录 id =
        预生成 message_id，与流式 agent_start metadata.message_id 完全一致）——前端
        groupDataBlocksByAgent 按 agent_id + message_id 分组（同 agent 并发 N 实例
        各自独立成组、组头 token 独立显示）。子组嵌套按 tc.id 精确关联：task 消息
        data 持久化 source_tool_call_id（= 产生该子执行的 tc.id，保存链路写入），
        子组块注入 source_tool_call_id，前端按 tc.id === 组 sourceToolCallId 对号
        （流式/回显统一，与工具名无关——所有工具调用天然拥有唯一 tc.id）。

        多轮压缩实例归组（instance_message_id）：压缩轮 stop/compacted/最终 completed
        是同一执行实例的多条 DB 记录（各自独立 id 落库，防 UNIQUE 冲突），前端必须
        归为同一实例组（流式阶段该实例只有一个 message_id）——调用方传入该执行第一条
        记录 id 统一注入全部块（mainagent merge / subagent 递归均传 sub_msgs[0].id），
        与流式 agent_start 的 message_id 完全一致，刷新前后归组/组头 token 不变。
        """
        result_blocks = []
        # 从 token_usage_history 计算 agent 级 token 总值
        history = msg.token_usage_history or []
        agent_total = sum(h.get('total_tokens', 0) for h in history)
        agent_prompt = sum(h.get('prompt_tokens', 0) for h in history)
        agent_completion = sum(h.get('completion_tokens', 0) for h in history)
        # 后端聚合改造（3.3-4）：块级本阶段聚合（压缩气泡 hover 用），从该消息 history 求和
        block_totals = aggregate_token_totals(history)
        for block in msg.data or []:
            enriched_block = {
                **block,
                'agent_id': msg.agent_id,
                # 嵌套 subagent 块的 agent_name 来源（问题 1/2 修复：所有 agent 前端显示一致）：
                # 数据库消息无 agent_name 字段，顶层 agent 名由前端 extractAgentName 从
                # canvas_data 实时查询，此处同样使用 canvas 映射，保证嵌套块与顶层一致
                'agent_name': agent_name_map.get(str(msg.agent_id)) or None,
                'agent_level': agent_level,
                'message_index': msg.message_index,
                'agent_tokens': agent_total or None,
                'agent_prompt_tokens': agent_prompt or None,
                'agent_completion_tokens': agent_completion or None,
                # 组级整轮累计（后端聚合改造：subagent 组头回显用）。该 subagent 本次
                # task 调用下全部消息（stop→compacted→completed）history 求和，
                # 与流式 agentUsageMap[agent_id] 整轮累计同构；块级 agent_tokens 仍为
                # 单消息（压缩气泡 tokens 用）。mainagent 调用不传（组头走消息级聚合）。
                'group_agent_tokens': group_agent_tokens,
                'group_agent_totals': group_agent_totals,
                'group_agent_history': group_agent_history,
                # 实例标识（session_message_id）：消息记录 id = 预生成 message_id，
                # 与流式 agent_start metadata.message_id 一致（前端归组/组头 token 键）。
                # 多轮压缩归组：同一执行实例的多条记录（stop/compacted/completed）由调用方
                # 传入 instance_message_id（该执行第一条记录 id）统一注入——刷新前后组结构
                # 不变（流式该实例本就只有一个 message_id）。
                'message_id': instance_message_id or str(msg.id),
                # tc.id 方案：产生本子执行的 tool_call id（task 消息 source_tool_call_id 透传），
                # 前端按 tc.id === 组 sourceToolCallId 对号（流式/回显统一）
                'source_tool_call_id': source_tool_call_id,
                # 问题 3 修复：注入该 agent 的 token_usage_history（subagent 组头/压缩气泡
                # hover 详情数据源，与流式 injectAgentTokens 注入的 history 同构）。
                # 块级 history 与消息级 msg.token_usage_history 等价（前端 TokenBadge 通用）。
                'agent_token_history': history,
                # 后端聚合改造（3.3-4）：块级本阶段聚合（压缩气泡 hover 用），
                # 与 agent_token_history 同源（后端算好，前端不再求和）
                'agent_token_totals': block_totals,
            }
            # 压缩摘要块标记：compacted 消息的全部块（content 摘要 + reasoning_content 思考）
            # 统一标记为「上下文已压缩」气泡，与流式路径（react_core 压缩轮 reasoning/content
            # 均带 _is_compaction）完全同构（问题 1 修复：压缩轮 thought 归入压缩气泡，
            # 不再被当作 subagent/mainagent 的普通内容）。
            if msg.status == 'compacted' and block.get('type') in ('content', 'reasoning_content'):
                enriched_block['_is_compaction'] = True
            result_blocks.append(enriched_block)
            # 遇产生子执行的 tool_call：精确拼接该 subagent 本次任务下的全部 assistant 消息
            # （stop → compacted → completed，按 message_index 排序），使 subagent 的压缩块
            # 嵌套在 subagent 层级（agent_level+1）而非顶层独立返回（问题 2 修复）。
            # 关联键 = tc.id（产生本子执行的 tool_call id）：在 role='user' 的 task 消息
            # data 中找 source_tool_call_id === tc.id 的消息（保存链路持久化）——
            # 与工具名无关（所有工具调用天然拥有唯一 tc.id），流式/回显统一对号。
            if block.get('type') == 'tool_calls':
                for tc in block.get('tool_calls', []):
                    tc_id = tc.get('id')
                    if not tc_id:
                        continue
                    # task 消息：role='user' 且 data 中 source_tool_call_id === tc_id
                    #（保存链路写入），其 id 即本次任务根（subagent 消息的 parent_message_id）
                    task_msg = next(
                        (m for m in messages if m.role == 'user'
                         and any(isinstance(b, dict) and b.get('source_tool_call_id') == tc_id
                                 for b in (m.data or []))),
                        None
                    )
                    if not task_msg:
                        continue
                    root_task_id = str(task_msg.id)
                    sub_msgs = [
                        m for m in messages
                        if str(m.parent_message_id) == root_task_id
                        and m.role == 'assistant'
                        and str(m.id) not in matched_ids
                    ]
                    sub_msgs.sort(key=lambda m: m.message_index or 0)
                    # 组级聚合（后端聚合改造）：该 subagent 本次 task 调用下全部消息
                    # （stop→compacted→completed）history 求和，作为组头回显的整轮累计，
                    # 与流式 agentUsageMap[agent_id] 同构——前端不再按 blocks 拼接。
                    _sub_history: List[Dict[str, Any]] = []
                    for _sm in sub_msgs:
                        _sub_history.extend(_sm.token_usage_history or [])
                    _group_agent_tokens = sum(h.get('total_tokens', 0) for h in _sub_history) or None
                    _group_agent_totals = aggregate_token_totals(_sub_history)
                    for sub_msg in sub_msgs:
                        matched_ids.add(str(sub_msg.id))
                        sub_blocks = build_flattened_blocks(
                            sub_msg, agent_level + 1,
                            _group_agent_tokens, _group_agent_totals, _sub_history,
                            source_tool_call_id=tc_id,
                            # 多轮压缩归组：该执行全部记录（stop→compacted→completed）统一
                            # 注入第一条记录 id（流式 agent_start message_id），前端单组渲染
                            instance_message_id=str(sub_msgs[0].id),
                        )
                        result_blocks.extend(sub_blocks)
        return result_blocks

    result = []
    # 〇·5 回显端：roots 用 role='user' AND parent_message_id IS NULL（task 消息
    # parent_message_id 非空天然排除——task user 消息以 role='user' 保存但挂在
    # mainagent 消息下，不再依赖 'default' 占位 agent_id 识别人类输入）
    roots = [m for m in messages if m.role == 'user' and not m.parent_message_id]
    roots.sort(key=lambda m: m.message_index or 0)

    for user_msg in roots:
        # 1. 加入 user 消息
        unified_data = []
        for block in user_msg.data or []:
            unified_data.append({
                **block,
                'agent_id': None,
                'agent_name': '用户',
                'agent_level': 0
            })
        result.append({
            "id": user_msg.id,
            "role": "user",
            "agent_id": user_msg.agent_id,
            "parent_agent_id": user_msg.parent_agent_id,
            "parent_message_id": user_msg.parent_message_id,
            "data": unified_data,
            "status": user_msg.status,
            "error": user_msg.error,
            "message_index": user_msg.message_index,
            "token_usage_history": user_msg.token_usage_history,
            # 后端聚合改造（3.3-3）：user 消息无 token，聚合为空对象、tokens 为 None
            "token_usage": {},
            "tokens": None,
            "is_compressed": user_msg.is_compressed,
            "timestamp": format_iso(user_msg.timestamp),
            "created_at": format_iso(user_msg.created_at),
        })
        matched_ids.add(str(user_msg.id))

        # 2. 找 parent_message_id=user.id 的 mainagent 消息并合并为一条（3.3）：
        #    同一 user 下的 mainagent stop/compacted/completed 按 message_index 合并——
        #    data 顺序拼接、token_usage_history 拼接、聚合 5 字段 + total 后端算好，
        #    与流式"mainagent 单条消息"同构（前端 loadMessagesWithFileChanges 的
        #    pendingMain 合并逻辑删除，前端不再拼接）。
        mainagent_children = [
            m for m in messages
            if str(m.parent_message_id) == str(user_msg.id)
            and str(m.id) not in matched_ids
        ]
        mainagent_msgs = [
            m for m in mainagent_children
            if m.role == 'assistant'  # 跳过 task 消息（role='user'）
        ]
        mainagent_msgs.sort(key=lambda m: m.message_index or 0)
        if mainagent_msgs:
            merged_data = []
            merged_history = []
            for mainagent_msg in mainagent_msgs:
                matched_ids.add(str(mainagent_msg.id))
                merged_history.extend(mainagent_msg.token_usage_history or [])
                # 多轮压缩归组：mainagent 压缩轮 stop/compacted/最终 completed 多条记录统一
                # 注入第一条记录 id（流式 agent_start message_id），前端单组渲染
                merged_data.extend(build_flattened_blocks(mainagent_msg, 0, instance_message_id=str(mainagent_msgs[0].id)))
            first_msg = mainagent_msgs[0]
            last_msg = mainagent_msgs[-1]
            merged_totals = aggregate_token_totals(merged_history)
            result.append({
                "id": first_msg.id,
                "role": "assistant",
                "agent_id": first_msg.agent_id,
                "parent_agent_id": first_msg.parent_agent_id,
                "parent_message_id": first_msg.parent_message_id,
                "data": merged_data,
                "status": last_msg.status,
                "error": last_msg.error,
                "message_index": first_msg.message_index,
                "token_usage_history": merged_history,
                # 后端聚合改造（3.3-1）：合并后聚合字段（消息头 hover 数据源）
                "token_usage": merged_totals,
                "tokens": merged_totals["total"],
                "is_compressed": last_msg.is_compressed,
                "timestamp": format_iso(first_msg.timestamp),
                "created_at": format_iso(first_msg.created_at),
            })

    # 4. 压缩轮次相关消息独立返回：subagent 的 pre-compaction 输出（status=stop）与
    #    压缩摘要（status=compacted）的 parent_message_id 指向 subagent 的 task 消息
    #    （非 user 消息），不在 mainagent_children 分支中返回。为满足
    #    "LLM块 → 压缩轮 → LLM块"的回显顺序，未被拼接的 stop/compacted assistant
    #    消息单独返回，并按 message_index 整体排序（agent_level=1：subagent 层）。
    for m in messages:
        if str(m.id) not in matched_ids and m.role == "assistant" and m.status in ("stop", "compacted"):
            matched_ids.add(str(m.id))
            totals = aggregate_token_totals(m.token_usage_history or [])
            result.append({
                "id": str(m.id),
                "role": m.role,
                "agent_id": m.agent_id,
                "parent_agent_id": m.parent_agent_id,
                "parent_message_id": m.parent_message_id,
                "data": build_flattened_blocks(m, 1),
                "status": m.status,
                "error": m.error,
                "message_index": m.message_index,
                "token_usage_history": m.token_usage_history,
                # 后端聚合改造（3.3-2）：未被拼接的独立 stop/compacted 同样附加聚合字段
                "token_usage": totals,
                "tokens": totals["total"],
                "is_compressed": m.is_compressed,
                "timestamp": format_iso(m.timestamp),
                "created_at": format_iso(m.created_at),
            })

    # 5. 按 message_index 排序，保证"LLM块→压缩轮→LLM块"回显顺序
    result.sort(key=lambda r: r.get("message_index") or 0)

    return {
        "code": 200,
        "message": "Messages retrieved",
        "data": result
    }

@router.post("/clear-cache/{user_id}/{agentic_flow_id}/{session_id}/{run_project_id}")
async def clear_flow_cache(
    user_id: str,
    agentic_flow_id: str,
    session_id: str,
    run_project_id: str,
    current_user: User = Depends(get_current_user)
):
    """清除指定 Flow 的编译缓存。"""
    if user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作其他用户的缓存")
    removed = CompiledFlowFactory.remove(user_id, agentic_flow_id, session_id, run_project_id)
    return {
        "code": 200,
        "message": "Cache cleared" if removed else "Cache not found",
        "data": {"user_id": user_id, "agentic_flow_id": agentic_flow_id, "session_id": session_id, "run_project_id": run_project_id, "removed": removed}
    }


@router.post("/clear-cache")
async def clear_all_cache(
    current_user: User = Depends(get_current_user)
):
    """清除所有编译缓存。"""
    CompiledFlowFactory.clear_all()
    return {
        "code": 200,
        "message": "All cache cleared",
        "data": CompiledFlowFactory.get_stats()
    }


@router.get("/cache-stats")
async def get_cache_stats(
    current_user: User = Depends(get_current_user)
):
    """获取缓存统计信息。"""
    return {
        "code": 200,
        "message": "Cache stats retrieved",
        "data": CompiledFlowFactory.get_stats()
    }
