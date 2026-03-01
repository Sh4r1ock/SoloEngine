# -*- coding: utf-8 -*-
"""JWT 认证服务。"""

import os
import logging
from typing import Dict, Optional, Any
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass, field

try:
    import jwt
    from jwt.exceptions import InvalidTokenError
    HAS_AUTH_DEPS = True
except ImportError:
    HAS_AUTH_DEPS = False
    InvalidTokenError = Exception

from app.models.auth import User, Token
from app.core.database import db_manager, get_db, UserModel, hash_password, verify_password

logger = logging.getLogger(__name__)


def _user_model_to_dataclass(user_model: UserModel) -> User:
    """将数据库模型转换为 dataclass。"""
    return User(
        id=user_model.id,
        username=user_model.username,
        email=user_model.email,
        hashed_password=user_model.hashed_password,
        is_active=user_model.is_active,
        is_superuser=user_model.is_superuser,
        created_at=user_model.created_at.isoformat() if user_model.created_at else "",
        updated_at=user_model.updated_at.isoformat() if user_model.updated_at else "",
        last_login=user_model.last_login.isoformat() if user_model.last_login else None,
    )


class AuthService:
    """认证服务 - 使用数据库存储用户。"""

    def __init__(
        self,
        secret_key: Optional[str] = None,
        algorithm: str = "HS256",
        access_token_expire_minutes: int = 30,
        refresh_token_expire_days: int = 7,
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
        db = next(get_db())
        try:
            existing_user = db_manager.get_user_by_username(db, username)
            if existing_user:
                raise ValueError(f"Username '{username}' already exists")
            
            existing_email = db.query(UserModel).filter(UserModel.email == email).first()
            if existing_email:
                raise ValueError(f"Email '{email}' already exists")

            user_model = db_manager.create_user(
                db,
                username=username,
                email=email,
                password=password,
                is_superuser=is_superuser,
            )
            logger.info(f"Registered user: {username}")
            return _user_model_to_dataclass(user_model)
        finally:
            db.close()

    async def authenticate_user(
        self,
        username: str,
        password: str,
    ) -> Optional[User]:
        """验证用户。"""
        db = next(get_db())
        try:
            user_model = db_manager.authenticate_user(db, username, password)
            if not user_model:
                return None
            return _user_model_to_dataclass(user_model)
        finally:
            db.close()

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

        user = await self.get_user(user_id)
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
        db = next(get_db())
        try:
            user_model = db_manager.get_user_by_id(db, user_id)
            if not user_model:
                return None
            return _user_model_to_dataclass(user_model)
        finally:
            db.close()

    async def get_user_by_username(self, username: str) -> Optional[User]:
        """通过用户名获取用户。"""
        db = next(get_db())
        try:
            user_model = db_manager.get_user_by_username(db, username)
            if not user_model:
                return None
            return _user_model_to_dataclass(user_model)
        finally:
            db.close()

    async def update_user(
        self,
        user_id: str,
        email: Optional[str] = None,
        password: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> Optional[User]:
        """更新用户。"""
        db = next(get_db())
        try:
            user_model = db_manager.get_user_by_id(db, user_id)
            if not user_model:
                return None

            if email:
                existing_email = db.query(UserModel).filter(
                    UserModel.email == email,
                    UserModel.id != user_id
                ).first()
                if existing_email:
                    raise ValueError(f"Email '{email}' already exists")
                user_model.email = email
            
            if password:
                user_model.hashed_password = hash_password(password)
            
            if is_active is not None:
                user_model.is_active = is_active

            user_model.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(user_model)
            
            return _user_model_to_dataclass(user_model)
        finally:
            db.close()

    async def delete_user(self, user_id: str) -> bool:
        """删除用户。"""
        db = next(get_db())
        try:
            user_model = db_manager.get_user_by_id(db, user_id)
            if not user_model:
                return False

            db.delete(user_model)
            db.commit()
            return True
        finally:
            db.close()

    async def list_users(self) -> list:
        """列出用户。"""
        db = next(get_db())
        try:
            users = db.query(UserModel).all()
            return [_user_model_to_dataclass(u) for u in users]
        finally:
            db.close()


auth_service = AuthService()
