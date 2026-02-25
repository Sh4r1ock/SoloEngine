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
- 自动检测任务完成条件
- 集成记忆、RAG、工具执行等插件

ReAct 架构说明：
    ReAct 是一种将推理（Reasoning）和行动（Acting）交替进行的 Agent 架构。
    每轮迭代包含：
    1. Thought（思考）：分析当前状态，决定下一步行动
    2. Action（行动）：执行工具调用或生成回复
    3. Observation（观察）：获取行动结果，更新状态

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
from ..plugins.tools.finish_function_calling import (
    check_finish_by_function_calling,
)
from ..plugins.tools.finish_structured import (
    check_finish_by_structured_output,
)
from ..plugins.tools.finish_markers import (
    CompletionMarkers,
    check_finish_by_markers,
)


class CompletionReason(Enum):
    """
    任务完成原因枚举。
    
    定义 Agent 任务结束的各种原因，用于分析和调试。
    
    Attributes:
        TASK_COMPLETED: 任务正常完成，Agent 认为已给出最终答案
        MAX_ITERATIONS: 达到最大迭代次数限制，强制终止
        USER_SATISFIED: 用户表示满意，任务完成
        NO_MORE_ACTIONS: 没有更多行动可执行，自然终止
        ERROR_ENCOUNTERED: 遇到无法恢复的错误
        EXPLICIT_FINISH: Agent 显式调用了结束指令（finish 工具）
    """
    TASK_COMPLETED = "task_completed"
    MAX_ITERATIONS = "max_iterations"
    USER_SATISFIED = "user_satisfied"
    NO_MORE_ACTIONS = "no_more_actions"
    ERROR_ENCOUNTERED = "error_encountered"
    EXPLICIT_FINISH = "explicit_finish"


