"""
SoloAgent 模块
简洁的 Agent 基础类和 AgenticFlow 编译器
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
