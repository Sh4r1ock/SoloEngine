# -*- coding: utf-8 -*-
"""Ollama local model chat class."""
import asyncio
from datetime import datetime
from typing import (
    Any,
    AsyncGenerator,
    Literal,
    Optional,
)
from collections import OrderedDict

import httpx
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
    """The Ollama local model chat class.

    Ollama is an open-source local LLM runner that supports
    running models like Llama 2, Mistral, Gemma, etc. locally.
    """

    def __init__(
        self,
        model_name: str,
        base_url: str = "http://localhost:11434",
        stream: bool = True,
        generate_kwargs: dict[str, JSONSerializableObject] | None = None,
        **kwargs: Any,
    ) -> None:
        """Initialize Ollama client.

        Args:
            model_name (str): The name of the model to use (e.g., "llama2",
                "mistral", "gemma:2b").
            base_url (str): The base URL of the Ollama API server.
                Default is "http://localhost:11434".
            stream (bool): Whether to use streaming output or not.
            generate_kwargs (dict | None): Extra keyword arguments used in
                Ollama API generation, e.g., "temperature", "num_ctx".
            **kwargs (Any): Additional keyword arguments.
        """
        super().__init__(model_name, stream)

        self.base_url = base_url.rstrip("/")
        self.generate_kwargs = generate_kwargs or {}
        self.client = httpx.AsyncClient(timeout=300.0)

    async def __call__(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: Literal["auto", "none", "any"] | str | None = None,
        structured_model: Any = None,
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

        start_datetime = datetime.now()

        try:
            if self.stream:
                response = await self.client.stream(
                    f"{self.base_url}/api/chat",
                    json=payload,
                )
                return self._parse_ollama_stream_response(
                    start_datetime,
                    response,
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

        Ollama has a different tool format than OpenAI.
        We'll convert OpenAI-style tool definitions to Ollama format.
        """
        if not tools:
            return []

        formatted_tools = []
        for tool in tools:
            formatted = {
                "type": "function",
                "function": {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters", {}),
                },
            }
            formatted_tools.append(formatted)
        return formatted_tools

    async def _parse_ollama_stream_response(
        self,
        start_datetime: datetime,
        response,
    ) -> AsyncGenerator[ChatResponse, None]:
        """Parse Ollama streaming response and yield ChatResponse objects.

        Args:
            start_datetime (datetime): The start datetime of response generation.
            response: Ollama streaming response object.

        Returns:
            AsyncGenerator[ChatResponse, None]: Generator yielding ChatResponse objects.
        """
        usage = None
        text = ""
        thinking = ""
        tool_calls = OrderedDict()
        last_text = ""  # 记录上次输出的文本，用于计算增量
        last_thinking = ""  # 记录上次输出的思考内容，用于计算增量

        try:
            async for line in response.aiter_lines():
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
                            time=(datetime.now() - start_datetime).total_seconds(),
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
                time=(datetime.now() - start_datetime).total_seconds(),
            )

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
