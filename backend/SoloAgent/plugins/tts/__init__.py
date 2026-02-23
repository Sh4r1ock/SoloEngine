# -*- coding: utf-8 -*-
"""TTS plugins for SoloEngine."""

from ..core.interfaces import ITTSModel

__all__ = [
    "ITTSModel",
    "OpenAITTSModel",
    "AzureTTSModel", 
    "EdgeTTSModel",
    "LocalTTSModel",
]

try:
    from .openai_tts import OpenAITTSModel
except ImportError:
    OpenAITTSModel = None

try:
    from .azure_tts import AzureTTSModel
except ImportError:
    AzureTTSModel = None

try:
    from .edge_tts import EdgeTTSModel
except ImportError:
    EdgeTTSModel = None

try:
    from .local_tts import LocalTTSModel
except ImportError:
    LocalTTSModel = None
