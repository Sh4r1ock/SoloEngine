# -*- coding: utf-8 -*-
"""执行历史 API endpoints。"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from ..core.history_manager import history_manager, ExecutionStatus
from ..api.v1.auth import get_current_user
from ..core.auth import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/history", tags=["history"])


class CreateRecordRequest(BaseModel):
    project_name: str
    input_message: Optional[str] = None
    metadata: Optional[dict] = None


class AddStepRequest(BaseModel):
    step_type: str
    node_id: str
    node_name: str
    input_data: dict
    thought: Optional[str] = None
    action: Optional[str] = None


class CompleteStepRequest(BaseModel):
    output_data: Optional[dict] = None
    observation: Optional[str] = None
    error: Optional[str] = None


class AddToolCallRequest(BaseModel):
    tool_name: str
    arguments: dict
    result: Optional[any] = None
    error: Optional[str] = None


class CompleteExecutionRequest(BaseModel):
    output_message: Optional[str] = None
    token_usage: Optional[dict] = None


@router.post("/create")
async def create_record(request: CreateRecordRequest, current_user: User = Depends(get_current_user)):
    """创建执行记录。"""
    record = history_manager.create_record(
        project_name=request.project_name,
        input_message=request.input_message,
        metadata=request.metadata,
    )

    return {
        "code": 200,
        "message": "Execution record created",
        "data": history_manager.get_record_dict(record.execution_id),
    }


@router.post("/{execution_id}/start")
async def start_execution(execution_id: str, current_user: User = Depends(get_current_user)):
    """开始执行。"""
    try:
        history_manager.start_execution(execution_id)
        return {
            "code": 200,
            "message": "Execution started",
            "data": {"execution_id": execution_id, "status": "running"},
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{execution_id}/complete")
async def complete_execution(
    execution_id: str, 
    request: CompleteExecutionRequest,
    current_user: User = Depends(get_current_user)
):
    """完成执行。"""
    try:
        history_manager.complete_execution(
            execution_id=execution_id,
            output_message=request.output_message,
            token_usage=request.token_usage,
        )
        return {
            "code": 200,
            "message": "Execution completed",
            "data": history_manager.get_record_dict(execution_id),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{execution_id}/fail")
async def fail_execution(
    execution_id: str, 
    error: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """执行失败。"""
    try:
        history_manager.fail_execution(execution_id, error)
        return {
            "code": 200,
            "message": "Execution marked as failed",
            "data": history_manager.get_record_dict(execution_id),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{execution_id}/steps")
async def add_step(
    execution_id: str, 
    request: AddStepRequest,
    current_user: User = Depends(get_current_user)
):
    """添加执行步骤。"""
    try:
        step = history_manager.add_step(
            execution_id=execution_id,
            step_type=request.step_type,
            node_id=request.node_id,
            node_name=request.node_name,
            input_data=request.input_data,
            thought=request.thought,
            action=request.action,
        )

        return {
            "code": 200,
            "message": "Step added",
            "data": {
                "step_id": step.step_id,
                "step_type": step.step_type,
                "node_id": step.node_id,
            },
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{execution_id}/steps/{step_id}/complete")
async def complete_step(
    execution_id: str, 
    step_id: str, 
    request: CompleteStepRequest,
    current_user: User = Depends(get_current_user)
):
    """完成执行步骤。"""
    try:
        history_manager.complete_step(
            execution_id=execution_id,
            step_id=step_id,
            output_data=request.output_data,
            observation=request.observation,
            error=request.error,
        )

        return {
            "code": 200,
            "message": "Step completed",
            "data": {"execution_id": execution_id, "step_id": step_id},
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{execution_id}/tool-calls")
async def add_tool_call(
    execution_id: str, 
    request: AddToolCallRequest,
    current_user: User = Depends(get_current_user)
):
    """添加工具调用记录。"""
    try:
        history_manager.add_tool_call(
            execution_id=execution_id,
            tool_name=request.tool_name,
            arguments=request.arguments,
            result=request.result,
            error=request.error,
        )

        return {
            "code": 200,
            "message": "Tool call recorded",
            "data": {"execution_id": execution_id, "tool_name": request.tool_name},
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/list")
async def list_records(
    project_name: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(100, le=1000),
    current_user: User = Depends(get_current_user)
):
    """列出执行记录。"""
    status_enum = None
    if status:
        try:
            status_enum = ExecutionStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    records = history_manager.list_records(
        project_name=project_name,
        status=status_enum,
        limit=limit,
    )

    return {
        "code": 200,
        "message": "Records retrieved",
        "data": records,
    }


@router.get("/{execution_id}")
async def get_record(execution_id: str, current_user: User = Depends(get_current_user)):
    """获取执行记录。"""
    record = history_manager.get_record_dict(execution_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Record '{execution_id}' not found")

    return {
        "code": 200,
        "message": "Record retrieved",
        "data": record,
    }


@router.delete("/{execution_id}")
async def delete_record(execution_id: str, current_user: User = Depends(get_current_user)):
    """删除执行记录。"""
    success = history_manager.delete_record(execution_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Record '{execution_id}' not found")

    return {
        "code": 200,
        "message": "Record deleted",
        "data": {"execution_id": execution_id},
    }


@router.delete("/clear")
async def clear_old_records(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user)
):
    """清除旧记录。"""
    removed_count = history_manager.clear_old_records(days)

    return {
        "code": 200,
        "message": f"Cleared {removed_count} old records",
        "data": {"removed_count": removed_count},
    }


@router.get("/statistics")
async def get_statistics(
    project_name: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """获取执行统计。"""
    stats = history_manager.get_statistics(project_name)

    return {
        "code": 200,
        "message": "Statistics retrieved",
        "data": stats,
    }


@router.get("/{execution_id}/export")
async def export_record(
    execution_id: str, 
    format: str = "json",
    current_user: User = Depends(get_current_user)
):
    """导出执行记录。"""
    try:
        content = history_manager.export_record(execution_id, format)

        if format == "json":
            return {
                "code": 200,
                "message": "Record exported",
                "data": content,
            }
        else:
            return {
                "code": 200,
                "message": "Record exported",
                "data": content,
            }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
