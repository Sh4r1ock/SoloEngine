#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_new_python_mcp - MCP Server
Test Python MCP

此文件由 MCP Service 自动生成。
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("test_new_python_mcp")


@mcp.tool()
def main_tool(query: str) -> str:
    """Test function"""
    import json
    from original import main
    
    result = main(query=query)
    
    if isinstance(result, dict):
        return json.dumps(result, ensure_ascii=False)
    return str(result)


if __name__ == "__main__":
    mcp.run(transport="stdio")
