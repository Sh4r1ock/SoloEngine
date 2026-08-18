# -*- coding: utf-8 -*-
"""
SoloEngine : MCP Server 客户端连接配置构建（核心层）

@file mcp_config.py
@description 将 MCP Server 数据库模型序列化为客户端连接配置（transport/command/
             args/env/url/headers/timeout）。纯函数，无任何 API 层 / 前端依赖。

架构分层（对齐 06-architecture.md）：
- 核心层（本模块）：配置构建，供编译器层（MCPHostClientManager）与 API 层
  （mcp_servers 路由）共同使用——核心层不反向依赖 API 层。
"""

from typing import Any, Dict


def build_mcp_config(server) -> dict:
    """将 MCP Server 模型构建为客户端连接配置。

    Args:
        server: MCPServerModel 实例（含 transport_type 与对应传输配置关系）。

    Returns:
        dict: 客户端连接配置（transport 必含，其余按传输类型附带）。
    """
    if server.transport_type == "stdio" and server.stdio_config:
        return {"transport": server.transport_type, "command": server.stdio_config.command, "args": server.stdio_config.args, "env": server.stdio_config.env}
    elif server.transport_type == "http" and server.http_config:
        return {"transport": server.transport_type, "url": server.http_config.url, "headers": server.http_config.headers, "timeout": server.http_config.timeout}
    elif server.transport_type == "sse" and server.sse_config:
        return {"transport": server.transport_type, "url": server.sse_config.url, "headers": server.sse_config.headers, "timeout": server.sse_config.timeout}
    return {"transport": server.transport_type}
