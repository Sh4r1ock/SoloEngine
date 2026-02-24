# -*- coding: utf-8 -*-
"""
API路由 - MCP服务API端点。
"""

import os
import re
import json
import uuid
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, Query
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
    os.path.dirname(__file__), "..", "storage", "mcp_servers"
)
os.makedirs(MCP_SERVERS_STORAGE_DIR, exist_ok=True)


def get_user_mcp_dir(user_id: str) -> str:
    """获取用户的MCP存储目录。"""
    user_dir = os.path.join(MCP_SERVERS_STORAGE_DIR, user_id)
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


def get_mcp_file_path(user_id: str, module_name: str) -> str:
    """获取MCP Python文件路径。"""
    mcp_dir = os.path.join(MCP_SERVERS_STORAGE_DIR, user_id, module_name)
    os.makedirs(mcp_dir, exist_ok=True)
    return os.path.join(mcp_dir, "main.py")


class MCPServerCreate(BaseModel):
    name: str = Field(..., description="服务器名称")
    transport: str = Field("python", description="传输类型: http, stdio, sse, python")
    description: Optional[str] = Field(None, description="服务器描述")
    url: Optional[str] = Field(None, description="服务器 URL (http/sse)")
    command: Optional[str] = Field(None, description="命令 (stdio)")
    args: Optional[List[str]] = Field(None, description="命令参数")
    env: Optional[Dict[str, str]] = Field(None, description="环境变量")
    headers: Optional[Dict[str, str]] = Field(None, description="HTTP 头")
    timeout: int = Field(30, description="超时时间（秒）")
    enabled: bool = Field(True, description="是否启用")
    module: Optional[str] = Field(None, description="Python模块名 (python类型)")
    function: Optional[str] = Field("main", description="函数名 (python类型)")
    inputSchema: Optional[Dict[str, Any]] = Field(None, description="输入参数Schema (python类型)")
    outputSchema: Optional[Dict[str, Any]] = Field(None, description="输出参数Schema (python类型)")


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
    module: Optional[str] = None
    function: Optional[str] = None
    inputSchema: Optional[Dict[str, Any]] = None
    outputSchema: Optional[Dict[str, Any]] = None


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
        module=server.module,
        function=server.function,
        input_schema=server.input_schema,
        output_schema=server.output_schema,
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
        module=server.module,
        function=server.function,
        input_schema=server.inputSchema,
        output_schema=server.outputSchema,
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
    if update.module is not None:
        update_data["module"] = update.module
    if update.function is not None:
        update_data["function"] = update.function
    if update.inputSchema is not None:
        update_data["input_schema"] = update.inputSchema
    if update.outputSchema is not None:
        update_data["output_schema"] = update.outputSchema
    
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
    """创建Python编写的MCP（简单函数模式）。"""
    user_id = get_mock_user_id()
    module_name = request.name
    
    mcp_file_path = get_mcp_file_path(user_id, module_name)
    mcp_dir = os.path.dirname(mcp_file_path)
    
    tools_code = ""
    for tool in request.tools:
        tool_name = tool.get("name", "unnamed_tool")
        tool_description = tool.get("description", "")
        tool_params = tool.get("parameters", {})
        
        params_str = ", ".join([f"{p['name']}: {p.get('type', 'Any')}" for p in tool_params.get("properties", {}).values()])
        
        tools_code += f'''
def {tool_name}({params_str}) -> dict:
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
    return result

'''
    
    main_py_content = f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
{request.name} MCP Server
{request.description}

这是一个简单的Python函数MCP，通过main()函数提供工具能力。
"""

import json
from typing import Any, Dict, List

{tools_code}

def main(**kwargs) -> dict:
    """
    MCP主入口函数。
    
    根据传入的参数执行相应的操作。
    """
    return {{
        "status": "success",
        "message": "MCP {request.name} executed",
        "params": kwargs
    }}

if __name__ == "__main__":
    import sys
    result = main(**dict(arg.split("=") for arg in sys.argv[1:] if "=" in arg))
    print(json.dumps(result, ensure_ascii=False))
'''
    
    with open(mcp_file_path, "w", encoding="utf-8") as f:
        f.write(main_py_content)
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        name=request.name,
        transport="python",
        module=module_name,
        function="main",
        description=request.description,
    )
    
    return {
        "code": 200,
        "message": "Python MCP created",
        "data": {
            "id": new_server.id,
            "name": new_server.name,
            "module": module_name,
            "path": mcp_dir,
            "main_file": mcp_file_path,
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
    
    if server.transport == "python" and server.module:
        main_py_path = get_mcp_file_path(user_id, server.module)
    elif server.transport == "stdio" and server.args:
        main_py_path = server.args[0] if server.args else None
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
    
    if server.transport == "python" and server.module:
        main_py_path = get_mcp_file_path(user_id, server.module)
    elif server.transport == "stdio" and server.args:
        main_py_path = server.args[0] if server.args else None
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
    
    await lifecycle_manager.disconnect(server_id)
    
    server.enabled = False
    db.commit()
    
    return {
        "code": 200,
        "message": "Disconnected successfully",
        "data": {"server_id": server_id, "status": "disconnected"},
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
        module=server.module,
        function=server.function,
        input_schema=server.inputSchema,
        output_schema=server.outputSchema,
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
