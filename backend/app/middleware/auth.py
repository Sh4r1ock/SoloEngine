# -*- coding: utf-8 -*-
"""认证中间件。"""

from typing import Optional
from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware
import time

from app.core.auth import auth_service


security = HTTPBearer(auto_error=False)


async def get_current_user(request: Request) -> Optional[dict]:
    """获取当前用户。"""
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None
    
    try:
        scheme, token = auth_header.split()
        if scheme.lower() != "bearer":
            return None
        
        payload = auth_service.decode_token(token)
        if not payload:
            return None
        
        user_id = payload.get("sub")
        if not user_id:
            return None
        
        user = await auth_service.get_user(user_id)
        if user:
            return {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_active": user.is_active,
                "is_superuser": user.is_superuser,
            }
        return None
    except Exception:
        return None


class AuthMiddleware(BaseHTTPMiddleware):
    """认证中间件。"""
    
    PUBLIC_PATHS = [
        "/",
        "/docs",
        "/openapi.json",
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/auth/refresh",
        "/api/v1/health",
        "/api/v1/ws",
    ]
    
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        
        if any(path.startswith(public) for public in self.PUBLIC_PATHS):
            return await call_next(request)
        
        user = await get_current_user(request)
        
        if user:
            request.state.user = user
        
        response = await call_next(request)
        return response


def require_auth(request: Request) -> dict:
    """要求认证装饰器。"""
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未认证",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_superuser(request: Request) -> dict:
    """要求超级用户装饰器。"""
    user = require_auth(request)
    if not user.get("is_superuser"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="权限不足",
        )
    return user
