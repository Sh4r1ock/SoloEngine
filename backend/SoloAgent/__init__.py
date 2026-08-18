# -*- coding: utf-8 -*-
"""
SoloEngine : SoloAgent主模块入口，提供核心功能导出

@file __init__.py
@description SoloAgent主模块入口，统一导出ReAct核心引擎、插件系统和工具模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是SoloAgent的主入口，提供以下核心功能的统一导出：
    - ReAct核心引擎: ReActCore，实现推理-行动循环
    - 插件系统接口: IMemory, IRAG, IToolExecutor等
    - 工具模块: Read, Write, RunCommand等内置工具
    - 模型接口: 各类模型基类和实现
    - 消息处理: 消息类型定义和处理

依赖:
    - .core: 核心引擎和插件接口定义
    - .plugins.tools: 内置工具模块集合

使用示例:
    - from SoloAgent import ReActCore
    - from SoloAgent.plugins.tools import Read, Write, RunCommand, ToolkitExecutor
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
    EnterPlanMode,
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
    "EnterPlanMode",
    "ExitPlanMode",
    "OpenPreview",
]
