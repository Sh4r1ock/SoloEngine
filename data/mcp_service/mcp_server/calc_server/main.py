#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
calc_server - MCP Server
计算器 MCP Server

此文件由 MCP Service 自动生成。
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("calc_server")


@mcp.tool()
def calculate_tool(a: int, b: int) -> str:
    """计算两个整数的和、差、积"""
    import json
    from original import calculate
    
    result = calculate(a=a, b=b)
    
    if isinstance(result, dict):
        return json.dumps(result, ensure_ascii=False)
    return str(result)


if __name__ == "__main__":
    mcp.run(transport="stdio")
