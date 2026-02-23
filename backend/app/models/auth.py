# -*- coding: utf-8 -*-
"""用户/角色数据模型。"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
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
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
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
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
            last_login=data.get("last_login"),
        )


@dataclass
class Role:
    """角色定义。"""
    id: str
    name: str
    description: str = ""
    permissions: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
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
