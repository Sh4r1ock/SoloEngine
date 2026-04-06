# -*- coding: utf-8 -*-
"""
运行 API endpoints。

@file run.py
@description 运行接口 - 工作流运行相关API端点
@author SoloEngine Team
@date 2026-02-19

功能描述：
- JSON工作流执行接口
- 单节点执行接口
- 运行会话管理接口
- 执行历史查询接口
- WebSocket实时通信端点

使用场景：
- 工作流运行管理
- 执行历史查询

注意事项：
- 会话数据存储在SQLite数据库中
"""
import asyncio
import json
import os
import logging
from typing import Dict, List, Optional, Any, Set
from datetime import datetime, timezone
import uuid


def format_datetime(dt: datetime) -> Optional[str]:
    """格式化 datetime 为 ISO 格式字符串，确保包含 UTC 时区信息。"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.isoformat()
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db, db_manager, AgenticFlowSessionModel, SessionMessageModel, get_db_context, get_db_context_async
from SoloAgent.solo_agent.compiler import AgenticFlowCompiler, FlowRunner, CompiledFlowFactory
from app.api.v1.auth import get_current_user
from app.core.auth import User, auth_service
from app.core.config import settings
from app.core.execution_context import execution_context_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/run", tags=["run"])


class ChunkCollector:
    """收集流式chunk并合并，支持多agent和堆栈作用域"""
    
    def __init__(self):
        self._chunks = []
        self._agent_data = {}
        self._current_agent_id = None
        self._current_agent_name = None
        self._current_block = {}
        self._pending_tool_calls = {}
        self._state_stack = []
        self._root_agent_id = None
    
    def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
        """添加chunk，支持agent_id分组和堆栈作用域"""
        if agent_id:
            if self._current_agent_id is None:
                self._root_agent_id = agent_id
                self._current_agent_id = agent_id
                self._current_agent_name = agent_name
            elif agent_id != self._current_agent_id:
                self._handle_agent_switch(agent_id, agent_name)
        
        if self._current_agent_id and self._current_agent_id not in self._agent_data:
            self._agent_data[self._current_agent_id] = {
                'agent_name': self._current_agent_name,
                'data': []
            }
        
        chunk_type = self._normalize_type(delta)
        content = self._extract_content(delta, chunk_type)
        
        if chunk_type != 'tool_calls' and not content:
            return
        if chunk_type == 'tool_calls' and not content:
            return
        
        if chunk_type == 'tool_calls':
            self._process_tool_calls(content)
        else:
            if self._current_block and self._current_block.get('type') == chunk_type:
                self._current_block[chunk_type] = (self._current_block.get(chunk_type, "") or "") + content
            else:
                if self._current_block:
                    self._agent_data[self._current_agent_id]['data'].append(self._current_block)
                    self._current_block['_added_to_agent_data'] = True
                self._current_block = {chunk_type: content, 'type': chunk_type}
        
        self._chunks.append({'delta': delta, 'agent_id': agent_id})
    
    def _process_tool_calls(self, tool_calls: list):
        """处理tool_calls，合并调用和result"""
        agent_id = self._current_agent_id
        if agent_id not in self._pending_tool_calls:
            self._pending_tool_calls[agent_id] = {}
        
        if 'index_to_id' not in self._pending_tool_calls[agent_id]:
            self._pending_tool_calls[agent_id]['index_to_id'] = {}
        
        for new_tc in tool_calls:
            tool_id = new_tc.get('id')
            tool_index = new_tc.get('index')
            has_result = 'result' in new_tc or 'error' in new_tc
            
            if tool_id and tool_index is not None:
                self._pending_tool_calls[agent_id]['index_to_id'][tool_index] = tool_id
            
            if not tool_id and tool_index is not None:
                tool_id = self._pending_tool_calls[agent_id]['index_to_id'].get(tool_index)
            
            if tool_id and tool_id in self._pending_tool_calls[agent_id]:
                import copy
                existing_tc = self._pending_tool_calls[agent_id][tool_id]
                for key, value in new_tc.items():
                    if key == 'function' and isinstance(value, dict):
                        if 'function' not in existing_tc:
                            existing_tc['function'] = {}
                        for func_key, func_value in value.items():
                            if func_key == 'arguments':
                                existing_tc['function']['arguments'] = existing_tc['function'].get('arguments', '') + func_value
                            else:
                                if func_key not in existing_tc['function']:
                                    existing_tc['function'][func_key] = func_value
                    elif key in ['result', 'error', 'status']:
                        existing_tc[key] = copy.deepcopy(value)
                    elif key not in existing_tc or existing_tc.get(key) is None:
                        existing_tc[key] = copy.deepcopy(value) if isinstance(value, (dict, list)) else value
                
                if has_result:
                    if self._current_block and self._current_block.get('type') == 'tool_calls':
                        self._current_block['tool_calls'].append(existing_tc)
                    else:
                        if self._current_block:
                            self._agent_data[agent_id]['data'].append(self._current_block)
                        self._current_block = {'type': 'tool_calls', 'tool_calls': [existing_tc]}
                    del self._pending_tool_calls[agent_id][tool_id]
            elif tool_id and not has_result:
                import copy
                self._pending_tool_calls[agent_id][tool_id] = copy.deepcopy(new_tc)
            elif tool_id:
                import copy
                self._pending_tool_calls[agent_id][tool_id] = copy.deepcopy(new_tc)
                if has_result:
                    if self._current_block and self._current_block.get('type') == 'tool_calls':
                        self._current_block['tool_calls'].append(self._pending_tool_calls[agent_id][tool_id])
                    else:
                        if self._current_block:
                            self._agent_data[agent_id]['data'].append(self._current_block)
                        self._current_block = {'type': 'tool_calls', 'tool_calls': [self._pending_tool_calls[agent_id][tool_id]]}
                    del self._pending_tool_calls[agent_id][tool_id]
            else:
                import copy
                copied_tc = copy.deepcopy(new_tc)
                if self._current_block and self._current_block.get('type') == 'tool_calls':
                    self._current_block['tool_calls'].append(copied_tc)
                else:
                    if self._current_block:
                        self._agent_data[agent_id]['data'].append(self._current_block)
                    self._current_block = {'type': 'tool_calls', 'tool_calls': [copied_tc]}
    
    def _normalize_type(self, delta: dict) -> str:
        if isinstance(delta, str):
            return 'content'
        raw_type = delta.get("type", None)
        if raw_type in ('thinking', 'think', 'reason', 'reasoning_content'):
            return 'reasoning_content'
        if raw_type in ('tool_use', 'tool_call', 'tool_calls') or 'tool_calls' in delta:
            return 'tool_calls'
        if 'reasoning_content' in delta and delta.get('reasoning_content'):
            return 'reasoning_content'
        if 'content' in delta:
            return 'content'
        return 'content'
    
    def _extract_content(self, delta: dict, chunk_type: str):
        if isinstance(delta, str):
            return delta
        if chunk_type == 'reasoning_content':
            return delta.get('reasoning_content', '') or delta.get('thinking', '') or delta.get('text', '')
        elif chunk_type == 'tool_calls':
            return delta.get('tool_calls', [])
        else:
            return delta.get('content', '') or delta.get('text', '')
    
    def _handle_agent_switch(self, new_agent_id: str, new_agent_name: str):
        """处理 agent 切换，使用堆栈保存/恢复状态"""
        if new_agent_id == self._root_agent_id:
            while self._state_stack:
                self._pop_state()
        else:
            self._push_state()
            self._current_agent_id = new_agent_id
            self._current_agent_name = new_agent_name
    
    def _push_state(self):
        """保存当前状态到堆栈（SubAgent 进入）"""
        self._state_stack.append({
            'agent_id': self._current_agent_id,
            'agent_name': self._current_agent_name,
            'current_block': self._current_block,
            'pending_tool_calls': self._pending_tool_calls.get(self._current_agent_id, {})
        })
        self._current_block = {}
        logger.debug(f"[ChunkCollector] Push state: {self._current_agent_id}")
    
    def _pop_state(self):
        """从堆栈恢复状态（SubAgent 退出）"""
        if self._current_block and self._current_agent_id and not self._current_block.get('_added_to_agent_data'):
            if self._current_agent_id not in self._agent_data:
                self._agent_data[self._current_agent_id] = {
                    'agent_name': self._current_agent_name,
                    'data': []
                }
            self._agent_data[self._current_agent_id]['data'].append(self._current_block)
            self._current_block['_added_to_agent_data'] = True
        
        if self._state_stack:
            state = self._state_stack.pop()
            self._current_agent_id = state['agent_id']
            self._current_agent_name = state['agent_name']
            self._current_block = state['current_block']
            if self._current_agent_id not in self._pending_tool_calls:
                self._pending_tool_calls[self._current_agent_id] = {}
            self._pending_tool_calls[self._current_agent_id].update(state['pending_tool_calls'])
            logger.debug(f"[ChunkCollector] Pop state: -> {self._current_agent_id}")
    
    def get_agent_data(self) -> dict:
        while self._state_stack:
            self._pop_state()
        
        if self._current_block and self._current_agent_id and not self._current_block.get('_added_to_agent_data'):
            if self._current_agent_id not in self._agent_data:
                self._agent_data[self._current_agent_id] = {
                    'agent_name': self._current_agent_name,
                    'data': []
                }
            self._agent_data[self._current_agent_id]['data'].append(self._current_block)
            self._current_block = {}
        
        for agent_id, pending in self._pending_tool_calls.items():
            if agent_id not in self._agent_data:
                self._agent_data[agent_id] = {
                    'agent_name': None,
                    'data': []
                }
            
            existing_tool_ids = set()
            for block in self._agent_data[agent_id]['data']:
                if block.get('type') == 'tool_calls':
                    for tc in block.get('tool_calls', []):
                        if tc.get('id'):
                            existing_tool_ids.add(tc['id'])
            
            new_tool_calls = []
            for tool_id, tc in pending.items():
                if tool_id == 'index_to_id':
                    continue
                if tool_id not in existing_tool_ids:
                    new_tool_calls.append(tc)
            
            if new_tool_calls:
                self._agent_data[agent_id]['data'].append({
                    'type': 'tool_calls',
                    'tool_calls': new_tool_calls
                })
        
        for agent_id in list(self._agent_data.keys()):
            cleaned_data = []
            for block in self._agent_data[agent_id]['data']:
                block_type = block.get('type')
                if block_type == 'content' and not block.get('content', '').strip():
                    continue
                if block_type == 'reasoning_content' and not block.get('reasoning_content', '').strip():
                    continue
                if block_type == 'tool_calls' and not block.get('tool_calls', []):
                    continue
                cleaned_data.append(block)
            self._agent_data[agent_id]['data'] = cleaned_data
        
        return self._agent_data
    
    def get_merged_data(self) -> list:
        agent_data = self.get_agent_data()
        for agent_id, data in agent_data.items():
            return data['data']
        return []
    
    def get_chunk_count(self) -> int:
        return len(self._chunks)
    
    def get_agent_ids(self) -> list:
        return list(self._agent_data.keys())


async def save_session_message(
    db: Session, session_id: str, user_id: str, role: str,
    data: list, status: str = "completed", agent_id: str = "default",
    tokens: dict = None,
    agentic_flow_id: str = None,
    run_project_id: str = None,
    parent_message_id: str = None,
    parent_agent_id: str = None
):
    """保存session消息到数据库
    
    Args:
        db: 数据库会话
        session_id: 会话ID
        user_id: 用户ID
        role: 角色（user/assistant）
        data: 消息数据列表，如果手动停止且没有chunk则为空列表[]
        status: 消息状态（completed/stopped/error）
        agent_id: Agent ID
        tokens: token使用信息
        agentic_flow_id: AgenticFlow ID（用于创建新session时）
        run_project_id: Run Project ID（用于创建新session时）
        parent_message_id: 父消息ID
        parent_agent_id: 父Agent ID（用于关联SubAgent与MainAgent）
    """
    from app.core.database import SessionMessageModel, func, AgenticFlowSessionModel
    
    if data is None:
        data = []
    
    if not agent_id:
        agent_id = "default"
    
    try:
        session = db.query(AgenticFlowSessionModel).filter(
            AgenticFlowSessionModel.id == session_id
        ).first()
        
        if not session:
            if not agentic_flow_id or not run_project_id:
                raise ValueError("agentic_flow_id and run_project_id are required to create a new session")
            session = AgenticFlowSessionModel(
                id=session_id,
                user_id=user_id,
                agentic_flow_id=agentic_flow_id,
                run_project_id=run_project_id,
                status="pending",
            )
            db.add(session)
            db.commit()
            logger.info(f"Created new session {session_id} when saving message")
        
        max_index = db.query(func.max(SessionMessageModel.message_index)).filter(
            SessionMessageModel.session_id == session_id
        ).scalar()
        
        if max_index is None:
            max_index = -1
        
        message = SessionMessageModel(
            session_id=session_id,
            user_id=user_id,
            agent_id=agent_id,
            parent_agent_id=parent_agent_id,
            role=role,
            data=data,
            status=status,
            message_index=max_index + 1,
            parent_message_id=parent_message_id
        )
        
        if tokens:
            message.prompt_tokens = tokens.get('prompt_tokens')
            message.completion_tokens = tokens.get('completion_tokens')
            message.total_tokens = tokens.get('total_tokens')
        
        db.add(message)
        db.commit()
        db.refresh(message)
        logger.info(f"Saved {role} message to session {session_id}: message_id={message.id}, {len(data)} blocks, status={status}")
        return message
    except Exception as e:
        logger.error(f"Failed to save message: {e}")
        db.rollback()
        raise


async def load_and_distribute_memories(
    db: Session, 
    session_id: str, 
    user_id: str
) -> Dict[str, List[Dict]]:
    """从数据库读取记忆并按 agent_id 分发
    
    应用过滤模式：tool_calls[].result 中的完整 JSON 只提取 content 字段
    
    关键修复：对于包含 tool_calls 的 assistant 消息，必须在后面添加对应的 tool 结果消息，
    以满足 OpenAI API 的要求（tool_calls 后必须有 tool 消息响应）
    """
    from app.core.database import SessionMessageModel
    
    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id
    ).order_by(SessionMessageModel.message_index).all()
    
    agent_memories = {}
    shared_memories = []
    
    for record in records:
        data = record.data or []
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                data = []
        
        filtered_data = _filter_tool_results(data)
        
        message = {
            "role": record.role,
            "content": filtered_data,
            "agent_id": record.agent_id
        }
        
        if record.agent_id and record.agent_id != "default":
            if record.agent_id not in agent_memories:
                agent_memories[record.agent_id] = []
            agent_memories[record.agent_id].append(message)
        else:
            shared_memories.append(message)
        

    
    for agent_id in agent_memories:
        agent_memories[agent_id] = shared_memories + agent_memories[agent_id]
    
    if not agent_memories and shared_memories:
        agent_memories["default"] = shared_memories
    
    return agent_memories


def _filter_tool_results(data: list) -> list:
    """
    过滤 tool_calls 中的 result，提取 content 字段。
    
    当 tool_calls[].result 是 dict 时，只提取 content 字段传递给模型。
    这样模型上下文中只包含 content 字段，而数据库中存储完整 JSON。
    
    Args:
        data (list): 消息数据块列表。
    
    Returns:
        list: 过滤后的数据块列表。
    """
    if not isinstance(data, list):
        return data
    
    filtered = []
    for block in data:
        if not isinstance(block, dict):
            filtered.append(block)
            continue
            
        if block.get("type") == "tool_calls":
            filtered_block = {"type": "tool_calls", "tool_calls": []}
            for tc in block.get("tool_calls", []):
                filtered_tc = tc.copy()
                if "result" in tc and isinstance(tc["result"], dict):
                    if "content" in tc["result"]:
                        filtered_tc["result"] = tc["result"]["content"]
                    elif "result" in tc["result"]:
                        filtered_tc["result"] = tc["result"]["result"]
                filtered_block["tool_calls"].append(filtered_tc)
            filtered.append(filtered_block)
        else:
            filtered.append(block)
    return filtered


def _extract_content_from_data(data: list) -> str:
    """从 data 字段提取文本内容"""
    if not data:
        return ""
    for item in data:
        if item.get("type") == "content":
            return item.get("content", "")
    return ""


class ExecuteJSONRequest(BaseModel):
    canvas_data: Dict[str, Any] = Field(..., description="画布JSON数据")
    input_message: str = Field(..., description="输入消息")
    project_name: Optional[str] = Field(None, description="项目名称")
    context: Optional[Dict[str, Any]] = Field(None, description="执行上下文")
    agentic_flow_id: str = Field(..., description="AgenticFlow ID（必需）")
    session_id: str = Field(..., description="会话ID（必需）")
    run_project_id: str = Field(..., description="项目ID（必需）")


class ExecuteNodeRequest(BaseModel):
    canvas_data: Dict[str, Any] = Field(..., description="画布JSON数据")
    node_id: str = Field(..., description="节点ID")
    input_message: str = Field(..., description="输入消息")
    context: Optional[Dict[str, Any]] = Field(None, description="执行上下文")
    agentic_flow_id: str = Field(..., description="AgenticFlow ID（必需，用于数据隔离）")
    session_id: str = Field(..., description="会话ID（必需，用于数据隔离）")
    run_project_id: str = Field(..., description="项目ID（必需，用于数据隔离）")
    user_id: Optional[str] = Field(None, description="用户ID（可选，不传则使用当前登录用户）")


class RunMessage(BaseModel):
    type: str
    data: Dict[str, Any]
    session_id: str
    timestamp: float


_active_websockets: Dict[str, WebSocket] = {}
_websocket_keys: Dict[str, Dict[str, str]] = {}
_websocket_timestamps: Dict[str, float] = {}
_cleanup_task: Optional[asyncio.Task] = None


def _make_websocket_key(user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> str:
    """生成 WebSocket 存储的 key - 四参数隔离"""
    return f"{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}"


async def _cleanup_stale_connections():
    """定期清理超时的WebSocket连接。"""
    while True:
        try:
            await asyncio.sleep(60)
            current_time = datetime.now().timestamp()
            stale_keys = []
            
            for ws_key, ws in list(_active_websockets.items()):
                try:
                    if hasattr(ws, 'client_state') and ws.client_state.name == "DISCONNECTED":
                        stale_keys.append(ws_key)
                    elif ws_key in _websocket_timestamps:
                        if current_time - _websocket_timestamps[ws_key] > settings.RUN_SESSION_TIMEOUT:
                            stale_keys.append(ws_key)
                except Exception:
                    stale_keys.append(ws_key)
            
            for ws_key in stale_keys:
                ws = _active_websockets.pop(ws_key, None)
                _websocket_timestamps.pop(ws_key, None)
                _websocket_keys.pop(ws_key, None)
                if ws:
                    try:
                        await ws.close(code=1001, reason="Connection timeout")
                    except Exception:
                        pass
                logger.info(f"Cleaned up stale WebSocket connection: {ws_key}")
                
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in WebSocket cleanup task: {e}")


@router.on_event("startup")
async def startup_event():
    """应用启动时启动清理任务。"""
    global _cleanup_task
    _cleanup_task = asyncio.create_task(_cleanup_stale_connections())
    logger.info("WebSocket cleanup task started")


@router.on_event("shutdown")
async def shutdown_event():
    """应用关闭时停止清理任务。"""
    global _cleanup_task
    if _cleanup_task:
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
    logger.info("WebSocket cleanup task stopped")


def _get_timestamp() -> float:
    return datetime.now().timestamp()


async def _broadcast_message(session_id: str, message: RunMessage):
    ws = _active_websockets.get(session_id)
    if ws:
        try:
            await ws.send_json(message.dict())
        except Exception:
            _active_websockets.pop(session_id, None)


@router.post("/execute")
async def execute_workflow(
    request: ExecuteJSONRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """执行JSON工作流。"""
    try:
        result = await FlowRunner.run_from_json(
            request.canvas_data,
            request.input_message,
            user_id=current_user.id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
            context=request.context or {}
        )
        
        return {
            "code": 200,
            "message": "Workflow executed",
            "data": result
        }
    except Exception as e:
        logger.error(f"Workflow execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute-node")
async def execute_single_node(
    request: ExecuteNodeRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """执行单个节点。"""
    try:
        result = await FlowRunner.run_node(
            request.canvas_data,
            request.node_id,
            request.input_message,
            user_id=current_user.id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
            context=request.context or {}
        )
        
        return {
            "code": 200,
            "message": "Node executed",
            "data": result
        }
    except Exception as e:
        logger.error(f"Node execution failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stream")
async def stream_workflow(
    request: ExecuteJSONRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """SSE流式执行工作流 - 作为WebSocket的降级方案。"""
    import asyncio
    
    stream_queue = asyncio.Queue()
    execution_result = None
    execution_error = None
    collector = ChunkCollector()
    
    def stream_callback(delta: dict):
        try:
            collector.add_chunk(delta)
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(stream_queue.put(delta))
        except Exception as e:
            logger.error(f"Stream callback error: {e}")
    
    async def run_execution():
        nonlocal execution_result, execution_error
        try:
            result = await FlowRunner.run_from_json(
                request.canvas_data,
                request.input_message,
                user_id=current_user.id,
                agentic_flow_id=request.agentic_flow_id,
                session_id=request.session_id,
                run_project_id=request.run_project_id,
                context=request.context or {},
                stream_callback=stream_callback
            )
            execution_result = result
        except Exception as e:
            execution_error = e
        finally:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(stream_queue.put(None))
            except:
                pass
    
    async def event_generator():
        execution_task = asyncio.create_task(run_execution())
        
        try:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Starting execution...'}, ensure_ascii=False)}\n\n"
            
            while True:
                try:
                    delta = await asyncio.wait_for(stream_queue.get(), timeout=1.0)
                    if delta is None:
                        break
                    yield f"data: {json.dumps({'type': 'stream', 'delta': delta}, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    if execution_task.done():
                        break
                    continue
            
            await execution_task
            
            if execution_error:
                status = "error"
                yield f"data: {json.dumps({'type': 'error', 'message': str(execution_error)}, ensure_ascii=False)}\n\n"
            else:
                status = "completed"
                openai_message = execution_result.get("message", {"role": "assistant", "content": execution_result.get("output", "")})
                yield f"data: {json.dumps({'type': 'execution_complete', 'message': openai_message, 'data': execution_result}, ensure_ascii=False)}\n\n"
            
            if request.session_id:
                try:
                    user_data = [{"type": "content", "content": request.input_message}]
                    await save_session_message(
                        db=db, session_id=request.session_id, user_id=current_user.id,
                        role="user", data=user_data, agent_id="default",
                        agentic_flow_id=request.agentic_flow_id, run_project_id=request.run_project_id
                    )
                    
                    agent_data = collector.get_agent_data()
                    if agent_data:
                        for agent_id_key, agent_info in agent_data.items():
                            data = agent_info['data']
                            if not data:
                                data = [{"type": "content", "content": f"Status: {status}"}]
                            await save_session_message(
                                db=db, session_id=request.session_id, user_id=current_user.id,
                                role="assistant", data=data, status=status, agent_id=agent_id_key,
                                agentic_flow_id=request.agentic_flow_id, run_project_id=request.run_project_id
                            )
                    else:
                        await save_session_message(
                            db=db, session_id=request.session_id, user_id=current_user.id,
                            role="assistant", 
                            data=[{"type": "content", "content": execution_result.get("output", "") if execution_result else ""}],
                            status=status, agent_id="default",
                            agentic_flow_id=request.agentic_flow_id, run_project_id=request.run_project_id
                        )
                except Exception as save_error:
                    logger.error(f"Failed to save session messages: {save_error}")
                
        except Exception as e:
            logger.error(f"SSE stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/sessions")
async def get_sessions(
    agentic_flow_id: str = Query(..., description="流程ID，必需"),
    run_project_id: str = Query(..., description="项目ID，必需"),
    status: Optional[str] = Query(None, description="状态过滤"),
    limit: int = Query(50, description="返回数量限制"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取运行会话列表。
    
    必须传入 agentic_flow_id、user_id、run_project_id 进行隔离。
    """
    query = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.user_id == current_user.id,
        AgenticFlowSessionModel.agentic_flow_id == agentic_flow_id,
        AgenticFlowSessionModel.run_project_id == run_project_id
    )
    
    if status:
        query = query.filter(AgenticFlowSessionModel.status == status)
    
    sessions = query.order_by(AgenticFlowSessionModel.created_at.desc()).limit(limit).all()
    
    result = []
    for s in sessions:
        first_assistant_msg = db.query(SessionMessageModel).filter(
            SessionMessageModel.session_id == s.id,
            SessionMessageModel.role == 'assistant'
        ).order_by(SessionMessageModel.message_index).first()
        
        first_assistant_content = None
        if first_assistant_msg and first_assistant_msg.data:
            for block in first_assistant_msg.data:
                if block.get('type') == 'content' and block.get('content'):
                    first_assistant_content = block['content'][:30]
                    break
        
        result.append({
            "id": s.id,
            "agentic_flow_id": s.agentic_flow_id,
            "run_project_id": s.run_project_id,
            "status": s.status,
            "error": s.error,
            "token_usage": s.token_usage,
            "started_at": format_datetime(s.started_at),
            "completed_at": format_datetime(s.completed_at),
            "created_at": format_datetime(s.created_at),
            "updated_at": format_datetime(s.updated_at),
            "duration_ms": s.duration_ms,
            "first_assistant_content": first_assistant_content,
        })

    return {
        "code": 200,
        "message": "Sessions retrieved",
        "data": result
    }


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取运行会话详情。"""
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "code": 200,
        "message": "Session retrieved",
        "data": {
            "id": session.id,
            "status": session.status,
            "error": session.error,
            "token_usage": session.token_usage,
            "started_at": format_datetime(session.started_at),
            "completed_at": format_datetime(session.completed_at),
            "created_at": format_datetime(session.created_at),
            "updated_at": format_datetime(session.updated_at),
            "duration_ms": session.duration_ms
        }
    }


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """删除运行会话及其所有消息。"""
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    db.delete(session)
    db.commit()
    
    return {
        "code": 200,
        "message": "Session deleted successfully",
        "data": {"id": session_id}
    }


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话消息列表（统一格式）。
    
    所有消息的 data 都包含 agent_level 字段：
    - user 消息：agent_level = 0
    - assistant 消息：根据层级计算 agent_level
    
    注意：在扁平化拼接过程中被使用的 SubAgent 消息不会单独返回，
    而是作为其父消息的一部分返回。
    """
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # 查询所有消息
    messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == current_user.id
    ).order_by(SessionMessageModel.message_index).offset(offset).limit(limit).all()
    
    # 构建 parent_children_map 和 agent_levels（用于 assistant 消息处理）
    parent_children_map = build_parent_children_map(messages)
    agent_levels = calculate_agent_levels(messages)
    
    # 创建全局可用的 children 映射表（会被 process_agent 修改）
    available_children = {
        parent_id: children.copy()
        for parent_id, children in parent_children_map.items()
    }
    
    # 辅助函数：检查消息是否还在 available_children 中（未被使用）
    def is_message_available(msg_id: str) -> bool:
        for children in available_children.values():
            for child in children:
                if child.id == msg_id:
                    return True
        return False
    
    # 处理每条消息
    result = []
    for m in messages:
        if m.role == 'user':
            # user 消息：统一格式，添加 agent_level = 0
            unified_data = []
            for block in m.data or []:
                unified_data.append({
                    **block,
                    'agent_id': None,
                    'agent_name': '用户',
                    'agent_level': 0
                })
            result.append({
                "id": m.id,
                "role": m.role,
                "agent_id": m.agent_id,
                "data": unified_data,
                "status": m.status,
                "message_index": m.message_index,
                "prompt_tokens": m.prompt_tokens,
                "completion_tokens": m.completion_tokens,
                "total_tokens": m.total_tokens,
                "created_at": format_datetime(m.created_at)
            })
        else:
            # assistant 消息：检查是否还在 available_children 中
            # 如果不在，说明已被作为 SubAgent 拼接到父消息中，跳过
            if m.agent_id and not is_message_available(m.id):
                continue
            
            # assistant 消息：使用扁平化 blocks
            flattened_blocks = build_flattened_blocks_for_message(
                m, available_children, agent_levels
            )
            result.append({
                "id": m.id,
                "role": m.role,
                "agent_id": m.agent_id,
                "data": flattened_blocks,
                "status": m.status,
                "message_index": m.message_index,
                "prompt_tokens": m.prompt_tokens,
                "completion_tokens": m.completion_tokens,
                "total_tokens": m.total_tokens,
                "created_at": format_datetime(m.created_at)
            })
    
    return {
        "code": 200,
        "message": "Messages retrieved",
        "data": result
    }


