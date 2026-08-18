# -*- coding: utf-8 -*-
"""
SoloEngine : 聊天模型基类模块，定义所有聊天模型的抽象基类和通用功能

@file model_base.py
@description 定义所有聊天模型的抽象基类和通用功能
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义聊天模型的抽象基类，提供以下核心功能：
    - 定义聊天模型的统一接口
    - 提供工具选择验证等通用功能
    - 支持同步和流式输出

设计理念：
    采用抽象基类模式，为不同LLM提供商提供统一的接口。
    所有具体模型实现（OpenAI、Anthropic、Qwen、Ollama）
    都继承自此类并实现__call__方法。

支持的模型提供商：
    - OpenAI: GPT-4, GPT-3.5, GPT-4o等
    - Anthropic: Claude 3系列
    - Qwen: 通义千问系列
    - Ollama: 本地模型（Llama, Mistral等）

工具选择模式：
    - auto: 自动决定是否调用工具
    - none: 不调用任何工具
    - required: 必须调用工具
    - 具体工具名: 强制调用指定工具

状态: ✅ 完整实现
"""

from abc import abstractmethod
from typing import AsyncGenerator, Any
import asyncio

from .model_response import ChatResponse
from ..utils.logging import logger


_TOOL_CHOICE_MODES = ["auto", "none", "required"]
"""工具选择模式列表，定义 LLM 如何选择工具调用"""


