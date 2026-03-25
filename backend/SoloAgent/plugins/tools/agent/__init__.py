# -*- coding: utf-8 -*-
"""
Agent工具模块。

@file __init__.py
@description 提供Agent相关工具的统一导出
@author SoloEngine Team
@date 2026-03-02

功能描述：
- Task: 任务执行工具，启动SubAgent处理任务
- Skill: 技能调用工具，在主对话中执行技能
- BaseAgentTool: Agent工具基类
- AgentToolError: Agent工具错误类

工具类型：
    Task工具：
        - 启动专门的SubAgent处理特定任务
        - 支持search和general_purpose_task两种类型
        - SubAgent拥有隔离的上下文
    
    Skill工具：
        - 在主对话中执行技能
        - 支持渐进式披露机制
        - 注入技能上下文和权限控制

使用示例：
    from SoloAgent.tools.agent import Task, Skill
    from SoloAgent.tools.agent import TaskTool, SkillTool
    from SoloAgent.tools.agent import task_tool_function, skill_tool_function

状态: ✅ 模块初始化完成
"""

from .base import (
    AgentToolError,
    BaseAgentTool,
    ToolContext,
    ToolPermission,
)

from .task import (
    TaskTool,
    SubAgentConfig,
    SubAgentType,
    ResponseLanguage,
    task_tool_function,
    get_task_tool_spec,
)

from .skill import (
    SkillTool,
    SkillContext,
    skill_tool_function,
    get_skill_tool_spec,
)


Task = TaskTool
Skill = SkillTool

__all__ = [
    "Task",
    "Skill",
    "TaskTool",
    "SkillTool",
    "BaseAgentTool",
    "AgentToolError",
    "ToolContext",
    "ToolPermission",
    "SubAgentConfig",
    "SubAgentType",
    "ResponseLanguage",
    "SkillContext",
    "task_tool_function",
    "skill_tool_function",
    "get_task_tool_spec",
    "get_skill_tool_spec",
]
