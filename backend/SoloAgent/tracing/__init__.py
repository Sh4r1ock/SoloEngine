# -*- coding: utf-8 -*-
"""
Tracing utilities for SoloEngine.

@file __init__.py
@description 追踪工具 - LLM调用追踪和性能监控
@author SoloEngine Team
@date 2026-02-22

功能描述：
- 提供LLM调用的追踪装饰器
- 记录调用时间、参数和结果
- 支持性能分析和调试

使用场景：
- LLM调用追踪
- 性能监控
- 调试和日志记录
"""
import time
import logging
import functools
from typing import Callable, Any, Optional, Dict
from datetime import datetime
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class TraceRecord:
    """追踪记录。"""
    function_name: str
    start_time: str
    end_time: Optional[str] = None
    duration_ms: Optional[float] = None
    args: tuple = field(default_factory=tuple)
    kwargs: dict = field(default_factory=dict)
    result: Any = None
    error: Optional[str] = None
    success: bool = True


class TraceManager:
    """追踪管理器。"""
    
    _instance: Optional['TraceManager'] = None
    _records: list = []
    _enabled: bool = True
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    @classmethod
    def enable(cls):
        """启用追踪。"""
        cls._enabled = True
    
    @classmethod
    def disable(cls):
        """禁用追踪。"""
        cls._enabled = False
    
    @classmethod
    def record(cls, record: TraceRecord):
        """记录追踪信息。"""
        if cls._enabled:
            cls._records.append(record)
            logger.debug(
                f"Trace: {record.function_name} - "
                f"{record.duration_ms:.2f}ms - "
                f"{'success' if record.success else 'failed'}"
            )
    
    @classmethod
    def get_records(cls) -> list:
        """获取所有追踪记录。"""
        return cls._records.copy()
    
    @classmethod
    def clear(cls):
        """清除追踪记录。"""
        cls._records.clear()
    
    @classmethod
    def get_statistics(cls) -> Dict[str, Any]:
        """获取追踪统计信息。"""
        if not cls._records:
            return {"total_calls": 0}
        
        total = len(cls._records)
        successful = sum(1 for r in cls._records if r.success)
        failed = total - successful
        total_duration = sum(r.duration_ms or 0 for r in cls._records)
        
        return {
            "total_calls": total,
            "successful_calls": successful,
            "failed_calls": failed,
            "total_duration_ms": total_duration,
            "average_duration_ms": total_duration / total if total > 0 else 0,
        }


def trace_llm(func: Callable) -> Callable:
    """LLM调用追踪装饰器。
    
    记录LLM调用的详细信息，包括：
    - 调用时间
    - 调用参数
    - 返回结果
    - 执行时长
    - 错误信息（如果有）
    
    Args:
        func: 被装饰的函数
        
    Returns:
        装饰后的函数
    """
    @functools.wraps(func)
    async def async_wrapper(*args, **kwargs):
        if not TraceManager._enabled:
            return await func(*args, **kwargs)
        
        record = TraceRecord(
            function_name=func.__name__,
            start_time=datetime.now().isoformat(),
            args=args,
            kwargs=kwargs,
        )
        
        try:
            result = await func(*args, **kwargs)
            record.result = result
            record.success = True
            return result
        except Exception as e:
            record.error = str(e)
            record.success = False
            raise
        finally:
            record.end_time = datetime.now().isoformat()
            record.duration_ms = (
                datetime.fromisoformat(record.end_time).timestamp() -
                datetime.fromisoformat(record.start_time).timestamp()
            ) * 1000
            TraceManager.record(record)
    
    @functools.wraps(func)
    def sync_wrapper(*args, **kwargs):
        if not TraceManager._enabled:
            return func(*args, **kwargs)
        
        record = TraceRecord(
            function_name=func.__name__,
            start_time=datetime.now().isoformat(),
            args=args,
            kwargs=kwargs,
        )
        
        try:
            result = func(*args, **kwargs)
            record.result = result
            record.success = True
            return result
        except Exception as e:
            record.error = str(e)
            record.success = False
            raise
        finally:
            record.end_time = datetime.now().isoformat()
            record.duration_ms = (
                datetime.fromisoformat(record.end_time).timestamp() -
                datetime.fromisoformat(record.start_time).timestamp()
            ) * 1000
            TraceManager.record(record)
    
    import asyncio
    if asyncio.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper


def trace_format(func: Callable) -> Callable:
    """格式化追踪装饰器。
    
    用于追踪消息格式化过程。
    
    Args:
        func: 被装饰的函数
        
    Returns:
        装饰后的函数
    """
    @functools.wraps(func)
    async def async_wrapper(*args, **kwargs):
        if not TraceManager._enabled:
            return await func(*args, **kwargs)
        
        start_time = time.time()
        try:
            result = await func(*args, **kwargs)
            duration = (time.time() - start_time) * 1000
            logger.debug(f"Format trace: {func.__name__} - {duration:.2f}ms")
            return result
        except Exception as e:
            logger.error(f"Format trace error: {func.__name__} - {e}")
            raise
    
    @functools.wraps(func)
    def sync_wrapper(*args, **kwargs):
        if not TraceManager._enabled:
            return func(*args, **kwargs)
        
        start_time = time.time()
        try:
            result = func(*args, **kwargs)
            duration = (time.time() - start_time) * 1000
            logger.debug(f"Format trace: {func.__name__} - {duration:.2f}ms")
            return result
        except Exception as e:
            logger.error(f"Format trace error: {func.__name__} - {e}")
            raise
    
    import asyncio
    if asyncio.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper


__all__ = ['trace_llm', 'trace_format', 'TraceManager', 'TraceRecord']