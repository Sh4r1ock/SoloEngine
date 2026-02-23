# -*- coding: utf-8 -*-
"""Knowledge Base RAG plugin for SoloEngine.

@file knowledge_base_rag.py
@description 知识库RAG插件 - 基于向量相似度的文档检索
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 向量化的文档存储
- 基于相似度的文档检索
- 支持配置化的 embedding 模型
- 支持多种 embedding 提供商

使用场景：
- RAG 知识检索
- 文档问答
- 上下文增强

状态: ✅ 完整实现
"""

from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
import numpy as np
import uuid

from ...core.interfaces import IRAG
from ...types import JSONSerializableObject
from ...embedding import get_embedding_service, EmbeddingService


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
    
    chunk_size: int = 500
    """Document chunk size for splitting."""
    
    chunk_overlap: int = 50
    """Overlap between chunks."""


class KnowledgeBaseRAGPlugin(IRAG):
    """Knowledge Base RAG plugin."""
    
    def __init__(self, config: Optional[dict] = None) -> None:
        """Initialize knowledge base.
        
        Args:
            config: Configuration dictionary
        """
        self.config = KnowledgeBaseConfig(**(config or {}))
        
        self._documents: Dict[str, Document] = {}
        self._embeddings: List[np.ndarray] = []
        self._doc_ids: List[str] = []
        
        embedding_config = {
            "provider": self.config.embedding_provider,
            "model_name": self.config.embedding_model,
            "dimensions": self.config.embedding_dimensions,
            "api_key": self.config.embedding_api_key,
            "base_url": self.config.embedding_base_url,
        }
        self._embedding_service: EmbeddingService = get_embedding_service(embedding_config)
    
    async def retrieve(self, query: str, limit: int = 5) -> List[dict]:
        """Retrieve relevant documents from knowledge base.
        
        Args:
            query: Query string
            limit: Maximum number of documents to retrieve
            
        Returns:
            List of relevant documents with similarity scores
        """
        if not self._documents:
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
        metadata: Optional[Dict[str, JSONSerializableObject]] = None,
        chunk: bool = True,
    ) -> str:
        """Add a document to the knowledge base.
        
        Args:
            content: Document content
            metadata: Optional metadata
            chunk: Whether to chunk the document
            
        Returns:
            Document ID
        """
        if chunk and len(content) > self.config.chunk_size:
            return await self._add_chunked_document(content, metadata)
        
        if len(self._documents) >= self.config.max_documents:
            oldest_id = self._doc_ids.pop(0)
            del self._documents[oldest_id]
            self._embeddings.pop(0)
        
        doc_id = str(uuid.uuid4())
        
        doc = Document(
            id=doc_id,
            content=content,
            metadata=metadata or {},
        )
        
        embedding = await self._embedding_service.embed(content)
        doc.embedding = embedding
        
        self._documents[doc_id] = doc
        self._embeddings.append(embedding)
        self._doc_ids.append(doc_id)
        
        return doc_id
    
    async def _add_chunked_document(
        self,
        content: str,
        metadata: Optional[Dict[str, JSONSerializableObject]] = None,
    ) -> str:
        """Add a chunked document.
        
        Args:
            content: Document content
            metadata: Optional metadata
            
        Returns:
            First chunk document ID
        """
        chunks = self._chunk_text(content)
        first_doc_id = None
        
        for i, chunk in enumerate(chunks):
            chunk_metadata = dict(metadata or {})
            chunk_metadata["chunk_index"] = i
            chunk_metadata["total_chunks"] = len(chunks)
            
            doc_id = await self.add_document(chunk, chunk_metadata, chunk=False)
            
            if first_doc_id is None:
                first_doc_id = doc_id
        
        return first_doc_id or ""
    
    def _chunk_text(self, text: str) -> List[str]:
        """Split text into chunks.
        
        Args:
            text: Input text
            
        Returns:
            List of text chunks
        """
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + self.config.chunk_size
            
            if end < len(text):
                last_period = text.rfind(".", start, end)
                last_newline = text.rfind("\n", start, end)
                split_point = max(last_period, last_newline)
                
                if split_point > start:
                    end = split_point + 1
            
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            
            start = end - self.config.chunk_overlap if end < len(text) else end
        
        return chunks
    
    async def add_documents_batch(
        self,
        documents: List[Dict[str, Any]],
    ) -> List[str]:
        """Add multiple documents in batch.
        
        Args:
            documents: List of documents with 'content' and optional 'metadata'
            
        Returns:
            List of document IDs
        """
        doc_ids = []
        
        contents = [doc.get("content", "") for doc in documents]
        embeddings = await self._embedding_service.embed_batch(contents)
        
        for i, doc in enumerate(documents):
            if len(self._documents) >= self.config.max_documents:
                oldest_id = self._doc_ids.pop(0)
                del self._documents[oldest_id]
                self._embeddings.pop(0)
            
            doc_id = str(uuid.uuid4())
            
            document = Document(
                id=doc_id,
                content=doc.get("content", ""),
                metadata=doc.get("metadata", {}),
                embedding=embeddings[i],
            )
            
            self._documents[doc_id] = document
            self._embeddings.append(embeddings[i])
            self._doc_ids.append(doc_id)
            doc_ids.append(doc_id)
        
        return doc_ids
    
    async def remove_document(self, doc_id: str) -> bool:
        """Remove a document from the knowledge base.
        
        Args:
            doc_id: Document ID
            
        Returns:
            True if removed, False if not found
        """
        if doc_id not in self._documents:
            return False
        
        del self._documents[doc_id]
        
        try:
            idx = self._doc_ids.index(doc_id)
            self._doc_ids.pop(idx)
            self._embeddings.pop(idx)
        except ValueError:
            pass
        
        return True
    
    async def clear(self) -> None:
        """Clear the knowledge base."""
        self._documents.clear()
        self._embeddings.clear()
        self._doc_ids.clear()
    
    async def get_document(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Get a document by ID.
        
        Args:
            doc_id: Document ID
            
        Returns:
            Document dict or None
        """
        doc = self._documents.get(doc_id)
        if doc:
            return {
                "id": doc.id,
                "content": doc.content,
                "metadata": doc.metadata,
            }
        return None
    
    async def get_statistics(self) -> Dict[str, Any]:
        """Get knowledge base statistics.
        
        Returns:
            Statistics dict
        """
        return {
            "document_count": len(self._documents),
            "max_documents": self.config.max_documents,
            "embedding_provider": self.config.embedding_provider,
            "embedding_model": self.config.embedding_model,
            "embedding_dimensions": self.config.embedding_dimensions,
            "is_real_embedding": self._embedding_service.is_available,
            "similarity_threshold": self.config.similarity_threshold,
        }
    
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
