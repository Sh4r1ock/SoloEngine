# -*- coding: utf-8 -*-
"""
SoloEngine : JWT 认证服务模块

@file auth.py
@description 提供JWT认证服务，包括用户注册、登录、令牌管理
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - JWT令牌创建和验证
    - 用户注册、登录、认证
    - 访问令牌和刷新令牌管理
    - 用户信息管理

依赖:
    - os: 操作系统接口
    - logging: 日志记录
    - typing: 类型注解支持
    - datetime: 时间处理
    - dataclasses: 数据类支持
    - jwt: JWT处理（可选依赖）
    - app.models.auth: 认证模型
    - app.core.database: 数据库管理

使用示例:
    - from app.core.auth import auth_service
    - token = await auth_service.login("username", "password")
    - user = await auth_service.get_user(user_id)
"""

import logging
from typing import Dict, Optional, Any
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

try:
    import jwt
    from jwt.exceptions import InvalidTokenError
    HAS_AUTH_DEPS = True
except ImportError:
    HAS_AUTH_DEPS = False
    InvalidTokenError = Exception

from app.models.auth import User, Token
from app.core.database import db_manager, get_db_context, UserModel, hash_password
from app.core.config import settings
from app.utils.timezone_utils import format_iso

logger = logging.getLogger(__name__)


def _user_model_to_dataclass(user_model: UserModel) -> User:
    """
    将数据库模型转换为dataclass
    
    Args:
        user_model: 数据库用户模型
        
    Returns:
        User dataclass实例
        
    Example:
        >>> user = _user_model_to_dataclass(user_model)
    """
    return User(
        id=user_model.id,
        username=user_model.username,
        email=user_model.email,
        hashed_password=user_model.hashed_password,
        is_active=user_model.is_active,
        is_superuser=user_model.is_superuser,
        created_at=format_iso(user_model.created_at),
        updated_at=format_iso(user_model.updated_at),
        last_login=format_iso(user_model.last_login),
    )


