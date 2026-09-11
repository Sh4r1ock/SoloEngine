# -*- coding: utf-8 -*-
"""
SoloEngine : 嵌入模型基类模块

@file embedding_base.py
@description 定义嵌入模型的抽象基类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供嵌入模型基类，包括：
    - EmbeddingModelBase: 嵌入模型基类
    - 定义嵌入模型的统一接口
    - 支持多种模态的嵌入（文本、图像、视频）
    - 提供模型元数据管理

嵌入模型用途：
    - 向量相似度搜索
    - 语义检索
    - 聚类分析
    - 特征提取

支持的模态：
    - text: 文本嵌入
    - image: 图像嵌入
    - video: 视频嵌入

依赖:
    - typing: 类型提示
    - .embedding_response: 嵌入响应

使用示例:
    - from SoloAgent.embedding import OpenAITextEmbedding
    - model = OpenAITextEmbedding(model_name="text-embedding-3-small")
    - response = await model(["你好", "世界"])
"""

from typing import Any, List, Dict

from .embedding_response import EmbeddingResponse
from .embedding_usage import EmbeddingUsage


class EmbeddingModelBase:
    """
    嵌入模型抽象基类

    职责:
        - 定义嵌入生成的统一接口
        - 管理模型元数据
        - 支持多种模态

    属性:
        model_name: 嵌入模型名称
        supported_modalities: 支持的数据模态列表
        dimensions: 嵌入向量维度

    示例:
        >>> from SoloAgent.embedding import OpenAITextEmbedding
        >>> model = OpenAITextEmbedding(
        ...     model_name="text-embedding-3-small",
        ...     dimensions=1536
        ... )
        >>> response = await model(["你好", "世界"])
        >>> print(len(response.embeddings))  # 2
    """

    model_name: str
    """嵌入模型名称，如 'text-embedding-3-small', 'nomic-embed-text'"""

    supported_modalities: list[str]
    """
    支持的数据模态列表。
    
    可能的值：
        - "text": 文本嵌入
        - "image": 图像嵌入
        - "video": 视频嵌入
        - "audio": 音频嵌入
    """

    dimensions: int
    """嵌入向量的维度，如 1536, 768, 384"""

    def __init__(
        self,
        model_name: str,
        dimensions: int,
    ) -> None:
        """
        初始化嵌入模型基类

        Args:
            model_name: 嵌入模型名称，如'text-embedding-3-small', 'nomic-embed-text'
            dimensions: 嵌入向量维度，常见值：1536（OpenAI）、768（BERT）、384（MiniLM）

        示例:
            >>> model = EmbeddingModelBase("text-embedding-3-small", 1536)
        """
        self.model_name = model_name
        self.dimensions = dimensions

    async def __call__(
        self,
        text: List[Any],
        **kwargs: Any,
    ) -> EmbeddingResponse:
        """
        公共嵌入调用骨架（R11：openai/ollama __call__ 同构逻辑统一收拢到基类）。

        流程：输入清理 → 组装调用参数（子类 _build_embedding_kwargs 差异）→
        缓存检索 → 调用 API（子类 _call_embedding_api 差异）→ 缓存写入 →
        组装 EmbeddingResponse。子类只实现两个差异钩子，不再各自重复本骨架。

        Args:
            text: 输入文本列表
            **kwargs: 额外的关键字参数

        Returns:
            EmbeddingResponse: 嵌入响应

        Raises:
            ValueError: 输入格式不支持时抛出

        示例:
            >>> response = await model(["你好", "世界"])
        """
        from datetime import datetime
        from zoneinfo import ZoneInfo
        from SoloAgent.config import settings

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

        call_kwargs = self._build_embedding_kwargs(gather_text, kwargs)

        cache = getattr(self, "embedding_cache", None)
        if cache:
            cached_embeddings = await cache.retrieve(
                identifier=call_kwargs,
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

        start_time = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        embeddings, token_usage = await self._call_embedding_api(call_kwargs)
        time = (datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) - start_time).total_seconds()

        if cache:
            await cache.store(
                identifier=call_kwargs,
                embeddings=embeddings,
            )

        usage_kwargs: Dict[str, Any] = {}
        if token_usage is not None:
            usage_kwargs["tokens"] = token_usage
        return EmbeddingResponse(
            embeddings=embeddings,
            usage=EmbeddingUsage(
                time=time,
                **usage_kwargs,
            ),
        )

    def _build_embedding_kwargs(
        self,
        gather_text: List[str],
        kwargs: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        组装嵌入 API 调用参数（R11：子类差异钩子，默认 input/model/dimensions）。

        Args:
            gather_text: 清理后的输入文本列表
            kwargs: 调用方额外参数

        Returns:
            Dict[str, Any]: API 调用参数
        """
        return {
            "input": gather_text,
            "model": self.model_name,
            "dimensions": self.dimensions,
            **kwargs,
        }

    async def _call_embedding_api(
        self,
        call_kwargs: Dict[str, Any],
    ):
        """
        调用底层嵌入 API 并返回向量与 token 用量（R11：子类差异钩子）。

        Args:
            call_kwargs: 组装后的 API 调用参数

        Returns:
            tuple: (embeddings 列表, token_usage 或 None——None 表示该 API 不提供 token 用量)
        """
        raise NotImplementedError(
            f"The {self.__class__.__name__} class does not implement "
            f"the _call_embedding_api method.",
        )
