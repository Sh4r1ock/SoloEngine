# -*- coding: utf-8 -*-
"""
运行 API endpoints。

@file run.py
@description 运行接口 - 工作流运行相关API端点
@author SoloEngine Team
@date 2026-02-19

功能描述：
- JSON工作流执行接口
- 单节点执行接口
- 运行会话管理接口
- 执行历史查询接口
- WebSocket实时通信端点

使用场景：
- 工作流运行管理
- 执行历史查询

注意事项：
- 会话数据存储在SQLite数据库中
"""
import asyncio
import json
import os
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
import uuid


def format_datetime(dt: datetime) -> Optional[str]:
    """格式化 datetime 为 ISO 格式字符串，确保包含 UTC 时区信息。"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.isoformat()
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db, db_manager, AgenticFlowSessionModel, SessionMessageModel, get_db_context
from SoloAgent.solo_agent.compiler import AgenticFlowCompiler, FlowRunner, CompiledFlowFactory
from app.api.v1.auth import get_current_user
from app.core.auth import User, auth_service
from app.core.config import settings
from app.core.execution_context import execution_context_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/run", tags=["run"])


class ChunkCollector:
    """收集流式chunk并合并，支持多agent"""
    
    def __init__(self):
        self._chunks = []
        self._agent_data = {}
        self._current_agent_id = None
        self._current_agent_name = None
        self._current_block = {}
    
    def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
        """添加chunk，支持agent_id分组"""
        if agent_id and agent_id != self._current_agent_id:
            if self._current_block and self._current_agent_id:
                if self._current_agent_id not in self._agent_data:
                    self._agent_data[self._current_agent_id] = {
                        'agent_name': self._current_agent_name,
                        'data': []
                    }
                self._agent_data[self._current_agent_id]['data'].append(self._current_block)
                self._current_block = {}
            self._current_agent_id = agent_id
            self._current_agent_name = agent_name
        
        if self._current_agent_id and self._current_agent_id not in self._agent_data:
            self._agent_data[self._current_agent_id] = {
                'agent_name': self._current_agent_name,
                'data': []
            }
        
        chunk_type = self._normalize_type(delta)
        content = self._extract_content(delta, chunk_type)
        
        if chunk_type == 'tool_calls':
            # tool_calls 类型：按 id 拼接合并
            if self._current_block and self._current_block.get('type') == 'tool_calls':
                existing_tool_calls = self._current_block.get('tool_calls', [])
                for new_tool_call in content:
                    tool_id = new_tool_call.get('id')
                    if tool_id:
                        # 按 id 查找已存在的 tool_call
                        found = False
                        for existing_call in existing_tool_calls:
                            if existing_call.get('id') == tool_id:
                                found = True
                                # 拼接合并：浅合并所有字段
                                for key, value in new_tool_call.items():
                                    if key == 'function' and isinstance(value, dict):
                                        # function 字段需要深度合并
                                        if 'function' not in existing_call:
                                            existing_call['function'] = {}
                                        existing_func = existing_call['function']
                                        for func_key, func_value in value.items():
                                            if func_key == 'arguments':
                                                # arguments 字段：追加拼接
                                                existing_func['arguments'] = existing_func.get('arguments', '') + func_value
                                            else:
                                                # 其他字段：覆盖
                                                if func_key not in existing_func:
                                                    existing_func[func_key] = func_value
                                    elif key not in existing_call or existing_call.get(key) is None:
                                        # 其他字段：首次出现时设置
                                        existing_call[key] = value
                                    elif key in ['status', 'result', 'error']:
                                        # status/result/error：直接覆盖
                                        existing_call[key] = value
                                break
                        if not found:
                            # 新的 tool_call，追加
                            existing_tool_calls.append(new_tool_call)
                self._current_block['tool_calls'] = existing_tool_calls
            else:
                # 当前块不是 tool_calls 类型，保存旧块，创建新块
                if self._current_block and self._current_agent_id:
                    if self._current_agent_id not in self._agent_data:
                        self._agent_data[self._current_agent_id] = {
                            'agent_name': self._current_agent_name,
                            'data': []
                        }
                    self._agent_data[self._current_agent_id]['data'].append(self._current_block)
                self._current_block = {'type': 'tool_calls', 'tool_calls': content}
        else:
            if self._current_block and self._current_block.get('type') == chunk_type:
                self._current_block[chunk_type] = (self._current_block.get(chunk_type, "") or "") + content
            else:
                if self._current_block:
                    self._agent_data[self._current_agent_id]['data'].append(self._current_block)
                self._current_block = {chunk_type: content, 'type': chunk_type}
        
        self._chunks.append({'delta': delta, 'agent_id': agent_id})
    
    def _normalize_type(self, delta: dict) -> str:
        if isinstance(delta, str):
            return 'content'
        raw_type = delta.get("type", None)
        if raw_type in ('thinking', 'think', 'reason', 'reasoning_content'):
            return 'reasoning_content'
        if raw_type in ('tool_use', 'tool_call', 'tool_calls') or 'tool_calls' in delta:
            return 'tool_calls'
        if 'reasoning_content' in delta and delta.get('reasoning_content'):
            return 'reasoning_content'
        if 'content' in delta:
            return 'content'
        return 'content'
    
    def _extract_content(self, delta: dict, chunk_type: str):
        if isinstance(delta, str):
            return delta
        if chunk_type == 'reasoning_content':
            return delta.get('reasoning_content', '') or delta.get('thinking', '') or delta.get('text', '')
        elif chunk_type == 'tool_calls':
            return delta.get('tool_calls', [])
        else:
            return delta.get('content', '') or delta.get('text', '')
    
    def get_agent_data(self) -> dict:
        if self._current_block and self._current_agent_id:
            if self._current_agent_id not in self._agent_data:
                self._agent_data[self._current_agent_id] = {
                    'agent_name': self._current_agent_name,
                    'data': []
                }
            self._agent_data[self._current_agent_id]['data'].append(self._current_block)
            self._current_block = {}
        return self._agent_data
    
    def get_merged_data(self) -> list:
        agent_data = self.get_agent_data()
        for agent_id, data in agent_data.items():
            return data['data']
        return []
    
    def get_chunk_count(self) -> int:
        return len(self._chunks)
    
    def get_agent_ids(self) -> list:
        return list(self._agent_data.keys())


async def save_session_message(
    db: Session, session_id: str, user_id: str, role: str,
    data: list, status: str = "completed", agent_id: str = "default",
    tokens: dict = None,
    agentic_flow_id: str = None,
    run_project_id: str = None,
    parent_message_id: str = None
):
    """保存session消息到数据库
    
    Args:
        db: 数据库会话
        session_id: 会话ID
        user_id: 用户ID
        role: 角色（user/assistant）
        data: 消息数据列表，如果手动停止且没有chunk则为空列表[]
        status: 消息状态（completed/stopped/error）
        agent_id: Agent ID
        tokens: token使用信息
        agentic_flow_id: AgenticFlow ID（用于创建新session时）
        run_project_id: Run Project ID（用于创建新session时）
        parent_message_id: 父消息ID
    """
    from app.core.database import SessionMessageModel, func, AgenticFlowSessionModel
    
    if data is None:
        data = []
    
    if not agent_id:
        agent_id = "default"
    
    try:
        session = db.query(AgenticFlowSessionModel).filter(
            AgenticFlowSessionModel.id == session_id
        ).first()
        
        if not session:
            if not agentic_flow_id or not run_project_id:
                raise ValueError("agentic_flow_id and run_project_id are required to create a new session")
            session = AgenticFlowSessionModel(
                id=session_id,
                user_id=user_id,
                agentic_flow_id=agentic_flow_id,
                run_project_id=run_project_id,
                status="pending",
            )
            db.add(session)
            db.commit()
            logger.info(f"Created new session {session_id} when saving message")
        
        max_index = db.query(func.max(SessionMessageModel.message_index)).filter(
            SessionMessageModel.session_id == session_id
        ).scalar()
        
        if max_index is None:
            max_index = -1
        
        message = SessionMessageModel(
            session_id=session_id,
            user_id=user_id,
            agent_id=agent_id,
            role=role,
            data=data,
            status=status,
            message_index=max_index + 1,
            parent_message_id=parent_message_id
        )
        
        if tokens:
            message.prompt_tokens = tokens.get('prompt_tokens')
            message.completion_tokens = tokens.get('completion_tokens')
            message.total_tokens = tokens.get('total_tokens')
        
        db.add(message)
        db.commit()
        db.refresh(message)
        logger.info(f"Saved {role} message to session {session_id}: message_id={message.id}, {len(data)} blocks, status={status}")
        return message
    except Exception as e:
        logger.error(f"Failed to save message: {e}")
        db.rollback()
        raise


async def load_and_distribute_memories(
    db: Session, 
    session_id: str, 
    user_id: str
) -> Dict[str, List[Dict]]:
    """从数据库读取记忆并按 agent_id 分发"""
    from app.core.database import SessionMessageModel
    
    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id
    ).order_by(SessionMessageModel.message_index).all()
    
    agent_memories = {}
    shared_memories = []
    
    for record in records:
        data = record.data or []
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                data = []
        message = {
            "role": record.role,
            "content": data,
            "agent_id": record.agent_id
        }
        
        if record.agent_id and record.agent_id != "default":
            if record.agent_id not in agent_memories:
                agent_memories[record.agent_id] = []
            agent_memories[record.agent_id].append(message)
        else:
            shared_memories.append(message)
    
    for agent_id in agent_memories:
        agent_memories[agent_id] = shared_memories + agent_memories[agent_id]
    
    if not agent_memories and shared_memories:
        agent_memories["default"] = shared_memories
    
    return agent_memories


def _extract_content_from_data(data: list) -> str:
    """从 data 字段提取文本内容"""
    if not data:
        return ""
    for item in data:
        if item.get("type") == "content":
            return item.get("content", "")
    return ""


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


class RunMessage(BaseModel):
    type: str
    data: Dict[str, Any]
    session_id: str
    timestamp: float


_active_websockets: Dict[str, WebSocket] = {}
_websocket_keys: Dict[str, Dict[str, str]] = {}
_websocket_timestamps: Dict[str, float] = {}
_cleanup_task: Optional[asyncio.Task] = None


def _make_websocket_key(user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> str:
    """生成 WebSocket 存储的 key - 四参数隔离"""
    return f"{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}"


async def _cleanup_stale_connections():
    """定期清理超时的WebSocket连接。"""
    while True:
        try:
            await asyncio.sleep(60)
            current_time = datetime.now().timestamp()
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
    return datetime.now().timestamp()


async def _broadcast_message(session_id: str, message: RunMessage):
    ws = _active_websockets.get(session_id)
    if ws:
        try:
            await ws.send_json(message.dict())
        except Exception:
            _active_websockets.pop(session_id, None)


@router.post("/execute")
async def execute_workflow(
    request: ExecuteJSONRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """执行JSON工作流。"""
    try:
        result = await FlowRunner.run_from_json(
            request.canvas_data,
            request.input_message,
            user_id=current_user.id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
            context=request.context or {}
        )
        
        return {
            "code": 200,
            "message": "Workflow executed",
            "data": result
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
    """执行单个节点。"""
    try:
        result = await FlowRunner.run_node(
            request.canvas_data,
            request.node_id,
            request.input_message,
            user_id=current_user.id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
            context=request.context or {}
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
    request: ExecuteJSONRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """SSE流式执行工作流 - 作为WebSocket的降级方案。"""
    import asyncio
    
    stream_queue = asyncio.Queue()
    execution_result = None
    execution_error = None
    collector = ChunkCollector()
    
    def stream_callback(delta: dict):
        try:
            collector.add_chunk(delta)
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(stream_queue.put(delta))
        except Exception as e:
            logger.error(f"Stream callback error: {e}")
    
    async def run_execution():
        nonlocal execution_result, execution_error
        try:
            result = await FlowRunner.run_from_json(
                request.canvas_data,
                request.input_message,
                user_id=current_user.id,
                agentic_flow_id=request.agentic_flow_id,
                session_id=request.session_id,
                run_project_id=request.run_project_id,
                context=request.context or {},
                stream_callback=stream_callback
            )
            execution_result = result
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
                try:
                    delta = await asyncio.wait_for(stream_queue.get(), timeout=1.0)
                    if delta is None:
                        break
                    yield f"data: {json.dumps({'type': 'stream', 'delta': delta}, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    if execution_task.done():
                        break
                    continue
            
            await execution_task
            
            if execution_error:
                status = "error"
                yield f"data: {json.dumps({'type': 'error', 'message': str(execution_error)}, ensure_ascii=False)}\n\n"
            else:
                status = "completed"
                openai_message = execution_result.get("message", {"role": "assistant", "content": execution_result.get("output", "")})
                yield f"data: {json.dumps({'type': 'execution_complete', 'message': openai_message, 'data': execution_result}, ensure_ascii=False)}\n\n"
            
            if request.session_id:
                try:
                    user_data = [{"type": "content", "content": request.input_message}]
                    await save_session_message(
                        db=db, session_id=request.session_id, user_id=current_user.id,
                        role="user", data=user_data, agent_id="default",
                        agentic_flow_id=request.agentic_flow_id, run_project_id=request.run_project_id
                    )
                    
                    agent_data = collector.get_agent_data()
                    if agent_data:
                        for agent_id_key, agent_info in agent_data.items():
                            data = agent_info['data']
                            if not data:
                                data = [{"type": "content", "content": f"Status: {status}"}]
                            await save_session_message(
                                db=db, session_id=request.session_id, user_id=current_user.id,
                                role="assistant", data=data, status=status, agent_id=agent_id_key,
                                agentic_flow_id=request.agentic_flow_id, run_project_id=request.run_project_id
                            )
                    else:
                        await save_session_message(
                            db=db, session_id=request.session_id, user_id=current_user.id,
                            role="assistant", 
                            data=[{"type": "content", "content": execution_result.get("output", "") if execution_result else ""}],
                            status=status, agent_id="default",
                            agentic_flow_id=request.agentic_flow_id, run_project_id=request.run_project_id
                        )
                except Exception as save_error:
                    logger.error(f"Failed to save session messages: {save_error}")
                
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
    
    sessions = query.order_by(AgenticFlowSessionModel.created_at.desc()).limit(limit).all()
    
    result = []
    for s in sessions:
        first_assistant_msg = db.query(SessionMessageModel).filter(
            SessionMessageModel.session_id == s.id,
            SessionMessageModel.role == 'assistant'
        ).order_by(SessionMessageModel.message_index).first()
        
        first_assistant_content = None
        if first_assistant_msg and first_assistant_msg.data:
            for block in first_assistant_msg.data:
                if block.get('type') == 'content' and block.get('content'):
                    first_assistant_content = block['content'][:30]
                    break
        
        result.append({
            "id": s.id,
            "agentic_flow_id": s.agentic_flow_id,
            "run_project_id": s.run_project_id,
            "status": s.status,
            "error": s.error,
            "token_usage": s.token_usage,
            "started_at": format_datetime(s.started_at),
            "completed_at": format_datetime(s.completed_at),
            "created_at": format_datetime(s.created_at),
            "updated_at": format_datetime(s.updated_at),
            "duration_ms": s.duration_ms,
            "first_assistant_content": first_assistant_content,
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
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
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
            "started_at": format_datetime(session.started_at),
            "completed_at": format_datetime(session.completed_at),
            "created_at": format_datetime(session.created_at),
            "updated_at": format_datetime(session.updated_at),
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
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
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
    """获取会话消息列表。
    
    根据 session_id 和 user_id 获取消息，确保用户隔离。
    """
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == current_user.id
    ).order_by(SessionMessageModel.message_index).offset(offset).limit(limit).all()
    
    return {
        "code": 200,
        "message": "Messages retrieved",
        "data": [
            {
                "id": m.id,
                "role": m.role,
                "agent_id": m.agent_id,
                "data": m.data,
                "status": m.status,
                "message_index": m.message_index,
                "prompt_tokens": m.prompt_tokens,
                "completion_tokens": m.completion_tokens,
                "total_tokens": m.total_tokens,
                "created_at": format_datetime(m.created_at)
            }
            for m in messages
        ]
    }


@router.get("/sessions/{session_id}/messages/by-agent")
async def get_session_messages_by_agent(
    session_id: str,
    agent_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话消息列表，按 agent_id 分组。
    
    根据 session_id、user_id 和可选的 agent_id 获取消息。
    """
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    query = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == current_user.id
    )
    
    if agent_id:
        query = query.filter(SessionMessageModel.agent_id == agent_id)
    
    messages = query.order_by(SessionMessageModel.message_index).all()
    
    agent_messages = {}
    for m in messages:
        if m.agent_id not in agent_messages:
            agent_messages[m.agent_id] = []
        agent_messages[m.agent_id].append({
            "id": m.id,
            "role": m.role,
            "agent_id": m.agent_id,
            "data": m.data,
            "status": m.status,
            "message_index": m.message_index,
            "prompt_tokens": m.prompt_tokens,
            "completion_tokens": m.completion_tokens,
            "total_tokens": m.total_tokens,
            "created_at": format_datetime(m.created_at)
        })
    
    return {
        "code": 200,
        "message": "Messages retrieved by agent",
        "data": agent_messages
    }


