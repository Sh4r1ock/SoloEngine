# -*- coding: utf-8 -*-
"""
Anthropic Claude 聊天模型类。

@file anthropic_model.py
@description 实现 Anthropic Claude 系列模型的 API 调用
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 支持 Anthropic Claude 系列模型（Claude 3 Opus, Sonnet, Haiku）
- 支持同步和流式输出
- 支持工具调用（Tool Use）
- 支持扩展思考（Extended Thinking）
- 支持多模态输入（文本、图像）

支持的模型：
    - claude-3-5-sonnet-20241022: Claude 3.5 Sonnet（最新）
    - claude-3-opus-20240229: Claude 3 Opus（最强）
    - claude-3-haiku-20240307: Claude 3 Haiku（最快）

特性：
    - 扩展思考：支持 Claude 的 thinking 模式
    - 工具调用：支持 Tool Use 功能
    - 多模态：支持图像输入
    - 系统提示：独立的系统消息参数

API 差异：
    Anthropic API 与 OpenAI API 有以下主要差异：
    - 系统消息通过单独的 system 参数传递
    - 消息格式略有不同
    - 工具调用结果格式不同

状态: ✅ 完整实现
"""

from datetime import datetime
from typing import (
    Any,
    TYPE_CHECKING,
    AsyncGenerator,
    Literal,
    Type,
    Optional,
)
from collections import OrderedDict

import anthropic
from anthropic.types import (
    Message,
    TextBlock,
    ImageBlockParam,
    ToolUseBlock,
    ToolResultBlockParam,
)

try:
    from anthropic.types import ThinkingBlock
    HAS_THINKING_BLOCK = True
except ImportError:
    ThinkingBlock = None
    HAS_THINKING_BLOCK = False

from .model_response import ChatResponse
from .model_base import ChatModelBase
from .model_usage import ChatUsage
from ..message import (
    TextBlock as SoloTextBlock,
    ToolUseBlock as SoloToolUseBlock,
    ToolResultBlock as SoloToolResultBlock,
    ThinkingBlock as SoloThinkingBlock,
    ImageBlock as SoloImageBlock,
    AudioBlock as SoloAudioBlock,
    Base64Source as SoloBase64Source,
    URLSource as SoloURLSource,
)
from ..utils.logging import logger
from ..types import JSONSerializableObject

if TYPE_CHECKING:
    from anthropic import AsyncStream
else:
    AsyncStream = "anthropic.AsyncStream"


def _convert_anthropic_message_to_solo_format(
    msg: Message,
) -> dict:
    """
    将 Anthropic 消息转换为 SoloEngine 格式。
    
    Anthropic API 返回的消息格式与 SoloEngine 内部格式不同，
    此函数负责格式转换。
    
    Args:
        msg (Message): Anthropic 消息对象。
    
    Returns:
        dict: SoloEngine 格式的消息字典，包含：
            - role: 消息角色
            - content: 内容块列表
    
    Note:
        支持转换的内容块类型：
        - TextBlock: 文本内容
        - ImageBlockParam: 图像内容
        - ThinkingBlock: 思考过程
        - ToolResultBlockParam: 工具调用结果
    """
    content = []

    if hasattr(msg, 'content') and msg.content:
        for block in msg.content:
            if isinstance(block, TextBlock):
                content.append({
                    "type": "text",
                    "text": block.text,
                })
            elif isinstance(block, ImageBlockParam):
                source = None
                if isinstance(block.source, dict):
                    if "data" in block.source:
                        source = {
                            "type": "base64",
                            "media_type": block.source.get("media_type", "image/jpeg"),
                            "data": block.source["data"],
                        }
                    elif "url" in block.source:
                        source = {
                            "type": "url",
                            "url": block.source["url"],
                        }

                if source:
                    content.append({
                        "type": "image",
                        "source": source,
                    })
            elif HAS_THINKING_BLOCK and isinstance(block, ThinkingBlock):
                content.append({
                    "type": "thinking",
                    "thinking": block.text,
                })

    if isinstance(msg, dict) and "role" in msg and msg["role"] == "user":
        if "tool_result_blocks" in msg:
            for result in msg["tool_result_blocks"]:
                if isinstance(result, ToolResultBlockParam):
                    result_block = {
                        "type": "tool_result",
                        "id": result.tool_use_id,
                        "name": result.content[0].text if result.content else "",
                        "output": None,
                    }
                    if result.content:
                        result_block["output"] = "\n".join(
                            block.text for block in result.content
                            if isinstance(block, TextBlock)
                        )
                    content.append(result_block)

    if isinstance(msg, dict) and "role" in msg and msg["role"] == "assistant":
        if "content" in msg:
            for block in msg["content"]:
                if isinstance(block, ToolUseBlock):
                    content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input if isinstance(block.input, dict) else {},
                    })

    return {
        "role": msg.role if hasattr(msg, 'role') else msg.get("role"),
        "content": content,
    }


