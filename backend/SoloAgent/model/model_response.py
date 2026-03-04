# -*- coding: utf-8 -*-
"""
模型响应模块。

@file model_response.py
@description 定义聊天模型的响应数据结构
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 定义统一的模型响应数据结构
- 支持多种内容块类型（文本、工具调用、思考、音频）
- 提供使用量统计和元数据存储

内容块类型：
    - TextBlock: 纯文本内容
    - ToolUseBlock: 工具调用请求
    - ThinkingBlock: 思考过程（如 Claude 的 extended thinking）
    - AudioBlock: 音频内容

数据结构：
    ChatResponse 包含：
    - content: 内容块列表
    - id: 响应唯一标识
    - created_at: 创建时间
    - type: 响应类型
    - usage: Token 使用量统计
    - metadata: 额外元数据
    - stop_reason: 停止原因（end_turn, tool_use, max_tokens 等）

状态: ✅ 完整实现
"""

from dataclasses import dataclass, field
from typing import Literal, Sequence, Optional

from .model_usage import ChatUsage
from ..utils import _get_timestamp, DictMixin
from ..message import (
    TextBlock,
    ToolUseBlock,
    ThinkingBlock,
    AudioBlock,
)
from ..types import JSONSerializableObject


@dataclass
class ChatResponse(DictMixin):
    """
    聊天模型响应数据类。
    
    封装 LLM API 调用的响应结果，包含生成的内容、
    使用量统计和元数据信息。
    
    使用 dataclass 实现，支持：
        - 自动生成 __init__、__repr__ 等方法
        - 通过 DictMixin 支持字典转换
        - 不可变语义（通过 frozen=True 可选）
    
    内容块类型：
        - TextBlock: 文本内容，如 {"type": "text", "text": "你好"}
        - ToolUseBlock: 工具调用，如 {"type": "tool_use", "name": "search", "input": {...}}
        - ThinkingBlock: 思考过程，如 {"type": "thinking", "thinking": "..."}
        - AudioBlock: 音频内容，如 {"type": "audio", "data": "..."}
    
    Example:
        >>> response = ChatResponse(
        ...     content=[{"type": "text", "text": "你好！有什么可以帮助你的？"}],
        ...     usage=ChatUsage(input_tokens=10, output_tokens=20, time=0.5)
        ... )
        >>> 
        >>> print(response.to_dict())
        >>> print(response.content[0]["text"])
    
    Note:
        - id 默认使用时间戳生成
        - created_at 默认使用当前时间
        - type 固定为 "chat"
    """

    content: Sequence[TextBlock | ToolUseBlock | ThinkingBlock | AudioBlock]
    """
    响应内容块列表。
    
    内容可以是以下类型的序列：
    - TextBlock: 文本内容
    - ToolUseBlock: 工具调用请求
    - ThinkingBlock: 思考过程
    - AudioBlock: 音频内容
    
    一个响应可能包含多个内容块，例如：
    - 先输出思考过程（ThinkingBlock）
    - 再输出文本回答（TextBlock）
    - 最后请求工具调用（ToolUseBlock）
    """

    id: str = field(default_factory=lambda: _get_timestamp(True))
    """
    响应唯一标识符。
    
    用于追踪和关联请求/响应。
    默认使用带毫秒的时间戳生成。
    """

    created_at: str = field(default_factory=_get_timestamp)
    """
    响应创建时间。
    
    ISO 8601 格式的时间字符串。
    默认使用当前时间。
    """

    type: Literal["chat"] = field(default_factory=lambda: "chat")
    """
    响应类型标识。
    
    固定为 "chat"，用于区分不同类型的响应。
    未来可能支持 "completion"、"embedding" 等类型。
    """

    usage: ChatUsage | None = field(default_factory=lambda: None)
    """
    Token 使用量统计。
    
    包含输入/输出 token 数量和响应时间。
    如果 API 不返回使用量信息，则为 None。
    """

    metadata: dict[str, JSONSerializableObject] | None = field(
        default_factory=lambda: None,
    )
    """
    响应元数据。
    
    可存储额外信息，如：
    - 模型版本
    - 请求 ID
    - 自定义标签
    - 其他提供商特定信息
    """
    
    stop_reason: Optional[str] = field(default_factory=lambda: None)
    """
    停止原因。
    
    表示模型停止生成的原因：
    - "end_turn": 正常结束，模型返回了完整回复
    - "tool_use": 模型请求调用工具
    - "max_tokens": 达到最大 token 限制
    - "stop_sequence": 遇到停止序列
    
    不同 API 使用不同的字段名：
    - Claude: stop_reason
    - OpenAI/GLM/DeepSeek: finish_reason
    
    本字段统一存储这些值。
    """
    
    finish_reason: Optional[str] = field(default_factory=lambda: None)
    """
    完成原因（OpenAI 格式）。
    
    与 stop_reason 含义相同，用于兼容 OpenAI 格式。
    """
    
    def get_text_content(self) -> str:
        """
        获取文本内容。
        
        从内容块中提取所有文本内容并合并。
        
        Returns:
            str: 合并后的文本内容。
        """
        texts = []
        for block in self.content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    texts.append(block.get("text", ""))
            elif hasattr(block, 'text'):
                texts.append(block.text)
        return "".join(texts)
