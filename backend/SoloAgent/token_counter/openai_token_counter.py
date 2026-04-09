# -*- coding: utf-8 -*-
"""
SoloEngine : OpenAI Token计数器模块

@file openai_token_counter.py
@description 提供OpenAI模型的Token计数功能
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供OpenAI Token计数器，包括：
    - OpenAITokenCounter: OpenAI Token计数器
    - 支持文本Token计数
    - 支持图像Token计数（视觉模型）
    - 支持工具Token计数
    - 支持多种OpenAI模型

依赖:
    - base64: Base64编码
    - io: IO操作
    - json: JSON处理
    - math: 数学运算
    - typing: 类型提示
    - requests: HTTP请求
    - PIL: 图像处理
    - tiktoken: OpenAI Token编码
    - .token_base: Token计数器基类

使用示例:
    - from SoloAgent.token_counter import OpenAITokenCounter
    - counter = OpenAITokenCounter(model_name="gpt-4")
    - count = await counter.count(messages)
"""

import base64
import io
import json
import math
from typing import Any
import requests
from PIL import Image

from .token_base import TokenCounterBase


def _calculate_tokens_for_high_quality_image(
    base_tokens: int,
    tile_tokens: int,
    width: int,
    height: int,
) -> int:
    """
    计算高质量图像的Token数量

    Args:
        base_tokens: 基础Token数
        tile_tokens: 每个tile的Token数
        width: 图像宽度
        height: 图像高度

    Returns:
        int: 总Token数

    示例:
        >>> tokens = _calculate_tokens_for_high_quality_image(85, 170, 1024, 1024)
    """
    # Step1: scale to fit within a 2048x2048 box
    if width > 2048 or height > 2048:
        ratio = min(2048 / width, 2048 / height)
        width = int(width * ratio)
        height = int(height * ratio)

    # Step2: Scale to make the shortest side 768 pixels
    shortest_side = min(width, height)
    if shortest_side != 768:
        ratio = 768 / shortest_side
        width = int(width * ratio)
        height = int(height * ratio)

    # Step3: Calculate how many 512px tiles are needed
    tiles_width = (width + 511) // 512
    tiles_height = (height + 511) // 512
    total_tiles = tiles_width * tiles_height

    # Step4: Calculate the total tokens
    total_tokens = (total_tiles * tile_tokens) + base_tokens

    return total_tokens


def _get_size_of_image_url(url: str) -> tuple[int, int]:
    """
    从URL获取图像尺寸

    Args:
        url: 图像URL或Base64数据

    Returns:
        tuple[int, int]: 图像宽度和高度

    Raises:
        requests.RequestException: HTTP请求失败时抛出

    示例:
        >>> width, height = _get_size_of_image_url("https://example.com/image.jpg")
    """
    if url.startswith("data:image/"):
        base64_data = url.split("base64,")[1]
        image_data = base64.b64decode(base64_data)
    else:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        image_data = response.content

    image = Image.open(io.BytesIO(image_data))
    width, height = image.size
    return width, height


def _get_base_and_tile_tokens(model_name: str) -> tuple[int, int]:
    """
    获取OpenAI模型的基础Token和tile Token数

    Args:
        model_name: 模型名称

    Returns:
        tuple[int, int]: (基础Token数, tile Token数)

    Raises:
        ValueError: 当模型不支持时抛出

    示例:
        >>> base, tile = _get_base_and_tile_tokens("gpt-4o")
    """
    if any(
        model_name.startswith(_)
        for _ in [
            "gpt-4o",
            "gpt-4.1",
            "gpt-4.5",
        ]
    ):
        return 85, 170

    if any(
        model_name.startswith(_)
        for _ in [
            "o1",
            "o1-pro",
            "o3",
        ]
    ):
        return 75, 150

    if model_name.startswith("4o-mini"):
        return 2833, 5667

    raise ValueError(
        f"Unsupported OpenAI model {model_name} for token counting.",
    )


def _calculate_tokens_for_tools(
    model_name: str,
    tools: list[dict],
    encoding: Any,
) -> int:
    """
    计算工具的Token数量

    Args:
        model_name: 模型名称
        tools: 工具定义列表
        encoding: Token编码器

    Returns:
        int: 工具的总Token数

    示例:
        >>> tokens = _calculate_tokens_for_tools("gpt-4", tools, encoding)
    """
    if not tools:
        return 0

    func_init = 10
    prop_init = 3
    prop_key = 3
    enum_init = -3
    enum_item = 3
    func_end = 12

    if model_name.startswith("gpt-4o"):
        func_init = 7

    func_token_count = 0
    for f in tools:
        func_token_count += func_init
        function = f["function"]
        f_name = function["name"]
        f_desc = function.get("description", "").removesuffix(".")
        func_token_count += len(encoding.encode(f"{f_name}:{f_desc}"))

        properties = function["parameters"]["properties"]

        if len(properties) > 0:
            func_token_count += prop_init
            for key in properties.keys():
                func_token_count += prop_key
                p_name = key
                p_type = properties[key]["type"]
                p_desc = (
                    properties[key].get("description", "").removesuffix(".")
                )

                if "enum" in properties[key].keys():
                    func_token_count += enum_init
                    for item in properties[key]["enum"]:
                        func_token_count += enum_item
                        func_token_count += len(encoding.encode(item))

                func_token_count += len(
                    encoding.encode(f"{p_name}:{p_type}:{p_desc}"),
                )
    func_token_count += func_end

    return func_token_count


