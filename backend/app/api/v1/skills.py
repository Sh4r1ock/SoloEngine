# -*- coding: utf-8 -*-
"""
SoloEngine : Skills管理API模块，提供Skills包管理相关API端点

@file skills.py
@description Skills接口 - Skills包管理相关API端点
@author Sh4rlock
@date 2026-04-09

功能描述：
- 获取已安装Skills列表接口
- 安装Skill包接口
- 卸载Skill包接口
- 更新Skill包接口
- 获取Skill详情接口
- 导入/导出Skills包接口
- 用户数据隔离

使用场景：
- Skills包的创建、导入和管理
- Skills包的激活和停用

注意事项：
- Skills包需要正确配置元数据
- 支持导入外部Skills包文件
- 所有数据与用户关联
"""

import os
import re
import yaml
import logging
import shutil
import uuid
import tempfile
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, SkillsPackageModel
from app.api.v1.auth import get_current_user
from app.core.auth import User
from app.core.data_paths import DataPaths
from app.utils.timezone_utils import format_iso
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])

# 临时文件管理器（内存存储，重启后清空）
temp_files = {}  # temp_id -> {path, created_at, user_id}


def get_user_skills_dir(user_id: str) -> str:
    """获取用户Skills目录。"""
    path = DataPaths.get_user_skills_dir(user_id)
    DataPaths.ensure_dir(path)
    return path


