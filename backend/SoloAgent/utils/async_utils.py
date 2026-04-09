# -*- coding: utf-8 -*-
"""
SoloEngine : 异步工具模块，提供异步上下文管理器等工具

@file async_utils.py
@description 提供异步工具函数和上下文管理器
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下异步工具：
    - AsyncNullContext: 异步空上下文管理器

依赖:
    - typing: 类型注解支持

使用示例:
    - from SoloAgent.utils.async_utils import AsyncNullContext
    - async with AsyncNullContext():
    -     pass
"""

from typing import Any


class AsyncNullContext:
    """
    异步空上下文管理器
    
    职责:
        - 提供一个无操作的异步上下文管理器
        - 用于需要上下文管理器但不需要实际资源管理的场景
    
    示例:
        >>> async with AsyncNullContext():
        ...     await some_async_operation()
    """

    async def __aenter__(self) -> None:
        """
        异步进入上下文
        
        Returns:
            None
        """
        return None

    async def __aexit__(
        self,
        exc_type: Any,
        exc_val: Any,
        exc_tb: Any,
    ) -> None:
        """
        异步退出上下文
        
        Args:
            exc_type: 异常类型
            exc_val: 异常值
            exc_tb: 异常追踪信息
            
        Returns:
            None
        """
        return None
