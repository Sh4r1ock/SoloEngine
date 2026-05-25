# -*- coding: utf-8 -*-
"""
SoloEngine : Embedding服务模块

@file embedding_service.py
@description 提供统一的embedding生成服务
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供Embedding服务，包括：
    - EmbeddingConfig: Embedding配置数据类
    - EmbeddingService: Embedding服务类（单例模式）
    - get_embedding_service: 获取embedding服务实例
    - 支持多种embedding提供商（OpenAI、Ollama）
    - 支持配置化的embedding模型选择
    - 支持缓存以提高性能

依赖:
    - os: 操作系统接口
    - logging: 日志记录
    - typing: 类型提示
    - dataclasses: 数据类
    - numpy: 数值计算
    - .embedding_base: 嵌入模型基类
    - .embedding_response: 嵌入响应
    - .openai_embedding: OpenAI嵌入
    - .ollama_embedding: Ollama嵌入
    - .file_cache: 文件缓存

使用示例:
    - from SoloAgent.embedding import get_embedding_service
    - service = get_embedding_service({"provider": "openai", "model_name": "text-embedding-3-small"})
    - embedding = await service.embed("文本内容")
"""

import os
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
import numpy as np

from .embedding_base import EmbeddingModelBase
from .embedding_response import EmbeddingResponse
from .openai_embedding import OpenAITextEmbedding
from .ollama_embedding import OllamaTextEmbedding
from .file_cache import FileEmbeddingCache

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingConfig:
    """
    Embedding配置数据类

    职责:
        - 存储Embedding服务配置
        - 管理模型参数
        - 管理缓存设置

    属性:
        provider: Embedding提供商
        model_name: 模型名称
        dimensions: 向量维度
        api_key: API密钥
        base_url: API基础URL
        cache_enabled: 是否启用缓存
        cache_dir: 缓存目录

    示例:
        >>> config = EmbeddingConfig(provider="openai", model_name="text-embedding-3-small")
    """

    provider: str = "openai"
    """Embedding提供商: openai, ollama"""

    model_name: str = "text-embedding-3-small"
    """模型名称"""

    dimensions: int = 1536
    """向量维度"""

    api_key: Optional[str] = None
    """API密钥（OpenAI）"""

    base_url: Optional[str] = None
    """API基础URL"""

    cache_enabled: bool = True
    """是否启用缓存"""

    cache_dir: str = ".embedding_cache"
    """缓存目录"""


