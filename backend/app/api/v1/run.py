# -*- coding: utf-8 -*-
"""
SoloEngine : 运行API模块，提供工作流运行相关API端点

@file run.py
@description 运行接口 - 工作流运行相关API端点
@author Sh4rlock
@date 2026-04-09

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
import logging
import os
from datetime import datetime
from typing import Dict, List, Optional, Any, Set
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, WebSocket, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.core.database import get_db, get_db_context, AgenticFlowSessionModel, SessionMessageModel
from SoloAgent.solo_agent.compiler import FlowRunner, CompiledFlowFactory
from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.models.auth import User
from app.utils.timezone_utils import format_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/run", tags=["run"])


def aggregate_incremental_to_net_view(incremental_changes: List[Dict]):
    from app.services.file_change.file_change_manager import FileChange

    file_states = {}
    for change in incremental_changes:
        fp = change.get("file_path", "")
        if not fp:
            continue
        if fp not in file_states:
            file_states[fp] = {
                "first_before_hash": change.get("before_content_hash"),
                "content_type": change.get("content_type", "text"),
            }
        file_states[fp]["last_after_hash"] = change.get("after_content_hash")

    result = []
    for fp, state in file_states.items():
        first_before = state["first_before_hash"]
        last_after = state["last_after_hash"]
        content_type = state.get("content_type", "text")
        if first_before is None and last_after is None:
            continue
        elif first_before is None:
            result.append(FileChange(file_path=fp, operation="created", new_hash=last_after, content_type=content_type))
        elif last_after is None:
            result.append(FileChange(file_path=fp, operation="deleted", old_hash=first_before, content_type=content_type))
        elif first_before != last_after:
            result.append(FileChange(file_path=fp, operation="modified", old_hash=first_before, new_hash=last_after, content_type=content_type))
    return result


class AgenticFlowRunContext:
    
    def __init__(self, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str):
        self.user_id = user_id
        self.agentic_flow_id = agentic_flow_id
        self.session_id = session_id
        self.run_project_id = run_project_id
        self._agent_memories: Dict = {}
        self._canvas_data: Dict = {}
        self._last_execute_result: Optional[Dict] = None
        self._last_user_message_id = None
        self._working_dir: Optional[str] = None
        self._last_working_dir: Optional[str] = None
        self._pending_file_changes: List[Dict] = []
        self._websocket = None
        self._compiled_flow = None
    
    def set_websocket(self, websocket):
        self._websocket = websocket
    
    def event_callback(self, event):
        try:
            if isinstance(event, dict):
                event_type = event.get("event_type")
                file_changes = event.get("file_changes", [])
            else:
                event_type = getattr(event, "event_type", None)
                file_changes = getattr(event, "file_changes", None) or []
            
            if event_type == "file_change_preview" and file_changes:
                self._pending_file_changes.extend(file_changes)
                self._persist_incremental_changes(file_changes)
            
            if self._websocket:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(self._send_websocket_event(event))
        except Exception as e:
            logger.warning(f"[RunContext] event_callback error: {e}")
    
    async def _send_websocket_event(self, event):
        try:
            if isinstance(event, dict):
                await self._websocket.send_json({
                    "type": "event",
                    "event": event,
                    "session_id": self.session_id
                })
            else:
                await self._websocket.send_json({
                    "type": "event",
                    "event": event.to_dict() if hasattr(event, 'to_dict') else str(event),
                    "session_id": self.session_id
                })
        except Exception as e:
            logger.warning(f"[RunContext] Failed to send WebSocket event: {e}")

    def _persist_incremental_changes(self, file_changes: List[Dict]) -> None:
        from app.models.file_change import FileChangeModel
        from app.core.database import get_db_context

        try:
            with get_db_context() as db:
                for change in file_changes:
                    if not change.get("tool_call_id"):
                        continue
                    existing = db.query(FileChangeModel).filter(
                        FileChangeModel.session_id == self.session_id,
                        FileChangeModel.tool_call_id == change.get("tool_call_id"),
                        FileChangeModel.file_path == change.get("file_path", ""),
                    ).first()
                    if not existing:
                        new_record = FileChangeModel(
                            session_id=self.session_id,
                            message_id=str(self._last_user_message_id or ""),
                            agent_id=None,
                            user_id=self.user_id,
                            file_path=change.get("file_path", ""),
                            operation=change.get("operation"),
                            tool_call_id=change.get("tool_call_id"),
                            before_content_hash=change.get("before_content_hash"),
                            after_content_hash=change.get("after_content_hash"),
                            content_type=change.get("content_type", "text"),
                            diff_data=change.get("diff"),
                            lines_added=change.get("diff", {}).get("lines_added", 0) if change.get("diff") else 0,
                            lines_removed=change.get("diff", {}).get("lines_removed", 0) if change.get("diff") else 0,
                            status="pending",
                        )
                        db.add(new_record)
                db.commit()
        except Exception as e:
            logger.warning(f"[RunContext] Failed to persist incremental changes: {e}")
    
    async def load_memories(self):
        from app.core.database import get_db_context
        with get_db_context() as db:
            self._agent_memories = await load_and_distribute_memories(
                db, self.session_id, self.user_id
            )
    
    async def execute(self, input_message: str, canvas_data: Dict, 
                      cancel_event=None,
                      event_callback=None, 
                      stream_callback=None) -> Dict:
        self._canvas_data = canvas_data
        
        def wrapped_event_callback(event):
            self.event_callback(event)
            if event_callback:
                event_callback(event)
        
        def on_flow_created(compiled_flow):
            self._compiled_flow = compiled_flow
        
        result = await FlowRunner.run_from_json(
            json_data=canvas_data,
            input_message=input_message,
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id,
            cancel_event=cancel_event,
            event_callback=wrapped_event_callback,
            stream_callback=stream_callback,
            agent_memories=self._agent_memories,
            on_flow_created=on_flow_created,
        )
        
        self._last_execute_result = result
        
        self._finalize_execution(result=result)
        
        return result
    
    async def execute_node(self, canvas_data: Dict, node_id: str, 
                           input_message: str, context: Dict = None) -> Dict:
        result = await FlowRunner.run_node(
            canvas_data, node_id, input_message,
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id,
            context=context or {},
            agent_memories=self._agent_memories,
        )
        
        self._last_execute_result = result
        
        self._finalize_execution(result=result)
        
        return result
    
    def _extract_token_usage(self, result: Dict) -> Optional[Dict]:
        token_usage = result.get("token_usage")
        if token_usage:
            return token_usage
        tokens = result.get("tokens")
        return tokens
    
    def _finalize_execution(self, result: Dict = None, status_override: str = None,
                            error_msg: str = None, tokens: Dict = None):
        final_status = status_override
        if final_status is None and result:
            final_status = result.get("status", "completed")

        if final_status == "error":
            final_status = "failed"

        update_data = {}
        if final_status in ("completed", "failed", "stop"):
            update_data["completed_at"] = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        if error_msg:
            update_data["error"] = error_msg

        final_tokens = tokens
        if final_tokens is None and result:
            final_tokens = self._extract_token_usage(result)
        if final_tokens and (final_tokens.get("prompt_tokens") or final_tokens.get("completion_tokens")):
            self._update_session_token_usage(final_tokens)

        if result and result.get("duration_ms"):
            update_data["duration_ms"] = result["duration_ms"]

        self._update_session_status(final_status, **update_data)
    
    def handle_cleanup(self, status: str, error_msg: str = None, tokens: Dict = None):
        self._finalize_execution(status_override=status, error_msg=error_msg, tokens=tokens)
    
    def _update_session_token_usage(self, token_usage: Dict):
        from app.core.database import get_db_context, db_manager
        with get_db_context() as db:
            db_manager.update_session_token_usage(
                db, self.session_id,
                prompt_tokens=token_usage.get("prompt_tokens", 0) or 0,
                completion_tokens=token_usage.get("completion_tokens", 0) or 0,
            )
    
    def _update_session_status(self, status: str, **kwargs):
        from app.core.database import get_db_context, db_manager
        with get_db_context() as db:
            update_data = {"status": status}
            if status in ("completed", "failed", "stop"):
                update_data["completed_at"] = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            if kwargs.get("duration_ms"):
                update_data["duration_ms"] = kwargs["duration_ms"]
            if kwargs.get("error"):
                update_data["error"] = kwargs["error"]
            db_manager.update_session(db, self.session_id, **update_data)
    
    async def save_user_message(self, input_message: str) -> Optional[str]:
        from app.core.database import get_db_context
        try:
            with get_db_context() as db:
                message = await save_session_message(
                    db=db, session_id=self.session_id, user_id=self.user_id,
                    role="user", data=[{"type": "content", "content": input_message}],
                    status="completed", agentic_flow_id=self.agentic_flow_id,
                    run_project_id=self.run_project_id,
                )
                logger.info(f"[RunContext] Saved user message: session={self.session_id}, message_id={message.id if message else None}")
                return str(message.id) if message else None
        except Exception as e:
            logger.error(f"[RunContext] Failed to save user message: {e}", exc_info=True)
            return None
    
    async def save_assistant_message(self, collector=None, tokens=None,
                               parent_message_id=None, execution_result=None,
                               update_file_change_message_id=False,
                               status: str = "completed", error: str = None):
        saved_message_ids = {}
        from app.core.database import get_db_context
        try:
            agent_data = collector.get_agent_data() if collector else None
            if agent_data:
                with get_db_context() as db:
                    main_agent_id = None
                    for agent_id_key, agent_info in agent_data.items():
                        data_to_save = agent_info.get('data', [])
                        if not data_to_save:
                            data_to_save = []
                        llm_config_id = self.get_agent_llm_config_id(agent_id_key)

                        if main_agent_id is None:
                            main_agent_id = agent_id_key
                            current_parent_agent_id = None
                        else:
                            current_parent_agent_id = main_agent_id

                        agent_tokens = self._get_agent_token_usage(agent_id_key) or tokens

                        try:
                            saved_message = await save_session_message(
                                db=db, session_id=self.session_id, user_id=self.user_id,
                                role="assistant", data=data_to_save, status=status,
                                agent_id=agent_id_key, tokens=agent_tokens,
                                agentic_flow_id=self.agentic_flow_id,
                                run_project_id=self.run_project_id,
                                parent_message_id=parent_message_id,
                                parent_agent_id=current_parent_agent_id,
                                llm_config_id=llm_config_id,
                                error=error,
                            )
                            if saved_message and update_file_change_message_id and parent_message_id:
                                self._update_file_change_message_id(db, parent_message_id, saved_message.id)
                            if saved_message:
                                saved_message_ids[agent_id_key] = str(saved_message.id)
                        except Exception as e:
                            logger.error(f"[RunContext] Failed to save agent message: {e}", exc_info=True)
            else:
                content = ""
                if execution_result and isinstance(execution_result, dict):
                    content = execution_result.get("output", "") or execution_result.get("error", "")
                
                if not content and status != "error":
                    status = "error"
                    error = error or "LLM未返回有效内容"
                
                with get_db_context() as db:
                    try:
                        saved_message = await save_session_message(
                            db=db, session_id=self.session_id, user_id=self.user_id,
                            role="assistant",
                            data=[{"type": "content", "content": content}] if content else [],
                            status=status, agent_id="default", tokens=tokens,
                            agentic_flow_id=self.agentic_flow_id,
                            run_project_id=self.run_project_id,
                            parent_message_id=parent_message_id,
                            error=error,
                        )
                        if saved_message:
                            saved_message_ids["default"] = str(saved_message.id)
                            if update_file_change_message_id and parent_message_id:
                                self._update_file_change_message_id(db, parent_message_id, saved_message.id)
                    except Exception as e:
                        logger.error(f"[RunContext] Failed to save empty assistant message: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"[RunContext] Failed to save assistant message: {e}", exc_info=True)
        return saved_message_ids
    
    def _update_file_change_message_id(self, db, old_message_id, new_message_id):
        from app.models.file_change import FileChangeModel
        
        changes = db.query(FileChangeModel).filter(
            FileChangeModel.session_id == self.session_id,
            FileChangeModel.message_id == str(old_message_id)
        ).all()
        for ch in changes:
            ch.message_id = new_message_id
        
        db.commit()
    
    def get_agent_llm_config_id(self, agent_id: str) -> Optional[str]:
        compiled_flow = CompiledFlowFactory.get(
            self.user_id, self.agentic_flow_id,
            self.session_id, self.run_project_id
        )
        if compiled_flow and agent_id in compiled_flow.agents:
            return compiled_flow.agents[agent_id].config._llm_config_id
        return None

    def _get_agent_token_usage(self, agent_id: str) -> Optional[Dict]:
        compiled_flow = CompiledFlowFactory.get(
            self.user_id, self.agentic_flow_id,
            self.session_id, self.run_project_id
        )
        if compiled_flow and agent_id in compiled_flow.agents:
            agent = compiled_flow.agents[agent_id]
            if hasattr(agent, 'get_token_usage'):
                return agent.get_token_usage()
        return None
    
    def clear_cache(self):
        CompiledFlowFactory.remove(
            self.user_id, self.agentic_flow_id,
            self.session_id, self.run_project_id
        )
    
    def ensure_session(self):
        if self.session_id:
            with get_db_context() as db:
                session = db.query(AgenticFlowSessionModel).filter(
                    AgenticFlowSessionModel.id == self.session_id
                ).first()
                
                if not session:
                    session = AgenticFlowSessionModel(
                        id=self.session_id,
                        user_id=self.user_id,
                        agentic_flow_id=self.agentic_flow_id,
                        run_project_id=self.run_project_id,
                        status="running",
                    )
                    db.add(session)
                    db.commit()
        
        return self.session_id
    
    async def get_working_dir(self, working_dir: str = None) -> str | None:
        from app.core.database import get_db_context, db_manager
        
        if not working_dir:
            with get_db_context() as db:
                project = db_manager.get_active_run_project(db, self.user_id, self.agentic_flow_id)
                if project:
                    working_dir = project.folder_path
        
        if not working_dir or not self.user_id:
            return None
        
        self._working_dir = working_dir
        self._last_working_dir = working_dir
        return working_dir
    
    async def save_file_changes(self, message_id: str = None) -> None:
        from app.services.file_change import file_change_manager
        from app.models.file_change import FileChangeModel
        from app.core.database import get_db_context

        working_dir = self._last_working_dir or getattr(self, '_working_dir', None)

        if not working_dir or not self.user_id:
            return

        try:
            incremental_changes = self._pending_file_changes or []
            if not incremental_changes:
                self._pending_file_changes = []
                return

            net_changes = aggregate_incremental_to_net_view(incremental_changes)

            for change in net_changes:
                if change.content_type == "text" and working_dir:
                    change.diff_data = file_change_manager.compute_diff_for_change(
                        change, working_dir
                    )
                    if change.diff_data:
                        change.lines_added = change.diff_data.get("lines_added", 0)
                        change.lines_removed = change.diff_data.get("lines_removed", 0)

            file_change_message_id = message_id or (str(self._last_user_message_id) if self._last_user_message_id else "")

            if net_changes:
                with get_db_context() as db:
                    for change in net_changes:
                        existing = db.query(FileChangeModel).filter(
                            FileChangeModel.session_id == self.session_id,
                            FileChangeModel.file_path == change.file_path,
                            FileChangeModel.message_id == file_change_message_id,
                            FileChangeModel.tool_call_id == None
                        ).first()

                        if existing:
                            existing.operation = change.operation
                            existing.before_content_hash = change.old_hash
                            existing.after_content_hash = change.new_hash
                            existing.content_type = change.content_type
                            if change.diff_data:
                                existing.diff_data = change.diff_data
                            existing.lines_added = change.lines_added
                            existing.lines_removed = change.lines_removed
                            existing.status = "pending"
                        else:
                            new_record = FileChangeModel(
                                session_id=self.session_id,
                                message_id=file_change_message_id,
                                agent_id=None,
                                user_id=self.user_id,
                                file_path=change.file_path,
                                operation=change.operation,
                                tool_call_id=None,
                                content_type=change.content_type,
                                before_content_hash=change.old_hash,
                                after_content_hash=change.new_hash,
                                diff_data=change.diff_data,
                                lines_added=change.lines_added,
                                lines_removed=change.lines_removed,
                                status="pending",
                            )
                            db.add(new_record)
                    db.commit()

            self._pending_file_changes = []

            logger.info(f"[RunContext] Net diff computed from incremental: {len(net_changes)} file changes")
        except Exception as e:
            logger.warning(f"Failed to compute net diff: {e}")
    


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
        
        logger.info(f"[ChunkCollector] add_chunk: type={chunk_type}, content_len={len(str(content)) if content else 0}, content_repr={repr(content)[:100]}")
        
        if chunk_type != 'tool_calls' and not content:
            logger.warning(f"[ChunkCollector] SKIPPING: non-tool chunk with empty content, type={chunk_type}")
            return
        if chunk_type == 'tool_calls' and not content:
            logger.warning("[ChunkCollector] SKIPPING: tool_calls with empty content")
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
        
        self._chunks.append({'delta': delta, 'agent_id': agent_id, 'agent_name': agent_name})
    
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
            val = delta.get('reasoning_content') or delta.get('thinking') or delta.get('text')
            return val if val is not None else ''
        elif chunk_type == 'tool_calls':
            return delta.get('tool_calls', [])
        else:
            val = delta.get('content') or delta.get('text')
            return val if val is not None else ''
    
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
                if block_type == 'reasoning_content':
                    pass
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
    
    def get_chunks_since(self, since_index: int) -> list:
        return self._chunks[since_index:]
    
    def get_agent_ids(self) -> list:
        return list(self._agent_data.keys())


async def save_session_message(
    db: Session, session_id: str, user_id: str, role: str,
    data: list, status: str = "completed", agent_id: str = "default",
    tokens: dict = None,
    agentic_flow_id: str = None,
    run_project_id: str = None,
    parent_message_id: str = None,
    parent_agent_id: str = None,
    llm_config_id: str = None,
    error: str = None,
):
    from app.core.database import AgenticFlowSessionModel, db_manager
    
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
        
        prompt_tokens = tokens.get('prompt_tokens') if tokens else None
        completion_tokens = tokens.get('completion_tokens') if tokens else None
        total_tokens = tokens.get('total_tokens') if tokens else None
        duration_ms = tokens.get('duration_ms') if tokens else None
        
        message = db_manager.add_session_message(
            db=db, session_id=session_id, user_id=user_id, role=role,
            data=data, status=status, agent_id=agent_id,
            parent_message_id=parent_message_id, parent_agent_id=parent_agent_id,
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
            total_tokens=total_tokens, duration_ms=duration_ms,
            llm_config_id=llm_config_id,
            error=error,
        )
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

    修复：保持消息的时间顺序，将 shared_memories 和 agent_memories 按 message_index 排序合并
    """
    from app.core.database import SessionMessageModel

    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id,
        SessionMessageModel.is_deleted == False
    ).order_by(SessionMessageModel.message_index).all()

    # 所有消息按时间顺序存储，每个agent维护自己的完整对话历史
    all_messages = []

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
            "data": filtered_data,
            "agent_id": record.agent_id,
            "message_index": record.message_index  # 保留索引用于排序
        }

        all_messages.append(message)

        # 关键修复：如果消息包含 tool_calls，在其后添加对应的 tool 结果消息
        if record.role == "assistant":
            for block in filtered_data:
                if block.get("type") == "tool_calls":
                    for tc in block.get("tool_calls", []):
                        tool_call_id = tc.get("id")
                        result = tc.get("result")
                        tool_name = tc.get("function", {}).get("name", "")

                        # result 已经被 _filter_tool_results 处理，直接取 content 或转为字符串
                        if tool_call_id and result is not None:
                            tool_content = result if isinstance(result, str) else str(result)

                            tool_msg = {
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "content": tool_content,
                                "name": tool_name,
                                "message_index": record.message_index + 0.5  # 确保在assistant消息之后
                            }
                            all_messages.append(tool_msg)

    # 按 message_index 排序，保持时间顺序
    all_messages.sort(key=lambda x: x.get("message_index", 0))

    # 构建 agent_memories：每个agent获得完整的对话历史
    agent_memories = {}
    default_agent_id = "default"

    # 找到所有agent_id
    agent_ids = set()
    for msg in all_messages:
        agent_id = msg.get("agent_id")
        if agent_id and agent_id != "default":
            agent_ids.add(agent_id)

    # 如果没有特定agent，使用default
    if not agent_ids:
        agent_ids = {default_agent_id}

    # 每个agent获得完整的对话历史（移除内部字段）
    for agent_id in agent_ids:
        agent_memories[agent_id] = []
        for msg in all_messages:
            # 移除内部字段
            clean_msg = {k: v for k, v in msg.items() if k != "message_index"}
            agent_memories[agent_id].append(clean_msg)

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
    from app.utils.common_utils import make_cache_key
    return make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)


