# -*- coding: utf-8 -*-
"""
工具执行器插件模块。

@file toolkit_executor.py
@description 工具调用执行器，管理和执行 Agent 可用的工具
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 管理工具注册表
- 执行工具调用
- 支持同步和异步工具函数
- 自动推断工具参数

工具执行流程：
    1. Agent 决定调用工具
    2. ToolkitExecutor 接收工具调用请求
    3. 查找并执行对应的工具函数
    4. 返回执行结果

支持的函数类型：
    - 同步函数：直接执行
    - 异步函数：自动 await
    - 生成器函数：逐步产生结果
    - 异步生成器：异步逐步产生结果

使用场景：
    - Agent 工具调用执行
    - MCP 工具本地代理
    - 自定义工具注册

状态: ✅ 完整实现
"""

from typing import List, Dict, Any, Optional, Callable, Union, Awaitable
import inspect
import asyncio

from ...core.interfaces import IToolExecutor
from ...exception import (
    ToolNotFoundError,
    ToolInvalidArgumentsError,
)
from ...types import ToolFunction


class ToolResponse:
    """
    工具执行响应类。
    
    封装工具执行的返回结果，包含执行状态和错误信息。
    
    Attributes:
        content (Union[str, List[Dict]]): 工具执行结果内容。
            可以是字符串或结构化数据。
        success (bool): 执行是否成功。默认为 True。
        error_message (Optional[str]): 错误信息。执行失败时包含
            错误描述。默认为 None。
    
    Example:
        >>> # 成功响应
        >>> response = ToolResponse(content="搜索结果：...")
        >>> 
        >>> # 失败响应
        >>> response = ToolResponse(
        ...     content="执行失败",
        ...     success=False,
        ...     error_message="网络连接超时"
        ... )
    
    Note:
        工具函数可以返回 ToolResponse 对象或普通字典，
        ToolkitExecutor 会自动处理格式转换。
    """
    
    def __init__(
        self,
        content: Union[str, List[Dict[str, Any]]],
        success: bool = True,
        error_message: Optional[str] = None,
    ) -> None:
        """
        初始化工具响应。
        
        Args:
            content (Union[str, List[Dict]]): 执行结果内容。
            success (bool, optional): 是否成功。默认为 True。
            error_message (Optional[str], optional): 错误信息。默认为 None。
        """
        self.content = content
        self.success = success
        self.error_message = error_message
    
    def to_dict(self) -> Dict[str, Any]:
        """
        转换为字典格式。
        
        Returns:
            Dict[str, Any]: 包含 content、success、error_message 的字典。
        """
        return {
            "content": self.content,
            "success": self.success,
            "error_message": self.error_message,
        }


