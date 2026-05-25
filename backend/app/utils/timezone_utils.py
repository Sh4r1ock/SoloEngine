# -*- coding: utf-8 -*-
"""
SoloEngine : 时区管理工具模块

@file timezone_utils.py
@description 时区管理工具 - 统一的时区管理，从 .env 配置读取时区
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 统一的时间获取方法（使用 .env 配置的 DEFAULT_TIMEZONE）
    - 时区转换功能
    - 时间格式化工具
    - ISO 8601格式解析和生成

依赖:
    - datetime: 日期时间处理
    - zoneinfo: 时区信息
    - typing: 类型注解支持
    - logging: 日志记录

设计理念：
    SoloEngine 是本地自托管单实例应用，时区由 .env 中 DEFAULT_TIMEZONE 统一控制。
    配置链路：代码 → settings.DEFAULT_TIMEZONE → config.py(os.getenv) → 根目录/.env
    所有时间使用 ZoneInfo(settings.DEFAULT_TIMEZONE) 生成，确保带时区标识符。
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional, List
import logging

logger = logging.getLogger(__name__)


class TimezoneManager:
    """时区管理器。

    提供统一的时间处理方法，时区从 .env 配置读取。
    配置链路：代码 → settings.DEFAULT_TIMEZONE → config.py(os.getenv) → 根目录/.env
    """

    _user_timezone: str = None

    @classmethod
    def _get_default_timezone(cls) -> str:
        from app.core.config import settings
        return settings.DEFAULT_TIMEZONE

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
        """获取当前用户时区。延迟初始化，首次调用时从 config 读取。"""
        if cls._user_timezone is None:
            cls._user_timezone = cls._get_default_timezone()
        return cls._user_timezone

    @classmethod
    def now(cls) -> datetime:
        """获取当前时间（带配置时区信息），替代 datetime.now() 无时区调用。

        Returns:
            带时区信息的当前时间
        """
        return datetime.now(ZoneInfo(cls.get_user_timezone()))

    @classmethod
    def timestamp(cls) -> float:
        """获取当前时间戳，替代 datetime.now().timestamp()。

        Returns:
            当前时间戳
        """
        return datetime.now(ZoneInfo(cls.get_user_timezone())).timestamp()

    @classmethod
    def format_iso_now(cls) -> str:
        """获取当前时间的 ISO 格式字符串，替代 datetime.now().isoformat()。

        Returns:
            ISO 格式的当前时间字符串（带时区标识符）
        """
        return datetime.now(ZoneInfo(cls.get_user_timezone())).isoformat()

    @classmethod
    def to_utc(cls, dt: datetime) -> datetime:
        """将时间转换为 UTC 时间。

        Args:
            dt: 任意时区的时间

        Returns:
            UTC 时间
        """
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo(cls.get_user_timezone()))
        return dt.astimezone(timezone.utc)

    @classmethod
    def to_user_timezone(cls, dt: datetime) -> datetime:
        """将时间转换为用户时区时间。

        Args:
            dt: 任意时区的时间，如果无时区信息则假定为配置时区

        Returns:
            用户时区的时间
        """
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo(cls.get_user_timezone()))
        return dt.astimezone(ZoneInfo(cls.get_user_timezone()))

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
        """格式化 datetime 为 ISO 字符串，确保带时区标识符。

        Args:
            dt: datetime 对象

        Returns:
            带时区标识符的 ISO 格式字符串
        """
        if dt is None:
            return ""
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo(cls.get_user_timezone()))
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
            "Asia/Taipei",
            "Asia/Macau",
            "Asia/Tokyo",
            "Asia/Seoul",
            "Asia/Singapore",
            "Asia/Kuala_Lumpur",
            "Asia/Manila",
            "Asia/Bangkok",
            "Asia/Jakarta",
            "Asia/Ho_Chi_Minh",
            "Asia/Kolkata",
            "Asia/Colombo",
            "Asia/Dhaka",
            "Asia/Karachi",
            "Asia/Tashkent",
            "Asia/Almaty",
            "Asia/Dubai",
            "Asia/Riyadh",
            "Asia/Tehran",
            "Asia/Baghdad",
            "Asia/Jerusalem",
            "Europe/London",
            "Europe/Dublin",
            "Europe/Lisbon",
            "Europe/Paris",
            "Europe/Brussels",
            "Europe/Amsterdam",
            "Europe/Berlin",
            "Europe/Zurich",
            "Europe/Rome",
            "Europe/Madrid",
            "Europe/Vienna",
            "Europe/Stockholm",
            "Europe/Oslo",
            "Europe/Copenhagen",
            "Europe/Helsinki",
            "Europe/Warsaw",
            "Europe/Prague",
            "Europe/Budapest",
            "Europe/Bucharest",
            "Europe/Athens",
            "Europe/Istanbul",
            "Europe/Moscow",
            "Europe/Kyiv",
            "America/New_York",
            "America/Chicago",
            "America/Denver",
            "America/Los_Angeles",
            "America/Phoenix",
            "America/Anchorage",
            "America/Toronto",
            "America/Vancouver",
            "America/Mexico_City",
            "America/Bogota",
            "America/Lima",
            "America/Sao_Paulo",
            "America/Argentina/Buenos_Aires",
            "America/Santiago",
            "Australia/Sydney",
            "Australia/Melbourne",
            "Australia/Brisbane",
            "Australia/Perth",
            "Australia/Adelaide",
            "Australia/Darwin",
            "Australia/Hobart",
            "Pacific/Auckland",
            "Pacific/Fiji",
            "Africa/Cairo",
            "Africa/Lagos",
            "Africa/Johannesburg",
            "Africa/Nairobi",
            "Africa/Casablanca",
            "UTC",
        ]


def user_now() -> datetime:
    """获取当前用户时区时间的便捷函数。

    Returns:
        用户时区的当前时间
    """
    return TimezoneManager.now()


def format_datetime(dt: datetime, fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    return TimezoneManager.format_for_user(dt, fmt)


def format_iso(dt: datetime) -> str:
    return TimezoneManager.format_iso(dt)


timezone_manager = TimezoneManager()
