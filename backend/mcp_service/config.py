# -*- coding: utf-8 -*-
"""
MCP Service 配置模块。
"""

import os
from typing import Optional

MCP_SERVICE_PORT = 8992
MCP_SERVICE_HOST = "0.0.0.0"

DEFAULT_TIMEOUT = 30
MAX_TOOL_ARGUMENTS_SIZE = 1024 * 1024

CORS_ORIGINS = [
    "http://localhost:8991",
    "http://127.0.0.1:8991",
    "http://localhost:8990",
    "http://127.0.0.1:8990",
]
