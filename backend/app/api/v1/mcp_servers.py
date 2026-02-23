# -*- coding: utf-8 -*-
"""
MCP 服务器管理 API endpoints。

@file mcp_servers.py
@description MCP服务器接口 - MCP服务器管理相关API端点
@author SoloEngine Team
@date 2026-02-19

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
import json
import uuid
import logging
import asyncio
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, MCPServerModel, OptimisticLockError
from app.api.v1.auth import get_current_user
from app.core.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/mcp", tags=["mcp"])


MCP_ROOT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "mcp_servers")
os.makedirs(MCP_ROOT_DIR, exist_ok=True)


def get_user_mcp_dir(user_id: str) -> str:
    """获取用户的MCP目录。"""
    user_dir = os.path.join(MCP_ROOT_DIR, user_id)
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


class MCPServerCreate(BaseModel):
    name: str = Field(..., description="服务器名称")
    transport: str = Field("http", description="传输类型: http, websocket, stdio, sse")
    url: Optional[str] = Field(None, description="服务器 URL (http/websocket)")
    command: Optional[str] = Field(None, description="命令 (stdio)")
    args: Optional[List[str]] = Field(None, description="命令参数")
    env: Optional[Dict[str, str]] = Field(None, description="环境变量")
    headers: Optional[Dict[str, str]] = Field(None, description="HTTP 头")
    timeout: int = Field(30, description="超时时间（秒）")
    enabled: bool = Field(True, description="是否启用")


class MCPServerUpdate(BaseModel):
    name: Optional[str] = None
    transport: Optional[str] = None
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


OPEN_SOURCE_MCPS = [
    {
        "id": "filesystem",
        "name": "Filesystem MCP",
        "description": "文件系统操作工具",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
        "category": "file",
    },
    {
        "id": "github",
        "name": "GitHub MCP",
        "description": "GitHub 仓库和 issue 操作",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {"GITHUB_TOKEN": "your_github_token"},
        "category": "dev",
    },
    {
        "id": "postgres",
        "name": "PostgreSQL MCP",
        "description": "PostgreSQL 数据库操作",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env": {"DATABASE_URL": "postgresql://user:pass@host:port/db"},
        "category": "database",
    },
    {
        "id": "sqlite",
        "name": "SQLite MCP",
        "description": "SQLite 数据库操作",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/path/to/db.sqlite"],
        "category": "database",
    },
    {
        "id": "brave-search",
        "name": "Brave Search MCP",
        "description": "Brave 搜索引擎集成",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env": {"BRAVE_API_KEY": "your_brave_api_key"},
        "category": "search",
    },
    {
        "id": "puppeteer",
        "name": "Puppeteer MCP",
        "description": "浏览器自动化工具",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
        "category": "browser",
    },
    {
        "id": "slack",
        "name": "Slack MCP",
        "description": "Slack 集成",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-slack"],
        "env": {"SLACK_BOT_TOKEN": "xoxb-your-bot-token", "SLACK_TEAM_ID": "T01234567"},
        "category": "communication",
    },
    {
        "id": "memory",
        "name": "Memory MCP",
        "description": "知识图谱记忆存储",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "category": "ai",
    },
]


@router.get("/servers")
async def list_servers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取用户的所有 MCP 服务器。"""
    user_id = current_user.id
    servers = db_manager.get_mcp_servers(db, user_id)
    
    return {
        "code": 200,
        "message": "MCP servers retrieved",
        "data": [
            {
                "id": server.id,
                "user_id": server.user_id,
                "name": server.name,
                "transport": server.transport,
                "url": server.url,
                "command": server.command,
                "args": server.args or [],
                "env": server.env or {},
                "headers": server.headers or {},
                "timeout": server.timeout,
                "enabled": server.enabled,
                "is_public": server.is_public,
                "version": server.version,
                "status": "connected" if server.enabled else "disconnected",
                "created_at": server.created_at.isoformat() if server.created_at else None,
                "updated_at": server.updated_at.isoformat() if server.updated_at else None,
            }
            for server in servers
        ],
    }


