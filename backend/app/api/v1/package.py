# -*- coding: utf-8 -*-
"""
SoloEngine : 打包API模块

@file package.py
@description 打包接口 - 项目打包相关API端点
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 创建项目包
    - 下载项目包
    - 获取包信息
    - 列出所有包

依赖:
    - logging: 日志记录
    - typing: 类型注解支持
    - fastapi: FastAPI框架
    - pydantic: 数据验证
    - app.core.packager: 打包服务

使用示例:
    - POST /api/v1/package/create - 创建包
    - GET /api/v1/package/download/{project_name} - 下载包

使用场景：
    - 项目打包和分发
    - 部署准备
"""

import logging
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ...core.packager import packager, PackageConfig, PackageResult
from .auth import get_current_user
from ...core.database import UserModel as User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/package", tags=["package"])


class PackageRequest(BaseModel):
    project_name: str
    name: Optional[str] = None
    version: str = "1.0.0"
    description: str = ""
    author: str = ""
    entry_point: str = "main"
    runtime: str = "python"
    dependencies: List[str] = []
    environment_vars: dict = {}


class PackageInfo(BaseModel):
    name: str
    path: str
    size_bytes: int
    created_at: str
    files_count: Optional[int] = None
    files: Optional[List[str]] = None


@router.post("/create", response_model=PackageResult)
async def create_package(request: PackageRequest, current_user: User = Depends(get_current_user)):
    """创建包。"""
    try:
        config = PackageConfig(
            name=request.name or request.project_name,
            version=request.version,
            description=request.description,
            author=request.author,
            entry_point=request.entry_point,
            runtime=request.runtime,
            dependencies=request.dependencies,
            environment_vars=request.environment_vars,
        )

        result = await packager.create_package(request.project_name, config)
        return result

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create package: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create package: {e}")


@router.get("/list")
async def list_packages(current_user: User = Depends(get_current_user)):
    """列出所有包。"""
    packages = await packager.list_packages()
    return {
        "code": 200,
        "message": "Packages retrieved",
        "data": packages,
    }


@router.get("/{package_name}")
async def get_package_info(package_name: str, current_user: User = Depends(get_current_user)):
    """获取包信息。"""
    info = await packager.get_package_info(package_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Package '{package_name}' not found")

    return {
        "code": 200,
        "message": "Package info retrieved",
        "data": info,
    }


@router.get("/{package_name}/download")
async def download_package(package_name: str, current_user: User = Depends(get_current_user)):
    """下载包。"""
    info = await packager.get_package_info(package_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Package '{package_name}' not found")

    return FileResponse(
        path=info["path"],
        filename=f"{package_name}.zip",
        media_type="application/zip",
    )


@router.delete("/{package_name}")
async def delete_package(package_name: str, current_user: User = Depends(get_current_user)):
    """删除包。"""
    success = await packager.delete_package(package_name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Package '{package_name}' not found")

    return {
        "code": 200,
        "message": "Package deleted",
        "data": {"package_name": package_name},
    }
