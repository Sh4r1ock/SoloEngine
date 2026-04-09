# -*- coding: utf-8 -*-
"""
AgenticFlow编译器机制-mcp_host_client_manager.py: MCP Host Client管理器

@file mcp_host_client_manager.py
@description Host层MCP Client统一管理，符合MCP官方架构
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块实现AgenticFlow编译器机制的MCP Host Client管理器，提供以下核心功能：
- Host层统一管理所有MCP Client
- 编译时收集所有Agent配置的mcp_servers
- 统一创建和注册MCPClient
- 管理Client生命周期（连接、断开、重连）
- 多个Agent共享同一个Client实例

核心职责：
1. Host层统一管理所有MCP Client
2. 编译时收集所有Agent配置的mcp_servers
3. 统一创建和注册MCPClient
4. 管理Client生命周期（连接、断开、重连）
5. 多个Agent共享同一个Client

依赖:
- logging: 日志记录
- typing: 类型提示
- asyncio: 异步操作
- SoloAgent.plugins.mcp.mcp_client: MCPClient实现

使用示例:
- manager = MCPHostClientManager()
- result = await manager.register_servers(mcp_servers, user_id)
- tools = await manager.get_all_tools()
"""

import logging
from typing import Dict, Any, Optional, List
import asyncio

from SoloAgent.plugins.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)


class MCPHostClientManager:
    """
    MCP Host Client管理器类
    
    职责:
    - Host层统一管理所有MCP Client
    - 符合MCP官方架构设计
    - 管理Client生命周期
    - 支持多Agent共享Client
    
    属性:
        _clients (Dict[str, MCPClient]): server_name到Client的映射
        _server_configs (Dict[str, Dict]): server_name到配置的映射
    """
    
    def __init__(self):
        self._clients: Dict[str, MCPClient] = {}
        self._server_configs: Dict[str, Dict] = {}
    
    async def register_servers(
        self, 
        all_mcp_servers: Dict[str, Dict],
        user_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """注册所有MCP Server，统一创建Client
        
        Args:
            all_mcp_servers: 所有Agent配置的mcp_servers的并集
                {"server_name": {"id": "...", "config": {...}}, ...}
            user_id: 用户ID，用于权限检查
        
        Returns:
            Dict[str, Any]: 注册结果
                {
                    "success": True/False,
                    "registered": ["server_name1", ...],
                    "failed": [{"name": "...", "error": "..."}],
                    "total": 10,
                    "connected": 8
                }
        """
        registered = []
        failed = []
        
        for server_name, server_data in all_mcp_servers.items():
            try:
                await self._create_client(server_name, server_data, user_id)
                registered.append(server_name)
                logger.info(f"[MCPHost] Registered MCP server '{server_name}'")
            except Exception as e:
                logger.error(f"[MCPHost] Failed to register '{server_name}': {e}")
                failed.append({"name": server_name, "error": str(e)})
        
        return {
            "success": len(failed) == 0,
            "registered": registered,
            "failed": failed,
            "total": len(all_mcp_servers),
            "connected": len(registered)
        }
    
    async def _create_client(
        self, 
        server_name: str, 
        server_data: Dict,
        user_id: Optional[str] = None
    ):
        """创建单个MCPClient
        
        Args:
            server_name: 服务器名称
            server_data: 服务器数据，包含id和config
            user_id: 用户ID
        """
        from app.core.database import get_db_context, MCPServerModel
        from sqlalchemy.orm import joinedload
        
        server_id = server_data.get("id")
        
        with get_db_context() as db:
            server = db.query(MCPServerModel).options(
                joinedload(MCPServerModel.sse_config),
                joinedload(MCPServerModel.stdio_config),
                joinedload(MCPServerModel.http_config)
            ).filter(MCPServerModel.id == server_id).first()
            
            if not server:
                raise ValueError(f"MCP server '{server_name}' not found in database")
            
            # 权限检查
            if not server.is_public and str(server.user_id) != str(user_id):
                raise PermissionError(f"No permission to access MCP server '{server_name}'")
            
            # 创建Client配置
            client_config = self._build_client_config(server)
            
            # 创建并连接Client
            client = MCPClient(client_config)
            await client.connect()
            
            # 获取工具列表
            tools = []
            if hasattr(server, 'tools') and server.tools:
                tools = server.tools
            
            # 保存
            self._clients[server_name] = client
            self._server_configs[server_name] = {
                "id": server_id,
                "name": server_name,
                "description": getattr(server, 'description', ''),
                "transport_type": getattr(server, 'transport_type', 'stdio'),
                "tools": tools,
                "resources": [],
                "prompts": [],
            }
            
            logger.info(
                f"[MCPHost] Created client for '{server_name}' "
                f"(transport={server.transport_type})"
            )
    
    def _build_client_config(self, server) -> Dict[str, Any]:
        """构建Client配置"""
        config = {"transport": server.transport_type}
        
        if server.transport_type == "stdio" and server.stdio_config:
            config["command"] = server.stdio_config.command
            config["args"] = server.stdio_config.args or []
            config["env"] = server.stdio_config.env or {}
        elif server.transport_type == "sse" and server.sse_config:
            config["url"] = server.sse_config.url
        elif server.transport_type == "http" and server.http_config:
            config["url"] = server.http_config.url
        
        return config
    
    def get_client(self, server_name: str) -> Optional[MCPClient]:
        """获取指定Server的Client
        
        Args:
            server_name: 服务器名称
        
        Returns:
            Optional[MCPClient]: Client实例，如果不存在返回None
        """
        return self._clients.get(server_name)
    
    def get_server_config(self, server_name: str) -> Optional[Dict]:
        """获取指定Server的配置
        
        Args:
            server_name: 服务器名称
        
        Returns:
            Optional[Dict]: 服务器配置
        """
        return self._server_configs.get(server_name)
    
    def get_all_clients(self) -> Dict[str, MCPClient]:
        """获取所有Client
        
        Returns:
            Dict[str, MCPClient]: 所有Client的字典
        """
        return self._clients.copy()
    
    def get_all_server_configs(self) -> Dict[str, Dict]:
        """获取所有Server配置
        
        Returns:
            Dict[str, Dict]: 所有Server配置的字典
        """
        return self._server_configs.copy()
    
    async def close_client(self, server_name: str):
        """关闭指定Client
        
        Args:
            server_name: 服务器名称
        """
        client = self._clients.pop(server_name, None)
        if client:
            try:
                await client.disconnect()
                logger.info(f"[MCPHost] Closed client for '{server_name}'")
            except Exception as e:
                logger.warning(f"[MCPHost] Error closing client '{server_name}': {e}")
    
    async def close_all(self):
        """关闭所有Client连接"""
        logger.info(f"[MCPHost] Closing all {len(self._clients)} MCP clients...")
        
        errors = []
        for server_name, client in list(self._clients.items()):
            try:
                await client.disconnect()
                logger.info(f"[MCPHost] Closed client for '{server_name}'")
            except Exception as e:
                errors.append((server_name, str(e)))
                logger.error(f"[MCPHost] Error closing client '{server_name}': {e}")
        
        self._clients.clear()
        self._server_configs.clear()
        
        if errors:
            logger.warning(f"[MCPHost] Errors during close: {errors}")
    
    async def __aenter__(self):
        """异步上下文管理器入口"""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器出口，确保关闭所有Client"""
        await self.close_all()
