# -*- coding: utf-8 -*-
"""
SoloEngine : Function Schema定义模块

@file function_schema.py
@description Function Schema定义 - 函数参数和工具定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义Function Schema相关的数据模型，包括：
    - 参数类型枚举
    - 参数Schema
    - 函数Schema
    - 工具调用
    - 函数注册表

依赖:
    - typing: 类型注解支持
    - dataclasses: 数据类支持
    - enum: 枚举类型支持

使用示例:
    - from app.models.function_schema import FunctionSchema, ParameterSchema
    - param = ParameterSchema(type="string", description="搜索关键词")
    - func = FunctionSchema(name="search", description="搜索工具", parameters={"query": param})
"""

from typing import Dict, List, Any, Optional, Literal
from dataclasses import dataclass, field
from enum import Enum


class ParameterType(Enum):
    """参数类型。"""
    STRING = "string"
    NUMBER = "number"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    OBJECT = "object"
    ARRAY = "array"
    NULL = "null"


@dataclass
class ParameterSchema:
    """参数 Schema。"""
    type: str
    description: Optional[str] = None
    enum: Optional[List[str]] = None
    default: Optional[Any] = None
    items: Optional["ParameterSchema"] = None
    properties: Optional[Dict[str, "ParameterSchema"]] = None
    required: Optional[List[str]] = None
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    pattern: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典。"""
        result = {"type": self.type}
        
        if self.description:
            result["description"] = self.description
        if self.enum:
            result["enum"] = self.enum
        if self.default is not None:
            result["default"] = self.default
        if self.items:
            result["items"] = self.items.to_dict()
        if self.properties:
            result["properties"] = {k: v.to_dict() for k, v in self.properties.items()}
        if self.required:
            result["required"] = self.required
        if self.minimum is not None:
            result["minimum"] = self.minimum
        if self.maximum is not None:
            result["maximum"] = self.maximum
        if self.min_length is not None:
            result["minLength"] = self.min_length
        if self.max_length is not None:
            result["maxLength"] = self.max_length
        if self.pattern:
            result["pattern"] = self.pattern
        
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ParameterSchema":
        """从字典创建。"""
        items = None
        if "items" in data:
            items = cls.from_dict(data["items"])
        
        properties = None
        if "properties" in data:
            properties = {k: cls.from_dict(v) for k, v in data["properties"].items()}
        
        return cls(
            type=data["type"],
            description=data.get("description"),
            enum=data.get("enum"),
            default=data.get("default"),
            items=items,
            properties=properties,
            required=data.get("required"),
            minimum=data.get("minimum"),
            maximum=data.get("maximum"),
            min_length=data.get("minLength"),
            max_length=data.get("maxLength"),
            pattern=data.get("pattern"),
        )


@dataclass
class FunctionSchema:
    """Function Schema 定义。"""
    name: str
    description: str
    parameters: Dict[str, ParameterSchema]
    required: List[str] = field(default_factory=list)
    returns: Optional[ParameterSchema] = None
    examples: List[Dict[str, Any]] = field(default_factory=list)

    def to_openai_schema(self) -> Dict[str, Any]:
        """转换为 OpenAI Function Calling 格式。"""
        properties = {k: v.to_dict() for k, v in self.parameters.items()}
        
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": self.required,
                },
            },
        }

    def to_anthropic_schema(self) -> Dict[str, Any]:
        """转换为 Anthropic Tool Use 格式。"""
        properties = {k: v.to_dict() for k, v in self.parameters.items()}
        
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {
                "type": "object",
                "properties": properties,
                "required": self.required,
            },
        }

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典。"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {k: v.to_dict() for k, v in self.parameters.items()},
            "required": self.required,
            "returns": self.returns.to_dict() if self.returns else None,
            "examples": self.examples,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FunctionSchema":
        """从字典创建。"""
        parameters = {
            k: ParameterSchema.from_dict(v)
            for k, v in data.get("parameters", {}).items()
        }
        
        returns = None
        if data.get("returns"):
            returns = ParameterSchema.from_dict(data["returns"])
        
        return cls(
            name=data["name"],
            description=data["description"],
            parameters=parameters,
            required=data.get("required", []),
            returns=returns,
            examples=data.get("examples", []),
        )


@dataclass
class ToolCall:
    """工具调用。"""
    id: str
    name: str
    arguments: Dict[str, Any]
    result: Optional[Any] = None
    error: Optional[str] = None
    status: Literal["pending", "running", "success", "error"] = "pending"

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典。"""
        return {
            "id": self.id,
            "name": self.name,
            "arguments": self.arguments,
            "result": self.result,
            "error": self.error,
            "status": self.status,
        }


