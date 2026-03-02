# -*- coding: utf-8 -*-
"""
网络工具模块。

@file __init__.py
@description 提供网络相关工具的统一导出
@author SoloEngine Team
@date 2026-03-02

功能描述：
- WebSearch: 网络搜索工具
- WebFetch: 网页获取工具
- BaseNetworkTool: 网络工具基类
- NetworkToolError: 网络工具错误类

状态: ✅ 模块初始化完成
"""

from .base import (
    BaseNetworkTool,
    NetworkToolError,
    NetworkResponse,
)

from .web_search import (
    WebSearch,
    SearchResult,
    web_search,
    get_web_search_tool_spec,
)

from .web_fetch import (
    WebFetch,
    HTMLToMarkdownConverter,
    web_fetch,
    get_web_fetch_tool_spec,
)

__all__ = [
    "BaseNetworkTool",
    "NetworkToolError",
    "NetworkResponse",
    "WebSearch",
    "SearchResult",
    "web_search",
    "get_web_search_tool_spec",
    "WebFetch",
    "HTMLToMarkdownConverter",
    "web_fetch",
    "get_web_fetch_tool_spec",
]
