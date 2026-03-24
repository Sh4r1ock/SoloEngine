# -*- coding: utf-8 -*-
"""Qwen (通义千问) chat model class."""
from datetime import datetime
from typing import (
    Any,
    TYPE_CHECKING,
    AsyncGenerator,
    Literal,
    Type,
)
from collections import OrderedDict

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
    ToolResultBlock as SoloToolResultBlock,
    ThinkingBlock as SoloThinkingBlock,
    ImageBlock as SoloImageBlock,
    Base64Source as SoloBase64Source,
    URLSource as SoloURLSource,
)
from ..utils.logging import logger
from ..types import JSONSerializableObject

if TYPE_CHECKING:
    from dashscope import AsyncStream
else:
    AsyncStream = "dashscope.AsyncStream"


class QwenChatModel(ChatModelBase):
    """The Qwen (Tongyi Qianwen) chat model class."""

    def __init__(
        self,
        model_name: str,
        api_key: str | None = None,
        stream: bool = True,
        api_key_env_var: str = "DASHSCOPE_API_KEY",
        client_kwargs: dict[str, JSONSerializableObject] | None = None,
        generate_kwargs: dict[str, JSONSerializableObject] | None = None,
        **kwargs: Any,
    ) -> None:
        """Initialize Qwen (Tongyi Qianwen) client.

        Args:
            model_name (str): The name of the model to use in Qwen API.
                (e.g., "qwen-plus", "qwen-turbo", "qwen-max")
            api_key (str | None): The API key for Qwen API.
                If not specified, it will be read from environment variable.
            stream (bool): Whether to use streaming output or not.
            api_key_env_var (str): Environment variable name for API key.
            client_kwargs (dict | None): Extra keyword arguments for Qwen client.
            generate_kwargs (dict | None): Extra keyword arguments used in Qwen API generation.
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

        # Initialize Qwen client
        import os
        key = api_key or os.environ.get(api_key_env_var)
        if not key:
            raise ValueError(
                f"Qwen API key not provided and not found in environment "
                f"variable '{api_key_env_var}'"
            )

        from dashscope import AsyncDashScope
        self.client = AsyncDashScope(
            api_key=key,
            **(client_kwargs or {}),
        )

        self.generate_kwargs = generate_kwargs or {}
        self.api_key_env_var = api_key_env_var

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
            if role not in ["SYSTEM", "USER", "ASSISTANT"]:
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
    ) -> AsyncGenerator[ChatResponse, None]:
        """Parse Qwen streaming response and yield ChatResponse objects.

        Args:
            start_datetime (datetime): The start datetime of response generation.
            response: Qwen AsyncGeneration object.

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

        async with response as stream:
            async for chunk in stream:
                if hasattr(chunk, "usage") and chunk.usage:
                    total_input_tokens = getattr(chunk.usage, 'input_tokens', None) or getattr(chunk.usage, 'prompt_tokens', None)
                    total_output_tokens = getattr(chunk.usage, 'output_tokens', None) or getattr(chunk.usage, 'completion_tokens', None)

                if hasattr(chunk, "output") and chunk.output:
                    output = chunk.output
                    if hasattr(chunk, "finish_reason"):
                        finish_reason = chunk.finish_reason
                        if finish_reason == "stop":
                            stop_reason = "end_turn"
                            # 流结束时设置usage
                            if total_input_tokens is not None or total_output_tokens is not None:
                                usage = ChatUsage(
                                    input_tokens=total_input_tokens,
                                    output_tokens=total_output_tokens,
                                    time=(datetime.now() - start_datetime).total_seconds(),
                                )
                                logger.info(f"[Qwen Stream] usage at end: input={total_input_tokens}, output={total_output_tokens}")
                        elif finish_reason == "tool_calls":
                            stop_reason = "tool_use"
                        logger.info(f"[Qwen Stream] finish_reason: {finish_reason}, stop_reason: {stop_reason}")
                    
                    # Qwen streaming format is a list of Message objects
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
                                # Handle content blocks in streaming
                                for block in msg.content:
                                    if isinstance(block, str):
                                        text += block
                                    elif isinstance(block, dict):
                                        if block.get("type") == "text":
                                            text += block.get("text", "")
                                        elif block.get("type") == "thinking":
                                            thinking += block.get("text", "")

                # 增量输出
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
                        logger.info(f"[Qwen] Tool call start: index={index}, id={tool_id}, name={tool_call.get('name')}")
                        
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
                            logger.info(f"[Qwen] Tool call initial args: index={index}, args={args_str[:50]}...")
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
                    time=(datetime.now() - start_datetime).total_seconds(),
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
