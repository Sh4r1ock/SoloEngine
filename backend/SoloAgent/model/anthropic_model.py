# -*- coding: utf-8 -*-
"""
SoloEngine : Anthropic Claude模型实现，支持Claude 3系列

@file anthropic_model.py
@description 实现Anthropic Claude系列模型的API调用，支持Claude 3 Opus/Sonnet/Haiku
@author Sh4rlock
@date 2026-04-09

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
from zoneinfo import ZoneInfo
import asyncio
import json
from typing import (
    Any,
    TYPE_CHECKING,
    AsyncGenerator,
    Literal,
    Type,
)
from collections import OrderedDict

import anthropic
from anthropic.types import (
    Message,
    TextBlock,
    ToolUseBlock,
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
    ThinkingBlock as SoloThinkingBlock,
)
from ..utils.logging import logger
from ..types import JSONSerializableObject
from app.core.config import settings

if TYPE_CHECKING:
    from anthropic import AsyncStream
else:
    AsyncStream = "anthropic.AsyncStream"



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
        api_key: str,
        stream: bool = True,
        client_kwargs: dict[str, JSONSerializableObject] | None = None,
        generate_kwargs: dict[str, JSONSerializableObject] | None = None,
        **kwargs: Any,
    ) -> None:
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

        if not api_key:
            raise ValueError(
                "Anthropic API key not provided. "
                "Please configure your API key in Settings > LLM Configuration."
            )

        self.client = anthropic.AsyncAnthropic(
            api_key=api_key,
            **(client_kwargs or {}),
        )

        self.generate_kwargs = generate_kwargs or {}

    async def __call__(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: Literal["auto", "none", "any"] | str | None = None,
        structured_model: Type[object] | None = None,
        cancel_event: asyncio.Event = None,
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

        # 将 OpenAI 格式消息转换为 Anthropic 格式
        messages = self._convert_openai_to_anthropic_messages(messages)

        if not all("role" in msg and "content" in msg for msg in messages):
            raise ValueError(
                "Each message in the 'messages' list must contain a 'role' "
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
            "max_tokens": kwargs.pop("max_tokens", None),
            "temperature": kwargs.pop("temperature", None),
            "top_p": kwargs.pop("top_p", None),
            "top_k": kwargs.pop("top_k", None),
            **self.generate_kwargs,
            **kwargs,
        }
        gen_kwargs = {k: v for k, v in gen_kwargs.items() if v is not None}

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

        start_datetime = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))

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
                    cancel_event,
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
                    cancel_event,
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
        cancel_event: asyncio.Event = None,
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
            cancel_event (asyncio.Event, optional): 取消事件。默认为 None。
        
        Returns:
            AsyncGenerator[ChatResponse, None]: 异步生成器。
        """
        usage = None
        text = ""
        thinking = ""
        tool_calls = OrderedDict()
        metadata: dict | None = None
        current_response_id = None
        stop_reason = None  # 记录停止原因

        try:
            async with response as stream:
                self._save_response_ref(stream)
                async for event in stream:
                    if cancel_event and cancel_event.is_set():
                        logger.info("[Anthropic] Cancel event detected, breaking stream loop")
                        self._was_cancelled = True
                        break
                    if event.type == "message_start":
                        current_response_id = event.message.id
                        if hasattr(event.message, "stop_reason"):
                            stop_reason = event.message.stop_reason
                        # message_start 事件中包含 input_tokens，直接捕获
                        if hasattr(event.message, "usage") and event.message.usage:
                            usage = ChatUsage(
                                input_tokens=getattr(event.message.usage, 'input_tokens', 0) or 0,
                                output_tokens=getattr(event.message.usage, 'output_tokens', 0) or 0,
                                time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
                            )
                            logger.info(f"[Anthropic Stream] message_start usage: input={usage.input_tokens}")
                    elif event.type == "content_block_start":
                        if event.content_block.type == "text":
                            text = ""
                        elif event.content_block.type == "thinking":
                            thinking = ""
                    elif event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            # 直接输出 SDK 提供的增量文本，单一 block type
                            text += event.delta.text
                            yield ChatResponse(
                                content=[SoloTextBlock(type="text", text=event.delta.text)],
                                usage=usage,
                                metadata=metadata,
                            )
                        elif event.delta.type == "thinking_delta":
                            # 直接输出 SDK 提供的增量思考内容，单一 block type
                            thinking += event.delta.thinking
                            yield ChatResponse(
                                content=[SoloThinkingBlock(type="thinking", thinking=event.delta.thinking)],
                                usage=usage,
                                metadata=metadata,
                            )
                        elif event.delta.type == "input_json_delta":
                            # 累积完整 JSON（供 content_block_stop 后执行），同时输出增量
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
                            tool_call_delta = {
                                "index": list(tool_calls.keys()).index(tool_use_id),
                                "id": tool_use_id,
                                "type": "function",
                                "function": {
                                    "name": tool_calls[tool_use_id]["name"],
                                    "arguments": event.delta.partial_json or "",
                                }
                            }
                            yield ChatResponse(
                                content=[{
                                    "type": "tool_calls",
                                    "tool_calls": [tool_call_delta],
                                }],
                                usage=usage,
                                metadata=metadata,
                            )
                            
                    elif event.type == "content_block_stop":
                        # 工具调用 block 结束：输出完整的 tool_calls 供 ReActCore 执行
                        # 每个 tool_call 单独一个 ChatResponse（单一 block type）
                        for tool_id, tool_call in tool_calls.items():
                            tool_call_delta = {
                                "index": list(tool_calls.keys()).index(tool_id),
                                "id": tool_id,
                                "type": "function",
                                "function": {
                                    "name": tool_call["name"],
                                    "arguments": json.dumps(tool_call["input"], ensure_ascii=False),
                                }
                            }
                            yield ChatResponse(
                                content=[{
                                    "type": "tool_calls",
                                    "tool_calls": [tool_call_delta],
                                }],
                                usage=usage,
                                metadata=metadata,
                            )
                    elif event.type == "message_delta":
                        if event.delta.type == "delta" and event.delta.text:
                            text += event.delta.text
                        if hasattr(event, "delta") and hasattr(event.delta, "stop_reason"):
                            stop_reason = event.delta.stop_reason
                            logger.info(f"[Anthropic Stream] stop_reason detected: {stop_reason}")
                        # message_delta 事件中包含 output_tokens（累积值）
                        if hasattr(event, "usage") and event.usage:
                            usage = ChatUsage(
                                input_tokens=getattr(usage, 'input_tokens', 0) if usage else 0,
                                output_tokens=event.usage.output_tokens,
                                time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
                            )
                            logger.info(f"[Anthropic Stream] message_delta usage: output={usage.output_tokens}")
                    elif event.type == "message_stop":
                        # 始终 yield 最终 usage（纯文本场景无 tool_calls 时也需要）
                        yield ChatResponse(
                            content=[],
                            usage=usage,
                            metadata=metadata,
                            stop_reason=stop_reason,
                            finish_reason="tool_calls" if tool_calls else stop_reason,
                        )
                        # 每个 tool_call 单独一个 ChatResponse
                        for tool_id, tool_call in tool_calls.items():
                            tool_call_delta = {
                                "index": list(tool_calls.keys()).index(tool_id),
                                "id": tool_id,
                                "type": "function",
                                "function": {
                                    "name": tool_call["name"],
                                    "arguments": json.dumps(tool_call["input"], ensure_ascii=False),
                                }
                            }
                            yield ChatResponse(
                                content=[{"type": "tool_calls", "tool_calls": [tool_call_delta]}],
                                usage=usage,
                                metadata=metadata,
                                stop_reason=stop_reason,
                                finish_reason="tool_calls",
                            )
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
                            time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
                        )
        finally:
            self._clear_response_ref()

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
            SoloTextBlock | dict | SoloThinkingBlock
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
                    content_blocks.append({
                        "type": "tool_calls",
                        "tool_calls": [{
                            "index": len([b for b in content_blocks if isinstance(b, dict) and b.get("type") == "tool_calls"]),
                            "id": block.id,
                            "type": "function",
                            "function": {
                                "name": block.name,
                                "arguments": json.dumps(block.input, ensure_ascii=False) if block.input else "{}",
                            },
                        }],
                    })

        usage = None
        if response.usage:
            usage = ChatUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
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

        stop_reason = getattr(response, "stop_reason", None)
        if stop_reason:
            logger.info(f"[Anthropic Completion] stop_reason: {stop_reason}")

        metadata = metadata or {}
        metadata['original_model_message'] = response
        metadata['provider'] = 'anthropic'

        return ChatResponse(
            content=content_blocks,
            usage=usage,
            metadata=metadata,
            stop_reason=stop_reason,
        )

    @staticmethod
    def _convert_openai_to_anthropic_messages(messages: list[dict]) -> list[dict]:
        """
        将 OpenAI 格式消息转换为 Anthropic 格式。

        转换规则：
        1. assistant 消息中的 tool_calls → 转为 content 中的 tool_use 块
        2. assistant 消息中的 reasoning_content → 转为 thinking 块
        3. 连续的 role="tool" 消息 → 合并为一个 role="user" 的多个 tool_result 块
        4. 其他消息保持不变

        Args:
            messages: OpenAI 格式消息列表

        Returns:
            Anthropic 格式消息列表
        """
        result = []
        pending_tool_results = []

        for msg in messages:
            role = msg.get("role")

            if role == "assistant" and "tool_calls" in msg:
                # 先提交之前累积的 tool_result
                if pending_tool_results:
                    result.append({"role": "user", "content": pending_tool_results})
                    pending_tool_results = []

                # assistant 消息含 tool_calls → 转为 Anthropic content 块格式
                content = []
                # reasoning_content → thinking 块
                reasoning = msg.get("reasoning_content")
                if reasoning:
                    content.append({"type": "thinking", "thinking": reasoning})
                text = msg.get("content")
                if text:
                    content.append({"type": "text", "text": text})
                for tc in msg.get("tool_calls", []):
                    func = tc.get("function", {})
                    args = func.get("arguments", "{}")
                    if isinstance(args, str):
                        try:
                            args = json.loads(args) if args.strip() else {}
                        except json.JSONDecodeError:
                            args = {}
                    content.append({
                        "type": "tool_use",
                        "id": tc.get("id", ""),
                        "name": func.get("name", ""),
                        "input": args,
                    })
                result.append({"role": "assistant", "content": content})

            elif role == "tool":
                # 累积 tool_result，后续合并
                pending_tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": msg.get("tool_call_id", ""),
                    "content": msg.get("content", ""),
                })

            else:
                # 先提交之前累积的 tool_result
                if pending_tool_results:
                    result.append({"role": "user", "content": pending_tool_results})
                    pending_tool_results = []
                result.append(msg)

        # 提交最后的 tool_result
        if pending_tool_results:
            result.append({"role": "user", "content": pending_tool_results})

        return result
