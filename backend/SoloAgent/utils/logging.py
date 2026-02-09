# -*- coding: utf-8 -*-
"""Logging configuration for SoloEngine."""

import logging
import sys

# Create logger
logger = logging.getLogger("SoloEngine")
logger.setLevel(logging.INFO)

# Create console handler
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)

# Create formatter
formatter = logging.Formatter(
    "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

# Add formatter to console handler
console_handler.setFormatter(formatter)

# Add console handler to logger
logger.addHandler(console_handler)

__all__ = ["logger"]