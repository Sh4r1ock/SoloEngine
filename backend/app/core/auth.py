# -*- coding: utf-8 -*-
"""JWT 认证服务。"""

import os
import json
import uuid
import logging
from typing import Dict, Optional, Any
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass, field
from pathlib import Path

try:
    import jwt
    from jwt.exceptions import InvalidTokenError
    from pwdlib import PasswordHash
    HAS_AUTH_DEPS = True
except ImportError:
    HAS_AUTH_DEPS = False
    InvalidTokenError = Exception

from app.models.auth import User, Token

logger = logging.getLogger(__name__)


class AuthService:
    """认证服务。"""

    def __init__(
        self,
        secret_key: Optional[str] = None,
        algorithm: str = "HS256",
        access_token_expire_minutes: int = 30,
        refresh_token_expire_days: int = 7,
        users_file: Optional[str] = None,
    ):
        if not HAS_AUTH_DEPS:
            logger.warning("Auth dependencies not installed. Install with: pip install pyjwt[crypto] pwdlib[argon2]")

        self.secret_key = secret_key or os.getenv("SECRET_KEY")
        if not self.secret_key:
            raise ValueError(
                "SECRET_KEY environment variable is required. "
                "Please set a secure random key in your environment. "
                "Example: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
            )
        if len(self.secret_key) < 32:
            logger.warning("SECRET_KEY is shorter than 32 characters. Consider using a longer key for production.")
        self.algorithm = algorithm
        self.access_token_expire_minutes = access_token_expire_minutes
        self.refresh_token_expire_days = refresh_token_expire_days
        
        self.users_file = Path(users_file) if users_file else Path("users.json")
        self._users: Dict[str, User] = {}
        self._load_users()

        if HAS_AUTH_DEPS:
            self.password_hash = PasswordHash.recommended()
        else:
            self.password_hash = None

    def _load_users(self):
        """加载用户数据。"""
        if self.users_file.exists():
            try:
                with open(self.users_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for user_data in data.get("users", []):
                        user = User(
                            id=user_data["id"],
                            username=user_data["username"],
                            email=user_data["email"],
                            hashed_password=user_data["hashed_password"],
                            is_active=user_data.get("is_active", True),
                            is_superuser=user_data.get("is_superuser", False),
                            created_at=user_data.get("created_at", datetime.now().isoformat()),
                            updated_at=user_data.get("updated_at", datetime.now().isoformat()),
                        )
                        self._users[user.username] = user
                        self._users[user.email] = user
            except Exception as e:
                logger.error(f"Failed to load users: {e}")

    def _save_users(self):
        """保存用户数据。"""
        unique_users = {}
        for user in self._users.values():
            if user.id not in unique_users:
                unique_users[user.id] = user

        data = {
            "users": [
                {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "hashed_password": user.hashed_password,
                    "is_active": user.is_active,
                    "is_superuser": user.is_superuser,
                    "created_at": user.created_at,
                    "updated_at": user.updated_at,
                }
                for user in unique_users.values()
            ]
        }

        try:
            with open(self.users_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save users: {e}")

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """验证密码。"""
        if self.password_hash:
            return self.password_hash.verify(plain_password, hashed_password)
        return plain_password == hashed_password

    def hash_password(self, password: str) -> str:
        """哈希密码。"""
        if self.password_hash:
            return self.password_hash.hash(password)
        return password

    def create_access_token(
        self,
        user_id: str,
        expires_delta: Optional[timedelta] = None,
    ) -> str:
        """创建访问令牌。"""
        if not HAS_AUTH_DEPS:
            raise RuntimeError(
                "Auth dependencies not installed. "
                "Install with: pip install pyjwt[crypto] pwdlib[argon2]"
            )

        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=self.access_token_expire_minutes)

        to_encode = {
            "sub": user_id,
            "exp": expire,
            "type": "access",
        }
        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def create_refresh_token(
        self,
        user_id: str,
        expires_delta: Optional[timedelta] = None,
    ) -> str:
        """创建刷新令牌。"""
        if not HAS_AUTH_DEPS:
            raise RuntimeError(
                "Auth dependencies not installed. "
                "Install with: pip install pyjwt[crypto] pwdlib[argon2]"
            )

        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(days=self.refresh_token_expire_days)

        to_encode = {
            "sub": user_id,
            "exp": expire,
            "type": "refresh",
        }
        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def decode_token(self, token: str) -> Optional[Dict[str, Any]]:
        """解码令牌。"""
        if not HAS_AUTH_DEPS:
            raise RuntimeError(
                "Auth dependencies not installed. "
                "Install with: pip install pyjwt[crypto] pwdlib[argon2]"
            )

        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            return payload
        except InvalidTokenError as e:
            logger.error(f"Failed to decode token: {e}")
            return None

    async def register_user(
        self,
        username: str,
        email: str,
        password: str,
        is_superuser: bool = False,
    ) -> User:
        """注册用户。"""
        if username in self._users:
            raise ValueError(f"Username '{username}' already exists")
        if email in self._users:
            raise ValueError(f"Email '{email}' already exists")

        user_id = str(uuid.uuid4())
        hashed_password = self.hash_password(password)

        user = User(
            id=user_id,
            username=username,
            email=email,
            hashed_password=hashed_password,
            is_superuser=is_superuser,
        )

        self._users[username] = user
        self._users[email] = user
        self._save_users()

        logger.info(f"Registered user: {username}")
        return user

    async def authenticate_user(
        self,
        username: str,
        password: str,
    ) -> Optional[User]:
        """验证用户。"""
        user = self._users.get(username)
        if not user:
            return None

        if not self.verify_password(password, user.hashed_password):
            return None

        if not user.is_active:
            return None

        return user

    async def login(self, username: str, password: str) -> Optional[Token]:
        """用户登录。"""
        user = await self.authenticate_user(username, password)
        if not user:
            return None

        access_token = self.create_access_token(user.id)
        refresh_token = self.create_refresh_token(user.id)

        return Token(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=self.access_token_expire_minutes * 60,
        )

    async def refresh_token(self, refresh_token: str) -> Optional[Token]:
        """刷新令牌。"""
        payload = self.decode_token(refresh_token)
        if not payload:
            return None

        if payload.get("type") != "refresh":
            return None

        user_id = payload.get("sub")
        if not user_id:
            return None

        user = None
        for u in self._users.values():
            if u.id == user_id:
                user = u
                break

        if not user or not user.is_active:
            return None

        new_access_token = self.create_access_token(user.id)
        new_refresh_token = self.create_refresh_token(user.id)

        return Token(
            access_token=new_access_token,
            refresh_token=new_refresh_token,
            token_type="bearer",
            expires_in=self.access_token_expire_minutes * 60,
        )

    async def get_user(self, user_id: str) -> Optional[User]:
        """获取用户。"""
        for user in self._users.values():
            if user.id == user_id:
                return user
        return None

    async def get_user_by_username(self, username: str) -> Optional[User]:
        """通过用户名获取用户。"""
        return self._users.get(username)

    async def update_user(
        self,
        user_id: str,
        email: Optional[str] = None,
        password: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> Optional[User]:
        """更新用户。"""
        user = await self.get_user(user_id)
        if not user:
            return None

        if email:
            user.email = email
        if password:
            user.hashed_password = self.hash_password(password)
        if is_active is not None:
            user.is_active = is_active

        user.updated_at = datetime.now().isoformat()
        self._save_users()

        return user

    async def delete_user(self, user_id: str) -> bool:
        """删除用户。"""
        user = await self.get_user(user_id)
        if not user:
            return False

        if user.username in self._users:
            del self._users[user.username]
        if user.email in self._users:
            del self._users[user.email]

        self._save_users()
        return True

    async def list_users(self) -> list:
        """列出用户。"""
        unique_users = {}
        for user in self._users.values():
            if user.id not in unique_users:
                unique_users[user.id] = user
        return list(unique_users.values())


auth_service = AuthService()
