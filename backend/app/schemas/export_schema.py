# -*- coding: utf-8 -*-
"""
SoloEngine : 导出格式定义模块

@file export_schema.py
@description 导出格式数据模型定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义导出相关的数据模型，包括：
    - 导出节点
    - 导出边
    - 导出技能
    - 导出MCP配置
    - 导出项目

依赖:
    - typing: 类型注解支持
    - dataclasses: 数据类支持
    - datetime: 日期时间处理

使用示例:
    - from app.schemas.export_schema import ExportProject, ExportNode
    - project = ExportProject(name="my_project", nodes=[], edges=[])
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo
from app.core.config import settings


@dataclass
class ExportNode:
    """导出节点。"""
    id: str
    type: str
    position: Dict[str, float]
    data: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "position": self.position,
            "data": self.data,
        }


@dataclass
class ExportEdge:
    """导出边。"""
    id: str
    source: str
    target: str
    source_handle: Optional[str] = None
    target_handle: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "target": self.target,
            "sourceHandle": self.source_handle,
            "targetHandle": self.target_handle,
        }


@dataclass
class ExportSkill:
    """导出技能。"""
    name: str
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "content": self.content,
            "metadata": self.metadata,
        }


@dataclass
class ExportMCPConfig:
    """导出 MCP 配置。"""
    server_name: str
    transport: str
    url: Optional[str] = None
    command: Optional[str] = None
    args: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "server_name": self.server_name,
            "transport": self.transport,
            "url": self.url,
            "command": self.command,
            "args": self.args,
            "env": self.env,
        }


@dataclass
class ExportProject:
    """导出项目。"""
    name: str
    version: str = "1.0.0"
    description: str = ""
    nodes: List[ExportNode] = field(default_factory=list)
    edges: List[ExportEdge] = field(default_factory=list)
    skills: List[ExportSkill] = field(default_factory=list)
    mcp_configs: List[ExportMCPConfig] = field(default_factory=list)
    settings: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    exported_at: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
            "skills": [s.to_dict() for s in self.skills],
            "mcp_configs": [m.to_dict() for m in self.mcp_configs],
            "settings": self.settings,
            "created_at": self.created_at,
            "exported_at": self.exported_at,
        }