class FunctionRegistry:
    """函数注册表。"""

    def __init__(self):
        self._functions: Dict[str, FunctionSchema] = {}
        self._handlers: Dict[str, callable] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: Dict[str, ParameterSchema],
        required: Optional[List[str]] = None,
        handler: Optional[callable] = None,
    ) -> FunctionSchema:
        """注册函数。"""
        schema = FunctionSchema(
            name=name,
            description=description,
            parameters=parameters,
            required=required or [],
        )
        
        self._functions[name] = schema
        
        if handler:
            self._handlers[name] = handler
        
        return schema

    def unregister(self, name: str) -> bool:
        """注销函数。"""
        if name in self._functions:
            del self._functions[name]
            if name in self._handlers:
                del self._handlers[name]
            return True
        return False

    def get(self, name: str) -> Optional[FunctionSchema]:
        """获取函数 Schema。"""
        return self._functions.get(name)

    def get_handler(self, name: str) -> Optional[callable]:
        """获取函数处理器。"""
        return self._handlers.get(name)

    def list_functions(self) -> List[FunctionSchema]:
        """列出所有函数。"""
        return list(self._functions.values())

    def to_openai_tools(self) -> List[Dict[str, Any]]:
        """转换为 OpenAI Tools 格式。"""
        return [f.to_openai_schema() for f in self._functions.values()]

    def to_anthropic_tools(self) -> List[Dict[str, Any]]:
        """转换为 Anthropic Tools 格式。"""
        return [f.to_anthropic_schema() for f in self._functions.values()]


# 预定义的常用函数 Schema
COMMON_FUNCTIONS = {
    "search": FunctionSchema(
        name="search",
        description="搜索信息",
        parameters={
            "query": ParameterSchema(
                type="string",
                description="搜索查询",
            ),
            "limit": ParameterSchema(
                type="integer",
                description="返回结果数量限制",
                default=10,
            ),
        },
        required=["query"],
    ),
    "read_file": FunctionSchema(
        name="read_file",
        description="读取文件内容",
        parameters={
            "path": ParameterSchema(
                type="string",
                description="文件路径",
            ),
        },
        required=["path"],
    ),
    "write_file": FunctionSchema(
        name="write_file",
        description="写入文件内容",
        parameters={
            "path": ParameterSchema(
                type="string",
                description="文件路径",
            ),
            "content": ParameterSchema(
                type="string",
                description="文件内容",
            ),
        },
        required=["path", "content"],
    ),
    "execute_command": FunctionSchema(
        name="execute_command",
        description="执行命令",
        parameters={
            "command": ParameterSchema(
                type="string",
                description="要执行的命令",
            ),
            "timeout": ParameterSchema(
                type="integer",
                description="超时时间（秒）",
                default=30,
            ),
        },
        required=["command"],
    ),
    "http_request": FunctionSchema(
        name="http_request",
        description="发送 HTTP 请求",
        parameters={
            "url": ParameterSchema(
                type="string",
                description="请求 URL",
            ),
            "method": ParameterSchema(
                type="string",
                description="HTTP 方法",
                enum=["GET", "POST", "PUT", "DELETE", "PATCH"],
                default="GET",
            ),
            "headers": ParameterSchema(
                type="object",
                description="请求头",
            ),
            "body": ParameterSchema(
                type="object",
                description="请求体",
            ),
        },
        required=["url"],
    ),
}


def create_function_registry_with_commons() -> FunctionRegistry:
    """创建包含常用函数的注册表。"""
    registry = FunctionRegistry()
    for name, schema in COMMON_FUNCTIONS.items():
        registry._functions[name] = schema
    return registry
