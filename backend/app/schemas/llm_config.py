# -*- coding: utf-8 -*-
"""LLM 配置模型。"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class LLMProvider(Enum):
    """LLM 提供商。"""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    QWEN = "qwen"
    OLLAMA = "ollama"


@dataclass
class LLMModel:
    """LLM 模型定义。"""
    id: str
    name: str
    provider: LLMProvider
    max_tokens: int = 4096
    supports_streaming: bool = True
    supports_tools: bool = True
    supports_vision: bool = False
    context_window: int = 8192
    pricing_input: float = 0.0
    pricing_output: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "provider": self.provider.value,
            "max_tokens": self.max_tokens,
            "supports_streaming": self.supports_streaming,
            "supports_tools": self.supports_tools,
            "supports_vision": self.supports_vision,
            "context_window": self.context_window,
            "pricing_input": self.pricing_input,
            "pricing_output": self.pricing_output,
        }


@dataclass
class LLMConfig:
    """LLM 配置。"""
    provider: LLMProvider
    model: str
    api_key: str = ""
    api_base: str = ""
    temperature: float = 0.7
    max_tokens: int = 2048
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    timeout: int = 60
    extra_params: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "provider": self.provider.value,
            "model": self.model,
            "api_key": "***" if self.api_key else "",
            "api_base": self.api_base,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "top_p": self.top_p,
            "frequency_penalty": self.frequency_penalty,
            "presence_penalty": self.presence_penalty,
            "timeout": self.timeout,
            "extra_params": self.extra_params,
        }


@dataclass
class LLMUsageRecord:
    """LLM 使用记录。"""
    id: str
    provider: LLMProvider
    model_name: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    duration_ms: int
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    project_name: str = ""
    node_id: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "provider": self.provider.value,
            "model_name": self.model_name,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "duration_ms": self.duration_ms,
            "timestamp": self.timestamp,
            "project_name": self.project_name,
            "node_id": self.node_id,
        }


@dataclass
class LLMUsageStats:
    """LLM 使用统计。"""
    time_range_hours: int
    total_requests: int
    total_tokens: int
    total_input_tokens: int
    total_output_tokens: int
    avg_tokens_per_request: float
    avg_time_per_request: float
    by_provider: Dict[str, int] = field(default_factory=dict)
    by_model: Dict[str, int] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "time_range_hours": self.time_range_hours,
            "total_requests": self.total_requests,
            "total_tokens": self.total_tokens,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "avg_tokens_per_request": self.avg_tokens_per_request,
            "avg_time_per_request": self.avg_time_per_request,
            "by_provider": self.by_provider,
            "by_model": self.by_model,
        }
