# -*- coding: utf-8 -*-
"""
缓存管理器。

@file cache.py
@description 后端缓存和性能优化模块
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 内存缓存装饰器
- TTL过期机制
- LRU缓存策略
- 缓存统计
"""

import time
import functools
import threading
from typing import Any, Callable, Dict, Optional, Tuple
from collections import OrderedDict
import logging

logger = logging.getLogger(__name__)


class LRUCache:
    """线程安全的LRU缓存实现。"""

    def __init__(self, max_size: int = 100, default_ttl: int = 300):
        self._cache: OrderedDict[str, Tuple[Any, float, float]] = OrderedDict()
        self._max_size = max_size
        self._default_ttl = default_ttl
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> Optional[Any]:
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
        with self._lock:
            if key in self._cache:
                del self._cache[key]

            if len(self._cache) >= self._max_size:
                self._cache.popitem(last=False)

            expire_time = time.time() + (ttl if ttl is not None else self._default_ttl)
            self._cache[key] = (value, expire_time, time.time())

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0

    def stats(self) -> Dict[str, Any]:
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
    缓存装饰器。

    Args:
        ttl: 缓存过期时间（秒）
        key_prefix: 缓存键前缀
        cache: 使用的缓存实例，默认使用全局缓存
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
    异步缓存装饰器。
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
    """查询优化器。"""

    def __init__(self):
        self._query_cache: Dict[str, Any] = {}
        self._query_stats: Dict[str, Dict[str, int]] = {}

    def optimize_query(self, query: str, params: Optional[Dict] = None) -> str:
        optimized = query.strip()
        optimized = " ".join(optimized.split())
        return optimized

    def record_query(self, query: str, execution_time: float) -> None:
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
        return [
            stats for stats in self._query_stats.values()
            if stats["avg_time"] > threshold
        ]

    def get_query_stats(self) -> Dict[str, Any]:
        return {
            "total_queries": len(self._query_stats),
            "slow_queries": len(self.get_slow_queries()),
            "stats": self._query_stats,
        }


query_optimizer = QueryOptimizer()
