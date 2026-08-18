# -*- coding: utf-8 -*-
"""
SoloEngine : 其他工具模块，提供其他辅助工具

@file __init__.py
@description 提供其他辅助工具的统一导出
@author Sh4rlock
@date 2026-04-09

功能描述：
- EnterPlanMode: 进入计划模式工具
- ExitPlanMode: 退出计划模式工具
- OpenPreview: 打开预览工具
- BaseOtherTool: 其他工具基类
- OtherToolError: 其他工具错误类

工具类型：
    EnterPlanMode工具：
        - 请求进入计划模式（需用户批准）
        - 进入后处于只读模式

    ExitPlanMode工具：
        - 用户批准后退出计划模式
        - 无需参数
        - 返回动作状态
    
    OpenPreview工具：
        - 向用户展示预览URL
        - 支持command_id和preview_url参数
        - 返回动作状态和预览详情

使用示例：
    from SoloAgent.tools.other import EnterPlanMode, ExitPlanMode, OpenPreview
    from SoloAgent.tools.other import EnterPlanModeTool, ExitPlanModeTool, OpenPreviewTool
    from SoloAgent.tools.other import enter_plan_mode_function, exit_plan_mode_function, open_preview_function

状态: ✅ 模块初始化完成
"""

from .base import (
    OtherToolError,
    BaseOtherTool,
    ToolAction,
)

from .enter_plan_mode import EnterPlanModeTool

from .exit_plan_mode import ExitPlanModeTool

from .open_preview import OpenPreviewTool


EnterPlanMode = EnterPlanModeTool
ExitPlanMode = ExitPlanModeTool
OpenPreview = OpenPreviewTool

__all__ = [
    "EnterPlanMode",
    "ExitPlanMode",
    "OpenPreview",
    "EnterPlanModeTool",
    "ExitPlanModeTool",
    "OpenPreviewTool",
    "BaseOtherTool",
    "OtherToolError",
    "ToolAction",
]
