# -*- coding: utf-8 -*-
"""
调试项目 API endpoints。

@file debug_project.py
@description 调试项目管理API - 项目选择、文件系统隔离、最近项目记录
@author SoloEngine Team
@date 2026-02-22

功能描述：
- 项目选择和切换
- 文件夹选择对话框接口
- 最近项目记录管理
- 文件系统访问隔离

使用场景：
- 面试调试场景中的项目管理
- 文件系统沙箱隔离
"""
import os
import json
import logging
import shutil
from typing import Dict, List, Optional, Any
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db, db_manager, DebugProjectModel, RecentProjectModel
from app.api.v1.auth import get_current_user
from app.core.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/debug-project", tags=["debug-project"])


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


class FileReadRequest(BaseModel):
    path: str = Field(..., description="相对文件路径")
    encoding: str = Field(default="utf-8", description="文件编码")


class FileWriteRequest(BaseModel):
    path: str = Field(..., description="相对文件路径")
    content: str = Field(..., description="文件内容")
    encoding: str = Field(default="utf-8", description="文件编码")
    mode: str = Field(default="write", description="写入模式: write, append")


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
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
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
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
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
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "mode": mode,
        }
    
    def delete_file(self, relative_path: str) -> Dict[str, Any]:
        """删除文件或目录。"""
        absolute_path = self._resolve_path(relative_path)
        
        if not os.path.exists(absolute_path):
            raise FileNotFoundError(f"Path not found: {relative_path}")
        
        if os.path.isfile(absolute_path):
            os.remove(absolute_path)
            return {"path": relative_path, "type": "file", "deleted": True}
        elif os.path.isdir(absolute_path):
            shutil.rmtree(absolute_path)
            return {"path": relative_path, "type": "directory", "deleted": True}
        
        return {"path": relative_path, "deleted": False}
    
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
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        }


_active_project_sessions: Dict[str, str] = {}


