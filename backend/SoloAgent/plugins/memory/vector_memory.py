# -*- coding: utf-8 -*-
"""
向量记忆插件模块。

@file vector_memory.py
@description 基于向量相似度的记忆检索插件
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 向量化的记忆存储
- 基于语义相似度的记忆检索
- 支持配置化的 embedding 模型
- 支持多种 embedding 提供商（OpenAI、Ollama）

工作原理：
    1. 添加消息时，提取文本内容并生成向量嵌入
    2. 检索时，计算查询向量与存储向量的余弦相似度
    3. 返回相似度超过阈值的最相关消息

使用场景：
    - Agent 长期记忆：存储历史对话，按相关性检索
    - 对话历史检索：找到与当前问题相关的历史对话
    - 上下文相关记忆：为 Agent 提供相关的上下文信息

配置参数：
    - max_size: 最大存储消息数量
    - similarity_threshold: 相似度阈值（0-1）
    - embedding_provider: 嵌入服务提供商
    - embedding_model: 嵌入模型名称
    - embedding_dimensions: 向量维度

状态: ✅ 完整实现
"""

from typing import List, Optional, Dict, Any
import numpy as np
from dataclasses import dataclass, field
from app.core.config import settings
from ...core.interfaces import IMemory
from ...message import Msg
from ...embedding import get_embedding_service, EmbeddingService


@dataclass
class VectorMemoryConfig:
    """
    向量记忆配置类。
    
    定义向量记忆插件的所有配置参数。
    
    Attributes:
        max_size (int): 最大存储消息数量。当达到上限时，
            最旧的消息会被自动淘汰。默认为 1000。
        similarity_threshold (float): 相似度阈值（0-1）。
            只有相似度超过此阈值的消息才会被检索返回。
            默认为 0.7。
        embedding_provider (str): 嵌入服务提供商。
            支持 "openai"、"ollama"。默认为 "openai"。
        embedding_model (str): 嵌入模型名称。
            如 "text-embedding-3-small"、"nomic-embed-text"。
            默认为 "text-embedding-3-small"。
        embedding_dimensions (int): 向量维度。
            需要与嵌入模型匹配。默认为 1536。
        embedding_api_key (Optional[str]): 嵌入服务 API 密钥。
            如果未提供，从环境变量读取。默认为 None。
        embedding_base_url (Optional[str]): 嵌入服务基础 URL。
            用于自定义部署。默认为 None。
    
    Example:
        >>> config = VectorMemoryConfig(
        ...     max_size=500,
        ...     similarity_threshold=0.8,
        ...     embedding_provider="ollama",
        ...     embedding_model="nomic-embed-text"
        ... )
    """
    
    max_size: int = field(default_factory=lambda: settings.VECTOR_MEMORY_MAX_SIZE)
    """最大存储消息数量，超过时淘汰最旧消息"""
    
    similarity_threshold: float = field(default_factory=lambda: settings.VECTOR_MEMORY_SIMILARITY_THRESHOLD)
    """相似度阈值，范围 0-1，越高要求越严格"""
    
    embedding_provider: str = "openai"
    """嵌入服务提供商：openai, ollama"""
    
    embedding_model: str = "text-embedding-3-small"
    """嵌入模型名称"""
    
    embedding_dimensions: int = 1536
    """向量维度，需与模型匹配"""
    
    embedding_api_key: Optional[str] = None
    """API 密钥，未提供时从环境变量读取"""
    
    embedding_base_url: Optional[str] = None
    """自定义 API 基础 URL"""


