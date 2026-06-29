# -*- coding: utf-8 -*-
"""
ReAct核心机制-react_core.py: 实现ReAct（Reasoning + Acting）架构的核心微内核

@file react_core.py
@description 实现ReAct架构的核心微内核，提供推理-行动循环和四事件机制
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块是ReAct核心机制的实现，提供以下核心功能：
- 实现推理-行动循环的核心逻辑（Thought → Action → Observation）
- 支持多轮迭代直到任务完成，可配置最大迭代次数
- 自动检测任务完成条件，统一处理多模型API差异
- 集成记忆、RAG、工具执行等插件接口
- 实现四事件机制：ToolCallEventType工具调用事件管理
- 维护_conversation_history作为唯一记忆缓存

ReAct架构说明：
ReAct是一种将推理（Reasoning）和行动（Acting）交替进行的Agent架构。
每轮迭代包含三个阶段：
1. Thought（思考）：分析当前状态，决定下一步行动
2. Action（行动）：执行工具调用或生成回复
3. Observation（观察）：获取行动结果，更新状态

多模型任务完成检测：
不同模型使用不同的API字段表示任务完成：
- Claude: stop_reason = "end_turn" (完成) / "tool_use" (工具调用)
- OpenAI/GLM/DeepSeek: finish_reason = "stop" (完成) / "tool_calls" (工具调用)
本模块统一处理这些差异，提供一致的任务完成检测接口。

依赖:
- asyncio: 异步操作支持
- json: JSON数据处理
- re: 正则表达式
- typing: 类型提示
- ..message: 消息类型定义
- ..model: 模型基类
- ..formatter: 格式化器
- .interfaces: 核心插件接口

使用示例:
- core = ReActCore(model=model, tools=tools, memory=memory)
- async for chunk in core.reply(user_input): process(chunk)
"""

import asyncio
import json
import re
import time
import logging
from typing import Optional, List, Any, Union, Dict
from collections import Counter
from enum import Enum

from ..message import Msg
from ..model import ChatModelBase, ChatResponse, ChatUsage
from ..formatter import FormatterBase
from .interfaces import IRAG, IToolExecutor
from ..types.protocols import StreamCallback
from app.core.config import settings

logger = logging.getLogger("SoloEngine")


class CompletionReason(Enum):
    TASK_COMPLETED = "task_completed"
    MAX_ITERATIONS = "max_iterations"
    USER_SATISFIED = "user_satisfied"
    NO_MORE_ACTIONS = "no_more_actions"
    ERROR_ENCOUNTERED = "error_encountered"
    TOOL_CALL = "tool_call"


class StopReason(Enum):
    END_TURN = "end_turn"
    TOOL_USE = "tool_use"
    MAX_TOKENS = "max_tokens"
    STOP_SEQUENCE = "stop_sequence"
    UNKNOWN = "unknown"
    
    @classmethod
    def from_api_response(cls, response: ChatResponse) -> "StopReason":
        stop_reason = getattr(response, "stop_reason", None)
        finish_reason = getattr(response, "finish_reason", None)
        
        reason = stop_reason or finish_reason
        
        if reason is None:
            return cls.UNKNOWN
        
        reason_str = str(reason).lower()
        
        if reason_str in ("end_turn", "stop"):
            return cls.END_TURN
        elif reason_str in ("tool_use", "tool_calls"):
            return cls.TOOL_USE
        elif reason_str in ("max_tokens", "length"):
            return cls.MAX_TOKENS
        elif reason_str == "stop_sequence":
            return cls.STOP_SEQUENCE
        
        return cls.UNKNOWN


class ToolCallEventType(str, Enum):
    TOOL_CALL_START = "TOOL_CALL_START"
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
    TOOL_CALL_END = "TOOL_CALL_END"
    TOOL_CALL_RESULT = "TOOL_CALL_RESULT"


