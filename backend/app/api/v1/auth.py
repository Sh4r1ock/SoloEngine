# -*- coding: utf-8 -*-
"""
认证 API endpoints。

@file auth.py
@description 认证接口 - 用户认证相关API端点
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 用户登录认证接口，验证用户名密码，返回JWT令牌
- 用户注册接口，创建新用户账户
- 获取当前用户信息接口，需要JWT认证
- 用户登出接口，清除用户会话
- 令牌刷新接口

使用场景：
- 用户身份验证和会话管理
- 用户账户管理

注意事项：
- 登录成功后会返回JWT令牌
- 需要妥善处理令牌的存储和刷新
- 超级用户权限操作需要管理员身份
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Header, Request
from pydantic import BaseModel, EmailStr, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.auth import auth_service, User
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

limiter = Limiter(key_func=get_remote_address)


class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)


class UserLogin(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    is_active: bool
    is_superuser: bool


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(None, min_length=6)
    is_active: Optional[bool] = None


async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    """获取当前用户。"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization[7:]
    payload = auth_service.decode_token(token)

    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = await auth_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    if not user.is_active:
        raise HTTPException(status_code=401, detail="User is inactive")

    return user


async def get_current_superuser(current_user: User = Depends(get_current_user)) -> User:
    """获取当前超级用户。"""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return current_user


@router.post("/register")
@limiter.limit(settings.RATE_LIMIT_REGISTER)
async def register(request: Request, user_data: UserRegister):
    """注册新用户。"""
    try:
        user = await auth_service.register_user(
            username=user_data.username,
            email=user_data.email,
            password=user_data.password,
        )
        return {
            "code": 200,
            "message": "User registered successfully",
            "data": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_active": user.is_active,
                "is_superuser": user.is_superuser,
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login")
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def login(request: Request, credentials: UserLogin):
    """用户登录。"""
    token = await auth_service.login(
        username=credentials.username,
        password=credentials.password,
    )

    if not token:
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    return {
        "code": 200,
        "message": "Login successful",
        "data": {
            "access_token": token.access_token,
            "refresh_token": token.refresh_token,
            "token_type": token.token_type,
            "expires_in": token.expires_in,
        }
    }


@router.post("/refresh")
async def refresh_token(request: RefreshRequest):
    """刷新令牌。"""
    token = await auth_service.refresh_token(request.refresh_token)

    if not token:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    return {
        "code": 200,
        "message": "Token refreshed",
        "data": {
            "access_token": token.access_token,
            "refresh_token": token.refresh_token,
            "token_type": token.token_type,
            "expires_in": token.expires_in,
        }
    }


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息。"""
    return {
        "code": 200,
        "message": "User info retrieved",
        "data": {
            "id": current_user.id,
            "username": current_user.username,
            "email": current_user.email,
            "is_active": current_user.is_active,
            "is_superuser": current_user.is_superuser,
        }
    }


@router.put("/me")
async def update_me(
    update_data: UserUpdate,
    current_user: User = Depends(get_current_user),
):
    """更新当前用户信息。"""
    user = await auth_service.update_user(
        user_id=current_user.id,
        email=update_data.email,
        password=update_data.password,
    )

    if not user:
        raise HTTPException(status_code=500, detail="Failed to update user")

    return {
        "code": 200,
        "message": "User updated",
        "data": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "is_active": user.is_active,
            "is_superuser": user.is_superuser,
        }
    }


@router.get("/users")
async def list_users(current_user: User = Depends(get_current_superuser)):
    """列出所有用户（仅超级用户）。"""
    users = await auth_service.list_users()
    return {
        "code": 200,
        "message": "Users retrieved",
        "data": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_active": user.is_active,
                "is_superuser": user.is_superuser,
            }
            for user in users
        ]
    }


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: User = Depends(get_current_superuser),
):
    """删除用户（仅超级用户）。"""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    success = await auth_service.delete_user(user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "code": 200,
        "message": "User deleted",
        "data": {"user_id": user_id}
    }
