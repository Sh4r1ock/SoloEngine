# -*- coding: utf-8 -*-
"""
统一调用接口 - 提供统一的工具调用接口。

职责：
- call(server_name, tool_name, params) - 调用指定工具
- list_tools(server_name) - 列出Server提供的所有工具
- list_servers() - 列出所有已注册的Server
"""

import logging
from typing import Dict, List, Any, Optional
import asyncio

from .registry import ServiceRegistry, MCPServerInfo, ServerStatus, service_registry
from .lifecycle import LifecycleManager, lifecycle_manager
from SoloAgent.plugins.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)


class UnifiedCaller:
    """统一调用接口。"""
    
    def __init__(
        self,
        registry: ServiceRegistry = None,
        lifecycle: LifecycleManager = None
    ):
        self._registry = registry or service_registry
        self._lifecycle = lifecycle or lifecycle_manager
    
    async def call(
        self,
        server_id: str,
        tool_name: str,
        params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """调用指定服务器的工具。
        
        Args:
            server_id: 服务器ID
            tool_name: 工具名称
            params: 工具参数
            
        Returns:
            工具执行结果
        """
        client = await self._lifecycle.get_client(server_id)
        
        if not client:
            server_info = await self._registry.get_server(server_id)
            if server_info and server_info.enabled:
                connected = await self._lifecycle.connect(server_id)
                if connected:
                    client = await self._lifecycle.get_client(server_id)
            
            if not client:
                raise ValueError(f"Server '{server_id}' not connected")
        
        try:
            result = await client.call_tool(tool_name, params)
            return result
        except Exception as e:
            logger.error(f"Error calling tool '{tool_name}' on server '{server_id}': {e}")
            raise
    
    async def list_tools(self, server_id: str) -> List[Dict[str, Any]]:
        """列出指定服务器的所有工具。
        
        Args:
            server_id: 服务器ID
            
        Returns:
            工具列表
        """
        client = await self._lifecycle.get_client(server_id)
        
        if not client:
            server_info = await self._registry.get_server(server_id)
            if server_info and server_info.enabled:
                connected = await self._lifecycle.connect(server_id)
                if connected:
                    client = await self._lifecycle.get_client(server_id)
            
            if not client:
                raise ValueError(f"Server '{server_id}' not connected")
        
        try:
            tools = await client.get_tools()
            server_info = await self._registry.get_server(server_id)
            
            return [
                {
                    "name": tool.get("name"),
                    "description": tool.get("description", ""),
                    "input_schema": tool.get("inputSchema", {}),
                    "server_id": server_id,
                    "server_name": server_info.name if server_info else server_id,
                }
                for tool in tools
            ]
        except Exception as e:
            logger.error(f"Error listing tools for server '{server_id}': {e}")
            raise
    
    async def list_servers(self, user_id: str = None) -> List[Dict[str, Any]]:
        """列出所有已注册的服务器。
        
        Args:
            user_id: 用户ID（可选，用于过滤用户的服务器）
            
        Returns:
            服务器列表
        """
        if user_id:
            servers = await self._registry.get_servers_by_user(user_id)
        else:
            servers = await self._registry.get_all_servers()
        
        return [server.to_dict() for server in servers]
    
    async def list_all_tools(self, user_id: str = None) -> List[Dict[str, Any]]:
        """列出所有服务器的所有工具。
        
        Args:
            user_id: 用户ID（可选）
            
        Returns:
            所有工具列表
        """
        if user_id:
            servers = await self._registry.get_servers_by_user(user_id)
        else:
            servers = await self._registry.get_all_servers()
        
        async def get_server_tools(server: MCPServerInfo) -> List[Dict[str, Any]]:
            tools = []
            try:
                client = await self._lifecycle.get_client(server.id)
                if not client and server.enabled:
                    await self._lifecycle.connect(server.id)
                    client = await self._lifecycle.get_client(server.id)
                
                if client:
                    server_tools = await client.get_tools()
                    for tool in server_tools:
                        tools.append({
                            "name": tool.get("name"),
                            "description": tool.get("description", ""),
                            "input_schema": tool.get("inputSchema", {}),
                            "server_id": server.id,
                            "server_name": server.name,
                        })
            except Exception as e:
                logger.error(f"Failed to get tools from server {server.name}: {e}")
            return tools
        
        results = await asyncio.gather(
            *[get_server_tools(s) for s in servers if s.enabled],
            return_exceptions=True
        )
        
        all_tools = []
        for result in results:
            if isinstance(result, list):
                all_tools.extend(result)
        
        return all_tools
    
    async def get_resources(self, server_id: str) -> List[Dict[str, Any]]:
        """获取服务器的资源列表。
        
        Args:
            server_id: 服务器ID
            
        Returns:
            资源列表
        """
        client = await self._lifecycle.get_client(server_id)
        
        if not client:
            server_info = await self._registry.get_server(server_id)
            if server_info and server_info.enabled:
                connected = await self._lifecycle.connect(server_id)
                if connected:
                    client = await self._lifecycle.get_client(server_id)
            
            if not client:
                raise ValueError(f"Server '{server_id}' not connected")
        
        try:
            resources = await client.get_resources()
            server_info = await self._registry.get_server(server_id)
            
            return [
                {
                    "uri": resource.get("uri"),
                    "name": resource.get("name"),
                    "description": resource.get("description", ""),
                    "mime_type": resource.get("mimeType"),
                    "server_id": server_id,
                    "server_name": server_info.name if server_info else server_id,
                }
                for resource in resources
            ]
        except Exception as e:
            logger.error(f"Error getting resources for server '{server_id}': {e}")
            raise
    
    async def get_prompts(self, server_id: str) -> List[Dict[str, Any]]:
        """获取服务器的提示词列表。
        
        Args:
            server_id: 服务器ID
            
        Returns:
            提示词列表
        """
        client = await self._lifecycle.get_client(server_id)
        
        if not client:
            server_info = await self._registry.get_server(server_id)
            if server_info and server_info.enabled:
                connected = await self._lifecycle.connect(server_id)
                if connected:
                    client = await self._lifecycle.get_client(server_id)
            
            if not client:
                raise ValueError(f"Server '{server_id}' not connected")
        
        try:
            prompts = await client.get_prompts()
            server_info = await self._registry.get_server(server_id)
            
            return [
                {
                    "name": prompt.get("name"),
                    "description": prompt.get("description", ""),
                    "arguments": prompt.get("arguments", []),
                    "server_id": server_id,
                    "server_name": server_info.name if server_info else server_id,
                }
                for prompt in prompts
            ]
        except Exception as e:
            logger.error(f"Error getting prompts for server '{server_id}': {e}")
            raise
    
    async def read_resource(self, server_id: str, uri: str) -> Dict[str, Any]:
        """读取服务器资源。
        
        Args:
            server_id: 服务器ID
            uri: 资源URI
            
        Returns:
            资源内容
        """
        client = await self._lifecycle.get_client(server_id)
        
        if not client:
            raise ValueError(f"Server '{server_id}' not connected")
        
        return await client.read_resource(uri)
    
    async def get_prompt(
        self,
        server_id: str,
        name: str,
        arguments: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """获取服务器的提示词。
        
        Args:
            server_id: 服务器ID
            name: 提示词名称
            arguments: 提示词参数
            
        Returns:
            提示词内容
        """
        client = await self._lifecycle.get_client(server_id)
        
        if not client:
            raise ValueError(f"Server '{server_id}' not connected")
        
        return await client.get_prompt(name, arguments)


unified_caller = UnifiedCaller()
