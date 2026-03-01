# -*- coding: utf-8 -*-
"""
API路由 - MCP服务API端点。
"""

import os
import re
import json
import logging
import asyncio
import shutil
import tempfile
import zipfile
import ast
from typing import List, Optional, Dict, Any
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .database import (
    get_db, mcp_db_manager, MCPServerModel, MCPStdioConfigModel, 
    MCPSseConfigModel, MCPHttpConfigModel, OptimisticLockError
)
from .config import MAX_TOOL_ARGUMENTS_SIZE
from .host.registry import MCPServerInfo, ServerStatus, service_registry
from .host.lifecycle import lifecycle_manager
from .host.caller import unified_caller

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/mcp", tags=["mcp"])

MCP_SERVERS_STORAGE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "mcp_servers"
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
    share: bool = Field(False, description="是否共享")


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
    share: Optional[bool] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")


class CallToolRequest(BaseModel):
    arguments: Dict[str, Any] = Field(default_factory=dict, description="工具参数")


class CreateHttpServerRequest(BaseModel):
    name: str = Field(..., description="服务器名称")
    description: Optional[str] = Field(None, description="服务器描述")
    url: str = Field(..., description="服务器URL")
    headers: Optional[Dict[str, str]] = Field(None, description="HTTP请求头")
    timeout: int = Field(30, description="超时时间(秒)")
    session_id: Optional[str] = Field(None, description="会话ID")
    enabled: bool = Field(True, description="是否启用")
    share: bool = Field(False, description="是否共享")


class CreateSseServerRequest(BaseModel):
    name: str = Field(..., description="服务器名称")
    description: Optional[str] = Field(None, description="服务器描述")
    url: str = Field(..., description="服务器URL")
    headers: Optional[Dict[str, str]] = Field(None, description="HTTP请求头")
    timeout: int = Field(30, description="超时时间(秒)")
    reconnect: bool = Field(True, description="是否自动重连")
    sse_endpoint: str = Field("/sse", description="SSE端点路径")
    retry_interval: int = Field(5, description="重试间隔(秒)")
    max_retries: int = Field(3, description="最大重试次数")
    enabled: bool = Field(True, description="是否启用")
    share: bool = Field(False, description="是否共享")


class UpdateMCPToolsRequest(BaseModel):
    tools: str = Field(..., description="工具定义JSON")


class UpdateMCPCodeRequest(BaseModel):
    code: str = Field(..., description="Python代码")


def model_to_server_info(server: MCPServerModel) -> MCPServerInfo:
    """将数据库模型转换为服务器信息。"""
    stdio_cfg = server.stdio_config[0] if server.stdio_config else None
    sse_cfg = server.sse_config
    http_cfg = server.http_config
    
    command = None
    args = []
    env = {}
    url = None
    headers = {}
    timeout = 30
    
    if server.transport_type == "stdio" and stdio_cfg:
        command = stdio_cfg.command
        args = stdio_cfg.args or []
        env = stdio_cfg.env or {}
        timeout = 30
    elif server.transport_type == "sse" and sse_cfg:
        url = sse_cfg.url
        headers = sse_cfg.headers or {}
        timeout = sse_cfg.timeout or 30
    elif server.transport_type == "http" and http_cfg:
        url = http_cfg.url
        headers = http_cfg.headers or {}
        timeout = http_cfg.timeout or 30
    
    # 确定source_type：优先使用数据库中的source_type，否则根据transport_type推断
    source_type = server.source_type
    if not source_type:
        # 如果没有source_type，检查是否是Python Function（通过检查是否有original.py）
        if server.transport_type == "stdio" and stdio_cfg and stdio_cfg.storage_path:
            original_py_path = os.path.join(stdio_cfg.storage_path, "original.py")
            if os.path.exists(original_py_path):
                source_type = "python_function"
            else:
                source_type = "stdio"
        else:
            source_type = server.transport_type
    
    return MCPServerInfo(
        id=server.mcp_server_id,
        user_id=server.user_id,
        name=server.mcp_name,
        transport=server.transport_type,
        url=url,
        command=command,
        args=args,
        env=env,
        headers=headers,
        timeout=timeout,
        enabled=server.enabled,
        is_public=server.share,
        is_default=False,
        author=server.author,
        source=source_type,  # 使用source_type作为source
        description=server.description,
        tags=server.tags or [],
        version=server.version,
        status=ServerStatus.DISCONNECTED,
        created_at=server.created_at,
        updated_at=server.updated_at,
        storage_path=stdio_cfg.storage_path if stdio_cfg else None,
        tools=[],
    )


