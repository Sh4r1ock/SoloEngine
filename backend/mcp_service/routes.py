# -*- coding: utf-8 -*-
"""
API路由 - MCP服务API端点。
"""

import os
import re
import json
import uuid
import logging
import asyncio
import shutil
import tempfile
import zipfile
import ast
from typing import List, Optional, Dict, Any
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends, Query, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .database import get_db, mcp_db_manager, MCPServerModel, OptimisticLockError
from .config import OPEN_SOURCE_MCPS, DEFAULT_MCP_SERVERS, MAX_TOOL_ARGUMENTS_SIZE
from .host.registry import MCPServerInfo, ServerStatus, service_registry
from .host.lifecycle import lifecycle_manager
from .host.caller import unified_caller

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/mcp", tags=["mcp"])

MCP_SERVERS_STORAGE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "mcp_service", "mcp_server"
)
os.makedirs(MCP_SERVERS_STORAGE_DIR, exist_ok=True)


def get_mcp_server_dir(name: str) -> str:
    """获取MCP Server存储目录。"""
    server_dir = os.path.join(MCP_SERVERS_STORAGE_DIR, name)
    os.makedirs(server_dir, exist_ok=True)
    return server_dir


class MCPServerCreate(BaseModel):
    name: str = Field(..., description="服务器名称")
    transport: str = Field("stdio", description="传输类型: http, stdio, sse")
    description: Optional[str] = Field(None, description="服务器描述")
    url: Optional[str] = Field(None, description="服务器 URL (http/sse)")
    command: Optional[str] = Field(None, description="命令 (stdio)")
    args: Optional[List[str]] = Field(None, description="命令参数")
    env: Optional[Dict[str, str]] = Field(None, description="环境变量")
    headers: Optional[Dict[str, str]] = Field(None, description="HTTP 头")
    timeout: int = Field(30, description="超时时间（秒）")
    enabled: bool = Field(True, description="是否启用")


class MCPServerUpdate(BaseModel):
    name: Optional[str] = None
    transport: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    command: Optional[str] = None
    args: Optional[List[str]] = None
    env: Optional[Dict[str, str]] = None
    headers: Optional[Dict[str, str]] = None
    timeout: Optional[int] = None
    enabled: Optional[bool] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")


class CreatePythonMCPRequest(BaseModel):
    name: str = Field(..., description="MCP名称")
    description: str = Field("", description="MCP描述")
    tools: List[Dict[str, Any]] = Field(default_factory=list, description="工具列表")


class CallToolRequest(BaseModel):
    arguments: Dict[str, Any] = Field(default_factory=dict, description="工具参数")


class ReadResourceRequest(BaseModel):
    uri: str = Field(..., description="资源 URI")


class GetPromptRequest(BaseModel):
    arguments: Optional[Dict[str, Any]] = Field(None, description="提示词参数")


def model_to_server_info(server: MCPServerModel) -> MCPServerInfo:
    """将数据库模型转换为服务器信息。"""
    return MCPServerInfo(
        id=server.id,
        user_id=server.user_id,
        name=server.name,
        transport=server.transport,
        url=server.url,
        command=server.command,
        args=server.args or [],
        env=server.env or {},
        headers=server.headers or {},
        timeout=server.timeout,
        enabled=server.enabled,
        is_public=server.is_public,
        is_default=server.is_default,
        author=server.author,
        source=server.source,
        description=server.description,
        tags=server.tags or [],
        version=server.version,
        status=ServerStatus.DISCONNECTED,
        created_at=server.created_at,
        updated_at=server.updated_at,
        storage_path=server.storage_path,
        tools=server.tools or [],
    )


def get_mock_user_id() -> str:
    """获取模拟用户ID（用于简化认证）。"""
    return "default_user"