def _count_content_tokens_for_openai_vision_model(
    model_name: str,
    content: list[dict],
    encoding: Any,
) -> int:
    """
    计算OpenAI视觉模型内容的Token数量

    Args:
        model_name: 模型名称
        content: 内容列表
        encoding: Token编码器

    Returns:
        int: 内容的总Token数

    Raises:
        ValueError: 当内容类型不支持时抛出

    示例:
        >>> tokens = _count_content_tokens_for_openai_vision_model("gpt-4o", content, encoding)
    """
    num_tokens = 0
    for item in content:
        assert isinstance(item, dict), (
            "The content field should be a list of dictionaries, but got "
            f"{type(item)}."
        )

        typ = item.get("type", None)
        if typ == "text":
            num_tokens += len(
                encoding.encode(item["text"]),
            )

        elif typ == "image_url":
            width, height = _get_size_of_image_url(item["image_url"]["url"])

            # Different counting logic for different models
            if any(
                model_name.startswith(_)
                for _ in [
                    "gpt-4.1-mini",
                    "gpt-4.1-nano",
                    "o4-mini",
                ]
            ):
                patches = min(
                    math.ceil(width / 32) * math.ceil(height / 32),
                    1536,
                )
                if model_name.startswith("gpt-4.1-mini"):
                    num_tokens += math.ceil(patches * 1.62)

                elif model_name.startswith("gpt-4.1-nano"):
                    num_tokens += math.ceil(patches * 2.46)

                else:
                    num_tokens += math.ceil(patches * 1.72)

            elif any(
                model_name.startswith(_)
                for _ in [
                    "gpt-4o",
                    "gpt-4.1",
                    "gpt-4o-mini",
                    "o",
                ]
            ):
                base_tokens, tile_tokens = _get_base_and_tile_tokens(
                    model_name,
                )

                # By default, we use high here to avoid undercounting tokens
                detail = item.get("image_url").get("detail", "high")
                if detail == "low":
                    num_tokens += base_tokens

                elif detail in ["auto", "high"]:
                    num_tokens += _calculate_tokens_for_high_quality_image(
                        base_tokens,
                        tile_tokens,
                        width,
                        height,
                    )

                else:
                    raise ValueError(
                        f"Unsupported image detail {detail}, expected "
                        f"one of ['low', 'auto', 'high'].",
                    )

        else:
            raise ValueError(
                "The type field currently only supports 'text' "
                f"and 'image_url', but got {typ}.",
            )

    return num_tokens


class OpenAITokenCounter(TokenCounterBase):
    """
    OpenAI Token计数器

    职责:
        - 实现TokenCounterBase接口
        - 计算OpenAI模型的Token数量
        - 支持文本、图像、工具Token计数

    属性:
        model_name: 模型名称

    示例:
        >>> counter = OpenAITokenCounter(model_name="gpt-4")
        >>> count = await counter.count(messages, tools)
    """

    def __init__(self, model_name: str) -> None:
        """
        初始化OpenAI Token计数器

        Args:
            model_name: OpenAI模型名称

        示例:
            >>> counter = OpenAITokenCounter("gpt-4")
        """
        self.model_name = model_name

    async def count(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict] = None,
        **kwargs: Any,
    ) -> int:
        """
        计算给定消息的Token数量

        Args:
            messages: 消息字典列表，需要包含role和content字段
            tools: 工具定义列表
            **kwargs: 额外的关键字参数

        Returns:
            int: Token总数

        示例:
            >>> count = await counter.count(messages, tools)
        """
        import tiktoken

        try:
            encoding = tiktoken.encoding_for_model(self.model_name)
        except KeyError:
            encoding = tiktoken.get_encoding("o200k_base")

        tokens_per_message = 3
        tokens_per_name = 1

        # every reply is primed with <|start|>assistant<|message|>
        num_tokens = 3
        for message in messages:
            num_tokens += tokens_per_message
            for key, value in message.items():
                # Considering vision models
                if key == "content" and isinstance(value, list):
                    num_tokens += (
                        _count_content_tokens_for_openai_vision_model(
                            self.model_name,
                            value,
                            encoding,
                        )
                    )

                elif isinstance(value, str):
                    num_tokens += len(encoding.encode(value))

                elif value is None:
                    continue

                elif key == "tool_calls":
                    num_tokens += len(
                        encoding.encode(
                            json.dumps(value, ensure_ascii=False),
                        ),
                    )

                else:
                    raise TypeError(
                        f"Invalid type {type(value)} in the {key} field: "
                        f"{value}",
                    )

                if key == "name":
                    num_tokens += tokens_per_name

        if tools:
            num_tokens += _calculate_tokens_for_tools(
                self.model_name,
                tools,
                encoding,
            )

        return num_tokens