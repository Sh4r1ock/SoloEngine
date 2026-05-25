# -*- coding: utf-8 -*-
"""
SoloEngine : MCP服务器管理API模块，提供MCP服务器管理相关API端点

@file mcp_servers.py
@description MCP服务器接口 - MCP服务器管理相关API端点
@author Sh4rlock
@date 2026-04-09

功能描述：
- 获取所有MCP服务器配置列表接口
- 添加新的MCP服务器配置接口
- 更新MCP服务器配置接口
- 删除MCP服务器配置接口
- 连接/断开MCP服务器接口
- 获取MCP工具列表接口
- Python编写MCP支持
- 用户数据隔离

使用场景：
- MCP服务器配置和管理
- MCP工具和资源调用
- 自定义MCP开发

注意事项：
- 支持多种传输协议（http、websocket、stdio等）
- 需要正确配置服务器连接参数
- 支持导入开源MCP服务器配置
"""

import os
import uuid
import logging
import asyncio
import re
import shutil
import zipfile
import tempfile
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Request
from app.core.config import settings
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, mcp_db_manager, MCPServerModel, MCPStdioConfigModel
from app.core.data_paths import DataPaths
from app.api.v1.auth import get_current_user
from app.core.auth import User
from app.utils.timezone_utils import format_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/mcp", tags=["mcp"])


def get_mcp_server_dir(user_id: str, name: str) -> str:
    """获取MCP Server存储目录（用户隔离）。"""
    base_dir = DataPaths.get_user_mcp_servers_dir(user_id)
    DataPaths.ensure_dir(base_dir)
    server_dir = os.path.join(base_dir, name)
    DataPaths.ensure_dir(server_dir)
    return server_dir


def fill_server_data(server, server_data: dict):
    if server.transport_type == "stdio" and server.stdio_config:
        server_data["command"] = server.stdio_config.command
        server_data["args"] = server.stdio_config.args or []
        server_data["env"] = server.stdio_config.env or {}
        server_data["folder_path"] = server.stdio_config.folder_path
    elif server.transport_type == "http" and server.http_config:
        server_data["url"] = server.http_config.url
        server_data["headers"] = server.http_config.headers or {}
        server_data["timeout"] = server.http_config.timeout or 30
    elif server.transport_type == "sse" and server.sse_config:
        server_data["url"] = server.sse_config.url
        server_data["headers"] = server.sse_config.headers or {}
        server_data["timeout"] = server.sse_config.timeout or 30


def build_mcp_config(server) -> dict:
    if server.transport_type == "stdio" and server.stdio_config:
        return {"transport": server.transport_type, "command": server.stdio_config.command, "args": server.stdio_config.args, "env": server.stdio_config.env}
    elif server.transport_type == "http" and server.http_config:
        return {"transport": server.transport_type, "url": server.http_config.url, "headers": server.http_config.headers, "timeout": server.http_config.timeout}
    elif server.transport_type == "sse" and server.sse_config:
        return {"transport": server.transport_type, "url": server.sse_config.url, "headers": server.sse_config.headers, "timeout": server.sse_config.timeout}
    return {"transport": server.transport_type}

class MCPServerCreate(BaseModel):
    name: str = Field(..., description="服务器名称")
    transport: str = Field("http", description="传输类型: http, websocket, stdio, sse")
    url: Optional[str] = Field(None, description="服务器 URL (http/websocket)")
    command: Optional[str] = Field(None, description="命令 (stdio)")
    args: Optional[List[str]] = Field(None, description="命令参数")
    env: Optional[Dict[str, str]] = Field(None, description="环境变量")
    headers: Optional[Dict[str, str]] = Field(None, description="HTTP 头")
    timeout: int = Field(30, description="超时时间（秒）")
    is_active: bool = Field(True, description="是否启用")
    tags: Optional[List[str]] = Field(None, description="标签列表")


class MCPServerUpdate(BaseModel):
    name: Optional[str] = None
    transport: Optional[str] = None
    url: Optional[str] = None
    command: Optional[str] = None
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    headers: Optional[Dict[str, str]] = None
    timeout: Optional[int] = None
    is_active: Optional[bool] = None
    tags: Optional[List[str]] = None
    description: Optional[str] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")
    tools: Optional[List[Dict[str, Any]]] = Field(None, description="工具列表")


class CreatePythonMCPRequest(BaseModel):
    name: str = Field(..., description="MCP名称")
    description: str = Field("", description="MCP描述")
    tools: List[Dict[str, Any]] = Field(default_factory=list, description="工具列表")
    tags: Optional[List[str]] = Field(None, description="标签列表")


