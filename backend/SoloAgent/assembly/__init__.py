# -*- coding: utf-8 -*-
"""Assembly layer for SoloEngine."""

from .assembler import ReActAgent
from .presets import (
    StandardAgent,
    ReActWithRAG,
    SimpleAgent,
    MultiMCPAgent,
    PlanningAgent,
)

__all__ = [
    "ReActAgent",
    "StandardAgent",
    "ReActWithRAG",
    "SimpleAgent",
    "MultiMCPAgent",
    "PlanningAgent",
]