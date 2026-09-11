# -*- coding: utf-8 -*-
import logging
import time
import asyncio
import json
import re
from typing import Dict, Any, Optional, List, Union, Callable
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from collections import Counter
from enum import Enum

from ..message import Msg
from ..model import ChatModelBase, ChatResponse, ChatUsage
from ..formatter import FormatterBase
from ..utils.context_vars import tool_call_id_var
from .interfaces import RAGInterface, ToolExecutorInterface
from ..types.protocols import StreamCallback

logger = logging.getLogger("SoloEngine")

from .compaction import (
    SUMMARY_OUTPUT_RESERVE,
    AUTOCOMPACT_BUFFER_TOKENS,
    COMPACTION_INVALID_MARKERS,
    COMPACTION_PROMPT,
    COMPACTION_USER_PROMPT,
    format_compact_summary,
    strip_spurious_tool_call_blocks,
)
from .tool_call_event import ToolCallEventManager, ToolCallEventType

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



class ReActCore:
    
    def __init__(
        self,
        name: str,
        model: ChatModelBase,
        formatter: FormatterBase,
        system_prompt: str,
        rag: Optional[RAGInterface] = None,
        tool_executor: Optional[ToolExecutorInterface] = None,
        # C8：默认值改为 None，在函数体内延迟 import settings 求值——
        # 消除模块级 `from app.core.config import settings` 反向依赖（core 层禁 import app 层）
        max_iters: int = None,
        print_hint_msg: bool = False,
        stream_callback: Optional[StreamCallback] = None,
        agent_id: Optional[str] = None,
        provider: str = "",
        max_input_tokens: Optional[int] = None,
        max_tool_calls: Optional[int] = None,
    ) -> None:
        # C8：延迟 import（仅在未显式传值时求默认），行为与模块级默认完全一致
        if max_iters is None:
            from SoloAgent.config import settings
            max_iters = settings.DEFAULT_MAX_ITERS
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
        self.provider = provider
        # ★ 无降级原则：max_input_tokens 必须从画布节点 model_config 获取
        # （默认值来自 llm_config 并写入 canvas，运行时完全从 canvas 获取）。
        # 禁止降级到默认值；缺失/非法时直接报错，让用户明确得知配置问题。
        if max_input_tokens is None or max_input_tokens <= 0:
            raise ValueError(
                f"[{name}] max_input_tokens 必须从画布节点 model_config 获取（默认值来自 llm_config 并写入 canvas），"
                "禁止降级到默认值。请在画布中为该节点配置 max_input_tokens 后重新保存。"
            )
        self._max_input_tokens = max_input_tokens

        # ★ 工具调用轮次（max_tool_calls）：一次 react_core 循环中 agent 允许调用 LLM API 的次数上限。
        #   同 max_input_tokens 规则：必须从画布节点 model_config 获取，禁止降级到默认值。
        if max_tool_calls is None or max_tool_calls <= 0:
            raise ValueError(
                f"[{name}] max_tool_calls（工具调用轮次）必须从画布节点 model_config 获取"
                "（默认值来自 llm_config 并写入 canvas），禁止降级到默认值。"
                "请在画布中为该节点配置 max_tool_calls 后重新保存。"
            )
        self.max_tool_calls = max_tool_calls

        self._conversation_history: List[Msg] = []
        self._iteration_count = 0
        self._last_tool_results: List[Dict[str, Any]] = []
        self._accumulated_text: str = ""
        self._last_collected_content: list = []
        self._interrupted: bool = False
        # 上下文压缩状态
        self._compacting: bool = False          # 压缩摘要生成中（防递归触发阈值检测）
        self._compaction_triggered: bool = False  # 阈值检测已触发（由 _reasoning 内设置）
        self._last_context_tokens: int = 0      # 最近一次 LLM 请求的上下文占用（单次请求，非累计）
        self._compaction_stream_buffer: list = []  # 压缩期间缓冲的原始流 delta（统一发射格式化摘要）
        self._on_tool_executed: Optional[Any] = None
        self._on_tool_executing: Optional[Any] = None
        self._accumulated_usage = self._new_usage_dict()
        # agent 级整轮累计（后端聚合改造 3.1）：
        # 与 _accumulated_usage（本阶段/消息级，take_accumulated_usage 消费即清空）正交——
        # 不随 take 清空，由 flow_compiler 在每次 _execute_agent 开始时 reset_agent_usage()，
        # 语义为"一次 _execute_agent 调用（整轮，含压缩 stop/compacted/resume 各阶段）
        # 的完整累计"。是流式 agent_token_usage 推送 agent_usage 字段与
        # agent_complete.metadata.agent_usage 的唯一实时数据源（前端消息头/组头整轮显示）。
        self._agent_accumulated_usage = self._new_usage_dict()
        # 执行实例唯一标识（〇·3 并发方案）：由 flow_compiler 在每次 _execute_agent 执行时
        # 通过 set_message_id 写入（initialize 之后、_active_models 注册处），
        # 全部 stream_callback 调用（6 处）据此携带 message_id，ChunkCollector 按
        # message_id 独立收集（同一 agent 并发 N 实例时块/保存互不混淆）。
        self._message_id: Optional[str] = None
        # 独立快照阶段计数（2026-08-05 问题 1 修复配套）：
        # take_accumulated_usage（消息保存时消费清空）每调用一次 phase+1，
        # agent_token_usage 推送携带当前 phase —— 前端据此精确识别「新阶段」边界。
        # 必须显式计数而非推断：压缩轮生成摘要的输入含完整历史，其 total 可能
        # ≥ 前一阶段（stop）末值，推送值递减/iteration 重置推断均不可靠。
        self._usage_phase = 0
        self._last_error: Optional[str] = None
        self._current_cancel_event = None

        self._tool_call_event_manager = ToolCallEventManager(
            stream_callback=self.stream_callback,
            agent_id=self.agent_id,
            agent_name=self.name,
            message_id=self._message_id
        )

    def load_history(self, messages: List[Msg]) -> None:
        self._conversation_history = messages.copy()

    def interrupt(self) -> None:
        self._interrupted = True
        logger.info(f"[{self.name}] Interrupt requested")
    
    def is_interrupted(self) -> bool:
        return self._interrupted
    
    def get_auto_compact_threshold(self) -> int:
        """自动压缩阈值（参考 Claude Code autoCompact.ts：有效窗口 − 安全缓冲）。

        有效上下文窗口 = max_input_tokens − 摘要输出预留（contextWindow − min(modelMaxOutput, 20000)）。
        小窗口（< 20000）按比例缩放：阈值 = 85% 窗口（预留输出与缓冲空间）。
        大窗口兜底：阈值不低于 70% 窗口，防止极端配置下阈值过低导致频繁压缩。
        """
        if self._max_input_tokens < SUMMARY_OUTPUT_RESERVE:
            # 小上下文窗口（如测试流 4096）：预留 15% 空间，阈值 = 85% 窗口
            return max(1, int(self._max_input_tokens * 0.85))
        max_output = getattr(self.model, 'max_output_tokens', None) or SUMMARY_OUTPUT_RESERVE
        effective = self._max_input_tokens - min(max_output, SUMMARY_OUTPUT_RESERVE)
        threshold = effective - AUTOCOMPACT_BUFFER_TOKENS
        floor = int(self._max_input_tokens * 0.7)
        return max(threshold, floor)
    
    def _build_accumulated_usage(self) -> ChatUsage:
        return ChatUsage(
            input_tokens=self._accumulated_usage["input_tokens"],
            output_tokens=self._accumulated_usage["output_tokens"],
            time=self._accumulated_usage.get("duration_ms", 0) / 1000.0,
            duration_ms=self._accumulated_usage.get("duration_ms", 0),
            system_prompt_token=self._accumulated_usage.get("system_prompt_token", 0),
            user_prompt_token=self._accumulated_usage.get("user_prompt_token", 0),
            assistant_prompt_token=self._accumulated_usage.get("assistant_prompt_token", 0),
            token_usage_history=self._accumulated_usage.get("token_usage_history", []),
        )

    # ---- B3 路径合并：usage 累计字典的唯一构造/累加/历史记录构造（3 个 helper）----

    @staticmethod
    def _new_usage_dict() -> Dict:
        """新建 usage 累计字典（B3：5 处 7 键字面量收敛为唯一构造）。"""
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "duration_ms": 0,
            "system_prompt_token": 0,
            "user_prompt_token": 0,
            "assistant_prompt_token": 0,
            "token_usage_history": [],
        }

    @staticmethod
    def _accumulate_usage(
        acc: Dict,
        input_tokens: int,
        output_tokens: int,
        system_tokens: int,
        user_tokens: int,
        assistant_tokens: int,
    ) -> None:
        """将单次 LLM 调用的 token 累加到累计字典（B3：2 处成对累加收敛）。"""
        acc["input_tokens"] += input_tokens
        acc["output_tokens"] += output_tokens
        acc["system_prompt_token"] += system_tokens
        acc["user_prompt_token"] += user_tokens
        acc["assistant_prompt_token"] += assistant_tokens

    @staticmethod
    def _build_history_entry(
        iteration: int,
        input_tokens: int,
        output_tokens: int,
        system_tokens: int,
        user_tokens: int,
        assistant_tokens: int,
        finish_reason: str,
        start_time: float,
    ) -> Dict:
        """构造 token_usage_history 单条记录（B3：2 处 history_entry 收敛）。"""
        # C8：延迟 import settings（消除 core 层模块级反向依赖 app.core.config）
        from SoloAgent.config import settings
        return {
            "iteration": iteration,
            "timestamp": datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat(),
            "system_prompt_token": system_tokens,
            "user_prompt_token": user_tokens,
            "assistant_prompt_token": assistant_tokens,
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "duration_ms": int((time.time() - start_time) * 1000),
            "finish_reason": finish_reason,
        }

    def _format_usage(self, acc: Dict, include_phase: bool = False) -> Optional[Dict]:
        """usage 字典 → 统一返回结构（去重：get_accumulated_usage / get_agent_usage 共用）。

        include_phase=True 时附带 usage_phase（agent_token_usage 推送与 agent_complete
        metadata.tokens 同源，均携带阶段计数，前端据此识别阶段边界）；
        get_agent_usage（agent 级整轮）不含 usage_phase。值为 0 时返回 None。
        """
        if acc and (acc.get("input_tokens", 0) > 0 or acc.get("output_tokens", 0) > 0):
            result = {
                "prompt_tokens": acc.get("input_tokens", 0),
                "completion_tokens": acc.get("output_tokens", 0),
                "total_tokens": acc.get("input_tokens", 0) + acc.get("output_tokens", 0),
                "duration_ms": acc.get("duration_ms", 0),
                "system_prompt_token": acc.get("system_prompt_token", 0),
                "user_prompt_token": acc.get("user_prompt_token", 0),
                "assistant_prompt_token": acc.get("assistant_prompt_token", 0),
                "token_usage_history": acc.get("token_usage_history", []),
            }
            if include_phase:
                result["usage_phase"] = self._usage_phase
            return result
        return None

    def get_accumulated_usage(self) -> Optional[Dict]:
        # 统一 token 数据源：agent_token_usage 与 agent_complete.metadata.tokens
        # 同源（本方法），均携带 usage_phase，前端 agent_complete 分支可直接复用
        # updateAgentTokens（单一注入路径，阶段锁定语义一致）。
        return self._format_usage(self._accumulated_usage, include_phase=True)

    def reset_agent_usage(self) -> None:
        """重置 agent 级整轮累计（每次 _execute_agent 开始时由 flow_compiler 调用）。

        与 _accumulated_usage（take 消费清空、阶段独立记账）正交：
        _agent_accumulated_usage 跨压缩轮全部阶段（stop/compacted/resume）持续累计，
        直到本次 _execute_agent 执行结束（下次执行前重置），语义为整轮累计。
        """
        self._agent_accumulated_usage = self._new_usage_dict()

    def get_agent_usage(self) -> Optional[Dict]:
        """返回 agent 级整轮累计快照（与 get_accumulated_usage 同构，不含 usage_phase）。

        该返回直接透传至前端 agent_token_usage 推送（agent_usage 字段）与
        agent_complete.metadata.agent_usage；回显/前端展示聚合字段
        （system_prompt/user_prompt/assistant_prompt/completion/total）由后端在
        聚合字段与前端 TokenTotals 映射时转换（run.py / 前端），本方法不承担映射。
        值为 0 时返回 None（前端据此不显示）。
        """
        return self._format_usage(self._agent_accumulated_usage, include_phase=False)

    def set_message_id(self, message_id: str) -> None:
        """设置执行实例唯一标识（〇·3 并发方案，flow_compiler 每次 _execute_agent 调用）。

        在 initialize 之后（_core 已存在）、_active_models 注册处调用；同时同步
        _tool_call_event_manager（其 _emit_to_frontend 的 stream_callback 调用同样需要
        携带 message_id）。同一 agent 并发 N 实例时各实例独立键，互不混淆。
        """
        self._message_id = message_id
        self._tool_call_event_manager.message_id = message_id

    def take_accumulated_usage(self) -> Optional[Dict]:
        """取走当前累计 usage 并清空（消息保存时消费，实现"每条消息独立记账"）。

        方案 B（独立快照，2026-08-04 重构）：替代 compact() 的主动重置。
        消息保存路径在保存后调用本方法，使下一条消息的 usage 从 0 开始累计——
        压缩轮 stop / compacted / resume 三条消息天然分界，与正常轮完全同路径。
        """
        result = self.get_accumulated_usage()
        if result:
            self._accumulated_usage = self._new_usage_dict()
            # 独立快照阶段计数：每次消息保存消费清空 = 新阶段开始（phase+1），
            # 前端 agent_token_usage 处理据此识别阶段边界（压缩轮 stop/compacted/
            # resume 各自独立阶段，与回显逐消息语义一致）。
            self._usage_phase += 1
        return result

    async def reply(self, message: Msg, cancel_event: asyncio.Event = None) -> Msg:
        _reply_start_time = time.time()

        self._current_cancel_event = cancel_event
        user_msg = message

        self._conversation_history.append(user_msg)
        self._iteration_count = 0
        self._last_tool_results = []
        self._interrupted = False
        self._compaction_triggered = False
        self._accumulated_usage = self._new_usage_dict()
        self._accumulated_text = ""
        
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

        # ★ 工具调用轮次（max_tool_calls）= 一次 react_core 循环中 agent 允许调用 LLM API 的次数上限。
        #   flow_compiler 已保证 max_iters 与 max_tool_calls 取值一致（均来自画布节点 model_config.max_tool_calls）。
        for iteration in range(self.max_tool_calls):
            self._tool_call_event_manager.reset()

            # 检查 cancel_event：用户主动停止时立即中断
            if cancel_event and cancel_event.is_set():
                logger.info(f"[{self.name}] Cancel event detected at iteration {iteration}, breaking")
                self._interrupted = True
                break

            if self._interrupted:
                logger.info(f"[{self.name}] Execution interrupted by user at iteration {iteration}")
                break

            # 压缩阈值检测已移至 _reasoning 内（基于"单次请求上下文占用" _last_context_tokens，
            # 而非累计请求量——修复统计口径 bug）：触发时 _reasoning 置 _compaction_triggered+
            # _interrupted=True 并返回 None，由下方 reasoning_result is None 分支统一 break，
            # flow_compiler._execute_agent 执行压缩（复用停止路径）。此处无需独立检查
            # _compaction_triggered（历史遗留冗余：L561-564 永不独立触发）。

            self._iteration_count = iteration + 1
            self._last_error = None
            
            reasoning_result = await self._reasoning(
                user_msg, 
                full_system_prompt,
                iteration,
                cancel_event
            )

            # 压缩阈值在 _reasoning 内触发（返回 None）：复用停止路径 break
            if reasoning_result is None:
                logger.info(f"[{self.name}] _reasoning returned None (compaction triggered), breaking")
                break

            if cancel_event and cancel_event.is_set():
                self._interrupted = True
                break
            
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
                final_response = await self._generate_final_response(
                    reasoning_result,
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

            tool_results = await self._acting(reasoning_result, cancel_event)
            
            if tool_results:
                for result in tool_results:
                    self._conversation_history.append(result)
            else:
                if has_tool_calls:
                    # 从 assistant_msg 的 content 中提取 tool_call_ids
                    if hasattr(assistant_msg, 'content') and isinstance(assistant_msg.content, list):
                        for block in assistant_msg.content:
                            if isinstance(block, dict) and block.get("type") == "tool_calls":
                                for tc in block.get("tool_calls", []):
                                    if isinstance(tc, dict) and tc.get("id"):
                                        empty_tool_msg = Msg(
                                            name="tool", content="", role="tool",
                                            tool_call_id=tc.get("id"),
                                        )
                                        self._conversation_history.append(empty_tool_msg)
                    logger.warning(f"[ReActCore] _acting() returned empty but has_tool_calls=True, added empty tool messages")
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
        
        if self._interrupted:
            response_msg = Msg(
                name=self.name,
                content=self._last_collected_content.copy(),
                role="assistant",
            )
            self._accumulated_usage["duration_ms"] = int((time.time() - _reply_start_time) * 1000)
            response_msg.usage = self._build_accumulated_usage()
            # 追加历史时过滤 tool_calls 块：collected_content 是上一次 _reasoning 收集的，
            # 其中的 tool_calls 已由 _acting 执行并将 tool 结果追加进历史；
            # 若原样追加会产生"孤立 tool_calls"（无对应 tool 结果），
            # 压缩摘要调用发给模型时违反 OpenAI 约束（400 2013 tool call and result not match）。
            # response_msg 保持原样返回（供 flow_compiler 保存 pre-compaction 输出）。
            # 修复重复 bug：若上一次迭代 has_tool_calls 为 True，assistant_msg（含文本+tool_calls）
            # 已追加进历史，此处再次追加文本块会产生重复；仅在无 tool_calls（assistant_msg 未追加）时追加。
            history_content = [
                b for b in self._last_collected_content
                if isinstance(b, dict) and b.get("type") != "tool_calls"
            ]
            has_tool_calls_in_last = any(
                isinstance(b, dict) and b.get("type") == "tool_calls"
                for b in self._last_collected_content
            )
            if history_content and not has_tool_calls_in_last:
                history_msg = Msg(
                    name=self.name,
                    content=history_content,
                    role="assistant",
                )
                self._conversation_history.append(history_msg)
            return response_msg

        final_response = await self._generate_final_response(
            "Maximum iterations reached"
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

        # 用户主动停止：保持 _interrupted = True，让外层知道是 stop 而非 completed
        if cancel_event and cancel_event.is_set():
            self._interrupted = True
            logger.info(f"[{self.name}] Reply ended with cancel_event set, _interrupted remains True")

        return response_msg

    # ================== 上下文压缩 ==================

    async def compact(self, cancel_event=None) -> Optional[str]:
        """生成压缩摘要。由 flow_compiler._execute_agent 在压缩轮次调用。

        与正常调用完全一致：stream_callback 保持打开，摘要作为普通 chunk 进入 collector 与前端。
        特殊处理：system_prompt 换为 COMPACTION_PROMPT（9 段结构化）、tool_executor 禁用、
        _compacting 置位（防递归触发阈值检测）。
        摘要经 format_compact_summary 剥离 <analysis> 草稿区、提取 <summary> 最终区。
        压缩后历史 = [摘要]（原始消息内容由摘要第 6 段"所有用户消息"逐字保留；
        不保留原始 user 消息原文，防止超大 user 消息在 resume 后再次触发压缩造成死循环）。
        """
        original_system_prompt = self.system_prompt
        original_tool_executor = self.tool_executor

        try:
            self.system_prompt = COMPACTION_PROMPT
            self.tool_executor = None
            self._compacting = True
            self._compaction_triggered = False
            self._compaction_stream_buffer = []
            # 必须在 _reasoning 之前重置：压缩检测在 reply() 中置 _interrupted=True，
            # _reasoning 的流式循环首轮会检查 _interrupted，若仍为 True 会立即中断导致"LLM 返回空响应"
            self._interrupted = False

            # 找最后一个 user 消息（用于 RAG 检索；摘要输入仍为完整 _conversation_history）
            # 注意：历史末尾通常是 subagent 的任务 user 消息 + assistant 工具调用 + tool 结果，
            # 直接传给模型易被引导"继续完成任务"。因此压缩轮次在消息末尾追加明确的
            # COMPACTION_USER_PROMPT 指令（问题 4 修复：压缩轮次总是完成任务式输出）。
            user_msg = None
            for msg in self._conversation_history:
                if msg.role == "user":
                    user_msg = msg
                    break
            if user_msg is None:
                user_msg = self._conversation_history[-1]

            compaction_instruction = Msg(
                name="user",
                content=COMPACTION_USER_PROMPT,
                role="user",
            )
            # 临时追加压缩指令到 history 末尾，_reasoning 构造 messages 时会包含它；
            # 压缩结束后 history 被重建为 [summary_msg]，无需回滚
            self._conversation_history.append(compaction_instruction)

            # 方案 B（独立快照）：不再重置 _accumulated_usage——压缩前 stop 轮的 usage
            # 已在 stop 消息保存时 take_accumulated_usage 消费清空，摘要轮 _reasoning
            # 自然从 0 开始累计，compacted 消息保存时取走即独立记账。

            reasoning_result = await self._reasoning(
                user_msg=compaction_instruction,
                system_prompt=COMPACTION_PROMPT,
                iteration=0,
                cancel_event=cancel_event,
            )
            if reasoning_result is None:
                raise RuntimeError("Compaction summary generation failed: empty response")

            raw_summary = self._extract_text(reasoning_result)
            # 已知 DeepSeek V4 缺陷归一化：剥离模型幻觉输出的工具调用 XML/DSML 块
            #（工具禁用时模型仍可能输出工具调用纯文本，非标准输出类型，需移除）
            summary_text = strip_spurious_tool_call_blocks(format_compact_summary(raw_summary))
            has_tc_marker = any(m in summary_text for m in COMPACTION_INVALID_MARKERS)
            logger.info(
                "[%s] Compaction summary check: len=%d, has_tool_calls=%s, raw_len=%d, preview=%r",
                self.name, len(summary_text), has_tc_marker, len(raw_summary or ""), str(summary_text)[:160],
            )
            if not summary_text.strip() or has_tc_marker:
                # 摘要无效（空 / 模型违规输出 <tool_calls> XML 或 DeepSeek DSML 标记）：重试一次
                # 不重置 _accumulated_usage：首次调用真实消耗 token，累计保留（准确反映消耗）
                logger.warning(
                    f"[{self.name}] Invalid compaction summary ({len(summary_text)} chars), retrying once"
                )
                self._compaction_stream_buffer = []
                reasoning_result = await self._reasoning(
                    user_msg=compaction_instruction,
                    system_prompt=COMPACTION_PROMPT,
                    iteration=0,
                    cancel_event=cancel_event,
                )
                if reasoning_result is None:
                    raise RuntimeError("Compaction summary retry failed: empty response")
                raw_summary = self._extract_text(reasoning_result)
                summary_text = strip_spurious_tool_call_blocks(format_compact_summary(raw_summary))
            if not summary_text.strip() or any(m in summary_text for m in COMPACTION_INVALID_MARKERS):
                raise RuntimeError(
                    f"Compaction summary invalid after retry: {len(summary_text)} chars"
                )

            summary_msg = Msg(
                name=self.name,
                content=[{"type": "text", "text": summary_text}],
                role="assistant",
            )

            # 压缩后历史 = [摘要]；resume 时 reply() 会 append continue 消息
            # 不重置 _accumulated_usage：compacted 消息保存时 take_accumulated_usage
            # 消费摘要轮 usage；resume 的 reply() 会重新初始化 _accumulated_usage。
            self._conversation_history = [summary_msg]
            self._accumulated_text = ""
            self._interrupted = False
            self._compaction_triggered = False
            logger.info(f"[{self.name}] Compaction done: {len(summary_text)} chars")
            # 发射格式化摘要到 collector + 前端（覆盖压缩期间的原始流缓冲，
            # 保证 DB/前端展示的是剥离 <analysis> 后的结构化摘要）。
            # _is_compaction 标记：前端据此将该 content 块渲染为「上下文已压缩」气泡
            # （嵌套在 subagent 组内，与回显路径 build_flattened_blocks 的标记同构）。
            # 分块流式发射：摘要生成后按小块连续调用 stream_callback（40 字符/块），
            # 前端 RAF 合并渲染呈逐字/逐块增长效果，模拟正常轮次的流式输出
            # （问题 2 修复：压缩块 content 不再"完成后整块传输"）。
            # collector 按 content 类型逐块拼接，DB 保存结果与一次性发射完全等价。
            # 统一修复：发射格式与正常轮次 to_delta 完全一致（{"content": ...}，text 块
            # 经 to_delta 即转为 content 字段），DB 中摘要块类型为标准 content。
            if self.stream_callback and summary_text:
                compaction_chunk_size = 40
                for i in range(0, len(summary_text), compaction_chunk_size):
                    piece = summary_text[i:i + compaction_chunk_size]
                    self.stream_callback(
                        {"content": piece, "_is_compaction": True},
                        agent_id=self.agent_id,
                        agent_name=self.name,
                        message_id=self._message_id,
                    )
            self._compaction_stream_buffer = []
            return summary_text

        finally:
            self.system_prompt = original_system_prompt
            self.tool_executor = original_tool_executor
            self._compacting = False
            self._compaction_stream_buffer = []

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
        # 按角色拆分估算
        current_system_tokens = 0
        current_user_tokens = 0
        current_assistant_tokens = 0
        # 单次调用计时（用于 history_entry 的 duration_ms）
        _iteration_start_time = time.time()
        
        messages = [
            Msg(name="system", content=system_prompt, role="system"),
            *self._conversation_history,  # 直接用完整历史，移除滑动窗口
        ]

        formatted = await self.formatter.format(messages)
        
        tools = None
        if self.tool_executor and hasattr(self.tool_executor, 'get_available_tools'):
            tools = self.tool_executor.get_available_tools()
        
        if formatted:
            from ..utils.token_estimator import estimate_context_tokens
            estimated = estimate_context_tokens(
                formatted,
                getattr(self.model, "model_name", ""),
            )
            # 压缩阈值 = 3 类输入内容求和（system+user+assistant）。
            # 不含 tools schema / 消息结构 overhead 等固定开销；旧 completion 已计入
            # assistant 历史消息，新 completion 未生成不计（2026-08-04 重构）。
            current_input_tokens = (
                estimated["system_prompt_token"]
                + estimated["user_prompt_token"]
                + estimated["assistant_prompt_token"]
            )
            current_system_tokens = estimated["system_prompt_token"]
            current_user_tokens = estimated["user_prompt_token"]
            current_assistant_tokens = estimated["assistant_prompt_token"]
            # 记录单次请求上下文占用（用于压缩阈值检测——修复累计请求量 vs 单次窗口的统计口径 bug）
            self._last_context_tokens = current_input_tokens

            # 压缩阈值检测（仅正常执行时检测；压缩摘要生成时 _compacting=True 跳过，防递归触发）
            # 参考 Claude Code autoCompact.ts：tokenCount ≥ 有效窗口 − buffer
            # 触发后复用停止路径：_compaction_triggered + _interrupted=True，由 reply() break，
            # flow_compiler._execute_agent 执行压缩
            if not self._compacting and current_input_tokens >= self.get_auto_compact_threshold():
                threshold = self.get_auto_compact_threshold()
                logger.info(
                    f"[{self.name}] Compaction threshold reached: "
                    f"{current_input_tokens}/{threshold} ({current_input_tokens / self._max_input_tokens:.1%})"
                )
                # 问题 2 修复：本次"工具结果后的重新发送请求"（ReAct 标准行为——工具调用结束后
                # 必须把工具结果重新发送给 LLM 继续推理，工具结果在每次后续请求中重新计入输入 token）
                # 被压缩检测拦截（未调用 LLM），但该请求的输入上下文 token（含工具结果）是真实的
                # 上下文占用，必须记录到 token_usage_history，否则前端显示的 token 严重偏小
                # （例如 stop 消息只记 iter1 的 4.1k，而工具结果 3.5 万字符从未被统计）。
                # 与被拦截请求的输入 token 一并累计，completion=0（未产生输出）。
                self._accumulate_usage(
                    self._accumulated_usage,
                    current_input_tokens, current_output_tokens,
                    current_system_tokens, current_user_tokens, current_assistant_tokens,
                )
                # agent 级整轮累计同步累加（拦截请求的输入 token 属于真实上下文占用）
                self._accumulate_usage(
                    self._agent_accumulated_usage,
                    current_input_tokens, current_output_tokens,
                    current_system_tokens, current_user_tokens, current_assistant_tokens,
                )
                intercepted_iteration = len(self._accumulated_usage["token_usage_history"]) + 1
                intercepted_entry = self._build_history_entry(
                    intercepted_iteration,
                    current_input_tokens, current_output_tokens,
                    current_system_tokens, current_user_tokens, current_assistant_tokens,
                    "compaction_triggered",
                    _iteration_start_time,
                )
                self._accumulated_usage["token_usage_history"].append(intercepted_entry)
                self._agent_accumulated_usage["duration_ms"] += intercepted_entry["duration_ms"]
                self._agent_accumulated_usage["token_usage_history"].append(intercepted_entry)
                self._compaction_triggered = True
                self._interrupted = True
                return None  # 跳过本次模型调用，reply() 循环检测到 _interrupted 后 break

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError()
        if tools:
            logger.info(f"[_reasoning] Calling model with {len(tools)} tools: {[t.get('function', {}).get('name') for t in tools]}")
            model_kwargs = {"tools": tools}
        else:
            logger.info(f"[_reasoning] Calling model without tools")
            model_kwargs = {}
        # 阻塞根因修复（create 阶段）：model 的 `await client.create(...)`（等待响应头）
        # 被 cancel() 的 task.cancel() 中断时抛 CancelledError（openai __call__ 内传播）。
        # 此处捕获并转为用户停止（_interrupted=True + return None），reply 复用停止
        # 路径（保存 stop 消息），不向 flow/run 层传播 CancelledError 破坏保存流程。
        try:
            response = await self.model(formatted, cancel_event=cancel_event, **model_kwargs)
        except asyncio.CancelledError:
            if cancel_event and cancel_event.is_set():
                logger.info(f"[{self.name}] Model call cancelled during request phase (user stop), treating as interrupted")
                self._interrupted = True
                self._last_collected_content = []
                return None
            raise
        
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
            
            try:
                chunk = None
                async for chunk in response:
                    # 检查 cancel_event：用户主动停止时立即中断
                    if cancel_event and cancel_event.is_set():
                        logger.info(f"[{self.name}] Cancel event detected in stream loop at chunk #{chunk_count}, breaking")
                        self._interrupted = True
                        break

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
                                block for block in chunk.content
                                if not (isinstance(block, dict) and block.get("type") == "tool_calls")
                            ]
                            if non_tool_blocks:
                                from collections import defaultdict
                                type_groups = defaultdict(list)
                                for block in non_tool_blocks:
                                    block_type = block.get("type", "text") if isinstance(block, dict) else getattr(block, "type", "text")
                                    type_groups[block_type].append(block)
                                for block_type, blocks in type_groups.items():
                                    single_type_chunk = ChatResponse(content=blocks)
                                    delta = single_type_chunk.to_delta()
                                    if delta:
                                        if self._compacting and block_type == "text":
                                            # 压缩摘要生成中：text 缓冲，不转发给 collector/前端；
                                            # 由 compact() 在 format_compact_summary 后分块流式发射
                                            # 格式化摘要（剥离 <analysis> 草稿区，见 compact()）。
                                            # 这是压缩轮次唯一的特殊操作（摘要需格式化）。
                                            # 思考块等其他块与正常轮次完全一致地直接转发，
                                            # 保证压缩轮次与正常轮次行为完全对齐。
                                            self._compaction_stream_buffer.append(delta)
                                        else:
                                            # 压缩轮次 reasoning 块带 _is_compaction 标记：
                                            # 前端据此将压缩轮的 thought 渲染进「上下文已压缩」气泡
                                            # （与压缩摘要 text 块统一），避免 thought 被当作
                                            # subagent/mainagent 的普通内容显示（问题 1 修复）。
                                            # 注意：原始 block type 为 "thinking"（to_delta 才转
                                            # reasoning_content），两种 type 均需标记。
                                            if self._compacting and isinstance(delta, dict) and bt in ("reasoning_content", "thinking"):
                                                delta = {**delta, "_is_compaction": True}
                                            self.stream_callback(delta, agent_id=self.agent_id, agent_name=self.name,
                                                                 message_id=self._message_id)

                    if hasattr(chunk, "content") and chunk.content:
                        from ..utils.token_estimator import estimate_text_tokens
                        for output_block in chunk.content:
                            if isinstance(output_block, dict):
                                output_text = output_block.get("text") or output_block.get("thinking") or ""
                            else:
                                output_text = getattr(output_block, "text", None) or getattr(output_block, "thinking", None) or ""
                            if output_text:
                                current_output_tokens += estimate_text_tokens(
                                    output_text,
                                    getattr(self.model, "model_name", ""),
                                )

                    await asyncio.sleep(0)

                if hasattr(chunk, 'metadata') and chunk.metadata:
                    collected_metadata = chunk.metadata
                if hasattr(chunk, 'usage') and chunk.usage:
                    # API 返回精确 usage，覆盖外部 token monitor 的估算值
                    # 统一获取函数：在获取端处理无效值，后续只判断 is not None
                    # 原因：统一在获取端处理，后续逻辑简单，避免每次使用都漏判 0 或 None
                    def get_valid_token_value(usage, field):
                        """获取有效的 token 值，无效值（None/0/空）统一转为 None"""
                        val = getattr(usage, field, None)
                        if val is None or val == 0:
                            return None
                        return val
                    
                    collected_usage = chunk.usage
                    llm_input_tokens = get_valid_token_value(chunk.usage, 'input_tokens')
                    llm_output_tokens = get_valid_token_value(chunk.usage, 'output_tokens')

                    # 用 LLM 精确值替换本轮估算值
                    if llm_input_tokens is not None:
                        current_input_tokens = llm_input_tokens
                        # 问题 2 修复：3 类估算归一化到 API 精确 prompt_tokens。
                        # 3 类估算仅统计消息内容（不含 tools schema / 消息结构 overhead /
                        # tokenizer 差异），而 API prompt_tokens 为完整输入；两者求和口径不同，
                        # 导致前端 token 详情 5 字段对不上（sys+user+asst+comp != total）。
                        # 按比例把 3 类估算缩放对齐到 API prompt，使 history entry 内
                        # prompt_tokens == 3 类之和、total == 3 类 + completion，数学完全自洽。
                        _est_sum = current_system_tokens + current_user_tokens + current_assistant_tokens
                        if _est_sum > 0 and current_input_tokens != _est_sum:
                            scale_ratio = current_input_tokens / _est_sum
                            _n_sys = round(current_system_tokens * scale_ratio)
                            _n_user = round(current_user_tokens * scale_ratio)
                            _n_asst = round(current_assistant_tokens * scale_ratio)
                            # 舍入误差归到最大项，保证 3 类之和精确等于 API prompt_tokens
                            rounding_diff = current_input_tokens - (_n_sys + _n_user + _n_asst)
                            if _n_asst >= _n_user:
                                _n_asst += rounding_diff
                            elif _n_user >= _n_sys:
                                _n_user += rounding_diff
                            else:
                                _n_sys += rounding_diff
                            current_system_tokens = _n_sys
                            current_user_tokens = _n_user
                            current_assistant_tokens = _n_asst
                    # 如果 llm_input_tokens 为 None，保留外部估算值
                    
                    if llm_output_tokens is not None:
                        current_output_tokens = llm_output_tokens
                    # 如果 llm_output_tokens 为 None，保留外部逐 chunk 估算值

            except asyncio.CancelledError:
                logger.info(f"[{self.name}] Stream cancelled, treating as normal end")
                if cancel_event and cancel_event.is_set():
                    logger.info(f"[{self.name}] Cancel event is set, marking as interrupted")
                    self._interrupted = True
            except Exception as e:
                if self.model._was_cancelled:
                    logger.info(f"[{self.name}] Stream closed by aclose ({type(e).__name__}), treating as normal end")
                    if cancel_event and cancel_event.is_set():
                        logger.info(f"[{self.name}] Cancel event is set, marking as interrupted")
                        self._interrupted = True
                else:
                    raise
            
            logger.info(f"[ReActCore] Total stream chunks processed: {chunk_count}")

            # 每轮迭代结束时，将本轮的 token 累加到总累加值（B3：唯一累加路径）
            self._accumulate_usage(
                self._accumulated_usage,
                current_input_tokens, current_output_tokens,
                current_system_tokens, current_user_tokens, current_assistant_tokens,
            )
            # agent 级整轮累计同步累加（每次 LLM 调用的真实消耗，含压缩轮全部阶段）
            self._accumulate_usage(
                self._agent_accumulated_usage,
                current_input_tokens, current_output_tokens,
                current_system_tokens, current_user_tokens, current_assistant_tokens,
            )

            # 记录到 token_usage_history（B3：唯一历史记录构造）
            # iteration = 本次 agent 循环内第几次 LLM API 调用（history 长度 + 1），
            # 不用外层 ReAct 循环下标：压缩后 _accumulated_usage 已重置，编号须从 1 重新开始
            iteration_num = len(self._accumulated_usage["token_usage_history"]) + 1
            history_entry = self._build_history_entry(
                iteration_num,
                current_input_tokens, current_output_tokens,
                current_system_tokens, current_user_tokens, current_assistant_tokens,
                collected_finish_reason or "unknown",
                _iteration_start_time,
            )
            self._accumulated_usage["token_usage_history"].append(history_entry)
            self._agent_accumulated_usage["duration_ms"] += history_entry["duration_ms"]
            self._agent_accumulated_usage["token_usage_history"].append(history_entry)

            # 问题 1 修复：迭代结束时推送实时 token 更新（流式过程中的 token 详情数据源）。
            # 每次 LLM 调用完成即向前端推送当前累计 usage，前端据此实时更新该 agent 的
            # 流式块 token（mainagent/subagent 同一路径），无需等待 agent_complete。
            # 该 delta 非消息块（无 content/reasoning/tool_calls），collector 忽略、仅转发前端。
            # 后端聚合改造（3.1-5）：另附 agent_usage = agent 级整轮累计（get_agent_usage），
            # 前端消息头/组头"整轮"显示的数据源（与 usage 的"本阶段"语义正交）。
            if self.stream_callback:
                try:
                    usage_snapshot = {
                        "prompt_tokens": self._accumulated_usage.get("input_tokens", 0),
                        "completion_tokens": self._accumulated_usage.get("output_tokens", 0),
                        "total_tokens": self._accumulated_usage.get("input_tokens", 0)
                        + self._accumulated_usage.get("output_tokens", 0),
                        "system_prompt_token": self._accumulated_usage.get("system_prompt_token", 0),
                        "user_prompt_token": self._accumulated_usage.get("user_prompt_token", 0),
                        "assistant_prompt_token": self._accumulated_usage.get("assistant_prompt_token", 0),
                        "token_usage_history": list(self._accumulated_usage.get("token_usage_history", [])),
                        # 独立快照阶段计数：前端据此识别「新阶段」边界（take 消费清空
                        # 后 phase+1），阶段切换时锁定上一阶段的块级 token（2026-08-05）。
                        "usage_phase": self._usage_phase,
                    }
                    self.stream_callback(
                        {"type": "agent_token_usage", "usage": usage_snapshot,
                         "agent_usage": self.get_agent_usage()},
                        agent_id=self.agent_id,
                        agent_name=self.name,
                        message_id=self._message_id,
                    )
                except Exception as e:
                    logger.debug(f"[ReActCore] Failed to emit token usage update: {e}")

            if collected_finish_reason == "tool_calls":
                self._tool_call_event_manager.end_all_active_tool_calls()
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
            elif final_response is None:
                was_cancelled = getattr(self.model, '_was_cancelled', False)
                if was_cancelled:
                    response = ChatResponse(
                        content=[], usage=None, metadata=None,
                        stop_reason="cancel", finish_reason="cancel",
                    )
                    response.text = ""
                    response.has_tool_calls = False
                else:
                    # LLM 返回空响应兜底：final_response is None 且非取消时构建空响应，
                    # 否则 response = None 会导致后续 response.content 抛 AttributeError
                    error_msg = "LLM 返回空响应"
                    self._last_error = error_msg
                    response = ChatResponse(
                        content=[], usage=None,
                        metadata={"error": error_msg},
                        stop_reason=None, finish_reason=None,
                    )
                    response.text = ""
                    response.has_tool_calls = False
            else:
                response = final_response
        elif self.stream_callback and response.content:
            delta = response.to_delta()
            if delta:
                logger.info(f"[ReActCore] Non-stream delta: {list(delta.keys())}")
                self.stream_callback(delta, agent_id=self.agent_id, agent_name=self.name,
                                     message_id=self._message_id)
        
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
    
    async def _acting(self, response: ChatResponse, cancel_event: asyncio.Event = None) -> List[Msg]:
        tool_calls = self._parse_tool_calls(response)
        
        logger.info(f"[_acting] Parsed {len(tool_calls)} tool calls from response")
        
        if not tool_calls:
            logger.debug("[_acting] No tool calls found, returning empty list")
            return []
        
        self._last_tool_results = []
        
        if len(tool_calls) > 1:
            # 并发执行同轮全部 tool_calls（〇·3 第 1 层）：Anthropic 官方推荐的合法路径
            #（parallel tool use 不规定执行顺序）+ OpenAI Agents SDK 默认行为（asyncio.gather）。
            # 有副作用工具（Write/SearchReplace/RunCommand 操作同一资源）并发存在竞态，
            # 为文档化基线（与 OpenAI SDK 默认一致），不引入工具分类调度分支（3.7）。
            # 取消语义：任一 _execute_single_tool 抛出 CancelledError，gather 直接传播，
            # 由 reply()/外层既有取消处理路径统一收尾。
            results = await asyncio.gather(
                *(self._execute_single_tool(tc, cancel_event) for tc in tool_calls)
            )
            tool_results = []
            for r in results:
                if r:
                    tool_results.extend(r)
        else:
            tool_results = await self._execute_single_tool(tool_calls[0], cancel_event) or []
        
        # 并发结果乱序 → 按 tool_call_id 排序，保持与 LLM 输出顺序一致（模型按 id 匹配）
        tool_results.sort(key=lambda m: (m.tool_call_id or ""))
        self._last_tool_results.sort(key=lambda entry: (entry.get("id") or ""))
        
        logger.info(f"[_acting] Total {len(self._last_tool_results)} tool results recorded")
        return tool_results

    async def _execute_single_tool(self, tool_call: dict, cancel_event: asyncio.Event = None) -> List[Msg]:
        """执行单个工具调用（_acting 并发 gather 的单元，原串行循环体原样迁入）。

        返回该 tool_call 产生的 tool 消息（成功 1 条 / 失败 1 条 / 未执行 0 条）。
        _last_tool_results 在并发下按执行完成顺序 append（乱序），由 _acting 统一按
        tool_call_id 排序恢复与 LLM 输出一致。
        """
        tool_results = []
        # 用户暂停：工具执行前检测 cancel_event，立即中断（减少停止延迟）
        if cancel_event and cancel_event.is_set():
            logger.info(f"[{self.name}] Cancel event detected before tool execution, aborting")
            return tool_results
        logger.info(f"[_acting] Executing tool: {tool_call.get('name')} with args: {tool_call.get('arguments')}")
        if self.tool_executor:
            # 注入当前 tool_call_id（并发工具各自 task context 隔离）：工具内 human_in_the_loop 读取
            # 并据此把回答 Future 注册到 run_context._pending_interactions[call_id]，
            # 并发审批按 id 精确送达，互不覆盖（单槽位覆盖 bug 根治）。
            _tc_token = tool_call_id_var.set(tool_call.get("id"))
            try:
                try:
                    if self._on_tool_executing:
                        await self._on_tool_executing(tool_call)
                except Exception as callback_err:
                    logger.warning(f"on_tool_executing callback error: {callback_err}")

                result = await self.tool_executor.execute(tool_call)

                # 执行后钩子（框架自有机制，工具不反向调用框架）：SoloAgent 桥接
                #（_on_tool_executed）检测到子代理启动声明（result 含 subagent_id + task）时
                # 启动子执行并返回其输出，覆盖工具结果注入 LLM 上下文；无声明返回 None。
                # 子执行的关联由 source_tool_call_id（tc.id）承载：_launch_subagent 将其
                # 传入 _execute_agent → agent_start metadata，保存链路持久化到 task 消息，
                # 回显按 tc.id 精确对号（流式/回显统一，无需 message_id 通道）。
                try:
                    if self._on_tool_executed:
                        hook_result = await self._on_tool_executed(tool_call, result)
                        if hook_result is not None:
                            result = hook_result
                except Exception as callback_err:
                    logger.warning(f"on_tool_executed callback error: {callback_err}")

                result_content = result.get("content", str(result)) if isinstance(result, dict) else str(result)
                
                tool_error = None
                if isinstance(result, dict) and result.get("success") is False:
                    tool_error = result.get("error_message", result.get("content", "Tool execution failed"))
                
                self._tool_call_event_manager.on_tool_call_result(
                    tool_call_id=tool_call.get("id"),
                    result=result,
                    error=tool_error,
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

            except asyncio.CancelledError:
                self._tool_call_event_manager.on_tool_call_result(
                    tool_call_id=tool_call.get("id"),
                    result={"content": "任务执行被取消", "success": False, "error_message": "执行被用户取消"},
                    error="cancelled",
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
                    error=error_str,
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
            finally:
                tool_call_id_var.reset(_tc_token)
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
                        self.stream_callback({"content": "\n\n[继续输出...]\n\n"}, agent_id=self.agent_id,
                                             agent_name=self.name, message_id=self._message_id)
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
        sentences = re.split(r'[.!?。！？]+', text)
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
    
    def get_conversation_history(self) -> List[Msg]:
        return self._conversation_history.copy()
