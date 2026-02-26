# -*- coding: utf-8 -*-
"""
Python Client - 包装用户自定义的Python函数。

用于连接自定义Python函数，无需MCP协议握手。
"""

import os
import sys
import json
import logging
import importlib.util
from typing import Dict, Any, Optional, List

from .base import BaseClient

logger = logging.getLogger(__name__)

MCP_SERVERS_STORAGE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "storage", "mcp_servers"
)


class PythonClient(BaseClient):
    """Python函数客户端。
    
    用于包装用户自定义的Python函数，不需要MCP协议握手。
    工具定义由前端配置提供。
    """
    
    def __init__(self, server_info: Any):
        """初始化Python客户端。
        
        Args:
            server_info: 服务器配置信息，需包含：
                - module: Python模块名（如 "my_tool"）
                - function: 函数名（默认main）
                - inputSchema: 输入参数Schema
                - outputSchema: 输出参数Schema
                - user_id: 用户ID
        """
        super().__init__(server_info)
        self._module = None
        self._function_name = "main"
        self._input_schema = {}
        self._output_schema = {}
    
    def _resolve_module_path(self) -> str:
        """解析模块路径。
        
        优先级：
        1. 如果args中有完整路径，直接使用
        2. 如果module配置存在，从storage/mcp_servers/{user_id}/{module}/main.py加载
        3. 否则抛出异常
        """
        module_path = getattr(self.server_info, 'args', None)
        if module_path and isinstance(module_path, list) and len(module_path) > 0:
            module_path = module_path[0]
            if os.path.isabs(module_path):
                return module_path
        
        module_name = getattr(self.server_info, 'module', None)
        user_id = getattr(self.server_info, 'user_id', 'default_user')
        
        if module_name:
            module_dir = os.path.join(MCP_SERVERS_STORAGE_DIR, user_id, module_name)
            module_path = os.path.join(module_dir, "main.py")
            return module_path
        
        raise ValueError("python transport requires either 'args' with module path or 'module' name")
    
    async def connect(self) -> None:
        """加载Python模块。"""
        if self._connected:
            return
        
        module_path = self._resolve_module_path()
        
        function_name = getattr(self.server_info, 'function', None)
        self._function_name = function_name or "main"
        
        self._input_schema = getattr(self.server_info, 'input_schema', {}) or {}
        self._output_schema = getattr(self.server_info, 'output_schema', {}) or {}
        
        if not os.path.exists(module_path):
            raise ValueError(f"Module path does not exist: {module_path}")
        
        try:
            module_name = os.path.splitext(os.path.basename(module_path))[0]
            
            module_dir = os.path.dirname(module_path)
            if module_dir not in sys.path:
                sys.path.insert(0, module_dir)
            
            spec = importlib.util.spec_from_file_location(module_name, module_path)
            if not spec or not spec.loader:
                raise ValueError(f"Failed to load module spec: {module_path}")
            
            self._module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = self._module
            spec.loader.exec_module(self._module)
            
            if not hasattr(self._module, self._function_name):
                raise ValueError(
                    f"Module does not have function '{self._function_name}'"
                )
            
            self._tools = self._build_tools_from_schema()
            self._resources = []
            self._prompts = []
            
            self._connected = True
            logger.info(f"Python client connected: {self.server_info.name}, module: {module_path}")
            
        except Exception as e:
            logger.error(f"Failed to load Python module: {e}")
            raise
    
    def _build_tools_from_schema(self) -> List[Dict[str, Any]]:
        """从配置构建工具列表。"""
        func = getattr(self._module, self._function_name, None)
        if not func:
            return []
        
        import inspect
        sig = inspect.signature(func)
        
        properties = {}
        required = []
        
        for param_name, param in sig.parameters.items():
            param_type = "string"
            param_desc = ""
            
            if param.annotation != inspect.Parameter.empty:
                type_map = {
                    str: "string",
                    int: "integer",
                    float: "number",
                    bool: "boolean",
                    list: "array",
                    dict: "object",
                }
                param_type = type_map.get(param.annotation, "string")
            
            if param.default == inspect.Parameter.empty:
                required.append(param_name)
            
            properties[param_name] = {
                "type": param_type,
                "description": param_desc,
            }
        
        return [{
            "name": self._function_name,
            "description": f"Python function: {self.server_info.name}",
            "inputSchema": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        }]
    
    async def disconnect(self) -> None:
        """断开连接（清理模块引用）。"""
        if not self._connected:
            return
        
        self._module = None
        self._connected = False
        self._tools = []
        self._resources = []
        self._prompts = []
        logger.info(f"Python client disconnected: {self.server_info.name}")
    
    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """调用Python函数。"""
        if not self._connected:
            await self.connect()
        
        if tool_name != self._function_name:
            return {
                "success": False,
                "error_message": f"Unknown tool: {tool_name}",
                "content": [],
            }
        
        try:
            func = getattr(self._module, self._function_name)
            result = func(**arguments)
            
            if isinstance(result, dict):
                result_str = json.dumps(result, ensure_ascii=False)
            elif isinstance(result, str):
                result_str = result
            else:
                result_str = str(result)
            
            return {
                "success": True,
                "content": [{
                    "type": "text",
                    "text": result_str,
                }],
                "is_error": False,
            }
            
        except Exception as e:
            logger.error(f"Error calling Python function '{tool_name}': {e}")
            return {
                "success": False,
                "error_message": str(e),
                "content": [],
            }
    
    async def read_resource(self, uri: str) -> Dict[str, Any]:
        """读取资源（Python客户端不支持）。"""
        return {
            "success": False,
            "error_message": "Python client does not support resources",
        }
    
    async def get_prompt(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """获取提示词（Python客户端不支持）。"""
        return {
            "success": False,
            "error_message": "Python client does not support prompts",
        }
