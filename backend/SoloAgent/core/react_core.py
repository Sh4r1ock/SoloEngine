# -*- coding: utf-8 -*-
"""
ReAct 核心微内核模块。

@file react_core.py
@description 实现 ReAct（Reasoning + Acting）架构的核心微内核
@author SoloEngine Team
@date 2026-02-20

功能描述：
- 实现推理-行动循环的核心逻辑
- 支持多轮迭代直到任务完成
- 自动检测任务完成条件（支持多模型 API）
- 集成记忆、RAG、工具执行等插件

ReAct 架构说明：
    ReAct 是一种将推理（Reasoning）和行动（Acting）交替进行的 Agent 架构。
    每轮迭代包含：
    1. Thought（思考）：分析当前状态，决定下一步行动
    2. Action（行动）：执行工具调用或生成回复
    3. Observation（观察）：获取行动结果，更新状态

多模型任务完成检测：
    不同模型使用不同的 API 字段表示任务完成：
    - Claude: stop_reason = "end_turn" (完成) / "tool_use" (工具调用)
    - OpenAI/GLM/DeepSeek: finish_reason = "stop" (完成) / "tool_calls" (工具调用)
    
    本模块统一处理这些差异，提供一致的任务完成检测接口。

设计理念：
    - 微内核架构：核心只负责控制流，功能通过插件接口扩展
    - 单一职责：核心不包含具体业务逻辑，只协调各组件
    - 可测试性：通过依赖注入实现松耦合，便于单元测试

使用场景：
    - 对话型 Agent 的核心引擎
    - 任务执行型 Agent 的控制中心
    - 多 Agent 系统的单个 Agent 实例

状态: ✅ 完整实现
"""

import asyncio
import json
import re
import logging
from typing import Optional, List, Any, Union, Dict
from enum import Enum

from ..message import Msg, ToolUseBlock, ToolResultBlock, TextBlock
from ..model import ChatModelBase, ChatResponse
from ..formatter import FormatterBase
from .interfaces import IMemory, IRAG, IToolExecutor

logger = logging.getLogger(__name__)


class CompletionReason(Enum):
    """
    任务完成原因枚举。
    
    定义 Agent 任务结束的各种原因，用于分析和调试。
    
    Attributes:
        TASK_COMPLETED: 任务正常完成，模型返回了最终答案
        MAX_ITERATIONS: 达到最大迭代次数限制，强制终止
        USER_SATISFIED: 用户表示满意，任务完成
        NO_MORE_ACTIONS: 没有更多行动可执行，自然终止
        ERROR_ENCOUNTERED: 遇到无法恢复的错误
        TOOL_CALL: 模型请求工具调用
    """
    TASK_COMPLETED = "task_completed"
    MAX_ITERATIONS = "max_iterations"
    USER_SATISFIED = "user_satisfied"
    NO_MORE_ACTIONS = "no_more_actions"
    ERROR_ENCOUNTERED = "error_encountered"
    TOOL_CALL = "tool_call"


class StopReason(Enum):
    """
    多模型停止原因枚举。
    
    统一不同模型的停止原因表示：
    - Claude: stop_reason 字段
    - OpenAI/GLM/DeepSeek: finish_reason 字段
    
    Attributes:
        END_TURN: 任务完成，模型返回最终答案
        TOOL_USE: 模型请求工具调用
        MAX_TOKENS: 达到最大 token 限制
        STOP_SEQUENCE: 遇到停止序列
        UNKNOWN: 未知原因
    """
    END_TURN = "end_turn"
    TOOL_USE = "tool_use"
    MAX_TOKENS = "max_tokens"
    STOP_SEQUENCE = "stop_sequence"
    UNKNOWN = "unknown"
    
    @classmethod
    def from_api_response(cls, response: ChatResponse) -> "StopReason":
        """
        从 API 响应中解析停止原因。
        
        支持多种模型的响应格式：
        - Claude: response.stop_reason
        - OpenAI/GLM/DeepSeek: response.finish_reason
        
        Args:
            response: LLM API 响应对象。
        
        Returns:
            StopReason: 统一的停止原因枚举值。
        """
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
    """工具调用事件类型"""
    TOOL_CALL_START = "TOOL_CALL_START"
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
    TOOL_CALL_END = "TOOL_CALL_END"
    TOOL_CALL_RESULT = "TOOL_CALL_RESULT"


