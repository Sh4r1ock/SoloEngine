# -*- coding: utf-8 -*-
"""
SoloEngine : RAG插件模块，提供检索增强生成功能

@file __init__.py
@description RAG插件模块入口，统一导出RAG相关类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是RAG插件的入口，提供以下核心组件的统一导出：
    - KnowledgeBaseRAGPlugin: 知识库RAG插件

依赖:
    - .knowledge_base_rag: 知识库RAG实现

使用示例:
    - from SoloAgent.plugins.rag import KnowledgeBaseRAGPlugin
    - rag = KnowledgeBaseRAGPlugin(config)
"""

from .knowledge_base_rag import KnowledgeBaseRAGPlugin

__all__ = [
    "KnowledgeBaseRAGPlugin",
]
