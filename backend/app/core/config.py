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
    """
    应用配置类
    
    职责:
        - 集中管理所有应用配置
        - 支持环境变量覆盖
        - 提供默认值和类型验证
    
    属性:
        SECRET_KEY (str): JWT密钥
        ENCRYPTION_KEY (Optional[str]): 加密密钥
        SYSTEM_USERNAME (str): 系统用户名
        SYSTEM_PASSWORD (str): 系统密码
        BACKEND_PORT (int): 后端端口
        FRONTEND_PORT (int): 前端端口
        DATABASE_PATH (str): 数据库路径
        JWT_ALGORITHM (str): JWT算法
        JWT_ACCESS_TOKEN_EXPIRE_MINUTES (int): JWT访问令牌过期时间（分钟）
        JWT_REFRESH_TOKEN_EXPIRE_DAYS (int): JWT刷新令牌过期时间（天）
        SKILLS_ROOT_DIR (str): Skills根目录
        MAX_DEBUG_SESSIONS (int): 最大调试会话数
        DEBUG_SESSION_TIMEOUT (int): 调试会话超时时间（秒）
        MAX_EXECUTOR_INSTANCES (int): 最大执行器实例数
        EXECUTOR_INSTANCE_TIMEOUT (int): 执行器实例超时时间（秒）
        RUN_SESSION_TIMEOUT (int): 运行会话超时时间（秒）
        COMPILED_FLOW_CACHE_TIMEOUT (int): 编译Flow缓存超时时间（秒）
        RATE_LIMIT_LOGIN (str): 登录速率限制
        RATE_LIMIT_REGISTER (str): 注册速率限制
        API_REQUEST_TIMEOUT (int): API请求超时时间（毫秒）
        MAX_FILE_UPLOAD_SIZE (int): 最大文件上传大小（字节）
        DEFAULT_MAX_ITERS (int): 默认最大迭代次数
    
    示例:
        >>> settings = Settings()
        >>> print(settings.BACKEND_PORT)
        8990
    """
    
    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-this-secret-key-in-production")
    ENCRYPTION_KEY: Optional[str] = os.getenv("ENCRYPTION_KEY")
    
    SYSTEM_USERNAME: str = os.getenv("SYSTEM_USERNAME", "system")
    SYSTEM_PASSWORD: str = os.getenv("SYSTEM_PASSWORD", "system")
    
    BACKEND_PORT: int = int(os.getenv("BACKEND_PORT", "8990"))
    FRONTEND_PORT: int = int(os.getenv("FRONTEND_PORT", "8991"))
    
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
        """Pydantic配置类"""
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """
    获取配置单例
    
    Returns:
        Settings实例
        
    Example:
        >>> settings = get_settings()
    """
    return Settings()


settings = get_settings()
