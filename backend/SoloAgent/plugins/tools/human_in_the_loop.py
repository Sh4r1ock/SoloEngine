# -*- coding: utf-8 -*-
"""
SoloEngine : 统一 HITL（Human-in-the-Loop）共享机制

@file human_in_the_loop.py
@description 风险操作统一批准 + 用户交互等待的共享实现
@author Sh4rlock
@date 2026-08-10

功能描述：
主流 AI IDE（Cursor / Claude Code / OpenCode / Cline / Windsurf 等）中，
所有风险操作（删除、写文件、执行命令、退出计划模式、向用户提问）统一走
"工具暂停等待用户决策 → 用户批准/驳回/输入 → 结果返回 Agent 继续" 的流程。

本模块抽取该流程的共享实现，供所有需要用户交互的工具复用：
- get_run_context()：获取当前执行的 run_context（经 execution_context_manager）
- wait_for_user_message()：等待用户回答（pending_interaction Future 直接送达），推送回答消费事件
- parse_approval()：解析批准/驳回文本
- request_approval()：统一风险操作批准入口

工具执行期间被 toolkit_executor await，本模块的 await 即实现"工具暂停等待用户"，
无需修改任何执行机制（react_core / run.py 等保持原样）。
"""

import asyncio
import logging
from typing import Optional, Dict, Any

from SoloAgent.config import settings
from ...utils.context_vars import tool_call_id_var

logger = logging.getLogger("SoloEngine")


def get_run_context():
    """
    获取当前执行的 run_context。

    通过 execution_context_manager（全局单例）匹配当前 asyncio task 对应的
    执行上下文，从而拿到 run_context._send_event（事件推送）与回答送达通道
    (pending_interaction Future 按 tool_call_id 直达，见 wait_for_user_message)。

    Returns:
        AgenticFlowRunContext 或 None（非 Web 执行场景）。
    """
    from app.core.execution_context import execution_context_manager

    # C5：经公开方法获取快照（锁在管理器的公开方法内部持有），
    # 不再直接读 execution_context_manager._contexts / _context_lock 私有属性
    contexts = execution_context_manager.get_contexts_snapshot()
    if not contexts:
        return None

    current = asyncio.current_task()
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


async def wait_for_user_message(run_context, description: str = "") -> str:
    """
    等待用户回答（工具自身 await 等待，回答直接送达）。

    工具被 await 期间 LLM 循环暂停等待；工具在此创建 Future 并按 tool_call_id 注册到
    run_context._pending_interactions（回答送达点，Dict），用户回答经前端 → WS
    interaction_answer（携带 tool_call_id）→ 事件循环按 id set_result 直接送达本 Future——
    回答零队列中转，完全复用工具自身的 await 等待操作；并发工具各自 Future 独立注册，
    按 id 精确路由互不覆盖（单槽位覆盖 bug 根治）。
    回答被消费后推送 interaction_answer_received 事件，前端据此移除"排队消息"显示。

    Args:
        run_context: 当前执行的 run_context。
        description (str): 交互描述（仅用于日志）。

    Returns:
        str: 用户回答文本。

    Raises:
        asyncio.TimeoutError: 等待超时（settings.INTERACTION_TIMEOUT 秒）。
    """
    # 回答送达点：工具 await 的 Future 按 tool_call_id 注册到 run_context._pending_interactions。
    # react_core._execute_single_tool 已把当前工具 id 注入 contextvar（并发工具各自 task 隔离），
    # 前端审批回答携带 tool_call_id 精确路由——并发审批各工具独立送达，互不覆盖（单槽位覆盖 bug 根治）。
    # 业务排队消息（execute → _message_queue）走队列，审批/提问回答走 Future 直接送达，
    # 两者机制本质隔离（队列 vs 直接送达），审批等待绝不会误取排队消息。
    loop = asyncio.get_event_loop()
    future = loop.create_future()
    tool_call_id = tool_call_id_var.get() or ""
    # C5：经 run_context 公开方法注册/移除回答送达点（不直接读写 _pending_interactions 私有字段）
    run_context.add_pending_interaction(tool_call_id, future)

    try:
        await asyncio.wait_for(future, timeout=settings.INTERACTION_TIMEOUT)
    except asyncio.TimeoutError:
        logger.warning(f"[HITL] 等待用户回答超时: {description[:80]}")
        raise asyncio.TimeoutError("等待用户回答超时")
    finally:
        # 无论成功/超时/取消都清除送达点，避免残留 future 被后续回答误 set_result
        run_context.remove_pending_interaction(tool_call_id)

    answer_text = future.result() if not future.cancelled() else ""

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


