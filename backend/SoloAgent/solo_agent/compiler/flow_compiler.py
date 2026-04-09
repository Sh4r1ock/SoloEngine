"""
AgenticFlow编译器机制-flow_compiler.py: AgenticFlow编译器，将画布JSON编译为可执行的多智能体系统

@file flow_compiler.py
@description 实现AgenticFlow编译器，将画布配置编译为可执行的CompiledFlow
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块实现AgenticFlow编译器机制，提供以下核心功能：
- AgenticFlowCompiler: 将画布JSON编译为CompiledFlow
- CompiledFlow: 编译后的流程对象，作为MCP Host管理多Agent执行
- CompiledFlowFactory: 流程工厂，创建CompiledFlow实例
- FlowRunner: 流程运行器，执行编译后的流程
- ExecutionEvent: 执行事件数据类，用于事件通知

核心特性：
- 网关注册集成：与AgenticFlowGateway协作
- 并发处理机制：支持多Agent并发执行
- 流式输出回调：支持实时输出到前端
- 完整数据库持久化：自动保存执行历史
- 自动加载配置：自动加载LLM/MCP/Skills配置

依赖:
- os, uuid, time, asyncio, json: 基础库
- typing: 类型提示
- collections: 有序字典
- threading: 线程锁
- datetime: 时间处理
- dataclasses: 数据类
- ..config: SoloAgentConfig
- ..agent: SoloAgent
- app.core.config: 应用配置

使用示例:
- compiler = AgenticFlowCompiler()
- compiled = await compiler.compile(canvas_config)
- async for event in compiled.run(user_input): process(event)
"""
import os
import uuid
import logging
import time
import asyncio
import json
from typing import Dict, Any, List, Optional, Callable, AsyncGenerator
from collections import OrderedDict
from threading import Lock
from datetime import datetime, timezone
from dataclasses import dataclass, field

from ..config import SoloAgentConfig
from ..agent import SoloAgent
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class ExecutionEvent:
    """
    执行事件数据类
    
    职责:
    - 封装流程执行过程中的各类事件
    - 支持多种事件类型：消息、工具调用、Skill调用、MCP调用等
    - 提供时间戳和元数据支持
    
    属性:
        event_type (str): 事件类型
        agent_id (Optional[str]): Agent ID
        agent_name (Optional[str]): Agent名称
        content (Optional[str]): 内容
        message (Optional[Dict]): 消息数据
        tool_name (Optional[str]): 工具名称
        tool_args (Optional[Dict]): 工具参数
        tool_result (Optional[str]): 工具结果
        timestamp (str): 时间戳
        metadata (Dict[str, Any]): 元数据
    """
    event_type: str
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    agent_type: Optional[str] = None
    content: Optional[str] = None
    message: Optional[Dict[str, Any]] = None
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[str] = None
    skill_name: Optional[str] = None
    skill_args: Optional[Dict[str, Any]] = None
    skill_result: Optional[str] = None
    mcp_name: Optional[str] = None
    mcp_args: Optional[Dict[str, Any]] = None
    mcp_result: Optional[str] = None
    subagent_id: Optional[str] = None
    subagent_name: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)


