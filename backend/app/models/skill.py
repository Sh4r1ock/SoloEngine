# -*- coding: utf-8 -*-
"""
SoloEngine : Skills数据模型模块

@file skill.py
@description Skills数据模型定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义Skills相关的数据模型，包括：
    - Skills包元数据
    - Skill文件信息
    - Skills包

依赖:
    - typing: 类型注解支持
    - dataclasses: 数据类支持
    - datetime: 日期时间处理

使用示例:
    - from app.models.skill import SkillsPackage, SkillMetadata
    - metadata = SkillMetadata(name="my_skill", version="1.0.0")
    - package = SkillsPackage(id="1", name="my_package", root_path="/path")
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class SkillMetadata:
    """Skills 包元数据。"""
    name: str
    version: str = "1.0.0"
    description: str = ""
    author: str = ""
    tags: List[str] = field(default_factory=list)
    instructions: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "tags": self.tags,
            "instructions": self.instructions,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SkillMetadata":
        return cls(
            name=data.get("name", ""),
            version=data.get("version", "1.0.0"),
            description=data.get("description", ""),
            author=data.get("author", ""),
            tags=data.get("tags", []),
            instructions=data.get("instructions", ""),
        )


@dataclass
class SkillFile:
    """Skill 文件信息。"""
    path: str
    name: str
    type: str  # 'skill', 'script', 'reference', 'asset'
    content: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "name": self.name,
            "type": self.type,
            "content": self.content,
            "metadata": self.metadata,
        }


@dataclass
class SkillsPackage:
    """Skills 包。"""
    id: str
    name: str
    root_path: str
    metadata: Optional[SkillMetadata] = None
    skills: List[SkillFile] = field(default_factory=list)
    common_files: List[SkillFile] = field(default_factory=list)
    is_active: bool = False
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "root_path": self.root_path,
            "metadata": self.metadata.to_dict() if self.metadata else None,
            "skills": [s.to_dict() for s in self.skills],
            "common_files": [f.to_dict() for f in self.common_files],
            "is_active": self.is_active,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SkillsPackage":
        metadata = None
        if data.get("metadata"):
            metadata = SkillMetadata.from_dict(data["metadata"])
        
        return cls(
            id=data["id"],
            name=data["name"],
            root_path=data["root_path"],
            metadata=metadata,
            skills=[SkillFile(**s) for s in data.get("skills", [])],
            common_files=[SkillFile(**f) for f in data.get("common_files", [])],
            is_active=data.get("is_active", False),
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
        )
