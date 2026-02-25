# -*- coding: utf-8 -*-
"""
嵌入模型基类模块。

@file embedding_base.py
@description 定义嵌入模型的抽象基类
@author SoloEngine Team
@date 2026-02-20

功能描述：
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

设计理念：
    采用抽象基类模式，为不同嵌入服务提供商提供统一接口。
    所有具体实现（OpenAI、Ollama 等）都继承此类。

状态: ✅ 完整实现
"""

from typing import Any

from .embedding_response import EmbeddingResponse


class EmbeddingModelBase:
    """
    嵌入模型抽象基类。
    
    所有嵌入模型的基类，定义了嵌入生成的统一接口。
    具体实现类需要实现 __call__ 方法。
    
    核心功能：
        1. 统一嵌入生成接口
        2. 模型元数据管理
        3. 支持多种模态
    
    子类实现：
        - OpenAITextEmbedding: OpenAI 文本嵌入
        - OllamaTextEmbedding: Ollama 本地模型嵌入
    
    使用方式：
        嵌入模型实例是可调用对象，直接调用即可生成嵌入：
        >>> response = await model(["文本1", "文本2"])
    
    Example:
        >>> from SoloAgent.embedding import OpenAITextEmbedding
        >>> 
        >>> model = OpenAITextEmbedding(
        ...     model_name="text-embedding-3-small",
        ...     dimensions=1536
        ... )
        >>> 
        >>> response = await model(["你好", "世界"])
        >>> print(len(response.embeddings))  # 2
        >>> print(len(response.embeddings[0]))  # 1536
    
    Note:
        - 所有模型参数通过构造函数传入
        - 调用时传入文本列表
        - 返回 EmbeddingResponse 对象
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
        初始化嵌入模型基类。
        
        Args:
            model_name (str): 嵌入模型名称，由具体提供商定义。
                例如：'text-embedding-3-small', 'nomic-embed-text'。
            dimensions (int): 嵌入向量的维度。
                常见维度：1536（OpenAI）、768（BERT）、384（MiniLM）。
        
        Note:
            子类应调用 super().__init__() 并添加提供商特定的参数。
        """
        self.model_name = model_name
        self.dimensions = dimensions

    async def __call__(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> EmbeddingResponse:
        """
        调用嵌入 API 生成向量。
        
        这是嵌入模型的主要接口方法，接收文本列表，
        返回嵌入响应。
        
        Args:
            *args: 位置参数，通常是文本列表。
            **kwargs: 关键字参数，可包含：
                - input: 输入文本列表
                - 其他提供商特定参数
        
        Returns:
            EmbeddingResponse: 嵌入响应，包含：
                - embeddings: 嵌入向量列表
                - usage: 使用量统计
                - model: 模型名称
        
        Raises:
            NotImplementedError: 子类未实现此方法时抛出。
        
        Note:
            子类必须实现此方法。
        
        Example:
            >>> response = await model(["你好", "世界"])
            >>> for embedding in response.embeddings:
            ...     print(len(embedding))  # 1536
        """
        raise NotImplementedError(
            f"The {self.__class__.__name__} class does not implement "
            f"the __call__ method.",
        )
