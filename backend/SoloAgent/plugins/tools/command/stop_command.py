# -*- coding: utf-8 -*-
"""
停止命令工具模块。

@file stop_command.py
@description 停止运行中的命令
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 终止运行中的命令
- 优雅关闭（先 terminate，后 kill）
- 支持强制终止

终止流程：
    1. 检查命令是否存在且正在运行
    2. 发送 terminate 信号（SIGTERM）
    3. 等待进程结束
    4. 如果进程未结束，发送 kill 信号（SIGKILL）

使用场景：
    - 停止长时间运行的命令
    - 终止卡住的进程
    - 取消正在执行的任务

状态: ✅ 模块初始化完成
"""

import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Dict, Any

from .base import (
    BaseCommandTool,
    CommandState,
    CommandNotFoundError,
    CommandToolError,
)
from app.core.config import settings


class StopCommand(BaseCommandTool):
    """
    停止命令工具。
    
    终止运行中的命令进程。
    
    终止策略：
        1. 优雅终止：发送 terminate 信号
        2. 强制终止：如果优雅终止失败，发送 kill 信号
    
    注意事项：
        - 只能终止正在运行的命令
        - 已完成或已停止的命令无法再次停止
        - 终止后命令状态变为 stopped
    
    Example:
        >>> result = await StopCommand.execute(
        ...     command_id="cmd_20260302_abc123"
        ... )
        >>> print(result["success"])  # True
    """
    
    TERMINATE_TIMEOUT_SECONDS = 5
    
    @classmethod
    async def execute(
        cls,
        command_id: str,
    ) -> Dict[str, Any]:
        """
        停止运行中的命令。
        
        Args:
            command_id (str): 命令 ID。
                要停止的命令的唯一标识符。
        
        Returns:
            Dict[str, Any]: 执行结果。
                - success (bool): 是否成功停止
                - message (str): 结果消息
                - status (str): 命令最终状态
                - command_id (str): 命令 ID
        
        Raises:
            CommandNotFoundError: 当命令 ID 不存在时抛出。
            CommandToolError: 当命令无法停止时抛出。
        
        Example:
            >>> result = await StopCommand.execute(
            ...     command_id="cmd_20260302_abc123"
            ... )
            >>> if result["success"]:
            ...     print("命令已停止")
        """
        if not command_id:
            raise CommandToolError("command_id 不能为空")
        
        cmd_info = cls._registry.get(command_id)
        if not cmd_info:
            raise CommandNotFoundError(f"命令不存在: {command_id}", command_id=command_id)
        
        if cmd_info.state != CommandState.RUNNING:
            return {
                "content": f"Not running (status: {cmd_info.state.value})",
                "success": False,
                "error_message": f"Command is not running (status: {cmd_info.state.value})",
                "status": cmd_info.state.value,
                "command_id": command_id,
                "metadata": {}
            }
        
        process = cmd_info.process
        if not process:
            cmd_info.state = CommandState.STOPPED
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            return {
                "content": "Stopped (no process)",
                "success": True,
                "error_message": None,
                "status": cmd_info.state.value,
                "command_id": command_id,
                "metadata": {}
            }
        
        try:
            process.terminate()
            
            try:
                await asyncio.wait_for(
                    process.wait(),
                    timeout=cls.TERMINATE_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
            
            cmd_info.state = CommandState.STOPPED
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            cmd_info.exit_code = process.returncode

            return {
                "content": "Stopped",
                "success": True,
                "error_message": None,
                "status": cmd_info.state.value,
                "command_id": command_id,
                "exit_code": cmd_info.exit_code,
                "metadata": {}
            }
            
        except ProcessLookupError:
            cmd_info.state = CommandState.STOPPED
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            return {
                "content": "Stopped (process already ended)",
                "success": True,
                "error_message": None,
                "status": cmd_info.state.value,
                "command_id": command_id,
                "metadata": {}
            }
        except Exception as e:
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            cmd_info.stderr_buffer = str(e)
            raise CommandToolError(f"停止命令失败: {e}", command_id=command_id)
    
    @staticmethod
    def get_tool_spec() -> Dict[str, Any]:
        """
        获取工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范字典，用于注册到工具执行器。
        """
        return {
            "name": "StopCommand",
            "description": "停止运行中的命令。先尝试优雅终止，失败后强制终止。",
            "parameters": {
                "type": "object",
                "properties": {
                    "command_id": {
                        "type": "string",
                        "description": "要停止的命令 ID",
                    },
                },
                "required": ["command_id"],
            },
        }
