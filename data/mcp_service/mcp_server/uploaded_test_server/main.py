#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""测试上传的 MCP Server"""

import json
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("uploaded_test_server")

@mcp.tool()
def hello(name: str) -> str:
    """打招呼工具"""
    return f"Hello, {name}!"

@mcp.tool()
def add(a: int, b: int) -> str:
    """加法工具"""
    result = a + b
    return json.dumps({"a": a, "b": b, "result": result})

if __name__ == "__main__":
    mcp.run(transport="stdio")
