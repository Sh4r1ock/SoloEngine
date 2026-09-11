# -*- coding: utf-8 -*-
import logging
import time
import asyncio
import hashlib
import json
from contextlib import nullcontext
from typing import Dict, Any, List, Optional, Callable
from collections import OrderedDict
from threading import Lock
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ..config import SoloAgentConfig
from ..agent import SoloAgent
from ...message import Msg
from SoloAgent.config import settings

logger = logging.getLogger("SoloEngine")

from .events import ExecutionEvent
from .compiled_flow import CompiledFlow
from .flow_compiler import CompiledFlowFactory, AgenticFlowCompiler


class FlowRunner:
    """工作流运行器，提供简化的执行接口"""
    
    @staticmethod
    async def run_from_json(
        json_data: Dict[str, Any], 
        input_message: Msg,
        user_id: str = None,
        agentic_flow_id: str = None,
        session_id: str = None,
        run_project_id: str = None,
        context: Dict[str, Any] = None,
        event_callback: Callable[[ExecutionEvent], None] = None,
        stream_callback: Callable[[dict], None] = None,
        agent_memories: Dict[str, List[Dict]] = None,
        cancel_event: asyncio.Event = None,
        on_flow_created: Callable = None,
    ) -> Dict[str, Any]:
        """运行 JSON 格式的工作流
        
        Args:
            json_data: 画布 JSON 数据
            input_message: 输入消息
            user_id: 用户 ID（必需）
            agentic_flow_id: AgenticFlow ID（必需）
            session_id: 会话 ID（必需）
            run_project_id: 项目 ID（必需）
            context: 执行上下文
            event_callback: 事件回调函数
            stream_callback: 流式输出回调函数
            agent_memories: 按 agent_id 分组的记忆
            on_flow_created: CompiledFlow 创建后的回调函数
            
        Returns:
            执行结果
        """
        compiler = AgenticFlowCompiler(user_id=user_id)
        compiled_flow = await compiler.compile(
            json_data, 
            user_id=user_id, 
            agentic_flow_id=agentic_flow_id,
            session_id=session_id,
            run_project_id=run_project_id,
        )
        
        if on_flow_created:
            on_flow_created(compiled_flow)
        
        if event_callback:
            compiled_flow.set_event_callback(event_callback)
        
        if stream_callback:
            compiled_flow.set_stream_callback(stream_callback)
        
        if agent_memories and compiled_flow._is_new:
            compiled_flow.set_agent_memories(agent_memories)
        
        execution_lock = CompiledFlowFactory.get_execution_lock(user_id, agentic_flow_id, session_id, run_project_id)
        # M7：有锁单分支（async with 锁/无锁 nullcontext），消除 if/else 双分支重复
        async with execution_lock if execution_lock else nullcontext():
            result = await compiled_flow.run(input_message, context, cancel_event=cancel_event)
            compiled_flow._is_new = False
            return result
    
    @staticmethod
    async def run_node(
        json_data: Dict[str, Any], 
        node_id: str,
        input_message: Msg,
        user_id: str = None,
        agentic_flow_id: str = None,
        session_id: str = None,
        run_project_id: str = None,
        context: Dict[str, Any] = None,
        agent_memories: Dict[str, List[Dict]] = None,
    ) -> Dict[str, Any]:
        if not session_id:
            raise ValueError("session_id is required for data isolation")
        if not user_id:
            raise ValueError("user_id is required for data isolation")
        if not agentic_flow_id:
            raise ValueError("agentic_flow_id is required for data isolation")
        if not run_project_id:
            raise ValueError("run_project_id is required for data isolation")
        
        compiler = AgenticFlowCompiler(user_id=user_id)
        compiled_flow = await compiler.compile(
            json_data, 
            user_id=user_id, 
            agentic_flow_id=agentic_flow_id, 
            session_id=session_id,
            run_project_id=run_project_id
        )
        
        agent = compiled_flow.get_agent(node_id)
        if agent is None:
            return {"error": f"Agent '{node_id}' not found"}
        
        if agent_memories and compiled_flow._is_new:
            compiled_flow.set_agent_memories(agent_memories)
        
        # C4：经 SoloAgent 公开方法 is_initialized() 查询（不直接读 _initialized 私有字段）
        if not agent.is_initialized():
            await agent.initialize()

        if hasattr(agent, 'set_stream_callback'):
            agent.set_stream_callback(compiled_flow._stream_callback)
        
        start_time = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        error_message = None
        try:
            response = await agent.reply(input_message)
        except Exception as e:
            error_message = str(e)
            logger.error(f"Error during agent reply: {error_message}")
            response = f"Error: {error_message}"
        end_time = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        
        duration_ms = int((end_time - start_time).total_seconds() * 1000)
        
        if error_message:
            return {
                "agent_id": node_id,
                "agent_name": agent.name,
                "output": response,
                "status": "failed",
                "error": error_message,
                "duration_ms": duration_ms,
            }
        
        openai_message = agent.get_last_openai_message() if hasattr(agent, 'get_last_openai_message') else {"content": response}
        
        tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
        
        return {
            "agent_id": node_id,
            "agent_name": agent.name,
            "output": response,
            "status": "completed",
            "message": openai_message,
            "tokens": tokens,
            "duration_ms": duration_ms
        }
