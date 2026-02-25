# -*- coding: utf-8 -*-
"""
服务注册中心 - 存储Server配置信息、维护Server状态、提供查询接口。

职责：
- 存储Server配置信息
- 维护Server状态
- 提供查询接口
"""

import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import asyncio
import uuid

logger = logging.getLogger(__name__)


class ServerStatus(Enum):
    """服务器状态枚举。"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class MCPServerInfo:
    """MCP服务器信息。"""
    id: str
    name: str
    transport: str
    user_id: str
    url: Optional[str] = None
    command: Optional[str] = None
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    headers: Dict[str, str] = field(default_factory=dict)
    timeout: int = 30
    enabled: bool = True
    is_public: bool = False
    is_default: bool = False
    author: Optional[str] = None
    source: Optional[str] = None
    description: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    storage_path: Optional[str] = None
    tools: List[Dict[str, Any]] = field(default_factory=list)
    version: int = 0
    status: ServerStatus = ServerStatus.DISCONNECTED
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典。"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "transport": self.transport,
            "url": self.url,
            "command": self.command,
            "args": self.args,
            "env": self.env,
            "headers": self.headers,
            "timeout": self.timeout,
            "enabled": self.enabled,
            "is_public": self.is_public,
            "is_default": self.is_default,
            "author": self.author,
            "source": self.source,
            "description": self.description,
            "tags": self.tags,
            "storage_path": self.storage_path,
            "tools": self.tools,
            "version": self.version,
            "status": self.status.value,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class ServiceRegistry:
    """服务注册中心。"""
    
    def __init__(self):
        self._servers: Dict[str, MCPServerInfo] = {}
        self._user_servers: Dict[str, List[str]] = {}
        self._lock = asyncio.Lock()
    
    async def register(self, server_info: MCPServerInfo) -> None:
        """注册服务器。"""
        async with self._lock:
            self._servers[server_info.id] = server_info
            
            if server_info.user_id not in self._user_servers:
                self._user_servers[server_info.user_id] = []
            
            if server_info.id not in self._user_servers[server_info.user_id]:
                self._user_servers[server_info.user_id].append(server_info.id)
            
            logger.info(f"Registered MCP server: {server_info.name} (id={server_info.id})")
    
    async def unregister(self, server_id: str) -> bool:
        """注销服务器。"""
        async with self._lock:
            if server_id not in self._servers:
                return False
            
            server = self._servers[server_id]
            
            if server.user_id in self._user_servers:
                if server_id in self._user_servers[server.user_id]:
                    self._user_servers[server.user_id].remove(server_id)
            
            del self._servers[server_id]
            logger.info(f"Unregistered MCP server: {server_id}")
            return True
    
    async def get_server(self, server_id: str) -> Optional[MCPServerInfo]:
        """获取服务器信息。"""
        return self._servers.get(server_id)
    
    async def get_servers_by_user(self, user_id: str) -> List[MCPServerInfo]:
        """获取用户的所有服务器。"""
        server_ids = self._user_servers.get(user_id, [])
        return [self._servers[sid] for sid in server_ids if sid in self._servers]
    
    async def get_all_servers(self) -> List[MCPServerInfo]:
        """获取所有服务器。"""
        return list(self._servers.values())
    
    async def update_status(
        self, 
        server_id: str, 
        status: ServerStatus,
        error_message: Optional[str] = None
    ) -> bool:
        """更新服务器状态。"""
        if server_id not in self._servers:
            return False
        
        self._servers[server_id].status = status
        self._servers[server_id].error_message = error_message
        self._servers[server_id].updated_at = datetime.utcnow()
        return True
    
    async def update_server_info(
        self, 
        server_id: str, 
        **kwargs
    ) -> Optional[MCPServerInfo]:
        """更新服务器信息。"""
        if server_id not in self._servers:
            return None
        
        server = self._servers[server_id]
        
        for key, value in kwargs.items():
            if hasattr(server, key):
                setattr(server, key, value)
        
        server.updated_at = datetime.utcnow()
        return server
    
    async def server_exists(self, server_id: str) -> bool:
        """检查服务器是否存在。"""
        return server_id in self._servers
    
    async def clear_user_servers(self, user_id: str) -> int:
        """清除用户的所有服务器。"""
        async with self._lock:
            server_ids = self._user_servers.get(user_id, [])
            count = 0
            
            for server_id in server_ids:
                if server_id in self._servers:
                    del self._servers[server_id]
                    count += 1
            
            if user_id in self._user_servers:
                del self._user_servers[user_id]
            
            return count


service_registry = ServiceRegistry()