class CreateHttpMCPRequest(BaseModel):
    name: str = Field(..., description="MCP名称")
    description: str = Field("", description="MCP描述")
    url: str = Field(..., description="HTTP服务器URL")
    headers: Optional[Dict[str, str]] = Field(default_factory=dict, description="HTTP请求头")
    timeout: int = Field(30, description="超时时间（秒）")
    session_id: Optional[str] = Field(None, description="会话ID")
    is_active: Optional[bool] = Field(True, description="是否启用")
    share: Optional[bool] = Field(False, description="是否共享")
    tags: Optional[List[str]] = Field(None, description="标签列表")


class CreateSseMCPRequest(BaseModel):
    name: str = Field(..., description="MCP名称")
    description: str = Field("", description="MCP描述")
    url: str = Field(..., description="SSE服务器URL")
    headers: Optional[Dict[str, str]] = Field(default_factory=dict, description="HTTP请求头")
    timeout: int = Field(30, description="超时时间（秒）")
    reconnect: Optional[bool] = Field(True, description="是否自动重连")
    sse_endpoint: Optional[str] = Field("/sse", description="SSE端点路径")
    retry_interval: Optional[int] = Field(5, description="重试间隔（秒）")
    max_retries: Optional[int] = Field(3, description="最大重试次数")
    is_active: Optional[bool] = Field(True, description="是否启用")
    share: Optional[bool] = Field(False, description="是否共享")
    tags: Optional[List[str]] = Field(None, description="标签列表")


class CallToolRequest(BaseModel):
    arguments: Dict[str, Any] = Field(default_factory=dict, description="工具参数")


class ReadResourceRequest(BaseModel):
    uri: str = Field(..., description="资源 URI")


class GetPromptRequest(BaseModel):
    arguments: Optional[Dict[str, Any]] = Field(None, description="提示词参数")


@router.get("/servers")
async def list_servers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取用户的所有 MCP 服务器（包含系统MCP和用户自己的MCP）。"""
    user_id = current_user.id

    servers = mcp_db_manager.get_servers(db, user_id)
    
    user_server_names = {s.name for s in servers}
    
    result = []
    
    for server in servers:
        # 根据 transport_type 获取对应的配置
        server_data = {
            "id": server.id,
            "user_id": server.user_id,
            "name": server.name,
            "transport": server.transport_type,
            "description": server.description,
            "url": "",
            "command": None,
            "args": [],
            "env": {},
            "headers": {},
            "timeout": 30,
            "is_active": server.is_active,
            "is_public": server.is_public,
            "is_default": False,
            "version": server.version,
            "status": "connected" if server.is_active else "disconnected",
            "created_at": format_iso(server.created_at),
            "updated_at": format_iso(server.updated_at),
            "tags": server.tags or [],
            "tools": server.tools or [],
        }
        
        fill_server_data(server, server_data)
        
        result.append(server_data)

    return {
        "code": 200,
        "message": "MCP servers retrieved",
        "data": result,
    }


@router.post("/servers")
async def add_server(
    server: MCPServerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """添加 MCP 服务器。"""
    user_id = current_user.id
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        name=server.name,
        transport_type=server.transport,
        description=None,
        is_active=server.is_active,
        tags=server.tags,
    )
    
    # 根据传输类型创建对应的配置
    if server.transport == "stdio" and (server.command or server.args):
        mcp_db_manager.create_stdio_config(
            db=db,
            mcp_server_id=new_server.id,
            command=server.command,
            args=server.args or [],
            env=server.env or {},
        )
    elif server.transport == "http" and server.url:
        mcp_db_manager.create_http_config(
            db=db,
            mcp_server_id=new_server.id,
            url=server.url,
            headers=server.headers or {},
            timeout=server.timeout or 30,
        )
    elif server.transport == "sse" and server.url:
        mcp_db_manager.create_sse_config(
            db=db,
            mcp_server_id=new_server.id,
            url=server.url,
            headers=server.headers or {},
            timeout=server.timeout or 30,
        )
    
    return {
        "code": 200,
        "message": "MCP server added",
        "data": {
            "id": new_server.id,
            "user_id": new_server.user_id,
            "name": new_server.name,
            "transport": new_server.transport_type,
            "url": server.url or "",
            "command": server.command,
            "args": server.args or [],
            "env": server.env or {},
            "headers": server.headers or {},
            "timeout": server.timeout or 30,
            "is_active": new_server.is_active,
            "status": "disconnected",
        },
    }


@router.get("/servers/{server_id}")
async def get_server(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定的 MCP 服务器。"""
    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    server_data = {
        "id": server.id,
        "user_id": server.user_id,
        "name": server.name,
        "transport": server.transport_type,
        "url": "",
        "command": None,
        "args": [],
        "env": {},
        "headers": {},
        "timeout": 30,
        "is_active": server.is_active,
        "is_public": server.is_public,
        "status": "disconnected",
    }
    
    fill_server_data(server, server_data)
    
    return {
        "code": 200,
        "message": "Server retrieved",
        "data": server_data,
    }


