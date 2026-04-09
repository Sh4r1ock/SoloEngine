# -*- coding: utf-8 -*-
"""
SoloEngine : LLM使用追踪器，用于监控token使用情况和统计信息

@file llm_tracker.py
@description 实现LLM使用情况的追踪、记录和统计功能
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供LLM使用情况的全面追踪功能，包括：
    - 记录每次LLM调用的token使用情况
    - 按模型和提供商统计使用量
    - 持久化存储使用记录
    - 提供查询和聚合统计功能
    - 支持线程安全的记录操作

依赖:
    - os: 文件路径操作
    - json: 数据序列化
    - datetime: 时间戳处理
    - typing: 类型提示
    - collections: 数据结构
    - threading: 线程锁
    - .model.model_usage: ChatUsage模型
    - .utils.logging: 日志记录

使用示例:
    - tracker = LLMUsageTracker()
    - tracker.record_usage("gpt-4", "openai", 100, 50, 1.5)
    - stats = tracker.get_statistics()
"""
import os
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from collections import defaultdict
from threading import Lock

from .model.model_usage import ChatUsage
from .utils.logging import logger


class LLMUsageRecord:
    """
    单条LLM使用记录类
    
    职责:
    - 存储单次LLM调用的完整信息
    - 提供token使用统计计算
    - 支持序列化为字典格式
    
    属性:
        model_name (str): 模型名称，如"gpt-4"
        provider (str): 提供商名称，如"openai"
        input_tokens (int): 输入token数量
        output_tokens (int): 输出token数量
        time_seconds (float): 调用耗时（秒）
        timestamp (str): 调用时间戳
        request_id (str): 请求唯一标识
    """

    def __init__(
        self,
        model_name: str,
        provider: str,
        input_tokens: int,
        output_tokens: int,
        time_seconds: float,
        timestamp: str,
        request_id: str,
    ):
        """
        初始化LLM使用记录
        
        Args:
            model_name: 模型名称
            provider: 提供商名称
            input_tokens: 输入token数量
            output_tokens: 输出token数量
            time_seconds: 调用耗时（秒）
            timestamp: 调用时间戳
            request_id: 请求唯一标识
        """
        self.model_name = model_name
        self.provider = provider
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.time_seconds = time_seconds
        self.timestamp = timestamp
        self.request_id = request_id

    @property
    def total_tokens(self) -> int:
        """
        计算总token数量
        
        Returns:
            int: 输入和输出token的总和
        """
        return self.input_tokens + self.output_tokens

    def to_dict(self) -> dict:
        """
        将记录转换为字典格式
        
        Returns:
            dict: 包含所有字段的字典表示
        """
        return {
            "model_name": self.model_name,
            "provider": self.provider,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "time_seconds": self.time_seconds,
            "timestamp": self.timestamp,
            "request_id": self.request_id,
        }