@router.post("/servers")
async def add_server(
    server: MCPServerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """添加 MCP 服务器。"""
    user_id = current_user.id
    
    new_server = db_manager.create_mcp_server(
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
    )
    
    return {
        "code": 200,
        "message": "MCP server added",
        "data": {
            "id": new_server.id,
            "user_id": new_server.user_id,
            "name": new_server.name,
            "transport": new_server.transport,
            "url": new_server.url,
            "command": new_server.command,
            "args": new_server.args or [],
            "env": new_server.env or {},
            "headers": new_server.headers or {},
            "timeout": new_server.timeout,
            "enabled": new_server.enabled,
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
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    return {
        "code": 200,
        "message": "Server retrieved",
        "data": {
            "id": server.id,
            "user_id": server.user_id,
            "name": server.name,
            "transport": server.transport,
            "url": server.url,
            "command": server.command,
            "args": server.args or [],
            "env": server.env or {},
            "headers": server.headers or {},
            "timeout": server.timeout,
            "enabled": server.enabled,
            "is_public": server.is_public,
            "status": "disconnected",
        },
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
    
    try:
        server = db_manager.update_mcp_server(
            db, server_id, user_id, version=update.version, **update_data
        )
    except OptimisticLockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    return {
        "code": 200,
        "message": "Server updated",
        "data": {
            "id": server.id,
            "name": server.name,
            "transport": server.transport,
            "url": server.url,
            "enabled": server.enabled,
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
    success = db_manager.delete_mcp_server(db, server_id, user_id)
    
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
    user_mcp_dir = get_user_mcp_dir(user_id)
    
    mcp_dir = os.path.join(user_mcp_dir, request.name)
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
    
    new_server = db_manager.create_mcp_server(
        db=db,
        user_id=user_id,
        name=request.name,
        transport="stdio",
        command="python",
        args=[main_py_path],
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
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    if server.transport != "stdio" or not server.args:
        raise HTTPException(status_code=400, detail="Server is not a Python MCP")
    
    main_py_path = server.args[0] if server.args else None
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
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    if server.transport != "stdio" or not server.args:
        raise HTTPException(status_code=400, detail="Server is not a Python MCP")
    
    main_py_path = server.args[0] if server.args else None
    if not main_py_path:
        raise HTTPException(status_code=404, detail="MCP code file not found")
    
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(request.code)
    
    return {
        "code": 200,
        "message": "MCP code updated",
        "data": {"server_id": server_id},
    }


@router.get("/open-source")
async def get_open_source_mcps(current_user: User = Depends(get_current_user)):
    """获取可用的开源 MCP 列表。"""
    return {
        "code": 200,
        "message": "Open source MCPs retrieved",
        "data": OPEN_SOURCE_MCPS,
    }


@router.post("/import")
async def import_open_mcp(
    mcp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导入开源 MCP 配置。"""
    mcp_config = next((m for m in OPEN_SOURCE_MCPS if m["id"] == mcp_id), None)
    
    if not mcp_config:
        raise HTTPException(status_code=404, detail=f"MCP '{mcp_id}' not found")
    
    user_id = current_user.id
    
    new_server = db_manager.create_mcp_server(
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """连接到 MCP 服务器。"""
    user_id = current_user.id
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    server.enabled = True
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
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    server.enabled = False
    db.commit()
    
    return {
        "code": 200,
        "message": "Disconnected successfully",
        "data": {"server_id": server_id, "status": "disconnected"},
    }


@router.post("/servers/test")
async def test_server(server: MCPServerCreate, current_user: User = Depends(get_current_user)):
    """测试 MCP 服务器连接。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient
    
    client = None
    try:
        client = MCPClient({
            "transport": server.transport,
            "url": server.url,
            "command": server.command,
            "args": server.args,
            "env": server.env,
            "headers": server.headers,
            "timeout": server.timeout,
        })
        
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取MCP服务器的工具列表。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient
    
    user_id = current_user.id
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    client = None
    try:
        client = MCPClient({
            "transport": server.transport,
            "url": server.url,
            "command": server.command,
            "args": server.args,
            "env": server.env,
            "headers": server.headers,
            "timeout": server.timeout,
        })
        
        await client.connect()
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
    finally:
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass


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
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    client = None
    try:
        client = MCPClient({
            "transport": server.transport,
            "url": server.url,
            "command": server.command,
            "args": server.args,
            "env": server.env,
            "headers": server.headers,
            "timeout": server.timeout,
        })
        
        await client.connect()
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
    finally:
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass


@router.get("/tools/all")
async def get_all_tools(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有已启用MCP服务器的工具。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient
    
    user_id = current_user.id
    servers = db_manager.get_mcp_servers(db, user_id)
    
    async def get_server_tools(server):
        tools = []
        client = None
        try:
            client = MCPClient({
                "transport": server.transport,
                "url": server.url,
                "command": server.command,
                "args": server.args,
                "env": server.env,
                "headers": server.headers,
                "timeout": server.timeout,
            })
            
            await client.connect()
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
        finally:
            if client:
                try:
                    await client.disconnect()
                except Exception:
                    pass
        return tools
    
    enabled_servers = [s for s in servers if s.enabled]
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
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    client = None
    try:
        client = MCPClient({
            "transport": server.transport,
            "url": server.url,
            "command": server.command,
            "args": server.args,
            "env": server.env,
            "headers": server.headers,
            "timeout": server.timeout,
        })
        
        await client.connect()
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
    finally:
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass


@router.get("/servers/{server_id}/prompts")
async def get_server_prompts(
    server_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取MCP服务器的提示词列表。"""
    from SoloAgent.plugins.mcp.mcp_client import MCPClient
    
    user_id = current_user.id
    server = db_manager.get_mcp_server(db, server_id, user_id)
    
    if not server:
        raise HTTPException(status_code=404, detail=f"Server '{server_id}' not found")
    
    client = None
    try:
        client = MCPClient({
            "transport": server.transport,
            "url": server.url,
            "command": server.command,
            "args": server.args,
            "env": server.env,
            "headers": server.headers,
            "timeout": server.timeout,
        })
        
        await client.connect()
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
    finally:
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass


@router.post("/init-defaults")
async def init_default_mcps(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """初始化默认的MCP服务器配置。"""
    from app.utils.default_packages import DEFAULT_MCP_SERVERS
    
    user_id = current_user.id
    added_count = 0
    
    for mcp_config in DEFAULT_MCP_SERVERS:
        existing = db.query(MCPServerModel).filter(
            MCPServerModel.user_id == user_id,
            MCPServerModel.name == mcp_config["name"]
        ).first()
        
        if not existing:
            new_server = db_manager.create_mcp_server(
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
            )
            if new_server:
                added_count += 1
    
    return {
        "code": 200,
        "message": f"Initialized {added_count} default MCP servers",
        "data": {"added_count": added_count},
    }