@router.get("/servers")
async def list_servers(
    db: Session = Depends(get_db)
):
    """获取用户的所有 MCP 服务器（包含系统默认MCP）。"""
    user_id = get_mock_user_id()
    servers = mcp_db_manager.get_servers(db, user_id)
    
    user_server_names = {s.name for s in servers}
    
    result = []
    
    for server in servers:
        server_info = model_to_server_info(server)
        result.append(server_info.to_dict())
    
    for idx, default_mcp in enumerate(DEFAULT_MCP_SERVERS):
        if default_mcp["name"] not in user_server_names:
            result.append({
                "id": f"default_{idx}",
                "user_id": "system",
                "name": default_mcp["name"],
                "transport": default_mcp.get("transport", "stdio"),
                "url": "",
                "command": default_mcp.get("command"),
                "args": default_mcp.get("args", []),
                "env": default_mcp.get("env", {}),
                "headers": {},
                "timeout": default_mcp.get("timeout", 30),
                "enabled": False,
                "is_public": True,
                "is_default": True,
                "author": default_mcp.get("author", "SoloEngine"),
                "source": default_mcp.get("source", ""),
                "description": default_mcp.get("description", ""),
                "tags": default_mcp.get("tags", []),
                "version": 0,
                "status": "disconnected",
                "created_at": None,
                "updated_at": None,
            })
    
    return {
        "code": 200,
        "message": "MCP servers retrieved",
        "data": result,
    }


@router.post("/servers")
async def add_server(
    server: MCPServerCreate,
    db: Session = Depends(get_db)
):
    """添加 MCP 服务器。"""
    user_id = get_mock_user_id()
    
    storage_path = None
    if server.transport == "stdio" and server.args:
        storage_path = server.args[0] if server.args else None
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        name=server.name,
        transport=server.transport,
        url=server.url,
        command=server.command,
        args=server.args,
        env=server.env,
        headers=server.headers,
        timeout=server.timeout,
        description=server.description,
        storage_path=storage_path,
    )
    
    server_info = model_to_server_info(new_server)
    
    return {
        "code": 200,
        "message": "MCP server added",
        "data": server_info.to_dict(),
    }


@router.get("/servers/{server_id}")
async def get_server(
    server_id: str,
    db: Session = Depends(get_db)
):
    """获取指定的 MCP 服务器。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    server_info = model_to_server_info(server)
    
    return {
        "code": 200,
        "message": "Server retrieved",
        "data": server_info.to_dict(),
    }


@router.put("/servers/{server_id}")
async def update_server(
    server_id: str,
    update: MCPServerUpdate,
    db: Session = Depends(get_db)
):
    """更新 MCP 服务器配置（带乐观锁）。"""
    user_id = get_mock_user_id()
    
    update_data = {}
    if update.name is not None:
        update_data["name"] = update.name
    if update.transport is not None:
        update_data["transport"] = update.transport
    if update.url is not None:
        update_data["url"] = update.url
    if update.command is not None:
        update_data["command"] = update.command
    if update.args is not None:
        update_data["args"] = update.args
    if update.env is not None:
        update_data["env"] = update.env
    if update.headers is not None:
        update_data["headers"] = update.headers
    if update.timeout is not None:
        update_data["timeout"] = update.timeout
    if update.enabled is not None:
        update_data["enabled"] = update.enabled
    if update.description is not None:
        update_data["description"] = update.description
    
    try:
        server = mcp_db_manager.update_server(
            db, server_id, user_id, version=update.version, **update_data
        )
    except OptimisticLockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    server_info = model_to_server_info(server)
    
    return {
        "code": 200,
        "message": "Server updated",
        "data": server_info.to_dict(),
    }


@router.delete("/servers/{server_id}")
async def delete_server(
    server_id: str,
    db: Session = Depends(get_db)
):
    """删除 MCP 服务器。"""
    user_id = get_mock_user_id()
    
    await lifecycle_manager.unregister_and_disconnect(server_id)
    
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
    db: Session = Depends(get_db)
):
    """创建Python编写的MCP Server（标准MCP协议）。"""
    user_id = get_mock_user_id()
    server_name = request.name
    
    server_dir = get_mcp_server_dir(server_name)
    
    tools_code = ""
    tools_list = []
    tools_call_handlers = ""
    
    for tool in request.tools:
        tool_name = tool.get("name", "unnamed_tool")
        tool_description = tool.get("description", "")
        tool_params = tool.get("parameters", {})
        
        params_list = []
        props = tool_params.get("properties", {})
        required = tool_params.get("required", [])
        
        for prop_name, prop_info in props.items():
            prop_type = prop_info.get("type", "str")
            type_map = {"string": "str", "integer": "int", "number": "float", "boolean": "bool", "array": "list", "object": "dict"}
            py_type = type_map.get(prop_type, "Any")
            if prop_name in required:
                params_list.append(f"{prop_name}: {py_type}")
            else:
                params_list.append(f"{prop_name}: {py_type} = None")
        
        params_str = ", ".join(params_list)
        
        tools_code += f'''
def {tool_name}({params_str}) -> dict:
    """
    {tool_description}
    """
    import logging
    logger = logging.getLogger("{server_name}")
    logger.info(f"Tool {tool_name} called")
    return {{
        "tool": "{tool_name}",
        "status": "executed",
        "params": {{k: v for k, v in locals().items() if k != 'logger'}}
    }}

'''
        
        tools_list.append(f'''        Tool(
            name="{tool_name}",
            description="{tool_description}",
            inputSchema={json.dumps(tool_params, ensure_ascii=False)},
        ),''')
        
        tools_call_handlers += f'''        case "{tool_name}":
            result = {tool_name}(**arguments)
            return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]
'''
    
    tools_list_str = "\n".join(tools_list)
    
    main_py_content = f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
{server_name} MCP Server - 用户自定义工具

{request.description}
"""

