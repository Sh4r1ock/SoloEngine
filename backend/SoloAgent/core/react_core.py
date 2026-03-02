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
import re
from typing import Optional, List, Any, Union, Dict
from enum import Enum

from ..message import Msg, ToolUseBlock, ToolResultBlock, TextBlock
from ..model import ChatModelBase, ChatResponse
from ..formatter import FormatterBase
from .interfaces import IMemory, IRAG, IToolExecutor


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
        memory: Optional[IMemory] = None,
        rag: Optional[IRAG] = None,
        tool_executor: Optional[IToolExecutor] = None,
        max_iters: int = 10,
        print_hint_msg: bool = False,
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
        self.memory = memory
        self.rag = rag
        self.tool_executor = tool_executor
        self.max_iters = max_iters
        self.print_hint_msg = print_hint_msg
        
        self._conversation_history: List[Msg] = []
        self._iteration_count = 0
        self._last_tool_results: List[Dict[str, Any]] = []
        
    async def reply(self, message: str | Msg) -> Msg:
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
        
        memory_context = ""
        if self.memory:
            retrieved = await self.memory.retrieve(user_msg.get_text_content() or "")
            if retrieved:
                memory_context = "\n".join([
                    f"Previous conversation: {msg.get_text_content()}"
                    for msg in retrieved
                ])
        
        rag_context = ""
        if self.rag:
            documents = await self.rag.retrieve(user_msg.get_text_content() or "")
            if documents:
                rag_context = "\n".join([
                    f"Relevant knowledge: {doc.get('content', '')}"
                    for doc in documents
                ])
        
        full_system_prompt = self.system_prompt
        if memory_context:
            full_system_prompt += f"\n\n{memory_context}"
        if rag_context:
            full_system_prompt += f"\n\n{rag_context}"
        
        completion_reason = None
        
        for iteration in range(self.max_iters):
            self._iteration_count = iteration + 1
            
            reasoning_result = await self._reasoning(
                user_msg, 
                full_system_prompt,
                iteration
            )
            
            completion_check = self._check_completion(reasoning_result, iteration)
            
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
                    role="assistant"
                )
                self._conversation_history.append(response_msg)
                
                if self.memory:
                    await self.memory.add(user_msg)
                    await self.memory.add(response_msg)
                
                return response_msg
            
            tool_results = await self._acting(reasoning_result)
            
            if tool_results:
                for result in tool_results:
                    self._conversation_history.append(result)
                self._last_tool_results = [
                    {"content": r.get_text_content()} for r in tool_results
                ]
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
                        role="assistant"
                    )
                    self._conversation_history.append(response_msg)
                    
                    if self.memory:
                        await self.memory.add(user_msg)
                        await self.memory.add(response_msg)
                    
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
            role="assistant"
        )
        self._conversation_history.append(response_msg)
        
        if self.memory:
            await self.memory.add(user_msg)
            await self.memory.add(response_msg)
        
        return response_msg
    
    async def _reasoning(
        self,
        user_msg: Msg,
        system_prompt: str,
        iteration: int
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
            response = await self.model(formatted, tools=tools)
        else:
            response = await self.model(formatted)
        
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
        
        if not tool_calls:
            return []
        
        tool_results = []
        for tool_call in tool_calls:
            if self.tool_executor:
                try:
                    result = await self.tool_executor.execute(tool_call)
                    result_content = result.get("content", str(result))
                    result_msg = Msg(
                        name="tool",
                        content=result_content if isinstance(result_content, str) else str(result_content),
                        role="assistant"
                    )
                    tool_results.append(result_msg)
                except Exception as e:
                    error_msg = Msg(
                        name="tool_error",
                        content=str(e),
                        role="assistant"
                    )
                    tool_results.append(error_msg)
        
        return tool_results
    
    def _parse_tool_calls(self, response: ChatResponse) -> List[dict]:
        """
        从 LLM 响应中解析工具调用。
        
        提取响应内容中的 tool_use 块，转换为标准工具调用格式。
        
        Args:
            response (ChatResponse): LLM 响应对象。
        
        Returns:
            List[dict]: 工具调用列表，每个调用包含：
                - id: 调用 ID
                - name: 工具名称
                - arguments: 工具参数
        """
        tool_calls = []
        for block in response.content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                tool_call = {
                    "id": block.get("id"),
                    "name": block.get("name"),
                    "arguments": block.get("input", {})
                }
                tool_calls.append(tool_call)
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
            stop_reason = StopReason.from_api_response(response)
            
            if stop_reason == StopReason.END_TURN:
                return {
                    "should_complete": True,
                    "reason": CompletionReason.TASK_COMPLETED
                }
            
            if stop_reason == StopReason.TOOL_USE:
                return {"should_complete": False, "reason": CompletionReason.TOOL_CALL}
            
            if stop_reason == StopReason.MAX_TOKENS:
                return {
                    "should_complete": True,
                    "reason": CompletionReason.MAX_ITERATIONS
                }
            
            has_tool_calls = any(
                isinstance(block, dict) and block.get("type") == "tool_use"
                for block in response.content
            )
            if has_tool_calls:
                return {"should_complete": False, "reason": CompletionReason.TOOL_CALL}
            
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
        - 记忆存储（如果配置了记忆插件）
        
        Warning:
            此操作不可逆，所有对话上下文将丢失。
        """
        self._conversation_history.clear()
        self._iteration_count = 0
        self._last_tool_results = []
        
        if self.memory:
            await self.memory.clear()
    
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
