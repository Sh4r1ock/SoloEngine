# -*- coding: utf-8 -*-
"""
MCP系统机制-__init__.py: MCP系统模块入口

@file __init__.py
@description MCP系统模块入口，统一导出MCP相关类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是MCP系统机制的入口，提供以下核心组件的统一导出：
- MCPClient: MCP客户端，实现Model Context Protocol
- MCPServerConfig: MCP服务器配置
- MCPClientManager: MCP客户端管理器

MCP协议说明：
MCP (Model Context Protocol) 是模型上下文协议，用于标准化
AI模型与外部工具、数据源之间的通信。

依赖:
- .mcp_client: MCP客户端实现

使用示例:
- from SoloAgent.plugins.mcp import MCPClient
- from SoloAgent.plugins.mcp import MCPServerConfig, MCPClientManager
"""

from .mcp_client import MCPClient, MCPServerConfig, MCPClientManager

__all__ = ["MCPClient", "MCPServerConfig", "MCPClientManager"]
