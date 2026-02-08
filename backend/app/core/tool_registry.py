from typing import Dict, Any, Callable, Optional
import asyncio

class ToolRegistry:
    def __init__(self):
        self.tools: Dict[str, Callable] = {}
        self.mcp_clients: Dict[str, Any] = {}
    
    def register(self, tool_name: str, tool_func: Callable):
        self.tools[tool_name] = tool_func
    
    def register_mcp_client(self, client_name: str, client: Any):
        self.mcp_clients[client_name] = client
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        if tool_name not in self.tools:
            raise ValueError(f"Tool {tool_name} not found")
        
        tool_func = self.tools[tool_name]
        
        if asyncio.iscoroutinefunction(tool_func):
            return await tool_func(**arguments)
        else:
            return tool_func(**arguments)
    
    def get_available_tools(self) -> Dict[str, str]:
        return {name: func.__doc__ or "No description" for name, func in self.tools.items()}
    
    def has_tool(self, tool_name: str) -> bool:
        return tool_name in self.tools

tool_registry = ToolRegistry()

async def example_search_tool(query: str) -> str:
    return f"Search results for: {query}"

async def example_file_tool(file_path: str) -> str:
    return f"File content from: {file_path}"

tool_registry.register("search", example_search_tool)
tool_registry.register("read_file", example_file_tool)
