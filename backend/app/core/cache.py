# -*- coding: utf-8 -*-
"""
SoloEngine : 缓存管理器模块

@file cache.py
@description 后端缓存和性能优化模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 内存缓存装饰器
    - TTL过期机制
    - LRU缓存策略
    - 缓存统计
    - 查询优化器

依赖:
    - time: 时间处理
    - functools: 函数工具
    - threading: 线程锁
    - typing: 类型注解支持
    - collections.OrderedDict: 有序字典
    - logging: 日志记录

使用示例:
    - from app.core.cache import cached, global_cache
    - @cached(ttl=300)
    - def expensive_function(x):
    -     return x * x
"""

import time
import functools
import threading
from typing import Any, Callable, Dict, Optional, Tuple
from collections import OrderedDict
import logging

logger = logging.getLogger(__name__)


class LRUCache:
    """
    线程安全的LRU缓存实现
    
    职责:
        - 提供线程安全的LRU缓存
        - 支持TTL过期机制
        - 提供缓存统计信息
    
    属性:
        _cache (OrderedDict): 缓存存储
        _max_size (int): 最大缓存大小
        _default_ttl (int): 默认TTL（秒）
        _lock (threading.RLock): 线程锁
        _hits (int): 缓存命中次数
        _misses (int): 缓存未命中次数
    
    示例:
        >>> cache = LRUCache(max_size=100, default_ttl=300)
        >>> cache.set("key", "value")
        >>> value = cache.get("key")
    """

    def __init__(self, max_size: int = 100, default_ttl: int = 300):
        """
        初始化LRU缓存
        
        Args:
            max_size: 最大缓存大小
            default_ttl: 默认TTL（秒）
        """
        self._cache: OrderedDict[str, Tuple[Any, float, float]] = OrderedDict()
        self._max_size = max_size
        self._default_ttl = default_ttl
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> Optional[Any]:
        """
        获取缓存值
        
        Args:
            key: 缓存键
            
        Returns:
            缓存值，如果不存在或已过期则返回None
            
        Example:
            >>> value = cache.get("key")
        """
        with self._lock:
            if key not in self._cache:
                self._misses += 1
                return None

            value, expire_time, _ = self._cache[key]
            if time.time() > expire_time:
                del self._cache[key]
                self._misses += 1
                return None

            self._cache.move_to_end(key)
            self._hits += 1
            return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """
        设置缓存值
        
        Args:
            key: 缓存键
            value: 缓存值
            ttl: 过期时间（秒），默认使用default_ttl
            
        Example:
            >>> cache.set("key", "value", ttl=600)
        """
        with self._lock:
            if key in self._cache:
                del self._cache[key]

            if len(self._cache) >= self._max_size:
                self._cache.popitem(last=False)

            expire_time = time.time() + (ttl if ttl is not None else self._default_ttl)
            self._cache[key] = (value, expire_time, time.time())

    def delete(self, key: str) -> bool:
        """
        删除缓存值
        
        Args:
            key: 缓存键
            
        Returns:
            是否成功删除
            
        Example:
            >>> deleted = cache.delete("key")
        """
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self) -> None:
        """
        清空缓存
        
        Example:
            >>> cache.clear()
        """
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0

    def stats(self) -> Dict[str, Any]:
        """
        获取缓存统计信息
        
        Returns:
            包含缓存大小、命中次数、未命中次数、命中率等信息的字典
            
        Example:
            >>> stats = cache.stats()
            >>> print(stats["hit_rate"])
        """
        with self._lock:
            total = self._hits + self._misses
            hit_rate = self._hits / total if total > 0 else 0
            return {
                "size": len(self._cache),
                "max_size": self._max_size,
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": f"{hit_rate:.2%}",
            }

    def cleanup_expired(self) -> int:
        """
        清理过期缓存
        
        Returns:
            清理的缓存项数量
            
        Example:
            >>> count = cache.cleanup_expired()
        """
        with self._lock:
            current_time = time.time()
            expired_keys = [
                key for key, (_, expire_time, _) in self._cache.items()
                if current_time > expire_time
            ]
            for key in expired_keys:
                del self._cache[key]
            return len(expired_keys)


global_cache = LRUCache(max_size=500, default_ttl=300)


