# -*- coding: utf-8 -*-
"""
插件系统机制-__init__.py: 插件系统模块入口

@file __init__.py
@description 插件系统模块入口，统一导出各类插件
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是插件系统机制的入口，提供以下核心组件的统一导出：
- VectorMemoryPlugin: 向量记忆插件
- BlackholeMemoryPlugin: 黑洞记忆插件（无记忆）
- KnowledgeBaseRAGPlugin: 知识库RAG插件
- ToolkitExecutor: 工具执行器
- ToolResponse: 工具响应
- MCPClient: MCP客户端
- MCPServerConfig: MCP服务器配置
- MCPClientManager: MCP客户端管理器

依赖:
- .memory: 记忆插件模块
- .rag: RAG插件模块
- .tools: 工具插件模块
- .mcp: MCP插件模块
- .hooks: 钩子插件模块
- .plan: 计划插件模块

使用示例:
- from SoloAgent.plugins import VectorMemoryPlugin
- from SoloAgent.plugins import ToolkitExecutor, MCPClient
"""

from .memory import VectorMemoryPlugin, BlackholeMemoryPlugin
from .rag import KnowledgeBaseRAGPlugin
from .tools import ToolkitExecutor, ToolResponse
from .mcp import MCPClient, MCPServerConfig, MCPClientManager

__all__ = [
    "VectorMemoryPlugin",
    "BlackholeMemoryPlugin",
    "KnowledgeBaseRAGPlugin",
    "ToolkitExecutor",
    "ToolResponse",
    "MCPClient",
    "MCPServerConfig",
    "MCPClientManager",
]