class ChatModelBase:
    """
    聊天模型抽象基类。
    
    所有聊天模型的基类，定义了模型调用的统一接口。
    具体实现类需要实现 __call__ 方法。
    
    核心功能：
        1. 统一模型调用接口
        2. 支持同步和流式输出
        3. 工具选择参数验证
    
    子类实现：
        - OpenAIChatModel: OpenAI 模型实现
        - AnthropicChatModel: Anthropic 模型实现
        - QwenChatModel: 通义千问模型实现
        - OllamaChatModel: Ollama 本地模型实现
    
    使用方式：
        模型实例是可调用对象，直接调用即可生成响应：
        >>> response = await model(messages)
    
    Example:
        >>> from SoloAgent.model import OpenAIChatModel
        >>> 
        >>> model = OpenAIChatModel(
        ...     model_name="gpt-4",
        ...     stream=False
        ... )
        >>> 
        >>> messages = [{"role": "user", "content": "你好"}]
        >>> response = await model(messages)
        >>> print(response.content)
    
    Note:
        - 所有模型参数通过构造函数传入
        - 调用时传入格式化后的消息列表
        - 返回 ChatResponse 对象或流式生成器
    """

    model_name: str
    """模型名称，如 'gpt-4', 'claude-3-opus-20240229'"""

    stream: bool
    """是否使用流式输出模式"""

    def __init__(
        self,
        model_name: str,
        stream: bool,
    ) -> None:
        """
        初始化聊天模型基类。
        
        Args:
            model_name (str): 模型名称，由具体提供商定义。
                例如：'gpt-4', 'claude-3-opus-20240229', 'qwen-plus'。
            stream (bool): 是否启用流式输出。
                - True: 返回异步生成器，逐步输出
                - False: 返回完整响应
        
        Note:
            子类应调用 super().__init__() 并添加提供商特定的参数。
        """
        self.model_name = model_name
        self.stream = stream
        self._active_response = None
        self._was_cancelled = False
        # create() 阶段（等待 HTTP 响应头）的 asyncio.Task 引用（阻塞根因修复）：
        # 流式调用中 `await client.create(...)` 在响应头返回前不可被 cancel_event 检查、
        # _active_response 也未设置（_save_response_ref 在进入流循环后才调用），
        # 服务端接受连接但不返回响应头时该 await 最长阻塞至 SDK 默认超时（openai/
        # anthropic 600s）。保存 task 引用后，cancel() 通过 task.cancel() 直接中断。
        self._create_task = None

    @abstractmethod
    async def __call__(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
        """
        调用模型生成响应。
        
        这是模型的主要接口方法，接收格式化后的消息，
        返回模型的响应。
        
        Args:
            *args: 位置参数，通常是消息列表或格式化后的请求体。
            **kwargs: 关键字参数，可包含：
                - tools: 可用工具列表
                - tool_choice: 工具选择模式
                - temperature: 生成温度
                - max_tokens: 最大输出 token 数
                - 其他提供商特定参数
        
        Returns:
            ChatResponse | AsyncGenerator[ChatResponse, None]:
                - 如果 stream=False，返回 ChatResponse 对象
                - 如果 stream=True，返回异步生成器
        
        Raises:
            APIError: 当 API 调用失败时抛出
            RateLimitError: 当达到速率限制时抛出
            AuthenticationError: 当认证失败时抛出
        
        Note:
            子类必须实现此方法。
        
        Example:
            >>> response = await model(messages, temperature=0.7)
            >>> async for chunk in model(messages, stream=True):
            ...     print(chunk.content)
        """

    def _validate_tool_choice(
        self,
        tool_choice: str,
        tools: list[dict] | None,
    ) -> None:
        """
        验证工具选择参数。
        
        检查 tool_choice 参数是否有效。有效的选项包括：
        1. 预定义模式：'auto', 'none', 'required'
        2. 具体工具名称：必须是 tools 列表中的工具名
        
        Args:
            tool_choice (str): 工具选择模式或工具名称。
                - 'auto': 模型自动决定是否调用工具
                - 'none': 模型不调用任何工具
                - 'required': 模型必须调用工具
                - 工具名: 强制模型调用指定工具
            tools (list[dict] | None): 可用工具列表。
                每个工具应包含 function.name 字段。
        
        Raises:
            TypeError: 当 tool_choice 不是字符串时抛出。
            ValueError: 当 tool_choice 不是有效选项时抛出。
        
        Example:
            >>> model._validate_tool_choice("auto", tools)  # 通过
            >>> model._validate_tool_choice("search", tools)  # 如果 search 在 tools 中则通过
            >>> model._validate_tool_choice("invalid", tools)  # 抛出 ValueError
        
        Note:
            此方法在模型调用前自动调用，确保参数有效。
        """
        if not isinstance(tool_choice, str):
            raise TypeError(
                f"tool_choice must be str, got {type(tool_choice)}",
            )
        if tool_choice in _TOOL_CHOICE_MODES:
            return

        available_functions = [tool["function"]["name"] for tool in tools]

        if tool_choice not in available_functions:
            all_options = _TOOL_CHOICE_MODES + available_functions
            raise ValueError(
                f"Invalid tool_choice '{tool_choice}'. "
                f"Available options: {', '.join(sorted(all_options))}",
            )

    async def cancel(self):
        """取消当前流式调用，关闭底层 HTTP 连接。

        尝试 aclose()（适用于 OpenAI AsyncStream、Qwen async generator、Ollama httpx.Response），
        回退到 close()（适用于 Anthropic MessageStream）。

        aclose() 加超时保护（0.5s）：OpenAI AsyncStream 的 aclose 在底层响应等待数据时
        可能阻塞数秒（实测约 1.5s），导致暂停/停止延迟；超时后尝试强制关闭底层
        httpx 连接（stream 内部持有的 _response），确保停滞连接真正断开而非仅置标志。

        阻塞根因修复（create 阶段）：流式调用的 `await client.create(...)`（等待响应头）
        期间 _active_response 未设置、cancel_event 检查不可达——先取消 _create_task
        （各 model __call__ 用 asyncio.ensure_future 保存），使等待响应头的协程被
        CancelledError 中断（httpx 连接随之关闭），再走原有 aclose/强断路径。
        """
        create_task = self._create_task
        if create_task is not None and not create_task.done():
            create_task.cancel()
        resp = self._active_response
        if resp:
            try:
                try:
                    await asyncio.wait_for(resp.aclose(), timeout=0.5)
                except (AttributeError, NotImplementedError):
                    # 回退到同步 close()（Anthropic MessageStream 等）
                    try:
                        resp.close()
                    except Exception:
                        pass
            except asyncio.TimeoutError:
                logger.warning("Model cancel: aclose() timed out after 0.5s, forcing close of underlying connection")
                # aclose 超时说明底层响应仍在等待数据（流停滞）。强制关闭流内部持有的
                # httpx Response（openai AsyncStream._response / qwen 等同构），
                # 使停滞的 __anext__ 能收到结束信号，事件循环不再被永久阻塞。
                inner = getattr(resp, '_response', None) or getattr(resp, 'response', None)
                if inner is not None:
                    try:
                        if hasattr(inner, 'aclose'):
                            await asyncio.wait_for(inner.aclose(), timeout=1.0)
                        elif hasattr(inner, 'close'):
                            inner.close()
                    except Exception:
                        pass
            except Exception:
                pass
            self._active_response = None
        self._was_cancelled = True

    async def _anext_stall_protected(self, iterator, timeout: float):
        """对流迭代器 __anext__ 加 stall 超时保护（根因修复：model 层阻塞问题）。

        此前所有 model 的流解析用 `async for item in stream`，cancel_event 检查在
        循环体内——当 LLM 服务发送响应头后停止发送数据（连接未关闭）时，
        `__anext__()` 永久阻塞，循环体（含 cancel_event 检查）永不执行，导致
        暂停/停止无法中断 LLM 调用（实测 subagent resume 流停滞 408s）。本方法用
        asyncio.wait_for 包裹 __anext__，超时（流停滞）抛出 StopAsyncIteration
        结束流循环，使上游 cancel_event 检查得以执行、执行任务得以结束。

        调用方按 `while True` + 捕获 StopAsyncIteration 改写循环（不能再用 async for）。

        Args:
            iterator: 支持 __anext__ 的异步迭代器（AsyncStream / async generator）。
            timeout: stall 超时秒数（两次 chunk 之间最大允许间隔）。

        Raises:
            StopAsyncIteration: 流正常结束或 stall 超时（视为异常结束）。
        """
        try:
            return await asyncio.wait_for(iterator.__anext__(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(f"Model stream stalled (no chunk within {timeout}s), aborting stream")
            raise StopAsyncIteration
        # StopAsyncIteration（正常结束）原样传播给调用方循环

    def _save_response_ref(self, response):
        self._active_response = response
        self._was_cancelled = False

    def _clear_response_ref(self):
        self._active_response = None
