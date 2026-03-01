# -*- coding: utf-8 -*-
"""
Skills 管理 API endpoints。

@file skills.py
@description Skills接口 - Skills包管理相关API端点
@author SoloEngine Team
@date 2026-02-19

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
import logging
import shutil
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.database import get_db, db_manager, SkillsPackageModel, OptimisticLockError
from app.api.v1.auth import get_current_user
from app.core.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])


SKILLS_ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data", "skills"))
os.makedirs(SKILLS_ROOT_DIR, exist_ok=True)

SYSTEM_SKILLS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data", "system_skills"))


def get_user_skills_dir(user_id: str) -> str:
    """获取用户的Skills目录。"""
    user_dir = os.path.join(SKILLS_ROOT_DIR, user_id)
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


def copy_skill_template(template_name: str, target_dir: str) -> bool:
    """从模板目录复制skill包内容到目标目录。
    
    Args:
        template_name: 模板名称（如 'pdf', 'docx' 等）
        target_dir: 目标目录路径
        
    Returns:
        bool: 是否成功复制了模板
    """
    template_dir = os.path.join(SKILL_TEMPLATES_DIR, template_name)
    
    if os.path.exists(template_dir) and os.path.isdir(template_dir):
        try:
            if os.path.exists(target_dir):
                shutil.rmtree(target_dir)
            shutil.copytree(template_dir, target_dir)
            logger.info(f"Copied skill template '{template_name}' to {target_dir}")
            return True
        except Exception as e:
            logger.error(f"Failed to copy skill template: {e}")
    return False


def parse_skill_md(skill_md_path: str) -> Dict[str, Any]:
    """解析SKILL.md文件，提取元数据和内容。
    
    Args:
        skill_md_path: SKILL.md文件路径
        
    Returns:
        dict: 包含name, version, description, author, tags, instructions等字段
    """
    result = {
        "name": "",
        "version": "1.0.0",
        "description": "",
        "author": "Anthropic",
        "tags": [],
        "instructions": ""
    }
    
    if not os.path.exists(skill_md_path):
        return result
    
    try:
        with open(skill_md_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                frontmatter = parts[1].strip()
                body = parts[2].strip()
                
                for line in frontmatter.split("\n"):
                    if ":" in line:
                        key, value = line.split(":", 1)
                        key = key.strip().lower()
                        value = value.strip()
                        
                        if key == "name":
                            result["name"] = value
                        elif key == "version":
                            result["version"] = value
                        elif key == "description":
                            result["description"] = value
                        elif key == "author":
                            result["author"] = value
                        elif key == "tags":
                            if value.startswith("[") and value.endswith("]"):
                                tags_str = value[1:-1]
                                result["tags"] = [t.strip().strip('"').strip("'") for t in tags_str.split(",") if t.strip()]
                
                result["instructions"] = body
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
    
    扫描SYSTEM_SKILLS_DIR目录，将所有系统skill存入skills_packages表（author='system'）。
    
    Args:
        db: 数据库会话
        
    Returns:
        int: 同步的skill数量
    """
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
            SkillsPackageModel.author == "system",
            SkillsPackageModel.name == skill_name
        ).first()
        
        if existing:
            existing.folder_path = skill_path
            existing.description = skill_info.get("description", existing.description)
            existing.tags = skill_info.get("tags", existing.tags)
            existing.instructions = skill_info.get("instructions", existing.instructions)
            existing.pkg_version = skill_info.get("version", existing.pkg_version)
            existing.version = (existing.version or 0) + 1
            logger.info(f"Updated system skill: {skill_name}")
        else:
            from datetime import datetime
            skill = SkillsPackageModel(
                name=skill_name,
                folder_path=skill_path,
                description=skill_info.get("description", ""),
                author="system",
                tags=skill_info.get("tags", []),
                instructions=skill_info.get("instructions", ""),
                pkg_version=skill_info.get("version", "1.0.0"),
                is_public=True,
                is_active=True,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
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


class UpdateSkillPackageRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    author: Optional[str] = None
    tags: Optional[List[str]] = None
    pkg_version: Optional[str] = None
    is_active: Optional[bool] = None
    version: Optional[int] = Field(None, description="乐观锁版本号")


class GeneratePromptRequest(BaseModel):
    package_id: str = Field(..., description="Skills 包ID")
    context: Optional[Dict[str, Any]] = Field(None, description="上下文变量")


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
        is_system = pkg.author == "system"
        result.append({
            "id": pkg.id,
            "user_id": pkg.user_id,
            "name": pkg.name,
            "pkg_version": pkg.pkg_version,
            "description": pkg.description or "",
            "author": pkg.author,
            "tags": pkg.tags or [],
            "instructions": pkg.instructions or "",
            "folder_path": pkg.folder_path,
            "is_active": pkg.is_active,
            "is_public": pkg.is_public,
            "is_system": is_system,
            "version": pkg.version,
            "created_at": pkg.created_at.isoformat() if pkg.created_at else None,
            "updated_at": pkg.updated_at.isoformat() if pkg.updated_at else None,
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
    
    pkg = db.query(SkillsPackageModel).filter(
        SkillsPackageModel.id == package_id,
        or_(
            SkillsPackageModel.author == "system",
            SkillsPackageModel.user_id == user_id
        )
    ).first()
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    is_system = pkg.author == "system"
    
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
            "instructions": pkg.instructions or "",
            "folder_path": pkg.folder_path,
            "is_active": pkg.is_active,
            "is_public": pkg.is_public,
            "is_system": is_system,
            "version": pkg.version,
            "created_at": pkg.created_at.isoformat() if pkg.created_at else None,
            "updated_at": pkg.updated_at.isoformat() if pkg.updated_at else None,
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
    
    pkg = db_manager.create_skills_package(
        db=db,
        user_id=user_id,
        name=request.name,
        description=request.description,
        folder_path=package_dir,
        pkg_version=request.pkg_version,
        author=request.author,
        tags=request.tags,
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
            "created_at": pkg.created_at.isoformat() if pkg.created_at else None,
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
            
            if pkg.folder_path and os.path.exists(pkg.folder_path):
                parent_dir = os.path.dirname(pkg.folder_path)
                new_folder_path = os.path.join(parent_dir, new_name)
                if os.path.exists(new_folder_path):
                    raise HTTPException(status_code=400, detail=f"文件夹 '{new_name}' 已存在，请使用其他名称")
                try:
                    os.rename(pkg.folder_path, new_folder_path)
                    update_data["folder_path"] = new_folder_path
                except Exception as e:
                    logger.error(f"重命名文件夹失败: {e}")
                    raise HTTPException(status_code=500, detail=f"重命名文件夹失败: {str(e)}")
            
            update_data["name"] = new_name
    
    if request.description is not None:
        update_data["description"] = request.description
    if request.author is not None:
        update_data["author"] = request.author
    if request.tags is not None:
        update_data["tags"] = request.tags
    if request.pkg_version is not None:
        update_data["pkg_version"] = request.pkg_version
    if request.is_active is not None:
        update_data["is_active"] = request.is_active
    
    try:
        pkg = db_manager.update_skills_package(
            db, package_id, user_id, version=request.version, **update_data
        )
    except OptimisticLockError as e:
        raise HTTPException(status_code=409, detail=str(e))
    
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
    
    pkg = db.query(SkillsPackageModel).filter(
        SkillsPackageModel.id == package_id,
        SkillsPackageModel.user_id == user_id
    ).first()
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if pkg.author == "system":
        raise HTTPException(status_code=403, detail="System skills cannot be deleted")
    
    if pkg.folder_path and os.path.exists(pkg.folder_path):
        try:
            shutil.rmtree(pkg.folder_path)
        except Exception as e:
            logger.error(f"删除文件夹失败: {e}")
    
    db.delete(pkg)
    db.commit()
    
    return {
        "code": 200,
        "message": "Skills package deleted",
        "data": {"package_id": package_id},
    }


MAX_FILE_SIZE = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = {'.zip'}


@router.post("/import")
async def import_package(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导入 Skills 包。"""
    user_id = current_user.id
    user_skills_dir = get_user_skills_dir(user_id)
    
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}")
    
    import tempfile
    import zipfile
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as temp_file:
        total_size = 0
        chunk_size = 1024 * 1024
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total_size += len(chunk)
            if total_size > MAX_FILE_SIZE:
                os.unlink(temp_file.name)
                raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB")
            temp_file.write(chunk)
        temp_file_path = temp_file.name
    
    try:
        with zipfile.ZipFile(temp_file_path, 'r') as zip_ref:
            package_name = None
            for file_info in zip_ref.filelist:
                if file_info.filename.endswith('SKILL.md'):
                    path_parts = file_info.filename.split('/')
                    if len(path_parts) > 0:
                        package_name = path_parts[0]
                    break
            
            if not package_name:
                package_name = os.path.splitext(file.filename)[0]
            
            extract_dir = os.path.join(user_skills_dir, package_name)
            if os.path.exists(extract_dir):
                shutil.rmtree(extract_dir)
            os.makedirs(extract_dir, exist_ok=True)
            
            zip_ref.extractall(extract_dir)
            
            skill_md_path = os.path.join(extract_dir, "SKILL.md")
            if os.path.exists(skill_md_path):
                with open(skill_md_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                metadata = {"name": package_name, "version": "1.0.0", "description": "", "author": "", "tags": []}
                if "---" in content:
                    parts = content.split("---")
                    if len(parts) >= 2:
                        import yaml
                        try:
                            frontmatter = yaml.safe_load(parts[1])
                            if frontmatter:
                                metadata.update(frontmatter)
                        except yaml.YAMLError as e:
                            logger.warning(f"Failed to parse YAML frontmatter: {e}")
                        except Exception as e:
                            logger.error(f"Unexpected error parsing frontmatter: {e}")
                
                pkg = db_manager.create_skills_package(
                    db=db,
                    user_id=user_id,
                    name=metadata.get("name", package_name),
                    description=metadata.get("description", ""),
                    folder_path=extract_dir,
                    pkg_version=metadata.get("version", "1.0.0"),
                    author=metadata.get("author", ""),
                    tags=metadata.get("tags", []),
                )
                
                return {
                    "code": 200,
                    "message": "Skills package imported",
                    "data": {
                        "id": pkg.id,
                        "name": pkg.name,
                        "pkg_version": pkg.pkg_version,
                        "description": pkg.description,
                    },
                }
            else:
                shutil.rmtree(extract_dir)
                raise HTTPException(status_code=400, detail="Invalid Skills package: SKILL.md not found")
    
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")
    finally:
        os.unlink(temp_file_path)


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
    
    if not pkg.folder_path or not os.path.exists(pkg.folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    import tempfile
    import zipfile
    export_path = os.path.join(tempfile.gettempdir(), f"{pkg.name}.zip")
    
    with zipfile.ZipFile(export_path, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
        for root, dirs, files in os.walk(pkg.folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, pkg.folder_path)
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
    
    pkg = db.query(SkillsPackageModel).filter(
        SkillsPackageModel.id == package_id,
        or_(
            SkillsPackageModel.author == "system",
            SkillsPackageModel.user_id == user_id
        )
    ).first()
    
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
    
    pkg = db.query(SkillsPackageModel).filter(
        SkillsPackageModel.id == package_id,
        or_(
            SkillsPackageModel.author == "system",
            SkillsPackageModel.user_id == user_id
        )
    ).first()
    
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
    
    if not pkg.folder_path or not os.path.exists(pkg.folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    safe_skill_name = os.path.basename(skill_name)
    if not re.match(r'^[\w\-\.]+$', safe_skill_name):
        raise HTTPException(status_code=400, detail="Invalid skill name format")
    
    skill_path = os.path.normpath(os.path.join(pkg.folder_path, "skills", safe_skill_name))
    if not skill_path.startswith(os.path.normpath(pkg.folder_path)):
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


@router.post("/prompt")
async def generate_prompt(
    request: GeneratePromptRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """生成包含 Skills 的提示词。"""
    user_id = current_user.id
    pkg = db_manager.get_skills_package(db, request.package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{request.package_id}' not found")
    
    if not pkg.instructions:
        return {
            "code": 200,
            "message": "No instructions found",
            "data": {
                "package_id": request.package_id,
                "prompt": "",
            },
        }
    
    prompt = pkg.instructions
    if request.context:
        for key, value in request.context.items():
            prompt = prompt.replace(f"{{{{ {key} }}}}", str(value))
    
    return {
        "code": 200,
        "message": "Prompt generated",
        "data": {
            "package_id": request.package_id,
            "prompt": prompt,
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
    
    pkg = db.query(SkillsPackageModel).filter(
        SkillsPackageModel.id == package_id,
        or_(
            SkillsPackageModel.author == "system",
            SkillsPackageModel.user_id == user_id
        )
    ).first()
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if not pkg.folder_path or not os.path.exists(pkg.folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    file_tree = build_file_tree(pkg.folder_path)
    
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
    
    pkg = db.query(SkillsPackageModel).filter(
        SkillsPackageModel.id == package_id,
        or_(
            SkillsPackageModel.author == "system",
            SkillsPackageModel.user_id == user_id
        )
    ).first()
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if not pkg.folder_path or not os.path.exists(pkg.folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    safe_path = os.path.normpath(file_path)
    if safe_path.startswith("..") or safe_path.startswith("/") or safe_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    full_path = os.path.normpath(os.path.join(pkg.folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(pkg.folder_path)):
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
    
    pkg = db.query(SkillsPackageModel).filter(
        SkillsPackageModel.id == package_id,
        or_(
            SkillsPackageModel.author == "system",
            SkillsPackageModel.user_id == user_id
        )
    ).first()
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if pkg.author == "system":
        raise HTTPException(status_code=403, detail="System skills are read-only")
    
    if not pkg.folder_path or not os.path.exists(pkg.folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    # 安全检查
    safe_path = os.path.normpath(request.file_path)
    if safe_path.startswith("..") or safe_path.startswith("/") or safe_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    full_path = os.path.normpath(os.path.join(pkg.folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(pkg.folder_path)):
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
    
    if not pkg.folder_path or not os.path.exists(pkg.folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    # 安全检查
    safe_path = os.path.normpath(request.file_path)
    if safe_path.startswith("..") or safe_path.startswith("/") or safe_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    full_path = os.path.normpath(os.path.join(pkg.folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(pkg.folder_path)):
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
    
    if not pkg.folder_path or not os.path.exists(pkg.folder_path):
        raise HTTPException(status_code=404, detail="Package folder not found")
    
    # 安全检查
    safe_path = os.path.normpath(request.file_path)
    if safe_path.startswith("..") or safe_path.startswith("/") or safe_path.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    full_path = os.path.normpath(os.path.join(pkg.folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(pkg.folder_path)):
        raise HTTPException(status_code=403, detail="Access denied: path traversal detected")
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"File or folder '{request.file_path}' not found")
    
    # 防止删除整个skills包
    if os.path.normpath(full_path) == os.path.normpath(pkg.folder_path):
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
