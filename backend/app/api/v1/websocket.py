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

事件类型：
    - execution-start: 开始执行工作流
    - agent-update: Agent 状态更新
    - tool-call: 工具调用事件
    - response-streaming: 响应流式输出
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
from app.core.canvas_parser import CanvasParser
from app.core.scheduler import Scheduler
from app.schemas.response import AgentUpdateEvent, ToolCallEvent, ResponseStreamingEvent, ExecutionCompleteEvent
from app.core.auth import auth_service
from app.core.database import db_manager, get_db_context_async

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
    
    Example:
        >>> manager = ConnectionManager()
        >>> await manager.connect(websocket, "task-123")
        >>> await manager.send_event("task-123", {"type": "status", "data": "..."})
        >>> manager.disconnect("task-123")
    
    Note:
        - 连接是线程安全的
        - 断开连接后自动从映射中移除
    """
    
    def __init__(self):
        """
        初始化连接管理器。
        
        创建空的连接映射字典。
        """
        self.active_connections: Dict[str, WebSocket] = {}
        """活跃连接映射：task_id -> WebSocket"""
    
    async def connect(self, websocket: WebSocket, task_id: str):
        """
        注册新的 WebSocket 连接。
        
        接受 WebSocket 连接请求并添加到活跃连接映射中。
        
        Args:
            websocket (WebSocket): WebSocket 连接实例。
            task_id (str): 任务唯一标识符，用于后续发送事件。
        
        Note:
            - 会调用 websocket.accept() 接受连接
            - 如果 task_id 已存在，会覆盖旧连接
        """
        await websocket.accept()
        self.active_connections[task_id] = websocket
    
    def disconnect(self, task_id: str):
        """
        注销 WebSocket 连接。
        
        从活跃连接映射中移除指定任务的连接。
        
        Args:
            task_id (str): 要注销的任务 ID。
        
        Note:
            如果 task_id 不存在，不会抛出异常。
        """
        if task_id in self.active_connections:
            del self.active_connections[task_id]
    
    async def send_event(self, task_id: str, event: Dict[str, Any]):
        """
        向指定任务发送事件。
        
        通过 WebSocket 向指定任务发送 JSON 格式的事件数据。
        
        Args:
            task_id (str): 目标任务 ID。
            event (Dict[str, Any]): 事件数据，必须包含 "type" 字段。
        
        Note:
            如果任务连接不存在，不会抛出异常。
        
        Example:
            >>> await manager.send_event("task-123", {
            ...     "type": "agent-update",
            ...     "node_id": "node-1",
            ...     "status": "running"
            ... })
        """
        if task_id in self.active_connections:
            await self.active_connections[task_id].send_json(event)


manager = ConnectionManager()
"""全局连接管理器实例"""


async def verify_token(token: str) -> bool:
    """
    验证 WebSocket 连接的 Token。
    
    验证 JWT Token 的有效性，包括：
        1. Token 是否存在
        2. Token 是否可解码
        3. Token 类型是否为 "access"
        4. 用户是否存在且活跃
    
    Args:
        token (str): JWT Token 字符串。
    
    Returns:
        bool: Token 是否有效。
            - True: Token 有效，允许连接
            - False: Token 无效，拒绝连接
    
    Note:
        此函数用于 WebSocket 连接前的认证验证。
    """
    if not token:
        return False
    payload = auth_service.decode_token(token)
    if not payload:
        return False
    if payload.get("type") != "access":
        return False
    user_id = payload.get("sub")
    if not user_id:
        return False
    user = await auth_service.get_user(user_id)
    return user is not None and user.is_active


@router.websocket("/ws/{task_id}")
async def websocket_endpoint(
    websocket: WebSocket, 
    task_id: str,
    token: str = Query(None)
):
    """
    WebSocket 端点主入口。
    
    处理 WebSocket 连接的生命周期，包括：
        1. Token 认证验证
        2. 连接注册
        3. 消息循环处理
        4. 连接断开清理
    
    Args:
        websocket (WebSocket): WebSocket 连接实例。
        task_id (str): 任务唯一标识符，由客户端生成。
        token (str, optional): JWT Token，通过查询参数传递。
    
    消息格式：
        客户端发送的消息必须是 JSON 格式，包含 type 字段：
        
        开始执行：
        {
            "type": "execution-start",
            "project_id": "project-uuid",
            "input": "用户输入"
        }
    
    错误码：
        - 4001: 未授权（Token 无效）
    
    Note:
        - Token 验证失败会立即关闭连接
        - 连接断开后会自动清理资源
    """
    if not token or not await verify_token(token):
        await websocket.close(code=4001, reason="Unauthorized")
        return
    
    await manager.connect(websocket, task_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "execution-start":
                project_id = data.get("project_id")
                user_input = data.get("input", "")
                
                await execute_workflow(task_id, project_id, user_input)
            
    except WebSocketDisconnect:
        manager.disconnect(task_id)


async def execute_workflow(task_id: str, project_id: str, user_input: str):
    """
    执行工作流。
    
    根据项目 ID 加载画布数据，解析并执行工作流。
    通过 WebSocket 实时推送执行状态。
    
    执行流程：
        1. 加载项目和画布数据
        2. 解析画布为协作图
        3. 创建调度器并启动执行
        4. 推送每个节点的执行状态
        5. 推送执行完成事件
    
    Args:
        task_id (str): 任务 ID，用于发送事件。
        project_id (str): 项目 ID，用于加载画布数据。
        user_input (str): 用户输入，作为工作流的初始上下文。
    
    推送事件：
        - agent-update: 节点状态更新
        - execution-complete: 执行完成
        - error: 错误事件
    
    Note:
        - 执行过程是异步的
        - 错误会通过 WebSocket 推送给客户端
        - 数据库连接会在执行完成后自动关闭
    """
    async with get_db_context_async() as db:
        project = db_manager.get_project(db, project_id)
        if not project:
            await manager.send_event(task_id, {
                "type": "error",
                "message": "Project not found"
            })
            return
        
        canvas_data = project.canvas_data
        
        try:
            collaboration_graph = CanvasParser.parse(canvas_data)
        except ValueError as e:
            await manager.send_event(task_id, {
                "type": "error",
                "message": str(e)
            })
            return
        
        scheduler = Scheduler(collaboration_graph)
        initial_context = {"user_input": user_input}
        
        try:
            result = await scheduler.start(initial_context)
            
            await manager.send_event(task_id, {
                "type": "agent-update",
                "node_id": result.get("node_id"),
                "status": result.get("status"),
                "message": result.get("message")
            })
            
            while result.get("next_node_id"):
                result = await scheduler.schedule_next(result)
                
                await manager.send_event(task_id, {
                    "type": "agent-update",
                    "node_id": result.get("node_id"),
                    "status": result.get("status"),
                    "message": result.get("message")
                })
            
            await manager.send_event(task_id, {
                "type": "execution-complete",
                "task_id": task_id,
                "result": result
            })
            
        except Exception as e:
            await manager.send_event(task_id, {
                "type": "error",
                "message": str(e)
            })
