# -*- coding: utf-8 -*-
"""Anthropic Claude chat model class."""
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
    """Convert Anthropic message to SoloEngine message format.

    Args:
        msg (Message): Anthropic message object

    Returns:
        dict: SoloEngine message format
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
                # Anthropic uses different format for images
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

    # Handle tool results
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
                        # Anthropic returns text blocks as content
                        result_block["output"] = "\n".join(
                            block.text for block in result.content
                            if isinstance(block, TextBlock)
                        )
                    content.append(result_block)

    # For assistant messages with tool_use
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
    """The Anthropic Claude chat model class."""

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
        """Initialize Anthropic client.

        Args:
            model_name (str): The name of the model to use
                (e.g., "claude-3-5-sonnet-20241022", "claude-3-opus-20240229")
            api_key (str | None): The API key for Anthropic API.
                If not specified, it will be read from environment variable.
            stream (bool): Whether to use streaming output or not.
            api_key_env_var (str): Environment variable name for API key.
            client_kwargs (dict | None): Extra keyword arguments for Anthropic client.
            generate_kwargs (dict | None): Extra keyword arguments used in Anthropic API generation.
            **kwargs (Any): Additional keyword arguments.
        """
        super().__init__(model_name, stream)

        # Handle deprecated client_args parameter from kwargs
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

        # Initialize Anthropic client
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
        """Get response from Anthropic messages API by given arguments.

        Args:
            messages (list[dict]): A list of dictionaries, where 'role' and 'content'
                fields are required, and 'name' field is optional.
            tools (list[dict] | None): The tools JSON schemas that model can use.
            tool_choice (Literal["auto", "none", "any"] | str | None):
                Controls which (if any) tool is called by the model.
            structured_model (Type[object] | None):
                A Pydantic BaseModel class that defines the expected structure
                for the model's output. When provided, model will be forced
                to return data that conforms to this schema by automatically
                converting to a tool function and setting `tool_choice`
                to enforce its usage.
            **kwargs (Any): The keyword arguments for Anthropic messages API,
                e.g., `temperature`, `max_tokens`, `top_p`, etc.

        Returns:
            ChatResponse | AsyncGenerator[ChatResponse, None]: The response.

        Notes:
            When `structured_model` is specified, both `tools` and `tool_choice`
            parameters are ignored, and the model will only perform structured
            output generation without calling any other tools.
        """
        # Check messages format
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

        # Format messages for Anthropic
        # Anthropic expects messages in a different format
        anthropic_messages: list[Message | dict] = []

        # Add system message first if present
        system_message = None
        if messages and messages[0].get("role") == "system":
            system_message = messages[0]
            remaining_messages = messages[1:]
        else:
            remaining_messages = messages

        # Convert remaining messages to Anthropic format
        anthropic_messages.extend(remaining_messages)

        # Build generation kwargs
        gen_kwargs = {
            "model": self.model_name,
            "max_tokens": kwargs.get("max_tokens", 4096),
            "temperature": kwargs.get("temperature", 0.7),
            "top_p": kwargs.get("top_p", 1.0),
            "top_k": kwargs.get("top_k"),
            **self.generate_kwargs,
            **kwargs,
        }

        # Handle streaming
        if self.stream:
            gen_kwargs["stream"] = True

        # Handle tools
        if tools:
            gen_kwargs["tools"] = tools

        # Handle structured model
        if structured_model:
            if tools:
                logger.warning(
                    "structured_model is provided. Both 'tools' and "
                    "'tool_choice' parameters will be overridden and "
                    "ignored. The model will only perform structured output "
                    "generation without calling any other tools."
                )
            # Anthropic uses beta tool_choice="any" for structured output
            gen_kwargs["tool_choice"] = {"type": "any", "name": "formatted_response"}
            gen_kwargs["betas"] = ["computer-use-2024-10-22"]

        start_datetime = datetime.now()

        if self.stream:
            if system_message:
                # For streaming with system message, we need to use the messages endpoint
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
        """Parse Anthropic streaming response and yield ChatResponse objects.

        Args:
            start_datetime (datetime): The start datetime of response generation.
            response (AsyncStream): Anthropic AsyncStream object.
            structured_model (Type[object] | None): Pydantic model for structured output.

        Returns:
            AsyncGenerator[ChatResponse, None]: Generator yielding ChatResponse objects.
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
                    # Yield accumulated content when a block ends
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
                    # Final event - check if there are any pending contents
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
                    # Yield error response
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
        """Parse Anthropic non-streaming completion response.

        Args:
            start_datetime (datetime): The start datetime of response generation.
            response (Message): Anthropic Message object.
            structured_model (Type[object] | None): Pydantic model for structured output.

        Returns:
            ChatResponse: The parsed response.
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
            # Extract structured output if available
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
