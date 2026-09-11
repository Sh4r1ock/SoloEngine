import os
import logging
import uuid
import hashlib
import base64
import secrets
from contextlib import contextmanager, asynccontextmanager
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional, List, Dict, Any

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False

try:
    from pwdlib import PasswordHash
    HAS_PWDLIB = True
except ImportError:
    HAS_PWDLIB = False

from sqlalchemy import create_engine, Column, String, Text, Integer, DateTime, Boolean, ForeignKey, JSON, Float, and_, or_, Index, func, PrimaryKeyConstraint, text, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, Session

from app.core.data_paths import DataPaths
from app.core.config import settings
from app.utils.timezone_utils import format_iso

logger = logging.getLogger(__name__)

Base = declarative_base()

DATABASE_PATH = settings.DATABASE_PATH
os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)

engine = create_engine(f"sqlite:///{DATABASE_PATH}", echo=False, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA temp_store=MEMORY")
    cursor.close()

class UserModel(Base):
    """用户模型。"""
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(255), nullable=False, unique=True, index=True)
    email = Column(String(255), nullable=True, unique=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
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
    canvas_data = Column(Text, nullable=True)
    is_template = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
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
    
    started_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    
    version = Column(Integer, nullable=False, default=1)

    agentic_flow = relationship("AgenticFlowModel", back_populates="sessions")
    user = relationship("UserModel", backref="sessions")
    run_project = relationship("RunProjectModel", backref="sessions")
    messages = relationship("SessionMessageModel", back_populates="session", cascade="all, delete-orphan", order_by="SessionMessageModel.message_index")


class SessionMessageModel(Base):
    """会话消息模型 - 存储会话中的对话消息。
    
    设计理念：
        一次对话只产生2条数据库记录（1条 user + 1条 assistant）
        使用 data 字段存储消息内容数组
        支持多轮推理过程：reasoning_content、tool_calls、content 可以多次出现
        parent_agent_id 用于关联 SubAgent 与 MainAgent
    """
    __tablename__ = "session_messages"
    __table_args__ = (
        PrimaryKeyConstraint('session_id', 'id', name='pk_session_messages'),
        Index('ix_session_messages_session_id', 'session_id'),
        Index('ix_session_messages_user_id', 'user_id'),
        Index('ix_session_messages_role', 'role'),
        Index('ix_session_messages_session_index', 'session_id', 'message_index'),
        Index('ix_session_messages_created_at', 'created_at'),
        Index('ix_session_messages_parent_agent_id', 'parent_agent_id'),
    )

    session_id = Column(String(36), ForeignKey("agentic_flow_sessions.id"), nullable=False, index=True, primary_key=True)
    id = Column(String(36), default=lambda: str(uuid.uuid4()), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(String(36), nullable=False, default="default", index=True)
    parent_agent_id = Column(String(36), nullable=True, index=True)
    
    role = Column(String(50), nullable=False, index=True)
    data = Column(JSON, nullable=False, default=[])
    status = Column(String(50), nullable=True, default="completed", index=True)
    error = Column(Text, nullable=True)

    message_index = Column(Integer, nullable=False)
    parent_message_id = Column(String(36), nullable=True)
    
    # token 统计：仅保留细粒度历史，总值由前端/后端从 history 求和
    token_usage_history = Column(JSON, nullable=True)
    llm_config_id = Column(String(36), nullable=True)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    
    # ★ 新增：上下文压缩标记
    is_compressed = Column(Boolean, nullable=False, default=False, index=True)
    
    timestamp = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    version = Column(Integer, nullable=False, default=1)
    
    session = relationship("AgenticFlowSessionModel", back_populates="messages")
    user = relationship("UserModel", backref="session_messages")


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
    folder_path = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    is_public = Column(Boolean, default=False)
    source = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", back_populates="skills_packages")


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
    # 完整 URL 开关：True 表示 base_url 为完整请求地址（含 /chat/completions），
    # 系统不再重复追加路径（SDK 会自动补全 /chat/completions，需剥离已存在后缀）
    is_full_url = Column(Boolean, default=False)
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, default=128000)
    max_input_tokens = Column(Integer, nullable=True)
    max_output_tokens = Column(Integer, nullable=True)
    top_p = Column(Float, default=1.0)
    frequency_penalty = Column(Float, default=0.0)
    presence_penalty = Column(Float, default=0.0)
    timeout = Column(Integer, default=60)
    # 工具调用轮次：一次 react_core 循环中 agent 允许调用 LLM API 的次数上限。
    # 作为 llm_config 默认值 → 填入画布节点 model_config → 运行时仅从 canvas_data 获取。
    max_tool_calls = Column(Integer, nullable=True)
    extra_params = Column(JSON, nullable=True)
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
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
    last_accessed_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", backref="run_projects")


def init_db():
    Base.metadata.create_all(bind=engine)
    # #14 修复：恢复 _ensure_column_exists 迁移机制
    # create_all 不会为已存在的表添加新列，旧数据库缺列会导致查询崩溃
    _ensure_column_exists(engine, 'session_messages', 'error', 'TEXT')
    _ensure_column_exists(engine, 'session_messages', 'is_compressed', 'BOOLEAN DEFAULT 0')
    _ensure_column_exists(engine, 'session_messages', 'token_usage_history', 'JSON')
    # llm_configs 表：补齐 max_input_tokens / max_output_tokens 列
    _ensure_column_exists(engine, 'llm_configs', 'max_input_tokens', 'INTEGER')
    _ensure_column_exists(engine, 'llm_configs', 'max_output_tokens', 'INTEGER')
    # llm_configs 表：补齐 is_full_url 列（完整 URL 开关）
    _ensure_column_exists(engine, 'llm_configs', 'is_full_url', 'BOOLEAN DEFAULT 0')
    # llm_configs 表：补齐 max_tool_calls 列（工具调用轮次）
    _ensure_column_exists(engine, 'llm_configs', 'max_tool_calls', 'INTEGER')
    logger.info(f"Database initialized at {DATABASE_PATH}")


def _ensure_column_exists(engine, table_name, column_name, column_type):
    with engine.connect() as conn:
        result = conn.execute(text(f"PRAGMA table_info({table_name})"))
        columns = [row[1] for row in result]
        if column_name not in columns:
            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))
            conn.commit()
            logger.info(f"Added column {column_name} to table {table_name}")


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


