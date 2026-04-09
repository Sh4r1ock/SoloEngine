# -*- coding: utf-8 -*-
"""
SoloEngine : LLM模型模块入口，统一导出各类模型实现

@file __init__.py
@description LLM模型模块入口，统一导出各类模型实现
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是LLM模型机制的入口，提供以下核心组件的统一导出：
    - ChatModelBase: 聊天模型基类
    - ChatResponse: 模型响应类
    - ChatUsage: Token使用统计类
    - OpenAIChatModel: OpenAI模型实现
    - AnthropicChatModel: Anthropic Claude模型实现
    - QwenChatModel: 通义千问模型实现
    - OllamaChatModel: Ollama本地模型实现
    - LLMFactory: LLM工厂类
    - LLMProvider: LLM提供商枚举

依赖:
    - .model_base: 模型基类
    - .model_response: 响应类
    - .model_usage: 使用统计类
    - .openai_model: OpenAI模型
    - .anthropic_model: Anthropic模型
    - .qwen_model: 千问模型
    - .ollama_model: Ollama模型
    - .llm_factory: 工厂类

使用示例:
    - from SoloAgent.model import ChatModelBase, ChatResponse
    - from SoloAgent.model import OpenAIChatModel, LLMFactory
"""

from .model_base import ChatModelBase
from .model_response import ChatResponse
from .model_usage import ChatUsage
from .openai_model import OpenAIChatModel
from .anthropic_model import AnthropicChatModel
from .qwen_model import QwenChatModel
from .ollama_model import OllamaChatModel
from .llm_factory import LLMFactory, LLMProvider

__all__ = [
    "ChatModelBase",
    "ChatResponse",
    "ChatUsage",
    "OpenAIChatModel",
    "AnthropicChatModel",
    "QwenChatModel",
    "OllamaChatModel",
    "LLMFactory",
    "LLMProvider",
]