# -*- coding: utf-8 -*-
"""
SoloEngine : 运行项目API模块

@file run_project.py
@description 运行项目管理API - 项目选择、文件系统隔离、最近项目记录
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 项目选择和切换
    - 文件夹选择对话框接口
    - 最近项目记录管理
    - 文件系统访问隔离
    - 项目配置管理

依赖:
    - os: 操作系统接口
    - json: JSON处理
    - logging: 日志记录
    - shutil: 文件操作
    - typing: 类型注解支持
    - datetime: 日期时间处理
    - pathlib: 路径处理
    - fastapi: FastAPI框架
    - pydantic: 数据验证
    - sqlalchemy: ORM框架

使用示例:
    - POST /api/v1/run-project/select - 选择项目
    - GET /api/v1/run-project/recent - 获取最近项目

使用场景：
    - 运行场景中的项目管理
    - 文件系统沙箱隔离
"""
import os
import json
import logging
from send2trash import send2trash
from datetime import datetime
from typing import Dict, List, Optional, Any
from zoneinfo import ZoneInfo
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Query, WebSocket
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager
from app.api.v1.auth import get_current_user
from app.core.auth import User
from app.core.config import settings
from app.utils.timezone_utils import format_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/run-project", tags=["run-project"])


class SelectOrCreateProjectRequest(BaseModel):
    agentic_flow_id: str = Field(..., description="流程ID")
    folder_path: str = Field(..., description="选择的文件夹路径")


class SelectFolderRequest(BaseModel):
    folder_path: str = Field(..., description="选择的文件夹路径")


class SelectFolderResponse(BaseModel):
    project_id: str
    project_name: str
    folder_path: str
    is_new: bool
    recent_projects: List[Dict[str, Any]]


class ProjectInfo(BaseModel):
    id: str
    name: str
    folder_path: str
    description: Optional[str]
    last_accessed_at: str
    created_at: str


class RecentProjectInfo(BaseModel):
    id: str
    project_id: str
    project_name: str
    folder_path: str
    accessed_at: str


class FileListRequest(BaseModel):
    path: str = Field(default="", description="相对路径")
    pattern: str = Field(default="*", description="文件匹配模式")
    agentic_flow_id: str = Field(default="", description="流程ID")


class FileReadRequest(BaseModel):
    path: str = Field(..., description="相对文件路径")
    encoding: str = Field(default="utf-8", description="文件编码")
    agentic_flow_id: str = Field(default="", description="流程ID")


class FileWriteRequest(BaseModel):
    path: str = Field(..., description="相对文件路径")
    content: str = Field(..., description="文件内容")
    encoding: str = Field(default="utf-8", description="文件编码")
    mode: str = Field(default="write", description="写入模式: write, append")
    agentic_flow_id: str = Field(default="", description="流程ID")


