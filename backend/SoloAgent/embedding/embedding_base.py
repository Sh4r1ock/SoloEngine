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

from typing import Any

from .embedding_response import EmbeddingResponse


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
        *args: Any,
        **kwargs: Any,
    ) -> EmbeddingResponse:
        """
        调用嵌入API生成向量

        这是嵌入模型的主要接口方法，接收文本列表，返回嵌入响应。

        Args:
            *args: 位置参数，通常是文本列表
            **kwargs: 关键字参数，可包含input等

        Returns:
            EmbeddingResponse: 嵌入响应，包含embeddings、usage、model

        Raises:
            NotImplementedError: 子类未实现此方法时抛出

        示例:
            >>> response = await model(["你好", "世界"])
            >>> for embedding in response.embeddings:
            ...     print(len(embedding))  # 1536
        """
        raise NotImplementedError(
            f"The {self.__class__.__name__} class does not implement "
            f"the __call__ method.",
        )
