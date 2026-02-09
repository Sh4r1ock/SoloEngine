# -*- coding: utf-8 -*-
"""Knowledge Base RAG plugin for SoloEngine."""

from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
import numpy as np

from ...core.interfaces import IRAG
from ...types import JSONSerializableObject


@dataclass
class Document:
    """Simple document class for RAG."""
    
    id: str
    content: str
    metadata: Dict[str, JSONSerializableObject] = field(default_factory=dict)
    embedding: Optional[np.ndarray] = None


@dataclass
class KnowledgeBaseConfig:
    """Configuration for knowledge base."""
    
    max_documents: int = 1000
    """Maximum number of documents to store."""
    
    similarity_threshold: float = 0.6
    """Minimum similarity score for retrieval."""
    
    embedding_dim: int = 384
    """Embedding dimension (simulated)."""


class KnowledgeBaseRAGPlugin(IRAG):
    """Knowledge Base RAG plugin."""
    
    def __init__(self, config: Optional[dict] = None) -> None:
        """Initialize knowledge base.
        
        Args:
            config: Configuration dictionary
        """
        self.config = KnowledgeBaseConfig(**(config or {}))
        
        # Document storage
        self._documents: Dict[str, Document] = {}
        self._embeddings: List[np.ndarray] = []
        self._doc_ids: List[str] = []
        
    async def retrieve(self, query: str, limit: int = 5) -> List[dict]:
        """Retrieve relevant documents from knowledge base."""
        if not self._documents:
            return []
        
        # Generate query embedding
        query_embedding = self._generate_embedding(query)
        
        # Calculate similarities
        similarities = []
        for embedding in self._embeddings:
            similarity = self._calculate_similarity(query_embedding, embedding)
            similarities.append(similarity)
        
        # Get indices of top matches
        indices = np.argsort(similarities)[-limit:][::-1]
        
        # Filter by threshold and prepare results
        results = []
        for idx in indices:
            if similarities[idx] >= self.config.similarity_threshold:
                doc_id = self._doc_ids[idx]
                doc = self._documents[doc_id]
                results.append({
                    "id": doc.id,
                    "content": doc.content,
                    "metadata": doc.metadata,
                    "similarity": float(similarities[idx]),
                })
        
        return results
    
    async def add_document(
        self,
        content: str,
        metadata: Optional[Dict[str, JSONSerializableObject]] = None
    ) -> str:
        """Add a document to the knowledge base."""
        if len(self._documents) >= self.config.max_documents:
            # Remove oldest document
            oldest_id = self._doc_ids.pop(0)
            del self._documents[oldest_id]
            self._embeddings.pop(0)
        
        # Generate document ID
        import uuid
        doc_id = str(uuid.uuid4())
               
 # Create document
        doc = Document(
            id=doc_id,
            content=content,
            metadata=metadata or {},
        )
        
        # Generate embedding
        embedding = self._generate_embedding(content)
        doc.embedding = embedding
        
        # Store
        self._documents[doc_id] = doc
        self._embeddings.append(embedding)
        self._doc_ids.append(doc_id)
        
        return doc_id
    
    async def clear(self) -> None:
        """Clear the knowledge base."""
        self._documents.clear()
        self._embeddings.clear()
        self._doc_ids.clear()
    
    def _generate_embedding(self, text: str) -> np.ndarray:
        """Generate embedding for text."""
        # Simulated embedding generation
        seed = hash(text) % (2**32)
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