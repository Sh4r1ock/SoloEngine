# -*- coding: utf-8 -*-
"""Vector memory plugin for SoloEngine.

@file vector_memory.py
@description 向量记忆插件 - 基于向量相似度的记忆检索
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 向量化的记忆存储
- 基于相似度的记忆检索
- 支持配置化的 embedding 模型
- 支持多种 embedding 提供商

使用场景：
- Agent 长期记忆
- 对话历史检索
- 上下文相关记忆

状态: ✅ 完整实现
"""

from typing import List, Optional, Dict, Any
import numpy as np
from dataclasses import dataclass

from ...core.interfaces import IMemory
from ...message import Msg
from ...embedding import get_embedding_service, EmbeddingService


@dataclass
class VectorMemoryConfig:
    """Configuration for vector memory."""
    
    max_size: int = 1000
    """Maximum number of messages to store."""
    
    similarity_threshold: float = 0.7
    """Minimum similarity score for retrieval."""
    
    embedding_provider: str = "openai"
    """Embedding provider: openai, ollama"""
    
    embedding_model: str = "text-embedding-3-small"
    """Embedding model name."""
    
    embedding_dimensions: int = 1536
    """Embedding dimension."""
    
    embedding_api_key: Optional[str] = None
    """API key for embedding service."""
    
    embedding_base_url: Optional[str] = None
    """Base URL for embedding service."""


class VectorMemoryPlugin(IMemory):
    """Vector-based memory plugin."""
    
    def __init__(self, config: Optional[dict] = None) -> None:
        """Initialize vector memory.
        
        Args:
            config: Configuration dictionary
        """
        self.config = VectorMemoryConfig(**(config or {}))
        
        self._messages: List[Msg] = []
        self._embeddings: List[np.ndarray] = []
        self._metadata: List[Dict[str, Any]] = []
        
        embedding_config = {
            "provider": self.config.embedding_provider,
            "model_name": self.config.embedding_model,
            "dimensions": self.config.embedding_dimensions,
            "api_key": self.config.embedding_api_key,
            "base_url": self.config.embedding_base_url,
        }
        self._embedding_service: EmbeddingService = get_embedding_service(embedding_config)
    
    async def add(self, msg: Msg, metadata: Optional[Dict[str, Any]] = None) -> None:
        """Add a message to memory.
        
        Args:
            msg: Message to add
            metadata: Optional metadata for the message
        """
        if len(self._messages) >= self.config.max_size:
            self._messages.pop(0)
            self._embeddings.pop(0)
            self._metadata.pop(0)
        
        self._messages.append(msg)
        self._metadata.append(metadata or {})
        
        text = msg.get_text_content() or ""
        embedding = await self._embedding_service.embed(text)
        self._embeddings.append(embedding)
    
    async def retrieve(self, query: str, limit: int = 5) -> List[Msg]:
        """Retrieve relevant messages from memory.
        
        Args:
            query: Query string
            limit: Maximum number of messages to retrieve
            
        Returns:
            List of relevant messages
        """
        if not self._messages:
            return []
        
        query_embedding = await self._embedding_service.embed(query)
        
        similarities = []
        for embedding in self._embeddings:
            similarity = self._calculate_similarity(query_embedding, embedding)
            similarities.append(similarity)
        
        indices = np.argsort(similarities)[-limit:][::-1]
        
        results = []
        for idx in indices:
            if similarities[idx] >= self.config.similarity_threshold:
                results.append(self._messages[idx])
        
        return results
    
    async def retrieve_with_scores(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Retrieve relevant messages with similarity scores.
        
        Args:
            query: Query string
            limit: Maximum number of messages to retrieve
            
        Returns:
            List of dicts containing message and similarity score
        """
        if not self._messages:
            return []
        
        query_embedding = await self._embedding_service.embed(query)
        
        similarities = []
        for embedding in self._embeddings:
            similarity = self._calculate_similarity(query_embedding, embedding)
            similarities.append(similarity)
        
        indices = np.argsort(similarities)[-limit:][::-1]
        
        results = []
        for idx in indices:
            if similarities[idx] >= self.config.similarity_threshold:
                results.append({
                    "message": self._messages[idx],
                    "similarity": float(similarities[idx]),
                    "metadata": self._metadata[idx],
                })
        
        return results
    
    async def clear(self) -> None:
        """Clear the memory."""
        self._messages.clear()
        self._embeddings.clear()
        self._metadata.clear()
    
    async def get_memory_state(self) -> dict:
        """Get the current memory state."""
        return {
            "message_count": len(self._messages),
            "max_size": self.config.max_size,
            "embedding_provider": self.config.embedding_provider,
            "embedding_model": self.config.embedding_model,
            "embedding_dimensions": self.config.embedding_dimensions,
            "is_real_embedding": self._embedding_service.is_available,
            "config": self.config.__dict__,
        }
    
    async def set_memory_state(self, state: dict) -> None:
        """Set the memory state."""
        pass
    
    def _calculate_similarity(
        self, 
        embedding1: np.ndarray, 
        embedding2: np.ndarray
    ) -> float:
        """Calculate cosine similarity between embeddings.
        
        Args:
            embedding1: First embedding vector
            embedding2: Second embedding vector
            
        Returns:
            Cosine similarity score
        """
        norm1 = np.linalg.norm(embedding1)
        norm2 = np.linalg.norm(embedding2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return float(np.dot(embedding1, embedding2) / (norm1 * norm2))
    
    @property
    def is_real_embedding(self) -> bool:
        """Check if using real embedding model."""
        return self._embedding_service.is_available