import json
import asyncio
from typing import Sequence

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, ImageContent, EmbeddedResource

{tools_code}

async def serve() -> None:
    server = Server("{server_name}")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [
{tools_list_str}
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> Sequence[TextContent | ImageContent | EmbeddedResource]:
        try:
            match name:
{tools_call_handlers}
            case _:
                raise ValueError(f"Unknown tool: {{name}}")
        except Exception as e:
            return [TextContent(type="text", text=json.dumps({{"error": str(e)}}, ensure_ascii=False))]

    options = server.create_initialization_options()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, options)

if __name__ == "__main__":
    asyncio.run(serve())
'''
    
    main_py_path = os.path.join(server_dir, "main.py")
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(main_py_content)
    
    init_py_content = f'''"""{server_name} MCP Server"""
'''
    init_py_path = os.path.join(server_dir, "__init__.py")
    with open(init_py_path, "w", encoding="utf-8") as f:
        f.write(init_py_content)
    
    main_module_py_content = f'''import asyncio
from main import serve

if __name__ == "__main__":
    asyncio.run(serve())
'''
    main_module_path = os.path.join(server_dir, "__main__.py")
    with open(main_module_path, "w", encoding="utf-8") as f:
        f.write(main_module_py_content)
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        name=request.name,
        transport="stdio",
        command="python",
        args=["-m", server_name],
        description=request.description,
        storage_path=server_dir,
    )
    
    return {
        "code": 200,
        "message": "Python MCP Server created",
        "data": {
            "id": new_server.id,
            "name": new_server.name,
            "transport": "stdio",
            "storage_path": server_dir,
            "main_file": main_py_path,
        },
    }


@router.get("/servers/{server_id}/code")
async def get_mcp_code(
    server_id: str,
    db: Session = Depends(get_db)
):
    """获取MCP的Python代码。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    main_py_path = None
    
    if server.storage_path:
        main_py_path = os.path.join(server.storage_path, "main.py")
    else:
        raise HTTPException(status_code=400, detail="Server does not have Python code")
    
    if not main_py_path or not os.path.exists(main_py_path):
        raise HTTPException(status_code=404, detail=f"MCP code file not found: {main_py_path}")
    
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
    db: Session = Depends(get_db)
):
    """更新MCP的Python代码。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    main_py_path = None
    
    if server.storage_path:
        main_py_path = os.path.join(server.storage_path, "main.py")
    else:
        raise HTTPException(status_code=400, detail="Server does not have Python code")
    
    if not main_py_path:
        raise HTTPException(status_code=404, detail="MCP code file not found")
    
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(request.code)
    
    return {
        "code": 200,
        "message": "MCP code updated",
        "data": {"server_id": server_id, "path": main_py_path},
    }


@router.get("/open-source")
async def get_open_source_mcps():
    """获取可用的开源 MCP 列表。"""
    return {
        "code": 200,
        "message": "Open source MCPs retrieved",
        "data": OPEN_SOURCE_MCPS,
    }


@router.post("/import")
async def import_open_mcp(
    mcp_id: str = Query(..., description="MCP ID"),
    db: Session = Depends(get_db)
):
    """导入开源 MCP 配置。"""
    mcp_config = next((m for m in OPEN_SOURCE_MCPS if m["id"] == mcp_id), None)
    
    if not mcp_config:
        raise HTTPException(status_code=404, detail=f"MCP '{mcp_id}' not found")
    
    user_id = get_mock_user_id()
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        name=mcp_config["name"],
        transport=mcp_config["transport"],
        url="",
        command=mcp_config.get("command"),
        args=mcp_config.get("args", []),
        env=mcp_config.get("env", {}),
        headers={},
        timeout=30,
        description=mcp_config.get("description", ""),
    )
    
    return {
        "code": 200,
        "message": "MCP imported successfully",
        "data": {
            "id": new_server.id,
            "name": new_server.name,
            "transport": new_server.transport,
            "status": "disconnected",
        },
    }


@router.post("/servers/{server_id}/connect")
async def connect_server(
    server_id: str,
    db: Session = Depends(get_db)
):
    """连接到 MCP 服务器。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    server_info = model_to_server_info(server)
    server_info.enabled = True
    
    success = await lifecycle_manager.register_and_connect(server_info)
    
    if success:
        server.enabled = True
        db.commit()
        
        return {
            "code": 200,
            "message": "Connected successfully",
            "data": {"server_id": server_id, "status": "connected"},
        }
    else:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": "Failed to connect",
                "data": {"server_id": server_id, "status": "error"},
            }
        )


@router.post("/servers/{server_id}/disconnect")
async def disconnect_server(
    server_id: str,
    db: Session = Depends(get_db)
):
    """断开 MCP 服务器连接。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    server.enabled = False
    db.commit()
    
    try:
        success = await asyncio.wait_for(
            lifecycle_manager.disconnect(server_id),
            timeout=5.0
        )
        status = "disconnected" if success else "error"
    except asyncio.TimeoutError:
        logger.warning(f"Timeout disconnecting server {server_id}")
        status = "timeout"
    except Exception as e:
        logger.error(f"Error disconnecting server {server_id}: {e}")
        status = "error"
    
    return {
        "code": 200,
        "message": f"Disconnect {status}",
        "data": {"server_id": server_id, "status": status},
    }


@router.post("/servers/test")
async def test_server(server: MCPServerCreate):
    """测试 MCP 服务器连接。"""
    from .clients import ClientFactory
    
    server_info = MCPServerInfo(
        id="test",
        user_id="test",
        name=server.name,
        transport=server.transport,
        url=server.url,
        command=server.command,
        args=server.args or [],
        env=server.env or {},
        headers=server.headers or {},
        timeout=server.timeout,
    )
    
    client = None
    try:
        client = ClientFactory.create_client(server_info)
        await client.connect()
        tools = await client.get_tools()
        
        return {
            "code": 200,
            "message": "Connection test successful",
            "data": {
                "connected": True,
                "tools_count": len(tools),
                "tools": [{"name": t.get("name"), "description": t.get("description", "")} for t in tools[:5]],
            },
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"Connection test failed: {str(e)}",
                "data": {
                    "connected": False,
                    "error": str(e),
                },
            }
        )
    finally:
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass


@router.get("/servers/{server_id}/tools")
async def get_server_tools(
    server_id: str,
    db: Session = Depends(get_db)
):
    """获取MCP服务器的工具列表。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    try:
        tools = await unified_caller.list_tools(server_id)
        
        return {
            "code": 200,
            "message": "Tools retrieved",
            "data": tools,
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
    db: Session = Depends(get_db)
):
    """调用MCP服务器的工具。"""
    if not re.match(r'^[\w\-\.]+$', tool_name):
        raise HTTPException(status_code=400, detail="Invalid tool name format")
    
    if request.arguments:
        serialized_size = len(str(request.arguments))
        if serialized_size > MAX_TOOL_ARGUMENTS_SIZE:
            raise HTTPException(status_code=413, detail="Arguments size exceeds 1MB limit")
    
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    try:
        result = await unified_caller.call(server_id, tool_name, request.arguments)
        
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
    db: Session = Depends(get_db)
):
    """获取所有已启用MCP服务器的工具。"""
    user_id = get_mock_user_id()
    
    try:
        tools = await unified_caller.list_all_tools(user_id)
        
        return {
            "code": 200,
            "message": "All tools retrieved",
            "data": tools,
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"Failed to get all tools: {str(e)}",
                "data": [],
            }
        )


@router.get("/servers/{server_id}/resources")
async def get_server_resources(
    server_id: str,
    db: Session = Depends(get_db)
):
    """获取MCP服务器的资源列表。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    try:
        resources = await unified_caller.get_resources(server_id)
        
        return {
            "code": 200,
            "message": "Resources retrieved",
            "data": resources,
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
    db: Session = Depends(get_db)
):
    """获取MCP服务器的提示词列表。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    try:
        prompts = await unified_caller.get_prompts(server_id)
        
        return {
            "code": 200,
            "message": "Prompts retrieved",
            "data": prompts,
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


@router.post("/init-defaults")
async def init_default_mcps(
    db: Session = Depends(get_db)
):
    """初始化默认的MCP服务器配置。"""
    user_id = get_mock_user_id()
    added_count = 0
    
    for mcp_config in DEFAULT_MCP_SERVERS:
        existing = mcp_db_manager.get_server_by_name(db, user_id, mcp_config["name"])
        
        if not existing:
            new_server = mcp_db_manager.create_server(
                db=db,
                user_id=user_id,
                name=mcp_config["name"],
                transport=mcp_config.get("transport", "stdio"),
                url="",
                command=mcp_config.get("command"),
                args=mcp_config.get("args", []),
                env=mcp_config.get("env", {}),
                headers={},
                timeout=mcp_config.get("timeout", 30),
                is_default=True,
                author=mcp_config.get("author", "SoloEngine"),
                source=mcp_config.get("source", ""),
                description=mcp_config.get("description", ""),
                tags=mcp_config.get("tags", []),
            )
            if new_server:
                added_count += 1
    
    return {
        "code": 200,
        "message": f"Initialized {added_count} default MCP servers",
        "data": {"added_count": added_count},
    }


@router.get("/health")
async def health_check():
    """健康检查端点。"""
    return {
        "code": 200,
        "message": "MCP Service is running",
        "data": {
            "service": "mcp-service",
            "version": "1.0.0",
            "port": 8992,
        },
    }


@router.post("/servers/upload/python")
async def upload_python_mcp(
    name: str = Form(..., description="MCP Server 名称"),
    description: str = Form("", description="MCP Server 描述"),
    file: UploadFile = File(..., description="Python 文件 (.py)"),
    tools: str = Form("[]", description="工具定义 JSON 列表"),
    db: Session = Depends(get_db)
):
    """上传 Python 文件编译为 MCP Server。
    
    上传的 Python 文件将被编译为 MCP Server，存储到 mcp_server/{name}/ 目录：
    - original.py - 原始上传的文件
    - main.py - 编译后的 MCP Server 代码
    - __init__.py - 包初始化文件
    - __main__.py - 模块入口文件
    
    tools 参数格式（JSON字符串）：
    [
        {
            "function_name": "main",
            "description": "工具描述",
            "parameters": [
                {
                    "name": "param1",
                    "type": "string",
                    "description": "参数描述",
                    "required": true
                }
            ]
        }
    ]
    """
    user_id = get_mock_user_id()
    
    if not file.filename.endswith('.py'):
        raise HTTPException(status_code=400, detail="Only Python files (.py) are allowed")
    
    safe_name = re.sub(r'[^\w\-]', '_', name)
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid server name")
    
    try:
        tools_list = json.loads(tools) if tools else []
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid tools JSON format")
    
    server_dir = get_mcp_server_dir(safe_name)
    
    content = await file.read()
    original_code = content.decode('utf-8')
    
    try:
        ast.parse(original_code)
    except SyntaxError as e:
        raise HTTPException(status_code=400, detail=f"Invalid Python syntax: {e}")
    
    original_py_path = os.path.join(server_dir, "original.py")
    with open(original_py_path, "w", encoding="utf-8") as f:
        f.write(original_code)
    
    mcp_server_code = generate_mcp_server_code(safe_name, description, original_code, tools_list)
    main_py_path = os.path.join(server_dir, "main.py")
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(mcp_server_code)
    
    init_py_content = f'"""{safe_name} MCP Server"""\n'
    init_py_path = os.path.join(server_dir, "__init__.py")
    with open(init_py_path, "w", encoding="utf-8") as f:
        f.write(init_py_content)
    
    main_module_py_content = f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    from main import mcp
    mcp.run(transport="stdio")
'''
    main_module_path = os.path.join(server_dir, "__main__.py")
    with open(main_module_path, "w", encoding="utf-8") as f:
        f.write(main_module_py_content)
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        name=name,
        transport="stdio",
        command="python",
        args=[main_py_path],
        description=description,
        storage_path=server_dir,
        tools=tools_list,
    )
    
    return {
        "code": 200,
        "message": "Python MCP Server compiled successfully",
        "data": {
            "id": new_server.id,
            "name": new_server.name,
            "transport": "stdio",
            "storage_path": server_dir,
            "main_file": main_py_path,
            "original_file": original_py_path,
            "tools_count": len(tools_list),
        },
    }


