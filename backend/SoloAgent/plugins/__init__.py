# -*- coding: utf-8 -*-
"""
插件系统机制-__init__.py: 插件系统模块入口

@file __init__.py
@description 插件系统模块入口，统一导出各类插件
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是插件系统机制的入口，提供以下核心组件的统一导出：
- ToolkitExecutor: 工具执行器
- ToolResponse: 工具响应
- MCPClient: MCP客户端
- MCPServerConfig: MCP服务器配置

依赖:
- .tools: 工具插件模块
- .mcp: MCP插件模块
- .plan: 计划插件模块

使用示例:
- from SoloAgent.plugins import ToolkitExecutor, MCPClient
"""

from .tools import ToolkitExecutor, ToolResponse
from .mcp import MCPClient, MCPServerConfig

__all__ = [
    "ToolkitExecutor",
    "ToolResponse",
    "MCPClient",
    "MCPServerConfig",
]
