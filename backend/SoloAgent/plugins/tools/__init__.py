# -*- coding: utf-8 -*-
"""
SoloEngine : 工具系统模块入口，统一导出各类工具

@file __init__.py
@description 工具系统模块入口，统一导出各类工具
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是工具系统机制的入口，提供以下核心组件的统一导出：
    - ToolkitExecutor: 工具执行器
    - ToolResponse: 工具响应
    - Skill: Skill工具
    - Task: Task工具
    - RunCommand: 运行命令工具
    - CheckCommandStatus: 检查命令状态工具
    - StopCommand: 停止命令工具
    - GetDiagnostics: 获取诊断工具
    - Read: 文件读取工具
    - Write: 文件写入工具
    - DeleteFile: 文件删除工具
    - LS: 目录列表工具
    - SearchReplace: 搜索替换工具
    - WebSearch: 网络搜索工具
    - WebFetch: 网页获取工具
    - ExitPlanMode: 退出计划模式工具
    - OpenPreview: 打开预览工具
    - SearchCodebase: 代码库搜索工具
    - Grep: 文本搜索工具
    - Glob: 文件匹配工具
    - TodoWrite: 待办事项工具
    - AskUserQuestion: 询问用户工具

工具分类：
    - agent/: Agent相关工具 (Skill, Task)
    - command/: 命令执行工具
    - file/: 文件操作工具
    - network/: 网络工具
    - other/: 其他工具
    - search/: 搜索工具
    - task/: 任务管理工具

依赖:
    - .toolkit_executor: 工具执行器
    - .agent: Agent工具
    - .command: 命令工具
    - .file: 文件工具
    - .network: 网络工具
    - .other: 其他工具
    - .search: 搜索工具
    - .task: 任务工具

使用示例:
    - from SoloAgent.plugins.tools import ToolkitExecutor
    - from SoloAgent.plugins.tools import Read, Write, RunCommand
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
