# -*- coding: utf-8 -*-
"""Vector memory plugin for SoloEngine."""

from typing import List, Optional
import numpy as np
from dataclasses import dataclass

from ...core.interfaces import IMemory
from ...message import Msg


@dataclass
class VectorMemoryConfig:
    """Configuration for vector memory."""
    
    max_size: int = 1000
    """Maximum number of messages to store."""
    
    similarity_threshold: float = 0.7
    """Minimum similarity score for retrieval."""
    
    embedding_dim: int = 384
    """Embedding dimension (simulated)."""


class VectorMemoryPlugin(IMemory):
    """Vector-based memory plugin."""
    
    def __init__(self, config: Optional[dict] = None) -> None:
        """Initialize vector memory.
        
        Args:
            config: Configuration dictionary
        """
        self.config = VectorMemoryConfig(**(config or {}))
        
        # Simulated storage
        self._messages: List[Msg] = []
        self._embeddings: List[np.ndarray] = []
        
    async def add(self, msg: Msg) -> None:
        """Add a message to memory."""
        if len(self._messages) >= self.config.max_size:
            # Remove oldest message
            self._messages.pop(0)
            self._embeddings.pop(0)
        
        self._messages.append(msg)
        # Simulate embedding generation
        embedding = self._generate_embedding(msg)
        self._embeddings.append(embedding)
    
    async def retrieve(self, query: str, limit: int = 5) -> List[Msg]:
        """Retrieve relevant messages from memory."""
        if not self._messages:
            return []
        
        # Generate query embedding
        query_embedding = self._generate_query_embedding(query)
        
        # Calculate similarities
        similarities = []
        for embedding in self._embeddings:
            similarity = self._calculate_similarity(query_embedding, embedding)
            similarities.append(similarity)
        
        # Get indices of top matches
        indices = np.argsort(similarities)[-limit:][::-1]
        
        # Filter by threshold
        results = []
        for idx in indices:
            if similarities[idx] >= self.config.similarity_threshold:
                results.append(self._messages[idx])
        
        return results
    
    async def clear(self) -> None:
        """Clear the memory."""
        self._messages.clear()
        self._embeddings.clear()
    
    async def get_memory_state(self) -> dict:
        """Get the current memory state."""
        return {
            "message_count": len(self._messages),
            "max_size": self.config.max_size,
            "config": self.config.__dict__,
        }
    
    async def set_memory_state(self, state: dict) -> None:
        """Set the memory state."""
        # This is a simplified implementation
        # In a real implementation, you would restore messages and embeddings
        pass
    
    def _generate_embedding(self, msg: Msg) -> np.ndarray:
        """Generate embedding for a message."""
        # Simulated embedding generation
        text = msg.get_text_content() or ""
        # Simple hash-based "embedding"
        seed = hash(text) % (2**32)
        np.random.seed(seed)
        return np.random.randn(self.config.embedding_dim)
    
    def _generate_query_embedding(self, query: str) -> np.ndarray:
        """Generate embedding for a query."""
        # Simulated embedding generation
        seed = hash(query) % (2**32)
        np.random.seed(seed)
        return np.random.randn(self.config.embedding_dim)
    
    def _calculate_similarity(
        self, 
        embedding1: np.ndarray, 
        embedding2: np.ndarray
    ) -> float:
        """Calculate cosine similarity between embeddings."""
        norm1 = np.linalg.norm(embedding1)
        norm2 = np.linalg.norm(embedding2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return np.dot(embedding1, embedding2) / (norm1 * norm2)