@router.get("/sessions/{session_id}/messages/by-agent")
async def get_session_messages_by_agent(
    session_id: str,
    agent_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取会话消息列表，按 agent_id 分组。
    
    根据 session_id、user_id 和可选的 agent_id 获取消息。
    """
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    query = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == current_user.id
    )
    
    if agent_id:
        query = query.filter(SessionMessageModel.agent_id == agent_id)
    
    messages = query.order_by(SessionMessageModel.message_index).all()
    
    agent_messages = {}
    for m in messages:
        if m.agent_id not in agent_messages:
            agent_messages[m.agent_id] = []
        agent_messages[m.agent_id].append({
            "id": m.id,
            "role": m.role,
            "agent_id": m.agent_id,
            "data": m.data,
            "status": m.status,
            "message_index": m.message_index,
            "prompt_tokens": m.prompt_tokens,
            "completion_tokens": m.completion_tokens,
            "total_tokens": m.total_tokens,
            "created_at": format_datetime(m.created_at)
        })
    
    return {
        "code": 200,
        "message": "Messages retrieved by agent",
        "data": agent_messages
    }


@router.get("/sessions/{session_id}/export")
async def export_session(
    session_id: str, 
    format: str = "json", 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """导出会话数据。"""
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id
    ).order_by(SessionMessageModel.message_index).all()

    if format == "json":
        data = {
            "id": session.id,
            "status": session.status,
            "error": session.error,
            "token_usage": session.token_usage,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "completed_at": session.completed_at.isoformat() if session.completed_at else None,
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "timestamp": m.timestamp.isoformat() if m.timestamp else None
                }
                for m in messages
            ]
        }
        return {
            "code": 200,
            "message": "Session exported",
            "data": data
        }
    else:
        content = f"Session: {session.id}\n"
        content += f"Status: {session.status}\n"
        content += f"Messages: {len(messages)}\n"
        for m in messages:
            content += f"  [{m.role}]: {m.content[:100]}...\n"
        return {
            "code": 200,
            "message": "Session exported",
            "data": {"content": content}
        }


@router.post("/clear-cache/{user_id}/{agentic_flow_id}/{session_id}/{run_project_id}")
async def clear_flow_cache(
    user_id: str,
    agentic_flow_id: str,
    session_id: str,
    run_project_id: str,
    current_user: User = Depends(get_current_user)
):
    """清除指定 Flow 的编译缓存。"""
    removed = CompiledFlowFactory.remove(user_id, agentic_flow_id, session_id, run_project_id)
    return {
        "code": 200,
        "message": "Cache cleared" if removed else "Cache not found",
        "data": {"user_id": user_id, "agentic_flow_id": agentic_flow_id, "session_id": session_id, "run_project_id": run_project_id, "removed": removed}
    }


@router.post("/clear-cache")
async def clear_all_cache(
    current_user: User = Depends(get_current_user)
):
    """清除所有编译缓存。"""
    CompiledFlowFactory.clear_all()
    return {
        "code": 200,
        "message": "All cache cleared",
        "data": CompiledFlowFactory.get_stats()
    }


@router.get("/cache-stats")
async def get_cache_stats(
    current_user: User = Depends(get_current_user)
):
    """获取缓存统计信息。"""
    return {
        "code": 200,
        "message": "Cache stats retrieved",
        "data": CompiledFlowFactory.get_stats()
    }


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
    
    修复说明：
    - 修复了 asyncio.wait 任务分发缺陷导致的1-2轮对话后断连问题
    - 将数据库会话从长期持有改为按需创建的短期会话
    - 增强了异常处理和错误通知机制
    - 增加了消息接收器容错能力
    """
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return
    
    payload = auth_service.decode_token(token)
    if not payload or payload.get("type") != "access":
        await websocket.close(code=4001, reason="Invalid or expired token")
        return
    
    user_id = payload.get("sub")
    if not user_id:
        await websocket.close(code=4001, reason="Invalid token payload")
        return
    
    user = await auth_service.get_user(user_id)
    if not user or not user.is_active:
        await websocket.close(code=4001, reason="User not found or inactive")
        return

    await websocket.accept()
    
    ws_key = _make_websocket_key(user_id, agentic_flow_id, session_id, run_project_id)
    _active_websockets[ws_key] = websocket
    _websocket_keys[ws_key] = {
        "agentic_flow_id": agentic_flow_id,
        "session_id": session_id,
        "run_project_id": run_project_id,
        "user_id": user_id,
    }
    _websocket_timestamps[ws_key] = _get_timestamp()

    stored_canvas_data: Dict = {}
    
    def event_callback(event):
        """事件回调函数 - 在同步上下文中调度异步发送"""
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_send_event(websocket, session_id, event))
        except Exception as e:
            logger.error(f"Event callback error: {e}")

    # 使用短期会话初始化数据（不再长期持有）
    session = None
    agent_memories = {}
    
    async with get_db_context_async() as init_db:
        session = init_db.query(AgenticFlowSessionModel).filter(
            AgenticFlowSessionModel.id == session_id
        ).first()
        
        if session:
            agent_memories = await load_and_distribute_memories(init_db, session_id, user_id)
    
    websocket_open = True
    current_execution_task: Optional[asyncio.Task] = None
    current_cancel_event: Optional[asyncio.Event] = None
    current_collector: Optional[ChunkCollector] = None
    status = "completed"
    error_msg = None
    last_user_message_id = None
    
    message_queue = asyncio.Queue()
    
    async def message_receiver():
        """增强的消息接收器 - 支持容错和连续错误检测"""
        consecutive_errors = 0
        MAX_CONSECUTIVE_ERRORS = 5
        
        while websocket_open:
            try:
                data = await websocket.receive_json()
                _websocket_timestamps[ws_key] = _get_timestamp()
                await message_queue.put(data)
                consecutive_errors = 0  # 重置错误计数
                
            except WebSocketDisconnect:
                logger.info(f"[WebSocket] Client disconnected (receiver)")
                await message_queue.put({"type": "__disconnect__"})
                break
                
            except json.JSONDecodeError as e:
                consecutive_errors += 1
                logger.warning(f"[WebSocket] JSON decode error ({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {e}")
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    logger.error(f"[WebSocket] Too many consecutive JSON errors, closing connection")
                    await message_queue.put({"type": "__disconnect__"})
                    break
                # JSON错误不终止接收器，继续等待下一条消息
                
            except Exception as e:
                consecutive_errors += 1
                logger.error(f"[WebSocket] Receiver error ({consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {e}")
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    logger.error(f"[WebSocket] Too many consecutive errors, closing connection")
                    await message_queue.put({"type": "__disconnect__"})
                    break
                # 短暂等待后重试
                await asyncio.sleep(0.1 * min(consecutive_errors, 3))
    
    async def handle_execution_completion():
        """处理执行任务完成后的所有逻辑"""
        nonlocal status, error_msg, current_execution_task, current_cancel_event, current_collector
        
        execution_context_manager.unregister(
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
            session_id=session_id,
            run_project_id=run_project_id
        )
        
        tokens = None
        try:
            if current_execution_task.cancelled():
                status = "stop"
                logger.info(f"[WebSocket] Execution stopped for session: {session_id}")
                
                await websocket.send_json({
                    "type": "execution_stopped",
                    "session_id": session_id,
                    "timestamp": _get_timestamp()
                })
            else:
                result = current_execution_task.result()
                tokens = result.get("tokens")
                
                openai_message = result.get("message", {"role": "assistant", "content": result.get("output", ""), "reasoning_content": None})
                
                await websocket.send_json({
                    "type": "execution_complete",
                    "message": openai_message,
                    "data": result,
                    "session_id": session_id,
                    "timestamp": _get_timestamp()
                })
        except asyncio.CancelledError:
            status = "stop"
            logger.info(f"[WebSocket] Execution stopped (CancelledError) for session: {session_id}")
            
            await websocket.send_json({
                "type": "execution_stopped",
                "session_id": session_id,
                "timestamp": _get_timestamp()
            })
        except Exception as exec_error:
            status = "error"
            error_msg = str(exec_error)
            logger.error(f"Execution error: {exec_error}", exc_info=True)
            
            try:
                await websocket.send_json({
                    "type": "execution_event",
                    "data": {
                        "event_type": "execution_error",
                        "error": error_msg,
                        "timestamp": datetime.now().isoformat()
                    },
                    "session_id": session_id,
                    "timestamp": _get_timestamp()
                })
                
                await websocket.send_json({
                    "type": "execution_result",
                    "data": {
                        "status": "error",
                        "error": error_msg
                    },
                    "session_id": session_id,
                    "timestamp": _get_timestamp()
                })
            except Exception as send_error:
                logger.error(f"Failed to send error to client: {send_error}")
        
        logger.info(f"[WebSocket] Task completed - status: {status}, collector has data: {current_collector.get_chunk_count() > 0 if current_collector else False}, tokens: {tokens}")
        
        # 使用独立的短期数据库会话保存结果
        if current_collector:
            agent_data = current_collector.get_agent_data()
            logger.info(f"[WebSocket] Agent data: {agent_data}")
            
            if agent_data:
                main_agent_id = None
                
                for agent_id_key, agent_info in agent_data.items():
                    data_to_save = agent_info['data']
                    if not data_to_save:
                        data_to_save = []
                    
                    if main_agent_id is None:
                        main_agent_id = agent_id_key
                        current_parent_agent_id = None
                    else:
                        current_parent_agent_id = main_agent_id
                    
                    logger.info(f"[WebSocket] Saving message for agent {agent_id_key}, data: {data_to_save}, tokens: {tokens}, parent_message_id: {last_user_message_id}, parent_agent_id: {current_parent_agent_id}")
                    
                    try:
                        with get_db_context() as save_db:
                            await save_session_message(
                                db=save_db, session_id=session_id, user_id=user_id,
                                role="assistant", data=data_to_save, status=status, agent_id=agent_id_key,
                                tokens=tokens,
                                agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
                                parent_message_id=last_user_message_id,
                                parent_agent_id=current_parent_agent_id
                            )
                    except Exception as save_error:
                        logger.error(f"[WebSocket] Failed to save message: {save_error}")
            else:
                logger.info(f"[WebSocket] No agent data, saving empty message, tokens: {tokens}, parent_message_id: {last_user_message_id}")
                try:
                    with get_db_context() as save_db:
                        await save_session_message(
                            db=save_db, session_id=session_id, user_id=user_id,
                            role="assistant",
                            data=[],
                            status=status, agent_id="default",
                            tokens=tokens,
                            agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
                            parent_message_id=last_user_message_id
                        )
                except Exception as save_error:
                    logger.error(f"[WebSocket] Failed to save empty message: {save_error}")
        else:
            logger.warning(f"[WebSocket] No collector available")
        
        # 更新会话状态
        try:
            with get_db_context() as update_db:
                if status == "stop":
                    db_manager.update_session(
                        update_db, session_id,
                        status="stop",
                        completed_at=datetime.now(timezone.utc)
                    )
                elif status == "error":
                    db_manager.update_session(
                        update_db, session_id,
                        status="failed",
                        error=error_msg,
                        completed_at=datetime.now(timezone.utc)
                    )
        except Exception as update_error:
            logger.error(f"[WebSocket] Failed to update session: {update_error}")
        
        # 重置状态
        current_execution_task = None
        current_cancel_event = None
        current_collector = None
    
    try:
        receiver_task = asyncio.create_task(message_receiver())
        
        while websocket_open:
            try:
                # 等待消息或执行任务完成
                wait_coroutines = []
                
                # 消息等待任务
                message_wait_task = asyncio.create_task(message_queue.get())
                wait_coroutines.append(message_wait_task)
                
                # 如果有正在执行的任务，也加入等待
                execution_wait_task = None
                if current_execution_task and not current_execution_task.done():
                    execution_wait_task = asyncio.ensure_future(current_execution_task)
                    wait_coroutines.append(execution_wait_task)
                
                # 等待任意一个完成
                done, pending = await asyncio.wait(
                    wait_coroutines,
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                # ====== 优先处理执行任务完成（避免状态泄漏）======
                if execution_wait_task and execution_wait_task in done:
                    logger.info(f"[WebSocket] Execution task completed, processing results")
                    
                    # 取消未完成的消息等待任务
                    if message_wait_task not in done:
                        message_wait_task.cancel()
                        try:
                            await message_wait_task
                        except (asyncio.CancelledError, Exception):
                            pass
                    
                    # 处理执行结果
                    await handle_execution_completion()
                    
                    continue  # 重新开始循环，等待下一个消息
                
                # ====== 处理新消息 ======
                if message_wait_task in done:
                    result = None
                    try:
                        result = message_wait_task.result()
                    except Exception as e:
                        logger.error(f"[WebSocket] Error getting message result: {e}")
                        continue
                    
                    # 断连检测
                    if isinstance(result, dict) and result.get("type") == "__disconnect__":
                        logger.info(f"[WebSocket] Client disconnected")
                        websocket_open = False
                        break
                    
                    # 消息处理
                    if isinstance(result, dict) and "type" in result:
                        data = result
                        
                        if data.get("type") == "ping":
                            await websocket.send_json({"type": "pong", "timestamp": _get_timestamp()})
                            
                        elif data.get("type") == "stop":
                            if current_execution_task and not current_execution_task.done():
                                logger.info(f"[WebSocket] Stop requested for session: {session_id}")
                                
                                if current_cancel_event:
                                    current_cancel_event.set()
                                
                                current_execution_task.cancel()
                                
                                try:
                                    await asyncio.wait_for(current_execution_task, timeout=5.0)
                                except asyncio.CancelledError:
                                    pass
                                except asyncio.TimeoutError:
                                    logger.warning(f"[WebSocket] Task cancellation timeout for session: {session_id}")
                                
                                status = "stop"
                                
                                logger.info(f"[WebSocket] Stop requested, task cancelled, will save in main loop")
                            else:
                                await websocket.send_json({
                                    "type": "execution_stopped",
                                    "session_id": session_id,
                                    "timestamp": _get_timestamp(),
                                    "message": "No running task to stop"
                                })
                        
                        elif data.get("type") == "execute" and (not current_execution_task or current_execution_task.done()):
                            canvas_data = data.get("canvas_data", {}) or stored_canvas_data
                            input_message = data.get("input_message", "")
                            
                            stored_canvas_data = canvas_data
                            
                            # 使用独立会话创建/更新session和保存用户消息
                            with get_db_context() as op_db:
                                op_session = op_db.query(AgenticFlowSessionModel).filter(
                                    AgenticFlowSessionModel.id == session_id
                                ).first()
                                
                                if not op_session:
                                    op_session = AgenticFlowSessionModel(
                                        id=session_id,
                                        user_id=user_id,
                                        agentic_flow_id=agentic_flow_id,
                                        run_project_id=run_project_id,
                                        status="running",
                                        started_at=datetime.now(timezone.utc),
                                        created_at=datetime.now(timezone.utc),
                                        updated_at=datetime.now(timezone.utc),
                                    )
                                    op_db.add(op_session)
                                    op_db.commit()
                                    logger.info(f"Created new session on execute: {session_id}")
                            
                            user_data = [{"type": "content", "content": input_message}]
                            
                            with get_db_context() as msg_db:
                                user_message = await save_session_message(
                                    db=msg_db, session_id=session_id, user_id=user_id,
                                    role="user", data=user_data, agent_id="default",
                                    agentic_flow_id=agentic_flow_id, run_project_id=run_project_id
                                )
                                last_user_message_id = user_message.id
                            
                            status = "completed"
                            current_collector = ChunkCollector()
                            
                            def stream_callback_with_collector(delta: dict, agent_id: str = None, agent_name: str = None):
                                try:
                                    current_collector.add_chunk(delta, agent_id, agent_name)
                                    if websocket_open:
                                        import asyncio
                                        loop = asyncio.get_event_loop()
                                        if loop.is_running():
                                            async def safe_send():
                                                try:
                                                    await websocket.send_json({
                                                        "type": "stream",
                                                        "delta": delta,
                                                        "agent_id": agent_id,
                                                        "agent_name": agent_name,
                                                        "timestamp": datetime.now().isoformat()
                                                    })
                                                except Exception:
                                                    pass
                                            asyncio.create_task(safe_send())
                                except Exception as e:
                                    logger.error(f"Stream callback error: {e}")
                            
                            current_cancel_event = asyncio.Event()
                            
                            async def run_execution():
                                nonlocal status
                                result = await FlowRunner.run_from_json(
                                    canvas_data,
                                    input_message,
                                    user_id=user_id,
                                    agentic_flow_id=agentic_flow_id,
                                    session_id=session_id,
                                    run_project_id=run_project_id,
                                    event_callback=event_callback,
                                    stream_callback=stream_callback_with_collector,
                                    agent_memories=agent_memories,
                                    cancel_event=current_cancel_event
                                )
                                return result
                            
                            current_execution_task = asyncio.create_task(run_execution())
                            
                            await _send_event(websocket, session_id, {
                                "event_type": "execution_start",
                                "timestamp": datetime.now().isoformat()
                            })
                            
                            execution_context_manager.register(
                                task=current_execution_task,
                                user_id=user_id,
                                agentic_flow_id=agentic_flow_id,
                                session_id=session_id,
                                run_project_id=run_project_id,
                                cancel_event=current_cancel_event
                            )
                        
                        elif data.get("type") == "execute":
                            # 有正在执行的任务，拒绝新请求
                            await websocket.send_json({
                                "type": "error",
                                "message": "Another execution is in progress",
                                "session_id": session_id,
                                "timestamp": _get_timestamp()
                            })
                            
            except asyncio.CancelledError:
                logger.info(f"[WebSocket] Main loop cancelled")
                break
            except Exception as e:
                logger.error(f"[WebSocket] Main loop error: {e}", exc_info=True)
                # 尝试通知前端
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Internal error: {str(e)}",
                        "timestamp": _get_timestamp()
                    })
                except Exception:
                    pass
                # 根据错误类型决定是否继续
                error_str = str(e).lower()
                if "database" in error_str or "connection" in error_str or "websocket" in error_str:
                    logger.error(f"[WebSocket] Fatal error, closing connection: {e}")
                    websocket_open = False
                else:
                    logger.info(f"[WebSocket] Non-fatal error, continuing...")
                    continue  # 非致命错误，继续运行
                    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {ws_key}")
        websocket_open = False
    except Exception as e:
        logger.error(f"WebSocket outer error: {e}", exc_info=True)
        websocket_open = False
    finally:
        websocket_open = False
        
        if current_execution_task and not current_execution_task.done():
            logger.info(f"[WebSocket] Cancelling execution in finally: {session_id}")
            
            if current_cancel_event:
                current_cancel_event.set()
            
            current_execution_task.cancel()
            
            try:
                await asyncio.wait_for(current_execution_task, timeout=5.0)
            except asyncio.CancelledError:
                pass
            except asyncio.TimeoutError:
                logger.warning(f"[WebSocket] Task cancellation timeout in finally: {session_id}")
            
            if current_collector:
                status = "stop"
                logger.info(f"[WebSocket] Finally block - saving data, collector has data: {current_collector.get_chunk_count() > 0}, parent_message_id: {last_user_message_id}")
                
                agent_data = current_collector.get_agent_data()
                logger.info(f"[WebSocket] Agent data (finally): {agent_data}")
                
                if agent_data:
                    main_agent_id = None
                    
                    for agent_id_key, agent_info in agent_data.items():
                        data_to_save = agent_info['data']
                        if not data_to_save:
                            data_to_save = []
                        
                        if main_agent_id is None:
                            main_agent_id = agent_id_key
                            current_parent_agent_id = None
                        else:
                            current_parent_agent_id = main_agent_id
                        
                        logger.info(f"[WebSocket] Saving message (finally) for agent {agent_id_key}, data: {data_to_save}, parent_message_id: {last_user_message_id}, parent_agent_id: {current_parent_agent_id}")
                        try:
                            with get_db_context() as finally_db:
                                await save_session_message(
                                    db=finally_db, session_id=session_id, user_id=user_id,
                                    role="assistant", data=data_to_save, status=status, agent_id=agent_id_key,
                                    agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
                                    parent_message_id=last_user_message_id,
                                    parent_agent_id=current_parent_agent_id
                                )
                        except Exception as save_error:
                            logger.error(f"[WebSocket] Failed to save message in finally: {save_error}")
                else:
                    logger.info(f"[WebSocket] No agent data (finally), saving empty message, parent_message_id: {last_user_message_id}")
                    try:
                        with get_db_context() as finally_db:
                            await save_session_message(
                                db=finally_db, session_id=session_id, user_id=user_id,
                                role="assistant",
                                data=[],
                                status=status, agent_id="default",
                                agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
                                parent_message_id=last_user_message_id
                            )
                    except Exception as save_error:
                        logger.error(f"[WebSocket] Failed to save empty message in finally: {save_error}")
                
                try:
                    with get_db_context() as finally_update_db:
                        db_manager.update_session(
                            finally_update_db, session_id,
                            status="stop",
                            completed_at=datetime.now(timezone.utc)
                        )
                except Exception as update_error:
                    logger.error(f"[WebSocket] Failed to update session in finally: {update_error}")
        
        _active_websockets.pop(ws_key, None)
        _websocket_timestamps.pop(ws_key, None)
        _websocket_keys.pop(ws_key, None)


