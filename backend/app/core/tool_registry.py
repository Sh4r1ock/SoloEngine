# -*- coding: utf-8 -*-
"""
工具注册表模块。

@file tool_registry.py
@description 工具注册表 - 工具管理和执行模块
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 注册和管理工具
- 支持Python函数工具
- 支持MCP工具调用
- 工具发现和执行
"""
from typing import Dict, Any, Callable, Optional, List
import asyncio
import json
import logging
import os
import subprocess
import httpx
from datetime import datetime

logger = logging.getLogger(__name__)


class ToolInfo:
    """工具信息。"""
    
    def __init__(
        self,
        name: str,
        description: str,
        func: Callable = None,
        parameters: Dict[str, Any] = None,
        tool_type: str = "python",
        server_id: str = None,
    ):
        self.name = name
        self.description = description
        self.func = func
        self.parameters = parameters or {}
        self.tool_type = tool_type
        self.server_id = server_id
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "tool_type": self.tool_type,
            "server_id": self.server_id,
        }


class ToolRegistry:
    """工具注册表。"""
    
    def __init__(self):
        self.tools: Dict[str, ToolInfo] = {}
        self.mcp_clients: Dict[str, Any] = {}
        self._register_builtin_tools()
    
    def _register_builtin_tools(self):
        """注册内置工具。"""
        self.register(
            "search",
            self._search_tool,
            description="搜索工具，用于搜索信息",
            parameters={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索查询"}
                },
                "required": ["query"]
            }
        )
        
        self.register(
            "read_file",
            self._read_file_tool,
            description="读取文件内容",
            parameters={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径"}
                },
                "required": ["file_path"]
            }
        )
        
        self.register(
            "write_file",
            self._write_file_tool,
            description="写入文件内容",
            parameters={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件路径"},
                    "content": {"type": "string", "description": "文件内容"}
                },
                "required": ["file_path", "content"]
            }
        )
        
        self.register(
            "execute_command",
            self._execute_command_tool,
            description="执行系统命令",
            parameters={
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "要执行的命令"},
                    "timeout": {"type": "integer", "description": "超时时间(秒)", "default": 30}
                },
                "required": ["command"]
            }
        )
        
        self.register(
            "http_request",
            self._http_request_tool,
            description="发送HTTP请求",
            parameters={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "请求URL"},
                    "method": {"type": "string", "description": "HTTP方法", "default": "GET"},
                    "headers": {"type": "object", "description": "请求头"},
                    "body": {"type": "object", "description": "请求体"}
                },
                "required": ["url"]
            }
        )
        
        self.register(
            "json_parse",
            self._json_parse_tool,
            description="解析JSON字符串",
            parameters={
                "type": "object",
                "properties": {
                    "json_string": {"type": "string", "description": "JSON字符串"}
                },
                "required": ["json_string"]
            }
        )
        
        self.register(
            "datetime_now",
            self._datetime_now_tool,
            description="获取当前日期时间",
            parameters={
                "type": "object",
                "properties": {
                    "format": {"type": "string", "description": "日期时间格式", "default": "%Y-%m-%d %H:%M:%S"}
                }
            }
        )
        
        self.register(
            "calculator",
            self._calculator_tool,
            description="计算器，执行数学表达式",
            parameters={
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "数学表达式"}
                },
                "required": ["expression"]
            }
        )
    
    def register(
        self,
        tool_name: str,
        tool_func: Callable,
        description: str = "",
        parameters: Dict[str, Any] = None,
        tool_type: str = "python",
        server_id: str = None,
    ):
        """注册工具。"""
        self.tools[tool_name] = ToolInfo(
            name=tool_name,
            description=description or tool_func.__doc__ or "No description",
            func=tool_func,
            parameters=parameters or {},
            tool_type=tool_type,
            server_id=server_id,
        )
        logger.debug(f"Registered tool: {tool_name}")
    
    def unregister(self, tool_name: str) -> bool:
        """注销工具。"""
        if tool_name in self.tools:
            del self.tools[tool_name]
            return True
        return False
    
    def register_mcp_client(self, client_name: str, client: Any):
        """注册MCP客户端。"""
        self.mcp_clients[client_name] = client
    
    def unregister_mcp_client(self, client_name: str) -> bool:
        """注销MCP客户端。"""
        if client_name in self.mcp_clients:
            del self.mcp_clients[client_name]
            return True
        return False
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """调用工具。"""
        if tool_name not in self.tools:
            raise ValueError(f"Tool '{tool_name}' not found")
        
        tool_info = self.tools[tool_name]
        
        if tool_info.tool_type == "mcp" and tool_info.server_id:
            return await self._call_mcp_tool(tool_info.server_id, tool_name, arguments)
        
        tool_func = tool_info.func
        if tool_func is None:
            raise ValueError(f"Tool '{tool_name}' has no function")
        
        try:
            if asyncio.iscoroutinefunction(tool_func):
                return await tool_func(**arguments)
            else:
                return tool_func(**arguments)
        except Exception as e:
            logger.error(f"Error calling tool '{tool_name}': {e}")
            raise
    
    async def _call_mcp_tool(self, server_id: str, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """调用MCP工具。"""
        client = self.mcp_clients.get(server_id)
        if not client:
            raise ValueError(f"MCP client '{server_id}' not found")
        
        return await client.call_tool(tool_name, arguments)
    
    def get_available_tools(self) -> Dict[str, str]:
        """获取所有可用工具及其描述。"""
        return {name: info.description for name, info in self.tools.items()}
    
    def get_tool_info(self, tool_name: str) -> Optional[ToolInfo]:
        """获取工具信息。"""
        return self.tools.get(tool_name)
    
    def get_all_tools_info(self) -> List[Dict[str, Any]]:
        """获取所有工具信息。"""
        return [info.to_dict() for info in self.tools.values()]
    
    def has_tool(self, tool_name: str) -> bool:
        """检查工具是否存在。"""
        return tool_name in self.tools
    
    def list_tools(self) -> List[str]:
        """列出所有工具名称。"""
        return list(self.tools.keys())
    
    async def _search_tool(self, query: str) -> str:
        """搜索工具实现。"""
        return f"Search results for: {query}"
    
    async def _read_file_tool(self, file_path: str) -> str:
        """读取文件工具实现。"""
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return f"Error: File '{file_path}' not found"
        except Exception as e:
            return f"Error reading file: {str(e)}"
    
    async def _write_file_tool(self, file_path: str, content: str) -> str:
        """写入文件工具实现。"""
        try:
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Successfully wrote to '{file_path}'"
        except Exception as e:
            return f"Error writing file: {str(e)}"
    
    async def _execute_command_tool(self, command: str, timeout: int = 30) -> str:
        """执行命令工具实现。"""
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            output = result.stdout
            if result.stderr:
                output += f"\nStderr: {result.stderr}"
            return output or "Command executed successfully (no output)"
        except subprocess.TimeoutExpired:
            return f"Error: Command timed out after {timeout} seconds"
        except Exception as e:
            return f"Error executing command: {str(e)}"
    
    async def _http_request_tool(
        self,
        url: str,
        method: str = "GET",
        headers: Dict[str, str] = None,
        body: Dict[str, Any] = None
    ) -> str:
        """HTTP请求工具实现。"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    json=body if body else None,
                    timeout=30
                )
                return json.dumps({
                    "status_code": response.status_code,
                    "headers": dict(response.headers),
                    "body": response.text[:5000]
                }, indent=2)
        except Exception as e:
            return f"Error making HTTP request: {str(e)}"
    
    async def _json_parse_tool(self, json_string: str) -> str:
        """JSON解析工具实现。"""
        try:
            data = json.loads(json_string)
            return json.dumps(data, indent=2, ensure_ascii=False)
        except json.JSONDecodeError as e:
            return f"Error parsing JSON: {str(e)}"
    
    async def _datetime_now_tool(self, format: str = "%Y-%m-%d %H:%M:%S") -> str:
        """获取当前时间工具实现。"""
        return datetime.now().strftime(format)
    
    async def _calculator_tool(self, expression: str) -> str:
        """计算器工具实现。"""
        try:
            allowed_chars = set("0123456789+-*/.() ")
            if not all(c in allowed_chars for c in expression):
                return "Error: Invalid characters in expression"
            
            result = eval(expression)
            return str(result)
        except Exception as e:
            return f"Error calculating expression: {str(e)}"


tool_registry = ToolRegistry()
