# -*- coding: utf-8 -*-
"""
SoloEngine : 日志配置模块

@file logging.py
@description 提供SoloEngine的日志配置
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供日志配置，包括：
    - logger: SoloEngine日志记录器
    - 配置控制台输出
    - 设置日志格式和级别

依赖:
    - logging: Python日志模块
    - sys: 系统模块

使用示例:
    - from SoloAgent.utils import logger
    - logger.info("信息日志")
    - logger.error("错误日志")
"""

import logging
import sys

# Create logger
logger = logging.getLogger("SoloEngine")
"""SoloEngine日志记录器"""

logger.setLevel(logging.INFO)

# Create console handler
console_handler = logging.StreamHandler(sys.stdout)
"""控制台日志处理器"""

console_handler.setLevel(logging.INFO)

# Create formatter
formatter = logging.Formatter(
    "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
"""日志格式器"""

# Add formatter to console handler
console_handler.setFormatter(formatter)

# Add console handler to logger
logger.addHandler(console_handler)

# 阻止日志向 root logger 传播，避免被 basicConfig 配置的 root handler 重复输出
logger.propagate = False

__all__ = ["logger"]