def get_mock_user_id() -> str:
    """获取模拟用户ID（用于简化认证）。"""
    return "default_user"


@router.get("/servers")
async def list_servers(
    db: Session = Depends(get_db)
):
    """获取用户的所有 MCP 服务器。"""
    user_id = get_mock_user_id()
    servers = mcp_db_manager.get_servers(db, user_id)
    
    result = []
    for server in servers:
        server_info = model_to_server_info(server)
        
        # 从service_registry获取实际连接状态
        registered_server = await service_registry.get_server(server.mcp_server_id)
        if registered_server:
            server_info.status = registered_server.status
            server_info.error_message = registered_server.error_message
        
        result.append(server_info.to_dict())
    
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
        mcp_name=server.name,
        transport_type=server.transport,
        description=server.description,
        enabled=server.enabled,
        share=server.share,
    )
    
    if server.transport == "stdio":
        storage_path = None
        if server.args:
            storage_path = server.args[0] if server.args else None
        mcp_db_manager.create_stdio_config(
            db=db,
            mcp_server_id=new_server.mcp_server_id,
            command=server.command,
            args=server.args,
            env=server.env,
            storage_path=storage_path,
        )
    elif server.transport == "sse":
        mcp_db_manager.create_sse_config(
            db=db,
            mcp_server_id=new_server.mcp_server_id,
            url=server.url,
            headers=server.headers,
            timeout=server.timeout,
        )
    elif server.transport == "http":
        mcp_db_manager.create_http_config(
            db=db,
            mcp_server_id=new_server.mcp_server_id,
            url=server.url,
            headers=server.headers,
            timeout=server.timeout,
        )
    
    db.refresh(new_server)
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
        update_data["mcp_name"] = update.name
    if update.transport is not None:
        update_data["transport_type"] = update.transport
    if update.description is not None:
        update_data["description"] = update.description
    if update.enabled is not None:
        update_data["enabled"] = update.enabled
    if update.share is not None:
        update_data["share"] = update.share
    
    try:
        server = mcp_db_manager.update_server(
            db, server_id, user_id, version=update.version, **update_data
        )
    except OptimisticLockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    if server.transport_type == "stdio":
        stdio_update = {}
        if update.command is not None:
            stdio_update["command"] = update.command
        if update.args is not None:
            stdio_update["args"] = update.args
        if update.env is not None:
            stdio_update["env"] = update.env
        if stdio_update:
            mcp_db_manager.update_stdio_config(db, server_id, **stdio_update)
    elif server.transport_type == "sse":
        sse_update = {}
        if update.url is not None:
            sse_update["url"] = update.url
        if update.headers is not None:
            sse_update["headers"] = update.headers
        if update.timeout is not None:
            sse_update["timeout"] = update.timeout
        if sse_update:
            mcp_db_manager.update_sse_config(db, server_id, **sse_update)
    elif server.transport_type == "http":
        http_update = {}
        if update.url is not None:
            http_update["url"] = update.url
        if update.headers is not None:
            http_update["headers"] = update.headers
        if update.timeout is not None:
            http_update["timeout"] = update.timeout
        if http_update:
            mcp_db_manager.update_http_config(db, server_id, **http_update)
    
    db.refresh(server)
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


