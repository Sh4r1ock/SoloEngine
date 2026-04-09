# -*- coding: utf-8 -*-
"""
SoloEngine : Token计数器模块，提供Token计数功能

@file __init__.py
@description Token计数器模块入口，统一导出Token计数器类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是Token计数器模块的入口，提供以下核心类的统一导出：
    - TokenCounterBase: Token计数器基类
    - OpenAITokenCounter: OpenAI Token计数器

依赖:
    - .token_base: Token计数器基类
    - .openai_token_counter: OpenAI Token计数器

使用示例:
    - from SoloAgent.token_counter import OpenAITokenCounter
    - counter = OpenAITokenCounter()
"""

from .token_base import TokenCounterBase
from .openai_token_counter import OpenAITokenCounter

__all__ = [
    "TokenCounterBase",
    "OpenAITokenCounter",
]
