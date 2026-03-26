"""
AgenticFlow 编译器
将画布 JSON 编译为可执行的多智能体系统

功能增强：
- 网关注册集成
- 并发处理机制
- 流式输出回调支持
- 完整数据库持久化
- 自动加载 LLM/MCP/Skills 配置
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
    """执行事件数据类"""
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
    """编译后的 AgenticFlow"""
    
    def __init__(
        self,
        agents: Dict[str, SoloAgent],
        edges: Dict[str, List[str]],
        orchestrator_id: Optional[str] = None,
        agentic_flow_id: str = None,
        session_id: str = None,
        user_id: str = None,
        run_project_id: str = None,
    ):
        self.agents = agents
        self.edges = edges
        self.orchestrator_id = orchestrator_id
        self.agentic_flow_id = agentic_flow_id
        self.session_id = session_id
        self.user_id = user_id
        self.run_project_id = run_project_id
        self._start_time: Optional[datetime] = None
        self._token_usage: Dict[str, int] = {}
        self._event_callback: Optional[Callable[[ExecutionEvent], None]] = None
        self._stream_callback: Optional[Callable[[str], None]] = None
        self._agent_memories: Dict[str, List[Dict]] = {}
        self._created_time: float = time.time()
    
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
        """运行 AgenticFlow，返回完整执行结果"""
        context = context or {}
        self._start_time = datetime.now()
        
        logger.info(f"[CompiledFlow.run] Starting run with session_id={self.session_id}, user_id={self.user_id}, run_project_id={self.run_project_id}, agentic_flow_id={self.agentic_flow_id}")
        
        from app.core.database import db_manager, get_db_context
        
        self._emit_event(ExecutionEvent(
            event_type="execution_start",
            content=input_message,
            metadata={"agentic_flow_id": self.agentic_flow_id, "user_id": self.user_id, "session_id": self.session_id, "run_project_id": self.run_project_id}
        ))
        
        with get_db_context() as db:
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
        
        agent_memory = self._agent_memories.get(agent_id, [])
        if agent_memory and hasattr(agent, 'set_message_history'):
            agent.set_message_history(agent_memory)
        
        if not agent._initialized:
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
                logger.info(f"Using cached CompiledFlow for key: {user_id}:{agentic_flow_id}:{session_id}:{run_project_id}")
                CompiledFlowFactory.register_user(user_id, agentic_flow_id, session_id, run_project_id, user_id)
                cached.session_id = session_id
                cached.run_project_id = run_project_id
                cached.user_id = user_id
                cached.agentic_flow_id = agentic_flow_id
                return cached
        
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
            mcp_tools = node_data.get("mcp_tools", [])
            for mcp in mcp_tools:
                if isinstance(mcp, str):
                    all_mcp_server_ids.add(mcp)
                elif isinstance(mcp, dict) and mcp.get("id"):
                    all_mcp_server_ids.add(mcp["id"])
        
        mcp_servers_info = {}
        if all_mcp_server_ids:
            mcp_servers_info = await self._build_mcp_servers_info(
                list(all_mcp_server_ids), mcp_configs
            )
        
        compilation_order = self._calculate_compilation_order(nodes, edges)
        
        edge_map = self._compile_edges(edges)
        
        agents: Dict[str, SoloAgent] = {}
        orchestrator_id: Optional[str] = None
        
        for node_id in compilation_order:
            node = node_map.get(node_id)
            if not node:
                continue
            
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
                mcp_servers_info=mcp_servers_info,
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
                        subagents_info.append({
                            "subagent_name": sub_agent.config.name,
                            "subagent_id": sub_agent.agent_id,
                            "description": sub_agent.config.system_prompt[:100] if sub_agent.config.system_prompt else f"SubAgent: {sub_agent.config.name}"
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
        """从数据库加载用户的 MCP 配置"""
        try:
            from mcp_service.database import mcp_db_manager, get_db_context as get_mcp_db_context
            with get_mcp_db_context() as db:
                servers = mcp_db_manager.get_servers(db, user_id)
                return {server.id: server for server in servers}
        except Exception as e:
            logger.warning(f"Failed to load MCP configs: {e}")
            return {}
    
    async def _build_mcp_servers_info(
        self,
        mcp_server_ids: List[str],
        mcp_configs: Dict[str, Any]
    ) -> Dict[str, Any]:
        """编译阶段建立MCP连接并组装mcp_servers_info
        
        Args:
            mcp_server_ids: MCP服务器ID列表
            mcp_configs: MCP配置字典
        
        Returns:
            Dict[str, MCPServerInfo]: mcp_servers_info字典
        """
        from ..plugins.tools.agent.mcp import MCPServerInfo
        from ..plugins.mcp.mcp_client import MCPClient
        
        mcp_servers_info: Dict[str, MCPServerInfo] = {}
        
        for server_id in mcp_server_ids:
            if server_id not in mcp_configs:
                logger.warning(f"MCP server '{server_id}' not found in configs")
                continue
            
            config = mcp_configs[server_id]
            server_name = config.name
            
            try:
                transport = getattr(config, "transport", "stdio")
                
                client_config = {
                    "transport": transport,
                    "timeout": getattr(config, "timeout", 30),
                }
                
                if transport == "stdio":
                    client_config["command"] = getattr(config, "command", None)
                    client_config["args"] = getattr(config, "args", []) or []
                    client_config["env"] = getattr(config, "env", {}) or {}
                elif transport in ("sse", "http"):
                    client_config["url"] = getattr(config, "url", "")
                    client_config["headers"] = getattr(config, "headers", {}) or {}
                
                client = MCPClient(client_config)
                await client.connect()
                
                tools = await client.get_tools()
                resources = await client.get_resources()
                prompts = await client.get_prompts()
                
                server_info = MCPServerInfo(
                    server_id=server_id,
                    server_name=server_name,
                    server_description=getattr(config, "description", ""),
                    tools=tools,
                    resources=resources,
                    prompts=prompts,
                    client=client,
                    is_connected=True,
                )
                
                mcp_servers_info[server_name] = server_info
                logger.info(f"[MCP] Connected to '{server_name}' with {len(tools)} tools")
                
            except Exception as e:
                logger.warning(f"[MCP] Failed to connect to '{server_name}': {e}")
                
                server_info = MCPServerInfo(
                    server_id=server_id,
                    server_name=server_name,
                    server_description=getattr(config, "description", ""),
                    tools=[],
                    resources=[],
                    prompts=[],
                    client=None,
                    is_connected=False,
                )
                mcp_servers_info[server_name] = server_info
        
        return mcp_servers_info
    
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
        
        from app.core.database import encryption_service
        
        if llm_config_id and llm_configs and llm_config_id in llm_configs:
            config = llm_configs[llm_config_id]
            provider = config.provider
            model = config.model_name
            if config.base_url:
                base_url = config.base_url
            if config.api_key:
                api_key = encryption_service.decrypt(config.api_key)
        elif llm_configs:
            default_config = None
            for cfg in llm_configs.values():
                if getattr(cfg, 'is_default', False):
                    default_config = cfg
                    break
            
            if default_config:
                provider = default_config.provider
                model = default_config.model_name
                if default_config.base_url:
                    base_url = default_config.base_url
                if default_config.api_key:
                    api_key = encryption_service.decrypt(default_config.api_key)
                logger.info(f"Using default LLM config: {default_config.name} ({provider}/{model})")
        
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
        
        mcp_tools = node_data.get("mcp_tools", [])
        node_mcp_servers_info = {}
        for mcp in mcp_tools:
            if isinstance(mcp, str):
                server_name = mcp
                if mcp_configs and mcp in mcp_configs:
                    server_name = mcp_configs[mcp].name
            elif isinstance(mcp, dict):
                server_name = mcp.get("name", mcp.get("id"))
            else:
                continue
            
            if mcp_servers_info and server_name in mcp_servers_info:
                node_mcp_servers_info[server_name] = mcp_servers_info[server_name]
        
        raw_tools = node_data.get("tools", [])
        tool_name_map = {
            "read_file": "Read",
            "write_file": "Write",
            "delete_file": "DeleteFile",
            "ls": "LS",
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
            "todo_write": "TodoWrite",
            "ask_user_question": "AskUserQuestion",
            "open_preview": "OpenPreview",
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
            system_prompt=node_data.get("system_prompt", ""),
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
        )
        
        agent = SoloAgent(config)
        agent._mcp_servers_info = node_mcp_servers_info
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
