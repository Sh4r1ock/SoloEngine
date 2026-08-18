# -*- coding: utf-8 -*-
"""
ExitPlanMode工具模块 - 退出计划模式实现。

@file exit_plan_mode.py
@description ExitPlanMode工具 - 用户批准后退出计划模式
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 在用户批准后退出计划模式
- 无需参数
- 返回动作状态

计划模式说明：
    计划模式是Agent的一种特殊工作模式：
    1. Agent首先制定执行计划
    2. 计划展示给用户审批
    3. 用户批准后退出计划模式
    4. Agent开始执行计划

设计理念：
    ExitPlanMode工具用于标记计划审批完成：
    1. Agent在计划准备好后调用此工具
    2. 前端收到动作后展示计划给用户
    3. 用户批准后Agent继续执行

使用场景：
    - Agent完成计划制定
    - 需要用户确认计划
    - 从计划模式切换到执行模式

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional
import asyncio
import logging
import os

from .base import BaseOtherTool
from .._hitl import get_run_context, await_user_message, set_plan_mode
from ...plan import PlanNotebookPlugin
from app.core.data_paths import DataPaths

logger = logging.getLogger(__name__)


class ExitPlanModeTool(BaseOtherTool):
    """
    ExitPlanMode工具 - 退出计划模式。
    
    用于在用户批准后退出计划模式，切换到执行模式。
    
    核心功能：
        1. 生成退出计划模式的动作
        2. 通知前端计划已准备好
        3. 等待用户确认
    
    工作流程：
        1. Agent完成计划制定
        2. 调用ExitPlanMode工具
        3. 前端收到动作，展示计划
        4. 用户批准
        5. Agent继续执行
    
    Example:
        >>> exit_tool = ExitPlanModeTool()
        >>> result = await exit_tool.execute()
        >>> print(result["content"])
        计划已准备好，等待用户批准。
    
    Note:
        - 此工具不需要参数
        - 返回的动作需要前端处理
        - 用户确认后Agent才能继续
    """
    
    def __init__(
        self,
        plan_content: Optional[str] = None,
        plan_steps: Optional[list] = None
    ) -> None:
        """
        初始化ExitPlanMode工具。
        
        Args:
            plan_content (str, optional): 计划内容。默认为 None。
            plan_steps (list, optional): 计划步骤列表。默认为 None。
        """
        super().__init__()
        self._plan_content = plan_content
        self._plan_steps = plan_steps or []
        self._is_approved = False
    
    async def execute(
        self,
        plan_content: Optional[str] = None,
        plan_steps: Optional[list] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行ExitPlanMode工具 - 生成退出计划模式动作。
        
        创建一个动作，通知前端计划已准备好，等待用户批准。
        
        Args:
            plan_content (str, optional): 计划内容描述。
                如果不提供，使用初始化时设置的内容。
            plan_steps (list, optional): 计划步骤列表。
                如果不提供，使用初始化时设置的步骤。
            **kwargs: 额外参数（忽略）。
        
        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success (bool): 是否成功
                - content (str): 状态消息
                - action (dict): 前端需要执行的动作
                - metadata (dict): 计划相关元数据
        
        Example:
            >>> result = await exit_tool.execute(
            ...     plan_content="实现用户登录功能",
            ...     plan_steps=["创建登录表单", "验证用户输入", "处理登录请求"]
            ... )
        """
        if plan_content:
            self._plan_content = plan_content
        if plan_steps:
            self._plan_steps = plan_steps

        action = self.create_action(
            action_type="exit_plan_mode",
            action_data={
                "plan_content": self._plan_content or "计划已准备好",
                "plan_steps": self._plan_steps,
                "requires_approval": True
            },
            message="计划已准备好，等待用户批准后执行。",
            requires_confirmation=True
        )

        # 真实交互：等待用户在工具调用面板中批准/驳回/修改计划。
        # 用户决策经前端 → WS execute → run.py enqueue_message 进入业务消息队列，
        # await_user_message 内部 await 该队列即实现"工具暂停等待用户批准"。
        run_context = get_run_context()
        if run_context is not None:
            try:
                approval = await self._await_approval(run_context)
            except asyncio.TimeoutError:
                self._is_approved = False
                return {
                    "success": False,
                    "content": "等待用户批准超时，计划未获批准。",
                    "error_message": "等待用户批准超时",
                    "is_approved": False,
                    "action": action.to_dict(),
                    "metadata": {
                        "plan_content": self._plan_content,
                        "plan_steps_count": len(self._plan_steps),
                        "is_approved": False
                    }
                }

            self._is_approved = bool(approval.get("approved", False))
            logger.info(f"[ExitPlanMode] Plan approval result: {approval}")

            # Plan 模式联动：批准(approve)/驳回(skip) → 退出计划模式（恢复写权限）；
            # 修改(modify) → 留在计划模式（只读，继续调整计划）。
            # action 值来自 _parse_approval：approve / skip / modify（无布尔 if，布尔表达式即三分支语义）。
            new_plan_mode = approval.get("action") == "modify"
            set_plan_mode(run_context, new_plan_mode)
            # 推送 plan_mode_changed 事件（前端 RunPanel 更新状态徽标；失败仅告警不中断）
            try:
                await run_context._send_event({
                    "event_type": "plan_mode_changed",
                    "plan_mode": new_plan_mode,
                })
            except Exception as e:
                logger.warning(f"[ExitPlanMode] 推送 plan_mode_changed 事件失败: {e}")

            # 计划持久化：收到 plan_content/plan_steps 时调用 create_plan 一次性持久化计划
            # （storage_path 显式取统一数据目录下的专用计划存储 data/plans/{user_id}，
            # 严禁使用项目工作目录——污染用户目录且 Permission denied；严禁依赖默认值兜底）
            if self._plan_content:
                plans_dir = os.path.join(DataPaths.get_data_root(), "plans", run_context.user_id)
                planner = PlanNotebookPlugin(storage_path=plans_dir)
                await planner.create_plan(goal=self._plan_content, steps=self._plan_steps)

            return {
                "success": True,
                "content": self._format_approval_content(approval),
                "is_approved": self._is_approved,
                "approval": approval,
                "action": action.to_dict(),
                "metadata": {
                    "plan_content": self._plan_content,
                    "plan_steps_count": len(self._plan_steps),
                    "is_approved": self._is_approved,
                    "plan_mode": new_plan_mode,
                }
            }

        # 无 run_context（非 Web 执行场景）：直接报错，严禁回退。
        # 工具必须真实等待用户批准/驳回/修改，失败即显式报错（对齐 _hitl.await_user_input）。
        raise RuntimeError(
            "无运行上下文（run_context）：无法等待用户批准，"
            "ExitPlanMode 工具必须在 AgenticFlow 执行环境中使用"
        )

    async def _await_approval(self, run_context) -> Dict[str, Any]:
        """
        等待用户对计划的审批决策。

        Args:
            run_context: 当前执行的 run_context。

        Returns:
            Dict[str, Any]: 审批结果，包含：
                - approved (bool): 是否批准
                - action (str): approve / reject / modify
                - feedback (str): 用户原始反馈

        Raises:
            asyncio.TimeoutError: 等待审批超时。
        """
        answer_text = await await_user_message(run_context, "计划审批")
        return self._parse_approval(answer_text)

    @staticmethod
    def _parse_approval(text: str) -> Dict[str, Any]:
        """
        解析用户审批决策文本。

        支持前端固定格式（【执行】/【跳过】/【修改】）与关键词兜底。

        Args:
            text (str): 用户回答文本。

        Returns:
            Dict[str, Any]: 审批结果 {approved, action, feedback}
        """
        stripped = text.strip()

        if stripped.startswith("【执行】"):
            return {"approved": True, "action": "approve", "feedback": stripped}
        if stripped.startswith("【跳过】"):
            return {"approved": False, "action": "skip", "feedback": stripped}
        if stripped.startswith("【修改】"):
            return {"approved": False, "action": "modify", "feedback": stripped}

        reject_keywords = ["跳过", "驳回", "拒绝", "不同意", "取消", "不需要", "停止"]
        approve_keywords = ["执行", "批准", "同意", "确认", "可以", "开始", "approve", "yes"]

        lowered = stripped.lower()
        for keyword in reject_keywords:
            if keyword in lowered:
                return {"approved": False, "action": "skip", "feedback": stripped}
        for keyword in approve_keywords:
            if keyword in lowered:
                return {"approved": True, "action": "approve", "feedback": stripped}

        return {"approved": False, "action": "modify", "feedback": stripped}

    @staticmethod
    def _format_approval_content(approval: Dict[str, Any]) -> str:
        """
        格式化用户审批决策为结构化文本（供 LLM 直接消费）。

        Args:
            approval (Dict[str, Any]): 审批结果 {approved, action, feedback}

        Returns:
            str: 结构化审批结果描述
        """
        action = approval.get("action", "modify")
        feedback = approval.get("feedback", "")
        if action == "approve":
            return "Plan approved by user. Proceed with execution."
        if action == "skip":
            return "Plan skipped by user. Do not proceed with this plan."
        return f"User requested plan modifications: {feedback}"

    def _generate_exit_message(self, approved: bool = False) -> str:
        """
        生成退出计划模式的消息。

        Args:
            approved (bool): 是否已批准。

        Returns:
            str: 消息内容
        """
        if approved:
            return "【计划已批准】用户已批准该计划，开始按计划执行。"
        if self._plan_content:
            message = f"【计划已准备好】\n\n{self._plan_content}\n\n"
            if self._plan_steps:
                message += "执行步骤：\n"
                for i, step in enumerate(self._plan_steps, 1):
                    message += f"{i}. {step}\n"
            message += "\n等待用户批准后开始执行。"
        else:
            message = "计划已准备好，等待用户批准后开始执行。"

        return message
    
    def set_approved(self, approved: bool = True) -> None:
        """
        设置计划是否已被批准。
        
        Args:
            approved (bool, optional): 是否批准。默认为 True。
        """
        self._is_approved = approved
    
    def is_approved(self) -> bool:
        """
        检查计划是否已被批准。
        
        Returns:
            bool: 是否已批准
        """
        return self._is_approved
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取ExitPlanMode工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式。
        """
        return {
            "name": "ExitPlanMode",
            "description": (
                "退出计划模式。"
                "在计划制定完成后调用此工具，将实施计划提交给用户审批。"
                "调用后工具会暂停等待用户批准/驳回/修改，用户批准后"
                "Agent 才能继续执行计划。"
                "可传入plan_content（计划内容描述）与plan_steps（执行步骤列表）"
                "以便前端展示完整计划。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "plan_content": {
                        "type": "string",
                        "description": "计划内容描述（Markdown 格式），将展示给用户审批",
                    },
                    "plan_steps": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "执行步骤列表，每项为一个步骤描述",
                    }
                },
                "required": [],
            }
        }

