# -*- coding: utf-8 -*-
"""
SoloEngine : 通用工具模块，提供常用工具函数

@file common.py
@description 提供常用工具函数
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心工具函数：
    - _get_timestamp: 获取时间戳
    - _save_base64_data: 保存Base64数据
    - _json_loads_with_repair: 带修复的JSON加载

依赖:
    - os: 操作系统接口
    - tempfile: 临时文件
    - base64: Base64编码
    - json: JSON处理
    - datetime: 时间处理
    - json_repair: JSON修复
    - .logging: 日志模块

使用示例:
    - from SoloAgent.utils import _get_timestamp
    - timestamp = _get_timestamp()
"""

import os
import tempfile
import base64
import json
from datetime import datetime
from zoneinfo import ZoneInfo
from app.core.config import settings
from json_repair import repair_json
from .logging import logger


def _get_timestamp(add_random_suffix: bool = False) -> str:
    """
    获取当前时间戳
    
    Args:
        add_random_suffix: 是否添加随机后缀
    
    Returns:
        格式化的时间戳字符串，格式为 YYYY-MM-DD HH:MM:SS.sss
    
    Example:
        >>> timestamp = _get_timestamp()
        >>> timestamp_with_suffix = _get_timestamp(add_random_suffix=True)
    """
    timestamp = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    if add_random_suffix:
        # Add a random suffix to the timestamp
        timestamp += f"_{os.urandom(3).hex()}"
    
    return timestamp


def _save_base64_data(base64_string: str, output_path: str = None) -> str:
    """
    保存Base64编码数据到文件
    
    Args:
        base64_string: Base64编码字符串（可能包含data URI前缀）
        output_path: 输出文件路径，如果为None则创建临时文件
        
    Returns:
        保存文件的路径
    
    Example:
        >>> path = _save_base64_data("data:image/png;base64,iVBORw0KGgo...")
    """
    # Remove data URI prefix if present
    if ',' in base64_string:
        base64_string = base64_string.split(',')[1]
    
    # Decode base64 data
    data = base64.b64decode(base64_string)
    
    # Create output path if not provided
    if output_path is None:
        output_path = os.path.join(tempfile.gettempdir(), f"soloagent_{_get_timestamp(True)}.bin")
    
    # Write data to file
    with open(output_path, 'wb') as f:
        f.write(data)
    
    logger.debug(f"Saved base64 data to: {output_path}")
    return output_path


def _json_loads_with_repair(json_string: str) -> dict:
    """
    解析JSON字符串，支持自动修复格式错误的JSON
    
    Args:
        json_string: 要解析的JSON字符串
        
    Returns:
        解析后的字典对象
        
    Raises:
        json.JSONDecodeError: 如果即使修复后也无法解析JSON
    
    Example:
        >>> data = _json_loads_with_repair('{"key": "value"}')
    """
    try:
        # Try standard JSON parsing first
        return json.loads(json_string)
    except json.JSONDecodeError:
        # Try to repair and parse
        repaired = repair_json(json_string)
        return json.loads(repaired)
