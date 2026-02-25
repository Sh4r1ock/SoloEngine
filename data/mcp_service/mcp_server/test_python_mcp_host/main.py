#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_python_mcp_host MCP Server - 用户自定义工具

测试 Python MCP - 用于验证 Host 功能
"""

import json
import asyncio
from typing import Sequence

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, ImageContent, EmbeddedResource


def echo(message: str) -> dict:
    """
    回显输入的消息
    """
    import logging
    logger = logging.getLogger("test_python_mcp_host")
    logger.info(f"Tool echo called")
    return {
        "tool": "echo",
        "status": "executed",
        "params": {k: v for k, v in locals().items() if k != 'logger'}
    }


def add(a: int, b: int) -> dict:
    """
    计算两个数字的和
    """
    import logging
    logger = logging.getLogger("test_python_mcp_host")
    logger.info(f"Tool add called")
    return {
        "tool": "add",
        "status": "executed",
        "params": {k: v for k, v in locals().items() if k != 'logger'}
    }



async def serve() -> None:
    server = Server("test_python_mcp_host")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [
        Tool(
            name="echo",
            description="回显输入的消息",
            inputSchema={"type": "object", "properties": {"message": {"type": "string", "description": "要回显的消息"}}, "required": ["message"]},
        ),
        Tool(
            name="add",
            description="计算两个数字的和",
            inputSchema={"type": "object", "properties": {"a": {"type": "integer", "description": "第一个数字"}, "b": {"type": "integer", "description": "第二个数字"}}, "required": ["a", "b"]},
        ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> Sequence[TextContent | ImageContent | EmbeddedResource]:
        try:
            match name:
        case "echo":
            result = echo(**arguments)
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]
        case "add":
            result = add(**arguments)
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]

            case _:
                raise ValueError(f"Unknown tool: {name}")
        except Exception as e:
            return [TextContent(type="text", text=json.dumps({"error": str(e)}, ensure_ascii=False))]

    options = server.create_initialization_options()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, options)

if __name__ == "__main__":
    asyncio.run(serve())
