# -*- coding: utf-8 -*-
"""Simple MCP client plugin for SoloEngine."""

from typing import List, Dict, Any, Optional
import asyncio

from ...core.interfaces import IMCPClient


class SimpleMCPClient(IMCPClient):
    """Simple MCP client implementation."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        """Initialize simple MCP client.
        
        Args:
            config: Configuration dictionary. Currently not used.
        """
        self.config = config or {}
        self._connected = False
        self._tools: List[Dict[str, Any]] = []
    
    async def connect(self) -> None:
        """Connect to the MCP server."""
        if self._connected:
            return
        
        # Simulate connection delay
        await asyncio.sleep(0.1)
        self._connected = True
        
        # Simulate discovering some tools
        self._tools = [
            {
                "name": "mcp_search",
                "description": "Search using MCP server",
                "parameters": {
                    "query": {"type": "string", "required": True},
                    "limit": {"type": "integer", "required": False, "default": 5},
                }
            },
            {
                "name": "mcp_calculate",
                "description": "Calculate using MCP server",
                "parameters": {
                    "expression": {"type": "string", "required": True},
                }
            }
        ]
    
    async def disconnect(self) -> None:
        """Disconnect from the MCP server."""
        self._connected = False
        self._tools = []
    
    async def get_tools(self) -> List[Dict[str, Any]]:
        """Get tools from the MCP server."""
        if not self._connected:
            await self.connect()
        return self._tools
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool on the MCP server."""
        if not self._connected:
            await self.connect()
        
        # Simulate tool execution
        if tool_name == "mcp_search":
            query = arguments.get("query", "")
            limit = arguments.get("limit", 5)
            return {
                "content": f"MCP search results for '{query}' (limit: {limit})",
                "success": True,
            }
        elif tool_name == "mcp_calculate":
            expression = arguments.get("expression", "")
            try:
                result = eval(expression, {"__builtins__": {}})
                return {
                    "content": f"MCP calculation: {expression} = {result}",
                    "success": True,
                }
            except Exception as e:
                return {
                    "content": f"MCP calculation error: {e}",
                    "success": False,
                    "error_message": str(e),
                }
        else:
            return {
                "content": f"Tool '{tool_name}' not found",
                "success": False,
                "error_message": f"Tool '{tool_name}' not available",
            }