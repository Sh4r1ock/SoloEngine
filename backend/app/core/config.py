# -*- coding: utf-8 -*-
"""
SoloEngine : 统一配置管理模块

@file config.py
@description 配置管理 - 集中管理所有应用配置
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 统一配置管理
    - 环境变量支持
    - 默认值设置
    - 类型验证

依赖:
    - os: 操作系统接口
    - typing: 类型注解支持
    - pydantic_settings: 配置验证
    - functools: 函数工具

使用示例:
    - from app.core.config import settings
    - port = settings.BACKEND_PORT
"""

import os
from typing import Optional
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-this-secret-key-in-production")
    ENCRYPTION_KEY: Optional[str] = os.getenv("ENCRYPTION_KEY")

    SYSTEM_USERNAME: str = os.getenv("SYSTEM_USERNAME", "system")
    SYSTEM_PASSWORD: str = os.getenv("SYSTEM_PASSWORD", "system")

    BACKEND_PORT: int = int(os.getenv("BACKEND_PORT", "8990"))
    FRONTEND_PORT: int = int(os.getenv("FRONTEND_PORT", "8991"))

    DEFAULT_TIMEZONE: str = os.getenv("DEFAULT_TIMEZONE", "UTC")

    DATABASE_PATH: str = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "data", "database", "soloengine.db"
    )

    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    SKILLS_ROOT_DIR: str = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "data", "skills"
    )

    MAX_DEBUG_SESSIONS: int = 100
    DEBUG_SESSION_TIMEOUT: int = 3600

    MAX_EXECUTOR_INSTANCES: int = 100
    EXECUTOR_INSTANCE_TIMEOUT: int = 3600

    RUN_SESSION_TIMEOUT: int = 1800
    COMPILED_FLOW_CACHE_TIMEOUT: int = int(os.getenv("COMPILED_FLOW_CACHE_TIMEOUT", "1800"))

    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_REGISTER: str = "5/hour"

    API_REQUEST_TIMEOUT: int = 30000

    MAX_FILE_UPLOAD_SIZE: int = 50 * 1024 * 1024

    DEFAULT_MAX_ITERS: int = int(os.getenv("MAX_ITERATIONS", "10"))

    COMPILED_FLOW_MAX_INSTANCES: int = int(os.getenv("COMPILED_FLOW_MAX_INSTANCES", "50"))
    COMPILED_FLOW_CLEANUP_INTERVAL: int = int(os.getenv("COMPILED_FLOW_CLEANUP_INTERVAL", "300"))
    MAX_CONSECUTIVE_ERRORS: int = int(os.getenv("MAX_CONSECUTIVE_ERRORS", "5"))
    RETURN_INTERMEDIATE_STEPS: bool = os.getenv("RETURN_INTERMEDIATE_STEPS", "false").lower() == "true"

    ONLYOFFICE_URL: str = os.getenv("ONLYOFFICE_URL", "http://localhost:8993")
    MCP_DEFAULT_URL: str = os.getenv("MCP_DEFAULT_URL", "http://localhost:8080")

    OLLAMA_REQUEST_TIMEOUT: int = int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "300"))
    TTS_REQUEST_TIMEOUT: int = int(os.getenv("TTS_REQUEST_TIMEOUT", "60"))
    MCP_CONNECT_TIMEOUT: int = int(os.getenv("MCP_CONNECT_TIMEOUT", "30"))
    MCP_CALL_TIMEOUT: int = int(os.getenv("MCP_CALL_TIMEOUT", "60"))
    MCP_MAX_RETRIES: int = int(os.getenv("MCP_MAX_RETRIES", "3"))
    NETWORK_TOOL_TIMEOUT: int = int(os.getenv("NETWORK_TOOL_TIMEOUT", "30"))
    COMMAND_DEFAULT_TIMEOUT_MS: int = int(os.getenv("COMMAND_DEFAULT_TIMEOUT_MS", "30000"))
    COMMAND_MAX_TIMEOUT_MS: int = int(os.getenv("COMMAND_MAX_TIMEOUT_MS", "600000"))
    AGENT_TOOL_TIMEOUT: int = int(os.getenv("AGENT_TOOL_TIMEOUT", "300"))
    CACHE_MAX_SIZE: int = int(os.getenv("CACHE_MAX_SIZE", "500"))
    CACHE_DEFAULT_TTL: int = int(os.getenv("CACHE_DEFAULT_TTL", "300"))
    WEBSOCKET_CLEANUP_INTERVAL: int = int(os.getenv("WEBSOCKET_CLEANUP_INTERVAL", "60"))
    VECTOR_MEMORY_MAX_SIZE: int = int(os.getenv("VECTOR_MEMORY_MAX_SIZE", "1000"))
    VECTOR_MEMORY_SIMILARITY_THRESHOLD: float = float(os.getenv("VECTOR_MEMORY_SIMILARITY_THRESHOLD", "0.7"))
    CHUNK_SIZE: int = int(os.getenv("CHUNK_SIZE", "500"))
    CHUNK_OVERLAP: int = int(os.getenv("CHUNK_OVERLAP", "50"))
    TOKEN_COUNTER_TIMEOUT: int = int(os.getenv("TOKEN_COUNTER_TIMEOUT", "10"))
    # LLM 流式响应 stall 超时（秒）：两次 chunk 之间超过该时间视为流停滞
    # （LLM 服务发送响应头后停止发送数据、连接未关闭）。此前无 stall 保护，
    # `__anext__()` 永久阻塞导致 cancel_event 检查不可达，暂停/停止无法中断
    # LLM 调用（实测 subagent resume 流停滞 408s）。60s 远超正常 chunk 间隔。
    STREAM_STALL_TIMEOUT: int = int(os.getenv("STREAM_STALL_TIMEOUT", "60"))
    WEBSOCKET_TASK_CANCEL_TIMEOUT: float = float(os.getenv("WEBSOCKET_TASK_CANCEL_TIMEOUT", "5.0"))
    WEBSOCKET_GRACE_PERIOD_SECONDS: int = int(os.getenv("WEBSOCKET_GRACE_PERIOD_SECONDS", "15"))
    WEBSOCKET_STREAM_QUEUE_TIMEOUT: float = float(os.getenv("WEBSOCKET_STREAM_QUEUE_TIMEOUT", "1.0"))
    TOOL_REGISTRY_REQUEST_TIMEOUT: int = int(os.getenv("TOOL_REGISTRY_REQUEST_TIMEOUT", "30"))
    PLAYWRIGHT_PAGE_TIMEOUT: int = int(os.getenv("PLAYWRIGHT_PAGE_TIMEOUT", "30000"))
    COMMAND_TERMINATE_TIMEOUT: int = int(os.getenv("COMMAND_TERMINATE_TIMEOUT", "5"))
    MCP_RETRY_DELAY: float = float(os.getenv("MCP_RETRY_DELAY", "1.0"))
    SEARCH_TOOL_TIMEOUT: int = int(os.getenv("SEARCH_TOOL_TIMEOUT", "15"))
    GREP_TOOL_TIMEOUT: int = int(os.getenv("GREP_TOOL_TIMEOUT", "60"))
    GREP_MAX_FILES: int = int(os.getenv("GREP_MAX_FILES", "1000"))
    # GetDiagnostics 工具：单次扫描的最大文件数限制（防止超大工作区卡死）
    DIAGNOSTICS_MAX_FILES: int = int(os.getenv("DIAGNOSTICS_MAX_FILES", "200"))
    # 交互类工具（AskUserQuestion/ExitPlanMode）等待用户响应的超时时间（秒）
    INTERACTION_TIMEOUT: int = int(os.getenv("INTERACTION_TIMEOUT", "300"))
    WEB_FETCH_MAX_CONTENT_LENGTH: int = int(os.getenv("WEB_FETCH_MAX_CONTENT_LENGTH", "10000"))
    TOOL_REGISTRY_BODY_TRUNCATE: int = int(os.getenv("TOOL_REGISTRY_BODY_TRUNCATE", "5000"))
    WEBSOCKET_ERROR_BACKOFF_BASE: float = float(os.getenv("WEBSOCKET_ERROR_BACKOFF_BASE", "0.1"))
    WEBSOCKET_ERROR_BACKOFF_MAX_CONSECUTIVE: int = int(os.getenv("WEBSOCKET_ERROR_BACKOFF_MAX_CONSECUTIVE", "3"))
    MCP_SERVICE_KEEPALIVE_INTERVAL: int = int(os.getenv("MCP_SERVICE_KEEPALIVE_INTERVAL", "3600"))
    EMBEDDING_BATCH_SIZE: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "2048"))
    EMBEDDING_MAX_TOKENS_PER_BATCH: int = int(os.getenv("EMBEDDING_MAX_TOKENS_PER_BATCH", "8191"))
    # ===== Embedding 服务配置（SearchCodebase 语义搜索 / 向量记忆 / RAG 统一使用） =====
    # 默认指向本机 Ollama（无需 API Key）：provider=ollama, model=bge-m3（1024 维）。
    # 使用 OpenAI 时：provider=openai, model=text-embedding-3-small, dimensions=1536,
    # 并配置 EMBEDDING_API_KEY（或数据库 LLM 配置中对应密钥）。
    EMBEDDING_PROVIDER: str = os.getenv("EMBEDDING_PROVIDER", "ollama")
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "bge-m3")
    EMBEDDING_DIMENSIONS: int = int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))
    EMBEDDING_BASE_URL: Optional[str] = os.getenv("EMBEDDING_BASE_URL", "http://localhost:11434")
    EMBEDDING_API_KEY: Optional[str] = os.getenv("EMBEDDING_API_KEY")

    MCP_FILE_PATH_PARAMS: str = os.getenv(
        "MCP_FILE_PATH_PARAMS",
        "path,file_path,filePath,filepath,source_path,target_path,output_path,destination,notebook_path,image_path,document_path,directory,dir_path,folder_path"
    )

    # ===== 搜索引擎配置 =====
    SEARCH_ENGINE: str = os.getenv("SEARCH_ENGINE", "bing")
    TAVILY_API_KEY: Optional[str] = os.getenv("TAVILY_API_KEY")
    SERPER_API_KEY: Optional[str] = os.getenv("SERPER_API_KEY")

    class Config:
        """Pydantic配置类"""
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
