# -*- coding: utf-8 -*-
"""
SoloEngine : 对象类型定义模块

@file object.py
@description 定义对象类型
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供对象类型定义，包括：
    - Embedding: 嵌入向量类型

依赖:
    - typing: 类型提示

使用示例:
    - from SoloAgent.types import Embedding
    - embedding: Embedding = [0.1, 0.2, 0.3]
"""
from typing import List

Embedding = List[float]
"""嵌入向量类型，浮点数列表"""