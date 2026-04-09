# -*- coding: utf-8 -*-
"""
SoloEngine : 命令执行工具模块，提供命令执行相关功能

@file __init__.py
@description 提供命令执行相关工具的统一导出
@author Sh4rlock
@date 2026-04-09

功能描述：
- RunCommand: 执行终端命令
- CheckCommandStatus: 检查命令状态
- StopCommand: 停止运行中的命令
- GetDiagnostics: 获取语言诊断信息

工具分类：
    1. 命令执行
       - RunCommand: 执行终端命令，支持阻塞/非阻塞模式
       - CheckCommandStatus: 检查运行中命令的状态
       - StopCommand: 停止运行中的命令
    
    2. 诊断信息
       - GetDiagnostics: 获取 VS Code 语言诊断信息

使用示例：
    from SoloAgent.tools.command import RunCommand, CheckCommandStatus
    from SoloAgent.tools.command import StopCommand, GetDiagnostics
    
    # 执行命令
    result = await RunCommand.execute(
        command="npm run dev",
        blocking=False,
        command_type="web_server"
    )
    
    # 检查状态
    status = await CheckCommandStatus.execute(
        command_id=result["command_id"]
    )
    
    # 停止命令
    await StopCommand.execute(command_id=result["command_id"])
    
    # 获取诊断
    diagnostics = await GetDiagnostics.execute()

状态: ✅ 模块初始化完成
"""

from .base import (
    BaseCommandTool,
    CommandRegistry,
    CommandInfo,
    CommandState,
    CommandType,
    CommandToolError,
    CommandSecurityError,
    CommandNotFoundError,
    ALLOWED_COMMANDS,
    DANGEROUS_PATTERNS,
)

from .run_command import RunCommand
from .check_command_status import CheckCommandStatus
from .stop_command import StopCommand
from .get_diagnostics import GetDiagnostics, Diagnostic, DiagnosticSeverity

__all__ = [
    "BaseCommandTool",
    "CommandRegistry",
    "CommandInfo",
    "CommandState",
    "CommandType",
    "CommandToolError",
    "CommandSecurityError",
    "CommandNotFoundError",
    "ALLOWED_COMMANDS",
    "DANGEROUS_PATTERNS",
    "RunCommand",
    "CheckCommandStatus",
    "StopCommand",
    "GetDiagnostics",
    "Diagnostic",
    "DiagnosticSeverity",
]
