# -*- coding: utf-8 -*-
"""
SoloEngine : 模型使用量统计模块，定义聊天模型API调用的使用量统计

@file model_usage.py
@description 定义聊天模型 API 调用的使用量统计
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供模型使用量统计功能，包括：
    - ChatUsage: 聊天模型使用量统计数据类
    - 记录 API 调用的 Token 使用量
    - 统计响应时间
    - 支持成本计算和分析

依赖:
    - dataclasses: 数据类
    - typing: 类型提示
    - ..utils: 工具类

使用示例:
    - from SoloAgent.model import ChatUsage
    - usage = ChatUsage(input_tokens=100, output_tokens=50, time=1.5)
"""

from dataclasses import dataclass, field
from typing import Literal

from ..utils import DictMixin


@dataclass
class ChatUsage(DictMixin):
    """
    聊天模型使用量统计数据类
    
    职责:
        - 记录单次 API 调用的资源使用情况
        - 包括 Token 数量和响应时间
        - 支持成本计算、性能监控和使用量分析
    
    属性:
        input_tokens: 输入 Token 数量
        output_tokens: 输出 Token 数量
        time: 响应时间（秒）
        type: 使用类型
    
    示例:
        >>> usage = ChatUsage(
        ...     input_tokens=100,
        ...     output_tokens=50,
        ...     time=1.5
        ... )
        >>> print(f"总 Token: {usage.total_tokens}")
    
    Note:
        - time 单位为秒
        - Token 数量由各提供商 API 返回
        - 部分本地模型可能不提供 Token 统计
    """

    input_tokens: int
    """
    输入 Token 数量。
    
    包括提示词、系统消息、对话历史等所有输入内容。
    用于计算输入成本。
    """

    output_tokens: int
    """
    输出 Token 数量。
    
    模型生成的所有内容，包括文本、工具调用等。
    用于计算输出成本。
    """

    time: float
    """
    API 响应时间（秒）。

    从发送请求到收到完整响应的时间。
    用于性能监控和优化。
    """

    duration_ms: int = 0
    """
    调用时长（毫秒）。

    与 time（秒）区分：time 用于响应时间监控，duration_ms 用于累计耗时统计。
    避免 float→int 转换损失精度。
    """

    system_prompt_token: int = 0
    """
    system 提示词 token 数（tiktoken 估算累加值）。

    reply 周期内累加的 system 消息 token 数。
    """

    user_prompt_token: int = 0
    """
    user 输入 token 数（tiktoken 估算累加值）。

    reply 周期内累加的 user 消息 token 数。
    """

    assistant_prompt_token: int = 0
    """
    历史 assistant 消息 token 数（tiktoken 估算累加值）。

    reply 周期内累加的 assistant 消息 token 数。
    """

    token_usage_history: list = field(default_factory=list)
    """
    每次 LLM API 调用的 token 消耗明细列表。

    每个 entry 包含：iteration, timestamp, system_prompt_token,
    user_prompt_token, assistant_prompt_token, prompt_tokens,
    completion_tokens, total_tokens, duration_ms, finish_reason。
    """

    type: Literal["chat"] = field(default_factory=lambda: "chat")
    """
    使用量类型标识。
    
    固定为 "chat"，用于区分不同类型的使用量统计。
    未来可能支持 "completion"、"embedding" 等类型。
    """
