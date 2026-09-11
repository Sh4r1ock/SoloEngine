# -*- coding: utf-8 -*-
"""
SoloEngine : 数据库管理包

@package database
@description database.py 拆分后的包入口，聚合导出全部公开符号（外部 import 路径不变）

模块结构：
    - models.py         : ORM 模型 + Base/engine/SessionLocal + init_db/get_db/get_db_context
    - security.py       : EncryptionService + 密码哈希 + 乐观锁
    - db_manager.py     : DatabaseManager（通用数据访问）
    - mcp_db_manager.py : MCPDatabaseManager（MCP 服务器配置管理）
"""
import logging
from contextlib import contextmanager, asynccontextmanager
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from .models import (
    Base,
    engine,
    SessionLocal,
    DATABASE_PATH,
    UserModel,
    AgenticFlowModel,
    AgenticFlowSessionModel,
    SessionMessageModel,
    SkillsPackageModel,
    LLMConfigModel,
    RunProjectModel,
    MCPServerModel,
    MCPStdioConfigModel,
    MCPSseConfigModel,
    MCPHttpConfigModel,
    FileChangeModel,
    FileContentBlobModel,
    init_db,
    _ensure_column_exists,
    get_db,
    get_db_context,
    get_db_context_async,
)
from .security import (
    EncryptionService,
    encryption_service,
    OptimisticLockError,
    check_optimistic_lock,
    increment_version,
    hash_password,
    verify_password,
)
from .db_manager import DatabaseManager, db_manager
from .mcp_db_manager import MCPDatabaseManager, mcp_db_manager

init_db()

__all__ = [
    "Base",
    "engine",
    "SessionLocal",
    "DATABASE_PATH",
    "UserModel",
    "AgenticFlowModel",
    "AgenticFlowSessionModel",
    "SessionMessageModel",
    "SkillsPackageModel",
    "LLMConfigModel",
    "RunProjectModel",
    "MCPServerModel",
    "MCPStdioConfigModel",
    "MCPSseConfigModel",
    "MCPHttpConfigModel",
    "FileChangeModel",
    "FileContentBlobModel",
    "init_db",
    "get_db",
    "get_db_context",
    "get_db_context_async",
    "EncryptionService",
    "encryption_service",
    "OptimisticLockError",
    "check_optimistic_lock",
    "increment_version",
    "hash_password",
    "verify_password",
    "DatabaseManager",
    "db_manager",
    "MCPDatabaseManager",
    "mcp_db_manager",
]
