# -*- coding: utf-8 -*-
"""
SoloEngine : 记忆插件模块

@file __init__.py
@description 记忆插件模块入口，统一导出记忆插件类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是记忆插件的入口，提供以下核心插件的统一导出：
    - VectorMemoryPlugin: 向量记忆插件
    - BlackholeMemoryPlugin: 黑洞记忆插件（无记忆功能）
    - DatabaseMemoryPlugin: 数据库记忆插件

依赖:
    - .vector_memory: 向量记忆
    - .blackhole_memory: 黑洞记忆
    - .database_memory: 数据库记忆

使用示例:
    - from SoloAgent.plugins.memory import VectorMemoryPlugin
    - memory = VectorMemoryPlugin(config)
"""

from .vector_memory import VectorMemoryPlugin, VectorMemoryConfig
from .blackhole_memory import BlackholeMemoryPlugin
from .database_memory import DatabaseMemoryPlugin

__all__ = [
    "VectorMemoryPlugin",
    "VectorMemoryConfig",
    "BlackholeMemoryPlugin",
    "DatabaseMemoryPlugin",
]
