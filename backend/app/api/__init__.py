# -*- coding: utf-8 -*-
"""
SoloEngine : API模块入口

@file __init__.py
@description API模块入口，导出所有API子模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是API模块的入口，包含以下子模块：
    - v1: API v1版本模块

依赖:
    - app.api.v1: API v1版本

使用示例:
    - from app.api import v1
"""

from . import v1

__all__ = ["v1"]
