# -*- coding: utf-8 -*-
"""
SoloEngine : 系统用户管理模块

@file system_user.py
@description 系统用户管理 - 创建和管理系统用户
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 创建系统用户
    - 检查用户是否为系统用户
    - 管理系统用户凭证

依赖:
    - os: 操作系统接口
    - sqlalchemy.orm: ORM会话
    - datetime: 时间处理
    - app.core.database: 数据库模型

使用示例:
    - from app.core.system_user import create_system_user, is_system_user
    - system_user = create_system_user(db_session)
    - is_system = is_system_user(user_id)
"""

from sqlalchemy.orm import Session
from app.core.database import UserModel, hash_password
from app.core.config import settings
from datetime import datetime
from zoneinfo import ZoneInfo

SYSTEM_USER_ID = "system"

DEFAULT_SYSTEM_USERNAME = settings.SYSTEM_USERNAME

DEFAULT_SYSTEM_PASSWORD = settings.SYSTEM_PASSWORD


def create_system_user(db: Session) -> UserModel:
    """
    创建系统用户（如果不存在）
    
    Args:
        db: 数据库会话
        
    Returns:
        系统用户模型实例
        
    Example:
        >>> system_user = create_system_user(db_session)
    """
    existing = db.query(UserModel).filter(UserModel.id == SYSTEM_USER_ID).first()
    if existing:
        return existing
    
    hashed_password = hash_password(DEFAULT_SYSTEM_PASSWORD)
    system_user = UserModel(
        id=SYSTEM_USER_ID,
        username=DEFAULT_SYSTEM_USERNAME,
        hashed_password=hashed_password,
        is_active=True,
        created_at=datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)),
        updated_at=datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
    )
    db.add(system_user)
    db.commit()
    db.refresh(system_user)
    return system_user


def is_system_user(user_id: str) -> bool:
    """
    检查是否是系统用户
    
    Args:
        user_id: 用户ID
        
    Returns:
        是否为系统用户
        
    Example:
        >>> is_system = is_system_user("system")
        True
    """
    return user_id == SYSTEM_USER_ID
