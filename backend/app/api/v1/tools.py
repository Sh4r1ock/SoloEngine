# -*- coding: utf-8 -*-
"""
SoloEngine : 工具管理API模块

@file tools.py
@description 工具接口 - 工具管理相关API端点
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 获取工具列表
    - 注册/注销工具
    - 调用工具
    - 工具信息查询

依赖:
    - fastapi: Web框架
    - pydantic: 数据验证
    - app.core.tool_registry: 工具注册表
    - app.api.v1.auth: 认证依赖
    - app.core.auth: 用户认证

使用示例:
    - GET /api/v1/tools - 获取工具列表
    - POST /api/v1/tools/{tool_id}/call - 调用工具
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
import uuid

from app.core.tool_registry import tool_registry
from app.api.v1.auth import get_current_user
from app.core.auth import User

router = APIRouter(prefix="/api/v1/tools", tags=["tools"])


class RegisterToolRequest(BaseModel):
    """注册工具请求。"""
    name: str = Field(..., description="工具名称")
    description: str = Field("", description="工具描述")
    parameters: Optional[Dict[str, Any]] = Field(None, description="工具参数定义")
    tool_type: str = Field("python", description="工具类型: python, mcp")
    server_id: Optional[str] = Field(None, description="MCP服务器ID（如果是MCP工具）")


class CallToolRequest(BaseModel):
    """调用工具请求。"""
    arguments: Dict[str, Any] = Field(default_factory=dict, description="工具参数")


@router.get("")
async def get_tools(current_user: User = Depends(get_current_user)):
    """获取所有可用工具。"""
    tools_info = tool_registry.get_all_tools_info()
    
    return {
        "code": 200,
        "message": "success",
        "data": {
            "tools": tools_info,
        },
    }


@router.get("/{tool_name}")
async def get_tool(tool_name: str, current_user: User = Depends(get_current_user)):
    """获取指定工具信息。"""
    tool_info = tool_registry.get_tool_info(tool_name)
    
    if not tool_info:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    
    return {
        "code": 200,
        "message": "success",
        "data": tool_info.to_dict(),
    }


@router.post("")
async def register_tool(request: RegisterToolRequest, current_user: User = Depends(get_current_user)):
    """注册工具。"""
    if tool_registry.has_tool(request.name):
        raise HTTPException(status_code=400, detail=f"Tool '{request.name}' already exists")
    
    def placeholder_func(**kwargs):
        return f"Tool '{request.name}' executed with args: {kwargs}"
    
    tool_registry.register(
        tool_name=request.name,
        tool_func=placeholder_func,
        description=request.description,
        parameters=request.parameters or {},
        tool_type=request.tool_type,
        server_id=request.server_id,
    )
    
    return {
        "code": 201,
        "message": "Tool registered successfully",
        "data": {
            "name": request.name,
            "description": request.description,
            "tool_type": request.tool_type,
        },
    }


@router.delete("/{tool_name}")
async def delete_tool(tool_name: str, current_user: User = Depends(get_current_user)):
    """注销工具。"""
    if not tool_registry.unregister(tool_name):
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    
    return {
        "code": 200,
        "message": "Tool deleted successfully",
        "data": {"tool_name": tool_name},
    }


@router.post("/{tool_name}/call")
async def call_tool(tool_name: str, request: CallToolRequest, current_user: User = Depends(get_current_user)):
    """调用工具。"""
    if not tool_registry.has_tool(tool_name):
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    
    try:
        result = await tool_registry.call_tool(tool_name, request.arguments)
        
        return {
            "code": 200,
            "message": "Tool executed successfully",
            "data": {
                "tool_name": tool_name,
                "result": result,
            },
        }
    except Exception as e:
        return {
            "code": 500,
            "message": f"Tool execution failed: {str(e)}",
            "data": {
                "tool_name": tool_name,
                "error": str(e),
            },
        }
