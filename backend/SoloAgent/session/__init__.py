# -*- coding: utf-8 -*-
"""
SoloEngine : Session模块，提供会话管理功能

@file __init__.py
@description Session模块入口，统一导出会话类
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是Session模块的入口，提供以下核心会话类的统一导出：
    - SessionBase: 会话基类
    - JSONSession: JSON会话实现

依赖:
    - .session_base: 会话基类
    - .json_session: JSON会话实现

使用示例:
    - from SoloAgent.session import JSONSession
    - session = JSONSession()
"""

from .session_base import SessionBase
from .json_session import JSONSession

__all__ = ["SessionBase", "JSONSession"]
