# -*- coding: utf-8 -*-
"""
WebSocket API 端点模块。

@file websocket.py
@description WebSocket 实时通信端点，支持 Agent 执行过程的实时推送
@author SoloEngine Team
@date 2026-02-20

功能描述：
- WebSocket 连接管理
- 实时执行状态推送
- 工作流执行调度
- Token 认证验证
- 流式事件推送

事件类型：
    - execution-start: 开始执行工作流
    - agent-start: Agent 开始执行
    - agent-complete: Agent 执行完成
    - agent-error: Agent 执行错误
    - tool-call: 工具调用事件
    - skill-call: Skill 调用事件
    - mcp-call: MCP 调用事件
    - child-agent-start: 子模型开始执行
    - child-agent-complete: 子模型执行完成
    - execution-complete: 执行完成
    - error: 错误事件

使用场景：
- 前端实时显示 Agent 执行状态
- 调试工作流执行过程
- 实时监控 Agent 行为

认证方式：
    WebSocket 连接需要通过查询参数传递 JWT Token：
    ws://host/ws/{task_id}?token=xxx

状态: ✅ 完整实现
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import Dict, Any
import json
import uuid
import logging
from SoloAgent.solo_agent.compiler import (
    AgenticFlowCompiler, 
    FlowRunner, 
    CompiledFlowFactory,
    ExecutionEvent
)
from app.core.auth import auth_service
from app.core.database import db_manager, get_db_context_async

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")


class ConnectionManager:
    """
    WebSocket 连接管理器。
    
    管理所有活跃的 WebSocket 连接，支持：
        - 连接注册和注销
        - 按任务 ID 发送事件
        - 广播消息
    
    连接映射：
        task_id -> WebSocket 实例
        
        每个任务有唯一的 task_id，对应一个 WebSocket 连接。
    """
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, task_id: str):
        await websocket.accept()
        self.active_connections[task_id] = websocket
    
    def disconnect(self, task_id: str):
        if task_id in self.active_connections:
            del self.active_connections[task_id]
    
    async def send_event(self, task_id: str, event: Dict[str, Any]):
        if task_id in self.active_connections:
            await self.active_connections[task_id].send_json(event)


manager = ConnectionManager()


async def verify_token(token: str) -> tuple:
    """
    验证 WebSocket 连接的 Token。
    """
    if not token:
        return False, None
    payload = auth_service.decode_token(token)
    if not payload:
        return False, None
    if payload.get("type") != "access":
        return False, None
    user_id = payload.get("sub")
    if not user_id:
        return False, None
    user = await auth_service.get_user(user_id)
    if user is None or not user.is_active:
        return False, None
    return True, user_id


@router.websocket("/ws/{task_id}")
async def websocket_endpoint(
    websocket: WebSocket, 
    task_id: str,
    token: str = Query(None)
):
    """
    WebSocket 端点主入口。
    """
    is_valid, user_id = await verify_token(token)
    if not is_valid:
        await websocket.close(code=4001, reason="Unauthorized")
        return
    
    await manager.connect(websocket, task_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "execution-start":
                project_id = data.get("project_id")
                user_input = data.get("input", "")
                
                await execute_workflow(task_id, project_id, user_input, user_id)
            
            elif data.get("type") == "execute":
                canvas_data = data.get("canvas_data", {})
                input_message = data.get("input_message", "")
                agentic_flow_id = data.get("agentic_flow_id")
                session_id = data.get("session_id")
                run_project_id = data.get("run_project_id")
                
                await execute_canvas(
                    task_id, 
                    canvas_data, 
                    input_message, 
                    user_id, 
                    agentic_flow_id=agentic_flow_id,
                    session_id=session_id,
                    run_project_id=run_project_id
                )
            
            elif data.get("type") == "clear-cache":
                agentic_flow_id = data.get("agentic_flow_id")
                session_id = data.get("session_id")
                run_project_id = data.get("run_project_id")
                user_id_from_data = data.get("user_id")
                if agentic_flow_id and session_id and run_project_id and user_id_from_data:
                    CompiledFlowFactory.remove(user_id_from_data, agentic_flow_id, session_id, run_project_id)
                    await manager.send_event(task_id, {
                        "type": "cache-cleared",
                        "agentic_flow_id": agentic_flow_id
                    })
                else:
                    CompiledFlowFactory.clear_all()
                    await manager.send_event(task_id, {
                        "type": "cache-cleared",
                        "message": "All cache cleared"
                    })
            
            elif data.get("type") == "ping":
                await manager.send_event(task_id, {"type": "pong"})
            
    except WebSocketDisconnect:
        manager.disconnect(task_id)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(task_id)


async def execute_workflow(task_id: str, project_id: str, user_input: str, user_id: str):
    """
    执行工作流。
    """
    async with get_db_context_async() as db:
        project = db_manager.get_project(db, project_id, user_id)
        if not project:
            await manager.send_event(task_id, {
                "type": "error",
                "message": "Project not found"
            })
            return
        
        canvas_data = project.canvas_data
        
        if not canvas_data or not canvas_data.get("nodes"):
            await manager.send_event(task_id, {
                "type": "error",
                "message": "Canvas data is empty"
            })
            return
        
        await execute_canvas(task_id, canvas_data, user_input, user_id, project_id)


async def execute_canvas(
    task_id: str, 
    canvas_data: Dict[str, Any], 
    input_message: str, 
    user_id: str,
    agentic_flow_id: str = None,
    session_id: str = None,
    run_project_id: str = None
):
    """
    执行画布工作流，支持流式事件推送。
    """
    def event_callback(event: ExecutionEvent):
        event_data = {
            "type": event.event_type,
            "data": {
                "agent_id": event.agent_id,
                "agent_name": event.agent_name,
                "agent_type": event.metadata.get("agent_type") if event.metadata else None,
                "content": event.content,
                "tool_name": event.tool_name,
                "tool_args": event.tool_args,
                "tool_result": event.tool_result,
                "skill_name": event.skill_name,
                "skill_args": event.skill_args,
                "skill_result": event.skill_result,
                "mcp_name": event.mcp_name,
                "mcp_args": event.mcp_args,
                "mcp_result": event.mcp_result,
                "child_agent_id": event.child_agent_id,
                "child_agent_name": event.child_agent_name,
                "status": event.status,
                "error": event.error,
                "timestamp": event.timestamp,
                "metadata": event.metadata
            }
        }
        
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(manager.send_event(task_id, event_data))
        except Exception as e:
            logger.error(f"Failed to send event: {e}")
    
    try:
        await manager.send_event(task_id, {
            "type": "agent-update",
            "status": "compiling",
            "message": "Compiling workflow..."
        })
        
        compiler = AgenticFlowCompiler(user_id=user_id)
        compiled_flow = compiler.compile(
            {"canvas_data": canvas_data},
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
            session_id=session_id,
            run_project_id=run_project_id
        )
        
        compiled_flow.set_event_callback(event_callback)
        
        await manager.send_event(task_id, {
            "type": "agent-update",
            "status": "running",
            "message": f"Starting execution with {len(compiled_flow.agents)} agents",
            "orchestrator_id": compiled_flow.orchestrator_id
        })
        
        result = await compiled_flow.run(input_message)
        
        await manager.send_event(task_id, {
            "type": "execution-complete",
            "task_id": task_id,
            "result": result
        })
        
    except Exception as e:
        logger.error(f"Workflow execution failed: {e}")
        await manager.send_event(task_id, {
            "type": "error",
            "message": str(e)
        })
