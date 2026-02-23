# -*- coding: utf-8 -*-
"""Embedding module for SoloEngine."""

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
