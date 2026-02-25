# -*- coding: utf-8 -*-
"""
格式化器基类模块。

@file formatter_base.py
@description 定义消息格式化器的抽象基类
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 定义消息格式化器的统一接口
- 将 Msg 对象转换为 LLM API 所需的格式
- 处理多模态内容的格式转换

格式化器作用：
    不同 LLM 提供商的 API 对消息格式有不同要求：
    - OpenAI: {"role": "user", "content": "..."} 或多模态格式
    - Anthropic: 类似但系统消息单独处理
    - 其他提供商: 各有差异
    
    格式化器负责将统一的 Msg 对象转换为各提供商所需的格式。

支持的转换：
    - 文本消息转换
    - 多模态消息转换（图像、音频、视频）
    - 工具调用消息转换
    - 系统消息处理

设计理念：
    采用策略模式，为不同 LLM 提供商提供对应的格式化器实现。
    格式化器是 Agent 与 LLM API 之间的适配层。

状态: ✅ 完整实现
"""

from abc import abstractmethod
from typing import Any, List, Tuple, Sequence

from ..utils import _save_base64_data
from ..message import Msg, AudioBlock, ImageBlock, TextBlock, VideoBlock


class FormatterBase:
    """
    消息格式化器抽象基类。
    
    所有格式化器的基类，定义了消息格式转换的统一接口。
    具体实现类需要实现 format 方法。
    
    核心功能：
        1. 消息格式转换：将 Msg 对象转换为 API 所需格式
        2. 多模态处理：处理图像、音频、视频等内容
        3. 工具结果转换：将工具结果转换为兼容格式
    
    子类实现：
        - OpenAIChatFormatter: OpenAI Chat API 格式化器
        - 其他提供商的格式化器
    
    使用方式：
        格式化器通过 format 方法将消息列表转换为 API 格式：
        >>> formatted = await formatter.format(messages)
    
    Example:
        >>> from SoloAgent.formatter import OpenAIChatFormatter
        >>> from SoloAgent.message import Msg
        >>> 
        >>> formatter = OpenAIChatFormatter()
        >>> messages = [Msg(name="user", content="你好", role="user")]
        >>> formatted = await formatter.format(messages)
        >>> print(formatted)  # [{"role": "user", "content": "你好"}]
    
    Note:
        - 格式化器是 Agent 与 LLM API 之间的适配层
        - 不同提供商需要不同的格式化器实现
    """

    @abstractmethod
    async def format(self, *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        """
        格式化消息列表。
        
        将 Msg 对象列表转换为 LLM API 所需的字典列表格式。
        这是格式化器的主要接口方法。
        
        Args:
            *args: 位置参数，通常是 Msg 对象列表。
            **kwargs: 关键字参数，可包含：
                - tools: 工具定义列表
                - 其他格式化选项
        
        Returns:
            list[dict[str, Any]]: 格式化后的消息列表。
                每个字典包含 role 和 content 字段，
                格式取决于具体的 LLM 提供商。
        
        Raises:
            NotImplementedError: 子类未实现此方法时抛出。
        
        Note:
            子类必须实现此方法。
        
        Example:
            >>> formatted = await formatter.format(messages)
            >>> # OpenAI 格式示例：
            >>> # [{"role": "user", "content": "你好"}]
        """

    @staticmethod
    def assert_list_of_msgs(msgs: list[Msg]) -> None:
        """
        验证输入是否为 Msg 对象列表。
        
        检查输入是否为有效的 Msg 对象列表，
        用于在格式化前进行类型验证。
        
        Args:
            msgs (list[Msg]): 待验证的消息列表。
        
        Raises:
            TypeError: 当输入不是列表时抛出。
            TypeError: 当列表元素不是 Msg 对象时抛出。
        
        Example:
            >>> FormatterBase.assert_list_of_msgs([Msg(...)])  # 通过
            >>> FormatterBase.assert_list_of_msgs("not a list")  # 抛出 TypeError
        """
        if not isinstance(msgs, list):
            raise TypeError("Input must be a list of Msg objects.")

        for msg in msgs:
            if not isinstance(msg, Msg):
                raise TypeError(
                    f"Expected Msg object, got {type(msg)} instead.",
                )

    @staticmethod
    def convert_tool_result_to_string(
        output: str | List[TextBlock | ImageBlock | AudioBlock | VideoBlock],
    ) -> tuple[
        str,
        Sequence[
            Tuple[
                str,
                ImageBlock | AudioBlock | TextBlock | VideoBlock,
            ]
        ],
    ]:
        """
        将工具结果转换为字符串格式。
        
        某些 LLM API 不支持在工具结果中直接使用多模态数据，
        此方法将多模态数据转换为文本描述，并保存到本地文件。
        
        转换规则：
            - 文本块：直接提取文本内容
            - URL 图像/音频/视频：生成 URL 引用文本
            - Base64 图像/音频/视频：保存到本地文件，生成文件路径引用
        
        Args:
            output (str | List[TextBlock | ImageBlock | AudioBlock | VideoBlock]):
                工具执行结果，可以是：
                - 字符串：直接返回
                - 内容块列表：需要转换
        
        Returns:
            tuple[str, Sequence[Tuple[str, ...]]]:
                - str: 工具结果的文本表示
                - Sequence[Tuple[str, Block]]: 多模态数据列表，
                  每个元组包含（文件路径或 URL, 原始块对象）
        
        Raises:
            AssertionError: 当块格式无效时抛出。
            ValueError: 当源类型不支持时抛出。
        
        Example:
            >>> output = [
            ...     {"type": "text", "text": "这是结果"},
            ...     {"type": "image", "source": {"type": "url", "url": "http://..."}}
            ... ]
            >>> text, multimodal = FormatterBase.convert_tool_result_to_string(output)
            >>> print(text)  # "这是结果\nThe returned image can be found at: http://..."
        
        Note:
            - Base64 数据会被保存到本地临时文件
            - URL 数据保持原样
            - 此方法用于兼容不支持多模态工具结果的 API
        """

        if isinstance(output, str):
            return output, []

        textual_output = []
        multimodal_data = []
        for block in output:
            assert isinstance(block, dict) and "type" in block, (
                f"Invalid block: {block}, a TextBlock, ImageBlock, "
                f"AudioBlock, or VideoBlock is expected."
            )
            if block["type"] == "text":
                textual_output.append(block["text"])

            elif block["type"] in ["image", "audio", "video"]:
                assert "source" in block, (
                    f"Invalid {block['type']} block: {block}, 'source' key "
                    "is required."
                )
                source = block["source"]
                if source["type"] == "url":
                    textual_output.append(
                        f"The returned {block['type']} can be found "
                        f"at: {source['url']}",
                    )

                    path_multimodal_file = source["url"]

                elif source["type"] == "base64":
                    path_multimodal_file = _save_base64_data(
                        source["media_type"],
                        source["data"],
                    )
                    textual_output.append(
                        f"The returned {block['type']} can be found "
                        f"at: {path_multimodal_file}",
                    )

                else:
                    raise ValueError(
                        f"Invalid image source: {block['source']}, "
                        "expected 'url' or 'base64'.",
                    )

                multimodal_data.append(
                    (path_multimodal_file, block),
                )

            else:
                raise ValueError(
                    f"Unsupported block type: {block['type']}, "
                    "expected 'text', 'image', 'audio', or 'video'.",
                )

        if len(textual_output) == 1:
            return textual_output[0], multimodal_data

        else:
            return "\n".join("- " + _ for _ in textual_output), multimodal_data
