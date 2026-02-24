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

from app.core.database import get_db, db_manager, SkillsPackageModel, OptimisticLockError
from app.api.v1.auth import get_current_user
from app.core.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])


SKILLS_ROOT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "skills")
os.makedirs(SKILLS_ROOT_DIR, exist_ok=True)


def get_user_skills_dir(user_id: str) -> str:
    """获取用户的Skills目录。"""
    user_dir = os.path.join(SKILLS_ROOT_DIR, user_id)
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


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
    """获取用户的所有 Skills 包（包含系统默认Skills）。"""
    from app.utils.default_packages import DEFAULT_SKILLS_PACKAGES
    
    user_id = current_user.id
    packages = db_manager.get_skills_packages(db, user_id)
    
    user_package_names = {p.name for p in packages}
    
    result = []
    
    for pkg in packages:
        result.append({
            "id": pkg.id,
            "user_id": pkg.user_id,
            "name": pkg.name,
            "pkg_version": pkg.pkg_version,
            "description": pkg.description,
            "author": pkg.author,
            "tags": pkg.tags or [],
            "instructions": pkg.instructions,
            "folder_path": pkg.folder_path,
            "is_active": pkg.is_active,
            "is_public": pkg.is_public,
            "is_default": False,
            "version": pkg.version,
            "created_at": pkg.created_at.isoformat() if pkg.created_at else None,
            "updated_at": pkg.updated_at.isoformat() if pkg.updated_at else None,
        })
    
    for idx, default_skill in enumerate(DEFAULT_SKILLS_PACKAGES):
        if default_skill["name"] not in user_package_names:
            result.append({
                "id": f"default_{idx}",
                "user_id": "system",
                "name": default_skill["name"],
                "pkg_version": "1.0.0",
                "description": default_skill.get("description", ""),
                "author": default_skill.get("author", "SoloEngine"),
                "tags": default_skill.get("tags", []),
                "instructions": default_skill.get("instructions", ""),
                "folder_path": None,
                "is_active": False,
                "is_public": True,
                "is_default": True,
                "source": default_skill.get("source", ""),
                "version": 0,
                "created_at": None,
                "updated_at": None,
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
    
    return {
        "code": 200,
        "message": "Package retrieved",
        "data": {
            "id": pkg.id,
            "user_id": pkg.user_id,
            "name": pkg.name,
            "pkg_version": pkg.pkg_version,
            "description": pkg.description,
            "author": pkg.author,
            "tags": pkg.tags or [],
            "instructions": pkg.instructions,
            "folder_path": pkg.folder_path,
            "is_active": pkg.is_active,
            "is_public": pkg.is_public,
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
    
    update_data = {}
    if request.name is not None:
        update_data["name"] = request.name
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
    pkg = db_manager.get_skills_package(db, package_id, user_id)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
    if pkg.folder_path and os.path.exists(pkg.folder_path):
        try:
            shutil.rmtree(pkg.folder_path)
        except Exception as e:
            logger.error(f"删除文件夹失败: {e}")
    
    success = db_manager.delete_skills_package(db, package_id, user_id)
    
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
    pkg = db_manager.update_skills_package(db, package_id, user_id, is_active=True)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
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
    pkg = db_manager.update_skills_package(db, package_id, user_id, is_active=False)
    
    if not pkg:
        raise HTTPException(status_code=404, detail=f"Package '{package_id}' not found")
    
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


@router.post("/init-defaults")
async def init_default_skills(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """初始化默认的Skills包。"""
    from app.utils.default_packages import DEFAULT_SKILLS_PACKAGES
    
    user_id = current_user.id
    user_skills_dir = get_user_skills_dir(user_id)
    added_count = 0
    
    for skill_config in DEFAULT_SKILLS_PACKAGES:
        existing = db.query(SkillsPackageModel).filter(
            SkillsPackageModel.user_id == user_id,
            SkillsPackageModel.name == skill_config["name"]
        ).first()
        
        if not existing:
            package_dir = os.path.join(user_skills_dir, skill_config["name"])
            os.makedirs(package_dir, exist_ok=True)
            
            skill_md_content = f"""---
name: {skill_config["name"]}
version: 1.0.0
description: {skill_config["description"]}
author: {skill_config["author"]}
tags:
{chr(10).join(f'  - {tag}' for tag in skill_config.get("tags", []))}
---

# {skill_config["name"]}

## 概述
{skill_config["description"]}

## 使用指南
{skill_config.get("instructions", "请在此添加使用说明。")}
"""
            skill_md_path = os.path.join(package_dir, "SKILL.md")
            with open(skill_md_path, "w", encoding="utf-8") as f:
                f.write(skill_md_content)
            
            skills_dir = os.path.join(package_dir, "skills")
            os.makedirs(skills_dir, exist_ok=True)
            
            templates_dir = os.path.join(package_dir, "templates")
            os.makedirs(templates_dir, exist_ok=True)
            
            resources_dir = os.path.join(package_dir, "resources")
            os.makedirs(resources_dir, exist_ok=True)
            
            pkg = db_manager.create_skills_package(
                db=db,
                user_id=user_id,
                name=skill_config["name"],
                description=skill_config["description"],
                folder_path=package_dir,
                pkg_version="1.0.0",
                author=skill_config["author"],
                tags=skill_config.get("tags", []),
            )
            
            if pkg:
                pkg.instructions = skill_config.get("instructions", "")
                db.commit()
                added_count += 1
    
    return {
        "code": 200,
        "message": f"Initialized {added_count} default Skills packages",
        "data": {"added_count": added_count},
    }
