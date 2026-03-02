# -*- coding: utf-8 -*-
"""
任务管理工具模块。

@file __init__.py
@description 提供任务管理相关工具的统一导出
@author SoloEngine Team
@date 2026-03-02

功能描述：
- TodoWrite: 任务列表管理
- AskUserQuestion: 向用户提问
- BaseTaskTool: 任务工具基类
- TaskToolError: 任务工具错误类

状态: ✅ 模块初始化完成
"""

from .base import (
    BaseTaskTool,
    TaskToolError,
    TaskStatus,
    TaskPriority,
)

from .todo_write import (
    TodoWrite,
    todo_write,
    get_todo_write_tool_spec,
)

from .ask_user_question import (
    AskUserQuestion,
    ask_user_question,
    get_ask_user_question_tool_spec,
)

__all__ = [
    "BaseTaskTool",
    "TaskToolError",
    "TaskStatus",
    "TaskPriority",
    "TodoWrite",
    "todo_write",
    "get_todo_write_tool_spec",
    "AskUserQuestion",
    "ask_user_question",
    "get_ask_user_question_tool_spec",
]
