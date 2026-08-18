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
import asyncio
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
        # ★ 任务1：重置 _was_cancelled 标志，避免上次调用的 cancel 状态污染本次调用
        self._was_cancelled = False

        # Check messages format
        if not isinstance(messages, list):
            raise ValueError(
                f"Ollama 'messages' field expected type 'list', "
                f"got {type(messages)} instead."
            )
        # ★ 任务2：放宽 messages 校验，assistant 消息可能只有 tool_calls 而无 content
        if not all("role" in msg for msg in messages):
            raise ValueError(
                "Each message in 'messages' list must contain a 'role' key for Ollama API."
            )

        # ★ 任务3：转换 messages 为 Ollama 格式
        ollama_messages = self._convert_messages_for_ollama(messages)

        # Prepare request payload
        payload = {
            "model": self.model_name,
            "messages": ollama_messages,
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
                async def stream_generator():
                    async with self.client.stream(
                        "POST",
                        f"{self.base_url}/api/chat",
                        json=payload,
                    ) as response:
                        if response.status_code < 200 or response.status_code >= 300:
                            error_body = await response.aread()
                            error_text = error_body.decode(errors="replace") if error_body else ""
                            logger.error(f"Ollama API returned HTTP {response.status_code}: {error_text[:500]}")
                            yield ChatResponse(
                                content=[], usage=None,
                                metadata={"error": f"Ollama API HTTP {response.status_code}: {error_text[:200]}"},
                            )
                            return
                        async for resp in self._parse_ollama_stream_response(start_datetime, response, cancel_event):
                            yield resp
                return stream_generator()
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

    def _convert_messages_for_ollama(self, messages: list[dict]) -> list[dict]:
        """Convert OpenAI-format messages to Ollama-format messages.

        Ollama API 与 OpenAI 格式有 4 处差异：
        1. content 必须是字符串（OpenAI 可能是 list[dict]）
        2. tool_calls arguments 必须是 dict（OpenAI 是 JSON string）
        3. tool 结果消息用 tool_name 而非 tool_call_id
        4. 不支持 reasoning_content（需过滤 thinking blocks）
        """
        # 构建 tool_call_id → tool_name 的映射
        tool_id_to_name: dict[str, str] = {}
        for msg in messages:
            if msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    tc_id = tc.get("id") or (tc.get("function", {}).get("name"))
                    tc_name = tc.get("function", {}).get("name")
                    if tc_id and tc_name:
                        tool_id_to_name[tc_id] = tc_name

        ollama_messages: list[dict] = []
        for msg in messages:
            ollama_msg: dict = {"role": msg["role"]}
            # content: list[dict] → str
            content = msg.get("content")
            if isinstance(content, list):
                text_parts = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                        elif block.get("type") == "thinking":
                            pass
                    elif isinstance(block, str):
                        text_parts.append(block)
                ollama_msg["content"] = "\n".join(text_parts) if text_parts else ""
            elif content is None:
                ollama_msg["content"] = ""
            else:
                ollama_msg["content"] = str(content)

            # tool_calls: arguments string → dict
            if msg.get("tool_calls"):
                ollama_tool_calls = []
                for tc in msg["tool_calls"]:
                    func = tc.get("function", {})
                    args = func.get("arguments")
                    if isinstance(args, str):
                        try:
                            args_dict = json.loads(args) if args else {}
                        except json.JSONDecodeError:
                            args_dict = {}
                    elif isinstance(args, dict):
                        args_dict = args
                    else:
                        args_dict = {}
                    ollama_tool_calls.append({
                        "type": "function",
                        "function": {"name": func.get("name", ""), "arguments": args_dict},
                    })
                ollama_msg["tool_calls"] = ollama_tool_calls

            # tool 结果消息：name → tool_name，移除 tool_call_id
            if msg["role"] == "tool":
                tool_name = msg.get("name")
                if not tool_name and msg.get("tool_call_id"):
                    tool_name = tool_id_to_name.get(msg["tool_call_id"], "")
                if tool_name:
                    ollama_msg["tool_name"] = tool_name
            elif msg.get("name"):
                ollama_msg["name"] = msg["name"]

            ollama_messages.append(ollama_msg)
        return ollama_messages

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
            lines = response.aiter_lines()
            while True:
                # stall 超时保护（根因修复）：流停滞时 __anext__ 永久阻塞使 cancel_event
                # 检查不可达，暂停/停止无法中断 LLM 调用。超时视为异常结束。
                try:
                    line = await self._anext_stall_protected(lines, settings.STREAM_STALL_TIMEOUT)
                except StopAsyncIteration:
                    break
                if cancel_event and cancel_event.is_set():
                    logger.info("[Ollama] Cancel event detected, breaking stream loop")
                    self._was_cancelled = True
                    break
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
                    # Final response or intermediate chunk
                    if "message" in data:
                        msg_data = data["message"]
                        # 1. content
                        if "content" in msg_data:
                            final_content = msg_data["content"]
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
                                                tc_id = tool_call.get("id", "")
                                                tool_calls[tc_id] = {
                                                    "type": "tool_use",
                                                    "id": tc_id,
                                                    "name": tool_call.get("function", {}).get("name", ""),
                                                    "input": tool_call.get("arguments", {}),
                                                }
                        # 2. thinking
                        if msg_data.get("thinking"):
                            thinking += msg_data["thinking"]
                        # 3. message.tool_calls 独立字段
                        if msg_data.get("tool_calls"):
                            for idx, tool_call in enumerate(msg_data["tool_calls"]):
                                func = tool_call.get("function", {})
                                tc_id = tool_call.get("id") or f"ollama_tc_{idx}_{id(tool_call)}"
                                tool_calls[tc_id] = {
                                    "type": "tool_use",
                                    "id": tc_id,
                                    "name": func.get("name", ""),
                                    "input": func.get("arguments", {}) if isinstance(func.get("arguments"), dict) else {},
                                }

                    if "prompt_eval_count" in data and "eval_count" in data:
                        usage = ChatUsage(
                            input_tokens=data.get("prompt_eval_count", 0),
                            output_tokens=data.get("eval_count", 0),
                            time=(datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_datetime).total_seconds(),
                        )

                    # Yield response periodically
                    # 逐个 yield，每个 ChatResponse 只含一种 block type
                    if thinking and len(thinking) > len(last_thinking):
                        delta_thinking_content = thinking[len(last_thinking):]
                        yield ChatResponse(
                            content=[SoloThinkingBlock(type="thinking", thinking=delta_thinking_content)],
                            usage=usage,
                            metadata=None,
                        )
                        last_thinking = thinking
                    if text and len(text) > len(last_text):
                        delta_text_content = text[len(last_text):]
                        yield ChatResponse(
                            content=[SoloTextBlock(type="text", text=delta_text_content)],
                            usage=usage,
                            metadata=None,
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
                            yield ChatResponse(
                                content=[{
                                    "type": "tool_calls",
                                    "tool_calls": [chunk_data],
                                }],
                                usage=usage,
                                metadata=None,
                            )
                    
                    last_tool_calls = OrderedDict(tool_calls)

                    # ★ 任务6：done=true 时设置 stop_reason / finish_reason
                    if data.get("done") is True:
                        done_reason = data.get("done_reason", "stop")
                        if tool_calls:
                            final_stop_reason = "tool_use"
                            final_finish_reason = "tool_calls"
                        elif done_reason == "stop":
                            final_stop_reason = "end_turn"
                            final_finish_reason = "stop"
                        elif done_reason == "tool_calls":
                            final_stop_reason = "tool_use"
                            final_finish_reason = "tool_calls"
                        elif done_reason == "length":
                            final_stop_reason = "max_tokens"
                            final_finish_reason = "length"
                        else:
                            final_stop_reason = done_reason
                            final_finish_reason = done_reason

                        yield ChatResponse(
                            content=[], usage=usage, metadata=None,
                            stop_reason=final_stop_reason, finish_reason=final_finish_reason,
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
            SoloTextBlock | dict | SoloThinkingBlock
        ] = []
        metadata: dict | None = None
        usage = None  # ★ 任务7：初始化 usage，避免无 prompt_eval_count 时 NameError

        if "message" in data:
            msg_data = data["message"]
            # 1. content
            if "content" in msg_data:
                content = msg_data["content"]
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
                                    content_blocks.append({
                                        "type": "tool_calls",
                                        "tool_calls": [{
                                            "index": len([b for b in content_blocks if isinstance(b, dict) and b.get("type") == "tool_calls"]),
                                            "id": tool_call.get("id", ""),
                                            "type": "function",
                                            "function": {
                                                "name": tool_call.get("function", {}).get("name", ""),
                                                "arguments": json.dumps(tool_call.get("arguments", {}), ensure_ascii=False),
                                            },
                                        }],
                                    })
            # 2. thinking
            if msg_data.get("thinking"):
                content_blocks.append(SoloThinkingBlock(type="thinking", thinking=msg_data["thinking"]))
            # 3. message.tool_calls 独立字段
            if msg_data.get("tool_calls"):
                for idx, tool_call in enumerate(msg_data["tool_calls"]):
                    func = tool_call.get("function", {})
                    tc_id = tool_call.get("id") or f"ollama_tc_{idx}"
                    args = func.get("arguments", {})
                    if isinstance(args, dict):
                        args_str = json.dumps(args, ensure_ascii=False)
                    else:
                        args_str = str(args) if args else ""
                    content_blocks.append({
                        "type": "tool_calls",
                        "tool_calls": [{
                            "index": len([b for b in content_blocks if isinstance(b, dict) and b.get("type") == "tool_calls"]),
                            "id": tc_id,
                            "type": "function",
                            "function": {
                                "name": func.get("name", ""),
                                "arguments": args_str,
                            },
                        }],
                    })

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
