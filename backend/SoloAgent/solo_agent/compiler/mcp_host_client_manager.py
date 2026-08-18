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
import asyncio
from typing import Dict, Any, Optional

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
        self._connection_events: Dict[str, asyncio.Event] = {}  # 连接完成事件
        self._connection_tasks: Dict[str, asyncio.Task] = {}  # 连接任务跟踪
        self._shutdown_events: Dict[str, asyncio.Event] = {}  # 关闭信号事件（连接任务等待）
        self._server_data: Dict[str, Dict] = {}  # 保存server_id和user_id用于重连
    
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
        
        async def _register_one(server_name, server_data):
            try:
                await self._create_client(server_name, server_data, user_id)
                return server_name, None
            except Exception as e:
                logger.error(f"[MCPHost] Failed to register '{server_name}': {e}")
                return None, {"name": server_name, "error": str(e)}
        
        results = await asyncio.gather(*[
            _register_one(name, data) for name, data in all_mcp_servers.items()
        ], return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                failed.append({"name": "unknown", "error": str(result)})
            elif result[0]:
                registered.append(result[0])
            else:
                failed.append(result[1])
        
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

        # 保存server数据用于重连
        self._server_data[server_name] = {
            "id": server_id,
            "user_id": user_id
        }

        # 创建连接事件
        self._connection_events[server_name] = asyncio.Event()

        try:
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

                # 获取工具列表和资源（从连接后的client获取最新数据）
                tools = await client.get_tools()
                resources = await client.get_resources()

                # 保存
                self._clients[server_name] = client
                self._server_configs[server_name] = {
                    "id": server_id,
                    "name": server_name,
                    "description": getattr(server, 'description', ''),
                    "transport_type": getattr(server, 'transport_type', 'stdio'),
                    "tools": tools,  # 使用从client获取的最新tools
                    "resources": resources,
                    "prompts": [],
                }

                # 标记连接完成
                self._connection_events[server_name].set()

                logger.info(
                    f"[MCPHost] Created client for '{server_name}' "
                    f"(transport={server.transport_type}, tools={len(tools)})"
                )
        except Exception as e:
            # 即使失败也标记事件，避免无限等待
            self._connection_events[server_name].set()
            raise
    
    def _build_client_config(self, server) -> Dict[str, Any]:
        from app.core.mcp_config import build_mcp_config
        return build_mcp_config(server)
    
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

        通过关闭信号触发连接任务，在该任务中执行 disconnect，
        保证 anyio cancel scope 同任务退出。

        Args:
            server_name: 服务器名称
        """
        event = self._shutdown_events.get(server_name)
        if event:
            event.set()
        task = self._connection_tasks.get(server_name)
        if task is not None:
            try:
                await task
            except Exception as e:
                logger.warning(f"[MCPHost] Error waiting close task for '{server_name}': {e}")
        self._shutdown_events.pop(server_name, None)
        self._connection_tasks.pop(server_name, None)
    
    async def close_all(self):
        """关闭所有Client连接（在各自连接任务中执行 disconnect）"""
        logger.info(f"[MCPHost] Closing all {len(self._clients)} MCP clients...")
        
        # 触发所有关闭信号，连接任务收到后在同一任务中执行 disconnect
        for event in self._shutdown_events.values():
            event.set()
        
        pending = [
            t for t in self._connection_tasks.values()
            if t is not None and not t.done()
        ]
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        
        self._clients.clear()
        self._server_configs.clear()
        self._shutdown_events.clear()
        self._connection_tasks.clear()
    
    def load_server_configs(self, mcp_configs: Dict[str, Any]):
        """加载MCP服务器配置（不连接）
        
        Args:
            mcp_configs: MCP配置字典，key为server_id，value为MCPServerModel
        """
        for server_id, server in mcp_configs.items():
            server_name = server.name
            self._server_configs[server_name] = {
                "id": server_id,
                "name": server_name,
                "description": getattr(server, 'description', ''),
                "transport_type": getattr(server, 'transport_type', 'stdio'),
                "tools": getattr(server, 'tools', []),
                "resources": [],
                "prompts": [],
            }
            logger.info(f"[MCPHost] Loaded config for '{server_name}'")
    
    async def connect_servers_async(
        self,
        all_mcp_servers: Dict[str, Dict],
        user_id: Optional[str] = None
    ):
        """后台异步连接所有MCP服务器（生命周期任务模式）

        Args:
            all_mcp_servers: 所有Agent配置的mcp_servers的并集
            user_id: 用户ID

        设计说明：
            每个服务器的连接任务在成功连接后保持存活，等待关闭信号；
            disconnect 在与 connect 相同的任务中执行，确保 anyio
            cancel scope（mcp SDK stdio_client 内部）在同一任务中退出，
            避免 "Attempted to exit cancel scope in a different task than
            it was entered in" 与 "Task exception was never retrieved"。
        """
        logger.info(f"[MCPHost] Starting async connection for {len(all_mcp_servers)} servers...")

        async def _connect_one(server_name, server_data):
            try:
                await self._create_client(server_name, server_data, user_id)
                logger.info(f"[MCPHost] Async connected '{server_name}'")
                # 等待关闭信号，在同一任务中执行 disconnect
                await self._shutdown_events[server_name].wait()
                client = self._clients.pop(server_name, None)
                self._server_configs.pop(server_name, None)
                if client is not None:
                    try:
                        await client.disconnect()
                        logger.info(f"[MCPHost] Closed client for '{server_name}' (in connect task)")
                    except Exception as e:
                        logger.error(f"[MCPHost] Error closing client '{server_name}' in connect task: {e}")
            except Exception as e:
                logger.error(f"[MCPHost] Async connection failed for '{server_name}': {e}")

        # 创建连接任务并保存（任务生命周期化，不在此处 await 等待完成）
        for name, data in all_mcp_servers.items():
            self._shutdown_events[name] = asyncio.Event()
            task = asyncio.create_task(_connect_one(name, data))
            self._connection_tasks[name] = task

        logger.info(f"[MCPHost] Async connection tasks scheduled for {len(all_mcp_servers)} servers")

    async def wait_for_connection(self, server_name: str, timeout: float = 30.0) -> bool:
        """等待指定服务器连接完成

        Args:
            server_name: 服务器名称
            timeout: 超时时间（秒）

        Returns:
            bool: 是否在超时前连接成功
        """
        # 如果已经连接，直接返回True
        if server_name in self._clients:
            return True

        # 如果有连接事件，等待它
        if server_name in self._connection_events:
            try:
                await asyncio.wait_for(
                    self._connection_events[server_name].wait(),
                    timeout=timeout
                )
                return server_name in self._clients
            except asyncio.TimeoutError:
                logger.warning(f"[MCPHost] Timeout waiting for '{server_name}' connection")
                return False

        # 如果没有连接事件，说明连接从未启动
        return False

    async def connect_server_by_id(
        self,
        server_id: str,
        server_name: str,
        user_id: Optional[str] = None
    ) -> bool:
        """根据server_id主动连接MCP服务器

        用于当异步连接失败或未启动时，工具调用端主动触发连接

        Args:
            server_id: 服务器ID
            server_name: 服务器名称
            user_id: 用户ID

        Returns:
            bool: 是否连接成功
        """
        # 如果已经连接，直接返回True
        if server_name in self._clients:
            return True

        try:
            logger.info(f"[MCPHost] Connecting server '{server_name}' by id...")
            await self._create_client(
                server_name=server_name,
                server_data={"id": server_id},
                user_id=user_id
            )
            return True
        except Exception as e:
            logger.error(f"[MCPHost] Failed to connect server '{server_name}': {e}")
            return False

    async def reconnect_server(
        self,
        server_name: str,
        server_id: Optional[str] = None,
        user_id: Optional[str] = None
    ) -> bool:
        """重新连接MCP服务器

        用于连接断开后的自动重连

        Args:
            server_name: 服务器名称
            server_id: 服务器ID（可选，如果不提供则从_server_data获取）
            user_id: 用户ID（可选，如果不提供则从_server_data获取）

        Returns:
            bool: 是否重连成功
        """
        # 关闭现有连接
        if server_name in self._clients:
            try:
                old_client = self._clients[server_name]
                await old_client.disconnect()
            except Exception as e:
                logger.warning(f"[MCPHost] Error disconnecting old client for '{server_name}': {e}")
            finally:
                self._clients.pop(server_name, None)

        # 重置连接事件
        if server_name in self._connection_events:
            self._connection_events[server_name].clear()
        else:
            self._connection_events[server_name] = asyncio.Event()

        # 获取保存的server数据
        server_data = self._server_data.get(server_name, {})
        actual_server_id = server_id or server_data.get("id")
        actual_user_id = user_id or server_data.get("user_id")

        if not actual_server_id:
            logger.error(f"[MCPHost] Cannot reconnect '{server_name}': no server_id available")
            return False

        try:
            logger.info(f"[MCPHost] Reconnecting server '{server_name}'...")
            await self._create_client(
                server_name=server_name,
                server_data={"id": actual_server_id},
                user_id=actual_user_id
            )
            logger.info(f"[MCPHost] Successfully reconnected '{server_name}'")
            return True
        except Exception as e:
            logger.error(f"[MCPHost] Failed to reconnect '{server_name}': {e}")
            # 标记事件，避免无限等待
            self._connection_events[server_name].set()
            return False
    
    async def __aenter__(self):
        """异步上下文管理器入口"""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器出口，确保关闭所有Client"""
        await self.close_all()
