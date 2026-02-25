# -*- coding: utf-8 -*-
"""
MCP Client 基类 - 定义统一的客户端接口。
"""

import logging
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class BaseClient(ABC):
    """MCP客户端基类，定义统一接口。"""
    
    def __init__(self, server_info: Any):
        """初始化客户端。
        
        Args:
            server_info: 服务器配置信息
        """
        self.server_info = server_info
        self._connected = False
        self._tools: List[Dict[str, Any]] = []
        self._resources: List[Dict[str, Any]] = []
        self._prompts: List[Dict[str, Any]] = []
    
    @abstractmethod
    async def connect(self) -> None:
        """连接到MCP服务器。"""
        pass
    
    @abstractmethod
    async def disconnect(self) -> None:
        """断开与MCP服务器的连接。"""
        pass
    
    @property
    def is_connected(self) -> bool:
        """检查是否已连接。"""
        return self._connected
    
    async def get_tools(self) -> List[Dict[str, Any]]:
        """获取MCP服务器的工具列表。"""
        if not self._connected:
            await self.connect()
        return self._tools
    
    async def get_resources(self) -> List[Dict[str, Any]]:
        """获取MCP服务器的资源列表。"""
        if not self._connected:
            await self.connect()
        return self._resources
    
    async def get_prompts(self) -> List[Dict[str, Any]]:
        """获取MCP服务器的提示词列表。"""
        if not self._connected:
            await self.connect()
        return self._prompts
    
    @abstractmethod
    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """调用MCP服务器上的工具。
        
        Args:
            tool_name: 工具名称
            arguments: 工具参数
            
        Returns:
            工具执行结果
        """
        pass
    
    @abstractmethod
    async def read_resource(self, uri: str) -> Dict[str, Any]:
        """读取MCP服务器的资源。
        
        Args:
            uri: 资源URI
            
        Returns:
            资源内容
        """
        pass
    
    @abstractmethod
    async def get_prompt(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """获取MCP服务器的提示词。
        
        Args:
            name: 提示词名称
            arguments: 提示词参数
            
        Returns:
            提示词内容
        """
        pass
    
    def _parse_tools(self, tools_result: Any) -> List[Dict[str, Any]]:
        """解析工具列表结果。"""
        tools = []
        for tool in tools_result.tools:
            tools.append({
                "name": tool.name,
                "description": tool.description or "",
                "inputSchema": tool.inputSchema,
            })
        return tools
    
    def _parse_resources(self, resources_result: Any) -> List[Dict[str, Any]]:
        """解析资源列表结果。"""
        resources = []
        for resource in resources_result.resources:
            resources.append({
                "uri": resource.uri,
                "name": resource.name,
                "description": getattr(resource, "description", ""),
                "mimeType": getattr(resource, "mimeType", None),
            })
        return resources
    
    def _parse_prompts(self, prompts_result: Any) -> List[Dict[str, Any]]:
        """解析提示词列表结果。"""
        prompts = []
        for prompt in prompts_result.prompts:
            prompts.append({
                "name": prompt.name,
                "description": prompt.description or "",
                "arguments": [
                    {
                        "name": arg.name,
                        "description": getattr(arg, "description", ""),
                        "required": getattr(arg, "required", False),
                    }
                    for arg in (prompt.arguments or [])
                ],
            })
        return prompts
    
    def _parse_tool_result(self, result: Any) -> Dict[str, Any]:
        """解析工具调用结果。"""
        content = []
        if hasattr(result, "content"):
            for item in result.content:
                if hasattr(item, "type"):
                    if item.type == "text":
                        content.append({
                            "type": "text",
                            "text": item.text,
                        })
                    elif item.type == "image":
                        content.append({
                            "type": "image",
                            "data": item.data,
                            "mimeType": item.mimeType,
                        })
                    else:
                        content.append({"type": item.type})
        
        return {
            "success": not result.isError if hasattr(result, "isError") else True,
            "content": content,
            "is_error": result.isError if hasattr(result, "isError") else False,
        }
    
    def _parse_resource_result(self, result: Any) -> Dict[str, Any]:
        """解析资源读取结果。"""
        contents = []
        if hasattr(result, "contents"):
            for item in result.contents:
                content_item = {
                    "uri": item.uri,
                }
                if hasattr(item, "mimeType"):
                    content_item["mimeType"] = item.mimeType
                if hasattr(item, "text"):
                    content_item["text"] = item.text
                if hasattr(item, "blob"):
                    content_item["blob"] = item.blob
                contents.append(content_item)
        
        return {
            "success": True,
            "contents": contents,
        }
    
    def _parse_prompt_result(self, result: Any) -> Dict[str, Any]:
        """解析提示词获取结果。"""
        messages = []
        if hasattr(result, "messages"):
            for msg in result.messages:
                message_item = {
                    "role": msg.role,
                }
                if hasattr(msg, "content"):
                    if hasattr(msg.content, "type"):
                        if msg.content.type == "text":
                            message_item["content"] = {
                                "type": "text",
                                "text": msg.content.text,
                            }
                        elif msg.content.type == "image":
                            message_item["content"] = {
                                "type": "image",
                                "data": msg.content.data,
                                "mimeType": msg.content.mimeType,
                            }
                        else:
                            message_item["content"] = {"type": msg.content.type}
                messages.append(message_item)
        
        return {
            "success": True,
            "messages": messages,
            "description": getattr(result, "description", None),
        }