# =============================================================================
# Set 3 统一重构：后端数据构建函数
# =============================================================================

def build_parent_children_map(
    messages: List[SessionMessageModel]
) -> Dict[str, List[SessionMessageModel]]:
    """
    构建 parent_agent_id -> children 映射表
    
    同一 agent_id 可能有多个 message（被多处调用）
    """
    parent_children_map: Dict[str, List[SessionMessageModel]] = {}
    
    for msg in messages:
        if msg.role == 'assistant' and msg.agent_id:
            parent_id = msg.parent_agent_id or 'root'
            if parent_id not in parent_children_map:
                parent_children_map[parent_id] = []
            parent_children_map[parent_id].append(msg)
    
    # 对每个 parent 的 children 按 message_index 排序
    for parent_id in parent_children_map:
        parent_children_map[parent_id].sort(key=lambda m: m.message_index or 0)
    
    return parent_children_map


def calculate_agent_levels(messages: List[SessionMessageModel]) -> Dict[str, int]:
    """
    计算每个 agent 的层级
    
    MainAgent: level = 0
    SubAgent: level = parent.level + 1
    """
    # 构建 agent_id -> parent_agent_id 映射
    parent_map = {}
    for msg in messages:
        if msg.agent_id:
            parent_map[msg.agent_id] = msg.parent_agent_id
    
    # 递归计算层级
    level_cache = {}
    
    def get_level(agent_id: str, visited: Set[str] = None) -> int:
        if visited is None:
            visited = set()
        
        if agent_id in level_cache:
            return level_cache[agent_id]
        
        if agent_id in visited:  # 防止循环
            return 0
        
        visited.add(agent_id)
        parent_id = parent_map.get(agent_id)
        
        if not parent_id:
            level = 0
        else:
            level = get_level(parent_id, visited) + 1
        
        level_cache[agent_id] = level
        return level
    
    for agent_id in parent_map.keys():
        get_level(agent_id)
    
    return level_cache


