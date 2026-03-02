# -*- coding: utf-8 -*-
"""
Task工具模块 - SubAgent架构实现。

@file task.py
@description Task工具 - 启动专门的子Agent处理任务
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 启动专门的子Agent（SubAgent）处理特定任务
- 支持多种SubAgent类型（search, general_purpose_task）
- SubAgent拥有独立的隔离上下文
- 返回SubAgent的最终执行结果

SubAgent类型：
    - search: 搜索型SubAgent，专门用于信息检索和搜索任务
    - general_purpose_task: 通用型SubAgent，处理一般性任务

设计理念：
    SubAgent架构允许主Agent将复杂任务委托给专门的子Agent处理：
    1. 主Agent通过Task工具启动SubAgent
    2. SubAgent在隔离的上下文中执行任务
    3. SubAgent完成后返回最终结果给主Agent
    4. 主Agent继续处理后续任务

参数说明：
    - subagent_type: SubAgent类型（search/general_purpose_task）
    - description: 任务简短描述（3-5个词）
    - query: 详细任务描述（最多30个词）
    - response_language: 响应语言

使用场景：
    - 需要专门Agent处理的复杂搜索任务
    - 需要隔离上下文的独立任务
    - 需要特定工具集的任务

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional, Literal
from dataclasses import dataclass
import logging

from .base import BaseAgentTool, AgentToolError, ToolContext, ToolPermission

logger = logging.getLogger(__name__)


SubAgentType = Literal["search", "general_purpose_task"]
ResponseLanguage = Literal["zh", "en", "auto"]


@dataclass
class SubAgentConfig:
    """
    SubAgent配置数据类。
    
    定义SubAgent的配置参数。
    
    Attributes:
        subagent_type (SubAgentType): SubAgent类型
        description (str): 任务简短描述（3-5个词）
        query (str): 详细任务描述（最多30个词）
        response_language (ResponseLanguage): 响应语言
    """
    subagent_type: SubAgentType = "general_purpose_task"
    description: str = ""
    query: str = ""
    response_language: ResponseLanguage = "auto"


SUBAGENT_SYSTEM_PROMPTS = {
    "search": """你是一个专门的搜索Agent，负责执行信息检索和搜索任务。

你的职责：
1. 使用可用的搜索工具查找相关信息
2. 分析和整理搜索结果
3. 提供准确、简洁的搜索结果摘要

工作原则：
- 专注于搜索和检索任务
- 使用多个搜索源获取全面信息
- 验证信息的准确性
- 用清晰的结构呈现结果

请根据用户查询执行搜索任务，并返回搜索结果摘要。""",

    "general_purpose_task": """你是一个通用的任务执行Agent，负责处理各种一般性任务。

你的职责：
1. 理解任务要求
2. 制定执行计划
3. 使用可用工具完成任务
4. 返回任务执行结果

工作原则：
- 仔细分析任务需求
- 选择合适的工具和方法
- 按步骤执行任务
- 确保结果质量

