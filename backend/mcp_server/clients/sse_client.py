# -*- coding: utf-8 -*-
"""
SSE Client - 通过Server-Sent Events连接MCP服务器。

适用于远程服务通信，支持服务器主动推送消息。
"""

import logging
from typing import Dict, Any, Optional

from .base import BaseClient

logger = logging.getLogger(__name__)


class SSEClient(BaseClient):
    """SSE传输客户端。"""
    
    def __init__(self, server_info: Any):
        """初始化SSE客户端。
        
        Args:
            server_info: 服务器配置信息，需包含url、headers
        """
        super().__init__(server_info)
        self._session = None
        self._session_context = None
        self._client_context = None
    
    async def connect(self) -> None:
        """通过SSE连接MCP服务器。"""
        if self._connected:
            return
        
        try:
            from mcp import ClientSession
            from mcp.client.sse import sse_client
        except ImportError:
            raise ImportError("MCP SDK is required. Install with: pip install mcp")
        
        url = self.server_info.url
        if not url:
            raise ValueError("sse transport requires 'url' config")
        
        headers = self.server_info.headers or {}
        
        try:
            self._client_context = sse_client(url, headers=headers)
            read_stream, write_stream = await self._client_context.__aenter__()
            
            self._session = ClientSession(read_stream, write_stream)
            await self._session.__aenter__()
            await self._session.initialize()
            
            await self._load_capabilities()
            
            self._connected = True
            logger.info(f"SSE client connected: {self.server_info.name}")
            
        except Exception as e:
            await self._cleanup()
            logger.error(f"Failed to connect SSE client: {e}")
            raise
    
    async def _load_capabilities(self) -> None:
        """加载服务器的工具、资源和提示词。"""
        try:
            tools_result = await self._session.list_tools()
            self._tools = self._parse_tools(tools_result)
            
            try:
                resources_result = await self._session.list_resources()
                self._resources = self._parse_resources(resources_result)
            except Exception as e:
                logger.warning(f"Server does not support resources: {e}")
                self._resources = []
            
            try:
                prompts_result = await self._session.list_prompts()
                self._prompts = self._parse_prompts(prompts_result)
            except Exception as e:
                logger.warning(f"Server does not support prompts: {e}")
                self._prompts = []
            
            logger.info(
                f"SSE client initialized: {len(self._tools)} tools, "
                f"{len(self._resources)} resources, {len(self._prompts)} prompts"
            )
            
        except Exception as e:
            logger.error(f"Failed to load capabilities: {e}")
            raise
    
    async def disconnect(self) -> None:
        """断开与MCP服务器的连接。"""
        if not self._connected:
            return
        
        await self._cleanup()
        self._connected = False
        self._tools = []
        self._resources = []
        self._prompts = []
        logger.info(f"SSE client disconnected: {self.server_info.name}")
    
    async def _cleanup(self) -> None:
        """清理资源。"""
        try:
            if self._session:
                await self._session.__aexit__(None, None, None)
                self._session = None
            
            if self._client_context:
                await self._client_context.__aexit__(None, None, None)
                self._client_context = None
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
    
    async def call_tool(
        self,
        tool_name: str,
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """调用MCP服务器上的工具。"""
        if not self._connected:
            await self.connect()
        
        try:
            result = await self._session.call_tool(tool_name, arguments)
            return self._parse_tool_result(result)
        except Exception as e:
            logger.error(f"Error calling tool '{tool_name}': {e}")
            return {
                "success": False,
                "error_message": str(e),
                "content": [],
            }
    
    async def read_resource(self, uri: str) -> Dict[str, Any]:
        """读取MCP服务器的资源。"""
        if not self._connected:
            await self.connect()
        
        try:
            result = await self._session.read_resource(uri)
            return self._parse_resource_result(result)
        except Exception as e:
            logger.error(f"Error reading resource '{uri}': {e}")
            return {
                "success": False,
                "error_message": str(e),
            }
    
    async def get_prompt(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """获取MCP服务器的提示词。"""
        if not self._connected:
            await self.connect()
        
        try:
            result = await self._session.get_prompt(name, arguments or {})
            return self._parse_prompt_result(result)
        except Exception as e:
            logger.error(f"Error getting prompt '{name}': {e}")
            return {
                "success": False,
                "error_message": str(e),
            }
