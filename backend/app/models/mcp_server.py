# -*- coding: utf-8 -*-
"""
SoloEngine : MCP服务器数据模型模块

@file mcp_server.py
@description MCP服务器数据模型定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义MCP服务器相关的数据模型，包括：
    - MCP传输类型枚举
    - MCP服务器状态枚举
    - MCP工具定义
    - MCP资源定义
    - MCP服务器配置

依赖:
    - typing: 类型注解支持
    - dataclasses: 数据类支持
    - datetime: 日期时间处理
    - enum: 枚举类型支持

使用示例:
    - from app.models.mcp_server import MCPServer, MCPTransportType
    - server = MCPServer(id="1", name="my_server", transport_type=MCPTransportType.HTTP)
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class MCPTransportType(Enum):
    """MCP 传输类型。"""
    HTTP = "http"
    WEBSOCKET = "websocket"
    STDIO = "stdio"
    SSE = "sse"


class MCPServerStatus(Enum):
    """MCP 服务器状态。"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class MCPTool:
    """MCP 工具定义。"""
    name: str
    description: str
    input_schema: Dict[str, Any]
    server_id: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "server_id": self.server_id,
        }


@dataclass
class MCPResource:
    """MCP 资源定义。"""
    uri: str
    name: str
    description: str = ""
    mime_type: str = ""
    server_id: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "uri": self.uri,
            "name": self.name,
            "description": self.description,
            "mime_type": self.mime_type,
            "server_id": self.server_id,
        }


@dataclass
class MCPPrompt:
    """MCP 提示词定义。"""
    name: str
    description: str
    arguments: List[Dict[str, Any]] = field(default_factory=list)
    server_id: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "arguments": self.arguments,
            "server_id": self.server_id,
        }


@dataclass
class MCPServerConfig:
    """MCP 服务器配置。"""
    id: str
    name: str
    transport: MCPTransportType
    url: str = ""
    command: str = ""
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    headers: Dict[str, str] = field(default_factory=dict)
    timeout: int = 30
    is_active: bool = True
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "transport": self.transport.value,
            "url": self.url,
            "command": self.command,
            "args": self.args,
            "env": self.env,
            "headers": self.headers,
            "timeout": self.timeout,
            "is_active": self.is_active,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MCPServerConfig":
        return cls(
            id=data["id"],
            name=data["name"],
            transport=MCPTransportType(data.get("transport", "http")),
            url=data.get("url", ""),
            command=data.get("command", ""),
            args=data.get("args", []),
            env=data.get("env", {}),
            headers=data.get("headers", {}),
            timeout=data.get("timeout", 30),
            is_active=data.get("is_active", True),
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
        )


@dataclass
class MCPServer:
    """MCP 服务器完整信息。"""
    config: MCPServerConfig
    status: MCPServerStatus = MCPServerStatus.DISCONNECTED
    tools: List[MCPTool] = field(default_factory=list)
    resources: List[MCPResource] = field(default_factory=list)
    prompts: List[MCPPrompt] = field(default_factory=list)
    error_message: str = ""
    last_connected: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "config": self.config.to_dict(),
            "status": self.status.value,
            "tools": [t.to_dict() for t in self.tools],
            "resources": [r.to_dict() for r in self.resources],
            "prompts": [p.to_dict() for p in self.prompts],
            "error_message": self.error_message,
            "last_connected": self.last_connected,
        }
