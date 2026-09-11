# -*- coding: utf-8 -*-
import logging
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional, List, Dict, Any

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.data_paths import DataPaths
from app.core.config import settings
from .security import check_optimistic_lock, increment_version
from .models import (
    engine,
    SessionLocal,
    MCPServerModel,
    MCPStdioConfigModel,
    MCPSseConfigModel,
    MCPHttpConfigModel,
)

logger = logging.getLogger(__name__)


class MCPDatabaseManager:
    """MCP数据库管理器。"""

    def __init__(self):
        self.engine = engine
        self.SessionLocal = SessionLocal

    def create_server(
        self,
        db: Session,
        user_id: str,
        name: str,
        transport_type: str,
        description: str = None,
        is_active: bool = True,
        is_public: bool = False,
        author: str = None,
        tags: List[str] = None,
        source_type: str = None,
        icon: str = None,
    ) -> MCPServerModel:
        """创建MCP服务器配置。"""
        final_tags = tags.copy() if tags else []
        if user_id == "system" and "system" not in final_tags:
            final_tags.append("system")
        
        server = MCPServerModel(
            user_id=user_id,
            name=name,
            transport_type=transport_type,
            source_type=source_type or "upload",
            description=description,
            icon=icon,
            is_active=is_active,
            is_public=is_public,
            author=author,
            tags=final_tags,
        )
        db.add(server)
        db.commit()
        db.refresh(server)
        return server

    def get_servers(self, db: Session, user_id: str) -> List[MCPServerModel]:
        """获取用户可见的MCP服务器（公共 + 用户）。"""
        from sqlalchemy import or_
        return db.query(MCPServerModel).filter(
            or_(
                MCPServerModel.is_public == True,
                MCPServerModel.user_id == user_id
            )
        ).order_by(MCPServerModel.created_at.desc()).all()
    
    def check_server_permission(self, db: Session, server_id: str, user_id: str, action: str = "read") -> Optional[MCPServerModel]:
        """检查服务器权限（基于is_public和user_id）。"""
        server = db.query(MCPServerModel).filter(
            MCPServerModel.id == server_id,
            or_(
                MCPServerModel.is_public == True,
                MCPServerModel.user_id == user_id
            )
        ).first()
        if not server:
            return None
        
        # 写操作只能对自己的数据执行
        if action in ["update", "delete"] and server.user_id != user_id:
            return None
        
        return server

    def get_server(self, db: Session, mcp_server_id: str, user_id: str = None) -> Optional[MCPServerModel]:
        """获取MCP服务器（包含公共数据）。"""
        query = db.query(MCPServerModel).filter(MCPServerModel.id == mcp_server_id)
        if user_id:
            query = query.filter(
                or_(
                    MCPServerModel.is_public == True,
                    MCPServerModel.user_id == user_id
                )
            )
        return query.first()

    def update_server(
        self,
        db: Session,
        mcp_server_id: str,
        user_id: str,
        version: int = None,
        **kwargs
    ) -> Optional[MCPServerModel]:
        """更新MCP服务器配置（带乐观锁）。"""
        server = self.get_server(db, mcp_server_id, user_id)
        if not server:
            return None
        
        check_optimistic_lock(server, version)
        
        for key, value in kwargs.items():
            if key == 'tags' and value is not None:
                if server.user_id == "system":
                    if "system" not in value:
                        value.append("system")
                setattr(server, key, value)
            elif hasattr(server, key):
                setattr(server, key, value)
        increment_version(server)
        db.commit()
        db.refresh(server)
        return server

    def delete_server(self, db: Session, mcp_server_id: str, user_id: str) -> bool:
        """删除MCP服务器。"""
        server = self.get_server(db, mcp_server_id, user_id)
        if server:
            db.delete(server)
            db.commit()
            return True
        return False

    def create_stdio_config(
        self,
        db: Session,
        mcp_server_id: str,
        command: str = None,
        args: List[str] = None,
        env: dict = None,
        folder_path: str = None,
        working_dir: str = None,
    ) -> MCPStdioConfigModel:
        """创建Stdio配置。"""
        rel_folder_path = DataPaths.to_relative_path(folder_path) if folder_path else None
        rel_working_dir = DataPaths.to_relative_path(working_dir) if working_dir else None
        
        config = MCPStdioConfigModel(
            mcp_server_id=mcp_server_id,
            command=command,
            args=args or [],
            env=env or {},
            folder_path=rel_folder_path,
            working_dir=rel_working_dir,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    def get_stdio_config(self, db: Session, mcp_server_id: str) -> Optional[MCPStdioConfigModel]:
        """获取Stdio配置。"""
        config = db.query(MCPStdioConfigModel).filter(
            MCPStdioConfigModel.mcp_server_id == mcp_server_id
        ).first()
        
        if config:
            if config.folder_path:
                config.folder_path = DataPaths.to_absolute_path(config.folder_path)
            if config.working_dir:
                config.working_dir = DataPaths.to_absolute_path(config.working_dir)
        
        db.expunge(config) if config else None
        return config

    def update_stdio_config(self, db: Session, mcp_server_id: str, **kwargs) -> Optional[MCPStdioConfigModel]:
        """更新Stdio配置。"""
        config = db.query(MCPStdioConfigModel).filter(
            MCPStdioConfigModel.mcp_server_id == mcp_server_id
        ).first()
        
        if config:
            for key, value in kwargs.items():
                if key in ['folder_path', 'working_dir'] and value:
                    value = DataPaths.to_relative_path(value)
                
                if hasattr(config, key):
                    setattr(config, key, value)
            
            db.commit()
            db.refresh(config)
            
            if config.folder_path:
                config.folder_path = DataPaths.to_absolute_path(config.folder_path)
            if config.working_dir:
                config.working_dir = DataPaths.to_absolute_path(config.working_dir)
            
            db.expunge(config)
            return config

    def create_sse_config(
        self,
        db: Session,
        mcp_server_id: str,
        url: str,
        headers: dict = None,
        timeout: int = 30,
        reconnect: bool = True,
        sse_endpoint: str = "/sse",
        retry_interval: int = 5,
        max_retries: int = 3,
    ) -> MCPSseConfigModel:
        """创建SSE配置。"""
        config = MCPSseConfigModel(
            mcp_server_id=mcp_server_id,
            url=url,
            headers=headers or {},
            timeout=timeout,
            reconnect=reconnect,
            sse_endpoint=sse_endpoint,
            retry_interval=retry_interval,
            max_retries=max_retries,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    def get_sse_config(self, db: Session, mcp_server_id: str) -> Optional[MCPSseConfigModel]:
        """获取SSE配置。"""
        return db.query(MCPSseConfigModel).filter(
            MCPSseConfigModel.mcp_server_id == mcp_server_id
        ).first()

    def update_sse_config(self, db: Session, mcp_server_id: str, **kwargs) -> Optional[MCPSseConfigModel]:
        """更新SSE配置。"""
        config = self.get_sse_config(db, mcp_server_id)
        if config:
            for key, value in kwargs.items():
                if hasattr(config, key):
                    setattr(config, key, value)
            db.commit()
            db.refresh(config)
        return config

    def create_http_config(
        self,
        db: Session,
        mcp_server_id: str,
        url: str,
        headers: dict = None,
        timeout: int = 30,
        session_id: str = None,
    ) -> MCPHttpConfigModel:
        """创建HTTP配置。"""
        config = MCPHttpConfigModel(
            mcp_server_id=mcp_server_id,
            url=url,
            headers=headers or {},
            timeout=timeout,
            session_id=session_id,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    def get_http_config(self, db: Session, mcp_server_id: str) -> Optional[MCPHttpConfigModel]:
        """获取HTTP配置。"""
        return db.query(MCPHttpConfigModel).filter(
            MCPHttpConfigModel.mcp_server_id == mcp_server_id
        ).first()

    def update_http_config(self, db: Session, mcp_server_id: str, **kwargs) -> Optional[MCPHttpConfigModel]:
        """更新HTTP配置。"""
        config = self.get_http_config(db, mcp_server_id)
        if config:
            for key, value in kwargs.items():
                if hasattr(config, key):
                    setattr(config, key, value)
            db.commit()
            db.refresh(config)
        return config

    def update_server_tools(
        self,
        db: Session,
        mcp_server_id: str,
        tools: List[Dict[str, Any]],
        user_id: str
    ) -> Optional[MCPServerModel]:
        """更新服务器工具列表。"""
        server = self.get_server(db, mcp_server_id, user_id)
        if not server:
            return None

        # 为每个工具添加 is_enabled 字段（默认启用）
        tools_with_enabled = []
        for tool in tools:
            tool_data = {
                "name": tool.get("name"),
                "description": tool.get("description", ""),
                "input_schema": tool.get("input_schema", tool.get("inputSchema", {})),
                "is_enabled": True,  # 默认启用
            }
            tools_with_enabled.append(tool_data)

        server.tools = tools_with_enabled
        server.updated_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        db.commit()
        db.refresh(server)
        return server

    def update_tool_enabled(
        self,
        db: Session,
        mcp_server_id: str,
        tool_name: str,
        is_enabled: bool,
        user_id: str
    ) -> Optional[MCPServerModel]:
        """更新单个工具的启用状态。"""
        server = self.get_server(db, mcp_server_id, user_id)
        if not server or not server.tools:
            return None

        for tool in server.tools:
            if tool.get("name") == tool_name:
                tool["is_enabled"] = is_enabled
                break

        server.updated_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        db.commit()
        db.refresh(server)
        return server


mcp_db_manager = MCPDatabaseManager()