class MCPServerModel(Base):
    """MCP服务器配置模型（统一规范）。"""
    __tablename__ = "mcp_servers"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    transport_type = Column(String(50), nullable=False)
    source_type = Column(String(50))
    description = Column(Text)
    icon = Column(String(100))
    is_active = Column(Boolean, default=True)
    is_public = Column(Boolean, default=False)
    author = Column(String(255))
    tags = Column(JSON)
    tools = Column(JSON, default=list)
    source = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    version = Column(Integer, nullable=False, default=1)

    user = relationship("UserModel", backref="mcp_servers")
    stdio_config = relationship("MCPStdioConfigModel", back_populates="mcp_server", cascade="all, delete-orphan", uselist=False)
    sse_config = relationship("MCPSseConfigModel", back_populates="mcp_server", cascade="all, delete-orphan", uselist=False)
    http_config = relationship("MCPHttpConfigModel", back_populates="mcp_server", cascade="all, delete-orphan", uselist=False)


class MCPStdioConfigModel(Base):
    """MCP Stdio配置模型。"""
    __tablename__ = "mcp_stdio_configs"

    mcp_server_id = Column(String(36), ForeignKey("mcp_servers.id"), primary_key=True)
    command = Column(String(500))
    args = Column(JSON)
    env = Column(JSON)
    folder_path = Column(String(500))
    working_dir = Column(String(500))

    mcp_server = relationship("MCPServerModel", back_populates="stdio_config")


class MCPSseConfigModel(Base):
    """MCP SSE配置模型。"""
    __tablename__ = "mcp_sse_configs"

    mcp_server_id = Column(String(36), ForeignKey("mcp_servers.id"), primary_key=True)
    url = Column(String(500), nullable=False)
    headers = Column(JSON)
    timeout = Column(Integer, default=30)
    reconnect = Column(Boolean, default=True)
    sse_endpoint = Column(String(255), default="/sse")
    retry_interval = Column(Integer, default=5)
    max_retries = Column(Integer, default=3)

    mcp_server = relationship("MCPServerModel", back_populates="sse_config")


class MCPHttpConfigModel(Base):
    """MCP HTTP配置模型。"""
    __tablename__ = "mcp_http_configs"

    mcp_server_id = Column(String(36), ForeignKey("mcp_servers.id"), primary_key=True)
    url = Column(String(500), nullable=False)
    headers = Column(JSON)
    timeout = Column(Integer, default=30)
    session_id = Column(String(100))

    mcp_server = relationship("MCPServerModel", back_populates="http_config")


class FileContentBlobModel(Base):
    """文件内容 Blob 模型（内容寻址存储）。"""
    __tablename__ = "file_content_blobs"

    content_hash = Column(String(64), primary_key=True)
    content = Column(Text, nullable=True)
    is_large_file = Column(Boolean, default=False)
    file_size = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))


class FileChangeModel(Base):
    """文件变更记录模型。"""
    __tablename__ = "file_changes"
    __table_args__ = (
        Index('idx_file_changes_session_message', 'session_id', 'message_id'),
        Index('idx_file_changes_file_path', 'file_path'),
        Index('idx_file_changes_session_agent', 'session_id', 'agent_id'),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("agentic_flow_sessions.id"), nullable=False, index=True)
    message_id = Column(String(36), ForeignKey("session_messages.id"), nullable=False, index=True)
    agent_id = Column(String(36), nullable=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    file_path = Column(String(500), nullable=False)
    operation = Column(String(20), nullable=False)
    tool_call_id = Column(String(100), nullable=True, index=True)
    content_type = Column(String(20), default="text")
    before_content_hash = Column(String(64), nullable=True)
    after_content_hash = Column(String(64), nullable=True)

    diff_data = Column(JSON, nullable=True)

    lines_added = Column(Integer, default=0)
    lines_removed = Column(Integer, default=0)

    status = Column(String(20), default="pending")

    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)), onupdate=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)))

    session = relationship("AgenticFlowSessionModel", backref="file_changes")
    message = relationship("SessionMessageModel", backref="file_changes")
    user = relationship("UserModel", backref="file_changes")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "session_id": self.session_id,
            "message_id": self.message_id,
            "agent_id": self.agent_id,
            "file_path": self.file_path,
            "operation": self.operation,
            "tool_call_id": self.tool_call_id,
            "content_type": self.content_type,
            "before_content_hash": self.before_content_hash,
            "after_content_hash": self.after_content_hash,
            "diff_data": self.diff_data,
            "lines_added": self.lines_added,
            "lines_removed": self.lines_removed,
            "status": self.status,
            "created_at": format_iso(self.created_at),
        }