class CompiledFlow:
    """
    编译后的AgenticFlow类 - 作为MCP Host
    
    职责:
    - 管理多个Agent的执行
    - 协调会话生命周期
    - Host层统一管理MCP Client
    - 事件管理和流式输出
    
    属性:
        agents (Dict[str, SoloAgent]): Agent字典
        edges (Dict[str, List[str]]): Agent连接关系
        orchestrator_id (Optional[str]): 编排器Agent ID
        agentic_flow_id (str): AgenticFlow ID
        session_id (str): 会话ID
        user_id (str): 用户ID
        run_project_id (str): 运行项目ID
        mcp_client_manager (Optional[MCPHostClientManager]): MCP客户端管理器
    """
    
    def __init__(
        self,
        agents: Dict[str, SoloAgent],
        edges: Dict[str, List[str]],
        orchestrator_id: Optional[str] = None,
        agentic_flow_id: str = None,
        session_id: str = None,
        user_id: str = None,
        run_project_id: str = None,
        mcp_client_manager: Optional["MCPHostClientManager"] = None,
    ):
        """
        初始化CompiledFlow
        
        Args:
            agents: Agent字典
            edges: 边连接关系
            orchestrator_id: 编排器Agent ID
            agentic_flow_id: AgenticFlow ID
            session_id: 会话ID
            user_id: 用户ID
            run_project_id: 运行项目ID
            mcp_client_manager: MCP Client管理器(Host层)
        """
        self.agents = agents
        self.edges = edges
        self.orchestrator_id = orchestrator_id
        self.agentic_flow_id = agentic_flow_id
        self.session_id = session_id
        self.user_id = user_id
        self.run_project_id = run_project_id
        
        # Host层MCP Client管理
        self._mcp_client_manager = mcp_client_manager
        
        self._start_time: Optional[datetime] = None
        self._token_usage: Dict[str, int] = {}
        self._event_callback: Optional[Callable[[ExecutionEvent], None]] = None
        self._stream_callback: Optional[Callable[[str], None]] = None
        self._agent_memories: Dict[str, List[Dict]] = {}
        self._created_time: float = time.time()
        
        logger.info(
            f"[CompiledFlow] Initialized with {len(agents)} agents, "
            f"mcp_clients={len(mcp_client_manager.get_all_clients()) if mcp_client_manager else 0}"
        )
    
    def set_event_callback(self, callback: Callable[[ExecutionEvent], None]):
        """设置事件回调函数"""
        self._event_callback = callback
    
    def set_stream_callback(self, callback: Callable[[dict], None]):
        """设置流式输出回调函数"""
        self._stream_callback = callback
    
    def set_agent_memories(self, memories: Dict[str, List[Dict]]) -> None:
        """设置按 agent_id 分组的记忆（由 AgenticFlow实例层调用）"""
        self._agent_memories = memories
    
    def _emit_event(self, event: ExecutionEvent):
        """发送执行事件"""
        if self._event_callback:
            try:
                self._event_callback(event)
            except Exception as e:
                logger.error(f"Event callback error: {e}")
    
    def _emit_stream(self, content: str):
        """发送流式输出"""
        if self._stream_callback:
            try:
                self._stream_callback(content)
            except Exception as e:
                logger.error(f"Stream callback error: {e}")
    
    def get_agent(self, agent_id: str) -> Optional[SoloAgent]:
        return self.agents.get(agent_id)
    
    def get_orchestrator(self) -> Optional[SoloAgent]:
        if self.orchestrator_id:
            return self.agents.get(self.orchestrator_id)
        return None
    
    def get_subagents(self, agent_id: str) -> List[SoloAgent]:
        subagent_ids = self.edges.get(agent_id, [])
        return [self.agents[aid] for aid in subagent_ids if aid in self.agents]
    
    def get_entry_nodes(self) -> List[str]:
        target_nodes = set()
        for child_ids in self.edges.values():
            target_nodes.update(child_ids)
        return [node_id for node_id in self.agents.keys() if node_id not in target_nodes]
    
    async def run(self, input_message: str, context: Dict[str, Any] = None, cancel_event: asyncio.Event = None) -> Dict[str, Any]:
        """运行 AgenticFlow，返回完整执行结果
        
        Args:
            input_message: 用户输入消息
            context: 上下文信息
            cancel_event: 取消事件
        
        Returns:
            Dict[str, Any]: 运行结果
        """
        context = context or {}
        self._start_time = datetime.now()
        
        logger.info(f"[CompiledFlow.run] Starting run with session_id={self.session_id}, user_id={self.user_id}, run_project_id={self.run_project_id}, agentic_flow_id={self.agentic_flow_id}")
        
        from app.core.database import db_manager, get_db_context
        
        self._emit_event(ExecutionEvent(
            event_type="execution_start",
            content=input_message,
            metadata={"agentic_flow_id": self.agentic_flow_id, "user_id": self.user_id, "session_id": self.session_id, "run_project_id": self.run_project_id}
        ))
        
        try:
            with get_db_context() as db:
                result = await self._run_internal(input_message, db, context, cancel_event)
                return result
        except Exception as e:
            logger.error(f"[CompiledFlow.run] Execution failed: {e}", exc_info=True)
            # 返回错误结果而不是None
            return {
                "session_id": self.session_id,
                "agentic_flow_id": self.agentic_flow_id,
                "run_project_id": self.run_project_id,
                "status": "failed",
                "error": str(e),
                "output": f"执行失败: {str(e)}"
            }
        finally:
            # 确保关闭所有MCP Client连接
            if self._mcp_client_manager:
                await self._mcp_client_manager.close_all()
    
    async def _run_internal(self, input_message: str, db, context: Dict[str, Any], cancel_event: asyncio.Event = None) -> Dict[str, Any]:
        """内部运行逻辑"""
        from app.core.database import db_manager
        
        orchestrator = self.get_orchestrator()
        
        if orchestrator is None:
            if len(self.agents) == 1:
                agent = list(self.agents.values())[0]
                result = await self._execute_agent(agent, input_message, db, context, cancel_event=cancel_event)
                
                if self.session_id and result:
                    end_time = datetime.now()
                    duration_ms = int((end_time - self._start_time).total_seconds() * 1000) if self._start_time else 0
                    db_manager.update_session(
                        db, self.session_id,
                        status="completed",
                        duration_ms=duration_ms,
                        token_usage=self._token_usage if self._token_usage else None,
                        completed_at=datetime.now(timezone.utc)
                    )
                
                return result
            else:
                entry_nodes = self.get_entry_nodes()
                if not entry_nodes:
                    entry_nodes = list(self.agents.keys())
                
                results = {}
                for entry_id in entry_nodes:
                    agent = self.agents.get(entry_id)
                    if agent:
                        result = await self._execute_agent(agent, input_message, db, context, cancel_event=cancel_event)
                        results[entry_id] = result
                
                output = self._aggregate_results(results)
                
                end_time = datetime.now()
                duration_ms = int((end_time - self._start_time).total_seconds() * 1000)
                
                if self.session_id:
                    db_manager.update_session(
                        db, self.session_id,
                        status="completed",
                        duration_ms=duration_ms,
                        token_usage=self._token_usage if self._token_usage else None,
                        completed_at=datetime.now(timezone.utc)
                    )
                
                self._emit_event(ExecutionEvent(
                    event_type="execution_complete",
                    content=output,
                    metadata={"duration_ms": duration_ms}
                ))
                
                return {
                    "session_id": self.session_id,
                    "agentic_flow_id": self.agentic_flow_id,
                    "run_project_id": self.run_project_id,
                        "status": "completed",
                        "output": output,
                        "node_results": results,
                        "duration_ms": duration_ms,
                        "token_usage": self._token_usage
                    }
        else:
            result = await self._execute_agent(orchestrator, input_message, db, context, cancel_event=cancel_event)
            return result
    
    async def _execute_agent(
        self, 
        agent: SoloAgent, 
        input_message: str,
        db,
        context: Dict[str, Any],
        cancel_event: asyncio.Event = None
    ) -> Dict[str, Any]:
        """执行单个 Agent 并记录"""
        from app.core.database import db_manager
        
        agent_id = agent.agent_id
        agent_name = agent.name
        
        self._emit_event(ExecutionEvent(
            event_type="agent_start",
            agent_id=agent_id,
            agent_name=agent_name,
            agent_type=agent.agent_type,
            content=input_message
        ))
        
        if self._stream_callback and hasattr(agent, 'set_stream_callback'):
            agent.set_stream_callback(self._stream_callback)
        
        # 只在 agent 未初始化时设置记忆，避免覆盖 ReActCore 的 _conversation_history
        if not agent._initialized:
            agent_memory = self._agent_memories.get(agent_id, [])
            if agent_memory and hasattr(agent, 'set_message_history'):
                agent.set_message_history(agent_memory)
            await agent.initialize()
        
        try:
            original_reply = agent.reply
            
            async def wrapped_reply(message: str) -> str:
                response = await original_reply(message, cancel_event=cancel_event)
                
                if hasattr(agent, '_last_tool_calls') and agent._last_tool_calls:
                    for tool_call in agent._last_tool_calls:
                        tool_name = tool_call.get("name")
                        if not tool_name:
                            continue
                        
                        self._emit_event(ExecutionEvent(
                            event_type="tool_call",
                            agent_id=agent_id,
                            agent_name=agent_name,
                            tool_name=tool_name,
                            tool_args=tool_call.get("args"),
                            tool_result=tool_call.get("result")
                        ))
                
                if hasattr(agent, '_last_skill_calls'):
                    for skill_call in agent._last_skill_calls:
                        self._emit_event(ExecutionEvent(
                            event_type="skill_call",
                            agent_id=agent_id,
                            agent_name=agent_name,
                            skill_name=skill_call.get("name"),
                            skill_args=skill_call.get("args"),
                            skill_result=skill_call.get("result")
                        ))
                
                if hasattr(agent, '_last_mcp_calls'):
                    for mcp_call in agent._last_mcp_calls:
                        self._emit_event(ExecutionEvent(
                            event_type="mcp_call",
                            agent_id=agent_id,
                            agent_name=agent_name,
                            mcp_name=mcp_call.get("name"),
                            mcp_args=mcp_call.get("args"),
                            mcp_result=mcp_call.get("result")
                        ))
                
                return response
            
            response = await wrapped_reply(input_message)

            # 保存对话历史到记忆 - 使用与 load_and_distribute_memories 一致的格式
            agent_memory.append({"role": "user", "data": [{"type": "content", "content": input_message}]})
            agent_memory.append({"role": "assistant", "data": [{"type": "content", "content": response}]})
            self._agent_memories[agent_id] = agent_memory
            
            end_time = datetime.now()
            duration_ms = int((end_time - self._start_time).total_seconds() * 1000) if self._start_time else 0
            
            tool_calls = []
            if hasattr(agent, '_last_tool_calls') and agent._last_tool_calls:
                tool_calls = agent._last_tool_calls.copy()
            
            openai_message = agent.get_last_openai_message() if hasattr(agent, 'get_last_openai_message') else {"role": "assistant", "content": response, "reasoning_content": None}
            
            tokens = None
            if hasattr(agent, '_last_response') and hasattr(agent._last_response, 'usage') and agent._last_response.usage:
                usage = agent._last_response.usage
                tokens = {
                    "prompt_tokens": getattr(usage, 'input_tokens', None),
                    "completion_tokens": getattr(usage, 'output_tokens', None),
                    "total_tokens": getattr(usage, 'output_tokens', 0) + getattr(usage, 'input_tokens', 0) if getattr(usage, 'input_tokens', None) is not None and getattr(usage, 'output_tokens', None) is not None else None,
                }
                if tokens.get("prompt_tokens") is not None:
                    self._token_usage["prompt_tokens"] = self._token_usage.get("prompt_tokens", 0) + (tokens.get("prompt_tokens") or 0)
                    self._token_usage["completion_tokens"] = self._token_usage.get("completion_tokens", 0) + (tokens.get("completion_tokens") or 0)
                    self._token_usage["total_tokens"] = self._token_usage.get("total_tokens", 0) + (tokens.get("total_tokens") or 0)
                    logger.info(f"[Token Usage] Accumulated: {tokens}")
            
            result = {
                "agent_id": agent_id,
                "agent_name": agent_name,
                "agent_type": agent.agent_type,
                "user_id": self.user_id,
                "agentic_flow_id": self.agentic_flow_id,
                "run_project_id": self.run_project_id,
                "session_id": self.session_id,
                "output": response,
                "message": openai_message,
                "status": "completed",
                "duration_ms": duration_ms,
                "tool_calls": tool_calls,
                "tokens": tokens,
            }
            
            self._emit_event(ExecutionEvent(
                event_type="agent_complete",
                agent_id=agent_id,
                agent_name=agent_name,
                content=openai_message.get("content", response) if openai_message else response,
                message=openai_message,
                status="completed"
            ))
            
            return result
            
        except Exception as e:
            import traceback
            logger.error(f"Agent execution failed: {agent_name} - {e}")
            logger.error(traceback.format_exc())
            
            self._emit_event(ExecutionEvent(
                event_type="agent_error",
                agent_id=agent_id,
                agent_name=agent_name,
                error=str(e),
                status="failed"
            ))
            
            if self.session_id:
                db_manager.update_session(
                    db, self.session_id,
                    status="failed",
                    error=str(e)
                )
            
            return {
                "agent_id": agent_id,
                "agent_name": agent_name,
                "status": "failed",
                "error": str(e)
            }
    
    def _aggregate_results(self, results: Dict[str, Any]) -> str:
        outputs = []
        for agent_id, result in results.items():
            if isinstance(result, dict):
                output = result.get("output", "")
                if output:
                    agent_name = self.agents.get(agent_id)
                    name = agent_name.name if agent_name else agent_id
                    outputs.append(f"[{name}]: {output}")
        
        return "\n\n".join(outputs) if outputs else "Execution completed"
    
    async def run_agent(self, agent_id: str, message: str) -> str:
        """运行指定的 Agent"""
        agent = self.get_agent(agent_id)
        if agent is None:
            raise ValueError(f"Agent '{agent_id}' not found")
        
        if not agent._initialized:
            await agent.initialize()
        
        return await agent.reply(message)


