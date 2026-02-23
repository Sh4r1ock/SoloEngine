# -*- coding: utf-8 -*-
"""包格式定义。"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class PackageStatus(Enum):
    """包状态。"""
    PENDING = "pending"
    BUILDING = "building"
    COMPLETED = "completed"
    FAILED = "failed"


class RuntimeType(Enum):
    """运行时类型。"""
    PYTHON = "python"
    NODE = "node"
    DOCKER = "docker"


@dataclass
class PackageDependency:
    """包依赖。"""
    name: str
    version: str = "*"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
        }


@dataclass
class PackageFile:
    """包文件。"""
    path: str
    content: str
    is_binary: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "content": self.content,
            "is_binary": self.is_binary,
        }


@dataclass
class PackageManifest:
    """包清单。"""
    name: str
    version: str
    description: str = ""
    author: str = ""
    entry_point: str = "main"
    runtime: RuntimeType = RuntimeType.PYTHON
    dependencies: List[PackageDependency] = field(default_factory=list)
    environment_vars: Dict[str, str] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "entry_point": self.entry_point,
            "runtime": self.runtime.value,
            "dependencies": [d.to_dict() for d in self.dependencies],
            "environment_vars": self.environment_vars,
            "created_at": self.created_at,
        }


@dataclass
class PackageConfig:
    """打包配置。"""
    project_name: str
    name: str
    version: str = "1.0.0"
    description: str = ""
    author: str = ""
    entry_point: str = "main"
    runtime: RuntimeType = RuntimeType.PYTHON
    dependencies: List[str] = field(default_factory=list)
    environment_vars: Dict[str, str] = field(default_factory=dict)
    include_dockerfile: bool = True
    include_readme: bool = True
    include_compose: bool = True
    compress_level: int = 6
    excludes: List[str] = field(default_factory=lambda: ["*.log", ".git", "__pycache__", "node_modules"])
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "project_name": self.project_name,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "entry_point": self.entry_point,
            "runtime": self.runtime.value,
            "dependencies": self.dependencies,
            "environment_vars": self.environment_vars,
            "include_dockerfile": self.include_dockerfile,
            "include_readme": self.include_readme,
            "include_compose": self.include_compose,
            "compress_level": self.compress_level,
            "excludes": self.excludes,
        }


@dataclass
class PackageResult:
    """打包结果。"""
    name: str
    version: str
    status: PackageStatus
    files_count: int = 0
    size_bytes: int = 0
    output_path: str = ""
    files: List[PackageFile] = field(default_factory=list)
    manifest: Optional[PackageManifest] = None
    error: str = ""
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "status": self.status.value,
            "files_count": self.files_count,
            "size_bytes": self.size_bytes,
            "output_path": self.output_path,
            "files": [f.to_dict() for f in self.files],
            "manifest": self.manifest.to_dict() if self.manifest else None,
            "error": self.error,
            "created_at": self.created_at,
        }
