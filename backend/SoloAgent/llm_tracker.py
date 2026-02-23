# -*- coding: utf-8 -*-
"""LLM usage tracker for monitoring token usage and statistics."""
import os
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from collections import defaultdict
from threading import Lock

from .model.model_usage import ChatUsage
from .utils.logging import logger


class LLMUsageRecord:
    """A single LLM usage record."""

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
        self.model_name = model_name
        self.provider = provider
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.time_seconds = time_seconds
        self.timestamp = timestamp
        self.request_id = request_id

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def to_dict(self) -> dict:
        """Convert to dictionary."""
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
    """Track LLM usage across all models."""

    def __init__(
        self,
        storage_path: str | None = None,
        max_records: int = 1000,
    ):
        """Initialize the LLM usage tracker.

        Args:
            storage_path (str | None): Path to store usage data.
                If None, uses default path.
            max_records (int): Maximum number of records to keep in memory.
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
        """Load usage records from storage."""
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
        """Save usage records to storage."""
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
        """Record a LLM usage event.

        Args:
            model_name (str): The model name used.
            provider (str): The provider name (openai, anthropic, etc.).
            usage (ChatUsage): The usage information from the model.
            request_id (str): Unique identifier for this request.
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
        """Get usage statistics for a given time range.

        Args:
            time_range_hours (int): Time range in hours.
            provider (str | None): Filter by provider.
            model_name (str | None): Filter by model name.

        Returns:
            dict: Statistics including total tokens, average time, etc.
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

    def get_provider_statistics(self) -> Dict[str, dict]:
        """Get statistics grouped by provider.

        Returns:
            Dict[str, dict]: Statistics for each provider.
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
        """Get statistics grouped by model.

        Returns:
            Dict[str, dict]: Statistics for each model.
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
        """Get the most recent usage records.

        Args:
            limit (int): Maximum number of records to return.
            provider (str | None): Filter by provider.

        Returns:
            List[dict]: Recent usage records.
        """
        if provider:
            filtered = [r for r in self.records if r.provider == provider]
        else:
            filtered = self.records

        return [r.to_dict() for r in filtered[-limit:][::-1]]

    def clear_old_records(self, days_to_keep: int = 30) -> int:
        """Clear records older than specified days.

        Args:
            days_to_keep (int): Number of days of records to keep.

        Returns:
            int: Number of records removed.
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
        """Export usage data to a file.

        Args:
            output_path (str | None): Path to save export file.
                If None, generates a filename.
            format (str): Export format ('json' or 'csv').

        Returns:
            str: Path to the exported file.
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
