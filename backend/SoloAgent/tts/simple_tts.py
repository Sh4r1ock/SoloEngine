# -*- coding: utf-8 -*-
"""Simple TTS model for SoloEngine."""

from typing import Any
from ..core.interfaces import ITTSModel


class SimpleTTSModel(ITTSModel):
    """Simple TTS model that returns empty audio data.
    
    This is a placeholder implementation for environments where
    TTS is not needed or not supported.
    """
    
    async def synthesize(self, text: str, **kwargs) -> bytes:
        """Synthesize speech from text.
        
        Returns empty bytes as a placeholder.
        
        Args:
            text: Text to synthesize.
            **kwargs: Additional arguments (ignored).
            
        Returns:
            Empty bytes.
        """
        # Log that TTS was called (optional)
        # import logging
        # logging.getLogger(__name__).info(f"TTS synthesized: {text[:50]}...")
        return b""