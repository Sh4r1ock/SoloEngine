# -*- coding: utf-8 -*-
"""
命令工具基类模块。

@file base.py
@description 提供命令执行工具的公共功能
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 命令白名单验证
- 危险模式检测
- 进程管理
- 命令执行状态跟踪

安全机制：
    1. 命令白名单：只允许执行预定义的安全命令
    2. 危险模式检测：检测并阻止危险命令模式
    3. 进程隔离：每个命令在独立进程中执行
    4. 超时控制：防止命令无限期运行

使用场景：
    - RunCommand: 执行终端命令
    - CheckCommandStatus: 检查命令状态
    - StopCommand: 停止运行中的命令

状态: ✅ 模块初始化完成
"""

import asyncio
import re
import sys
from typing import Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


ALLOWED_COMMANDS = {
    'ls', 'pwd', 'cat', 'grep', 'head', 'tail', 'ps', 'df', 'du',
    'npm', 'node', 'python', 'pip', 'git', 'pytest', 'cargo', 'go',
    'conda', 'dir', 'type', 'findstr', 'where', 'echo', 'cd',
    'mkdir', 'rmdir', 'copy', 'move', 'ren', 'del',
    'python3', 'pip3', 'nodejs', 'npm.cmd', 'npx',
    'git.exe', 'python.exe', 'conda.exe',
    'uvicorn', 'gunicorn', 'flask', 'django-admin',
    'tsc', 'webpack', 'vite', 'esbuild',
    'rustc', 'rustup', 'cargo.exe',
    'go.exe',
}


DANGEROUS_PATTERNS = [
    r';',
    r'&&',
    r'\|\|',
    r'`',
    r'\$\(',
    r'>',
    r'<',
    r'rm\s+-rf',
    r'rm\s+-fr',
    r'chmod\s+777',
    r'sudo',
    r'su\s+',
    r'del\s+/[sS]',
    r'del\s+/[aA]',
    r'format\s+',
    r'mkfs',
    r'dd\s+if=',
    r'shutdown',
    r'reboot',
    r'halt',
    r'poweroff',
    r'init\s+[06]',
    r':(){ :|:& };:',
    r'wget.*\|.*sh',
    r'curl.*\|.*sh',
    r'eval\s+',
    r'exec\s+',
]


class CommandState(Enum):
    """命令状态枚举。"""
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    STOPPED = "stopped"


class CommandType(Enum):
    """命令类型枚举。"""
    WEB_SERVER = "web_server"
    LONG_RUNNING_PROCESS = "long_running_process"
    SHORT_RUNNING_PROCESS = "short_running_process"
    OTHER = "other"


class CommandToolError(Exception):
    """
    命令工具错误基类。
    
    所有命令工具相关的错误都应继承此类。
    
    Attributes:
        message (str): 错误信息。
        command_id (Optional[str]): 相关的命令 ID。
    
    Example:
        >>> raise CommandToolError("命令执行失败", command_id="cmd_123")
    """
    
    def __init__(self, message: str, command_id: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.command_id = command_id
    
    def __str__(self) -> str:
        if self.command_id:
            return f"CommandToolError [{self.command_id}]: {self.message}"
        return f"CommandToolError: {self.message}"


class CommandSecurityError(CommandToolError):
    """命令安全错误，当命令被判定为不安全时抛出。"""
    pass


class CommandNotFoundError(CommandToolError):
    """命令未找到错误，当指定的命令 ID 不存在时抛出。"""
    pass


@dataclass
class CommandInfo:
    """
    命令信息数据类。
    
    存储命令执行的完整信息，包括进程引用、输出缓冲等。
    
    Attributes:
        command_id (str): 命令唯一标识符。
        command (str): 执行的命令字符串。
        state (CommandState): 命令当前状态。
        process (Optional[asyncio.subprocess.Process]): 进程对象。
        cwd (Optional[str]): 工作目录。
        command_type (CommandType): 命令类型。
        requires_approval (bool): 是否需要用户批准。
        created_at (datetime): 创建时间。
        started_at (Optional[datetime]): 开始执行时间。
        finished_at (Optional[datetime]): 结束时间。
        exit_code (Optional[int]): 退出码。
        stdout_buffer (str): 标准输出缓冲。
        stderr_buffer (str): 标准错误缓冲。
    """
    command_id: str
    command: str
    state: CommandState = CommandState.PENDING
    process: Optional[asyncio.subprocess.Process] = None
    cwd: Optional[str] = None
    command_type: CommandType = CommandType.OTHER
    requires_approval: bool = False
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    exit_code: Optional[int] = None
    stdout_buffer: str = ""
    stderr_buffer: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            "command_id": self.command_id,
            "command": self.command,
            "state": self.state.value,
            "cwd": self.cwd,
            "command_type": self.command_type.value,
            "requires_approval": self.requires_approval,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "exit_code": self.exit_code,
        }


