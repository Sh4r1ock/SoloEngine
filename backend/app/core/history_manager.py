# -*- coding: utf-8 -*-
"""执行历史管理器。"""

import os
import json
import uuid
import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from enum import Enum

logger = logging.getLogger(__name__)


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


@dataclass
class ExecutionRecord:
    """执行记录。"""
    execution_id: str
    project_name: str
    status: ExecutionStatus = ExecutionStatus.PENDING
    start_time: str = field(default_factory=lambda: datetime.now().isoformat())
    end_time: Optional[str] = None
    duration_ms: Optional[int] = None
    input_message: Optional[str] = None
    output_message: Optional[str] = None
    steps: List[ExecutionStep] = field(default_factory=list)
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    token_usage: Dict[str, int] = field(default_factory=dict)
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class HistoryManager:
    """执行历史管理器。"""

    def __init__(self, storage_path: Optional[str] = None):
        self.storage_path = Path(storage_path) if storage_path else Path("history")
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self._records: Dict[str, ExecutionRecord] = {}
        self._load_records()

    def _load_records(self):
        """加载历史记录。"""
        for record_file in self.storage_path.glob("*.json"):
            try:
                with open(record_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    record = self._dict_to_record(data)
                    self._records[record.execution_id] = record
            except Exception as e:
                logger.error(f"Failed to load record {record_file}: {e}")

    def _dict_to_record(self, data: Dict[str, Any]) -> ExecutionRecord:
        """将字典转换为执行记录。"""
        steps = [
            ExecutionStep(
                step_id=s["step_id"],
                step_type=s["step_type"],
                node_id=s["node_id"],
                node_name=s["node_name"],
                timestamp=s["timestamp"],
                input_data=s.get("input_data", {}),
                output_data=s.get("output_data"),
                thought=s.get("thought"),
                action=s.get("action"),
                observation=s.get("observation"),
                error=s.get("error"),
                duration_ms=s.get("duration_ms"),
            )
            for s in data.get("steps", [])
        ]

        return ExecutionRecord(
            execution_id=data["execution_id"],
            project_name=data["project_name"],
            status=ExecutionStatus(data.get("status", "pending")),
            start_time=data.get("start_time", datetime.now().isoformat()),
            end_time=data.get("end_time"),
            duration_ms=data.get("duration_ms"),
            input_message=data.get("input_message"),
            output_message=data.get("output_message"),
            steps=steps,
            tool_calls=data.get("tool_calls", []),
            token_usage=data.get("token_usage", {}),
            error=data.get("error"),
            metadata=data.get("metadata", {}),
        )

    def _record_to_dict(self, record: ExecutionRecord) -> Dict[str, Any]:
        """将执行记录转换为字典。"""
        return {
            "execution_id": record.execution_id,
            "project_name": record.project_name,
            "status": record.status.value,
            "start_time": record.start_time,
            "end_time": record.end_time,
            "duration_ms": record.duration_ms,
            "input_message": record.input_message,
            "output_message": record.output_message,
            "steps": [
                {
                    "step_id": s.step_id,
                    "step_type": s.step_type,
                    "node_id": s.node_id,
                    "node_name": s.node_name,
                    "timestamp": s.timestamp,
                    "input_data": s.input_data,
                    "output_data": s.output_data,
                    "thought": s.thought,
                    "action": s.action,
                    "observation": s.observation,
                    "error": s.error,
                    "duration_ms": s.duration_ms,
                }
                for s in record.steps
            ],
            "tool_calls": record.tool_calls,
            "token_usage": record.token_usage,
            "error": record.error,
            "metadata": record.metadata,
        }

    def _save_record(self, record: ExecutionRecord):
        """保存执行记录。"""
        record_file = self.storage_path / f"{record.execution_id}.json"
        try:
            with open(record_file, "w", encoding="utf-8") as f:
                json.dump(self._record_to_dict(record), f, indent=2, ensure_ascii=False)
            self._records[record.execution_id] = record
        except Exception as e:
            logger.error(f"Failed to save record {record.execution_id}: {e}")
            raise

    def create_record(
        self,
        project_name: str,
        input_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ExecutionRecord:
        """创建执行记录。"""
        execution_id = str(uuid.uuid4())
        record = ExecutionRecord(
            execution_id=execution_id,
            project_name=project_name,
            status=ExecutionStatus.PENDING,
            input_message=input_message,
            metadata=metadata or {},
        )
        self._save_record(record)
        logger.info(f"Created execution record: {execution_id}")
        return record

    def start_execution(self, execution_id: str) -> None:
        """开始执行。"""
        record = self._records.get(execution_id)
        if not record:
            raise ValueError(f"Record not found: {execution_id}")

        record.status = ExecutionStatus.RUNNING
        record.start_time = datetime.now().isoformat()
        self._save_record(record)

    def complete_execution(
        self,
        execution_id: str,
        output_message: Optional[str] = None,
        token_usage: Optional[Dict[str, int]] = None,
    ) -> None:
        """完成执行。"""
        record = self._records.get(execution_id)
        if not record:
            raise ValueError(f"Record not found: {execution_id}")

        record.status = ExecutionStatus.COMPLETED
        record.end_time = datetime.now().isoformat()
        record.output_message = output_message

        if token_usage:
            record.token_usage = token_usage

        # 计算持续时间
        try:
            start = datetime.fromisoformat(record.start_time)
            end = datetime.fromisoformat(record.end_time)
            record.duration_ms = int((end - start).total_seconds() * 1000)
        except:
            pass

        self._save_record(record)

    def fail_execution(
        self,
        execution_id: str,
        error: str,
    ) -> None:
        """执行失败。"""
        record = self._records.get(execution_id)
        if not record:
            raise ValueError(f"Record not found: {execution_id}")

        record.status = ExecutionStatus.FAILED
        record.end_time = datetime.now().isoformat()
        record.error = error

        try:
            start = datetime.fromisoformat(record.start_time)
            end = datetime.fromisoformat(record.end_time)
            record.duration_ms = int((end - start).total_seconds() * 1000)
        except:
            pass

        self._save_record(record)

    def add_step(
        self,
        execution_id: str,
        step_type: str,
        node_id: str,
        node_name: str,
        input_data: Dict[str, Any],
        thought: Optional[str] = None,
        action: Optional[str] = None,
    ) -> ExecutionStep:
        """添加执行步骤。"""
        record = self._records.get(execution_id)
        if not record:
            raise ValueError(f"Record not found: {execution_id}")

        step = ExecutionStep(
            step_id=str(uuid.uuid4()),
            step_type=step_type,
            node_id=node_id,
            node_name=node_name,
            timestamp=datetime.now().isoformat(),
            input_data=input_data,
            thought=thought,
            action=action,
        )

        record.steps.append(step)
        self._save_record(record)

        return step

    def complete_step(
        self,
        execution_id: str,
        step_id: str,
        output_data: Optional[Dict[str, Any]] = None,
        observation: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        """完成执行步骤。"""
        record = self._records.get(execution_id)
        if not record:
            raise ValueError(f"Record not found: {execution_id}")

        for step in record.steps:
            if step.step_id == step_id:
                step.output_data = output_data
                step.observation = observation
                step.error = error

                # 计算步骤持续时间
                try:
                    start = datetime.fromisoformat(step.timestamp)
                    end = datetime.now()
                    step.duration_ms = int((end - start).total_seconds() * 1000)
                except:
                    pass
                break

        self._save_record(record)

    def add_tool_call(
        self,
        execution_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        result: Optional[Any] = None,
        error: Optional[str] = None,
    ) -> None:
        """添加工具调用记录。"""
        record = self._records.get(execution_id)
        if not record:
            raise ValueError(f"Record not found: {execution_id}")

        tool_call = {
            "id": str(uuid.uuid4()),
            "tool_name": tool_name,
            "arguments": arguments,
            "result": result,
            "error": error,
            "timestamp": datetime.now().isoformat(),
        }

        record.tool_calls.append(tool_call)
        self._save_record(record)

    def get_record(self, execution_id: str) -> Optional[ExecutionRecord]:
        """获取执行记录。"""
        return self._records.get(execution_id)

    def get_record_dict(self, execution_id: str) -> Optional[Dict[str, Any]]:
        """获取执行记录字典。"""
        record = self._records.get(execution_id)
        if record:
            return self._record_to_dict(record)
        return None

    def list_records(
        self,
        project_name: Optional[str] = None,
        status: Optional[ExecutionStatus] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """列出执行记录。"""
        records = list(self._records.values())

        if project_name:
            records = [r for r in records if r.project_name == project_name]

        if status:
            records = [r for r in records if r.status == status]

        records = sorted(records, key=lambda r: r.start_time, reverse=True)
        records = records[:limit]

        return [self._record_to_dict(r) for r in records]

    def delete_record(self, execution_id: str) -> bool:
        """删除执行记录。"""
        if execution_id not in self._records:
            return False

        del self._records[execution_id]

        record_file = self.storage_path / f"{execution_id}.json"
        if record_file.exists():
            record_file.unlink()

        logger.info(f"Deleted execution record: {execution_id}")
        return True

    def clear_old_records(self, days: int = 30) -> int:
        """清除旧记录。"""
        cutoff = datetime.now()
        removed_count = 0

        for execution_id, record in list(self._records.items()):
            try:
                record_time = datetime.fromisoformat(record.start_time)
                if (cutoff - record_time).days > days:
                    self.delete_record(execution_id)
                    removed_count += 1
            except:
                pass

        logger.info(f"Cleared {removed_count} old records")
        return removed_count

    def get_statistics(
        self,
        project_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """获取执行统计。"""
        records = list(self._records.values())

        if project_name:
            records = [r for r in records if r.project_name == project_name]

        total = len(records)
        completed = sum(1 for r in records if r.status == ExecutionStatus.COMPLETED)
        failed = sum(1 for r in records if r.status == ExecutionStatus.FAILED)

        total_duration = sum(r.duration_ms or 0 for r in records)
        avg_duration = total_duration / total if total > 0 else 0

        total_tokens = sum(
            r.token_usage.get("total_tokens", 0)
            for r in records
        )

        return {
            "total_executions": total,
            "completed": completed,
            "failed": failed,
            "success_rate": round(completed / total * 100, 2) if total > 0 else 0,
            "total_duration_ms": total_duration,
            "avg_duration_ms": round(avg_duration, 2),
            "total_tokens": total_tokens,
        }

    def export_record(
        self,
        execution_id: str,
        format: str = "json",
    ) -> str:
        """导出执行记录。"""
        record = self._records.get(execution_id)
        if not record:
            raise ValueError(f"Record not found: {execution_id}")

        if format == "json":
            return json.dumps(self._record_to_dict(record), indent=2, ensure_ascii=False)
        elif format == "txt":
            lines = [
                f"Execution: {record.execution_id}",
                f"Project: {record.project_name}",
                f"Status: {record.status.value}",
                f"Start: {record.start_time}",
                f"End: {record.end_time or 'N/A'}",
                f"Duration: {record.duration_ms}ms" if record.duration_ms else "Duration: N/A",
                "",
                f"Input: {record.input_message}",
                f"Output: {record.output_message}",
                "",
                "=== Steps ===",
            ]

            for i, step in enumerate(record.steps, 1):
                lines.append(f"\nStep {i}: {step.step_type}")
                lines.append(f"  Node: {step.node_name}")
                if step.thought:
                    lines.append(f"  Thought: {step.thought}")
                if step.action:
                    lines.append(f"  Action: {step.action}")
                if step.observation:
                    lines.append(f"  Observation: {step.observation}")
                if step.error:
                    lines.append(f"  Error: {step.error}")

            if record.tool_calls:
                lines.append("\n=== Tool Calls ===")
                for tc in record.tool_calls:
                    lines.append(f"\n{tc['tool_name']}({tc['arguments']})")
                    if tc.get('result'):
                        lines.append(f"  Result: {tc['result']}")
                    if tc.get('error'):
                        lines.append(f"  Error: {tc['error']}")

            return "\n".join(lines)
        else:
            raise ValueError(f"Unsupported format: {format}")


history_manager = HistoryManager()