@router.put("/servers/{server_id}")
async def update_server(
    server_id: str,
    update: MCPServerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新 MCP 服务器配置（带乐观锁）。"""
    user_id = current_user.id
    
    # 首先获取服务器以检查类型
    server = mcp_db_manager.get_server(db, server_id, user_id)
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    # 更新主服务器配置
    update_data = {}
    if update.name is not None:
        update_data["name"] = update.name
    if update.transport is not None:
        update_data["transport_type"] = update.transport
    if update.is_active is not None:
        update_data["is_active"] = update.is_active
    if update.tags is not None:
        update_data["tags"] = update.tags
    if update.description is not None:
        update_data["description"] = update.description
    if update.tools is not None:
        update_data["tools"] = update.tools
    
    server = mcp_db_manager.update_server(
            db, server_id, user_id, version=update.version, **update_data
        )
    
    # 更新传输类型特定的配置
    if server.transport_type == "stdio" and server.stdio_config:
        if update.command is not None:
            server.stdio_config.command = update.command
        if update.args is not None:
            server.stdio_config.args = update.args
        if update.env is not None:
            server.stdio_config.env = update.env
    elif server.transport_type == "http" and server.http_config:
        if update.url is not None:
            server.http_config.url = update.url
        if update.headers is not None:
            server.http_config.headers = update.headers
        if update.timeout is not None:
            server.http_config.timeout = update.timeout
    elif server.transport_type == "sse" and server.sse_config:
        if update.url is not None:
            server.sse_config.url = update.url
        if update.headers is not None:
            server.sse_config.headers = update.headers
        if update.timeout is not None:
            server.sse_config.timeout = update.timeout
    
    db.commit()
    
    return {
        "code": 200,
        "message": "Server updated",
        "data": {
            "id": server.id,
            "name": server.name,
            "transport": server.transport_type,
            "url": server.http_config.url if server.http_config else (server.sse_config.url if server.sse_config else ""),
            "is_active": server.is_active,
            "version": server.version,
        },
    }


@router.delete("/servers/{server_id}")
async def delete_server(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除 MCP 服务器。"""
    user_id = current_user.id
    success = mcp_db_manager.delete_server(db, server_id, user_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    return {
        "code": 200,
        "message": "Server deleted",
        "data": {"server_id": server_id},
    }


@router.post("/servers/python")
async def create_python_mcp(
    request: CreatePythonMCPRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建Python编写的MCP。"""
    user_id = current_user.id
    mcp_dir = get_mcp_server_dir(user_id, request.name)
    os.makedirs(mcp_dir, exist_ok=True)
    
    tools_code = ""
    for tool in request.tools:
        tool_name = tool.get("name", "unnamed_tool")
        tool_description = tool.get("description", "")
        tool_params = tool.get("parameters", {})
        
        params_str = ", ".join([f"{p['name']}: {p.get('type', 'Any')}" for p in tool_params.get("properties", {}).values()])
        
        tools_code += f'''
@mcp.tool()
def {tool_name}({params_str}) -> str:
    """
    {tool_description}
    """
    import json
    import logging
    logger = logging.getLogger("{request.name}")
    logger.info(f"Tool {tool_name} called with params: {{locals()}}")
    result = {{
        "tool": "{tool_name}",
        "params": {{k: v for k, v in locals().items() if k != 'logger'}},
        "status": "executed"
    }}
    return json.dumps(result, ensure_ascii=False)

'''
    
    main_py_content = f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
{request.name} MCP Server
{request.description}
"""

import asyncio
import json
from typing import Any, Dict, List
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("{request.name}")

{tools_code}

if __name__ == "__main__":
    mcp.run(transport="stdio")
'''
    
    main_py_path = os.path.join(mcp_dir, "main.py")
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(main_py_content)
    
    requirements_content = """mcp>=1.0.0
"""
    requirements_path = os.path.join(mcp_dir, "requirements.txt")
    with open(requirements_path, "w", encoding="utf-8") as f:
        f.write(requirements_content)
    
    readme_content = f"""# {request.name} MCP Server

{request.description}

## 安装

```bash
pip install -r requirements.txt
```

## 运行

```bash
python main.py
```

## 工具列表

"""
    for tool in request.tools:
        readme_content += f"- **{tool.get('name')}**: {tool.get('description', '')}\n"
    
    readme_path = os.path.join(mcp_dir, "README.md")
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(readme_content)
    
    # 创建服务器记录
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        name=request.name,
        transport_type="stdio",
        description=f"Python MCP: {request.name}",
        enabled=True,
        tags=request.tags,
    )
    
    # 创建stdio配置
    mcp_db_manager.create_stdio_config(
        db=db,
        mcp_server_id=new_server.id,
        command="python",
        args=[main_py_path],
        env={},
        folder_path=mcp_dir,
    )
    
    return {
        "code": 200,
        "message": "Python MCP created",
        "data": {
            "id": new_server.id,
            "name": new_server.name,
            "path": mcp_dir,
            "main_file": main_py_path,
        },
    }


@router.get("/servers/{server_id}/code")
async def get_mcp_code(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取MCP的Python代码。"""
    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    if server.transport_type != "stdio" or not server.stdio_config:
        raise HTTPException(status_code=400, detail="Server is not a Python MCP")
    
    main_py_path = server.stdio_config.args[0] if server.stdio_config.args else None
    if not main_py_path or not os.path.exists(main_py_path):
        raise HTTPException(status_code=404, detail="MCP code file not found")
    
    with open(main_py_path, "r", encoding="utf-8") as f:
        code = f.read()
    
    return {
        "code": 200,
        "message": "MCP code retrieved",
        "data": {
            "server_id": server_id,
            "name": server.name,
            "code": code,
            "path": main_py_path,
        },
    }


class UpdateMCPCodeRequest(BaseModel):
    code: str = Field(..., description="Python代码")


@router.put("/servers/{server_id}/code")
async def update_mcp_code(
    server_id: str,
    request: UpdateMCPCodeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新MCP的Python代码。"""
    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)

    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    if server.transport_type != "stdio" or not server.stdio_config:
        raise HTTPException(status_code=400, detail="Server is not a Python MCP")

    main_py_path = server.stdio_config.args[0] if server.stdio_config.args else None
    if not main_py_path:
        raise HTTPException(status_code=404, detail="MCP code file not found")

    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(request.code)

    return {
        "code": 200,
        "message": "MCP code updated",
        "data": {"server_id": server_id},
    }


@router.post("/servers/{server_id}/connect")
async def connect_server(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """连接到 MCP 服务器。"""
    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)

    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    server.is_active = True
    db.commit()

    return {
        "code": 200,
        "message": "Connected successfully",
        "data": {"server_id": server_id, "status": "connected"},
    }


@router.post("/servers/{server_id}/disconnect")
async def disconnect_server(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """断开 MCP 服务器连接。"""
    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)

    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    server.is_active = False
    db.commit()

    return {
        "code": 200,
        "message": "Disconnected successfully",
        "data": {"server_id": server_id, "status": "disconnected"},
    }


@router.post("/servers/connect")
async def connect_server(server: MCPServerCreate, current_user: User = Depends(get_current_user)):
    """测试 MCP 服务器连接。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient
    
    config = {
        "transport": server.transport,
        "url": server.url,
        "command": server.command,
        "args": server.args,
        "env": server.env,
        "headers": server.headers,
        "timeout": server.timeout,
    }
    
    try:
        async with MCPClient(config) as client:
            tools = await client.get_tools()
            
            return {
                "code": 200,
                "message": "Connection test successful",
                "data": {
                    "connected": True,
                    "tools_count": len(tools),
                    "tools": [{"name": t.get("name"), "description": t.get("description", ""), "input_schema": t.get("inputSchema", {})} for t in tools],
                },
            }
    except Exception as e:
        logger.error(f"MCP connection test failed: {e}")
        return {
            "code": 500,
            "message": f"Connection test failed: {str(e)}",
            "data": {
                "connected": False,
                "error": str(e),
            },
        }


@router.get("/servers/{server_id}/tools")
async def get_server_tools(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取MCP服务器的工具列表。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient

    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)

    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    config = build_mcp_config(server)

    try:
        async with MCPClient(config) as client:
            tools = await client.get_tools()

            return {
                "code": 200,
                "message": "Tools retrieved",
                "data": [
                    {
                        "name": t.get("name"),
                        "description": t.get("description", ""),
                        "input_schema": t.get("inputSchema", {}),
                        "server_id": server_id,
                        "server_name": server.name,
                    }
                    for t in tools
                ],
            }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"Failed to get tools: {str(e)}",
                "data": [],
            }
        )


@router.post("/servers/{server_id}/tools/{tool_name}/call")
async def call_server_tool(
    server_id: str,
    tool_name: str,
    request: CallToolRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """调用MCP服务器的工具。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient
    import re

    if not re.match(r'^[\w\-\.]+$', tool_name):
        raise HTTPException(status_code=400, detail="Invalid tool name format")

    if request.arguments:
        serialized_size = len(str(request.arguments))
        if serialized_size > 1024 * 1024:
            raise HTTPException(status_code=413, detail="Arguments size exceeds 1MB limit")

    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)

    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    config = build_mcp_config(server)

    try:
        async with MCPClient(config) as client:
            result = await client.call_tool(tool_name, request.arguments)

            return {
                "code": 200,
                "message": "Tool called successfully",
                "data": result,
            }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"Failed to call tool: {str(e)}",
                "data": None,
            }
        )


@router.get("/tools/all")
async def get_all_tools(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有已启用MCP服务器的工具。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient

    user_id = current_user.id
    servers = mcp_db_manager.get_servers(db, user_id)

    async def get_server_tools(server):
        tools = []
        try:
            config = build_mcp_config(server)

            async with MCPClient(config) as client:
                server_tools = await client.get_tools()

                for t in server_tools:
                    tools.append({
                        "name": t.get("name"),
                        "description": t.get("description", ""),
                        "input_schema": t.get("inputSchema", {}),
                        "server_id": server.id,
                        "server_name": server.name,
                    })
        except Exception as e:
            logger.error(f"Failed to get tools from server {server.name}: {e}")
        return tools

    enabled_servers = [s for s in servers if s.is_active]
    results = await asyncio.gather(*[get_server_tools(s) for s in enabled_servers], return_exceptions=True)

    all_tools = []
    for result in results:
        if isinstance(result, list):
            all_tools.extend(result)

    return {
        "code": 200,
        "message": "All tools retrieved",
        "data": all_tools,
    }


@router.get("/servers/{server_id}/resources")
async def get_server_resources(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取MCP服务器的资源列表。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient
    
    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    config = build_mcp_config(server)
    
    try:
        async with MCPClient(config) as client:
            resources = await client.get_resources()
            
            return {
                "code": 200,
                "message": "Resources retrieved",
                "data": [
                    {
                        "uri": r.get("uri"),
                        "name": r.get("name"),
                        "description": r.get("description", ""),
                        "mime_type": r.get("mimeType"),
                        "server_id": server_id,
                        "server_name": server.name,
                    }
                    for r in resources
                ],
            }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"Failed to get resources: {str(e)}",
                "data": [],
            }
        )


@router.get("/servers/{server_id}/prompts")
async def get_server_prompts(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取MCP服务器的提示词列表。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient
    
    user_id = current_user.id
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    config = build_mcp_config(server)
    
    try:
        async with MCPClient(config) as client:
            prompts = await client.get_prompts()
            
            return {
                "code": 200,
                "message": "Prompts retrieved",
                "data": [
                    {
                        "name": p.get("name"),
                        "description": p.get("description", ""),
                        "arguments": p.get("arguments", []),
                        "server_id": server_id,
                        "server_name": server.name,
                    }
                    for p in prompts
                ],
            }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"Failed to get prompts: {str(e)}",
                "data": [],
            }
        )


@router.post("/servers/create/stdio")
async def create_stdio_mcp(
    request: Request,
    name: str = Form(...),
    description: str = Form("", description="MCP Server 描述"),
    tags: Optional[str] = Form(None, description="标签列表 (JSON字符串)"),
    package: Optional[UploadFile] = File(None, description="MCP Server 包 (.zip)"),
    files: Optional[List[UploadFile]] = File(None, description="文件夹中的所有文件"),
    file_paths: Optional[List[str]] = Form(None, description="文件相对路径列表"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建Stdio MCP（上传ZIP包或文件夹）。
    
    上传的 ZIP 包将被解压到 mcp_server 目录，或文件夹中的文件将被存储。
    ZIP 包应包含 main.py 或 __main__.py 作为入口文件。
    """
    user_id = current_user.id
    
    if not package and not files:
        raise HTTPException(status_code=400, detail="Either package or files must be provided")
    
    safe_name = re.sub(r'[^\w\-]', '_', name)
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid server name")
    
    server_dir = get_mcp_server_dir(user_id, safe_name)
    
    main_py_path = None
    entry_file = None
    
    if package:
        if not package.filename.endswith('.zip') and not package.filename.endswith('.mcpb'):
            raise HTTPException(status_code=400, detail="Only ZIP or MCPB packages are allowed")
        
        temp_dir = tempfile.mkdtemp()
        try:
            temp_zip_path = os.path.join(temp_dir, "package.zip")
            with open(temp_zip_path, "wb") as f:
                content = await package.read()
                f.write(content)
            
            with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                zip_ref.extractall(server_dir)
            
            # 处理嵌套目录（GitHub下载的ZIP常见）
            extracted_items = [item for item in os.listdir(server_dir) if not item.startswith('.')]
            if len(extracted_items) == 1:
                potential_root = os.path.join(server_dir, extracted_items[0])
                if os.path.isdir(potential_root):
                    logger.info(f"[STDIO] Flattening nested directory: {extracted_items[0]}")
                    for item in os.listdir(potential_root):
                        shutil.move(os.path.join(potential_root, item), os.path.join(server_dir, item))
                    os.rmdir(potential_root)
            
            # 查找入口文件 - 支持 Python 和 Node.js
            entry_candidates = [
                # Python 入口文件
                'main.py', '__main__.py', 'server.py', 'app.py',
                # Node.js 入口文件
                'index.js', 'cli.js', 'server.js', 'app.js',
                # 其他可能的入口
                'package.json'
            ]
            
            for entry in entry_candidates:
                candidate = os.path.join(server_dir, entry)
                if os.path.exists(candidate):
                    main_py_path = candidate
                    entry_file = entry
                    break
            
            if not main_py_path:
                for root, dirs, filenames in os.walk(server_dir):
                    for filename in filenames:
                        if filename in entry_candidates:
                            main_py_path = os.path.join(root, filename)
                            entry_file = filename
                            break
                    if main_py_path:
                        break
            
            if not main_py_path:
                raise HTTPException(status_code=400, detail="No valid entry file found (main.py, __main__.py, server.py, app.py for Python; index.js, cli.js, server.js, app.js for Node.js)")
        
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Invalid ZIP file")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    elif files:
        if os.path.exists(server_dir):
            shutil.rmtree(server_dir)
        os.makedirs(server_dir, exist_ok=True)
        
        for idx, file in enumerate(files):
            # 使用前端传递的 file_paths 作为相对路径，保持文件夹结构
            if file_paths and idx < len(file_paths) and file_paths[idx]:
                relative_path = file_paths[idx]
            else:
                relative_path = file.filename
            
            if not relative_path:
                continue
            
            file_path = os.path.join(server_dir, relative_path)
            file_dir = os.path.dirname(file_path)
            os.makedirs(file_dir, exist_ok=True)
            
            content = await file.read()
            with open(file_path, "wb") as f:
                f.write(content)
        
        # 查找入口文件 - 支持多种语言和格式
        entry_candidates = [
            # Python
            'main.py', '__main__.py', 'server.py', 'app.py',
            # Node.js / TypeScript
            'index.js', 'cli.js', 'server.js', 'app.js',
            'index.ts', 'server.ts', 'app.ts',
            # Go
            'main.go',
            # Rust
            'main.rs', 'lib.rs',
            # Java
            'Main.java',
            # PHP
            'index.php',
            # Shell
            'run.sh', 'start.sh',
            # Binary
            'mcp-server', 'server'
        ]
        
        for entry in entry_candidates:
            candidate = os.path.join(server_dir, entry)
            if os.path.exists(candidate):
                main_py_path = candidate
                entry_file = entry
                break
        
        if not main_py_path:
            for root, dirs, filenames in os.walk(server_dir):
                for filename in filenames:
                    if filename in entry_candidates:
                        main_py_path = os.path.join(root, filename)
                        entry_file = filename
                        break
                if main_py_path:
                    break
        
        if not main_py_path:
            raise HTTPException(status_code=400, detail="No valid entry file found. Supported: Python (.py), Node.js (.js/.ts), Go (.go), Rust (.rs), Java (.java), PHP (.php), Shell (.sh), or binary")
    
    # 根据入口文件类型确定运行命令
    if entry_file:
        ext = os.path.splitext(entry_file)[1].lower()
        basename = os.path.basename(entry_file).lower()
        
        if ext == '.py' or basename == '__main__.py':
            run_command = "python"
            run_args = [main_py_path]
        elif ext in ['.js', '.mjs']:
            run_command = "node"
            run_args = [main_py_path]
        elif ext == '.ts':
            run_command = "npx"
            run_args = ["tsx", main_py_path]
        elif ext == '.go':
            run_command = "go"
            run_args = ["run", main_py_path]
        elif ext in ['.rs', '.lib.rs']:
            run_command = "cargo"
            run_args = ["run", "--manifest-path", os.path.join(server_dir, "Cargo.toml")] if os.path.exists(os.path.join(server_dir, "Cargo.toml")) else ["run", "--bin", entry_file.replace('.rs', '')]
        elif ext == '.java':
            run_command = "java"
            run_args = [main_py_path]
        elif ext == '.php':
            run_command = "php"
            run_args = [main_py_path]
        elif ext in ['.sh']:
            run_command = "bash"
            run_args = [main_py_path]
        elif basename in ['run.sh', 'start.sh']:
            run_command = "bash"
            run_args = [main_py_path]
        elif basename == 'package.json':
            # Node.js 项目，使用 npx 运行
            run_command = "npx"
            run_args = ["-y", server_dir]
        elif basename in ['mcp-server', 'server']:
            run_command = os.path.join(server_dir, entry_file)
            run_args = []
        else:
            run_command = "python"
            run_args = [main_py_path]
    else:
        run_command = "python"
        run_args = []
    
    # 解析标签
    import json
    parsed_tags = []
    if tags:
        try:
            parsed_tags = json.loads(tags)
            if not isinstance(parsed_tags, list):
                parsed_tags = []
        except json.JSONDecodeError:
            parsed_tags = []
    
    # 创建数据库记录
    try:
        new_server = MCPServerModel(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=name,
            transport_type="stdio",
            description=description,
            is_active=True,
            author="user",
            tags=parsed_tags,
        )
        db.add(new_server)
        db.flush()
        
        stdio_config = MCPStdioConfigModel(
            mcp_server_id=new_server.id,
            command=run_command,
            args=run_args,
            folder_path=server_dir,
        )
        db.add(stdio_config)
        db.commit()
        db.refresh(new_server)

        tools = []
        try:
            from SoloAgent.plugins.mcp.mcp_client import MCPClient

            async with MCPClient({
                "transport": "stdio",
                "command": run_command,
                "args": run_args,
                "env": {},
            }) as client:
                tools = await client.get_tools()

            mcp_db_manager.update_server_tools(
                db=db,
                mcp_server_id=new_server.id,
                tools=tools,
                user_id=user_id
            )

            logger.info(f"[STDIO] Loaded {len(tools)} tools for server '{name}'")
        except Exception as e:
            logger.warning(f"[STDIO] Failed to get tools for new server: {e}")

        return {
            "code": 200,
            "message": "Stdio MCP Server created successfully",
            "data": {
                "id": new_server.id,
                "name": new_server.name,
                "transport_type": "stdio",
                "folder_path": server_dir,
                "entry_file": entry_file,
                "main_file": main_py_path,
                "tools_count": len(tools),
                "tools": tools,
            },
        }
    except Exception as e:
        db.rollback()
        logger.error(f"[STDIO] Failed to create server: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create server: {str(e)}")


@router.post("/servers/create/http")
async def create_http_mcp(
    request: CreateHttpMCPRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建HTTP MCP服务器。

    通过URL连接到远程HTTP MCP服务器。
    """
    user_id = current_user.id

    # 验证URL格式
    if not request.url or not request.url.startswith(('http://', 'https://')):
        raise HTTPException(status_code=400, detail="Invalid URL format. URL must start with http:// or https://")

    try:
        # 创建服务器记录
        new_server = MCPServerModel(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=request.name,
            transport_type="http",
            description=request.description,
            is_active=request.is_active if request.is_active is not None else True,
            is_public=request.share if request.share is not None else False,
            author="user",
            tags=request.tags or [],
        )
        db.add(new_server)
        db.flush()

        # 创建HTTP配置
        from app.core.database import MCPHttpConfigModel
        http_config = MCPHttpConfigModel(
            mcp_server_id=new_server.id,
            url=request.url,
            headers=request.headers or {},
            timeout=request.timeout or 30,
            session_id=request.session_id,
        )
        db.add(http_config)
        db.commit()
        db.refresh(new_server)

        tools = []
        try:
            from SoloAgent.plugins.mcp.mcp_client import MCPClient

            async with MCPClient({
                "transport": "http",
                "url": request.url,
                "headers": request.headers or {},
                "timeout": request.timeout or 30,
            }) as client:
                tools = await client.get_tools()

            mcp_db_manager.update_server_tools(
                db=db,
                mcp_server_id=new_server.id,
                tools=tools,
                user_id=user_id
            )
            logger.info(f"[HTTP] Loaded {len(tools)} tools for server '{request.name}'")
        except Exception as e:
            logger.warning(f"[HTTP] Failed to get tools for new server: {e}")

        return {
            "code": 200,
            "message": "HTTP MCP Server created successfully",
            "data": {
                "id": new_server.id,
                "name": new_server.name,
                "transport_type": "http",
                "url": request.url,
                "tools_count": len(tools),
                "tools": tools,
            },
        }
    except Exception as e:
        db.rollback()
        logger.error(f"[HTTP] Failed to create server: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create server: {str(e)}")


@router.post("/servers/create/sse")
async def create_sse_mcp(
    request: CreateSseMCPRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建SSE MCP服务器。

    通过URL连接到远程SSE MCP服务器。
    """
    user_id = current_user.id

    # 验证URL格式
    if not request.url or not request.url.startswith(('http://', 'https://')):
        raise HTTPException(status_code=400, detail="Invalid URL format. URL must start with http:// or https://")

    try:
        # 创建服务器记录
        new_server = MCPServerModel(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=request.name,
            transport_type="sse",
            description=request.description,
            is_active=request.is_active if request.is_active is not None else True,
            is_public=request.share if request.share is not None else False,
            author="user",
            tags=request.tags or [],
        )
        db.add(new_server)
        db.flush()

        # 创建SSE配置
        from app.core.database import MCPSseConfigModel
        sse_config = MCPSseConfigModel(
            mcp_server_id=new_server.id,
            url=request.url,
            headers=request.headers or {},
            timeout=request.timeout or 30,
            reconnect=request.reconnect if request.reconnect is not None else True,
            sse_endpoint=request.sse_endpoint if request.sse_endpoint else "/sse",
            retry_interval=request.retry_interval if request.retry_interval is not None else 5,
            max_retries=request.max_retries if request.max_retries is not None else 3,
        )
        db.add(sse_config)
        db.commit()
        db.refresh(new_server)

        tools = []
        try:
            from SoloAgent.plugins.mcp.mcp_client import MCPClient

            async with MCPClient({
                "transport": "sse",
                "url": request.url,
                "headers": request.headers or {},
                "timeout": request.timeout or 30,
            }) as client:
                tools = await client.get_tools()

            mcp_db_manager.update_server_tools(
                db=db,
                mcp_server_id=new_server.id,
                tools=tools,
                user_id=user_id
            )
            logger.info(f"[SSE] Loaded {len(tools)} tools for server '{request.name}'")
        except Exception as e:
            logger.warning(f"[SSE] Failed to get tools for new server: {e}")

        return {
            "code": 200,
            "message": "SSE MCP Server created successfully",
            "data": {
                "id": new_server.id,
                "name": new_server.name,
                "transport_type": "sse",
                "url": request.url,
                "tools_count": len(tools),
                "tools": tools,
            },
        }
    except Exception as e:
        db.rollback()
        logger.error(f"[SSE] Failed to create server: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create server: {str(e)}")


class UpdateToolEnabledRequest(BaseModel):
    """更新工具启用状态请求。"""
    is_active: bool = Field(..., description="是否启用")


@router.put("/servers/{server_id}/tools/{tool_name}/enabled")
async def update_tool_enabled(
    server_id: str,
    tool_name: str,
    request: UpdateToolEnabledRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新单个工具的启用状态。"""
    user_id = current_user.id

    server = mcp_db_manager.update_tool_enabled(
        db, server_id, tool_name, request.is_active, user_id
    )

    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")

    return {
        "code": 200,
        "message": "Tool enabled status updated",
        "data": {
            "server_id": server_id,
            "tool_name": tool_name,
            "is_active": request.is_active,
        },
    }