class AuthService:
    """
    认证服务类 - 使用数据库存储用户
    
    职责:
        - 管理JWT令牌的创建和验证
        - 处理用户注册、登录、认证
        - 管理访问令牌和刷新令牌
        - 提供用户信息管理功能
    
    属性:
        secret_key (str): JWT密钥
        algorithm (str): JWT算法
        access_token_expire_minutes (int): 访问令牌过期时间（分钟）
        refresh_token_expire_days (int): 刷新令牌过期时间（天）
    
    示例:
        >>> auth = AuthService()
        >>> token = auth.create_access_token("user_id")
        >>> user = await auth.authenticate_user("username", "password")
    """

    def __init__(
        self,
        secret_key: Optional[str] = None,
        algorithm: str = "HS256",
        access_token_expire_minutes: int = None,
        refresh_token_expire_days: int = None,
    ):
        """
        初始化认证服务
        
        Args:
            secret_key: JWT密钥，默认从环境变量获取
            algorithm: JWT算法，默认为HS256
            access_token_expire_minutes: 访问令牌过期时间（分钟）
            refresh_token_expire_days: 刷新令牌过期时间（天）
        """
        if not HAS_AUTH_DEPS:
            logger.warning("Auth dependencies not installed. Install with: pip install pyjwt[crypto] pwdlib[argon2]")

        self.secret_key = secret_key or settings.SECRET_KEY
        if self.secret_key == "change-this-secret-key-in-production":
            logger.warning("Using default SECRET_KEY. Please set a secure random key in production.")
        if len(self.secret_key) < 32:
            logger.warning("SECRET_KEY is shorter than 32 characters. Consider using a longer key for production.")
        self.algorithm = algorithm
        self.access_token_expire_minutes = access_token_expire_minutes or settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
        self.refresh_token_expire_days = refresh_token_expire_days or settings.JWT_REFRESH_TOKEN_EXPIRE_DAYS

    def create_access_token(
        self,
        user_id: str,
        expires_delta: Optional[timedelta] = None,
    ) -> str:
        """
        创建访问令牌
        
        Args:
            user_id: 用户ID
            expires_delta: 自定义过期时间
            
        Returns:
            JWT访问令牌字符串
            
        Raises:
            RuntimeError: 如果认证依赖未安装
            
        Example:
            >>> token = auth_service.create_access_token("user_123")
        """
        if not HAS_AUTH_DEPS:
            raise RuntimeError(
                "Auth dependencies not installed. "
                "Install with: pip install pyjwt[crypto] pwdlib[argon2]"
            )

        if expires_delta:
            expire = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) + expires_delta
        else:
            expire = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) + timedelta(minutes=self.access_token_expire_minutes)

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
        """
        创建刷新令牌
        
        Args:
            user_id: 用户ID
            expires_delta: 自定义过期时间
            
        Returns:
            JWT刷新令牌字符串
            
        Raises:
            RuntimeError: 如果认证依赖未安装
            
        Example:
            >>> token = auth_service.create_refresh_token("user_123")
        """
        if not HAS_AUTH_DEPS:
            raise RuntimeError(
                "Auth dependencies not installed. "
                "Install with: pip install pyjwt[crypto] pwdlib[argon2]"
            )

        if expires_delta:
            expire = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) + expires_delta
        else:
            expire = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)) + timedelta(days=self.refresh_token_expire_days)

        to_encode = {
            "sub": user_id,
            "exp": expire,
            "type": "refresh",
        }
        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def decode_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        解码令牌
        
        Args:
            token: JWT令牌字符串
            
        Returns:
            令牌payload字典，如果解码失败则返回None
            
        Raises:
            RuntimeError: 如果认证依赖未安装
            
        Example:
            >>> payload = auth_service.decode_token(token)
        """
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

    async def verify_access_token(self, token: str) -> tuple[bool, Optional[str]]:
        """
        验证 access token 完整性（用于 WebSocket 等无法走 Depends 的场景）

        包含 4 项检查（与 v0.3.0.1 websocket.py verify_token 一致）：
        1. token 非空
        2. decode_token 成功
        3. payload.get("type") == "access"（拒绝 refresh token）
        4. get_user(user_id) 用户存在且 is_active

        Args:
            token: JWT 令牌字符串

        Returns:
            (valid, user_id) 元组：valid=True 且 user_id 为用户 ID 时通过
        """
        if not token:
            return False, None
        payload = self.decode_token(token)
        if not payload or payload.get("type") != "access":
            return False, None
        user_id = payload.get("sub")
        if not user_id:
            return False, None
        user = await self.get_user(user_id)
        if user is None or not user.is_active:
            return False, None
        return True, user_id

    async def register_user(
        self,
        username: str,
        email: str,
        password: str,
        is_superuser: bool = False,
    ) -> User:
        """
        注册用户
        
        Args:
            username: 用户名
            email: 邮箱地址
            password: 密码
            is_superuser: 是否为超级用户
            
        Returns:
            新创建的用户对象
            
        Raises:
            ValueError: 如果用户名或邮箱已存在
            
        Example:
            >>> user = await auth_service.register_user("john", "john@example.com", "password123")
        """
        with get_db_context() as db:
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

    async def authenticate_user(
        self,
        username: str,
        password: str,
    ) -> Optional[User]:
        """
        验证用户
        
        Args:
            username: 用户名
            password: 密码
            
        Returns:
            用户对象，如果验证失败则返回None
            
        Example:
            >>> user = await auth_service.authenticate_user("john", "password123")
        """
        with get_db_context() as db:
            user_model = db_manager.authenticate_user(db, username, password)
            if not user_model:
                return None
            return _user_model_to_dataclass(user_model)

    async def login(self, username: str, password: str) -> Optional[Token]:
        """
        用户登录
        
        Args:
            username: 用户名
            password: 密码
            
        Returns:
            Token对象，如果登录失败则返回None
            
        Example:
            >>> token = await auth_service.login("john", "password123")
        """
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
        """
        刷新令牌
        
        Args:
            refresh_token: 刷新令牌字符串
            
        Returns:
            新的Token对象，如果刷新失败则返回None
            
        Example:
            >>> new_token = await auth_service.refresh_token(refresh_token)
        """
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
        """
        获取用户
        
        Args:
            user_id: 用户ID
            
        Returns:
            用户对象，如果不存在则返回None
            
        Example:
            >>> user = await auth_service.get_user("user_123")
        """
        with get_db_context() as db:
            user_model = db_manager.get_user_by_id(db, user_id)
            if not user_model:
                return None
            return _user_model_to_dataclass(user_model)

    async def get_user_by_username(self, username: str) -> Optional[User]:
        """
        通过用户名获取用户
        
        Args:
            username: 用户名
            
        Returns:
            用户对象，如果不存在则返回None
            
        Example:
            >>> user = await auth_service.get_user_by_username("john")
        """
        with get_db_context() as db:
            user_model = db_manager.get_user_by_username(db, username)
            if not user_model:
                return None
            return _user_model_to_dataclass(user_model)

    async def update_user(
        self,
        user_id: str,
        email: Optional[str] = None,
        password: Optional[str] = None,
        is_active: Optional[bool] = None,
    ) -> Optional[User]:
        """
        更新用户
        
        Args:
            user_id: 用户ID
            email: 新邮箱地址（可选）
            password: 新密码（可选）
            is_active: 是否激活（可选）
            
        Returns:
            更新后的用户对象，如果用户不存在则返回None
            
        Raises:
            ValueError: 如果邮箱已被其他用户使用
            
        Example:
            >>> user = await auth_service.update_user("user_123", email="new@example.com")
        """
        with get_db_context() as db:
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

            user_model.updated_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            db.commit()
            db.refresh(user_model)
            
            return _user_model_to_dataclass(user_model)

    async def delete_user(self, user_id: str) -> bool:
        """
        删除用户
        
        Args:
            user_id: 用户ID
            
        Returns:
            是否成功删除
            
        Example:
            >>> success = await auth_service.delete_user("user_123")
        """
        with get_db_context() as db:
            user_model = db_manager.get_user_by_id(db, user_id)
            if not user_model:
                return False

            db.delete(user_model)
            db.commit()
            return True

    async def list_users(self) -> list:
        """
        列出所有用户
        
        Returns:
            用户对象列表
            
        Example:
            >>> users = await auth_service.list_users()
        """
        with get_db_context() as db:
            users = db.query(UserModel).all()
            return [_user_model_to_dataclass(u) for u in users]


auth_service = AuthService()
