# -*- coding: utf-8 -*-
"""
SQLite 数据库管理模块。

@file database.py
@description 数据库管理 - SQLite数据库连接和模型定义
@author SoloEngine Team
@date 2026-02-19

功能描述：
- SQLite数据库连接管理
- ORM模型定义
- 数据库初始化和迁移
- 长期存储支持
- 用户数据隔离

使用场景：
- Agent长期记忆存储
- 执行历史持久化
- 项目数据存储
- 用户管理
"""

import os
import json
import logging
import uuid
import hashlib
import base64
import secrets
from contextlib import contextmanager, asynccontextmanager
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pathlib import Path

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.backends import default_backend
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False

try:
    from pwdlib import PasswordHash
    HAS_PWDLIB = True
except ImportError:
    HAS_PWDLIB = False

from sqlalchemy import create_engine, Column, String, Text, Integer, DateTime, Boolean, ForeignKey, JSON, Float, and_, or_, Index, func, PrimaryKeyConstraint, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, Session

from app.core.data_paths import DataPaths

logger = logging.getLogger(__name__)

Base = declarative_base()

DATABASE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "database", "soloengine.db")
os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)

engine = create_engine(f"sqlite:///{DATABASE_PATH}", echo=False, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class UserModel(Base):
    """用户模型。"""
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(255), nullable=False, unique=True, index=True)
    email = Column(String(255), nullable=True, unique=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    last_login = Column(DateTime, nullable=True)
    version = Column(Integer, nullable=False, default=1)

    agentic_flows = relationship("AgenticFlowModel", back_populates="user", cascade="all, delete-orphan")
    skills_packages = relationship("SkillsPackageModel", back_populates="user", cascade="all, delete-orphan")


class AgenticFlowModel(Base):
    """AgenticFlow 模型。"""
    __tablename__ = "agentic_flows"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(100), nullable=True)
    folder_path = Column(String(500), nullable=True)
    is_template = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", back_populates="agentic_flows")
    sessions = relationship("AgenticFlowSessionModel", back_populates="agentic_flow", cascade="all, delete-orphan")


