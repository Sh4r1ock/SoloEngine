# -*- coding: utf-8 -*-
"""
MCP工具模块 - MCP服务器工具调用实现。

@file mcp.py
@description MCP工具 - 调用MCP服务器上的工具
@author SoloEngine Team
@date 2026-03-26

功能描述：
- 统一入口调用MCP服务器工具
- 三参数设计：server_name + tool_name + arguments
- XML标签展示可用工具
- 直接调用MCPClient，不经过HTTP
- 完善的错误处理和重试机制

设计理念：
    参考SkillTool的设计模式：
    - 编译时注入mcp_servers_info（包含MCPClient实例）
    - 统一入口调用方式
    - XML标签展示可用工具
    - 直接调用MCPClient，不通过HTTP

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional, List, Union
from dataclasses import dataclass, field
import asyncio
import json
import time
import logging
from datetime import datetime, timezone

from .base import BaseAgentTool, AgentToolError, ToolContext, ToolPermission

logger = logging.getLogger(__name__)


@dataclass
class MCPServerInfo:
    """MCP服务器信息数据类
    
    存储MCP服务器的完整信息，包括工具列表、资源和客户端实例。
    
    Attributes:
        server_id (str): 服务器ID
        server_name (str): 服务器名称
        server_description (str): 服务器描述
        tools (List[Dict[str, Any]]): 工具列表
        resources (List[Dict[str, Any]]): 资源列表
        prompts (List[Dict[str, Any]]): 提示词列表
        client (Optional[Any]): MCPClient实例
        is_connected (bool): 是否已连接
    """
    server_id: str = ""
    server_name: str = ""
    server_description: str = ""
    tools: List[Dict[str, Any]] = field(default_factory=list)
    resources: List[Dict[str, Any]] = field(default_factory=list)
    prompts: List[Dict[str, Any]] = field(default_factory=list)
    client: Optional[Any] = None
    is_connected: bool = False


@dataclass
class MCPConnectionConfig:
    """MCP连接配置数据类
    
    存储MCP连接的超时和重试配置。
    
    Attributes:
        connect_timeout (int): 连接超时时间（秒）
        call_timeout (int): 调用超时时间（秒）
        max_retries (int): 最大重试次数
        retry_delay (float): 重试延迟（秒）
    """
    connect_timeout: int = 30
    call_timeout: int = 60
    max_retries: int = 3
    retry_delay: float = 1.0


class MCPTool(BaseAgentTool):
    """MCP工具 - 调用MCP服务器上的工具
    
    参考SkillTool的设计模式：
    - 编译时注入mcp_servers_info（包含MCPClient实例）
    - 统一入口调用方式
    - XML标签展示可用工具
    - 直接调用MCPClient，不通过HTTP
    
    核心功能：
        1. 统一入口：使用MCP工具作为所有MCP调用的入口
        2. 三参数设计：server_name + tool_name + arguments
        3. XML标签感知：通过<available_mcp_tools> XML展示可用工具
        4. 直接调用：MCPTool直接调用MCPClient，不经过HTTP
    
    Example:
        >>> mcp_tool = MCPTool(mcp_servers_info={
        ...     "github": MCPServerInfo(
        ...         server_id="xxx",
        ...         server_name="github",
        ...         tools=[{"name": "create_issue", "description": "..."}],
        ...         client=<MCPClient instance>
        ...     )
        ... })
        >>> result = await mcp_tool.execute(
        ...     server_name="github",
        ...     tool_name="create_issue",
        ...     arguments={"owner": "xxx", "repo": "xxx", "title": "Bug"}
        ... )
    
    Note:
        - MCP服务器信息在编译阶段注入
        - 每个Agent有独立的MCPTool实例和MCPClient实例
        - mcp_service（已集成到端口8990）仅用于前端管理，与Agent调用无关
    """
    
    def __init__(
        self,
        mcp_servers_info: Optional[Dict[str, MCPServerInfo]] = None,
        connection_config: Optional[MCPConnectionConfig] = None,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None
    ) -> None:
        """初始化MCP工具。
        
        Args:
            mcp_servers_info (Dict[str, MCPServerInfo], optional): MCP服务器信息字典
                {"server_name": MCPServerInfo(...), ...}
            connection_config (MCPConnectionConfig, optional): 连接配置
            context (ToolContext, optional): 工具上下文
            permission (ToolPermission, optional): 工具权限
        """
        super().__init__(context, permission)
        self._mcp_servers_info = mcp_servers_info or {}
        self._connection_config = connection_config or MCPConnectionConfig()
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """获取工具规范 - 包含 available_mcp_servers XML 和渐进发现说明

        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式
        """
        available_mcp_xml = self._format_available_mcp_servers_xml()

        description = f"""Call a tool from an MCP server with progressive discovery.

