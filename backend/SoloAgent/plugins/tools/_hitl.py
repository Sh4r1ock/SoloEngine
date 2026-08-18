# -*- coding: utf-8 -*-
"""
SoloEngine : 统一 HITL（Human-in-the-Loop）共享机制

@file _hitl.py
@description 风险操作统一批准 + 用户交互等待的共享实现
@author Sh4rlock
@date 2026-08-10

功能描述：
主流 AI IDE（Cursor / Claude Code / OpenCode / Cline / Windsurf 等）中，
所有风险操作（删除、写文件、执行命令、退出计划模式、向用户提问）统一走
"工具暂停等待用户决策 → 用户批准/驳回/输入 → 结果返回 Agent 继续" 的流程。

本模块抽取该流程的共享实现，供所有需要用户交互的工具复用：
- get_run_context()：获取当前执行的 run_context（经 execution_context_manager）
- await_user_message()：等待用户回答（业务消息队列），推送回答消费事件
- parse_approval()：解析批准/驳回文本
- request_approval()：统一风险操作批准入口

工具执行期间被 toolkit_executor await，本模块的 await 即实现"工具暂停等待用户"，
无需修改任何执行机制（react_core / run.py 等保持原样）。
"""

import asyncio
import logging
from typing import Optional, Dict, Any

from app.core.config import settings

logger = logging.getLogger(__name__)


def get_run_context():
    """
    获取当前执行的 run_context。

    通过 execution_context_manager（全局单例）匹配当前 asyncio task 对应的
    执行上下文，从而拿到 run_context._message_queue（业务消息队列）与
    run_context._send_event（事件推送）。

    Returns:
        AgenticFlowRunContext 或 None（非 Web 执行场景）。
    """
    from app.core.execution_context import execution_context_manager

    contexts = getattr(execution_context_manager, "_contexts", None)
    if not contexts:
        return None

    current = asyncio.current_task()
    with execution_context_manager._context_lock:
        # 精确匹配：当前 task 就是注册的执行 task
        if current is not None:
            for ctx in contexts.values():
                if ctx.task is current:
                    return ctx.run_context
        # 兜底：取第一个未完成执行的 run_context（单活跃执行场景）
        for ctx in contexts.values():
            if ctx.run_context is not None and not ctx.task.done():
                return ctx.run_context
    return None