@router.post("/servers/create/python")
async def create_python_mcp(
    name: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(..., description="Python 文件 (.py)"),
    tools: str = Form("[]", description="工具定义 JSON 列表"),
    db: Session = Depends(get_db)
):
    """创建Python MCP（上传Python文件编译）。
    
    上传的 Python 文件将被编译为 MCP Server，存储到 mcp_server/{name}/ 目录：
    - original.py - 原始上传的文件
    - main.py - 编译后的 MCP Server 代码
    - __init__.py - 包初始化文件
    - __main__.py - 模块入口文件
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
    
    tools_json_path = os.path.join(server_dir, "tools.json")
    with open(tools_json_path, "w", encoding="utf-8") as f:
        json.dump(tools_list, f, ensure_ascii=False, indent=2)
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        mcp_name=name,
        transport_type="stdio",
        source_type="python_function",  # 标记为Python Function类型
        description=description,
        author="user",
    )
    
    mcp_db_manager.create_stdio_config(
        db=db,
        mcp_server_id=new_server.mcp_server_id,
        command="python",
        args=[main_py_path],
        storage_path=server_dir,
    )
    
    db.refresh(new_server)
    
    return {
        "code": 200,
        "message": "Python MCP Server created successfully",
        "data": {
            "id": new_server.mcp_server_id,
            "name": new_server.mcp_name,
            "transport_type": "stdio",
            "storage_path": server_dir,
            "main_file": main_py_path,
            "original_file": original_py_path,
            "tools_count": len(tools_list),
        },
    }


@router.post("/servers/create/stdio")
async def create_stdio_mcp(
    name: str = Form(...),
    description: str = Form("", description="MCP Server 描述"),
    package: Optional[UploadFile] = File(None, description="MCP Server 包 (.zip)"),
    files: Optional[List[UploadFile]] = File(None, description="文件夹中的所有文件"),
    db: Session = Depends(get_db)
):
    """创建Stdio MCP（上传ZIP包或文件夹）。
    
    上传的 ZIP 包将被解压到 mcp_server 目录，或文件夹中的文件将被存储。
    ZIP 包应包含 main.py 或 __main__.py 作为入口文件。
    """
    user_id = get_mock_user_id()
    
    if not package and not files:
        raise HTTPException(status_code=400, detail="Either package or files must be provided")
    
    safe_name = re.sub(r'[^\w\-]', '_', name)
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid server name")
    
    server_dir = get_mcp_server_dir(safe_name)
    
    main_py_path = None
    entry_file = None
    author = "user"
    
    if package:
        if not package.filename.endswith('.zip'):
            raise HTTPException(status_code=400, detail="Only ZIP packages are allowed")
        
        temp_dir = tempfile.mkdtemp()
        try:
            temp_zip_path = os.path.join(temp_dir, "package.zip")
            with open(temp_zip_path, "wb") as f:
                content = await package.read()
                f.write(content)
            
            with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                zip_ref.extractall(server_dir)
            
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
            
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Invalid ZIP file")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
    
    elif files:
        if os.path.exists(server_dir):
            shutil.rmtree(server_dir)
        os.makedirs(server_dir, exist_ok=True)
        
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
        mcp_name=name,
        transport_type="stdio",
        description=description,
        author=author,
    )
    
    mcp_db_manager.create_stdio_config(
        db=db,
        mcp_server_id=new_server.mcp_server_id,
        command="python",
        args=[main_py_path],
        storage_path=server_dir,
    )
    
    db.refresh(new_server)
    
    return {
        "code": 200,
        "message": "Stdio MCP Server created successfully",
        "data": {
            "id": new_server.mcp_server_id,
            "name": new_server.mcp_name,
            "transport_type": "stdio",
            "storage_path": server_dir,
            "entry_file": entry_file,
            "main_file": main_py_path,
        },
    }


@router.post("/servers/create/http")
async def create_http_mcp(
    request: CreateHttpServerRequest,
    db: Session = Depends(get_db)
):
    """创建HTTP MCP（填写HTTP连接配置）。"""
    user_id = get_mock_user_id()
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        mcp_name=request.name,
        transport_type="http",
        description=request.description,
        enabled=request.enabled,
        share=request.share,
        author="user",
    )
    
    mcp_db_manager.create_http_config(
        db=db,
        mcp_server_id=new_server.mcp_server_id,
        url=request.url,
        headers=request.headers,
        timeout=request.timeout,
        session_id=request.session_id,
    )
    
    db.refresh(new_server)
    server_info = model_to_server_info(new_server)
    
    return {
        "code": 200,
        "message": "HTTP MCP Server created successfully",
        "data": server_info.to_dict(),
    }


@router.post("/servers/create/sse")
async def create_sse_mcp(
    request: CreateSseServerRequest,
    db: Session = Depends(get_db)
):
    """创建SSE MCP（填写SSE连接配置）。"""
    user_id = get_mock_user_id()
    
    new_server = mcp_db_manager.create_server(
        db=db,
        user_id=user_id,
        mcp_name=request.name,
        transport_type="sse",
        description=request.description,
        enabled=request.enabled,
        share=request.share,
        author="user",
    )
    
    mcp_db_manager.create_sse_config(
        db=db,
        mcp_server_id=new_server.mcp_server_id,
        url=request.url,
        headers=request.headers,
        timeout=request.timeout,
        reconnect=request.reconnect,
        sse_endpoint=request.sse_endpoint,
        retry_interval=request.retry_interval,
        max_retries=request.max_retries,
    )
    
    db.refresh(new_server)
    server_info = model_to_server_info(new_server)
    
    return {
        "code": 200,
        "message": "SSE MCP Server created successfully",
        "data": server_info.to_dict(),
    }


@router.put("/servers/{server_id}/tools")
async def update_mcp_tools(
    server_id: str,
    request: UpdateMCPToolsRequest,
    db: Session = Depends(get_db)
):
    """保存工具参数定义到tools.json，并自动重新编译MCP Server代码。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    stdio_cfg = mcp_db_manager.get_stdio_config(db, server_id)
    if not stdio_cfg or not stdio_cfg.storage_path:
        raise HTTPException(status_code=400, detail="Server does not have storage path")
    
    try:
        tools_list = json.loads(request.tools) if request.tools else []
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid tools JSON format")
    
    tools_json_path = os.path.join(stdio_cfg.storage_path, "tools.json")
    with open(tools_json_path, "w", encoding="utf-8") as f:
        json.dump(tools_list, f, ensure_ascii=False, indent=2)
    
    # 读取original.py获取原始代码
    original_py_path = os.path.join(stdio_cfg.storage_path, "original.py")
    original_code = ""
    if os.path.exists(original_py_path):
        with open(original_py_path, "r", encoding="utf-8") as f:
            original_code = f.read()
    
    # 重新编译MCP Server代码
    if original_code:
        mcp_server_code = generate_mcp_server_code(
            server.mcp_name,
            server.description or "",
            original_code,
            tools_list
        )
        main_py_path = os.path.join(stdio_cfg.storage_path, "main.py")
        with open(main_py_path, "w", encoding="utf-8") as f:
            f.write(mcp_server_code)
    
    return {
        "code": 200,
        "message": "Tools definition updated and MCP Server recompiled",
        "data": {
            "server_id": server_id,
            "tools_count": len(tools_list),
            "path": tools_json_path,
        },
    }


