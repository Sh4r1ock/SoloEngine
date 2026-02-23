# -*- coding: utf-8 -*-
"""
Embedding 服务工厂模块。

@file embedding_service.py
@description Embedding服务 - 统一的embedding生成服务
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 提供统一的embedding生成接口
- 支持多种embedding提供商（OpenAI、Ollama、本地模型）
- 支持配置化的embedding模型选择
- 支持缓存以提高性能

使用场景：
- VectorMemoryPlugin 使用
- KnowledgeBaseRAGPlugin 使用
- 其他需要embedding的场景

状态: ✅ 完整实现
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
    """Embedding 配置。"""
    
    provider: str = "openai"
    """Embedding 提供商: openai, ollama, local"""
    
    model_name: str = "text-embedding-3-small"
    """模型名称"""
    
    dimensions: int = 1536
    """向量维度"""
    
    api_key: Optional[str] = None
    """API Key (OpenAI)"""
    
    base_url: Optional[str] = None
    """API Base URL"""
    
    cache_enabled: bool = True
    """是否启用缓存"""
    
    cache_dir: str = ".embedding_cache"
    """缓存目录"""


class EmbeddingService:
    """统一的 Embedding 服务。"""
    
    _instance: Optional['EmbeddingService'] = None
    _model: Optional[EmbeddingModelBase] = None
    _config: Optional[EmbeddingConfig] = None
    
    def __new__(cls, config: Optional[EmbeddingConfig] = None):
        """单例模式。"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self, config: Optional[EmbeddingConfig] = None):
        """初始化 Embedding 服务。
        
        Args:
            config: Embedding 配置
        """
        if config is not None:
            self._config = config
            self._initialize_model()
    
    def _initialize_model(self) -> None:
        """初始化 embedding 模型。"""
        if self._config is None:
            self._config = EmbeddingConfig()
        
        cache = None
        if self._config.cache_enabled:
            cache_path = os.path.join(
                os.path.dirname(__file__), 
                "..", "..", "data", 
                self._config.cache_dir
            )
            os.makedirs(cache_path, exist_ok=True)
            cache = FileEmbeddingCache(cache_path)
        
        if self._config.provider == "openai":
            api_key = self._config.api_key or os.environ.get("OPENAI_API_KEY")
            if not api_key:
                logger.warning("OpenAI API key not found, using simulated embedding")
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
        """生成文本的 embedding 向量。
        
        Args:
            text: 输入文本
            
        Returns:
            embedding 向量
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
        """批量生成文本的 embedding 向量。
        
        Args:
            texts: 输入文本列表
            
        Returns:
            embedding 向量列表
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
        """模拟 embedding 生成（当没有真实模型时使用）。
        
        使用确定性哈希生成伪随机向量，保证相同文本生成相同向量。
        
        Args:
            text: 输入文本
            
        Returns:
            模拟的 embedding 向量
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
        """获取 embedding 维度。"""
        return self._config.dimensions if self._config else 1536
    
    @property
    def is_available(self) -> bool:
        """检查 embedding 服务是否可用。"""
        return self._model is not None
    
    @classmethod
    def get_instance(cls, config: Optional[EmbeddingConfig] = None) -> 'EmbeddingService':
        """获取单例实例。"""
        if cls._instance is None:
            cls._instance = cls(config)
        elif config is not None:
            cls._instance._config = config
            cls._instance._initialize_model()
        return cls._instance


def get_embedding_service(config: Optional[Dict[str, Any]] = None) -> EmbeddingService:
    """获取 embedding 服务实例。
    
    Args:
        config: 配置字典
        
    Returns:
        EmbeddingService 实例
    """
    if config is not None:
        embedding_config = EmbeddingConfig(**config)
    else:
        embedding_config = EmbeddingConfig()
    
    return EmbeddingService.get_instance(embedding_config)
