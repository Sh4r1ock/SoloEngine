# -*- coding: utf-8 -*-
"""
SoloEngine : MCP客户端，实现Model Context Protocol

@file mcp_client.py
@description 使用官方MCP Python SDK实现的客户端，支持多种传输协议
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供MCP客户端实现，包括：
    - MCPClient: MCP客户端，实现Model Context Protocol
    - MCPServerConfig: MCP服务器配置
    - MCPClientManager: MCP客户端管理器
    - 支持stdio、SSE和Streamable HTTP传输协议
    - 支持工具调用、资源读取、提示词获取

MCP协议说明：
MCP (Model Context Protocol) 是模型上下文协议，用于标准化
AI模型与外部工具、数据源之间的通信。

依赖:
    - asyncio: 异步IO
    - json: JSON处理
    - uuid: UUID生成
    - os: 操作系统接口
    - sys: 系统接口
    - logging: 日志记录
    - typing: 类型提示
    - dataclasses: 数据类
    - contextlib: 上下文管理器
    - mcp: 官方MCP Python SDK

使用示例:
    - from SoloAgent.plugins.mcp import MCPClient
    - client = MCPClient(config={"transport": "stdio", "command": "..."})
    - await client.connect()
    - tools = await client.get_tools()
    - result = await client.call_tool("tool_name", {"arg": "value"})
"""

import asyncio
import json
import uuid
import os
import sys
import logging
from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass
from contextlib import asynccontextmanager

from ...core.interfaces import IMCPClient

logger = logging.getLogger(__name__)


@dataclass
class MCPServerConfig:
    """
    MCP服务器配置数据类

    职责:
        - 存储MCP服务器的配置信息
        - 支持多种传输协议配置
        - 管理服务器连接参数

    属性:
        id: 服务器唯一标识
        name: 服务器名称
        transport: 传输类型（stdio/sse/http）
        url: 服务器URL（sse/http使用）
        headers: HTTP请求头
        timeout: 超时时间（秒）
        enabled: 是否启用
        command: stdio命令
        args: stdio参数
        env: 环境变量

    示例:
        >>> config = MCPServerConfig(
        ...     id="github",
        ...     name="GitHub MCP",
        ...     transport="stdio",
        ...     command="npx",
        ...     args=["-y", "@modelcontextprotocol/server-github"]
        ... )
    """
    id: str
    name: str
    transport: str  # 'stdio', 'sse', or 'http'
    url: str
    headers: Optional[Dict[str, str]] = None
    timeout: int = 30
    enabled: bool = True
    command: Optional[str] = None
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None


