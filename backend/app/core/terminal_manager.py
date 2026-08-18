# -*- coding: utf-8 -*-
"""
SoloEngine : 终端 PTY 会话管理（核心层）

@file terminal_manager.py
@description 真实多终端：每终端一个 Windows ConPTY 会话（pywinpty）。
             本模块为核心层能力：工具层（RunCommand 命令真实执行于终端）
             与 API 层（terminal_ws WebSocket 收发）共同依赖，二者互不依赖。
@author Sh4rlock
@date 2026-08-11

功能描述：
- 创建/销毁 PTY 会话（spawn powershell）
- 每会话 daemon 线程阻塞读取 PTY 输出，桥接回事件循环：
    - 推送所有已连接 WS 客户端（前端 xterm 实时显示）
    - 推送命令捕获队列（RunCommand PTY 执行时收集输出回传 agent）
- 命令捕获机制：cmd_id -> asyncio.Queue（命令完成判定 + 结果收集）
- 同一会话命令串行执行锁（避免多 agent 并发 RunCommand 在 PTY 中交错）

架构分层（对齐 06-architecture.md）：
- 核心层（本模块）：PTY 会话生命周期与输出分发，不感知 FastAPI/前端
- API 层（app/api/v1/terminal_ws.py）：仅 WS/REST 端点，转发到本模块
- 工具层（SoloAgent/plugins/tools/command/run_command.py）：经本模块将命令
  写入 PTY 真实执行并收集结果——工具不依赖 API 层，实现低耦合
"""

import asyncio
import logging
import os
import re
import sys
import threading
import uuid
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Windows 下依赖 pywinpty（import winpty）
if sys.platform == "win32":
    try:
        from winpty import PtyProcess
    except ImportError:
        PtyProcess = None
else:
    PtyProcess = None


