# -*- coding: utf-8 -*-
"""
SoloEngine : 文件嵌入缓存模块

@file file_cache.py
@description 提供基于文件的嵌入缓存实现
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供文件嵌入缓存，包括：
    - FileEmbeddingCache: 文件嵌入缓存类
    - 将嵌入向量存储在二进制文件中
    - 支持缓存大小和文件数量限制
    - 自动清理过期缓存

依赖:
    - hashlib: 哈希计算
    - json: JSON处理
    - os: 操作系统接口
    - typing: 类型提示
    - numpy: 数值计算
    - .cache_base: 缓存基类
    - ..utils.logging: 日志记录
    - ..types: 类型定义

使用示例:
    - from SoloAgent.embedding import FileEmbeddingCache
    - cache = FileEmbeddingCache(cache_dir="./cache")
    - await cache.store(embeddings, "doc-123")
    - embeddings = await cache.retrieve("doc-123")
"""

import hashlib
import json
import os
from typing import Any, List

import numpy as np

from .cache_base import EmbeddingCacheBase
from ..utils.logging import logger
from ..types import (
    Embedding,
    JSONSerializableObject,
)


class FileEmbeddingCache(EmbeddingCacheBase):
    """
    文件嵌入缓存类

    职责:
        - 将嵌入向量存储在二进制文件中
        - 管理缓存目录
        - 支持缓存大小和文件数量限制
        - 自动清理过期缓存

    属性:
        _cache_dir: 缓存目录路径
        max_file_number: 最大文件数量
        max_cache_size: 最大缓存大小（MB）

    示例:
        >>> cache = FileEmbeddingCache(cache_dir="./cache", max_file_number=1000)
        >>> await cache.store(embeddings, "doc-123")
    """

    def __init__(
        self,
        cache_dir: str = "./.cache/embeddings",
        max_file_number: int | None = None,
        max_cache_size: int | None = None,
    ) -> None:
        """
        初始化文件嵌入缓存类

        Args:
            cache_dir: 缓存目录，默认为"./.cache/embeddings"
            max_file_number: 最大文件数量，超出将删除最旧的文件
            max_cache_size: 最大缓存大小（MB），超出将删除最旧的文件

        示例:
            >>> cache = FileEmbeddingCache(cache_dir="./cache")
        """
        self._cache_dir = os.path.abspath(cache_dir)
        self.max_file_number = max_file_number
        self.max_cache_size = max_cache_size

    @property
    def cache_dir(self) -> str:
        """
        缓存目录

        Returns:
            str: 缓存目录路径

        示例:
            >>> print(cache.cache_dir)
        """
        if not os.path.exists(self._cache_dir):
            os.makedirs(self._cache_dir, exist_ok=True)
        return self._cache_dir

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
            identifier: 标识符，用于生成文件名，需要可JSON序列化
            overwrite: 是否覆盖已存在的嵌入
            **kwargs: 额外的关键字参数

        示例:
            >>> await cache.store(embeddings, "doc-123", overwrite=True)
        """
        filename = self._get_filename(identifier)
        path_file = os.path.join(self.cache_dir, filename)

        if os.path.exists(path_file):
            if not os.path.isfile(path_file):
                raise RuntimeError(
                    f"Path {path_file} exists but is not a file.",
                )

            if overwrite:
                np.save(path_file, embeddings)
                await self._maintain_cache_dir()
        else:
            np.save(path_file, embeddings)
            await self._maintain_cache_dir()

    async def retrieve(
        self,
        identifier: JSONSerializableObject,
    ) -> List[Embedding] | None:
        """
        检索嵌入向量

        Args:
            identifier: 标识符，用于生成文件名

        Returns:
            List[Embedding] | None: 嵌入向量列表，如果未找到则返回None

        示例:
            >>> embeddings = await cache.retrieve("doc-123")
        """
        filename = self._get_filename(identifier)
        path_file = os.path.join(self.cache_dir, filename)

        if os.path.exists(path_file):
            return np.load(os.path.join(self.cache_dir, filename)).tolist()
        return None

    async def remove(self, identifier: JSONSerializableObject) -> None:
        """
        删除嵌入向量

        Args:
            identifier: 标识符

        Raises:
            FileNotFoundError: 文件不存在时抛出

        示例:
            >>> await cache.remove("doc-123")
        """
        filename = self._get_filename(identifier)
        path_file = os.path.join(self.cache_dir, filename)

        if os.path.exists(path_file):
            os.remove(path_file)
        else:
            raise FileNotFoundError(f"File {path_file} does not exist.")

    async def clear(self) -> None:
        """
        清空缓存目录

        示例:
            >>> await cache.clear()
        """
        for filename in os.listdir(self.cache_dir):
            if filename.endswith(".npy"):
                os.remove(os.path.join(self.cache_dir, filename))

    def _get_cache_size(self) -> float:
        """
        获取缓存目录的当前大小

        Returns:
            float: 缓存大小（MB）

        示例:
            >>> size = cache._get_cache_size()
        """
        total_size = 0
        for filename in os.listdir(self.cache_dir):
            if filename.endswith(".npy"):
                path_file = os.path.join(self.cache_dir, filename)
                if os.path.isfile(path_file):
                    total_size += os.path.getsize(path_file)
        return total_size / (1024.0 * 1024.0)

    @staticmethod
    def _get_filename(identifier: JSONSerializableObject) -> str:
        """
        根据标识符生成文件名

        Args:
            identifier: 标识符

        Returns:
            str: 生成的文件名

        示例:
            >>> filename = cache._get_filename("doc-123")
        """
        json_str = json.dumps(identifier, ensure_ascii=False)
        return hashlib.sha256(json_str.encode("utf-8")).hexdigest() + ".npy"

    async def _maintain_cache_dir(self) -> None:
        """
        维护缓存目录

        如果文件数量或缓存大小超过限制，删除最旧的文件

        示例:
            >>> await cache._maintain_cache_dir()
        """
        files = [
            (_.name, _.stat().st_mtime)
            for _ in os.scandir(self.cache_dir)
            if _.is_file() and _.name.endswith(".npy")
        ]
        files.sort(key=lambda x: x[1])

        if self.max_file_number and len(files) > self.max_file_number:
            for file_name, _ in files[: 0 - self.max_file_number]:
                os.remove(os.path.join(self.cache_dir, file_name))
                logger.info(
                    "Remove cached embedding file %s for limited number "
                    "of files (%d).",
                    file_name,
                    self.max_file_number,
                )
            files = files[0 - self.max_file_number :]

        if (
            self.max_cache_size is not None
            and self._get_cache_size() > self.max_cache_size
        ):
            removed_files = []
            for filename, _ in files:
                os.remove(os.path.join(self.cache_dir, filename))
                removed_files.append(filename)
                if self._get_cache_size() <= self.max_cache_size:
                    break

            if removed_files:
                logger.info(
                    "Remove %d cached embedding file(s) for limited "
                    "cache size (%d MB).",
                    len(removed_files),
                    self.max_cache_size,
                )