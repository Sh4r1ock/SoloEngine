# -*- coding: utf-8 -*-
"""The exception module in SoloEngine."""

from .exception_base import AgentOrientedExceptionBase
from .tool import (
    ToolNotFoundError,
    ToolInterruptedError,
    ToolInvalidArgumentsError,
)

__all__ = [
    "AgentOrientedExceptionBase",
    "ToolNotFoundError",
    "ToolInterruptedError",
    "ToolInvalidArgumentsError",
]