class ToolCallEventManager:
    """
    工具调用事件管理器。
    
    负责管理工具调用的四事件生命周期，并将内部事件转换为前端格式。
    
    事件流程：
    1. TOOL_CALL_START：首次检测到新的工具调用 ID
    2. TOOL_CALL_ARGS：增量传输参数（可能多次）
    3. TOOL_CALL_END：参数传输完成
    4. TOOL_CALL_RESULT：工具执行结果返回
    
    前端格式：
    所有事件都转换为 {type: "tool_calls", tool_calls: [...]} 格式，
    通过 stream callback 发送，最终包装为 {type: "stream", delta: {...}}。
    """
    
    def __init__(self, stream_callback=None, agent_id: str = None, agent_name: str = None):
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
        """
        将内部事件转换为前端格式。
        
        返回格式：{type: "tool_calls", tool_calls: [...]}
        """
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
            result_data = {
                "id": tool_call_id,
                "result": event["result"]
            }
            if event.get("error"):
                result_data["error"] = event["error"]
            return {
                "type": "tool_calls",
                "tool_calls": [result_data]
            }
        
        return None


class ReActCore:
    """
    ReAct 微内核 - 纯控制流实现，通过插件接口扩展功能。
    
    这是 SoloEngine 的核心组件，实现了 ReAct（推理-行动）架构。
    核心只负责控制流，所有具体功能通过插件接口注入。
    
    核心流程：
        1. 接收用户消息
        2. 从记忆和 RAG 检索相关上下文
        3. 进入推理-行动循环：
           a. 调用 LLM 进行推理
           b. 检查 API 返回的停止原因（支持多模型）
           c. 执行工具调用（如果有）
           d. 检查是否达到完成条件
        4. 返回最终响应
    
    插件依赖：
        - model: LLM 模型实例（必需）
        - formatter: 消息格式化器（必需）
        - memory: 记忆插件（可选，用于上下文检索）
        - rag: RAG 插件（可选，用于知识检索）
        - tool_executor: 工具执行器（可选，用于工具调用）
    
    多模型支持：
        自动检测不同模型的停止原因：
        - Claude: stop_reason = "end_turn" / "tool_use"
        - OpenAI/GLM/DeepSeek: finish_reason = "stop" / "tool_calls"
    
    Example:
        >>> from SoloAgent.model import OpenAIChatModel
        >>> from SoloAgent.formatter import OpenAIChatFormatter
        >>> 
        >>> model = OpenAIChatModel(model_name="gpt-4")
        >>> formatter = OpenAIChatFormatter()
        >>> 
        >>> core = ReActCore(
        ...     name="assistant",
        ...     model=model,
        ...     formatter=formatter,
        ...     system_prompt="你是一个有帮助的助手。",
        ...     max_iters=10,
        ... )
        >>> 
        >>> response = await core.reply("请帮我分析这段代码")
        >>> print(response.get_text_content())
    
    Note:
        - 核心是无状态的，状态通过 conversation_history 维护
        - 每次调用 reply 会重置迭代计数
        - 最大迭代次数防止无限循环
    """
    
    def __init__(
        self,
        name: str,
        model: ChatModelBase,
        formatter: FormatterBase,
        system_prompt: str,
        rag: Optional[IRAG] = None,
        tool_executor: Optional[IToolExecutor] = None,
        max_iters: int = 10,
        print_hint_msg: bool = False,
        stream_callback: Optional[callable] = None,
        agent_id: Optional[str] = None,
    ) -> None:
        """
        初始化 ReAct 核心微内核。
        
        Args:
            name (str): Agent 名称，用于标识和日志。
            model (ChatModelBase): LLM 模型实例，用于推理。
                支持所有继承自 ChatModelBase 的模型。
            formatter (FormatterBase): 消息格式化器，将 Msg 对象
                转换为模型 API 所需的格式。
            system_prompt (str): 系统提示词，定义 Agent 的角色和行为。
            memory (IMemory, optional): 记忆插件实例。如果提供，
                会从记忆中检索相关上下文。默认为 None。
            rag (IRAG, optional): RAG 插件实例。如果提供，
                会从知识库中检索相关文档。默认为 None。
            tool_executor (IToolExecutor, optional): 工具执行器实例。
                如果提供，Agent 可以调用工具。默认为 None。
            max_iters (int, optional): 最大迭代次数。防止无限循环。
                默认为 10。
            print_hint_msg (bool, optional): 是否打印调试信息。
                默认为 False。
            stream_callback (callable, optional): 流式输出回调函数。
                默认为 None。
            agent_id (str, optional): Agent ID，用于多Agent场景区分。
                默认为 None，会使用 name 作为 ID。
        
        Note:
            - model 和 formatter 是必需的
            - 插件参数都是可选的，按需注入
            - max_iters 应根据任务复杂度调整
            - 任务完成检测通过 API 响应的 stop_reason/finish_reason 自动判断
        """
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
        self._interrupted: bool = False
        
        # 新增：初始化工具调用事件管理器
        self._tool_call_event_manager = ToolCallEventManager(
            stream_callback=self.stream_callback,
            agent_id=self.agent_id,
            agent_name=self.name
        )
    
    def load_history(self, messages: List[Msg]) -> None:
        """
        加载历史消息到对话历史。
        
        Args:
            messages (List[Msg]): 历史消息列表。
        """
        self._conversation_history = messages.copy()
    
    def interrupt(self) -> None:
        """
        中断当前正在进行的模型输出。
        
        调用此方法后，流式输出会立即停止，API 不再发送请求。
        这是一个真实的中断，不会消耗额外的 token。
        
        Example:
            >>> # 在另一个线程中调用
            >>> core.interrupt()
        """
        self._interrupted = True
        logger.info(f"[{self.name}] Interrupt requested")
    
    def is_interrupted(self) -> bool:
        """
        检查是否已被中断。
        
        Returns:
            bool: 如果已被中断返回 True，否则返回 False。
        """
        return self._interrupted
    
    def reset_interrupt(self) -> None:
        """
        重置中断标志。
        
        在开始新的对话时自动调用。
        """
        self._interrupted = False
        
    async def reply(self, message: str | Msg, cancel_event: asyncio.Event = None) -> Msg:
        """
        处理用户消息并生成回复。
        
        这是 ReAct 核心的主入口方法，实现了完整的推理-行动循环：
        1. 将用户消息添加到对话历史
        2. 从记忆和 RAG 中检索相关上下文
        3. 执行多轮推理-行动迭代，直到任务完成或达到最大迭代次数
        4. 返回最终响应
        
        Args:
            message (str | Msg): 用户输入消息，可以是字符串或 Msg 对象。
                如果是字符串，会自动转换为 Msg 对象。
        
        Returns:
            Msg: Agent 的响应消息，包含回复内容和元数据。
        
        Example:
            >>> response = await core.reply("请帮我分析这段代码")
            >>> print(response.get_text_content())
        
        Note:
            - 每次调用会重置迭代计数
            - 对话历史会累积，直到调用 clear_history
            - 返回的消息角色为 "assistant"
        """
        if isinstance(message, str):
            user_msg = Msg(name="user", content=message, role="user")
        else:
            user_msg = message
        
        self._conversation_history.append(user_msg)
        self._iteration_count = 0
        self._last_tool_results = []
        self._interrupted = False  # 重置中断标志
        
        # 新增：重置工具调用事件管理器
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
            # 每轮迭代开始时重置工具调用事件管理器
            self._tool_call_event_manager.reset()
            
            if self._interrupted:
                logger.info(f"[{self.name}] Execution interrupted by user at iteration {iteration}")
                break
            
            if cancel_event and cancel_event.is_set():
                logger.info(f"[{self.name}] Cancel event detected at iteration {iteration}")
                break
            
            self._iteration_count = iteration + 1
            
            reasoning_result = await self._reasoning(
                user_msg, 
                full_system_prompt,
                iteration,
                cancel_event
            )
            
            completion_check = self._check_completion(reasoning_result, iteration)
            
            # 处理断点续传
            if completion_check.get("auto_continue"):
                # 将当前的部分输出添加到对话历史，然后继续
                partial_text = self._extract_text(reasoning_result)
                if partial_text.strip():
                    # 累积输出
                    self._accumulated_text += partial_text
                    partial_msg = Msg(
                        name=self.name,
                        content=partial_text,
                        role="assistant"
                    )
                    self._conversation_history.append(partial_msg)
                    # 添加继续提示
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
                    completion_reason
                )
                response_msg = Msg(
                    name=self.name,
                    content=final_response,
                    role="assistant",
                    metadata=getattr(reasoning_result, 'metadata', None)
                )
                self._conversation_history.append(response_msg)
                
                return response_msg
            
            # 检查是否有tool_calls
            # 优先使用 ToolCallEventManager 判断，其次检查 finish_reason
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
                # 从ChatResponse的content创建Msg，并传递metadata
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
                # _last_tool_results 已经在 _execute_tool_calls 中设置，不需要再覆盖
            else:
                if self._has_explicit_answer(reasoning_result):
                    completion_reason = CompletionReason.NO_MORE_ACTIONS
                    final_response = await self._generate_final_response(
                        reasoning_result,
                        full_system_prompt,
                        completion_reason
                    )
                    response_msg = Msg(
                        name=self.name,
                        content=final_response,
                        role="assistant",
                        metadata=getattr(reasoning_result, 'metadata', None)
                    )
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
            content=final_response,
            role="assistant",
            metadata=getattr(reasoning_result, 'metadata', None)
        )
        self._conversation_history.append(response_msg)
        
        return response_msg
    
    async def _reasoning(
        self,
        user_msg: Msg,
        system_prompt: str,
        iteration: int,
        cancel_event: asyncio.Event = None
    ) -> ChatResponse:
        """
        执行推理步骤。
        
        调用 LLM 进行推理，生成下一步的思考或行动。
        这是 ReAct 循环中的 "Thought" 阶段。
        
        Args:
            user_msg (Msg): 原始用户消息。
            system_prompt (str): 完整的系统提示词（包含上下文）。
            iteration (int): 当前迭代次数（从 0 开始）。
        
        Returns:
            ChatResponse: LLM 的响应，包含推理结果。
        
        Note:
            - 只保留最近 10 条消息作为上下文
            - 如果启用 print_hint_msg，会打印推理摘要
            - 如果有工具执行器，会传递工具 schema 给模型
        """
        messages = [
            Msg(name="system", content=system_prompt, role="system"),
            *self._conversation_history[-10:],
        ]
        
        formatted = await self.formatter.format(messages)
        
        tools = None
        if self.tool_executor and hasattr(self.tool_executor, 'get_available_tools'):
            tools = self.tool_executor.get_available_tools()
        
        if tools:
            logger.info(f"[_reasoning] Calling model with {len(tools)} tools: {[t.get('function', {}).get('name') for t in tools]}")
            response = await self.model(formatted, tools=tools, cancel_event=cancel_event)
        else:
            logger.info(f"[_reasoning] Calling model without tools")
            response = await self.model(formatted, cancel_event=cancel_event)
        
        # 处理流式响应 - 必须先消费生成器
        if hasattr(response, '__aiter__'):
            # 流式响应：逐个chunk处理并收集
            final_response = None
            chunk_count = 0
            # 收集所有的内容块，合并到完整响应
            collected_content = []
            collected_stop_reason = None
            collected_finish_reason = None
            collected_metadata = None
            collected_usage = None
            
            async for chunk in response:
                if self._interrupted:
                    logger.info(f"[{self.name}] Stream interrupted by user at chunk #{chunk_count}")
                    break
                
                if cancel_event and cancel_event.is_set():
                    logger.info(f"[{self.name}] Stream cancelled at chunk #{chunk_count}")
                    break
                
                chunk_count += 1
                final_response = chunk
                
                # Debug: 打印每个 chunk 的 stop_reason
                if chunk.stop_reason:
                    logger.info(f"[_reasoning] Chunk #{chunk_count} stop_reason={chunk.stop_reason}")
                    collected_stop_reason = chunk.stop_reason
                if chunk.finish_reason:
                    logger.info(f"[_reasoning] Chunk #{chunk_count} finish_reason={chunk.finish_reason}")
                    collected_finish_reason = chunk.finish_reason
                
                # 收集内容块 - 区分增量块和完整块
                if hasattr(chunk, 'content') and chunk.content:
                    for block in chunk.content:
                        # 支持 dict 和 dataclass/TypedDict 对象
                        if isinstance(block, dict):
                            block_type = block.get("type")
                        elif hasattr(block, "__getitem__"):
                            # TypedDict 支持字典式访问
                            try:
                                block_type = block["type"] if "type" in block else None
                            except (KeyError, TypeError):
                                block_type = None
                        else:
                            block_type = None
                        
                        if block_type == "tool_use":
                            # 完整工具调用块（非流式响应或 Claude 格式）
                            # 流式响应中 Model 层不再输出此块，由 ReActCore 从增量构建
                            tool_id = block.get("id") if isinstance(block, dict) else getattr(block, "id", None)
                            if tool_id:
                                input_data = block.get("input", {}) if isinstance(block, dict) else getattr(block, "input", {})
                                if isinstance(input_data, str):
                                    try:
                                        input_data = json.loads(input_data) if input_data.strip() else {}
                                    except json.JSONDecodeError:
                                        logger.warning(f"Failed to parse tool_use input: {input_data[:100]}...")
                                        input_data = {}
                                
                                tool_name = block.get("name", "") if isinstance(block, dict) else getattr(block, "name", "")
                                
                                # 通知 ToolCallEventManager（用于前端实时显示）
                                self._tool_call_event_manager.on_tool_call_start(
                                    tool_call_id=tool_id,
                                    tool_name=tool_name
                                )
                                args_str = json.dumps(input_data, ensure_ascii=False) if input_data else "{}"
                                self._tool_call_event_manager.on_tool_call_args(
                                    tool_call_id=tool_id,
                                    delta=args_str
                                )
                                self._tool_call_event_manager.on_tool_call_end(tool_id)
                                
                                block_dict = {
                                    "type": "tool_use",
                                    "id": tool_id,
                                    "name": tool_name,
                                    "input": input_data
                                }
                                collected_content.append(block_dict)
                            else:
                                pass
                        elif block_type == "tool_calls":
                            # 增量工具调用块（OpenAI 流式格式）- 触发四事件
                            for tool_call_data in block.get("tool_calls", []):
                                tool_id = tool_call_data.get("id")
                                tool_index = tool_call_data.get("index")
                                func = tool_call_data.get("function", {})
                                
                                logger.info(f"[ReActCore] Received tool_calls block: id={tool_id}, index={tool_index}, func={func}")
                                
                                # 关键修复：确定实际的工具调用 ID
                                # OpenAI 流式响应中，后续 delta 的 id 可能为 None，需要通过 index 匹配
                                actual_tool_id = tool_id
                                
                                if not actual_tool_id and tool_index is not None:
                                    # id 为 None，通过 index 匹配已存在的工具调用
                                    active_calls = self._tool_call_event_manager.get_active_tool_calls()
                                    active_ids = list(active_calls.keys())
                                    if tool_index < len(active_ids):
                                        actual_tool_id = active_ids[tool_index]
                                        logger.info(f"[ReActCore] Matched tool call by index: {tool_index} -> {actual_tool_id}")
                                
                                if not actual_tool_id:
                                    # 无法确定工具调用 ID，跳过
                                    logger.warning(f"[ReActCore] Cannot determine tool_call_id, skipping: index={tool_index}")
                                    continue
                                
                                # TOOL_CALL_START: 检测到新的工具调用
                                if actual_tool_id not in self._tool_call_event_manager.get_active_tool_calls():
                                    self._tool_call_event_manager.on_tool_call_start(
                                        tool_call_id=actual_tool_id,
                                        tool_name=func.get("name", "")
                                    )
                                    logger.info(f"[ReActCore] TOOL_CALL_START: {actual_tool_id}, name={func.get('name')}")
                                
                                # TOOL_CALL_ARGS: 发送参数增量
                                delta_args = func.get("arguments", "")
                                if delta_args:
                                    self._tool_call_event_manager.on_tool_call_args(
                                        tool_call_id=actual_tool_id,
                                        delta=delta_args
                                    )
                                    logger.info(f"[ReActCore] TOOL_CALL_ARGS: {actual_tool_id}, delta={delta_args[:50]}...")
                                else:
                                    logger.info(f"[ReActCore] TOOL_CALL_ARGS skipped: delta_args is empty or None")
                            # 不收集到 collected_content，由 ToolCallEventManager 管理
                        else:
                            collected_content.append(block)
                
                # 收集 metadata 和 usage
                if hasattr(chunk, 'metadata') and chunk.metadata:
                    collected_metadata = chunk.metadata
                if hasattr(chunk, 'usage') and chunk.usage:
                    collected_usage = chunk.usage
                
                # 使用 to_delta() 方法转换为 OpenAI 标准格式
                # 但过滤掉已被 ToolCallEventManager 处理的 tool_use 块
                if self.stream_callback and chunk.content:
                    # 过滤掉 tool_use 和 tool_calls 块（由 ToolCallEventManager 处理）
                    filtered_content = [
                        block for block in chunk.content
                        if not (isinstance(block, dict) and block.get("type") in ("tool_use", "tool_calls"))
                    ]
                    if filtered_content:
                        # 避免将模型最终组装的完整块作为 delta 发送，否则会导致前端重复显示
                        is_final_assembled = hasattr(chunk, 'metadata') and chunk.metadata and 'original_model_message' in chunk.metadata
                        if not is_final_assembled:
                            from collections import defaultdict
                            type_groups = defaultdict(list)
                            for block in filtered_content:
                                if isinstance(block, dict):
                                    block_type = block.get("type", "text")
                                else:
                                    block_type = getattr(block, "type", "text")
                                type_groups[block_type].append(block)
                            
                            for block_type, blocks in type_groups.items():
                                single_type_chunk = ChatResponse(content=blocks)
                                delta = single_type_chunk.to_delta()
                                if delta:
                                    logger.info(f"[ReActCore] Chunk #{chunk_count} sending delta with type: {block_type}")
                                    self.stream_callback(delta, agent_id=self.agent_id, agent_name=self.name)
            
            logger.info(f"[ReActCore] Total stream chunks processed: {chunk_count}")
            
            # finish_reason 处理：结束所有活跃的工具调用
            if collected_finish_reason == "tool_calls":
                self._tool_call_event_manager.end_all_active_tool_calls()
                logger.info(f"[ReActCore] finish_reason=tool_calls, ended all active tool calls")
            
            logger.info(f"[ReActCore] collected_content types before tool_use merge: {[block.get('type') if isinstance(block, dict) else type(block).__name__ for block in collected_content]}")
            
            # 从 ToolCallEventManager 获取完整的工具调用信息，构建 ToolUseBlock
            # 这是四事件方案的核心：Model 层只发增量，ReActCore 从 ToolCallEventManager 构建 ToolUseBlock
            active_tool_calls = self._tool_call_event_manager.get_active_tool_calls()
            if active_tool_calls:
                existing_tool_ids = set()
                for block in collected_content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        existing_tool_ids.add(block.get("id"))
                
                for tool_id, tool_call in active_tool_calls.items():
                    if tool_id not in existing_tool_ids:
                        try:
                            arguments = json.loads(tool_call.get("arguments", "{}")) if tool_call.get("arguments", "").strip() else {}
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse arguments for tool {tool_call.get('name')}: {tool_call.get('arguments', '')[:100]}...")
                            arguments = {}
                        
                        tool_use_block = {
                            "type": "tool_use",
                            "id": tool_id,
                            "name": tool_call.get("name", ""),
                            "input": arguments
                        }
                        collected_content.append(tool_use_block)
                        logger.info(f"[ReActCore] Built ToolUseBlock from ToolCallEventManager: {tool_id}")
            
            logger.info(f"[ReActCore] Final collected_content types: {[block.get('type') if isinstance(block, dict) else type(block).__name__ for block in collected_content]}")
            
            # 构建完整的响应
            if final_response and collected_content:
                # 从 final_response 创建新的完整响应
                response = ChatResponse(
                    content=collected_content,
                    usage=collected_usage or getattr(final_response, 'usage', None),
                    metadata=collected_metadata or getattr(final_response, 'metadata', None),
                    stop_reason=collected_stop_reason or getattr(final_response, 'stop_reason', None),
                    finish_reason=collected_finish_reason or getattr(final_response, 'finish_reason', None),
                )
                logger.info(f"[ReActCore] Built complete response with {len(collected_content)} content blocks")
            else:
                response = final_response
        elif self.stream_callback and response.content:
            delta = response.to_delta()
            if delta:
                logger.info(f"[ReActCore] Non-stream delta: {list(delta.keys())}")
                self.stream_callback(delta, agent_id=self.agent_id, agent_name=self.name)
        
        if self.print_hint_msg:
            reasoning_text = ""
            tool_calls_info = []
            for block in response.content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        reasoning_text += block.get("text", "")
                    elif block.get("type") == "tool_use":
                        tool_calls_info.append(f"{block.get('name')}({block.get('input', {})})")
            
            if tool_calls_info:
                print(f"[Iteration {iteration}] Tool calls: {tool_calls_info}")
            else:
                print(f"[Iteration {iteration}] Reasoning: {reasoning_text[:100]}...")
        
        return response
    
    async def _acting(self, response: ChatResponse) -> List[Msg]:
        """
        执行行动步骤。
        
        解析 LLM 响应中的工具调用，并执行这些工具。
        这是 ReAct 循环中的 "Action" 阶段。
        
        Args:
            response (ChatResponse): LLM 的推理响应。
        
        Returns:
            List[Msg]: 工具调用结果消息列表。
                如果没有工具调用，返回空列表。
        
        Note:
            - 工具调用错误会被捕获并作为错误消息返回
            - 每个工具结果都会添加到对话历史
        """
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
                    result = await self.tool_executor.execute(tool_call)
                    result_content = result.get("content", str(result)) if isinstance(result, dict) else str(result)
                    
                    # 使用 ToolCallEventManager 发送 TOOL_CALL_RESULT
                    self._tool_call_event_manager.on_tool_call_result(
                        tool_call_id=tool_call.get("id"),
                        result=result_content
                    )
                    
                    tool_result_block = {
                        "type": "tool_result",
                        "id": tool_call.get("id"),
                        "name": tool_call.get("name"),
                        "output": result_content if isinstance(result_content, str) else str(result_content)
                    }
                    
                    result_msg = Msg(
                        name="tool",
                        content=[tool_result_block],
                        role="tool"
                    )
                    tool_results.append(result_msg)
                    
                    self._last_tool_results.append({
                        "name": tool_call.get("name"),
                        "args": tool_call.get("arguments", {}),
                        "result": result_content,
                        "full_result": result,
                    })
                    logger.info(f"[_acting] Tool {tool_call.get('name')} executed successfully, result length: {len(str(result_content))}")
                except Exception as e:
                    # 使用 ToolCallEventManager 发送 TOOL_CALL_RESULT（带错误）
                    self._tool_call_event_manager.on_tool_call_result(
                        tool_call_id=tool_call.get("id"),
                        result=f"Error: {str(e)}",
                        error=str(e)
                    )
                    
                    error_result_block = {
                        "type": "tool_result",
                        "id": tool_call.get("id"),
                        "name": tool_call.get("name"),
                        "output": str(e)
                    }
                    
                    error_msg = Msg(
                        name="tool_error",
                        content=[error_result_block],
                        role="tool"
                    )
                    tool_results.append(error_msg)
                    
                    self._last_tool_results.append({
                        "name": tool_call.get("name"),
                        "args": tool_call.get("arguments", {}),
                        "error": str(e)
                    })
                    logger.error(f"[_acting] Tool {tool_call.get('name')} execution failed: {e}")
        
        logger.info(f"[_acting] Total {len(self._last_tool_results)} tool results recorded")
        return tool_results
    
    def _parse_tool_calls(self, response: ChatResponse) -> List[dict]:
        """
        从 LLM 响应中解析工具调用。
        
        优先使用 ToolCallEventManager 中累积的数据，
        回退到从响应内容中解析（兼容非流式响应)。
        
        Args:
            response (ChatResponse): LLM 响应对象。
        
        Returns:
            List[dict]: 工具调用列表，每个调用包含：
                - id: 调用 ID
                - name: 工具名称
                - arguments: 工具参数（字典）
        """
        tool_calls = []
        
        # 优先使用 ToolCallEventManager 中累积的数据
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
        
        # 回退：从响应内容中解析（兼容非流式响应和 tool_use 块)
        merged_tool_calls = {}
        
        for block in response.content:
            if isinstance(block, dict):
                block_type = block.get("type")
                
                if block_type == "tool_use":
                    tool_id = block.get("id")
                    if tool_id:
                        tool_calls.append({
                            "id": tool_id,
                            "name": block.get("name"),
                            "arguments": block.get("input", {})
                        })
        
        if tool_calls:
            logger.info(f"[_parse_tool_calls] Parsed {len(tool_calls)} tool calls from response content")
        
        return tool_calls
    
    def _check_completion(self, response: Union[ChatResponse, str], iteration: int) -> dict:
        """
        检查任务是否完成。
        
        通过 API 响应的停止原因判断是否应该结束推理-行动循环。
        支持多种模型的响应格式：
        - Claude: stop_reason = "end_turn" / "tool_use"
        - OpenAI/GLM/DeepSeek: finish_reason = "stop" / "tool_calls"
        
        Args:
            response (ChatResponse | str): LLM 响应或文本。
            iteration (int): 当前迭代次数。
        
        Returns:
            dict: 检查结果，包含：
                - should_complete (bool): 是否应该结束
                - reason (CompletionReason): 结束原因
        """
        if isinstance(response, ChatResponse):
            # Debug logging
            stop_reason_raw = getattr(response, 'stop_reason', None)
            finish_reason_raw = getattr(response, 'finish_reason', None)
            logger.info(f"[_check_completion] stop_reason={stop_reason_raw}, finish_reason={finish_reason_raw}")
            
            # 优先检查是否有 tool_use 块
            # 这是关键修复：无论stop_reason是什么，只要有tool_use块就返回TOOL_CALL
            has_tool_calls = any(
                isinstance(block, dict) and block.get("type") == "tool_use"
                for block in response.content
            )
            logger.info(f"[_check_completion] has_tool_calls={has_tool_calls}")
            
            if has_tool_calls:
                logger.info(f"[_check_completion] Found tool_use blocks, returning TOOL_CALL")
                return {"should_complete": False, "reason": CompletionReason.TOOL_CALL}
            
            # 然后检查stop_reason
            stop_reason = StopReason.from_api_response(response)
            logger.info(f"[_check_completion] parsed stop_reason={stop_reason}")
            with open('debug_completion.log', 'a', encoding='utf-8') as f:
                f.write(f"Iteration: {iteration}\n")
                f.write(f"has_tool_calls: {has_tool_calls}\n")
                f.write(f"response.finish_reason: {getattr(response, 'finish_reason', None)}\n")
                f.write(f"response.stop_reason: {getattr(response, 'stop_reason', None)}\n")
                f.write(f"stop_reason enum: {stop_reason}\n")
                f.write("-" * 50 + "\n")
            
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
            
            reasoning_text = self._extract_text(response)
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
        """
        判断文本是否看起来像最终答案。
        
        通过启发式规则判断：
        - 短文本（1-2 句话）可能是直接回答
        - 以 yes/no 开头的简短回答
        - 包含 "is/are/was/were + 数字" 的陈述句
        
        Args:
            text (str): 待判断的文本。
        
        Returns:
            bool: 是否像最终答案。
        """
        sentences = re.split(r'[.!?]+', text)
        if len(sentences) <= 2:
            return True
        
        if re.search(r'^\s*(yes|no|correct|incorrect)\s*[,.]', text.lower()):
            return True
        
        if re.search(r'\b(is|are|was|were)\s+\d+', text.lower()):
            return True
        
        return False
    
    def _has_explicit_answer(self, response: Union[ChatResponse, str]) -> bool:
        """
        检查响应是否包含显式答案。
        
        当没有工具调用但输出包含答案格式时，
        认为任务已完成。
        
        Args:
            response (ChatResponse | str): LLM 响应。
        
        Returns:
            bool: 是否包含显式答案。
        """
        text = self._extract_text(response)
        
        if re.search(r'(answer|result|output)\s*(is|:)\s*', text.lower()):
            return True
        
        if re.search(r'^\s*[\d\w]+\.?\s*$', text.strip()):
            return True
        
        return False
    
    def _extract_text(self, response: Union[ChatResponse, str]) -> str:
        """
        从响应中提取纯文本。
        
        处理 ChatResponse 对象和字符串两种输入类型。
        
        Args:
            response (ChatResponse | str): LLM 响应或字符串。
        
        Returns:
            str: 提取的纯文本内容。
        """
        if isinstance(response, ChatResponse):
            text = ""
            for block in response.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text += block.get("text", "")
            return text
        return response
    
    async def _generate_final_response(
        self,
        response: Union[ChatResponse, str],
        system_prompt: str,
        completion_reason: Optional[CompletionReason] = None
    ) -> str:
        """
        生成最终响应。
        
        从推理结果中提取或生成最终答案。
        
        处理逻辑：
            1. 尝试提取显式的最终答案
            2. 如果提取失败，截取推理文本前 500 字符
            3. 如果没有推理文本，返回默认消息
        
        Args:
            response (ChatResponse | str): 推理结果。
            system_prompt (str): 系统提示词（未使用，保留扩展）。
            completion_reason (CompletionReason, optional): 完成原因。
        
        Returns:
            str: 最终响应文本。
        """
        reasoning_text = self._extract_text(response)
        
        # 如果有累积的文本，优先使用
        if self._accumulated_text:
            final_text = self._accumulated_text + reasoning_text
            self._accumulated_text = ""  # 重置累积文本
            if len(final_text) > 500:
                return final_text[:500] + "..."
            return final_text
        
        if reasoning_text:
            final_answer = self._extract_final_answer(reasoning_text)
            if final_answer:
                return final_answer
            
            if len(reasoning_text) > 500:
                return reasoning_text[:500] + "..."
            return reasoning_text
        
        return "Final response generated."
    
    def _extract_final_answer(self, text: str) -> Optional[str]:
        """
        从推理文本中提取最终答案。
        
        使用正则表达式匹配常见的答案格式：
        - "final answer: ..."
        - "conclusion: ..."
        - "therefore, ..."
        
        Args:
            text (str): 推理文本。
        
        Returns:
            Optional[str]: 提取的答案，如果未找到返回 None。
        """
        patterns = [
            r'(?:final answer|answer|result)[:\s]+(.+?)(?:\n\n|\n[A-Z]|$)',
            r'(?:conclusion|summary)[:\s]+(.+?)(?:\n\n|\n[A-Z]|$)',
            r'(?:therefore|thus|hence|so)[,\s]+(.+?)(?:\n\n|\n[A-Z]|\.$|$)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
            if match:
                answer = match.group(1).strip()
                if len(answer) > 10:
                    return answer
        
        return None
    
    async def clear_history(self) -> None:
        """
        清空对话历史。
        
        重置所有内部状态，包括：
        - 对话历史
        - 迭代计数
        - 工具调用结果
        
        Warning:
            此操作不可逆，所有对话上下文将丢失。
        """
        self._conversation_history.clear()
        self._iteration_count = 0
        self._last_tool_results = []
    
    def get_iteration_count(self) -> int:
        """
        获取当前迭代次数。
        
        Returns:
            int: 当前迭代次数（从 1 开始）。
        """
        return self._iteration_count
    
    def get_conversation_history(self) -> List[Msg]:
        """
        获取对话历史的副本。
        
        Returns:
            List[Msg]: 对话历史消息列表的副本。
        """
        return self._conversation_history.copy()
    
    def get_last_tool_results(self) -> List[Dict[str, Any]]:
        """
        获取最近一次的工具调用结果。
        
        Returns:
            List[Dict[str, Any]]: 工具调用结果列表的副本。
        """
        return self._last_tool_results.copy()