async def await_user_message(run_context, description: str = "") -> str:
    """
    等待用户回答（从业务消息队列取一条用户消息）。

    工具被 await 期间 LLM 循环暂停等待；用户回答经前端 → WS execute →
    run.py enqueue_message 进入业务消息队列，此处取到后返回。
    回答被消费后推送 interaction_answer_received 事件，前端据此移除"排队消息"显示。

    Args:
        run_context: 当前执行的 run_context。
        description (str): 交互描述（仅用于日志）。

    Returns:
        str: 用户回答文本。

    Raises:
        asyncio.TimeoutError: 等待超时（settings.INTERACTION_TIMEOUT 秒）。
    """
    message_queue = getattr(run_context, "_message_queue", None)
    if message_queue is None:
        raise asyncio.TimeoutError("运行上下文无消息队列")

    try:
        msg = await asyncio.wait_for(
            message_queue.get(),
            timeout=settings.INTERACTION_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning(f"[HITL] 等待用户回答超时: {description[:80]}")
        raise asyncio.TimeoutError("等待用户回答超时")

    answer_text = msg.get_text_content() if hasattr(msg, "get_text_content") else str(msg)

    # 通知前端该回答已被工具消费，移除"排队消息"显示
    try:
        send_event = getattr(run_context, "_send_event", None)
        if send_event:
            await send_event({
                "event_type": "interaction_answer_received",
                "content": answer_text,
            })
    except Exception as e:
        logger.warning(f"[HITL] 推送回答消费事件失败: {e}")

    return answer_text


async def await_user_input(description: str = "") -> str:
    """
    统一等待用户输入/回答（唯一主干，无回退）。

    所有需要用户输入/审批的工具（AskUserQuestion / ExitPlanMode 等）
    复用此入口：获取当前 run_context（无则直接报错，不做任何回退），
    从业务消息队列等待用户回答并返回文本。

    Args:
        description (str): 交互描述（仅用于日志）。

    Returns:
        str: 用户回答文本。

    Raises:
        RuntimeError: 无 run_context（非 AgenticFlow 执行环境）。
        asyncio.TimeoutError: 等待超时。
    """
    run_context = get_run_context()
    if run_context is None:
        raise RuntimeError(
            "无运行上下文（run_context）：无法等待用户输入，"
            "工具必须在 AgenticFlow 执行环境中使用"
        )
    return await await_user_message(run_context, description)


def parse_approval(text: str) -> bool:
    """
    解析用户批准/驳回文本。

    支持前端固定格式（【批准】/【驳回】）与关键词兜底。

    Args:
        text (str): 用户回答文本。

    Returns:
        bool: True=批准，False=驳回。
    """
    if any(kw in text for kw in ["批准", "同意", "确认", "执行", "approve", "yes"]):
        return True
    if any(kw in text for kw in ["驳回", "拒绝", "取消", "不需要"]):
        return False
    return False


async def request_approval(description: str = "") -> Optional[bool]:
    """
    统一的风险操作批准入口。

    获取当前 run_context 并等待用户批准/驳回。所有风险工具
    （DeleteFile / RunCommand requires_approval / 退出计划模式等）
    统一调用本函数实现"执行前等待用户批准"。

    Args:
        description (str): 待批准操作的描述（用于日志）。

    Returns:
        Optional[bool]: True=用户批准，False=用户驳回或超时；
            无 run_context（非 Web 执行场景）返回 None，调用方自行决定放行策略。
    """
    run_context = get_run_context()
    if run_context is None:
        return None

    try:
        answer_text = await await_user_message(run_context, description)
    except asyncio.TimeoutError:
        return False

    return parse_approval(answer_text)


def get_run_mode() -> str:
    """
    读取 agenticflow 画布设置的运行模式（自动运行 / 每次询问 / 白名单）。

    数据来源：run_context._stored_canvas_data / _canvas_data 的
    globalSettings.runMode（画布设置保存后经 canvas_data 持久化）。

    Returns:
        str: 'auto' | 'ask' | 'allowlist'。默认 'ask'（每次询问，最安全，与主流一致）；
            非 Web 执行场景（无 run_context，无审批通道）返回 'auto'（自动执行）。
    """
    run_context = get_run_context()
    if run_context is None:
        return "auto"
    canvas_data = getattr(run_context, "_stored_canvas_data", None) or getattr(run_context, "_canvas_data", None) or {}
    global_settings = canvas_data.get("globalSettings", {}) or {}
    mode = global_settings.get("runMode", "ask")
    if mode not in ("auto", "ask", "allowlist"):
        return "ask"
    return mode


def get_command_allowlist() -> list:
    """
    读取 agenticflow 画布设置的命令白名单（用户可自行添加的命令前缀列表）。

    Returns:
        list: 白名单命令前缀列表（空列表 = 无白名单）。
    """
    run_context = get_run_context()
    if run_context is None:
        return []
    canvas_data = getattr(run_context, "_stored_canvas_data", None) or getattr(run_context, "_canvas_data", None) or {}
    global_settings = canvas_data.get("globalSettings", {}) or {}
    return global_settings.get("commandAllowlist", []) or []


def get_terminal_id() -> Optional[str]:
    """
    读取前端当前激活的终端会话 ID（terminal_attach WS 消息写入 run_context）。

    前端决定"命令执行在哪个终端"（用户正在查看的终端），RunCommand 经本共享入口
    读取目标终端——关联决策在前端，工具不感知前端，实现前端与工具联动独立。

    Returns:
        Optional[str]: 目标终端 ID；无 run_context 或未指定时返回 None
            （None = 未指定，由调用方回退到默认会话选择）。
    """
    run_context = get_run_context()
    if run_context is None:
        return None
    return getattr(run_context, "_active_terminal_id", None)


PLAN_MODE_ATTR = "_plan_mode"


def is_plan_mode(run_context) -> bool:
    """判断当前是否处于 Plan 模式（read-only 锁定）。

    无 run_context 时 getattr 默认返回 False：plan 模式状态仅存在于 run_context 上，
    而 EnterPlanMode 在无 run_context 时直接报错、无法进入 plan 模式，
    故"无 run_context 不可能处于 plan 模式"是逻辑必然，非兜底。

    Args:
        run_context: 当前执行的 run_context（可为 None）。

    Returns:
        bool: True=处于 Plan 模式（read-only 锁定），False=执行模式。
    """
    return bool(getattr(run_context, PLAN_MODE_ATTR, False))


def set_plan_mode(run_context, value: bool) -> None:
    """设置/清除 Plan 模式状态（动态属性，不改 run_context 源码）。

    调用方（EnterPlanMode/ExitPlanMode）保证 run_context 存在（无 run_context 已直接报错），
    因此不做空值判断，直接 setattr。

    Args:
        run_context: 当前执行的 run_context。
        value (bool): True=进入 Plan 模式，False=退出 Plan 模式。
    """
    setattr(run_context, PLAN_MODE_ATTR, value)


def plan_mode_guard(tool_name: str) -> Optional[Dict[str, Any]]:
    """修改类工具守卫：处于 Plan 模式时返回拒绝结果，否则返回 None。

    唯一分支为守卫拦截判定本身（极特殊点位），无任何兜底。

    Args:
        tool_name (str): 调用守卫的工具名（用于拒绝结果 metadata 定位）。

    Returns:
        Optional[Dict[str, Any]]: Plan 模式下返回拒绝结果（含 plan_mode_blocked 标记，
            前端据此渲染"计划模式下禁止修改"提示）；非 Plan 模式返回 None（放行原路径）。
    """
    if is_plan_mode(get_run_context()):
        return {
            "content": "当前处于计划模式（read-only），禁止修改操作。"
                       "请调用 ExitPlanMode 提交计划，获得用户批准后再执行。",
            "success": False,
            "error_message": "Plan mode 下禁止修改操作",
            "plan_mode_blocked": True,
            "metadata": {"tool_name": tool_name},
        }
    return None
