# -*- coding: utf-8 -*-
"""
SoloEngine : 嵌入缓存基类模块

@file cache_base.py
@description 提供嵌入缓存基类定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供嵌入缓存基类，包括：
    - EmbeddingCacheBase: 嵌入缓存基类
    - 定义嵌入存储、检索、删除接口
    - 支持缓存清理

依赖:
    - abc: 抽象基类
    - typing: 类型提示
    - ..types: 类型定义

使用示例:
    - from SoloAgent.embedding import EmbeddingCacheBase
    - class MyCache(EmbeddingCacheBase):
    -     async def store(self, embeddings, identifier, overwrite=False, **kwargs):
    -         pass
"""

from abc import abstractmethod
from typing import List, Any

from ..types import (
    JSONSerializableObject,
    Embedding,
)


class EmbeddingCacheBase:
    """
    嵌入缓存基类

    职责:
        - 定义嵌入存储接口
        - 定义嵌入检索接口
        - 定义嵌入删除接口
        - 定义缓存清理接口

    属性:
        无

    示例:
        >>> class MyCache(EmbeddingCacheBase):
        ...     async def store(self, embeddings, identifier, overwrite=False, **kwargs):
        ...         pass
        ...     async def retrieve(self, identifier):
        ...         return None
        ...     async def remove(self, identifier):
        ...         pass
        ...     async def clear(self):
        ...         pass
    """

    @abstractmethod
    async def store(
        self,
        embeddings: List[Embedding],
        identifier: JSONSerializableObject,
        overwrite: bool = False,
        **kwargs: Any,
    ) -> None:
        """
        存储嵌入向量

        Args:
            embeddings: 要存储的嵌入向量列表
            identifier: 标识符，用于区分不同的嵌入
            overwrite: 是否覆盖已存在的嵌入
            **kwargs: 额外的关键字参数

        示例:
            >>> await cache.store(embeddings, "doc-123", overwrite=True)
        """

    @abstractmethod
    async def retrieve(
        self,
        identifier: JSONSerializableObject,
    ) -> List[Embedding] | None:
        """
        检索嵌入向量

        Args:
            identifier: 标识符

        Returns:
            List[Embedding] | None: 嵌入向量列表，如果未找到则返回None

        示例:
            >>> embeddings = await cache.retrieve("doc-123")
        """

    @abstractmethod
    async def remove(
        self,
        identifier: JSONSerializableObject,
    ) -> None:
        """
        删除嵌入向量

        Args:
            identifier: 标识符

        示例:
            >>> await cache.remove("doc-123")
        """

    @abstractmethod
    async def clear(self) -> None:
        """
        清空所有缓存的嵌入向量

        示例:
            >>> await cache.clear()
        """