async def _cleanup_stale_connections():
    """定期清理超时的WebSocket连接。"""
    while True:
        try:
            await asyncio.sleep(settings.WEBSOCKET_CLEANUP_INTERVAL)
            current_time = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).timestamp()
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
    if _cleanup_task:
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
    logger.info("WebSocket cleanup task stopped")


def _get_timestamp() -> float:
    return datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).timestamp()


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
    try:
        run_context = AgenticFlowRunContext(
            user_id=current_user.id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
        )
        await run_context.load_memories()
        
        result = await run_context.execute(
            input_message=request.input_message,
            canvas_data=request.canvas_data,
            context=request.context or {},
        )
        
        await run_context.save_user_message(request.input_message)
        await run_context.save_assistant_message(
            execution_result=result,
        )
        
        return {
            "code": 200,
            "message": "Workflow executed",
            "data": result
        }
    except Exception as e:
        logger.error(f"Workflow execution failed: {e}")
        try:
            await run_context.save_assistant_message()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute-node")
async def execute_single_node(
    request: ExecuteNodeRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        user_id = request.user_id or current_user.id
        run_context = AgenticFlowRunContext(
            user_id=user_id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
        )
        await run_context.load_memories()
        
        result = await run_context.execute_node(
            canvas_data=request.canvas_data,
            node_id=request.node_id,
            input_message=request.input_message,
            context=request.context or {},
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
    import asyncio
    
    stream_queue = asyncio.Queue()
    execution_result = None
    execution_error = None
    collector = ChunkCollector()
    
    run_context = AgenticFlowRunContext(
        user_id=current_user.id,
        agentic_flow_id=request.agentic_flow_id,
        session_id=request.session_id,
        run_project_id=request.run_project_id,
    )
    
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
            await run_context.load_memories()
            
            result = await run_context.execute(
                input_message=request.input_message,
                canvas_data=request.canvas_data,
                context=request.context or {},
                stream_callback=stream_callback,
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
                    delta = await asyncio.wait_for(stream_queue.get(), timeout=settings.WEBSOCKET_STREAM_QUEUE_TIMEOUT)
                    if delta is None:
                        break
                    yield f"data: {json.dumps({'type': 'stream', 'delta': delta}, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    if execution_task.done():
                        break
                    continue
            
            await execution_task
            
            if execution_error:
                yield f"data: {json.dumps({'type': 'error', 'message': str(execution_error)}, ensure_ascii=False)}\n\n"
            else:
                openai_message = execution_result.get("message", {"role": "assistant", "content": execution_result.get("output", "")})
                tokens = execution_result.get("tokens") or execution_result.get("token_usage")
                yield f"data: {json.dumps({'type': 'execution_complete', 'message': openai_message, 'data': execution_result, 'tokens': tokens}, ensure_ascii=False)}\n\n"
            
            if request.session_id:
                tokens = execution_result.get("tokens") or execution_result.get("token_usage") if execution_result else None
                try:
                    await run_context.save_user_message(request.input_message)
                    
                    await run_context.save_assistant_message(
                        collector=collector,
                        tokens=tokens,
                    )
                except Exception as save_error:
                    logger.error(f"Failed to save session messages: {save_error}")
                
        except Exception as e:
            logger.error(f"SSE stream error: {e}")
            try:
                await run_context.save_assistant_message(
                    collector=collector if collector else None,
                    tokens=execution_result.get("tokens") if execution_result else None,
                )
            except Exception:
                pass
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
    
    sessions = query.order_by(AgenticFlowSessionModel.updated_at.desc()).limit(limit).all()
    
    first_content_map = {}
    if sessions:
        session_ids = [s.id for s in sessions]
        min_index_subquery = db.query(
            SessionMessageModel.session_id,
            sqlfunc.min(SessionMessageModel.message_index).label('min_index')
        ).filter(
            SessionMessageModel.session_id.in_(session_ids),
            SessionMessageModel.role == 'assistant',
            SessionMessageModel.is_deleted == False
        ).group_by(SessionMessageModel.session_id).subquery()

        first_messages = db.query(SessionMessageModel).join(
            min_index_subquery,
            (SessionMessageModel.session_id == min_index_subquery.c.session_id) &
            (SessionMessageModel.message_index == min_index_subquery.c.min_index)
        ).filter(
            SessionMessageModel.is_deleted == False
        ).all()

        for msg in first_messages:
            if msg.data:
                for block in msg.data:
                    if block.get('type') == 'content' and block.get('content'):
                        first_content_map[msg.session_id] = block['content'][:50]
                        break

    result = []
    for s in sessions:
        result.append({
            "id": s.id,
            "agentic_flow_id": s.agentic_flow_id,
            "run_project_id": s.run_project_id,
            "status": s.status,
            "error": s.error,
            "token_usage": s.token_usage,
            "started_at": format_iso(s.started_at),
            "completed_at": format_iso(s.completed_at),
            "created_at": format_iso(s.created_at),
            "updated_at": format_iso(s.updated_at),
            "duration_ms": s.duration_ms,
            "first_assistant_content": first_content_map.get(s.id),
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
            "started_at": format_iso(session.started_at),
            "completed_at": format_iso(session.completed_at),
            "created_at": format_iso(session.created_at),
            "updated_at": format_iso(session.updated_at),
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
    from app.core.database import SessionMessageModel
    from app.api.v1.file_changes import delete_messages, DeleteMessagesRequest

    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id,
        AgenticFlowSessionModel.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # 1. 获取所有未删除的消息
    all_messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.is_deleted == False
    ).all()

    # 2. 调用delete_messages处理消息和file_changes（统一路径）
    if all_messages:
        first_msg = all_messages[0]
        delete_request = DeleteMessagesRequest(
            session_id=session_id,
            from_message_id=first_msg.id
        )
        await delete_messages(delete_request, db, current_user)

    # 3. 物理删除session（级联删除消息）
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
        SessionMessageModel.user_id == current_user.id,
        SessionMessageModel.is_deleted == False
    ).order_by(SessionMessageModel.message_index).offset(offset).limit(limit).all()
    
    # 构建 parent_children_map 和 agent_levels（用于 assistant 消息处理）
    parent_children_map = build_parent_children_map(messages)
    agent_levels = calculate_agent_levels(messages)
    
    # 创建全局可用的 children 映射表（会被 process_agent 修改）
    available_children = {
        parent_id: children.copy()
        for parent_id, children in parent_children_map.items()
    }
    
    # 辅助函数：检查消息是否还在 available_children 中（未被 process_agent 消费）
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
                "error": m.error,
                "message_index": m.message_index,
                "prompt_tokens": m.prompt_tokens,
                "completion_tokens": m.completion_tokens,
                "total_tokens": m.total_tokens,
                "created_at": format_iso(m.created_at)
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
                "error": m.error,
                "message_index": m.message_index,
                "prompt_tokens": m.prompt_tokens,
                "completion_tokens": m.completion_tokens,
                "total_tokens": m.total_tokens,
                "created_at": format_iso(m.created_at)
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
        SessionMessageModel.user_id == current_user.id,
        SessionMessageModel.is_deleted == False
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
            "error": m.error,
            "message_index": m.message_index,
            "prompt_tokens": m.prompt_tokens,
            "completion_tokens": m.completion_tokens,
            "total_tokens": m.total_tokens,
            "created_at": format_iso(m.created_at)
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
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.is_deleted == False
    ).order_by(SessionMessageModel.message_index).all()

    if format == "json":
        data = {
            "id": session.id,
            "status": session.status,
            "error": session.error,
            "token_usage": session.token_usage,
            "started_at": format_iso(session.started_at),
            "completed_at": format_iso(session.completed_at),
            "created_at": format_iso(session.created_at),
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "error": m.error,
                    "timestamp": format_iso(m.timestamp)
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
    """
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return
    
    from app.api.v1.websocket import verify_token
    valid, user_id = await verify_token(token)
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
            'message_index': msg.message_index,
            'agent_tokens': msg.total_tokens,
            'agent_prompt_tokens': msg.prompt_tokens,
            'agent_completion_tokens': msg.completion_tokens,
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
        SessionMessageModel.user_id == user_id,
        SessionMessageModel.is_deleted == False
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
