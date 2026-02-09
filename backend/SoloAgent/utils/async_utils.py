# -*- coding: utf-8 -*-
"""Async utilities for SoloEngine."""

from typing import Any


class AsyncNullContext:
    """An async null context manager."""

    async def __aenter__(self) -> None:
        return None

    async def __aexit__(
        self,
        exc_type: Any,
        exc_val: Any,
        exc_tb: Any,
    ) -> None:
        return None