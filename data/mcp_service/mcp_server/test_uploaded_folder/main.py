#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""测试上传的 MCP Server 文件夹"""

import json
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("test_uploaded_folder")

@mcp.tool()
def divide(a: int, b: int) -> str:
    """除法工具"""
    if b == 0:
        return json.dumps({"error": "Division by zero"})
    result = a / b
    return json.dumps({"a": a, "b": b, "result": result})

if __name__ == "__main__":
    mcp.run(transport="stdio")