class AnthropicChatModel(ChatModelBase):
    """
    Anthropic Claude 聊天模型类。
    
    实现 Anthropic Claude 系列模型的 API 调用，支持同步和流式输出、
    工具调用、扩展思考等功能。
    
    核心功能：
        1. 模型调用：通过 __call__ 方法调用 Anthropic API
        2. 流式输出：支持逐步返回生成内容
        3. 工具调用：支持 Tool Use 功能
        4. 扩展思考：支持 Claude 的 thinking 模式
    
    支持的模型：
        - Claude 3.5 Sonnet: claude-3-5-sonnet-20241022
        - Claude 3 Opus: claude-3-opus-20240229
        - Claude 3 Haiku: claude-3-haiku-20240307
    
    API 差异说明：
        Anthropic API 与 OpenAI API 有以下主要差异：
        - 系统消息通过单独的 system 参数传递，不在消息列表中
        - 消息格式略有不同，需要格式转换
        - 工具调用结果格式不同
    
    Example:
        >>> model = AnthropicChatModel(
        ...     model_name="claude-3-5-sonnet-20241022",
        ...     api_key="sk-ant-...",
        ...     stream=False
        ... )
        >>> 
        >>> messages = [{"role": "user", "content": "你好"}]
        >>> response = await model(messages)
        >>> print(response.content[0]["text"])
    
    Note:
        - API 密钥可通过参数或环境变量 ANTHROPIC_API_KEY 提供
        - 系统消息会被自动提取并使用单独参数传递
        - 流式输出时返回异步生成器
    """

    def __init__(
        self,
        model_name: str,
        api_key: str | None = None,
        stream: bool = True,
        api_key_env_var: str = "ANTHROPIC_API_KEY",
        client_kwargs: dict[str, JSONSerializableObject] | None = None,
        generate_kwargs: dict[str, JSONSerializableObject] | None = None,
        **kwargs: Any,
    ) -> None:
        """
        初始化 Anthropic 客户端。
        
        Args:
            model_name (str): 模型名称，如：
                - 'claude-3-5-sonnet-20241022'
                - 'claude-3-opus-20240229'
                - 'claude-3-haiku-20240307'
            api_key (str | None, optional): API 密钥。如果未指定，
                从环境变量读取。默认为 None。
            stream (bool, optional): 是否启用流式输出。默认为 True。
            api_key_env_var (str, optional): API 密钥的环境变量名。
                默认为 "ANTHROPIC_API_KEY"。
            client_kwargs (dict | None, optional): 初始化 Anthropic 客户端的
                额外参数。默认为 None。
            generate_kwargs (dict | None, optional): API 调用时的额外参数，
                如 temperature, max_tokens 等。默认为 None。
            **kwargs: 额外的关键字参数。
        
        Raises:
            ValueError: 当 API 密钥未提供且环境变量未设置时抛出。
        
        Note:
            - client_args 参数已弃用，请使用 client_kwargs
        """
        super().__init__(model_name, stream)

        client_args = kwargs.pop("client_args", None)
        if client_args is not None and client_kwargs is not None:
            raise ValueError(
                "Cannot specify both 'client_args' and 'client_kwargs'. "
                "Please use only 'client_kwargs' (client_args is deprecated)."
            )
        if client_args is not None:
            logger.warning(
                "The parameter 'client_args' is deprecated and will be "
                "removed in a future version. Please use 'client_kwargs' "
                "instead. Automatically converting 'client_args' to "
                "'client_kwargs'."
            )
            client_kwargs = client_args

        if kwargs:
            logger.warning(
                f"Unknown keyword arguments: {list(kwargs.keys())}. "
                "These will be ignored."
            )

        import os
        key = api_key or os.environ.get(api_key_env_var)
        if not key:
            raise ValueError(
                f"Anthropic API key not provided and not found in environment "
                f"variable '{api_key_env_var}'"
            )

        self.client = anthropic.AsyncAnthropic(
            api_key=key,
            **(client_kwargs or {}),
        )

        self.generate_kwargs = generate_kwargs or {}
        self.api_key_env_var = api_key_env_var

    async def __call__(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: Literal["auto", "none", "any"] | str | None = None,
        structured_model: Type[object] | None = None,
        **kwargs: Any,
    ) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
        """
        调用 Anthropic Messages API 获取响应。
        
        这是模型的主要接口方法，支持多种调用模式。
        
        Args:
            messages (list[dict]): 消息列表，每条消息必须包含：
                - role: 角色（system/user/assistant）
                - content: 内容（字符串或内容块列表）
            tools (list[dict] | None, optional): 工具定义列表。
                默认为 None。
            tool_choice (Literal["auto", "none", "any"] | str | None, optional):
                工具选择模式。默认为 None。
            structured_model (Type[object] | None, optional):
                结构化输出的模型类。默认为 None。
            **kwargs: Anthropic API 的额外参数，如：
                - temperature: 生成温度
                - max_tokens: 最大输出 token 数
                - top_p: 核采样参数
                - top_k: Top-K 采样参数
        
        Returns:
            ChatResponse | AsyncGenerator[ChatResponse, None]:
                - 如果 stream=False，返回 ChatResponse 对象
                - 如果 stream=True，返回异步生成器
        
        Raises:
            ValueError: 当消息格式不正确时抛出。
        
        Note:
            - 系统消息会被自动提取并使用单独参数传递
            - structured_model 模式下会忽略 tools 和 tool_choice
        """
        if not isinstance(messages, list):
            raise ValueError(
                f"Anthropic 'messages' field expected type 'list', "
                f"got {type(messages)} instead."
            )
        if not all("role" in msg and "content" in msg for msg in messages):
            raise ValueError(
                "Each message in 'messages' list must contain a 'role' "
                "and 'content' key for Anthropic API."
            )

        anthropic_messages: list[Message | dict] = []

        system_message = None
        if messages and messages[0].get("role") == "system":
            system_message = messages[0]
            remaining_messages = messages[1:]
        else:
            remaining_messages = messages

        anthropic_messages.extend(remaining_messages)

        gen_kwargs = {
            "model": self.model_name,
            "max_tokens": kwargs.get("max_tokens", 4096),
            "temperature": kwargs.get("temperature", 0.7),
            "top_p": kwargs.get("top_p", 1.0),
            "top_k": kwargs.get("top_k"),
            **self.generate_kwargs,
            **kwargs,
        }

        if self.stream:
            gen_kwargs["stream"] = True

        if tools:
            gen_kwargs["tools"] = tools

        if structured_model:
            if tools:
                logger.warning(
                    "structured_model is provided. Both 'tools' and "
                    "'tool_choice' parameters will be overridden and "
                    "ignored. The model will only perform structured output "
                    "generation without calling any other tools."
                )
            gen_kwargs["tool_choice"] = {"type": "any", "name": "formatted_response"}
            gen_kwargs["betas"] = ["computer-use-2024-10-22"]

        start_datetime = datetime.now()

        if self.stream:
            if system_message:
                response = await self.client.messages.create(
                    system=system_message.get("content"),
                    messages=anthropic_messages,
                    **gen_kwargs,
                )
                return self._parse_anthropic_stream_response(
                    start_datetime,
                    response,
                    structured_model,
                )
            else:
                response = await self.client.messages.stream(
                    messages=anthropic_messages,
                    **gen_kwargs,
                )
                return self._parse_anthropic_stream_response(
                    start_datetime,
                    response,
                    structured_model,
                )
        else:
            if system_message:
                response = await self.client.messages.create(
                    system=system_message.get("content"),
                    messages=anthropic_messages,
                    **gen_kwargs,
                )
                return self._parse_anthropic_completion_response(
                    start_datetime,
                    response,
                    structured_model,
                )
            else:
                response = await self.client.messages.create(
                    messages=anthropic_messages,
                    **gen_kwargs,
                )
                return self._parse_anthropic_completion_response(
                    start_datetime,
                    response,
                    structured_model,
                )

    async def _parse_anthropic_stream_response(
        self,
        start_datetime: datetime,
        response: AsyncStream,
        structured_model: Type[object] | None = None,
    ) -> AsyncGenerator[ChatResponse, None]:
        """
        解析 Anthropic 流式响应。
        
        从 Anthropic 流式响应中提取内容块和使用量信息，
        逐步生成 ChatResponse 对象。
        
        Args:
            start_datetime (datetime): 响应生成的开始时间。
            response (AsyncStream): Anthropic 异步流对象。
            structured_model (Type[object] | None, optional):
                结构化输出的模型类。默认为 None。
        
        Returns:
            AsyncGenerator[ChatResponse, None]: 异步生成器。
        """
        usage = None
        text = ""
        thinking = ""
        tool_calls = OrderedDict()
        metadata: dict | None = None
        current_response_id = None

        async with response as stream:
            async for event in stream:
                if event.type == "message_start":
                    current_response_id = event.message.id
                elif event.type == "content_block_start":
                    if event.content_block.type == "text":
                        text = ""
                    elif event.content_block.type == "thinking":
                        thinking = ""
                elif event.type == "content_block_delta":
                    if event.content_block.type == "text":
                        text += event.delta.text
                    elif event.content_block.type == "thinking":
                        thinking += event.delta.text
                    elif event.content_block.type == "input_json":
                        if event.delta.type == "tool_use":
                            tool_use_id = event.content_block.index
                            if tool_use_id not in tool_calls:
                                tool_calls[tool_use_id] = {
                                    "type": "tool_use",
                                    "id": tool_use_id,
                                    "name": "",
                                    "input": {},
                                }
                            if event.delta.partial_json:
                                tool_calls[tool_use_id]["input"].update(
                                    event.delta.partial_json
                                )
                                tool_calls[tool_use_id]["name"] = event.delta.partial_json.get(
                                    "name", ""
                                )
                elif event.type == "content_block_stop":
                    contents = []
                    if thinking:
                        contents.append(
                            SoloThinkingBlock(
                                type="thinking",
                                thinking=thinking,
                            ),
                        )
                    if text:
                        contents.append(
                            SoloTextBlock(
                                type="text",
                                text=text,
                            ),
                        )
                    for tool_call in tool_calls.values():
                        contents.append(
                            SoloToolUseBlock(
                                type=tool_call["type"],
                                id=tool_call["id"],
                                name=tool_call["name"],
                                input=tool_call["input"],
                            ),
                        )
                    if contents:
                        res = ChatResponse(
                            content=contents,
                            usage=usage,
                            metadata=metadata,
                        )
                        yield res
                elif event.type == "message_delta":
                    if event.delta.type == "delta" and event.delta.text:
                        text += event.delta.text
                elif event.type == "message_stop":
                    contents = []
                    if thinking:
                        contents.append(
                            SoloThinkingBlock(
                                type="thinking",
                                thinking=thinking,
                            ),
                        )
                    if text:
                        contents.append(
                            SoloTextBlock(
                                type="text",
                                text=text,
                            ),
                        )
                    for tool_call in tool_calls.values():
                        contents.append(
                            SoloToolUseBlock(
                                type=tool_call["type"],
                                id=tool_call["id"],
                                name=tool_call["name"],
                                input=tool_call["input"],
                            ),
                        )
                    if contents:
                        res = ChatResponse(
                            content=contents,
                            usage=usage,
                            metadata=metadata,
                        )
                        yield res
                elif event.type == "error":
                    logger.error(f"Anthropic stream error: {event.error}")
                    yield ChatResponse(
                        content=[],
                        usage=None,
                        metadata={"error": str(event.error)},
                    )
                elif event.type == "usage":
                    usage = ChatUsage(
                        input_tokens=event.usage.input_tokens,
                        output_tokens=event.usage.output_tokens,
                        time=(datetime.now() - start_datetime).total_seconds(),
                    )

    async def _parse_anthropic_completion_response(
        self,
        start_datetime: datetime,
        response: anthropic.types.Message,
        structured_model: Type[object] | None = None,
    ) -> ChatResponse:
        """
        解析 Anthropic 非流式响应。
        
        从 Anthropic Message 对象中提取内容块和使用量信息。
        
        Args:
            start_datetime (datetime): 响应生成的开始时间。
            response (Message): Anthropic Message 对象。
            structured_model (Type[object] | None, optional):
                结构化输出的模型类。默认为 None。
        
        Returns:
            ChatResponse: 包含内容块和使用量的响应对象。
        """
        content_blocks: list[
            SoloTextBlock | SoloToolUseBlock | SoloThinkingBlock
        ] = []

        if response.content:
            for block in response.content:
                if isinstance(block, TextBlock):
                    content_blocks.append(
                        SoloTextBlock(
                            type="text",
                            text=block.text,
                        ),
                    )
                elif HAS_THINKING_BLOCK and isinstance(block, ThinkingBlock):
                    content_blocks.append(
                        SoloThinkingBlock(
                            type="thinking",
                            thinking=block.text,
                        ),
                    )
                elif isinstance(block, ToolUseBlock):
                    content_blocks.append(
                        SoloToolUseBlock(
                            type="tool_use",
                            id=block.id,
                            name=block.name,
                            input=block.input if block.input else {},
                        ),
                    )

        usage = None
        if response.usage:
            usage = ChatUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                time=(datetime.now() - start_datetime).total_seconds(),
            )

        metadata: dict | None = None
        if structured_model and response.content:
            try:
                import json
                if isinstance(response.content[-1], TextBlock):
                    structured_data = json.loads(response.content[-1].text)
                    metadata = structured_data
            except (json.JSONDecodeError, Exception) as e:
                logger.warning(f"Failed to parse structured output: {e}")

        return ChatResponse(
            content=content_blocks,
            usage=usage,
            metadata=metadata,
        )
