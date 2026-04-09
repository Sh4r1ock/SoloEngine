# -*- coding: utf-8 -*-
"""
SoloEngine : Agent预设配置模块，提供常用Agent配置的快捷创建函数

@file presets.py
@description 提供常用Agent配置的快捷创建函数
@author Sh4rlock
@date 2026-04-09

功能描述：
- 提供多种预设 Agent 配置模板
- 简化常见使用场景的 Agent 创建
- 封装最佳实践配置

预设类型：
    - StandardAgent: 标准 Agent，启用记忆和工具
    - ReActWithRAG: 带 RAG 的 Agent，启用知识检索
    - SimpleAgent: 简单 Agent，仅启用记忆
    - MultiMCPAgent: 多 MCP Agent，连接多个外部工具服务
    - PlanningAgent: 规划 Agent，启用任务规划功能

使用场景：
    - 快速创建常见类型的 Agent
    - 作为自定义 Agent 配置的参考模板
    - 降低 Agent 创建的学习成本

状态: ✅ 完整实现
"""

from typing import Optional

from .assembler import ReActAgent
from ..model import ChatModelBase
from ..formatter import FormatterBase


def StandardAgent(
    name: str,
    model: ChatModelBase,
    formatter: FormatterBase,
    system_prompt: str,
    **kwargs
) -> ReActAgent:
    """
    创建标准 Agent。
    
    启用记忆和基本工具功能，适用于大多数对话场景。
    这是最常用的 Agent 配置。
    
    功能特性：
        - ✅ 记忆功能：自动保存和检索对话历史
        - ✅ 工具功能：可调用搜索和计算器等工具
        - ❌ RAG 功能：不启用知识库检索
        - ❌ 计划功能：不启用任务规划
    
    Args:
        name (str): Agent 名称，用于标识和日志。
        model (ChatModelBase): LLM 模型实例。
        formatter (FormatterBase): 消息格式化器。
        system_prompt (str): 系统提示词。
        **kwargs: 传递给 ReActAgent 的额外参数，如：
            - max_iters: 最大迭代次数
            - print_hint_msg: 是否打印调试信息
    
    Returns:
        ReActAgent: 配置好的 Agent 实例。
    
    Example:
        >>> from SoloAgent.model import OpenAIChatModel
        >>> from SoloAgent.formatter import OpenAIChatFormatter
        >>> 
        >>> model = OpenAIChatModel(model_name="gpt-4")
        >>> formatter = OpenAIChatFormatter()
        >>> 
        >>> agent = StandardAgent(
        ...     name="assistant",
        ...     model=model,
        ...     formatter=formatter,
        ...     system_prompt="你是一个有帮助的助手。"
        ... )
        >>> 
        >>> response = await agent.reply("你好！")
    
    Note:
        默认工具包括 search 和 calculator，可通过 tool_configs 覆盖。
    """
    return ReActAgent(
        name=name,
        model=model,
        formatter=formatter,
        system_prompt=system_prompt,
        enable_memory=True,
        enable_tools=True,
        **kwargs
    )


def ReActWithRAG(
    name: str,
    model: ChatModelBase,
    formatter: FormatterBase,
    system_prompt: str,
    rag_config: Optional[dict] = None,
    **kwargs
) -> ReActAgent:
    """
    创建带 RAG 功能的 Agent。
    
    启用记忆、工具和 RAG 功能，适用于需要知识库检索的场景。
    RAG（检索增强生成）可以从知识库中检索相关文档增强回答。
    
    功能特性：
        - ✅ 记忆功能：自动保存和检索对话历史
        - ✅ 工具功能：可调用搜索和计算器等工具
        - ✅ RAG 功能：从知识库检索相关文档
        - ❌ 计划功能：不启用任务规划
    
    Args:
        name (str): Agent 名称，用于标识和日志。
        model (ChatModelBase): LLM 模型实例。
        formatter (FormatterBase): 消息格式化器。
        system_prompt (str): 系统提示词。
        rag_config (dict, optional): RAG 配置，可包含：
            - knowledge_base_path: 知识库路径
            - embedding_model: 嵌入模型配置
            - chunk_size: 文档分块大小
            - chunk_overlap: 分块重叠大小
            默认为 None，使用默认配置。
        **kwargs: 传递给 ReActAgent 的额外参数。
    
    Returns:
        ReActAgent: 配置好的 Agent 实例。
    
    Example:
        >>> agent = ReActWithRAG(
        ...     name="knowledge_assistant",
        ...     model=model,
        ...     formatter=formatter,
        ...     system_prompt="你是一个知识库助手。",
        ...     rag_config={"knowledge_base_path": "./docs"}
        ... )
        >>> 
        >>> response = await agent.reply("什么是机器学习？")
    
    Note:
        RAG 功能需要预先构建知识库或配置文档加载。
    """
    return ReActAgent(
        name=name,
        model=model,
        formatter=formatter,
        system_prompt=system_prompt,
        enable_memory=True,
        enable_tools=True,
        rag_config=rag_config or {},
        **kwargs
    )


