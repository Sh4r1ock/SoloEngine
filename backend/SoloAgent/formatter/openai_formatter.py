# -*- coding: utf-8 -*-
# pylint: disable=too-many-branches, too-many-nested_blocks
"""
SoloEngine : OpenAI格式化器，将消息转换为OpenAI API格式

@file openai_formatter.py
@description 实现OpenAI API消息格式化器，支持多模态内容和工具调用
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供OpenAI API的消息格式化功能，包括：
    - OpenAIChatFormatter: OpenAI聊天格式化器
    - OpenAIMultiAgentFormatter: OpenAI多Agent格式化器
    - 支持图像、音频等多模态内容
    - 支持工具调用格式转换

依赖:
    - base64: Base64编码
    - json: JSON处理
    - os: 文件操作
    - urllib.parse: URL解析
    - requests: HTTP请求
    - .truncated_formatter_base: 截断格式化器基类
    - ..message: 消息类型
    - ..model.model_response: 响应类
    - ..token_counter: Token计数器

使用示例:
    - from SoloAgent.formatter import OpenAIChatFormatter
    - formatter = OpenAIChatFormatter()
    - formatted = await formatter.format(messages)
"""
import base64
import copy
import json
import os
from typing import Any
from urllib.parse import urlparse

import requests

from .truncated_formatter_base import TruncatedFormatterBase
from ..utils.logging import logger
from ..message import (
    Msg,
    URLSource,
    TextBlock,
    ImageBlock,
    AudioBlock,
    Base64Source,
    ToolUseBlock,
    ToolResultBlock,
    ThinkingBlock,
)
from ..model.model_response import ChatResponse
from ..token_counter import TokenCounterBase


def _format_openai_image_block(
    image_block: ImageBlock,
) -> dict[str, Any]:
    """
    格式化图像块为OpenAI API格式

    将ImageBlock转换为OpenAI API所需的图像URL格式

    Args:
        image_block: 图像内容块

    Returns:
        dict[str, Any]: OpenAI格式的图像字典，包含type和image_url字段

    Raises:
        ValueError: 当图像源类型不支持时抛出

    示例:
        >>> block = ImageBlock(type="image", source={"type": "url", "url": "http://..."})
        >>> result = _format_openai_image_block(block)
        >>> print(result)  # {"type": "image_url", "image_url": {"url": "..."}}
    """
    source = image_block["source"]
    if source["type"] == "url":
        url = _to_openai_image_url(source["url"])
    elif source["type"] == "base64":
        data = source["data"]
        media_type = source["media_type"]
        url = f"data:{media_type};base64,{data}"
    else:
        raise ValueError(
            f"Unsupported image source type: {source['type']}",
        )

    return {
        "type": "image_url",
        "image_url": {
            "url": url,
        },
    }


def _to_openai_image_url(url: str) -> str:
    """
    转换图像URL为OpenAI格式

    如果给定URL是本地文件，转换为Base64格式；否则直接返回URL

    Args:
        url: 图像的本地路径或公开URL

    Returns:
        str: OpenAI格式的图像URL

    Raises:
        TypeError: 当URL格式不支持时抛出

    示例:
        >>> # 本地文件
        >>> url = _to_openai_image_url("/path/to/image.png")
        >>> # 返回 data:image/png;base64,...
        >>> 
        >>> # 公开URL
        >>> url = _to_openai_image_url("https://example.com/image.jpg")
        >>> # 返回 https://example.com/image.jpg
    """
    support_image_extensions = (
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
    )

    parsed_url = urlparse(url)

    lower_url = url.lower()

    if not os.path.exists(url) and parsed_url.scheme != "":
        if any(lower_url.endswith(_) for _ in support_image_extensions):
            return url

    elif os.path.exists(url) and os.path.isfile(url):
        if any(lower_url.endswith(_) for _ in support_image_extensions):
            with open(url, "rb") as image_file:
                base64_image = base64.b64encode(image_file.read()).decode(
                    "utf-8",
                )
            extension = parsed_url.path.lower().split(".")[-1]
            mime_type = f"image/{extension}"
            return f"data:{mime_type};base64,{base64_image}"

    raise TypeError(f'"{url}" should end with {support_image_extensions}.')


