# -*- coding: utf-8 -*-
"""
SoloEngine : AgenticFlow管理API模块，提供AgenticFlow管理相关API端点

@file agentic_flows.py
@description AgenticFlow接口 - Agentic管理相关API端点
@author Sh4rlock
@date 2026-04-09

功能描述：
- 获取用户的所有AgenticFlow列表
- 创建、更新、删除AgenticFlow
- 运行AgenticFlow
- 获取运行历史

使用场景：
- AgenticFlow管理
- Agentic执行和调试
"""

import json
import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager
from app.api.v1.auth import get_current_user
from app.core.auth import User
from app.utils.timezone_utils import format_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agentic-flows", tags=["agentic-flows"])


class CreateFlowRequest(BaseModel):
    name: str = Field(..., description="Agentic名称")
    description: Optional[str] = Field(None, description="Agentic描述")
    icon: Optional[str] = Field(None, description="图标")
    canvas_data: Optional[Dict[str, Any]] = Field(None, description="画布数据")


class UpdateFlowRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    canvas_data: Optional[Dict[str, Any]] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")


class RunFlowRequest(BaseModel):
    input_message: str = Field(..., description="输入消息")


def _get_canvas_data(flow) -> Dict[str, Any]:
    if flow.canvas_data:
        try:
            return json.loads(flow.canvas_data)
        except (json.JSONDecodeError, TypeError):
            return {"nodes": [], "edges": []}
    return {"nodes": [], "edges": []}


@router.get("")
async def list_flows(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取用户的所有AgenticFlow。"""
    user_id = current_user.id
    flows = db_manager.get_agentic_flows(db, user_id)
    
    data = []
    for flow in flows:
        canvas_data = _get_canvas_data(flow)
        data.append({
            "id": flow.id,
            "user_id": flow.user_id,
            "name": flow.name,
            "description": flow.description,
            "icon": flow.icon,
            "folder_path": flow.folder_path,
            "canvas_data": canvas_data,
            "is_template": flow.is_template,
            "is_active": flow.is_active,
            "version": flow.version,
            "created_at": format_iso(flow.created_at),
            "updated_at": format_iso(flow.updated_at),
        })
    
    return {
        "code": 200,
        "message": "AgenticFlows retrieved",
        "data": data,
    }


@router.post("")
async def create_flow(
    request: CreateFlowRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建新的AgenticFlow。"""
    user_id = current_user.id
    
    canvas_data_str = json.dumps(request.canvas_data, ensure_ascii=False) if request.canvas_data else None
    
    flow = db_manager.create_agentic_flow(
        db=db,
        user_id=user_id,
        name=request.name,
        description=request.description,
        folder_path=None,
        icon=request.icon,
        canvas_data=canvas_data_str,
    )
    
    return {
        "code": 200,
        "message": "AgenticFlow created",
        "data": {
            "id": flow.id,
            "user_id": flow.user_id,
            "name": flow.name,
            "description": flow.description,
            "icon": flow.icon,
            "folder_path": flow.folder_path,
            "canvas_data": request.canvas_data or {"nodes": [], "edges": []},
            "is_template": flow.is_template,
            "is_active": flow.is_active,
            "created_at": format_iso(flow.created_at),
            "updated_at": format_iso(flow.updated_at),
        },
    }


@router.get("/{agentic_flow_id}")
async def get_flow(
    agentic_flow_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定的AgenticFlow。"""
    user_id = current_user.id
    flow = db_manager.get_agentic_flow(db, agentic_flow_id, user_id)
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{agentic_flow_id}' not found")
    
    canvas_data = _get_canvas_data(flow)
    
    return {
        "code": 200,
        "message": "AgenticFlow retrieved",
        "data": {
            "id": flow.id,
            "user_id": flow.user_id,
            "name": flow.name,
            "description": flow.description,
            "icon": flow.icon,
            "folder_path": flow.folder_path,
            "canvas_data": canvas_data,
            "is_template": flow.is_template,
            "is_active": flow.is_active,
            "version": flow.version,
            "created_at": format_iso(flow.created_at),
            "updated_at": format_iso(flow.updated_at),
        },
    }


@router.put("/{agentic_flow_id}")
async def update_flow(
    agentic_flow_id: str,
    request: UpdateFlowRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新AgenticFlow（带乐观锁）。"""
    user_id = current_user.id
    
    update_data = {}
    if request.name is not None:
        update_data["name"] = request.name
    if request.description is not None:
        update_data["description"] = request.description
    if request.icon is not None:
        update_data["icon"] = request.icon
    if request.canvas_data is not None:
        update_data["canvas_data"] = json.dumps(request.canvas_data, ensure_ascii=False)
    
    flow = db_manager.update_agentic_flow(
            db, agentic_flow_id, user_id, version=request.version, **update_data
        )
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{agentic_flow_id}' not found")
    
    canvas_data = _get_canvas_data(flow)
    
    return {
        "code": 200,
        "message": "AgenticFlow updated",
        "data": {
            "id": flow.id,
            "user_id": flow.user_id,
            "name": flow.name,
            "description": flow.description,
            "icon": flow.icon,
            "folder_path": flow.folder_path,
            "canvas_data": canvas_data,
            "is_template": flow.is_template,
            "is_active": flow.is_active,
            "version": flow.version,
            "created_at": format_iso(flow.created_at),
            "updated_at": format_iso(flow.updated_at),
        },
    }


@router.delete("/{agentic_flow_id}")
async def delete_flow(
    agentic_flow_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除AgenticFlow。"""
    user_id = current_user.id
    success = db_manager.delete_agentic_flow(db, agentic_flow_id, user_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{agentic_flow_id}' not found")
    
    return {
        "code": 200,
        "message": "AgenticFlow deleted",
        "data": {"agentic_flow_id": agentic_flow_id},
    }


@router.get("/{agentic_flow_id}/canvas")
async def get_canvas(
    agentic_flow_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取AgenticFlow的画布数据。"""
    user_id = current_user.id
    flow = db_manager.get_agentic_flow(db, agentic_flow_id, user_id)
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{agentic_flow_id}' not found")
    
    canvas_data = _get_canvas_data(flow)
    
    return {
        "code": 200,
        "message": "Canvas data retrieved",
        "data": canvas_data,
    }


@router.put("/{agentic_flow_id}/canvas")
async def save_canvas(
    agentic_flow_id: str,
    request: UpdateFlowRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """保存AgenticFlow的画布数据。"""
    user_id = current_user.id
    
    flow = db_manager.get_agentic_flow(db, agentic_flow_id, user_id)
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{agentic_flow_id}' not found")
    
    if request.canvas_data is not None:
        canvas_data_str = json.dumps(request.canvas_data, ensure_ascii=False)
        db_manager.update_agentic_flow(db, agentic_flow_id, user_id, canvas_data=canvas_data_str)
    
    return {
        "code": 200,
        "message": "Canvas data saved",
        "data": {"agentic_flow_id": agentic_flow_id},
    }
