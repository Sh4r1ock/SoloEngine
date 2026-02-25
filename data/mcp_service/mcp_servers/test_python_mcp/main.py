#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_python_mcp MCP Server - 用户自定义工具

Test Python MCP Server
"""

import json
import asyncio
from typing import Sequence

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, ImageContent, EmbeddedResource


def hello(name: str) -> dict:
    """
    Say hello to someone
    """
    import logging
    logger = logging.getLogger("test_python_mcp")
    logger.info(f"Tool hello called")
    return {
        "tool": "hello",
        "status": "executed",
        "params": {k: v for k, v in locals().items() if k != 'logger'}
    }



async def serve() -> None:
    server = Server("test_python_mcp")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [
        Tool(
            name="hello",
            description="Say hello to someone",
            inputSchema={"type": "object", "properties": {"name": {"type": "string", "description": "Name to greet"}}, "required": ["name"]},
        ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> Sequence[TextContent | ImageContent | EmbeddedResource]:
        try:
            match name:
        case "hello":
            result = hello(**arguments)
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
