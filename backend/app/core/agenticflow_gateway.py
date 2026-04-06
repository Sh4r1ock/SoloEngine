# -*- coding: utf-8 -*-
"""
AgenticFlow 网关路由 - 动态路由注册和管理。

@file agenticflow_gateway.py
@description 为 AgenticFlow 提供自动网关路由注册功能
@author SoloEngine Team
@date 2026-03-06

功能描述：
- 当编译 AgenticFlow 后，自动创建 /api/v1/agentic-flows/{agentic_flow_id}/execute 路由
- 支持动态路由的注册和注销
- 转发请求到实际的 AgenticFlow 执行器

使用场景：
- AgenticFlow 编译后自动暴露为 HTTP 端点
- 支持通过 HTTP 调用 AgenticFlow

状态: 新增实现
"""

import logging
import asyncio
from typing import Dict, Any, Optional, Callable
from datetime import datetime
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
import json

logger = logging.getLogger(__name__)


class AgenticFlowGateway:
    """
    AgenticFlow 网关管理器。
    
    为编译的 AgenticFlow 自动创建网关路由。
    例如：编译 agentic_flow_id 为 "abc123" 后，可通过 /api/v1/agentic-flows/abc123/execute 访问。
    
    Attributes:
        _routes (Dict[str, str]): agentic_flow_id 到路由路径的映射
        _app (Optional[FastAPI]): FastAPI 应用实例
        _handlers (Dict[str, Callable]): 路由处理器映射
        _compiled_flows (Dict[str, Any]): 编译后的 Flow 实例缓存
        _execution_locks (Dict[str, asyncio.Lock]): 每个 agentic_flow_id 的执行锁，支持并发控制
    """
    
    def __init__(self):
        self._routes: Dict[str, str] = {}
        self._app: Optional[FastAPI] = None
        self._handlers: Dict[str, Callable] = {}
        self._compiled_flows: Dict[str, Any] = {}
        self._execution_locks: Dict[str, asyncio.Lock] = {}
        self._user_sessions: Dict[str, Dict[str, Any]] = {}
    
    def init_app(self, app: FastAPI) -> None:
        """
        初始化网关。
        
        Args:
            app (FastAPI): FastAPI 应用实例
        """
        self._app = app
        logger.info("AgenticFlow Gateway initialized")
    
    def register_compiled_flow(self, agentic_flow_id: str, compiled_flow: Any) -> str:
        """
        注册编译后的 AgenticFlow。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
            compiled_flow: 编译后的 Flow 实例
        
        Returns:
            str: 注册的路由路径
        """
        self._compiled_flows[agentic_flow_id] = compiled_flow
        
        if agentic_flow_id not in self._execution_locks:
            self._execution_locks[agentic_flow_id] = asyncio.Lock()
        
        route_path = f"/api/v1/agentic-flows/{agentic_flow_id}/execute"
        self._routes[agentic_flow_id] = route_path
        
        logger.info(f"AgenticFlow registered: {route_path}")
        return route_path
    
    async def register_route(self, agentic_flow_id: str) -> str:
        """
        为 AgenticFlow 注册网关路由。
        
        注册后可通过 /api/v1/agentic-flows/{agentic_flow_id}/execute 访问执行接口。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
        
        Returns:
            str: 注册的路由路径
        
        Raises:
            RuntimeError: 如果 FastAPI 应用未初始化
        """
        if not self._app:
            raise RuntimeError("FastAPI app not initialized. Call init_app() first.")
        
        if agentic_flow_id in self._routes:
            logger.debug(f"Route already exists for flow: {agentic_flow_id}")
            return self._routes[agentic_flow_id]
        
        gateway_path = f"/api/v1/agentic-flows/{agentic_flow_id}/execute"
        
        async def gateway_handler(request: Request):
            return await self._handle_execute_request(agentic_flow_id, request)
        
        async def gateway_stream_handler(request: Request):
            return await self._handle_stream_request(agentic_flow_id, request)
        
        self._app.add_route(
            gateway_path, 
            gateway_handler, 
            methods=["POST"]
        )
        
        self._app.add_route(
            f"/api/v1/agentic-flows/{agentic_flow_id}/stream", 
            gateway_stream_handler, 
            methods=["POST"]
        )
        
        self._routes[agentic_flow_id] = gateway_path
        self._handlers[agentic_flow_id] = gateway_handler
        
        if agentic_flow_id not in self._execution_locks:
            self._execution_locks[agentic_flow_id] = asyncio.Lock()
        
        logger.info(f"Gateway route registered: {gateway_path}")
        
        return gateway_path
    
    async def unregister_route(self, agentic_flow_id: str) -> bool:
        """
        注销网关路由。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
        
        Returns:
            bool: 是否成功注销
        """
        if agentic_flow_id in self._routes:
            del self._routes[agentic_flow_id]
            if agentic_flow_id in self._handlers:
                del self._handlers[agentic_flow_id]
            if agentic_flow_id in self._compiled_flows:
                del self._compiled_flows[agentic_flow_id]
            if agentic_flow_id in self._execution_locks:
                del self._execution_locks[agentic_flow_id]
            logger.info(f"Gateway route unregistered: {agentic_flow_id}")
            return True
        return False
    
    async def _handle_execute_request(
        self, 
        agentic_flow_id: str, 
        request: Request
    ) -> Response:
        """
        处理执行请求。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
            request (Request): FastAPI 请求对象
        
        Returns:
            Response: 响应对象
        """
        from SoloAgent.solo_agent.compiler import CompiledFlowFactory, FlowRunner
        
        try:
            body = await request.json()
            input_message = body.get("input_message", "")
            user_id = body.get("user_id")
            if not user_id:
                return JSONResponse(
                    status_code=400,
                    content={"error": "user_id is required"}
                )
            session_id = body.get("session_id")
            run_project_id = body.get("run_project_id")
            context = body.get("context", {})
            canvas_data = body.get("canvas_data")
            
            compiled_flow = self._compiled_flows.get(agentic_flow_id)
            
            if not compiled_flow and user_id and session_id and run_project_id:
                compiled_flow = CompiledFlowFactory.get(user_id, agentic_flow_id, session_id, run_project_id)
            
            if not compiled_flow and canvas_data:
                result = await FlowRunner.run_from_json(
                    canvas_data,
                    input_message,
                    user_id=user_id,
                    agentic_flow_id=agentic_flow_id,
                    session_id=session_id,
                    run_project_id=run_project_id,
                    context=context
                )
                return JSONResponse(content={
                    "code": 200,
                    "message": "AgenticFlow executed",
                    "data": result
                })
            
            if not compiled_flow:
                return JSONResponse(
                    status_code=404,
                    content={"code": 404, "message": f"AgenticFlow '{agentic_flow_id}' not found or not compiled"}
                )
            
            execution_lock = self._execution_locks.get(agentic_flow_id)
            if execution_lock:
                async with execution_lock:
                    result = await compiled_flow.run(input_message, context)
            else:
                result = await compiled_flow.run(input_message, context)
            
            return JSONResponse(content={
                "code": 200,
                "message": "AgenticFlow executed",
                "data": result
            })
            
        except Exception as e:
            logger.error(f"Gateway execute error for {agentic_flow_id}: {e}")
            return JSONResponse(
                status_code=500,
                content={"code": 500, "message": str(e)}
            )
    
    async def _handle_stream_request(
        self, 
        agentic_flow_id: str, 
        request: Request
    ) -> Response:
        """
        处理流式执行请求。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
            request (Request): FastAPI 请求对象
        
        Returns:
            Response: StreamingResponse 对象
        """
        from SoloAgent.solo_agent.compiler import CompiledFlowFactory, FlowRunner
        
        async def stream_generator():
            try:
                body = await request.json()
                input_message = body.get("input_message", "")
                user_id = body.get("user_id")
                if not user_id:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'user_id is required'})}\n\n"
                    return
                session_id = body.get("session_id")
                run_project_id = body.get("run_project_id")
                context = body.get("context", {})
                canvas_data = body.get("canvas_data")
                
                compiled_flow = self._compiled_flows.get(agentic_flow_id)
                
                if not compiled_flow and user_id and session_id and run_project_id:
                    compiled_flow = CompiledFlowFactory.get(user_id, agentic_flow_id, session_id, run_project_id)
                
                if not compiled_flow and canvas_data:
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Compiling...'})}\n\n"
                    
                    result = await FlowRunner.run_from_json(
                        canvas_data,
                        input_message,
                        user_id=user_id,
                        agentic_flow_id=agentic_flow_id,
                        session_id=session_id,
                        run_project_id=run_project_id,
                        context=context
                    )
                    
                    yield f"data: {json.dumps({'type': 'result', 'data': result})}\n\n"
                    return
                
                if not compiled_flow:
                    yield f"data: {json.dumps({'type': 'error', 'message': f'AgenticFlow {agentic_flow_id} not found'})}\n\n"
                    return
                
                yield f"data: {json.dumps({'type': 'status', 'message': 'Starting execution...'})}\n\n"
                
                result = await compiled_flow.run(input_message, context)
                
                yield f"data: {json.dumps({'type': 'result', 'data': result})}\n\n"
                
            except Exception as e:
                logger.error(f"Gateway stream error for {agentic_flow_id}: {e}")
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        
        return StreamingResponse(
            stream_generator(),
            media_type="text/event-stream"
        )
    
    def get_registered_routes(self) -> Dict[str, str]:
        """
        获取已注册的路由列表。
        
        Returns:
            Dict[str, str]: agentic_flow_id 到路由路径的映射
        """
        return self._routes.copy()
    
    def get_compiled_flow(self, agentic_flow_id: str) -> Optional[Any]:
        """
        获取编译后的 AgenticFlow。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
        
        Returns:
            编译后的 Flow 实例，如果不存在则返回 None
        """
        return self._compiled_flows.get(agentic_flow_id)
    
    def get_execution_lock(self, agentic_flow_id: str) -> Optional[asyncio.Lock]:
        """
        获取指定 AgenticFlow 的执行锁。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
        
        Returns:
            asyncio.Lock: 执行锁实例
        """
        return self._execution_locks.get(agentic_flow_id)
    
    def create_user_session(self, agentic_flow_id: str, user_id: str, session_id: str) -> str:
        """
        创建用户会话。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
            user_id (str): 用户 ID
            session_id (str): 会话 ID
        
        Returns:
            str: 会话 ID
        """
        session_key = f"{agentic_flow_id}:{user_id}:{session_id}"
        self._user_sessions[session_key] = {
            "agentic_flow_id": agentic_flow_id,
            "user_id": user_id,
            "session_id": session_id,
            "created_at": datetime.now(),
            "messages": []
        }
        return session_id
    
    def get_user_session(self, agentic_flow_id: str, user_id: str, session_id: str) -> Optional[Dict[str, Any]]:
        """
        获取用户会话。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
            user_id (str): 用户 ID
            session_id (str): 会话 ID
        
        Returns:
            会话数据，如果不存在则返回 None
        """
        session_key = f"{agentic_flow_id}:{user_id}:{session_id}"
        return self._user_sessions.get(session_key)
    
    def add_message_to_session(self, agentic_flow_id: str, user_id: str, session_id: str, 
                                role: str, content: str) -> None:
        """
        向会话添加消息。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
            user_id (str): 用户 ID
            session_id (str): 会话 ID
            role (str): 消息角色 (user/assistant/system)
            content (str): 消息内容
        """
        session_key = f"{agentic_flow_id}:{user_id}:{session_id}"
        if session_key in self._user_sessions:
            self._user_sessions[session_key]["messages"].append({
                "role": role,
                "content": content,
                "timestamp": datetime.now().isoformat()
            })
    
    def get_session_messages(self, agentic_flow_id: str, user_id: str, session_id: str) -> list:
        """
        获取会话消息历史。
        
        Args:
            agentic_flow_id (str): AgenticFlow ID
            user_id (str): 用户 ID
            session_id (str): 会话 ID
        
        Returns:
            消息历史列表
        """
        session = self.get_user_session(agentic_flow_id, user_id, session_id)
        if session:
            return session.get("messages", [])
        return []
    
    def get_stats(self) -> Dict[str, Any]:
        """
        获取网关统计信息。
        
        Returns:
            Dict[str, Any]: 统计信息
        """
        return {
            "total_routes": len(self._routes),
            "total_compiled_flows": len(self._compiled_flows),
            "total_execution_locks": len(self._execution_locks),
            "total_user_sessions": len(self._user_sessions),
            "routes": list(self._routes.keys())
        }


agenticflow_gateway = AgenticFlowGateway()
