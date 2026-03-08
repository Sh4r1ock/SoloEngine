# -*- coding: utf-8 -*-
# pylint: disable=too-many-branches
"""
OpenAI 聊天模型类。

@file openai_model.py
@description 实现 OpenAI GPT 系列模型的 API 调用
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 支持 OpenAI GPT 系列模型（GPT-4, GPT-3.5, GPT-4o, o3-mini 等）
- 支持同步和流式输出
- 支持工具调用（Function Calling）
- 支持结构化输出（Structured Output）
- 支持音频输入输出
- 支持推理模式（o3, o4 等模型）

支持的模型：
    - gpt-4: GPT-4 基础模型
    - gpt-4-turbo: GPT-4 Turbo 版本
    - gpt-4o: GPT-4 Omni 多模态模型
    - gpt-3.5-turbo: GPT-3.5 Turbo 版本
    - o3-mini: 推理增强模型

特性：
    - 流式输出：逐步返回生成内容
    - 工具调用：支持 Function Calling
    - 结构化输出：强制输出符合 JSON Schema
    - 推理模式：支持 o3 系列的 reasoning_effort 参数

状态: ✅ 完整实现
"""

import warnings
from datetime import datetime
from typing import (
    Any,
    TYPE_CHECKING,
    List,
    AsyncGenerator,
    Literal,
    Type,
)
from collections import OrderedDict

from pydantic import BaseModel

from . import ChatResponse
from .model_base import ChatModelBase
from .model_usage import ChatUsage
from ..utils.logging import logger
from ..utils.common import _json_loads_with_repair
from ..message import (
    ToolUseBlock,
    TextBlock,
    ThinkingBlock,
    AudioBlock,
    Base64Source,
)
from ..tracing import trace_llm
from ..types import JSONSerializableObject

if TYPE_CHECKING:
    from openai.types.chat import ChatCompletion
    from openai import AsyncStream
else:
    ChatCompletion = "openai.types.chat.ChatCompletion"
    AsyncStream = "openai.types.chat.AsyncStream"


def _format_audio_data_for_qwen_omni(messages: list[dict]) -> None:
    """
    为 Qwen-Omni 模型格式化音频数据。
    
    Qwen-Omni 使用 OpenAI 兼容的 API，但音频数据格式不同。
    需要在 base64 数据前添加 "data:;base64," 前缀。
    
    参考：https://bailian.console.aliyun.com/?tab=doc#/doc/?type=model&url=2867839
    
    Args:
        messages (list[dict]): OpenAI 格式化器生成的消息列表。
            此函数会原地修改消息中的音频数据格式。
    
    Note:
        此函数会直接修改传入的 messages 列表，不返回新列表。
    """
    for msg in messages:
        if isinstance(msg.get("content"), list):
            for block in msg["content"]:
                if (
                    isinstance(block, dict)
                    and "input_audio" in block
                    and isinstance(block["input_audio"].get("data"), str)
                ):
                    if not block["input_audio"]["data"].startswith("http"):
                        block["input_audio"]["data"] = (
                            "data:;base64," + block["input_audio"]["data"]
                        )


