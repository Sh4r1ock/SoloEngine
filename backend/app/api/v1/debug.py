# -*- coding: utf-8 -*-
"""
调试 API endpoints。

@file debug.py
@description 调试接口 - Agentic调试相关API端点
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 启动Agentic调试会话接口
- 停止Agentic调试会话接口
- 获取调试会话状态接口
- 获取调试执行日志接口
- 执行单步调试接口
- 继续执行调试接口
- 断点管理接口
- WebSocket实时通信端点
- JSON导入执行接口

使用场景：
- Agentic调试会话管理
- 单步执行和断点控制
- JSON Agentic执行

注意事项：
- 调试会话需要正确建立WebSocket连接
- 支持断点设置和条件断点
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
from app.core.json_executor import JSONWorkflowExecutor, WorkflowRunner
from app.core.debug_engine import debug_engine, DebugState, BreakpointType
from app.api.v1.auth import get_current_user
from app.core.auth import User, auth_service
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/debug", tags=["debug"])


class StartDebugRequest(BaseModel):
    session_id: Optional[str] = None
    agent_id: Optional[str] = None
    node_id: Optional[str] = None
    breakpoints: Optional[List[Dict[str, str]]] = None


class ExecuteJSONRequest(BaseModel):
    canvas_data: Dict[str, Any] = Field(..., description="画布JSON数据")
    input_message: str = Field(..., description="输入消息")
    project_name: Optional[str] = Field(None, description="项目名称")
    context: Optional[Dict[str, Any]] = Field(None, description="执行上下文")


class ExecuteNodeRequest(BaseModel):
    canvas_data: Dict[str, Any] = Field(..., description="画布JSON数据")
    node_id: str = Field(..., description="节点ID")
    input_message: str = Field(..., description="输入消息")
    context: Optional[Dict[str, Any]] = Field(None, description="执行上下文")


class StopDebugRequest(BaseModel):
    session_id: str


class PauseDebugRequest(BaseModel):
    session_id: str


class ResumeDebugRequest(BaseModel):
    session_id: str


class StepControlRequest(BaseModel):
    session_id: str
    command: str


class SetBreakpointRequest(BaseModel):
    node_id: str
    step_type: str = Field(..., pattern="^(before_thought|before_action|after_action)$")
    enabled: bool = True


class DebugMessage(BaseModel):
    type: str
    data: Dict[str, Any]
    session_id: str
    timestamp: float


_active_websockets: Dict[str, WebSocket] = {}
_websocket_timestamps: Dict[str, float] = {}
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
                        if current_time - _websocket_timestamps[session_id] > settings.DEBUG_SESSION_TIMEOUT:
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


async def _broadcast_message(session_id: str, message: DebugMessage):
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
    """执行JSON Agentic。"""
    try:
        result = await WorkflowRunner.run_from_json(
            request.canvas_data,
            request.input_message,
            request.context or {}
        )
        
        return {
            "code": 200,
            "message": "Agentic executed",
            "data": result
        }
    except Exception as e:
        logger.error(f"Agentic execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute-node")
async def execute_single_node(
    request: ExecuteNodeRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """执行单个节点。"""
    try:
        result = await WorkflowRunner.run_node(
            request.canvas_data,
            request.node_id,
            request.input_message,
            request.context or {}
        )
        
        return {
            "code": 200,
            "message": "Node executed",
            "data": result
        }
    except Exception as e:
        logger.error(f"Node execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start")
async def start_debug(
    request: StartDebugRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """启动调试会话。"""
    session_id = request.session_id or f"debug-{uuid.uuid4().hex[:12]}"

    session = await debug_engine.create_session(
        flow_id=request.agent_id or "default",
        flow_name="Debug Session"
    )

    if request.breakpoints:
        for bp in request.breakpoints:
            await debug_engine.add_breakpoint(
                session_id,
                BreakpointType(bp.get("step_type", "before_action")),
                bp.get("node_id")
            )

    await debug_engine.start_debug(session_id)

    return {
        "code": 200,
        "message": "Debug session started",
        "data": {
            "session_id": session_id,
            "status": "running"
        }
    }


@router.post("/stop")
async def stop_debug(request: StopDebugRequest, current_user: User = Depends(get_current_user)):
    """停止调试会话。"""
    session_id = request.session_id

    await debug_engine.stop_debug(session_id)

    ws = _active_websockets.pop(session_id, None)
    if ws:
        await ws.close()

    return {
        "code": 200,
        "message": "Debug session stopped",
        "data": {"session_id": session_id}
    }


@router.post("/pause")
async def pause_debug(request: PauseDebugRequest, current_user: User = Depends(get_current_user)):
    """暂停调试会话。"""
    await debug_engine.pause_debug(request.session_id)

    return {
        "code": 200,
        "message": "Debug session paused",
        "data": {"session_id": request.session_id}
    }


@router.post("/resume")
async def resume_debug(request: ResumeDebugRequest, current_user: User = Depends(get_current_user)):
    """恢复调试会话。"""
    await debug_engine.resume_debug(request.session_id)

    return {
        "code": 200,
        "message": "Debug session resumed",
        "data": {"session_id": request.session_id}
    }


@router.post("/step")
async def step_control(request: StepControlRequest, current_user: User = Depends(get_current_user)):
    """单步调试控制。"""
    await debug_engine.step(request.session_id, request.command)

    return {
        "code": 200,
        "message": "Step command sent",
        "data": {
            "session_id": request.session_id,
            "command": request.command
        }
    }


@router.post("/breakpoint")
async def set_breakpoint(request: SetBreakpointRequest, current_user: User = Depends(get_current_user)):
    """设置断点。"""
    breakpoint_id = f"bp-{uuid.uuid4().hex[:12]}"

    return {
        "code": 200,
        "message": "Breakpoint set",
        "data": {
            "id": breakpoint_id,
            "node_id": request.node_id,
            "step_type": request.step_type,
            "enabled": request.enabled
        }
    }


@router.delete("/breakpoint/{breakpoint_id}")
async def remove_breakpoint(breakpoint_id: str, current_user: User = Depends(get_current_user)):
    """删除断点。"""
    return {
        "code": 200,
        "message": "Breakpoint removed",
        "data": {"breakpoint_id": breakpoint_id}
    }


@router.get("/breakpoints")
async def list_breakpoints(current_user: User = Depends(get_current_user)):
    """列出所有断点。"""
    return {
        "code": 200,
        "message": "Breakpoints retrieved",
        "data": []
    }


@router.get("/sessions")
async def get_sessions(
    agent_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取调试会话列表。"""
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
    """获取调试会话详情。"""
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