def get_agent_name(msg: SessionMessageModel) -> str:
    """从消息数据中提取 agent 名称"""
    # 优先使用 agent_name 字段
    if hasattr(msg, 'agent_name') and msg.agent_name:
        return msg.agent_name
    
    # 从 data 中的 tool_calls 提取
    if msg.data:
        for block in msg.data:
            if block.get('type') == 'tool_calls':
                for tc in block.get('tool_calls', []):
                    if tc.get('function', {}).get('name') == 'Task':
                        result = tc.get('result', {})
                        if isinstance(result, str):
                            try:
                                result = json.loads(result)
                            except:
                                continue
                        subagent_name = result.get('subagent_name')
                        if subagent_name:
                            return subagent_name
    
    return 'AI助手'


def process_agent(
    agent_id: str,
    parent_id: str,
    available_children: Dict[str, List[SessionMessageModel]],
    agent_levels: Dict[str, int],
    result_blocks: List[Dict[str, Any]],
    agent_name: str = None
) -> None:
    """
    处理指定 parent 下的 agent（DFS 深度优先搜索）
    
    从 available_children[parent_id] 中取出一个匹配的 agent，然后删除（不再可用）
    支持同一 agent_id 被多个 parent 调用
    
    Args:
        agent_name: 可选，指定 agent 名称（用于 SubAgent，从父消息的 Task result 中获取）
    """
    # 检查该 parent 下是否有可用的 children
    if parent_id not in available_children:
        return
    
    # 找到并"拿出一个"（从可用列表中删除）
    children = available_children[parent_id]
    msg = None
    for i, child in enumerate(children):
        if child.agent_id == agent_id:
            msg = children.pop(i)  # 删除，之后不再可用
            break
    
    if not msg:
        return
    
    # 处理当前 agent 的 blocks
    agent_level = agent_levels.get(agent_id, 0)
    # 使用传入的 agent_name 或从消息中提取
    current_agent_name = agent_name or get_agent_name(msg)
    
    for block in msg.data or []:
        result_blocks.append({
            **block,
            'agent_id': msg.agent_id,
            'agent_name': current_agent_name,
            'agent_level': agent_level,
            'message_index': msg.message_index
        })
        
        # 处理 Task tool_call 中的 subagent
        if block.get('type') == 'tool_calls':
            for tc in block.get('tool_calls', []):
                if tc.get('function', {}).get('name') == 'Task':
                    result_str = tc.get('result', {})
                    if isinstance(result_str, str):
                        try:
                            result_str = json.loads(result_str)
                        except:
                            continue
                    
                    subagent_id = result_str.get('subagent_id')
                    subagent_name = result_str.get('subagent_name')
                    
                    # 递归处理 subagent，使用当前 agent_id 作为 parent_id
                    if subagent_id:
                        process_agent(
                            subagent_id,
                            agent_id,  # 当前 agent 作为 parent
                            available_children,
                            agent_levels,
                            result_blocks,
                            subagent_name  # 传递 SubAgent 名称
                        )


