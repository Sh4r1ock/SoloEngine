# -*- coding: utf-8 -*-
"""执行历史管理器 - 使用数据库存储。"""

import json
import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

from .database import (
    db_manager,
    get_db_context,
    AgenticFlowRunModel,
    ExecutionStepModel,
    ToolCallRecordModel,
)

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
    start_time: str = ""
    end_time: Optional[str] = None
    duration_ms: Optional[int] = None
    input_message: Optional[str] = None
    output_message: Optional[str] = None
    steps: List[ExecutionStep] = None
    tool_calls: List[Dict[str, Any]] = None
    token_usage: Dict[str, int] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.steps is None:
            self.steps = []
        if self.tool_calls is None:
            self.tool_calls = []
        if self.token_usage is None:
            self.token_usage = {}
        if self.metadata is None:
            self.metadata = {}


class HistoryManager:
    """执行历史管理器 - 使用数据库存储。"""

    def __init__(self, storage_path: Optional[str] = None):
        """初始化历史管理器。
        
        Args:
            storage_path: 保留参数以兼容旧接口，但不再使用
        """
        if storage_path:
            logger.warning("storage_path parameter is deprecated. HistoryManager now uses database storage.")
        self._records_cache: Dict[str, ExecutionRecord] = {}

    def _db_model_to_record(self, run: AgenticFlowRunModel) -> ExecutionRecord:
        """将数据库模型转换为执行记录。"""
        steps = [
            ExecutionStep(
                step_id=step.id,
                step_type=step.step_type,
                node_id=step.node_id,
                node_name=step.node_name,
                timestamp=step.created_at.isoformat() if step.created_at else "",
                input_data=step.action_input or {},
                output_data={"observation": step.observation} if step.observation else None,
                thought=step.thought,
                action=step.action,
                observation=step.observation,
                error=step.error,
                duration_ms=step.duration_ms,
            )
            for step in run.steps
        ]

        tool_calls = [
            {
                "id": tc.id,
                "tool_name": tc.tool_name,
                "arguments": tc.arguments,
                "result": tc.result,
                "error": tc.error,
                "timestamp": tc.created_at.isoformat() if tc.created_at else "",
            }
            for tc in run.tool_calls
        ]

        return ExecutionRecord(
            execution_id=run.id,
            project_name=run.agentic_flow.name if run.agentic_flow else run.id,
            status=ExecutionStatus(run.status),
            start_time=run.started_at.isoformat() if run.started_at else "",
            end_time=run.completed_at.isoformat() if run.completed_at else None,
            duration_ms=run.duration_ms,
            input_message=run.input_message,
            output_message=run.output_message,
            steps=steps,
            tool_calls=tool_calls,
            token_usage=run.token_usage or {},
            error=run.error,
            metadata={},
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

    def create_record(
        self,
        project_name: str,
        input_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ExecutionRecord:
        """创建执行记录。"""
        with get_db_context() as db:
            run = db_manager.create_run(
                db,
                flow_id=project_name,
                user_id="default_user",
                input_message=input_message,
            )
            record = self._db_model_to_record(run)
            logger.info(f"Created execution record: {run.id}")
            return record

    def start_execution(self, execution_id: str) -> None:
        """开始执行。"""
        with get_db_context() as db:
            db_manager.update_run(
                db,
                run_id=execution_id,
                status="running",
            )
            logger.info(f"Started execution: {execution_id}")

    def complete_execution(
        self,
        execution_id: str,
        output_message: Optional[str] = None,
        token_usage: Optional[Dict[str, int]] = None,
    ) -> None:
        """完成执行。"""
        with get_db_context() as db:
            run = db_manager.get_run(db, execution_id)
            if not run:
                raise ValueError(f"Record not found: {execution_id}")

            end_time = datetime.now(timezone.utc)
            duration_ms = None
            if run.started_at:
                duration_ms = int((end_time - run.started_at).total_seconds() * 1000)

            db_manager.update_run(
                db,
                run_id=execution_id,
                status="completed",
                output_message=output_message,
                token_usage=token_usage,
                completed_at=end_time,
                duration_ms=duration_ms,
            )
            logger.info(f"Completed execution: {execution_id}")

    def fail_execution(
        self,
        execution_id: str,
        error: str,
    ) -> None:
        """执行失败。"""
        with get_db_context() as db:
            run = db_manager.get_run(db, execution_id)
            if not run:
                raise ValueError(f"Record not found: {execution_id}")

            end_time = datetime.now(timezone.utc)
            duration_ms = None
            if run.started_at:
                duration_ms = int((end_time - run.started_at).total_seconds() * 1000)

            db_manager.update_run(
                db,
                run_id=execution_id,
                status="failed",
                error=error,
                completed_at=end_time,
                duration_ms=duration_ms,
            )
            logger.info(f"Failed execution: {execution_id}")

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
        with get_db_context() as db:
            step = db_manager.add_execution_step(
                db,
                run_id=execution_id,
                step_type=step_type,
                node_id=node_id,
                node_name=node_name,
                thought=thought,
                action=action,
                action_input=input_data,
            )
            return ExecutionStep(
                step_id=step.id,
                step_type=step.step_type,
                node_id=step.node_id,
                node_name=step.node_name,
                timestamp=step.created_at.isoformat() if step.created_at else "",
                input_data=step.action_input or {},
                thought=step.thought,
                action=step.action,
            )

    def complete_step(
        self,
        execution_id: str,
        step_id: str,
        output_data: Optional[Dict[str, Any]] = None,
        observation: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        """完成执行步骤。"""
        with get_db_context() as db:
            steps = db.query(ExecutionStepModel).filter(
                ExecutionStepModel.run_id == execution_id,
                ExecutionStepModel.id == step_id
            ).all()

            if not steps:
                raise ValueError(f"Step not found: {step_id}")

            step = steps[0]
            end_time = datetime.now(timezone.utc)
            duration_ms = None
            if step.created_at:
                duration_ms = int((end_time - step.created_at).total_seconds() * 1000)

            step.output_data = output_data
            step.observation = observation
            step.error = error
            step.duration_ms = duration_ms
            db.commit()

    def add_tool_call(
        self,
        execution_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        result: Optional[Any] = None,
        error: Optional[str] = None,
    ) -> None:
        """添加工具调用记录。"""
        with get_db_context() as db:
            db_manager.add_tool_call(
                db,
                run_id=execution_id,
                tool_name=tool_name,
                arguments=arguments,
                result=str(result) if result else None,
                error=error,
            )
            logger.info(f"Added tool call: {tool_name} for execution: {execution_id}")

    def get_record(self, execution_id: str) -> Optional[ExecutionRecord]:
        """获取执行记录。"""
        with get_db_context() as db:
            run = db_manager.get_run(db, execution_id)
            if run:
                return self._db_model_to_record(run)
            return None

    def get_record_dict(self, execution_id: str) -> Optional[Dict[str, Any]]:
        """获取执行记录字典。"""
        record = self.get_record(execution_id)
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
        with get_db_context() as db:
            query = db.query(AgenticFlowRunModel)
            
            if status:
                query = query.filter(AgenticFlowRunModel.status == status.value)
            
            runs = query.order_by(AgenticFlowRunModel.started_at.desc()).limit(limit).all()
            
            if project_name:
                runs = [r for r in runs if r.agentic_flow and r.agentic_flow.name == project_name]
            
            return [self._record_to_dict(self._db_model_to_record(r)) for r in runs]

    def delete_record(self, execution_id: str) -> bool:
        """删除执行记录。"""
        with get_db_context() as db:
            run = db_manager.get_run(db, execution_id)
            if not run:
                return False

            db.delete(run)
            db.commit()
            logger.info(f"Deleted execution record: {execution_id}")
            return True

    def clear_old_records(self, days: int = 30) -> int:
        """清除旧记录。"""
        with get_db_context() as db:
            cutoff = datetime.now(timezone.utc)
            old_runs = db.query(AgenticFlowRunModel).filter(
                AgenticFlowRunModel.started_at < cutoff
            ).all()
            
            removed_count = 0
            for run in old_runs:
                if run.started_at and (cutoff - run.started_at).days > days:
                    db.delete(run)
                    removed_count += 1
            
            db.commit()
            logger.info(f"Cleared {removed_count} old records")
            return removed_count

    def get_statistics(
        self,
        project_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """获取执行统计。"""
        with get_db_context() as db:
            query = db.query(AgenticFlowRunModel)
            
            if project_name:
                runs = [r for r in query.all() if r.agentic_flow and r.agentic_flow.name == project_name]
            else:
                runs = query.all()
            
            total = len(runs)
            completed = sum(1 for r in runs if r.status == "completed")
            failed = sum(1 for r in runs if r.status == "failed")

            total_duration = sum(r.duration_ms or 0 for r in runs)
            avg_duration = total_duration / total if total > 0 else 0

            total_tokens = sum(
                r.token_usage.get("total_tokens", 0) if r.token_usage else 0
                for r in runs
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
        record = self.get_record(execution_id)
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
