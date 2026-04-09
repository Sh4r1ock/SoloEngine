# -*- coding: utf-8 -*-
"""
SoloEngine : 异常基类模块，提供Agent相关异常基类

@file exception_base.py
@description 提供Agent相关异常的基类定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供异常基类，包括：
    - AgentOrientedExceptionBase: Agent异常基类
    - 所有Agent相关异常的基类
    - 支持异常消息和字符串表示

依赖:
    - 无

使用示例:
    - from SoloAgent.exception import AgentOrientedExceptionBase
    - raise AgentOrientedExceptionBase("Something went wrong")
"""


class AgentOrientedExceptionBase(Exception):
    """
    Agent异常基类

    职责:
        - 作为所有Agent相关异常的基类
        - 提供统一的异常消息处理
        - 支持在运行时被捕获并暴露给Agent

    属性:
        message: 异常消息

    示例:
        >>> try:
        ...     raise AgentOrientedExceptionBase("Something went wrong")
        ... except AgentOrientedExceptionBase as e:
        ...     print(e)  # AgentOrientedExceptionBase: Something went wrong
    """

    def __init__(self, message: str):
        """
        初始化异常

        Args:
            message: 异常消息

        示例:
            >>> raise AgentOrientedExceptionBase("Error message")
        """
        super().__init__(message)
        self.message = message

    def __str__(self) -> str:
        """
        返回异常的字符串表示

        Returns:
            str: 异常类名和消息

        示例:
            >>> e = AgentOrientedExceptionBase("Error")
            >>> str(e)  # "AgentOrientedExceptionBase: Error"
        """
        return f"{self.__class__.__name__}: {self.message}"