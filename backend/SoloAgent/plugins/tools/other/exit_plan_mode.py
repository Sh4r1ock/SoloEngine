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
import logging

from .base import BaseOtherTool

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
        
        content = self._generate_exit_message()
        
        return self.create_success_response(
            content=content,
            action=action,
            metadata={
                "plan_content": self._plan_content,
                "plan_steps_count": len(self._plan_steps),
                "is_approved": self._is_approved
            }
        )
    
    def _generate_exit_message(self) -> str:
        """
        生成退出计划模式的消息。
        
        Returns:
            str: 消息内容
        """
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
                "在计划制定完成后调用此工具，等待用户批准后开始执行。"
                "此工具不需要任何参数。"
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            }
        }

