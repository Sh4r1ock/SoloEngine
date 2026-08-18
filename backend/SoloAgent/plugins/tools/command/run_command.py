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
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Dict, Any, Optional
from app.core.config import settings
from app.core.terminal_manager import terminal_manager
from .._hitl import request_approval, get_run_mode, get_command_allowlist, get_terminal_id, plan_mode_guard
from .base import (
    BaseCommandTool,
    CommandInfo,
    CommandState,
    CommandToolError,
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
    
    MAX_TIMEOUT_MS = settings.COMMAND_MAX_TIMEOUT_MS
    DEFAULT_TIMEOUT_MS = settings.COMMAND_DEFAULT_TIMEOUT_MS
    
    @classmethod
    async def execute(
        cls,
        command: str,
        blocking: bool = True,
        requires_approval: bool = False,
        cwd: Optional[str] = None,
        timeout: Optional[int] = None,
        command_type: Optional[str] = None,
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
        # Plan 模式守卫（read-only 锁定）：处于计划模式时拒绝执行命令（特殊点位处理，非 plan 模式返回 None 放行原路径）
        guard = plan_mode_guard(cls.__name__)
        if guard:
            return guard

        # 安全检查分级：命中危险模式（rm -rf / sudo / shutdown 等）不再直接拒绝，
        # 由运行模式决定"转人工审批"（危险命令必须用户批准才执行）。
        is_dangerous, danger_reason = cls.is_command_dangerous(command)
        
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

        # 审批决策 = requires_approval（LLM 显式要求）+ agenticflow 画布运行模式：
        #   auto      自动运行：直接执行（等价 Claude Code bypassPermissions / Cursor Run Everything）
        #   ask       每次询问：所有命令均请求用户批准（等价 Claude Code default / Cursor Ask）
        #   allowlist 白名单：白名单内命令自动执行，白名单外请求用户批准（等价 Cursor Allowlist）
        # 用户决策经前端 → WS execute → run.py enqueue_message 进入业务消息队列，
        # request_approval 内部 await 该队列即实现"执行前等待用户批准"。
        run_mode = get_run_mode()
        need_approval = requires_approval
        if run_mode == "ask":
            need_approval = True
        elif run_mode == "allowlist":
            if not cls.is_command_allowlisted(command, get_command_allowlist()):
                need_approval = True

        if need_approval:
            if is_dangerous:
                desc = f"【危险命令】执行确认: {command[:80]}"
            else:
                desc = f"命令执行确认: {command[:80]}"
            approved = await request_approval(desc)
            if approved is not True:
                return {
                    "content": "命令未被用户批准，已取消执行。",
                    "success": False,
                    "error_message": "命令未被用户批准",
                    "command_id": command_id,
                    "status": "rejected",
                    "metadata": {},
                }
        
        if blocking:
            # 命令在 agentic 操作区终端 PTY 中真实执行（存在终端会话时）：
            # 命令写入 PTY，输出经现有 WS 通道实时显示在前端 xterm，执行结果仍回传 agent。
            # 无终端会话时回退 subprocess 独立执行（原链路）。
            pty_session = cls._pick_terminal_session()
            if pty_session is not None:
                return await cls._execute_in_terminal(
                    cmd_info=cmd_info,
                    session=pty_session,
                    timeout=timeout,
                )
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
    def _pick_terminal_session(cls) -> Optional[Any]:
        """选择命令执行的终端会话：优先前端指定的目标终端（terminal_attach），否则第一个会话。

        关联决策（命令执行在哪个终端）由前端持有并经 run_context 注入（_hitl.get_terminal_id），
        工具仅接收目标终端 ID 执行——工具不感知前端连接状态（session.clients），前端与工具联动独立。
        """
        sessions = terminal_manager.get_all()
        if not sessions:
            return None
        terminal_id = get_terminal_id()
        if terminal_id:
            session = terminal_manager.get(terminal_id)
            if session is not None:
                return session
        return next(iter(sessions.values()))

    @classmethod
    async def _execute_in_terminal(
        cls,
        cmd_info: CommandInfo,
        session: Any,
        timeout: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        命令在操作区终端 PTY 会话中真实执行（blocking）。

        命令本身（用户命令）写入 PTY，终端像真实用户输入一样回显命令并显示输出
        （前端 xterm 经 WS 实时可见）。命令完成判定基于 PowerShell 新提示符出现
        （每次命令执行完 PowerShell 打印新提示符 `(base) PS D:...>`），
        命令输出 = 命令回显行之后、新提示符之前的内容（与真实终端行为完全一致，
        无任何内部标记污染显示）。

        Args:
            cmd_info (CommandInfo): 命令信息。
            session (TerminalSession): 目标终端 PTY 会话。
            timeout (Optional[int]): 超时时间（毫秒）。

        Returns:
            Dict[str, Any]: 与 _execute_blocking 相同结构的执行结果。
        """
        timeout_ms = min(timeout or cls.DEFAULT_TIMEOUT_MS, cls.MAX_TIMEOUT_MS)
        timeout_seconds = timeout_ms / 1000.0

        cmd_id = cmd_info.command_id

        # 终端会话初始化（等 PowerShell 就绪 + PSReadLine 已禁用），
        # 消除命令写入与初始化序列（Remove-Module PSReadLine）竞争导致命令被吞。
        # 等待有超时兜底：PTY 初始化失败（PowerShell 卡死）时直接报错，而非永久挂起。
        try:
            await asyncio.wait_for(session.wait_ready(), timeout=30)
        except asyncio.TimeoutError:
            raise CommandToolError(
                f"终端会话初始化超时（PowerShell 未就绪），命令未执行: {cmd_info.command[:80]}",
                command_id=cmd_id,
            )

        cmd_info.state = CommandState.RUNNING
        cmd_info.started_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))

        queue = session.start_capture(cmd_id)
        collected: list = []
        user_output = ""
        try:
            async with session.cmd_lock:
                # 1) 工作目录切换（单独一条真实命令，独立回显+提示符完成）
                if cmd_info.cwd:
                    cwd_escaped = str(cmd_info.cwd).replace("'", "''")
                    await cls._write_and_wait(
                        session, queue, f"Set-Location -LiteralPath '{cwd_escaped}'",
                        timeout_seconds, collected,
                    )
                # 2) 用户命令本身（真实回显：`echo PTYRealRunTest456` -> 输出独立行）
                user_output = await cls._write_and_wait(
                    session, queue, cmd_info.command, timeout_seconds, collected,
                )
        except asyncio.TimeoutError:
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            return {
                "content": f"命令执行超时（{timeout_ms}ms），已停止等待结果。",
                "success": False,
                "error_message": f"命令执行超时（{timeout_ms}ms）",
                "exit_code": None,
                "command_id": cmd_id,
                "status": "timeout",
                "metadata": {"execution_method": "terminal_pty", "stderr": ""},
            }
        except Exception as e:
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            raise CommandToolError(str(e), command_id=cmd_id)
        finally:
            session.stop_capture(cmd_id)

        # 用户命令输出（_write_and_wait 已按"新提示符前内容 - 命令回显"提取）
        content = user_output

        cmd_info.stdout_buffer = content
        # PTY 模式基于"命令回显行后出现新提示符"判定完成（无真实进程退出码来源），
        # 完成即视为成功，exit_code=0（修正原 `0 if content or True else 1` 恒真的逻辑 bug）。
        cmd_info.exit_code = 0
        cmd_info.state = CommandState.DONE
        cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))

        return {
            "content": content,
            "success": True,
            "error_message": None,
            "exit_code": cmd_info.exit_code,
            "command_id": cmd_id,
            "metadata": {"execution_method": "terminal_pty", "stderr": ""},
        }

    @classmethod
    async def _write_and_wait(
        cls,
        session: Any,
        queue: Any,
        command: str,
        timeout_seconds: float,
        collected: list,
    ) -> str:
        """写入单条命令并等待命令执行完成（新提示符出现），返回该命令的输出文本。

        完成判定与真实终端行为一致：PowerShell 每次命令执行完都会打印新提示符。
        判定锚点为「命令写入后新增部分出现新提示符」，不再依赖命令回显行的连续文本匹配——
        长命令在窄终端（默认 120 列）下会被 ANSI 折行重绘拆开（如 `Solo\\r\\nEngine-main...`），
        连续匹配必然失败导致超时（实测根因）。
        """
        # 排空上一条命令残留输出（多为尾部控制序列），避免污染本条命令完成判定
        while True:
            try:
                leftover = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            collected.append(leftover)

        session.write(command + "\r")
        # 完成基线：命令写入前已累积文本（清理 ANSI 后）
        pre_clean = cls._clean_ansi("".join(collected))
        cmd_chunks: list = []
        while True:
            chunk = await asyncio.wait_for(queue.get(), timeout=timeout_seconds)
            collected.append(chunk)
            cmd_chunks.append(chunk)
            clean = cls._clean_ansi("".join(collected))
            if not clean.startswith(pre_clean):
                # 前缀异常（理论不发生）：以当前累计为基线继续
                pre_clean = clean
                continue
            # 命令写入后新增部分出现新提示符 = 命令执行完成
            if cls._find_prompt(clean[len(pre_clean):]) is not None:
                break
        # 提取本条命令输出（仅本条 chunk，结构：回显 + 输出 + 新提示符）
        return cls._extract_terminal_output("".join(cmd_chunks), command)

    @staticmethod
    def _clean_ansi(raw: str) -> str:
        """清理 ANSI 转义序列（PowerShell 高亮/光标重绘），返回纯文本。"""
        clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", raw)
        clean = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", clean)
        return clean

    @staticmethod
    def _find_prompt(text: str):
        """定位 PowerShell 提示符（`(base) PS D:...>`）。返回 match 或 None。

        提示符分段输出：`(base) `（conda 环境前缀）与 `PS D:...>` 常分属不同
        PTY chunk。若只从 `PS` 开始匹配，`(base) ` 会残留在命令输出中
        （实测 content 多出 `(base)`），因此前缀纳入匹配范围。
        """
        return re.search(r"(?:\([^)]*\)[ \t]*)?PS [^>\r\n]*>", text)

    @staticmethod
    def _extract_terminal_output(raw: str, command: str) -> str:
        """从单条命令的终端原始输出中提取命令输出（回显之后、新提示符之前的内容）。

        单条命令输出结构（清理 ANSI 后）：
            `(base) PS D:...> <command>`   ← 回显行（含初始提示符，长命令可能被折行拆开）
            `<output 行1>`                  ← 命令输出
            `(base) PS D:...>`             ← 新提示符

        提取策略：取初始提示符之后、新提示符之前的文本，再剔除命令回显
        （命令文本本身，容忍折行拆行）。
        """
        clean = RunCommand._clean_ansi(raw)
        prompts = list(re.finditer(r"(?:\([^)]*\)[ \t]*)?PS [^>\r\n]*>", clean))
        if not prompts:
            return ""
        if len(prompts) >= 2:
            body = clean[prompts[0].end():prompts[-1].start()]
        else:
            body = clean[prompts[0].end():]
        body = RunCommand._strip_command_echo(body, command)
        return "\n".join(ln.strip() for ln in body.splitlines() if ln.strip())

    @staticmethod
    def _strip_command_echo(body: str, command: str) -> str:
        """剔除命令回显（命令文本本身）。容忍 ANSI 折行将命令文本拆成多行。"""
        if not command:
            return body
        # compact：去掉全部换行后定位命令（折行重绘会在命令文本中插入换行）
        compact = re.sub(r"[\r\n]+", "", body)
        cmd_idx = compact.find(command)
        if cmd_idx == -1:
            return body
        # 逐字符映射 compact 索引回 body 索引（换行字符映射为 None）
        mapping = []
        ci = 0
        for ch in body:
            if ch in "\r\n":
                mapping.append(None)
            else:
                mapping.append(ci)
                ci += 1
        start = next((bi for bi, v in enumerate(mapping) if v == cmd_idx), None)
        end = next((bi for bi, v in enumerate(mapping) if v == cmd_idx + len(command) - 1), None)
        if start is None or end is None:
            return body
        return body[:start] + body[end + 1:]

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
        cmd_info.started_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        
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
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            
            success = cmd_info.exit_code == 0
            if success:
                return {
                    "content": cmd_info.stdout_buffer,
                    "success": True,
                    "error_message": None,
                    "exit_code": cmd_info.exit_code,
                    "command_id": cmd_info.command_id,
                    "metadata": {
                        "stderr": cmd_info.stderr_buffer
                    }
                }
            else:
                return {
                    "content": cmd_info.stderr_buffer if cmd_info.stderr_buffer else f"Command failed with exit code {cmd_info.exit_code}",
                    "success": False,
                    "error_message": cmd_info.stderr_buffer if cmd_info.stderr_buffer else f"Command failed with exit code {cmd_info.exit_code}",
                    "exit_code": cmd_info.exit_code,
                    "command_id": cmd_info.command_id,
                    "metadata": {
                        "stdout": cmd_info.stdout_buffer
                    }
                }
            
        except CommandToolError:
            raise
        except Exception as e:
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
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
        cmd_info.started_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        
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
                "content": f"Started: {cmd_info.command_id}",
                "success": True,
                "error_message": None,
                "command_id": cmd_info.command_id,
                "status": cmd_info.state.value,
                "metadata": {}
            }
            
        except CommandToolError:
            raise
        except Exception as e:
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            cmd_info.stderr_buffer = str(e)
            raise CommandToolError(str(e), command_id=cmd_info.command_id)
    
    @classmethod
    async def _create_process(cls, cmd_info: CommandInfo) -> asyncio.subprocess.Process:
        if sys.platform == 'win32':
            command = f'chcp 65001 >nul && {cmd_info.command}'
            process = await asyncio.create_subprocess_shell(
                command,
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
            # 命令被 StopCommand 主动停止后状态为 STOPPED，
            # 监控任务不能把停止后的进程状态覆盖为 DONE/ERROR。
            if cmd_info.state != CommandState.STOPPED:
                cmd_info.state = CommandState.DONE if process.returncode == 0 else CommandState.ERROR
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            
        except Exception as e:
            cmd_info.stderr_buffer = str(e)
            cmd_info.state = CommandState.ERROR
            cmd_info.finished_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
    
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
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要执行的终端命令",
                    },
                    "blocking": {
                        "type": "boolean",
                        "description": "是否阻塞执行。True 表示等待命令完成，False 表示立即返回 command_id",
                    },
                    "requires_approval": {
                        "type": "boolean",
                        "description": "是否需要用户批准。建议：执行有副作用的命令（安装依赖、删除文件、启动/停止服务、git push 等）时设为 true；只读命令（ls、dir、pwd、git status 等）设为 false。系统还会根据 agenticflow 画布设置的运行模式自动决定是否审批。",
                    },
                    "cwd": {
                        "type": "string",
                        "description": "工作目录（必须是绝对路径）",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "超时时间（毫秒），最大 600000ms",
                    },
                    "command_type": {
                        "type": "string",
                        "description": "命令类型：web_server, long_running_process, short_running_process, other",
                        "enum": ["web_server", "long_running_process", "short_running_process", "other"],
                    },
                    "wait_ms_before_async": {
                        "type": "integer",
                        "description": "非阻塞模式下启动后等待时间（毫秒）",
                    },
                },
                "required": ["command", "blocking", "requires_approval"],
            },
        }