class MCPClient(IMCPClient):
    """
    MCP客户端实现类

    职责:
        - 实现MCP协议客户端
        - 支持多种传输协议（stdio/sse/http）
        - 管理与服务器的连接
        - 提供工具调用、资源读取、提示词获取功能

    属性:
        config: 客户端配置
        _connected: 是否已连接
        _tools: 工具列表
        _resources: 资源列表
        _prompts: 提示词列表
        _session: MCP会话
        _session_context: 会话上下文
        _client_context: 客户端上下文

    示例:
        >>> client = MCPClient(config={
        ...     "transport": "stdio",
        ...     "command": "npx",
        ...     "args": ["-y", "@modelcontextprotocol/server-github"]
        ... })
        >>> await client.connect()
        >>> tools = await client.get_tools()
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        """
        初始化MCP客户端

        Args:
            config: 配置字典，可包含:
                - transport: 传输类型 ('stdio', 'sse', 'http')
                - url: 服务器URL (sse/http)
                - command: stdio命令
                - args: stdio参数
                - env: 环境变量
                - headers: HTTP头
                - timeout: 超时时间（秒）

        示例:
            >>> client = MCPClient({"transport": "stdio", "command": "..."})
        """
        self.config = config or {}
        self._connected = False
        self._tools: List[Dict[str, Any]] = []
        self._resources: List[Dict[str, Any]] = []
        self._prompts: List[Dict[str, Any]] = []
        self._session: Optional[Any] = None
        self._session_context: Optional[Any] = None
        self._client_context: Optional[Any] = None

    async def connect(self) -> None:
        """连接到 MCP 服务器。"""
        if self._connected:
            return

        transport = self.config.get("transport", "stdio")

        try:
            if transport == "stdio":
                await self._connect_stdio()
            elif transport == "sse":
                await self._connect_sse()
            elif transport == "http":
                await self._connect_http()
            else:
                raise ValueError(f"Unsupported transport: {transport}")

            self._connected = True
            logger.info(f"MCP client connected via {transport}")

        except ImportError as e:
            logger.error(f"MCP SDK not installed: {e}")
            raise ImportError(
                "MCP SDK is required. Install with: pip install mcp"
            )
        except Exception as e:
            logger.error(f"Failed to connect MCP client: {e}")
            raise

    async def _connect_stdio(self) -> None:
        """通过 stdio 连接 MCP 服务器。"""
        from mcp import ClientSession
        from mcp.client.stdio import stdio_client, StdioServerParameters

        command = self.config.get("command")
        if not command:
            raise ValueError("stdio transport requires 'command' config")

        args = self.config.get("args") or []
        env = self.config.get("env") or {}
        
        process_env = os.environ.copy()
        process_env.update(env)

        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=process_env,
        )

        self._client_context = stdio_client(server_params)
        read_stream, write_stream = await self._client_context.__aenter__()
        
        self._session = ClientSession(read_stream, write_stream)
        await self._session.__aenter__()
        await self._session.initialize()

        await self._load_capabilities()

    async def _connect_sse(self) -> None:
        """通过 SSE 连接 MCP 服务器。"""
        from mcp import ClientSession
        from mcp.client.sse import sse_client

        url = self.config.get("url")
        if not url:
            raise ValueError("sse transport requires 'url' config")

        headers = self.config.get("headers", {})

        self._client_context = sse_client(url, headers=headers)
        read_stream, write_stream = await self._client_context.__aenter__()
        
        self._session = ClientSession(read_stream, write_stream)
        await self._session.__aenter__()
        await self._session.initialize()

        await self._load_capabilities()

    async def _connect_http(self) -> None:
        """通过 Streamable HTTP 连接 MCP 服务器。"""
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client
        import httpx

        url = self.config.get("url")
        if not url:
            raise ValueError("http transport requires 'url' config")

        headers = self.config.get("headers", {})

        try:
            self._client_context = streamablehttp_client(url, headers=headers)
            read_stream, write_stream, _ = await self._client_context.__aenter__()
            
            self._session = ClientSession(read_stream, write_stream)
            await self._session.__aenter__()
            await self._session.initialize()

            await self._load_capabilities()
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error connecting to MCP server: {e}")
            raise ConnectionError(f"Failed to connect to MCP server: HTTP {e.response.status_code}")
        except Exception as e:
            logger.error(f"Error connecting to MCP server: {e}")
            raise ConnectionError(f"Failed to connect to MCP server: {str(e)}")

    async def _load_capabilities(self) -> None:
        """加载服务器的工具、资源和提示词。"""
        try:
            tools_result = await self._session.list_tools()
            self._tools = [
                {
                    "name": tool.name,
                    "description": tool.description or "",
                    "inputSchema": tool.inputSchema,
                }
                for tool in tools_result.tools
            ]

            try:
                resources_result = await self._session.list_resources()
                self._resources = [
                    {
                        "uri": resource.uri,
                        "name": resource.name,
                        "description": getattr(resource, "description", ""),
                        "mimeType": getattr(resource, "mimeType", None),
                    }
                    for resource in resources_result.resources
                ]
            except Exception as e:
                logger.warning(f"Server does not support resources: {e}")
                self._resources = []

            try:
                prompts_result = await self._session.list_prompts()
                self._prompts = [
                    {
                        "name": prompt.name,
                        "description": prompt.description or "",
                        "arguments": [
                            {
                                "name": arg.name,
                                "description": getattr(arg, "description", ""),
                                "required": getattr(arg, "required", False),
                            }
                            for arg in (prompt.arguments or [])
                        ],
                    }
                    for prompt in prompts_result.prompts
                ]
            except Exception as e:
                logger.warning(f"Server does not support prompts: {e}")
                self._prompts = []

            logger.info(
                f"MCP client initialized: {len(self._tools)} tools, "
                f"{len(self._resources)} resources, {len(self._prompts)} prompts"
            )

        except Exception as e:
            logger.error(f"Failed to load capabilities: {e}")
            raise

    async def disconnect(self) -> None:
        """断开与 MCP 服务器的连接。"""
        if not self._connected:
            return

        try:
            if self._session:
                await self._session.__aexit__(None, None, None)
                self._session = None

            if self._client_context:
                await self._client_context.__aexit__(None, None, None)
                self._client_context = None

        except Exception as e:
            logger.error(f"Error during disconnect: {e}")
        finally:
            self._connected = False
            self._tools = []
            self._resources = []
            self._prompts = []

    async def get_tools(self) -> List[Dict[str, Any]]:
        """获取 MCP 服务器的工具列表。"""
        if not self._connected:
            await self.connect()
        return self._tools

    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """调用 MCP 服务器上的工具。

        Args:
            tool_name: 工具名称
            arguments: 工具参数

        Returns:
            工具执行结果
        """
        if not self._connected:
            await self.connect()

        try:
            result = await self._session.call_tool(tool_name, arguments)

            content = []
            if hasattr(result, "content"):
                for item in result.content:
                    if hasattr(item, "type"):
                        if item.type == "text":
                            content.append({
                                "type": "text",
                                "text": item.text,
                            })
                        elif item.type == "image":
                            content.append({
                                "type": "image",
                                "data": item.data,
                                "mimeType": item.mimeType,
                            })
                        else:
                            content.append({"type": item.type})

            return {
                "success": not result.isError if hasattr(result, "isError") else True,
                "content": content,
                "is_error": result.isError if hasattr(result, "isError") else False,
            }

        except Exception as e:
            logger.error(f"Error calling tool '{tool_name}': {e}")
            return {
                "success": False,
                "error_message": str(e),
                "content": [],
            }

    async def get_resources(self) -> List[Dict[str, Any]]:
        """获取 MCP 服务器的资源列表。"""
        if not self._connected:
            await self.connect()
        return self._resources

    async def read_resource(self, uri: str) -> Dict[str, Any]:
        """读取 MCP 服务器的资源。

        Args:
            uri: 资源 URI

        Returns:
            资源内容
        """
        if not self._connected:
            await self.connect()

        try:
            result = await self._session.read_resource(uri)

            contents = []
            if hasattr(result, "contents"):
                for item in result.contents:
                    content_item = {
                        "uri": item.uri,
                    }
                    if hasattr(item, "mimeType"):
                        content_item["mimeType"] = item.mimeType
                    if hasattr(item, "text"):
                        content_item["text"] = item.text
                    if hasattr(item, "blob"):
                        content_item["blob"] = item.blob
                    contents.append(content_item)

            return {
                "success": True,
                "contents": contents,
            }

        except Exception as e:
            logger.error(f"Error reading resource '{uri}': {e}")
            return {
                "success": False,
                "error_message": str(e),
            }

    async def get_prompts(self) -> List[Dict[str, Any]]:
        """获取 MCP 服务器的提示词列表。"""
        if not self._connected:
            await self.connect()
        return self._prompts

    async def get_prompt(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """获取 MCP 服务器的提示词。

        Args:
            name: 提示词名称
            arguments: 提示词参数

        Returns:
            提示词内容
        """
        if not self._connected:
            await self.connect()

        try:
            result = await self._session.get_prompt(name, arguments or {})

            messages = []
            if hasattr(result, "messages"):
                for msg in result.messages:
                    message_item = {
                        "role": msg.role,
                    }
                    if hasattr(msg, "content"):
                        if hasattr(msg.content, "type"):
                            if msg.content.type == "text":
                                message_item["content"] = {
                                    "type": "text",
                                    "text": msg.content.text,
                                }
                            elif msg.content.type == "image":
                                message_item["content"] = {
                                    "type": "image",
                                    "data": msg.content.data,
                                    "mimeType": msg.content.mimeType,
                                }
                            else:
                                message_item["content"] = {"type": msg.content.type}
                    messages.append(message_item)

            return {
                "success": True,
                "messages": messages,
                "description": getattr(result, "description", None),
            }

        except Exception as e:
            logger.error(f"Error getting prompt '{name}': {e}")
            return {
                "success": False,
                "error_message": str(e),
            }


class MCPClientManager:
    """
    MCP客户端管理器

    职责:
        - 管理多个MCP服务器连接
        - 统一获取所有服务器的工具
        - 路由工具调用到对应服务器
        - 管理服务器生命周期

    属性:
        _clients: 客户端字典 {server_id: MCPClient}
        _servers: 服务器配置字典 {server_id: MCPServerConfig}

    示例:
        >>> manager = MCPClientManager()
        >>> await manager.add_server(config)
        >>> all_tools = await manager.get_all_tools()
        >>> result = await manager.call_tool("server_id", "tool_name", {})
    """

    def __init__(self):
        """初始化MCP客户端管理器。"""
        self._clients: Dict[str, MCPClient] = {}
        self._servers: Dict[str, MCPServerConfig] = {}

    async def add_server(self, server_config: MCPServerConfig) -> None:
        """添加 MCP 服务器。"""
        self._servers[server_config.id] = server_config

        if server_config.enabled:
            client = MCPClient({
                "transport": server_config.transport,
                "url": server_config.url,
                "command": server_config.command,
                "args": server_config.args,
                "env": server_config.env,
                "headers": server_config.headers,
                "timeout": server_config.timeout,
            })
            await client.connect()
            self._clients[server_config.id] = client

    async def remove_server(self, server_id: str) -> None:
        """移除 MCP 服务器。"""
        if server_id in self._clients:
            await self._clients[server_id].disconnect()
            del self._clients[server_id]

        if server_id in self._servers:
            del self._servers[server_id]

    async def get_all_tools(self) -> List[Dict[str, Any]]:
        """获取所有服务器的工具。"""
        all_tools = []
        for server_id, client in self._clients.items():
            server = self._servers.get(server_id)
            tools = await client.get_tools()
            for tool in tools:
                tool["_server_id"] = server_id
                tool["_server_name"] = server.name if server else server_id
            all_tools.extend(tools)
        return all_tools

    async def call_tool(
        self,
        server_id: str,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """调用指定服务器的工具。"""
        client = self._clients.get(server_id)
        if not client:
            raise ValueError(f"Server '{server_id}' not connected")
        return await client.call_tool(tool_name, arguments)

    async def disconnect_all(self) -> None:
        """断开所有连接。"""
        for client in self._clients.values():
            await client.disconnect()
        self._clients.clear()