def build_flattened_blocks_for_message(
    msg: SessionMessageModel,
    available_children: Dict[str, List[SessionMessageModel]],
    agent_levels: Dict[str, int]
) -> List[Dict[str, Any]]:
    """
    为单条 assistant 消息构建扁平化的 blocks
    
    包含当前消息的 blocks + 所有子 SubAgent 的 blocks（按正确顺序插入）
    
    Args:
        available_children: 全局可用的 children 映射表（会被修改）
        agent_levels: agent 层级映射
    """
    if not msg.agent_id:
        # 如果没有 agent_id，返回原始 data 并添加 agent_level = 0
        return [
            {**block, 'agent_id': None, 'agent_name': 'AI助手', 'agent_level': 0}
            for block in msg.data or []
        ]
    
    result_blocks = []
    
    # 处理当前消息
    process_agent(
        msg.agent_id,
        msg.parent_agent_id or 'root',
        available_children,
        agent_levels,
        result_blocks
    )
    
    return result_blocks


async def build_unified_blocks(
    session_id: str,
    user_id: str,
    db: Session
) -> List[Dict[str, Any]]:
    """
    构建统一格式的 blocks，不构建树，直接扁平化（DFS 遍历）
    
    支持同一 agent 被多处调用（多个 session_message 记录）
    内存占用最低，性能最好
    """
    # 1. 查询所有消息，按 message_index 排序
    messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id
    ).order_by(SessionMessageModel.message_index).all()
    
    # 2. 构建 parent_agent_id -> children 映射表
    parent_children_map = build_parent_children_map(messages)
    
    # 3. 计算每个 agent 的层级
    agent_levels = calculate_agent_levels(messages)
    
    # 4. 关键：创建可用 children 列表的副本，支持"拿出一个，删除一个"
    available_children = {
        parent_id: children.copy()
        for parent_id, children in parent_children_map.items()
    }
    
    # 5. 从根节点开始处理（DFS）
    result_blocks = []
    
    for root_msg in parent_children_map.get('root', []):
        process_agent(
            root_msg.agent_id,
            'root',  # parent_id
            available_children,
            agent_levels,
            result_blocks
        )
    
    return result_blocks
