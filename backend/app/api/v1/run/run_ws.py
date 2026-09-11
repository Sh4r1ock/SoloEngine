# -*- coding: utf-8 -*-
import asyncio
import json
import logging
import os
import time
from typing import Dict, List, Optional, Any, Set
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.core.database import get_db, AgenticFlowSessionModel, SessionMessageModel
from app.core.execution_context import execution_context_manager
from SoloAgent.solo_agent.compiler import FlowRunner, CompiledFlowFactory
from SoloAgent.exception.exceptions import SoloEngineException
from SoloAgent.message.message_base import Msg
from app.api.v1.auth import get_current_user
from app.core.auth import User, auth_service
from app.core.config import settings
from app.utils.timezone_utils import format_iso

logger = logging.getLogger("SoloEngine")

from .run_api import router
from .run_api import _active_websockets, _websocket_keys, _websocket_timestamps, _get_timestamp, _make_websocket_key
from .run_collector import ChunkCollector
from .run_context import AgenticFlowRunContext


async def _send_event(websocket: WebSocket, session_id: str, event: Any):
    """发送执行事件到WebSocket客户端。"""
    try:
        await websocket.send_json({
            "type": "execution_event",
            "data": event if isinstance(event, dict) else event.__dict__ if hasattr(event, '__dict__') else str(event),
            "session_id": session_id,
            "timestamp": _get_timestamp()
        })
    except Exception as e:
        logger.error(f"Failed to send event: {e}")


@router.websocket("/ws/{agentic_flow_id}/{session_id}/{run_project_id}")
async def run_websocket(
    websocket: WebSocket, 
    agentic_flow_id: str,
    session_id: str,
    run_project_id: str,
    token: str = Query(None)
):
    """WebSocket端点用于实时运行消息。
    
    URL 格式: /ws/{agentic_flow_id}/{session_id}/{run_project_id}?token=xxx
    """
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return

    # token 验证：复用 AuthService.verify_access_token（含 type==access + user.is_active 完整检查）
    from app.core.auth import auth_service
    valid, user_id = await auth_service.verify_access_token(token)
    if not valid:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await websocket.accept()

    from app.api.v1.websocket_handler import WebSocketRunContext
    run_context = AgenticFlowRunContext(
        user_id=user_id,
        agentic_flow_id=agentic_flow_id,
        session_id=session_id,
        run_project_id=run_project_id,
    )
    ctx = WebSocketRunContext(
        websocket=websocket,
        agentic_flow_id=agentic_flow_id,
        session_id=session_id,
        run_project_id=run_project_id,
        user_id=user_id,
        active_websockets=_active_websockets,
        websocket_keys=_websocket_keys,
        websocket_timestamps=_websocket_timestamps,
        send_event_func=_send_event,
        timestamp_func=_get_timestamp,
        make_key_func=_make_websocket_key,
        chunk_collector_class=ChunkCollector,
        run_context=run_context,
    )
    await ctx.initialize()

    from app.services.file_system_push import ws_registry
    from app.services.workspace_watcher import workspace_watcher

    ws_key = ctx.ws_key
    ws_registry.register(ws_key, session_id, websocket)

    working_dir = await run_context.get_working_dir()
    if working_dir and os.path.exists(working_dir):
        workspace_watcher.start_watching(session_id, working_dir)

    try:
        await ctx.run()
    finally:
        workspace_watcher.stop_watching(session_id)
        ws_registry.unregister(ws_key)


# =============================================================================
# Set 3 统一重构：后端数据构建函数（已删除）
# =============================================================================
# 以下函数已于 Bug 1+Bug 2 修复中删除（无调用方）：
# - build_parent_children_map（被 get_session_messages / build_unified_blocks 调用，现两者已重构）
# - calculate_agent_levels（被 get_session_messages / build_unified_blocks 调用）
# - get_agent_name（被 process_agent 调用）
# - process_agent（被 build_flattened_blocks_for_message / build_unified_blocks 调用）
# - build_flattened_blocks_for_message（被 get_session_messages 调用）
# - build_unified_blocks（无调用方，依赖被删除的 5 个函数）
# 新方案：get_session_messages 内联 build_flattened_blocks，基于 tc.id（task 消息持久化
# source_tool_call_id）精确关联 subagent（流式/回显统一对号，无 message_id 通道）
