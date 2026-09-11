import asyncio
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.execution_context import execution_context_manager, ExecutionContext

logger = logging.getLogger("SoloEngine")


class WebSocketRunContext:

    def __init__(self, websocket: WebSocket, agentic_flow_id: str, session_id: str,
                 run_project_id: str, user_id: str,
                 active_websockets, websocket_keys, websocket_timestamps,
                 send_event_func, timestamp_func, make_key_func,
                 chunk_collector_class,
                 run_context):
        self.websocket = websocket
        self.agentic_flow_id = agentic_flow_id
        self.session_id = session_id
        self.run_project_id = run_project_id
        self.user_id = user_id

        self._active_websockets = active_websockets
        self._websocket_keys = websocket_keys
        self._websocket_timestamps = websocket_timestamps
        self._send_event = send_event_func
        self._get_timestamp = timestamp_func
        self._make_websocket_key = make_key_func
        self._run_context = run_context

        self.ws_key = self._make_websocket_key(user_id, agentic_flow_id, session_id, run_project_id)
        self.websocket_open = True

    def _make_stream_send_callback(self):
        """创建流式发送回调，每次调用时动态获取最新 websocket"""
        ctx = self
        def stream_send_callback(delta, agent_id=None, agent_name=None, message_id=None):
            try:
                exec_ctx = execution_context_manager.get(
                    user_id=ctx.user_id,
                    agentic_flow_id=ctx.agentic_flow_id,
                    session_id=ctx.session_id,
                    run_project_id=ctx.run_project_id
                )
                if exec_ctx and exec_ctx.websocket_ref is not None:
                    ws = exec_ctx.websocket_ref
                    loop = asyncio.get_running_loop()
                    if loop.is_running():
                        async def safe_send():
                            try:
                                await ws.send_json({
                                    "type": "stream",
                                    "delta": delta,
                                    "agent_id": agent_id,
                                    "agent_name": agent_name,
                                    "message_id": message_id,
                                    "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
                                })
                            except Exception:
                                pass
                        task = asyncio.create_task(safe_send())
                        # C7：经公开方法登记待收尾任务（不直接操作 _pending_stream_tasks）
                        ctx._run_context.add_pending_stream_task(task)
            except Exception as e:
                logger.error(f"Stream callback error: {e}")
        return stream_send_callback

    async def _send_event_to_client(self, event):
        """发送事件到 WebSocket 客户端（v0.2.1 格式）。供 run_context 通过回调调用。"""
        try:
            # ★ 统一将 ExecutionEvent 对象转换为 dict，避免 JSON 序列化失败
            if not isinstance(event, dict) and hasattr(event, "to_dict"):
                event = event.to_dict()
            await self.websocket.send_json({
                "type": "execution_event",
                "data": event,
                "session_id": self.session_id,
                "timestamp": self._get_timestamp(),
            })
        except Exception as e:
            logger.error(f"[WebSocket] Failed to send event: {e}")

    async def _send_raw_to_client(self, data):
        """直接发送原始数据到 WebSocket（不包装）。用于 pong 等直接响应。"""
        try:
            await self.websocket.send_json(data)
        except Exception as e:
            logger.error(f"[WebSocket] Failed to send raw: {e}")

    async def message_receiver(self):
        """从 WebSocket 接收消息放入 run_context 的 WebSocket 传输队列。"""
        consecutive_errors = 0
        while self.websocket_open:
            try:
                data = await self.websocket.receive_json()
                self._websocket_timestamps[self.ws_key] = self._get_timestamp()
                # C7：经公开方法写入 WebSocket 传输队列（不直接操作 _ws_message_queue）
                await self._run_context.put_ws_message(data)
                consecutive_errors = 0
            except WebSocketDisconnect:
                await self._run_context.put_ws_message({"type": "__disconnect__"})
                break
            except json.JSONDecodeError as e:
                consecutive_errors += 1
                logger.warning(f"[WebSocket] JSON decode error ({consecutive_errors}/{settings.MAX_CONSECUTIVE_ERRORS}): {e}")
                if consecutive_errors >= settings.MAX_CONSECUTIVE_ERRORS:
                    await self._run_context.put_ws_message({"type": "__disconnect__"})
                    break
            except Exception as e:
                consecutive_errors += 1
                logger.error(f"[WebSocket] Receiver error ({consecutive_errors}/{settings.MAX_CONSECUTIVE_ERRORS}): {e}")
                if consecutive_errors >= settings.MAX_CONSECUTIVE_ERRORS:
                    await self._run_context.put_ws_message({"type": "__disconnect__"})
                    break
                await asyncio.sleep(settings.WEBSOCKET_ERROR_BACKOFF_BASE * min(consecutive_errors, settings.WEBSOCKET_ERROR_BACKOFF_MAX_CONSECUTIVE))

    async def _send_unsent_chunks(self, exec_ctx: ExecutionContext) -> None:
        """重连后补发未发送的流式数据。"""
        if not exec_ctx.collector:
            return

        total = 0
        while True:
            unsent_chunks = exec_ctx.collector.get_chunks_since(exec_ctx.chunks_sent_count)
            if not unsent_chunks:
                break

            for chunk_data in unsent_chunks:
                try:
                    await self.websocket.send_json({
                        "type": "stream",
                        "delta": chunk_data['delta'],
                        "agent_id": chunk_data.get('agent_id'),
                        "agent_name": chunk_data.get('agent_name'),
                        "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
                    })
                    total += 1
                except Exception as e:
                    logger.error(f"[WebSocket] Send unsent chunk error: {e}")
                    break

            exec_ctx.chunks_sent_count = exec_ctx.collector.get_chunk_count()

        logger.info(f"[WebSocket] Sent {total} unsent chunks to reconnected client")

    async def initialize(self):
        """连接注册、接管已有执行、注入回调。"""
        self._active_websockets[self.ws_key] = self.websocket
        self._websocket_keys[self.ws_key] = {
            "agentic_flow_id": self.agentic_flow_id,
            "session_id": self.session_id,
            "run_project_id": self.run_project_id,
            "user_id": self.user_id,
        }
        self._websocket_timestamps[self.ws_key] = self._get_timestamp()

        existing_ctx = execution_context_manager.get(
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id
        )

        if existing_ctx and existing_ctx.status in ("running", "grace_period") and not existing_ctx.task.done():
            self._run_context = existing_ctx.run_context
            # C7：经 run_context 公开方法同步记忆 + 接管执行状态
            #（不直接写 _agent_memories / _current_execution_task / _current_collector /
            #  _last_user_message_id / _taken_over_event / _status / _websocket_open）
            self._run_context.set_agent_memories(existing_ctx.run_context.get_agent_memories())
            existing_ctx.run_context.set_websocket(self.websocket)
            self._run_context.take_over_execution(
                task=existing_ctx.task,
                collector=existing_ctx.collector,
                last_user_message_id=existing_ctx.run_context.get_last_user_message_id(),
                taken_over_event=existing_ctx.taken_over_event,
                status="running",
                websocket_open=True,
            )

            existing_ctx.status = "running"

            await self._send_unsent_chunks(existing_ctx)

            existing_ctx.websocket_ref = self.websocket

            if existing_ctx.taken_over_event:
                existing_ctx.taken_over_event.set()

            new_taken_over_event = asyncio.Event()
            existing_ctx.taken_over_event = new_taken_over_event
            # C7：经公开方法替换接管信号事件（不直接写 _taken_over_event）
            self._run_context.set_taken_over_event(new_taken_over_event)

            logger.info(f"[WebSocket] Took over execution: {self.session_id}")

            # 接管时注入回调（run_context 已切换）
            self._run_context.set_transport_callbacks(
                send_event_callback=self._send_event_to_client,
                message_receiver_func=self.message_receiver,
                send_raw_callback=self._send_raw_to_client,
            )
            self._run_context.set_stream_send_callback(self._make_stream_send_callback())
        else:
            await self._run_context.load_memories()
            # C7：经公开方法同步记忆（不直接写 _agent_memories）
            self._run_context.set_agent_memories(self._run_context.get_agent_memories())
            self._run_context.set_websocket(self.websocket)

            # 注入传输层回调
            self._run_context.set_transport_callbacks(
                send_event_callback=self._send_event_to_client,
                message_receiver_func=self.message_receiver,
                send_raw_callback=self._send_raw_to_client,
            )
            self._run_context.set_stream_send_callback(self._make_stream_send_callback())

    async def run(self) -> None:
        """入口：启动 run_context 的事件循环。"""
        await self._run_context.run_event_loop()
        # 事件循环结束后，清理连接映射（传输层状态）
        self._active_websockets.pop(self.ws_key, None)
        self._websocket_timestamps.pop(self.ws_key, None)
        self._websocket_keys.pop(self.ws_key, None)