class TerminalSession:
    """单个 PTY 终端会话。"""

    def __init__(self, terminal_id: str, proc, loop: asyncio.AbstractEventLoop, cwd: str):
        self.id = terminal_id
        self.proc = proc
        self.loop = loop
        self.cwd = cwd
        self.clients: set = set()
        self._closed = False
        # RunCommand 命令执行捕获：cmd_id -> 输出队列（命令在 PTY 真实执行时，
        # reader 线程读到的输出同时推给 WS 客户端与捕获队列，供工具结果回传）。
        self._cmd_captures: Dict[str, asyncio.Queue] = {}
        # 同一会话命令串行执行锁（避免多 agent 并发 RunCommand 在 PTY 中交错）
        self.cmd_lock = asyncio.Lock()
        # PSReadLine 禁用标记：PowerShell 交互终端的行内编辑会以 ANSI 光标/颜色
        # 序列逐字符重绘命令行输入（\x1b[7;55H 等），导致命令回显与输出交错混乱。
        # 初始化协程在 PowerShell 就绪（首次提示符）后执行 Remove-Module PSReadLine，
        # 回退到简单回显——命令与输出独立成行，xterm 显示干净（实测验证）。
        self._psreadline_disabled = False
        # 初始化完成事件（PowerShell 就绪 + PSReadLine 已禁用）：RunCommand 写入
        # 命令前 await wait_ready()，避免命令写入与初始化序列（Remove-Module）竞争。
        self._ready = asyncio.Event()
        # 初始化阶段 PTY 输出累积缓冲（供 _count_prompts 检测提示符）
        self._startup_buffer = ""
        # 初始化完成后快照（清理 ANSI + 仅最后一个提示符）：新 WS 客户端连接时
        # 回放该快照，使 xterm 显示终端当前状态而非空白。
        self._snapshot = ""
        # cls（清屏）前提示符计数基线：_cls_done 据此判断 cls 后新提示符已打印
        self._cls_base_prompt_count = 0
        self._init_task = asyncio.create_task(self._initialize_terminal())
        # daemon 线程阻塞读 PTY 输出 -> 桥接回事件循环推送 WS
        self._reader_thread = threading.Thread(
            target=self._reader_loop, name=f"terminal-pty-reader-{terminal_id}", daemon=True
        )
        self._reader_thread.start()

    async def _initialize_terminal(self) -> None:
        """初始化终端会话：等待 PowerShell 就绪（首次提示符）-> 禁用 PSReadLine。

        初始化序列与 RunCommand 命令写入共用 cmd_lock 串行化：
        RunCommand 的 _execute_in_terminal 先 await wait_ready()，保证命令写入
        一定发生在 PSReadLine 禁用完成之后（消除实测中 Set-Location 被吞的竞态）。
        """
        try:
            async with self.cmd_lock:
                # 等待 PowerShell profile 加载完成（首次提示符出现）
                while not self._closed and self._count_prompts() < 1:
                    await asyncio.sleep(0.1)
                if self._closed:
                    return
                # 禁用 PSReadLine（简单回显，命令与输出独立成行）
                try:
                    self.proc.write("Remove-Module PSReadLine\r")
                    # 等待禁用命令执行完成：Remove-Module 回显之后出现新提示符
                    # （不能用 count>=2：同路径提示符被行内重绘重复打印会误判/误卡）
                    while not self._closed and not self._remove_module_done():
                        await asyncio.sleep(0.1)
                    self._psreadline_disabled = True
                    # 清屏（Clear-Host）：消除屏幕缓冲中的初始化历史（Remove-Module 回显等）。
                    # winpty 在 resize 时会重新抓取 console 屏幕缓冲并作为输出流推送
                    # （winpty "direct mode" 仅同步 console 快照，实测前端 xterm 残留
                    # `Remove-Module PSReadLine(base) PS ...backend>` 即源于此）。
                    # 清屏后屏幕缓冲仅剩新提示符，任意次 resize 重绘均为干净提示符。
                    # 完成判定：cls 回显文本不可靠（Clear-Host 清屏机制下 "cls" 文本不写入
                    # startup_buffer，实测 `cls` 回显缺失导致 _cls_done 恒 False 卡死），
                    # 改用提示符计数增量（写 cls 前计数 → 写 cls 后计数增加 = 新提示符已打印）。
                    self._cls_base_prompt_count = self._count_prompts()
                    self.proc.write("cls\r")
                    while not self._closed and not self._cls_done():
                        await asyncio.sleep(0.1)
                    # 稳定等待：让 cls 后的最后一个提示符完整写入 startup_buffer
                    #（避免快照截取到未完成的提示符/残留回显）
                    await asyncio.sleep(0.5)
                except Exception as e:
                    logger.warning(f"[Terminal] disable PSReadLine error {self.id}: {e}")
        except Exception as e:
            logger.warning(f"[Terminal] init error {self.id}: {e}")
        finally:
            # 初始化完成：计算终端当前快照（清理 ANSI 后最后一个提示符），
            # 供后连接的 WS 客户端回放（xterm 显示当前终端状态）。
            try:
                buf = self._startup_buffer or ""
                clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", buf)
                clean = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", clean)
                prompts = list(re.finditer(r"(?:\([^)]*\)[ \t]*)?PS [^>\r\n]*>", clean))
                if prompts:
                    # 仅取最后一个提示符文本本身（不含其后的残留回显/控制序列）
                    clean = prompts[-1].group(0)
                self._snapshot = clean
            except Exception:
                self._snapshot = ""
            self._ready.set()

    async def replay_snapshot(self, websocket: Any) -> None:
        """向 WS 客户端回放终端当前快照（仅最后一个提示符，无初始化杂乱输出）。

        前端创建会话后立即连接 WS，此时初始化可能尚未完成（_snapshot 为空）。
        因此先等待 _ready（PowerShell 就绪 + PSReadLine 已禁用 + 快照已计算），
        再回放快照，保证新连接 xterm 显示终端当前状态而非空白。
        """
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=30)
        except asyncio.TimeoutError:
            logger.warning(f"[Terminal] replay snapshot wait ready timeout {self.id}")
        if self._snapshot:
            try:
                await websocket.send_json({"type": "output", "data": self._snapshot})
            except Exception as e:
                logger.warning(f"[Terminal] replay snapshot error {self.id}: {e}")

    def _count_prompts(self) -> int:
        """统计 startup_buffer 中 PowerShell 提示符出现次数（仅用于等待首次提示符）。

        提示符特征：`PS D:...>`（Windows PowerShell 提示符）。不要求行首前缀——
        初始化阶段 Remove-Module PSReadLine 的回显经行内编辑重绘（ANSI 光标绝对
        定位 `\x1b[8;1H`），清理 ANSI 后提示符可能与回显文本粘连无换行。
        正则排除 `>` 防止贪婪吞并同一行多个提示符（`[^>\r\n]*>` 每个提示符独立匹配）。

        注意：同一路径提示符可能被 PSReadLine 重复打印（回车 + 行内重绘），因此
        本计数只用于"首次提示符已出现"（count>=1）判断；Remove-Module 完成判定
        由 _remove_module_done（回显之后出现新提示符）负责，不依赖本计数。
        """
        data = getattr(self, "_startup_buffer", None) or ""
        clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", data)
        clean = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", clean)
        return len(re.findall(r"PS [^>\r\n]*>", clean))

    def _remove_module_done(self) -> bool:
        """Remove-Module PSReadLine 是否已执行完成：其回显之后出现新提示符。

        不能依赖提示符计数（count>=2）：同一路径提示符会被 PSReadLine 行内重绘
        重复打印（`...backend>\r(base) PS ...backend>`），且 Remove-Module 完成后的
        新提示符文本与重复的旧提示符相同，计数无法区分。改用文本锚点：
        回显中出现 `Remove-Module PSReadLine`，且该文本之后出现提示符，即为完成。
        """
        data = getattr(self, "_startup_buffer", None) or ""
        clean = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", data)
        clean = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", clean)
        marker = "Remove-Module PSReadLine"
        if marker not in clean:
            return False
        after = clean.split(marker, 1)[1]
        return re.search(r"PS [^>\r\n]*>", after) is not None

    def _cls_done(self) -> bool:
        """cls（Clear-Host 清屏）是否已执行完成：提示符数量较写 cls 前增加。

        Clear-Host 清屏后 PowerShell 重新打印提示符，startup_buffer 中提示符数量
        相对 _cls_base_prompt_count（写 cls 前记录）增加即完成。不用 "cls" 回显文本
        作锚点：实测 Clear-Host 清屏机制下 "cls" 文本不写入 startup_buffer（恒 False 卡死）。
        """
        return self._count_prompts() > getattr(self, "_cls_base_prompt_count", 0)

    async def wait_ready(self) -> None:
        """等待终端会话初始化完成（PowerShell 就绪 + PSReadLine 已禁用）。"""
        await self._ready.wait()

    def _reader_loop(self) -> None:
        """阻塞读取 PTY 输出并推送所有连接的 WebSocket 客户端与命令捕获队列。

        初始化完成（PowerShell 就绪 + PSReadLine 已禁用）前，PTY 输出仅累积到
        _startup_buffer 供 _initialize_terminal 检测提示符，不推送前端——避免
        初始化阶段 profile 加载与 Remove-Module 行内编辑重绘的杂乱输出显示在
        xterm 中（实测前端出现 `Remove-Module PS(base) PS D:...>` 交错即源于此）。
        初始化完成后才广播 WS 与命令捕获队列（RunCommand 亦先 await wait_ready()）。
        """
        try:
            while not self._closed:
                try:
                    data = self.proc.read(4096)
                except Exception:
                    break
                if not data:
                    continue
                if not self._ready.is_set():
                    # 初始化阶段：仅累积输出供 _initialize_terminal 检测提示符
                    try:
                        self._startup_buffer = (self._startup_buffer or "") + data
                    except Exception:
                        pass
                    continue
                # 1) WS 广播（前端 xterm 实时显示）
                if self.clients:
                    asyncio.run_coroutine_threadsafe(
                        self._broadcast({"type": "output", "data": data}), self.loop
                    )
                # 2) 命令捕获队列（RunCommand PTY 执行时收集本次命令输出）
                if self._cmd_captures:
                    asyncio.run_coroutine_threadsafe(
                        self._push_captures(data), self.loop
                    )
        finally:
            try:
                exit_code = getattr(self.proc, "exitstatus", 0) or 0
            except Exception:
                exit_code = 0
            asyncio.run_coroutine_threadsafe(
                self._broadcast({"type": "exit", "code": exit_code}), self.loop
            )
            asyncio.run_coroutine_threadsafe(self._on_exit(), self.loop)

    async def _push_captures(self, data: str) -> None:
        """将 PTY 输出推给所有命令捕获队列（RunCommand 结果收集）。"""
        for q in list(self._cmd_captures.values()):
            q.put_nowait(data)

    async def _broadcast(self, payload: dict) -> None:
        for client in list(self.clients):
            try:
                await client.send_json(payload)
            except Exception:
                self.clients.discard(client)

    async def _on_exit(self) -> None:
        terminal_manager.remove(self.id)
        self.close()

    def add_client(self, websocket: Any) -> None:
        """注册 WS 客户端（API 层传入 FastAPI WebSocket 对象，核心层仅持有连接句柄）。"""
        self.clients.add(websocket)

    def remove_client(self, websocket: Any) -> None:
        self.clients.discard(websocket)

    def start_capture(self, cmd_id: str) -> asyncio.Queue:
        """注册命令输出捕获队列（RunCommand PTY 执行前调用）。"""
        q: asyncio.Queue = asyncio.Queue()
        self._cmd_captures[cmd_id] = q
        return q

    def stop_capture(self, cmd_id: str) -> None:
        """注销命令输出捕获队列（RunCommand 完成/超时后调用）。"""
        self._cmd_captures.pop(cmd_id, None)

    def write(self, data: str) -> None:
        if not self._closed and self.proc:
            try:
                self.proc.write(data)
            except Exception as e:
                logger.warning(f"[Terminal] write error {self.id}: {e}")

    def resize(self, cols: Optional[int], rows: Optional[int]) -> None:
        if not self._closed and self.proc and cols and rows:
            try:
                # pywinpty PtyProcess.setwinsize(rows, cols)：注意参数顺序
                self.proc.setwinsize(rows, cols)
                logger.info(f"[Terminal] resized {self.id} to {cols}x{rows}")
            except Exception as e:
                logger.warning(f"[Terminal] resize error {self.id}: {e}")

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self.proc:
                self.proc.close()
        except Exception as e:
            logger.warning(f"[Terminal] close error {self.id}: {e}")
        self.clients.clear()


