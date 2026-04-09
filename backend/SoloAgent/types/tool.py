# -*- coding: utf-8 -*-
"""
SoloEngine : 工具相关类型定义模块

@file tool.py
@description 定义工具函数的类型签名
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供工具函数类型定义，包括：
    - ToolFunction: 工具函数类型别名
    - 支持同步和异步工具函数
    - 支持生成器风格的工具函数

工具函数类型：
    ToolFunction 支持以下返回类型：
    - ToolResponse: 同步函数，直接返回响应
    - Awaitable[ToolResponse]: 异步函数，返回协程
    - Generator[ToolResponse, None, None]: 同步生成器函数
    - AsyncGenerator[ToolResponse, None]: 异步生成器函数
    - Coroutine[..., AsyncGenerator]: 异步函数返回异步生成器
    - Coroutine[..., Generator]: 异步函数返回同步生成器

设计理念：
    工具函数可以有多种实现方式，此模块定义了统一的类型签名，
    使工具执行器能够正确处理各种类型的工具函数。

使用场景：
    - 定义工具函数时的类型注解
    - 工具执行器中的类型检查
    - IDE 自动补全和类型检查

依赖:
    - typing: 类型提示
    - ..plugins.tools: 工具响应类型

使用示例:
    - from SoloAgent.types import ToolFunction
    - def my_tool() -> ToolFunction:
    -     return {"content": "结果"}

状态: ✅ 完整实现
"""

from typing import (
    Callable,
    Union,
    Awaitable,
    AsyncGenerator,
    Generator,
    Coroutine,
    Any,
    TYPE_CHECKING,
)

if TYPE_CHECKING:
    from ..plugins.tools import ToolResponse
else:
    ToolResponse = "ToolResponse"


ToolFunction = Callable[
    ...,
    Union[
        ToolResponse,
        Awaitable[ToolResponse],
        Generator[ToolResponse, None, None],
        AsyncGenerator[ToolResponse, None],
        Coroutine[Any, Any, AsyncGenerator[ToolResponse, None]],
        Coroutine[Any, Any, Generator[ToolResponse, None, None]],
    ],
]
"""
工具函数类型签名。

定义工具函数可以采用的多种返回类型，支持灵活的工具实现方式。

支持的返回类型：
    1. 同步函数（ToolResponse）：
       直接返回工具响应，适用于快速操作。
       
       >>> def quick_tool() -> ToolResponse:
       ...     return {"content": "结果"}
    
    2. 异步函数（Awaitable[ToolResponse]）：
       返回协程，适用于需要异步 I/O 的操作。
       
       >>> async def async_tool() -> ToolResponse:
       ...     result = await some_async_operation()
       ...     return {"content": result}
    
    3. 同步生成器（Generator[ToolResponse, None, None]）：
       逐步产生多个响应，适用于流式输出。
       
       >>> def stream_tool() -> Generator[ToolResponse, None, None]:
       ...     for chunk in data:
       ...         yield {"content": chunk}
    
    4. 异步生成器（AsyncGenerator[ToolResponse, None]）：
       异步逐步产生多个响应。
       
       >>> async def async_stream_tool() -> AsyncGenerator[ToolResponse, None]:
       ...     async for chunk in async_data():
       ...         yield {"content": chunk}
    
    5. 异步函数返回异步生成器：
       异步函数内部创建并返回生成器。
       
       >>> async def complex_tool() -> AsyncGenerator[ToolResponse, None]:
       ...     async for chunk in process():
       ...         yield {"content": chunk}
    
    6. 异步函数返回同步生成器：
       较少使用，但类型系统支持。

Note:
    - Callable[..., ...] 表示接受任意参数
    - 工具执行器会自动检测返回类型并正确处理
    - 推荐使用异步函数或异步生成器以获得最佳性能
"""