def _to_openai_audio_data(source: URLSource | Base64Source) -> dict:
    """
    转换音频源为OpenAI格式

    将URLSource或Base64Source转换为OpenAI API所需的音频数据格式

    Args:
        source: 音频数据源，可以是URL或Base64编码

    Returns:
        dict: 包含data和format字段的字典

    Raises:
        TypeError: 当音频格式不支持时抛出
        ValueError: 当音频源无效时抛出

    示例:
        >>> source = URLSource(type="url", url="https://example.com/audio.mp3")
        >>> result = _to_openai_audio_data(source)
        >>> print(result)  # {"data": "...", "format": "mp3"}
    """
    if source["type"] == "url":
        extension = source["url"].split(".")[-1].lower()
        if extension not in ["wav", "mp3"]:
            raise TypeError(
                f"Unsupported audio file extension: {extension}, "
                "wav and mp3 are supported.",
            )

        parsed_url = urlparse(source["url"])

        if os.path.exists(source["url"]):
            with open(source["url"], "rb") as audio_file:
                data = base64.b64encode(audio_file.read()).decode("utf-8")

        elif parsed_url.scheme != "":
            response = requests.get(source["url"])
            response.raise_for_status()
            data = base64.b64encode(response.content).decode("utf-8")

        else:
            raise ValueError(
                f"Unsupported audio source: {source['url']}, "
                "it should be a local file or a web URL.",
            )

        return {
            "data": data,
            "format": extension,
        }

    if source["type"] == "base64":
        data = source["data"]
        media_type = source["media_type"]

        if media_type not in ["audio/wav", "audio/mp3"]:
            raise TypeError(
                f"Unsupported audio media type: {media_type}, "
                "only audio/wav and audio/mp3 are supported.",
            )

        return {
            "data": data,
            "format": media_type.split("/")[-1],
        }

    raise TypeError(f"Unsupported audio source: {source['type']}.")