@router.get("/sessions/{session_id}/steps")
async def get_session_steps(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话执行步骤。"""
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "code": 200,
        "message": "Steps retrieved",
        "data": [
            {
                "id": s.id,
                "step_type": s.step_type,
                "node_id": s.node_id,
                "node_name": s.node_name,
                "thought": s.thought,
                "action": s.action,
                "observation": s.observation,
                "error": s.error,
                "created_at": s.created_at.isoformat() if s.created_at else None
            }
            for s in session.steps
        ]
    }


@router.get("/sessions/{session_id}/tools")
async def get_session_tool_calls(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话工具调用记录。"""
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "code": 200,
        "message": "Tool calls retrieved",
        "data": [
            {
                "id": t.id,
                "tool_name": t.tool_name,
                "arguments": t.arguments,
                "result": t.result,
                "error": t.error,
                "created_at": t.created_at.isoformat() if t.created_at else None
            }
            for t in session.tool_calls
        ]
    }


@router.get("/sessions/{session_id}/export")
async def export_session(
    session_id: str, 
    format: str = "json", 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导出会话数据。"""
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id
    ).order_by(SessionMessageModel.message_index).all()

    if format == "json":
        data = {
            "id": session.id,
            "status": session.status,
            "error": session.error,
            "token_usage": session.token_usage,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "completed_at": session.completed_at.isoformat() if session.completed_at else None,
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "timestamp": m.timestamp.isoformat() if m.timestamp else None
                }
                for m in messages
            ],
            "steps": [
                {
                    "step_type": s.step_type,
                    "node_name": s.node_name,
                    "thought": s.thought,
                    "action": s.action,
                    "observation": s.observation
                }
                for s in session.steps
            ],
            "tool_calls": [
                {
                    "tool_name": t.tool_name,
                    "arguments": t.arguments,
                    "result": t.result
                }
                for t in session.tool_calls
            ]
        }
        return {
            "code": 200,
            "message": "Session exported",
            "data": data
        }
    else:
        content = f"Session: {session.id}\n"
        content += f"Status: {session.status}\n"
        content += f"Messages: {len(messages)}\n"
        for m in messages:
            content += f"  [{m.role}]: {m.content[:100]}...\n"
        return {
            "code": 200,
            "message": "Session exported",
            "data": {"content": content}
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


async def _send_event(websocket: WebSocket, session_id: str, event: Any):
    """发送执行事件到WebSocket客户端。"""
    try:
        await websocket.send_json({
            "type": "execution_event",
            "data": event if isinstance(event, dict) else event.__dict__ if hasattr(event, '__dict__') else str(event),
            "session_id": session_id,
            "timestamp": _get_timestamp()
        })
    except Exception as e:
        logger.error(f"Failed to send event: {e}")


@router.websocket("/ws/{agentic_flow_id}/{session_id}/{run_project_id}")
async def run_websocket(
    websocket: WebSocket, 
    agentic_flow_id: str,
    session_id: str,
    run_project_id: str,
    token: str = Query(None)
):
    """WebSocket端点用于实时运行消息。
    
    URL 格式: /ws/{agentic_flow_id}/{session_id}/{run_project_id}?token=xxx
    """
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return
    
    payload = auth_service.decode_token(token)
    if not payload or payload.get("type") != "access":
        await websocket.close(code=4001, reason="Invalid or expired token")
        return
    
    user_id = payload.get("sub")
    if not user_id:
        await websocket.close(code=4001, reason="Invalid token payload")
        return
    
    user = await auth_service.get_user(user_id)
    if not user or not user.is_active:
        await websocket.close(code=4001, reason="User not found or inactive")
        return

    await websocket.accept()
    
    ws_key = _make_websocket_key(user_id, agentic_flow_id, session_id, run_project_id)
    _active_websockets[ws_key] = websocket
    _websocket_keys[ws_key] = {
        "agentic_flow_id": agentic_flow_id,
        "session_id": session_id,
        "run_project_id": run_project_id,
        "user_id": user_id,
    }
    _websocket_timestamps[ws_key] = _get_timestamp()

    stored_canvas_data: Dict = {}
    
    def event_callback(event):
        """事件回调函数 - 在同步上下文中调度异步发送"""
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_send_event(websocket, session_id, event))
        except Exception as e:
            logger.error(f"Event callback error: {e}")

    with get_db_context() as db:
        session = db.query(AgenticFlowSessionModel).filter(
            AgenticFlowSessionModel.id == session_id
        ).first()
        
        agent_memories = await load_and_distribute_memories(db, session_id, user_id) if session else {}
        
        websocket_open = True
        
        try:
            current_execution_task: Optional[asyncio.Task] = None
            current_cancel_event: Optional[asyncio.Event] = None
            current_collector: Optional[ChunkCollector] = None
            status = "completed"
            error_msg = None
            
            message_queue = asyncio.Queue()
            
            async def message_receiver():
                while websocket_open:
                    try:
                        data = await websocket.receive_json()
                        _websocket_timestamps[ws_key] = _get_timestamp()
                        await message_queue.put(data)
                    except WebSocketDisconnect:
                        await message_queue.put({"type": "__disconnect__"})
                        break
                    except Exception as e:
                        logger.error(f"[WebSocket] Message receiver error: {e}")
                        break
            
            receiver_task = asyncio.create_task(message_receiver())
            last_user_message_id = None
            
            while websocket_open:
                pending_tasks = []
                
                message_task = asyncio.create_task(message_queue.get())
                pending_tasks.append(message_task)
                
                if current_execution_task and not current_execution_task.done():
                    pending_tasks.append(asyncio.ensure_future(current_execution_task))
                
                done, pending = await asyncio.wait(
                    pending_tasks,
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                for task in done:
                    if task is message_task:
                        result = task.result()
                        if isinstance(result, dict) and result.get("type") == "__disconnect__":
                            websocket_open = False
                            break
                        
                        elif isinstance(result, dict) and "type" in result:
                            data = result
                            
                            if data.get("type") == "ping":
                                await websocket.send_json({"type": "pong", "timestamp": _get_timestamp()})
                            elif data.get("type") == "stop":
                                if current_execution_task and not current_execution_task.done():
                                    logger.info(f"[WebSocket] Stop requested for session: {session_id}")
                                    
                                    if current_cancel_event:
                                        current_cancel_event.set()
                                    
                                    current_execution_task.cancel()
                                    
                                    try:
                                        await asyncio.wait_for(current_execution_task, timeout=5.0)
                                    except asyncio.CancelledError:
                                        pass
                                    except asyncio.TimeoutError:
                                        logger.warning(f"[WebSocket] Task cancellation timeout for session: {session_id}")
                                    
                                    status = "stop"
                                    
                                    logger.info(f"[WebSocket] Stop requested, task cancelled, will save in main loop")
                                else:
                                    await websocket.send_json({
                                        "type": "execution_stopped",
                                        "session_id": session_id,
                                        "timestamp": _get_timestamp(),
                                        "message": "No running task to stop"
                                    })
                                
                            elif data.get("type") == "execute" and (not current_execution_task or current_execution_task.done()):
                                canvas_data = data.get("canvas_data", {}) or stored_canvas_data
                                input_message = data.get("input_message", "")
                                
                                stored_canvas_data = canvas_data
                                
                                if not session:
                                    session = AgenticFlowSessionModel(
                                        id=session_id,
                                        user_id=user_id,
                                        agentic_flow_id=agentic_flow_id,
                                        run_project_id=run_project_id,
                                        status="running",
                                        started_at=datetime.now(timezone.utc),
                                        created_at=datetime.now(timezone.utc),
                                        updated_at=datetime.now(timezone.utc),
                                    )
                                    db.add(session)
                                    db.commit()
                                    logger.info(f"Created new session on execute: {session_id}")
                                
                                user_data = [{"type": "content", "content": input_message}]
                                user_message = await save_session_message(
                                    db=db, session_id=session_id, user_id=user_id,
                                    role="user", data=user_data, agent_id="default",
                                    agentic_flow_id=agentic_flow_id, run_project_id=run_project_id
                                )
                                last_user_message_id = user_message.id
                                
                                status = "completed"
                                current_collector = ChunkCollector()
                                
                                def stream_callback_with_collector(delta: dict, agent_id: str = None, agent_name: str = None):
                                    try:
                                        current_collector.add_chunk(delta, agent_id, agent_name)
                                        if websocket_open:
                                            import asyncio
                                            loop = asyncio.get_event_loop()
                                            if loop.is_running():
                                                async def safe_send():
                                                    try:
                                                        await websocket.send_json({
                                                            "type": "stream",
                                                            "delta": delta,
                                                            "agent_id": agent_id,
                                                            "agent_name": agent_name,
                                                            "timestamp": datetime.now().isoformat()
                                                        })
                                                    except Exception:
                                                        pass
                                                asyncio.create_task(safe_send())
                                    except Exception as e:
                                        logger.error(f"Stream callback error: {e}")
                                
                                current_cancel_event = asyncio.Event()
                                
                                async def run_execution():
                                    nonlocal status
                                    result = await FlowRunner.run_from_json(
                                        canvas_data,
                                        input_message,
                                        user_id=user_id,
                                        agentic_flow_id=agentic_flow_id,
                                        session_id=session_id,
                                        run_project_id=run_project_id,
                                        event_callback=event_callback,
                                        stream_callback=stream_callback_with_collector,
                                        agent_memories=agent_memories,
                                        cancel_event=current_cancel_event
                                    )
                                    return result
                                
                                current_execution_task = asyncio.create_task(run_execution())
                                
                                await _send_event(websocket, session_id, {
                                    "event_type": "execution_start",
                                    "timestamp": datetime.now().isoformat()
                                })
                                
                                execution_context_manager.register(
                                    task=current_execution_task,
                                    user_id=user_id,
                                    agentic_flow_id=agentic_flow_id,
                                    session_id=session_id,
                                    run_project_id=run_project_id,
                                    cancel_event=current_cancel_event
                                )
                    
                    else:
                        execution_result = result
                        
                        execution_context_manager.unregister(
                            user_id=user_id,
                            agentic_flow_id=agentic_flow_id,
                            session_id=session_id,
                            run_project_id=run_project_id
                        )
                        
                        tokens = None
                        try:
                            if current_execution_task.cancelled():
                                status = "stop"
                                logger.info(f"[WebSocket] Execution stopped for session: {session_id}")
                                
                                await websocket.send_json({
                                    "type": "execution_stopped",
                                    "session_id": session_id,
                                    "timestamp": _get_timestamp()
                                })
                            else:
                                result = current_execution_task.result()
                                tokens = result.get("tokens")
                                
                                openai_message = result.get("message", {"role": "assistant", "content": result.get("output", ""), "reasoning_content": None})
                                
                                await websocket.send_json({
                                    "type": "execution_complete",
                                    "message": openai_message,
                                    "data": result,
                                    "session_id": session_id,
                                    "timestamp": _get_timestamp()
                                })
                        except asyncio.CancelledError:
                            status = "stop"
                            logger.info(f"[WebSocket] Execution stopped (CancelledError) for session: {session_id}")
                            
                            await websocket.send_json({
                                "type": "execution_stopped",
                                "session_id": session_id,
                                "timestamp": _get_timestamp()
                            })
                        except Exception as exec_error:
                            status = "error"
                            error_msg = str(exec_error)
                            logger.error(f"Execution error: {exec_error}")
                            
                            await websocket.send_json({
                                "type": "execution_event",
                                "data": {
                                    "event_type": "execution_error",
                                    "error": error_msg,
                                    "timestamp": datetime.now().isoformat()
                                },
                                "session_id": session_id,
                                "timestamp": _get_timestamp()
                            })
                            
                            await websocket.send_json({
                                "type": "execution_result",
                                "data": {
                                    "status": "error",
                                    "error": error_msg
                                },
                                "session_id": session_id,
                                "timestamp": _get_timestamp()
                            })
                        
                        logger.info(f"[WebSocket] Task completed - status: {status}, collector has data: {current_collector.get_chunk_count() > 0 if current_collector else False}, tokens: {tokens}")
                        
                        if current_collector:
                            agent_data = current_collector.get_agent_data()
                            logger.info(f"[WebSocket] Agent data: {agent_data}")
                            
                            if agent_data:
                                for agent_id_key, agent_info in agent_data.items():
                                    data_to_save = agent_info['data']
                                    if not data_to_save:
                                        data_to_save = []
                                    logger.info(f"[WebSocket] Saving message for agent {agent_id_key}, data: {data_to_save}, tokens: {tokens}, parent_message_id: {last_user_message_id}")
                                    await save_session_message(
                                        db=db, session_id=session_id, user_id=user_id,
                                        role="assistant", data=data_to_save, status=status, agent_id=agent_id_key,
                                        tokens=tokens,
                                        agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
                                        parent_message_id=last_user_message_id
                                    )
                            else:
                                logger.info(f"[WebSocket] No agent data, saving empty message, tokens: {tokens}, parent_message_id: {last_user_message_id}")
                                await save_session_message(
                                    db=db, session_id=session_id, user_id=user_id,
                                    role="assistant", 
                                    data=[],
                                    status=status, agent_id="default",
                                    tokens=tokens,
                                    agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
                                    parent_message_id=last_user_message_id
                                )
                        else:
                            logger.warning(f"[WebSocket] No collector available")
                        
                        if status == "stop":
                            db_manager.update_session(
                                db, session_id,
                                status="stop",
                                completed_at=datetime.now(timezone.utc)
                            )
                        elif status == "error":
                            db_manager.update_session(
                                db, session_id,
                                status="failed",
                                error=error_msg,
                                completed_at=datetime.now(timezone.utc)
                            )
                        current_execution_task = None
                        current_cancel_event = None
        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected: {ws_key}")
            websocket_open = False
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
            websocket_open = False
        finally:
            websocket_open = False
            
            if current_execution_task and not current_execution_task.done():
                logger.info(f"[WebSocket] Cancelling execution in finally: {session_id}")
                
                if current_cancel_event:
                    current_cancel_event.set()
                
                current_execution_task.cancel()
                
                try:
                    await asyncio.wait_for(current_execution_task, timeout=5.0)
                except asyncio.CancelledError:
                    pass
                except asyncio.TimeoutError:
                    logger.warning(f"[WebSocket] Task cancellation timeout in finally: {session_id}")
                
                if current_collector:
                    status = "stop"
                    logger.info(f"[WebSocket] Finally block - saving data, collector has data: {current_collector.get_chunk_count() > 0}, parent_message_id: {last_user_message_id}")
                    
                    agent_data = current_collector.get_agent_data()
                    logger.info(f"[WebSocket] Agent data (finally): {agent_data}")
                    
                    if agent_data:
                        for agent_id_key, agent_info in agent_data.items():
                            data_to_save = agent_info['data']
                            if not data_to_save:
                                data_to_save = []
                            logger.info(f"[WebSocket] Saving message (finally) for agent {agent_id_key}, data: {data_to_save}, parent_message_id: {last_user_message_id}")
                            try:
                                await save_session_message(
                                    db=db, session_id=session_id, user_id=user_id,
                                    role="assistant", data=data_to_save, status=status, agent_id=agent_id_key,
                                    agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
                                    parent_message_id=last_user_message_id
                                )
                            except Exception as save_error:
                                logger.error(f"[WebSocket] Failed to save message in finally: {save_error}")
                    else:
                        logger.info(f"[WebSocket] No agent data (finally), saving empty message, parent_message_id: {last_user_message_id}")
                        try:
                            await save_session_message(
                                db=db, session_id=session_id, user_id=user_id,
                                role="assistant", 
                                data=[],
                                status=status, agent_id="default",
                                agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
                                parent_message_id=last_user_message_id
                            )
                        except Exception as save_error:
                            logger.error(f"[WebSocket] Failed to save empty message in finally: {save_error}")
                    
                    try:
                        db_manager.update_session(
                            db, session_id,
                            status="stop",
                            completed_at=datetime.now(timezone.utc)
                        )
                    except Exception as update_error:
                        logger.error(f"[WebSocket] Failed to update session in finally: {update_error}")
            
            _active_websockets.pop(ws_key, None)
            _websocket_timestamps.pop(ws_key, None)
            _websocket_keys.pop(ws_key, None)
