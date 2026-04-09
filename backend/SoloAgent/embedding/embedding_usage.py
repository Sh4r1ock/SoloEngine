# -*- coding: utf-8 -*-
"""
SoloEngine : 嵌入使用统计模块

@file embedding_usage.py
@description 提供嵌入模型使用统计数据类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供嵌入使用统计，包括：
    - EmbeddingUsage: 嵌入使用统计数据类
    - 存储API调用时间和Token使用量

依赖:
    - dataclasses: 数据类
    - typing: 类型提示
    - ..utils.mixin: 混入类

使用示例:
    - from SoloAgent.embedding import EmbeddingUsage
    - usage = EmbeddingUsage(time=0.5, tokens=100)
"""

from dataclasses import dataclass, field
from typing import Literal

from ..utils.mixin import DictMixin


@dataclass
class EmbeddingUsage(DictMixin):
    """
    嵌入使用统计数据类

    职责:
        - 存储嵌入API调用的时间统计
        - 存储Token使用量

    属性:
        time: 调用耗时（秒）
        tokens: Token使用量
        type: 使用类型，固定为"embedding"

    示例:
        >>> usage = EmbeddingUsage(time=0.5, tokens=100)
        >>> print(usage.time)  # 0.5
    """

    time: float
    """调用耗时（秒）"""

    tokens: int | None = field(default_factory=lambda: None)
    """Token使用量"""

    type: Literal["embedding"] = field(default_factory=lambda: "embedding")
    """使用类型，固定为'embedding'"""