class EmbeddingService:
    """
    Embedding服务类（单例模式）

    职责:
        - 提供统一的embedding生成接口
        - 管理embedding模型实例
        - 支持缓存
        - 支持模拟embedding（当模型不可用时）

    属性:
        _instance: 单例实例
        _model: embedding模型
        _config: 配置

    示例:
        >>> service = EmbeddingService(config)
        >>> embedding = await service.embed("文本内容")
    """

    _instance: Optional['EmbeddingService'] = None
    _model: Optional[EmbeddingModelBase] = None
    _config: Optional[EmbeddingConfig] = None

    def __new__(cls, config: Optional[EmbeddingConfig] = None):
        """
        单例模式

        Args:
            config: Embedding配置

        示例:
            >>> service = EmbeddingService(config)
        """
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, config: Optional[EmbeddingConfig] = None):
        """
        初始化Embedding服务

        Args:
            config: Embedding配置

        示例:
            >>> service = EmbeddingService(config)
        """
        if config is not None:
            self._config = config
            self._initialize_model()
    
    def _initialize_model(self) -> None:
        """
        初始化embedding模型

        根据配置初始化相应的embedding模型

        示例:
            >>> service._initialize_model()
        """
        if self._config is None:
            self._config = EmbeddingConfig()
        
        cache = None
        if self._config.cache_enabled:
            cache_path = os.path.join(
                os.path.dirname(__file__), 
                "..", "..", "..", "data", 
                self._config.cache_dir
            )
            os.makedirs(cache_path, exist_ok=True)
            cache = FileEmbeddingCache(cache_path)
        
        if self._config.provider == "openai":
            api_key = self._config.api_key
            if not api_key:
                logger.warning("OpenAI API key not provided for embedding service, using simulated embedding")
                self._model = None
                return
            
            self._model = OpenAITextEmbedding(
                api_key=api_key,
                model_name=self._config.model_name,
                dimensions=self._config.dimensions,
                embedding_cache=cache,
            )
            if self._config.base_url:
                self._model.client.base_url = self._config.base_url
        
        elif self._config.provider == "ollama":
            self._model = OllamaTextEmbedding(
                model_name=self._config.model_name,
                dimensions=self._config.dimensions,
                host=self._config.base_url,
                embedding_cache=cache,
            )
        
        else:
            logger.warning(f"Unknown provider: {self._config.provider}, using simulated embedding")
            self._model = None
    
    async def embed(self, text: str) -> np.ndarray:
        """
        生成文本的embedding向量

        Args:
            text: 输入文本

        Returns:
            np.ndarray: embedding向量

        示例:
            >>> embedding = await service.embed("文本内容")
        """
        if self._model is None:
            return self._simulate_embedding(text)
        
        try:
            response: EmbeddingResponse = await self._model([text])
            return np.array(response.embeddings[0], dtype=np.float32)
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            return self._simulate_embedding(text)
    
    async def embed_batch(self, texts: List[str]) -> List[np.ndarray]:
        """
        批量生成文本的embedding向量

        Args:
            texts: 输入文本列表

        Returns:
            List[np.ndarray]: embedding向量列表

        示例:
            >>> embeddings = await service.embed_batch(["文本1", "文本2"])
        """
        if self._model is None:
            return [self._simulate_embedding(text) for text in texts]
        
        try:
            response: EmbeddingResponse = await self._model(texts)
            return [np.array(emb, dtype=np.float32) for emb in response.embeddings]
        except Exception as e:
            logger.error(f"Failed to generate batch embeddings: {e}")
            return [self._simulate_embedding(text) for text in texts]
    
    def _simulate_embedding(self, text: str) -> np.ndarray:
        """
        模拟embedding生成（当没有真实模型时使用）

        使用确定性哈希生成伪随机向量，保证相同文本生成相同向量。

        Args:
            text: 输入文本

        Returns:
            np.ndarray: 模拟的embedding向量

        示例:
            >>> embedding = service._simulate_embedding("文本")
        """
        dimensions = self._config.dimensions if self._config else 1536
        seed = hash(text) % (2**32)
        rng = np.random.RandomState(seed)
        embedding = rng.randn(dimensions).astype(np.float32)
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding
    
    @property
    def dimensions(self) -> int:
        """
        获取embedding维度

        Returns:
            int: 向量维度

        示例:
            >>> dims = service.dimensions
        """
        return self._config.dimensions if self._config else 1536

    @property
    def is_available(self) -> bool:
        """
        检查embedding服务是否可用

        Returns:
            bool: 是否可用

        示例:
            >>> if service.is_available:
            ...     embedding = await service.embed("文本")
        """
        return self._model is not None

    @classmethod
    def get_instance(cls, config: Optional[EmbeddingConfig] = None) -> 'EmbeddingService':
        """
        获取单例实例

        Args:
            config: Embedding配置

        Returns:
            EmbeddingService: 服务实例

        示例:
            >>> service = EmbeddingService.get_instance(config)
        """
        if cls._instance is None:
            cls._instance = cls(config)
        elif config is not None:
            cls._instance._config = config
            cls._instance._initialize_model()
        return cls._instance


def get_embedding_service(config: Optional[Dict[str, Any]] = None) -> EmbeddingService:
    """
    获取embedding服务实例

    Args:
        config: 配置字典

    Returns:
        EmbeddingService: 服务实例

    示例:
        >>> service = get_embedding_service({"provider": "openai"})
    """
    if config is not None:
        embedding_config = EmbeddingConfig(**config)
    else:
        embedding_config = EmbeddingConfig()
    
    return EmbeddingService.get_instance(embedding_config)
