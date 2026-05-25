# -*- coding: utf-8 -*-
"""
SoloEngine : Function Calling 适配器模块

@file function_calling.py
@description Function Calling 适配器 - 支持多提供商的函数调用
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 函数注册和管理
    - 多提供商工具格式转换（OpenAI、Anthropic、Qwen、Ollama）
    - 工具调用解析和执行
    - 参数验证
    - 执行历史记录

依赖:
    - json: JSON处理
    - uuid: UUID生成
    - logging: 日志记录
    - typing: 类型注解支持
    - dataclasses: 数据类支持
    - ..models.function_schema: 函数Schema定义

使用示例:
    - from app.core.function_calling import FunctionCallingAdapter
    - adapter = FunctionCallingAdapter()
    - adapter.register_function("search", "搜索工具", {...})
    - result = await adapter.execute_tool_call(tool_call)
"""

import json
import uuid
import logging
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass

from ..models.function_schema import (
    FunctionSchema,
    FunctionRegistry,
    ToolCall,
    create_function_registry_with_commons,
)

logger = logging.getLogger(__name__)


@dataclass
class FunctionCallResult:
    tool_call_id: str
    name: str
    arguments: Dict[str, Any]
    result: Optional[Any] = None
    error_message: Optional[str] = None
    success: bool = True