def parse_skill_md(skill_md_path: str) -> Dict[str, Any]:
    """解析SKILL.md文件，提取元数据和内容。
    
    遵循 Anthropic Agent Skills 标准规范（agentskills.io/specification）：
    - YAML frontmatter 中 name 和 description 为必填字段
    - Markdown body 为 L2 渐进式披露内容
    
    Args:
        skill_md_path: SKILL.md文件路径
        
    Returns:
        dict: 包含name, description, author, tags, version等字段
    """
    FRONTMATTER_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)
    
    result = {
        "name": "",
        "description": "",
        "author": "",
        "tags": [],
        "version": "1.0.0",
    }
    
    if not os.path.exists(skill_md_path):
        return result
    
    try:
        with open(skill_md_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        match = FRONTMATTER_PATTERN.match(content)
        if match:
            frontmatter_str, _ = match.groups()
            fm = yaml.safe_load(frontmatter_str) or {}
            result["name"] = str(fm.get("name", "")).strip()
            result["description"] = str(fm.get("description", "")).strip()
            if "version" in fm:
                result["version"] = str(fm["version"]).strip()
            if "author" in fm:
                result["author"] = str(fm["author"]).strip()
            if "tags" in fm and isinstance(fm["tags"], list):
                result["tags"] = [str(t).strip() for t in fm["tags"]]
        
    except Exception as e:
        logger.error(f"Failed to parse SKILL.md: {e}")
    
    return result


def build_file_tree(folder_path: str, parent_key: str = "") -> List[Dict[str, Any]]:
    """递归构建文件树。
    
    Args:
        folder_path: 文件夹的绝对路径
        parent_key: 父级路径前缀，用于构建完整的相对路径key
    """
    if not os.path.exists(folder_path):
        return []
    
    result = []
    try:
        items = sorted(os.listdir(folder_path))
        for item in items:
            if item.startswith('.'):
                continue
            item_path = os.path.join(folder_path, item)
            is_dir = os.path.isdir(item_path)
            item_key = f"{parent_key}/{item}" if parent_key else item
            node = {
                "key": item_key,
                "title": item,
                "isLeaf": not is_dir,
            }
            if is_dir:
                children = build_file_tree(item_path, item_key)
                if children:
                    node["children"] = children
                else:
                    node["children"] = []
            result.append(node)
    except Exception as e:
        logger.error(f"构建文件树失败: {e}")
    return result


def read_file_content(file_path: str) -> str:
    """读取文件内容。"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        logger.error(f"读取文件失败: {e}")
        return ""


def save_file_content(file_path: str, content: str) -> bool:
    """保存文件内容。"""
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        return True
    except Exception as e:
        logger.error(f"保存文件失败: {e}")
        return False


def delete_file_or_folder(path: str) -> bool:
    """删除文件或文件夹。"""
    try:
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        return True
    except Exception as e:
        logger.error(f"删除失败: {e}")
        return False


def sync_system_skills(db: Session) -> int:
    """同步系统skill到数据库。
    
    扫描SYSTEM_SKILLS_DIR目录，将所有系统skill存入skills_packages表（user_id='system'）。
    
    Args:
        db: 数据库会话
        
    Returns:
        int: 同步的skill数量
    """
    SYSTEM_SKILLS_DIR = DataPaths.get_system_skills_dir()
    
    if not os.path.exists(SYSTEM_SKILLS_DIR):
        logger.warning(f"System skills directory not found: {SYSTEM_SKILLS_DIR}")
        return 0
    
    synced_count = 0
    
    for skill_name in os.listdir(SYSTEM_SKILLS_DIR):
        skill_path = os.path.join(SYSTEM_SKILLS_DIR, skill_name)
        
        if not os.path.isdir(skill_path):
            continue
        
        skill_md_path = os.path.join(skill_path, "SKILL.md")
        if not os.path.exists(skill_md_path):
            continue
        
        skill_info = parse_skill_md(skill_md_path)
        
        existing = db.query(SkillsPackageModel).filter(
            SkillsPackageModel.user_id == "system",
            SkillsPackageModel.name == skill_name
        ).first()
        
        if existing:
            existing.folder_path = DataPaths.to_relative_path(skill_path)
            desc = skill_info.get("description", "")
            if desc:
                existing.description = desc
            tags = skill_info.get("tags", existing.tags or [])
            if "system" not in tags:
                tags.append("system")
            existing.tags = tags
            existing.pkg_version = skill_info.get("version", existing.pkg_version)
            existing.version = (existing.version or 0) + 1
            logger.info(f"Updated system skill: {skill_name}")
        else:
            from datetime import datetime, timezone
            tags = skill_info.get("tags", [])
            if "system" not in tags:
                tags.append("system")
            skill = SkillsPackageModel(
                name=skill_name,
                folder_path=DataPaths.to_relative_path(skill_path),
                description=skill_info.get("description", ""),
                user_id="system",
                tags=tags,
                pkg_version=skill_info.get("version", "1.0.0"),
                is_public=True,
                is_active=True,
                created_at=datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)),
                updated_at=datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)),
            )
            db.add(skill)
            logger.info(f"Created system skill: {skill_name}")
        
        synced_count += 1
    
    db.commit()
    return synced_count


class CreateSkillPackageRequest(BaseModel):
    name: str = Field(..., description="Skills 包名称")
    description: str = Field("", description="Skills 包描述")
    author: str = Field("", description="作者")
    tags: List[str] = Field(default_factory=list, description="标签列表")
    pkg_version: str = Field("1.0.0", description="版本号")
    icon: Optional[str] = Field(None, description="图标")


class UpdateSkillPackageRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    author: Optional[str] = None
    tags: Optional[List[str]] = None
    pkg_version: Optional[str] = None
    is_active: Optional[bool] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")
    icon: Optional[str] = None


class SearchSkillsRequest(BaseModel):
    query: str = Field("", description="搜索查询")
    tags: Optional[List[str]] = Field(None, description="标签过滤")


@router.get("/packages")
async def list_packages(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取用户可见的所有 Skills 包（系统skill + 用户skill）。"""
    user_id = current_user.id
    
    all_skills = db_manager.get_all_skills_for_user(db, user_id)
    
    result = []
    for pkg in all_skills:
        is_system = pkg.user_id == "system"
        result.append({
            "id": pkg.id,
            "user_id": pkg.user_id,
            "name": pkg.name,
            "pkg_version": pkg.pkg_version,
            "description": pkg.description or "",
            "author": pkg.author,
            "tags": pkg.tags or [],
            "folder_path": pkg.folder_path,
            "is_active": pkg.is_active,
            "is_public": pkg.is_public,
            "is_system": is_system,
            "version": pkg.version,
            "icon": pkg.icon,
            "created_at": format_iso(pkg.created_at),
            "updated_at": format_iso(pkg.updated_at),
        })
    
    return {
        "code": 200,
        "message": "Skills packages retrieved",
        "data": result,
    }


@router.get("/packages/{package_id}")
async def get_package(
    package_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定的 Skills 包。"""
    user_id = current_user.id
    
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    is_system = pkg.user_id == "system"
    
    return {
        "code": 200,
        "message": "Package retrieved",
        "data": {
            "id": pkg.id,
            "user_id": pkg.user_id,
            "name": pkg.name,
            "pkg_version": pkg.pkg_version,
            "description": pkg.description or "",
            "author": pkg.author,
            "tags": pkg.tags or [],
            "folder_path": pkg.folder_path,
            "is_active": pkg.is_active,
            "is_public": pkg.is_public,
            "is_system": is_system,
            "version": pkg.version,
            "icon": pkg.icon,
            "created_at": format_iso(pkg.created_at),
            "updated_at": format_iso(pkg.updated_at),
        },
    }


@router.post("/packages")
async def create_package(
    request: CreateSkillPackageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建新的 Skills 包。"""
    user_id = current_user.id
    user_skills_dir = get_user_skills_dir(user_id)
    
    package_dir = os.path.join(user_skills_dir, request.name)
    os.makedirs(package_dir, exist_ok=True)
    
    skill_md_content = f"""---
name: {request.name}
version: {request.pkg_version}
description: {request.description}
author: {request.author}
tags:
{chr(10).join(f'  - {tag}' for tag in request.tags)}
---

# {request.name}

## 概述
{request.description}

## 使用指南
请在此添加使用说明。
"""
    skill_md_path = os.path.join(package_dir, "SKILL.md")
    with open(skill_md_path, "w", encoding="utf-8") as f:
        f.write(skill_md_content)
    
    skills_dir = os.path.join(package_dir, "skills")
    os.makedirs(skills_dir, exist_ok=True)
    
    common_dir = os.path.join(package_dir, "common")
    os.makedirs(common_dir, exist_ok=True)
    
    tags = request.tags.copy() if request.tags else []
    if user_id == "system" and "system" not in tags:
        tags.append("system")
    
    pkg = db_manager.create_skills_package(
        db=db,
        user_id=user_id,
        name=request.name,
        description=request.description,
        folder_path=DataPaths.to_relative_path(package_dir),
        pkg_version=request.pkg_version,
        author=request.author,
        tags=tags,
        icon=request.icon,
    )
    
    return {
        "code": 200,
        "message": "Skills package created",
        "data": {
            "id": pkg.id,
            "user_id": pkg.user_id,
            "name": pkg.name,
            "pkg_version": pkg.pkg_version,
            "description": pkg.description,
            "author": pkg.author,
            "tags": pkg.tags or [],
            "folder_path": pkg.folder_path,
            "is_active": pkg.is_active,
            "icon": pkg.icon,
            "created_at": format_iso(pkg.created_at),
        },
    }


@router.put("/packages/{package_id}")
async def update_package(
    package_id: str,
    request: UpdateSkillPackageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新 Skills 包（带乐观锁）。"""
    user_id = current_user.id
    
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    # 检查是否是系统skill
    if pkg.user_id == "system" and user_id != "system":
        # 系统skill只允许修改is_active状态，其他修改不允许
        allowed_fields = ['is_active']
        for key in request.__dict__:
            if key not in allowed_fields and getattr(request, key) is not None:
                raise HTTPException(status_code=403, detail="System skills cannot be edited")
    
    update_data = {}
    if request.name is not None:
        new_name = request.name.strip()
        if new_name != pkg.name:
            existing = db.query(SkillsPackageModel).filter(
                SkillsPackageModel.user_id == user_id,
                SkillsPackageModel.name == new_name,
                SkillsPackageModel.id != package_id
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail=f"包名称 '{new_name}' 已存在，请使用其他名称")
            
            if pkg.folder_path:
                abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
                if os.path.exists(abs_folder_path):
                    parent_dir = os.path.dirname(abs_folder_path)
                    new_abs_folder_path = os.path.join(parent_dir, new_name)
                    if os.path.exists(new_abs_folder_path):
                        raise HTTPException(status_code=400, detail=f"文件夹 '{new_name}' 已存在，请使用其他名称")
                    try:
                        os.rename(abs_folder_path, new_abs_folder_path)
                        update_data["folder_path"] = DataPaths.to_relative_path(new_abs_folder_path)
                    except Exception as e:
                        logger.error(f"重命名文件夹失败: {e}")
                        raise HTTPException(status_code=500, detail=f"重命名文件夹失败: {str(e)}")
            
            update_data["name"] = new_name
    
    if request.description is not None:
        update_data["description"] = request.description
    if request.author is not None:
        update_data["author"] = request.author
    if request.tags is not None:
        # 如果是系统skill，确保system标签不会被删除
        if pkg.user_id == "system":
            if "system" not in request.tags:
                request.tags.append("system")
        update_data["tags"] = request.tags
    if request.pkg_version is not None:
        update_data["pkg_version"] = request.pkg_version
    if request.is_active is not None:
        update_data["is_active"] = request.is_active
    if request.icon is not None:
        update_data["icon"] = request.icon
    
    pkg = db_manager.update_skills_package(
            db, package_id, user_id, version=request.version, **update_data
        )
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    return {
        "code": 200,
        "message": "Skills package updated",
        "data": {
            "id": pkg.id,
            "name": pkg.name,
            "pkg_version": pkg.pkg_version,
            "description": pkg.description,
            "is_active": pkg.is_active,
            "folder_path": pkg.folder_path,
            "version": pkg.version,
            "icon": pkg.icon,
        },
    }


@router.delete("/packages/{package_id}")
async def delete_package(
    package_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除 Skills 包。"""
    user_id = current_user.id
    
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if pkg.user_id == "system" and user_id != "system":
        raise HTTPException(status_code=403, detail="System skills cannot be deleted")
    
    if pkg.folder_path:
        abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
        if os.path.exists(abs_folder_path):
            try:
                shutil.rmtree(abs_folder_path)
            except Exception as e:
                logger.error(f"删除文件夹失败: {e}")
    
    db.delete(pkg)
    db.commit()
    
    return {
        "code": 200,
        "message": "Skills package deleted",
        "data": {"package_id": package_id},
    }


MAX_FILE_SIZE = settings.MAX_FILE_UPLOAD_SIZE
ALLOWED_EXTENSIONS = {'.zip'}


@router.post("/import/parse")
async def parse_import_package(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """解析上传的Skills包，返回元数据（不保存，仅创建临时文件）"""
    user_id = current_user.id
    
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}")
    
    # 生成临时文件ID
    temp_id = str(uuid.uuid4())
    
    # 保存临时文件
    temp_dir = tempfile.mkdtemp()
    temp_file_path = os.path.join(temp_dir, file.filename)
    
    total_size = 0
    chunk_size = 1024 * 1024
    try:
        with open(temp_file_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_FILE_SIZE:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                    raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB")
                f.write(chunk)
        
        # 解析ZIP
        import zipfile
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        
        with zipfile.ZipFile(temp_file_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
            
            # 查找SKILL.md
            skill_md_path = None
            package_name = None
            for file_info in zip_ref.filelist:
                if file_info.filename.endswith('SKILL.md'):
                    path_parts = file_info.filename.split('/')
                    if len(path_parts) > 0:
                        package_name = path_parts[0]
                        skill_md_path = os.path.join(extract_dir, file_info.filename)
                    break
            
            if not skill_md_path:
                # 尝试根目录
                skill_md_path = os.path.join(extract_dir, "SKILL.md")
                package_name = os.path.splitext(file.filename)[0]
        
        # 解析SKILL.md
        metadata = {
            "name": package_name,
            "version": "1.0.0",
            "description": "",
            "author": "",
            "tags": [],
            "temp_file_id": temp_id
        }
        
        if os.path.exists(skill_md_path):
            with open(skill_md_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            if "---" in content:
                parts = content.split("---")
                if len(parts) >= 2:
                    import yaml
                    try:
                        frontmatter = yaml.safe_load(parts[1])
                        if frontmatter:
                            metadata.update(frontmatter)
                    except yaml.YAMLError:
                        pass
        
        # 记录临时文件
        temp_files[temp_id] = {
            "path": temp_dir,
            "created_at": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)),
            "user_id": user_id
        }
        
        return {
            "code": 200,
            "message": "Package parsed",
            "data": metadata
        }
        
    except zipfile.BadZipFile:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Invalid ZIP file")
    except Exception as e:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Parse failed: {str(e)}")


@router.post("/import/cleanup")
async def cleanup_temp_file(
    temp_id: str = Form(...),
    current_user: User = Depends(get_current_user)
):
    """清理临时文件"""
    if temp_id in temp_files:
        temp_info = temp_files[temp_id]
        # 验证用户权限
        if temp_info["user_id"] == current_user.id:
            shutil.rmtree(temp_info["path"], ignore_errors=True)
            del temp_files[temp_id]
    
    return {"code": 200, "message": "Cleaned up"}


@router.post("/import")
async def import_package(
    temp_id: str = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    author: str = Form(""),
    tags: str = Form("[]"),  # JSON字符串
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """确认导入Skills包（使用临时文件）"""
    user_id = current_user.id
    
    if temp_id not in temp_files:
        raise HTTPException(status_code=400, detail="Temp file not found or expired")
    
    temp_info = temp_files[temp_id]
    if temp_info["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    temp_dir = temp_info["path"]
    user_skills_dir = get_user_skills_dir(user_id)
    
    try:
        # 查找解压后的目录
        extract_dir = os.path.join(temp_dir, "extracted")
        if not os.path.exists(extract_dir):
            extract_dir = temp_dir
        
        # 移动到用户skills目录
        package_dir = os.path.join(user_skills_dir, name)
        if os.path.exists(package_dir):
            shutil.rmtree(package_dir)
        
        # 复制文件
        shutil.copytree(extract_dir, package_dir)
        
        # 解析tags
        tags_list = json.loads(tags)
        
        # 创建数据库记录
        pkg = db_manager.create_skills_package(
            db=db,
            user_id=user_id,
            name=name,
            description=description,
            folder_path=DataPaths.to_relative_path(package_dir),
            pkg_version="1.0.0",
            author=author,
            tags=tags_list,
        )
        
        # 清理临时文件
        shutil.rmtree(temp_dir, ignore_errors=True)
        del temp_files[temp_id]
        
        return {
            "code": 200,
            "message": "Skills package imported",
            "data": {
                "id": pkg.id,
                "name": pkg.name,
                "pkg_version": pkg.pkg_version,
                "description": pkg.description,
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@router.get("/packages/{package_id}/export")
async def export_package(
    package_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导出 Skills 包。"""
    user_id = current_user.id
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if not pkg.folder_path:
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
    if not os.path.exists(abs_folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    export_path = os.path.join(tempfile.gettempdir(), f"{pkg.name}.zip")
    
    with zipfile.ZipFile(export_path, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
        for root, dirs, files in os.walk(abs_folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, abs_folder_path)
                zip_ref.write(file_path, arcname)
    
    return {
        "code": 200,
        "message": "Package exported",
        "data": {
            "filename": f"{pkg.name}.zip",
            "path": export_path,
        },
    }


@router.post("/search")
async def search_skills(
    request: SearchSkillsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """搜索 Skills 包。"""
    user_id = current_user.id
    packages = db_manager.get_skills_packages(db, user_id)
    
    results = []
    for pkg in packages:
        match = False
        
        if request.query:
            if request.query.lower() in pkg.name.lower():
                match = True
            elif pkg.description and request.query.lower() in pkg.description.lower():
                match = True
        else:
            match = True
        
        if request.tags:
            pkg_tags = pkg.tags or []
            if not any(tag in pkg_tags for tag in request.tags):
                match = False
        
        if match:
            results.append({
                "id": pkg.id,
                "name": pkg.name,
                "pkg_version": pkg.pkg_version,
                "description": pkg.description,
                "author": pkg.author,
                "tags": pkg.tags or [],
                "is_active": pkg.is_active,
            })
    
    return {
        "code": 200,
        "message": "Search results",
        "data": results,
    }


@router.post("/packages/{package_id}/activate")
async def activate_package(
    package_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """激活 Skills 包。"""
    user_id = current_user.id
    
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    pkg.is_active = True
    db.commit()
    
    return {
        "code": 200,
        "message": "Package activated",
        "data": {
            "id": pkg.id,
            "name": pkg.name,
            "is_active": pkg.is_active,
        },
    }


@router.post("/packages/{package_id}/deactivate")
async def deactivate_package(
    package_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """停用 Skills 包。"""
    user_id = current_user.id
    
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    pkg.is_active = False
    db.commit()
    
    return {
        "code": 200,
        "message": "Package deactivated",
        "data": {
            "id": pkg.id,
            "name": pkg.name,
            "is_active": pkg.is_active,
        },
    }


@router.get("/packages/{package_id}/skills/{skill_name}")
async def get_skill_content(
    package_id: str,
    skill_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 Skills 包中的技能内容。"""
    import re
    
    user_id = current_user.id
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if not pkg.folder_path:
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
    if not os.path.exists(abs_folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    safe_skill_name = os.path.basename(skill_name)
    if not re.match(r'^[\w\-\.]+$', safe_skill_name):
        raise HTTPException(status_code=400, detail="Invalid skill name format")
    
    skill_path = os.path.normpath(os.path.join(abs_folder_path, "skills", safe_skill_name))
    if not skill_path.startswith(os.path.normpath(abs_folder_path)):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected")
    
    if not os.path.exists(skill_path):
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    
    skill_md_path = os.path.join(skill_path, "SKILL.md")
    if os.path.exists(skill_md_path):
        with open(skill_md_path, "r", encoding="utf-8") as f:
            content = f.read()
    else:
        content = ""
        for root, dirs, files in os.walk(skill_path):
            for file in files:
                file_path = os.path.join(root, file)
                with open(file_path, "r", encoding="utf-8") as f:
                    content += f"--- {file} ---\n{f.read()}\n\n"
    
    return {
        "code": 200,
        "message": "Skill content retrieved",
        "data": {
            "package_id": package_id,
            "skill_name": skill_name,
            "content": content,
            "path": skill_path,
        },
    }


@router.get("/packages/{package_id}/files")
async def get_package_files(
    package_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 Skills 包的文件树。"""
    user_id = current_user.id
    
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if not pkg.folder_path:
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
    if not os.path.exists(abs_folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    file_tree = build_file_tree(abs_folder_path)
    
    return {
        "code": 200,
        "message": "File tree retrieved",
        "data": {
            "package_id": package_id,
            "files": file_tree,
            "folder_path": pkg.folder_path,
        },
    }


@router.get("/packages/{package_id}/files/content")
async def get_file_content(
    package_id: str,
    file_path: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取指定文件的内容。"""
    user_id = current_user.id
    
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if not pkg.folder_path:
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
    if not os.path.exists(abs_folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    safe_path = os.path.normpath(file_path)
    if safe_path.startswith("..") or safe_path.startswith("/") or safe_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    full_path = os.path.normpath(os.path.join(abs_folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(abs_folder_path)):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected")
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"File '{file_path}' not found")
    
    if os.path.isdir(full_path):
        raise HTTPException(status_code=400, detail="Path is a directory, not a file")
    
    content = read_file_content(full_path)
    
    return {
        "code": 200,
        "message": "File content retrieved",
        "data": {
            "package_id": package_id,
            "file_path": file_path,
            "content": content,
        },
    }


class SaveFileRequest(BaseModel):
    file_path: str = Field(..., description="文件路径")
    content: str = Field(..., description="文件内容")


@router.post("/packages/{package_id}/files/save")
async def save_file(
    package_id: str,
    request: SaveFileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """保存文件内容。"""
    user_id = current_user.id
    
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if pkg.user_id == "system" and user_id != "system":
        raise HTTPException(status_code=403, detail="System skills are read-only")
    
    if not pkg.folder_path:
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
    if not os.path.exists(abs_folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    # 安全检查
    safe_path = os.path.normpath(request.file_path)
    if safe_path.startswith("..") or safe_path.startswith("/") or safe_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    full_path = os.path.normpath(os.path.join(abs_folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(abs_folder_path)):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected")
    
    success = save_file_content(full_path, request.content)
    
    if success:
        return {
            "code": 200,
            "message": "File saved successfully",
            "data": {
                "package_id": package_id,
                "file_path": request.file_path,
            },
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to save file")


class CreateFileRequest(BaseModel):
    file_path: str = Field(..., description="文件或文件夹路径")
    is_directory: bool = Field(False, description="是否为文件夹")


@router.post("/packages/{package_id}/files/create")
async def create_file_or_folder(
    package_id: str,
    request: CreateFileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建文件或文件夹。"""
    user_id = current_user.id
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if not pkg.folder_path:
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
    if not os.path.exists(abs_folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    # 安全检查
    safe_path = os.path.normpath(request.file_path)
    if safe_path.startswith("..") or safe_path.startswith("/") or safe_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    full_path = os.path.normpath(os.path.join(abs_folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(abs_folder_path)):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected")
    
    if os.path.exists(full_path):
        raise HTTPException(status_code=400, detail="File or folder already exists")
    
    try:
        if request.is_directory:
            os.makedirs(full_path, exist_ok=True)
        else:
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write("")
        
        return {
            "code": 200,
            "message": f"{'Folder' if request.is_directory else 'File'} created successfully",
            "data": {
                "package_id": package_id,
                "file_path": request.file_path,
                "is_directory": request.is_directory,
            },
        }
    except Exception as e:
        logger.error(f"创建文件/文件夹失败: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create: {str(e)}")


class DeleteFileRequest(BaseModel):
    file_path: str = Field(..., description="文件或文件夹路径")


@router.post("/packages/{package_id}/files/delete")
async def delete_file_or_folder_endpoint(
    package_id: str,
    request: DeleteFileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除文件或文件夹。"""
    user_id = current_user.id
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if not pkg.folder_path:
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    abs_folder_path = DataPaths.to_absolute_path(pkg.folder_path)
    if not os.path.exists(abs_folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    # 安全检查
    safe_path = os.path.normpath(request.file_path)
    if safe_path.startswith("..") or safe_path.startswith("/") or safe_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    full_path = os.path.normpath(os.path.join(abs_folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(abs_folder_path)):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected")
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"File or folder '{request.file_path}' not found")
    
    # 防止删除整个skills包
    if os.path.normpath(full_path) == os.path.normpath(abs_folder_path):
        raise HTTPException(status_code=403, detail="Cannot delete the root package folder")
    
    success = delete_file_or_folder(full_path)
    
    if success:
        return {
            "code": 200,
            "message": "Deleted successfully",
            "data": {
                "package_id": package_id,
                "file_path": request.file_path,
            },
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to delete")
