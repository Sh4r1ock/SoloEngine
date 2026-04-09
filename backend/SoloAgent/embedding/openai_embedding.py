# -*- coding: utf-8 -*-
"""
SoloEngine : OpenAI文本嵌入模型模块

@file openai_embedding.py
@description 提供OpenAI文本嵌入模型实现
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供OpenAI文本嵌入模型，包括：
    - OpenAITextEmbedding: OpenAI文本嵌入模型
    - 支持OpenAI API的嵌入生成
    - 支持批量处理和缓存功能

依赖:
    - datetime: 日期时间
    - typing: 类型提示
    - openai: OpenAI Python客户端
    - .embedding_response: 嵌入响应
    - .embedding_usage: 嵌入使用统计
    - .cache_base: 缓存基类
    - .embedding_base: 嵌入模型基类
    - ..message: 消息类型

使用示例:
    - from SoloAgent.embedding import OpenAITextEmbedding
    - model = OpenAITextEmbedding(api_key="your_key", model_name="text-embedding-3-small")
    - response = await model(["文本1", "文本2"])
"""

from datetime import datetime
from typing import Any, List

from .embedding_response import EmbeddingResponse
from .embedding_usage import EmbeddingUsage
from .cache_base import EmbeddingCacheBase
from .embedding_base import EmbeddingModelBase
from ..message import TextBlock


class OpenAITextEmbedding(EmbeddingModelBase):
    """
    OpenAI文本嵌入模型

    职责:
        - 实现OpenAI API的嵌入生成
        - 支持文本输入
        - 支持批量处理
        - 支持缓存功能

    属性:
        supported_modalities: 支持的模态列表，仅支持文本
        client: OpenAI异步客户端
        embedding_cache: 嵌入缓存
        batch_size: 批量大小
        max_tokens_per_batch: 每批次最大Token数

    示例:
        >>> model = OpenAITextEmbedding(
        ...     api_key="your_key",
        ...     model_name="text-embedding-3-small",
        ...     dimensions=1536
        ... )
        >>> response = await model(["你好", "世界"])
    """

    supported_modalities: list[str] = ["text"]
    """仅支持文本输入"""

    def __init__(
        self,
        api_key: str,
        model_name: str,
        dimensions: int = 1024,
        embedding_cache: EmbeddingCacheBase | None = None,
        batch_size: int = 2048,
        max_tokens_per_batch: int = 8191,
        **kwargs: Any,
    ) -> None:
        """
        初始化OpenAI文本嵌入模型

        Args:
            api_key: OpenAI API密钥
            model_name: 嵌入模型名称
            dimensions: 嵌入向量维度
            embedding_cache: 嵌入缓存实例
            batch_size: 单次API调用的最大文本数
            max_tokens_per_batch: 每批次最大Token数（OpenAI限制）
            **kwargs: 额外的关键字参数

        示例:
            >>> model = OpenAITextEmbedding(
            ...     api_key="your_key",
            ...     model_name="text-embedding-3-small"
            ... )
        """
        import openai

        super().__init__(model_name, dimensions)

        self.client = openai.AsyncClient(api_key=api_key, **kwargs)
        self.embedding_cache = embedding_cache
        self.batch_size = batch_size
        self.max_tokens_per_batch = max_tokens_per_batch

    async def __call__(
        self,
        text: List[str | TextBlock],
        **kwargs: Any,
    ) -> EmbeddingResponse:
        """
        调用OpenAI嵌入API

        Args:
            text: 输入文本列表
            **kwargs: 额外的关键字参数

        Returns:
            EmbeddingResponse: 嵌入响应

        Raises:
            ValueError: 输入格式不支持时抛出

        示例:
            >>> response = await model(["文本1", "文本2"])
        """
        gather_text = []
        for _ in text:
            if isinstance(_, dict) and "text" in _:
                gather_text.append(_["text"])
            elif isinstance(_, str):
                gather_text.append(_)
            else:
                raise ValueError(
                    "Input text must be a list of strings or TextBlock dicts.",
                )

        kwargs = {
            "input": gather_text,
            "model": self.model_name,
            "dimensions": self.dimensions,
            "encoding_format": "float",
            **kwargs,
        }

        if self.embedding_cache:
            cached_embeddings = await self.embedding_cache.retrieve(
                identifier=kwargs,
            )
            if cached_embeddings:
                return EmbeddingResponse(
                    embeddings=cached_embeddings,
                    usage=EmbeddingUsage(
                        tokens=0,
                        time=0,
                    ),
                    source="cache",
                )

        start_time = datetime.now()
        response = await self.client.embeddings.create(**kwargs)
        time = (datetime.now() - start_time).total_seconds()

        if self.embedding_cache:
            await self.embedding_cache.store(
                identifier=kwargs,
                embeddings=[_.embedding for _ in response.data],
            )

        return EmbeddingResponse(
            embeddings=[_.embedding for _ in response.data],
            usage=EmbeddingUsage(
                tokens=response.usage.total_tokens,
                time=time,
            ),
        )