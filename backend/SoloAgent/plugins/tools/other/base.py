# -*- coding: utf-8 -*-
"""
其他工具基类模块。

@file base.py
@description 提供其他辅助工具的公共功能和基类定义
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 定义其他工具错误基类
- 定义其他工具基类
- 提供统一的响应格式

其他工具类型：
    - ExitPlanMode: 退出计划模式工具
    - OpenPreview: 打开预览工具

设计理念：
    其他工具是一类辅助性工具，它们：
    1. 提供特定的控制功能
    2. 与前端交互
    3. 不涉及复杂的Agent逻辑

使用场景：
    - ExitPlanMode: 用户批准后退出计划模式
    - OpenPreview: 向用户展示预览URL

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class OtherToolError(Exception):
    """
    其他工具错误基类。
    
    所有其他工具相关错误的基类，提供统一的错误处理接口。
    
    Attributes:
        message (str): 错误消息
        error_code (str): 错误代码
        details (dict): 错误详情
    
    Example:
        >>> raise OtherToolError(
        ...     message="预览URL无效",
        ...     error_code="INVALID_PREVIEW_URL",
        ...     details={"url": "invalid_url"}
        ... )
    """
    
    def __init__(
        self,
        message: str,
        error_code: str = "OTHER_TOOL_ERROR",
        details: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        初始化其他工具错误。
        
        Args:
            message (str): 错误消息。
            error_code (str, optional): 错误代码。默认为 "OTHER_TOOL_ERROR"。
            details (dict, optional): 错误详情。默认为 None。
        """
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.details = details or {}
    
    def to_dict(self) -> Dict[str, Any]:
        """
        转换为字典格式。
        
        Returns:
            Dict[str, Any]: 包含错误信息的字典。
        """
        return {
            "error_message": self.message,
            "error_code": self.error_code,
            "details": self.details
        }


@dataclass
class ToolAction:
    """
    工具动作数据类。
    
    定义工具执行后需要前端执行的动作。
    
    Attributes:
        action_type (str): 动作类型
        action_data (Dict[str, Any]): 动作数据
        message (str): 用户消息
        requires_confirmation (bool): 是否需要用户确认
    
    Example:
        >>> action = ToolAction(
        ...     action_type="open_preview",
        ...     action_data={"url": "http://localhost:3000"},
        ...     message="预览已就绪"
        ... )
    """
    action_type: str = ""
    action_data: Dict[str, Any] = field(default_factory=dict)
    message: str = ""
    requires_confirmation: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        """
        转换为字典格式。
        
        Returns:
            Dict[str, Any]: 动作字典。
        """
        return {
            "action_type": self.action_type,
            "action_data": self.action_data,
            "message": self.message,
            "requires_confirmation": self.requires_confirmation
        }


class BaseOtherTool(ABC):
    """
    其他工具基类。
    
    所有其他工具的抽象基类，定义公共接口和功能。
    
    核心功能：
        1. 动作生成：生成需要前端执行的动作
        2. 错误处理：统一的错误处理机制
        3. 工具规范：定义工具的规范格式
    
    子类需要实现：
        - execute(): 执行工具逻辑
        - get_tool_spec(): 获取工具规范
    
    Example:
        >>> class MyOtherTool(BaseOtherTool):
        ...     async def execute(self, **kwargs) -> Dict[str, Any]:
        ...         return {"result": "success"}
        ...
        ...     def get_tool_spec(self) -> Dict[str, Any]:
        ...         return {
        ...             "name": "my_tool",
        ...             "description": "我的工具",
        ...             "parameters": {}
        ...         }
    
    Note:
        - 所有其他工具都应该继承此类
        - execute方法应该是异步的
        - 工具规范应该兼容OpenAI Function Calling格式
    """
    
    def __init__(self) -> None:
        """初始化其他工具。"""
        self._last_action: Optional[ToolAction] = None
    
    @abstractmethod
    async def execute(self, **kwargs) -> Dict[str, Any]:
        """
        执行工具逻辑。
        
        子类必须实现此方法，定义工具的具体执行逻辑。
        
        Args:
            **kwargs: 工具参数
        
        Returns:
            Dict[str, Any]: 执行结果
        
        Raises:
            OtherToolError: 执行失败时抛出
        """
    
    @abstractmethod
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取工具规范。
        
        返回工具的规范定义，用于注册到工具执行器。
        
        Returns:
            Dict[str, Any]: 工具规范，格式兼容OpenAI Function Calling：
                - name: 工具名称
                - description: 工具描述
                - parameters: 参数规范（JSON Schema）
        """
    
    def create_action(
        self,
        action_type: str,
        action_data: Dict[str, Any],
        message: str = "",
        requires_confirmation: bool = False
    ) -> ToolAction:
        """
        创建工具动作。
        
        Args:
            action_type (str): 动作类型
            action_data (Dict[str, Any]): 动作数据
            message (str, optional): 用户消息。默认为 ""。
            requires_confirmation (bool, optional): 是否需要确认。默认为 False。
        
        Returns:
            ToolAction: 创建的动作对象
        """
        action = ToolAction(
            action_type=action_type,
            action_data=action_data,
            message=message,
            requires_confirmation=requires_confirmation
        )
        self._last_action = action
        return action
    
    def get_last_action(self) -> Optional[ToolAction]:
        """
        获取最近创建的动作。
        
        Returns:
            Optional[ToolAction]: 最近创建的动作，如果没有返回 None。
        """
        return self._last_action
    
    def create_error_response(
        self,
        message: str,
        error_code: str = "EXECUTION_ERROR",
        details: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        创建错误响应。
        
        Args:
            message (str): 错误消息
            error_code (str, optional): 错误代码。默认为 "EXECUTION_ERROR"。
            details (dict, optional): 错误详情。默认为 None。
        
        Returns:
            Dict[str, Any]: 错误响应字典
        """
        return {
            "success": False,
            "content": message,
            "error_message": message,
            "error_code": error_code,
            "details": details or {},
            "metadata": {}
        }
    
    def create_success_response(
        self,
        content: Any,
        action: Optional[ToolAction] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        创建成功响应。
        
        Args:
            content (Any): 响应内容
            action (ToolAction, optional): 工具动作。默认为 None。
            metadata (dict, optional): 额外元数据。默认为 None。
        
        Returns:
            Dict[str, Any]: 成功响应字典
        """
        response = {
            "success": True,
            "content": content,
            "error_message": None,
            "metadata": metadata or {}
        }
        
        if action:
            response["action"] = action.to_dict()
        
        return response
