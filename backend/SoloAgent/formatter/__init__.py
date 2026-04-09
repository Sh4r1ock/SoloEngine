# -*- coding: utf-8 -*-
"""
消息格式化机制-__init__.py: 消息格式化模块入口

@file __init__.py
@description 消息格式化模块入口，统一导出格式化器类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是消息格式化机制的入口，提供以下核心组件的统一导出：
- FormatterBase: 格式化器基类
- TruncatedFormatterBase: 截断格式化器基类
- OpenAIChatFormatter: OpenAI聊天格式化器
- OpenAIMultiAgentFormatter: OpenAI多Agent格式化器

依赖:
- .formatter_base: 格式化器基类
- .truncated_formatter_base: 截断格式化器基类
- .openai_formatter: OpenAI格式化器

使用示例:
- from SoloAgent.formatter import FormatterBase
- from SoloAgent.formatter import OpenAIChatFormatter
"""

from .formatter_base import FormatterBase
from .truncated_formatter_base import TruncatedFormatterBase
from .openai_formatter import OpenAIChatFormatter, OpenAIMultiAgentFormatter

__all__ = [
    "FormatterBase",
    "TruncatedFormatterBase",
    "OpenAIChatFormatter",
    "OpenAIMultiAgentFormatter",
]
