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
from datetime import datetime
import uuid
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager
from SoloAgent.solo_agent.compiler import AgenticFlowCompiler, FlowRunner, CompiledFlowFactory
from app.api.v1.auth import get_current_user
from app.core.auth import User, auth_service
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/run", tags=["run"])


class ExecuteJSONRequest(BaseModel):
    canvas_data: Dict[str, Any] = Field(..., description="画布JSON数据")
    input_message: str = Field(..., description="输入消息")
    project_name: Optional[str] = Field(None, description="项目名称")
    context: Optional[Dict[str, Any]] = Field(None, description="执行上下文")
    flow_id: Optional[str] = Field(None, description="AgenticFlow ID")


class ExecuteNodeRequest(BaseModel):
    canvas_data: Dict[str, Any] = Field(..., description="画布JSON数据")
    node_id: str = Field(..., description="节点ID")
    input_message: str = Field(..., description="输入消息")
    context: Optional[Dict[str, Any]] = Field(None, description="执行上下文")
    flow_id: Optional[str] = Field(None, description="AgenticFlow ID")


class CreateSessionRequest(BaseModel):
    flow_id: Optional[str] = Field(None, description="AgenticFlow ID")
    canvas_data: Optional[Dict[str, Any]] = Field(None, description="画布JSON数据")
    project_name: Optional[str] = Field(None, description="项目名称")


class RunMessage(BaseModel):
    type: str
    data: Dict[str, Any]
    session_id: str
    timestamp: float


class SessionInfo:
    """会话信息类"""
    def __init__(self, session_id: str, user_id: str, flow_id: str = None, 
                 canvas_data: Dict = None, project_name: str = None):
        self.session_id = session_id
        self.user_id = user_id
        self.flow_id = flow_id
        self.canvas_data = canvas_data or {}
        self.project_name = project_name
        self.created_at = datetime.now()
        self.status = "created"
        self.messages: List[Dict] = []


_active_websockets: Dict[str, WebSocket] = {}
_websocket_timestamps: Dict[str, float] = {}
_valid_sessions: Dict[str, SessionInfo] = {}
_cleanup_task: Optional[asyncio.Task] = None


async def _cleanup_stale_connections():
    """定期清理超时的WebSocket连接。"""
    while True:
        try:
            await asyncio.sleep(60)
            current_time = datetime.now().timestamp()
            stale_sessions = []
            
            for session_id, ws in list(_active_websockets.items()):
                try:
                    if hasattr(ws, 'client_state') and ws.client_state.name == "DISCONNECTED":
                        stale_sessions.append(session_id)
                    elif session_id in _websocket_timestamps:
                        if current_time - _websocket_timestamps[session_id] > settings.RUN_SESSION_TIMEOUT:
                            stale_sessions.append(session_id)
                except Exception:
                    stale_sessions.append(session_id)
            
            for session_id in stale_sessions:
                ws = _active_websockets.pop(session_id, None)
                _websocket_timestamps.pop(session_id, None)
                if ws:
                    try:
                        await ws.close(code=1001, reason="Connection timeout")
                    except Exception:
                        pass
                logger.info(f"Cleaned up stale WebSocket connection: {session_id}")
                
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


@router.post("/sessions")
async def create_session(
    request: CreateSessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    创建新的运行会话。
    
    会话用于：
    - 标识一次完整的对话/执行流程
    - 存储对话历史和执行记录
    - WebSocket连接标识
    
    Returns:
        session_id: 会话ID，用于后续WebSocket连接
    """
    session_id = str(uuid.uuid4())
    
    session_info = SessionInfo(
        session_id=session_id,
        user_id=current_user.id,
        flow_id=request.flow_id,
        canvas_data=request.canvas_data,
        project_name=request.project_name
    )
    
    _valid_sessions[session_id] = session_info
    
    execution = db_manager.create_execution(
        db,
        project_name=request.project_name or "default",
        input_message=None,
        user_id=current_user.id,
        flow_id=request.flow_id
    )
    
    logger.info(f"Created session {session_id} for user {current_user.id}")
    
    return {
        "code": 200,
        "message": "Session created",
        "data": {
            "session_id": session_id,
            "execution_id": execution.id,
            "created_at": session_info.created_at.isoformat(),
            "status": session_info.status
        }
    }


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
            flow_id=request.flow_id,
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
            flow_id=request.flow_id,
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


@router.get("/sessions")
async def get_sessions(
    agent_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取运行会话列表。"""
    executions = db_manager.list_executions(db, agent_id=agent_id, status=status, limit=limit)
    
    return {
        "code": 200,
        "message": "Sessions retrieved",
        "data": [
            {
                "id": e.id,
                "status": e.status,
                "input_message": e.input_message,
                "output_message": e.output_message,
                "error": e.error,
                "started_at": e.started_at.isoformat() if e.started_at else None,
                "completed_at": e.completed_at.isoformat() if e.completed_at else None,
                "duration_ms": e.duration_ms
            }
            for e in executions
        ]
    }


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取运行会话详情。"""
    execution = db_manager.get_execution(db, session_id)
    
    if not execution:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "code": 200,
        "message": "Session retrieved",
        "data": {
            "id": execution.id,
            "status": execution.status,
            "input_message": execution.input_message,
            "output_message": execution.output_message,
            "error": execution.error,
            "token_usage": execution.token_usage,
            "started_at": execution.started_at.isoformat() if execution.started_at else None,
            "completed_at": execution.completed_at.isoformat() if execution.completed_at else None,
            "duration_ms": execution.duration_ms
        }
    }


@router.get("/sessions/{session_id}/steps")
async def get_session_steps(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话执行步骤。"""
    execution = db_manager.get_execution(db, session_id)
    
    if not execution:
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
            for s in execution.steps
        ]
    }


