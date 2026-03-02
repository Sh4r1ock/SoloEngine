# -*- coding: utf-8 -*-
"""
Tool plugins for SoloEngine.

整合后的工具目录结构：
- toolkit_executor.py: 核心工具执行器
- agent/: Agent 相关工具 (Skill, Task)
- command/: 命令执行工具
- file/: 文件操作工具
- network/: 网络工具
- other/: 其他工具
- search/: 搜索工具
- task/: 任务管理工具
"""

from .toolkit_executor import ToolkitExecutor, ToolResponse

from .agent import Skill, Task
from .command import RunCommand, CheckCommandStatus, StopCommand, GetDiagnostics
from .file import Read, Write, DeleteFile, LS, SearchReplace
from .network import WebSearch, WebFetch
from .other import ExitPlanMode, OpenPreview
from .search import SearchCodebase, Grep, Glob
from .task import TodoWrite, AskUserQuestion

__all__ = [
    "ToolkitExecutor",
    "ToolResponse",
    "Skill",
    "Task",
    "RunCommand",
    "CheckCommandStatus",
    "StopCommand",
    "GetDiagnostics",
    "Read",
    "Write",
    "DeleteFile",
    "LS",
    "SearchReplace",
    "WebSearch",
    "WebFetch",
    "ExitPlanMode",
    "OpenPreview",
    "SearchCodebase",
    "Grep",
    "Glob",
    "TodoWrite",
    "AskUserQuestion",
]
