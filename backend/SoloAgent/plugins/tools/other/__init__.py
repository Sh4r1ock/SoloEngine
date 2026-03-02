# -*- coding: utf-8 -*-
"""
其他工具模块。

@file __init__.py
@description 提供其他辅助工具的统一导出
@author SoloEngine Team
@date 2026-03-02

功能描述：
- ExitPlanMode: 退出计划模式工具
- OpenPreview: 打开预览工具
- BaseOtherTool: 其他工具基类
- OtherToolError: 其他工具错误类

工具类型：
    ExitPlanMode工具：
        - 用户批准后退出计划模式
        - 无需参数
        - 返回动作状态
    
    OpenPreview工具：
        - 向用户展示预览URL
        - 支持command_id和preview_url参数
        - 返回动作状态和预览详情

使用示例：
    from SoloAgent.tools.other import ExitPlanMode, OpenPreview
    from SoloAgent.tools.other import ExitPlanModeTool, OpenPreviewTool
    from SoloAgent.tools.other import exit_plan_mode_function, open_preview_function

状态: ✅ 模块初始化完成
"""

from .base import (
    OtherToolError,
    BaseOtherTool,
    ToolAction,
)

from .exit_plan_mode import (
    ExitPlanModeTool,
    exit_plan_mode_function,
    get_exit_plan_mode_tool_spec,
)

from .open_preview import (
    OpenPreviewTool,
    open_preview_function,
    get_open_preview_tool_spec,
)


ExitPlanMode = ExitPlanModeTool
OpenPreview = OpenPreviewTool

__all__ = [
    "ExitPlanMode",
    "OpenPreview",
    "ExitPlanModeTool",
    "OpenPreviewTool",
    "BaseOtherTool",
    "OtherToolError",
    "ToolAction",
    "exit_plan_mode_function",
    "open_preview_function",
    "get_exit_plan_mode_tool_spec",
    "get_open_preview_tool_spec",
]
