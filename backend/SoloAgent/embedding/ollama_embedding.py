# -*- coding: utf-8 -*-
"""
SoloEngine : Ollama文本嵌入模型模块

@file ollama_embedding.py
@description 提供Ollama文本嵌入模型实现
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供Ollama文本嵌入模型，包括：
    - OllamaTextEmbedding: Ollama文本嵌入模型
    - 支持本地Ollama服务的嵌入生成
    - 支持缓存功能

依赖:
    - datetime: 日期时间
    - typing: 类型提示
    - ollama: Ollama Python客户端
    - .embedding_response: 嵌入响应
    - .embedding_usage: 嵌入使用统计
    - .cache_base: 缓存基类
    - .embedding_base: 嵌入模型基类
    - ..message: 消息类型

使用示例:
    - from SoloAgent.embedding import OllamaTextEmbedding
    - model = OllamaTextEmbedding(model_name="nomic-embed-text", dimensions=768)
    - response = await model(["文本1", "文本2"])
"""

from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Any, Dict

from .embedding_response import EmbeddingResponse
from .embedding_usage import EmbeddingUsage
from .cache_base import EmbeddingCacheBase
from .embedding_base import EmbeddingModelBase
from ..message import TextBlock


class OllamaTextEmbedding(EmbeddingModelBase):
    """
    Ollama文本嵌入模型

    职责:
        - 实现Ollama本地模型的嵌入生成
        - 支持文本输入
        - 支持缓存功能

    属性:
        supported_modalities: 支持的模态列表，仅支持文本
        client: Ollama异步客户端
        embedding_cache: 嵌入缓存

    示例:
        >>> model = OllamaTextEmbedding(
        ...     model_name="nomic-embed-text",
        ...     dimensions=768,
        ...     host="http://localhost:11434"
        ... )
        >>> response = await model(["你好", "世界"])
    """

    supported_modalities: list[str] = ["text"]
    """仅支持文本输入"""

    def __init__(
        self,
        model_name: str,
        dimensions: int,
        host: str | None = None,
        embedding_cache: EmbeddingCacheBase | None = None,
        **kwargs: Any,
    ) -> None:
        """
        初始化Ollama文本嵌入模型

        Args:
            model_name: 嵌入模型名称
            dimensions: 嵌入向量维度
            host: Ollama API主机URL
            embedding_cache: 嵌入缓存实例
            **kwargs: 额外的关键字参数

        示例:
            >>> model = OllamaTextEmbedding(
            ...     model_name="nomic-embed-text",
            ...     dimensions=768
            ... )
        """
        import ollama

        super().__init__(model_name, dimensions)

        self.client = ollama.AsyncClient(host=host, **kwargs)
        self.embedding_cache = embedding_cache

    def _build_embedding_kwargs(
        self,
        gather_text: List[str],
        kwargs: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Ollama 版调用参数组装（R11：基类公共 __call__ 骨架的差异钩子）。

        Args:
            gather_text: 清理后的输入文本列表
            kwargs: 调用方额外参数

        Returns:
            Dict[str, Any]: Ollama embed API 调用参数
        """
        return {
            "input": gather_text,
            "model": self.model_name,
            "dimensions": self.dimensions,
            **kwargs,
        }

    async def _call_embedding_api(self, call_kwargs: Dict[str, Any]):
        """
        Ollama 版嵌入 API 调用（R11：差异钩子，embed）。

        Args:
            call_kwargs: 组装后的调用参数

        Returns:
            tuple: (embeddings 列表, None——Ollama 不提供 token 用量)
        """
        response = await self.client.embed(**call_kwargs)
        return response.embeddings, None