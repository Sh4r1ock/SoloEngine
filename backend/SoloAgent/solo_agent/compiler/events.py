# -*- coding: utf-8 -*-
from dataclasses import dataclass, field
from typing import Any, Optional, List, Dict
from datetime import datetime
from zoneinfo import ZoneInfo

from SoloAgent.config import settings


@dataclass
class ExecutionEvent:
    """
    执行事件数据类
    
    职责:
    - 封装流程执行过程中的各类事件
    - 支持多种事件类型：消息、工具调用、Skill调用、MCP调用、文件变更等
    - 提供时间戳和元数据支持
    
    属性:
        event_type (str): 事件类型
        agent_id (Optional[str]): Agent ID
        agent_name (Optional[str]): Agent名称
        content (Optional[str]): 内容
        message (Optional[Dict]): 消息数据
        tool_name (Optional[str]): 工具名称
        tool_args (Optional[Dict]): 工具参数
        tool_result (Optional[str]): 工具结果
        timestamp (str): 时间戳
        metadata (Dict[str, Any]): 元数据
        file_changes (Optional[List[Dict]]): 文件变更列表
    """
    event_type: str
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    agent_type: Optional[str] = None
    content: Optional[str] = None
    message: Optional[Dict[str, Any]] = None
    tool_name: Optional[str] = None
    tool_type: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[Any] = None
    tool_call_id: Optional[str] = None
    parent_message_id: Optional[str] = None  # 改动 3 文件 E：subagent 消息的 parent_message_id
    status: Optional[str] = None
    error: Optional[str] = None
    file_changes: Optional[List[Dict]] = None
    timestamp: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "event_type": self.event_type,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "agent_type": self.agent_type,
            "content": self.content,
            "tool_name": self.tool_name,
            "tool_type": self.tool_type,
            "tool_args": self.tool_args,
            "tool_result": self.tool_result,
            "tool_call_id": self.tool_call_id,
            "parent_message_id": self.parent_message_id,
            "status": self.status,
            "error": self.error,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }
