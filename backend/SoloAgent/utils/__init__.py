# -*- coding: utf-8 -*-
"""
SoloEngine : Utils工具模块，提供通用工具函数

@file __init__.py
@description Utils工具模块入口，统一导出工具函数
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是Utils工具的入口，提供以下核心工具的统一导出：
    - logger: 日志记录器
    - get_timestamp: 获取时间戳
    - save_base64_data: 保存Base64数据
    - json_loads_with_repair: 带修复的JSON加载
    - DictMixin: 字典混入类

依赖:
    - .logging: 日志模块
    - .common: 通用工具
    - .mixin: 混入类

使用示例:
    - from SoloAgent.utils import logger
    - logger.info("Hello")
"""

from .logging import logger
from .common import get_timestamp, save_base64_data, json_loads_with_repair
from .mixin import DictMixin
from .message_utils import MessageBlockExtractor

__all__ = [
    "logger",
    "get_timestamp",
    "save_base64_data",
    "json_loads_with_repair",
    "DictMixin",
    "MessageBlockExtractor",
]
