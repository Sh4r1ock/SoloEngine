"""
SoloAgent机制-__init__.py: SoloAgent模块，简洁的Agent基础类和AgenticFlow编译器

@file __init__.py
@description SoloAgent模块入口，统一导出配置类、Agent基础类和工具注册表
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是SoloAgent机制的入口，提供以下核心组件的统一导出：
- SoloAgentConfig: 配置数据类，支持声明式配置
- SoloAgent: Agent基础类，基于ReActCore构建
- ConfigLoader: 配置加载器，从数据库/文件加载详细配置
- ToolRegistry: 工具注册表，管理所有可用工具

依赖:
- .config: SoloAgentConfig配置类定义
- .agent: SoloAgent基础类实现
- .loader: ConfigLoader配置加载器
- .tools: ToolRegistry工具注册表

使用示例:
- from SoloAgent.solo_agent import SoloAgent, SoloAgentConfig
- from SoloAgent.solo_agent import ConfigLoader, ToolRegistry
"""
from .config import SoloAgentConfig
from .agent import SoloAgent
from .loader import ConfigLoader
from .tools import ToolRegistry, register_all_tools

__all__ = [
    "SoloAgentConfig",
    "SoloAgent",
    "ConfigLoader",
    "ToolRegistry",
    "register_all_tools",
]