@router.get("/sessions/{session_id}/tools")
async def get_session_tool_calls(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话工具调用记录。"""
    execution = db_manager.get_execution(db, session_id)
    
    if not execution:
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
            for t in execution.tool_calls
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
    execution = db_manager.get_execution(db, session_id)
    
    if not execution:
        raise HTTPException(status_code=404, detail="Session not found")

    if format == "json":
        data = {
            "id": execution.id,
            "status": execution.status,
            "input_message": execution.input_message,
            "output_message": execution.output_message,
            "error": execution.error,
            "token_usage": execution.token_usage,
            "started_at": execution.started_at.isoformat() if execution.started_at else None,
            "completed_at": execution.completed_at.isoformat() if execution.completed_at else None,
            "steps": [
                {
                    "step_type": s.step_type,
                    "node_name": s.node_name,
                    "thought": s.thought,
                    "action": s.action,
                    "observation": s.observation
                }
                for s in execution.steps
            ],
            "tool_calls": [
                {
                    "tool_name": t.tool_name,
                    "arguments": t.arguments,
                    "result": t.result
                }
                for t in execution.tool_calls
            ]
        }
        return {
            "code": 200,
            "message": "Session exported",
            "data": data
        }
    else:
        content = f"Execution: {execution.id}\n"
        content += f"Status: {execution.status}\n"
        content += f"Input: {execution.input_message}\n"
        content += f"Output: {execution.output_message}\n"
        return {
            "code": 200,
            "message": "Session exported",
            "data": {"content": content}
        }


@router.post("/clear-cache/{flow_id}")
async def clear_flow_cache(
    flow_id: str,
    current_user: User = Depends(get_current_user)
):
    """清除指定 Flow 的编译缓存。"""
    removed = CompiledFlowFactory.remove(flow_id)
    return {
        "code": 200,
        "message": "Cache cleared" if removed else "Cache not found",
        "data": {"flow_id": flow_id, "removed": removed}
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


@router.websocket("/ws/{session_id}")
async def run_websocket(
    websocket: WebSocket, 
    session_id: str,
    token: str = Query(None)
):
    """WebSocket端点用于实时运行消息。"""
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

    session_info = _valid_sessions.get(session_id)
    if not session_info:
        await websocket.close(code=4002, reason="Invalid session_id. Please create a session first via POST /api/v1/run/sessions")
        return
    
    if session_info.user_id != user_id:
        await websocket.close(code=4003, reason="Session does not belong to this user")
        return

    await websocket.accept()
    session_info.status = "connected"
    _active_websockets[session_id] = websocket
    _websocket_timestamps[session_id] = _get_timestamp()

    def event_callback(event):
        """事件回调函数 - 在同步上下文中调度异步发送"""
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_send_event(websocket, session_id, event))
        except Exception as e:
            logger.error(f"Event callback error: {e}")

    def stream_callback(content: str):
        """流式输出回调函数"""
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_send_event(websocket, session_id, {
                    "event_type": "stream",
                    "content": content,
                    "timestamp": datetime.now().isoformat()
                }))
        except Exception as e:
            logger.error(f"Stream callback error: {e}")

    try:
        while True:
            data = await websocket.receive_json()
            _websocket_timestamps[session_id] = _get_timestamp()

            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": _get_timestamp()})
            elif data.get("type") == "execute":
                canvas_data = data.get("canvas_data", {}) or session_info.canvas_data
                input_message = data.get("input_message", "")
                flow_id = data.get("flow_id") or session_info.flow_id
                
                session_info.status = "running"
                session_info.messages.append({
                    "role": "user",
                    "content": input_message,
                    "timestamp": datetime.now().isoformat()
                })
                
                try:
                    result = await FlowRunner.run_from_json(
                        canvas_data,
                        input_message,
                        user_id=user_id,
                        flow_id=flow_id,
                        event_callback=event_callback,
                        stream_callback=stream_callback
                    )
                    
                    session_info.status = "completed"
                    if result.get("output"):
                        session_info.messages.append({
                            "role": "assistant",
                            "content": result.get("output"),
                            "timestamp": datetime.now().isoformat()
                        })
                    
                    await websocket.send_json({
                        "type": "execution_result",
                        "data": result,
                        "session_id": session_id,
                        "timestamp": _get_timestamp()
                    })
                except Exception as exec_error:
                    logger.error(f"Execution error: {exec_error}")
                    session_info.status = "error"
                    error_msg = str(exec_error)
                    
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

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({
                "type": "execution_event",
                "data": {
                    "event_type": "execution_error",
                    "error": str(e),
                    "timestamp": datetime.now().isoformat()
                },
                "session_id": session_id,
                "timestamp": _get_timestamp()
            })
        except:
            pass
    finally:
        _active_websockets.pop(session_id, None)
        _websocket_timestamps.pop(session_id, None)
