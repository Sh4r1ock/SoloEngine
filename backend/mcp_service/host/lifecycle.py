# -*- coding: utf-8 -*-
"""
生命周期管理 - 管理MCP服务器的生命周期。

职责：
- 注册 → 创建Client → 连接Server
- 注销 → 断开连接 → 销毁Client
- 启动 → 启动Server进程
- 停止 → 停止Server进程
"""

import logging
from typing import Dict, Optional, Any
from datetime import datetime
import asyncio

from .registry import ServiceRegistry, MCPServerInfo, ServerStatus, service_registry
from SoloAgent.plugins.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)


class LifecycleManager:
    """生命周期管理器。"""
    
    def __init__(self, registry: ServiceRegistry = None):
        self._registry = registry or service_registry
        self._clients: Dict[str, MCPClient] = {}
        self._lock = asyncio.Lock()
    
    async def register_and_connect(
        self,
        server_info: MCPServerInfo
    ) -> bool:
        """注册服务器并建立连接。"""
        try:
            await self._registry.register(server_info)
            
            if server_info.enabled:
                return await self.connect(server_info.id)
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to register and connect server {server_info.name}: {e}")
            await self._registry.update_status(
                server_info.id,
                ServerStatus.ERROR,
                str(e)
            )
            return False
    
    async def connect(self, server_id: str) -> bool:
        """连接到服务器。"""
        server_info = await self._registry.get_server(server_id)
        if not server_info:
            logger.error(f"Server {server_id} not found")
            return False
        
        async with self._lock:
            if server_id in self._clients:
                logger.warning(f"Server {server_id} already connected")
                return True
        
        await self._registry.update_status(server_id, ServerStatus.CONNECTING)
        
        try:
            client_config = {
                "transport": server_info.transport,
                "timeout": server_info.timeout,
            }
            
            if server_info.transport == "stdio":
                client_config["command"] = server_info.command
                client_config["args"] = server_info.args or []
                client_config["env"] = server_info.env or {}
            elif server_info.transport in ("sse", "http"):
                client_config["url"] = server_info.url
                client_config["headers"] = server_info.headers or {}
            
            client = MCPClient(client_config)
            await client.connect()
            
            async with self._lock:
                self._clients[server_id] = client
            
            await self._registry.update_status(server_id, ServerStatus.CONNECTED)
            logger.info(f"Connected to MCP server: {server_info.name}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to server {server_info.name}: {e}")
            await self._registry.update_status(
                server_id,
                ServerStatus.ERROR,
                str(e)
            )
            return False
    
    async def disconnect(self, server_id: str) -> bool:
        """断开服务器连接。"""
        client = self._clients.pop(server_id, None)
        
        if client:
            try:
                await asyncio.wait_for(
                    client.disconnect(),
                    timeout=3.0
                )
                logger.info(f"Disconnected from server: {server_id}")
            except asyncio.TimeoutError:
                logger.warning(f"Timeout disconnecting from server {server_id}")
            except Exception as e:
                logger.error(f"Error disconnecting from server {server_id}: {e}")
        
        await self._registry.update_status(server_id, ServerStatus.DISCONNECTED)
        return True
    
    async def unregister_and_disconnect(self, server_id: str) -> bool:
        """注销服务器并断开连接。"""
        await self.disconnect(server_id)
        return await self._registry.unregister(server_id)
    
    async def get_client(self, server_id: str) -> Optional[MCPClient]:
        """获取服务器对应的客户端。"""
        return self._clients.get(server_id)
    
    async def is_connected(self, server_id: str) -> bool:
        """检查服务器是否已连接。"""
        return server_id in self._clients
    
    async def reconnect(self, server_id: str) -> bool:
        """重新连接服务器。"""
        await self.disconnect(server_id)
        return await self.connect(server_id)
    
    async def disconnect_all(self) -> None:
        """断开所有连接。"""
        server_ids = list(self._clients.keys())
        for server_id in server_ids:
            await self.disconnect(server_id)
    
    async def get_connected_servers(self) -> Dict[str, MCPClient]:
        """获取所有已连接的服务器。"""
        return dict(self._clients)
    
    async def health_check(self, server_id: str) -> Dict[str, Any]:
        """健康检查。"""
        server_info = await self._registry.get_server(server_id)
        if not server_info:
            return {"healthy": False, "error": "Server not found"}
        
        client = self._clients.get(server_id)
        if not client:
            return {"healthy": False, "error": "Not connected"}
        
        try:
            tools = await client.get_tools()
            return {
                "healthy": True,
                "server_name": server_info.name,
                "tools_count": len(tools),
                "status": server_info.status.value,
            }
        except Exception as e:
            return {"healthy": False, "error": str(e)}


lifecycle_manager = LifecycleManager()
