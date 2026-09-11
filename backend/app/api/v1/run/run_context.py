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

from .message_queue import MessageQueue
from .run_collector import ChunkCollector
from .run_save import aggregate_incremental_to_net_view, save_session_message, load_and_distribute_memories, aggregate_token_totals

# B6：flow 执行终态（completed/stop/failed）→ run 内部状态（completed/stop/error）唯一映射表。
# flow 是执行终态的唯一真相源，run 层直接采用，不再自行推导/兜底。
FLOW_STATUS_TO_RUN_STATUS = {"completed": "completed", "stop": "stop", "failed": "error"}

# B9：run 内部终态 → 终态事件表驱动（事件类型/事件状态/附带字段），终态事件唯一构造路径。
TERMINAL_EVENT_TABLE = {
    "stop": {"event_type": "execution_stopped", "status": "stopped", "with_error": False, "with_message": False},
    "error": {"event_type": "execution_error", "status": "error", "with_error": True, "with_message": False},
    "completed": {"event_type": "execution_complete", "status": "completed", "with_error": False, "with_message": True},
}


def build_terminal_event(run_status: str, tokens: Dict = None,
                         error_msg: str = None, openai_message: Dict = None,
                         user_message_id: str = None) -> Dict:
    """表驱动构造终态事件（B9：stop/error/completed 3 分支收敛为唯一路径）。"""
    spec = TERMINAL_EVENT_TABLE[run_status]
    event = {
        "event_type": spec["event_type"],
        "status": spec["status"],
        "tokens": tokens,
        "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
    }
    if spec["with_error"]:
        event["error"] = error_msg or ""
    if spec["with_message"]:
        event["message"] = openai_message
        event["user_message_id"] = user_message_id
    return event


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
        # 工具交互回答送达点（审批/提问）：工具 wait_for_user_message 创建的 Future 按
        # tool_call_id 注册于此（Dict），WS interaction_answer 分支按 id 精确 set_result
        # 直接送达——回答零队列中转，与业务排队消息（_message_queue，队列机制）本质隔离
        # （队列 vs 直接送达）；并发工具各自 Future 独立注册，互不覆盖（单槽位覆盖 bug 根治）。
        self._pending_interactions: Dict[str, "asyncio.Future"] = {}
        self._ws_message_queue = asyncio.Queue()   # WebSocket 传输队列（dict），仅数据传递

        # 从 websocket_handler 移入的执行状态
        self._current_execution_task = None
        self._current_collector = None
        self._status = "completed"
        self._cancel_event = None
        self._stored_canvas_data = {}
        # 前端当前激活终端（terminal_attach WS 消息写入）：RunCommand 选择命令执行的 PTY 会话。
        # 关联决策在前端（用户查看的终端），后端仅承载状态，工具经 human_in_the_loop.get_terminal_id() 读取。
        self._active_terminal_id: Optional[str] = None
        self._pending_stream_tasks = []
        self._pending_save_tasks = []  # agent 消息保存任务（event_callback 触发）
        self._current_round_index = 0
        # subagent task 消息管理：保存 subagent 的 task 消息 id 作为 parent_message_id
        self._subagent_task_message_ids: Dict[str, str] = {}  # message_id -> task message id
        self._subagent_task_save_tasks: Dict[str, "asyncio.Task"] = {}  # message_id -> save task
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

    # ---- C5：工具交互回答送达点（_pending_interactions）公开方法 ----
    # human_in_the_loop.py 等插件层经公开方法注册/移除/查询，不再直接读写私有 _pending_interactions

    def add_pending_interaction(self, tool_call_id: str, future: "asyncio.Future") -> None:
        """注册工具交互回答送达点：按 tool_call_id 绑定 Future（回答到达时按 id 精确唤醒）。"""
        self._pending_interactions[tool_call_id] = future

    def remove_pending_interaction(self, tool_call_id: str) -> None:
        """移除工具交互回答送达点（工具 await 结束后调用，防止迟到回答误唤醒残留 Future）。"""
        self._pending_interactions.pop(tool_call_id, None)

    def get_pending_interaction(self, tool_call_id: str) -> Optional["asyncio.Future"]:
        """按 tool_call_id 获取回答送达 Future（无则 None）。"""
        return self._pending_interactions.get(tool_call_id)

    def set_stream_send_callback(self, callback):
        """注入流式数据发送回调。重连时 ws_handler 调用更新。"""
        self._stream_send_callback = callback

    async def start_execution(self, data, stream_callback=None):
        """创建执行任务。返回 execution_start 事件数据。

        stream_callback: HTTP/SSE 模式透传给 execute()（WebSocket 模式由
        WebSocketRunContext.set_stream_send_callback 设置，保持 None）。
        """
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
                stream_callback=stream_callback,
                context=data.get("context"),
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
        queue_msgs = self._message_queue.drain_all()
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
        # flow 是执行终态的唯一真相源，run 层直接采用，不再自行推导/兜底（B6：模块级常量表）。
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
                self._status = FLOW_STATUS_TO_RUN_STATUS.get(result_status, "completed")
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

        # 执行状态事件（B9：表驱动唯一构造路径，stop/error/completed 3 分支收敛）
        openai_message = result.get("message", {"role": "assistant", "content": result.get("output", ""), "reasoning_content": None}) if result else None
        events.append(build_terminal_event(
            self._status,
            tokens=tokens,
            error_msg=error_msg,
            openai_message=openai_message,
            user_message_id=str(self._last_user_message_id) if self._last_user_message_id else None,
        ))

        # finalize_execution（B9：status_override = run 内部终态；仅 error 分支携带 error_msg）
        finalize_kwargs = {"status_override": self._status, "tokens": tokens}
        if TERMINAL_EVENT_TABLE[self._status]["with_error"]:
            finalize_kwargs["error_msg"] = error_msg
        self._finalize_execution(**finalize_kwargs)

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

    def _stream_collector_callback(self, delta, agent_id=None, agent_name=None, message_id=None):
        """流式收集 + 前端发送（统一数据路径：所有流式 delta 经此转发）。

        message_id（〇·3）：react_core 6 处 stream_callback 携带，ChunkCollector
        按 message_id 独立收集（同一 agent 并发 N 实例块互不混淆）。
        """
        self._current_collector.add_chunk(delta, agent_id, agent_name, message_id)
        if self._stream_send_callback:
            self._stream_send_callback(delta, agent_id, agent_name, message_id)

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
                        # 消息分支（message_wait_task 先完成）：本轮的 taken_over_wait_task
                        # 不再需要，立即 cancel——否则 Event.wait() task 失去引用后由 GC
                        # 回收时触发 "Task was destroyed but it is pending!" 警告（泄漏）。
                        # 与执行完成分支（taken_over_wait_task cancel）同一清理模式。
                        if taken_over_wait_task and taken_over_wait_task not in done:
                            taken_over_wait_task.cancel()
                            try:
                                await taken_over_wait_task
                            except (asyncio.CancelledError, Exception):
                                pass

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

                            elif data.get("type") == "interaction_answer":
                                # 工具交互回答（审批/提问）：直接送达等待中的工具。
                                # 工具 wait_for_user_message 已把 Future 按 tool_call_id 注册到
                                # _pending_interactions 并 await 等待（工具自身等待操作）；
                                # 前端审批回答携带 tool_call_id，此处按 id 精确 set_result 唤醒——
                                # 回答零队列中转，与排队消息（execute → _message_queue）本质隔离，
                                # 审批等待绝不会误取排队消息；并发工具各自 Future 独立送达互不覆盖。
                                answer_text = data.get("content", "")
                                if not answer_text:
                                    continue
                                tool_call_id = data.get("tool_call_id", "") or ""
                                # 精确路由：按前端携带的 tool_call_id 找到对应 Future。
                                # 兜底（无 id / 工具未带 id 的旧链路）：取唯一未完成 Future，
                                # 多个未完成时取最先注册者（保持"首个回答送首个等待工具"顺序）。
                                pending = self._pending_interactions.get(tool_call_id)
                                if pending is None or pending.done():
                                    candidates = [
                                        f for f in self._pending_interactions.values()
                                        if not f.done()
                                    ]
                                    pending = candidates[0] if candidates else None
                                if pending is not None and not pending.done():
                                    try:
                                        pending.set_result(answer_text)
                                        logger.info(f"[Interaction] Delivered answer to awaiting tool (tool_call_id={tool_call_id[:20]}): '{answer_text[:50]}'")
                                    except (asyncio.InvalidStateError, RuntimeError) as e:
                                        # 超时取消竞态：工具已放弃等待，忽略迟到回答
                                        logger.warning(f"[Interaction] Answer delivery skipped: {e}")

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

    # ---- C7：接管/连接状态管理公开方法 ----
    # websocket_handler 重连接管时经公开方法同步执行状态，不再直接写私有字段
    #（_agent_memories / _current_execution_task / _current_collector /
    #  _last_user_message_id / _taken_over_event / _status / _websocket_open /
    #  _pending_stream_tasks / _ws_message_queue）

    def set_agent_memories(self, memories) -> None:
        """设置 agent 记忆（接管时同步，替代直接写 _agent_memories）。"""
        self._agent_memories = memories

    def get_agent_memories(self) -> Dict:
        """公开获取 agent 记忆。"""
        return self._agent_memories

    def get_last_user_message_id(self) -> Optional[str]:
        """公开获取最后一条用户消息 id。"""
        return self._last_user_message_id

    def take_over_execution(self, *, task, collector, last_user_message_id,
                            taken_over_event, status: str = "running",
                            websocket_open: bool = True) -> None:
        """接管已有执行：统一同步执行任务/收集器/最后用户消息 id/接管信号/状态/连接状态。

        替代 websocket_handler 重连接管时对 _current_execution_task、
        _current_collector、_last_user_message_id、_taken_over_event、
        _status、_websocket_open 的逐字段私有写。
        """
        self._current_execution_task = task
        self._current_collector = collector
        self._last_user_message_id = last_user_message_id
        self._taken_over_event = taken_over_event
        self._status = status
        self._websocket_open = websocket_open

    def set_taken_over_event(self, taken_over_event) -> None:
        """设置接管信号事件（接管后替换为新的接管事件，替代直接写 _taken_over_event）。"""
        self._taken_over_event = taken_over_event

    def add_pending_stream_task(self, task) -> None:
        """登记待收尾的流式发送任务（替代直接操作 _pending_stream_tasks）。"""
        self._pending_stream_tasks.append(task)

    async def put_ws_message(self, data) -> None:
        """向 WebSocket 传输队列写入消息（替代直接操作 _ws_message_queue）。"""
        await self._ws_message_queue.put(data)
    
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

            # 统一 agent_start：所有 agent（mainagent + subagent）统一事件，subagent 保存 task 消息
            # message_id：执行实例标识（session_message_id），随事件透传前端/保存链路
            #（保存消息 id = message_id，即预生成消息 id）；parent_message_id：父实例 message_id
            #（前端层级关联 + task 消息 parent_message_id 定位依据）。
            if event_type == "agent_start":
                agent_id = getattr(event, "agent_id", None)
                metadata = getattr(event, "metadata", {}) or {}
                message_id = metadata.get("message_id")
                parent_agent_id = metadata.get("parent_agent_id")
                parent_message_id = metadata.get("parent_message_id")
                # tc.id 方案：产生本执行的 tool_call id（task 工具调用时由框架传入），
                # 持久化到 task 消息，回显按 tc.id 精确对号（流式/回显统一，无 message_id 通道）
                source_tool_call_id = metadata.get("source_tool_call_id")
                # subagent（有 parent_agent_id）：保存 task 消息作为 subagent 消息的 parent_message_id
                if parent_agent_id and agent_id and message_id:
                    task_content = metadata.get("task_content") or getattr(event, "content", None)
                    if task_content:
                        save_task = asyncio.create_task(
                            self._save_subagent_task_message(
                                agent_id, task_content, parent_agent_id,
                                parent_message_id=parent_message_id,
                                message_id=message_id,
                                source_tool_call_id=source_tool_call_id,
                            )
                        )
                        self._subagent_task_save_tasks[message_id] = save_task

            # 统一保存路径：agent_complete / agent_error 结构完全一致，
            # 唯一区别是 event.status 和 event.error 的取值（由 react_core 赋值）
            if event_type in ("agent_complete", "agent_error"):
                agent_id = getattr(event, "agent_id", None)
                metadata = getattr(event, "metadata", {}) or {}
                parent_agent_id = metadata.get("parent_agent_id")
                message_id = metadata.get("message_id")
                # 压缩轮 compacted 摘要独立 DB 记录 id（compiled_flow 压缩轮 ④ 生成并携带）：
                # stop 记录已占用执行实例 message_id，摘要须独立 id 落库；collector 取数仍按
                # message_id，二者解耦。普通轮/stop 保存无此字段（None）→ 用 message_id。
                record_message_id = metadata.get("record_message_id")
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
                        self._save_agent_messages(agent_id, status=save_status, error=save_error, parent_agent_id=parent_agent_id, save_done_event=save_done_event, message_id=message_id, record_message_id=record_message_id)
                    )
                    self._pending_save_tasks.append(task)

            # 通过传输层回调发送事件
            # save_done_event 是 Python asyncio.Event 对象，无法 JSON 序列化，发送前端前必须移除
            if event_type in ("agent_complete", "agent_error"):
                getattr(event, "metadata", {}).pop("save_done_event", None)
            # A1：compression_marked 事件 → run 层唯一执行 DB 批量标记（compiler 只读配置、
            # 不直接写对话记忆 DB）。save_done_event 供 compiler 层等待标记完成；事件本身
            # 无前端语义（前端不渲染压缩标记），标记完成后不转发 WS。
            if event_type == "compression_marked":
                agent_id = getattr(event, "agent_id", None)
                metadata = getattr(event, "metadata", {}) or {}
                save_done_event = metadata.get("save_done_event")
                task = asyncio.create_task(
                    self._batch_mark_compressed(agent_id, save_done_event=save_done_event)
                )
                self._pending_save_tasks.append(task)
                return
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
                                          parent_message_id: str = None, message_id: str = None,
                                          source_tool_call_id: str = None):
        """保存 subagent 的 task 消息作为 user 消息，作为 subagent assistant 消息的 parent_message_id。

        方案 SAVE-02：subagent 的 parent_message_id 应为 task 消息 id（非 user 消息 id）。
        task 消息以 role='user', agent_id=subagent_id 保存，与原始 user 消息区分。
        #17 改3：parent_message_id 优先使用预生成的 mainagent message_id（消除断链 1）。
        message_id（〇·3）：保存后 _subagent_task_message_ids[message_id] 暂存
        task 消息 id（并发实例各存各的，回显按 parent_message_id 各自嵌套正确）。
        source_tool_call_id（tc.id 方案）：产生本执行的 tool_call id，随 data 持久化，
        回显构建据此把子组精确嵌套到对应 tc 下（流式/回显统一对号，无 message_id 通道）。
        """
        try:
            from app.core.database import get_db_context
            # parent_message_id 已由 agent_start 事件 metadata.parent_message_id 直接携带
            #（父实例 message_id），无需经字典查询
            if not parent_message_id:
                parent_message_id = self._last_user_message_id
            with get_db_context() as db:
                task_data = [{"type": "content", "content": task_content}]
                if source_tool_call_id:
                    task_data[0]["source_tool_call_id"] = source_tool_call_id
                message = await save_session_message(
                    db=db, session_id=self.session_id, user_id=self.user_id,
                    role="user", data=task_data,
                    status="completed", agent_id=subagent_id,
                    parent_agent_id=parent_agent_id,
                    agentic_flow_id=self.agentic_flow_id,
                    run_project_id=self.run_project_id,
                    parent_message_id=parent_message_id,
                )
                if message and message_id:
                    self._subagent_task_message_ids[message_id] = str(message.id)
                    logger.info(f"[RunContext] Saved subagent task message: subagent_id={subagent_id}, message_id={message_id}, message_id={message.id}")
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

    async def _batch_mark_compressed(self, agent_id: str = None, save_done_event=None):
        """批量标记被压缩 agent 的旧消息为 is_compressed=True（A1：run 层唯一对话记忆写权）。

        compiler 层经 compression_marked 事件触发本方法（compiled_flow 不直接写 DB）。
        标记语义与 run.py load_and_distribute_memories 的 is_compressed=False 查询配套：
        旧消息被摘要覆盖后标记为已压缩，不再进入 LLM 上下文；摘要与压缩后新增消息
        保持 is_compressed=0。
        """
        from sqlalchemy import func, or_, and_
        from app.core.database import get_db_context, SessionMessageModel
        try:
            with get_db_context() as db:
                # 1) 先查该 agent 的 user 消息最大 message_index（最后一条 user = resume 锚点）
                last_user_idx = db.query(
                    func.max(SessionMessageModel.message_index)
                ).filter(
                    SessionMessageModel.session_id == self.session_id,
                    SessionMessageModel.agent_id == agent_id,
                    SessionMessageModel.role == "user",
                ).scalar()
                # 2) 统一 UPDATE：assistant 全部 + user 除最后一条（无 user 消息时 last_user_idx
                #    为 None，user 条件 message_index < -1 恒 false → 只标 assistant，天然正确）
                query = db.query(SessionMessageModel).filter(
                    SessionMessageModel.session_id == self.session_id,
                    SessionMessageModel.is_compressed == False,
                    SessionMessageModel.status != "compacted",
                    SessionMessageModel.agent_id == agent_id,
                    or_(
                        SessionMessageModel.role == "assistant",
                        and_(
                            SessionMessageModel.role == "user",
                            SessionMessageModel.message_index < (last_user_idx if last_user_idx is not None else -1),
                        ),
                    ),
                )
                updated = query.update({"is_compressed": True}, synchronize_session=False)
                db.commit()
                logger.info(
                    f"[RunContext] Marked {updated} messages as compressed in session "
                    f"{self.session_id} for agent {agent_id} (last_user_idx={last_user_idx})"
                )
        except Exception as e:
            logger.error(f"[RunContext] Failed to batch mark compressed: {e}", exc_info=True)
        finally:
            if save_done_event:
                save_done_event.set()

    async def _save_agent_messages(self, agent_id: str, status: str = "completed", error: str = None, parent_agent_id: str = None, save_done_event=None, message_id: str = None, record_message_id: str = None):
        """保存指定执行实例的消息，并发送 message_ids_updated 事件。

        message_id（〇·3）：标识收集/保存的实例（agent_complete/agent_error 事件
        metadata 携带）；save_done_event：压缩轮次由 compiler 层传入的等待信号，
        保存完成后 set（供 _execute_agent 等待）。
        record_message_id：DB 记录 id 覆盖（压缩轮 compacted 摘要专用——stop 记录已
        占用执行实例 message_id，摘要独立 id 落库；collector 取数仍按 message_id）。
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
                task_save_task = self._subagent_task_save_tasks.get(message_id)
                if task_save_task:
                    try:
                        await task_save_task  # 等待 task 消息保存完成
                    except Exception:
                        pass
                    self._subagent_task_save_tasks.pop(message_id, None)
                task_message_id = self._subagent_task_message_ids.get(message_id)
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
                message_id=message_id,
                record_message_id=record_message_id,
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
        except Exception as e:
            logger.error(f"[RunContext] Failed to save agent messages for {agent_id}: {e}", exc_info=True)
        finally:
            # 压缩轮次的等待信号：无论保存成功/失败都 set，防止 compiler 层永久等待
            if save_done_event is not None and not save_done_event.is_set():
                save_done_event.set()
    

    def _persist_incremental_changes(self, file_changes: List[Dict]) -> None:
        """增量级 FileChangeModel 写入（M2：与 save_file_changes 净视图写路径语义不同，保留并存）。

        语义差异：
        - 本方法：工具执行实时持久化【增量】记录（每条带 tool_call_id，按 tool_call_id 去重落库），
          供前端实时展示单次工具调用的文件改动；message_id 固定为最后一轮 user 消息 id。
        - save_file_changes：执行结束时聚合 incremental → 净视图（tool_call_id IS NULL），
          同一文件同一 message_id 只保留最终状态（去重 upsert + diff 计算）。
        两条路径各自服务不同场景（实时增量展示 vs 最终净视图），不可合并。
        """
        from app.core.database import FileChangeModel
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
                      stream_callback=None,
                      context: Dict = None) -> Dict:
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
        def _stream_forward(delta: dict, agent_id=None, agent_name=None, message_id=None):
            run_ctx._stream_collector_callback(delta, agent_id=agent_id, agent_name=agent_name, message_id=message_id)

        try:
            result = await FlowRunner.run_from_json(
                json_data=canvas_data,
                input_message=input_message,
                user_id=self.user_id,
                agentic_flow_id=self.agentic_flow_id,
                session_id=self.session_id,
                run_project_id=self.run_project_id,
                context=context or {},
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
            all_history: List[Dict] = []
            for m in messages:
                history = m.token_usage_history or []
                all_history.extend(history)
                for h in history:
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
                # 统一 5 字段视图（B2：唯一聚合函数 aggregate_token_totals，
                # 与前端 TokenTotals 同构）。终态事件（execution_complete/stopped/error）
                # 透传本 dict，前端 finalizeExecution 在 agent 级数据（agentUsageMap）
                # 缺失时以此兜底 token_totals——字段名与前端 TokenTotals 一致。
                "token_totals": aggregate_token_totals(all_history),
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
                               parent_agent_id: str = None, message_id: str = None,
                               record_message_id: str = None):
        """统一保存路径：按执行实例（message_id）批量保存（〇·3 per-execution）。

        核心原则：
        - agent_id 必须传入（新架构下不再支持 agent_id=None 旧路径）
        - message_id 标识收集/保存的实例：get_agent_data(message_id) 恒一收集
          该实例的块（无分支）；循环变量 agent_id_key 即 message_id（收集键），
          写库 agent_id= 用传入的真实 agent_id（并发实例同一 agent_id 各自独立保存，
          互不混淆——修复 L1283 现状误用 agent_id_key 的问题）
        - 一个 agent 的所有 blocks 合并为一条 assistant 消息保存（压缩摘要是普通 block，不分离、不丢弃）
        - record_message_id：DB 记录 id 覆盖（压缩轮 compacted 摘要专用——stop 记录已占用
          执行实例 message_id，摘要必须独立 id 落库否则 UNIQUE 冲突摘要丢失；collector
          取数仍按 message_id，记录 id 独立，二者解耦）
        - is_compressed 批量更新由 compiler 层 _batch_mark_compressed 负责
        - 保存后从 collector 中移除该 message_id 的已保存数据
        - parent_agent_id 用于 subagent 保存时构建父子关系（mainagent 保存时为 None）
        """
        saved_message_ids = {}
        from app.core.database import get_db_context
        try:
            # 〇·3 per-execution：get_agent_data(message_id) 恒一收集该实例的块
            agent_data = collector.get_agent_data(message_id=message_id) if collector else None

            if not agent_data and agent_id:
                # collector 为空 / 无该 key 数据：创建空 agent_data，统一路径保存空状态记录
                agent_data = {message_id or agent_id: {'agent_name': None, 'data': []}}

            if not agent_data:
                logger.warning(f"[save_assistant_message] agent_id is required")
                return saved_message_ids

            with get_db_context() as db:
                first_agent_id = None
                for agent_id_key, agent_info in agent_data.items():
                    # agent_id_key 即 message_id（收集键）；写库必须用真实 agent_id
                    real_agent_id = agent_id or agent_id_key
                    blocks = agent_info.get('data', []) or []
                    llm_config_id = self.get_agent_llm_config_id(real_agent_id)
                    # 方案 B（独立快照）：take 取走该消息对应的 usage 并清空——
                    # stop/compacted/resume/正常轮各自独立记账，无特殊分支（2026-08-04）
                    agent_tokens = self._get_agent_token_usage(message_id) if message_id else None
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
                    logger.info(f"[save_assistant_message] agent_id={real_agent_id}, message_id={agent_id_key}, blocks_count={len(blocks)}, valid_blocks_count={valid_blocks_count}, status={status}")

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

                    # 统一保存该 agent 的所有 blocks（压缩摘要是普通 block，无需特殊处理）
                    # 消息记录 id = message_id（预生成 session_message_id，agent_start 时确定，
                    # 与前端流式/回显实例标识一致）。压缩轮 compacted 摘要例外：stop 记录已
                    # 占用执行实例 message_id，摘要必须独立 id 落库（record_message_id 覆盖），
                    # 否则 UNIQUE 冲突摘要丢失（collector 取数仍按 message_id，二者解耦）。
                    if blocks_to_save:
                        regular_parent_message_id = blocks_to_save[0].get('parent_message_id', parent_message_id)
                        block_id = record_message_id or (message_id if message_id else None)
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
                                    f"agent_id={real_agent_id}, message_id={agent_id_key}, status={status}, "
                                    f"parent_message_id={parent_message_id}"
                                )
                        except Exception as e:
                            logger.error(f"[RunContext] Failed to save empty agent message: {e}", exc_info=True)

                    if saved_ids_for_agent:
                        saved_message_ids[agent_id_key] = saved_ids_for_agent

                # 保存后从 collector 移除该 message_id 数据
                if agent_id and collector and message_id:
                    collector.remove_agent_data(message_id)

        except Exception as e:
            logger.error(f"[RunContext] Failed to save assistant message: {e}", exc_info=True)
        return saved_message_ids
    
    def _update_file_change_message_id(self, db, old_message_id, new_message_id):
        from app.core.database import FileChangeModel
        
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

    def _get_agent_token_usage(self, message_id: str) -> Optional[Dict]:
        """取走该执行实例的当前累计 usage 并清空（消息保存时消费，方案 B 独立快照）。

        每次消息保存调用一次，使下一条消息的 usage 从 0 开始累计——
        压缩轮 stop / compacted / resume 与正常轮完全同路径（2026-08-04 重构）。
        〇·3：并发实例不在 compiled_flow.agents（编译期单实例），必须按
        _execution_instances[message_id] 取用实例 take_token_usage。正常流程
        message_id 必已注册（_execute_agent 统一注册 → 执行 → 事件 → 保存，
        时序保证）；取不到 = bug，直接 raise 报错，严禁回退 agents[agent_id]。
        """
        compiled_flow = CompiledFlowFactory.get(
            self.user_id, self.agentic_flow_id,
            self.session_id, self.run_project_id
        )
        if compiled_flow:
            agent = compiled_flow.get_instance_agent(message_id)
            if agent and hasattr(agent, 'take_token_usage'):
                return agent.take_token_usage()
        raise RuntimeError(
            f"[RunContext] _get_agent_token_usage: message_id={message_id} 不在 "
            f"_execution_instances 注册表（_execute_agent 统一注册时序被破坏 = bug，严禁回退）"
        )
    
    def clear_cache(self):
        CompiledFlowFactory.remove(
            self.user_id, self.agentic_flow_id,
            self.session_id, self.run_project_id
        )
    
    def ensure_session(self):
        from app.core.database import get_db_context, db_manager
        if self.session_id:
            with get_db_context() as db:
                session = db_manager.get_session(db, self.session_id)
                
                if not session:
                    session = db_manager.create_session(
                        db, self.session_id, self.user_id,
                        self.agentic_flow_id, self.run_project_id,
                        status="running",
                    )
        
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
        """净视图级 FileChangeModel 写入（M2：与 _persist_incremental_changes 增量写路径语义不同，保留并存）。

        语义差异：
        - 本方法：执行结束时把 _pending_file_changes 聚合（aggregate_incremental_to_net_view）为
          【净视图】记录（tool_call_id IS NULL），同一 (session_id, file_path, message_id) 去重 upsert，
          并计算 diff（lines_added/removed）；供前端展示文件最终改动面板。
        - _persist_incremental_changes：工具执行实时写入【增量】记录（带 tool_call_id），
          供前端实时展示单次工具调用的改动。
        两条路径各自服务不同场景（实时增量展示 vs 最终净视图），不可合并。
        """
        from app.services.file_change import file_change_manager
        from app.core.database import FileChangeModel
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