def get_sandboxed_fs(user_id: str, db: Session) -> SandboxedFileSystem:
    """获取用户的沙箱文件系统实例。"""
    project_id = _active_project_sessions.get(user_id)
    
    if not project_id:
        project = db_manager.get_active_debug_project(db, user_id)
        if project:
            project_id = project.id
            _active_project_sessions[user_id] = project_id
    
    if not project_id:
        raise HTTPException(
            status_code=400, 
            detail="No project selected. Please select a project folder first."
        )
    
    project = db_manager.get_debug_project(db, project_id, user_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return SandboxedFileSystem(project.folder_path)


@router.post("/select-folder")
async def select_folder(
    request: SelectFolderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """选择项目文件夹。"""
    folder_path = os.path.abspath(request.folder_path)
    
    if not os.path.exists(folder_path):
        raise HTTPException(status_code=400, detail=f"Folder does not exist: {folder_path}")
    
    if not os.path.isdir(folder_path):
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {folder_path}")
    
    project_name = os.path.basename(folder_path)
    
    existing_project = db_manager.get_debug_project_by_path(db, current_user.id, folder_path)
    
    if existing_project:
        existing_project.last_accessed_at = datetime.utcnow()
        db.commit()
        db.refresh(existing_project)
        project = existing_project
        is_new = False
    else:
        project = db_manager.create_debug_project(
            db=db,
            user_id=current_user.id,
            name=project_name,
            folder_path=folder_path,
        )
        is_new = True
    
    _active_project_sessions[current_user.id] = project.id
    
    db_manager.add_recent_project(
        db=db,
        user_id=current_user.id,
        project_id=project.id,
        folder_path=folder_path,
        project_name=project_name,
    )
    
    recent_projects = db_manager.get_recent_projects(db, current_user.id, limit=10)
    
    return {
        "code": 200,
        "message": "Project selected successfully",
        "data": {
            "project_id": project.id,
            "project_name": project.name,
            "folder_path": project.folder_path,
            "is_new": is_new,
            "recent_projects": [
                {
                    "id": rp.id,
                    "project_id": rp.project_id,
                    "project_name": rp.project_name,
                    "folder_path": rp.folder_path,
                    "accessed_at": rp.accessed_at.isoformat() if rp.accessed_at else None,
                }
                for rp in recent_projects
            ]
        }
    }


@router.get("/current")
async def get_current_project(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取当前选择的项目。"""
    project_id = _active_project_sessions.get(current_user.id)
    
    if project_id:
        project = db_manager.get_debug_project(db, project_id, current_user.id)
        if project:
            return {
                "code": 200,
                "message": "Current project retrieved",
                "data": {
                    "id": project.id,
                    "name": project.name,
                    "folder_path": project.folder_path,
                    "description": project.description,
                    "last_accessed_at": project.last_accessed_at.isoformat() if project.last_accessed_at else None,
                    "created_at": project.created_at.isoformat() if project.created_at else None,
                }
            }
    
    project = db_manager.get_active_debug_project(db, current_user.id)
    if project:
        _active_project_sessions[current_user.id] = project.id
        return {
            "code": 200,
            "message": "Current project retrieved",
            "data": {
                "id": project.id,
                "name": project.name,
                "folder_path": project.folder_path,
                "description": project.description,
                "last_accessed_at": project.last_accessed_at.isoformat() if project.last_accessed_at else None,
                "created_at": project.created_at.isoformat() if project.created_at else None,
            }
        }
    
    return {
        "code": 200,
        "message": "No project selected",
        "data": None
    }


@router.get("/recent")
async def get_recent_projects(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取最近访问的项目列表。"""
    recent_projects = db_manager.get_recent_projects(db, current_user.id, limit=limit)
    
    return {
        "code": 200,
        "message": "Recent projects retrieved",
        "data": [
            {
                "id": rp.id,
                "project_id": rp.project_id,
                "project_name": rp.project_name,
                "folder_path": rp.folder_path,
                "accessed_at": rp.accessed_at.isoformat() if rp.accessed_at else None,
            }
            for rp in recent_projects
        ]
    }


@router.post("/switch/{project_id}")
async def switch_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """切换到指定项目。"""
    project = db_manager.get_debug_project(db, project_id, current_user.id)
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if not os.path.exists(project.folder_path):
        raise HTTPException(status_code=400, detail=f"Project folder no longer exists: {project.folder_path}")
    
    project.last_accessed_at = datetime.utcnow()
    db.commit()
    db.refresh(project)
    
    _active_project_sessions[current_user.id] = project.id
    
    db_manager.add_recent_project(
        db=db,
        user_id=current_user.id,
        project_id=project.id,
        folder_path=project.folder_path,
        project_name=project.name,
    )
    
    return {
        "code": 200,
        "message": "Project switched successfully",
        "data": {
            "id": project.id,
            "name": project.name,
            "folder_path": project.folder_path,
        }
    }


@router.post("/files/list")
async def list_files(
    request: FileListRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """列出项目文件。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db)
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
        fs = get_sandboxed_fs(current_user.id, db)
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
        fs = get_sandboxed_fs(current_user.id, db)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除项目文件或目录。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """创建目录。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取文件信息。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db)
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """检查文件是否存在。"""
    try:
        fs = get_sandboxed_fs(current_user.id, db)
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
    import platform
    
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
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
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
    title: str = "选择项目文件夹",
    initialdir: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """打开原生文件夹选择对话框。"""
    import threading
    import tkinter as tk
    from tkinter import filedialog
    
    result = {"folder_path": None}
    
    def open_dialog():
        try:
            root = tk.Tk()
            root.withdraw()
            root.wm_attributes('-topmost', 1)
            
            folder_path = filedialog.askdirectory(
                title=title,
                initialdir=initialdir if initialdir else None
            )
            
            result["folder_path"] = folder_path if folder_path else None
            root.destroy()
        except Exception as e:
            logger.error(f"Failed to open folder dialog: {e}")
            result["error"] = str(e)
    
    dialog_thread = threading.Thread(target=open_dialog)
    dialog_thread.start()
    dialog_thread.join(timeout=60)
    
    if result.get("error"):
        raise HTTPException(status_code=500, detail=result["error"])
    
    if not result.get("folder_path"):
        return {
            "code": 200,
            "message": "No folder selected",
            "data": None
        }
    
    folder_path = result["folder_path"]
    
    project_name = os.path.basename(folder_path)
    
    existing_project = db_manager.get_debug_project_by_path(db, current_user.id, folder_path)
    
    if existing_project:
        existing_project.last_accessed_at = datetime.utcnow()
        db.commit()
        db.refresh(existing_project)
        project = existing_project
        is_new = False
    else:
        project = db_manager.create_debug_project(
            db=db,
            user_id=current_user.id,
            name=project_name,
            folder_path=folder_path,
        )
        is_new = True
    
    _active_project_sessions[current_user.id] = project.id
    
    db_manager.add_recent_project(
        db=db,
        user_id=current_user.id,
        project_id=project.id,
        folder_path=folder_path,
        project_name=project_name,
    )
    
    recent_projects = db_manager.get_recent_projects(db, current_user.id, limit=10)
    
    return {
        "code": 200,
        "message": "Folder selected successfully",
        "data": {
            "project_id": project.id,
            "project_name": project.name,
            "folder_path": project.folder_path,
            "is_new": is_new,
            "recent_projects": [
                {
                    "id": rp.id,
                    "project_id": rp.project_id,
                    "project_name": rp.project_name,
                    "folder_path": rp.folder_path,
                    "accessed_at": rp.accessed_at.isoformat() if rp.accessed_at else None,
                }
                for rp in recent_projects
            ]
        }
    }
