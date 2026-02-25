# -*- coding: utf-8 -*-
"""
MCP 网关路由 - 动态路由注册和管理。

@file gateway.py
@description 为 MCP Server 提供自动网关路由注册功能
@author SoloEngine Team
@date 2026-02-25

功能描述：
- 当注册名为 "github" 的 MCP Server 后，自动创建 /github 路由
- 支持动态路由的注册和注销
- 转发请求到实际的 MCP 服务

使用场景：
- MCP Server 注册后自动暴露为 HTTP 端点
- 支持通过 HTTP 调用 MCP 工具

状态: 新增实现
"""

import logging
from typing import Dict, Any, Optional, Callable
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class MCPGateway:
    """
    MCP 网关管理器。
    
    为注册的 MCP Server 自动创建网关路由。
    例如：注册名为 "github" 的服务器后，可通过 /github/* 访问。
    
    Attributes:
        _routes (Dict[str, str]): 服务器名称到路由路径的映射
        _app (Optional[FastAPI]): FastAPI 应用实例
        _handlers (Dict[str, Callable]): 路由处理器映射
    
    Example:
        >>> gateway = MCPGateway()
        >>> gateway.init_app(app)
        >>> await gateway.register_route("github")
        >>> # 现在可以通过 /github/tools 访问工具列表
    """
    
    def __init__(self):
        self._routes: Dict[str, str] = {}
        self._app: Optional[FastAPI] = None
        self._handlers: Dict[str, Callable] = {}
    
    def init_app(self, app: FastAPI) -> None:
        """
        初始化网关。
        
        Args:
            app (FastAPI): FastAPI 应用实例
        """
        self._app = app
        logger.info("MCP Gateway initialized")
    
    async def register_route(self, server_name: str, server_id: str = None) -> str:
        """
        为服务器注册网关路由。
        
        注册后可通过 /{server_name}/* 访问服务。
        
        Args:
            server_name (str): 服务器名称，用于生成路由路径
            server_id (str, optional): 服务器 ID，用于查找服务器
        
        Returns:
            str: 注册的路由路径
        
        Raises:
            RuntimeError: 如果 FastAPI 应用未初始化
        """
        if not self._app:
            raise RuntimeError("FastAPI app not initialized. Call init_app() first.")
        
        if server_name in self._routes:
            logger.warning(f"Route already exists for server: {server_name}")
            return self._routes[server_name]
        
        gateway_path = f"/{server_name}"
        
        async def gateway_handler(request: Request):
            return await self._handle_request(server_name, server_id, request)
        
        self._app.add_route(
            f"{gateway_path}/{{path:path}}", 
            gateway_handler, 
            methods=["GET", "POST", "PUT", "DELETE"]
        )
        self._app.add_route(
            gateway_path, 
            gateway_handler, 
            methods=["GET", "POST"]
        )
        
        self._routes[server_name] = gateway_path
        self._handlers[server_name] = gateway_handler
        
        logger.info(f"Gateway route registered: {gateway_path}")
        
        return gateway_path
    
    async def unregister_route(self, server_name: str) -> bool:
        """
        注销网关路由。
        
        注意：FastAPI 不直接支持删除路由，此方法只是从内部映射中移除。
        实际路由仍然存在，但处理器会返回 404。
        
        Args:
            server_name (str): 服务器名称
        
        Returns:
            bool: 是否成功注销
        """
        if server_name in self._routes:
            del self._routes[server_name]
            if server_name in self._handlers:
                del self._handlers[server_name]
            logger.info(f"Gateway route unregistered: /{server_name}")
            return True
        return False
    
    async def _handle_request(
        self, 
        server_name: str, 
        server_id: Optional[str],
        request: Request
    ) -> Response:
        """
        处理网关请求。
        
        根据请求路径转发到相应的 MCP 服务。
        
        Args:
            server_name (str): 服务器名称
            server_id (Optional[str]): 服务器 ID
            request (Request): FastAPI 请求对象
        
        Returns:
            Response: 响应对象
        """
        from .host.registry import service_registry
        from .host.caller import unified_caller
        
        if server_name not in self._routes:
            return JSONResponse(
                status_code=404,
                content={"code": 404, "message": f"Server '{server_name}' not registered in gateway"}
            )
        
        server = None
        if server_id:
            server = await service_registry.get_server(server_id)
        
        if not server:
            servers = await service_registry.get_all_servers()
            server = next((s for s in servers if s.name == server_name), None)
        
        if not server:
            return JSONResponse(
                status_code=404,
                content={"code": 404, "message": f"Server '{server_name}' not found"}
            )
        
        path = request.url.path
        method = request.method
        
        try:
            if path == f"/{server_name}" or path == f"/{server_name}/":
                return JSONResponse(content={
                    "code": 200,
                    "message": f"MCP Server: {server_name}",
                    "data": {
                        "id": server.id,
                        "name": server.name,
                        "transport": server.transport,
                        "description": server.description
                    }
                })
            
            elif path.endswith("/tools"):
                tools = await unified_caller.list_tools(server.id)
                return JSONResponse(content={"code": 200, "data": tools})
            
            elif "/tools/" in path:
                parts = path.split("/")
                if len(parts) >= 4:
                    tool_name = parts[3]
                    
                    if path.endswith("/call"):
                        body = await request.json() if method == "POST" else {}
                        result = await unified_caller.call(
                            server.id, 
                            tool_name, 
                            body.get("arguments", {})
                        )
                        return JSONResponse(content={"code": 200, "data": result})
                    else:
                        tools = await unified_caller.list_tools(server.id)
                        tool = next((t for t in tools if t.get("name") == tool_name), None)
                        if tool:
                            return JSONResponse(content={"code": 200, "data": tool})
                        return JSONResponse(
                            status_code=404,
                            content={"code": 404, "message": f"Tool '{tool_name}' not found"}
                        )
            
            elif path.endswith("/resources"):
                resources = await unified_caller.get_resources(server.id)
                return JSONResponse(content={"code": 200, "data": resources})
            
            elif path.endswith("/prompts"):
                prompts = await unified_caller.get_prompts(server.id)
                return JSONResponse(content={"code": 200, "data": prompts})
            
            else:
                return JSONResponse(
                    status_code=404,
                    content={"code": 404, "message": f"Route '{path}' not found"}
                )
                
        except Exception as e:
            logger.error(f"Gateway error for {server_name}: {e}")
            return JSONResponse(
                status_code=500,
                content={"code": 500, "message": str(e)}
            )
    
    def get_registered_routes(self) -> Dict[str, str]:
        """
        获取已注册的路由列表。
        
        Returns:
            Dict[str, str]: 服务器名称到路由路径的映射
        """
        return self._routes.copy()


mcp_gateway = MCPGateway()
