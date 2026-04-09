# -*- coding: utf-8 -*-
"""
SoloEngine : Embedding模块，提供文本嵌入功能

@file __init__.py
@description Embedding模块入口，统一导出嵌入相关类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是Embedding模块的入口，提供以下核心类的统一导出：
    - EmbeddingModelBase: 嵌入模型基类
    - EmbeddingResponse: 嵌入响应
    - EmbeddingUsage: 嵌入使用统计
    - EmbeddingCacheBase: 嵌入缓存基类
    - FileEmbeddingCache: 文件嵌入缓存
    - OpenAITextEmbedding: OpenAI文本嵌入
    - OllamaTextEmbedding: Ollama文本嵌入
    - EmbeddingService: 嵌入服务
    - EmbeddingConfig: 嵌入配置
    - get_embedding_service: 获取嵌入服务函数

依赖:
    - .embedding_base: 嵌入模型基类
    - .embedding_response: 嵌入响应
    - .embedding_usage: 嵌入使用统计
    - .cache_base: 缓存基类
    - .file_cache: 文件缓存
    - .openai_embedding: OpenAI嵌入
    - .ollama_embedding: Ollama嵌入
    - .embedding_service: 嵌入服务

使用示例:
    - from SoloAgent.embedding import OpenAITextEmbedding
    - embedding = OpenAITextEmbedding(api_key="your_key")
"""

from .embedding_base import EmbeddingModelBase
from .embedding_response import EmbeddingResponse
from .embedding_usage import EmbeddingUsage
from .cache_base import EmbeddingCacheBase
from .file_cache import FileEmbeddingCache
from .openai_embedding import OpenAITextEmbedding
from .ollama_embedding import OllamaTextEmbedding
from .embedding_service import EmbeddingService, EmbeddingConfig, get_embedding_service

__all__ = [
    "EmbeddingModelBase",
    "EmbeddingResponse",
    "EmbeddingUsage",
    "EmbeddingCacheBase",
    "FileEmbeddingCache",
    "OpenAITextEmbedding",
    "OllamaTextEmbedding",
    "EmbeddingService",
    "EmbeddingConfig",
    "get_embedding_service",
]