请根据任务描述执行任务，并返回执行结果。"""
}


SUBAGENT_TOOL_PERMISSIONS = {
    "search": ToolPermission(
        allowed_tools={"SearchCodebase", "Grep", "Glob", "WebSearch", "WebFetch", "Read"},
        max_iterations=5,
        timeout=120
    ),
    "general_purpose_task": ToolPermission(
        allowed_tools=set(),
        max_iterations=10,
        timeout=300
    )
}


class TaskTool(BaseAgentTool):
    """
    Task工具 - 启动SubAgent处理任务。
    
    通过Task工具，主Agent可以将任务委托给专门的SubAgent处理。
    SubAgent在隔离的上下文中执行，完成后返回结果。
    
    核心功能：
        1. SubAgent创建：根据类型创建专门的SubAgent
        2. 上下文隔离：SubAgent拥有独立的对话历史
        3. 权限控制：SubAgent使用受限的工具权限
        4. 结果返回：返回SubAgent的最终执行结果
    
    支持的SubAgent类型：
        - search: 搜索型Agent，专注于信息检索
        - general_purpose_task: 通用型Agent，处理一般任务
    
    Example:
        >>> task_tool = TaskTool()
        >>> result = await task_tool.execute(
        ...     subagent_type="search",
        ...     description="搜索代码库",
        ...     query="在代码库中搜索与用户认证相关的代码",
        ...     response_language="zh"
        ... )
    
    Note:
        - SubAgent的上下文与主Agent隔离
        - SubAgent的工具权限受到限制
        - description限制为3-5个词
        - query限制为最多30个词
    """
    
    def __init__(
        self,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None,
        agent_factory: Optional[callable] = None
    ) -> None:
        """
        初始化Task工具。
        
        Args:
            context (ToolContext, optional): 工具上下文。默认为 None。
            permission (ToolPermission, optional): 工具权限。默认为 None。
            agent_factory (callable, optional): Agent工厂函数，用于创建SubAgent。
                如果不提供，将使用默认的创建逻辑。
        """
        super().__init__(context, permission)
        self._agent_factory = agent_factory
        self._subagent_results: Dict[str, Dict[str, Any]] = {}
    
    async def execute(
        self,
        subagent_type: SubAgentType = "general_purpose_task",
        description: str = "",
        query: str = "",
        response_language: ResponseLanguage = "auto",
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行Task工具 - 启动SubAgent处理任务。
        
        根据指定的类型创建SubAgent，并在隔离上下文中执行任务。
        
        Args:
            subagent_type (SubAgentType): SubAgent类型。
                - "search": 搜索型Agent
                - "general_purpose_task": 通用型Agent
                默认为 "general_purpose_task"。
            description (str): 任务简短描述，3-5个词。
                用于标识和日志记录。
            query (str): 详细任务描述，最多30个词。
                SubAgent将根据此描述执行任务。
            response_language (ResponseLanguage): 响应语言。
                - "zh": 中文
                - "en": 英文
                - "auto": 自动检测
                默认为 "auto"。
            **kwargs: 额外参数。
        
        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success (bool): 是否成功
                - content (str): SubAgent的执行结果
                - subagent_type (str): SubAgent类型
                - description (str): 任务描述
                - metadata (dict): 额外元数据
        
        Raises:
            AgentToolError: 当参数无效或执行失败时抛出。
        
        Example:
            >>> result = await task_tool.execute(
            ...     subagent_type="search",
            ...     description="代码搜索",
            ...     query="搜索用户认证相关代码"
            ... )
            >>> print(result["content"])
        """
        description = self._validate_description(description)
        query = self._validate_query(query)
        
        config = SubAgentConfig(
            subagent_type=subagent_type,
            description=description,
            query=query,
            response_language=response_language
        )
        
        try:
            subagent = await self._create_subagent(config)
            result = await self._run_subagent(subagent, config)
            
            return self.create_success_response(
                content=result,
                metadata={
                    "subagent_type": subagent_type,
                    "description": description,
                    "response_language": response_language
                }
            )
            
        except Exception as e:
            logger.error(f"SubAgent execution failed: {e}")
            return self.create_error_response(
                message=f"SubAgent执行失败: {str(e)}",
                error_code="SUBAGENT_EXECUTION_ERROR",
                details={
                    "subagent_type": subagent_type,
                    "description": description,
                    "error": str(e)
                }
            )
    
    def _validate_description(self, description: str) -> str:
        """
        验证并规范化描述。
        
        Args:
            description (str): 原始描述
        
        Returns:
            str: 规范化后的描述
        
        Note:
            描述限制为3-5个词，超过会被截断。
        """
        if not description:
            return "执行任务"
        
        words = description.split()
        if len(words) > 5:
            return " ".join(words[:5])
        return description
    
    def _validate_query(self, query: str) -> str:
        """
        验证并规范化查询。
        
        Args:
            query (str): 原始查询
        
        Returns:
            str: 规范化后的查询
        
        Note:
            查询限制为最多30个词，超过会被截断。
        """
        if not query:
            raise AgentToolError(
                message="query参数不能为空",
                error_code="INVALID_QUERY"
            )
        
        words = query.split()
        if len(words) > 30:
            return " ".join(words[:30])
        return query
    
    async def _create_subagent(self, config: SubAgentConfig) -> Any:
        """
        创建SubAgent实例。
        
        根据配置创建对应类型的SubAgent。
        
        Args:
            config (SubAgentConfig): SubAgent配置
        
        Returns:
            Any: SubAgent实例
        """
        if self._agent_factory:
            return await self._agent_factory(config)
        
        from ....assembly import ReActAgent
        from ....model.llm_factory import LLMFactory
        from ....formatter.openai_formatter import OpenAIChatFormatter
        
        model = LLMFactory.create_model(
            provider="openai",
            model_name="gpt-4"
        )
        formatter = OpenAIChatFormatter()
        
        system_prompt = SUBAGENT_SYSTEM_PROMPTS.get(
            config.subagent_type,
            SUBAGENT_SYSTEM_PROMPTS["general_purpose_task"]
        )
        
        if config.response_language == "zh":
            system_prompt += "\n\n请使用中文回复。"
        elif config.response_language == "en":
            system_prompt += "\n\nPlease respond in English."
        
        permission = SUBAGENT_TOOL_PERMISSIONS.get(
            config.subagent_type,
            ToolPermission()
        )
        
        agent = ReActAgent(
            name=f"subagent_{config.subagent_type}",
            model=model,
            formatter=formatter,
            system_prompt=system_prompt,
            max_iters=permission.max_iterations,
            enable_memory=False,
            enable_tools=True
        )
        
        return agent
    
    async def _run_subagent(self, subagent: Any, config: SubAgentConfig) -> str:
        """
        运行SubAgent执行任务。
        
        Args:
            subagent: SubAgent实例
            config (SubAgentConfig): SubAgent配置
        
        Returns:
            str: 执行结果
        """
        try:
            response = await subagent.reply(config.query)
            
            result_text = response.get_text_content() or "SubAgent执行完成，但未返回结果"
            
            self._subagent_results[config.description] = {
                "query": config.query,
                "result": result_text,
                "subagent_type": config.subagent_type
            }
            
            return result_text
            
        except Exception as e:
            raise AgentToolError(
                message=f"SubAgent执行出错: {str(e)}",
                error_code="SUBAGENT_RUN_ERROR",
                details={"error": str(e)}
            )
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取Task工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式。
        """
        return {
            "name": "Task",
            "description": (
                "启动专门的子Agent（SubAgent）处理特定任务。"
                "SubAgent在隔离的上下文中执行，完成后返回结果。"
                "支持search（搜索）和general_purpose_task（通用）两种类型。"
            ),
            "parameters": {
                "subagent_type": {
                    "type": "string",
                    "enum": ["search", "general_purpose_task"],
                    "description": "SubAgent类型：search用于搜索任务，general_purpose_task用于通用任务",
                    "required": True
                },
                "description": {
                    "type": "string",
                    "description": "任务简短描述，3-5个词，用于标识任务",
                    "required": True
                },
                "query": {
                    "type": "string",
                    "description": "详细任务描述，最多30个词，SubAgent将根据此描述执行任务",
                    "required": True
                },
                "response_language": {
                    "type": "string",
                    "enum": ["zh", "en", "auto"],
                    "description": "响应语言：zh中文，en英文，auto自动检测",
                    "required": False,
                    "default": "auto"
                }
            }
        }
    
    def get_subagent_results(self) -> Dict[str, Dict[str, Any]]:
        """
        获取所有SubAgent的执行结果。
        
        Returns:
            Dict[str, Dict[str, Any]]: SubAgent结果字典，键为任务描述。
        """
        return self._subagent_results.copy()


async def task_tool_function(
    subagent_type: SubAgentType = "general_purpose_task",
    description: str = "",
    query: str = "",
    response_language: ResponseLanguage = "auto"
) -> Dict[str, Any]:
    """
    Task工具函数 - 直接调用入口。
    
    提供简化的函数式调用接口。
    
    Args:
        subagent_type (SubAgentType): SubAgent类型。默认为 "general_purpose_task"。
        description (str): 任务简短描述（3-5个词）。
        query (str): 详细任务描述（最多30个词）。
        response_language (ResponseLanguage): 响应语言。默认为 "auto"。
    
    Returns:
        Dict[str, Any]: 执行结果。
    
    Example:
        >>> result = await task_tool_function(
        ...     subagent_type="search",
        ...     description="代码搜索",
        ...     query="搜索用户认证相关代码"
        ... )
    """
    tool = TaskTool()
    return await tool.execute(
        subagent_type=subagent_type,
        description=description,
        query=query,
        response_language=response_language
    )


def get_task_tool_spec() -> Dict[str, Any]:
    """
    获取Task工具规范。
    
    Returns:
        Dict[str, Any]: 工具规范，用于注册到ToolkitExecutor。
    """
    tool = TaskTool()
    return tool.get_tool_spec()
