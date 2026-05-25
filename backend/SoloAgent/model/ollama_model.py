# -*- coding: utf-8 -*-
"""
SoloEngine : Ollama本地模型实现，支持本地部署的LLM

@file ollama_model.py
@description 实现Ollama本地模型的调用接口，支持本地部署的开源模型
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供Ollama本地模型的实现，包括：
    - OllamaChatModel: Ollama模型主类
    - 支持流式输出和非流式输出
    - 支持本地模型管理
    - 支持多种开源模型（Llama、Mistral等）

依赖:
    - asyncio: 异步操作
    - json: JSON处理
    - datetime: 时间处理
    - typing: 类型提示
    - .model_response: 响应类
    - .model_base: 模型基类
    - .model_usage: 使用统计类
    - ..message: 消息类型定义

使用示例:
    - from SoloAgent.model import OllamaChatModel
    - model = OllamaChatModel(model_name="llama2")
    - response = await model(messages)
"""
import json
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import (
    Any,
    AsyncGenerator,
    Literal,
)
from collections import OrderedDict

import httpx
from app.core.config import settings
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


class OllamaChatModel(ChatModelBase):
    """
    Ollama本地模型聊天类

    职责:
        - 实现Ollama本地模型的API调用
        - 支持流式输出和非流式输出
        - 支持本地模型管理
        - 支持多种开源模型（Llama、Mistral、Gemma等）

    属性:
        model_name: 模型名称
        base_url: Ollama API服务器地址
        stream: 是否使用流式输出
        generate_kwargs: 生成参数
        client: HTTP异步客户端

    示例:
        >>> model = OllamaChatModel(
        ...     model_name="llama2",
        ...     base_url="http://localhost:11434"
        ... )
        >>> messages = [{"role": "user", "content": "你好"}]
        >>> response = await model(messages)
    """

    def __init__(
        self,
        model_name: str,
        base_url: str = "http://localhost:11434",
        stream: bool = True,
        generate_kwargs: dict[str, JSONSerializableObject] | None = None,
        client_kwargs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(model_name, stream)

        self.base_url = base_url.rstrip("/")
        self.generate_kwargs = generate_kwargs or {}
        from app.core.config import settings
        
        timeout = None
        if client_kwargs and "timeout" in client_kwargs:
            timeout = client_kwargs["timeout"]
        
        self.client = httpx.AsyncClient(timeout=timeout or float(settings.OLLAMA_REQUEST_TIMEOUT))

    async def __call__(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: Literal["auto", "none", "any"] | str | None = None,
        structured_model: Any = None,
        cancel_event: asyncio.Event = None,
        **kwargs: Any,
    ) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
        """Get response from Ollama chat completion API.

        Args:
            messages (list[dict]): A list of dictionaries, where 'role' and 'content'
                fields are required, and 'name' field is optional.
            tools (list[dict] | None): The tools JSON schemas that model can use.
                Note: Ollama has limited tool calling support.
            tool_choice (Literal["auto", "none", "any"] | str | None):
                Controls which (if any) tool is called by the model.
                Can be "auto", "none", "any", or specific tool name.
            structured_model (Any): Ollama may have limited structured output support.
            **kwargs (Any): The keyword arguments for Ollama chat completion API,
                e.g., "temperature", "num_ctx", "top_k".

        Returns:
            ChatResponse | AsyncGenerator[ChatResponse, None]: The response.
        """
        # Check messages format
        if not isinstance(messages, list):
            raise ValueError(
                f"Ollama 'messages' field expected type 'list', "
                f"got {type(messages)} instead."
            )
        if not all("role" in msg and "content" in msg for msg in messages):
            raise ValueError(
                "Each message in 'messages' list must contain a 'role' "
                "and 'content' key for Ollama API."
            )

        # Prepare request payload
        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": self.stream,
            **self.generate_kwargs,
            **kwargs,
        }

        # Handle tools (Ollama has limited tool support)
        if tools:
            # Ollama's tool format is different from OpenAI
            # We'll pass tools in the payload format Ollama expects
            payload["tools"] = self._format_tools_for_ollama(tools)

        # Handle tool choice
        if tool_choice:
            # Ollama doesn't have the same tool_choice concept as OpenAI
            # We'll store it but Ollama may ignore it
            payload["tool_choice"] = tool_choice

        start_datetime = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))

        try:
            if self.stream:
                response = await self.client.stream(
                    f"{self.base_url}/api/chat",
                    json=payload,
                )
                return self._parse_ollama_stream_response(
                    start_datetime,
                    response,
                    cancel_event,
                )
            else:
                response = await self.client.post(
                    f"{self.base_url}/api/chat",
                    json=payload,
                )
                return self._parse_ollama_completion_response(
                    start_datetime,
                    response,
                )
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama HTTP error: {e}")
            return ChatResponse(
                content=[],
                usage=None,
                metadata={"error": f"HTTP {e.response.status_code}: {str(e)}"},
            )
        except httpx.RequestError as e:
            logger.error(f"Ollama request error: {e}")
            return ChatResponse(
                content=[],
                usage=None,
                metadata={"error": f"Request error: {str(e)}"},
            )
        except Exception as e:
            logger.error(f"Ollama error: {e}")
            return ChatResponse(
                content=[],
                usage=None,
                metadata={"error": f"Unexpected error: {str(e)}"},
            )

    def _format_tools_for_ollama(self, tools: list[dict]) -> list[dict]:
        """Format tools for Ollama API.

        Ollama uses the same tool format as OpenAI Function Calling.
        The input tools are already in the correct format from get_available_tools(),
        so we pass them through directly.
        """
        if not tools:
            return []
        return tools

    async def _parse_ollama_stream_response(
        self,
        start_datetime: datetime,
        response,
        cancel_event: asyncio.Event = None,
    ) -> AsyncGenerator[ChatResponse, None]:
        """Parse Ollama streaming response and yield ChatResponse objects.

        Args:
            start_datetime (datetime): The start datetime of response generation.
            response: Ollama streaming response object.
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

        self._save_response_ref(response)
        try:
            async for line in response.aiter_lines():
                if cancel_event and cancel_event.is_set():
                    logger.info("[Ollama] Cancel event detected, closing stream")
                    await response.aclose()
                    self._was_cancelled = True
                    raise asyncio.CancelledError()
                if not line.strip():
                    continue

                try:
                    # Ollama returns JSON lines
                    data = self._json_loads_with_repair(line)
                except Exception as e:
                    logger.warning(f"Failed to parse Ollama stream line: {e}")
                    continue

                # Handle different response fields
                if "done" in data:
                    # Final response
                    if "message" in data and "content" in data["message"]:
                        final_content = data["message"]["content"]
                        if isinstance(final_content, str):
                            text += final_content
                        elif isinstance(final_content, list):
                            for block in final_content:
                                if isinstance(block, str):
                                    text += block
                                elif isinstance(block, dict):
                                    if block.get("type") == "text":
                                        text += block.get("text", "")
                                    elif block.get("type") == "tool_calls":
                                        for tool_call in block.get("tool_calls", []):
                                            tool_calls[tool_call.get("id", "")] = {
                                                "type": "tool_use",
                                                "id": tool_call.get("id", ""),
                                                "name": tool_call.get("function", {}).get("name", ""),
                                                "input": tool_call.get("arguments", {}),
                                            }

                    if "prompt_eval_count" in data and "eval_count" in data:
                        usage = ChatUsage(
                            input_tokens=data.get("prompt_eval_count", 0),
                            output_tokens=data.get("eval_count", 0),
                            time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
                        )

                    # Yield response periodically
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
                    
                    # 工具调用输出增量格式，而非完整 ToolUseBlock
                    # 由 ReActCore 的 ToolCallEventManager 管理状态
                    for tool_id, tool_call in tool_calls.items():
                        index = list(tool_calls.keys()).index(tool_id)
                        last_call = last_tool_calls.get(tool_id)
                        tool_call_chunks = []
                        
                        if last_call is None:
                            # 新工具调用开始
                            # 第一个 chunk：包含 id 和 name，arguments 可能为空
                            tool_call_chunks.append({
                                "index": index,
                                "id": tool_id,
                                "type": "function",
                                "function": {
                                    "name": tool_call["name"],
                                    "arguments": "",
                                }
                            })
                            logger.info(f"[Ollama] Tool call start: index={index}, id={tool_id}, name={tool_call.get('name')}")
                            
                            # 如果有 arguments，单独发送
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
                                logger.info(f"[Ollama] Tool call initial args: index={index}, args={args_str[:50]}...")
                        else:
                            # 后续增量：只包含 arguments 增量
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
                                    logger.info(f"[Ollama] Tool call args delta: index={index}, delta={delta_args[:50]}...")
                        
                        for chunk_data in tool_call_chunks:
                            contents.append({
                                "type": "tool_calls",
                                "tool_calls": [chunk_data],
                            })
                    
                    last_tool_calls = OrderedDict(tool_calls)
                    
                    if contents:
                        yield ChatResponse(
                            content=contents,
                            usage=usage,
                            metadata=None,
                        )

        except Exception as e:
            logger.error(f"Error parsing Ollama stream: {e}")
            yield ChatResponse(
                content=[],
                usage=None,
                metadata={"error": f"Stream parsing error: {str(e)}"},
            )
        finally:
            self._clear_response_ref()

    async def _parse_ollama_completion_response(
        self,
        start_datetime: datetime,
        response,
    ) -> ChatResponse:
        """Parse Ollama non-streaming completion response.

        Args:
            start_datetime (datetime): The start datetime of response generation.
            response: Ollama response object.

        Returns:
            ChatResponse: The parsed response.
        """
        try:
            data = response.json()
        except Exception as e:
            logger.error(f"Failed to parse Ollama response: {e}")
            return ChatResponse(
                content=[],
                usage=None,
                metadata={"error": f"Response parsing error: {str(e)}"},
            )

        content_blocks: list[
            SoloTextBlock | SoloToolUseBlock | SoloThinkingBlock
        ] = []
        metadata: dict | None = None

        if "message" in data and "content" in data["message"]:
            content = data["message"]["content"]
            if isinstance(content, str):
                content_blocks.append(
                    SoloTextBlock(
                        type="text",
                        text=content,
                    ),
                )
            elif isinstance(content, list):
                for block in content:
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
                        elif block.get("type") == "tool_calls":
                            for tool_call in block.get("tool_calls", []):
                                content_blocks.append(
                                    SoloToolUseBlock(
                                        type="tool_use",
                                        id=tool_call.get("id", ""),
                                        name=tool_call.get("function", {}).get("name", ""),
                                        input=tool_call.get("arguments", {}),
                                    ),
                                )

        if "prompt_eval_count" in data and "eval_count" in data:
            usage = ChatUsage(
                input_tokens=data.get("prompt_eval_count", 0),
                output_tokens=data.get("eval_count", 0),
                time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
            )

        metadata = metadata or {}
        metadata['original_model_message'] = data
        metadata['provider'] = 'ollama'

        return ChatResponse(
            content=content_blocks,
            usage=usage,
            metadata=metadata,
        )

    def _json_loads_with_repair(self, text: str):
        """Try to load JSON with repair for common issues."""
        import json
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to fix common issues
            # Remove trailing commas
            text = text.rstrip().rstrip(",")
            try:
                return json.loads(text)
            except Exception as e:
                logger.warning(f"Failed to repair JSON: {e}")
                # Return as plain text in content block
                return {"message": {"content": text}}
