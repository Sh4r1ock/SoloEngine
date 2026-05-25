# -*- coding: utf-8 -*-
"""
SoloEngine : 模型响应模块，定义聊天模型的响应数据结构

@file model_response.py
@description 定义聊天模型的响应数据结构
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供统一的模型响应数据结构定义，包括：
    - ChatResponse: 聊天响应数据类
    - 支持多种内容块类型（文本、工具调用、思考、音频）
    - 提供使用量统计和元数据存储

依赖:
    - json: JSON处理
    - dataclasses: 数据类
    - typing: 类型提示
    - .model_usage: 使用统计
    - ..utils: 工具函数
    - ..message: 消息类型
    - ..types: 类型定义

使用示例:
    - from SoloAgent.model import ChatResponse
    - response = ChatResponse(content=[{"type": "text", "text": "Hello"}])
"""

import json
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
    聊天模型响应数据类
    
    职责:
        - 封装 LLM API 调用的响应结果
        - 包含生成的内容、使用量统计和元数据信息
        - 支持多种内容块类型
    
    属性:
        content: 响应内容块列表
        id: 响应唯一标识符
        created_at: 响应创建时间
        type: 响应类型
        usage: Token使用量统计
        metadata: 额外元数据
        stop_reason: 停止原因
    
    示例:
        >>> response = ChatResponse(
        ...     content=[{"type": "text", "text": "你好！"}],
        ...     usage=ChatUsage(input_tokens=10, output_tokens=20, time=0.5)
        ... )
        >>> print(response.to_dict())
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
                elif block.get("type") == "content":
                    content = block.get("content", "")
                    texts.append(content if isinstance(content, str) else str(content))
            elif hasattr(block, 'text'):
                texts.append(block.text)
        return "".join(texts)
    
    def get_reasoning_content(self) -> str:
        """
        获取思考内容（OpenAI 格式）。
        
        从内容块中提取所有思考内容并合并。
        对应 OpenAI API 的 reasoning_content 字段。
        
        Returns:
            str: 合并后的思考内容。
        """
        reasoning = []
        for block in self.content:
            if isinstance(block, dict):
                if block.get("type") == "thinking":
                    reasoning.append(block.get("thinking", ""))
                elif block.get("type") == "reasoning_content":
                    rc = block.get("reasoning_content", block.get("content", ""))
                    reasoning.append(rc if isinstance(rc, str) else str(rc))
            elif hasattr(block, 'thinking'):
                reasoning.append(block.thinking)
        return "".join(reasoning)
    
    def to_openai_message(self) -> dict:
        """
        转换为 OpenAI 格式的消息对象。
        
        Returns:
            dict: OpenAI 格式的消息，包含 role, content, reasoning_content, tool_calls 字段
        """
        reasoning = self.get_reasoning_content()
        has_thinking_blocks = any(
            (isinstance(b, dict) and b.get("type") in ("thinking", "reasoning_content"))
            or hasattr(b, 'thinking')
            for b in self.content
        )
        msg = {
            "role": "assistant",
            "content": self.get_text_content(),
            "reasoning_content": reasoning if reasoning else ("" if has_thinking_blocks else None)
        }
        
        tool_calls = []
        for block in self.content:
            # 支持 dict 和 TypedDict 对象
            if isinstance(block, dict):
                block_type = block.get("type")
            elif hasattr(block, "__getitem__"):
                try:
                    block_type = block["type"] if "type" in block else None
                except (KeyError, TypeError):
                    block_type = None
            else:
                block_type = None
            
            if block_type == "tool_use":
                if isinstance(block, dict):
                    tool_id = block.get("id", "")
                    tool_name = block.get("name", "")
                    tool_input = block.get("input", {})
                else:
                    tool_id = block.get("id", "") if hasattr(block, "get") else (block["id"] if "id" in block else "")
                    tool_name = block.get("name", "") if hasattr(block, "get") else (block["name"] if "name" in block else "")
                    tool_input = block.get("input", {}) if hasattr(block, "get") else (block["input"] if "input" in block else {})
                if isinstance(tool_input, str):
                    arguments_str = tool_input
                else:
                    try:
                        arguments_str = json.dumps(tool_input, ensure_ascii=False)
                    except:
                        arguments_str = ""
                tool_calls.append({
                    "id": tool_id,
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": arguments_str
                    }
                })
            elif block_type == "tool_calls":
                if isinstance(block, dict):
                    tcs = block.get("tool_calls", [])
                else:
                    tcs = block.get("tool_calls", []) if hasattr(block, "get") else (block["tool_calls"] if "tool_calls" in block else [])
                for tc in tcs:
                    if isinstance(tc, dict):
                        tc_id = tc.get("id", "")
                        if tc_id and tc_id not in [t.get("id", "") for t in tool_calls]:
                            clean_tc = {
                                "id": tc_id,
                                "type": tc.get("type", "function"),
                                "function": tc.get("function", {})
                            }
                            if not isinstance(clean_tc["function"], dict):
                                clean_tc["function"] = {"name": str(clean_tc["function"]), "arguments": ""}
                            if "arguments" not in clean_tc["function"]:
                                clean_tc["function"]["arguments"] = ""
                            tool_calls.append(clean_tc)
        
        if tool_calls:
            msg["tool_calls"] = tool_calls
        
        return msg
    
    def to_delta(self) -> dict:
        """
        转换为 OpenAI 流式响应的 delta 格式。
        
        这是流式输出的标准格式，用于 stream_callback。
        将 content 列表中的各个 block 转换为 delta 对象。
        
        Returns:
            dict: OpenAI delta 格式。例如：
                - {"content": "文本内容"} - 文本增量
                - {"reasoning_content": "思考内容"} - 思考增量
                - {"tool_calls": [...]} - 工具调用增量
                - {} - 空块（无内容）
        
        Note:
            如果同时包含多种类型，会返回包含多个字段的对象。
            对于多个 tool_use 块，会合并为一个 tool_calls 数组。
        """
        delta = {}
        tool_calls_list = []
        
        for block in self.content:
            # 支持 dict 和 TypedDict 对象
            if isinstance(block, dict):
                block_type = block.get("type")
            elif hasattr(block, "__getitem__"):
                try:
                    block_type = block["type"] if "type" in block else None
                except (KeyError, TypeError):
                    block_type = None
            else:
                block_type = None
            
            if block_type == "text":
                if isinstance(block, dict):
                    text = block.get("text", "")
                else:
                    text = block.get("text", "") if hasattr(block, "get") else (block["text"] if "text" in block else "")
                if text:
                    delta["content"] = text
            elif block_type == "thinking":
                if isinstance(block, dict):
                    thinking = block.get("thinking", "")
                else:
                    thinking = block.get("thinking", "") if hasattr(block, "get") else (block["thinking"] if "thinking" in block else "")
                if thinking:
                    delta["reasoning_content"] = thinking
            elif block_type == "tool_use":
                if isinstance(block, dict):
                    tool_id = block.get("id", "")
                    tool_name = block.get("name", "")
                    tool_input = block.get("input", {})
                else:
                    tool_id = block.get("id", "") if hasattr(block, "get") else (block["id"] if "id" in block else "")
                    tool_name = block.get("name", "") if hasattr(block, "get") else (block["name"] if "name" in block else "")
                    tool_input = block.get("input", {}) if hasattr(block, "get") else (block["input"] if "input" in block else {})
                if isinstance(tool_input, str):
                    arguments_str = tool_input
                else:
                    try:
                        arguments_str = json.dumps(tool_input, ensure_ascii=False)
                    except:
                        arguments_str = ""
                tool_calls_list.append({
                    "index": len(tool_calls_list),
                    "id": tool_id,
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": arguments_str
                    }
                })
            elif block_type == "tool_calls":
                # 流式格式的 tool_calls 块
                if isinstance(block, dict):
                    for tc in block.get("tool_calls", []):
                        tool_calls_list.append(tc)
                else:
                    tcs = block.get("tool_calls", []) if hasattr(block, "get") else (block["tool_calls"] if "tool_calls" in block else [])
                    for tc in tcs:
                        tool_calls_list.append(tc)
        
        if tool_calls_list:
            delta["tool_calls"] = tool_calls_list
        
        return delta