def SimpleAgent(
    name: str,
    model: ChatModelBase,
    formatter: FormatterBase,
    system_prompt: str,
    **kwargs
) -> ReActAgent:
    """
    创建简单 Agent。
    
    仅启用记忆功能，适用于纯对话场景。
    不使用工具和 RAG，响应更快，成本更低。
    
    功能特性：
        - ✅ 记忆功能：自动保存和检索对话历史
        - ❌ 工具功能：不启用工具调用
        - ❌ RAG 功能：不启用知识库检索
        - ❌ 计划功能：不启用任务规划
    
    Args:
        name (str): Agent 名称，用于标识和日志。
        model (ChatModelBase): LLM 模型实例。
        formatter (FormatterBase): 消息格式化器。
        system_prompt (str): 系统提示词。
        **kwargs: 传递给 ReActAgent 的额外参数。
    
    Returns:
        ReActAgent: 配置好的 Agent 实例。
    
    Example:
        >>> agent = SimpleAgent(
        ...     name="chatbot",
        ...     model=model,
        ...     formatter=formatter,
        ...     system_prompt="你是一个友好的聊天机器人。"
        ... )
        >>> 
        >>> response = await agent.reply("今天天气怎么样？")
    
    Note:
        简单 Agent 适合不需要外部知识的纯对话场景。
    """
    return ReActAgent(
        name=name,
        model=model,
        formatter=formatter,
        system_prompt=system_prompt,
        enable_memory=True,
        enable_tools=False,
        enable_rag=False,
        **kwargs
    )


def MultiMCPAgent(
    name: str,
    model: ChatModelBase,
    formatter: FormatterBase,
    system_prompt: str,
    mcp_configs: list,
    **kwargs
) -> ReActAgent:
    """
    创建多 MCP Agent。
    
    启用记忆和多个 MCP 客户端，适用于需要连接多个外部工具服务的场景。
    MCP（Model Context Protocol）是一种标准化的工具协议。
    
    功能特性：
        - ✅ 记忆功能：自动保存和检索对话历史
        - ✅ MCP 工具：连接多个 MCP 服务器
        - ❌ RAG 功能：不启用知识库检索
        - ❌ 计划功能：不启用任务规划
    
    Args:
        name (str): Agent 名称，用于标识和日志。
        model (ChatModelBase): LLM 模型实例。
        formatter (FormatterBase): 消息格式化器。
        system_prompt (str): 系统提示词。
        mcp_configs (list): MCP 客户端配置列表，每个配置包含：
            - transport: 传输协议（stdio/sse/http）
            - command: 命令（stdio 协议）
            - url: URL（sse/http 协议）
            - args: 参数（可选）
            - env: 环境变量（可选）
        **kwargs: 传递给 ReActAgent 的额外参数。
    
    Returns:
        ReActAgent: 配置好的 Agent 实例。
    
    Example:
        >>> agent = MultiMCPAgent(
        ...     name="tool_agent",
        ...     model=model,
        ...     formatter=formatter,
        ...     system_prompt="你是一个工具助手。",
        ...     mcp_configs=[
        ...         {"transport": "stdio", "command": "mcp-server-filesystem"},
        ...         {"transport": "http", "url": "http://localhost:8000/mcp"}
        ...     ]
        ... )
        >>> 
        >>> await agent.connect_mcp_servers()
        >>> response = await agent.reply("列出当前目录的文件")
        >>> await agent.disconnect_mcp_servers()
    
    Note:
        使用前需要调用 connect_mcp_servers() 连接服务器，
        使用后需要调用 disconnect_mcp_servers() 断开连接。
    """
    return ReActAgent(
        name=name,
        model=model,
        formatter=formatter,
        system_prompt=system_prompt,
        enable_memory=True,
        enable_tools=True,
        mcp_configs=mcp_configs,
        **kwargs
    )


def PlanningAgent(
    name: str,
    model: ChatModelBase,
    formatter: FormatterBase,
    system_prompt: str,
    plan_config: Optional[dict] = None,
    **kwargs
) -> ReActAgent:
    """
    创建规划 Agent。
    
    启用记忆、工具和计划功能，适用于需要任务规划和分解的复杂场景。
    计划功能可以帮助 Agent 管理多步骤任务的执行进度。
    
    功能特性：
        - ✅ 记忆功能：自动保存和检索对话历史
        - ✅ 工具功能：可调用搜索和计算器等工具
        - ❌ RAG 功能：不启用知识库检索
        - ✅ 计划功能：支持任务规划和进度跟踪
    
    Args:
        name (str): Agent 名称，用于标识和日志。
        model (ChatModelBase): LLM 模型实例。
        formatter (FormatterBase): 消息格式化器。
        system_prompt (str): 系统提示词。
        plan_config (dict, optional): 计划配置，可包含：
            - storage_path: 计划存储路径
            - auto_save: 是否自动保存
            - max_plans: 最大计划数量
            默认为 None，使用默认配置。
        **kwargs: 传递给 ReActAgent 的额外参数。
    
    Returns:
        ReActAgent: 配置好的 Agent 实例。
    
    Example:
        >>> agent = PlanningAgent(
        ...     name="planner",
        ...     model=model,
        ...     formatter=formatter,
        ...     system_prompt="你是一个任务规划助手。",
        ...     plan_config={"storage_path": "./plans", "auto_save": True}
        ... )
        >>> 
        >>> response = await agent.reply("帮我规划一个学习计划")
    
    Note:
        计划功能会自动将当前计划状态注入到用户消息中，
        帮助 Agent 了解任务进度。
    """
    return ReActAgent(
        name=name,
        model=model,
        formatter=formatter,
        system_prompt=system_prompt,
        enable_memory=True,
        enable_tools=True,
        plan_config=plan_config or {},
        **kwargs
    )


__all__ = [
    "StandardAgent",
    "ReActWithRAG",
    "SimpleAgent",
    "MultiMCPAgent",
    "PlanningAgent",
]