class CompiledFlowFactory:
    """CompiledFlow 工厂，带 LRU 缓存、并发控制和自动清理
    
    缓存 key 格式: {user_id}:{agentic_flow_id}:{session_id}:{run_project_id}
    """
    
    MAX_INSTANCES = 100
    CACHE_TIMEOUT = int(os.getenv("COMPILED_FLOW_CACHE_TIMEOUT", "1800"))
    
    _instances: OrderedDict[str, tuple] = OrderedDict()
    _lock = Lock()
    _execution_locks: Dict[str, asyncio.Lock] = {}
    _flow_users: Dict[str, set] = {}
    
    @classmethod
    def _make_cache_key(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> str:
        """生成四参数缓存 key"""
        return f"{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}"
    
    @classmethod
    def create(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str, compiled_flow: CompiledFlow) -> CompiledFlow:
        cache_key = cls._make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
        
        with cls._lock:
            cls._cleanup_expired()
            
            if cache_key in cls._instances:
                cls._instances.move_to_end(cache_key)
                compiled_flow, _ = cls._instances[cache_key]
                return compiled_flow
            
            if len(cls._instances) >= cls.MAX_INSTANCES:
                oldest_key = next(iter(cls._instances))
                del cls._instances[oldest_key]
                if oldest_key in cls._execution_locks:
                    del cls._execution_locks[oldest_key]
                if oldest_key in cls._flow_users:
                    del cls._flow_users[oldest_key]
                logger.info(f"Removed oldest CompiledFlow instance: {oldest_key}")
            
            cls._instances[cache_key] = (compiled_flow, time.time())
            
            if cache_key not in cls._execution_locks:
                cls._execution_locks[cache_key] = asyncio.Lock()
            
            if cache_key not in cls._flow_users:
                cls._flow_users[cache_key] = set()
            
            return compiled_flow
    
    @classmethod
    def get(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> Optional[CompiledFlow]:
        cache_key = cls._make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
        
        with cls._lock:
            if cache_key in cls._instances:
                cls._instances.move_to_end(cache_key)
                compiled_flow, _ = cls._instances[cache_key]
                return compiled_flow
            return None
    
    @classmethod
    def get_execution_lock(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> Optional[asyncio.Lock]:
        cache_key = cls._make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
        return cls._execution_locks.get(cache_key)
    
    @classmethod
    def register_user(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str, user_id_to_register: str) -> None:
        cache_key = cls._make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
        
        with cls._lock:
            if cache_key not in cls._flow_users:
                cls._flow_users[cache_key] = set()
            cls._flow_users[cache_key].add(user_id_to_register)
    
    @classmethod
    def get_flow_users(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> set:
        cache_key = cls._make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
        return cls._flow_users.get(cache_key, set())
    
    @classmethod
    def _cleanup_expired(cls):
        current_time = time.time()
        expired_ids = [
            fid for fid, (_, created_time) in cls._instances.items()
            if current_time - created_time > cls.CACHE_TIMEOUT
        ]
        for fid in expired_ids:
            del cls._instances[fid]
            if fid in cls._execution_locks:
                del cls._execution_locks[fid]
            if fid in cls._flow_users:
                del cls._flow_users[fid]
            logger.info(f"Removed expired CompiledFlow instance: {fid}")
    
    @classmethod
    def remove(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> bool:
        cache_key = cls._make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
        
        with cls._lock:
            if cache_key in cls._instances:
                del cls._instances[cache_key]
                if cache_key in cls._execution_locks:
                    del cls._execution_locks[cache_key]
                if cache_key in cls._flow_users:
                    del cls._flow_users[cache_key]
                return True
            return False
    
    @classmethod
    def clear_all(cls):
        with cls._lock:
            cls._instances.clear()
            cls._execution_locks.clear()
            cls._flow_users.clear()
            logger.info("Cleared all CompiledFlow instances")
    
    @classmethod
    def get_stats(cls) -> Dict[str, Any]:
        with cls._lock:
            return {
                "total_instances": len(cls._instances),
                "max_instances": cls.MAX_INSTANCES,
                "cache_timeout": cls.CACHE_TIMEOUT,
                "total_execution_locks": len(cls._execution_locks),
                "flow_users_count": {fid: len(users) for fid, users in cls._flow_users.items()}
            }


class AgenticFlowCompiler:
    """AgenticFlow 编译器
    
    将前端画布 JSON 数据编译为可执行的 Agent 实例树
    
    功能增强：
    - 自动从数据库加载 LLM/MCP/Skills 配置
    - 编译后自动注册到网关
    - 支持并发执行
    - 从下向上编译（拓扑排序）
    """
    
    def __init__(self, user_id: str = None):
        self.user_id = user_id
    
    def _calculate_compilation_order(self, nodes: List[Dict], edges: List[Dict]) -> List[str]:
        """通过边关系拓扑排序，确定编译顺序
        
        边关系：source → target 表示 source 是上级，target 是下级（subagent）
        编译顺序：先编译下级（没有出边的节点），再编译上级
        
        Args:
            nodes: 节点列表
            edges: 边列表
        
        Returns:
            List[str]: 编译顺序（节点 ID 列表）
        """
        out_edges: Dict[str, List[str]] = {}
        in_edges: Dict[str, List[str]] = {}
        
        for edge in edges:
            source = edge.get("source")
            target = edge.get("target")
            if source and target:
                if source not in out_edges:
                    out_edges[source] = []
                out_edges[source].append(target)
                
                if target not in in_edges:
                    in_edges[target] = []
                in_edges[target].append(source)
        
        all_nodes = {n["id"] for n in nodes}
        nodes_with_out_edges = set(out_edges.keys())
        bottom_nodes = all_nodes - nodes_with_out_edges
        
        compilation_order = []
        visited = set()
        queue = list(bottom_nodes)
        
        while queue:
            node_id = queue.pop(0)
            if node_id in visited:
                continue
            visited.add(node_id)
            compilation_order.append(node_id)
            
            for parent_id in in_edges.get(node_id, []):
                all_subagents_compiled = all(
                    subagent_id in visited 
                    for subagent_id in out_edges.get(parent_id, [])
                )
                if all_subagents_compiled and parent_id not in visited:
                    queue.append(parent_id)
        
        for node in nodes:
            node_id = node.get("id")
            if node_id and node_id not in visited:
                compilation_order.append(node_id)
        
        logger.info(f"[Compilation Order] {compilation_order}")
        return compilation_order
    
    async def compile(
        self,
        flow_data: Dict[str, Any],
        user_id: str = None,
        agentic_flow_id: str = None,
        session_id: str = None,
        run_project_id: str = None,
        use_cache: bool = True,
        register_gateway: bool = True,
    ) -> CompiledFlow:
        """编译 AgenticFlow JSON 为可执行结构
        
        Args:
            flow_data: AgenticFlow JSON 数据
            user_id: 用户 ID（必需）
            agentic_flow_id: AgenticFlow ID（必需）
            session_id: 会话 ID（必需）
            run_project_id: 项目 ID（必需）
            use_cache: 是否使用缓存
            register_gateway: 是否注册到网关
            
        Returns:
            CompiledFlow: 编译后的可执行结构
        """
        user_id = user_id or self.user_id
        agentic_flow_id = agentic_flow_id or flow_data.get("agentic_flow_id")
        
        if not agentic_flow_id:
            raise ValueError("agentic_flow_id is required. It must be provided either as a parameter or in flow_data.")
        
        if not user_id:
            raise ValueError("user_id is required.")
        
        if not session_id:
            raise ValueError("session_id is required.")
        
        if not run_project_id:
            raise ValueError("run_project_id is required.")
        
        if use_cache:
            cached = CompiledFlowFactory.get(user_id, agentic_flow_id, session_id, run_project_id)
            if cached:
                current_llm_configs = self._load_llm_configs(user_id)
                
                cached_config_versions = set()
                for agent in cached.agents.values():
                    if hasattr(agent.config, '_llm_config_version') and agent.config._llm_config_version:
                        cached_config_versions.add(agent.config._llm_config_version)
                
                current_config_versions = {cfg.version for cfg in current_llm_configs.values() if cfg.version}
                
                if cached_config_versions == current_config_versions and (len(cached_config_versions) > 0 or len(current_config_versions) == 0):
                    logger.info(f"Using cached CompiledFlow for key: {user_id}:{agentic_flow_id}:{session_id}:{run_project_id}")
                    CompiledFlowFactory.register_user(user_id, agentic_flow_id, session_id, run_project_id, user_id)
                    cached.session_id = session_id
                    cached.run_project_id = run_project_id
                    cached.user_id = user_id
                    cached.agentic_flow_id = agentic_flow_id
                    return cached
                else:
                    logger.info(f"LLM config version changed (cached: {cached_config_versions}, current: {current_config_versions}), recompiling...")
                    CompiledFlowFactory.remove(user_id, agentic_flow_id, session_id, run_project_id)
        
        canvas_data = flow_data.get("canvas_data", flow_data)
        nodes = canvas_data.get("nodes", [])
        edges = canvas_data.get("edges", [])
        
        llm_configs = self._load_llm_configs(user_id)
        mcp_configs = self._load_mcp_configs(user_id)
        skills_configs = self._load_skills_configs(user_id)
        
        all_mcp_server_ids = set()
        node_map = {n["id"]: n for n in nodes}
        for node in nodes:
            node_data = node.get("data", {})
            mcp_servers = node_data.get("mcp_servers", [])
            for mcp in mcp_servers:
                if isinstance(mcp, str):
                    all_mcp_server_ids.add(mcp)
                elif isinstance(mcp, dict) and mcp.get("id"):
                    all_mcp_server_ids.add(mcp["id"])
        
        # 收集所有Agent配置的mcp_servers
        all_mcp_servers = self._collect_all_mcp_servers(nodes)
        
        # 创建Host层的Client管理器
        from SoloAgent.solo_agent.compiler.mcp_host_client_manager import MCPHostClientManager
        mcp_client_manager = MCPHostClientManager()
        
        if all_mcp_servers:
            register_result = await mcp_client_manager.register_servers(
                all_mcp_servers, 
                user_id=user_id
            )
            logger.info(
                f"[Compiler] MCP servers registered: "
                f"{register_result['connected']}/{register_result['total']} connected"
            )
        
        compilation_order = self._calculate_compilation_order(nodes, edges)
        
        edge_map = self._compile_edges(edges)
        
        agents: Dict[str, SoloAgent] = {}
        orchestrator_id: Optional[str] = None
        
        for node_id in compilation_order:
            node = node_map.get(node_id)
            if not node:
                continue
            
            # 为每个Agent创建其专属的mcp_servers_info（引用Host的Client）
            node_data = node.get("data", {})
            agent_mcp_server_ids = node_data.get("mcp_servers", [])
            agent_mcp_servers_info = {}
            
            if agent_mcp_server_ids and mcp_client_manager:
                agent_mcp_servers_info = self._create_agent_server_info(
                    agent_mcp_server_ids,
                    mcp_client_manager
                )
                logger.info(
                    f"[Compiler] Agent '{node_id}' configured with "
                    f"{len(agent_mcp_servers_info)} MCP servers"
                )
            
            agent = await self._compile_node(
                node=node,
                user_id=user_id,
                agentic_flow_id=agentic_flow_id,
                session_id=session_id,
                run_project_id=run_project_id,
                llm_configs=llm_configs,
                mcp_configs=mcp_configs,
                skills_configs=skills_configs,
                canvas_data=canvas_data,
                mcp_servers_info=agent_mcp_servers_info,
            )
            agents[agent.agent_id] = agent

            if node.get("data", {}).get("agentType") == "orchestrator":
                orchestrator_id = agent.agent_id
            
            subagent_ids = edge_map.get(agent.agent_id, [])
            if subagent_ids:
                subagents = {}
                subagents_info = []
                for sid in subagent_ids:
                    if sid in agents:
                        sub_agent = agents[sid]
                        subagents[sid] = sub_agent
                        subagent_desc = sub_agent.config.desc if sub_agent.config.desc else (
                            sub_agent.config.system_prompt[:100] if sub_agent.config.system_prompt else f"SubAgent: {sub_agent.config.name}"
                        )
                        subagents_info.append({
                            "subagent_name": sub_agent.config.name,
                            "subagent_id": sub_agent.agent_id,
                            "description": subagent_desc
                        })
                if subagents:
                    agent.set_subagents(subagents, subagents_info)
                    logger.info(f"[SubAgents] Agent '{agent.config.name}' has subagents: {[s['subagent_name'] for s in subagents_info]}")
        
        compiled_flow = CompiledFlow(
            agents=agents,
            edges=edge_map,
            orchestrator_id=orchestrator_id,
            agentic_flow_id=agentic_flow_id,
            session_id=session_id,
            user_id=user_id,
            run_project_id=run_project_id,
            mcp_client_manager=mcp_client_manager,
        )
        
        if use_cache:
            CompiledFlowFactory.create(user_id, agentic_flow_id, session_id, run_project_id, compiled_flow)
            CompiledFlowFactory.register_user(user_id, agentic_flow_id, session_id, run_project_id, user_id)
        
        if register_gateway:
            self._register_to_gateway(agentic_flow_id, compiled_flow)
        
        logger.info(
            f"Compiled AgenticFlow with {len(agents)} agents, "
            f"orchestrator: {orchestrator_id}"
        )
        
        return compiled_flow
    
    def _collect_all_mcp_servers(self, nodes: List[Dict]) -> Dict[str, Dict]:
        """收集所有Agent配置的mcp_servers的并集
        
        Args:
            nodes: 节点列表
        
        Returns:
            Dict[str, Dict]: 所有mcp_servers的并集
                {"server_name": {"id": "..."}, ...}
        """
        all_servers = {}
        
        from app.core.database import get_db_context, MCPServerModel
        
        for node in nodes:
            node_data = node.get("data", {})
            mcp_servers = node_data.get("mcp_servers", [])
            
            for server_id in mcp_servers:
                # 从数据库获取服务器信息
                with get_db_context() as db:
                    server = db.query(MCPServerModel).filter(
                        MCPServerModel.id == server_id
                    ).first()
                    if server:
                        all_servers[server.name] = {"id": server_id}
        
        return all_servers
    
    def _create_agent_server_info(
        self,
        agent_mcp_servers: List[str],
        client_manager: "MCPHostClientManager"
    ) -> Dict[str, "MCPServerInfo"]:
        """为Agent创建MCPServerInfo(引用Host的Client)
        
        Args:
            agent_mcp_servers: Agent配置的mcp_server ID列表
            client_manager: Host层Client管理器
        
        Returns:
            Dict[str, MCPServerInfo]: Agent的server_info字典
        """
        from SoloAgent.plugins.tools.agent.mcp import MCPServerInfo
        
        server_info = {}
        all_configs = client_manager.get_all_server_configs()
        
        for server_id in agent_mcp_servers:
            # 查找对应的server_name
            server_name = None
            for name, config in all_configs.items():
                if config.get("id") == server_id:
                    server_name = name
                    break
            
            if not server_name:
                logger.warning(f"[Compiler] Server '{server_id}' not found in Host manager")
                continue
            
            # 获取Host层的Client
            client = client_manager.get_client(server_name)
            config = client_manager.get_server_config(server_name)
            
            if not client or not config:
                logger.warning(f"[Compiler] Client for '{server_name}' not available")
                continue
            
            # 创建MCPServerInfo，引用Host的Client
            server_info[server_name] = MCPServerInfo(
                server_id=config["id"],
                server_name=server_name,
                server_description=config.get("description", ""),
                tools=config.get("tools", []),
                resources=config.get("resources", []),
                prompts=config.get("prompts", []),
                client=client,
                is_connected=True,
            )
        
        return server_info
    
    def _load_llm_configs(self, user_id: str) -> Dict[str, Any]:
        """从数据库加载用户的 LLM 配置"""
        try:
            from app.core.database import db_manager, get_db_context
            with get_db_context() as db:
                configs = db_manager.get_llm_configs(db, user_id)
                return {config.id: config for config in configs}
        except Exception as e:
            logger.warning(f"Failed to load LLM configs: {e}")
            return {}
    
    def _load_mcp_configs(self, user_id: str) -> Dict[str, Any]:
        """从数据库加载用户的 MCP 配置
        
        注意：需要在会话关闭前预加载所有关联数据（sse_config, stdio_config），
        否则在会话关闭后访问这些属性会导致懒加载失败。
        """
        try:
            from app.core.database import mcp_db_manager, get_db_context, MCPServerModel
            from sqlalchemy.orm import joinedload
            with get_db_context() as db:
                # 使用 joinedload 预加载关联数据，避免懒加载问题
                from sqlalchemy import or_
                servers = db.query(MCPServerModel).options(
                    joinedload(MCPServerModel.sse_config),
                    joinedload(MCPServerModel.stdio_config),
                    joinedload(MCPServerModel.http_config)
                ).filter(
                    or_(
                        MCPServerModel.is_public == True,
                        MCPServerModel.user_id == user_id
                    )
                ).order_by(MCPServerModel.created_at.desc()).all()
                
                # 在会话内访问所有需要的属性，确保数据被加载
                for server in servers:
                    _ = server.sse_config
                    _ = server.stdio_config
                    _ = server.http_config
                    _ = server.tools
                
                return {server.id: server for server in servers}
        except Exception as e:
            logger.warning(f"Failed to load MCP configs: {e}")
            return {}
    
    def _load_skills_configs(self, user_id: str) -> Dict[str, Any]:
        """从数据库加载用户的 Skills 配置"""
        try:
            from app.core.database import db_manager, get_db_context
            with get_db_context() as db:
                skills = db_manager.get_all_skills_for_user(db, user_id)
                return {skill.id: skill for skill in skills}
        except Exception as e:
            logger.warning(f"Failed to load Skills configs: {e}")
            return {}
    
    def _get_work_dir(self, user_id: str, agentic_flow_id: str = None) -> Optional[str]:
        """获取用户的活动项目工作目录"""
        try:
            from app.core.database import db_manager, get_db_context
            with get_db_context() as db:
                project = db_manager.get_active_run_project(db, user_id, agentic_flow_id)
                if project:
                    return project.folder_path
        except Exception as e:
            logger.warning(f"Failed to get work_dir: {e}")
        return None
    
    def _build_system_prompt_with_project_path(
        self,
        base_prompt: str,
        user_id: str,
        agentic_flow_id: str = None,
    ) -> str:
        """构建包含项目路径信息的 system prompt
        
        在原始 system_prompt 基础上追加项目路径信息（XML格式），
        与 skill、MCP 工具的 XML 格式保持统一，使 LLM 能够感知
        当前工作目录并提供更精准的文件操作。
        
        Args:
            base_prompt: 原始 system_prompt（来自节点配置）
            user_id: 用户ID
            agentic_flow_id: 流程ID
            
        Returns:
            str: 拼接后的完整 system_prompt
        """
        work_dir = self._get_work_dir(user_id, agentic_flow_id)
        
        if not work_dir:
            return base_prompt
        
        # XML格式，与 skill、MCP 工具格式统一
        project_path_section = f"""\n<env>
Working Directory: {work_dir}
</env>"""
        
        return base_prompt + project_path_section
    
    def _register_to_gateway(self, agentic_flow_id: str, compiled_flow: CompiledFlow) -> None:
        """注册编译后的 Flow 到网关"""
        try:
            from app.core.agenticflow_gateway import agenticflow_gateway
            agenticflow_gateway.register_compiled_flow(agentic_flow_id, compiled_flow)
            logger.info(f"Registered AgenticFlow to gateway: {agentic_flow_id}")
        except Exception as e:
            logger.warning(f"Failed to register to gateway: {e}")
    
    async def _compile_node(
        self,
        node: Dict[str, Any],
        user_id: str,
        agentic_flow_id: str,
        session_id: str = None,
        run_project_id: str = None,
        llm_configs: Dict[str, Any] = None,
        mcp_configs: Dict[str, Any] = None,
        skills_configs: Dict[str, Any] = None,
        canvas_data: Dict[str, Any] = None,
        mcp_servers_info: Dict[str, Any] = None,
    ) -> SoloAgent:
        """编译单个节点为 Agent
        
        Args:
            node: 节点数据
            user_id: 用户ID
            agentic_flow_id: AgenticFlow ID
            session_id: 会话ID
            run_project_id: 项目ID
            llm_configs: LLM配置字典
            mcp_configs: MCP配置字典
            skills_configs: Skills配置字典
            canvas_data: 画布数据
            mcp_servers_info: MCP服务器信息字典（编译阶段已建立连接）
        
        Returns:
            SoloAgent: 编译后的Agent实例
        """
        node_id = node.get("id")
        node_data = node.get("data", {})
        
        model_config = node_data.get("model_config", {})
        llm_config_id = node_data.get("llm_config_id")
        
        provider = model_config.get("provider", "openai")
        model = model_config.get("model", "gpt-4")
        api_key = model_config.get("api_key")
        base_url = model_config.get("base_url")
        max_tokens = model_config.get("max_tokens", 4096)
        temperature = model_config.get("temperature", 0.7)
        frequency_penalty = model_config.get("frequency_penalty", 0.5)
        presence_penalty = model_config.get("presence_penalty", 0.5)
        
        from app.core.database import encryption_service
        
        if not llm_config_id:
            raise ValueError(
                f"节点 '{node_data.get('name', node_id)}' 未配置 LLM 模型。"
                f"请在画布中为该节点选择 LLM 配置后重新保存。"
            )
        
        if llm_config_id not in llm_configs:
            raise ValueError(
                f"节点 '{node_data.get('name', node_id)}' 的 LLM 配置 (ID: {llm_config_id}) 不存在或已被删除。"
                f"请在「设置 > LLM配置」中检查配置，或在画布中重新选择模型。"
            )
        
        config = llm_configs[llm_config_id]
        provider = config.provider
        model = config.model_name
        if config.base_url:
            base_url = config.base_url
        if config.api_key:
            api_key = encryption_service.decrypt(config.api_key)
        logger.info(f"Using LLM config from agenticflow.json: {config.name} ({provider}/{model}), config_id={llm_config_id}")
        
        if not api_key:
            raise ValueError(
                f"未配置 LLM API Key。请在设置中配置模型（节点: {node_data.get('name', node_id)}）。"
                f"您可以在「设置 > LLM配置」中添加 API Key。"
            )
        
        skills = node_data.get("skills", [])
        enriched_skills = []
        for skill in skills:
            if isinstance(skill, str):
                skill_dict = {"id": skill, "name": skill}
                if skills_configs and skill in skills_configs:
                    skill_config = skills_configs[skill]
                    skill_dict["name"] = skill_config.name
                    skill_dict["description"] = getattr(skill_config, "description", "")
                    rel_folder_path = getattr(skill_config, "folder_path", None)
                    if rel_folder_path:
                        from app.core.data_paths import DataPaths
                        skill_dict["folder_path"] = DataPaths.to_absolute_path(rel_folder_path)
                    else:
                        skill_dict["folder_path"] = None
                    skill_dict["instructions"] = getattr(skill_config, "instructions", None)
                    skill_dict["tools"] = getattr(skill_config, "tools", [])
                enriched_skills.append(skill_dict)
            elif isinstance(skill, dict):
                enriched_skills.append(skill)
        
        mcp_servers = node_data.get("mcp_servers", [])
        logger.info(f"[MCP NODE DEBUG] node_id={node.get('id')}, mcp_servers={mcp_servers}")
        logger.info(f"[MCP NODE DEBUG] mcp_configs keys={list(mcp_configs.keys()) if mcp_configs else []}")
        logger.info(f"[MCP NODE DEBUG] mcp_servers_info keys={list(mcp_servers_info.keys()) if mcp_servers_info else []}")
        node_mcp_servers_info = {}
        for mcp in mcp_servers:
            if isinstance(mcp, str):
                server_name = mcp
                if mcp_configs and mcp in mcp_configs:
                    server_name = mcp_configs[mcp].name
                    logger.info(f"[MCP NODE DEBUG] Found server_name={server_name} for mcp_id={mcp}")
                else:
                    logger.warning(f"[MCP NODE DEBUG] mcp_id={mcp} not in mcp_configs")
            elif isinstance(mcp, dict):
                server_name = mcp.get("name", mcp.get("id"))
            else:
                continue
            
            if mcp_servers_info and server_name in mcp_servers_info:
                node_mcp_servers_info[server_name] = mcp_servers_info[server_name]
                logger.info(f"[MCP NODE DEBUG] Added {server_name} to node_mcp_servers_info")
            else:
                logger.warning(f"[MCP NODE DEBUG] server_name={server_name} not in mcp_servers_info")
        
        logger.info(f"[MCP NODE DEBUG] Final node_mcp_servers_info keys={list(node_mcp_servers_info.keys())}")
        
        raw_tools = node_data.get("tools", [])
        tool_name_map = {
            "read_file": "Read",
            "write_file": "Write",
            "delete_file": "DeleteFile",
            "ls": "LS",
            "search_replace": "SearchReplace",
            "grep": "Grep",
            "glob": "Glob",
            "search_codebase": "SearchCodebase",
            "run_command": "RunCommand",
            "check_command_status": "CheckCommandStatus",
            "stop_command": "StopCommand",
            "get_diagnostics": "GetDiagnostics",
            "web_fetch": "WebFetch",
            "web_search": "WebSearch",
            "skill": "Skill",
            "task": "Task",
            "mcp": "MCP",
            "todo_write": "TodoWrite",
            "ask_user_question": "AskUserQuestion",
            "open_preview": "OpenPreview",
            "exit_plan_mode": "ExitPlanMode",
        }
        mapped_tools = set(tool_name_map.values())
        tools = []
        for t in raw_tools:
            if t in mapped_tools:
                tools.append(t)
            else:
                tools.append(tool_name_map.get(t, t))
        logger.info(f"[FlowCompiler] Raw tools: {raw_tools} -> Mapped tools: {tools}")
        
        config = SoloAgentConfig(
            name=node_data.get("name", "Agent"),
            provider=provider,
            model=model,
            api_key=api_key,
            base_url=base_url,
            system_prompt=self._build_system_prompt_with_project_path(
                base_prompt=node_data.get("system_prompt", ""),
                user_id=user_id,
                agentic_flow_id=agentic_flow_id,
            ),
            desc=node_data.get("desc", ""),
            skills=enriched_skills,
            tools=tools,
            mcp_servers=node_mcp_servers_info,
            subagents=[],
            memory=node_data.get("memory", True),
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
            run_project_id=run_project_id,
            agent_id=node_id,
            session_id=session_id,
            max_memory_length=node_data.get("max_memory_length"),
            max_iters=(
                (canvas_data or {}).get("globalSettings", {}).get("maxIterations")
                or node_data.get("max_iters")
                or settings.DEFAULT_MAX_ITERS
            ),
            stream=node_data.get("stream", True),
            agent_type=node_data.get("agentType", "executor"),
            work_dir=self._get_work_dir(user_id, agentic_flow_id),
            max_tokens=max_tokens,
            temperature=temperature,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
            _llm_config_id=llm_config_id,
            _llm_config_version=config.version if config else None,
        )
        
        agent = SoloAgent(config)
        agent._mcp_servers_info = node_mcp_servers_info
        logger.info(f"[MCP NODE DEBUG] Assigned node_mcp_servers_info to agent: {list(node_mcp_servers_info.keys()) if node_mcp_servers_info else 'EMPTY'}")
        return agent
    
    def _compile_edges(self, edges: List[Dict[str, Any]]) -> Dict[str, List[str]]:
        """编译边关系
        
        Returns:
            Dict[str, List[str]]: 源节点 ID -> 目标节点 ID 列表的映射
        """
        edge_map: Dict[str, List[str]] = {}
        
        for edge in edges:
            source = edge.get("source")
            target = edge.get("target")
            
            if source and target:
                if source not in edge_map:
                    edge_map[source] = []
                edge_map[source].append(target)
        
        return edge_map


class FlowRunner:
    """工作流运行器，提供简化的执行接口"""
    
    @staticmethod
    async def run_from_json(
        json_data: Dict[str, Any], 
        input_message: str,
        user_id: str = None,
        agentic_flow_id: str = None,
        session_id: str = None,
        run_project_id: str = None,
        context: Dict[str, Any] = None,
        event_callback: Callable[[ExecutionEvent], None] = None,
        stream_callback: Callable[[dict], None] = None,
        agent_memories: Dict[str, List[Dict]] = None,
        cancel_event: asyncio.Event = None,
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
            use_cache=False,  # 强制重新编译以加载MCP工具
        )
        
        if event_callback:
            compiled_flow.set_event_callback(event_callback)
        
        if stream_callback:
            compiled_flow.set_stream_callback(stream_callback)
        
        if agent_memories:
            compiled_flow.set_agent_memories(agent_memories)
        
        execution_lock = CompiledFlowFactory.get_execution_lock(user_id, agentic_flow_id, session_id, run_project_id)
        if execution_lock:
            async with execution_lock:
                return await compiled_flow.run(input_message, context, cancel_event=cancel_event)
        else:
            return await compiled_flow.run(input_message, context, cancel_event=cancel_event)
    
    @staticmethod
    async def run_node(
        json_data: Dict[str, Any], 
        node_id: str,
        input_message: str,
        user_id: str = None,
        agentic_flow_id: str = None,
        session_id: str = None,
        run_project_id: str = None,
        context: Dict[str, Any] = None,
        agent_memories: Dict[str, List[Dict]] = None,
        cancel_event: asyncio.Event = None,
    ) -> Dict[str, Any]:
        """运行指定节点"""
        from app.core.database import db_manager, get_db_context
        from datetime import datetime, timezone
        
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
        
        if agent_memories:
            compiled_flow.set_agent_memories(agent_memories)
        
        if not agent._initialized:
            await agent.initialize()

        if hasattr(agent, 'set_stream_callback'):
            agent.set_stream_callback(compiled_flow._stream_callback)
        
        start_time = datetime.now()
        error_message = None
        try:
            response = await agent.reply(input_message)
        except Exception as e:
            error_message = str(e)
            logger.error(f"Error during agent reply: {error_message}")
            response = f"Error: {error_message}"
        end_time = datetime.now()
        
        if error_message:
            if session_id:
                duration_ms = int((end_time - start_time).total_seconds() * 1000)
                with get_db_context() as db:
                    db_manager.update_session(
                        db, session_id,
                        status="failed",
                        duration_ms=duration_ms,
                        error_message=error_message,
                        completed_at=datetime.now(timezone.utc)
                    )
            
            return {
                "agent_id": node_id,
                "agent_name": agent.name,
                "output": response,
                "status": "failed",
                "error": error_message
            }
        
        openai_message = agent.get_last_openai_message() if hasattr(agent, 'get_last_openai_message') else {"content": response}
        
        tokens = None
        try:
            if hasattr(agent, '_last_response') and agent._last_response and hasattr(agent._last_response, 'usage') and agent._last_response.usage:
                usage = agent._last_response.usage
                tokens = {
                    "prompt_tokens": getattr(usage, 'input_tokens', None),
                    "completion_tokens": getattr(usage, 'output_tokens', None),
                    "total_tokens": (getattr(usage, 'input_tokens', 0) or 0) + (getattr(usage, 'output_tokens', 0) or 0)
                }
        except Exception as e:
            logger.error(f"Error getting token usage: {e}")
        
        if session_id:
            duration_ms = int((end_time - start_time).total_seconds() * 1000)
            with get_db_context() as db:
                db_manager.update_session(
                    db, session_id,
                    status="completed",
                    duration_ms=duration_ms,
                    token_usage=tokens,
                    completed_at=datetime.now(timezone.utc)
                )
        
        return {
            "agent_id": node_id,
            "agent_name": agent.name,
            "output": response,
            "status": "completed",
            "message": openai_message,
            "tokens": tokens
        }
    
    @staticmethod
    async def stream_run_from_json(
        json_data: Dict[str, Any], 
        input_message: str,
        user_id: str = None,
        agentic_flow_id: str = None,
        session_id: str = None,
        run_project_id: str = None,
        context: Dict[str, Any] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式运行 JSON 格式的工作流
        
        Args:
            json_data: 画布 JSON 数据
            input_message: 输入消息
            user_id: 用户 ID（必需）
            agentic_flow_id: AgenticFlow ID（必需）
            session_id: 会话 ID（必需）
            run_project_id: 项目 ID（必需）
            context: 执行上下文
            
        Yields:
            执行事件字典
        """
        events_queue = asyncio.Queue()
        
        def event_callback(event: ExecutionEvent):
            asyncio.create_task(events_queue.put(event))
        
        async def run_flow():
            try:
                result = await FlowRunner.run_from_json(
                    json_data, input_message, user_id, agentic_flow_id, session_id, run_project_id, context,
                    event_callback=event_callback
                )
                await events_queue.put({"type": "final_result", "data": result})
            except Exception as e:
                await events_queue.put({"type": "error", "error": str(e)})
        
        asyncio.create_task(run_flow())
        
        while True:
            event = await events_queue.get()
            
            if isinstance(event, dict):
                if event.get("type") == "final_result":
                    yield event
                    break
                elif event.get("type") == "error":
                    yield event
                    break
                yield event
            elif isinstance(event, ExecutionEvent):
                yield {
                    "type": event.event_type,
                    "data": {
                        "agent_id": event.agent_id,
                        "agent_name": event.agent_name,
                        "content": event.content,
                        "tool_name": event.tool_name,
                        "tool_args": event.tool_args,
                        "tool_result": event.tool_result,
                        "skill_name": event.skill_name,
                        "skill_args": event.skill_args,
                        "skill_result": event.skill_result,
                        "mcp_name": event.mcp_name,
                        "mcp_args": event.mcp_args,
                        "mcp_result": event.mcp_result,
                        "subagent_id": event.subagent_id,
                        "subagent_name": event.subagent_name,
                        "status": event.status,
                        "error": event.error,
                        "timestamp": event.timestamp,
                        "metadata": event.metadata
                    }
                }