class SandboxedFileSystem:
    """沙箱文件系统 - 限制文件操作在项目文件夹内。"""
    
    def __init__(self, base_path: str):
        self.base_path = os.path.abspath(base_path)
        if not os.path.isdir(self.base_path):
            raise ValueError(f"Base path does not exist or is not a directory: {self.base_path}")
    
    def _resolve_path(self, relative_path: str) -> str:
        """解析相对路径并验证是否在沙箱内。"""
        relative_path = relative_path.lstrip("/\\")
        absolute_path = os.path.abspath(os.path.join(self.base_path, relative_path))
        
        if not absolute_path.startswith(self.base_path):
            raise PermissionError(f"Access denied: path '{relative_path}' is outside the sandbox")
        
        return absolute_path
    
    def list_files(self, relative_path: str = "", pattern: str = "*") -> List[Dict[str, Any]]:
        """列出文件和目录。"""
        target_path = self._resolve_path(relative_path)
        
        if not os.path.exists(target_path):
            raise FileNotFoundError(f"Path not found: {relative_path}")
        
        results = []
        for item in Path(target_path).glob(pattern):
            if item.name.startswith('.'):
                continue
            
            try:
                stat = item.stat()
                results.append({
                    "name": item.name,
                    "path": str(item.relative_to(self.base_path)),
                    "is_dir": item.is_dir(),
                    "size": stat.st_size if item.is_file() else 0,
                    "modified": format_iso(datetime.fromtimestamp(stat.st_mtime, tz=ZoneInfo(settings.DEFAULT_TIMEZONE))),
                })
            except Exception as e:
                logger.warning(f"Failed to stat {item}: {e}")
        
        return sorted(results, key=lambda x: (not x["is_dir"], x["name"].lower()))
    
    def read_file(self, relative_path: str, encoding: str = "utf-8") -> Dict[str, Any]:
        """读取文件内容。"""
        absolute_path = self._resolve_path(relative_path)
        
        if not os.path.exists(absolute_path):
            raise FileNotFoundError(f"File not found: {relative_path}")
        
        if not os.path.isfile(absolute_path):
            raise IsADirectoryError(f"Path is a directory: {relative_path}")
        
        stat = os.stat(absolute_path)
        
        with open(absolute_path, "r", encoding=encoding) as f:
            content = f.read()
        
        return {
            "path": relative_path,
            "content": content,
            "size": stat.st_size,
            "modified": format_iso(datetime.fromtimestamp(stat.st_mtime, tz=ZoneInfo(settings.DEFAULT_TIMEZONE))),
        }
    
    def write_file(self, relative_path: str, content: str, encoding: str = "utf-8", 
                   mode: str = "write") -> Dict[str, Any]:
        """写入文件内容。"""
        absolute_path = self._resolve_path(relative_path)
        
        parent_dir = os.path.dirname(absolute_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        
        write_mode = "a" if mode == "append" else "w"
        with open(absolute_path, write_mode, encoding=encoding) as f:
            f.write(content)
        
        stat = os.stat(absolute_path)
        
        return {
            "path": relative_path,
            "size": stat.st_size,
            "modified": format_iso(datetime.fromtimestamp(stat.st_mtime, tz=ZoneInfo(settings.DEFAULT_TIMEZONE))),
            "mode": mode,
        }
    
    def delete_file(self, relative_path: str) -> Dict[str, Any]:
        """删除文件或目录（移入回收站）。"""
        absolute_path = self._resolve_path(relative_path)
        
        if not os.path.exists(absolute_path):
            raise FileNotFoundError(f"Path not found: {relative_path}")
        
        is_dir = os.path.isdir(absolute_path)
        send2trash(absolute_path)
        return {"path": relative_path, "type": "directory" if is_dir else "file", "deleted": True}
    
    def create_directory(self, relative_path: str) -> Dict[str, Any]:
        """创建目录。"""
        absolute_path = self._resolve_path(relative_path)
        os.makedirs(absolute_path, exist_ok=True)
        
        return {
            "path": relative_path,
            "created": True,
        }
    
    def file_exists(self, relative_path: str) -> bool:
        """检查文件是否存在。"""
        absolute_path = self._resolve_path(relative_path)
        return os.path.exists(absolute_path)
    
    def get_file_info(self, relative_path: str) -> Dict[str, Any]:
        """获取文件信息。"""
        absolute_path = self._resolve_path(relative_path)
        
        if not os.path.exists(absolute_path):
            raise FileNotFoundError(f"Path not found: {relative_path}")
        
        stat = os.stat(absolute_path)
        
        return {
            "path": relative_path,
            "name": os.path.basename(absolute_path),
            "is_dir": os.path.isdir(absolute_path),
            "size": stat.st_size,
            "created": format_iso(datetime.fromtimestamp(stat.st_ctime, tz=ZoneInfo(settings.DEFAULT_TIMEZONE))),
            "modified": format_iso(datetime.fromtimestamp(stat.st_mtime, tz=ZoneInfo(settings.DEFAULT_TIMEZONE))),
        }


_active_project_sessions: Dict[str, str] = {}


def _get_session_key(user_id: str, agentic_flow_id: str = None) -> str:
    """生成会话存储的 key，包含 user_id 和 agentic_flow_id"""
    if agentic_flow_id:
        return f"{user_id}:{agentic_flow_id}"
    return user_id


def _do_select_or_create_project(
    db: Session,
    user_id: str,
    agentic_flow_id: str,
    folder_path: str
) -> Dict[str, Any]:
    """选择或创建项目的核心逻辑。
    
    Args:
        db: 数据库会话
        user_id: 用户ID
        agentic_flow_id: 流程ID
        folder_path: 文件夹路径
        
    Returns:
        包含项目信息和最近项目列表的字典
    """
    folder_path = os.path.abspath(folder_path)
    
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=400, detail=f"Folder does not exist: {folder_path}")
    
    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {folder_path}")
    
    project_name = os.path.basename(folder_path)
    
    existing_project = db_manager.get_run_project_by_path(
        db, user_id, agentic_flow_id, folder_path
    )
    
    if existing_project:
        existing_project.last_accessed_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        db.commit()
        db.refresh(existing_project)
        project = existing_project
        is_new = False
    else:
        project = db_manager.create_run_project(
            db=db,
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
            name=project_name,
            folder_path=folder_path,
        )
        is_new = True
    
    session_key = _get_session_key(user_id, agentic_flow_id)
    _active_project_sessions[session_key] = project.id
    
    recent_projects = db_manager.get_recent_projects(db, user_id, agentic_flow_id, limit=10)
    
    return {
        "project_id": project.id,
        "project_name": project.name,
        "folder_path": project.folder_path,
        "is_new": is_new,
        "recent_projects": [
            {
                "id": rp.id,
                "project_id": rp.id,
                "project_name": rp.name,
                "folder_path": rp.folder_path,
                "accessed_at": format_iso(rp.last_accessed_at),
            }
            for rp in recent_projects
        ]
    }