class OpenAIChatFormatter(TruncatedFormatterBase):
    """
    OpenAI聊天格式化器类

    职责:
        - 将Msg对象转换为OpenAI API格式
        - 支持多模态内容（图像、音频）
        - 支持工具调用格式转换
        - 处理assistant消息的reasoning_content

    属性:
        support_tools_api: 是否支持工具API
        support_multiagent: 是否支持多Agent
        support_vision: 是否支持视觉
        supported_blocks: 支持的内容块类型列表
        promote_tool_result_images: 是否提升工具结果图像
        token_counter: Token计数器
        max_tokens: 最大Token数

    示例:
        >>> formatter = OpenAIChatFormatter()
        >>> messages = [Msg(name="user", content="你好", role="user")]
        >>> formatted = await formatter.format(messages)
        >>> print(formatted)  # [{"role": "user", "content": "你好"}]
    """

    support_tools_api: bool = True
    support_multiagent: bool = True
    support_vision: bool = True

    supported_blocks: list[type] = [
        TextBlock,
        ImageBlock,
        AudioBlock,
        ToolUseBlock,
        ToolResultBlock,
        ThinkingBlock,
    ]

    def __init__(
        self,
        promote_tool_result_images: bool = False,
        token_counter: TokenCounterBase | None = None,
        max_tokens: int | None = None,
    ) -> None:
        super().__init__(token_counter=token_counter, max_tokens=max_tokens)
        self.promote_tool_result_images = promote_tool_result_images

    async def _format(
        self,
        msgs: list[Msg],
    ) -> list[dict[str, Any]]:
        self.assert_list_of_msgs(msgs)

        messages: list[dict] = []
        i = 0
        while i < len(msgs):
            msg = msgs[i]
            
            # 对于assistant消息，直接使用to_openai_message()方法构建
            if msg.role == "assistant":
                # 创建一个临时的ChatResponse对象来使用to_openai_message()方法
                chat_response = ChatResponse(content=msg.content if msg.content else [])
                openai_msg = chat_response.to_openai_message()
                openai_msg["name"] = msg.name
                messages.append(openai_msg)
                i += 1
                continue
            
            content_blocks = []
            tool_calls = []
            reasoning_content = None

            for block in msg.get_content_blocks():
                typ = block.get("type")
                if typ == "text":
                    content_blocks.append({**block})
                elif typ == "content":
                    content_blocks.append({"type": "text", "text": block.get("content", "")})

                elif typ == "thinking":
                    reasoning_content = block.get("thinking")
                
                elif typ == "reasoning_content":
                    if "reasoning_content" in block:
                        reasoning_content = block.get("reasoning_content")
                    elif "content" in block:
                        reasoning_content = block.get("content", "")

                elif typ == "tool_use":
                    tool_calls.append(
                        {
                            "id": block.get("id"),
                            "type": "function",
                            "function": {
                                "name": block.get("name"),
                                "arguments": json.dumps(
                                    block.get("input", {}),
                                    ensure_ascii=False,
                                ),
                            },
                        },
                    )

                elif typ == "tool_calls":
                    # 流式格式的 tool_calls 块
                    for tc in block.get("tool_calls", []):
                        tool_calls.append(tc)

                elif typ == "tool_result":
                    (
                        textual_output,
                        multimodal_data,
                    ) = self.convert_tool_result_to_string(block["output"])

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": block.get("id"),
                            "content": textual_output,
                            "name": block.get("name"),
                        },
                    )

                    promoted_blocks: list = []
                    for url, multimodal_block in multimodal_data:
                        if (
                            multimodal_block["type"] == "image"
                            and self.promote_tool_result_images
                        ):
                            promoted_blocks.extend(
                                [
                                    TextBlock(
                                        type="text",
                                        text=f"\n- The image from '{url}': ",
                                    ),
                                    ImageBlock(
                                        type="image",
                                        source=URLSource(
                                            type="url",
                                            url=url,
                                        ),
                                    ),
                                ],
                            )

                    if promoted_blocks:
                        promoted_blocks = [
                            TextBlock(
                                type="text",
                                text="<system-info>The following are "
                                "the image contents from the tool "
                                f"result of '{block['name']}':",
                            ),
                            *promoted_blocks,
                            TextBlock(
                                type="text",
                                text="</system-info>",
                            ),
                        ]

                        msgs.insert(
                            i + 1,
                            Msg(
                                name="user",
                                content=promoted_blocks,
                                role="user",
                            ),
                        )

                elif typ == "image":
                    content_blocks.append(
                        _format_openai_image_block(
                            block,
                        ),
                    )

                elif typ == "audio":
                    input_audio = _to_openai_audio_data(block["source"])
                    content_blocks.append(
                        {
                            "type": "input_audio",
                            "input_audio": input_audio,
                        },
                    )

                else:
                    logger.warning(
                        "Unsupported block type %s in the message, skipped.",
                        typ,
                    )

            # 处理 tool 消息的 content：必须是字符串
            if msg.role == "tool":
                # 将 content_blocks 转换为字符串
                if content_blocks:
                    text_parts = []
                    for block in content_blocks:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                    content_str = "\n".join(text_parts) if text_parts else ""
                else:
                    content_str = ""
                
                msg_openai = {
                    "role": "tool",
                    "content": content_str,  # 必须是字符串，即使是空字符串
                }
                
                # 添加 tool_call_id
                if msg.tool_call_id:
                    msg_openai["tool_call_id"] = msg.tool_call_id
            else:
                # 统一处理其他消息类型
                msg_openai = {
                    "role": msg.role,
                    "name": msg.name,
                    "content": content_blocks or None,
                }

                if tool_calls:
                    msg_openai["tool_calls"] = tool_calls

            has_content = msg_openai.get("content") is not None and (
                not isinstance(msg_openai.get("content"), list) or len(msg_openai.get("content")) > 0
            )
            has_valid_content = has_content or tool_calls
            
            if has_valid_content or msg.role == "tool":
                # 即使没有original_model_message，也从content中提取thinking内容
                if reasoning_content is not None and msg.role == "assistant":
                    msg_openai["reasoning_content"] = reasoning_content
                # 关键修复：确保所有有tool_calls的assistant消息都有reasoning_content字段
                if tool_calls and msg.role == "assistant" and "reasoning_content" not in msg_openai:
                    # 如果没有reasoning_content，添加一个空字符串
                    msg_openai["reasoning_content"] = ""
                    logger.warning(f"[OpenAIChatFormatter] Added empty reasoning_content to assistant message with tool_calls")
                messages.append(msg_openai)

            i += 1

        return messages

    async def format(self, msgs: list[Msg]) -> list[dict[str, Any]]:
        """
        格式化消息为OpenAI格式

        将Msg对象列表转换为OpenAI API所需的消息格式，包含调试日志

        Args:
            msgs: 消息对象列表

        Returns:
            list[dict[str, Any]]: OpenAI格式的消息列表

        示例:
            >>> messages = [Msg(name="user", content="你好", role="user")]
            >>> formatted = await formatter.format(messages)
            >>> print(formatted)  # [{"role": "user", "content": "你好"}]
        """
        logger.info(f"[OpenAIChatFormatter] Input {len(msgs)} Msg objects:")
        for i, msg in enumerate(msgs):
            has_original = msg.metadata and 'original_model_message' in msg.metadata
            provider = msg.metadata.get('provider', 'N/A') if msg.metadata else 'N/A'
            logger.info(f"  Msg {i}: role={msg.role}, has_original={has_original}, provider={provider}")
            if msg.metadata:
                logger.info(f"    Msg {i} metadata keys: {list(msg.metadata.keys())}")
                if has_original:
                    original = msg.metadata['original_model_message']
                    logger.info(f"    Original message: role={original.get('role')}, has_rc={'reasoning_content' in original}, has_tc={'tool_calls' in original}")
                    logger.info(f"    Original message full: {original}")
        
        formatted = await self._format(msgs)
        logger.info(f"[OpenAIChatFormatter] Sending {len(formatted)} messages to API:")
        for i, msg in enumerate(formatted):
            logger.info(f"  Message {i}: role={msg.get('role')}, has_tool_calls={'tool_calls' in msg}, has_reasoning_content={'reasoning_content' in msg}")
            if msg.get('role') == 'tool':
                logger.info(f"    Message {i} tool_call_id: {msg.get('tool_call_id')}")
            if 'tool_calls' in msg and 'reasoning_content' not in msg:
                logger.error(f"  !!! ERROR: Message {i} has tool_calls but NO reasoning_content!")
                logger.error(f"  Message {i} full: {msg}")
        
        # 验证 tool_calls 和 tool 消息是否匹配
        tool_call_ids = set()
        tool_ids = set()
        for msg in formatted:
            if msg.get('role') == 'assistant' and 'tool_calls' in msg:
                for tc in msg['tool_calls']:
                    tool_call_ids.add(tc.get('id'))
            elif msg.get('role') == 'tool':
                tool_ids.add(msg.get('tool_call_id'))
        
        missing = tool_call_ids - tool_ids
        if missing:
            logger.error(f"[OpenAIChatFormatter] Missing tool messages for tool_call_ids: {missing}")
        else:
            logger.info(f"[OpenAIChatFormatter] All tool_calls have matching tool messages")
        
        return formatted