class TerminalSessionManager:
    """全局终端会话管理（单例，仿 CommandRegistry）。"""

    _instance: Optional["TerminalSessionManager"] = None
    _sessions: Dict[str, TerminalSession] = {}

    def __new__(cls) -> "TerminalSessionManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def create(self, cwd: Optional[str] = None) -> TerminalSession:
        """创建新的 PTY 会话（spawn powershell）。"""
        if PtyProcess is None:
            raise RuntimeError("pywinpty 未安装：请执行 pip install pywinpty")

        terminal_id = f"term_{uuid.uuid4().hex[:8]}"
        workdir = cwd or os.getcwd()
        try:
            # Windows ConPTY：spawn PowerShell，默认 120x30 终端尺寸
            proc = PtyProcess.spawn("powershell.exe", cwd=workdir, dimensions=(30, 120))
        except Exception as e:
            logger.error(f"[Terminal] spawn powershell failed: {e}")
            raise RuntimeError(f"启动终端会话失败: {e}")

        loop = asyncio.get_running_loop()
        session = TerminalSession(terminal_id, proc, loop, workdir)
        self._sessions[terminal_id] = session
        logger.info(f"[Terminal] Created session {terminal_id} cwd={workdir}")
        return session

    def get(self, terminal_id: str) -> Optional[TerminalSession]:
        return self._sessions.get(terminal_id)

    def remove(self, terminal_id: str) -> None:
        self._sessions.pop(terminal_id, None)

    def close(self, terminal_id: str) -> bool:
        session = self._sessions.pop(terminal_id, None)
        if session:
            session.close()
            return True
        return False

    def get_all(self) -> Dict[str, TerminalSession]:
        return self._sessions.copy()


terminal_manager = TerminalSessionManager()
