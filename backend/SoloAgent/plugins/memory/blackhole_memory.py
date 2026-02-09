# -*- coding: utf-8 -*-
"""Blackhole memory plugin - empty implementation for disabling memory."""

from typing import List

from ...core.interfaces import IMemory
from ...message import Msg


class BlackholeMemoryPlugin(IMemory):
    """Empty memory plugin that discards all messages."""
    
    async def add(self, msg: Msg) -> None:
        """Do nothing."""
        pass
    
    async def retrieve(self, query: str, limit: int = 5) -> List[Msg]:
        """Return empty list."""
        return []
    
    async def clear(self) -> None:
        """Do nothing."""
        pass
    
    async def get_memory_state(self) -> dict:
        """Return empty state."""
        return {"type": "blackhole", "message_count": 0}
    
    async def set_memory_state(self, state: dict) -> None:
        """Ignore state."""
        pass