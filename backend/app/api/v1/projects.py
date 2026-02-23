# -*- coding: utf-8 -*-
"""
项目接口 - 项目管理相关API端点。

@file projects.py
@description 项目接口 - 项目管理相关API端点
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 获取用户所有项目列表接口
- 创建新项目接口
- 获取项目详情接口
- 更新项目信息接口
- 删除项目接口
- 获取画布数据接口
- 保存画布数据接口
- 运行项目接口

使用场景：
- 项目创建和管理
- 画布数据的存取
- 项目执行
"""

import logging
import uuid
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, ProjectModel, OptimisticLockError
from app.schemas.response import CanvasSchema, ExecutionRequestSchema, ExecutionResponseSchema
from app.core.canvas_parser import CanvasParser
from app.core.scheduler import Scheduler
from app.api.v1.auth import get_current_user
from app.core.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["projects"])


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="项目名称")
    description: Optional[str] = Field(None, description="项目描述")


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")


class CanvasUpdate(BaseModel):
    nodes: list = Field(default_factory=list)
    edges: list = Field(default_factory=list)
    version: Optional[int] = Field(None, description="乐观锁版本号")


class ProjectResponse(BaseModel):
    id: str
    user_id: str
    name: str
    description: Optional[str]
    is_active: bool
    version: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CanvasResponse(BaseModel):
    id: str
    name: str
    canvas: Dict[str, Any]
    version: int


@router.get("")
async def get_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取用户的所有项目。"""
    user_id = current_user.id
    projects = db_manager.get_projects(db, user_id)
    
    return {
        "code": 200,
        "message": "success",
        "data": [
            {
                "id": p.id,
                "user_id": p.user_id,
                "name": p.name,
                "description": p.description,
                "is_active": p.is_active,
                "version": p.version,
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
            for p in projects
        ],
    }


@router.post("")
async def create_project(
    name: str = Query(..., min_length=1, max_length=255),
    description: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建新项目。"""
    user_id = current_user.id
    
    project = db_manager.create_project(
        db=db,
        user_id=user_id,
        name=name,
        description=description,
        canvas_data={"nodes": [], "edges": []},
    )
    
    return {
        "code": 201,
        "message": "created",
        "data": {
            "id": project.id,
            "user_id": project.user_id,
            "name": project.name,
            "description": project.description,
            "canvas": project.canvas_data,
            "version": project.version,
            "created_at": project.created_at.isoformat() if project.created_at else None,
        },
    }


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取项目详情。"""
    user_id = current_user.id
    project = db_manager.get_project(db, project_id, user_id)
    
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    
    return {
        "code": 200,
        "message": "success",
        "data": {
            "id": project.id,
            "user_id": project.user_id,
            "name": project.name,
            "description": project.description,
            "canvas": project.canvas_data,
            "is_active": project.is_active,
            "version": project.version,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        },
    }


@router.put("/{project_id}")
async def update_project(
    project_id: str,
    update_data: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新项目信息（带乐观锁）。"""
    user_id = current_user.id
    
    update_dict = {}
    if update_data.name is not None:
        update_dict["name"] = update_data.name
    if update_data.description is not None:
        update_dict["description"] = update_data.description
    
    try:
        project = db_manager.update_project(
            db, project_id, user_id, version=update_data.version, **update_dict
        )
    except OptimisticLockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    
    return {
        "code": 200,
        "message": "updated",
        "data": {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "version": project.version,
        },
    }


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除项目。"""
    user_id = current_user.id
    success = db_manager.delete_project(db, project_id, user_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    
    return {
        "code": 200,
        "message": "deleted",
        "data": {"project_id": project_id},
    }


@router.get("/{project_id}/canvas")
async def get_canvas(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取画布数据。"""
    user_id = current_user.id
    project = db_manager.get_project(db, project_id, user_id)
    
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    
    return {
        "code": 200,
        "message": "success",
        "data": {
            "id": project.id,
            "name": project.name,
            "canvas": project.canvas_data or {"nodes": [], "edges": []},
            "version": project.version,
        },
    }


@router.put("/{project_id}/canvas")
async def update_canvas(
    project_id: str,
    canvas_data: CanvasUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """保存画布数据（带乐观锁）。"""
    user_id = current_user.id
    
    try:
        project = db_manager.update_project(
            db,
            project_id,
            user_id,
            version=canvas_data.version,
            canvas_data={"nodes": canvas_data.nodes, "edges": canvas_data.edges},
        )
    except OptimisticLockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    
    return {
        "code": 200,
        "message": "updated",
        "data": {
            "id": project.id,
            "name": project.name,
            "canvas": project.canvas_data,
            "version": project.version,
        },
    }


@router.post("/{project_id}/run")
async def run_project(
    project_id: str,
    request: ExecutionRequestSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """运行项目。"""
    user_id = current_user.id
    project = db_manager.get_project(db, project_id, user_id)
    
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    
    canvas_data = project.canvas_data
    
    if not canvas_data or not canvas_data.get("nodes"):
        raise HTTPException(status_code=400, detail="Project has no canvas data")
    
    try:
        collaboration_graph = CanvasParser.parse(canvas_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    task_id = str(uuid.uuid4())
    
    scheduler = Scheduler(collaboration_graph)
    initial_context = {"user_input": request.input}
    
    return {
        "code": 200,
        "message": "started",
        "data": {
            "task_id": task_id,
            "project_id": project_id,
            "status": "running",
        },
    }