def get_sandboxed_fs(user_id: str, db: Session, agentic_flow_id: str = None) -> SandboxedFileSystem:
    """获取用户的沙箱文件系统实例。"""
    if agentic_flow_id == "":
        agentic_flow_id = None
    session_key = _get_session_key(user_id, agentic_flow_id)
    project_id = _active_project_sessions.get(session_key)
    
    if not project_id:
        project = db_manager.get_active_run_project(db, user_id, agentic_flow_id)
        if project:
            project_id = project.id
            _active_project_sessions[session_key] = project_id
    
    if not project_id:
        raise HTTPException(
            status_code=400, 
            detail="No project selected. Please select a project folder first."
        )
    
    project = db_manager.get_run_project(db, project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    folder_path = project.folder_path
    
    if not os.path.isabs(folder_path):
        from app.core.data_paths import DataPaths
        folder_path = DataPaths.to_absolute_path(folder_path)
    
    return SandboxedFileSystem(folder_path)


@router.post("/select-or-create")
async def select_or_create_project(
    request: SelectOrCreateProjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """根据agentic_flow_id、user_id、folder_path选择或创建项目。
    
    逻辑：
    1. 根据user_id + agentic_flow_id + folder_path查询run_projects表
    2. 如果存在，更新last_accessed_at，返回项目信息
    3. 如果不存在，创建新记录，返回项目信息
    4. 更新 recent_projects 表
    """
    data = _do_select_or_create_project(
        db=db,
        user_id=current_user.id,
        agentic_flow_id=request.agentic_flow_id,
        folder_path=request.folder_path
    )
    
    return {
        "code": 200,
        "message": "Project selected successfully",
        "data": data
    }


@router.post("/select-folder")
async def select_folder(
    request: SelectFolderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """选择项目文件夹（已废弃，请使用 /select-or-create）。"""
    raise HTTPException(status_code=410, detail="This endpoint is deprecated. Please use /select-or-create instead.")


@router.get("/current")
async def get_current_project(
    agentic_flow_id: str = Query(None, description="流程ID，可选，用于过滤特定流程的项目"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前选择的项目。"""
    session_key = _get_session_key(current_user.id, agentic_flow_id)
    project_id = _active_project_sessions.get(session_key)
    
    if project_id:
        project = db_manager.get_run_project(db, project_id, current_user.id)
        if project:
            return {
                "code": 200,
                "message": "Current project retrieved",
                "data": {
                    "id": project.id,
                    "name": project.name,
                    "folder_path": project.folder_path,
                    "description": project.description,
                    "last_accessed_at": format_iso(project.last_accessed_at),
                    "created_at": format_iso(project.created_at),
                }
            }
    
    project = db_manager.get_active_run_project(db, current_user.id, agentic_flow_id)
    if project:
        _active_project_sessions[session_key] = project.id
        return {
            "code": 200,
            "message": "Current project retrieved",
            "data": {
                "id": project.id,
                "name": project.name,
                "folder_path": project.folder_path,
                "description": project.description,
                "last_accessed_at": format_iso(project.last_accessed_at),
                "created_at": format_iso(project.created_at),
            }
        }
    
    return {
        "code": 200,
        "message": "No project selected",
        "data": None
    }


@router.get("/recent")
async def get_recent_projects(
    agentic_flow_id: str = Query(..., description="流程ID，必需"),
    limit: int = Query(10, description="返回数量限制"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取最近访问的项目列表。
    
    Args:
        agentic_flow_id: 流程ID，必需，用于过滤特定流程的项目
        limit: 返回数量限制
    """
    recent_projects = db_manager.get_recent_projects(db, current_user.id, agentic_flow_id, limit=limit)
    
    return {
        "code": 200,
        "message": "Recent projects retrieved",
        "data": [
            {
                "id": rp.id,
                "project_id": rp.id,
                "project_name": rp.name,
                "folder_path": rp.folder_path,
                "accessed_at": format_iso(rp.last_accessed_at),
            }
            for rp in recent_projects
        ]
    }


@router.post("/files/list")
async def list_files(
    request: FileListRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """列出项目文件。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, request.agentic_flow_id)
        files = fs.list_files(request.path, request.pattern)
        
        return {
            "code": 200,
            "message": "Files listed successfully",
            "data": {
                "base_path": fs.base_path,
                "relative_path": request.path,
                "files": files,
            }
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to list files: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/read")
async def read_file(
    request: FileReadRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """读取项目文件。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, request.agentic_flow_id)
        result = fs.read_file(request.path, request.encoding)
        
        return {
            "code": 200,
            "message": "File read successfully",
            "data": result
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except UnicodeDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Encoding error: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to read file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/write")
async def write_file(
    request: FileWriteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """写入项目文件。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, request.agentic_flow_id)
        result = fs.write_file(request.path, request.content, request.encoding, request.mode)
        
        return {
            "code": 200,
            "message": "File written successfully",
            "data": result
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to write file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/files/delete")
async def delete_file(
    path: str,
    agentic_flow_id: str = Query(default="", description="流程ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除项目文件或目录。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, agentic_flow_id)
        result = fs.delete_file(path)
        
        return {
            "code": 200,
            "message": "File deleted successfully",
            "data": result
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to delete file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/files/mkdir")
async def create_directory(
    path: str,
    agentic_flow_id: str = Query(default="", description="流程ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建目录。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, agentic_flow_id)
        result = fs.create_directory(path)
        
        return {
            "code": 200,
            "message": "Directory created successfully",
            "data": result
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create directory: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/info")
async def get_file_info(
    path: str,
    agentic_flow_id: str = Query(default="", description="流程ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取文件信息。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, agentic_flow_id)
        result = fs.get_file_info(path)
        
        return {
            "code": 200,
            "message": "File info retrieved",
            "data": result
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get file info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/exists")
async def check_file_exists(
    path: str,
    agentic_flow_id: str = Query(default="", description="流程ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """检查文件是否存在。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, agentic_flow_id)
        exists = fs.file_exists(path)
        
        return {
            "code": 200,
            "message": "File existence checked",
            "data": {
                "path": path,
                "exists": exists,
            }
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to check file existence: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workspace-roots")
async def get_workspace_roots():
    """获取可用的工作区根目录列表。"""
    import platform
    from pathlib import Path
    
    home = str(Path.home())
    user_name = os.path.basename(home)
    system = platform.system()
    
    roots = []
    
    if system == "Windows":
        possible_roots = [
            ("桌面", os.path.join(home, "Desktop")),
            ("文档", os.path.join(home, "Documents")),
            ("下载", os.path.join(home, "Downloads")),
            ("用户目录", home),
        ]
        for drive in ["C:", "D:", "E:", "F:"]:
            if os.path.exists(drive + "\\"):
                possible_roots.append((f"{drive} 盘", drive + "\\"))
    else:
        possible_roots = [
            ("主目录", home),
            ("文档", os.path.join(home, "Documents")),
            ("下载", os.path.join(home, "Downloads")),
            ("/home", "/home"),
            ("/opt", "/opt"),
        ]
    
    for name, path in possible_roots:
        if os.path.exists(path) and os.path.isdir(path):
            roots.append({
                "name": name,
                "path": path,
            })
    
    return {
        "code": 200,
        "message": "Workspace roots retrieved",
        "data": {
            "roots": roots,
            "system": system,
        }
    }


@router.get("/browse")
async def browse_directory(
    path: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """浏览目录内容，返回子目录和文件列表。"""
    
    if not path:
        return await get_workspace_roots()
    
    try:
        abs_path = os.path.abspath(path)
        
        if not os.path.exists(abs_path):
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")
        
        if not os.path.isdir(abs_path):
            raise HTTPException(status_code=400, detail=f"Path is not a directory: {path}")
        
        items = []
        for item in Path(abs_path).iterdir():
            try:
                if item.name.startswith('.'):
                    continue
                
                stat = item.stat()
                items.append({
                    "name": item.name,
                    "path": str(item),
                    "is_dir": item.is_dir(),
                    "size": stat.st_size if item.is_file() else 0,
                    "modified": format_iso(datetime.fromtimestamp(stat.st_mtime, tz=ZoneInfo(settings.DEFAULT_TIMEZONE))),
                })
            except PermissionError:
                continue
            except Exception as e:
                logger.warning(f"Failed to stat {item}: {e}")
        
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        
        parent_path = str(Path(abs_path).parent) if abs_path != Path(abs_path).root else ""
        
        return {
            "code": 200,
            "message": "Directory browsed successfully",
            "data": {
                "current_path": abs_path,
                "parent_path": parent_path,
                "items": items,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to browse directory: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/native-folder-dialog")
async def open_native_folder_dialog(
    agentic_flow_id: str = Query(..., description="流程ID"),
    title: str = "选择项目文件夹",
    initialdir: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """打开原生文件夹选择对话框。
    
    功能：
    1. 打开原生文件夹选择对话框
    2. 如果选择了文件夹，调用 selectOrCreateProject 逻辑创建/获取项目
    
    注意：此 API 是 selectOrCreateProject 的便捷封装，
         核心逻辑由 _do_select_or_create_project 函数实现。
    """
    import asyncio
    import tkinter as tk
    from tkinter import filedialog
    
    def open_dialog():
        root = None
        try:
            root = tk.Tk()
            root.withdraw()
            root.wm_attributes('-topmost', 1)
            
            folder_path = filedialog.askdirectory(
                title=title,
                initialdir=initialdir if initialdir else None
            )
            
            return folder_path if folder_path else None
        except Exception as e:
            logger.error(f"Failed to open folder dialog: {e}")
            return None
        finally:
            if root:
                try:
                    root.quit()
                    root.destroy()
                except Exception:
                    pass
    
    try:
        folder_path = await asyncio.to_thread(open_dialog)
    except Exception as e:
        logger.error(f"Failed to open folder dialog: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    if not folder_path:
        return {
            "code": 200,
            "message": "No folder selected",
            "data": None
        }
    
    data = _do_select_or_create_project(
        db=db,
        user_id=current_user.id,
        agentic_flow_id=agentic_flow_id,
        folder_path=folder_path
    )
    
    return {
        "code": 200,
        "message": "Project selected successfully",
        "data": data
    }


@router.get("/files/access")
async def access_file(
    path: str,
    agentic_flow_id: str = Query(default="", description="流程ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """访问文件（用于预览）。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, agentic_flow_id)
        absolute_path = fs._resolve_path(path)
        
        if not os.path.exists(absolute_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        if not os.path.isfile(absolute_path):
            raise HTTPException(status_code=400, detail="Path is not a file")
        
        return FileResponse(
            path=absolute_path,
            filename=os.path.basename(absolute_path),
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to access file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def get_document_type(file_ext: str) -> str:
    """根据文件扩展名获取 OnlyOffice 文档类型。"""
    ext = file_ext.lower().lstrip('.')
    word_exts = ['doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'htm', 'mht', 'pdf', 'djvu', 'xps', 'epub']
    cell_exts = ['xls', 'xlsx', 'ods', 'csv']
    slide_exts = ['ppt', 'pptx', 'odp']
    
    if ext in word_exts:
        return 'word'
    elif ext in cell_exts:
        return 'cell'
    elif ext in slide_exts:
        return 'slide'
    return 'word'


def generate_file_key(file_path: str) -> str:
    """生成文件唯一 key（用于 OnlyOffice 缓存）。"""
    import hashlib
    return hashlib.md5(file_path.encode()).hexdigest()


class OnlyOfficeConfigRequest(BaseModel):
    path: str = Field(..., description="文件路径")
    mode: str = Field(default="edit", description="编辑模式: edit, view")
    agentic_flow_id: str = Field(default="", description="流程ID")


@router.post("/onlyoffice/config")
async def get_onlyoffice_config(
    request: OnlyOfficeConfigRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取 OnlyOffice 编辑器配置。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, request.agentic_flow_id)
        absolute_path = fs._resolve_path(request.path)
        
        if not os.path.exists(absolute_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        if not os.path.isfile(absolute_path):
            raise HTTPException(status_code=400, detail="Path is not a file")
        
        file_name = os.path.basename(absolute_path)
        file_ext = os.path.splitext(file_name)[1].lstrip('.').lower()
        
        stat = os.stat(absolute_path)
        file_key = f"{generate_file_key(request.path)}_{int(stat.st_mtime)}"
        
        backend_url = f"http://localhost:{settings.BACKEND_PORT}"
        onlyoffice_url = settings.ONLYOFFICE_URL
        
        config = {
            "document": {
                "fileType": file_ext,
                "key": file_key,
                "title": file_name,
                "url": f"{backend_url}/api/v1/run-project/onlyoffice/download?path={request.path}",
            },
            "documentType": get_document_type(file_ext),
            "editorConfig": {
                "callbackUrl": f"{backend_url}/api/v1/run-project/onlyoffice/save?path={request.path}",
                "user": {
                    "id": current_user.id,
                    "name": current_user.username or "User"
                },
                "mode": request.mode,
                "lang": "zh-CN",
                "customization": {
                    "autosave": True,
                    "forcesave": True,
                    "chat": False,
                    "comments": False,
                    "help": True,
                    "zoom": 100,
                    "compactHeader": False,
                    "toolbarNoTabs": False,
                }
            }
        }
        
        return {
            "code": 200,
            "message": "OnlyOffice config retrieved",
            "data": {
                "config": config,
                "documentServerUrl": onlyoffice_url
            }
        }
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get OnlyOffice config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/onlyoffice/download")
async def onlyoffice_download_file(
    path: str,
    agentic_flow_id: str = Query(default="", description="流程ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """OnlyOffice 下载文件 API。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db, agentic_flow_id)
        absolute_path = fs._resolve_path(path)
        
        if not os.path.exists(absolute_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        if not os.path.isfile(absolute_path):
            raise HTTPException(status_code=400, detail="Path is not a file")
        
        return FileResponse(
            path=absolute_path,
            filename=os.path.basename(absolute_path),
        )
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to download file for OnlyOffice: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/onlyoffice/save")
async def onlyoffice_save_file(
    path: str,
    agentic_flow_id: str = Query(default="", description="流程ID"),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """OnlyOffice 保存文件回调 API。"""

    try:
        fs = get_sandboxed_fs(current_user.id, db, agentic_flow_id)
        absolute_path = fs._resolve_path(path)

        if not os.path.exists(absolute_path):
            raise HTTPException(status_code=404, detail="File not found")

        return {
            "error": 0
        }
    except Exception as e:
        logger.error(f"Failed to save file from OnlyOffice: {e}")
        return {
            "error": 1,
            "message": str(e)
        }


@router.websocket("/ws/watch/{project_id}")
async def project_watcher_ws(
    websocket: WebSocket,
    project_id: str,
    token: str = Query(None)
):
    """项目级文件监听 WebSocket 端点。

    当用户浏览资源管理器时，独立于执行会话启动 watchdog 监听，
    实时推送文件系统变化事件到前端。

    URL 格式: /api/v1/run-project/ws/watch/{project_id}?token=xxx
    """
    from app.api.v1.websocket import verify_token
    from app.services.file_system_push import ws_registry
    from app.services.workspace_watcher import workspace_watcher
    from app.core.database import get_db_context

    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return

    valid, user_id = await verify_token(token)
    if not valid:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    with get_db_context() as db:
        project = db_manager.get_run_project(db, project_id, user_id)
    if not project:
        await websocket.close(code=4004, reason="Project not found")
        return

    folder_path = project.folder_path
    if not folder_path or not os.path.exists(folder_path):
        await websocket.close(code=4004, reason="Project folder not found")
        return

    await websocket.accept()

    session_id = f"project:{project_id}"
    ws_key = f"watcher:{project_id}:{user_id}"
    ws_registry.register(ws_key, session_id, websocket)
    workspace_watcher.start_watching(session_id, folder_path)

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except Exception:
                pass
    except Exception:
        pass
    finally:
        workspace_watcher.stop_watching(session_id)
        ws_registry.unregister(ws_key)
