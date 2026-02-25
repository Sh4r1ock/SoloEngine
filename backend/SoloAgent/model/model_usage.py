# -*- coding: utf-8 -*-
"""
模型使用量统计模块。

@file model_usage.py
@description 定义聊天模型 API 调用的使用量统计
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 记录 API 调用的 Token 使用量
- 统计响应时间
- 支持成本计算和分析

统计指标：
    - input_tokens: 输入 Token 数量
    - output_tokens: 输出 Token 数量
    - time: 响应时间（秒）

用途：
    - 成本监控和预算控制
    - 性能分析和优化
    - 使用量报告

状态: ✅ 完整实现
"""

from dataclasses import dataclass, field
from typing import Literal

from ..utils import DictMixin


@dataclass
class ChatUsage(DictMixin):
    """
    聊天模型使用量统计数据类。
    
    记录单次 API 调用的资源使用情况，包括 Token 数量和响应时间。
    这些数据可用于成本计算、性能监控和使用量分析。
    
    使用 dataclass 实现，支持：
        - 自动生成 __init__、__repr__ 等方法
        - 通过 DictMixin 支持字典转换
    
    Token 计费说明：
        - input_tokens: 提示词和对话历史消耗的 Token
        - output_tokens: 模型生成内容消耗的 Token
        - 通常输出 Token 价格高于输入 Token
    
    Example:
        >>> usage = ChatUsage(
        ...     input_tokens=100,
        ...     output_tokens=50,
        ...     time=1.5
        ... )
        >>> 
        >>> total_tokens = usage.input_tokens + usage.output_tokens
        >>> print(f"总 Token: {total_tokens}, 耗时: {usage.time}s")
    
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

    type: Literal["chat"] = field(default_factory=lambda: "chat")
    """
    使用量类型标识。
    
    固定为 "chat"，用于区分不同类型的使用量统计。
    未来可能支持 "completion"、"embedding" 等类型。
    """
