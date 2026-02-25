#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_full_compile - MCP Server
完整测试编译的 MCP Server

此文件由 MCP Service 自动生成。
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("test_full_compile")


@mcp.tool()
def calculate_tool(a: int, b: int) -> str:
    """计算两个整数的和、差、积"""
    import json
    from original import calculate
    
    result = calculate(a=a, b=b)
    
    if isinstance(result, dict):
        return json.dumps(result, ensure_ascii=False)
    return str(result)


@mcp.tool()
def greet_tool(name: str) -> str:
    """向用户打招呼"""
    import json
    from original import greet
    
    result = greet(name=name)
    
    if isinstance(result, dict):
        return json.dumps(result, ensure_ascii=False)
    return str(result)


if __name__ == "__main__":
    mcp.run(transport="stdio")
