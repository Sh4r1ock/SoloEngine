# -*- coding: utf-8 -*-
"""Memory plugins for SoloEngine."""

from .vector_memory import VectorMemoryPlugin
from .blackhole_memory import BlackholeMemoryPlugin

__all__ = [
    "VectorMemoryPlugin",
    "BlackholeMemoryPlugin",
]