class FunctionCallingAdapter:
    """
    Function Calling 适配器
    
    职责:
        - 管理函数注册表
        - 支持多提供商工具格式转换
        - 解析和执行工具调用
        - 验证函数参数
        - 记录执行历史
    
    属性:
        registry (FunctionRegistry): 函数注册表
        _execution_history (List[FunctionCallResult]): 执行历史
    
    示例:
        >>> adapter = FunctionCallingAdapter()
        >>> adapter.register_function("search", "搜索工具", {...})
        >>> tools = adapter.get_tools_for_provider("openai")
        >>> result = await adapter.execute_tool_call(tool_call)
    """

    def __init__(self, registry: Optional[FunctionRegistry] = None):
        """
        初始化Function Calling适配器
        
        Args:
            registry: 函数注册表，如果为None则创建默认注册表
        """
        self.registry = registry or create_function_registry_with_commons()
        self._execution_history: List[FunctionCallResult] = []

    def register_function(
        self,
        name: str,
        description: str,
        parameters: Dict[str, Any],
        required: Optional[List[str]] = None,
        handler: Optional[Callable] = None,
    ) -> FunctionSchema:
        """
        注册函数
        
        Args:
            name: 函数名称
            description: 函数描述
            parameters: 参数字典
            required: 必需参数列表
            handler: 函数处理器
            
        Returns:
            注册的函数Schema
            
        Example:
            >>> schema = adapter.register_function(
            ...     "search",
            ...     "搜索工具",
            ...     {"query": {"type": "string", "description": "搜索查询"}},
            ...     required=["query"],
            ...     handler=search_handler
            ... )
        """
        from ..models.function_schema import ParameterSchema
        
        param_schemas = {}
        for param_name, param_config in parameters.items():
            param_schemas[param_name] = ParameterSchema(
                type=param_config.get("type", "string"),
                description=param_config.get("description"),
                enum=param_config.get("enum"),
                default=param_config.get("default"),
            )
        
        return self.registry.register(
            name=name,
            description=description,
            parameters=param_schemas,
            required=required,
            handler=handler,
        )

    def unregister_function(self, name: str) -> bool:
        """
        注销函数
        
        Args:
            name: 函数名称
            
        Returns:
            是否成功注销
            
        Example:
            >>> success = adapter.unregister_function("search")
        """
        return self.registry.unregister(name)

    def get_tools_for_provider(self, provider: str) -> List[Dict[str, Any]]:
        """
        获取指定提供商的工具格式
        
        Args:
            provider: 提供商名称（openai、anthropic、qwen、ollama）
            
        Returns:
            工具格式列表
            
        Example:
            >>> tools = adapter.get_tools_for_provider("openai")
        """
        if provider in ("openai", "qwen", "ollama"):
            return self.registry.to_openai_tools()
        elif provider == "anthropic":
            return self.registry.to_anthropic_tools()
        else:
            return self.registry.to_openai_tools()

    def parse_tool_calls(
        self,
        response: Dict[str, Any],
        provider: str,
    ) -> List[ToolCall]:
        """
        解析响应中的工具调用
        
        Args:
            response: LLM响应字典
            provider: 提供商名称
            
        Returns:
            工具调用列表
            
        Example:
            >>> tool_calls = adapter.parse_tool_calls(response, "openai")
        """
        tool_calls = []

        if provider in ("openai", "qwen", "ollama"):
            choices = response.get("choices", [])
            if choices:
                message = choices[0].get("message", {})
                calls = message.get("tool_calls", [])
                for call in calls:
                    tool_calls.append(ToolCall(
                        id=call.get("id", str(uuid.uuid4())),
                        name=call["function"]["name"],
                        arguments=json.loads(call["function"]["arguments"]),
                    ))

        elif provider == "anthropic":
            content = response.get("content", [])
            for block in content:
                if block.get("type") == "tool_use":
                    tool_calls.append(ToolCall(
                        id=block.get("id", str(uuid.uuid4())),
                        name=block["name"],
                        arguments=block.get("input", {}),
                    ))

        return tool_calls

    async def execute_tool_call(
        self,
        tool_call: ToolCall,
        handler: Optional[Callable] = None,
    ) -> FunctionCallResult:
        """
        执行工具调用
        
        Args:
            tool_call: 工具调用对象
            handler: 可选的自定义处理器
            
        Returns:
            函数调用结果
            
        Raises:
            ValueError: 如果找不到函数处理器
            
        Example:
            >>> result = await adapter.execute_tool_call(tool_call)
        """
        tool_call.status = "running"
        
        try:
            # 使用传入的处理器或注册表中的处理器
            func_handler = handler or self.registry.get_handler(tool_call.name)
            
            if func_handler is None:
                raise ValueError(f"No handler registered for function: {tool_call.name}")

            # 验证参数
            schema = self.registry.get(tool_call.name)
            if schema:
                self._validate_arguments(schema, tool_call.arguments)

            # 执行函数
            import asyncio
            if asyncio.iscoroutinefunction(func_handler):
                result = await func_handler(**tool_call.arguments)
            else:
                result = func_handler(**tool_call.arguments)

            tool_call.result = result
            tool_call.status = "success"
            
            call_result = FunctionCallResult(
                tool_call_id=tool_call.id,
                name=tool_call.name,
                arguments=tool_call.arguments,
                result=result,
                success=True,
            )

        except Exception as e:
            logger.error(f"Error executing tool call {tool_call.name}: {e}")
            tool_call.error_message = str(e)
            tool_call.status = "error"
            
            call_result = FunctionCallResult(
                tool_call_id=tool_call.id,
                name=tool_call.name,
                arguments=tool_call.arguments,
                error_message=str(e),
                success=False,
            )

        self._execution_history.append(call_result)
        return call_result

    def _validate_arguments(
        self,
        schema: FunctionSchema,
        arguments: Dict[str, Any],
    ) -> None:
        """
        验证参数
        
        Args:
            schema: 函数Schema
            arguments: 参数字典
            
        Raises:
            ValueError: 如果缺少必需参数
            TypeError: 如果参数类型不匹配
            
        Example:
            >>> adapter._validate_arguments(schema, {"query": "python"})
        """
        # 检查必需参数
        for required_param in schema.required:
            if required_param not in arguments:
                raise ValueError(f"Missing required parameter: {required_param}")

        # 检查参数类型
        for param_name, param_value in arguments.items():
            if param_name not in schema.parameters:
                continue
            
            param_schema = schema.parameters[param_name]
            self._validate_type(param_name, param_value, param_schema)

    def _validate_type(
        self,
        name: str,
        value: Any,
        schema: Any,
    ) -> None:
        """
        验证参数类型
        
        Args:
            name: 参数名称
            value: 参数值
            schema: 参数Schema
            
        Raises:
            TypeError: 如果类型不匹配
            ValueError: 如果值不符合约束
            
        Example:
            >>> adapter._validate_type("age", 25, param_schema)
        """
        expected_type = schema.type
        
        if expected_type == "string":
            if not isinstance(value, str):
                raise TypeError(f"Parameter '{name}' must be a string")
            if schema.min_length and len(value) < schema.min_length:
                raise ValueError(f"Parameter '{name}' must be at least {schema.min_length} characters")
            if schema.max_length and len(value) > schema.max_length:
                raise ValueError(f"Parameter '{name}' must be at most {schema.max_length} characters")
            if schema.pattern:
                import re
                if not re.match(schema.pattern, value):
                    raise ValueError(f"Parameter '{name}' does not match pattern {schema.pattern}")
        
        elif expected_type == "number":
            if not isinstance(value, (int, float)):
                raise TypeError(f"Parameter '{name}' must be a number")
            if schema.minimum is not None and value < schema.minimum:
                raise ValueError(f"Parameter '{name}' must be at least {schema.minimum}")
            if schema.maximum is not None and value > schema.maximum:
                raise ValueError(f"Parameter '{name}' must be at most {schema.maximum}")
        
        elif expected_type == "integer":
            if not isinstance(value, int):
                raise TypeError(f"Parameter '{name}' must be an integer")
            if schema.minimum is not None and value < schema.minimum:
                raise ValueError(f"Parameter '{name}' must be at least {schema.minimum}")
            if schema.maximum is not None and value > schema.maximum:
                raise ValueError(f"Parameter '{name}' must be at most {schema.maximum}")
        
        elif expected_type == "boolean":
            if not isinstance(value, bool):
                raise TypeError(f"Parameter '{name}' must be a boolean")
        
        elif expected_type == "array":
            if not isinstance(value, list):
                raise TypeError(f"Parameter '{name}' must be an array")
            if schema.items:
                for i, item in enumerate(value):
                    self._validate_type(f"{name}[{i}]", item, schema.items)
        
        elif expected_type == "object":
            if not isinstance(value, dict):
                raise TypeError(f"Parameter '{name}' must be an object")
        
        if schema.enum and value not in schema.enum:
            raise ValueError(f"Parameter '{name}' must be one of {schema.enum}")

    def format_tool_result_for_provider(
        self,
        result: FunctionCallResult,
        provider: str,
    ) -> Dict[str, Any]:
        """
        格式化工具结果用于发送给模型
        
        Args:
            result: 函数调用结果
            provider: 提供商名称
            
        Returns:
            格式化后的结果字典
            
        Example:
            >>> formatted = adapter.format_tool_result_for_provider(result, "openai")
        """
        if provider in ("openai", "qwen", "ollama"):
            return {
                "role": "tool",
                "tool_call_id": result.tool_call_id,
                "content": json.dumps(result.result) if result.success else json.dumps({"error": result.error_message}),
            }
        
        elif provider == "anthropic":
            return {
                "type": "tool_result",
                "tool_use_id": result.tool_call_id,
                "content": json.dumps(result.result) if result.success else json.dumps({"error": result.error_message}),
                "is_error": not result.success,
            }
        
        else:
            return {
                "role": "tool",
                "tool_call_id": result.tool_call_id,
                "content": json.dumps(result.result) if result.success else json.dumps({"error": result.error_message}),
            }

    def get_execution_history(self) -> List[FunctionCallResult]:
        """
        获取执行历史
        
        Returns:
            执行历史列表
            
        Example:
            >>> history = adapter.get_execution_history()
        """
        return self._execution_history.copy()

    def clear_execution_history(self) -> None:
        """
        清除执行历史
        
        Example:
            >>> adapter.clear_execution_history()
        """
        self._execution_history.clear()


def create_tool_call_message(
    tool_calls: List[ToolCall],
    provider: str,
) -> Dict[str, Any]:
    """
    创建工具调用消息
    
    Args:
        tool_calls: 工具调用列表
        provider: 提供商名称
        
    Returns:
        工具调用消息字典
        
    Example:
        >>> message = create_tool_call_message(tool_calls, "openai")
    """
    if provider in ("openai", "qwen", "ollama"):
        return {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": json.dumps(tc.arguments),
                    },
                }
                for tc in tool_calls
            ],
        }
    
    elif provider == "anthropic":
        return {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.arguments,
                }
                for tc in tool_calls
            ],
        }
    
    else:
        return {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": json.dumps(tc.arguments),
                    },
                }
                for tc in tool_calls
            ],
        }