class AgenticFlowSessionModel(Base):
    """会话模型 - 存储会话元数据（状态、时间、统计）。
    
    设计理念：
        会话是用户与AI的一次完整对话流程，包含多轮对话消息。
        会话元数据包括状态、时间戳、token统计等。
    """
    __tablename__ = "agentic_flow_sessions"
    __table_args__ = (
        Index('ix_sessions_user_id', 'user_id'),
        Index('ix_sessions_agentic_flow_id', 'agentic_flow_id'),
        Index('ix_sessions_status', 'status'),
        Index('ix_sessions_created_at', 'created_at'),
        Index('ix_sessions_user_status', 'user_id', 'status'),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agentic_flow_id = Column(String(36), ForeignKey("agentic_flows.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    run_project_id = Column(String(36), ForeignKey("run_projects.id"), nullable=False, index=True)
    
    status = Column(String(50), nullable=False, default="pending", index=True)
    error = Column(Text, nullable=True)
    
    token_usage = Column(JSON, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    version = Column(Integer, nullable=False, default=1)

    agentic_flow = relationship("AgenticFlowModel", back_populates="sessions")
    user = relationship("UserModel", backref="sessions")
    run_project = relationship("RunProjectModel", backref="sessions")
    messages = relationship("SessionMessageModel", back_populates="session", cascade="all, delete-orphan", order_by="SessionMessageModel.message_index")
    steps = relationship("ExecutionStepModel", back_populates="session", cascade="all, delete-orphan")
    tool_calls = relationship("ToolCallRecordModel", back_populates="session", cascade="all, delete-orphan")


class AgentModel(Base):
    """Agent 数据模型（保留用于兼容）。"""
    __tablename__ = "agents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    agentic_flow_id = Column(String(36), ForeignKey("agentic_flows.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    agent_type = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    config = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    is_active = Column(Boolean, default=True)
    version = Column(Integer, nullable=False, default=1)


class SessionMessageModel(Base):
    """会话消息模型 - 存储会话中的对话消息。
    
    设计理念：
        一次对话只产生2条数据库记录（1条 user + 1条 assistant）
        使用 data 字段存储消息内容数组
        支持多轮推理过程：reasoning_content、tool_calls、content 可以多次出现
    """
    __tablename__ = "session_messages"
    __table_args__ = (
        PrimaryKeyConstraint('session_id', 'id', name='pk_session_messages'),
        Index('ix_session_messages_session_id', 'session_id'),
        Index('ix_session_messages_user_id', 'user_id'),
        Index('ix_session_messages_role', 'role'),
        Index('ix_session_messages_session_index', 'session_id', 'message_index'),
        Index('ix_session_messages_created_at', 'created_at'),
    )

    session_id = Column(String(36), ForeignKey("agentic_flow_sessions.id"), nullable=False, index=True, primary_key=True)
    id = Column(String(36), default=lambda: str(uuid.uuid4()), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(String(36), nullable=False, default="default", index=True)
    
    role = Column(String(50), nullable=False, index=True)
    data = Column(JSON, nullable=False, default=[])
    status = Column(String(50), nullable=True, default="completed", index=True)
    
    message_index = Column(Integer, nullable=False)
    parent_message_id = Column(String(36), nullable=True)
    
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)
    
    session = relationship("AgenticFlowSessionModel", back_populates="messages")
    user = relationship("UserModel", backref="session_messages")


class ExecutionStepModel(Base):
    """执行步骤模型。"""
    __tablename__ = "execution_steps"
    __table_args__ = (
        Index('ix_execution_steps_step_type', 'step_type'),
        Index('ix_execution_steps_session_type', 'session_id', 'step_type'),
    )

    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("agentic_flow_sessions.id"), nullable=False, index=True)
    step_type = Column(String(50), nullable=False)
    node_id = Column(String(36), nullable=True)
    node_name = Column(String(255), nullable=True)
    thought = Column(Text, nullable=True)
    action = Column(String(255), nullable=True)
    action_input = Column(JSON, nullable=True)
    observation = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)
    
    session = relationship("AgenticFlowSessionModel", back_populates="steps")


class ToolCallRecordModel(Base):
    """工具调用记录模型。"""
    __tablename__ = "tool_call_records"
    __table_args__ = (
        Index('ix_tool_call_records_tool_name', 'tool_name'),
        Index('ix_tool_call_records_session_type', 'session_id', 'tool_name'),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("agentic_flow_sessions.id"), nullable=False, index=True)
    tool_name = Column(String(255), nullable=False)
    arguments = Column(JSON, nullable=True)
    result = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)

    session = relationship("AgenticFlowSessionModel", back_populates="tool_calls")


class SkillsPackageModel(Base):
    """Skills包模型。
    
    系统skill和用户skill共用此表：
    - author='system': 系统skill，folder_path指向 data/system_skills/{skill_name}
    - author=用户名: 用户skill，folder_path指向 data/skills/{user_id}/{skill_name}
    """
    __tablename__ = "skills_packages"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    pkg_version = Column(String(50), nullable=False, default="1.0.0")
    description = Column(Text, nullable=True)
    icon = Column(String(100), nullable=True)
    author = Column(String(255), nullable=False, default="system", index=True)
    tags = Column(JSON, nullable=True)
    instructions = Column(Text, nullable=True)
    folder_path = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    is_public = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", back_populates="skills_packages")


class ProjectModel(Base):
    """项目数据模型。"""
    __tablename__ = "projects"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    canvas_data = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", backref="projects")


class LLMConfigModel(Base):
    """LLM模型配置表。"""
    __tablename__ = "llm_configs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    provider = Column(String(50), nullable=False)
    model_name = Column(String(255), nullable=False)
    api_key = Column(Text, nullable=True)
    base_url = Column(String(500), nullable=True)
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, default=2048)
    top_p = Column(Float, default=1.0)
    frequency_penalty = Column(Float, default=0.0)
    presence_penalty = Column(Float, default=0.0)
    timeout = Column(Integer, default=60)
    extra_params = Column(JSON, nullable=True)
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", backref="llm_configs")


