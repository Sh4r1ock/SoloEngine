# -*- coding: utf-8 -*-
"""The model usage class in SoloEngine."""

from dataclasses import dataclass, field
from typing import Literal

from ..utils import DictMixin


@dataclass
class ChatUsage(DictMixin):
    """The usage of a chat model API invocation."""

    input_tokens: int
    """The number of input tokens."""

    output_tokens: int
    """The number of output tokens."""

    time: float
    """The time used in seconds."""

    type: Literal["chat"] = field(default_factory=lambda: "chat")
    """The type of the usage, must be `chat`."""