# -*- coding: utf-8 -*-
"""
数据库模型 - MCP服务独立数据库。
"""

import os
import uuid
import logging
from datetime import datetime
from typing import Optional, List

from sqlalchemy import create_engine, Column, String, Text, Integer, DateTime, Boolean, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship

logger = logging.getLogger(__name__)

Base = declarative_base()

DATABASE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "database")
os.makedirs(DATABASE_DIR, exist_ok=True)
DATABASE_PATH = os.path.join(DATABASE_DIR, "mcp_service.db")

engine = create_engine(f"sqlite:///{DATABASE_PATH}", echo=False, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class MCPServerModel(Base):
    """MCP服务器配置模型 - 主表"""
    __tablename__ = "mcp_servers"

    mcp_server_id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), nullable=False, index=True)
    mcp_name = Column(String(255), nullable=False)
    transport_type = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True)
    share = Column(Boolean, default=False)
    author = Column(String(255), nullable=True)
    tags = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    version = Column(Integer, nullable=False, default=1)

    stdio_config = relationship("MCPStdioConfigModel", back_populates="mcp_server", cascade="all, delete-orphan")
    sse_config = relationship("MCPSseConfigModel", uselist=False, back_populates="mcp_server", cascade="all, delete-orphan")
    http_config = relationship("MCPHttpConfigModel", uselist=False, back_populates="mcp_server", cascade="all, delete-orphan")


class MCPStdioConfigModel(Base):
    """MCP Stdio配置模型 - 子表"""
    __tablename__ = "mcp_stdio_configs"

    mcp_server_id = Column(String(36), ForeignKey("mcp_servers.mcp_server_id"), primary_key=True)
    command = Column(String(500), nullable=True)
    args = Column(JSON, nullable=True)
    env = Column(JSON, nullable=True)
    storage_path = Column(String(500), nullable=True)
    working_dir = Column(String(500), nullable=True)

    mcp_server = relationship("MCPServerModel", back_populates="stdio_config")


class MCPSseConfigModel(Base):
    """MCP SSE配置模型 - 子表"""
    __tablename__ = "mcp_sse_configs"

    mcp_server_id = Column(String(36), ForeignKey("mcp_servers.mcp_server_id"), primary_key=True)
    url = Column(String(500), nullable=False)
    headers = Column(JSON, nullable=True)
    timeout = Column(Integer, default=30)
    reconnect = Column(Boolean, default=True)
    sse_endpoint = Column(String(255), default="/sse")
    retry_interval = Column(Integer, default=5)
    max_retries = Column(Integer, default=3)

    mcp_server = relationship("MCPServerModel", back_populates="sse_config")


class MCPHttpConfigModel(Base):
    """MCP HTTP配置模型 - 子表"""
    __tablename__ = "mcp_http_configs"

    mcp_server_id = Column(String(36), ForeignKey("mcp_servers.mcp_server_id"), primary_key=True)
    url = Column(String(500), nullable=False)
    headers = Column(JSON, nullable=True)
    timeout = Column(Integer, default=30)
    session_id = Column(String(100), nullable=True)

    mcp_server = relationship("MCPServerModel", back_populates="http_config")


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
        mcp_name: str,
        transport_type: str,
        description: str = None,
        enabled: bool = True,
        share: bool = False,
        author: str = None,
        tags: List[str] = None,
    ) -> MCPServerModel:
        """创建MCP服务器配置。"""
        server = MCPServerModel(
            user_id=user_id,
            mcp_name=mcp_name,
            transport_type=transport_type,
            description=description,
            enabled=enabled,
            share=share,
            author=author,
            tags=tags or [],
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

    def get_server(self, db: Session, mcp_server_id: str, user_id: str = None) -> Optional[MCPServerModel]:
        """获取MCP服务器。"""
        query = db.query(MCPServerModel).filter(MCPServerModel.mcp_server_id == mcp_server_id)
        if user_id:
            query = query.filter(MCPServerModel.user_id == user_id)
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

    def delete_server(self, db: Session, mcp_server_id: str, user_id: str) -> bool:
        """删除MCP服务器。"""
        server = self.get_server(db, mcp_server_id, user_id)
        if server:
            db.delete(server)
            db.commit()
            return True
        return False

    def get_server_by_name(self, db: Session, user_id: str, mcp_name: str) -> Optional[MCPServerModel]:
        """通过名称获取服务器。"""
        return db.query(MCPServerModel).filter(
            MCPServerModel.user_id == user_id,
            MCPServerModel.mcp_name == mcp_name
        ).first()

    def create_stdio_config(
        self,
        db: Session,
        mcp_server_id: str,
        command: str = None,
        args: List[str] = None,
        env: dict = None,
        storage_path: str = None,
        working_dir: str = None,
    ) -> MCPStdioConfigModel:
        """创建Stdio配置。"""
        config = MCPStdioConfigModel(
            mcp_server_id=mcp_server_id,
            command=command,
            args=args or [],
            env=env or {},
            storage_path=storage_path,
            working_dir=working_dir,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    def get_stdio_config(self, db: Session, mcp_server_id: str) -> Optional[MCPStdioConfigModel]:
        """获取Stdio配置。"""
        return db.query(MCPStdioConfigModel).filter(
            MCPStdioConfigModel.mcp_server_id == mcp_server_id
        ).first()

    def update_stdio_config(self, db: Session, mcp_server_id: str, **kwargs) -> Optional[MCPStdioConfigModel]:
        """更新Stdio配置。"""
        config = self.get_stdio_config(db, mcp_server_id)
        if config:
            for key, value in kwargs.items():
                if hasattr(config, key):
                    setattr(config, key, value)
            db.commit()
            db.refresh(config)
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


mcp_db_manager = MCPDatabaseManager()

init_db()