def generate_mcp_server_code(
    server_name: str,
    description: str,
    original_code: str,
    tools: List[Dict[str, Any]]
) -> str:
    """生成 MCP Server 代码。
    
    Args:
        server_name: 服务器名称
        description: 服务器描述
        original_code: 原始 Python 代码
        tools: 工具定义列表
        
    Returns:
        生成的 MCP Server 代码
    """
    type_mapping = {
        "string": "str",
        "integer": "int",
        "number": "float",
        "boolean": "bool",
        "array": "list",
        "object": "dict",
    }
    
    tools_code = []
    
    for tool in tools:
        func_name = tool.get("function_name", "main")
        tool_desc = tool.get("description", f"调用 {func_name} 函数")
        parameters = tool.get("parameters", [])
        
        params_list = []
        param_names = []
        for param in parameters:
            param_name = param.get("name")
            param_type = type_mapping.get(param.get("type", "string"), "str")
            required = param.get("required", True)
            
            if required:
                params_list.append(f"{param_name}: {param_type}")
            else:
                params_list.append(f"{param_name}: {param_type} = None")
            param_names.append(param_name)
        
        params_str = ", ".join(params_list)
        args_str = ", ".join([f"{name}={name}" for name in param_names])
        
        tool_code = f'''
@mcp.tool()
def {func_name}_tool({params_str}) -> str:
    """{tool_desc}"""
    import json
    from original import {func_name}
    
    result = {func_name}({args_str})
    
    if isinstance(result, dict):
        return json.dumps(result, ensure_ascii=False)
    return str(result)
'''
        tools_code.append(tool_code)
    
    tools_code_str = "\n".join(tools_code)
    
    mcp_code = f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
{server_name} - MCP Server
{description}

