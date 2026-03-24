# -*- coding: utf-8 -*-
"""
消息类模块。

@file message_base.py
@description 定义 Agent 对话中的消息数据结构
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 定义统一的消息数据结构
- 支持多种内容类型（文本、图像、音频、工具调用等）
- 提供消息的序列化和反序列化功能
- 支持内容块的类型安全访问

消息结构：
    Msg 对象包含：
    - id: 消息唯一标识
    - name: 发送者名称
    - role: 角色（user/assistant/system）
    - content: 内容（字符串或内容块列表）
    - metadata: 元数据
    - timestamp: 时间戳
    - invocation_id: API 调用 ID

角色类型：
    - user: 用户消息
    - assistant: 助手消息
    - system: 系统消息
    - tool: 工具调用结果消息

设计理念：
    消息是 Agent 对话的基本单位，支持结构化的多模态内容。
    通过内容块机制，一条消息可以包含文本、图像、工具调用
    等多种类型的内容。

状态: ✅ 完整实现
"""

from datetime import datetime
from typing import Literal, List, overload, Sequence

import shortuuid

from .message_block import (
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
    ImageBlock,
    AudioBlock,
    ContentBlock,
    VideoBlock,
    ThinkingBlock,
)
from ..types import JSONSerializableObject


class Msg:
    """
    消息类 - Agent 对话的基本单位。
    
    表示对话中的一条消息，包含发送者信息、内容和元数据。
    支持多种内容类型，包括文本、图像、音频、工具调用等。
    
    核心功能：
        1. 多模态内容支持：支持文本、图像、音频、视频等
        2. 工具调用支持：支持工具调用请求和结果
        3. 序列化支持：支持与字典格式互转
        4. 类型安全访问：提供类型安全的内容块访问方法
    
    消息角色：
        - user: 用户发送的消息
        - assistant: 助手（LLM）生成的消息
        - system: 系统提示消息
        - tool: 工具调用结果消息
    
    内容格式：
        消息内容可以是：
        - 字符串：纯文本消息
        - 内容块列表：多模态或结构化消息
    
    Example:
        >>> # 纯文本消息
        >>> msg = Msg(
        ...     name="user",
        ...     content="你好！",
        ...     role="user"
        ... )
        >>> 
        >>> # 多模态消息
        >>> msg = Msg(
        ...     name="user",
        ...     content=[
        ...         {"type": "text", "text": "这张图片是什么？"},
        ...         {"type": "image", "source": {...}}
        ...     ],
        ...     role="user"
        ... )
        >>> 
        >>> # 获取文本内容
        >>> text = msg.get_text_content()
    
    Note:
        - id 和 timestamp 会自动生成
        - 内容可以是字符串或内容块列表
    """

    def __init__(
        self,
        name: str,
        content: str | Sequence[ContentBlock],
        role: Literal["user", "assistant", "system", "tool"],
        metadata: dict[str, JSONSerializableObject] | None = None,
        timestamp: str | None = None,
        invocation_id: str | None = None,
    ) -> None:
        """
        初始化消息对象。
        
        Args:
            name (str): 消息发送者名称，如 "user"、"assistant" 或自定义名称。
            content (str | Sequence[ContentBlock]): 消息内容，可以是：
                - 字符串：纯文本消息
                - 内容块列表：多模态或结构化消息
            role (Literal["user", "assistant", "system", "tool"]): 消息角色：
                - "user": 用户消息
                - "assistant": 助手消息
                - "system": 系统消息
                - "tool": 工具调用结果消息
            metadata (dict[str, JSONSerializableObject] | None, optional):
                消息元数据，可存储结构化输出、标签等额外信息。
                默认为 None。
            timestamp (str | None, optional): 消息时间戳。
                如果未指定，自动使用当前时间。默认为 None。
            invocation_id (str | None, optional): 关联的 API 调用 ID。
                用于追踪消息对应的 API 请求。默认为 None。
        
        Raises:
            AssertionError: 当 content 不是字符串或列表时抛出。
            AssertionError: 当 role 不是有效角色时抛出。
        
        Example:
            >>> msg = Msg(
            ...     name="assistant",
            ...     content="你好！有什么可以帮助你的？",
            ...     role="assistant",
            ...     metadata={"model": "gpt-4"}
            ... )
        """

        self.name = name

        assert isinstance(
            content,
            (list, str),
        ), "The content must be a string or a list of content blocks."

        self.content = content

        assert role in ["user", "assistant", "system", "tool"]
        self.role = role

        self.metadata = metadata

        self.id = shortuuid.uuid()
        self.timestamp = (
            timestamp
            or datetime.now().strftime(
                "%Y-%m-%d %H:%M:%S.%f",
            )[:-3]
        )
        self.invocation_id = invocation_id

    def to_dict(self) -> dict:
        """
        将消息转换为字典格式。
        
        用于消息的序列化，便于存储和传输。
        
        Returns:
            dict: 消息的字典表示，包含以下字段：
                - id: 消息唯一标识
                - name: 发送者名称
                - role: 消息角色
                - content: 消息内容
                - metadata: 元数据
                - timestamp: 时间戳
        
        Example:
            >>> msg = Msg(name="user", content="你好", role="user")
            >>> data = msg.to_dict()
            >>> print(data["content"])  # "你好"
        
        Note:
            invocation_id 不包含在输出中。
        """
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "content": self.content,
            "metadata": self.metadata,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, json_data: dict) -> "Msg":
        """
        从字典创建消息对象。
        
        用于消息的反序列化，从存储或传输的数据恢复消息。
        
        Args:
            json_data (dict): 消息的字典表示，必须包含：
                - name: 发送者名称
                - content: 消息内容
                - role: 消息角色
                可选字段：
                - id: 消息 ID（如果未提供则自动生成）
                - metadata: 元数据
                - timestamp: 时间戳
                - invocation_id: API 调用 ID
        
        Returns:
            Msg: 创建的消息对象。
        
        Example:
            >>> data = {"name": "user", "content": "你好", "role": "user"}
            >>> msg = Msg.from_dict(data)
        """
        new_obj = cls(
            name=json_data["name"],
            content=json_data["content"],
            role=json_data["role"],
            metadata=json_data.get("metadata", None),
            timestamp=json_data.get("timestamp", None),
            invocation_id=json_data.get("invocation_id", None),
        )

        new_obj.id = json_data.get("id", new_obj.id)
        return new_obj

    def has_content_blocks(
        self,
        block_type: Literal[
            "text",
            "tool_use",
            "tool_result",
            "image",
            "audio",
            "video",
        ]
        | None = None,
    ) -> bool:
        """
        检查消息是否包含指定类型的内容块。
        
        Args:
            block_type (Literal["text", "tool_use", "tool_result", "image", \
            "audio", "video"] | None, optional): 要检查的块类型。
                如果为 None，检查是否有任何内容块。默认为 None。
        
        Returns:
            bool: 如果包含指定类型的块则返回 True，否则返回 False。
        
        Example:
            >>> msg = Msg(name="user", content=[{"type": "text", "text": "你好"}], role="user")
            >>> msg.has_content_blocks("text")  # True
            >>> msg.has_content_blocks("image")  # False
        """
        return len(self.get_content_blocks(block_type)) > 0

    def get_text_content(self, separator: str = "\n") -> str | None:
        """
        获取消息中的纯文本内容。
        
        从消息内容中提取所有文本块并拼接。如果内容是字符串，
        直接返回；如果是内容块列表，提取所有文本块。
        
        Args:
            separator (str, optional): 多个文本块之间的分隔符。
                默认为换行符 "\\n"。
        
        Returns:
            str | None: 拼接后的文本内容。如果没有文本内容，返回 None。
        
        Example:
            >>> msg = Msg(
            ...     name="assistant",
            ...     content=[
            ...         {"type": "text", "text": "第一段"},
            ...         {"type": "text", "text": "第二段"}
            ...     ],
            ...     role="assistant"
            ... )
            >>> msg.get_text_content()  # "第一段\\n第二段"
        
        Note:
            此方法只返回文本块的内容，忽略图像、工具调用等其他块。
        """
        if isinstance(self.content, str):
            return self.content

        gathered_text = []
        for block in self.content:
            if block.get("type") == "text":
                gathered_text.append(block["text"])

        if gathered_text:
            return separator.join(gathered_text)

        return None

    @overload
    def get_content_blocks(
        self,
        block_type: Literal["text"],
    ) -> List[TextBlock]:
        ...

    @overload
    def get_content_blocks(
        self,
        block_type: Literal["tool_use"],
    ) -> List[ToolUseBlock]:
        ...

    @overload
    def get_content_blocks(
        self,
        block_type: Literal["tool_result"],
    ) -> List[ToolResultBlock]:
        ...

    @overload
    def get_content_blocks(
        self,
        block_type: Literal["image"],
    ) -> List[ImageBlock]:
        ...

    @overload
    def get_content_blocks(
        self,
        block_type: Literal["audio"],
    ) -> List[AudioBlock]:
        ...

    @overload
    def get_content_blocks(
        self,
        block_type: Literal["video"],
    ) -> List[VideoBlock]:
        ...

    @overload
    def get_content_blocks(
        self,
        block_type: None = None,
    ) -> List[ContentBlock]:
        ...

    def get_content_blocks(
        self,
        block_type: Literal[
            "text",
            "thinking",
            "tool_use",
            "tool_result",
            "image",
            "audio",
            "video",
        ]
        | None = None,
    ) -> (
        List[ContentBlock]
        | List[TextBlock]
        | List[ThinkingBlock]
        | List[ToolUseBlock]
        | List[ToolResultBlock]
        | List[ImageBlock]
        | List[AudioBlock]
        | List[VideoBlock]
    ):
        """
        获取消息中的内容块。
        
        从消息内容中提取指定类型的内容块。如果内容是字符串，
        会自动转换为文本块。
        
        Args:
            block_type (Literal["text", "thinking", "tool_use", \
            "tool_result", "image", "audio", "video"] | None, optional):
                要提取的块类型。如果为 None，返回所有块。默认为 None。
        
        Returns:
            List[ContentBlock] | List[具体块类型]: 内容块列表。
                返回类型取决于 block_type 参数。
        
        Example:
            >>> msg = Msg(
            ...     name="assistant",
            ...     content=[
            ...         {"type": "text", "text": "回答"},
            ...         {"type": "tool_use", "id": "1", "name": "search", "input": {}}
            ...     ],
            ...     role="assistant"
            ... )
            >>> 
            >>> text_blocks = msg.get_content_blocks("text")
            >>> tool_blocks = msg.get_content_blocks("tool_use")
        
        Note:
            - 如果内容是字符串，会自动转换为包含单个文本块的列表
            - 类型过滤通过块的 type 字段实现
        """
        blocks = []
        if isinstance(self.content, str):
            blocks.append(
                TextBlock(type="text", text=self.content),
            )
        else:
            blocks = self.content or []

        if block_type is not None:
            blocks = [_ for _ in blocks if _["type"] == block_type]

        return blocks

    def __repr__(self) -> str:
        """
        获取消息的字符串表示。
        
        返回消息的详细字符串表示，包含所有字段信息。
        
        Returns:
            str: 消息的字符串表示。
        
        Example:
            >>> msg = Msg(name="user", content="你好", role="user")
            >>> repr(msg)  # "Msg(id='...', name='user', content='你好', ...)"
        """
        return (
            f"Msg(id='{self.id}', "
            f"name='{self.name}', "
            f"content={repr(self.content)}, "
            f"role='{self.role}', "
            f"metadata={repr(self.metadata)}, "
            f"timestamp='{self.timestamp}', "
            f"invocation_id='{self.invocation_id}')"
        )
