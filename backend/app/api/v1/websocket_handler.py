import asyncio
import json
import logging
from datetime import datetime
from typing import Dict, Optional
from zoneinfo import ZoneInfo

from fastapi import WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.execution_context import execution_context_manager, ExecutionContext
from SoloAgent.exception.exceptions import SoloEngineException

logger = logging.getLogger(__name__)


class WebSocketRunContext:

    def __init__(self, websocket: WebSocket, agentic_flow_id: str, session_id: str,
                 run_project_id: str, user_id: str,
                 active_websockets: Dict, websocket_keys: Dict, websocket_timestamps: Dict,
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
        self._ChunkCollector = chunk_collector_class
        self._run_context = run_context

        self.ws_key = self._make_websocket_key(user_id, agentic_flow_id, session_id, run_project_id)

        self.websocket_open = True
        self.current_execution_task: Optional[asyncio.Task] = None
        self.current_collector = None
        self.status = "completed"
        self.last_user_message_id = None
        self.stored_canvas_data: Dict = {}
        self.agent_memories = {}
        self.consecutive_errors = 0
        self.MAX_CONSECUTIVE_ERRORS = settings.MAX_CONSECUTIVE_ERRORS

        self.message_queue = asyncio.Queue()

        self._current_round_index = 0

        self.receiver_task = None
        self._current_taken_over_event = None
        self.current_cancel_event: Optional[asyncio.Event] = None
        

    async def initialize(self):
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
            self.agent_memories = existing_ctx.run_context._agent_memories
            existing_ctx.run_context.set_websocket(self.websocket)

            self.current_execution_task = existing_ctx.task
            self.current_collector = existing_ctx.collector
            self.last_user_message_id = existing_ctx.run_context._last_user_message_id
            self._current_taken_over_event = existing_ctx.taken_over_event
            self.status = "running"
            self.websocket_open = True

            existing_ctx.status = "running"

            await self._send_unsent_chunks(existing_ctx)

            existing_ctx.websocket_ref = self.websocket

            if existing_ctx.taken_over_event:
                existing_ctx.taken_over_event.set()

            new_taken_over_event = asyncio.Event()
            existing_ctx.taken_over_event = new_taken_over_event
            self._current_taken_over_event = new_taken_over_event

            logger.info(f"[WebSocket] Took over execution: {self.session_id}")
        else:
            await self._run_context.load_memories()
            self.agent_memories = self._run_context._agent_memories
            self._run_context.set_websocket(self.websocket)

    def event_callback(self, event):
        try:
            ws = self._run_context._websocket if self._run_context else self.websocket
            try:
                loop = asyncio.get_running_loop()
                if loop.is_running():
                    asyncio.create_task(self._send_event(ws, self.session_id, event))
            except RuntimeError:
                pass
        except Exception as e:
            logger.error(f"Event callback error: {e}")

    async def _send_execution_event(self, event_type: str, **kwargs):
        data = {
            "event_type": event_type,
            "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
        }
        if event_type == "execution_stopped":
            data["status"] = "stopped"
            data["tokens"] = kwargs.get("tokens")
        elif event_type == "execution_error":
            data["status"] = "error"
            data["error"] = kwargs.get("error", "")
            data["tokens"] = kwargs.get("tokens")
        elif event_type == "execution_complete":
            data["message"] = kwargs.get("message")
            data["tokens"] = kwargs.get("tokens")
            data["user_message_id"] = kwargs.get("user_message_id")

        event = {
            "type": "execution_event",
            "data": data,
            "session_id": self.session_id,
            "timestamp": self._get_timestamp(),
        }
        if event_type == "execution_complete":
            event["user_message_id"] = str(kwargs.get("user_message_id")) if kwargs.get("user_message_id") else None

        try:
            await self.websocket.send_json(event)
        except Exception:
            pass

    async def _handle_loop_error(self, error, is_fatal=False):
        self.consecutive_errors += 1
        logger.error(f"[WebSocket] Error ({self.consecutive_errors}/{self.MAX_CONSECUTIVE_ERRORS}): {error}", exc_info=True)
        try:
            await self.websocket.send_json({
                "type": "error",
                "message": f"Internal error: {str(error)}",
                "timestamp": self._get_timestamp()
            })
        except Exception:
            pass

        if is_fatal or self.consecutive_errors >= self.MAX_CONSECUTIVE_ERRORS:
            logger.error(f"[WebSocket] Fatal error or too many consecutive errors, closing connection")
            self.websocket_open = False
        else:
            logger.info(f"[WebSocket] Non-fatal error, continuing...")
            await asyncio.sleep(settings.WEBSOCKET_ERROR_BACKOFF_BASE * min(self.consecutive_errors, settings.WEBSOCKET_ERROR_BACKOFF_MAX_CONSECUTIVE))

    async def message_receiver(self) -> None:
        consecutive_errors = 0

        while self.websocket_open:
            try:
                data = await self.websocket.receive_json()
                self._websocket_timestamps[self.ws_key] = self._get_timestamp()
                await self.message_queue.put(data)
                consecutive_errors = 0

            except WebSocketDisconnect:
                logger.info(f"[WebSocket] Client disconnected (receiver)")
                await self.message_queue.put({"type": "__disconnect__"})
                break

            except json.JSONDecodeError as e:
                consecutive_errors += 1
                logger.warning(f"[WebSocket] JSON decode error ({consecutive_errors}/{self.MAX_CONSECUTIVE_ERRORS}): {e}")
                if consecutive_errors >= self.MAX_CONSECUTIVE_ERRORS:
                    logger.error(f"[WebSocket] Too many consecutive JSON errors, closing connection")
                    await self.message_queue.put({"type": "__disconnect__"})
                    break

            except Exception as e:
                consecutive_errors += 1
                logger.error(f"[WebSocket] Receiver error ({consecutive_errors}/{self.MAX_CONSECUTIVE_ERRORS}): {e}")
                if consecutive_errors >= self.MAX_CONSECUTIVE_ERRORS:
                    logger.error(f"[WebSocket] Too many consecutive errors, closing connection")
                    await self.message_queue.put({"type": "__disconnect__"})
                    break
                await asyncio.sleep(settings.WEBSOCKET_ERROR_BACKOFF_BASE * min(consecutive_errors, settings.WEBSOCKET_ERROR_BACKOFF_MAX_CONSECUTIVE))

    async def handle_execution_completion(self) -> None:
        execution_context_manager.unregister(
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id
        )

        if hasattr(self, '_pending_stream_tasks') and self._pending_stream_tasks:
            await asyncio.gather(*self._pending_stream_tasks, return_exceptions=True)
            self._pending_stream_tasks.clear()

        result = None
        error_msg = None

        try:
            if self.current_execution_task.cancelled():
                self.status = "stop"
                logger.info(f"[WebSocket] Execution stopped for session: {self.session_id}")
            else:
                result = self.current_execution_task.result()
                result_status = result.get("status") if isinstance(result, dict) else None

                if result_status == "failed":
                    self.status = "error"
                    error_msg = result.get("error", "执行失败")
                    logger.error(f"[WebSocket] Execution returned failed status: {error_msg}")
                else:
                    self.status = "completed"
        except asyncio.CancelledError:
            self.status = "stop"
            logger.info(f"[WebSocket] Execution stopped (CancelledError) for session: {self.session_id}")
        except Exception as exec_error:
            self.status = "error"
            error_msg = str(exec_error)
            logger.error(f"Execution error: {exec_error}", exc_info=True)

        tokens = result.get("token_usage") if isinstance(result, dict) else None
        if not tokens and self._run_context._compiled_flow:
            tokens = getattr(self._run_context._compiled_flow, '_token_usage', None)

        if self.status == "stop":
            await self._send_execution_event("execution_stopped", tokens=tokens)
        elif self.status == "error":
            try:
                await self._send_execution_event("execution_error", error=error_msg, tokens=tokens)
            except Exception as send_error:
                logger.error(f"Failed to send execution_error to client: {send_error}")
        else:
            openai_message = result.get("message", {"role": "assistant", "content": result.get("output", ""), "reasoning_content": None}) if result else None
            await self._send_execution_event("execution_complete", message=openai_message, tokens=tokens, user_message_id=self.last_user_message_id)

        logger.info(f"[WebSocket] Task completed - status: {self.status}, collector has data: {self.current_collector.get_chunk_count() > 0 if self.current_collector else False}, tokens: {tokens}")

        has_collector_data = self.current_collector.get_chunk_count() > 0 if self.current_collector else False
        if not has_collector_data and self.status != "error" and self.status != "stop":
            self.status = "error"
            error_msg = error_msg or "LLM未返回有效内容"

        msg_status = "error" if self.status == "error" else "completed"
        msg_error = error_msg if self.status == "error" else None

        saved_message_ids = {}

        if self.current_collector:
            saved_message_ids = await self._run_context.save_assistant_message(
                collector=self.current_collector,
                tokens=tokens,
                parent_message_id=self.last_user_message_id,
                execution_result=self._run_context._last_execute_result,
                update_file_change_message_id=True,
                status=msg_status,
                error=msg_error,
            )
            if saved_message_ids:
                try:
                    await self.websocket.send_json({
                        "type": "message_ids_updated",
                        "session_id": self.session_id,
                        "message_ids": saved_message_ids,
                        "timestamp": self._get_timestamp()
                    })
                    logger.info(f"[WebSocket] Sent message_ids_updated: {saved_message_ids}")
                except Exception as send_err:
                    logger.error(f"[WebSocket] Failed to send message_ids_updated: {send_err}")
        else:
            try:
                await self._run_context.save_assistant_message(
                    collector=None,
                    tokens=tokens,
                    parent_message_id=self.last_user_message_id,
                    execution_result=self._run_context._last_execute_result,
                    update_file_change_message_id=True,
                    status=msg_status,
                    error=msg_error,
                )
            except Exception as save_error:
                logger.error(f"[WebSocket] Failed to save empty message: {save_error}")

        if self.status == "stop":
            self._run_context._finalize_execution(status_override="stop", tokens=tokens)
        elif self.status == "error":
            self._run_context._finalize_execution(status_override="error", error_msg=error_msg, tokens=tokens)
        else:
            self._run_context._finalize_execution(status_override="completed", tokens=tokens)

        self.current_execution_task = None
        self.current_collector = None

        file_change_message_id = None
        if saved_message_ids:
            first_key = next(iter(saved_message_ids), None)
            if first_key:
                file_change_message_id = saved_message_ids[first_key]
        await self._run_context.save_file_changes(message_id=file_change_message_id)
        try:
            await self._send_event(self.websocket, self.session_id, {
                "event_type": "file_changes_ready",
                "message_id": file_change_message_id,
            })
        except Exception as e:
            logger.error(f"Failed to send file_changes_ready event: {e}")

    async def handle_ping(self) -> None:
        try:
            await self.websocket.send_json({"type": "pong", "timestamp": self._get_timestamp()})
        except Exception:
            self.websocket_open = False

    async def handle_stop(self) -> None:
        if self.current_execution_task and not self.current_execution_task.done():
            logger.info(f"[WebSocket] Stop requested for session: {self.session_id}")

            # 通过 CompiledFlow.cancel() 关闭 HTTP 连接
            try:
                ec = execution_context_manager.get(
                    self.agentic_flow_id, self.session_id, self.run_project_id
                )
                if ec and ec.run_context and hasattr(ec.run_context, '_compiled_flow'):
                    compiled_flow = ec.run_context._compiled_flow
                    if compiled_flow:
                        await compiled_flow.cancel()
                        logger.info(f"[WebSocket] CompiledFlow.cancel() completed")
            except Exception as e:
                logger.warning(f"[WebSocket] CompiledFlow.cancel() failed: {e}")

            # 兜底：设置 cancel_event + task.cancel()
            if self.current_cancel_event:
                self.current_cancel_event.set()

            self.current_execution_task.cancel()

            try:
                await self.current_execution_task
            except (asyncio.CancelledError, Exception):
                pass
            logger.info(f"[WebSocket] Execution task completed after stop")
        else:
            try:
                await self.websocket.send_json({
                    "type": "execution_stopped",
                    "session_id": self.session_id,
                    "timestamp": self._get_timestamp(),
                    "message": "No running task to stop"
                })
            except Exception:
                self.websocket_open = False

    async def handle_execute(self, data: dict) -> None:
        self._run_context._last_execute_result = None

        canvas_data = data.get("canvas_data", {}) or self.stored_canvas_data
        input_message = data.get("input_message", "")

        self.stored_canvas_data = canvas_data

        self._run_context.ensure_session()

        message_id = await self._run_context.save_user_message(input_message)
        self.last_user_message_id = message_id
        self._run_context._last_user_message_id = message_id

        self.status = "completed"
        self.current_collector = self._ChunkCollector()
        self._pending_stream_tasks = []

        self._current_round_index += 1

        await self._send_event(self.websocket, self.session_id, {
            "event_type": "execution_start",
            "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
        })

        ctx = self

        def stream_callback_with_collector(delta: dict, agent_id: str = None, agent_name: str = None):
            try:
                # DEBUG: verify callback is called and collector exists
                logger.info(f"[WebSocket] stream_callback called: collector={ctx.current_collector is not None}, delta_keys={list(delta.keys())}, agent_id={agent_id}")
                ctx.current_collector.add_chunk(delta, agent_id, agent_name)
                exec_ctx = execution_context_manager.get(
                    user_id=ctx.user_id,
                    agentic_flow_id=ctx.agentic_flow_id,
                    session_id=ctx.session_id,
                    run_project_id=ctx.run_project_id
                )
                if exec_ctx and exec_ctx.websocket_ref is not None:
                    ws = exec_ctx.websocket_ref
                    try:
                        loop = asyncio.get_running_loop()
                        if loop.is_running():
                            async def safe_send():
                                try:
                                    await ws.send_json({
                                        "type": "stream",
                                        "delta": delta,
                                        "agent_id": agent_id,
                                        "agent_name": agent_name,
                                        "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat()
                                    })
                                except Exception:
                                    pass
                            task = asyncio.create_task(safe_send())
                            ctx._pending_stream_tasks.append(task)
                    except RuntimeError:
                        pass
            except Exception as e:
                logger.error(f"Stream callback error: {e}")

        self.current_cancel_event = asyncio.Event()

        taken_over_event = asyncio.Event()
        self._current_taken_over_event = taken_over_event

        async def run_execution():
            working_dir = await self._run_context.get_working_dir()

            result = await self._run_context.execute(
                input_message=input_message,
                canvas_data=canvas_data,
                cancel_event=ctx.current_cancel_event,
                event_callback=ctx.event_callback,
                stream_callback=stream_callback_with_collector,
            )

            return result

        self.current_execution_task = asyncio.create_task(run_execution())

        execution_context_manager.register(
            task=self.current_execution_task,
            user_id=self.user_id,
            agentic_flow_id=self.agentic_flow_id,
            session_id=self.session_id,
            run_project_id=self.run_project_id,
            cancel_event=self.current_cancel_event,
            collector=self.current_collector,
            run_context=self._run_context,
            websocket_ref=self.websocket,
            taken_over_event=taken_over_event,
        )

    async def _send_unsent_chunks(self, exec_ctx: ExecutionContext) -> None:
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

    async def run(self) -> None:
        self.receiver_task = asyncio.create_task(self.message_receiver())

        try:
            while self.websocket_open:
                try:
                    wait_coroutines = []

                    message_wait_task = asyncio.create_task(self.message_queue.get())
                    wait_coroutines.append(message_wait_task)

                    execution_wait_task = None
                    if self.current_execution_task:
                        execution_wait_task = asyncio.ensure_future(self.current_execution_task)
                        wait_coroutines.append(execution_wait_task)

                    taken_over_wait_task = None
                    if self._current_taken_over_event is not None:
                        taken_over_wait_task = asyncio.ensure_future(self._current_taken_over_event.wait())
                        wait_coroutines.append(taken_over_wait_task)

                    done, pending = await asyncio.wait(
                        wait_coroutines,
                        return_when=asyncio.FIRST_COMPLETED
                    )

                    if taken_over_wait_task and taken_over_wait_task in done:
                        logger.info(f"[WebSocket] Taken over by new connection")
                        for p in pending:
                            p.cancel()
                            try:
                                await p
                            except (asyncio.CancelledError, Exception):
                                pass
                        break

                    if execution_wait_task and execution_wait_task in done:
                        logger.info(f"[WebSocket] Execution task completed, processing results")

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

                        await self.handle_execution_completion()

                        continue

                    if message_wait_task in done:
                        result = None
                        try:
                            result = message_wait_task.result()
                        except Exception as e:
                            logger.error(f"[WebSocket] Error getting message result: {e}")
                            continue

                        if isinstance(result, dict) and result.get("type") == "__disconnect__":
                            logger.info(f"[WebSocket] Client disconnected")
                            self.websocket_open = False
                            break

                        if isinstance(result, dict) and "type" in result:
                            self.consecutive_errors = 0
                            data = result

                            if data.get("type") == "ping":
                                await self.handle_ping()

                            elif data.get("type") == "stop":
                                await self.handle_stop()

                            elif data.get("type") == "execute":
                                if not self.current_execution_task or self.current_execution_task.done():
                                    await self.handle_execute(data)

                except asyncio.CancelledError:
                    logger.info(f"[WebSocket] Main loop cancelled")
                    break
                except SoloEngineException as e:
                    await self._handle_loop_error(e, is_fatal=e.is_fatal)
                    if not self.websocket_open:
                        break
                    continue
                except Exception as e:
                    await self._handle_loop_error(e)
                    if not self.websocket_open:
                        break
                    continue

        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected: {self.ws_key}")
            self.websocket_open = False
        except Exception as e:
            logger.error(f"WebSocket outer error: {e}", exc_info=True)
            self.websocket_open = False
        finally:
            await self.cleanup()

    async def cleanup(self) -> None:
        self.websocket_open = False

        if self.receiver_task and not self.receiver_task.done():
            self.receiver_task.cancel()
            try:
                await self.receiver_task
            except (asyncio.CancelledError, Exception):
                pass

        if self._current_taken_over_event is not None and self._current_taken_over_event.is_set():
            logger.info(f"[WebSocket] Handler taken over, skipping grace period: {self.session_id}")
            return

        if self.current_execution_task and not self.current_execution_task.done():
            exec_ctx = execution_context_manager.get(
                user_id=self.user_id,
                agentic_flow_id=self.agentic_flow_id,
                session_id=self.session_id,
                run_project_id=self.run_project_id
            )

            if exec_ctx:
                exec_ctx.websocket_ref = None
                exec_ctx.status = "grace_period"
                exec_ctx.chunks_sent_count = self.current_collector.get_chunk_count() if self.current_collector else 0

            grace_period = settings.WEBSOCKET_GRACE_PERIOD_SECONDS
            logger.info(f"[WebSocket] Entering grace period ({grace_period}s): {self.session_id}")

            try:
                saved_taken_over_event = exec_ctx.taken_over_event if exec_ctx else None

                wait_coroutines = [self.current_execution_task]
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
                    logger.info(f"[WebSocket] Execution taken over by new connection: {self.session_id}")
                    return

                if self.current_execution_task in done:
                    logger.info(f"[WebSocket] Task completed during grace period: {self.session_id}")
                    await self.handle_execution_completion()
                else:
                    logger.warning(f"[WebSocket] Grace period expired, stopping execution: {self.session_id}")
                    await self.handle_stop()
                    await self.handle_execution_completion()

            except Exception as e:
                logger.error(f"[WebSocket] Cleanup error: {e}", exc_info=True)
                try:
                    if self.current_cancel_event:
                        self.current_cancel_event.set()
                    if self.current_execution_task and not self.current_execution_task.done():
                        self.current_execution_task.cancel()
                except Exception:
                    pass

        self._active_websockets.pop(self.ws_key, None)
        self._websocket_timestamps.pop(self.ws_key, None)
        self._websocket_keys.pop(self.ws_key, None)

        self._run_context.clear_cache()