此文件由 MCP Service 自动生成。
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("{server_name}")

{tools_code_str}

if __name__ == "__main__":
    mcp.run(transport="stdio")
'''
    
    return mcp_code


@router.post("/servers/upload/package")
async def upload_mcp_package(
    name: str = Form(..., description="MCP Server 名称"),
    description: str = Form("", description="MCP Server 描述"),
    package: UploadFile = File(..., description="MCP Server 包 (.zip)"),
    db: Session = Depends(get_db)
):
    """上传第三方 MCP Server 包。
    
    上传的 ZIP 包将被解压到 mcp_server 目录，并自动配置。
    ZIP 包应包含 main.py 或 __main__.py 作为入口文件。
    """
    user_id = get_mock_user_id()
    
    if not package.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Only ZIP packages are allowed")
    
    safe_name = re.sub(r'[^\w\-]', '_', name)
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid server name")
    
    server_dir = get_mcp_server_dir(safe_name)
    
    temp_dir = tempfile.mkdtemp()
    try:
        temp_zip_path = os.path.join(temp_dir, "package.zip")
        with open(temp_zip_path, "wb") as f:
            content = await package.read()
            f.write(content)
        
        with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
            zip_ref.extractall(server_dir)
        
        main_py_path = None
        entry_file = None
        
        for entry in ['main.py', '__main__.py', 'server.py', 'app.py']:
            candidate = os.path.join(server_dir, entry)
            if os.path.exists(candidate):
                main_py_path = candidate
                entry_file = entry
                break
        
        if not main_py_path:
            for root, dirs, files in os.walk(server_dir):
                for file in files:
                    if file.endswith('.py') and file in ['main.py', '__main__.py', 'server.py']:
                        main_py_path = os.path.join(root, file)
                        entry_file = file
                        break
                if main_py_path:
                    break
        
        if not main_py_path:
            raise HTTPException(status_code=400, detail="No valid entry file found (main.py, __main__.py, server.py)")
        
        requirements_path = os.path.join(server_dir, "requirements.txt")
        if os.path.exists(requirements_path):
            logger.info(f"Found requirements.txt for {name}")
        
        new_server = mcp_db_manager.create_server(
            db=db,
            user_id=user_id,
            name=name,
            transport="stdio",
            command="python",
            args=[main_py_path],
            description=description,
            storage_path=server_dir,
        )
        
        return {
            "code": 200,
            "message": "MCP Server package uploaded successfully",
            "data": {
                "id": new_server.id,
                "name": new_server.name,
                "transport": "stdio",
                "storage_path": server_dir,
                "entry_file": entry_file,
                "main_file": main_py_path,
                "original_filename": package.filename,
            },
        }
        
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/servers/upload/folder")
async def upload_mcp_folder(
    name: str = Form(..., description="MCP Server 名称"),
    description: str = Form("", description="MCP Server 描述"),
    files: List[UploadFile] = File(..., description="文件夹中的所有文件"),
    db: Session = Depends(get_db)
):
    """上传文件夹作为 MCP Server。
    
    上传的文件夹将被存储到 mcp_server/{name}/ 目录。
    需要包含 main.py 或 __main__.py 或 server.py 作为入口文件。
    
    注意：前端需要将文件夹中的所有文件递归上传，保持相对路径结构。
    """
    user_id = get_mock_user_id()
    
    safe_name = re.sub(r'[^\w\-]', '_', name)
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid server name")
    
    server_dir = get_mcp_server_dir(safe_name)
    
    if os.path.exists(server_dir):
        shutil.rmtree(server_dir)
    os.makedirs(server_dir, exist_ok=True)
    
    file_structure = {}
    
    for file in files:
        relative_path = file.filename
        if not relative_path:
            continue
        
        file_path = os.path.join(server_dir, relative_path)
        file_dir = os.path.dirname(file_path)
        os.makedirs(file_dir, exist_ok=True)
        
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        
        file_structure[relative_path] = {
            "size": len(content),
            "type": "file"
        }
    
    main_py_path = None
    entry_file = None
    
    for entry in ['main.py', '__main__.py', 'server.py', 'app.py']:
        candidate = os.path.join(server_dir, entry)
        if os.path.exists(candidate):
            main_py_path = candidate
            entry_file = entry
            break
    
    if not main_py_path:
        for root, dirs, filenames in os.walk(server_dir):
            for filename in filenames:
                if filename.endswith('.py') and filename in ['main.py', '__main__.py', 'server.py']:
                    main_py_path = os.path.join(root, filename)
                    entry_file = filename
                    break
            if main_py_path:
                break
    
    if not main_py_path:
        raise HTTPException(status_code=400, detail="No valid entry file found (main.py, __main__.py, server.py)")
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        name=name,
        transport="stdio",
        command="python",
        args=[main_py_path],
        description=description,
        storage_path=server_dir,
    )
    
    return {
        "code": 200,
        "message": "MCP Server folder uploaded successfully",
        "data": {
            "id": new_server.id,
            "name": new_server.name,
            "transport": "stdio",
            "storage_path": server_dir,
            "entry_file": entry_file,
            "main_file": main_py_path,
            "files_count": len(file_structure),
            "file_structure": file_structure,
        },
    }


@router.post("/servers/import-local")
async def import_local_mcp(
    name: str = Form(..., description="MCP Server 名称"),
    path: str = Form(..., description="本地 MCP Server 路径"),
    description: str = Form("", description="MCP Server 描述"),
    command: str = Form("python", description="启动命令"),
    db: Session = Depends(get_db)
):
    """导入本地已有的 MCP Server（已废弃，    请使用 upload/python 或 upload/folder 接口代替。
    """
    raise HTTPException(
        status_code=410, 
        detail="This endpoint is deprecated. Please use /servers/upload/python or /servers/upload/folder instead."
    )


@router.get("/servers/{server_id}/files")
async def get_server_files(
    server_id: str,
    db: Session = Depends(get_db)
):
    """获取 MCP Server 的文件列表。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    if not server.storage_path or not os.path.exists(server.storage_path):
        return {
            "code": 200,
            "message": "No files found",
            "data": [],
        }
    
    files = []
    if os.path.isfile(server.storage_path):
        stat = os.stat(server.storage_path)
        files.append({
            "name": os.path.basename(server.storage_path),
            "path": server.storage_path,
            "type": "file",
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })
    else:
        for root, dirs, filenames in os.walk(server.storage_path):
            for filename in filenames:
                if filename.startswith('.'):
                    continue
                filepath = os.path.join(root, filename)
                relpath = os.path.relpath(filepath, server.storage_path)
                stat = os.stat(filepath)
                files.append({
                    "name": filename,
                    "path": filepath,
                    "relative_path": relpath,
                    "type": "file",
                    "size": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
    
    return {
        "code": 200,
        "message": "Files retrieved",
        "data": files,
    }
