# -*- coding: utf-8 -*-
"""
统一配置管理模块。

@file config.py
@description 配置管理 - 集中管理所有应用配置
@author SoloEngine Team
@date 2026-02-21

功能描述：
- 统一配置管理
- 环境变量支持
- 默认值设置
- 类型验证
"""

import os
from typing import Optional
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """应用配置。"""
    
    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-this-secret-key-in-production")
    ENCRYPTION_KEY: Optional[str] = os.getenv("ENCRYPTION_KEY")
    
    SYSTEM_USERNAME: str = os.getenv("SYSTEM_USERNAME", "system")
    SYSTEM_PASSWORD: str = os.getenv("SYSTEM_PASSWORD", "system")
    
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
    COMPILED_FLOW_CACHE_TIMEOUT: int = 1800
    
    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_REGISTER: str = "5/hour"
    
    API_REQUEST_TIMEOUT: int = 30000
    
    MAX_FILE_UPLOAD_SIZE: int = 50 * 1024 * 1024

    DEFAULT_MAX_ITERS: int = int(os.getenv("MAX_ITERATIONS", "20"))

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """获取配置单例。"""
    return Settings()


settings = get_settings()
