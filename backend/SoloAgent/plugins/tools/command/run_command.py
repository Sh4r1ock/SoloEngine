# -*- coding: utf-8 -*-
"""
运行命令工具模块。

@file run_command.py
@description 执行终端命令的工具
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 执行 shell 命令
- 支持阻塞/非阻塞执行
- 支持用户批准机制
- 支持工作目录设置
- 支持超时控制
- Windows PowerShell 环境支持

执行模式：
    1. 阻塞模式 (blocking=True)：
       - 等待命令完成后返回结果
       - 适用于短时间运行的命令
    
    2. 非阻塞模式 (blocking=False)：
       - 立即返回 command_id
       - 适用于长时间运行的命令（如服务器）
       - 使用 CheckCommandStatus 查询状态

命令类型：
    - web_server: Web 服务器
    - long_running_process: 长时间运行的进程
    - short_running_process: 短时间运行的进程
    - other: 其他类型

状态: ✅ 模块初始化完成
"""

import asyncio
import os
import sys
from datetime import datetime
from typing import Dict, Any, Optional

from .base import (
    BaseCommandTool,
    CommandInfo,
    CommandState,
    CommandType,
    CommandToolError,
    CommandSecurityError,
)


class RunCommand(BaseCommandTool):
    """
    运行命令工具。
    
    执行终端命令，支持阻塞和非阻塞两种执行模式。
    
    安全机制：
        1. 命令安全检查
        2. 超时控制（最大 600 秒）
        3. 进程隔离
    
    执行流程：
        1. 检查命令安全性
        2. 创建命令信息并注册
        3. 启动子进程执行命令
        4. 根据阻塞模式返回结果或 command_id
    
    Example:
        >>> # 阻塞执行
        >>> result = await RunCommand.execute(
        ...     command="ls -la",
        ...     blocking=True,
        ...     requires_approval=False
        ... )
        >>> print(result["stdout"])
        
        >>> # 非阻塞执行
        >>> result = await RunCommand.execute(
        ...     command="npm run dev",
        ...     blocking=False,
        ...     command_type="web_server"
        ... )
        >>> command_id = result["command_id"]
    """
    
    MAX_TIMEOUT_MS = 600000
    DEFAULT_TIMEOUT_MS = 30000
    
    @classmethod
    async def execute(
        cls,
        command: str,
        blocking: bool = True,
        requires_approval: bool = False,
        cwd: Optional[str] = None,
        timeout: Optional[int] = None,
        command_type: Optional[str] = None,
        target_terminal: Optional[str] = None,
        wait_ms_before_async: int = 0,
    ) -> Dict[str, Any]:
        """
        执行终端命令。
        
        Args:
            command (str): 要执行的终端命令。
                必须是格式正确的命令字符串。
            blocking (bool): 是否阻塞执行。
                - True: 等待命令完成后返回结果
                - False: 立即返回 command_id
                默认为 True。
            requires_approval (bool): 是否需要用户批准。
                如果为 True，命令在执行前需要用户确认。
                默认为 False。
            cwd (Optional[str]): 工作目录。
                命令执行的目录路径。如果未指定，使用当前目录。
                默认为 None。
            timeout (Optional[int]): 超时时间（毫秒）。
                最大值为 600000ms（10分钟）。
                仅在阻塞模式下有效。
                默认为 None（使用默认超时 30 秒）。
            command_type (Optional[str]): 命令类型。
                可选值：
                - "web_server": Web 服务器
                - "long_running_process": 长时间运行的进程
                - "short_running_process": 短时间运行的进程
                - "other": 其他类型
                默认为 None（自动判断）。
            target_terminal (Optional[str]): 目标终端 ID。
                指定命令执行的终端。如果未指定，使用新终端。
                默认为 None。
            wait_ms_before_async (int): 非阻塞模式下启动后等待时间（毫秒）。
                用于检测命令启动时的错误。
                默认为 0。
        
        Returns:
            Dict[str, Any]: 执行结果。
                阻塞模式返回：
                - stdout (str): 标准输出
                - stderr (str): 标准错误
                - exit_code (int): 退出码
                - success (bool): 是否成功
                
                非阻塞模式返回：
                - command_id (str): 命令 ID
                - status (str): 命令状态
                - message (str): 提示信息
        
        Raises:
            CommandSecurityError: 当命令被判定为不安全时抛出。
            CommandToolError: 当命令执行失败时抛出。
        
        Example:
            >>> # 执行 ls 命令
            >>> result = await RunCommand.execute(
            ...     command="ls -la",
            ...     blocking=True
            ... )
            >>> print(result["stdout"])
            
            >>> # 启动开发服务器
            >>> result = await RunCommand.execute(
            ...     command="npm run dev",
            ...     blocking=False,
            ...     command_type="web_server"
            ... )
            >>> print(result["command_id"])
        """
        is_safe, reason = cls.is_command_safe(command)
        if not is_safe:
            raise CommandSecurityError(f"命令不安全: {reason}")
        
        if cwd and not os.path.isabs(cwd):
            cwd = os.path.abspath(cwd)
        
        if cwd and not os.path.isdir(cwd):
            raise CommandToolError(f"工作目录不存在: {cwd}")
        
        cmd_type = cls.parse_command_type(command_type)
        
        command_id = cls.generate_command_id()
        
        cmd_info = cls._registry.register(
            command=command,
            command_id=command_id,
            cwd=cwd,
            command_type=cmd_type,
            requires_approval=requires_approval,
        )
        
        if blocking:
            return await cls._execute_blocking(
                cmd_info=cmd_info,
                timeout=timeout,
            )
        else:
            return await cls._execute_non_blocking(
                cmd_info=cmd_info,
                wait_ms=wait_ms_before_async,
            )
    
    @classmethod
    async def _execute_blocking(
        cls,
        cmd_info: CommandInfo,
        timeout: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        阻塞执行命令。
        
        Args:
            cmd_info (CommandInfo): 命令信息。
            timeout (Optional[int]): 超时时间（毫秒）。
        
        Returns:
            Dict[str, Any]: 执行结果。
        """
        timeout_ms = min(timeout or cls.DEFAULT_TIMEOUT_MS, cls.MAX_TIMEOUT_MS)
        timeout_seconds = timeout_ms / 1000.0
        
        cmd_info.state = CommandState.RUNNING
        cmd_info.started_at = datetime.now()
        
        try:
            process = await cls._create_process(cmd_info)
            cmd_info.process = process
            
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout_seconds
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise CommandToolError(
                    f"命令执行超时（{timeout_ms}ms）",
                    command_id=cmd_info.command_id
                )
            
            cmd_info.stdout_buffer = stdout.decode('utf-8', errors='replace')
            cmd_info.stderr_buffer = stderr.decode('utf-8', errors='replace')
            cmd_info.exit_code = process.returncode
            cmd_info.state = CommandState.DONE
            cmd_info.finished_at = datetime.now()
            
            return {
                "stdout": cmd_info.stdout_buffer,
                "stderr": cmd_info.stderr_buffer,
                "exit_code": cmd_info.exit_code,
                "success": cmd_info.exit_code == 0,
                "command_id": cmd_info.command_id,
            }
            
        except CommandToolError:
            raise
        except Exception as e:
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now()
            raise CommandToolError(str(e), command_id=cmd_info.command_id)
    
    @classmethod
    async def _execute_non_blocking(
        cls,
        cmd_info: CommandInfo,
        wait_ms: int = 0,
    ) -> Dict[str, Any]:
        """
        非阻塞执行命令。
        
        Args:
            cmd_info (CommandInfo): 命令信息。
            wait_ms (int): 启动后等待时间（毫秒）。
        
        Returns:
            Dict[str, Any]: 包含 command_id 的结果。
        """
        cmd_info.state = CommandState.RUNNING
        cmd_info.started_at = datetime.now()
        
        try:
            process = await cls._create_process(cmd_info)
            cmd_info.process = process
            
            asyncio.create_task(cls._monitor_process(cmd_info))
            
            if wait_ms > 0:
                await asyncio.sleep(wait_ms / 1000.0)
                
                if cmd_info.state == CommandState.ERROR:
                    raise CommandToolError(
                        cmd_info.stderr_buffer or "命令启动失败",
                        command_id=cmd_info.command_id
                    )
            
            return {
                "command_id": cmd_info.command_id,
                "status": cmd_info.state.value,
                "message": "命令已启动，使用 CheckCommandStatus 查询状态",
            }
            
        except CommandToolError:
            raise
        except Exception as e:
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now()
            cmd_info.stderr_buffer = str(e)
            raise CommandToolError(str(e), command_id=cmd_info.command_id)
    
    @classmethod
    async def _create_process(cls, cmd_info: CommandInfo) -> asyncio.subprocess.Process:
        """
        创建子进程。
        
        根据操作系统选择合适的 shell 执行命令。
        
        Args:
            cmd_info (CommandInfo): 命令信息。
        
        Returns:
            asyncio.subprocess.Process: 进程对象。
        """
        if sys.platform == 'win32':
            process = await asyncio.create_subprocess_shell(
                cmd_info.command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cmd_info.cwd,
                shell=True,
            )
        else:
            process = await asyncio.create_subprocess_shell(
                cmd_info.command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cmd_info.cwd,
                shell=True,
            )
        
        return process
    
    @classmethod
    async def _monitor_process(cls, cmd_info: CommandInfo) -> None:
        """
        监控进程执行。
        
        持续读取进程输出并更新命令信息。
        
        Args:
            cmd_info (CommandInfo): 命令信息。
        """
        process = cmd_info.process
        if not process:
            return
        
        try:
            stdout, stderr = await process.communicate()
            
            cmd_info.stdout_buffer = stdout.decode('utf-8', errors='replace')
            cmd_info.stderr_buffer = stderr.decode('utf-8', errors='replace')
            cmd_info.exit_code = process.returncode
            cmd_info.state = CommandState.DONE if process.returncode == 0 else CommandState.ERROR
            cmd_info.finished_at = datetime.now()
            
        except Exception as e:
            cmd_info.stderr_buffer = str(e)
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now()
    
    @staticmethod
    def get_tool_spec() -> Dict[str, Any]:
        """
        获取工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范字典，用于注册到工具执行器。
        """
        return {
            "name": "RunCommand",
            "description": "执行终端命令。支持阻塞和非阻塞两种执行模式。Windows PowerShell 环境。",
            "parameters": {
                "command": {
                    "type": "string",
                    "description": "要执行的终端命令",
                    "required": True,
                },
                "blocking": {
                    "type": "boolean",
                    "description": "是否阻塞执行。True 表示等待命令完成，False 表示立即返回 command_id",
                    "required": True,
                },
                "requires_approval": {
                    "type": "boolean",
                    "description": "是否需要用户批准",
                    "required": True,
                },
                "cwd": {
                    "type": "string",
                    "description": "工作目录（必须是绝对路径）",
                    "required": False,
                },
                "timeout": {
                    "type": "integer",
                    "description": "超时时间（毫秒），最大 600000ms",
                    "required": False,
                },
                "command_type": {
                    "type": "string",
                    "description": "命令类型：web_server, long_running_process, short_running_process, other",
                    "enum": ["web_server", "long_running_process", "short_running_process", "other"],
                    "required": False,
                },
                "target_terminal": {
                    "type": "string",
                    "description": "目标终端 ID",
                    "required": False,
                },
                "wait_ms_before_async": {
                    "type": "integer",
                    "description": "非阻塞模式下启动后等待时间（毫秒）",
                    "required": False,
                },
            },
        }
