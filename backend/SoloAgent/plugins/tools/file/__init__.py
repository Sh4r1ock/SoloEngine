# -*- coding: utf-8 -*-
"""
文件操作工具模块。

@file __init__.py
@description 提供文件操作相关工具的统一导出
@author SoloEngine Team
@date 2026-03-02

功能描述：
- Read: 读取文件内容
- Write: 写入文件内容
- SearchReplace: 搜索并替换文件内容
- DeleteFile: 删除文件
- LS: 列出目录内容

状态: ✅ 模块初始化完成
"""

from .base import BaseFileTool, FileToolError
from .read import Read, read_file, get_read_tool_spec
from .write import Write, write_file, get_write_tool_spec
from .search_replace import SearchReplace, search_replace, get_search_replace_tool_spec
from .delete_file import DeleteFile, delete_files, get_delete_file_tool_spec
from .ls import LS, list_directory, get_ls_tool_spec

__all__ = [
    "BaseFileTool",
    "FileToolError",
    "Read",
    "read_file",
    "get_read_tool_spec",
    "Write",
    "write_file",
    "get_write_tool_spec",
    "SearchReplace",
    "search_replace",
    "get_search_replace_tool_spec",
    "DeleteFile",
    "delete_files",
    "get_delete_file_tool_spec",
    "LS",
    "list_directory",
    "get_ls_tool_spec",
]
