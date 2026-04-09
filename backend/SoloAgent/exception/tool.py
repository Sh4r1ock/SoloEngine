# -*- coding: utf-8 -*-
"""
SoloEngine : 工具异常模块，提供工具相关异常定义

@file tool.py
@description 提供工具相关异常的定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供工具相关异常，包括：
    - ToolNotFoundError: 工具未找到异常
    - ToolInterruptedError: 工具中断异常
    - ToolInvalidArgumentsError: 工具参数无效异常

依赖:
    - .exception_base: 异常基类

使用示例:
    - from SoloAgent.exception import ToolNotFoundError
    - raise ToolNotFoundError("Tool 'search' not found")
"""

from .exception_base import AgentOrientedExceptionBase


class ToolNotFoundError(AgentOrientedExceptionBase):
    """
    工具未找到异常

    职责:
        - 当请求的工具不存在时抛出

    属性:
        message: 异常消息

    示例:
        >>> raise ToolNotFoundError("Tool 'search' not found")
    """


class ToolInterruptedError(AgentOrientedExceptionBase):
    """
    工具中断异常

    职责:
        - 当工具调用被用户中断时抛出

    属性:
        message: 异常消息

    示例:
        >>> raise ToolInterruptedError("Tool execution was interrupted")
    """


class ToolInvalidArgumentsError(AgentOrientedExceptionBase):
    """
    工具参数无效异常

    职责:
        - 当传递给工具的参数无效时抛出

    属性:
        message: 异常消息

    示例:
        >>> raise ToolInvalidArgumentsError("Invalid argument type for 'query'")
    """