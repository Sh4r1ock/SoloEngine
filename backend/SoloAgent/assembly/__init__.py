# -*- coding: utf-8 -*-
"""
SoloEngine : Assembly层模块，提供Agent组装功能

@file __init__.py
@description Assembly层模块入口，统一导出组装相关类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是Assembly层的入口，提供以下核心组件的统一导出：
    - ReActAgent: ReAct Agent组装类
    - StandardAgent: 标准Agent预设
    - ReActWithRAG: 带RAG的ReAct Agent预设
    - SimpleAgent: 简单Agent预设
    - MultiMCPAgent: 多MCP Agent预设
    - PlanningAgent: 规划Agent预设

依赖:
    - .assembler: 组装器实现
    - .presets: 预设配置

使用示例:
    - from SoloAgent.assembly import StandardAgent
    - agent = StandardAgent(config)
"""

from .assembler import ReActAgent
from .presets import (
    StandardAgent,
    ReActWithRAG,
    SimpleAgent,
    MultiMCPAgent,
    PlanningAgent,
)

__all__ = [
    "ReActAgent",
    "StandardAgent",
    "ReActWithRAG",
    "SimpleAgent",
    "MultiMCPAgent",
    "PlanningAgent",
]
