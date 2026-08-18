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


class MessageQueue:
    """消息队列。支持异步等待、入队、drain。内部使用 asyncio.Queue。"""

    def __init__(self):
        self._queue = asyncio.Queue()

    async def put(self, message) -> None:
        """异步入队。"""
        await self._queue.put(message)

    def enqueue(self, message) -> None:
        """同步入队。"""
        self._queue.put_nowait(message)

    def enqueue_front(self, message) -> None:
        items = []
        while not self._queue.empty():
            items.append(self._queue.get_nowait())
        self._queue.put_nowait(message)
        for item in items:
            self._queue.put_nowait(item)

    def remove(self, index: int) -> bool:
        """按索引删除。"""
        items = []
        while not self._queue.empty():
            items.append(self._queue.get_nowait())
        if 0 <= index < len(items):
            del items[index]
        for item in items:
            self._queue.put_nowait(item)
        return 0 <= index <= len(items)

    def drain_all(self) -> list:
        """Drain 所有消息，连续相同 name 的条目合并为一条。"""
        items = []
        while not self._queue.empty():
            items.append(self._queue.get_nowait())

        merged = []
        for msg in items:
            msg_name = getattr(msg, 'name', None)
            msg_content = getattr(msg, 'content', None)
            msg_role = getattr(msg, 'role', 'user')
            if merged and getattr(merged[-1], 'name', None) == msg_name:
                setattr(merged[-1], 'content',
                        (getattr(merged[-1], 'content', None) or "") + "\n" + (msg_content or ""))
            else:
                from SoloAgent.message.message_base import Msg as _Msg
                merged.append(_Msg(name=msg_name, content=msg_content, role=msg_role, metadata=getattr(msg, 'metadata', None)))
        return merged

    def drain_next_round(self) -> list:
        """drain 队列，连续相同 name 的条目合并为一条。"""
        return self.drain_all()

    async def get(self):
        """异步获取消息。事件循环调用。"""
        return await self._queue.get()

    @property
    def has_pending(self) -> bool:
        return not self._queue.empty()


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
        self._message_queue = MessageQueue()       # 业务消息队列（Msg），管理待发送消息
        self._ws_message_queue = asyncio.Queue()   # WebSocket 传输队列（dict），仅数据传递

        # 从 websocket_handler 移入的执行状态
        self._current_execution_task = None
        self._current_collector = None
        self._status = "completed"
        self._cancel_event = None
        self._stored_canvas_data = {}
        # 前端当前激活终端（terminal_attach WS 消息写入）：RunCommand 选择命令执行的 PTY 会话。
        # 关联决策在前端（用户查看的终端），后端仅承载状态，工具经 _hitl.get_terminal_id() 读取。
        self._active_terminal_id: Optional[str] = None
        self._pending_stream_tasks = []
        self._pending_save_tasks = []  # agent 消息保存任务（event_callback 触发）
        self._current_round_index = 0
        # subagent task 消息管理：保存 subagent 的 task 消息 id 作为 parent_message_id
        self._subagent_task_message_ids: Dict[str, str] = {}  # subagent_id -> task message id
        self._subagent_task_save_tasks: Dict[str, "asyncio.Task"] = {}  # subagent_id -> save task
        # #17 改2：预生成 message_id 管理：agent_start 时存储，供 subagent task 消息的 parent_message_id 使用
        self._pending_agent_message_ids: Dict[str, str] = {}  # agent_id -> pre-generated message_id
        # 流式回调（由 websocket_handler 注入）
        self._stream_send_callback = None

        # 事件循环状态
        self._send_event_callback = None              # 发送事件到前端的回调（包装 event 格式）
        self._send_raw_callback = None                # 发送原始数据到前端的回调（不包装）
        self._message_receiver_func = None            # 消息接收函数
        self._websocket_open = True                   # 连接是否打开
        self._receiver_task = None                    # 消息接收任务
        self._taken_over_event = None                 # 接管信号
        self._consecutive_errors = 0                  # 连续错误计数
        self._max_consecutive_errors = settings.MAX_CONSECUTIVE_ERRORS

    def enqueue_message(self, msg) -> None:
        """外部入队。仅入队。"""
        self._message_queue.enqueue(msg)

    def remove_message(self, index: int) -> bool:
        """外部删除队列消息。"""
        return self._message_queue.remove(index)

    def set_stream_send_callback(self, callback):
        """注入流式数据发送回调。重连时 ws_handler 调用更新。"""
        self._stream_send_callback = callback

    async def start_execution(self, data):
        """创建执行任务。返回 execution_start 事件数据。"""
        self._cancel_event = asyncio.Event()
        self._compiled_flow = None  # 清空旧的 compiled_flow，避免 stop_execution 取消旧 flow
        self._status = "completed"
        self._current_collector = ChunkCollector()
        self._pending_stream_tasks = []
        # 清空 subagent task 消息管理，避免跨轮次数据污染
        self._subagent_task_message_ids.clear()
        self._subagent_task_save_tasks.clear()
        self._stored_canvas_data = data.get("canvas_data", {}) or self._stored_canvas_data
        input_message = data.get("input_message")
        # ★ str→Msg: 提取文本用于保存用户消息
        input_text = input_message.get_text_content() if hasattr(input_message, 'get_text_content') else str(input_message)

        self.ensure_session()
        resume_user_message_id = (getattr(input_message, "metadata", None) or {}).get("resume_user_message_id")
        if resume_user_message_id:
            self._last_user_message_id = resume_user_message_id
        else:
            message_id = await self.save_user_message(input_text)
            self._last_user_message_id = message_id
        self._current_round_index += 1

        # 新增：每轮 start_execution 都重新加载 memories，确保 mainagent 能拿到最新的 memory
        await self.load_memories()

        async def run_execution():
            return await self.execute(
                input_message=input_message,
                canvas_data=self._stored_canvas_data,
                cancel_event=self._cancel_event,
                # 不传 event_callback：execute() 内部 wrapped_event_callback 已调用 self.event_callback
                # 若再传一次会导致同一事件被处理两次（task 消息重复保存、agent 消息重复保存）
            )

        self._current_execution_task = asyncio.create_task(run_execution())

        execution_context_manager.register(
            task=self._current_execution_task,
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id,
            cancel_event=self._cancel_event,
            collector=self._current_collector,
            run_context=self,
            websocket_ref=None,
            taken_over_event=None,
        )

        return {
            "event_type": "execution_start",
            "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
        }

    async def stop_execution(self):
        """停止执行。通过 flow.cancel() 关闭 LLM HTTP 连接，让任务自然完成。"""
        if not self._current_execution_task or self._current_execution_task.done():
            logger.info(f"[RunContext] stop_execution: task already done, skipping")
            return

        logger.info(f"[RunContext] stop_execution: setting _cancel_event and calling flow.cancel()")
        # 先设置 _cancel_event，确保 event_callback 中的 agent_error 处理能识别为用户停止
        # 根因：flow.cancel() 期间会触发 agent_error 事件，若 _cancel_event 未设置，
        # event_callback 会将 status 保存为 error 而非 stop
        if self._cancel_event:
            self._cancel_event.set()

        if self._compiled_flow:
            await self._compiled_flow.cancel()
            logger.info(f"[RunContext] stop_execution: flow.cancel() completed")

    def drain_queue(self):
        """Drain 消息队列，返回消息文本列表。"""
        if self._message_queue.has_pending:
            return [m.get_text_content() or "" for m in self._message_queue.drain_all()]
        return []

    async def send_queue_returned(self):
        """用户停止：drain 队列并发送 queue_returned 到前端。"""
        queue_msgs = self.drain_queue()
        if queue_msgs:
            await self._send_event({
                "event_type": "queue_returned",
                "messages": queue_msgs,
            })

    async def send_queue_drained_and_start(self):
        """执行完成后（队列有排队消息）：drain 队列，发送 queue_drained，
        然后完全复用用户发送消息的流程启动新任务（统一化：队列消息在当前任务
        LLM 调用完成后、下个任务 LLM 调用前处理，无独立检查点）。"""
        queue_msgs = self._message_queue.drain_next_round()
        if not queue_msgs:
            return
        input_message = Msg(
            name="user",
            content="\n".join(m.get_text_content() or "" for m in queue_msgs),
            role="user",
        )
        await self._send_event({
            "event_type": "queue_drained",
            "content": input_message.get_text_content() or "",
        })
        # 完全复用用户发送消息的流程（run.py line 573-587）
        # 1. 创建 taken_over_event
        taken_over_event = asyncio.Event()
        self._taken_over_event = taken_over_event
        # 2. 调用 start_execution
        start_event = await self.start_execution({
            "input_message": input_message,
            "canvas_data": self._stored_canvas_data,
        })
        # 3. 注入传输层上下文
        exec_ctx = execution_context_manager.get(
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id
        )
        if exec_ctx:
            exec_ctx.websocket_ref = self._websocket
            exec_ctx.taken_over_event = taken_over_event
        # 4. 发送 execution_start 事件
        await self._send_event(start_event)

    async def on_execution_done(self):
        """执行完成后处理。返回事件列表。"""
        # flow 执行结果状态（completed/stop/failed）→ run 内部状态（completed/stop/error）映射。
        # flow 是执行终态的唯一真相源，run 层直接采用，不再自行推导/兜底。
        flow_status_to_run_status = {"completed": "completed", "stop": "stop", "failed": "error"}
        execution_context_manager.unregister(
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id
        )

        if self._pending_stream_tasks:
            await asyncio.gather(*self._pending_stream_tasks, return_exceptions=True)
            self._pending_stream_tasks.clear()

        # 等待所有 agent 消息保存任务完成，确保 on_execution_done 之前消息已保存
        if self._pending_save_tasks:
            await asyncio.gather(*self._pending_save_tasks, return_exceptions=True)
            self._pending_save_tasks.clear()

        # 清理可能残留的 subagent task 保存任务（subagent_complete 未触发的情况）
        if self._subagent_task_save_tasks:
            await asyncio.gather(*self._subagent_task_save_tasks.values(), return_exceptions=True)
            self._subagent_task_save_tasks.clear()

        # 判断执行状态
        result = None
        error_msg = None
        try:
            if self._current_execution_task.cancelled():
                self._status = "stop"
                logger.info(f"[RunContext] Task cancelled")
            else:
                result = self._current_execution_task.result()
                result_status = result.get("status") if isinstance(result, dict) else None
                # 直接采用 flow 的执行终态（唯一真相源），映射到 run 内部状态；
                # 仅 failed 额外提取错误信息用于 execution_error 事件。
                self._status = flow_status_to_run_status.get(result_status, "completed")
                if result_status == "failed":
                    error_msg = result.get("error", "执行失败")
                logger.info(f"[RunContext] Task completed: result_type={type(result).__name__}, has_token_usage={bool(result.get('token_usage')) if isinstance(result, dict) else False}")
        except asyncio.CancelledError:
            self._status = "stop"
        except Exception as exec_error:
            is_user_stop = self._cancel_event is not None and self._cancel_event.is_set()
            if is_user_stop:
                self._status = "stop"
            else:
                self._status = "error"
                error_msg = str(exec_error)
                # compile 阶段抛错时无 agent_error 事件，on_execution_done 唯一兜底保存
                try:
                    agent_id = self._resolve_error_agent_id()
                    logger.info(f"[RunContext] Saving compile error assistant message: agent_id={agent_id}, error={error_msg[:100]}")
                    await self._save_agent_messages(agent_id, status="error", error=error_msg)
                    if self._pending_save_tasks:
                        await asyncio.gather(*self._pending_save_tasks, return_exceptions=True)
                        self._pending_save_tasks.clear()
                except Exception as save_err:
                    logger.error(f"[RunContext] Failed to save compile error assistant message: {save_err}", exc_info=True)

        # 剪枝（P6）：原三级兜底的前两级恒为空——flow_compiler._build_result_dict 硬编码
        # token_usage=None、compiled_flow._token_usage 属性不存在，均为死分支。
        # tokens 的唯一来源 = session_messages 会话级聚合（与 _finalize_execution 中
        # DB 写入同源，幂等覆盖写入，重复调用无副作用）。
        tokens = None
        try:
            tokens = self._update_session_token_usage_from_messages()
        except Exception as agg_err:
            logger.warning(f"[RunContext] Session token aggregation failed: {agg_err}")
        logger.info(f"[RunContext] Token extraction: final_tokens={tokens}")

        # 统一路径：先检查 collector 是否为空，如果是空且 status 不是 error/stop，设置 self._status="error"
        # 这样后续生成的事件（execution_error）和保存的消息（status="error"）才能正确反映错误状态
        # 根因：agent.reply 捕获异常返回错误字符串，_execute_agent 认为 status="completed"
        # 但 collector 为空（stream_callback 未被调用），需要在这里修复为 error
        has_collector_data = self._current_collector.get_chunk_count() > 0 if self._current_collector else False
        if not has_collector_data and self._status != "error" and self._status != "stop":
            self._status = "error"
            # 优先使用 result.output（LLM 调用失败时 agent.reply 返回的详细错误信息）作为 error_msg
            # 这样前端 content 区域（修改后）能显示详细错误信息，而非系统的 LLM未返回有效内容
            if result and isinstance(result, dict) and result.get("output"):
                error_msg = result["output"]
            else:
                error_msg = error_msg or "LLM未返回有效内容"
            logger.info(f"[RunContext] Collector empty, status set to error: error_msg={error_msg[:100] if error_msg else None}")
        # 所有 agent 消息在 event_callback (agent_complete/agent_error) 中已保存
        # on_execution_done 只负责发送完成事件和 file_changes
        events = []

        # 执行状态事件
        if self._status == "stop":
            events.append({
                "event_type": "execution_stopped",
                "status": "stopped",
                "tokens": tokens,
                "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
            })
        elif self._status == "error":
            events.append({
                "event_type": "execution_error",
                "status": "error",
                "error": error_msg or "",
                "tokens": tokens,
                "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
            })
        else:
            openai_message = result.get("message", {"role": "assistant", "content": result.get("output", ""), "reasoning_content": None}) if result else None
            events.append({
                "event_type": "execution_complete",
                "message": openai_message,
                "tokens": tokens,
                "user_message_id": str(self._last_user_message_id) if self._last_user_message_id else None,
                "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
            })

        # finalize_execution
        if self._status == "stop":
            self._finalize_execution(status_override="stop", tokens=tokens)
        elif self._status == "error":
            self._finalize_execution(status_override="error", error_msg=error_msg, tokens=tokens)
        else:
            self._finalize_execution(status_override="completed", tokens=tokens)

        self._current_execution_task = None
        self._current_collector = None

        # save_file_changes
        file_change_message_id = None
        # 新架构下 file_change 的 message_id 已在 save_assistant_message 中更新
        await self.save_file_changes(message_id=None)

        events.append({
            "event_type": "file_changes_ready",
            "message_id": file_change_message_id,
        })

        return events

    def _stream_collector_callback(self, delta, agent_id=None, agent_name=None, execution_key=None):
        """流式收集 + 前端发送（统一数据路径：所有流式 delta 经此转发）。

        execution_key（〇·3）：react_core 6 处 stream_callback 携带，ChunkCollector
        按 execution_key 独立收集（同一 agent 并发 N 实例块互不混淆）。
        """
        self._current_collector.add_chunk(delta, agent_id, agent_name, execution_key)
        if self._stream_send_callback:
            self._stream_send_callback(delta, agent_id, agent_name, execution_key)

    def set_transport_callbacks(self, send_event_callback, message_receiver_func, send_raw_callback=None):
        """注入传输层回调。ws_handler 在 initialize() 中调用。"""
        self._send_event_callback = send_event_callback
        self._message_receiver_func = message_receiver_func
        self._send_raw_callback = send_raw_callback

    async def _send_event(self, event):
        """发送事件到前端（包装 event 格式）。通过回调调用 ws_handler 的 send_json。"""
        if self._send_event_callback:
            try:
                await self._send_event_callback(event)
            except Exception as e:
                logger.error(f"[RunContext] Failed to send event: {e}")

    async def _send_raw(self, data):
        """发送原始数据到前端（不包装）。用于 pong 等直接响应。"""
        if self._send_raw_callback:
            try:
                await self._send_raw_callback(data)
            except Exception as e:
                logger.error(f"[RunContext] Failed to send raw: {e}")

    async def run_event_loop(self):
        """执行层事件循环。等待信号、路由消息、处理生命周期。"""
        self._receiver_task = asyncio.create_task(self._message_receiver_func())

        try:
            while self._websocket_open:
                try:
                    wait_coroutines = []

                    # 等待用户消息
                    message_wait_task = asyncio.create_task(self._ws_message_queue.get())
                    wait_coroutines.append(message_wait_task)

                    # 等待执行完成
                    execution_wait_task = None
                    if self._current_execution_task:
                        execution_wait_task = asyncio.ensure_future(self._current_execution_task)
                        wait_coroutines.append(execution_wait_task)

                    # 等待接管信号
                    taken_over_wait_task = None
                    if self._taken_over_event is not None:
                        taken_over_wait_task = asyncio.ensure_future(self._taken_over_event.wait())
                        wait_coroutines.append(taken_over_wait_task)

                    done, pending = await asyncio.wait(
                        wait_coroutines,
                        return_when=asyncio.FIRST_COMPLETED
                    )

                    # 连接接管
                    if taken_over_wait_task and taken_over_wait_task in done:
                        logger.info(f"[RunContext] Taken over by new connection")
                        for p in pending:
                            p.cancel()
                            try:
                                await p
                            except (asyncio.CancelledError, Exception):
                                pass
                        break

                    # 执行完成
                    if execution_wait_task and execution_wait_task in done:
                        if message_wait_task not in done:
                            message_wait_task.cancel()
                            try:
                                await message_wait_task
                            except (asyncio.CancelledError, Exception):
                                pass
                        if taken_over_wait_task and taken_over_wait_task not in done:
                            taken_over_wait_task.cancel()
                            try:
                                await taken_over_wait_task
                            except (asyncio.CancelledError, Exception):
                                pass

                        events = await self.on_execution_done()
                        for event in events:
                            await self._send_event(event)

                        # 执行完成后，检查队列中是否有待发送消息
                        # 适用于检查点停止后的场景：
                        # - 检查点停止 → stop_execution() → LLM 结束 → on_execution_done() 保存
                        # - 检查队列 → 队列有消息 → send_queue_drained_and_start() 启动新任务
                        # send_queue_drained_and_start() 内部完全复用用户发送消息的流程
                        if self._message_queue.has_pending:
                            await self.send_queue_drained_and_start()
                        continue

                    # 用户消息
                    if message_wait_task in done:
                        result = None
                        try:
                            result = message_wait_task.result()
                        except Exception as e:
                            logger.error(f"[RunContext] Error getting message: {e}")
                            continue

                        if isinstance(result, dict) and result.get("type") == "__disconnect__":
                            logger.info(f"[RunContext] Client disconnected")
                            self._websocket_open = False
                            break

                        if isinstance(result, dict) and "type" in result:
                            self._consecutive_errors = 0
                            data = result

                            if data.get("type") == "ping":
                                await self._send_raw({"type": "pong", "timestamp": time.time()})

                            elif data.get("type") == "terminal_attach":
                                # 前端上报当前激活终端（terminal_id），供 RunCommand 选择执行终端。
                                # 空值/缺省清除：命令执行回退到默认会话选择。
                                self._active_terminal_id = data.get("terminal_id") or None

                            elif data.get("type") == "stop":
                                await self.stop_execution()
                                await self.send_queue_returned()

                            elif data.get("type") == "execute":
                                # ★ str→Msg: 包装 str 为 Msg 对象
                                input_content = data.get("input_message", "")
                                if isinstance(input_content, str):
                                    if not input_content:
                                        continue
                                    data["input_message"] = Msg(name="user", content=input_content, role="user")

                                if not self._current_execution_task or self._current_execution_task.done():
                                    taken_over_event = asyncio.Event()
                                    self._taken_over_event = taken_over_event
                                    start_event = await self.start_execution(data)
                                    exec_ctx = execution_context_manager.get(
                                        user_id=self.user_id,
                                        agentic_flow_id=self.agentic_flow_id,
                                        session_id=self.session_id,
                                        run_project_id=self.run_project_id
                                    )
                                    if exec_ctx:
                                        exec_ctx.websocket_ref = self._websocket
                                        exec_ctx.taken_over_event = taken_over_event
                                    await self._send_event(start_event)
                                else:
                                    user_msg = data["input_message"]
                                    user_text = user_msg.get_text_content() if hasattr(user_msg, 'get_text_content') else str(user_msg)
                                    self.enqueue_message(user_msg)
                                    logger.info(f"[Message Queue] Enqueued message: '{user_text[:50]}', queue_has_pending={self._message_queue.has_pending}")
                                    await self._send_event({
                                        "event_type": "message_queued",
                                        "content": user_text,
                                    })

                            elif data.get("type") == "queue_remove":
                                self.remove_message(data.get("index", -1))

                except asyncio.CancelledError:
                    logger.info(f"[RunContext] Event loop cancelled")
                    break
                except SoloEngineException as e:
                    await self._handle_loop_error(e, is_fatal=e.is_fatal)
                    if not self._websocket_open:
                        break
                    continue
                except Exception as e:
                    await self._handle_loop_error(e)
                    if not self._websocket_open:
                        break
                    continue

        except WebSocketDisconnect:
            logger.info(f"[RunContext] WebSocket disconnected")
            self._websocket_open = False
        except Exception as e:
            logger.error(f"[RunContext] Event loop outer error: {e}", exc_info=True)
            self._websocket_open = False
        finally:
            await self.handle_cleanup()

    async def _handle_loop_error(self, error, is_fatal=False):
        """事件循环错误处理。"""
        self._consecutive_errors += 1
        logger.error(f"[RunContext] Error ({self._consecutive_errors}/{self._max_consecutive_errors}): {error}", exc_info=True)
        try:
            await self._send_raw({
                "type": "error",
                "message": f"Internal error: {str(error)}",
                "timestamp": time.time()
            })
        except Exception:
            pass

        if is_fatal or self._consecutive_errors >= self._max_consecutive_errors:
            logger.error(f"[RunContext] Fatal error or too many errors, closing")
            self._websocket_open = False
        else:
            await asyncio.sleep(settings.WEBSOCKET_ERROR_BACKOFF_BASE * min(self._consecutive_errors, settings.WEBSOCKET_ERROR_BACKOFF_MAX_CONSECUTIVE))

    async def handle_cleanup(self):
        """grace period + 停止 + 完成 + 清理。从 ws_handler.cleanup() 迁移。"""
        self._websocket_open = False

        # 停止消息接收任务
        if self._receiver_task and not self._receiver_task.done():
            self._receiver_task.cancel()
            try:
                await self._receiver_task
            except (asyncio.CancelledError, Exception):
                pass

        # 接管时跳过 grace period
        if self._taken_over_event is not None and self._taken_over_event.is_set():
            logger.info(f"[RunContext] Taken over, skipping grace period: {self.session_id}")
            return

        if self._current_execution_task and not self._current_execution_task.done():
            exec_ctx = execution_context_manager.get(
                user_id=self.user_id,
                agentic_flow_id=self.agentic_flow_id,
                session_id=self.session_id,
                run_project_id=self.run_project_id
            )

            if exec_ctx:
                exec_ctx.websocket_ref = None
                exec_ctx.status = "grace_period"
                exec_ctx.chunks_sent_count = self._current_collector.get_chunk_count() if self._current_collector else 0

            grace_period = settings.WEBSOCKET_GRACE_PERIOD_SECONDS
            logger.info(f"[RunContext] Entering grace period ({grace_period}s): {self.session_id}")

            try:
                saved_taken_over_event = exec_ctx.taken_over_event if exec_ctx else None

                wait_coroutines = [self._current_execution_task]
                if saved_taken_over_event:
                    taken_over_task = asyncio.create_task(saved_taken_over_event.wait())
                    wait_coroutines.append(taken_over_task)

                done, pending = await asyncio.wait(wait_coroutines, timeout=grace_period)

                for p in pending:
                    p.cancel()
                    try:
                        await p
                    except (asyncio.CancelledError, Exception):
                        pass

                if saved_taken_over_event and saved_taken_over_event.is_set():
                    logger.info(f"[RunContext] Execution taken over: {self.session_id}")
                    return

                if self._current_execution_task in done:
                    logger.info(f"[RunContext] Task completed during grace period: {self.session_id}")
                    events = await self.on_execution_done()
                    for event in events:
                        await self._send_event(event)
                else:
                    logger.warning(f"[RunContext] Grace period expired, stopping: {self.session_id}")
                    await self.stop_execution()
                    events = await self.on_execution_done()
                    for event in events:
                        await self._send_event(event)

            except Exception as e:
                logger.error(f"[RunContext] Cleanup error: {e}", exc_info=True)
                try:
                    if self._cancel_event:
                        self._cancel_event.set()
                    if self._current_execution_task and not self._current_execution_task.done():
                        self._current_execution_task.cancel()
                except Exception:
                    pass

        # 注销执行上下文
        execution_context_manager.unregister(
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id
        )
        self.clear_cache()

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

            # 统一 agent_start：所有 agent（mainagent + subagent）统一事件，存储预生成 message_id；subagent 保存 task 消息
            # 键改 execution_key（〇·3）：并发实例各存各的，互不覆盖（后保存不再覆盖先保存）
            if event_type == "agent_start":
                agent_id = getattr(event, "agent_id", None)
                metadata = getattr(event, "metadata", {}) or {}
                msg_id = metadata.get("message_id")
                parent_agent_id = metadata.get("parent_agent_id")
                execution_key = metadata.get("execution_key")
                parent_execution_key = metadata.get("parent_execution_key")
                if agent_id and msg_id and execution_key:
                    self._pending_agent_message_ids[execution_key] = msg_id
                # subagent（有 parent_agent_id）：保存 task 消息作为 subagent 消息的 parent_message_id
                if parent_agent_id and agent_id and execution_key:
                    task_content = metadata.get("task_content") or getattr(event, "content", None)
                    if task_content:
                        save_task = asyncio.create_task(
                            self._save_subagent_task_message(
                                agent_id, task_content, parent_agent_id,
                                parent_execution_key=parent_execution_key,
                                execution_key=execution_key,
                            )
                        )
                        self._subagent_task_save_tasks[execution_key] = save_task

            # 统一保存路径：agent_complete / agent_error 结构完全一致，
            # 唯一区别是 event.status 和 event.error 的取值（由 react_core 赋值）
            if event_type in ("agent_complete", "agent_error"):
                agent_id = getattr(event, "agent_id", None)
                metadata = getattr(event, "metadata", {}) or {}
                parent_agent_id = metadata.get("parent_agent_id")
                execution_key = metadata.get("execution_key")
                # 压缩轮次携带的等待信号：保存完成后 set，供 compiler 层 _execute_agent 等待
                save_done_event = metadata.get("save_done_event")
                save_status = getattr(event, "status", None) or "completed"
                save_error = getattr(event, "error", None) or ""
                # 用户主动停止时，status 覆写为 "stop"，清除 error
                is_user_stop = self._cancel_event is not None and self._cancel_event.is_set()
                if is_user_stop:
                    save_status = "stop"
                    save_error = None
                if agent_id:
                    task = asyncio.create_task(
                        self._save_agent_messages(agent_id, status=save_status, error=save_error, parent_agent_id=parent_agent_id, save_done_event=save_done_event, execution_key=execution_key)
                    )
                    self._pending_save_tasks.append(task)

            # 通过传输层回调发送事件
            # save_done_event 是 Python asyncio.Event 对象，无法 JSON 序列化，发送前端前必须移除
            if event_type in ("agent_complete", "agent_error"):
                getattr(event, "metadata", {}).pop("save_done_event", None)
            # 统一终态事件：execution_complete 由 on_execution_done() 唯一发送（携带 tokens/
            # user_message_id 与最终状态）。flow_compiler 内部 _run_internal 也会 emit
            # execution_complete（无 tokens），若一并转发，前端会收到两次终态事件 →
            # handleExecutionEnd 二次执行 → finalizeStream 已清空 rootAgentIdRef →
            # 二次 commit 用空值覆盖消息头 token（流式 mainagent 消息头 token 丢失根因）。
            # 此处拦截 flow_compiler 的 execution_complete，不转发 WS。
            if event_type == "execution_complete":
                return
            if self._send_event_callback:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(self._send_event(event))
        except Exception as e:
            logger.warning(f"[RunContext] event_callback error: {e}")

    async def _save_subagent_task_message(self, subagent_id: str, task_content: str, parent_agent_id: str = None,
                                          parent_execution_key: str = None, execution_key: str = None):
        """保存 subagent 的 task 消息作为 user 消息，作为 subagent assistant 消息的 parent_message_id。

        方案 SAVE-02：subagent 的 parent_message_id 应为 task 消息 id（非 user 消息 id）。
        task 消息以 role='user', agent_id=subagent_id 保存，与原始 user 消息区分。
        #17 改3：parent_message_id 优先使用预生成的 mainagent message_id（消除断链 1）。
        execution_key（〇·3）：保存后 _subagent_task_message_ids[execution_key] 暂存
        task 消息 id（并发实例各存各的，回显按 parent_message_id 各自嵌套正确）。
        """
        try:
            from app.core.database import get_db_context
            # #17 改3：优先使用预生成的 mainagent message_id（_pending_agent_message_ids 键为
            # execution_key，用调用方实例键 parent_execution_key 查询），而非 default user id
            parent_message_id = self._pending_agent_message_ids.get(parent_execution_key) if parent_execution_key else None
            if not parent_message_id:
                parent_message_id = self._last_user_message_id
            with get_db_context() as db:
                message = await save_session_message(
                    db=db, session_id=self.session_id, user_id=self.user_id,
                    role="user", data=[{"type": "content", "content": task_content}],
                    status="completed", agent_id=subagent_id,
                    parent_agent_id=parent_agent_id,
                    agentic_flow_id=self.agentic_flow_id,
                    run_project_id=self.run_project_id,
                    parent_message_id=parent_message_id,
                )
                if message and execution_key:
                    self._subagent_task_message_ids[execution_key] = str(message.id)
                    logger.info(f"[RunContext] Saved subagent task message: subagent_id={subagent_id}, execution_key={execution_key}, message_id={message.id}")
        except Exception as e:
            logger.error(f"[RunContext] Failed to save subagent task message for {subagent_id}: {e}", exc_info=True)

    def _resolve_error_agent_id(self) -> str:
        """解析 error 状态下保存 assistant 消息使用的 agent_id。

        覆盖 compile/run 任何阶段抛错的场景：
        - 优先级 1：compiled_flow.orchestrator_id（compile 成功但 run 失败）
        - 优先级 2：compiled_flow 入口节点（无上级边，实际执行的主 agent）
        - 优先级 3：compiled_flow.agents 第一个 key（兜底）
        - 优先级 4：canvas_data 第一个 agent 节点 id（compile 阶段失败）
        - 优先级 5："default"（兜底）
        """
        if self._compiled_flow:
            if self._compiled_flow.orchestrator_id:
                return self._compiled_flow.orchestrator_id
            # ★ 优先返回入口节点（无上级边的主 agent），而非编译顺序中的第一个
            entry_nodes = self._compiled_flow.get_entry_nodes()
            if entry_nodes:
                return entry_nodes[0]
            if self._compiled_flow.agents:
                return next(iter(self._compiled_flow.agents))
        canvas_data = getattr(self, '_canvas_data', None) or getattr(self, '_stored_canvas_data', {}) or {}
        if canvas_data:
            for node in canvas_data.get("nodes", []):
                if node.get("type") == "agent":
                    return node.get("id", "default")
        return "default"

    async def _save_agent_messages(self, agent_id: str, status: str = "completed", error: str = None, parent_agent_id: str = None, save_done_event=None, execution_key: str = None):
        """保存指定执行实例的消息，并发送 message_ids_updated 事件。

        execution_key（〇·3）：标识收集/保存的实例（agent_complete/agent_error 事件
        metadata 携带）；save_done_event：压缩轮次由 compiler 层传入的等待信号，
        保存完成后 set（供 _execute_agent 等待）。
        """
        try:
            # error/stop 状态下即使 collector 为 None 也需要保存空消息记录状态
            # 根因：compile 阶段抛错时 collector 可能未创建，但需要保存 error 消息让前端显示
            if not self._current_collector and status not in ("error", "stop"):
                return
            if not self._current_collector:
                self._current_collector = ChunkCollector()
                logger.info(f"[RunContext] Created empty collector for status={status} save")

            # 改动 3 文件 B 修复：mainagent 保存前，等待所有 subagent 保存任务完成
            # 解决异步时序问题：tool_call 固化时 subagent 可能还未保存完成，导致 message_id 未注入
            if not parent_agent_id and self._pending_save_tasks:
                current_task = asyncio.current_task()
                pending = [t for t in self._pending_save_tasks if not t.done() and t is not current_task]
                if pending:
                    logger.info(f"[RunContext] Waiting for {len(pending)} subagent save tasks before mainagent save")
                    await asyncio.gather(*pending, return_exceptions=True)

            update_file_change = False
            if self._compiled_flow and agent_id == self._compiled_flow.orchestrator_id:
                update_file_change = True

            # ★ 方案 SAVE-02：subagent 使用 task 消息 id 作为 parent_message_id（非 user 消息 id）
            # subagent_start 事件触发时保存 task 消息，subagent_complete 时需等待 task 消息保存完成
            parent_message_id = self._last_user_message_id
            if parent_agent_id:  # subagent
                task_save_task = self._subagent_task_save_tasks.get(execution_key)
                if task_save_task:
                    try:
                        await task_save_task  # 等待 task 消息保存完成
                    except Exception:
                        pass
                    self._subagent_task_save_tasks.pop(execution_key, None)
                task_message_id = self._subagent_task_message_ids.get(execution_key)
                if task_message_id:
                    parent_message_id = task_message_id
                    logger.info(f"[RunContext] Using task message id as parent_message_id for subagent {agent_id}: {task_message_id}")

            saved_message_ids = await self.save_assistant_message(
                collector=self._current_collector,
                agent_id=agent_id,
                status=status,
                error=error,
                parent_message_id=parent_message_id,
                update_file_change_message_id=update_file_change,
                parent_agent_id=parent_agent_id,
                execution_key=execution_key,
            )

            if saved_message_ids:
                # 前端期望每个 agent_id 对应一个 message_id（取第一个 block 的 id）
                formatted_ids = {}
                for k, v in saved_message_ids.items():
                    if isinstance(v, list) and v:
                        formatted_ids[k] = v[0]
                    elif isinstance(v, str):
                        formatted_ids[k] = v
                await self._send_event({
                    "event_type": "message_ids_updated",
                    "session_id": self.session_id,
                    "message_ids": formatted_ids,
                })

                # 改动 3 文件 A：subagent 保存后暂存 session_message_id 映射（键 execution_key），
                # 供 mainagent tool_call 固化注入（并发实例各 tool_call 注入自己的 task 消息 id）
                if parent_agent_id and execution_key:
                    saved_list = saved_message_ids.get(agent_id) or saved_message_ids.get(execution_key)
                    first_saved_id = None
                    if isinstance(saved_list, list) and saved_list:
                        first_saved_id = saved_list[0]
                    elif isinstance(saved_list, str):
                        first_saved_id = saved_list
                    if first_saved_id and self._current_collector:
                        self._current_collector._subagent_message_ids[execution_key] = first_saved_id
                        logger.info(f"[RunContext] Stored subagent_message_ids: execution_key={execution_key}, session_message_id={first_saved_id}")
        except Exception as e:
            logger.error(f"[RunContext] Failed to save agent messages for {agent_id}: {e}", exc_info=True)
        finally:
            # 压缩轮次的等待信号：无论保存成功/失败都 set，防止 compiler 层永久等待
            if save_done_event is not None and not save_done_event.is_set():
                save_done_event.set()
    

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
    
    async def execute(self, input_message: Msg, canvas_data: Dict,
                      cancel_event=None,
                      event_callback=None,
                      stream_callback=None) -> Dict:
        self._canvas_data = canvas_data

        # 确保统一 collector 存在
        if self._current_collector is None:
            self._current_collector = ChunkCollector()

        # 设置流式发送回调，让 _stream_collector_callback 统一处理 collector + 前端发送
        # 仅当外部传入 stream_callback 时才覆盖（SSE 模式）；
        # WebSocket 模式下 _stream_send_callback 由 WebSocketRunContext.set_stream_send_callback 设置
        if stream_callback is not None:
            self._stream_send_callback = stream_callback

        def wrapped_event_callback(event):
            self.event_callback(event)
            if event_callback:
                event_callback(event)

        def on_flow_created(compiled_flow):
            self._compiled_flow = compiled_flow
            # 〇·5 保存端：回填本轮 user 消息的 agent_id = 入口 agent（orchestrator /
            # entry node，与 _resolve_error_agent_id 同源逻辑），消除 'default' 占位导致
            # 的全链路 4 处分支。mainagent 的人类输入 user 回填为入口 agent_id 后，
            # 压缩标记端按 agent_id == A 才能命中（依赖本回填先行实施）。
            entry_agent_id = compiled_flow.orchestrator_id
            if not entry_agent_id:
                entry_nodes = compiled_flow.get_entry_nodes()
                entry_agent_id = entry_nodes[0] if entry_nodes else next(iter(compiled_flow.agents), None)
            if entry_agent_id and self._last_user_message_id:
                try:
                    from app.core.database import get_db_context
                    with get_db_context() as db:
                        db.query(SessionMessageModel).filter(
                            SessionMessageModel.id == self._last_user_message_id
                        ).update({"agent_id": entry_agent_id}, synchronize_session=False)
                        db.commit()
                        logger.info(f"[RunContext] Backfilled user message agent_id={entry_agent_id} for id={self._last_user_message_id}")
                except Exception as e:
                    logger.error(f"[RunContext] Failed to backfill user message agent_id: {e}", exc_info=True)
            # 检查 cancel_event 是否已经在 flow 创建前被设置（用户提前点击停止）
            if self._cancel_event and self._cancel_event.is_set():
                logger.info(f"[RunContext] Cancel event already set before flow creation, cancelling new flow")
                asyncio.create_task(compiled_flow.cancel())

        # stream 数据路由：转发到 _stream_collector_callback（统一路径，无检查点逻辑）
        run_ctx = self
        def _stream_forward(delta: dict, agent_id=None, agent_name=None, execution_key=None):
            run_ctx._stream_collector_callback(delta, agent_id=agent_id, agent_name=agent_name, execution_key=execution_key)

        try:
            result = await FlowRunner.run_from_json(
                json_data=canvas_data,
                input_message=input_message,
                user_id=self.user_id,
                agentic_flow_id=self.agentic_flow_id,
                session_id=self.session_id,
                run_project_id=self.run_project_id,
                cancel_event=cancel_event,
                event_callback=wrapped_event_callback,
                stream_callback=_stream_forward,
                agent_memories=self._agent_memories,
                on_flow_created=on_flow_created,
            )
        except asyncio.CancelledError:
            # 任务被取消时，仍需保存 stop 状态的 assistant 消息
            # 注意：agent_error 事件可能已在 event_callback 中触发保存，此处作为兜底
            # _finalize_execution 由 on_execution_done() 统一调用，此处不再重复调用（避免 token 双重累加）
            logger.info(f"[RunContext] execute() CancelledError caught, saving stop status")
            orchestrator_id = self._compiled_flow.orchestrator_id if self._compiled_flow else None
            if orchestrator_id:
                logger.info(f"[RunContext] Calling save_assistant_message(agent_id={orchestrator_id}, status='stop') from CancelledError branch")
                await self._save_agent_messages(orchestrator_id, status="stop")
            raise
        except Exception as e:
            # 执行层异常：agent_error 事件已在 event_callback 中触发保存
            # _finalize_execution 由 on_execution_done() 统一调用，此处不再重复调用（避免 token 双重累加）
            is_user_stop = self._cancel_event is not None and self._cancel_event.is_set()
            logger.info(f"[RunContext] execute() Exception caught: {type(e).__name__}: {e}, is_user_stop={is_user_stop}")
            raise

        self._last_execute_result = result
        # _finalize_execution 由 on_execution_done() 统一调用，此处不再重复调用（避免 token 双重累加）

        return result

    async def execute_node(self, canvas_data: Dict, node_id: str,
                           input_message: Msg, context: Dict = None) -> Dict:
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
        elif final_status == "completed":
            # 成功执行时清除旧的 error 字段，避免遗留上次失败的错误信息
            update_data["error"] = None

        # 会话级 token_usage：统一从 session_messages.token_usage_history 聚合（2026-08-04）。
        # 消息表是唯一 token 数据源（每条消息含 agent_id + token_usage_history），
        # 替代 flow_compiler 内存累计 + message_id 去重。
        self._update_session_token_usage_from_messages()

        if result and result.get("duration_ms"):
            update_data["duration_ms"] = result["duration_ms"]

        self._update_session_status(final_status, **update_data)
    
    def _update_session_token_usage_from_messages(self):
        """从 session_messages.token_usage_history 聚合会话级 token_usage（2026-08-04）。

        消息表是唯一 token 数据源：每条消息保存时已写入自己的 token_usage_history
        （含 agent_id），按 session 聚合 sum 各字段得到会话级值；天然按 agent/消息
        划分，无需内存累计与 message_id 去重。

        覆盖写入（幂等）：多次调用结果一致（聚合对象 = 当前全部消息），
        不使用 db_manager 的累加 update_session_token_usage（会随任务数重复累计）。
        """
        from app.core.database import get_db_context, db_manager, SessionMessageModel
        from sqlalchemy.orm.attributes import flag_modified
        with get_db_context() as db:
            messages = db.query(SessionMessageModel).filter(
                SessionMessageModel.session_id == self.session_id,
                SessionMessageModel.is_deleted == False,
            ).all()
            agg = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "duration_ms": 0,
                "system_prompt_token": 0,
                "user_prompt_token": 0,
                "assistant_prompt_token": 0,
            }
            for m in messages:
                for h in (m.token_usage_history or []):
                    agg["prompt_tokens"] += h.get("prompt_tokens") or 0
                    agg["completion_tokens"] += h.get("completion_tokens") or 0
                    agg["duration_ms"] += h.get("duration_ms") or 0
                    agg["system_prompt_token"] += h.get("system_prompt_token") or 0
                    agg["user_prompt_token"] += h.get("user_prompt_token") or 0
                    agg["assistant_prompt_token"] += h.get("assistant_prompt_token") or 0
            new_usage = {
                "prompt_tokens": agg["prompt_tokens"],
                "completion_tokens": agg["completion_tokens"],
                "total_tokens": agg["prompt_tokens"] + agg["completion_tokens"],
                "system_prompt_token": agg["system_prompt_token"],
                "user_prompt_token": agg["user_prompt_token"],
                "assistant_prompt_token": agg["assistant_prompt_token"],
                "duration_ms": agg["duration_ms"],
                # 统一 5 字段视图（R3：与 _aggregate_token_totals / 前端 TokenTotals 同构）。
                # 终态事件（execution_complete/stopped/error）透传本 dict，前端
                # finalizeExecution 在 agent 级数据（agentUsageMap）缺失时以此兜底
                # token_totals——字段名与前端 TokenTotals 一致，消除两端格式不一致。
                "token_totals": {
                    "system_prompt": agg["system_prompt_token"],
                    "user_prompt": agg["user_prompt_token"],
                    "assistant_prompt": agg["assistant_prompt_token"],
                    "completion": agg["completion_tokens"],
                    "total": agg["prompt_tokens"] + agg["completion_tokens"],
                },
            }
            session = db_manager.get_session(db, self.session_id)
            if session:
                session.token_usage = new_usage
                session.updated_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
                flag_modified(session, "token_usage")
                db.commit()
            return new_usage
    
    def _update_session_status(self, status: str, **kwargs):
        from app.core.database import get_db_context, db_manager
        with get_db_context() as db:
            update_data = {"status": status}
            if status in ("completed", "failed", "stop"):
                update_data["completed_at"] = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
            if kwargs.get("duration_ms"):
                update_data["duration_ms"] = kwargs["duration_ms"]
            if "error" in kwargs:
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
                               status: str = "completed", error: str = None, agent_id=None,
                               parent_agent_id: str = None, execution_key: str = None):
        """统一保存路径：按执行实例（execution_key）批量保存（〇·3 per-execution）。

        核心原则：
        - agent_id 必须传入（新架构下不再支持 agent_id=None 旧路径）
        - execution_key 标识收集/保存的实例：get_agent_data(execution_key) 恒一收集
          该实例的块（无分支）；循环变量 agent_id_key 即 execution_key（收集键），
          写库 agent_id= 用传入的真实 agent_id（并发实例同一 agent_id 各自独立保存，
          互不混淆——修复 L1283 现状误用 agent_id_key 的问题）
        - 一个 agent 的所有 blocks 合并为一条 assistant 消息保存（压缩摘要是普通 block，不分离、不丢弃）
        - is_compressed 批量更新由 compiler 层 _batch_mark_compressed 负责
        - 保存后从 collector 中移除该 execution_key 的已保存数据
        - parent_agent_id 用于 subagent 保存时构建父子关系（mainagent 保存时为 None）
        """
        saved_message_ids = {}
        from app.core.database import get_db_context
        try:
            # 〇·3 per-execution：get_agent_data(execution_key) 恒一收集该实例的块
            agent_data = collector.get_agent_data(execution_key=execution_key) if collector else None

            if not agent_data and agent_id:
                # collector 为空 / 无该 key 数据：创建空 agent_data，统一路径保存空状态记录
                agent_data = {execution_key or agent_id: {'agent_name': None, 'data': []}}

            if not agent_data:
                logger.warning(f"[save_assistant_message] agent_id is required")
                return saved_message_ids

            with get_db_context() as db:
                first_agent_id = None
                for agent_id_key, agent_info in agent_data.items():
                    # agent_id_key 即 execution_key（收集键）；写库必须用真实 agent_id
                    real_agent_id = agent_id or agent_id_key
                    blocks = agent_info.get('data', []) or []
                    llm_config_id = self.get_agent_llm_config_id(real_agent_id)
                    # 方案 B（独立快照）：take 取走该消息对应的 usage 并清空——
                    # stop/compacted/resume/正常轮各自独立记账，无特殊分支（2026-08-04）
                    agent_tokens = self._get_agent_token_usage(execution_key) if execution_key else None
                    if agent_tokens is None:
                        agent_tokens = tokens

                    if first_agent_id is None:
                        first_agent_id = agent_id_key
                        # mainagent: parent_agent_id=None; subagent: 使用传入的 parent_agent_id
                        current_parent_agent_id = parent_agent_id
                    else:
                        current_parent_agent_id = first_agent_id

                    valid_blocks_count = sum(
                        1 for b in blocks
                        if isinstance(b, dict) and (
                            b.get('type') in ('reasoning_content', 'content')
                            and (b.get('content') or b.get('reasoning_content'))
                        ) or (b.get('type') == 'tool_calls' and b.get('tool_calls'))
                    )
                    logger.info(f"[save_assistant_message] agent_id={real_agent_id}, execution_key={agent_id_key}, blocks_count={len(blocks)}, valid_blocks_count={valid_blocks_count}, status={status}")

                    # 统一保存所有 block：压缩摘要是普通 LLM 输出，不分离、不丢弃（pre-compaction 输出丢失 bug 修复）
                    # 统一修复：保存前剥离 collector 内部标记 _added_to_agent_data（防重复 flush 用，泄漏污染 DB）。
                    # 必须浅拷贝：collector 内部状态仍依赖原块的该标记防重复 append。
                    blocks_to_save = []
                    for b in blocks:
                        if not b:
                            continue
                        if isinstance(b, dict):
                            blocks_to_save.append(
                                {k: v for k, v in b.items() if k != '_added_to_agent_data'}
                            )
                        else:
                            blocks_to_save.append(b)

                    saved_ids_for_agent = []
                    first_saved_id = None

                    # 改动 3 文件 B 修复：保存前重新注入 subagent session_message_id 到 tool_calls
                    # 解决异步时序问题：tool_call 固化时 subagent 可能还未保存完成
                    if not parent_agent_id and collector:
                        for block in blocks_to_save:
                            if isinstance(block, dict) and block.get('type') == 'tool_calls':
                                for tc in block.get('tool_calls', []):
                                    collector._inject_subagent_link_to_tool_call(tc)

                    # 统一保存该 agent 的所有 blocks（压缩摘要是普通 block，无需特殊处理）
                    if blocks_to_save:
                        regular_parent_message_id = blocks_to_save[0].get('parent_message_id', parent_message_id)
                        block_id = self._pending_agent_message_ids.pop(execution_key, None) if execution_key else None
                        try:
                            saved_message = await save_session_message(
                                db=db, session_id=self.session_id, user_id=self.user_id,
                                role="assistant", data=blocks_to_save, status=status,
                                agent_id=real_agent_id, tokens=agent_tokens,
                                agentic_flow_id=self.agentic_flow_id,
                                run_project_id=self.run_project_id,
                                parent_message_id=regular_parent_message_id,
                                parent_agent_id=current_parent_agent_id,
                                llm_config_id=llm_config_id,
                                error=error,
                                id=block_id,
                            )
                            if saved_message:
                                saved_id = str(saved_message.id)
                                saved_ids_for_agent.append(saved_id)
                                first_saved_id = saved_id
                                if update_file_change_message_id and regular_parent_message_id:
                                    self._update_file_change_message_id(db, regular_parent_message_id, saved_id)
                        except Exception as e:
                            logger.error(f"[RunContext] Failed to save regular agent message: {e}", exc_info=True)

                    # 空状态记录：所有状态统一路径，parent_message_id 使用调用方传入的正确值
                    if not saved_ids_for_agent:
                        try:
                            saved_message = await save_session_message(
                                db=db, session_id=self.session_id, user_id=self.user_id,
                                role="assistant", data=[], status=status,
                                agent_id=real_agent_id, tokens=agent_tokens,
                                agentic_flow_id=self.agentic_flow_id,
                                run_project_id=self.run_project_id,
                                parent_message_id=parent_message_id,
                                parent_agent_id=current_parent_agent_id,
                                llm_config_id=llm_config_id,
                                error=error,
                            )
                            if saved_message:
                                saved_id = str(saved_message.id)
                                saved_ids_for_agent.append(saved_id)
                                first_saved_id = saved_id
                                logger.info(
                                    f"[save_assistant_message] saved empty state record: "
                                    f"agent_id={real_agent_id}, execution_key={agent_id_key}, status={status}, "
                                    f"parent_message_id={parent_message_id}"
                                )
                        except Exception as e:
                            logger.error(f"[RunContext] Failed to save empty agent message: {e}", exc_info=True)

                    if saved_ids_for_agent:
                        saved_message_ids[agent_id_key] = saved_ids_for_agent

                # 保存后从 collector 移除该 execution_key 数据
                if agent_id and collector and execution_key:
                    collector.remove_agent_data(execution_key)

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

    def _get_agent_token_usage(self, execution_key: str) -> Optional[Dict]:
        """取走该执行实例的当前累计 usage 并清空（消息保存时消费，方案 B 独立快照）。

        每次消息保存调用一次，使下一条消息的 usage 从 0 开始累计——
        压缩轮 stop / compacted / resume 与正常轮完全同路径（2026-08-04 重构）。
        〇·3：并发实例不在 compiled_flow.agents（编译期单实例），必须按
        _execution_instances[execution_key] 取用实例 take_token_usage。正常流程
        execution_key 必已注册（_execute_agent 统一注册 → 执行 → 事件 → 保存，
        时序保证）；取不到 = bug，直接 raise 报错，严禁回退 agents[agent_id]。
        """
        compiled_flow = CompiledFlowFactory.get(
            self.user_id, self.agentic_flow_id,
            self.session_id, self.run_project_id
        )
        if compiled_flow and execution_key in compiled_flow._execution_instances:
            agent = compiled_flow._execution_instances[execution_key]
            if hasattr(agent, 'take_token_usage'):
                return agent.take_token_usage()
        raise RuntimeError(
            f"[RunContext] _get_agent_token_usage: execution_key={execution_key} 不在 "
            f"_execution_instances 注册表（_execute_agent 统一注册时序被破坏 = bug，严禁回退）"
        )
    
    def clear_cache(self):
        CompiledFlowFactory.remove(
            self.user_id, self.agentic_flow_id,
            self.session_id, self.run_project_id
        )
    
    def ensure_session(self):
        from app.core.database import get_db_context, db_manager, AgenticFlowSessionModel
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
    """收集流式chunk并合并，按执行实例（execution_key）独立收集（〇·2 + 〇·3 第 3 层）。

    根本重构：删除全局单一块 + 状态栈，块永远按 execution_key 归位——
    agent 切换只更新 _current_execution_key，无 push/pop；同一 agent 并发 N 实例 =
    N 个独立 execution_key，块/pending/保存天然隔离（B9/B10 语义保持）。
    """

    def __init__(self):
        self._chunks = []
        self._agent_data = {}
        # per-execution：收集键为 execution_key（每次 _execute_agent 调用唯一）
        self._current_execution_key = None
        self._current_agent_name = None
        self._current_blocks = {}  # execution_key -> 当前累积中的块
        self._pending_tool_calls = {}  # execution_key -> pending tool_calls
        self._subagent_message_ids = {}  # execution_key -> session_message_id 映射（保存后暂存，供 tool_call 固化注入）

    def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None, execution_key: str = None):
        """添加chunk，按 execution_key 独立收集（agent 切换只更新当前执行标识，无状态栈）。"""
        # 实时 token 更新事件：非消息块（无 content/reasoning/tool_calls），
        # 仅转发前端用于流式 token 实时显示，不进入 collector 状态机
        #（必须在 agent switch 逻辑之前返回，否则 token 事件会触发执行标识切换污染状态）。
        if isinstance(delta, dict) and delta.get("type") == "agent_token_usage":
            return
        if agent_id and execution_key:
            if self._current_execution_key is None or execution_key != self._current_execution_key:
                self._current_execution_key = execution_key
                self._current_agent_name = agent_name
        
        if self._current_execution_key and self._current_execution_key not in self._agent_data:
            self._agent_data[self._current_execution_key] = {
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
            current_block = self._current_blocks.get(self._current_execution_key, {})
            if current_block and current_block.get('type') == chunk_type:
                current_block[chunk_type] = (current_block.get(chunk_type, "") or "") + content
            else:
                if current_block:
                    self._agent_data[self._current_execution_key]['data'].append(current_block)
                    current_block['_added_to_agent_data'] = True
                new_block = {chunk_type: content, 'type': chunk_type}
                # 统一修复：压缩轮块的 _is_compaction 标记随数据自洽入库
                # （此前新建块丢弃该标记，回显靠 status='compacted' 事后补标——隐式依赖）。
                if delta.get('_is_compaction'):
                    new_block['_is_compaction'] = True
                self._current_blocks[self._current_execution_key] = new_block
        
        self._chunks.append({'delta': delta, 'agent_id': agent_id, 'agent_name': agent_name})
    
    def remove_agent_data(self, execution_key: str):
        """移除指定执行实例（execution_key）的已保存数据（保留原始 _chunks 记录）。

        B10 语义保持（subagent resume 长内容丢失修复）：不再清空 _current_execution_key。
        保存路径（get_agent_data 恒一模式）本身已 flush 并清空 current_block；
        此处移除已保存的 agent_data + 追加清理 _current_blocks[execution_key]
        （resume 新块 add_chunk 自动重建，B10 语义保持）。
        """
        if execution_key in self._agent_data:
            del self._agent_data[execution_key]
        if self._pending_tool_calls and execution_key in self._pending_tool_calls:
            del self._pending_tool_calls[execution_key]
        if execution_key in self._current_blocks:
            del self._current_blocks[execution_key]
    
    def _inject_subagent_link_to_tool_call(self, tc: dict):
        """改动 3 文件 B：Task 工具的 tool_call 收到 result 时，将 session_message_id + subagent_id 注入 tool_call 顶层。

        幂等设计：支持多次调用（tool_call 固化时 + mainagent 保存前）。
        - 首次调用：从 result 获取 subagent_id / execution_key，注入到顶层，从 result 移除
        - 后续调用：从 tc.subagent_id / tc.execution_key 获取（已注入），补充注入 session_message_id
        - message_id：对应 subagent 的 session_message_id（按 execution_key 查 _subagent_message_ids，
          并发实例各 tool_call 注入自己的 task 消息 id，互不覆盖——〇·3）
        - subagent_id：subagent 的 agent_id
        - subagent_name 保留在 arguments 内（LLM 生成），不移动到顶层
        - 从 result 中移除 subagent_id/subagent_name/execution_key（避免重复）
        """
        if tc.get('function', {}).get('name') != 'Task':
            return

        # 优先从顶层获取 subagent_id（之前已注入的情况，幂等支持）
        subagent_id = tc.get('subagent_id')

        if not subagent_id:
            # 首次调用：从 result 获取 subagent_id
            result = tc.get('result', {})
            if isinstance(result, str):
                try:
                    import json
                    result = json.loads(result)
                except Exception:
                    pass
            if not isinstance(result, dict):
                return
            subagent_id = result.get('subagent_id')
            # 将 subagent_id 移到 tool_call 顶层
            if subagent_id:
                tc['subagent_id'] = subagent_id
            # 从 result 中移除 subagent_id/subagent_name（避免重复；subagent_name 保留在 arguments 内）
            if isinstance(tc.get('result'), dict):
                tc['result'] = {k: v for k, v in tc['result'].items() if k not in ('subagent_id', 'subagent_name')}

        # 从 result 提取 execution_key（首次调用），或从 tc 顶层读取（幂等；并发实例各自独立）
        execution_key = tc.get('execution_key')
        if not execution_key:
            result = tc.get('result', {})
            if isinstance(result, str):
                try:
                    import json
                    result = json.loads(result)
                except Exception:
                    pass
            if isinstance(result, dict):
                execution_key = result.get('execution_key')
                if execution_key:
                    tc['execution_key'] = execution_key
                    # 与 subagent_id 同模式：从 result 移除，避免重复
                    if isinstance(tc.get('result'), dict):
                        tc['result'] = {k: v for k, v in tc['result'].items() if k != 'execution_key'}

        # 从 _subagent_message_ids 获取 session_message_id（按 execution_key，并发实例互不覆盖）
        if execution_key:
            session_message_id = self._subagent_message_ids.get(execution_key)
            if session_message_id:
                tc['message_id'] = session_message_id

    def _process_tool_calls(self, tool_calls: list):
        """处理tool_calls，合并调用和result（按 execution_key 独立收集，〇·3）。"""
        execution_key = self._current_execution_key
        if execution_key not in self._pending_tool_calls:
            self._pending_tool_calls[execution_key] = {}

        if 'index_to_id' not in self._pending_tool_calls[execution_key]:
            self._pending_tool_calls[execution_key]['index_to_id'] = {}

        for new_tc in tool_calls:
            tool_id = new_tc.get('id')
            tool_index = new_tc.get('index')
            has_result = 'result' in new_tc or 'error' in new_tc

            if tool_id and tool_index is not None:
                self._pending_tool_calls[execution_key]['index_to_id'][tool_index] = tool_id

            if not tool_id and tool_index is not None:
                tool_id = self._pending_tool_calls[execution_key]['index_to_id'].get(tool_index)

            if tool_id and tool_id in self._pending_tool_calls[execution_key]:
                import copy
                existing_tc = self._pending_tool_calls[execution_key][tool_id]
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
                    # 改动 3 文件 B：固化前注入 session_message_id + subagent_id + execution_key 到 tool_call 顶层
                    self._inject_subagent_link_to_tool_call(existing_tc)
                    current_block = self._current_blocks.get(execution_key, {})
                    if current_block and current_block.get('type') == 'tool_calls':
                        current_block['tool_calls'].append(existing_tc)
                    else:
                        if current_block:
                            self._agent_data[execution_key]['data'].append(current_block)
                        self._current_blocks[execution_key] = {'type': 'tool_calls', 'tool_calls': [existing_tc]}
                    del self._pending_tool_calls[execution_key][tool_id]
            elif tool_id and not has_result:
                import copy
                self._pending_tool_calls[execution_key][tool_id] = copy.deepcopy(new_tc)
            elif tool_id:
                import copy
                # B9 修复：同一 tool_call 的 result delta 重复到达（如 subagent 完成时 Task result
                # 被二次转发）时，若该 tool_id 已固化在当前 tool_calls 块中，仅更新 result/error 字段，
                # 不重复 append——防止数据库出现重复的相同 Task tool_call 块（回显出现空白 Task 徽标）。
                current_block = self._current_blocks.get(execution_key, {})
                if has_result and current_block and current_block.get('type') == 'tool_calls':
                    existing_ids = [tc.get('id') for tc in current_block['tool_calls']]
                    if tool_id in existing_ids:
                        for tc in current_block['tool_calls']:
                            if tc.get('id') == tool_id:
                                if 'result' in new_tc:
                                    tc['result'] = copy.deepcopy(new_tc['result'])
                                if 'error' in new_tc:
                                    tc['error'] = copy.deepcopy(new_tc['error'])
                                break
                        self._pending_tool_calls[execution_key].pop(tool_id, None)
                        continue
                self._pending_tool_calls[execution_key][tool_id] = copy.deepcopy(new_tc)
                if has_result:
                    # 改动 3 文件 B：固化前注入 session_message_id + subagent_id + execution_key 到 tool_call 顶层
                    self._inject_subagent_link_to_tool_call(self._pending_tool_calls[execution_key][tool_id])
                    if current_block and current_block.get('type') == 'tool_calls':
                        current_block['tool_calls'].append(self._pending_tool_calls[execution_key][tool_id])
                    else:
                        if current_block:
                            self._agent_data[execution_key]['data'].append(current_block)
                        self._current_blocks[execution_key] = {'type': 'tool_calls', 'tool_calls': [self._pending_tool_calls[execution_key][tool_id]]}
                    del self._pending_tool_calls[execution_key][tool_id]
            else:
                import copy
                copied_tc = copy.deepcopy(new_tc)
                current_block = self._current_blocks.get(execution_key, {})
                if current_block and current_block.get('type') == 'tool_calls':
                    current_block['tool_calls'].append(copied_tc)
                else:
                    if current_block:
                        self._agent_data[execution_key]['data'].append(current_block)
                    self._current_blocks[execution_key] = {'type': 'tool_calls', 'tool_calls': [copied_tc]}
    
    def _normalize_type(self, delta: dict) -> str:
        if isinstance(delta, str):
            return 'content'
        raw_type = delta.get("type", None)
        if raw_type in ('thinking', 'think', 'reason', 'reasoning_content'):
            return 'reasoning_content'
        if raw_type in ('tool_call', 'tool_calls') or 'tool_calls' in delta:
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
            val = delta.get('reasoning_content') or delta.get('thinking')
            return val if val is not None else ''
        elif chunk_type == 'tool_calls':
            return delta.get('tool_calls', [])
        else:
            val = delta.get('content')
            return val if val is not None else ''
    
    def _handle_agent_switch(self, new_execution_key: str, new_agent_name: str):
        """处理执行实例切换：只更新当前执行标识（per-execution，无状态栈）。

        add_chunk 内 agent switch 判定（execution_key != self._current_execution_key）
        时调用；同一 agent 不同实例视为切换。原状态栈 push/pop 已删除——
        块永远按 execution_key 归位，保存按 key 恒一收集（〇·2/〇·3）。
        """
        self._current_execution_key = new_execution_key
        self._current_agent_name = new_agent_name
    
    def get_agent_data(self, execution_key: str = None) -> dict:
        """收集指定执行实例（execution_key）的数据（恒一模式，〇·2 + 〇·3 第 3 层）。

        与现状（agent_id=None 全量 pop 栈 + agent_id=X 中间保存）的根本区别：
        不再有全量/中间两种模式——per-execution 后每次保存只收自己 execution_key 的
        数据（flush 该 key 的 current_block + 该 key 的 pending tool_calls），
        不触碰其他 execution_key 的状态（并发实例保存互不污染，B9 语义保持）。
        无效 arguments 校验（原全量模式 L1837-1851）移植到本方法。
        """
        if execution_key is None:
            # 无执行实例的保存路径（如 CancelledError 兜底空记录）：不收集任何块
            return {}

        # flush 该 execution_key 的 current_block
        if execution_key in self._current_blocks and self._current_blocks[execution_key] and \
                not self._current_blocks[execution_key].get('_added_to_agent_data'):
            if execution_key not in self._agent_data:
                self._agent_data[execution_key] = {'agent_name': self._current_agent_name, 'data': []}
            self._agent_data[execution_key]['data'].append(self._current_blocks[execution_key])
            self._current_blocks[execution_key]['_added_to_agent_data'] = True
            self._current_blocks[execution_key] = {}

        # flush 该 execution_key 的 pending tool_calls（带无效 arguments 校验）
        pending = self._pending_tool_calls.get(execution_key, {})
        if pending:
            if execution_key not in self._agent_data:
                self._agent_data[execution_key] = {'agent_name': None, 'data': []}

            existing_tool_ids = set()
            for block in self._agent_data[execution_key]['data']:
                if block.get('type') == 'tool_calls':
                    for tc in block.get('tool_calls', []):
                        if tc.get('id'):
                            existing_tool_ids.add(tc['id'])

            new_tool_calls = []
            for tool_id, tc in pending.items():
                if tool_id == 'index_to_id':
                    continue
                if tool_id not in existing_tool_ids:
                    # 校验 tool_call arguments 是否为有效 JSON：LLM 输出因 max_output_tokens
                    # 截断会产生无效 arguments（如 Write 大文件内容）。此类 tool_call 从未被
                    # 后端执行，固化会污染 LLM 上下文（下次调用 400 invalid function arguments），
                    # 必须丢弃，只保留完整合法的 tool_call。
                    args = (tc.get('function') or {}).get('arguments')
                    if isinstance(args, str):
                        try:
                            json.loads(args)
                        except Exception:
                            logger.warning(
                                f"[ChunkCollector] Dropping truncated tool_call {tool_id} "
                                f"({(tc.get('function') or {}).get('name')}): invalid arguments JSON"
                            )
                            continue
                    new_tool_calls.append(tc)

            if new_tool_calls:
                self._agent_data[execution_key]['data'].append({
                    'type': 'tool_calls',
                    'tool_calls': new_tool_calls
                })
                # 固化后清理 pending，防止多次收集重复固化同一 tool_call
                for tool_id in new_tool_calls:
                    pending.pop(tool_id, None)

        # 清理空块（仅该 execution_key）
        if execution_key in self._agent_data:
            cleaned_data = []
            for block in self._agent_data[execution_key]['data']:
                block_type = block.get('type')
                if block_type == 'content' and not block.get('content', '').strip():
                    continue
                if block_type == 'reasoning_content':
                    pass
                if block_type == 'tool_calls' and not block.get('tool_calls', []):
                    continue
                cleaned_data.append(block)
            self._agent_data[execution_key]['data'] = cleaned_data

        return {execution_key: self._agent_data.get(execution_key, {'agent_name': None, 'data': []})}
    
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
    id: str = None,
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
        
        token_usage_history = tokens.get('token_usage_history') if tokens else None

        message = db_manager.add_session_message(
            db=db, session_id=session_id, user_id=user_id, role=role,
            data=data, status=status, agent_id=agent_id,
            parent_message_id=parent_message_id, parent_agent_id=parent_agent_id,
            token_usage_history=token_usage_history,
            llm_config_id=llm_config_id,
            error=error,
            id=id,
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

    # 查询所有未压缩的消息（包括最新的压缩摘要和压缩后新增的消息）
    # 设计：压缩完成后，旧消息被批量更新为 is_compressed=True，
    # 最新压缩摘要本身 is_compressed=False（默认值），压缩后新增的消息也是 is_compressed=False
    # 所以查询 is_compressed=False 即可获取所有需要加载到 LLM 上下文的消息
    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id,
        SessionMessageModel.is_deleted == False,
        SessionMessageModel.is_compressed == False
    ).order_by(SessionMessageModel.message_index).all()
    all_records = list(records)

    # 所有消息按时间顺序存储，每个agent维护自己的完整对话历史
    all_messages = []
    excluded_empty_state_ids = []

    for record in all_records:
        data = record.data or []
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                data = []

        # ★ 修复 3：空 assistant 状态记录（error/stop 时保存的占位记录，data=[]，无有效内容）
        # 不能进入 LLM 上下文。判断条件：role=assistant 且 data 为空列表（或解析为空列表）。
        # 数据库保留该记录用于前端状态展示。
        if record.role == "assistant":
            normalized = data if isinstance(data, list) else []
            has_content = any(
                isinstance(b, dict) and (
                    (b.get('type') == 'content' and b.get('content'))
                    or (b.get('type') == 'reasoning_content' and b.get('reasoning_content'))
                    or (b.get('type') == 'tool_calls' and b.get('tool_calls'))
                )
                for b in normalized
            )
            if not has_content:
                excluded_empty_state_ids.append(str(record.id))
                continue
        filtered_data = _filter_tool_results(data)

        message = {
            "role": record.role,
            "data": filtered_data,
            "agent_id": record.agent_id,
            "parent_agent_id": record.parent_agent_id,
            "message_index": record.message_index
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

    if excluded_empty_state_ids:
        logger.info(
            f"[load_and_distribute_memories] excluded empty assistant state records from LLM context: "
            f"{excluded_empty_state_ids} (kept in DB for status display)"
        )

    # 按 message_index 排序，保持时间顺序
    all_messages.sort(key=lambda x: x.get("message_index", 0))

    # 构建 agent_memories：每个agent获得完整的对话历史
    agent_memories = {}
    default_agent_id = "default"

    # 找到所有agent_id（包括 default）
    agent_ids = set()
    for msg in all_messages:
        agent_id = msg.get("agent_id")
        if agent_id:  # 不过滤 default
            agent_ids.add(agent_id)

    # 如果没有特定agent，使用default
    if not agent_ids:
        agent_ids = {default_agent_id}

    # 〇·5 统一分发：每个 agent 只收自己的消息（user 消息归属 = 接收 agent：
    # 人类输入已由 on_flow_created 回填为入口 agent_id，task 输入 agent_id=subagent_id）。
    # 上下文隔离天然保持（agent_id 不同即隔离），无 is_subagent / 'default' 分支。
    for agent_id in agent_ids:
        agent_memories[agent_id] = []
        for msg in all_messages:
            if msg.get('agent_id') == agent_id:
                # 移除内部字段
                clean_msg = {k: v for k, v in msg.items() if k not in ("message_index", "parent_agent_id")}
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
                # 防御性过滤：arguments 非有效 JSON 的 tool_call（LLM 输出截断产物）禁止进入
                # LLM 上下文，否则 LLM API 会因 invalid function arguments json string 返回 400。
                # 历史坏数据（固化校验前已保存）在此统一拦截。
                args = (tc.get("function") or {}).get("arguments")
                if isinstance(args, str):
                    try:
                        json.loads(args)
                    except Exception:
                        logger.warning(
                            f"[_filter_tool_results] Skipping invalid tool_call "
                            f"{tc.get('id')} ({(tc.get('function') or {}).get('name')}): invalid arguments JSON"
                        )
                        continue
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
    global _cleanup_task
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
        
        # ★ str→Msg: 包装 str 为 Msg 对象
        input_msg = Msg(name="user", content=request.input_message, role="user")
        result = await run_context.execute(
            input_message=input_msg,
            canvas_data=request.canvas_data,
            context=request.context or {},
        )

        await run_context.save_user_message(request.input_message)
        
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
    try:
        user_id = request.user_id or current_user.id
        run_context = AgenticFlowRunContext(
            user_id=user_id,
            agentic_flow_id=request.agentic_flow_id,
            session_id=request.session_id,
            run_project_id=request.run_project_id,
        )
        await run_context.load_memories()
        
        # ★ str→Msg: 包装 str 为 Msg 对象
        input_msg = Msg(name="user", content=request.input_message, role="user")
        result = await run_context.execute_node(
            canvas_data=request.canvas_data,
            node_id=request.node_id,
            input_message=input_msg,
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
    http_request: Request,
    request: ExecuteJSONRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    import asyncio

    stream_queue = asyncio.Queue()
    execution_result = None
    execution_error = None

    run_context = AgenticFlowRunContext(
        user_id=current_user.id,
        agentic_flow_id=request.agentic_flow_id,
        session_id=request.session_id,
        run_project_id=request.run_project_id,
    )

    def stream_callback(delta: dict):
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(stream_queue.put(delta))
        except Exception as e:
            logger.error(f"Stream callback error: {e}")

    async def run_execution():
        nonlocal execution_result, execution_error
        try:
            await run_context.load_memories()

            # ★ str→Msg: 包装 str 为 Msg 对象
            input_msg = Msg(name="user", content=request.input_message, role="user")
            result = await run_context.execute(
                input_message=input_msg,
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
                # 检测客户端断开（AbortController.abort 触发），复用现有 stop_execution 机制真正停止 LLM
                if await http_request.is_disconnected():
                    logger.info("[SSE] Client disconnected, stopping execution")
                    await run_context.stop_execution()
                    break

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
                openai_message = execution_result.get("message", {"role": "assistant", "content": execution_result.get("output", "")}) if execution_result else {"role": "assistant", "content": ""}
                tokens = execution_result.get("tokens") or execution_result.get("token_usage") if execution_result else None
                yield f"data: {json.dumps({'type': 'execution_complete', 'message': openai_message, 'data': execution_result, 'tokens': tokens}, ensure_ascii=False)}\n\n"

            if request.session_id:
                tokens = execution_result.get("tokens") or execution_result.get("token_usage") if execution_result else None
                try:
                    await run_context.save_user_message(request.input_message)
                except Exception as save_error:
                    logger.error(f"Failed to save session user message: {save_error}")

        except asyncio.CancelledError:
            logger.info("[SSE] Generator cancelled, stopping execution")
            await run_context.stop_execution()
            raise
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


def _aggregate_token_totals(history: list) -> Dict[str, Any]:
    """从 token_usage_history 聚合 5 字段（后端聚合改造 3.3：前端不再求和）。

    聚合值在接口层实时计算（token_usage_history 已持久化，无需新增数据库列）。
    返回键名与前端 TokenTotals 一致：system_prompt/user_prompt/assistant_prompt/
    completion/total。
    """
    history = history or []
    return {
        "system_prompt": sum(h.get('system_prompt_token', 0) or 0 for h in history),
        "user_prompt": sum(h.get('user_prompt_token', 0) or 0 for h in history),
        "assistant_prompt": sum(h.get('assistant_prompt_token', 0) or 0 for h in history),
        "completion": sum(h.get('completion_tokens', 0) or 0 for h in history),
        "total": sum(h.get('total_tokens', 0) or 0 for h in history),
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

    # 从 canvas_data 构建 agent_id -> agent_name 映射（subagent 嵌套块的 agent_name 来源；
    # 数据库消息无 agent_name 字段，前端组名依赖 block.agent_name）
    agent_name_map: Dict[str, str] = {}
    try:
        flow_model = session.agentic_flow
        if flow_model and flow_model.canvas_data:
            canvas = json.loads(flow_model.canvas_data) if isinstance(flow_model.canvas_data, str) else flow_model.canvas_data
            for node in (canvas.get("nodes") or []):
                node_id = node.get("id")
                node_name = (node.get("data") or {}).get("name")
                if node_id and node_name:
                    agent_name_map[str(node_id)] = str(node_name)
    except Exception as e:
        logger.warning(f"[get_session_messages] Failed to parse canvas_data for agent_name map: {e}")

    # 查询所有消息
    messages = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == current_user.id,
        SessionMessageModel.is_deleted == False
    ).order_by(SessionMessageModel.message_index).offset(offset).limit(limit).all()

    # 构建 message_id -> message 映射（用于 message_id 精确匹配 subagent）
    message_map: Dict[str, SessionMessageModel] = {str(m.id): m for m in messages}

    # 构建 parent_message_id -> [children] 映射（用于找 mainagent）
    children_map: Dict[str, List[SessionMessageModel]] = {}
    for m in messages:
        pid = str(m.parent_message_id) if m.parent_message_id else None
        if pid not in children_map:
            children_map[pid] = []
        children_map[pid].append(m)
    # 对每个 parent 的 children 按 message_index 排序
    for pid in children_map:
        children_map[pid].sort(key=lambda m: m.message_index or 0)

    matched_ids: set = set()  # 已通过 message_id 精确匹配的 subagent id

    def build_flattened_blocks(msg: SessionMessageModel, agent_level: int,
                               group_agent_tokens: Optional[int] = None,
                               group_agent_totals: Optional[Dict[str, Any]] = None,
                               group_agent_history: Optional[List[Dict[str, Any]]] = None,
                               execution_key: Optional[str] = None) -> List[Dict[str, Any]]:
        """为单条 assistant 消息构建扁平化 blocks（含 subagent 嵌套）。

        遍历 msg.data blocks，遇 Task tool_call 时用 subagent_id 精确匹配 subagent
        （兼容旧数据用 message_id 匹配），将该 subagent 在本任务下的全部 assistant 消息
        （stop → compacted → completed，按 message_index 排序）的 blocks 插入到
        Task tool_call 之后——即 subagent 的压缩块嵌套在 subagent 层级（agent_level+1），
        而非顶层独立返回（问题 2 修复：压缩块应放在 subagent 层级）。

        execution_key（〇·3 并发修复）：subagent 实例唯一键——同一 Task 调用实例的
        全部消息共享同一个 root_task_id（task user 消息 id，天然唯一），前端
        groupDataBlocksByAgent 按 agent_id + execution_key 分组，同 agent 并发 N 实例
        （TA10）各自独立成组、组头 token 独立显示；mainagent 不传（None，单组）。
        """
        result_blocks = []
        # 从 token_usage_history 计算 agent 级 token 总值
        history = msg.token_usage_history or []
        agent_total = sum(h.get('total_tokens', 0) for h in history)
        agent_prompt = sum(h.get('prompt_tokens', 0) for h in history)
        agent_completion = sum(h.get('completion_tokens', 0) for h in history)
        # 后端聚合改造（3.3-4）：块级本阶段聚合（压缩气泡 hover 用），从该消息 history 求和
        block_totals = _aggregate_token_totals(history)
        for block in msg.data or []:
            enriched_block = {
                **block,
                'agent_id': msg.agent_id,
                # 嵌套 subagent 块的 agent_name 来源（问题 1/2 修复：所有 agent 前端显示一致）：
                # 数据库消息无 agent_name 字段，顶层 agent 名由前端 extractAgentName 从
                # canvas_data 实时查询，此处同样使用 canvas 映射，保证嵌套块与顶层一致
                'agent_name': agent_name_map.get(str(msg.agent_id)) or None,
                'agent_level': agent_level,
                'message_index': msg.message_index,
                'agent_tokens': agent_total or None,
                'agent_prompt_tokens': agent_prompt or None,
                'agent_completion_tokens': agent_completion or None,
                # 组级整轮累计（后端聚合改造：subagent 组头回显用）。该 subagent 本次
                # task 调用下全部消息（stop→compacted→completed）history 求和，
                # 与流式 agentUsageMap[agent_id] 整轮累计同构；块级 agent_tokens 仍为
                # 单消息（压缩气泡 tokens 用）。mainagent 调用不传（组头走消息级聚合）。
                'group_agent_tokens': group_agent_tokens,
                'group_agent_totals': group_agent_totals,
                'group_agent_history': group_agent_history,
                # 〇·3 并发修复：块级实例唯一键（前端 groupDataBlocksByAgent 分组依据，
                # 同 agent 并发 N 实例各自独立成组；mainagent 为 None）
                'execution_key': execution_key,
                # 问题 3 修复：注入该 agent 的 token_usage_history（subagent 组头/压缩气泡
                # hover 详情数据源，与流式 injectAgentTokens 注入的 history 同构）。
                # 块级 history 与消息级 msg.token_usage_history 等价（前端 TokenBadge 通用）。
                'agent_token_history': history,
                # 后端聚合改造（3.3-4）：块级本阶段聚合（压缩气泡 hover 用），
                # 与 agent_token_history 同源（后端算好，前端不再求和）
                'agent_token_totals': block_totals,
            }
            # 压缩摘要块标记：compacted 消息的全部块（content 摘要 + reasoning_content 思考）
            # 统一标记为「上下文已压缩」气泡，与流式路径（react_core 压缩轮 reasoning/content
            # 均带 _is_compaction）完全同构（问题 1 修复：压缩轮 thought 归入压缩气泡，
            # 不再被当作 subagent/mainagent 的普通内容）。
            if msg.status == 'compacted' and block.get('type') in ('content', 'reasoning_content'):
                enriched_block['_is_compaction'] = True
            result_blocks.append(enriched_block)
            # 遇 Task tool_call：精确拼接该 subagent 本次 task 下的全部 assistant 消息
            # （stop → compacted → completed，按 message_index 排序），使 subagent 的压缩块
            # 嵌套在 subagent 层级（agent_level+1）而非顶层独立返回（问题 2 修复）。
            if block.get('type') == 'tool_calls':
                for tc in block.get('tool_calls', []):
                    if tc.get('function', {}).get('name') == 'Task':
                        subagent_msg_id = tc.get('message_id')
                        subagent_id = tc.get('subagent_id')
                        root_task_id = None
                        # message_id 指向 subagent 的 completed/stop/compacted 消息，
                        # 其 parent_message_id 为 subagent 的 task user 消息（本次任务根）
                        if subagent_msg_id and subagent_msg_id in message_map:
                            root_task_id = str(message_map[subagent_msg_id].parent_message_id) or None
                        if root_task_id:
                            sub_msgs = [
                                m for m in messages
                                if str(m.parent_message_id) == root_task_id
                                and m.role == 'assistant'
                                and str(m.id) not in matched_ids
                            ]
                        elif subagent_id:
                            # 兼容旧数据（无 message_id）：按 subagent_id 收集其 assistant 消息
                            sub_msgs = [
                                m for m in messages
                                if m.agent_id == subagent_id and m.role == 'assistant'
                                and str(m.id) not in matched_ids
                            ]
                        else:
                            sub_msgs = []
                        sub_msgs.sort(key=lambda m: m.message_index or 0)
                        # 组级聚合（后端聚合改造）：该 subagent 本次 task 调用下全部消息
                        # （stop→compacted→completed）history 求和，作为组头回显的整轮累计，
                        # 与流式 agentUsageMap[agent_id] 同构——前端不再按 blocks 拼接。
                        _sub_history: List[Dict[str, Any]] = []
                        for _sm in sub_msgs:
                            _sub_history.extend(_sm.token_usage_history or [])
                        _group_agent_tokens = sum(h.get('total_tokens', 0) for h in _sub_history) or None
                        _group_agent_totals = _aggregate_token_totals(_sub_history)
                        for sub_msg in sub_msgs:
                            matched_ids.add(str(sub_msg.id))
                            sub_blocks = build_flattened_blocks(
                                sub_msg, agent_level + 1,
                                _group_agent_tokens, _group_agent_totals, _sub_history,
                                execution_key=root_task_id,
                            )
                            result_blocks.extend(sub_blocks)
        return result_blocks

    result = []
    # 〇·5 回显端：roots 用 role='user' AND parent_message_id IS NULL（task 消息
    # parent_message_id 非空天然排除——task user 消息以 role='user' 保存但挂在
    # mainagent 消息下，不再依赖 'default' 占位 agent_id 识别人类输入）
    roots = [m for m in messages if m.role == 'user' and not m.parent_message_id]
    roots.sort(key=lambda m: m.message_index or 0)

    for user_msg in roots:
        # 1. 加入 user 消息
        unified_data = []
        for block in user_msg.data or []:
            unified_data.append({
                **block,
                'agent_id': None,
                'agent_name': '用户',
                'agent_level': 0
            })
        result.append({
            "id": user_msg.id,
            "role": "user",
            "agent_id": user_msg.agent_id,
            "parent_agent_id": user_msg.parent_agent_id,
            "parent_message_id": user_msg.parent_message_id,
            "data": unified_data,
            "status": user_msg.status,
            "error": user_msg.error,
            "message_index": user_msg.message_index,
            "token_usage_history": user_msg.token_usage_history,
            # 后端聚合改造（3.3-3）：user 消息无 token，聚合为空对象、tokens 为 None
            "token_usage": {},
            "tokens": None,
            "is_compressed": user_msg.is_compressed,
            "timestamp": format_iso(user_msg.timestamp),
            "created_at": format_iso(user_msg.created_at),
        })
        matched_ids.add(str(user_msg.id))

        # 2. 找 parent_message_id=user.id 的 mainagent 消息并合并为一条（3.3）：
        #    同一 user 下的 mainagent stop/compacted/completed 按 message_index 合并——
        #    data 顺序拼接、token_usage_history 拼接、聚合 5 字段 + total 后端算好，
        #    与流式"mainagent 单条消息"同构（前端 loadMessagesWithFileChanges 的
        #    pendingMain 合并逻辑删除，前端不再拼接）。
        mainagent_children = [
            m for m in messages
            if str(m.parent_message_id) == str(user_msg.id)
            and str(m.id) not in matched_ids
        ]
        mainagent_msgs = [
            m for m in mainagent_children
            if m.role == 'assistant'  # 跳过 task 消息（role='user'）
        ]
        mainagent_msgs.sort(key=lambda m: m.message_index or 0)
        if mainagent_msgs:
            merged_data = []
            merged_history = []
            for mainagent_msg in mainagent_msgs:
                matched_ids.add(str(mainagent_msg.id))
                merged_history.extend(mainagent_msg.token_usage_history or [])
                merged_data.extend(build_flattened_blocks(mainagent_msg, 0))
            first_msg = mainagent_msgs[0]
            last_msg = mainagent_msgs[-1]
            merged_totals = _aggregate_token_totals(merged_history)
            result.append({
                "id": first_msg.id,
                "role": "assistant",
                "agent_id": first_msg.agent_id,
                "parent_agent_id": first_msg.parent_agent_id,
                "parent_message_id": first_msg.parent_message_id,
                "data": merged_data,
                "status": last_msg.status,
                "error": last_msg.error,
                "message_index": first_msg.message_index,
                "token_usage_history": merged_history,
                # 后端聚合改造（3.3-1）：合并后聚合字段（消息头 hover 数据源）
                "token_usage": merged_totals,
                "tokens": merged_totals["total"],
                "is_compressed": last_msg.is_compressed,
                "timestamp": format_iso(first_msg.timestamp),
                "created_at": format_iso(first_msg.created_at),
            })

    # 4. 压缩轮次相关消息独立返回：subagent 的 pre-compaction 输出（status=stop）与
    #    压缩摘要（status=compacted）的 parent_message_id 指向 subagent 的 task 消息
    #    （非 user 消息），不在 mainagent_children 分支中返回。为满足
    #    "LLM块 → 压缩轮 → LLM块"的回显顺序，未被拼接的 stop/compacted assistant
    #    消息单独返回，并按 message_index 整体排序（agent_level=1：subagent 层）。
    for m in messages:
        if str(m.id) not in matched_ids and m.role == "assistant" and m.status in ("stop", "compacted"):
            matched_ids.add(str(m.id))
            totals = _aggregate_token_totals(m.token_usage_history or [])
            result.append({
                "id": str(m.id),
                "role": m.role,
                "agent_id": m.agent_id,
                "parent_agent_id": m.parent_agent_id,
                "parent_message_id": m.parent_message_id,
                "data": build_flattened_blocks(m, 1, execution_key=str(m.parent_message_id)),
                "status": m.status,
                "error": m.error,
                "message_index": m.message_index,
                "token_usage_history": m.token_usage_history,
                # 后端聚合改造（3.3-2）：未被拼接的独立 stop/compacted 同样附加聚合字段
                "token_usage": totals,
                "tokens": totals["total"],
                "is_compressed": m.is_compressed,
                "timestamp": format_iso(m.timestamp),
                "created_at": format_iso(m.created_at),
            })

    # 5. 按 message_index 排序，保证"LLM块→压缩轮→LLM块"回显顺序
    result.sort(key=lambda r: r.get("message_index") or 0)

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
            "system_prompt_token": m.system_prompt_token,
            "user_prompt_token": m.user_prompt_token,
            "assistant_prompt_token": m.assistant_prompt_token,
            "token_usage_history": m.token_usage_history,
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
# 新方案：get_session_messages 内联 build_flattened_blocks，基于 tc.message_id 精确关联 subagent
# =============================================================================
