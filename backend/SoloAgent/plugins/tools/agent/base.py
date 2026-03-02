# -*- coding: utf-8 -*-
"""
Agent工具基类模块。

@file base.py
@description 提供Agent工具的公共功能和基类定义
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 定义Agent工具错误基类
- 定义Agent工具基类
- 提供上下文管理功能
- 提供工具权限控制功能

Agent工具类型：
    - Task: 任务执行工具，启动专门的子Agent处理任务
    - Skill: 技能调用工具，在主对话中执行技能

设计理念：
    Agent工具是一类特殊的工具，它们可以：
    1. 创建和管理子Agent
    2. 注入技能上下文
    3. 控制工具权限

使用场景：
    - Task工具：需要专门Agent处理的复杂任务
    - Skill工具：需要注入特定上下文的技能调用

状态: ✅ 完整实现
"""

from typing import Dict, Any, List, Optional, Set
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class AgentToolError(Exception):
    """
    Agent工具错误基类。
    
    所有Agent工具相关错误的基类，提供统一的错误处理接口。
    
    Attributes:
        message (str): 错误消息
        error_code (str): 错误代码
        details (dict): 错误详情
    
    Example:
        >>> raise AgentToolError(
        ...     message="SubAgent启动失败",
        ...     error_code="SUBAGENT_ERROR",
        ...     details={"reason": "模型不可用"}
        ... )
    """
    
    def __init__(
        self,
        message: str,
        error_code: str = "AGENT_TOOL_ERROR",
        details: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        初始化Agent工具错误。
        
        Args:
            message (str): 错误消息。
            error_code (str, optional): 错误代码。默认为 "AGENT_TOOL_ERROR"。
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
            "error": True,
            "error_code": self.error_code,
            "message": self.message,
            "details": self.details
        }


@dataclass
class ToolContext:
    """
    工具上下文数据类。
    
    存储工具执行时的上下文信息，包括会话信息、用户信息等。
    
    Attributes:
        session_id (str): 会话ID
        user_id (str): 用户ID
        agent_id (str): Agent ID
        conversation_history (List[Dict]): 对话历史
        metadata (Dict[str, Any]): 额外元数据
    
    Example:
        >>> context = ToolContext(
        ...     session_id="session-123",
        ...     user_id="user-456",
        ...     agent_id="agent-789"
        ... )
    """
    session_id: str = ""
    user_id: str = ""
    agent_id: str = ""
    conversation_history: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolPermission:
    """
    工具权限数据类。
    
    定义工具的权限范围，控制工具可以访问的资源。
    
    Attributes:
        allowed_tools (Set[str]): 允许使用的工具集合
        denied_tools (Set[str]): 禁止使用的工具集合
        allowed_paths (Set[str]): 允许访问的路径集合
        denied_paths (Set[str]): 禁止访问的路径集合
        max_iterations (int): 最大迭代次数
        timeout (int): 超时时间（秒）
    
    Example:
        >>> permission = ToolPermission(
        ...     allowed_tools={"Read", "Write", "Grep"},
        ...     max_iterations=5,
        ...     timeout=60
        ... )
    """
    allowed_tools: Set[str] = field(default_factory=set)
    denied_tools: Set[str] = field(default_factory=set)
    allowed_paths: Set[str] = field(default_factory=set)
    denied_paths: Set[str] = field(default_factory=set)
    max_iterations: int = 10
    timeout: int = 300


class BaseAgentTool(ABC):
    """
    Agent工具基类。
    
    所有Agent工具的抽象基类，定义公共接口和功能。
    
    核心功能：
        1. 上下文管理：管理工具执行的上下文信息
        2. 权限控制：控制工具的访问权限
        3. 错误处理：统一的错误处理机制
        4. 工具规范：定义工具的规范格式
    
    子类需要实现：
        - execute(): 执行工具逻辑
        - get_tool_spec(): 获取工具规范
    
    Example:
        >>> class MyAgentTool(BaseAgentTool):
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
        - 所有Agent工具都应该继承此类
        - execute方法应该是异步的
        - 工具规范应该兼容OpenAI Function Calling格式
    """
    
    def __init__(
        self,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None
    ) -> None:
        """
        初始化Agent工具。
        
        Args:
            context (ToolContext, optional): 工具上下文。默认为 None。
            permission (ToolPermission, optional): 工具权限。默认为 None。
        """
        self._context = context or ToolContext()
        self._permission = permission or ToolPermission()
    
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
            AgentToolError: 执行失败时抛出
        """
        pass
    
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
        pass
    
    def set_context(self, context: ToolContext) -> None:
        """
        设置工具上下文。
        
        Args:
            context (ToolContext): 新的工具上下文。
        """
        self._context = context
    
    def get_context(self) -> ToolContext:
        """
        获取当前工具上下文。
        
        Returns:
            ToolContext: 当前的工具上下文。
        """
        return self._context
    
    def set_permission(self, permission: ToolPermission) -> None:
        """
        设置工具权限。
        
        Args:
            permission (ToolPermission): 新的工具权限。
        """
        self._permission = permission
    
    def get_permission(self) -> ToolPermission:
        """
        获取当前工具权限。
        
        Returns:
            ToolPermission: 当前的工具权限。
        """
        return self._permission
    
    def check_tool_permission(self, tool_name: str) -> bool:
        """
        检查是否有权限使用指定工具。
        
        Args:
            tool_name (str): 工具名称
        
        Returns:
            bool: 是否有权限
        """
        if tool_name in self._permission.denied_tools:
            return False
        if self._permission.allowed_tools and tool_name not in self._permission.allowed_tools:
            return False
        return True
    
    def check_path_permission(self, path: str) -> bool:
        """
        检查是否有权限访问指定路径。
        
        Args:
            path (str): 路径
        
        Returns:
            bool: 是否有权限
        """
        if path in self._permission.denied_paths:
            return False
        if self._permission.allowed_paths and path not in self._permission.allowed_paths:
            return False
        return True
    
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
            "error": True,
            "error_code": error_code,
            "message": message,
            "details": details or {}
        }
    
    def create_success_response(
        self,
        content: Any,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        创建成功响应。
        
        Args:
            content (Any): 响应内容
            metadata (dict, optional): 额外元数据。默认为 None。
        
        Returns:
            Dict[str, Any]: 成功响应字典
        """
        return {
            "success": True,
            "content": content,
            "metadata": metadata or {}
        }