def parse_approval_response(text: str, approve_first: bool = False) -> Dict[str, Any]:
    """
    统一解析用户审批决策文本（R2：human_in_the_loop.parse_approval 与 exit_plan_mode._parse_approval 合并的唯一实现）。

    输出标准结构 {"approved": bool, "action": "approve"|"skip"|"modify", "feedback": str}，
    各消费方经该结构适配自身语义（返回值结构差异交由消费方，解析逻辑统一）：

    - approve_first=True（bool 消费方：parse_approval / request_approval）：
      语义 = 批准词优先匹配（substring、大小写敏感），无匹配默认未批准（approved=False）。
      与原 human_in_the_loop.parse_approval 行为逐字保真。
    - approve_first=False（dict 消费方：ExitPlanMode 计划审批）：
      语义 = 三分支（approve/skip/modify），拒绝词优先匹配（大小写不敏感），
      无匹配默认 modify（留在计划模式）。与原 exit_plan_mode._parse_approval 行为逐字保真。

    Args:
        text (str): 用户回答文本。
        approve_first (bool): True=批准词优先（bool 消费语义）；False=拒绝词优先（dict 三分支语义）。

    Returns:
        Dict[str, Any]: 标准审批结果 {approved, action, feedback}
    """
    stripped = text.strip()

    if stripped.startswith("【执行】"):
        return {"approved": True, "action": "approve", "feedback": stripped}
    if stripped.startswith("【批准】"):
        return {"approved": True, "action": "approve", "feedback": stripped}
    if stripped.startswith("【跳过】"):
        return {"approved": False, "action": "skip", "feedback": stripped}
    if stripped.startswith("【驳回】"):
        return {"approved": False, "action": "skip", "feedback": stripped}
    if stripped.startswith("【修改】"):
        return {"approved": False, "action": "modify", "feedback": stripped}

    if approve_first:
        # bool 消费方（原 parse_approval 词集/顺序/大小写敏感保真）
        approve_keywords = ["批准", "同意", "确认", "执行", "approve", "yes"]
        reject_keywords = ["驳回", "拒绝", "取消", "不需要"]
        for keyword in approve_keywords:
            if keyword in text:
                return {"approved": True, "action": "approve", "feedback": stripped}
        for keyword in reject_keywords:
            if keyword in text:
                return {"approved": False, "action": "skip", "feedback": stripped}
        return {"approved": False, "action": "skip", "feedback": stripped}

    # dict 消费方（原 exit_plan_mode._parse_approval 词集/顺序/大小写不敏感保真：拒绝词优先）
    lowered = stripped.lower()
    reject_keywords = ["跳过", "驳回", "拒绝", "不同意", "取消", "不需要", "停止"]
    approve_keywords = ["执行", "批准", "同意", "确认", "可以", "开始", "approve", "yes"]
    for keyword in reject_keywords:
        if keyword in lowered:
            return {"approved": False, "action": "skip", "feedback": stripped}
    for keyword in approve_keywords:
        if keyword in lowered:
            return {"approved": True, "action": "approve", "feedback": stripped}
    return {"approved": False, "action": "modify", "feedback": stripped}


def parse_approval(text: str) -> bool:
    """
    解析用户批准/驳回文本。

    支持前端固定格式（【批准】/【驳回】）与关键词兜底。
    统一复用 parse_approval_response（approve_first=True），bool 语义与原实现完全一致。

    Args:
        text (str): 用户回答文本。

    Returns:
        bool: True=批准，False=驳回。
    """
    return parse_approval_response(text, approve_first=True)["approved"]


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
        answer_text = await wait_for_user_message(run_context, description)
    except asyncio.TimeoutError:
        return False

    parsed = parse_approval(answer_text)
    return parsed


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