class LLMUsageTracker:
    """
    LLM使用追踪器类
    
    职责:
    - 追踪所有模型的LLM使用情况
    - 持久化存储使用记录
    - 提供统计查询功能
    - 线程安全的记录操作
    
    属性:
        storage_path (str): 存储文件路径
        max_records (int): 内存中最大记录数
        records (List[LLMUsageRecord]): 使用记录列表
        _lock (Lock): 线程锁
    """

    def __init__(
        self,
        storage_path: str | None = None,
        max_records: int = 1000,
    ):
        """
        初始化LLM使用追踪器

        Args:
            storage_path: 存储文件路径，默认为data/llm_usage.json
            max_records: 内存中保留的最大记录数
        """
        if storage_path is None:
            storage_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "data",
                "llm_usage.json",
            )

        self.storage_path = storage_path
        self.max_records = max_records
        self.records: List[LLMUsageRecord] = []
        self._lock = Lock()
        self._load_records()

    def _load_records(self) -> None:
        """
        从存储文件加载使用记录
        
        如果存储文件不存在则跳过，加载失败会记录警告日志
        """
        if not os.path.exists(self.storage_path):
            return

        try:
            with open(self.storage_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    self.records = [
                        LLMUsageRecord(**record) for record in data
                    ]
            logger.info(f"Loaded {len(self.records)} usage records")
        except Exception as e:
            logger.warning(f"Failed to load usage records: {e}")

    def _save_records(self) -> None:
        """
        将使用记录保存到存储文件
        
        自动创建父目录，保存失败会记录错误日志
        """
        try:
            os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
            with open(self.storage_path, "w", encoding="utf-8") as f:
                data = [record.to_dict() for record in self.records]
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save usage records: {e}")

    def record_usage(
        self,
        model_name: str,
        provider: str,
        usage: ChatUsage,
        request_id: str,
    ) -> None:
        """
        记录一次LLM使用事件

        Args:
            model_name: 使用的模型名称
            provider: 提供商名称（openai, anthropic等）
            usage: 模型的使用信息
            request_id: 本次请求的唯一标识
        """
        if usage is None:
            logger.warning(f"Usage is None for request {request_id}, skipping recording")
            return

        record = LLMUsageRecord(
            model_name=model_name,
            provider=provider,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            time_seconds=usage.time,
            timestamp=datetime.now().isoformat(),
            request_id=request_id,
        )

        with self._lock:
            self.records.append(record)
            if len(self.records) > self.max_records:
                # Keep only the most recent records
                self.records = self.records[-self.max_records :]

        self._save_records()

    def get_statistics(
        self,
        time_range_hours: int = 24,
        provider: str | None = None,
        model_name: str | None = None,
    ) -> dict:
        """
        获取指定时间范围内的使用统计信息

        Args:
            time_range_hours: 时间范围（小时），默认为24小时
            provider: 按提供商过滤，None表示不过滤
            model_name: 按模型名称过滤，None表示不过滤

        Returns:
            dict: 包含以下统计信息的字典:
                - total_requests: 总请求数
                - total_tokens: 总token数
                - avg_tokens_per_request: 平均每请求token数
                - avg_time_per_request: 平均每请求耗时
                - time_range_hours: 时间范围

        Raises:
            无异常抛出

        Example:
            >>> stats = tracker.get_statistics(time_range_hours=24, provider="openai")
            >>> print(stats["total_tokens"])
        """
        cutoff_time = datetime.now() - timedelta(hours=time_range_hours)

        filtered_records = [
            r for r in self.records
            if datetime.fromisoformat(r.timestamp) >= cutoff_time
        ]

        if provider:
            filtered_records = [r for r in filtered_records if r.provider == provider]

        if model_name:
            filtered_records = [r for r in filtered_records if r.model_name == model_name]

        if not filtered_records:
            return {
                "total_requests": 0,
                "total_tokens": 0,
                "avg_tokens_per_request": 0,
                "avg_time_per_request": 0,
            }

        total_requests = len(filtered_records)
        total_tokens = sum(r.total_tokens for r in filtered_records)
        total_time = sum(r.time_seconds for r in filtered_records)

        return {
            "total_requests": total_requests,
            "total_tokens": total_tokens,
            "avg_tokens_per_request": total_tokens / total_requests if total_requests > 0 else 0,
            "avg_time_per_request": total_time / total_requests if total_requests > 0 else 0,
            "time_range_hours": time_range_hours,
        }

    def get_daily_statistics(
        self,
        start_date: str | None = None,
        end_date: str | None = None,
        provider: str | None = None,
        model_name: str | None = None,
    ) -> dict:
        """
        按天分组获取使用统计信息

        Args:
            start_date: 开始日期（YYYY-MM-DD格式），None表示7天前
            end_date: 结束日期（YYYY-MM-DD格式），None表示今天
            provider: 按提供商过滤，None表示不过滤
            model_name: 按模型名称过滤，None表示不过滤

        Returns:
            dict: 包含以下内容的字典:
                - daily: 每天的统计列表
                - summary: 汇总统计信息
                - date_range: 日期范围

        Raises:
            无异常抛出

        Example:
            >>> daily_stats = tracker.get_daily_statistics(start_date="2025-01-01")
            >>> print(daily_stats["summary"]["total_requests"])
        """
        today = datetime.now().date()
        
        if start_date:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        else:
            start_dt = datetime.combine(today - timedelta(days=6), datetime.min.time())
        
        if end_date:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1) - timedelta(seconds=1)
        else:
            end_dt = datetime.now()

        filtered_records = [
            r for r in self.records
            if start_dt <= datetime.fromisoformat(r.timestamp) <= end_dt
        ]

        if provider:
            filtered_records = [r for r in filtered_records if r.provider == provider]

        if model_name:
            filtered_records = [r for r in filtered_records if r.model_name == model_name]

        daily_data = defaultdict(lambda: {"requests": 0, "tokens": 0, "time": 0.0})
        
        for record in filtered_records:
            day = datetime.fromisoformat(record.timestamp).strftime("%Y-%m-%d")
            daily_data[day]["requests"] += 1
            daily_data[day]["tokens"] += record.total_tokens
            daily_data[day]["time"] += record.time_seconds

        current_date = start_dt.date()
        end_date_obj = end_dt.date() if isinstance(end_dt, datetime) else end_dt
        while current_date <= end_date_obj:
            day_str = current_date.strftime("%Y-%m-%d")
            if day_str not in daily_data:
                daily_data[day_str] = {"requests": 0, "tokens": 0, "time": 0.0}
            current_date += timedelta(days=1)

        sorted_days = sorted(daily_data.keys())
        daily_stats = []
        for day in sorted_days:
            data = daily_data[day]
            daily_stats.append({
                "date": day,
                "requests": data["requests"],
                "tokens": data["tokens"],
                "avg_time": data["time"] / data["requests"] if data["requests"] > 0 else 0,
            })

        total_requests = sum(d["requests"] for d in daily_stats)
        total_tokens = sum(d["tokens"] for d in daily_stats)
        total_time = sum(daily_data[d]["time"] for d in sorted_days)

        return {
            "daily": daily_stats,
            "summary": {
                "total_requests": total_requests,
                "total_tokens": total_tokens,
                "avg_tokens_per_request": total_tokens / total_requests if total_requests > 0 else 0,
                "avg_time_per_request": total_time / total_requests if total_requests > 0 else 0,
            },
            "date_range": {
                "start": sorted_days[0] if sorted_days else None,
                "end": sorted_days[-1] if sorted_days else None,
            },
        }

    def get_provider_statistics(self) -> Dict[str, dict]:
        """
        按提供商分组获取统计信息

        Args:
            无参数

        Returns:
            Dict[str, dict]: 每个提供商的统计信息，包含:
                - total_requests: 总请求数
                - total_tokens: 总token数
                - avg_tokens_per_request: 平均每请求token数

        Raises:
            无异常抛出

        Example:
            >>> provider_stats = tracker.get_provider_statistics()
            >>> print(provider_stats["openai"]["total_tokens"])
        """
        provider_stats = defaultdict(list)

        for record in self.records:
            provider_stats[record.provider].append(record)

        result = {}
        for provider, records in provider_stats.items():
            if not records:
                result[provider] = {
                    "total_requests": 0,
                    "total_tokens": 0,
                    "avg_tokens_per_request": 0,
                }
                continue

            total_requests = len(records)
            total_tokens = sum(r.total_tokens for r in records)
            result[provider] = {
                "total_requests": total_requests,
                "total_tokens": total_tokens,
                "avg_tokens_per_request": total_tokens / total_requests if total_requests > 0 else 0,
            }

        return result

    def get_model_statistics(self) -> Dict[str, dict]:
        """
        按模型分组获取统计信息

        Args:
            无参数

        Returns:
            Dict[str, dict]: 每个模型的统计信息，键格式为"provider:model_name"，包含:
                - total_requests: 总请求数
                - total_tokens: 总token数
                - avg_tokens_per_request: 平均每请求token数

        Raises:
            无异常抛出

        Example:
            >>> model_stats = tracker.get_model_statistics()
            >>> print(model_stats["openai:gpt-4"]["total_tokens"])
        """
        model_stats = defaultdict(list)

        for record in self.records:
            model_stats[f"{record.provider}:{record.model_name}"].append(record)

        result = {}
        for key, records in model_stats.items():
            if not records:
                result[key] = {
                    "total_requests": 0,
                    "total_tokens": 0,
                    "avg_tokens_per_request": 0,
                }
                continue

            total_requests = len(records)
            total_tokens = sum(r.total_tokens for r in records)
            result[key] = {
                "total_requests": total_requests,
                "total_tokens": total_tokens,
                "avg_tokens_per_request": total_tokens / total_requests if total_requests > 0 else 0,
            }

        return result

    def get_recent_records(
        self,
        limit: int = 100,
        provider: str | None = None,
    ) -> List[dict]:
        """
        获取最近的使用记录

        Args:
            limit: 返回的最大记录数，默认为100
            provider: 按提供商过滤，None表示不过滤

        Returns:
            List[dict]: 最近的使用记录列表，按时间倒序排列

        Raises:
            无异常抛出

        Example:
            >>> recent = tracker.get_recent_records(limit=10, provider="openai")
            >>> for record in recent:
            ...     print(record["model_name"])
        """
        if provider:
            filtered = [r for r in self.records if r.provider == provider]
        else:
            filtered = self.records

        return [r.to_dict() for r in filtered[-limit:][::-1]]

    def clear_old_records(self, days_to_keep: int = 30) -> int:
        """
        清除指定天数之前的旧记录

        Args:
            days_to_keep: 保留记录的天数，默认为30天

        Returns:
            int: 被删除的记录数量

        Raises:
            无异常抛出

        Example:
            >>> removed = tracker.clear_old_records(days_to_keep=7)
            >>> print(f"Removed {removed} old records")
        """
        cutoff_time = datetime.now() - timedelta(days=days_to_keep)
        old_count = len(self.records)

        self.records = [
            r for r in self.records
            if datetime.fromisoformat(r.timestamp) >= cutoff_time
        ]

        removed_count = old_count - len(self.records)

        if removed_count > 0:
            self._save_records()
            logger.info(f"Removed {removed_count} old usage records")

        return removed_count

    def export_usage(
        self,
        output_path: str | None = None,
        format: str = "json",
    ) -> str:
        """
        导出使用数据到文件

        Args:
            output_path: 导出文件路径，None则自动生成文件名
            format: 导出格式，支持'json'或'csv'，默认为'json'

        Returns:
            str: 导出文件的绝对路径

        Raises:
            ValueError: 当format不是'json'或'csv'时抛出
            Exception: 文件写入失败时抛出

        Example:
            >>> path = tracker.export_usage(format="json")
            >>> print(f"Exported to {path}")
            >>> path = tracker.export_usage(output_path="usage.csv", format="csv")
        """
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = f"llm_usage_export_{timestamp}.{format}"

        output_path = os.path.abspath(output_path)

        try:
            if format == "json":
                data = [r.to_dict() for r in self.records]
                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            elif format == "csv":
                import csv
                with open(output_path, "w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow([
                        "timestamp",
                        "provider",
                        "model_name",
                        "request_id",
                        "input_tokens",
                        "output_tokens",
                        "total_tokens",
                        "time_seconds",
                    ])
                    for r in self.records:
                        writer.writerow([
                            r.timestamp,
                            r.provider,
                            r.model_name,
                            r.request_id,
                            r.input_tokens,
                            r.output_tokens,
                            r.total_tokens,
                            r.time_seconds,
                        ])
            else:
                raise ValueError(f"Unsupported export format: {format}")

            logger.info(f"Exported {len(self.records)} usage records to {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Failed to export usage data: {e}")
            raise
