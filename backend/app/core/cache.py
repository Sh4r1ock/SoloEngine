# -*- coding: utf-8 -*-
"""
SoloEngine : 缓存管理器模块

@file cache.py
@description 后端缓存和性能优化模块
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供以下核心功能：
    - 内存缓存
    - TTL过期机制
    - LRU缓存策略
    - 缓存统计

依赖:
    - time: 时间处理
    - threading: 线程锁
    - typing: 类型注解支持
    - collections.OrderedDict: 有序字典

使用示例:
    - from app.core.cache import global_cache
    - global_cache.set("key", "value", ttl=300)
    - value = global_cache.get("key")
"""

import time
import threading
from typing import Any, Dict, Optional, Tuple
from collections import OrderedDict


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


from app.core.config import settings

global_cache = LRUCache(max_size=settings.CACHE_MAX_SIZE, default_ttl=settings.CACHE_DEFAULT_TTL)