@router.get("/servers/{server_id}/tools/json")
async def get_mcp_tools_json(
    server_id: str,
    db: Session = Depends(get_db)
):
    """获取tools.json内容。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    stdio_cfg = mcp_db_manager.get_stdio_config(db, server_id)
    if not stdio_cfg or not stdio_cfg.storage_path:
        raise HTTPException(status_code=400, detail="Server does not have storage path")
    
    tools_json_path = os.path.join(stdio_cfg.storage_path, "tools.json")
    
    if not os.path.exists(tools_json_path):
        return {
            "code": 200,
            "message": "Tools file not found, returning empty list",
            "data": {"tools": [], "path": tools_json_path},
        }
    
    with open(tools_json_path, "r", encoding="utf-8") as f:
        tools = json.load(f)
    
    return {
        "code": 200,
        "message": "Tools definition retrieved",
        "data": {"tools": tools, "path": tools_json_path},
    }


@router.get("/servers/{server_id}/original")
async def get_mcp_original_code(
    server_id: str,
    db: Session = Depends(get_db)
):
    """获取original.py内容。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    stdio_cfg = mcp_db_manager.get_stdio_config(db, server_id)
    if not stdio_cfg or not stdio_cfg.storage_path:
        raise HTTPException(status_code=400, detail="Server does not have storage path")
    
    original_py_path = os.path.join(stdio_cfg.storage_path, "original.py")
    
    if not os.path.exists(original_py_path):
        raise HTTPException(status_code=404, detail=f"Original file not found: {original_py_path}")
    
    with open(original_py_path, "r", encoding="utf-8") as f:
        code = f.read()
    
    return {
        "code": 200,
        "message": "Original code retrieved",
        "data": {
            "server_id": server_id,
            "name": server.mcp_name,
            "code": code,
            "path": original_py_path,
        },
    }


