# -*- coding: utf-8 -*-
"""Session module for SoloEngine."""

from .session_base import SessionBase
from .json_session import JSONSession

__all__ = ["SessionBase", "JSONSession"]