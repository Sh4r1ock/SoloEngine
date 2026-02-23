# -*- coding: utf-8 -*-
"""ReAct core microkernel for SoloEngine."""

import asyncio
import re
from typing import Optional, List, Any, Union, Dict
from enum import Enum

from ..message import Msg, ToolUseBlock, ToolResultBlock, TextBlock
from ..model import ChatModelBase, ChatResponse
from ..formatter import FormatterBase
from .interfaces import IMemory, IRAG, IToolExecutor


class CompletionReason(Enum):
    TASK_COMPLETED = "task_completed"
    MAX_ITERATIONS = "max_iterations"
    USER_SATISFIED = "user_satisfied"
    NO_MORE_ACTIONS = "no_more_actions"
    ERROR_ENCOUNTERED = "error_encountered"
    EXPLICIT_FINISH = "explicit_finish"


class ReActCore:
    """ReAct microkernel - pure control flow with plugin interfaces."""
    
    COMPLETION_MARKERS = [
        "final answer",
        "final answer:",
        "answer:",
        "conclusion:",
        "conclusion",
        "task completed",
        "task complete",
        "done",
        "finished",
        "i have completed",
        "here is the result",
        "the result is",
        "in summary",
        "to summarize",
        "the answer is",
        "result:",
        "output:",
        "response:",
    ]
    
    CONTINUATION_MARKERS = [
        "i need to",
        "next step",
        "next, i will",
        "i should",
        "let me",
        "i will now",
        "first, i",
        "then i will",
        "i'll",
        "i must",
        "continuing",
        "proceeding",
    ]
    
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
        return response_msg
    
    async def _reasoning(
        self,
        user_msg: Msg,
        system_prompt: str,
        iteration: int
    ) -> ChatResponse:
        messages = [
            Msg(name="system", content=system_prompt, role="system"),
            *self._conversation_history[-10:],
        ]
        
        formatted = await self.formatter.format(messages)
        
        response = await self.model(formatted)
        
        if self.print_hint_msg:
            reasoning_text = ""
            for block in response.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    reasoning_text += block.get("text", "")
            print(f"[Iteration {iteration}] Reasoning: {reasoning_text[:100]}...")
        
        return response
    
    async def _acting(self, response: ChatResponse) -> List[Msg]:
        tool_calls = self._parse_tool_calls(response)
        
        if not tool_calls:
            return []
        
        tool_results = []
        for tool_call in tool_calls:
            if self.tool_executor:
                try:
                    result = await self.tool_executor.execute(tool_call)
                    result_msg = Msg(
                        name="tool",
                        content=result,
                        role="tool"
                    )
                    tool_results.append(result_msg)
                except Exception as e:
                    error_msg = Msg(
                        name="tool_error",
                        content=str(e),
                        role="tool"
                    )
                    tool_results.append(error_msg)
        
        return tool_results
    
    def _parse_tool_calls(self, response: ChatResponse) -> List[dict]:
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
        if isinstance(response, ChatResponse):
            has_tool_calls = any(
                isinstance(block, dict) and block.get("type") == "tool_use"
                for block in response.content
            )
            if has_tool_calls:
                return {"should_complete": False, "reason": None}
        
        reasoning_text = self._extract_text(response)
        
        if not reasoning_text.strip():
            return {"should_complete": False, "reason": None}
        
        text_lower = reasoning_text.lower()
        
        for marker in self.COMPLETION_MARKERS:
            if marker in text_lower:
                completion_confidence = self._calculate_completion_confidence(reasoning_text)
                if completion_confidence > 0.5:
                    return {
                        "should_complete": True,
                        "reason": CompletionReason.TASK_COMPLETED,
                        "confidence": completion_confidence
                    }
        
        has_continuation = any(marker in text_lower for marker in self.CONTINUATION_MARKERS)
        if has_continuation:
            return {"should_complete": False, "reason": None}
        
        if iteration >= self.max_iters - 1:
            return {
                "should_complete": True,
                "reason": CompletionReason.MAX_ITERATIONS,
                "confidence": 0.8
            }
        
        if self._looks_like_final_answer(reasoning_text):
            return {
                "should_complete": True,
                "reason": CompletionReason.TASK_COMPLETED,
                "confidence": 0.7
            }
        
        return {"should_complete": False, "reason": None}
    
    def _calculate_completion_confidence(self, text: str) -> float:
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
        sentences = re.split(r'[.!?]+', text)
        if len(sentences) <= 2:
            return True
        
        if re.search(r'^\s*(yes|no|correct|incorrect)\s*[,.]', text.lower()):
            return True
        
        if re.search(r'\b(is|are|was|were)\s+\d+', text.lower()):
            return True
        
        return False
    
    def _has_explicit_answer(self, response: Union[ChatResponse, str]) -> bool:
        text = self._extract_text(response)
        
        if re.search(r'(answer|result|output)\s*(is|:)\s*', text.lower()):
            return True
        
        if re.search(r'^\s*[\d\w]+\.?\s*$', text.strip()):
            return True
        
        return False
    
    def _extract_text(self, response: Union[ChatResponse, str]) -> str:
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
        self._conversation_history.clear()
        self._iteration_count = 0
        self._last_tool_results = []
        
        if self.memory:
            await self.memory.clear()
    
    def get_iteration_count(self) -> int:
        return self._iteration_count
    
    def get_conversation_history(self) -> List[Msg]:
        return self._conversation_history.copy()
    
    def get_last_tool_results(self) -> List[Dict[str, Any]]:
        return self._last_tool_results.copy()