@router.put("/servers/{server_id}/original")
async def update_mcp_original_code(
    server_id: str,
    request: UpdateMCPCodeRequest,
    db: Session = Depends(get_db)
):
    """更新original.py内容，并自动重新编译MCP Server代码。"""
    user_id = get_mock_user_id()
    server = mcp_db_manager.get_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    stdio_cfg = mcp_db_manager.get_stdio_config(db, server_id)
    if not stdio_cfg or not stdio_cfg.storage_path:
        raise HTTPException(status_code=400, detail="Server does not have storage path")
    
    original_py_path = os.path.join(stdio_cfg.storage_path, "original.py")
    tools_json_path = os.path.join(stdio_cfg.storage_path, "tools.json")
    
    try:
        ast.parse(request.code)
    except SyntaxError as e:
        raise HTTPException(status_code=400, detail=f"Invalid Python syntax: {e}")
    
    # 保存原始代码
    with open(original_py_path, "w", encoding="utf-8") as f:
        f.write(request.code)
    
    # 读取tools.json获取工具定义
    tools = []
    if os.path.exists(tools_json_path):
        with open(tools_json_path, "r", encoding="utf-8") as f:
            tools = json.load(f)
    
    # 重新编译MCP Server代码
    mcp_server_code = generate_mcp_server_code(
        server.mcp_name,
        server.description or "",
        request.code,
        tools
    )
    main_py_path = os.path.join(stdio_cfg.storage_path, "main.py")
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(mcp_server_code)
    
    return {
        "code": 200,
        "message": "Original code updated and MCP Server recompiled",
        "data": {
            "server_id": server_id,
            "path": original_py_path,
            "main_path": main_py_path,
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
    
    stdio_cfg = mcp_db_manager.get_stdio_config(db, server_id)
    if not stdio_cfg or not stdio_cfg.storage_path:
        raise HTTPException(status_code=400, detail="Server does not have Python code")
    
    main_py_path = os.path.join(stdio_cfg.storage_path, "main.py")
    
    if not os.path.exists(main_py_path):
        raise HTTPException(status_code=404, detail=f"MCP code file not found: {main_py_path}")
    
    with open(main_py_path, "r", encoding="utf-8") as f:
        code = f.read()
    
    return {
        "code": 200,
        "message": "MCP code retrieved",
        "data": {
            "server_id": server_id,
            "name": server.mcp_name,
            "code": code,
            "path": main_py_path,
        },
    }


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
    
    stdio_cfg = mcp_db_manager.get_stdio_config(db, server_id)
    if not stdio_cfg or not stdio_cfg.storage_path:
        raise HTTPException(status_code=400, detail="Server does not have Python code")
    
    main_py_path = os.path.join(stdio_cfg.storage_path, "main.py")
    
    if not os.path.exists(main_py_path):
        raise HTTPException(status_code=404, detail="MCP code file not found")
    
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(request.code)
    
    return {
        "code": 200,
        "message": "MCP code updated",
        "data": {"server_id": server_id, "path": main_py_path},
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
        mcp_db_manager.update_server(db, server_id, user_id, enabled=True)
        
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
    
    mcp_db_manager.update_server(db, server_id, user_id, enabled=False)
    
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


@router.get("/health")
async def health_check():
    """健康检查端点。"""
    return {
        "code": 200,
        "message": "MCP Service is running",
        "data": {
            "service": "mcp-service",
            "version": "2.0.0",
            "port": 8992,
        },
    }


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
    
    stdio_cfg = mcp_db_manager.get_stdio_config(db, server_id)
    storage_path = stdio_cfg.storage_path if stdio_cfg else None
    
    if not storage_path or not os.path.exists(storage_path):
        return {
            "code": 200,
            "message": "No files found",
            "data": [],
        }
    
    files = []
    if os.path.isfile(storage_path):
        stat = os.stat(storage_path)
        files.append({
            "name": os.path.basename(storage_path),
            "path": storage_path,
            "type": "file",
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })
    else:
        for root, dirs, filenames in os.walk(storage_path):
            for filename in filenames:
                if filename.startswith('.'):
                    continue
                filepath = os.path.join(root, filename)
                relpath = os.path.relpath(filepath, storage_path)
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
