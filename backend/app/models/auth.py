# -*- coding: utf-8 -*-
"""
SoloEngine : 用户/角色数据模型模块

@file auth.py
@description 用户/角色数据模型定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义用户认证相关的数据模型，包括：
    - 用户角色枚举
    - 用户数据模型
    - 角色数据模型
    - 令牌数据模型
    - 令牌数据载荷

依赖:
    - typing: 类型注解支持
    - dataclasses: 数据类支持
    - datetime: 日期时间处理
    - enum: 枚举类型支持

使用示例:
    - from app.models.auth import User, UserRole
    - user = User(id="1", username="test", email="test@example.com", hashed_password="***")
    - role = UserRole.ADMIN
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.config import settings
from enum import Enum


class UserRole(Enum):
    """用户角色。"""
    USER = "user"
    ADMIN = "admin"
    SUPERUSER = "superuser"


@dataclass
class User:
    """用户定义。"""
    id: str
    username: str
    email: str
    hashed_password: str
    is_active: bool = True
    is_superuser: bool = False
    roles: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    last_login: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "hashed_password": "***",
            "is_active": self.is_active,
            "is_superuser": self.is_superuser,
            "roles": self.roles,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_login": self.last_login,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "User":
        return cls(
            id=data["id"],
            username=data["username"],
            email=data["email"],
            hashed_password=data.get("hashed_password", ""),
            is_active=data.get("is_active", True),
            is_superuser=data.get("is_superuser", False),
            roles=data.get("roles", []),
            created_at=data.get("created_at", datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()),
            updated_at=data.get("updated_at", datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()),
            last_login=data.get("last_login"),
        )


@dataclass
class Role:
    """角色定义。"""
    id: str
    name: str
    description: str = ""
    permissions: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "permissions": self.permissions,
            "created_at": self.created_at,
        }


@dataclass
class Token:
    """令牌定义。"""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 3600
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "token_type": self.token_type,
            "expires_in": self.expires_in,
        }


@dataclass
class TokenData:
    """令牌数据。"""
    user_id: str
    username: str
    exp: int
    type: str = "access"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "exp": self.exp,
            "type": self.type,
        }
