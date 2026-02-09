# -*- coding: utf-8 -*-
"""ReAct core microkernel for SoloEngine."""

import asyncio
from typing import Optional, List, Any, Union

from ..message import Msg, ToolUseBlock, ToolResultBlock, TextBlock
from ..model import ChatModelBase, ChatResponse
from ..formatter import FormatterBase
from .interfaces import IMemory, IRAG, IToolExecutor


class ReActCore:
    """ReAct microkernel - pure control flow with plugin interfaces."""
    
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
        """Initialize the ReAct microkernel.
        
        Args:
            name: Agent name
            model: Chat model
            formatter: Message formatter
            system_prompt: System prompt
            memory: Memory plugin (optional)
            rag: RAG plugin (optional)
            tool_executor: Tool executor plugin (optional)
            max_iters: Maximum reasoning-acting iterations
            print_hint_msg: Whether to print hint messages
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
        
        # Internal state
        self._conversation_history: List[Msg] = []
        
    async def reply(self, message: str | Msg) -> Msg:
        """Main entry point for the agent.
        
        Args:
            message: User message (string or Msg object)
            
        Returns:
            Agent's response message
        """
        if isinstance(message, str):
            user_msg = Msg(name="user", content=message, role="user")
        else:
            user_msg = message
        
        # Add to conversation history
        self._conversation_history.append(user_msg)
        
        # Retrieve from memory if available
        memory_context = ""
        if self.memory:
            retrieved = await self.memory.retrieve(user_msg.get_text_content() or "")
            if retrieved:
                memory_context = "\n".join([
                    f"Previous conversation: {msg.get_text_content()}"
                    for msg in retrieved
                ])
        
        # Retrieve from RAG if available
        rag_context = ""
        if self.rag:
            documents = await self.rag.retrieve(user_msg.get_text_content() or "")
            if documents:
                rag_context = "\n".join([
                    f"Relevant knowledge: {doc.get('content', '')}"
                    for doc in documents
                ])
        
        # Prepare system prompt with context
        full_system_prompt = self.system_prompt
        if memory_context:
            full_system_prompt += f"\n\n{memory_context}"
        if rag_context:
            full_system_prompt += f"\n\n{rag_context}"
        
        # Start ReAct loop
        for iteration in range(self.max_iters):
            # 1. Reasoning step
            reasoning_result = await self._reasoning(
                user_msg, 
                full_system_prompt,
                iteration
            )
            
            # Check if reasoning indicates completion
            if self._should_complete(reasoning_result):
                final_response = await self._generate_final_response(
                    reasoning_result,
                    full_system_prompt
                )
                response_msg = Msg(
                    name=self.name,
                    content=final_response,
                    role="assistant"
                )
                self._conversation_history.append(response_msg)
                return response_msg
            
            # 2. Acting step (tool execution)
            tool_results = await self._acting(reasoning_result)
            
            # Update conversation with tool results
            if tool_results:
                # Add tool results to conversation
                for result in tool_results:
                    self._conversation_history.append(result)
            
            # Continue to next iteration
        
        # If max iterations reached, generate final response
        final_response = await self._generate_final_response(
            "Maximum iterations reached",
            full_system_prompt
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
        """Perform reasoning step."""
        # Prepare messages for model
        messages = [
            Msg(name="system", content=system_prompt, role="system"),
            *self._conversation_history[-5:],  # Last 5 messages for context
        ]
        
        # Format messages using formatter
        formatted = await self.formatter.format(messages)
        
        # Call model
        response = await self.model(formatted)
        
        if self.print_hint_msg:
            # Extract text for logging
            reasoning_text = ""
            for block in response.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    reasoning_text += block.get("text", "")
            print(f"[Iteration {iteration}] Reasoning: {reasoning_text[:100]}...")
        
        return response
    
    async def _acting(self, response: ChatResponse) -> List[Msg]:
        """Execute tools based on reasoning."""
        # Parse tool calls from model response
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
        """Parse tool calls from model response.
        
        Extracts structured tool calls from the model's ChatResponse.
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
    
    def _should_complete(self, response: Union[ChatResponse, str]) -> bool:
        """Determine if reasoning indicates completion."""
        # If response contains tool calls, we should not complete yet
        if isinstance(response, ChatResponse):
            # Check for tool use blocks
            has_tool_calls = any(
                isinstance(block, dict) and block.get("type") == "tool_use"
                for block in response.content
            )
            if has_tool_calls:
                return False
        
        # Extract text from response
        reasoning_text = ""
        if isinstance(response, ChatResponse):
            for block in response.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    reasoning_text += block.get("text", "")
        else:
            reasoning_text = response
        
        # Simple heuristic - if text contains final answer markers
        markers = ["final answer", "answer:", "conclusion:", "done"]
        return any(marker in reasoning_text.lower() for marker in markers)
    
    async def _generate_final_response(
        self,
        response: Union[ChatResponse, str],
        system_prompt: str
    ) -> str:
        """Generate final response from reasoning."""
        # Extract text from response
        reasoning_text = ""
        if isinstance(response, ChatResponse):
            for block in response.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    reasoning_text += block.get("text", "")
        else:
            reasoning_text = response
        
        # If we have reasoning text, return it directly (truncated if too long)
        if reasoning_text:
            if len(reasoning_text) > 500:
                return reasoning_text[:500] + "..."
            return reasoning_text
        
        # Fallback
        return "Final response generated."
    
    async def clear_history(self) -> None:
        """Clear conversation history."""
        self._conversation_history.clear()
        
        if self.memory:
            await self.memory.clear()