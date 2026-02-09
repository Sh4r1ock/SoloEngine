# -*- coding: utf-8 -*-
"""Preset configurations for SoloEngine."""

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
    """Create a standard agent with memory and basic tools.
    
    Args:
        name: Agent name
        model: Chat model
        formatter: Message formatter
        system_prompt: System prompt
        **kwargs: Additional arguments passed to ReActAgent
    
    Returns:
        Configured ReActAgent instance
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
    """Create an agent with memory, tools, and RAG.
    
    Args:
        name: Agent name
        model: Chat model
        formatter: Message formatter
        system_prompt: System prompt
        rag_config: RAG configuration
        **kwargs: Additional arguments passed to ReActAgent
    
    Returns:
        Configured ReActAgent instance
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
    """Create a simple agent with only memory.
    
    Args:
        name: Agent name
        model: Chat model
        formatter: Message formatter
        system_prompt: System prompt
        **kwargs: Additional arguments passed to ReActAgent
    
    Returns:
        Configured ReActAgent instance
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
    """Create an agent with multiple MCP clients.
    
    Args:
        name: Agent name
        model: Chat model
        formatter: Message formatter
        system_prompt: System prompt
        mcp_configs: List of MCP configurations
        **kwargs: Additional arguments passed to ReActAgent
    
    Returns:
        Configured ReActAgent instance
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
    """Create an agent with planning capabilities.
    
    Args:
        name: Agent name
        model: Chat model
        formatter: Message formatter
        system_prompt: System prompt
        plan_config: Plan configuration
        **kwargs: Additional arguments passed to ReActAgent
    
    Returns:
        Configured ReActAgent instance
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