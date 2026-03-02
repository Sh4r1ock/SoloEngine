# -*- coding: utf-8 -*-
"""
SoloEngine: A plugin-based architecture for ReAct agents.

@file __init__.py
@description SoloAgent 主模块入口
@author SoloEngine Team
@date 2026-02-20

功能描述：
本模块提供 SoloAgent 的核心功能导出，包括：
- ReAct 核心引擎
- 插件系统
- 工具模块
- 模型接口
- 消息处理

使用示例：
    from SoloAgent import ReActCore
    from SoloAgent.plugins.tools import Read, Write, RunCommand, ToolkitExecutor
"""

__version__ = "0.1.0"

from .core import ReActCore, IToolExecutor, IMemory, IRAG, IMCPClient, IPlanNotebook, ITTSModel
from .plugins.tools import (
    Read,
    Write,
    SearchReplace,
    DeleteFile,
    LS,
    SearchCodebase,
    Grep,
    Glob,
    Task,
    Skill,
    RunCommand,
    CheckCommandStatus,
    StopCommand,
    GetDiagnostics,
    WebSearch,
    WebFetch,
    TodoWrite,
    AskUserQuestion,
    ExitPlanMode,
    OpenPreview,
)

__all__ = [
    "__version__",
    "ReActCore",
    "IToolExecutor",
    "IMemory",
    "IRAG",
    "IMCPClient",
    "IPlanNotebook",
    "ITTSModel",
    "Read",
    "Write",
    "SearchReplace",
    "DeleteFile",
    "LS",
    "SearchCodebase",
    "Grep",
    "Glob",
    "Task",
    "Skill",
    "RunCommand",
    "CheckCommandStatus",
    "StopCommand",
    "GetDiagnostics",
    "WebSearch",
    "WebFetch",
    "TodoWrite",
    "AskUserQuestion",
    "ExitPlanMode",
    "OpenPreview",
]
