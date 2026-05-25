# -*- coding: utf-8 -*-
"""
SoloEngine : Token计数器基类模块

@file token_base.py
@description 提供Token计数器基类定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供Token计数器基类，包括：
    - TokenCounterBase: Token计数器基类
    - 定义Token计数接口

依赖:
    - abc: 抽象基类
    - typing: 类型提示

使用示例:
    - from SoloAgent.token_counter import TokenCounterBase
    - class MyTokenCounter(TokenCounterBase):
    -     async def count(self, messages, **kwargs):
    -         return 100
"""

from abc import abstractmethod
from typing import Any


class TokenCounterBase:
    """
    Token计数器基类

    职责:
        - 定义Token计数接口
        - 作为所有Token计数器的基类

    属性:
        无

    示例:
        >>> class MyTokenCounter(TokenCounterBase):
        ...     async def count(self, messages, **kwargs):
        ...         return 100
    """

    @abstractmethod
    async def count(
        self,
        messages: list[dict],
        **kwargs: Any,
    ) -> int:
        """
        计算Token数量

        Args:
            messages: 消息列表
            **kwargs: 额外的关键字参数

        Returns:
            int: Token数量

        示例:
            >>> count = await counter.count(messages)
        """