class OpenAIChatModel(ChatModelBase):
    """
    OpenAI 聊天模型类。
    
    实现 OpenAI GPT 系列模型的 API 调用，支持同步和流式输出、
    工具调用、结构化输出等功能。
    
    核心功能：
        1. 模型调用：通过 __call__ 方法调用 OpenAI API
        2. 流式输出：支持逐步返回生成内容
        3. 工具调用：支持 Function Calling
        4. 结构化输出：强制输出符合 Pydantic 模型
        5. 推理模式：支持 o3 系列模型的推理增强
    
    支持的模型：
        - GPT-4 系列：gpt-4, gpt-4-turbo, gpt-4o, gpt-4o-mini
        - GPT-3.5 系列：gpt-3.5-turbo
        - 推理模型：o3-mini, o3-mini-turbo
    
    Example:
        >>> model = OpenAIChatModel(
        ...     model_name="gpt-4",
        ...     api_key="sk-...",
        ...     stream=False
        ... )
        >>> 
        >>> messages = [{"role": "user", "content": "你好"}]
        >>> response = await model(messages)
        >>> print(response.content[0]["text"])
    
    Note:
        - API 密钥可通过参数或环境变量 OPENAI_API_KEY 提供
        - 流式输出时返回异步生成器
        - 工具调用结果在 content 中以 ToolUseBlock 形式返回
    """

    def __init__(
        self,
        model_name: str,
        api_key: str | None = None,
        stream: bool = True,
        reasoning_effort: Literal["low", "medium", "high"] | None = None,
        organization: str = None,
        client_kwargs: dict[str, JSONSerializableObject] | None = None,
        generate_kwargs: dict[str, JSONSerializableObject] | None = None,
        **kwargs: Any,
    ) -> None:
        """
        初始化 OpenAI 客户端。
        
        Args:
            model_name (str): 模型名称，如 'gpt-4', 'gpt-4-turbo', 'o3-mini'。
            api_key (str | None, optional): API 密钥。如果未指定，
                从环境变量 OPENAI_API_KEY 读取。默认为 None。
            stream (bool, optional): 是否启用流式输出。默认为 True。
            reasoning_effort (Literal["low", "medium", "high"] | None, optional):
                推理强度，仅适用于 o3, o4 等推理模型。
                参考：https://platform.openai.com/docs/guides/reasoning
                默认为 None。
            organization (str, optional): 组织 ID。如果未指定，
                从环境变量 OPENAI_ORGANIZATION 读取。默认为 None。
            client_kwargs (dict | None, optional): 初始化 OpenAI 客户端的
                额外参数。默认为 None。
            generate_kwargs (dict | None, optional): API 调用时的额外参数，
                如 temperature, seed 等。默认为 None。
            **kwargs: 额外的关键字参数（已弃用的参数会被忽略）。
        
        Raises:
            ValueError: 当同时指定 client_args 和 client_kwargs 时抛出。
        
        Note:
            - client_args 参数已弃用，请使用 client_kwargs
            - 未知的关键字参数会被忽略并记录警告
        """

        client_args = kwargs.pop("client_args", None)
        if client_args is not None and client_kwargs is not None:
            raise ValueError(
                "Cannot specify both 'client_args' and 'client_kwargs'. "
                "Please use only 'client_kwargs' (client_args is deprecated).",
            )

        if client_args is not None:
            logger.warning(
                "The parameter 'client_args' is deprecated and will be "
                "removed in a future version. Please use 'client_kwargs' "
                "instead. Automatically converting 'client_args' to "
                "'client_kwargs'.",
            )
            client_kwargs = client_args

        if kwargs:
            logger.warning(
                "Unknown keyword arguments: %s. These will be ignored.",
                list(kwargs.keys()),
            )

        super().__init__(model_name, stream)

        import openai

        self.client = openai.AsyncClient(
            api_key=api_key,
            organization=organization,
            **(client_kwargs or {}),
        )

        self.reasoning_effort = reasoning_effort
        self.generate_kwargs = generate_kwargs or {}

    @trace_llm
    async def __call__(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: Literal["auto", "none", "required"] | str | None = None,
        structured_model: Type[BaseModel] | None = None,
        **kwargs: Any,
    ) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
        """
        调用 OpenAI Chat Completions API 获取响应。
        
        这是模型的主要接口方法，支持多种调用模式：
        1. 普通对话：传入消息列表，获取文本响应
        2. 工具调用：传入工具定义，模型可调用工具
        3. 结构化输出：传入 Pydantic 模型，强制输出符合结构
        
        Args:
            messages (list[dict]): 消息列表，每条消息必须包含：
                - role: 角色（system/user/assistant/tool）
                - content: 内容（字符串或内容块列表）
                - name: 名称（可选）
            tools (list[dict] | None, optional): 工具定义列表。
                每个工具包含 name, description, parameters 字段。
                默认为 None。
            tool_choice (Literal["auto", "none", "required"] | str | None, optional):
                工具选择模式：
                - "auto": 模型自动决定是否调用工具
                - "none": 模型不调用任何工具
                - "required": 模型必须调用工具
                - 工具名: 强制调用指定工具
                默认为 None。
            structured_model (Type[BaseModel] | None, optional):
                Pydantic 模型类，用于结构化输出。
                当指定时，tools 和 tool_choice 参数将被忽略。
                参考：https://platform.openai.com/docs/guides/structured-outputs
                默认为 None。
            **kwargs: OpenAI API 的额外参数，如：
                - temperature: 生成温度（0-2）
                - max_tokens: 最大输出 token 数
                - top_p: 核采样参数
                - seed: 随机种子
        
        Returns:
            ChatResponse | AsyncGenerator[ChatResponse, None]:
                - 如果 stream=False，返回 ChatResponse 对象
                - 如果 stream=True，返回异步生成器
        
        Raises:
            ValueError: 当消息格式不正确时抛出。
        
        Example:
            >>> # 普通对话
            >>> response = await model([{"role": "user", "content": "你好"}])
            >>> 
            >>> # 工具调用
            >>> tools = [{"type": "function", "function": {...}}]
            >>> response = await model(messages, tools=tools)
            >>> 
            >>> # 结构化输出
            >>> class Answer(BaseModel):
            ...     text: str
            ...     confidence: float
            >>> response = await model(messages, structured_model=Answer)
        
        Note:
            - structured_model 模式下会忽略 tools 和 tool_choice
            - Qwen-Omni 模型会自动格式化音频数据
        """

        if not isinstance(messages, list):
            raise ValueError(
                "OpenAI `messages` field expected type `list`, "
                f"got `{type(messages)}` instead.",
            )
        if not all("role" in msg and "content" in msg for msg in messages):
            raise ValueError(
                "Each message in the 'messages' list must contain a 'role' "
                "and 'content' key for OpenAI API.",
            )

        if "omni" in self.model_name.lower():
            _format_audio_data_for_qwen_omni(messages)

        kwargs = {
            "model": self.model_name,
            "messages": messages,
            "stream": self.stream,
            **self.generate_kwargs,
            **kwargs,
        }
        if self.reasoning_effort and "reasoning_effort" not in kwargs:
            kwargs["reasoning_effort"] = self.reasoning_effort

        if tools:
            kwargs["tools"] = self._format_tools_json_schemas(tools)

        if tool_choice:
            if tool_choice == "any":
                warnings.warn(
                    '"any" is deprecated and will be removed in a future '
                    "version.",
                    DeprecationWarning,
                )
                tool_choice = "required"
            self._validate_tool_choice(tool_choice, tools)
            kwargs["tool_choice"] = self._format_tool_choice(tool_choice)

        if self.stream:
            kwargs["stream_options"] = {"include_usage": True}

        start_datetime = datetime.now()

        if structured_model:
            if tools or tool_choice:
                logger.warning(
                    "structured_model is provided. Both 'tools' and "
                    "'tool_choice' parameters will be overridden and "
                    "ignored. The model will only perform structured output "
                    "generation without calling any other tools.",
                )
            kwargs.pop("stream", None)
            kwargs.pop("tools", None)
            kwargs.pop("tool_choice", None)
            kwargs["response_format"] = structured_model
            if not self.stream:
                response = await self.client.chat.completions.parse(**kwargs)
            else:
                response = self.client.chat.completions.stream(**kwargs)
                return self._parse_openai_stream_response(
                    start_datetime,
                    response,
                    structured_model,
                )
        else:
            response = await self.client.chat.completions.create(**kwargs)

        if self.stream:
            return self._parse_openai_stream_response(
                start_datetime,
                response,
                structured_model,
            )

        parsed_response = self._parse_openai_completion_response(
            start_datetime,
            response,
            structured_model,
        )

        return parsed_response

    async def _parse_openai_stream_response(
        self,
        start_datetime: datetime,
        response: AsyncStream,
        structured_model: Type[BaseModel] | None = None,
    ) -> AsyncGenerator[ChatResponse, None]:
        """
        解析 OpenAI 流式响应。
        
        从 OpenAI 流式响应中提取内容块和使用量信息，
        逐步生成 ChatResponse 对象。
        
        Args:
            start_datetime (datetime): 响应生成的开始时间。
            response (AsyncStream): OpenAI 异步流对象。
            structured_model (Type[BaseModel] | None, optional):
                结构化输出的 Pydantic 模型。默认为 None。
        
        Returns:
            AsyncGenerator[ChatResponse, None]: 异步生成器，
                逐步生成 ChatResponse 对象。
        
        Note:
            如果指定了 structured_model，结构化输出会存储在
            ChatResponse 的 metadata 字段中。
        """
        usage, res = None, None
        text = ""
        thinking = ""
        audio = ""
        tool_calls = OrderedDict()
        metadata: dict | None = None
        last_text = ""  # 记录上次输出的文本，用于计算增量
        last_thinking = ""  # 记录上次输出的思考内容，用于计算增量
        finish_reason = None  # 记录 finish_reason

        async with response as stream:
            async for item in stream:
                if structured_model:
                    if item.type != "chunk":
                        continue
                    chunk = item.chunk
                else:
                    chunk = item

                if chunk.usage:
                    usage = ChatUsage(
                        input_tokens=chunk.usage.prompt_tokens,
                        output_tokens=chunk.usage.completion_tokens,
                        time=(datetime.now() - start_datetime).total_seconds(),
                    )

                if not chunk.choices:
                    if usage:
                        # 最后一个 chunk，yield 完整响应
                        contents = []
                        if thinking:
                            contents.append(
                                ThinkingBlock(
                                    type="thinking",
                                    thinking=thinking,
                                ),
                            )
                        if text:
                            contents.append(
                                TextBlock(
                                    type="text",
                                    text=text,
                                ),
                            )
                        for tool_call in tool_calls.values():
                            contents.append(
                                ToolUseBlock(
                                    type=tool_call["type"],
                                    id=tool_call["id"],
                                    name=tool_call["name"],
                                    input=_json_loads_with_repair(
                                        tool_call["input"] or "{}",
                                    ),
                                ),
                            )
                        if contents:
                            # 设置 stop_reason
                            stop_reason = None
                            if finish_reason:
                                if finish_reason == "stop":
                                    stop_reason = "end_turn"
                                elif finish_reason == "tool_calls":
                                    stop_reason = "tool_use"
                                else:
                                    stop_reason = finish_reason
                            res = ChatResponse(
                                content=contents,
                                usage=usage,
                                metadata=metadata,
                                stop_reason=stop_reason,
                                finish_reason=finish_reason,
                            )
                            yield res
                    continue

                choice = chunk.choices[0]
                
                # 记录 finish_reason
                if hasattr(choice, 'finish_reason') and choice.finish_reason:
                    finish_reason = choice.finish_reason
                    logger.info(f"[Stream] finish_reason detected: {finish_reason}")
                    
                    # 当检测到 finish_reason 时，立即 yield 最终响应
                    # 这处理了 MAX_TOKENS 和 tool_calls 等情况
                    if finish_reason in ("length", "max_tokens", "tool_calls", "stop"):
                        contents = []
                        if thinking:
                            contents.append(
                                ThinkingBlock(
                                    type="thinking",
                                    thinking=thinking,
                                ),
                            )
                        if text:
                            contents.append(
                                TextBlock(
                                    type="text",
                                    text=text,
                                ),
                            )
                        for tool_call in tool_calls.values():
                            contents.append(
                                ToolUseBlock(
                                    type=tool_call["type"],
                                    id=tool_call["id"],
                                    name=tool_call["name"],
                                    input=_json_loads_with_repair(
                                        tool_call["input"] or "{}",
                                    ),
                                ),
                            )
                        if contents:
                            # 设置 stop_reason
                            stop_reason = None
                            if finish_reason == "stop":
                                stop_reason = "end_turn"
                            elif finish_reason == "tool_calls":
                                stop_reason = "tool_use"
                            else:
                                stop_reason = finish_reason
                            res = ChatResponse(
                                content=contents,
                                usage=usage,
                                metadata=metadata,
                                stop_reason=stop_reason,
                                finish_reason=finish_reason,
                            )
                            logger.info(f"[Stream] Yielding final response with {len(contents)} blocks, stop_reason={stop_reason}")
                            yield res

                delta_dict = choice.delta.model_dump() if hasattr(choice.delta, 'model_dump') else {}
                delta_thinking = delta_dict.get("reasoning_content") or ""
                delta_text = choice.delta.content or ""
                
                if delta_thinking:
                    logger.info(f"[Stream Chunk] thinking='{delta_thinking[:50]}...'")
                elif delta_text:
                    logger.info(f"[Stream Chunk] text='{delta_text}'")
                
                thinking += delta_thinking
                text += delta_text

                if (
                    hasattr(choice.delta, "audio")
                    and "data" in choice.delta.audio
                ):
                    audio += choice.delta.audio["data"]
                if (
                    hasattr(choice.delta, "audio")
                    and "transcript" in choice.delta.audio
                ):
                    text += choice.delta.audio["transcript"]

                for tool_call in choice.delta.tool_calls or []:
                    if tool_call.index in tool_calls:
                        if tool_call.function.arguments is not None:
                            tool_calls[tool_call.index][
                                "input"
                            ] += tool_call.function.arguments

                    else:
                        tool_calls[tool_call.index] = {
                            "type": "tool_use",
                            "id": tool_call.id,
                            "name": tool_call.function.name,
                            "input": tool_call.function.arguments or "",
                        }

                # 构建增量内容
                contents = []

                # 只输出增量的思考内容
                if thinking and len(thinking) > len(last_thinking):
                    delta_thinking_content = thinking[len(last_thinking):]
                    contents.append(
                        ThinkingBlock(
                            type="thinking",
                            thinking=delta_thinking_content,
                        ),
                    )
                    last_thinking = thinking

                if audio:
                    media_type = self.generate_kwargs.get("audio", {}).get(
                        "format",
                        "wav",
                    )
                    contents.append(
                        AudioBlock(
                            type="audio",
                            source=Base64Source(
                                data=audio,
                                media_type=f"audio/{media_type}",
                                type="base64",
                            ),
                        ),
                    )

                # 只输出增量的文本内容
                if text and len(text) > len(last_text):
                    delta_text_content = text[len(last_text):]
                    contents.append(
                        TextBlock(
                            type="text",
                            text=delta_text_content,
                        ),
                    )
                    last_text = text

                    if structured_model:
                        metadata = _json_loads_with_repair(text)

                # 工具调用只在完成时输出（不增量输出）
                # 检查是否有新的工具调用完成
                if tool_calls and not delta_text and not delta_thinking:
                    # 只在没有文本输出时才输出工具调用
                    for tool_call in tool_calls.values():
                        contents.append(
                            ToolUseBlock(
                                type=tool_call["type"],
                                id=tool_call["id"],
                                name=tool_call["name"],
                                input=_json_loads_with_repair(
                                    tool_call["input"] or "{}",
                                ),
                            ),
                        )

                if not contents:
                    continue

                res = ChatResponse(
                    content=contents,
                    usage=usage,
                    metadata=metadata,
                )
                yield res

    def _parse_openai_completion_response(
        self,
        start_datetime: datetime,
        response: ChatCompletion,
        structured_model: Type[BaseModel] | None = None,
    ) -> ChatResponse:
        """
        解析 OpenAI 非流式响应。
        
        从 OpenAI ChatCompletion 对象中提取内容块和使用量信息。
        
        Args:
            start_datetime (datetime): 响应生成的开始时间。
            response (ChatCompletion): OpenAI ChatCompletion 对象。
            structured_model (Type[BaseModel] | None, optional):
                结构化输出的 Pydantic 模型。默认为 None。
        
        Returns:
            ChatResponse: 包含内容块和使用量的响应对象。
        
        Note:
            如果指定了 structured_model，结构化输出会存储在
            ChatResponse 的 metadata 字段中。
        """
        content_blocks: List[
            TextBlock | ToolUseBlock | ThinkingBlock | AudioBlock
        ] = []
        metadata: dict | None = None

        if response.choices:
            choice = response.choices[0]
            if (
                hasattr(choice.message, "reasoning_content")
                and choice.message.reasoning_content is not None
            ):
                content_blocks.append(
                    ThinkingBlock(
                        type="thinking",
                        thinking=response.choices[0].message.reasoning_content,
                    ),
                )

            if choice.message.content:
                content_blocks.append(
                    TextBlock(
                        type="text",
                        text=response.choices[0].message.content,
                    ),
                )
            if choice.message.audio:
                media_type = self.generate_kwargs.get("audio", {}).get(
                    "format",
                    "mp3",
                )
                content_blocks.append(
                    AudioBlock(
                        type="audio",
                        source=Base64Source(
                            data=choice.message.audio.data,
                            media_type=f"audio/{media_type}",
                            type="base64",
                        ),
                    ),
                )

                if choice.message.audio.transcript:
                    content_blocks.append(
                        TextBlock(
                            type="text",
                            text=choice.message.audio.transcript,
                        ),
                    )

            for tool_call in choice.message.tool_calls or []:
                content_blocks.append(
                    ToolUseBlock(
                        type="tool_use",
                        id=tool_call.id,
                        name=tool_call.function.name,
                        input=_json_loads_with_repair(
                            tool_call.function.arguments,
                        ),
                    ),
                )

            if structured_model:
                metadata = choice.message.parsed.model_dump()

        usage = None
        if response.usage:
            usage = ChatUsage(
                input_tokens=response.usage.prompt_tokens,
                output_tokens=response.usage.completion_tokens,
                time=(datetime.now() - start_datetime).total_seconds(),
            )
        
        stop_reason = None
        finish_reason = None
        if response.choices:
            choice = response.choices[0]
            finish_reason = getattr(choice, 'finish_reason', None)
            if finish_reason:
                if finish_reason == "stop":
                    stop_reason = "end_turn"
                elif finish_reason == "tool_calls":
                    stop_reason = "tool_use"
                else:
                    stop_reason = finish_reason

        parsed_response = ChatResponse(
            content=content_blocks,
            usage=usage,
            metadata=metadata,
            stop_reason=stop_reason,
            finish_reason=finish_reason,
        )

        return parsed_response

    def _format_tools_json_schemas(
        self,
        schemas: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        格式化工具 JSON Schema。
        
        将工具定义转换为 OpenAI API 所需的格式。
        
        Args:
            schemas (list[dict]): 工具定义列表。
        
        Returns:
            list[dict]: 格式化后的工具列表。
        
        Note:
            OpenAI 格式与通用格式相同，此方法保留用于扩展。
        """
        return schemas

    def _format_tool_choice(
        self,
        tool_choice: Literal["auto", "none", "required"] | str | None,
    ) -> str | dict | None:
        """
        格式化工具选择参数。
        
        将工具选择参数转换为 OpenAI API 所需的格式。
        
        Args:
            tool_choice: 工具选择模式或工具名称。
        
        Returns:
            str | dict | None: 格式化后的工具选择配置。
                - 模式字符串：直接返回
                - 工具名称：返回 {"type": "function", "function": {"name": ...}}
        
        参考：
            https://platform.openai.com/docs/api-reference/responses/create#responses_create-tool_choice
        """
        if tool_choice is None:
            return None

        mode_mapping = {
            "auto": "auto",
            "none": "none",
            "required": "required",
        }
        if tool_choice in mode_mapping:
            return mode_mapping[tool_choice]
        return {"type": "function", "function": {"name": tool_choice}}
