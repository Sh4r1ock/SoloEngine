# -*- coding: utf-8 -*-
"""
数据库模型 - MCP服务独立数据库。
"""

import os
import uuid
import logging
from datetime import datetime
from typing import Optional, List

from sqlalchemy import create_engine, Column, String, Text, Integer, DateTime, Boolean, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

logger = logging.getLogger(__name__)

Base = declarative_base()

DATABASE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "mcp_service")
os.makedirs(DATABASE_DIR, exist_ok=True)
DATABASE_PATH = os.path.join(DATABASE_DIR, "mcp_service.db")

engine = create_engine(f"sqlite:///{DATABASE_PATH}", echo=False, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class MCPServerModel(Base):
    """MCP服务器配置模型。"""
    __tablename__ = "mcp_servers"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    transport = Column(String(50), nullable=False)
    url = Column(String(500), nullable=True)
    command = Column(String(500), nullable=True)
    args = Column(JSON, nullable=True)
    env = Column(JSON, nullable=True)
    headers = Column(JSON, nullable=True)
    timeout = Column(Integer, default=30)
    enabled = Column(Boolean, default=True)
    is_public = Column(Boolean, default=False)
    is_default = Column(Boolean, default=False)
    author = Column(String(255), nullable=True)
    source = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)
    module = Column(String(255), nullable=True)
    function = Column(String(100), nullable=True, default="main")
    input_schema = Column(JSON, nullable=True)
    output_schema = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = Column(Integer, nullable=False, default=1)


def init_db():
    """初始化数据库。"""
    Base.metadata.create_all(bind=engine)
    logger.info(f"MCP Service database initialized at {DATABASE_PATH}")


def get_db() -> Session:
    """获取数据库会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class OptimisticLockError(Exception):
    """乐观锁冲突异常。"""
    pass


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
        transport: str,
        url: str = None,
        command: str = None,
        args: List[str] = None,
        env: dict = None,
        headers: dict = None,
        timeout: int = 30,
        is_public: bool = False,
        is_default: bool = False,
        author: str = None,
        source: str = None,
        description: str = None,
        tags: List[str] = None,
        module: str = None,
        function: str = "main",
        input_schema: dict = None,
        output_schema: dict = None,
    ) -> MCPServerModel:
        """创建MCP服务器配置。"""
        server = MCPServerModel(
            user_id=user_id,
            name=name,
            transport=transport,
            url=url,
            command=command,
            args=args or [],
            env=env or {},
            headers=headers or {},
            timeout=timeout,
            is_public=is_public,
            is_default=is_default,
            author=author,
            source=source,
            description=description,
            tags=tags or [],
            module=module,
            function=function or "main",
            input_schema=input_schema,
            output_schema=output_schema,
        )
        db.add(server)
        db.commit()
        db.refresh(server)
        return server

    def get_servers(self, db: Session, user_id: str) -> List[MCPServerModel]:
        """获取用户的MCP服务器。"""
        return db.query(MCPServerModel).filter(
            MCPServerModel.user_id == user_id
        ).order_by(MCPServerModel.updated_at.desc()).all()

    def get_server(self, db: Session, server_id: str, user_id: str = None) -> Optional[MCPServerModel]:
        """获取MCP服务器。"""
        query = db.query(MCPServerModel).filter(MCPServerModel.id == server_id)
        if user_id:
            query = query.filter(MCPServerModel.user_id == user_id)
        return query.first()

    def update_server(
        self,
        db: Session,
        server_id: str,
        user_id: str,
        version: int = None,
        **kwargs
    ) -> Optional[MCPServerModel]:
        """更新MCP服务器配置（带乐观锁）。"""
        server = self.get_server(db, server_id, user_id)
        if not server:
            return None
        
        if version is not None and server.version != version:
            raise OptimisticLockError(
                f"Optimistic lock conflict: expected version {version}, but current version is {server.version}"
            )
        
        for key, value in kwargs.items():
            if hasattr(server, key):
                setattr(server, key, value)
        server.version = (server.version or 0) + 1
        db.commit()
        db.refresh(server)
        return server

    def delete_server(self, db: Session, server_id: str, user_id: str) -> bool:
        """删除MCP服务器。"""
        server = self.get_server(db, server_id, user_id)
        if server:
            db.delete(server)
            db.commit()
            return True
        return False

    def get_server_by_name(self, db: Session, user_id: str, name: str) -> Optional[MCPServerModel]:
        """通过名称获取服务器。"""
        return db.query(MCPServerModel).filter(
            MCPServerModel.user_id == user_id,
            MCPServerModel.name == name
        ).first()


mcp_db_manager = MCPDatabaseManager()

init_db()
