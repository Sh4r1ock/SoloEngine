#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""测试上传的 MCP Server 包"""

import json
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("test_uploaded_package")

@mcp.tool()
def multiply(a: int, b: int) -> str:
    """乘法工具"""
    result = a * b
    return json.dumps({"a": a, "b": b, "result": result})

if __name__ == "__main__":
    mcp.run(transport="stdio")