class RunProjectModel(Base):
    """运行项目模型 - 用于运行场景的项目管理。"""
    __tablename__ = "run_projects"
    __table_args__ = (
        Index('ix_run_projects_user_active', 'user_id', 'is_active'),
        Index('ix_run_projects_user_flow', 'user_id', 'agentic_flow_id'),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    agentic_flow_id = Column(String(36), ForeignKey("agentic_flows.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    folder_path = Column(String(1000), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    last_accessed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", backref="run_projects")
    agentic_flow = relationship("AgenticFlowModel", backref="run_projects")


class RecentProjectModel(Base):
    """最近访问项目记录模型。"""
    __tablename__ = "recent_projects"
    __table_args__ = (
        Index('ix_recent_projects_user_accessed', 'user_id', 'accessed_at'),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    project_id = Column(String(36), ForeignKey("run_projects.id"), nullable=False, index=True)
    folder_path = Column(String(1000), nullable=False)
    project_name = Column(String(255), nullable=False)
    accessed_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", backref="recent_projects")
    project = relationship("RunProjectModel", backref="recent_records")


class MCPServerModel(Base):
    """MCP服务器配置模型。"""
    __tablename__ = "mcp_servers"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
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
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", backref="mcp_servers")


def init_db():
    """初始化数据库。"""
    Base.metadata.create_all(bind=engine)
    logger.info(f"Database initialized at {DATABASE_PATH}")


def get_db() -> Session:
    """获取数据库会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_context():
    """获取数据库会话的上下文管理器。
    
    用于非 FastAPI 依赖注入场景，确保会话自动关闭。
    
    Example:
        with get_db_context() as db:
            user = db.query(UserModel).first()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@asynccontextmanager
async def get_db_context_async():
    """获取数据库会话的异步上下文管理器。
    
    用于异步函数中，确保会话自动关闭。
    
    Example:
        async with get_db_context_async() as db:
            user = db.query(UserModel).first()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_pwd_context = None


def _get_pwd_context():
    """获取密码上下文。"""
    global _pwd_context
    if _pwd_context is None:
        if HAS_PWDLIB:
            _pwd_context = PasswordHash.recommended()
        else:
            _pwd_context = None
    return _pwd_context


def hash_password(password: str) -> str:
    """使用 Argon2 哈希密码。"""
    pwd_context = _get_pwd_context()
    if pwd_context:
        return pwd_context.hash(password)
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码。"""
    pwd_context = _get_pwd_context()
    if pwd_context:
        try:
            return pwd_context.verify(plain_password, hashed_password)
        except Exception:
            pass
    return hash_password(plain_password) == hashed_password


class EncryptionService:
    """API密钥加密服务。"""

    def __init__(self):
        self._key = self._get_or_create_key()
        self._aesgcm = AESGCM(self._key) if HAS_CRYPTOGRAPHY and self._key else None

    def _get_or_create_key(self) -> Optional[bytes]:
        """获取或创建加密密钥。"""
        key_env = os.getenv("ENCRYPTION_KEY")
        if key_env:
            try:
                return base64.urlsafe_b64decode(key_env)
            except Exception:
                pass
        
        key_file = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", ".encryption_key")
        os.makedirs(os.path.dirname(key_file), exist_ok=True)
        
        if os.path.exists(key_file):
            try:
                with open(key_file, "rb") as f:
                    return f.read()
            except Exception:
                pass
        
        if HAS_CRYPTOGRAPHY:
            key = secrets.token_bytes(32)
            try:
                with open(key_file, "wb") as f:
                    f.write(key)
                os.chmod(key_file, 0o600)
                return key
            except Exception:
                pass
        
        return None

    def encrypt(self, plaintext: str) -> str:
        """加密数据。"""
        if not self._aesgcm or not plaintext:
            return plaintext
        
        try:
            nonce = secrets.token_bytes(12)
            ciphertext = self._aesgcm.encrypt(nonce, plaintext.encode(), None)
            return base64.urlsafe_b64encode(nonce + ciphertext).decode()
        except Exception:
            return plaintext

    def decrypt(self, ciphertext: str) -> str:
        """解密数据。"""
        if not self._aesgcm or not ciphertext:
            return ciphertext
        
        try:
            data = base64.urlsafe_b64decode(ciphertext)
            nonce = data[:12]
            actual_ciphertext = data[12:]
            return self._aesgcm.decrypt(nonce, actual_ciphertext, None).decode()
        except Exception:
            return ciphertext


encryption_service = EncryptionService()


class OptimisticLockError(Exception):
    """乐观锁冲突异常。"""
    pass


class DatabaseManager:
    """数据库管理器。"""

    def __init__(self):
        self.engine = engine
        self.SessionLocal = SessionLocal

    def create_user(self, db: Session, username: str, email: str, password: str, 
                    is_superuser: bool = False) -> UserModel:
        """创建用户。"""
        user = UserModel(
            username=username,
            email=email,
            hashed_password=hash_password(password),
            is_superuser=is_superuser,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def get_user_by_username(self, db: Session, username: str) -> Optional[UserModel]:
        """通过用户名获取用户。"""
        return db.query(UserModel).filter(UserModel.username == username).first()

    def get_user_by_id(self, db: Session, user_id: str) -> Optional[UserModel]:
        """通过ID获取用户。"""
        return db.query(UserModel).filter(UserModel.id == user_id).first()

    def authenticate_user(self, db: Session, username: str, password: str) -> Optional[UserModel]:
        """验证用户。"""
        user = self.get_user_by_username(db, username)
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        user.last_login = datetime.now(timezone.utc)
        db.commit()
        return user

    def create_agentic_flow(self, db: Session, user_id: str, name: str, 
                            description: str = None, folder_path: str = None, icon: str = None) -> AgenticFlowModel:
        """创建AgenticFlow。"""
        # 转换为相对路径
        rel_folder_path = DataPaths.to_relative_path(folder_path) if folder_path else None
        
        flow = AgenticFlowModel(
            user_id=user_id,
            name=name,
            description=description,
            folder_path=rel_folder_path,
            icon=icon,
        )
        db.add(flow)
        db.commit()
        db.refresh(flow)
        
        # 返回时转换为绝对路径
        if flow.folder_path:
            flow.folder_path = DataPaths.to_absolute_path(flow.folder_path)
        
        return flow

    def get_agentic_flows(self, db: Session, user_id: str) -> List[AgenticFlowModel]:
        """获取用户的所有AgenticFlow。"""
        flows = db.query(AgenticFlowModel).filter(
            AgenticFlowModel.user_id == user_id,
            AgenticFlowModel.is_active == True
        ).order_by(AgenticFlowModel.created_at.desc()).all()
        
        # 转换为绝对路径
        for flow in flows:
            if flow.folder_path:
                flow.folder_path = DataPaths.to_absolute_path(flow.folder_path)
        
        return flows

    def get_agentic_flow(self, db: Session, agentic_flow_id: str, user_id: str = None) -> Optional[AgenticFlowModel]:
        """获取AgenticFlow。"""
        query = db.query(AgenticFlowModel).filter(AgenticFlowModel.id == agentic_flow_id)
        if user_id:
            query = query.filter(AgenticFlowModel.user_id == user_id)
        flow = query.first()
        
        # 转换为绝对路径
        if flow and flow.folder_path:
            flow.folder_path = DataPaths.to_absolute_path(flow.folder_path)
        
        return flow

    def update_agentic_flow(self, db: Session, agentic_flow_id: str, user_id: str, 
                            version: int = None, **kwargs) -> Optional[AgenticFlowModel]:
        """更新AgenticFlow（带乐观锁）。"""
        # 直接查询数据库，不使用get_agentic_flow，避免路径转换干扰
        query = db.query(AgenticFlowModel).filter(AgenticFlowModel.id == agentic_flow_id)
        if user_id:
            query = query.filter(AgenticFlowModel.user_id == user_id)
        flow = query.first()
        
        if not flow:
            return None
        
        if version is not None and flow.version != version:
            raise OptimisticLockError(
                f"Optimistic lock conflict: expected version {version}, but current version is {flow.version}"
            )
        
        for key, value in kwargs.items():
            if key == 'folder_path' and value:
                # 转换为相对路径
                value = DataPaths.to_relative_path(value)
            
            if hasattr(flow, key):
                setattr(flow, key, value)
        
        flow.version = (flow.version or 0) + 1
        db.commit()
        db.refresh(flow)
        
        # 返回时转换为绝对路径
        if flow.folder_path:
            flow.folder_path = DataPaths.to_absolute_path(flow.folder_path)
        
        return flow

    def delete_agentic_flow(self, db: Session, agentic_flow_id: str, user_id: str) -> bool:
        """删除AgenticFlow。"""
        flow = self.get_agentic_flow(db, agentic_flow_id, user_id)
        if flow:
            flow.is_active = False
            db.commit()
            return True
        return False

    def create_session(self, db: Session, agentic_flow_id: str, user_id: str,
                       run_project_id: str = None) -> AgenticFlowSessionModel:
        """创建会话记录。"""
        session = AgenticFlowSessionModel(
            agentic_flow_id=agentic_flow_id,
            user_id=user_id,
            run_project_id=run_project_id,
            status="pending",
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    def update_session(self, db: Session, session_id: str, version: int = None,
                       **kwargs) -> Optional[AgenticFlowSessionModel]:
        """更新会话记录（带乐观锁）。"""
        session = db.query(AgenticFlowSessionModel).filter(
            AgenticFlowSessionModel.id == session_id
        ).first()
        if not session:
            return None
        
        if version is not None and session.version != version:
            raise OptimisticLockError(
                f"Optimistic lock conflict: expected version {version}, but current version is {session.version}"
            )
        
        for key, value in kwargs.items():
            if hasattr(session, key):
                setattr(session, key, value)
        session.version = (session.version or 0) + 1
        session.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(session)
        return session

    def get_session(self, db: Session, session_id: str) -> Optional[AgenticFlowSessionModel]:
        """获取单个会话记录。"""
        return db.query(AgenticFlowSessionModel).filter(
            AgenticFlowSessionModel.id == session_id
        ).first()

    def get_sessions(self, db: Session, agentic_flow_id: str = None, user_id: str = None,
                     status: str = None, limit: int = 100) -> List[AgenticFlowSessionModel]:
        """获取会话记录。"""
        query = db.query(AgenticFlowSessionModel)
        if agentic_flow_id:
            query = query.filter(AgenticFlowSessionModel.agentic_flow_id == agentic_flow_id)
        if user_id:
            query = query.filter(AgenticFlowSessionModel.user_id == user_id)
        if status:
            query = query.filter(AgenticFlowSessionModel.status == status)
        return query.order_by(AgenticFlowSessionModel.updated_at.desc()).limit(limit).all()

    def add_session_message(self, db: Session, session_id: str, user_id: str,
                            role: str, data: dict = None, agent_id: str = "default",
                            parent_message_id: str = None,
                            prompt_tokens: int = None, completion_tokens: int = None,
                            total_tokens: int = None,
                            status: str = "completed") -> SessionMessageModel:
        """添加会话消息。"""
        if not agent_id:
            agent_id = "default"
        
        max_index = db.query(func.max(SessionMessageModel.message_index)).filter(
            SessionMessageModel.session_id == session_id
        ).scalar()
        if max_index is None:
            max_index = -1
        
        message = SessionMessageModel(
            session_id=session_id,
            user_id=user_id,
            agent_id=agent_id,
            role=role,
            data=data,
            status=status,
            message_index=max_index + 1,
            parent_message_id=parent_message_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            timestamp=datetime.now(timezone.utc),
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    def get_session_messages(self, db: Session, session_id: str,
                             limit: int = None, offset: int = 0) -> List[SessionMessageModel]:
        """获取会话消息列表。"""
        query = db.query(SessionMessageModel).filter(
            SessionMessageModel.session_id == session_id
        ).order_by(SessionMessageModel.message_index)
        if offset:
            query = query.offset(offset)
        if limit:
            query = query.limit(limit)
        return query.all()
    
    def get_session_messages_by_agent(self, db: Session, session_id: str,
                                       agent_id: str = None) -> List[SessionMessageModel]:
        """获取会话消息列表，按 agent_id 分组返回。"""
        query = db.query(SessionMessageModel).filter(
            SessionMessageModel.session_id == session_id
        )
        if agent_id:
            query = query.filter(SessionMessageModel.agent_id == agent_id)
        return query.order_by(SessionMessageModel.message_index).all()

    def update_session_token_usage(self, db: Session, session_id: str,
                                   prompt_tokens: int = 0, completion_tokens: int = 0) -> Optional[AgenticFlowSessionModel]:
        """更新会话 token 统计。"""
        session = self.get_session(db, session_id)
        if not session:
            return None
        
        current_usage = session.token_usage or {}
        current_usage["prompt_tokens"] = current_usage.get("prompt_tokens", 0) + prompt_tokens
        current_usage["completion_tokens"] = current_usage.get("completion_tokens", 0) + completion_tokens
        current_usage["total_tokens"] = current_usage.get("total_tokens", 0) + prompt_tokens + completion_tokens
        
        session.token_usage = current_usage
        session.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(session)
        return session

    def create_skills_package(self, db: Session, user_id: str, name: str, 
                              description: str = None, folder_path: str = None,
                              pkg_version: str = "1.0.0", author: str = None, 
                              tags: List[str] = None, icon: str = None) -> SkillsPackageModel:
        """创建Skills包。"""
        # 转换为相对路径
        rel_folder_path = DataPaths.to_relative_path(folder_path) if folder_path else None
        
        package = SkillsPackageModel(
            user_id=user_id,
            name=name,
            description=description,
            folder_path=rel_folder_path,
            pkg_version=pkg_version,
            author=author,
            tags=tags or [],
            icon=icon,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(package)
        db.commit()
        db.refresh(package)
        
        # 返回时转换为绝对路径
        if package.folder_path:
            package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        return package

    def get_skills_packages(self, db: Session, user_id: str) -> List[SkillsPackageModel]:
        """获取用户的Skills包（包括停用和启用的）。"""
        packages = db.query(SkillsPackageModel).filter(
            SkillsPackageModel.user_id == user_id
        ).order_by(SkillsPackageModel.created_at.desc()).all()
        
        # 转换为绝对路径
        for package in packages:
            if package.folder_path:
                package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        return packages

    def get_skills_package(self, db: Session, package_id: str, user_id: str = None) -> Optional[SkillsPackageModel]:
        """获取Skills包。"""
        query = db.query(SkillsPackageModel).filter(SkillsPackageModel.id == package_id)
        if user_id:
            # 查找用户自己的skill或系统skill
            query = query.filter(
                or_(
                    SkillsPackageModel.user_id == user_id,
                    SkillsPackageModel.user_id == "system"
                )
            )
        package = query.first()
        
        # 转换为绝对路径
        if package and package.folder_path:
            package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        return package

    def update_skills_package(self, db: Session, package_id: str, user_id: str,
                              version: int = None, **kwargs) -> Optional[SkillsPackageModel]:
        """更新Skills包（带乐观锁）。"""
        # 直接查询数据库，不使用get_skills_package，避免路径转换干扰
        query = db.query(SkillsPackageModel).filter(SkillsPackageModel.id == package_id)
        if user_id:
            query = query.filter(SkillsPackageModel.user_id == user_id)
        package = query.first()
        
        if not package:
            return None
        
        if version is not None and package.version != version:
            raise OptimisticLockError(
                f"Optimistic lock conflict: expected version {version}, but current version is {package.version}"
            )
        
        for key, value in kwargs.items():
            if key == 'folder_path' and value:
                # 转换为相对路径
                value = DataPaths.to_relative_path(value)
            
            if hasattr(package, key):
                setattr(package, key, value)
        
        package.version = (package.version or 0) + 1
        db.commit()
        db.refresh(package)
        
        # 返回时转换为绝对路径
        if package.folder_path:
            package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        return package

    def delete_skills_package(self, db: Session, package_id: str, user_id: str) -> bool:
        """删除Skills包（物理删除）。"""
        package = self.get_skills_package(db, package_id, user_id)
        if package:
            db.delete(package)
            db.commit()
            return True
        return False

    def create_llm_config(self, db: Session, user_id: str, name: str, provider: str,
                          model_name: str, api_key: str = None, base_url: str = None,
                          temperature: float = 0.7, max_tokens: int = 2048,
                          top_p: float = 1.0, frequency_penalty: float = 0.0,
                          presence_penalty: float = 0.0, timeout: int = 60,
                          extra_params: Dict = None, is_default: bool = False) -> LLMConfigModel:
        """创建LLM配置。"""
        if is_default:
            db.query(LLMConfigModel).filter(
                and_(LLMConfigModel.user_id == user_id, LLMConfigModel.is_default == True)
            ).update({"is_default": False})
        
        encrypted_api_key = encryption_service.encrypt(api_key) if api_key else None
        
        config = LLMConfigModel(
            user_id=user_id,
            name=name,
            provider=provider,
            model_name=model_name,
            api_key=encrypted_api_key,
            base_url=base_url,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
            timeout=timeout,
            extra_params=extra_params or {},
            is_default=is_default,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    def get_llm_configs(self, db: Session, user_id: str) -> List[LLMConfigModel]:
        """获取用户的所有LLM配置。"""
        return db.query(LLMConfigModel).filter(
            LLMConfigModel.user_id == user_id,
            LLMConfigModel.is_active == True
        ).order_by(LLMConfigModel.is_default.desc(), LLMConfigModel.updated_at.desc()).all()

    def get_llm_config(self, db: Session, config_id: str, user_id: str = None) -> Optional[LLMConfigModel]:
        """获取指定的LLM配置。"""
        query = db.query(LLMConfigModel).filter(LLMConfigModel.id == config_id)
        if user_id:
            query = query.filter(LLMConfigModel.user_id == user_id)
        return query.first()

    def get_default_llm_config(self, db: Session, user_id: str) -> Optional[LLMConfigModel]:
        """获取用户的默认LLM配置。"""
        return db.query(LLMConfigModel).filter(
            and_(LLMConfigModel.user_id == user_id, LLMConfigModel.is_default == True, LLMConfigModel.is_active == True)
        ).first()

    def update_llm_config(self, db: Session, config_id: str, user_id: str,
                          version: int = None, **kwargs) -> Optional[LLMConfigModel]:
        """更新LLM配置（带乐观锁）。"""
        config = self.get_llm_config(db, config_id, user_id)
        if not config:
            return None
        
        if version is not None and config.version != version:
            raise OptimisticLockError(
                f"Optimistic lock conflict: expected version {version}, but current version is {config.version}"
            )
        
        if kwargs.get("is_default") == True:
            db.query(LLMConfigModel).filter(
                and_(LLMConfigModel.user_id == user_id, LLMConfigModel.is_default == True, LLMConfigModel.id != config_id)
            ).update({"is_default": False})
        
        if "api_key" in kwargs and kwargs["api_key"]:
            kwargs["api_key"] = encryption_service.encrypt(kwargs["api_key"])
        
        for key, value in kwargs.items():
            if hasattr(config, key) and key != "version":
                setattr(config, key, value)
        config.version = (config.version or 0) + 1
        db.commit()
        db.refresh(config)
        return config
    
    def get_decrypted_api_key(self, config: LLMConfigModel) -> Optional[str]:
        """获取解密后的API密钥。"""
        if not config or not config.api_key:
            return None
        return encryption_service.decrypt(config.api_key)

    def delete_llm_config(self, db: Session, config_id: str, user_id: str) -> bool:
        """删除LLM配置（软删除）。"""
        config = self.get_llm_config(db, config_id, user_id)
        if config:
            config.is_active = False
            db.commit()
            return True
        return False

    def get_agent(self, db: Session, agent_id: str) -> Optional[AgentModel]:
        """获取Agent。"""
        return db.query(AgentModel).filter(AgentModel.id == agent_id).first()

    def create_agent(self, db: Session, agent_id: str, name: str, agent_type: str,
                     description: str = None, config: Dict = None,
                     user_id: str = None, agentic_flow_id: str = None) -> AgentModel:
        """创建Agent。"""
        agent = AgentModel(
            id=agent_id,
            name=name,
            agent_type=agent_type,
            description=description,
            config=config,
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
        return agent

    def create_project(self, db: Session, user_id: str, name: str, 
                       description: str = None, canvas_data: Dict = None) -> ProjectModel:
        """创建项目。"""
        project = ProjectModel(
            user_id=user_id,
            name=name,
            description=description,
            canvas_data=canvas_data or {"nodes": [], "edges": []},
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        return project

    def get_projects(self, db: Session, user_id: str) -> List[ProjectModel]:
        """获取用户的所有项目。"""
        return db.query(ProjectModel).filter(
            ProjectModel.user_id == user_id,
            ProjectModel.is_active == True
        ).order_by(ProjectModel.updated_at.desc()).all()

    def get_project(self, db: Session, project_id: str, user_id: str = None) -> Optional[ProjectModel]:
        """获取项目。"""
        query = db.query(ProjectModel).filter(ProjectModel.id == project_id)
        if user_id:
            query = query.filter(ProjectModel.user_id == user_id)
        return query.first()

    def update_project(self, db: Session, project_id: str, user_id: str,
                       version: int = None, **kwargs) -> Optional[ProjectModel]:
        """更新项目（带乐观锁）。"""
        project = self.get_project(db, project_id, user_id)
        if not project:
            return None
        
        if version is not None and project.version != version:
            raise OptimisticLockError(
                f"Optimistic lock conflict: expected version {version}, but current version is {project.version}"
            )
        
        for key, value in kwargs.items():
            if hasattr(project, key) and key != "version":
                setattr(project, key, value)
        project.version = (project.version or 0) + 1
        db.commit()
        db.refresh(project)
        return project

    def delete_project(self, db: Session, project_id: str, user_id: str) -> bool:
        """删除项目（软删除）。"""
        project = self.get_project(db, project_id, user_id)
        if project:
            project.is_active = False
            db.commit()
            return True
        return False

    def create_run_project(self, db: Session, user_id: str, agentic_flow_id: str, name: str,
                           folder_path: str, description: str = None) -> RunProjectModel:
        """创建运行项目。"""
        # run_project表使用绝对路径，不做转换
        project = RunProjectModel(
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
            name=name,
            folder_path=folder_path,
            description=description,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        
        return project

    def get_run_project(self, db: Session, project_id: str, user_id: str = None) -> Optional[RunProjectModel]:
        """获取运行项目。"""
        query = db.query(RunProjectModel).filter(RunProjectModel.id == project_id)
        if user_id:
            query = query.filter(RunProjectModel.user_id == user_id)
        project = query.first()
        
        # run_project表使用绝对路径，不做转换
        return project

    def get_run_project_by_path(self, db: Session, user_id: str, agentic_flow_id: str, folder_path: str) -> Optional[RunProjectModel]:
        """通过路径获取运行项目。"""
        # run_project表使用绝对路径，直接查询
        project = db.query(RunProjectModel).filter(
            RunProjectModel.user_id == user_id,
            RunProjectModel.agentic_flow_id == agentic_flow_id,
            RunProjectModel.folder_path == folder_path,
            RunProjectModel.is_active == True
        ).first()
        
        return project

    def get_active_run_project(self, db: Session, user_id: str, agentic_flow_id: str = None) -> Optional[RunProjectModel]:
        """获取用户当前活动的运行项目。"""
        query = db.query(RunProjectModel).filter(
            RunProjectModel.user_id == user_id,
            RunProjectModel.is_active == True
        )
        if agentic_flow_id:
            query = query.filter(RunProjectModel.agentic_flow_id == agentic_flow_id)
        project = query.order_by(RunProjectModel.last_accessed_at.desc()).first()
        
        # run_project表使用绝对路径，不做转换
        return project

    def update_run_project(self, db: Session, project_id: str, user_id: str,
                           version: int = None, **kwargs) -> Optional[RunProjectModel]:
        """更新运行项目（带乐观锁）。"""
        # 直接查询数据库，不使用get_run_project，避免路径转换干扰
        query = db.query(RunProjectModel).filter(RunProjectModel.id == project_id)
        if user_id:
            query = query.filter(RunProjectModel.user_id == user_id)
        project = query.first()
        
        if not project:
            return None
        
        if version is not None and project.version != version:
            raise OptimisticLockError(
                f"Optimistic lock conflict: expected version {version}, but current version is {project.version}"
            )
        
        for key, value in kwargs.items():
            if hasattr(project, key) and key != "version":
                setattr(project, key, value)
        
        project.version = (project.version or 0) + 1
        db.commit()
        db.refresh(project)
        
        # run_project表使用绝对路径，不做转换
        return project

    def delete_run_project(self, db: Session, project_id: str, user_id: str) -> bool:
        """删除运行项目（软删除）。"""
        project = self.get_run_project(db, project_id, user_id)
        if project:
            project.is_active = False
            db.commit()
            return True
        return False

    def add_recent_project(self, db: Session, user_id: str, project_id: str,
                           folder_path: str, project_name: str) -> RecentProjectModel:
        """添加最近访问项目记录。"""
        # recent_projects表使用绝对路径，不做转换
        existing = db.query(RecentProjectModel).filter(
            RecentProjectModel.user_id == user_id,
            RecentProjectModel.project_id == project_id
        ).first()
        
        if existing:
            existing.accessed_at = datetime.now(timezone.utc)
            existing.folder_path = folder_path
            existing.project_name = project_name
            db.commit()
            db.refresh(existing)
            
            return existing
        
        recent = RecentProjectModel(
            user_id=user_id,
            project_id=project_id,
            folder_path=folder_path,
            project_name=project_name,
        )
        db.add(recent)
        db.commit()
        db.refresh(recent)
        
        self._cleanup_recent_projects(db, user_id)
        
        return recent

    def get_recent_projects(self, db: Session, user_id: str, limit: int = 10) -> List[RecentProjectModel]:
        """获取用户最近访问的项目列表。"""
        recent_projects = db.query(RecentProjectModel).filter(
            RecentProjectModel.user_id == user_id
        ).order_by(RecentProjectModel.accessed_at.desc()).limit(limit).all()
        
        # recent_projects表使用绝对路径，不做转换
        return recent_projects

    def _cleanup_recent_projects(self, db: Session, user_id: str, max_count: int = 10):
        """清理超出限制的最近项目记录。"""
        recent_projects = db.query(RecentProjectModel).filter(
            RecentProjectModel.user_id == user_id
        ).order_by(RecentProjectModel.accessed_at.desc()).all()
        
        if len(recent_projects) > max_count:
            for project in recent_projects[max_count:]:
                db.delete(project)
            db.commit()

    def get_system_skills(self, db: Session) -> List[SkillsPackageModel]:
        """获取所有系统skill（user_id='system'）。"""
        return db.query(SkillsPackageModel).filter(
            SkillsPackageModel.user_id == "system",
            SkillsPackageModel.is_active == True
        ).order_by(SkillsPackageModel.name).all()

    def get_user_skills(self, db: Session, user_id: str) -> List[SkillsPackageModel]:
        """获取用户的所有skill。"""
        return db.query(SkillsPackageModel).filter(
            SkillsPackageModel.user_id == user_id,
            SkillsPackageModel.is_active == True
        ).order_by(SkillsPackageModel.name).all()

    def get_all_skills_for_user(self, db: Session, user_id: str) -> List[SkillsPackageModel]:
        """获取用户可见的所有skill（系统skill + 用户skill）。
        
        注意：is_active只控制skill是否可用，不影响显示。
        按创建时间降序排列。
        """
        packages = db.query(SkillsPackageModel).filter(
            or_(
                SkillsPackageModel.user_id == "system",
                SkillsPackageModel.user_id == user_id
            )
        ).order_by(SkillsPackageModel.created_at.desc()).all()
        
        # 转换为绝对路径
        for package in packages:
            if package.folder_path:
                package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        return packages

    def create_system_skill(self, db: Session, name: str, folder_path: str,
                            description: str = None, tags: List[str] = None,
                            instructions: str = None, pkg_version: str = "1.0.0") -> SkillsPackageModel:
        """创建系统skill。"""
        # 转换为相对路径
        rel_folder_path = DataPaths.to_relative_path(folder_path) if folder_path else None
        
        skill = SkillsPackageModel(
            name=name,
            folder_path=rel_folder_path,
            description=description,
            user_id="system",
            tags=tags or [],
            instructions=instructions,
            pkg_version=pkg_version,
            is_public=True,
        )
        db.add(skill)
        db.commit()
        db.refresh(skill)
        
        # 返回时转换为绝对路径
        if skill.folder_path:
            skill.folder_path = DataPaths.to_absolute_path(skill.folder_path)
        
        return skill

    def create_mcp_server(self, db: Session, user_id: str, name: str, transport: str,
                         url: str = None, command: str = None, args: List[str] = None,
                         env: Dict[str, str] = None, headers: Dict[str, str] = None,
                         timeout: int = 30) -> MCPServerModel:
        """创建MCP服务器。"""
        server = MCPServerModel(
            user_id=user_id,
            name=name,
            transport=transport,
            url=url,
            command=command,
            args=args,
            env=env,
            headers=headers,
            timeout=timeout,
        )
        db.add(server)
        db.commit()
        db.refresh(server)
        return server

    def get_mcp_servers(self, db: Session, user_id: str) -> List[MCPServerModel]:
        """获取用户可见的MCP服务器（系统 + 用户）。"""
        from sqlalchemy import or_
        return db.query(MCPServerModel).filter(
            or_(
                MCPServerModel.user_id == "system",
                MCPServerModel.user_id == user_id
            )
        ).order_by(MCPServerModel.created_at.desc()).all()
    
    def get_mcp_server(self, db: Session, mcp_server_id: str, user_id: str = None) -> Optional[MCPServerModel]:
        """获取MCP服务器。"""
        query = db.query(MCPServerModel).filter(MCPServerModel.id == mcp_server_id)
        if user_id:
            query = query.filter(MCPServerModel.user_id == user_id)
        return query.first()

    def update_mcp_server(self, db: Session, mcp_server_id: str, user_id: str,
                         version: int = None, **kwargs) -> Optional[MCPServerModel]:
        """更新MCP服务器配置（带乐观锁）。"""
        query = db.query(MCPServerModel).filter(MCPServerModel.id == mcp_server_id)
        if user_id:
            query = query.filter(MCPServerModel.user_id == user_id)
        server = query.first()
        
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

    def delete_mcp_server(self, db: Session, mcp_server_id: str, user_id: str) -> bool:
        """删除MCP服务器。"""
        query = db.query(MCPServerModel).filter(MCPServerModel.id == mcp_server_id)
        if user_id:
            query = query.filter(MCPServerModel.user_id == user_id)
        server = query.first()
        
        if server:
            db.delete(server)
            db.commit()
            return True
        return False

db_manager = DatabaseManager()

init_db()
