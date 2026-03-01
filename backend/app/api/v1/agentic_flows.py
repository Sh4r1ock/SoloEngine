# -*- coding: utf-8 -*-
"""
AgenticFlow 管理 API endpoints。

@file agentic_flows.py
@description AgenticFlow接口 - Agentic管理相关API端点
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 获取用户的所有AgenticFlow列表
- 创建、更新、删除AgenticFlow
- 运行AgenticFlow
- 获取运行历史

使用场景：
- AgenticFlow管理
- Agentic执行和调试
"""

import os
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, AgenticFlowModel, AgenticFlowRunModel, OptimisticLockError
from app.api.v1.auth import get_current_user
from app.core.auth import User
from app.core.agenticflow_storage import agenticflow_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/agentic-flows", tags=["agentic-flows"])


class CreateFlowRequest(BaseModel):
    name: str = Field(..., description="Agentic名称")
    description: Optional[str] = Field(None, description="Agentic描述")
    canvas_data: Optional[Dict[str, Any]] = Field(None, description="画布数据")


class UpdateFlowRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    canvas_data: Optional[Dict[str, Any]] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")


class RunFlowRequest(BaseModel):
    input_message: str = Field(..., description="输入消息")


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
        canvas_data = agenticflow_storage.load_canvas(flow.id)
        if canvas_data is None:
            canvas_data = flow.canvas_data or {"nodes": [], "edges": []}
        data.append({
            "id": flow.id,
            "user_id": flow.user_id,
            "name": flow.name,
            "description": flow.description,
            "canvas_data": canvas_data,
            "is_template": flow.is_template,
            "is_active": flow.is_active,
            "version": flow.version,
            "created_at": flow.created_at.isoformat() if flow.created_at else None,
            "updated_at": flow.updated_at.isoformat() if flow.updated_at else None,
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
    
    flow = db_manager.create_agentic_flow(
        db=db,
        user_id=user_id,
        name=request.name,
        description=request.description,
        canvas_data=None,
    )
    
    if request.canvas_data:
        agenticflow_storage.save_canvas(flow.id, request.canvas_data)
    
    return {
        "code": 200,
        "message": "AgenticFlow created",
        "data": {
            "id": flow.id,
            "user_id": flow.user_id,
            "name": flow.name,
            "description": flow.description,
            "canvas_data": request.canvas_data or {"nodes": [], "edges": []},
            "is_template": flow.is_template,
            "is_active": flow.is_active,
            "created_at": flow.created_at.isoformat() if flow.created_at else None,
            "updated_at": flow.updated_at.isoformat() if flow.updated_at else None,
        },
    }


@router.get("/{flow_id}")
async def get_flow(
    flow_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定的AgenticFlow。"""
    user_id = current_user.id
    flow = db_manager.get_agentic_flow(db, flow_id, user_id)
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{flow_id}' not found")
    
    canvas_data = agenticflow_storage.load_canvas(flow_id)
    if canvas_data is None:
        canvas_data = flow.canvas_data or {"nodes": [], "edges": []}
    
    return {
        "code": 200,
        "message": "AgenticFlow retrieved",
        "data": {
            "id": flow.id,
            "user_id": flow.user_id,
            "name": flow.name,
            "description": flow.description,
            "canvas_data": canvas_data,
            "is_template": flow.is_template,
            "is_active": flow.is_active,
            "version": flow.version,
            "created_at": flow.created_at.isoformat() if flow.created_at else None,
            "updated_at": flow.updated_at.isoformat() if flow.updated_at else None,
        },
    }


@router.put("/{flow_id}")
async def update_flow(
    flow_id: str,
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
    
    try:
        flow = db_manager.update_agentic_flow(
            db, flow_id, user_id, version=request.version, **update_data
        )
    except OptimisticLockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{flow_id}' not found")
    
    if request.canvas_data is not None:
        agenticflow_storage.save_canvas(flow_id, request.canvas_data)
    
    canvas_data = agenticflow_storage.load_canvas(flow_id)
    if canvas_data is None:
        canvas_data = flow.canvas_data or {"nodes": [], "edges": []}
    
    return {
        "code": 200,
        "message": "AgenticFlow updated",
        "data": {
            "id": flow.id,
            "user_id": flow.user_id,
            "name": flow.name,
            "description": flow.description,
            "canvas_data": canvas_data,
            "is_template": flow.is_template,
            "is_active": flow.is_active,
            "version": flow.version,
            "created_at": flow.created_at.isoformat() if flow.created_at else None,
            "updated_at": flow.updated_at.isoformat() if flow.updated_at else None,
        },
    }


@router.delete("/{flow_id}")
async def delete_flow(
    flow_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除AgenticFlow。"""
    user_id = current_user.id
    success = db_manager.delete_agentic_flow(db, flow_id, user_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{flow_id}' not found")
    
    agenticflow_storage.delete_canvas(flow_id)
    
    return {
        "code": 200,
        "message": "AgenticFlow deleted",
        "data": {"flow_id": flow_id},
    }


@router.get("/{flow_id}/canvas")
async def get_canvas(
    flow_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取AgenticFlow的画布数据。"""
    user_id = current_user.id
    flow = db_manager.get_agentic_flow(db, flow_id, user_id)
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{flow_id}' not found")
    
    canvas_data = agenticflow_storage.load_canvas(flow_id)
    if canvas_data is None:
        canvas_data = flow.canvas_data or {"nodes": [], "edges": []}
    
    return {
        "code": 200,
        "message": "Canvas data retrieved",
        "data": canvas_data,
    }


@router.put("/{flow_id}/canvas")
async def save_canvas(
    flow_id: str,
    request: UpdateFlowRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """保存AgenticFlow的画布数据。"""
    user_id = current_user.id
    
    flow = db_manager.get_agentic_flow(db, flow_id, user_id)
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{flow_id}' not found")
    
    if request.canvas_data is not None:
        agenticflow_storage.save_canvas(flow_id, request.canvas_data)
        db_manager.update_agentic_flow(db, flow_id, user_id)
    
    return {
        "code": 200,
        "message": "Canvas data saved",
        "data": {"flow_id": flow_id},
    }


@router.get("/{flow_id}/runs")
async def get_runs(
    flow_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取AgenticFlow的运行历史。"""
    user_id = current_user.id
    runs = db_manager.get_runs(db, flow_id=flow_id, user_id=user_id)
    
    return {
        "code": 200,
        "message": "Runs retrieved",
        "data": [
            {
                "id": run.id,
                "agentic_flow_id": run.agentic_flow_id,
                "user_id": run.user_id,
                "status": run.status,
                "input_message": run.input_message,
                "output_message": run.output_message,
                "error": run.error,
                "token_usage": run.token_usage,
                "duration_ms": run.duration_ms,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            }
            for run in runs
        ],
    }


@router.post("/{flow_id}/run")
async def run_flow(
    flow_id: str,
    request: RunFlowRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """运行AgenticFlow。"""
    user_id = current_user.id
    flow = db_manager.get_agentic_flow(db, flow_id, user_id)
    
    if not flow:
        raise HTTPException(status_code=404, detail=f"AgenticFlow '{flow_id}' not found")
    
    run = db_manager.create_run(
        db=db,
        flow_id=flow_id,
        user_id=user_id,
        input_message=request.input_message,
    )
    
    return {
        "code": 200,
        "message": "Run created",
        "data": {
            "id": run.id,
            "agentic_flow_id": run.agentic_flow_id,
            "user_id": run.user_id,
            "status": run.status,
            "input_message": run.input_message,
            "started_at": run.started_at.isoformat() if run.started_at else None,
        },
    }
