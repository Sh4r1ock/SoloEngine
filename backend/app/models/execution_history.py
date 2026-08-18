# -*- coding: utf-8 -*-
"""
SoloEngine : 执行历史数据模型模块

@file execution_history.py
@description 执行历史数据模型定义
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义执行历史相关的数据模型，包括：
    - 执行状态枚举
    - 执行步骤记录
    - 执行历史记录

依赖:
    - typing: 类型注解支持
    - dataclasses: 数据类支持
    - datetime: 日期时间处理
    - enum: 枚举类型支持

使用示例:
    - from app.models.execution_history import ExecutionHistory, ExecutionStatus
    - history = ExecutionHistory(history_id="1", flow_id="flow1")
    - history.add_step(step)
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo
from enum import Enum

from app.core.config import settings


class ExecutionStatus(Enum):
    """执行状态。"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ExecutionStep:
    """执行步骤记录。"""
    step_id: str
    step_type: str
    node_id: str
    node_name: str
    timestamp: str
    input_data: Dict[str, Any]
    output_data: Optional[Dict[str, Any]] = None
    thought: Optional[str] = None
    action: Optional[str] = None
    observation: Optional[str] = None
    error: Optional[str] = None
    duration_ms: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "step_id": self.step_id,
            "step_type": self.step_type,
            "node_id": self.node_id,
            "node_name": self.node_name,
            "timestamp": self.timestamp,
            "input_data": self.input_data,
            "output_data": self.output_data,
            "thought": self.thought,
            "action": self.action,
            "observation": self.observation,
            "error": self.error,
            "duration_ms": self.duration_ms,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionStep":
        return cls(
            step_id=data["step_id"],
            step_type=data["step_type"],
            node_id=data["node_id"],
            node_name=data["node_name"],
            timestamp=data["timestamp"],
            input_data=data.get("input_data", {}),
            output_data=data.get("output_data"),
            thought=data.get("thought"),
            action=data.get("action"),
            observation=data.get("observation"),
            error=data.get("error"),
            duration_ms=data.get("duration_ms"),
        )


@dataclass
class ToolCallRecord:
    """工具调用记录。"""
    id: str
    tool_name: str
    arguments: Dict[str, Any]
    result: Optional[Any] = None
    error: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    duration_ms: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "tool_name": self.tool_name,
            "arguments": self.arguments,
            "result": self.result,
            "error": self.error,
            "timestamp": self.timestamp,
            "duration_ms": self.duration_ms,
        }


@dataclass
class ExecutionRecord:
    """执行记录。"""
    execution_id: str
    project_name: str
    status: ExecutionStatus = ExecutionStatus.PENDING
    start_time: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    end_time: Optional[str] = None
    duration_ms: Optional[int] = None
    input_message: Optional[str] = None
    output_message: Optional[str] = None
    steps: List[ExecutionStep] = field(default_factory=list)
    tool_calls: List[ToolCallRecord] = field(default_factory=list)
    # Token 使用统计。包含以下 key：
    # - prompt_tokens: 输入 token 总和（API 精确值累加）
    # - completion_tokens: 输出 token（API 精确值累加）
    # - total_tokens: 总 token（prompt + completion，reply 周期累加消耗）
    # - duration_ms: 调用时长（毫秒）
    # - system_prompt_token: system 提示词 token（tiktoken 估算累加）
    # - user_prompt_token: user 输入 token（tiktoken 估算累加）
    # - assistant_prompt_token: 历史 assistant 消息 token（tiktoken 估算累加）
    token_usage: Dict[str, int] = field(default_factory=dict)
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "execution_id": self.execution_id,
            "project_name": self.project_name,
            "status": self.status.value,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "duration_ms": self.duration_ms,
            "input_message": self.input_message,
            "output_message": self.output_message,
            "steps": [s.to_dict() for s in self.steps],
            "tool_calls": [t.to_dict() for t in self.tool_calls],
            "token_usage": self.token_usage,
            "error": self.error,
            "metadata": self.metadata,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionRecord":
        return cls(
            execution_id=data["execution_id"],
            project_name=data["project_name"],
            status=ExecutionStatus(data.get("status", "pending")),
            start_time=data.get("start_time", datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()),
            end_time=data.get("end_time"),
            duration_ms=data.get("duration_ms"),
            input_message=data.get("input_message"),
            output_message=data.get("output_message"),
            steps=[ExecutionStep.from_dict(s) for s in data.get("steps", [])],
            tool_calls=[ToolCallRecord(**t) for t in data.get("tool_calls", [])],
            token_usage=data.get("token_usage", {}),
            error=data.get("error"),
            metadata=data.get("metadata", {}),
        )