class ToolCallEventManager:
    
    def __init__(self, stream_callback: Optional[StreamCallback] = None, agent_id: str = None, agent_name: str = None):
        self.stream_callback = stream_callback
        self.agent_id = agent_id
        self.agent_name = agent_name
        self._active_tool_calls: Dict[str, dict] = {}
        self._ended_tool_calls: set = set()
    
    def on_tool_call_start(self, tool_call_id: str, tool_name: str):
        if tool_call_id in self._active_tool_calls:
            return
        
        self._active_tool_calls[tool_call_id] = {
            "id": tool_call_id,
            "name": tool_name,
            "arguments": "",
            "status": "start"
        }
        
        logger.info(f"[ToolCallEventManager] TOOL_CALL_START: {tool_name} ({tool_call_id})")
        self._emit_to_frontend({
            "type": ToolCallEventType.TOOL_CALL_START,
            "tool_call_id": tool_call_id,
            "tool_name": tool_name
        })
    
    def on_tool_call_args(self, tool_call_id: str, delta: str):
        if tool_call_id not in self._active_tool_calls:
            logger.warning(f"[ToolCallEventManager] Unknown tool_call_id: {tool_call_id}")
            return
        
        self._active_tool_calls[tool_call_id]["arguments"] += delta
        logger.debug(f"[ToolCallEventManager] TOOL_CALL_ARGS: {tool_call_id} delta={delta[:50]}...")
        
        self._emit_to_frontend({
            "type": ToolCallEventType.TOOL_CALL_ARGS,
            "tool_call_id": tool_call_id,
            "delta": delta
        })
    
    def on_tool_call_end(self, tool_call_id: str):
        if tool_call_id not in self._active_tool_calls:
            return
        
        self._active_tool_calls[tool_call_id]["status"] = "end"
        self._ended_tool_calls.add(tool_call_id)
        
        logger.info(f"[ToolCallEventManager] TOOL_CALL_END: {tool_call_id}")
        self._emit_to_frontend({
            "type": ToolCallEventType.TOOL_CALL_END,
            "tool_call_id": tool_call_id
        })
    
    def on_tool_call_result(self, tool_call_id: str, result: str, error: str = None):
        logger.info(f"[ToolCallEventManager] TOOL_CALL_RESULT: {tool_call_id} error={error is not None}")
        self._emit_to_frontend({
            "type": ToolCallEventType.TOOL_CALL_RESULT,
            "tool_call_id": tool_call_id,
            "result": result,
            "error": error
        })
    
    def end_all_active_tool_calls(self):
        for tool_call_id in list(self._active_tool_calls.keys()):
            if tool_call_id not in self._ended_tool_calls:
                self.on_tool_call_end(tool_call_id)
    
    def get_tool_call_arguments(self, tool_call_id: str) -> str:
        if tool_call_id in self._active_tool_calls:
            return self._active_tool_calls[tool_call_id].get("arguments", "")
        return ""
    
    def get_active_tool_calls(self) -> Dict[str, dict]:
        return self._active_tool_calls.copy()
    
    def reset(self):
        self._active_tool_calls.clear()
        self._ended_tool_calls.clear()
        logger.debug("[ToolCallEventManager] Reset")
    
    def _emit_to_frontend(self, event: dict):
        frontend_delta = self._convert_to_frontend_format(event)
        if self.stream_callback and frontend_delta:
            self.stream_callback(frontend_delta, agent_id=self.agent_id, agent_name=self.agent_name)
    
    def _convert_to_frontend_format(self, event: dict) -> dict:
        event_type = event["type"]
        tool_call_id = event["tool_call_id"]
        
        if event_type == ToolCallEventType.TOOL_CALL_START:
            return {
                "type": "tool_calls",
                "tool_calls": [{
                    "id": tool_call_id,
                    "type": "function",
                    "function": {
                        "name": event["tool_name"]
                    },
                    "status": "start"
                }]
            }
        elif event_type == ToolCallEventType.TOOL_CALL_ARGS:
            return {
                "type": "tool_calls",
                "tool_calls": [{
                    "id": tool_call_id,
                    "function": {
                        "arguments": event["delta"]
                    }
                }]
            }
        elif event_type == ToolCallEventType.TOOL_CALL_END:
            return {
                "type": "tool_calls",
                "tool_calls": [{
                    "id": tool_call_id,
                    "status": "end"
                }]
            }
        elif event_type == ToolCallEventType.TOOL_CALL_RESULT:
            import copy
            result_data = {
                "id": tool_call_id,
                "result": copy.deepcopy(event["result"])
            }
            if event.get("error"):
                result_data["error"] = event["error"]
            return {
                "type": "tool_calls",
                "tool_calls": [result_data]
            }
        
        return None



