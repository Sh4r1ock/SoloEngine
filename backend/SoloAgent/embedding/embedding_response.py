# -*- coding: utf-8 -*-
"""
SoloEngine : 嵌入响应模块

@file embedding_response.py
@description 提供嵌入响应数据类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供嵌入响应数据类，包括：
    - EmbeddingResponse: 嵌入响应数据类
    - 存储嵌入向量列表
    - 存储使用统计信息
    - 支持缓存标记

依赖:
    - dataclasses: 数据类
    - typing: 类型提示
    - .embedding_usage: 嵌入使用统计
    - ..utils.common: 工具函数
    - ..utils.mixin: 混入类
    - ..types: 类型定义

使用示例:
    - from SoloAgent.embedding import EmbeddingResponse
    - response = EmbeddingResponse(embeddings=[[0.1, 0.2, ...]])
"""

from dataclasses import dataclass, field
from typing import Literal, List

from .embedding_usage import EmbeddingUsage
from ..utils.common import _get_timestamp
from ..utils.mixin import DictMixin
from ..types import Embedding


@dataclass
class EmbeddingResponse(DictMixin):
    """
    嵌入响应数据类

    职责:
        - 存储嵌入向量列表
        - 存储响应元数据
        - 存储使用统计信息
        - 标记数据来源（缓存或API）

    属性:
        embeddings: 嵌入向量列表
        id: 响应唯一标识
        created_at: 创建时间戳
        type: 响应类型，固定为"embedding"
        usage: 使用统计信息
        source: 数据来源，"cache"或"api"

    示例:
        >>> response = EmbeddingResponse(embeddings=[[0.1, 0.2, 0.3]])
        >>> print(len(response.embeddings))  # 1
    """

    embeddings: List[Embedding]
    """嵌入向量列表"""

    id: str = field(default_factory=lambda: _get_timestamp(True))
    """响应唯一标识"""

    created_at: str = field(default_factory=_get_timestamp)
    """创建时间戳"""

    type: Literal["embedding"] = field(default_factory=lambda: "embedding")
    """响应类型，固定为'embedding'"""

    usage: EmbeddingUsage | None = field(default_factory=lambda: None)
    """使用统计信息"""

    source: Literal["cache", "api"] = field(default_factory=lambda: "api")
    """数据来源，'cache'或'api'"""