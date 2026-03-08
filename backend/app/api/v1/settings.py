# -*- coding: utf-8 -*-
"""
时区设置 API。

@file settings.py
@description 时区和用户设置相关的 API 端点
@author SoloEngine Team
@date 2026-03-08
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import logging

from app.utils.timezone_utils import TimezoneManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


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
    """获取当前时间信息。"""
    try:
        from datetime import datetime
        from app.utils.timezone_utils import utc_now
        
        now_utc = utc_now()
        now_user = TimezoneManager.to_user_timezone(now_utc)
        
        return {
            "utc_time": now_utc.isoformat(),
            "user_time": now_user.isoformat(),
            "user_timezone": TimezoneManager.get_user_timezone(),
            "formatted_utc": TimezoneManager.format_for_user(now_utc, "%Y-%m-%d %H:%M:%S"),
            "formatted_user": TimezoneManager.format_for_user(now_user, "%Y-%m-%d %H:%M:%S"),
        }
    except Exception as e:
        logger.error(f"Failed to get current time: {e}")
        raise HTTPException(status_code=500, detail=str(e))