class VectorMemoryPlugin(IMemory):
    """
    向量记忆插件。
    
    实现 IMemory 接口，提供基于向量相似度的记忆存储和检索功能。
    消息被向量化后存储，检索时通过语义相似度匹配。
    
    核心功能：
        1. 消息存储：将消息文本向量化后存储
        2. 相似度检索：基于余弦相似度检索相关消息
        3. 容量管理：自动淘汰最旧消息
        4. 元数据支持：可为消息附加元数据
    
    相似度计算：
        使用余弦相似度计算向量之间的相似程度：
        similarity = dot(a, b) / (norm(a) * norm(b))
        
        相似度范围：-1 到 1
        - 1: 完全相同方向
        - 0: 正交（无关）
        - -1: 完全相反方向
    
    Example:
        >>> from SoloAgent.plugins.memory import VectorMemoryPlugin
        >>> from SoloAgent.message import Msg
        >>> 
        >>> memory = VectorMemoryPlugin({"max_size": 100})
        >>> 
        >>> # 添加消息
        >>> await memory.add(Msg(name="user", content="我喜欢编程", role="user"))
        >>> 
        >>> # 检索相关消息
        >>> results = await memory.retrieve("编程相关的话题")
        >>> print(results[0].get_text_content())  # "我喜欢编程"
    
    Note:
        - 需要配置有效的嵌入服务
        - 如果嵌入服务不可用，会使用模拟嵌入
        - 消息容量达到上限时自动淘汰最旧消息
    """
    
    def __init__(self, config: Optional[dict] = None) -> None:
        """
        初始化向量记忆插件。
        
        Args:
            config (dict, optional): 配置字典，可包含 VectorMemoryConfig
                的所有字段。如果未提供，使用默认配置。
        
        Note:
            初始化时会创建嵌入服务实例，如果嵌入服务不可用，
            会使用模拟嵌入（基于哈希的确定性伪随机向量）。
        """
        self.config = VectorMemoryConfig(**(config or {}))
        
        self._messages: List[Msg] = []
        """存储的消息列表"""
        
        self._embeddings: List[np.ndarray] = []
        """消息对应的向量嵌入列表"""
        
        self._metadata: List[Dict[str, Any]] = []
        """消息元数据列表"""
        
        embedding_config = {
            "provider": self.config.embedding_provider,
            "model_name": self.config.embedding_model,
            "dimensions": self.config.embedding_dimensions,
            "api_key": self.config.embedding_api_key,
            "base_url": self.config.embedding_base_url,
        }
        self._embedding_service: EmbeddingService = get_embedding_service(embedding_config)
    
    async def add(self, msg: Msg, metadata: Optional[Dict[str, Any]] = None) -> None:
        """
        将消息添加到记忆存储中。
        
        提取消息的文本内容，生成向量嵌入后存储。
        如果存储已满，自动淘汰最旧的消息。
        
        Args:
            msg (Msg): 要添加的消息对象。消息的文本内容会被提取
                并向量化存储。
            metadata (dict, optional): 消息元数据，可包含任意信息，
                如来源、时间戳、标签等。默认为 None。
        
        Note:
            - 消息添加后会立即可检索
            - 如果存储已满，最旧的消息会被移除
            - 嵌入生成失败时会使用模拟嵌入
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
        """
        从记忆中检索相关消息。
        
        基于语义相似度检索与查询最相关的历史消息。
        只返回相似度超过阈值的消息。
        
        Args:
            query (str): 查询文本，用于计算与存储消息的相似度。
            limit (int, optional): 返回消息的最大数量。默认为 5。
        
        Returns:
            List[Msg]: 相关消息列表，按相似度降序排列。
                如果没有消息超过相似度阈值，返回空列表。
        
        Note:
            - 查询文本会被向量化后与存储的向量比较
            - 相似度阈值由 config.similarity_threshold 决定
            - 返回的消息按相似度从高到低排序
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
        """
        从记忆中检索相关消息（包含相似度分数）。
        
        与 retrieve 方法类似，但返回结果包含相似度分数和元数据。
        
        Args:
            query (str): 查询文本。
            limit (int, optional): 返回消息的最大数量。默认为 5。
        
        Returns:
            List[Dict[str, Any]]: 结果列表，每个元素包含：
                - message: Msg 对象
                - similarity: 相似度分数（0-1）
                - metadata: 消息元数据
        
        Example:
            >>> results = await memory.retrieve_with_scores("编程")
            >>> for result in results:
            ...     print(f"相似度: {result['similarity']:.2f}")
            ...     print(f"内容: {result['message'].get_text_content()}")
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
        """
        清空记忆存储。
        
        删除所有存储的消息、向量嵌入和元数据。
        此操作不可逆。
        
        Warning:
            此操作会永久删除所有记忆数据，无法恢复。
        """
        self._messages.clear()
        self._embeddings.clear()
        self._metadata.clear()
    
    async def get_memory_state(self) -> dict:
        """
        获取当前记忆状态。
        
        返回记忆系统的状态信息，用于监控和调试。
        
        Returns:
            dict: 记忆状态字典，包含：
                - message_count: 当前存储的消息数量
                - max_size: 最大容量
                - embedding_provider: 嵌入服务提供商
                - embedding_model: 嵌入模型名称
                - embedding_dimensions: 向量维度
                - is_real_embedding: 是否使用真实嵌入
                - config: 完整配置
        """
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
        """
        设置记忆状态。
        
        从状态字典恢复记忆系统的状态。
        当前实现为空，需要根据持久化需求扩展。
        
        Args:
            state (dict): 记忆状态字典。
        
        Note:
            当前版本不支持从状态恢复，需要扩展实现。
        """
    
    def _calculate_similarity(
        self, 
        embedding1: np.ndarray, 
        embedding2: np.ndarray
    ) -> float:
        """
        计算两个向量之间的余弦相似度。
        
        余弦相似度衡量两个向量方向的相似程度，
        不考虑向量的大小。
        
        公式：
            similarity = dot(a, b) / (norm(a) * norm(b))
        
        Args:
            embedding1 (np.ndarray): 第一个向量。
            embedding2 (np.ndarray): 第二个向量。
        
        Returns:
            float: 余弦相似度，范围 -1 到 1。
                - 1: 完全相同方向
                - 0: 正交（无关）
                - -1: 完全相反方向
        
        Note:
            如果任一向量为零向量，返回 0。
        """
        norm1 = np.linalg.norm(embedding1)
        norm2 = np.linalg.norm(embedding2)
        
        if norm1 == 0 or norm2 == 0:
            return 0.0
        
        return float(np.dot(embedding1, embedding2) / (norm1 * norm2))
    
    @property
    def is_real_embedding(self) -> bool:
        """
        检查是否使用真实的嵌入模型。
        
        Returns:
            bool: 如果使用真实的嵌入模型返回 True，
                如果使用模拟嵌入返回 False。
        """
        return self._embedding_service.is_available