class CompletionDetectionMode(Enum):
    """
    任务完成检测模式枚举。
    
    定义不同的任务完成检测方式，由前端选择。
    
    Attributes:
        FUNCTION_CALLING: 工具调用模式（默认）。LLM 通过调用 finish 工具表示任务完成。
        STRUCTURED_OUTPUT: 结构化输出模式。解析 JSON 输出中的 action 字段判断。
        TEXT_MARKERS: 文本标记词模式。通过关键词检测判断任务完成。
    """
    FUNCTION_CALLING = "function_calling"
    STRUCTURED_OUTPUT = "structured_output"
    TEXT_MARKERS = "text_markers"


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
           b. 检查是否需要工具调用
           c. 执行工具调用（如果有）
           d. 检查是否达到完成条件
        4. 返回最终响应
    
    插件依赖：
        - model: LLM 模型实例（必需）
        - formatter: 消息格式化器（必需）
        - memory: 记忆插件（可选，用于上下文检索）
        - rag: RAG 插件（可选，用于知识检索）
        - tool_executor: 工具执行器（可选，用于工具调用）
    
    完成检测模式：
        - FUNCTION_CALLING（默认）：LLM 通过调用 finish 工具表示任务完成
        - STRUCTURED_OUTPUT：解析 JSON 输出中的 action 字段判断
        - TEXT_MARKERS：通过多语言关键词检测判断任务完成
    
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
        ...     completion_detection_mode=CompletionDetectionMode.FUNCTION_CALLING,
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
        completion_detection_mode: CompletionDetectionMode = CompletionDetectionMode.FUNCTION_CALLING,
        completion_markers: Optional[CompletionMarkers] = None,
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
            completion_detection_mode (CompletionDetectionMode, optional): 
                任务完成检测模式。默认为 FUNCTION_CALLING。
                - FUNCTION_CALLING: LLM 通过调用 finish 工具表示任务完成
                - STRUCTURED_OUTPUT: 解析 JSON 输出判断
                - TEXT_MARKERS: 通过关键词检测判断
            completion_markers (CompletionMarkers, optional): 多语言标记词配置。
                仅在 TEXT_MARKERS 模式下使用。默认为英文标记词。
        
        Note:
            - model 和 formatter 是必需的
            - 插件参数都是可选的，按需注入
            - max_iters 应根据任务复杂度调整
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
        self.completion_detection_mode = completion_detection_mode
        self.completion_markers = completion_markers or CompletionMarkers.english()
        
        self._conversation_history: List[Msg] = []
        self._iteration_count = 0
        self._last_tool_results: List[Dict[str, Any]] = []
        self._finish_answer: Optional[str] = None
        
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
        
        根据配置的检测模式判断是否应该结束推理-行动循环。
        
        检测模式：
            - FUNCTION_CALLING: 检测 finish 工具调用
            - STRUCTURED_OUTPUT: 解析 JSON 输出中的 action 字段
            - TEXT_MARKERS: 通过关键词检测判断
        
        Args:
            response (ChatResponse | str): LLM 响应或文本。
            iteration (int): 当前迭代次数。
        
        Returns:
            dict: 检查结果，包含：
                - should_complete (bool): 是否应该结束
                - reason (CompletionReason): 结束原因
                - confidence (float): 置信度（可选）
        """
        if self.completion_detection_mode == CompletionDetectionMode.FUNCTION_CALLING:
            return self._check_completion_function_calling(response, iteration)
        elif self.completion_detection_mode == CompletionDetectionMode.STRUCTURED_OUTPUT:
            return self._check_completion_structured_output(response, iteration)
        else:
            return self._check_completion_text_markers(response, iteration)
    
    def _check_completion_function_calling(
        self, 
        response: Union[ChatResponse, str], 
        iteration: int
    ) -> dict:
        """
        Function Calling 模式的任务完成检测。
        
        使用 finish_function_calling 插件检测任务完成。
        
        Args:
            response (ChatResponse | str): LLM 响应。
            iteration (int): 当前迭代次数。
        
        Returns:
            dict: 检查结果。
        """
        result = check_finish_by_function_calling(response)
        
        if result["is_finished"]:
            self._finish_answer = result["answer"]
            return {
                "should_complete": True,
                "reason": CompletionReason.EXPLICIT_FINISH,
                "confidence": 1.0
            }
        
        if result["has_other_tools"]:
            return {"should_complete": False, "reason": None}
        
        if iteration >= self.max_iters - 1:
            return {
                "should_complete": True,
                "reason": CompletionReason.MAX_ITERATIONS,
                "confidence": 0.8
            }
        
        reasoning_text = self._extract_text(response)
        if reasoning_text.strip() and self._looks_like_final_answer(reasoning_text):
            return {
                "should_complete": True,
                "reason": CompletionReason.TASK_COMPLETED,
                "confidence": 0.7
            }
        
        return {"should_complete": False, "reason": None}
    
    def _check_completion_structured_output(
        self, 
        response: Union[ChatResponse, str], 
        iteration: int
    ) -> dict:
        """
        Structured Output 模式的任务完成检测。
        
        使用 finish_structured 插件检测任务完成。
        
        Args:
            response (ChatResponse | str): LLM 响应。
            iteration (int): 当前迭代次数。
        
        Returns:
            dict: 检查结果。
        """
        reasoning_text = self._extract_text(response)
        result = check_finish_by_structured_output(reasoning_text)
        
        if result["is_finished"]:
            self._finish_answer = result["answer"]
            return {
                "should_complete": True,
                "reason": CompletionReason.EXPLICIT_FINISH,
                "confidence": 1.0
            }
        
        if result["has_other_action"]:
            return {"should_complete": False, "reason": None}
        
        if iteration >= self.max_iters - 1:
            return {
                "should_complete": True,
                "reason": CompletionReason.MAX_ITERATIONS,
                "confidence": 0.8
            }
        
        if reasoning_text.strip() and self._looks_like_final_answer(reasoning_text):
            return {
                "should_complete": True,
                "reason": CompletionReason.TASK_COMPLETED,
                "confidence": 0.7
            }
        
        return {"should_complete": False, "reason": None}
    
    def _check_completion_text_markers(
        self, 
        response: Union[ChatResponse, str], 
        iteration: int
    ) -> dict:
        """
        Text Markers 模式的任务完成检测。
        
        使用 finish_markers 插件检测任务完成。
        
        Args:
            response (ChatResponse | str): LLM 响应。
            iteration (int): 当前迭代次数。
        
        Returns:
            dict: 检查结果。
        """
        if isinstance(response, ChatResponse):
            has_tool_calls = any(
                isinstance(block, dict) and block.get("type") == "tool_use"
                for block in response.content
            )
            if has_tool_calls:
                return {"should_complete": False, "reason": None}
        
        reasoning_text = self._extract_text(response)
        result = check_finish_by_markers(reasoning_text, self.completion_markers)
        
        if result["is_finished"]:
            return {
                "should_complete": True,
                "reason": CompletionReason.TASK_COMPLETED,
                "confidence": result["confidence"]
            }
        
        if result["has_continuation"]:
            return {"should_complete": False, "reason": None}
        
        if iteration >= self.max_iters - 1:
            return {
                "should_complete": True,
                "reason": CompletionReason.MAX_ITERATIONS,
                "confidence": 0.8
            }
        
        if reasoning_text.strip() and self._looks_like_final_answer(reasoning_text):
            return {
                "should_complete": True,
                "reason": CompletionReason.TASK_COMPLETED,
                "confidence": 0.7
            }
        
        return {"should_complete": False, "reason": None}
    
    def _calculate_completion_confidence(self, text: str) -> float:
        """
        计算任务完成的置信度。
        
        基于多个信号综合评估任务是否完成：
        - 强标记词（如 "final answer"）权重更高
        - 弱标记词（如 "done"）权重较低
        - 结构化输出（如编号列表）增加置信度
        - 因果词（如 "therefore"）增加置信度
        
        Args:
            text (str): LLM 输出文本。
        
        Returns:
            float: 完成置信度，范围 [0, 1]。
        """
        confidence = 0.0
        text_lower = text.lower()
        
        strong_markers = ["final answer", "task completed", "conclusion:"]
        for marker in strong_markers:
            if marker in text_lower:
                confidence += 0.4
        
        weak_markers = ["answer:", "result:", "done", "finished"]
        for marker in weak_markers:
            if marker in text_lower:
                confidence += 0.2
        
        if re.search(r'\d+\.\s+\w+', text):
            confidence += 0.1
        
        if re.search(r'(therefore|thus|hence|so),', text_lower):
            confidence += 0.15
        
        return min(confidence, 1.0)
    
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
            1. 如果有 finish 工具提供的答案，直接返回
            2. 尝试提取显式的最终答案
            3. 如果提取失败，截取推理文本前 500 字符
            4. 如果没有推理文本，返回默认消息
        
        Args:
            response (ChatResponse | str): 推理结果。
            system_prompt (str): 系统提示词（未使用，保留扩展）。
            completion_reason (CompletionReason, optional): 完成原因。
        
        Returns:
            str: 最终响应文本。
        """
        if self._finish_answer:
            return self._finish_answer
        
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
        - finish 工具答案
        - 记忆存储（如果配置了记忆插件）
        
        Warning:
            此操作不可逆，所有对话上下文将丢失。
        """
        self._conversation_history.clear()
        self._iteration_count = 0
        self._last_tool_results = []
        self._finish_answer = None
        
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
