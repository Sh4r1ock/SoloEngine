# -*- coding: utf-8 -*-
"""Plugins for SoloEngine."""

from .memory import VectorMemoryPlugin, BlackholeMemoryPlugin
from .rag import KnowledgeBaseRAGPlugin
from .tools import ToolkitExecutor, ToolResponse
from .mcp import SimpleMCPClient
from .hooks import *
from .plan import *

__all__ = [
    "VectorMemoryPlugin",
    "BlackholeMemoryPlugin",
    "KnowledgeBaseRAGPlugin",
    "ToolkitExecutor",
    "ToolResponse",
    "SimpleMCPClient",
]