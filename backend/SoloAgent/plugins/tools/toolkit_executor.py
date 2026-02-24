# -*- coding: utf-8 -*-
"""Toolkit executor plugin for SoloEngine."""

from typing import List, Dict, Any, Optional, Callable, Union, Awaitable
import inspect
import asyncio

from ...core.interfaces import IToolExecutor
from ...exception import (
    ToolNotFoundError,
    ToolInvalidArgumentsError,
)
from ...types import ToolFunction
from .calculator import calculator


class ToolResponse:
    """Response from tool execution."""
    
    def __init__(
        self,
        content: Union[str, List[Dict[str, Any]]],
        success: bool = True,
        error_message: Optional[str] = None,
    ) -> None:
        self.content = content
        self.success = success
        self.error_message = error_message
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "content": self.content,
            "success": self.success,
            "error_message": self.error_message,
        }


class ToolkitExecutor(IToolExecutor):
    """Toolkit executor plugin."""
    
    def __init__(self, tool_configs: Optional[List[Dict[str, Any]]] = None) -> None:
        """Initialize toolkit executor.
        
        Args:
            tool_configs: List of tool configurations
        """
        self._tools: Dict[str, Dict[str, Any]] = {}
        
        # Register tools from configs
        if tool_configs:
            for config in tool_configs:
                self._register_tool_from_config(config)
    
    async def execute(self, tool_call: Dict[str, Any], **kwargs) -> Dict[str, Any]:
        """Execute a tool call."""
        tool_name = tool_call.get("name")
        arguments = tool_call.get("arguments", {})
        
        if not tool_name:
            raise ToolInvalidArgumentsError("Tool name is required")
        
        if tool_name not in self._tools:
            raise ToolNotFoundError(f"Tool '{tool_name}' not found")
        
        tool_info = self._tools[tool_name]
        tool_func = tool_info["function"]
        
        try:
            # Execute tool function
            if inspect.iscoroutinefunction(tool_func):
                result = await tool_func(**arguments)
            else:
                result = tool_func(**arguments)
            
            # Convert to ToolResponse if needed
            if isinstance(result, ToolResponse):
                return result.to_dict()
            elif isinstance(result, dict):
                return result
            else:
                return {"content": str(result), "success": True}
                
        except Exception as e:
            return {
                "content": str(e),
                "success": False,
                "error_message": str(e),
            }
    
    def get_available_tools(self) -> List[Dict[str, Any]]:
        """Get list of available tools."""
        tools = []
        for tool_name, tool_info in self._tools.items():
            tools.append({
                "name": tool_name,
                "description": tool_info.get("description", ""),
                "parameters": tool_info.get("parameters", {}),
            })
        return tools
    
    async def register_tool(self, tool_spec: Dict[str, Any]) -> None:
        """Register a new tool."""
        self._register_tool_from_config(tool_spec)
    
    def _register_tool_from_config(self, config: Dict[str, Any]) -> None:
        """Register tool from configuration."""
        tool_name = config.get("name")
        if not tool_name:
            raise ValueError("Tool name is required")
        
        # Extract tool function
        tool_func = config.get("function")
        if not callable(tool_func):
            raise ValueError(f"Tool '{tool_name}' must have a callable function")
        
        # Extract metadata
        description = config.get("description", "")
        parameters = config.get("parameters", {})
        
        self._tools[tool_name] = {
            "function": tool_func,
            "description": description,
            "parameters": parameters,
        }
    
    def register_function(
        self,
        func: Callable,
        name: Optional[str] = None,
        description: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Register a function as a tool."""
        tool_name = name or func.__name__
        
        self._tools[tool_name] = {
            "function": func,
            "description": description or func.__doc__ or "",
            "parameters": parameters or self._infer_parameters(func),
        }
    
    def _infer_parameters(self, func: Callable) -> Dict[str, Any]:
        """Infer parameters from function signature."""
        sig = inspect.signature(func)
        parameters = {}
        
        for param_name, param in sig.parameters.items():
            if param_name == "self":
                continue
                
            param_info = {
                "type": str(param.annotation) if param.annotation != inspect.Parameter.empty else "any",
                "required": param.default == inspect.Parameter.empty,
            }
            
            if param.default != inspect.Parameter.empty:
                param_info["default"] = param.default
            
            parameters[param_name] = param_info
        
        return parameters


# Example tool functions
async def search_tool(query: str, limit: int = 5) -> ToolResponse:
    """Search for information."""
    return ToolResponse(content=f"Search results for '{query}' (limit: {limit})")

async def calculator_tool(expression: str) -> ToolResponse:
    """Evaluate a mathematical expression safely."""
    result = calculator.evaluate(expression)
    
    if result["success"]:
        return ToolResponse(content=f"{expression} = {result['result']}")
    else:
        return ToolResponse(
            content=f"Error evaluating expression: {result['error']}",
            success=False,
            error_message=result["error"],
        )