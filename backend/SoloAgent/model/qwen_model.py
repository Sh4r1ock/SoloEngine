# -*- coding: utf-8 -*-
"""
SoloEngine : 通义千问(Qwen)模型实现，支持阿里DashScope API

@file qwen_model.py
@description 实现通义千问系列模型的调用接口，支持流式输出和工具调用
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供通义千问(Qwen)系列模型的实现，包括：
    - QwenChatModel: 千问模型主类
    - 支持流式输出和非流式输出
    - 支持工具调用(Function Calling)
    - 支持多轮对话
    - 自动处理API密钥和环境变量

依赖:
    - dashscope: 阿里云DashScope SDK
    - datetime: 时间处理
    - typing: 类型提示
    - collections: 有序字典
    - .model_response: 响应类
    - .model_base: 模型基类
    - .model_usage: 使用统计类
    - ..message: 消息类型定义

使用示例:
    - from SoloAgent.model import QwenChatModel
    - model = QwenChatModel(model_name="qwen-plus", api_key="your_key")
    - response = await model(messages)
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

from app.core.config import settings

from dashscope import Generation

try:
    from dashscope import Message
    HAS_MESSAGE = True
except ImportError:
    Message = None
    HAS_MESSAGE = False

try:
    from dashscope import AsyncGeneration
    HAS_ASYNC_GENERATION = True
except ImportError:
    AsyncGeneration = None
    HAS_ASYNC_GENERATION = False

try:
    from dashscope.types import Role
    HAS_ROLE = True
except ImportError:
    Role = None
    HAS_ROLE = False

from .model_response import ChatResponse
from .model_base import ChatModelBase
from .model_usage import ChatUsage
from ..message import (
    TextBlock as SoloTextBlock,
    ToolUseBlock as SoloToolUseBlock,
    ThinkingBlock as SoloThinkingBlock,
)
from ..utils.logging import logger
from ..types import JSONSerializableObject

if TYPE_CHECKING:
    from dashscope import AsyncStream
else:
    AsyncStream = "dashscope.AsyncStream"


class QwenChatModel(ChatModelBase):
    """
    通义千问(Qwen)聊天模型类
    
    职责:
        - 实现通义千问系列模型的 API 调用
        - 支持流式输出和非流式输出
        - 支持工具调用(Function Calling)
        - 支持多轮对话
    
    属性:
        model_name: 模型名称
        api_key: API密钥
        stream: 是否使用流式输出
        api_key_env_var: API密钥环境变量名
        client_kwargs: 客户端额外参数
        generate_kwargs: 生成参数
    
    示例:
        >>> model = QwenChatModel(
        ...     model_name="qwen-plus",
        ...     api_key="your_key",
        ...     stream=True
        ... )
        >>> messages = [{"role": "user", "content": "你好"}]
        >>> response = await model(messages)
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
                "Qwen API key not provided. "
                "Please configure your API key in Settings > LLM Configuration."
            )

        from dashscope import AsyncDashScope
        self.client = AsyncDashScope(
            api_key=api_key,
            **(client_kwargs or {}),
        )

        self.generate_kwargs = generate_kwargs or {}

    @property
    def _tools_param_key(self) -> str:
        """Return the key name for tools parameter based on model name."""
        # Different Qwen models may use different parameter names
        # Most models use "tools", but some may use "tools_list"
        return "tools"

    async def __call__(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: Literal["auto", "none", "any"] | str | None = None,
        structured_model: Type[object] | None = None,
        cancel_event: asyncio.Event = None,
        **kwargs: Any,
    ) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
        """Get response from Qwen messages API by given arguments.

        Args:
            messages (list[dict]): A list of dictionaries, where 'role' and 'content'
                fields are required, and 'name' field is optional.
            tools (list[dict] | None): The tools JSON schemas that model can use.
            tool_choice (Literal["auto", "none", "any"] | str | None):
                Controls which (if any) tool is called by the model.
                Can be "auto", "none", "any", or specific tool name.
            structured_model (Type[object] | None):
                A Pydantic BaseModel class that defines the expected structure
                for the model's output. When provided, the model will be forced
                to return data that conforms to this schema by automatically
                converting the BaseModel to a tool function and setting
                `tool_choice` to enforce its usage.

                .. note::
                    When `structured_model` is specified, both `tools` and
                    `tool_choice` parameters are ignored, and the model will only
                    perform structured output generation without calling any other tools.
            **kwargs (Any): The keyword arguments for Qwen messages API,
                e.g., `temperature`, `max_tokens`, `top_p`, etc.

        Returns:
            ChatResponse | AsyncGenerator[ChatResponse, None]: The response.

        Notes:
            When `structured_model` is specified, the expected structured output will
            be stored in the metadata of the `ChatResponse`.
        """
        # Check messages format
        if not isinstance(messages, list):
            raise ValueError(
                f"Qwen 'messages' field expected type 'list', "
                f"got {type(messages)} instead."
            )
        if not all("role" in msg and "content" in msg for msg in messages):
            raise ValueError(
                "Each message in 'messages' list must contain a 'role' "
                "and 'content' key for Qwen API."
            )

        # Format messages for Qwen
        qwen_messages: list[dict] = []
        for msg in messages:
            role = msg["role"].upper()
            if role == "TOOL":
                tool_call_id = msg.get("tool_call_id", "")
                content = msg.get("content", "")
                if isinstance(content, list):
                    text_parts = []
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                    content = "\n".join(text_parts) if text_parts else str(content)
                qwen_messages.append({"role": "tool", "content": content, "tool_call_id": tool_call_id})
                continue
            elif role not in ["SYSTEM", "USER", "ASSISTANT"]:
                role = "USER" if role == "SYSTEM" else role
            content = msg.get("content", "")
            if isinstance(content, str):
                content = [{"text": content}]
            elif isinstance(content, list):
                # Convert SoloEngine content blocks to Qwen format
                content = []
                for block in msg["content"]:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            content.append({"text": block.get("text", "")})
                        elif block.get("type") == "thinking":
                            content.append({"text": block.get("thinking", "")})
                        elif block.get("type") == "image":
                            source = block.get("source", {})
                            if isinstance(source, dict):
                                if source.get("type") == "base64":
                                    content.append({
                                        "image": f"data:{source.get('media_type', 'image/jpeg')};base64,{source.get('data', '')}"
                                    })
                                elif source.get("type") == "url":
                                    content.append({
                                        "image": source.get("url", "")
                                    })
                        elif block.get("type") == "tool_result":
                            result_content = block.get("output", "")
                            if isinstance(result_content, str):
                                content.append({"text": result_content})
                            elif isinstance(result_content, list):
                                for r in result_content:
                                    if isinstance(r, dict) and r.get("type") == "text":
                                        content.append({"text": r.get("text", "")})
                        elif block.get("type") == "tool_use":
                            # Skip tool_use blocks in content - they're for output only
                            pass
            if HAS_MESSAGE and HAS_ROLE:
                qwen_messages.append(Message(role=Role[role], content=content))
            else:
                qwen_messages.append({"role": role.lower(), "content": content})

        # Build generation kwargs
        gen_kwargs = {
            "model": self.model_name,
            "result_format": "message",
            **self.generate_kwargs,
            **kwargs,
        }

        # Handle tools
        if tools:
            gen_kwargs[self._tools_param_key] = tools

        # Handle tool choice
        if tool_choice:
            # Handle deprecated "any" option with warning
            if tool_choice == "any":
                import warnings
                warnings.warn(
                    '"any" is deprecated and will be removed in a future '
                    'version.',
                    DeprecationWarning,
                )
                tool_choice = "auto"
            self._validate_tool_choice(tool_choice, tools)
            gen_kwargs["tool_choice"] = tool_choice

        start_datetime = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))

        # Handle structured model (Qwen calls it result_format)
        if structured_model:
            if tools or tool_choice:
                logger.warning(
                    "structured_model is provided. Both 'tools' and "
                    "'tool_choice' parameters will be overridden and "
                    "ignored. The model will only perform structured output "
                    "generation without calling any other tools."
                )
            # For Qwen, structured output is handled via result_format
            # We'll store the structured model schema in metadata
            kwargs.pop("stream", None)  # Qwen doesn't support streaming with result_format
            if not self.stream:
                response = await self.client.calls.call(
                    qwen_messages,
                    **gen_kwargs,
                )
                return self._parse_qwen_completion_response(
                    start_datetime,
                    response,
                    structured_model,
                )
            else:
                # For streaming with structured output, we need a different approach
                # Qwen's streaming with result_format may have limitations
                raise ValueError(
                    "Streaming with structured output is not currently supported "
                    "for Qwen. Please set stream=False."
                )
        else:
            if self.stream:
                gen_kwargs["stream"] = True
                response = await self.client.calls.call(qwen_messages, **gen_kwargs)
                return self._parse_qwen_stream_response(
                    start_datetime,
                    response,
                    cancel_event,
                )
            else:
                response = await self.client.calls.call(qwen_messages, **gen_kwargs)
                return self._parse_qwen_completion_response(
                    start_datetime,
                    response,
                    structured_model,
                )

    async def _parse_qwen_stream_response(
        self,
        start_datetime: datetime,
        response: Any,
        cancel_event: asyncio.Event = None,
    ) -> AsyncGenerator[ChatResponse, None]:
        """Parse Qwen streaming response and yield ChatResponse objects.

        Args:
            start_datetime (datetime): The start datetime of response generation.
            response: Qwen AsyncGeneration object.
            cancel_event (asyncio.Event, optional): Cancel event. Defaults to None.

        Returns:
            AsyncGenerator[ChatResponse, None]: Generator yielding ChatResponse objects.
        """
        usage = None
        text = ""
        thinking = ""
        tool_calls = OrderedDict()
        last_text = ""  # 记录上次输出的文本，用于计算增量
        last_thinking = ""  # 记录上次输出的思考内容，用于计算增量
        last_tool_calls = OrderedDict()  # 记录上次输出的工具调用，用于计算增量
        finish_reason = None  # 记录完成原因
        stop_reason = None  # 记录停止原因
        total_input_tokens = None
        total_output_tokens = None

        self._save_response_ref(response)
        try:
            async for chunk in response:
                if cancel_event and cancel_event.is_set():
                    logger.info("[Qwen] Cancel event detected")
                    self._was_cancelled = True
                    raise asyncio.CancelledError()
                if hasattr(chunk, "usage") and chunk.usage:
                    total_input_tokens = getattr(chunk.usage, 'input_tokens', None) or getattr(chunk.usage, 'prompt_tokens', None)
                    total_output_tokens = getattr(chunk.usage, 'output_tokens', None) or getattr(chunk.usage, 'completion_tokens', None)

                if hasattr(chunk, "output") and chunk.output:
                    output = chunk.output
                    if hasattr(chunk, "finish_reason"):
                        finish_reason = chunk.finish_reason
                        if finish_reason == "stop":
                            stop_reason = "end_turn"
                            if total_input_tokens is not None or total_output_tokens is not None:
                                usage = ChatUsage(
                                    input_tokens=total_input_tokens,
                                    output_tokens=total_output_tokens,
                                    time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
                                )
                                logger.info(f"[Qwen Stream] usage at end: input={total_input_tokens}, output={total_output_tokens}")
                        elif finish_reason == "tool_calls":
                            stop_reason = "tool_use"
                        logger.info(f"[Qwen Stream] finish_reason: {finish_reason}, stop_reason: {stop_reason}")
                    
                    if isinstance(output, list) and output:
                        for msg in output:
                            if hasattr(msg, "text") and msg.text:
                                text += msg.text
                            elif hasattr(msg, "reasoning_content") and msg.reasoning_content:
                                thinking += msg.reasoning_content
                            elif hasattr(msg, "tool_calls") and msg.tool_calls:
                                for tool_call in msg.tool_calls:
                                    tool_id = tool_call.get("id", "")
                                    function = tool_call.get("function", {})
                                    tool_name = function.get("name", "")
                                    arguments = function.get("arguments", {})

                                    if tool_id not in tool_calls:
                                        tool_calls[tool_id] = {
                                            "type": "tool_use",
                                            "id": tool_id,
                                            "name": tool_name,
                                            "input": {},
                                        }
                                    tool_calls[tool_id]["input"].update(arguments)
                            elif hasattr(msg, "content") and msg.content:
                                for block in msg.content:
                                    if isinstance(block, str):
                                        text += block
                                    elif isinstance(block, dict):
                                        if block.get("type") == "text":
                                            text += block.get("text", "")
                                        elif block.get("type") == "thinking":
                                            thinking += block.get("text", "")

                contents = []
                if thinking and len(thinking) > len(last_thinking):
                    delta_thinking_content = thinking[len(last_thinking):]
                    contents.append(
                        SoloThinkingBlock(
                            type="thinking",
                            thinking=delta_thinking_content,
                        ),
                    )
                    last_thinking = thinking
                if text and len(text) > len(last_text):
                    delta_text_content = text[len(last_text):]
                    contents.append(
                        SoloTextBlock(
                            type="text",
                            text=delta_text_content,
                        ),
                    )
                    last_text = text
                
                for tool_id, tool_call in tool_calls.items():
                    index = list(tool_calls.keys()).index(tool_id)
                    last_call = last_tool_calls.get(tool_id)
                    tool_call_chunks = []
                    
                    if last_call is None:
                        tool_call_chunks.append({
                            "index": index,
                            "id": tool_id,
                            "type": "function",
                            "function": {
                                "name": tool_call["name"],
                                "arguments": "",
                            }
                        })
                        logger.info(f"[Qwen] Tool call start: index={index}, id={tool_id}, name={tool_call.get('name')}")
                        
                        if tool_call.get("input"):
                            args_str = json.dumps(tool_call["input"], ensure_ascii=False)
                            tool_call_chunks.append({
                                "index": index,
                                "id": None,
                                "type": "function",
                                "function": {
                                    "name": None,
                                    "arguments": args_str,
                                }
                            })
                            logger.info(f"[Qwen] Tool call initial args: index={index}, args={args_str[:50]}...")
                    else:
                        current_input = tool_call.get("input", {})
                        last_input = last_call.get("input", {})
                        current_args = json.dumps(current_input, ensure_ascii=False)
                        last_args = json.dumps(last_input, ensure_ascii=False)
                        if current_args and len(current_args) > len(last_args):
                            delta_args = current_args[len(last_args):]
                            if delta_args:
                                tool_call_chunks.append({
                                    "index": index,
                                    "id": None,
                                    "type": "function",
                                    "function": {
                                        "name": None,
                                        "arguments": delta_args,
                                    }
                                })
                                logger.info(f"[Qwen] Tool call args delta: index={index}, delta={delta_args[:50]}...")
                    
                    for chunk_data in tool_call_chunks:
                        contents.append({
                            "type": "tool_calls",
                            "tool_calls": [chunk_data],
                        })
                
                last_tool_calls = OrderedDict(tool_calls)
                
                if contents:
                    res = ChatResponse(
                        content=contents,
                        usage=usage,
                        metadata=None,
                        stop_reason=stop_reason,
                        finish_reason=finish_reason,
                    )
                    yield res
        finally:
            self._clear_response_ref()

    async def _parse_qwen_completion_response(
        self,
        start_datetime: datetime,
        response: Generation,
        structured_model: Type[object] | None = None,
    ) -> ChatResponse:
        """Parse Qwen non-streaming completion response.

        Args:
            start_datetime (datetime): The start datetime of response generation.
            response (Generation): Qwen Generation object.
            structured_model (Type[object] | None): Pydantic model for structured output.

        Returns:
            ChatResponse: The parsed response.
        """
        content_blocks: list[
            SoloTextBlock | SoloToolUseBlock | SoloThinkingBlock
        ] = []
        metadata: dict | None = None

        if hasattr(response, "output") and response.output:
            output = response.output
            if isinstance(output, list) and output:
                for msg in output:
                    if hasattr(msg, "text") and msg.text:
                        content_blocks.append(
                            SoloTextBlock(
                                type="text",
                                text=msg.text,
                            ),
                        )
                    elif hasattr(msg, "reasoning_content") and msg.reasoning_content:
                        content_blocks.append(
                            SoloThinkingBlock(
                                type="thinking",
                                thinking=msg.reasoning_content,
                            ),
                        )
                    elif hasattr(msg, "tool_calls") and msg.tool_calls:
                        for tool_call in msg.tool_calls:
                            content_blocks.append(
                                SoloToolUseBlock(
                                    type="tool_use",
                                    id=tool_call.get("id", ""),
                                    name=tool_call.get("function", {}).get("name", ""),
                                    input=tool_call.get("function", {}).get("arguments", {}),
                                ),
                            )
                    elif hasattr(msg, "content") and msg.content:
                        # Handle content blocks
                        for block in msg.content:
                            if isinstance(block, str):
                                content_blocks.append(
                                    SoloTextBlock(
                                        type="text",
                                        text=block,
                                    ),
                                )
                            elif isinstance(block, dict):
                                if block.get("type") == "text":
                                    content_blocks.append(
                                        SoloTextBlock(
                                            type="text",
                                            text=block.get("text", ""),
                                        ),
                                    )
                                elif block.get("type") == "thinking":
                                    content_blocks.append(
                                        SoloThinkingBlock(
                                            type="thinking",
                                            thinking=block.get("text", ""),
                                        ),
                                    )

        if structured_model:
            # Store structured model info in metadata
            metadata = {
                "structured_model": structured_model.__name__,
                "structured_output": response.output[0].text if response.output and len(response.output) > 0 else None,
            }

        usage = None
        if hasattr(response, "usage") and response.usage:
            input_tok = getattr(response.usage, 'input_tokens', None) or getattr(response.usage, 'prompt_tokens', None)
            output_tok = getattr(response.usage, 'output_tokens', None) or getattr(response.usage, 'completion_tokens', None)
            if input_tok is not None or output_tok is not None:
                usage = ChatUsage(
                    input_tokens=input_tok,
                    output_tokens=output_tok,
                    time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
                )
                logger.info(f"[Qwen Completion] usage: input={input_tok}, output={output_tok}")

        finish_reason = getattr(response, "finish_reason", None)
        stop_reason = None
        if finish_reason:
            if finish_reason == "stop":
                stop_reason = "end_turn"
            elif finish_reason == "tool_calls":
                stop_reason = "tool_use"
            logger.info(f"[Qwen Completion] finish_reason: {finish_reason}, stop_reason: {stop_reason}")

        metadata = metadata or {}
        metadata['original_model_message'] = response
        metadata['provider'] = 'qwen'

        return ChatResponse(
            content=content_blocks,
            usage=usage,
            metadata=metadata,
            stop_reason=stop_reason,
            finish_reason=finish_reason,
        )
