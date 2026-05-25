# -*- coding: utf-8 -*-
"""
SoloEngine : 异常模块，提供Agent相关异常定义

@file __init__.py
@description 异常模块入口，统一导出异常类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是异常模块的入口，提供以下核心异常类的统一导出：
    - AgentOrientedExceptionBase: 异常基类
    - ToolNotFoundError: 工具未找到异常
    - ToolInterruptedError: 工具中断异常
    - ToolInvalidArgumentsError: 工具参数无效异常

依赖:
    - .exception_base: 异常基类
    - .tool: 工具异常

使用示例:
    - from SoloAgent.exception import ToolNotFoundError
    - raise ToolNotFoundError("Tool not found")
"""

from .exception_base import AgentOrientedExceptionBase
from .tool import (
    ToolNotFoundError,
    ToolInterruptedError,
    ToolInvalidArgumentsError,
)
from .exceptions import (
    SoloEngineException,
    WebSocketException,
    WebSocketConnectionError,
    WebSocketAuthenticationError,
    DatabaseException,
    DatabaseConnectionError,
)

__all__ = [
    "AgentOrientedExceptionBase",
    "ToolNotFoundError",
    "ToolInterruptedError",
    "ToolInvalidArgumentsError",
    "SoloEngineException",
    "WebSocketException",
    "WebSocketConnectionError",
    "WebSocketAuthenticationError",
    "DatabaseException",
    "DatabaseConnectionError",
]