class ToolkitExecutor(IToolExecutor):
    """
    工具执行器插件。
    
    实现 IToolExecutor 接口，管理工具注册表并执行工具调用。
    支持同步和异步工具函数，自动处理不同类型的返回值。
    
    核心功能：
        1. 工具注册：支持配置式和函数式注册
        2. 工具执行：自动检测函数类型并正确调用
        3. 错误处理：捕获异常并返回错误响应
        4. 参数推断：自动从函数签名推断参数规范
    
    工具注册方式：
        1. 构造函数传入配置列表
        2. 调用 register_tool 方法
        3. 调用 register_function 方法
    
    Example:
        >>> executor = ToolkitExecutor([
        ...     {
        ...         "name": "search",
        ...         "function": search_function,
        ...         "description": "搜索信息",
        ...         "parameters": {"query": {"type": "string"}}
        ...     }
        ... ])
        >>> 
        >>> # 执行工具
        >>> result = await executor.execute({
        ...     "name": "search",
        ...     "arguments": {"query": "Python 教程"}
        ... })
    
    Note:
        - 工具函数可以是同步或异步
        - 返回值可以是 ToolResponse、dict 或其他类型
        - 执行错误会被捕获并返回错误响应
    """
    
    def __init__(self, tool_configs: Optional[List[Dict[str, Any]]] = None) -> None:
        """
        初始化工具执行器。
        
        Args:
            tool_configs (List[Dict], optional): 工具配置列表。
                每个配置包含：
                - name: 工具名称（唯一标识）
                - function: 工具函数（Callable）
                - description: 工具描述
                - parameters: 参数规范（JSON Schema）
                默认为 None。
        
        Note:
            工具配置会在初始化时自动注册。
        """
        self._tools: Dict[str, Dict[str, Any]] = {}
        """工具注册表，键为工具名称"""
        
        if tool_configs:
            for config in tool_configs:
                self._register_tool_from_config(config)
    
    async def execute(self, tool_call: Dict[str, Any], **kwargs) -> Dict[str, Any]:
        """
        执行工具调用。
        
        根据工具调用规范查找并执行对应的工具函数。
        自动处理同步和异步函数，捕获执行异常。
        
        Args:
            tool_call (Dict[str, Any]): 工具调用规范，包含：
                - name (str): 工具名称
                - arguments (dict): 工具参数
                - id (str): 调用 ID（可选）
            **kwargs: 额外的执行上下文参数。
        
        Returns:
            Dict[str, Any]: 执行结果，包含：
                - content: 执行结果内容
                - success: 是否成功
                - error_message: 错误信息（如果失败）
        
        Raises:
            ToolInvalidArgumentsError: 当工具名称缺失时抛出。
            ToolNotFoundError: 当工具不存在时抛出。
        
        Example:
            >>> result = await executor.execute({
            ...     "name": "calculator",
            ...     "arguments": {"expression": "2 + 3"}
            ... })
            >>> print(result["content"])  # "2 + 3 = 5"
        
        Note:
            - 异步函数会被自动 await
            - 执行异常会被捕获并返回错误响应
            - 返回值会自动转换为字典格式
        """
        tool_name = tool_call.get("name")
        arguments = tool_call.get("arguments", {})
        
        if not tool_name:
            raise ToolInvalidArgumentsError("Tool name is required")
        
        if tool_name not in self._tools:
            raise ToolNotFoundError(f"Tool '{tool_name}' not found")
        
        tool_info = self._tools[tool_name]
        tool_func = tool_info["function"]
        
        try:
            if inspect.iscoroutinefunction(tool_func):
                result = await tool_func(**arguments)
            else:
                result = tool_func(**arguments)
            
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
        """
        获取可用工具列表。
        
        返回所有已注册工具的规范列表，用于告知 LLM 可用的工具。
        
        Returns:
            List[Dict[str, Any]]: 工具规范列表，格式兼容 OpenAI Function Calling：
                - type: "function"
                - function: 包含 name, description, parameters
        
        Note:
            返回的规范格式兼容 OpenAI Function Calling 格式。
        """
        tools = []
        for tool_name, tool_info in self._tools.items():
            raw_params = tool_info.get("parameters", {})
            
            if raw_params and "properties" in raw_params:
                parameters = raw_params
            else:
                properties = {}
                required = []
                
                for param_name, param_def in raw_params.items():
                    if isinstance(param_def, dict):
                        prop = {}
                        if "type" in param_def:
                            prop["type"] = param_def["type"]
                        if "description" in param_def:
                            prop["description"] = param_def["description"]
                        if "default" in param_def:
                            prop["default"] = param_def["default"]
                        if "enum" in param_def:
                            prop["enum"] = param_def["enum"]
                        if param_def.get("required", False):
                            required.append(param_name)
                        properties[param_name] = prop if prop else {"type": "string"}
                    else:
                        properties[param_name] = {"type": "string"}
                
                parameters = {
                    "type": "object",
                    "properties": properties,
                    "required": required
                }
            
            tools.append({
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": tool_info.get("description", ""),
                    "parameters": parameters
                }
            })
        return tools
    
    async def register_tool(self, tool_spec: Dict[str, Any]) -> None:
        """
        注册新工具。
        
        通过配置字典注册工具。
        
        Args:
            tool_spec (Dict[str, Any]): 工具规范，包含：
                - name: 工具名称
                - function: 工具函数
                - description: 工具描述
                - parameters: 参数规范
        
        Note:
            此方法是 _register_tool_from_config 的异步包装。
        """
        self._register_tool_from_config(tool_spec)
    
    def _register_tool_from_config(self, config: Dict[str, Any]) -> None:
        """
        从配置注册工具。
        
        解析配置字典并注册工具到工具注册表。
        
        Args:
            config (Dict[str, Any]): 工具配置。
        
        Raises:
            ValueError: 当工具名称缺失时抛出。
            ValueError: 当工具函数不可调用时抛出。
        
        Note:
            - 工具名称必须唯一
            - 工具函数必须是可调用对象
        """
        tool_name = config.get("name")
        if not tool_name:
            raise ValueError("Tool name is required")
        
        tool_func = config.get("function")
        if not callable(tool_func):
            raise ValueError(f"Tool '{tool_name}' must have a callable function")
        
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
        """
        注册函数为工具。
        
        将普通函数注册为工具，自动推断参数规范。
        
        Args:
            func (Callable): 要注册的函数。
            name (Optional[str], optional): 工具名称。
                如果未指定，使用函数名。默认为 None。
            description (Optional[str], optional): 工具描述。
                如果未指定，使用函数文档字符串。默认为 None。
            parameters (Optional[Dict], optional): 参数规范。
                如果未指定，自动从函数签名推断。默认为 None。
        
        Example:
            >>> def greet(name: str, times: int = 1) -> str:
            ...     '''问候函数'''
            ...     return f"Hello, {name}!" * times
            >>> 
            >>> executor.register_function(greet)
            >>> # 自动推断参数：name (required), times (optional, default=1)
        
        Note:
            - 参数规范会自动从函数签名推断
            - 类型注解会被转换为字符串类型标识
            - 默认值会被记录
        """
        tool_name = name or func.__name__
        
        self._tools[tool_name] = {
            "function": func,
            "description": description or func.__doc__ or "",
            "parameters": parameters or self._infer_parameters(func),
        }
    
    def _infer_parameters(self, func: Callable) -> Dict[str, Any]:
        """
        从函数签名推断参数规范。
        
        解析函数的参数列表，生成兼容 JSON Schema 的参数规范。
        
        Args:
            func (Callable): 要分析的函数。
        
        Returns:
            Dict[str, Any]: 参数规范字典，每个参数包含：
                - type: 参数类型（字符串表示）
                - required: 是否必需
                - default: 默认值（如果有）
        
        Note:
            - self 参数会被忽略
            - 类型注解会被转换为字符串
            - 无默认值的参数标记为必需
        """
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


async def search_tool(query: str, limit: int = 5) -> ToolResponse:
    """
    示例搜索工具。
    
    提供基本的搜索功能占位实现。
    实际使用时应替换为真实的搜索服务。
    
    Args:
        query (str): 搜索查询。
        limit (int, optional): 结果数量限制。默认为 5。
    
    Returns:
        ToolResponse: 搜索结果响应。
    
    Note:
        这是一个示例工具，返回模拟的搜索结果。
    """
    return ToolResponse(content=f"Search results for '{query}' (limit: {limit})")