Available MCP servers:
{available_mcp_xml}

This tool supports multiple modes based on the parameters you provide:

1. DISCOVERY MODE - List all tools from a specific server:
   MCP(server_name="github")
   → Returns: List of all available tools from mcp_servers_info with brief descriptions

2. SEARCH MODE - Find tools by keyword:
   MCP(server_name="github", tool_name="issue")
   → Returns: Tools matching the keyword (searches in name and description)

3. SCHEMA MODE - Get tool details:
   MCP(server_name="github", tool_name="create_issue")
   → Returns: Full schema of the specified tool

4. BATCH SCHEMA MODE - Get multiple tool details:
   MCP(server_name="github", tool_name=["create_issue", "list_issues"])
   → Returns: Schemas for all specified tools

5. EXECUTION MODE - Run a tool:
   MCP(server_name="github", tool_name="create_issue",
       arguments={"{"}"title": "...", "body": "..."{"}"})
   → Returns: Tool execution result

IMPORTANT:
- Use exact tool_name for schema lookup and execution
- Use partial/keyword tool_name for search
- ALWAYS provide 'arguments' when you want to EXECUTE
- When an MCP tool is relevant, you must invoke this tool IMMEDIATELY as your first action.
- NEVER just announce or mention an MCP server in your text response without actually calling this tool."""

        return {
            "name": "MCP",
            "description": description,
            "parameters": {
                "type": "object",
                "properties": {
                    "server_name": {
                        "type": "string",
                        "description": "The MCP server name (e.g., 'github', 'filesystem')"
                    },
                    "tool_name": {
                        "oneOf": [
                            {"type": "string", "description": "Tool name (exact match or search keyword)"},
                            {"type": "array", "items": {"type": "string"}, "description": "List of tool names for batch schema lookup"}
                        ],
                        "description": "Optional. Tool name(s) for schema lookup, search, or execution"
                    },
                    "arguments": {
                        "type": "object",
                        "description": "Optional. Tool arguments for execution. Required when executing a tool."
                    }
                },
                "required": ["server_name"]
            }
        }
    
    def _format_available_mcp_tools_xml(self) -> str:
        """生成 available_mcp_tools XML (保留用于兼容性)

        Returns:
            str: available_mcp_tools XML 字符串
        """
        if not self._mcp_servers_info:
            return "<available_mcp_tools>\nNo MCP tools available.\n</available_mcp_tools>"

        lines = ["<available_mcp_tools>"]
        for server_name, server_info in self._mcp_servers_info.items():
            for tool in server_info.tools:
                tool_name = tool.get("name", "")
                tool_desc = tool.get("description", "")
                is_enabled = tool.get("is_enabled", True)  # 默认启用

                # 只显示启用的工具
                if tool_name and is_enabled:
                    if tool_desc:
                        lines.append(f"[{server_name}] {tool_name}: {tool_desc}")
                    else:
                        lines.append(f"[{server_name}] {tool_name}")
        lines.append("</available_mcp_tools>")
        return "\n".join(lines)

    def _format_available_mcp_servers_xml(self) -> str:
        """生成 available_mcp_servers XML - 只包含服务器信息

        Returns:
            str: available_mcp_servers XML 字符串
        """
        if not self._mcp_servers_info:
            return "<available_mcp_servers>\nNo MCP servers available.\n</available_mcp_servers>"

        lines = ["<available_mcp_servers>"]
        for server_name, server_info in self._mcp_servers_info.items():
            # 只注入服务器名称和描述，不注入具体工具
            server_desc = server_info.server_description or f"MCP server: {server_name}"
            lines.append(f"[{server_name}]: {server_desc}")
        lines.append("</available_mcp_servers>")
        return "\n".join(lines)
    
    async def execute(
        self,
        server_name: str,
        tool_name: Optional[Union[str, List[str]]] = None,
        arguments: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """执行MCP工具调用 - 支持三层递进模式

        Args:
            server_name (str): MCP服务器名称
            tool_name (Optional[Union[str, List[str]]]): 工具名称（可选）
            arguments (Optional[Dict[str, Any]]): 工具参数（可选）
            **kwargs: 额外参数（忽略）

        Returns:
            Dict[str, Any]: 执行结果，根据模式不同返回不同内容

        三层递进模式：
            - Tier 1: Discovery (server_name only) → 返回工具列表
            - Tier 2: Schema (server_name + tool_name) → 返回工具详情
            - Tier 3: Execution (server_name + tool_name + arguments) → 执行工具
        """
        start_time = time.time()
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        if not server_name:
            return self._create_error_result(
                error_code="INVALID_SERVER_NAME",
                message="MCP server name is required",
                execution_time=execution_time
            )

        server_info = self._mcp_servers_info.get(server_name)
        if not server_info:
            return self._create_error_result(
                error_code="MCP_SERVER_NOT_FOUND",
                message=f"MCP server '{server_name}' not found",
                details={"available_servers": list(self._mcp_servers_info.keys())},
                execution_time=execution_time
            )

        # Tier 1: Discovery - 只传 server_name
        if tool_name is None:
            return await self._tier1_discover(server_info, execution_time)

        # Tier 3: Execution - 传了 arguments
        if arguments is not None:
            if isinstance(tool_name, str):
                return await self._tier3_execute(server_info, tool_name, arguments, start_time, execution_time)
            else:
                return self._create_error_result(
                    error_code="INVALID_TOOL_NAME",
                    message="Cannot execute with multiple tools. Provide a single tool_name as string.",
                    execution_time=execution_time,
                    server_name=server_name
                )

        # Tier 2: Schema/Search - 没传 arguments，传了 tool_name
        if isinstance(tool_name, list):
            # 批量获取多个工具的 schema
            return await self._tier2_batch_schema(server_info, tool_name, execution_time)

        if isinstance(tool_name, str):
            # 先尝试精确匹配 - 返回单个 schema
            exact_match = self._find_tool_exact(server_info, tool_name)
            if exact_match:
                return await self._tier2_single_schema(server_info, tool_name, execution_time)
            # 精确匹配失败，进行模糊搜索 - 返回匹配工具的 schema 列表
            return await self._search_tools_with_schema(server_info, tool_name, execution_time)

        return self._create_error_result(
            error_code="INVALID_TOOL_NAME",
            message="Invalid tool_name type",
            execution_time=execution_time,
            server_name=server_name
        )
    
    def _find_tool_exact(self, server_info: MCPServerInfo, tool_name: str) -> Optional[Dict]:
        """精确匹配工具

        Args:
            server_info: 服务器信息
            tool_name: 工具名称

        Returns:
            Optional[Dict]: 匹配到的工具信息，未找到返回 None
        """
        for tool in server_info.tools:
            if tool.get("name") == tool_name:
                return tool
        return None

    async def _tier1_discover(self, server_info: MCPServerInfo, execution_time: str) -> Dict[str, Any]:
        """Tier 1: 发现所有工具

        Args:
            server_info: 服务器信息
            execution_time: 执行时间

        Returns:
            Dict[str, Any]: 工具列表
        """
        tools_summary = []
        for tool in server_info.tools:
            tool_desc = tool.get("description", "")[:100]
            tools_summary.append({
                "name": tool.get("name"),
                "description": tool_desc
            })

        return {
            "success": True,
            "mode": "discovery",
            "server_name": server_info.server_name,
            "available_tools": tools_summary,
            "total_count": len(tools_summary),
            "hint": "Use tool_name='keyword' to search, or exact tool_name to get schema",
            "metadata": {"execution_time": execution_time}
        }

    async def _search_tools(self, server_info: MCPServerInfo, query: str, execution_time: str) -> Dict[str, Any]:
        """模糊搜索工具 - 返回名称+简介（保留用于兼容性）

        Args:
            server_info: 服务器信息
            query: 搜索关键词
            execution_time: 执行时间

        Returns:
            Dict[str, Any]: 搜索结果
        """
        query_lower = query.lower()
        matches = []

        for tool in server_info.tools:
            name = tool.get("name", "").lower()
            description = tool.get("description", "").lower()

            # 匹配规则：名称包含 或 描述包含
            if query_lower in name or query_lower in description:
                matches.append({
                    "name": tool.get("name"),
                    "description": tool.get("description", "")[:100]
                })

        return {
            "success": True,
            "mode": "search",
            "server_name": server_info.server_name,
            "search_query": query,
            "match_count": len(matches),
            "matched_tools": matches,
            "hint": "Use exact tool_name from results to get full schema",
            "metadata": {"execution_time": execution_time}
        }

    async def _search_tools_with_schema(self, server_info: MCPServerInfo, query: str, execution_time: str) -> Dict[str, Any]:
        """模糊搜索工具 - 返回匹配工具的 schema 列表

        相当于批量查询匹配工具的详情

        Args:
            server_info: 服务器信息
            query: 搜索关键词
            execution_time: 执行时间

        Returns:
            Dict[str, Any]: 搜索结果，包含匹配工具的完整 schema
        """
        query_lower = query.lower()
        matches = []

        for tool in server_info.tools:
            name = tool.get("name", "").lower()
            description = tool.get("description", "").lower()

            # 匹配规则：名称包含 或 描述包含
            if query_lower in name or query_lower in description:
                matches.append({
                    "name": tool.get("name"),
                    "description": tool.get("description"),
                    "input_schema": tool.get("input_schema", {})
                })

        return {
            "success": True,
            "mode": "schema_search",
            "server_name": server_info.server_name,
            "search_query": query,
            "match_count": len(matches),
            "matched_tools": matches,
            "hint": "Use exact tool_name to execute the tool",
            "metadata": {"execution_time": execution_time}
        }

    async def _tier2_single_schema(self, server_info: MCPServerInfo, tool_name: str, execution_time: str) -> Dict[str, Any]:
        """Tier 2: 获取单个工具 schema

        Args:
            server_info: 服务器信息
            tool_name: 工具名称
            execution_time: 执行时间

        Returns:
            Dict[str, Any]: 工具 schema
        """
        for tool in server_info.tools:
            if tool.get("name") == tool_name:
                return {
                    "success": True,
                    "mode": "schema",
                    "server_name": server_info.server_name,
                    "tool_name": tool_name,
                    "description": tool.get("description"),
                    "input_schema": tool.get("input_schema", {}),
                    "hint": "Provide 'arguments' to execute this tool",
                    "metadata": {"execution_time": execution_time}
                }

        return self._create_error_result(
            error_code="TOOL_NOT_FOUND",
            message=f"Tool '{tool_name}' not found",
            execution_time=execution_time,
            server_name=server_info.server_name
        )

    async def _tier2_batch_schema(self, server_info: MCPServerInfo, tool_names: List[str], execution_time: str) -> Dict[str, Any]:
        """Tier 2+: 批量获取工具 schema

        Args:
            server_info: 服务器信息
            tool_names: 工具名称列表
            execution_time: 执行时间

        Returns:
            Dict[str, Any]: 批量 schema 结果
        """
        found_tools = []
        not_found = []

        for name in tool_names:
            tool = self._find_tool_exact(server_info, name)
            if tool:
                found_tools.append({
                    "name": tool.get("name"),
                    "description": tool.get("description"),
                    "input_schema": tool.get("input_schema", {})
                })
            else:
                not_found.append(name)

        result = {
            "success": True,
            "mode": "batch_schema",
            "server_name": server_info.server_name,
            "requested_count": len(tool_names),
            "found_count": len(found_tools),
            "tools": found_tools,
            "metadata": {"execution_time": execution_time}
        }

        if not_found:
            result["not_found"] = not_found

        return result

    async def _tier3_execute(
        self,
        server_info: MCPServerInfo,
        tool_name: str,
        arguments: Dict[str, Any],
        start_time: float,
        execution_time: str
    ) -> Dict[str, Any]:
        """Tier 3: 执行工具

        Args:
            server_info: 服务器信息
            tool_name: 工具名称
            arguments: 工具参数
            start_time: 开始时间
            execution_time: 执行时间字符串

        Returns:
            Dict[str, Any]: 执行结果
        """
        # 验证工具存在
        tool = self._find_tool_exact(server_info, tool_name)
        if not tool:
            return self._create_error_result(
                error_code="TOOL_NOT_FOUND",
                message=f"Tool '{tool_name}' not found in server '{server_info.server_name}'",
                execution_time=execution_time,
                server_name=server_info.server_name,
                tool_name=tool_name
            )

        client = server_info.client
        if not client:
            return self._create_error_result(
                error_code="MCP_NOT_CONNECTED",
                message=f"MCP server '{server_info.server_name}' is not connected",
                execution_time=execution_time,
                server_name=server_info.server_name,
                tool_name=tool_name
            )

        # 执行工具
        try:
            result = await self._call_with_retry(
                client.call_tool,
                tool_name,
                arguments or {}
            )
            call_duration_ms = int((time.time() - start_time) * 1000)

            # 提取content中的文本内容
            texts = []
            if result.get("content"):
                for item in result["content"]:
                    if item.get("type") == "text":
                        texts.append(item.get("text", ""))

            return {
                "success": True,
                "content": "\n".join(texts),  # 只返回content文本
                "metadata": {
                    "mode": "execution",
                    "server_name": server_info.server_name,
                    "tool_name": tool_name,
                    "execution_time": execution_time,
                    "server_id": server_info.server_id,
                    "connection_status": "connected",
                    "call_duration_ms": call_duration_ms
                }
            }
        except Exception as e:
            logger.error(f"[MCPTool] Tool execution failed: {e}")
            return self._create_error_result(
                error_code="TOOL_EXECUTION_ERROR",
                message=f"Tool execution failed: {str(e)}",
                execution_time=execution_time,
                server_name=server_info.server_name,
                tool_name=tool_name
            )

    async def _call_with_retry(
        self,
        func,
        *args,
        **kwargs
    ) -> Any:
        """带重试的调用

        Args:
            func: 要调用的函数
            *args: 位置参数
            **kwargs: 关键字参数

        Returns:
            Any: 调用结果

        Raises:
            Exception: 重试次数用尽后抛出最后一次异常
        """
        last_error = None
        for attempt in range(self._connection_config.max_retries):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                last_error = e
                if attempt < self._connection_config.max_retries - 1:
                    await asyncio.sleep(self._connection_config.retry_delay * (attempt + 1))
                    logger.warning(f"[MCPTool] Retry attempt {attempt + 1} after error: {e}")
        raise last_error
    
    def _create_error_result(
        self,
        error_code: str,
        message: str,
        execution_time: str,
        details: Dict[str, Any] = None,
        server_name: str = None,
        tool_name: str = None
    ) -> Dict[str, Any]:
        """创建错误返回结果
        
        Args:
            error_code (str): 错误代码
            message (str): 错误消息
            execution_time (str): 执行时间
            details (Dict[str, Any], optional): 错误详情
            server_name (str, optional): 服务器名称
            tool_name (str, optional): 工具名称
        
        Returns:
            Dict[str, Any]: 错误结果字典
        """
        return {
            "success": False,
            "server_name": server_name,
            "tool_name": tool_name,
            "content": json.dumps({
                "error": {
                    "code": error_code,
                    "message": message,
                    "details": details or {}
                }
            }, ensure_ascii=False),
            "metadata": {
                "execution_time": execution_time,
                "error_code": error_code
            }
        }
    
    async def disconnect(self, server_name: str = None) -> Dict[str, Any]:
        """断开MCP连接
        
        Args:
            server_name (str, optional): 服务器名称，为None时断开所有连接
        
        Returns:
            Dict[str, Any]: 断开连接结果
        """
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        disconnected_servers = []
        
        if server_name:
            server_info = self._mcp_servers_info.get(server_name)
            if server_info and server_info.client:
                await server_info.client.disconnect()
                server_info.client = None
                server_info.is_connected = False
                disconnected_servers.append(server_name)
        else:
            for name, server_info in self._mcp_servers_info.items():
                if server_info.client:
                    await server_info.client.disconnect()
                    server_info.client = None
                    server_info.is_connected = False
                    disconnected_servers.append(name)
        
        return {
            "success": True,
            "content": json.dumps({
                "disconnected_servers": disconnected_servers
            }, ensure_ascii=False),
            "metadata": {
                "execution_time": execution_time
            }
        }
    
    async def list_resources(self, server_name: str) -> Dict[str, Any]:
        """列出MCP服务器的资源
        
        Args:
            server_name (str): 服务器名称
        
        Returns:
            Dict[str, Any]: 资源列表结果
        """
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info:
            return self._create_error_result(
                error_code="MCP_SERVER_NOT_FOUND",
                message=f"MCP server '{server_name}' not found",
                execution_time=execution_time
            )
        
        return {
            "success": True,
            "server_name": server_name,
            "content": json.dumps({
                "resources": server_info.resources
            }, ensure_ascii=False),
            "metadata": {
                "execution_time": execution_time,
                "server_id": server_info.server_id
            }
        }
    
    async def read_resource(self, server_name: str, uri: str) -> Dict[str, Any]:
        """读取MCP资源
        
        Args:
            server_name (str): 服务器名称
            uri (str): 资源URI
        
        Returns:
            Dict[str, Any]: 资源内容结果
        """
        start_time = time.time()
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info or not server_info.client:
            return self._create_error_result(
                error_code="MCP_NOT_CONNECTED",
                message=f"MCP server '{server_name}' is not connected",
                execution_time=execution_time,
                server_name=server_name
            )
        
        try:
            result = await server_info.client.read_resource(uri)
            call_duration_ms = int((time.time() - start_time) * 1000)
            
            return {
                "success": True,
                "server_name": server_name,
                "content": json.dumps({
                    "resource": result
                }, ensure_ascii=False),
                "metadata": {
                    "execution_time": execution_time,
                    "uri": uri,
                    "call_duration_ms": call_duration_ms
                }
            }
        except Exception as e:
            return self._create_error_result(
                error_code="RESOURCE_READ_ERROR",
                message=f"Failed to read resource: {str(e)}",
                execution_time=execution_time,
                server_name=server_name
            )
    
    async def list_prompts(self, server_name: str) -> Dict[str, Any]:
        """列出MCP服务器的提示词
        
        Args:
            server_name (str): 服务器名称
        
        Returns:
            Dict[str, Any]: 提示词列表结果
        """
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info:
            return self._create_error_result(
                error_code="MCP_SERVER_NOT_FOUND",
                message=f"MCP server '{server_name}' not found",
                execution_time=execution_time
            )
        
        return {
            "success": True,
            "server_name": server_name,
            "content": json.dumps({
                "prompts": server_info.prompts
            }, ensure_ascii=False),
            "metadata": {
                "execution_time": execution_time,
                "server_id": server_info.server_id
            }
        }
    
    def get_connection_status(self, server_name: str) -> str:
        """获取连接状态
        
        Args:
            server_name (str): 服务器名称
        
        Returns:
            str: 连接状态 ("connected", "disconnected", "not_found")
        """
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info:
            return "not_found"
        if server_info.is_connected and server_info.client:
            return "connected"
        return "disconnected"
    
    def get_all_connection_status(self) -> Dict[str, str]:
        """获取所有服务器连接状态
        
        Returns:
            Dict[str, str]: 服务器名称到连接状态的映射
        """
        return {
            name: self.get_connection_status(name)
            for name in self._mcp_servers_info.keys()
        }
    
    async def cleanup(self) -> None:
        """清理所有资源"""
        await self.disconnect()
        self._mcp_servers_info.clear()


async def mcp_tool_function(
    server_name: str,
    tool_name: str,
    arguments: Dict[str, Any] = None,
    **kwargs
) -> Dict[str, Any]:
    """MCP工具函数 - 直接调用入口
    
    提供简化的函数式调用接口。
    
    Args:
        server_name (str): MCP服务器名称
        tool_name (str): 工具名称
        arguments (Dict[str, Any], optional): 工具参数
        **kwargs: 额外参数
    
    Returns:
        Dict[str, Any]: 执行结果
    
    Example:
        >>> result = await mcp_tool_function(
        ...     server_name="github",
        ...     tool_name="create_issue",
        ...     arguments={"owner": "xxx", "repo": "xxx", "title": "Bug"}
        ... )
    """
    tool = MCPTool()
    return await tool.execute(
        server_name=server_name,
        tool_name=tool_name,
        arguments=arguments,
        **kwargs
    )


def get_mcp_tool_spec(mcp_servers_info: Optional[Dict[str, MCPServerInfo]] = None) -> Dict[str, Any]:
    """获取MCP工具规范
    
    Args:
        mcp_servers_info (Dict[str, MCPServerInfo], optional): MCP服务器信息字典
    
    Returns:
        Dict[str, Any]: 工具规范，用于注册到ToolkitExecutor
    """
    tool = MCPTool(mcp_servers_info=mcp_servers_info)
    return tool.get_tool_spec()