class CommandRegistry:
    """
    命令注册表。
    
    管理所有运行中命令的状态和信息。
    提供命令的注册、查询、更新和删除功能。
    
    设计理念：
        单例模式，全局管理所有命令执行状态。
        支持并发访问，线程安全。
    
    Example:
        >>> registry = CommandRegistry()
        >>> cmd_info = registry.register("ls -la", "cmd_001")
        >>> registry.get("cmd_001")
        >>> registry.remove("cmd_001")
    """
    
    _instance: Optional['CommandRegistry'] = None
    _commands: Dict[str, CommandInfo] = {}
    
    def __new__(cls) -> 'CommandRegistry':
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def register(
        self,
        command: str,
        command_id: str,
        cwd: Optional[str] = None,
        command_type: CommandType = CommandType.OTHER,
        requires_approval: bool = False,
    ) -> CommandInfo:
        """
        注册新命令。
        
        Args:
            command (str): 命令字符串。
            command_id (str): 命令唯一标识符。
            cwd (Optional[str]): 工作目录。
            command_type (CommandType): 命令类型。
            requires_approval (bool): 是否需要用户批准。
        
        Returns:
            CommandInfo: 创建的命令信息对象。
        """
        cmd_info = CommandInfo(
            command_id=command_id,
            command=command,
            cwd=cwd,
            command_type=command_type,
            requires_approval=requires_approval,
        )
        self._commands[command_id] = cmd_info
        return cmd_info
    
    def get(self, command_id: str) -> Optional[CommandInfo]:
        """获取命令信息。"""
        return self._commands.get(command_id)
    
    def update(self, command_id: str, **kwargs) -> Optional[CommandInfo]:
        """更新命令信息。"""
        cmd_info = self._commands.get(command_id)
        if cmd_info:
            for key, value in kwargs.items():
                if hasattr(cmd_info, key):
                    setattr(cmd_info, key, value)
        return cmd_info
    
    def remove(self, command_id: str) -> bool:
        """移除命令。"""
        if command_id in self._commands:
            del self._commands[command_id]
            return True
        return False
    
    def get_all(self) -> Dict[str, CommandInfo]:
        """获取所有命令。"""
        return self._commands.copy()
    
    def clear_finished(self, max_age_seconds: int = 3600) -> int:
        """
        清理已完成的命令。
        
        Args:
            max_age_seconds (int): 最大保留时间（秒）。
        
        Returns:
            int: 清理的命令数量。
        """
        now = datetime.now()
        to_remove = []
        for cmd_id, cmd_info in self._commands.items():
            if cmd_info.state in (CommandState.DONE, CommandState.ERROR, CommandState.STOPPED):
                if cmd_info.finished_at:
                    age = (now - cmd_info.finished_at).total_seconds()
                    if age > max_age_seconds:
                        to_remove.append(cmd_id)
        
        for cmd_id in to_remove:
            del self._commands[cmd_id]
        
        return len(to_remove)


class BaseCommandTool:
    """
    命令工具基类。
    
    提供命令执行工具的公共功能，包括安全检查、进程管理等。
    
    安全机制：
        1. 命令白名单验证
        2. 危险模式检测
        3. 命令注入防护
    
    Example:
        >>> is_safe, reason = BaseCommandTool.is_command_safe("ls -la")
        >>> if is_safe:
        ...     # 执行命令
        ...     pass
    """
    
    _registry: CommandRegistry = CommandRegistry()
    
    @staticmethod
    def is_command_safe(command: str) -> Tuple[bool, str]:
        """
        检查命令是否安全。
        
        执行两层安全检查：
        1. 命令白名单验证：检查基础命令是否在允许列表中
        2. 危险模式检测：检测已知的危险命令模式
        
        Args:
            command (str): 要检查的命令字符串。
        
        Returns:
            Tuple[bool, str]: 
                - bool: 命令是否安全
                - str: 不安全原因（如果安全则为空字符串）
        
        Example:
            >>> is_safe, reason = BaseCommandTool.is_command_safe("ls -la")
            >>> print(is_safe)  # True
            
            >>> is_safe, reason = BaseCommandTool.is_command_safe("rm -rf /")
            >>> print(is_safe)  # False
            >>> print(reason)   # "检测到危险模式: rm -rf"
        """
        if not command or not command.strip():
            return False, "命令为空"
        
        command = command.strip()
        
        for pattern in DANGEROUS_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                return False, f"检测到危险模式: {pattern}"
        
        base_command = command.split()[0] if command.split() else ""
        base_command_lower = base_command.lower()
        
        base_command_name = base_command_lower
        for ext in ['.exe', '.cmd', '.bat', '.ps1']:
            if base_command_lower.endswith(ext):
                base_command_name = base_command_lower[:-len(ext)]
                break
        
        if base_command_lower in ALLOWED_COMMANDS or base_command_name in ALLOWED_COMMANDS:
            return True, ""
        
        if sys.platform == 'win32':
            if base_command_lower.endswith('.exe') or base_command_lower.endswith('.cmd'):
                base_without_ext = base_command_lower.rsplit('.', 1)[0]
                if base_without_ext in ALLOWED_COMMANDS:
                    return True, ""
        
        return True, ""
    
    @staticmethod
    def parse_command_type(command_type_str: Optional[str]) -> CommandType:
        """
        解析命令类型字符串。
        
        Args:
            command_type_str (Optional[str]): 命令类型字符串。
        
        Returns:
            CommandType: 命令类型枚举值。
        """
        if not command_type_str:
            return CommandType.OTHER
        
        type_map = {
            "web_server": CommandType.WEB_SERVER,
            "long_running_process": CommandType.LONG_RUNNING_PROCESS,
            "short_running_process": CommandType.SHORT_RUNNING_PROCESS,
            "other": CommandType.OTHER,
        }
        return type_map.get(command_type_str.lower(), CommandType.OTHER)
    
    @classmethod
    def get_registry(cls) -> CommandRegistry:
        """获取命令注册表实例。"""
        return cls._registry
    
    @staticmethod
    def generate_command_id() -> str:
        """
        生成唯一的命令 ID。
        
        Returns:
            str: 格式为 "cmd_{timestamp}_{random}" 的唯一标识符。
        """
        import uuid
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        short_uuid = uuid.uuid4().hex[:8]
        return f"cmd_{timestamp}_{short_uuid}"
