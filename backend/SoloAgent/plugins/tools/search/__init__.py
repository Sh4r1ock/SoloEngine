# -*- coding: utf-8 -*-
"""
SoloEngine : 搜索工具模块，提供代码搜索和文件匹配功能

@file __init__.py
@description 提供代码搜索相关工具的统一导出
@author Sh4rlock
@date 2026-04-09

功能描述：
- SearchCodebase: 代码库语义搜索
- Grep: 正则表达式搜索
- Glob: 文件模式匹配
- BaseSearchTool: 搜索工具基类
- SearchToolError: 搜索工具错误

状态: ✅ 模块初始化完成
"""

from .base import BaseSearchTool, SearchToolError
from .search_codebase import SearchCodebase, search_codebase
from .grep import Grep, grep
from .glob import Glob, glob_search

__all__ = [
    "BaseSearchTool",
    "SearchToolError",
    "SearchCodebase",
    "search_codebase",
    "Grep",
    "grep",
    "Glob",
    "glob_search",
]