def cached(
    ttl: int = 300,
    key_prefix: str = "",
    cache: Optional[LRUCache] = None
) -> Callable:
    """
    缓存装饰器

    Args:
        ttl: 缓存过期时间（秒）
        key_prefix: 缓存键前缀
        cache: 使用的缓存实例，默认使用全局缓存
        
    Returns:
        装饰器函数
        
    Example:
        >>> @cached(ttl=300)
        ... def expensive_function(x):
        ...     return x * x
    """
    _cache = cache or global_cache

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            cache_key = f"{key_prefix}:{func.__name__}:{str(args)}:{str(kwargs)}"

            result = _cache.get(cache_key)
            if result is not None:
                logger.debug(f"Cache hit for {cache_key}")
                return result

            result = func(*args, **kwargs)
            _cache.set(cache_key, result, ttl)
            logger.debug(f"Cache miss for {cache_key}")
            return result

        wrapper.cache_clear = lambda: _cache.clear()
        wrapper.cache_stats = lambda: _cache.stats()
        return wrapper

    return decorator


def async_cached(
    ttl: int = 300,
    key_prefix: str = "",
    cache: Optional[LRUCache] = None
) -> Callable:
    """
    异步缓存装饰器
    
    Args:
        ttl: 缓存过期时间（秒）
        key_prefix: 缓存键前缀
        cache: 使用的缓存实例，默认使用全局缓存
        
    Returns:
        装饰器函数
        
    Example:
        >>> @async_cached(ttl=300)
        ... async def expensive_async_function(x):
        ...     return x * x
    """
    _cache = cache or global_cache

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            cache_key = f"{key_prefix}:{func.__name__}:{str(args)}:{str(kwargs)}"

            result = _cache.get(cache_key)
            if result is not None:
                logger.debug(f"Cache hit for {cache_key}")
                return result

            result = await func(*args, **kwargs)
            _cache.set(cache_key, result, ttl)
            logger.debug(f"Cache miss for {cache_key}")
            return result

        wrapper.cache_clear = lambda: _cache.clear()
        wrapper.cache_stats = lambda: _cache.stats()
        return wrapper

    return decorator


class QueryOptimizer:
    """
    查询优化器
    
    职责:
        - 优化SQL查询
        - 记录查询统计
        - 识别慢查询
    
    属性:
        _query_cache (Dict): 查询缓存
        _query_stats (Dict): 查询统计
    
    示例:
        >>> optimizer = QueryOptimizer()
        >>> optimized = optimizer.optimize_query("SELECT  *  FROM  users")
    """

    def __init__(self):
        """初始化查询优化器"""
        self._query_cache: Dict[str, Any] = {}
        self._query_stats: Dict[str, Dict[str, int]] = {}

    def optimize_query(self, query: str, params: Optional[Dict] = None) -> str:
        """
        优化查询语句
        
        Args:
            query: SQL查询语句
            params: 查询参数
            
        Returns:
            优化后的查询语句
            
        Example:
            >>> optimized = optimizer.optimize_query("SELECT  *  FROM  users")
        """
        optimized = query.strip()
        optimized = " ".join(optimized.split())
        return optimized

    def record_query(self, query: str, execution_time: float) -> None:
        """
        记录查询执行信息
        
        Args:
            query: SQL查询语句
            execution_time: 执行时间（秒）
            
        Example:
            >>> optimizer.record_query("SELECT * FROM users", 0.5)
        """
        query_hash = hash(query)
        if query_hash not in self._query_stats:
            self._query_stats[query_hash] = {
                "count": 0,
                "total_time": 0,
                "avg_time": 0,
                "query": query[:100],
            }
        stats = self._query_stats[query_hash]
        stats["count"] += 1
        stats["total_time"] += execution_time
        stats["avg_time"] = stats["total_time"] / stats["count"]

    def get_slow_queries(self, threshold: float = 1.0) -> list:
        """
        获取慢查询列表
        
        Args:
            threshold: 慢查询阈值（秒）
            
        Returns:
            慢查询统计列表
            
        Example:
            >>> slow_queries = optimizer.get_slow_queries(threshold=1.0)
        """
        return [
            stats for stats in self._query_stats.values()
            if stats["avg_time"] > threshold
        ]

    def get_query_stats(self) -> Dict[str, Any]:
        """
        获取查询统计信息
        
        Returns:
            查询统计信息字典
            
        Example:
            >>> stats = optimizer.get_query_stats()
        """
        return {
            "total_queries": len(self._query_stats),
            "slow_queries": len(self.get_slow_queries()),
            "stats": self._query_stats,
        }


query_optimizer = QueryOptimizer()
