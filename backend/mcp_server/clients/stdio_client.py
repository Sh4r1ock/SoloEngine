# -*- coding: utf-8 -*-
"""
Stdio Client - 通过标准输入/输出连接MCP服务器。

适用于本地进程通信，是MCP最基础的传输方式。
"""

import os
import logging
import asyncio
from typing import Dict, Any, Optional

from .base import BaseClient

logger = logging.getLogger(__name__)


class StdioClient(BaseClient):
    """Stdio传输客户端。"""
    
    def __init__(self, server_info: Any):
        """初始化Stdio客户端。
        
        Args:
            server_info: 服务器配置信息，需包含command、args、env
        """
        super().__init__(server_info)
        self._session = None
        self._process = None
        self._task = None
        self._ready = asyncio.Event()
        self._error: Optional[Exception] = None
    
    async def connect(self) -> None:
        """通过stdio连接MCP服务器。"""
        if self._connected:
            return
        
        try:
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
        except ImportError:
            raise ImportError("MCP SDK is required. Install with: pip install mcp")
        
        command = self.server_info.command
        if not command:
            raise ValueError("stdio transport requires 'command' config")
        
        args = self.server_info.args or []
        env = self.server_info.env or {}
        
        process_env = os.environ.copy()
        process_env.update(env)
        
        server_params = StdioServerParameters(
            command=command,
            args=args,
            env=process_env,
        )
        
        self._ready.clear()
        self._error = None
        
        async def _run_client():
            """在后台任务中运行客户端连接。"""
            try:
                async with stdio_client(server_params) as (read_stream, write_stream):
                    async with ClientSession(read_stream, write_stream) as session:
                        self._session = session
                        await session.initialize()
                        
                        try:
                            if hasattr(stdio_client, 'process'):
                                self._process = stdio_client.process
                        except Exception:
                            pass
                        
                        await self._load_capabilities()
                        
                        self._connected = True
                        self._ready.set()
                        logger.info(f"Stdio client connected: {self.server_info.name}")
                        
                        try:
                            await asyncio.Future()
                        except asyncio.CancelledError:
                            logger.info(f"Client task cancelled for {self.server_info.name}")
                            raise
            except Exception as e:
                self._error = e
                self._ready.set()
                logger.error(f"Error in client task: {e}")
                raise
        
        self._task = asyncio.create_task(_run_client())
        
        await self._ready.wait()
        
        if self._error:
            raise self._error
    
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
                f"Stdio client initialized: {len(self._tools)} tools, "
                f"{len(self._resources)} resources, {len(self._prompts)} prompts"
            )
            
        except Exception as e:
            logger.error(f"Failed to load capabilities: {e}")
            raise
    
    async def disconnect(self) -> None:
        """断开与MCP服务器的连接。"""
        if not self._connected:
            return
        
        self._connected = False
        self._tools = []
        self._resources = []
        self._prompts = []
        
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        
        self._session = None
        self._process = None
        
        logger.info(f"Stdio client disconnected: {self.server_info.name}")
    
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