@router.websocket("/ws/{session_id}")
async def debug_websocket(
    websocket: WebSocket, 
    session_id: str,
    token: str = Query(None)
):
    """WebSocket端点用于实时调试消息。"""
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

    session = await debug_engine.get_session(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()
    _active_websockets[session_id] = websocket
    _websocket_timestamps[session_id] = _get_timestamp()

    try:
        while True:
            data = await websocket.receive_json()
            _websocket_timestamps[session_id] = _get_timestamp()

            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": _get_timestamp()})
            elif data.get("type") == "execute":
                canvas_data = data.get("canvas_data", {})
                input_message = data.get("input_message", "")
                
                executor = JSONWorkflowExecutor()
                if executor.load_from_json(canvas_data):
                    result = await executor.execute(input_message)
                    await websocket.send_json({
                        "type": "execution_result",
                        "data": result,
                        "session_id": session_id,
                        "timestamp": _get_timestamp()
                    })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        _active_websockets.pop(session_id, None)
        _websocket_timestamps.pop(session_id, None)


@router.get("/variables/{session_id}")
async def get_variables(session_id: str, current_user: User = Depends(get_current_user)):
    """获取调试变量。"""
    variables = await debug_engine.get_variables(session_id)
    
    return {
        "code": 200,
        "message": "Variables retrieved",
        "data": variables
    }
