# -*- coding: utf-8 -*-
"""
检查命令状态工具模块。

@file check_command_status.py
@description 检查运行中命令的状态
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 检查命令执行状态
- 获取命令输出（stdout/stderr）
- 支持输出过滤（正则表达式）
- 支持输出分页

状态类型：
    - pending: 命令尚未开始执行
    - running: 命令正在执行
    - done: 命令执行完成
    - error: 命令执行出错
    - stopped: 命令被停止

使用场景：
    - 查询长时间运行命令的状态
    - 获取命令执行结果
    - 监控服务器进程

状态: ✅ 模块初始化完成
"""

import re
from typing import Dict, Any, Optional

from .base import (
    BaseCommandTool,
    CommandInfo,
    CommandState,
    CommandNotFoundError,
    CommandToolError,
)


class CheckCommandStatus(BaseCommandTool):
    """
    检查命令状态工具。
    
    查询运行中命令的执行状态和输出。
    
    功能：
        1. 查询命令状态（running, done, error, stopped）
        2. 获取命令输出（stdout/stderr）
        3. 支持正则表达式过滤输出
        4. 支持输出分页
    
    输出分页：
        - output_character_count: 返回的字符数
        - skip_character_count: 跳过的字符数
        - output_priority: 输出优先级（top/bottom/split）
    
    Example:
        >>> result = await CheckCommandStatus.execute(
        ...     command_id="cmd_20260302_abc123"
        ... )
        >>> print(result["status"])  # "running" or "done"
        >>> print(result["stdout"])
    """
    
    DEFAULT_OUTPUT_CHARACTER_COUNT = 2000
    MAX_OUTPUT_CHARACTER_COUNT = 10000
    
    @classmethod
    async def execute(
        cls,
        command_id: str,
        filter: Optional[str] = None,
        output_character_count: int = DEFAULT_OUTPUT_CHARACTER_COUNT,
        output_priority: str = "bottom",
        skip_character_count: int = 0,
        wait_ms_before_check: int = 0,
    ) -> Dict[str, Any]:
        """
        检查命令状态。
        
        Args:
            command_id (str): 命令 ID。
                由 RunCommand 返回的唯一标识符。
            filter (Optional[str]): 输出过滤正则表达式。
                只返回匹配此正则表达式的行。
                默认为 None（不过滤）。
            output_character_count (int): 返回的字符数。
                限制返回的输出字符数量。
                默认为 2000。
            output_priority (str): 输出优先级。
                - "top": 从开头返回（最旧的输出）
                - "bottom": 从末尾返回（最新的输出）
                - "split": 同时返回开头和末尾
                默认为 "bottom"。
            skip_character_count (int): 跳过的字符数。
                在 output_priority 位置跳过指定数量的字符。
                默认为 0。
            wait_ms_before_check (int): 检查前等待时间（毫秒）。
                如果预期命令需要更长时间完成，可以设置等待时间。
                默认为 0。
        
        Returns:
            Dict[str, Any]: 命令状态信息。
                - status (str): 命令状态（running, done, error, stopped）
                - exit_code (Optional[int]): 退出码（仅 done/error 状态）
                - stdout (str): 标准输出
                - stderr (str): 标准错误
                - command (str): 执行的命令
                - command_type (str): 命令类型
        
        Raises:
            CommandNotFoundError: 当命令 ID 不存在时抛出。
            CommandToolError: 当参数无效时抛出。
        
        Example:
            >>> # 检查命令状态
            >>> result = await CheckCommandStatus.execute(
            ...     command_id="cmd_20260302_abc123"
            ... )
            >>> print(result["status"])
            
            >>> # 过滤输出
            >>> result = await CheckCommandStatus.execute(
            ...     command_id="cmd_20260302_abc123",
            ...     filter="error|warning"
            ... )
            
            >>> # 分页获取输出
            >>> result = await CheckCommandStatus.execute(
            ...     command_id="cmd_20260302_abc123",
            ...     output_character_count=1000,
            ...     skip_character_count=2000
            ... )
        """
        if not command_id:
            raise CommandToolError("command_id 不能为空")
        
        cmd_info = cls._registry.get(command_id)
        if not cmd_info:
            raise CommandNotFoundError(f"命令不存在: {command_id}", command_id=command_id)
        
        if wait_ms_before_check > 0:
            import asyncio
            await asyncio.sleep(wait_ms_before_check / 1000.0)
        
        output_character_count = min(
            max(output_character_count, 100),
            cls.MAX_OUTPUT_CHARACTER_COUNT
        )
        
        stdout = cmd_info.stdout_buffer
        stderr = cmd_info.stderr_buffer
        
        if filter:
            try:
                pattern = re.compile(filter, re.IGNORECASE)
                stdout_lines = stdout.split('\n')
                stderr_lines = stderr.split('\n')
                stdout = '\n'.join(line for line in stdout_lines if pattern.search(line))
                stderr = '\n'.join(line for line in stderr_lines if pattern.search(line))
            except re.error as e:
                raise CommandToolError(f"无效的正则表达式: {e}")
        
        stdout_paginated = cls._paginate_output(
            output=stdout,
            character_count=output_character_count,
            priority=output_priority,
            skip_count=skip_character_count,
        )
        stderr_paginated = cls._paginate_output(
            output=stderr,
            character_count=output_character_count,
            priority=output_priority,
            skip_count=skip_character_count,
        )
        
        result = {
            "status": cmd_info.state.value,
            "exit_code": cmd_info.exit_code,
            "stdout": stdout_paginated,
            "stderr": stderr_paginated,
            "command": cmd_info.command,
            "command_type": cmd_info.command_type.value,
            "command_id": cmd_info.command_id,
        }
        
        return result
    
    @classmethod
    def _paginate_output(
        cls,
        output: str,
        character_count: int,
        priority: str,
        skip_count: int,
    ) -> str:
        """
        分页输出。
        
        根据优先级和分页参数处理输出字符串。
        
        Args:
            output (str): 原始输出。
            character_count (int): 返回的字符数。
            priority (str): 优先级（top/bottom/split）。
            skip_count (int): 跳过的字符数。
        
        Returns:
            str: 分页后的输出。
        """
        if not output:
            return ""
        
        total_length = len(output)
        
        if total_length <= character_count:
            return output
        
        if priority == "top":
            start = skip_count
            end = min(start + character_count, total_length)
            return output[start:end]
        
        elif priority == "bottom":
            end = total_length - skip_count
            start = max(0, end - character_count)
            return output[start:end]
        
        elif priority == "split":
            half_count = character_count // 2
            top_end = min(half_count, total_length)
            bottom_start = max(0, total_length - half_count)
            
            if top_end >= bottom_start:
                return output[:character_count]
            
            return output[:top_end] + "\n... (truncated) ...\n" + output[bottom_start:]
        
        else:
            end = total_length - skip_count
            start = max(0, end - character_count)
            return output[start:end]
    
    @staticmethod
    def get_tool_spec() -> Dict[str, Any]:
        """
        获取工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范字典，用于注册到工具执行器。
        """
        return {
            "name": "CheckCommandStatus",
            "description": "检查运行中命令的状态。返回状态、退出码和输出。",
            "parameters": {
                "command_id": {
                    "type": "string",
                    "description": "命令 ID",
                    "required": True,
                },
                "filter": {
                    "type": "string",
                    "description": "输出过滤正则表达式",
                    "required": False,
                },
                "output_character_count": {
                    "type": "integer",
                    "description": "返回的字符数",
                    "required": False,
                },
                "output_priority": {
                    "type": "string",
                    "description": "输出优先级：top, bottom, split",
                    "enum": ["top", "bottom", "split"],
                    "required": False,
                },
                "skip_character_count": {
                    "type": "integer",
                    "description": "跳过的字符数",
                    "required": False,
                },
                "wait_ms_before_check": {
                    "type": "integer",
                    "description": "检查前等待时间（毫秒）",
                    "required": False,
                },
            },
        }
