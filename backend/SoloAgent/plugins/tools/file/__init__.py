# -*- coding: utf-8 -*-
"""
SoloEngine : 文件操作工具模块，提供文件读写删除等功能

@file __init__.py
@description 提供文件操作相关工具的统一导出
@author Sh4rlock
@date 2026-04-09

功能描述：
- Read: 读取文件内容
- Write: 写入文件内容
- SearchReplace: 搜索并替换文件内容
- DeleteFile: 删除文件
- LS: 列出目录内容

状态: ✅ 模块初始化完成
"""

from .base import BaseFileTool, FileToolError
from .read import Read
from .write import Write
from .search_replace import SearchReplace
from .delete_file import DeleteFile
from .ls import LS

__all__ = [
    "BaseFileTool",
    "FileToolError",
    "Read",
    "Write",
    "SearchReplace",
    "DeleteFile",
    "LS",
]
