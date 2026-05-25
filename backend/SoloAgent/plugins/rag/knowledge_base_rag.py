# -*- coding: utf-8 -*-
"""
SoloEngine : 知识库RAG插件，基于向量相似度的文档检索

@file knowledge_base_rag.py
@description 知识库RAG插件实现，支持向量化的文档存储和检索
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供知识库RAG插件，包括：
    - Document: 文档数据类
    - KnowledgeBaseConfig: 知识库配置类
    - KnowledgeBaseRAGPlugin: 知识库RAG插件
    - 向量化的文档存储
    - 基于相似度的文档检索
    - 支持配置化的embedding模型
    - 支持多种embedding提供商

依赖:
    - typing: 类型提示
    - dataclasses: 数据类
    - numpy: 数值计算
    - uuid: UUID生成
    - ...core.interfaces: 核心接口
    - ...types: 类型定义
    - ...embedding: 嵌入服务

使用示例:
    - from SoloAgent.plugins.rag import KnowledgeBaseRAGPlugin
    - rag = KnowledgeBaseRAGPlugin(config={"max_documents": 1000})
    - doc_id = await rag.add_document("文档内容", {"source": "file.txt"})
    - results = await rag.retrieve("查询内容", limit=5)
"""

from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field
import numpy as np
import uuid
from app.core.config import settings
from ...core.interfaces import IRAG
from ...types import JSONSerializableObject
from ...embedding import get_embedding_service, EmbeddingService


@dataclass
class Document:
    """
    RAG文档数据类

    职责:
        - 存储文档内容
        - 存储文档元数据
        - 存储文档向量嵌入

    属性:
        id: 文档唯一标识
        content: 文档内容
        metadata: 文档元数据
        embedding: 向量嵌入

    示例:
        >>> doc = Document(
        ...     id="doc-123",
        ...     content="文档内容",
        ...     metadata={"source": "file.txt"}
        ... )
    """

    id: str
    content: str
    metadata: Dict[str, JSONSerializableObject] = field(default_factory=dict)
    embedding: Optional[np.ndarray] = None


@dataclass
class KnowledgeBaseConfig:
    """
    知识库配置类

    职责:
        - 存储知识库配置参数
        - 管理embedding服务配置
        - 管理文档分块配置

    属性:
        max_documents: 最大文档数量
        similarity_threshold: 相似度阈值
        embedding_provider: 嵌入服务提供商
        embedding_model: 嵌入模型名称
        embedding_dimensions: 向量维度
        embedding_api_key: API密钥
        embedding_base_url: API基础URL
        chunk_size: 文档分块大小
        chunk_overlap: 分块重叠大小

    示例:
        >>> config = KnowledgeBaseConfig(
        ...     max_documents=1000,
        ...     similarity_threshold=0.6,
        ...     embedding_provider="openai"
        ... )
    """

    max_documents: int = 1000
    """最大文档数量"""

    similarity_threshold: float = 0.6
    """最小相似度分数用于检索"""

    embedding_provider: str = "openai"
    """嵌入服务提供商: openai, ollama"""

    embedding_model: str = "text-embedding-3-small"
    """嵌入模型名称"""

    embedding_dimensions: int = 1536
    """向量维度"""

    embedding_api_key: Optional[str] = None
    """嵌入服务API密钥"""

    embedding_base_url: Optional[str] = None
    """嵌入服务基础URL"""

    chunk_size: int = field(default_factory=lambda: settings.CHUNK_SIZE)
    """文档分块大小"""

    chunk_overlap: int = field(default_factory=lambda: settings.CHUNK_OVERLAP)
    """分块之间的重叠大小"""


class KnowledgeBaseRAGPlugin(IRAG):
    """
    知识库RAG插件

    职责:
        - 实现IRAG接口
        - 提供基于向量相似度的文档检索
        - 管理文档的添加、删除、检索
        - 支持文档分块和批量添加

    属性:
        config: 知识库配置
        _documents: 文档字典
        _embeddings: 向量嵌入列表
        _doc_ids: 文档ID列表
        _embedding_service: 嵌入服务

    示例:
        >>> rag = KnowledgeBaseRAGPlugin({
        ...     "max_documents": 1000,
        ...     "similarity_threshold": 0.6
        ... })
        >>> doc_id = await rag.add_document("文档内容")
        >>> results = await rag.retrieve("查询")
    """

    def __init__(self, config: Optional[dict] = None) -> None:
        """
        初始化知识库RAG插件

        Args:
            config: 配置字典，可包含KnowledgeBaseConfig的所有字段

        示例:
            >>> rag = KnowledgeBaseRAGPlugin({"max_documents": 500})
        """
        self.config = KnowledgeBaseConfig(**(config or {}))

        self._documents: Dict[str, Document] = {}
        """文档字典 {doc_id: Document}"""

        self._embeddings: List[np.ndarray] = []
        """向量嵌入列表"""

        self._doc_ids: List[str] = []
        """文档ID列表"""

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
