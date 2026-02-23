# -*- coding: utf-8 -*-
"""Function Calling 适配器。"""

import json
import uuid
import logging
from typing import Dict, List, Any, Optional, Callable, Union
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
    """函数调用结果。"""
    tool_call_id: str
    name: str
    arguments: Dict[str, Any]
    result: Optional[Any] = None
    error: Optional[str] = None
    success: bool = True


class FunctionCallingAdapter:
    """Function Calling 适配器。"""

    def __init__(self, registry: Optional[FunctionRegistry] = None):
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
        """注册函数。"""
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
        """注销函数。"""
        return self.registry.unregister(name)

    def get_tools_for_provider(self, provider: str) -> List[Dict[str, Any]]:
        """获取指定提供商的工具格式。"""
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
        """解析响应中的工具调用。"""
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
        """执行工具调用。"""
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
            tool_call.error = str(e)
            tool_call.status = "error"
            
            call_result = FunctionCallResult(
                tool_call_id=tool_call.id,
                name=tool_call.name,
                arguments=tool_call.arguments,
                error=str(e),
                success=False,
            )

        self._execution_history.append(call_result)
        return call_result

    def _validate_arguments(
        self,
        schema: FunctionSchema,
        arguments: Dict[str, Any],
    ) -> None:
        """验证参数。"""
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
        """验证参数类型。"""
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
        """格式化工具结果用于发送给模型。"""
        if provider in ("openai", "qwen", "ollama"):
            return {
                "role": "tool",
                "tool_call_id": result.tool_call_id,
                "content": json.dumps(result.result) if result.success else json.dumps({"error": result.error}),
            }
        
        elif provider == "anthropic":
            return {
                "type": "tool_result",
                "tool_use_id": result.tool_call_id,
                "content": json.dumps(result.result) if result.success else json.dumps({"error": result.error}),
                "is_error": not result.success,
            }
        
        else:
            return {
                "role": "tool",
                "tool_call_id": result.tool_call_id,
                "content": json.dumps(result.result) if result.success else json.dumps({"error": result.error}),
            }

    def get_execution_history(self) -> List[FunctionCallResult]:
        """获取执行历史。"""
        return self._execution_history.copy()

    def clear_execution_history(self) -> None:
        """清除执行历史。"""
        self._execution_history.clear()


def create_tool_call_message(
    tool_calls: List[ToolCall],
    provider: str,
) -> Dict[str, Any]:
    """创建工具调用消息。"""
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