class OpenAIMultiAgentFormatter(TruncatedFormatterBase):
    """
    OpenAI多Agent格式化器类

    职责:
        - 将Msg对象转换为OpenAI API格式，支持多Agent对话
        - 支持多模态内容（图像、音频）
        - 支持工具调用格式转换
        - 管理对话历史提示

    属性:
        support_tools_api: 是否支持工具API
        support_multiagent: 是否支持多Agent
        support_vision: 是否支持视觉
        supported_blocks: 支持的内容块类型列表
        conversation_history_prompt: 对话历史提示文本
        promote_tool_result_images: 是否提升工具结果图像
        token_counter: Token计数器
        max_tokens: 最大Token数

    示例:
        >>> formatter = OpenAIMultiAgentFormatter()
        >>> messages = [Msg(name="agent1", content="你好", role="assistant")]
        >>> formatted = await formatter.format(messages)
    """

    support_tools_api: bool = True
    support_multiagent: bool = True
    support_vision: bool = True

    supported_blocks: list[type] = [
        TextBlock,
        ImageBlock,
        AudioBlock,
        ToolUseBlock,
        ToolResultBlock,
        ThinkingBlock,
    ]

    def __init__(
        self,
        conversation_history_prompt: str = (
            "# Conversation History\n"
            "The content between <history></history> tags contains "
            "your conversation history\n"
        ),
        promote_tool_result_images: bool = False,
        token_counter: TokenCounterBase | None = None,
        max_tokens: int | None = None,
    ) -> None:
        super().__init__(token_counter=token_counter, max_tokens=max_tokens)
        self.conversation_history_prompt = conversation_history_prompt
        self.prom