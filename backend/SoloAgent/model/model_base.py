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

from .model_response import ChatResponse


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
        if self._active_response:
            try:
                await self._active_response.aclose()
            except Exception:
                pass
            self._active_response = None
        self._was_cancelled = True

    def _save_response_ref(self, response):
        self._active_response = response
        self._was_cancelled = False

    def _clear_response_ref(self):
        self._active_response = None
