# -*- coding: utf-8 -*-
"""
SoloEngine : 时区设置API模块

@file settings.py
@description 时区和用户设置相关的API端点
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 获取用户时区设置
    - 更新用户时区设置
    - 获取可用时区列表
    - 获取常用时区列表

依赖:
    - fastapi: FastAPI框架
    - pydantic: 数据验证
    - typing: 类型注解支持
    - logging: 日志记录
    - app.utils.timezone_utils: 时区工具

使用示例:
    - GET /settings/timezone - 获取当前时区
    - POST /settings/timezone - 更新时区

使用场景：
    - 用户偏好设置管理
    - 时间显示本地化
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import logging

from app.utils.timezone_utils import TimezoneManager, format_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class TimezoneSetting(BaseModel):
    """时区设置请求模型。"""
    timezone: str


class TimezoneResponse(BaseModel):
    """时区响应模型。"""
    timezone: str
    success: bool = True
    message: str = ""


class TimezoneListResponse(BaseModel):
    """时区列表响应模型。"""
    timezones: List[str]
    common_timezones: List[str]


@router.get("/timezone", response_model=TimezoneResponse)
async def get_timezone():
    """获取当前用户时区设置。"""
    try:
        timezone = TimezoneManager.get_user_timezone()
        return TimezoneResponse(
            timezone=timezone,
            success=True,
            message="获取时区设置成功"
        )
    except Exception as e:
        logger.error(f"Failed to get timezone: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/timezone", response_model=TimezoneResponse)
async def set_timezone(setting: TimezoneSetting):
    """设置用户时区。
    
    Args:
        setting: 包含时区名称的请求体，如 "Asia/Shanghai"
        
    Returns:
        设置结果
    """
    try:
        success = TimezoneManager.set_user_timezone(setting.timezone)
        if success:
            return TimezoneResponse(
                timezone=setting.timezone,
                success=True,
                message="时区设置成功"
            )
        else:
            return TimezoneResponse(
                timezone=TimezoneManager.get_user_timezone(),
                success=False,
                message=f"无效的时区: {setting.timezone}"
            )
    except Exception as e:
        logger.error(f"Failed to set timezone: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/timezone/list", response_model=TimezoneListResponse)
async def list_timezones():
    """获取所有可用的时区列表。"""
    try:
        all_timezones = TimezoneManager.get_available_timezones()
        common_timezones = TimezoneManager.get_common_timezones()
        return TimezoneListResponse(
            timezones=all_timezones,
            common_timezones=common_timezones
        )
    except Exception as e:
        logger.error(f"Failed to list timezones: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/time")
async def get_current_time():
    try:
        from datetime import datetime as dt, timezone
        from zoneinfo import ZoneInfo

        now_user = TimezoneManager.now()
        now_utc = now_user.astimezone(timezone.utc)

        return {
            "utc_time": format_iso(now_utc),
            "user_time": format_iso(now_user),
            "user_timezone": TimezoneManager.get_user_timezone(),
            "formatted_utc": now_utc.strftime("%Y-%m-%d %H:%M:%S"),
            "formatted_user": now_user.strftime("%Y-%m-%d %H:%M:%S"),
        }
    except Exception as e:
        logger.error(f"Failed to get current time: {e}")
        raise HTTPException(status_code=500, detail=str(e))
