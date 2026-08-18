# -*- coding: utf-8 -*-
"""
EnterPlanMode工具模块 - 进入计划模式实现。

@file enter_plan_mode.py
@description EnterPlanMode工具 - 请求进入计划模式（需用户批准）
@author SoloEngine Team
@date 2026-08-13

功能描述：
- LLM 请求进入 Plan 模式（read-only 锁定）
- 进入前等待用户批准（HITL）
- 批准后设置 run_context._plan_mode = True
- 计划模式（只读）：禁止修改文件或执行命令，仅可探索代码、澄清需求、制定计划
- 计划完成后必须调用 ExitPlanMode 提交计划并获得用户批准，才能退出计划模式开始执行

设计要点：
- 无 run_context（非 Web 场景）：直接报错，严禁回退（对齐 ExitPlanMode）
- 等待用户批准：复用 _hitl.await_user_message + parse_approval（与 ExitPlanMode._await_approval 一致）
- 等待超时：显式返回未进入结果（对齐 ExitPlanMode 超时处理，非兜底）
- 批准进入后初始化 PlanNotebookPlugin（storage_path 显式取项目工作目录，不依赖默认值兜底）

状态: ✅ 完整实现
"""

import asyncio
import logging
import os
from typing import Dict, Any, Optional

from .base import BaseOtherTool
from .._hitl import get_run_context, await_user_message, parse_approval, set_plan_mode
from ...plan import PlanNotebookPlugin
from app.core.data_paths import DataPaths

logger = logging.getLogger(__name__)


class EnterPlanModeTool(BaseOtherTool):
    """
    EnterPlanMode工具 - 进入计划模式。

    用于在复杂任务开始前请求进入计划模式（read-only 锁定），需用户批准。

    核心功能：
        1. 获取 run_context（无则直接报错，严禁回退）
        2. 等待用户批准进入计划模式
        3. 批准后设置 _plan_mode = True（read-only 锁定生效）
        4. 初始化 PlanNotebookPlugin（storage_path 显式取项目工作目录）供计划持久化
    """

    async def execute(
        self,
        reason: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行EnterPlanMode工具 - 请求进入计划模式。

        Args:
            reason (str, optional): 进入计划模式的原因（供前端展示）。
            **kwargs: 额外参数（忽略）。

        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success (bool): 是否成功
                - entered (bool): 是否已进入计划模式
                - plan_mode (bool): 当前是否处于计划模式
                - content (str): 状态消息

        Raises:
            RuntimeError: 无 run_context（非 AgenticFlow 执行环境）。
        """
        # 1. 获取 run_context（共享 _hitl.get_run_context）
        run_context = get_run_context()
        # 2. 无 run_context（非 Web 场景）：直接报错，严禁回退（对齐 ExitPlanMode 现有规范）
        if run_context is None:
            raise RuntimeError(
                "无运行上下文（run_context）：无法等待用户批准，"
                "EnterPlanMode 工具必须在 AgenticFlow 执行环境中使用"
            )
        # 3. 等待用户批准进入 Plan 模式（共享 await_user_message + parse_approval，
        #    与 ExitPlanMode._await_approval 交互模式完全一致，不依赖任何回退语义）
        try:
            answer_text = await await_user_message(run_context, "进入计划模式确认")
        except asyncio.TimeoutError:
            # 等待超时：显式返回未进入结果（对齐 ExitPlanMode 超时处理，非兜底）
            return {
                "success": False,
                "entered": False,
                "plan_mode": False,
                "error_message": "等待用户批准进入计划模式超时",
                "content": "等待用户批准超时，未进入计划模式。",
            }
        # 4. 批准 → 设置 plan 模式；驳回 → 不进入（用户交互决策分支，极特殊点位）
        if parse_approval(answer_text):
            set_plan_mode(run_context, True)
            # 推送 plan_mode_changed 事件（前端 RunPanel 更新状态徽标；失败仅告警不中断）
            try:
                await run_context._send_event({
                    "event_type": "plan_mode_changed",
                    "plan_mode": True,
                })
            except Exception as e:
                logger.warning(f"[EnterPlanMode] 推送 plan_mode_changed 事件失败: {e}")
            # 批准进入后初始化 PlanNotebookPlugin：storage_path 显式取统一数据目录下的专用计划存储
            # data/plans/{user_id}（严禁使用项目工作目录——PlanMemory._load_plans 会误扫工作目录
            # 全部 *.json（如 .eslintrc.json/package.json）报 'plan_id' 错误且污染用户目录；也严禁
            # 依赖 PlanMemory 默认 Path("plans") 兜底）
            plans_dir = os.path.join(DataPaths.get_data_root(), "plans", run_context.user_id)
            PlanNotebookPlugin(storage_path=plans_dir)
            logger.info(f"[EnterPlanMode] Entered plan mode, reason: {reason}")
            return {
                "success": True,
                "entered": True,
                "plan_mode": True,
                "content": "已进入计划模式（只读）。禁止修改文件或执行命令，"
                           "仅可探索代码、澄清需求、制定计划。计划完成后必须调用 "
                           "ExitPlanMode 提交计划并获得用户批准，才能退出计划模式开始执行。",
                "metadata": {"plan_mode": True},
            }
        return {
            "success": True,
            "entered": False,
            "plan_mode": False,
            "content": "用户未批准进入计划模式，保持执行模式。",
            "metadata": {"plan_mode": False},
        }

    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取EnterPlanMode工具规范。

        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式。
        """
        return {
            "name": "EnterPlanMode",
            "description": (
                "进入计划模式。适用于需要先规划再执行的中大型任务。"
                "调用后工具会暂停等待用户批准进入；进入后处于只读模式，"
                "禁止修改文件或执行命令，仅可探索代码、澄清需求、制定计划。"
                "计划完成后必须调用 ExitPlanMode 提交计划并获得用户批准，才能退出计划模式开始执行。"
                "可选参数 reason 说明进入计划模式的原因。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "进入计划模式的原因（可选）。",
                    }
                },
                "required": [],
            }
        }
