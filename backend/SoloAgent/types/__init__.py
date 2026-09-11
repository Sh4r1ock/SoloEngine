# -*- coding: utf-8 -*-
"""
SoloEngine : Types类型模块，提供类型定义

@file __init__.py
@description Types类型模块入口，统一导出类型定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是Types类型的入口，提供以下核心类型的统一导出：
    - Embedding: 嵌入向量类型
    - JSONPrimitive: JSON基本类型
    - JSONSerializableObject: JSON可序列化对象

依赖:
    - .object: 对象类型
    - .json: JSON类型
    - .protocols: 协议类型

使用示例:
    - from SoloAgent.types import Embedding
"""

from .object import Embedding
from .json import (
    JSONPrimitive,
    JSONSerializableObject,
)
from .protocols import StreamCallback

__all__ = [
    "Embedding",
    "JSONPrimitive",
    "JSONSerializableObject",
    "StreamCallback",
]
