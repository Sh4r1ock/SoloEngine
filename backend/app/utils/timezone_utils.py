# -*- coding: utf-8 -*-
"""
时区管理工具模块。

@file timezone_utils.py
@description 统一的时区管理工具，支持用户自定义时区设置
@author SoloEngine Team
@date 2026-03-08

功能描述：
- 统一的时间获取方法
- 时区转换功能
- 用户时区设置管理
- 时间格式化工具
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional, List
import logging

logger = logging.getLogger(__name__)


class TimezoneManager:
    """时区管理器。
    
    提供统一的时间处理方法，支持用户自定义时区。
    所有时间在数据库中以 UTC 存储，显示时转换为用户时区。
    """
    
    _user_timezone: str = "Asia/Shanghai"
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    @classmethod
    def set_user_timezone(cls, tz: str) -> bool:
        """设置用户时区。
        
        Args:
            tz: IANA 时区名称，如 'Asia/Shanghai', 'America/New_York'
            
        Returns:
            是否设置成功
        """
        try:
            ZoneInfo(tz)
            cls._user_timezone = tz
            logger.info(f"User timezone set to: {tz}")
            return True
        except Exception as e:
            logger.error(f"Invalid timezone: {tz}, error: {e}")
            return False
    
    @classmethod
    def get_user_timezone(cls) -> str:
        """获取当前用户时区。"""
        return cls._user_timezone
    
    @classmethod
    def now_utc(cls) -> datetime:
        """获取当前 UTC 时间（带时区信息）。
        
        Returns:
            带时区信息的 UTC 时间
        """
        return datetime.now(timezone.utc)
    
    @classmethod
    def now_user(cls) -> datetime:
        """获取当前用户时区时间。
        
        Returns:
            用户时区的当前时间
        """
        return datetime.now(ZoneInfo(cls._user_timezone))
    
    @classmethod
    def to_utc(cls, dt: datetime) -> datetime:
        """将时间转换为 UTC 时间。
        
        Args:
            dt: 任意时区的时间
            
        Returns:
            UTC 时间
        """
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    
    @classmethod
    def to_user_timezone(cls, dt: datetime) -> datetime:
        """将时间转换为用户时区时间。
        
        Args:
            dt: 任意时区的时间，如果无时区信息则假定为 UTC
            
        Returns:
            用户时区的时间
        """
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(ZoneInfo(cls._user_timezone))
    
    @classmethod
    def format_for_user(cls, dt: datetime, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
        """格式化时间为用户时区的字符串。
        
        Args:
            dt: 任意时区的时间
            fmt: 格式化字符串
            
        Returns:
            格式化后的时间字符串
        """
        if dt is None:
            return ""
        user_dt = cls.to_user_timezone(dt)
        return user_dt.strftime(fmt)
    
    @classmethod
    def format_iso(cls, dt: datetime) -> str:
        """格式化为 ISO 8601 格式。
        
        Args:
            dt: 任意时区的时间
            
        Returns:
            ISO 8601 格式的时间字符串
        """
        if dt is None:
            return ""
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    
    @classmethod
    def parse_iso(cls, iso_string: str) -> Optional[datetime]:
        """解析 ISO 8601 格式的时间字符串。
        
        Args:
            iso_string: ISO 8601 格式的时间字符串
            
        Returns:
            解析后的 datetime 对象
        """
        if not iso_string:
            return None
        try:
            return datetime.fromisoformat(iso_string.replace('Z', '+00:00'))
        except Exception as e:
            logger.error(f"Failed to parse ISO time: {iso_string}, error: {e}")
            return None
    
    @classmethod
    def get_available_timezones(cls) -> List[str]:
        """获取所有可用的时区列表。
        
        Returns:
            时区名称列表
        """
        from zoneinfo import available_timezones
        return sorted(available_timezones())
    
    @classmethod
    def get_common_timezones(cls) -> List[str]:
        """获取常用时区列表。
        
        Returns:
            常用时区名称列表
        """
        return [
            "Asia/Shanghai",
            "Asia/Hong_Kong",
            "Asia/Tokyo",
            "Asia/Seoul",
            "Asia/Singapore",
            "Asia/Dubai",
            "Europe/London",
            "Europe/Paris",
            "Europe/Berlin",
            "Europe/Moscow",
            "America/New_York",
            "America/Chicago",
            "America/Denver",
            "America/Los_Angeles",
            "America/Sao_Paulo",
            "Australia/Sydney",
            "Pacific/Auckland",
            "UTC",
        ]


def utc_now() -> datetime:
    """获取当前 UTC 时间的便捷函数。
    
    Returns:
        带 UTC 时区信息的当前时间
    """
    return TimezoneManager.now_utc()


def user_now() -> datetime:
    """获取当前用户时区时间的便捷函数。
    
    Returns:
        用户时区的当前时间
    """
    return TimezoneManager.now_user()


def format_datetime(dt: datetime, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """格式化时间为用户时区的便捷函数。
    
    Args:
        dt: 任意时区的时间
        fmt: 格式化字符串
        
    Returns:
        格式化后的时间字符串
    """
    return TimezoneManager.format_for_user(dt, fmt)


timezone_manager = TimezoneManager()
