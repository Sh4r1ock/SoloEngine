# -*- coding: utf-8 -*-
"""
MCP Client 模块 - 适配器层。

MCP Client是适配器，负责：
- 建立连接（与Server建立1:1连接）
- 协议处理（握手、消息格式转换、能力协商）
- 工具调用（发送请求、接收响应）
- 统一接口（让不同类型的Server对外表现一致）

支持三种传输类型：
- stdio: 标准输入/输出，适用于本地进程
- sse: Server-Sent Events，适用于远程服务
- http: Streamable HTTP，适用于远程服务
"""

from .base import BaseClient
from .stdio_client import StdioClient
from .sse_client import SSEClient
from .http_client import HTTPClient
from .factory import ClientFactory

__all__ = [
    "BaseClient",
    "StdioClient",
    "SSEClient",
    "HTTPClient",
    "ClientFactory",
]