class ReActCore:
    
    def __init__(
        self,
        name: str,
        model: ChatModelBase,
        formatter: FormatterBase,
        system_prompt: str,
        rag: Optional[IRAG] = None,
        tool_executor: Optional[IToolExecutor] = None,
        max_iters: int = settings.DEFAULT_MAX_ITERS,
        print_hint_msg: bool = False,
        stream_callback: Optional[StreamCallback] = None,
        agent_id: Optional[str] = None,
    ) -> None:
        self.name = name
        self.model = model
        self.formatter = formatter
        self.system_prompt = system_prompt
        self.rag = rag
        self.tool_executor = tool_executor
        self.max_iters = max_iters
        self.print_hint_msg = print_hint_msg
        self.stream_callback = stream_callback
        self.agent_id = agent_id or name
        
        self._conversation_history: List[Msg] = []
        self._iteration_count = 0
        self._last_tool_results: List[Dict[str, Any]] = []
        self._accumulated_text: str = ""
        self._last_collected_content: list = []
        self._interrupted: bool = False
        self._on_tool_executed: Optional[Any] = None
        self._on_tool_executing: Optional[Any] = None
        self._accumulated_usage = {"input_tokens": 0, "output_tokens": 0, "duration_ms": 0}
        self._last_error: Optional[str] = None

        # tiktoken 编码器：用于流式输出时实时估算 token（API usage 仅最后一个 chunk 返回）
        self._token_encoder = None
        try:
            import tiktoken
            model_name = getattr(model, 'model_name', None) or ''
            try:
                self._token_encoder = tiktoken.encoding_for_model(model_name)
                logger.info(f"[ReActCore] tiktoken initialized: model={model_name}, encoding={self._token_encoder.name}")
            except KeyError:
                self._token_encoder = tiktoken.get_encoding("o200k_base")
                logger.info(f"[ReActCore] tiktoken fallback: model={model_name}, encoding=o200k_base")
        except ImportError:
            logger.warning(f"[ReActCore] tiktoken not installed, token estimation disabled")
        except Exception as e:
            logger.warning(f"[ReActCore] tiktoken init error: {e}")

        self._tool_call_event_manager = ToolCallEventManager(
            stream_callback=self.stream_callback,
            agent_id=self.agent_id,
            agent_name=self.name
        )

    def load_history(self, messages: List[Msg]) -> None:
        self._conversation_history = messages.copy()
    
    def _msg_has_tool_call_id(self, msg: Msg, tool_call_id: str) -> bool:
        if msg.role != "assistant":
            return False
        content_blocks = msg.get_content_blocks()
        for block in content_blocks:
            if isinstance(block, dict):
                if block.get("type") == "tool_calls":
                    for tc in block.get("tool_calls", []):
                        if tc.get("id") == tool_call_id:
                            return True
        if msg.metadata and isinstance(msg.metadata, dict):
            original = msg.metadata.get("original_model_message", {})
            if isinstance(original, dict):
                for tc in original.get("tool_calls", []):
                    if tc.get("id") == tool_call_id:
                        return True
        return False
    
    def _get_tool_call_ids_from_msg(self, msg: Msg) -> set:
        ids = set()
        content_blocks = msg.get_content_blocks()
        for block in content_blocks:
            if isinstance(block, dict):
                if block.get("type") == "tool_calls":
                    for tc in block.get("tool_calls", []):
                        ids.add(tc.get("id"))
        if msg.metadata and isinstance(msg.metadata, dict):
            original = msg.metadata.get("original_model_message", {})
            if isinstance(original, dict):
                for tc in original.get("tool_calls", []):
                    ids.add(tc.get("id"))
        return ids
    
    def _get_sliding_window(self, max_messages: int = 10) -> List[Msg]:
        if len(self._conversation_history) <= max_messages:
            return self._conversation_history.copy()
        
        window = self._conversation_history[-max_messages:]
        
        while window and window[0].role == "tool":
            first_tool_call_id = window[0].tool_call_id
            if not first_tool_call_id:
                window = window[1:]
                continue
            
            window_start_idx = len(self._conversation_history) - len(window)
            found = False
            search_idx = window_start_idx - 1
            while search_idx >= 0:
                msg = self._conversation_history[search_idx]
                if msg.role == "assistant":
                    if self._msg_has_tool_call_id(msg, first_tool_call_id):
                        expand_start = search_idx
                        for idx in range(search_idx + 1, window_start_idx):
                            if self._conversation_history[idx].role == "tool":
                                expand_start = min(expand_start, idx)
                        window = self._conversation_history[expand_start:window_start_idx] + window
                        found = True
                        break
                elif msg.role == "user":
                    break
                search_idx -= 1
            
            if not found:
                window = window[1:]
        
        if window and window[-1].role == "assistant":
            tool_call_ids = self._get_tool_call_ids_from_msg(window[-1])
            
            if tool_call_ids:
                window_tool_ids = set()
                for msg in window:
                    if msg.role == "tool" and msg.tool_call_id:
                        window_tool_ids.add(msg.tool_call_id)
                
                missing_ids = tool_call_ids - window_tool_ids
                if missing_ids:
                    window_end_idx = len(self._conversation_history)
                    actual_end = len(self._conversation_history)
                    for idx in range(window_end_idx, actual_end):
                        msg = self._conversation_history[idx]
                        if msg.role == "tool" and msg.tool_call_id in missing_ids:
                            window.append(msg)
                            missing_ids.discard(msg.tool_call_id)
                            if not missing_ids:
                                break
                        elif msg.role != "tool":
                            break
        
        return window
    
    def interrupt(self) -> None:
        self._interrupted = True
        logger.info(f"[{self.name}] Interrupt requested")
    
    def is_interrupted(self) -> bool:
        return self._interrupted
    
    def reset_interrupt(self) -> None:
        self._interrupted = False
    
    def _build_accumulated_usage(self) -> ChatUsage:
        return ChatUsage(
            input_tokens=self._accumulated_usage["input_tokens"],
            output_tokens=self._accumulated_usage["output_tokens"],
            time=self._accumulated_usage.get("duration_ms", 0) / 1000.0
        )

    def get_accumulated_usage(self) -> Optional[Dict]:
        acc = self._accumulated_usage
        if acc and (acc.get("input_tokens", 0) > 0 or acc.get("output_tokens", 0) > 0):
            result = {
                "prompt_tokens": acc.get("input_tokens", 0),
                "completion_tokens": acc.get("output_tokens", 0),
                "total_tokens": acc.get("input_tokens", 0) + acc.get("output_tokens", 0),
                "duration_ms": acc.get("duration_ms", 0),
            }
            return result
        return None

    async def reply(self, message: str | Msg, cancel_event: asyncio.Event = None) -> Msg:
        _reply_start_time = time.time()
        
        if isinstance(message, str):
            user_msg = Msg(name="user", content=message, role="user")
        else:
            user_msg = message
        
        self._conversation_history.append(user_msg)
        self._iteration_count = 0
        self._last_tool_results = []
        self._interrupted = False
        self._accumulated_usage = {"input_tokens": 0, "output_tokens": 0, "duration_ms": 0}
        
        self._tool_call_event_manager.reset()
        
        rag_context = ""
        if self.rag:
            documents = await self.rag.retrieve(user_msg.get_text_content() or "")
            if documents:
                rag_context = "\n".join([
                    f"Relevant knowledge: {doc.get('content', '')}"
                    for doc in documents
                ])
        
        full_system_prompt = self.system_prompt
        if rag_context:
            full_system_prompt += f"\n\n{rag_context}"
        
        completion_reason = None
        
        for iteration in range(self.max_iters):
            self._tool_call_event_manager.reset()
            
            if self._interrupted:
                logger.info(f"[{self.name}] Execution interrupted by user at iteration {iteration}")
                break
            
            self._iteration_count = iteration + 1
            self._last_error = None
            
            reasoning_result = await self._reasoning(
                user_msg, 
                full_system_prompt,
                iteration,
                cancel_event
            )
            
            precomputed_text = getattr(reasoning_result, 'text', None)
            precomputed_has_tool_calls = getattr(reasoning_result, 'has_tool_calls', False)
            
            completion_check = self._check_completion(
                reasoning_result, iteration,
                precomputed_text=precomputed_text,
                has_tool_calls=precomputed_has_tool_calls,
            )
            
            if completion_check.get("auto_continue"):
                has_tool_calls_in_partial = precomputed_has_tool_calls
                
                if has_tool_calls_in_partial:
                    logger.warning(f"[ReActCore] MAX_TOKENS with tool_calls in partial, treating as tool_calls instead of auto_continue")
                else:
                    partial_text = self._extract_text(reasoning_result, precomputed_text)
                    if partial_text.strip():
                        self._accumulated_text += partial_text
                        partial_msg = Msg(
                            name=self.name,
                            content=[{"type": "text", "text": partial_text}],
                            role="assistant"
                        )
                        self._conversation_history.append(partial_msg)
                        continue_msg = Msg(
                            name="user",
                            content="[继续输出，不要重复之前的内容]",
                            role="user"
                        )
                        self._conversation_history.append(continue_msg)
                    continue
            
            if completion_check["should_complete"]:
                completion_reason = completion_check["reason"]
                final_response = await self._generate_final_response(
                    reasoning_result,
                    full_system_prompt,
                    completion_reason,
                    precomputed_text=precomputed_text
                )
                response_msg = Msg(
                    name=self.name,
                    content=[{"type": "text", "text": final_response}],
                    role="assistant",
                    metadata=getattr(reasoning_result, 'metadata', None)
                )
                self._accumulated_usage["duration_ms"] = int((time.time() - _reply_start_time) * 1000)
                response_msg.usage = self._build_accumulated_usage()
                self._conversation_history.append(response_msg)
                
                return response_msg
            
            has_tool_calls = (
                len(self._tool_call_event_manager.get_active_tool_calls()) > 0 or
                reasoning_result.finish_reason == "tool_calls"
            )

            logger.info(f"[ReActCore] has_tool_calls={has_tool_calls}")
            logger.info(f"[ReActCore] reasoning_result metadata: {getattr(reasoning_result, 'metadata', None)}")
            logger.info(f"[ReActCore] reasoning_result type: {type(reasoning_result)}")
            
            if hasattr(reasoning_result, '__dict__'):
                logger.info(f"[ReActCore] reasoning_result attributes: {list(reasoning_result.__dict__.keys())}")

            if has_tool_calls:
                assistant_msg = Msg(
                    name=self.name,
                    content=reasoning_result.content,
                    role="assistant",
                    metadata=getattr(reasoning_result, 'metadata', None)
                )
                self._conversation_history.append(assistant_msg)
                logger.info(f"[ReActCore] Added assistant message with tool_calls to history")
                logger.info(f"[ReActCore] Assistant msg metadata: {assistant_msg.metadata}")

            tool_results = await self._acting(reasoning_result)
            
            if tool_results:
                for result in tool_results:
                    self._conversation_history.append(result)
            else:
                if has_tool_calls:
                    tool_call_ids = self._get_tool_call_ids_from_msg(assistant_msg)
                    for tc_id in tool_call_ids:
                        empty_tool_msg = Msg(
                            name="tool",
                            content="",
                            role="tool",
                            tool_call_id=tc_id,
                        )
                        self._conversation_history.append(empty_tool_msg)
                    logger.warning(f"[ReActCore] _acting() returned empty but has_tool_calls=True, added {len(tool_call_ids)} empty tool messages")
                if self._has_explicit_answer(reasoning_result, precomputed_text):
                    completion_reason = CompletionReason.NO_MORE_ACTIONS
                    final_response = await self._generate_final_response(
                        reasoning_result,
                        full_system_prompt,
                        completion_reason,
                        precomputed_text=precomputed_text
                    )
                    response_msg = Msg(
                        name=self.name,
                        content=[{"type": "text", "text": final_response}],
                        role="assistant",
                        metadata=getattr(reasoning_result, 'metadata', None)
                    )
                    self._accumulated_usage["duration_ms"] = int((time.time() - _reply_start_time) * 1000)
                    response_msg.usage = self._build_accumulated_usage()
                    self._conversation_history.append(response_msg)
                    
                    return response_msg
        
        completion_reason = CompletionReason.MAX_ITERATIONS
        final_response = await self._generate_final_response(
            "Maximum iterations reached",
            full_system_prompt,
            completion_reason
        )
        response_msg = Msg(
            name=self.name,
            content=[{"type": "text", "text": final_response}],
            role="assistant",
            metadata=getattr(reasoning_result, 'metadata', None)
        )
        self._accumulated_usage["duration_ms"] = int((time.time() - _reply_start_time) * 1000)
        response_msg.usage = self._build_accumulated_usage()
        self._conversation_history.append(response_msg)
        
        return response_msg
    
    async def _reasoning(
        self,
        user_msg: Msg,
        system_prompt: str,
        iteration: int,
        cancel_event: asyncio.Event = None
    ) -> ChatResponse:
        # 初始化本轮的 token 值（不修改累加值）
        current_input_tokens = 0
        current_output_tokens = 0
        
        messages = [
            Msg(name="system", content=system_prompt, role="system"),
            *self._get_sliding_window(max_messages=10),
        ]
        
        formatted = await self.formatter.format(messages)
        
        tools = None
        if self.tool_executor and hasattr(self.tool_executor, 'get_available_tools'):
            tools = self.tool_executor.get_available_tools()
        
        # tiktoken 预估算 input_tokens（作为 API usage 不可达时的 fallback）
        # API usage 精确值会在后续 chunk 中覆盖此估算值
        if self._token_encoder and formatted:
            try:
                estimated_input = 3
                for msg in formatted:
                    estimated_input += 3
                    content = msg.get("content", "")
                    if isinstance(content, str) and content:
                        estimated_input += len(self._token_encoder.encode(content))
                    elif isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict):
                                text = block.get("text", "") or block.get("thinking", "")
                                if text:
                                    estimated_input += len(self._token_encoder.encode(text))
                    name = msg.get("name")
                    if name:
                        estimated_input += len(self._token_encoder.encode(name)) + 1
                if tools:
                    import json
                    tools_text = json.dumps(tools, ensure_ascii=False)
                    estimated_input += len(self._token_encoder.encode(tools_text))
                # 不直接赋值到累加值，改为记录本轮的 tiktoken 估算值
                current_input_tokens = estimated_input
                logger.info(f"[_reasoning] tiktoken estimated input_tokens={estimated_input}")
            except Exception as e:
                logger.warning(f"[_reasoning] tiktoken input estimation failed: {e}")
        
        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError()
        if tools:
            logger.info(f"[_reasoning] Calling model with {len(tools)} tools: {[t.get('function', {}).get('name') for t in tools]}")
            response = await self.model(formatted, tools=tools, cancel_event=cancel_event)
        else:
            logger.info(f"[_reasoning] Calling model without tools")
            response = await self.model(formatted, cancel_event=cancel_event)
        
        if not hasattr(response, '__aiter__') and hasattr(response, 'metadata') and isinstance(response.metadata, dict) and response.metadata.get('error'):
            error_msg = response.metadata['error']
            logger.error(f"[ReActCore] LLM returned error in metadata: {error_msg}")
            raise RuntimeError(f"LLM调用失败: {error_msg}")
        
        if hasattr(response, '__aiter__'):
            final_response = None
            chunk_count = 0
            collected_content = []
            self._last_collected_content = collected_content
            collected_text_parts = []
            collected_stop_reason = None
            collected_finish_reason = None
            collected_metadata = None
            collected_usage = None
            
            _prev_block_type = None
            
            try:
                async for chunk in response:
                    if self._interrupted:
                        logger.info(f"[{self.name}] Stream interrupted by user at chunk #{chunk_count}")
                        break
                    
                    chunk_count += 1
                    final_response = chunk
                    
                    if hasattr(chunk, 'metadata') and isinstance(chunk.metadata, dict) and chunk.metadata.get('error'):
                        error_msg = chunk.metadata['error']
                        logger.error(f"[ReActCore] LLM stream chunk contains error in metadata: {error_msg}")
                        self._last_error = f"LLM调用失败: {error_msg}"
                        break
                    
                    if chunk.stop_reason:
                        logger.info(f"[_reasoning] Chunk #{chunk_count} stop_reason={chunk.stop_reason}")
                        collected_stop_reason = chunk.stop_reason
                    if chunk.finish_reason:
                        logger.info(f"[_reasoning] Chunk #{chunk_count} finish_reason={chunk.finish_reason}")
                        collected_finish_reason = chunk.finish_reason
                    
                    
                    if hasattr(chunk, 'content') and chunk.content:
                        block = chunk.content[0]
                        block_type = block.get("type") if isinstance(block, dict) else None

                        # 检查点 1：text 结束（text → 非 text 就触发，不管后面是 thinking 还是 tool_calls）
                        if _prev_block_type == "text" and block_type != "text":
                            logger.info(f"[Checkpoint] content_ended: prev={_prev_block_type}, current={block_type}")
                            if self.stream_callback:
                                self.stream_callback(
                                    {"__checkpoint__": "content_ended"},
                                    agent_id=self.agent_id, agent_name=self.name
                                )
                        _prev_block_type = block_type

                        if block_type == "tool_calls":
                                for tool_call_data in block.get("tool_calls", []):
                                    tool_id = tool_call_data.get("id")
                                    tool_index = tool_call_data.get("index")
                                    func = tool_call_data.get("function", {})
                                    
                                    logger.info(f"[ReActCore] Received tool_calls block: id={tool_id}, index={tool_index}, func={func}")
                                    
                                    actual_tool_id = tool_id
                                    
                                    if not actual_tool_id and tool_index is not None:
                                        active_calls = self._tool_call_event_manager.get_active_tool_calls()
                                        active_ids = list(active_calls.keys())
                                        if tool_index < len(active_ids):
                                            actual_tool_id = active_ids[tool_index]
                                            logger.info(f"[ReActCore] Matched tool call by index: {tool_index} -> {actual_tool_id}")
                                    
                                    if not actual_tool_id:
                                        logger.warning(f"[ReActCore] Cannot determine tool_call_id, skipping: index={tool_index}")
                                        continue
                                    
                                    if actual_tool_id not in self._tool_call_event_manager.get_active_tool_calls():
                                        # 检查点 2：tool_calls 调用前
                                        if self.stream_callback:
                                            self.stream_callback(
                                                {"__checkpoint__": "before_tool_calls"},
                                                agent_id=self.agent_id, agent_name=self.name
                                            )
                                        self._tool_call_event_manager.on_tool_call_start(
                                            tool_call_id=actual_tool_id,
                                            tool_name=func.get("name", "")
                                        )
                                        logger.info(f"[ReActCore] TOOL_CALL_START: {actual_tool_id}, name={func.get('name')}")
                                    
                                    delta_args = func.get("arguments", "")
                                    if delta_args:
                                        self._tool_call_event_manager.on_tool_call_args(
                                            tool_call_id=actual_tool_id,
                                            delta=delta_args
                                        )
                                        logger.info(f"[ReActCore] TOOL_CALL_ARGS: {actual_tool_id}, delta={delta_args[:50]}...")
                                    else:
                                        logger.info(f"[ReActCore] TOOL_CALL_ARGS skipped: delta_args is empty or None")
                        else:
                            is_final_assembled = hasattr(chunk, 'metadata') and chunk.metadata and 'original_model_message' in chunk.metadata
                            
                            if not is_final_assembled:
                                collected_content.append(block)
                                if isinstance(block, dict) and block.get("type") == "text":
                                    collected_text_parts.append(block.get("text", ""))
                            else:
                                logger.debug(f"[ReActCore] Skipped block from final assembled chunk (type={block_type})")

                    if self.stream_callback and chunk.content:
                        is_assembled = (
                            hasattr(chunk, 'metadata')
                            and chunk.metadata
                            and 'original_model_message' in chunk.metadata
                        )
                        if not is_assembled:
                            non_tool_blocks = [
                                b for b in chunk.content
                                if not (isinstance(b, dict) and b.get("type") == "tool_calls")
                            ]
                            if non_tool_blocks:
                                from collections import defaultdict
                                type_groups = defaultdict(list)
                                for b in non_tool_blocks:
                                    bt = b.get("type", "text") if isinstance(b, dict) else getattr(b, "type", "text")
                                    type_groups[bt].append(b)
                                for bt, blocks in type_groups.items():
                                    single_type_chunk = ChatResponse(content=blocks)
                                    delta = single_type_chunk.to_delta()
                                    if delta:
                                        self.stream_callback(delta, agent_id=self.agent_id, agent_name=self.name)

                    # tiktoken 逐 chunk 累积（正常完成时被 API usage 精确值覆盖）
                    if self._token_encoder and hasattr(chunk, 'content') and chunk.content:
                        for block in chunk.content:
                            if isinstance(block, dict):
                                text = block.get('text') or block.get('thinking') or ''
                            else:
                                text = getattr(block, 'text', None) or getattr(block, 'thinking', None) or ''
                            if text:
                                # 累加到本轮 output_tokens，而非直接累加到总累加值
                                current_output_tokens += len(self._token_encoder.encode(text))

                    await asyncio.sleep(0)

                if hasattr(chunk, 'metadata') and chunk.metadata:
                    collected_metadata = chunk.metadata
                if hasattr(chunk, 'usage') and chunk.usage:
                    # API 返回精确 usage，覆盖本轮的 tiktoken 估算值
                    # 统一获取函数：在获取端处理无效值，后续只判断 is not None
                    # 原因：统一在获取端处理，后续逻辑简单，避免每次使用都漏判 0 或 None
                    def _get_valid_token_value(usage, field):
                        """获取有效的 token 值，无效值（None/0/空）统一转为 None"""
                        val = getattr(usage, field, None)
                        if val is None or val == 0:
                            return None
                        return val
                    
                    collected_usage = chunk.usage
                    llm_input_tokens = _get_valid_token_value(chunk.usage, 'input_tokens')
                    llm_output_tokens = _get_valid_token_value(chunk.usage, 'output_tokens')
                    
                    # 用 LLM 精确值替换本轮的 tiktoken 估算值
                    if llm_input_tokens is not None:
                        current_input_tokens = llm_input_tokens
                    # 如果 llm_input_tokens 为 None，保留 tiktoken 估算值，不覆盖
                    
                    if llm_output_tokens is not None:
                        current_output_tokens = llm_output_tokens
                    # 如果 llm_output_tokens 为 None，保留 tiktoken 逐 chunk 累加值，不覆盖

            except asyncio.CancelledError:
                logger.info(f"[{self.name}] Stream cancelled, treating as normal end")
                # 不 re-raise：aclose() 已关闭连接，流结束，走正常结束路径
            except Exception as e:
                if self.model._was_cancelled:
                    logger.info(f"[{self.name}] Stream closed by aclose ({type(e).__name__}), treating as normal end")
                    # 不转 CancelledError：aclose() 导致的异常视为正常结束
                else:
                    raise
            
            logger.info(f"[ReActCore] Total stream chunks processed: {chunk_count}")
            
            # 每轮迭代结束时，将本轮的 token 累加到总累加值
            self._accumulated_usage["input_tokens"] += current_input_tokens
            self._accumulated_usage["output_tokens"] += current_output_tokens
            
            if collected_finish_reason == "tool_calls":
                self._tool_call_event_manager.end_all_active_tool_calls()
                # 检查点 3：tool_calls 调用结束
                if self.stream_callback:
                    self.stream_callback(
                        {"__checkpoint__": "after_tool_calls"},
                        agent_id=self.agent_id, agent_name=self.name
                    )
                logger.info(f"[ReActCore] finish_reason=tool_calls, ended all active tool calls")
            
            type_counts = Counter(block.get('type') if isinstance(block, dict) else type(block).__name__ for block in collected_content)
            logger.info(f"[ReActCore] collected_content types before tool_calls merge: {dict(type_counts)}")
            
            active_tool_calls = self._tool_call_event_manager.get_active_tool_calls()
            if active_tool_calls:
                existing_tool_ids = set()
                for block in collected_content:
                    if isinstance(block, dict) and block.get("type") == "tool_calls":
                        for tc in block.get("tool_calls", []):
                            if isinstance(tc, dict) and tc.get("id"):
                                existing_tool_ids.add(tc.get("id"))
                
                for tool_id, tool_call in active_tool_calls.items():
                    if tool_id not in existing_tool_ids:
                        try:
                            arguments = json.loads(tool_call.get("arguments", "{}")) if tool_call.get("arguments", "").strip() else {}
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse arguments for tool {tool_call.get('name')}: {tool_call.get('arguments', '')[:100]}...")
                            arguments = {}
                        
                        tool_calls_block = {
                            "type": "tool_calls",
                            "tool_calls": [{
                                "index": len([b for b in collected_content if isinstance(b, dict) and b.get("type") == "tool_calls"]),
                                "id": tool_id,
                                "type": "function",
                                "function": {
                                    "name": tool_call.get("name", ""),
                                    "arguments": json.dumps(arguments, ensure_ascii=False),
                                },
                            }],
                        }
                        collected_content.append(tool_calls_block)
                        logger.info(f"[ReActCore] Built ToolCallsBlock from ToolCallEventManager: {tool_id}")
            
            final_type_counts = Counter(block.get('type') if isinstance(block, dict) else type(block).__name__ for block in collected_content)
            logger.info(f"[ReActCore] Final collected_content types: {dict(final_type_counts)}")
            
            if final_response and collected_content:
                collected_text = "".join(collected_text_parts)
                response = ChatResponse(
                    content=collected_content,
                    usage=collected_usage or getattr(final_response, 'usage', None),
                    metadata=collected_metadata or getattr(final_response, 'metadata', None),
                    stop_reason=collected_stop_reason or getattr(final_response, 'stop_reason', None),
                    finish_reason=collected_finish_reason or getattr(final_response, 'finish_reason', None),
                )
                response.text = collected_text
                response.has_tool_calls = (collected_finish_reason == "tool_calls")
                logger.info(f"[ReActCore] Built complete response with {len(collected_content)} content blocks")
            else:
                response = final_response
        elif self.stream_callback and response.content:
            delta = response.to_delta()
            if delta:
                logger.info(f"[ReActCore] Non-stream delta: {list(delta.keys())}")
                self.stream_callback(delta, agent_id=self.agent_id, agent_name=self.name)
        
        if self._last_error:
            raise RuntimeError(self._last_error)
        
        if self.print_hint_msg:
            reasoning_text = getattr(response, 'text', None)
            if reasoning_text is None:
                reasoning_text = self._extract_text(response)
            tool_calls_info = []
            for block in response.content:
                if isinstance(block, dict) and block.get("type") == "tool_calls":
                    for tc in block.get("tool_calls", []):
                        if isinstance(tc, dict):
                            func = tc.get("function", {})
                            tool_calls_info.append(f"{func.get('name')}({func.get('arguments', '')})")
            
            if tool_calls_info:
                print(f"[Iteration {iteration}] Tool calls: {tool_calls_info}")
            else:
                print(f"[Iteration {iteration}] Reasoning: {reasoning_text[:100]}...")
        
        return response
    
    async def _acting(self, response: ChatResponse) -> List[Msg]:
        tool_calls = self._parse_tool_calls(response)
        
        logger.info(f"[_acting] Parsed {len(tool_calls)} tool calls from response")
        
        if not tool_calls:
            logger.debug("[_acting] No tool calls found, returning empty list")
            return []
        
        tool_results = []
        self._last_tool_results = []
        
        for tool_call in tool_calls:
            logger.info(f"[_acting] Executing tool: {tool_call.get('name')} with args: {tool_call.get('arguments')}")
            if self.tool_executor:
                try:
                    try:
                        if self._on_tool_executing:
                            await self._on_tool_executing(tool_call)
                    except Exception as callback_err:
                        logger.warning(f"on_tool_executing callback error: {callback_err}")

                    result = await self.tool_executor.execute(tool_call)
                    result_content = result.get("content", str(result)) if isinstance(result, dict) else str(result)
                    
                    tool_error = None
                    if isinstance(result, dict) and result.get("success") is False:
                        tool_error = result.get("error_message", result.get("content", "Tool execution failed"))
                    
                    self._tool_call_event_manager.on_tool_call_result(
                        tool_call_id=tool_call.get("id"),
                        result=result,
                        error=tool_error
                    )
                    
                    result_content_str = result_content if isinstance(result_content, str) else str(result_content)

                    result_msg = Msg(
                        name="tool",
                        content=result_content_str,
                        role="tool",
                        tool_call_id=tool_call.get("id"),
                        metadata={
                            "tool_name": tool_call.get("name")
                        }
                    )
                    tool_results.append(result_msg)
                    
                    self._last_tool_results.append({
                        "name": tool_call.get("name"),
                        "tool_type": self._determine_call_type(tool_call.get("name")),
                        "args": tool_call.get("arguments", {}),
                        "result": result,
                        "id": tool_call.get("id"),
                    })
                    logger.info(f"[_acting] Tool {tool_call.get('name')} executed successfully, result length: {len(str(result_content))}")

                    try:
                        if self._on_tool_executed:
                            logger.info(f"[ReActCore] Calling _on_tool_executed for tool={tool_call.get('name')}")
                            await self._on_tool_executed(tool_call, result)
                        else:
                            logger.info(f"[ReActCore] _on_tool_executed is None, skipping callback for tool={tool_call.get('name')}")
                    except Exception as callback_err:
                        logger.warning(f"on_tool_executed callback error: {callback_err}")
                except asyncio.CancelledError:
                    self._tool_call_event_manager.on_tool_call_result(
                        tool_call_id=tool_call.get("id"),
                        result={"content": "任务执行被取消", "success": False, "error_message": "执行被用户取消"},
                        error="cancelled"
                    )
                    raise
                except Exception as e:
                    error_str = str(e)
                    self._tool_call_event_manager.on_tool_call_result(
                        tool_call_id=tool_call.get("id"),
                        result={
                            "content": error_str,
                            "success": False,
                            "error_message": error_str,
                            "metadata": {}
                        },
                        error=error_str
                    )
                    
                    error_msg = Msg(
                        name="tool_error",
                        content=error_str,
                        role="tool",
                        tool_call_id=tool_call.get("id"),
                        metadata={
                            "tool_name": tool_call.get("name"),
                            "error_message": error_str,
                            "success": False
                        }
                    )
                    tool_results.append(error_msg)
                    
                    self._last_tool_results.append({
                        "name": tool_call.get("name"),
                        "tool_type": self._determine_call_type(tool_call.get("name")),
                        "args": tool_call.get("arguments", {}),
                        "result": {
                            "content": error_str,
                            "success": False,
                            "error_message": error_str,
                            "metadata": {}
                        },
                        "id": tool_call.get("id"),
                    })
                    logger.error(f"[_acting] Tool {tool_call.get('name')} execution failed: {e}")
        
        logger.info(f"[_acting] Total {len(self._last_tool_results)} tool results recorded")
        return tool_results
    
    def _determine_call_type(self, tool_name: str) -> str:
        if tool_name == "Skill":
            return "skill"
        elif tool_name == "MCP":
            return "mcp"
        elif tool_name == "Task":
            return "subagent"
        return "tool"
    
    def _parse_tool_calls(self, response: ChatResponse) -> List[dict]:
        tool_calls = []
        
        active_tool_calls = self._tool_call_event_manager.get_active_tool_calls()
        
        if active_tool_calls:
            for tool_id, tool_call in active_tool_calls.items():
                args_str = tool_call.get("arguments", "")
                
                try:
                    arguments = json.loads(args_str) if args_str.strip() else {}
                except json.JSONDecodeError:
                    logger.warning(f"Failed to parse arguments for tool {tool_call.get('name')}: {args_str[:100]}...")
                    arguments = {}
                
                tool_calls.append({
                    "id": tool_id,
                    "name": tool_call.get("name"),
                    "arguments": arguments
                })
            
            logger.info(f"[_parse_tool_calls] Parsed {len(tool_calls)} tool calls from ToolCallEventManager")
            return tool_calls
        
        merged_tool_calls = {}
        
        for block in response.content:
            if isinstance(block, dict):
                block_type = block.get("type")
                
                if block_type == "tool_calls":
                    for tc in block.get("tool_calls", []):
                        if isinstance(tc, dict):
                            tc_id = tc.get("id", "")
                            if tc_id:
                                func = tc.get("function", {})
                                args = func.get("arguments", "")
                                if isinstance(args, str):
                                    try:
                                        args = json.loads(args) if args.strip() else {}
                                    except json.JSONDecodeError:
                                        args = {}
                                tool_calls.append({
                                    "id": tc_id,
                                    "name": func.get("name", ""),
                                    "arguments": args
                                })
        
        if tool_calls:
            logger.info(f"[_parse_tool_calls] Parsed {len(tool_calls)} tool calls from response content")
        
        return tool_calls
    
    def _check_completion(self, response: Union[ChatResponse, str], iteration: int,
                          precomputed_text: Optional[str] = None,
                          has_tool_calls: Optional[bool] = None) -> dict:
        if isinstance(response, ChatResponse):
            stop_reason_raw = getattr(response, 'stop_reason', None)
            finish_reason_raw = getattr(response, 'finish_reason', None)
            logger.info(f"[_check_completion] stop_reason={stop_reason_raw}, finish_reason={finish_reason_raw}")
            
            if has_tool_calls:
                logger.info(f"[_check_completion] has_tool_calls=True (precomputed), returning TOOL_CALL")
                return {"should_complete": False, "reason": CompletionReason.TOOL_CALL}
            
            stop_reason = StopReason.from_api_response(response)
            logger.info(f"[_check_completion] parsed stop_reason={stop_reason}")
            logger.debug(f"Completion check - Iteration: {iteration}, has_tool_calls: {has_tool_calls}, "
                         f"finish_reason: {getattr(response, 'finish_reason', None)}, "
                         f"stop_reason: {getattr(response, 'stop_reason', None)}")
            
            if stop_reason == StopReason.END_TURN:
                return {
                    "should_complete": True,
                    "reason": CompletionReason.TASK_COMPLETED
                }
            
            if stop_reason == StopReason.TOOL_USE:
                return {"should_complete": False, "reason": CompletionReason.TOOL_CALL}
            
            if stop_reason == StopReason.MAX_TOKENS:
                logger.info(f"MAX_TOKENS reached at iteration {iteration}, auto-continuing...")
                if self.stream_callback:
                    try:
                        self.stream_callback({"content": "\n\n[继续输出...]\n\n"}, agent_id=self.agent_id, agent_name=self.name)
                    except Exception as e:
                        logger.error(f"Stream callback error: {e}")
                return {
                    "should_complete": False,
                    "reason": CompletionReason.MAX_ITERATIONS,
                    "auto_continue": True
                }
            
            reasoning_text = self._extract_text(response, precomputed_text)
            if reasoning_text.strip() and self._looks_like_final_answer(reasoning_text):
                return {
                    "should_complete": True,
                    "reason": CompletionReason.TASK_COMPLETED
                }
        
        if iteration >= self.max_iters - 1:
            return {
                "should_complete": True,
                "reason": CompletionReason.MAX_ITERATIONS
            }
        
        return {"should_complete": False, "reason": None}
    
    def _looks_like_final_answer(self, text: str) -> bool:
        sentences = re.split(r'[.!?]+', text)
        if len(sentences) <= 2:
            return True
        
        if re.search(r'^\s*(yes|no|correct|incorrect)\s*[,.]', text.lower()):
            return True
        
        if re.search(r'\b(is|are|was|were)\s+\d+', text.lower()):
            return True
        
        return False
    
    def _has_explicit_answer(self, response: Union[ChatResponse, str], precomputed_text: Optional[str] = None) -> bool:
        text = self._extract_text(response, precomputed_text)
        
        if re.search(r'(answer|result|output)\s*(is|:)\s*', text.lower()):
            return True
        
        if re.search(r'^\s*[\d\w]+\.?\s*$', text.strip()):
            return True
        
        return False
    
    def _extract_text(self, response: Union[ChatResponse, str], precomputed_text: Optional[str] = None) -> str:
        if precomputed_text is not None:
            return precomputed_text
        if isinstance(response, ChatResponse):
            return "".join(
                block.get("text", "")
                for block in response.content
                if isinstance(block, dict) and block.get("type") == "text"
            )
        return response
    
    async def _generate_final_response(
        self,
        response: Union[ChatResponse, str],
        system_prompt: str,
        completion_reason: Optional[CompletionReason] = None,
        precomputed_text: Optional[str] = None
    ) -> str:
        reasoning_text = self._extract_text(response, precomputed_text)
        
        if self._accumulated_text:
            if reasoning_text.startswith(self._accumulated_text):
                final_text = reasoning_text
                logger.info(f"[_generate_final_response] reasoning_text already contains accumulated_text, using reasoning_text directly (len={len(reasoning_text)})")
            else:
                final_text = self._accumulated_text + reasoning_text
                logger.info(f"[_generate_final_response] concatenating accumulated_text (len={len(self._accumulated_text)}) + reasoning_text (len={len(reasoning_text)})")
            self._accumulated_text = ""
            return final_text
        
        if reasoning_text:
            return reasoning_text
        
        return "Final response generated."
    
    async def clear_history(self) -> None:
        self._conversation_history.clear()
        self._iteration_count = 0
        self._last_tool_results = []
    
    def get_iteration_count(self) -> int:
        return self._iteration_count
    
    def get_conversation_history(self) -> List[Msg]:
        return self._conversation_history.copy()
    
    def get_last_tool_results(self) -> List[Dict[str, Any]]:
        return self._last_tool_results.copy()
