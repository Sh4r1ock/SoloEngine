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
import uuid
import logging
import time
import asyncio
import json
from typing import Dict, Any, List, Optional, Callable, AsyncGenerator
from collections import OrderedDict
from threading import Lock
from datetime import datetime
from dataclasses import dataclass, field

from ..config import SoloAgentConfig
from ..agent import SoloAgent

logger = logging.getLogger(__name__)


@dataclass
class ExecutionEvent:
    """执行事件数据类"""
    event_type: str
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    agent_type: Optional[str] = None
    content: Optional[str] = None
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[str] = None
    skill_name: Optional[str] = None
    skill_args: Optional[Dict[str, Any]] = None
    skill_result: Optional[str] = None
    mcp_name: Optional[str] = None
    mcp_args: Optional[Dict[str, Any]] = None
    mcp_result: Optional[str] = None
    child_agent_id: Optional[str] = None
    child_agent_name: Optional[str] = None
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
        flow_id: str = None,
        run_id: str = None,
        user_id: str = None,
    ):
        self.agents = agents
        self.edges = edges
        self.orchestrator_id = orchestrator_id
        self.flow_id = flow_id
        self.run_id = run_id
        self.user_id = user_id
        self._start_time: Optional[datetime] = None
        self._token_usage: Dict[str, int] = {}
        self._event_callback: Optional[Callable[[ExecutionEvent], None]] = None
        self._stream_callback: Optional[Callable[[str], None]] = None
    
    def set_event_callback(self, callback: Callable[[ExecutionEvent], None]):
        """设置事件回调函数"""
        self._event_callback = callback
    
    def set_stream_callback(self, callback: Callable[[str], None]):
        """设置流式输出回调函数"""
        self._stream_callback = callback
    
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
    
    def get_child_agents(self, agent_id: str) -> List[SoloAgent]:
        child_ids = self.edges.get(agent_id, [])
        return [self.agents[aid] for aid in child_ids if aid in self.agents]
    
    def get_entry_nodes(self) -> List[str]:
        target_nodes = set()
        for child_ids in self.edges.values():
            target_nodes.update(child_ids)
        return [node_id for node_id in self.agents.keys() if node_id not in target_nodes]
    
    async def run(self, input_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """运行 AgenticFlow，返回完整执行结果"""
        context = context or {}
        self._start_time = datetime.now()
        
        from app.core.database import db_manager, get_db_context
        
        self._emit_event(ExecutionEvent(
            event_type="execution_start",
            content=input_message,
            metadata={"flow_id": self.flow_id, "user_id": self.user_id}
        ))
        
        with get_db_context() as db:
            if self.flow_id:
                run = db_manager.create_run(
                    db,
                    flow_id=self.flow_id,
                    user_id=self.user_id or "default_user",
                    input_message=input_message
                )
                self.run_id = run.id
                
                for agent in self.agents.values():
                    if hasattr(agent.config, 'agentic_flow_run_id'):
                        agent.config.agentic_flow_run_id = self.run_id
                    
                    if agent.config.memory and hasattr(agent, '_init_memory'):
                        agent._memory_plugin = None
                        agent._message_history = []
                        agent._initialized = False
            
            orchestrator = self.get_orchestrator()
            
            if orchestrator is None:
                if len(self.agents) == 1:
                    agent = list(self.agents.values())[0]
                    result = await self._execute_agent(agent, input_message, db, context)
                    return result
                else:
                    entry_nodes = self.get_entry_nodes()
                    if not entry_nodes:
                        entry_nodes = list(self.agents.keys())
                    
                    results = {}
                    for entry_id in entry_nodes:
                        agent = self.agents.get(entry_id)
                        if agent:
                            result = await self._execute_agent(agent, input_message, db, context)
                            results[entry_id] = result
                    
                    output = self._aggregate_results(results)
                    
                    end_time = datetime.now()
                    duration_ms = int((end_time - self._start_time).total_seconds() * 1000)
                    
                    if self.run_id:
                        db_manager.update_run(
                            db, self.run_id,
                            status="completed",
                            output_message=output,
                            duration_ms=duration_ms,
                            token_usage=self._token_usage if self._token_usage else None
                        )
                    
                    self._emit_event(ExecutionEvent(
                        event_type="execution_complete",
                        content=output,
                        metadata={"duration_ms": duration_ms}
                    ))
                    
                    return {
                        "run_id": self.run_id,
                        "agentic_flow_id": self.flow_id,
                        "status": "completed",
                        "output": output,
                        "node_results": results,
                        "duration_ms": duration_ms,
                        "token_usage": self._token_usage
                    }
            
            result = await self._execute_agent(orchestrator, input_message, db, context)
            return result
    
    async def _execute_agent(
        self, 
        agent: SoloAgent, 
        input_message: str,
        db,
        context: Dict[str, Any]
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
        
        db_manager.add_execution_step(
            db,
            execution_id=self.run_id,
            step_type="agent_execution",
            node_id=agent_id,
            node_name=agent_name
        )
        
        if self._stream_callback and hasattr(agent, 'set_stream_callback'):
            agent.set_stream_callback(self._stream_callback)
        
        if not agent._initialized:
            await agent.initialize()
        
        try:
            original_reply = agent.reply
            
            async def wrapped_reply(message: str) -> str:
                response = await original_reply(message)
                
                if hasattr(agent, '_last_tool_calls') and agent._last_tool_calls:
                    for tool_call in agent._last_tool_calls:
                        tool_name = tool_call.get("name")
                        if not tool_name:
                            continue  # 跳过无效的工具调用
                        
                        self._emit_event(ExecutionEvent(
                            event_type="tool_call",
                            agent_id=agent_id,
                            agent_name=agent_name,
                            tool_name=tool_name,
                            tool_args=tool_call.get("args"),
                            tool_result=tool_call.get("result")
                        ))
                        
                        db_manager.add_tool_call(
                            db,
                            run_id=self.run_id,
                            tool_name=tool_name,
                            arguments=tool_call.get("args"),
                            result=tool_call.get("result")
                        )
                
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
            
            self._emit_stream(response)
            
            end_time = datetime.now()
            duration_ms = int((end_time - self._start_time).total_seconds() * 1000) if self._start_time else 0
            
            # 获取工具调用记录
            tool_calls = []
            if hasattr(agent, '_last_tool_calls') and agent._last_tool_calls:
                tool_calls = agent._last_tool_calls.copy()
            
            result = {
                "agent_id": agent_id,
                "agent_name": agent_name,
                "agent_type": agent.agent_type,
                "user_id": self.user_id,
                "agentic_flow_id": self.flow_id,
                "run_id": self.run_id,
                "output": response,
                "status": "completed",
                "duration_ms": duration_ms,
                "tool_calls": tool_calls
            }
            
            child_ids = self.edges.get(agent_id, [])
            if child_ids:
                child_results = []
                for child_id in child_ids:
                    child_agent = self.agents.get(child_id)
                    if child_agent:
                        self._emit_event(ExecutionEvent(
                            event_type="child_agent_start",
                            agent_id=agent_id,
                            agent_name=agent_name,
                            child_agent_id=child_id,
                            child_agent_name=child_agent.name,
                            content=response
                        ))
                        
                        child_result = await self._execute_agent(
                            child_agent, response, db, context
                        )
                        child_results.append(child_result)
                        
                        self._emit_event(ExecutionEvent(
                            event_type="child_agent_complete",
                            agent_id=agent_id,
                            agent_name=agent_name,
                            child_agent_id=child_id,
                            child_agent_name=child_agent.name,
                            content=child_result.get("output")
                        ))
                result["child_results"] = child_results
            
            self._emit_event(ExecutionEvent(
                event_type="agent_complete",
                agent_id=agent_id,
                agent_name=agent_name,
                content=response,
                status="completed"
            ))
            
            return result
            
        except Exception as e:
            logger.error(f"Agent execution failed: {agent_name} - {e}")
            
            self._emit_event(ExecutionEvent(
                event_type="agent_error",
                agent_id=agent_id,
                agent_name=agent_name,
                error=str(e),
                status="failed"
            ))
            
            if self.run_id:
                db_manager.update_run(
                    db, self.run_id,
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
    """CompiledFlow 工厂，带 LRU 缓存、并发控制和自动清理"""
    
    MAX_INSTANCES = 100
    INSTANCE_TIMEOUT = 3600
    
    _instances: OrderedDict[str, tuple] = OrderedDict()
    _lock = Lock()
    _execution_locks: Dict[str, asyncio.Lock] = {}
    _flow_users: Dict[str, set] = {}
    
    @classmethod
    def create(cls, flow_id: str, compiled_flow: CompiledFlow) -> CompiledFlow:
        with cls._lock:
            cls._cleanup_expired()
            
            if flow_id in cls._instances:
                cls._instances.move_to_end(flow_id)
                compiled_flow, _ = cls._instances[flow_id]
                return compiled_flow
            
            if len(cls._instances) >= cls.MAX_INSTANCES:
                oldest_id = next(iter(cls._instances))
                del cls._instances[oldest_id]
                if oldest_id in cls._execution_locks:
                    del cls._execution_locks[oldest_id]
                if oldest_id in cls._flow_users:
                    del cls._flow_users[oldest_id]
                logger.info(f"Removed oldest CompiledFlow instance: {oldest_id}")
            
            cls._instances[flow_id] = (compiled_flow, time.time())
            
            if flow_id not in cls._execution_locks:
                cls._execution_locks[flow_id] = asyncio.Lock()
            
            if flow_id not in cls._flow_users:
                cls._flow_users[flow_id] = set()
            
            return compiled_flow
    
    @classmethod
    def get(cls, flow_id: str) -> Optional[CompiledFlow]:
        with cls._lock:
            if flow_id in cls._instances:
                cls._instances.move_to_end(flow_id)
                compiled_flow, _ = cls._instances[flow_id]
                return compiled_flow
            return None
    
    @classmethod
    def get_execution_lock(cls, flow_id: str) -> Optional[asyncio.Lock]:
        """获取指定 flow 的执行锁"""
        return cls._execution_locks.get(flow_id)
    
    @classmethod
    def register_user(cls, flow_id: str, user_id: str) -> None:
        """注册用户到 flow"""
        with cls._lock:
            if flow_id not in cls._flow_users:
                cls._flow_users[flow_id] = set()
            cls._flow_users[flow_id].add(user_id)
    
    @classmethod
    def get_flow_users(cls, flow_id: str) -> set:
        """获取 flow 的所有用户"""
        return cls._flow_users.get(flow_id, set())
    
    @classmethod
    def _cleanup_expired(cls):
        current_time = time.time()
        expired_ids = [
            fid for fid, (_, created_time) in cls._instances.items()
            if current_time - created_time > cls.INSTANCE_TIMEOUT
        ]
        for fid in expired_ids:
            del cls._instances[fid]
            if fid in cls._execution_locks:
                del cls._execution_locks[fid]
            if fid in cls._flow_users:
                del cls._flow_users[fid]
            logger.info(f"Removed expired CompiledFlow instance: {fid}")
    
    @classmethod
    def remove(cls, flow_id: str) -> bool:
        with cls._lock:
            if flow_id in cls._instances:
                del cls._instances[flow_id]
                if flow_id in cls._execution_locks:
                    del cls._execution_locks[flow_id]
                if flow_id in cls._flow_users:
                    del cls._flow_users[flow_id]
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
                "instance_timeout": cls.INSTANCE_TIMEOUT,
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
    """
    
    def __init__(self, user_id: str = None):
        self.user_id = user_id
    
    def compile(
        self,
        flow_data: Dict[str, Any],
        user_id: str = None,
        flow_id: str = None,
        use_cache: bool = True,
        register_gateway: bool = True,
    ) -> CompiledFlow:
        """编译 AgenticFlow JSON 为可执行结构
        
        Args:
            flow_data: AgenticFlow JSON 数据
            user_id: 用户 ID
            flow_id: AgenticFlow ID
            use_cache: 是否使用缓存
            register_gateway: 是否注册到网关
            
        Returns:
            CompiledFlow: 编译后的可执行结构
        """
        user_id = user_id or self.user_id
        flow_id = flow_id or flow_data.get("flow_id", str(uuid.uuid4()))
        
        if use_cache:
            cached = CompiledFlowFactory.get(flow_id)
            if cached:
                logger.info(f"Using cached CompiledFlow for flow_id: {flow_id}")
                CompiledFlowFactory.register_user(flow_id, user_id)
                return cached
        
        run_id = str(uuid.uuid4())
        
        canvas_data = flow_data.get("canvas_data", flow_data)
        nodes = canvas_data.get("nodes", [])
        edges = canvas_data.get("edges", [])
        
        llm_configs = self._load_llm_configs(user_id)
        mcp_configs = self._load_mcp_configs(user_id)
        skills_configs = self._load_skills_configs(user_id)
        
        agents: Dict[str, SoloAgent] = {}
        orchestrator_id: Optional[str] = None
        
        for node in nodes:
            agent = self._compile_node(
                node=node,
                user_id=user_id,
                flow_id=flow_id,
                run_id=run_id,
                llm_configs=llm_configs,
                mcp_configs=mcp_configs,
                skills_configs=skills_configs,
            )
            agents[agent.agent_id] = agent
            
            if node.get("data", {}).get("agentType") == "orchestrator":
                orchestrator_id = agent.agent_id
        
        edge_map = self._compile_edges(edges)
        
        for agent_id, child_ids in edge_map.items():
            if agent_id in agents:
                agents[agent_id].config.child_agents = child_ids
                child_agents = {cid: agents[cid] for cid in child_ids if cid in agents}
                agents[agent_id].set_child_agents(child_agents)
        
        compiled_flow = CompiledFlow(
            agents=agents,
            edges=edge_map,
            orchestrator_id=orchestrator_id,
            flow_id=flow_id,
            run_id=run_id,
            user_id=user_id,
        )
        
        if use_cache:
            CompiledFlowFactory.create(flow_id, compiled_flow)
            CompiledFlowFactory.register_user(flow_id, user_id)
        
        if register_gateway:
            self._register_to_gateway(flow_id, compiled_flow)
        
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
    
    def _get_work_dir(self, user_id: str) -> Optional[str]:
        """获取用户的活动项目工作目录"""
        try:
            from app.core.database import db_manager, get_db_context
            with get_db_context() as db:
                project = db_manager.get_active_run_project(db, user_id)
                if project:
                    return project.folder_path
        except Exception as e:
            logger.warning(f"Failed to get work_dir: {e}")
        return None
    
    def _register_to_gateway(self, flow_id: str, compiled_flow: CompiledFlow) -> None:
        """注册编译后的 Flow 到网关"""
        try:
            from app.core.agenticflow_gateway import agenticflow_gateway
            agenticflow_gateway.register_compiled_flow(flow_id, compiled_flow)
            logger.info(f"Registered AgenticFlow to gateway: {flow_id}")
        except Exception as e:
            logger.warning(f"Failed to register to gateway: {e}")
    
    def _compile_node(
        self,
        node: Dict[str, Any],
        user_id: str,
        flow_id: str,
        run_id: str,
        llm_configs: Dict[str, Any] = None,
        mcp_configs: Dict[str, Any] = None,
        skills_configs: Dict[str, Any] = None,
    ) -> SoloAgent:
        """编译单个节点为 Agent"""
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
                    skill_dict["folder_path"] = getattr(skill_config, "folder_path", None)
                    skill_dict["instructions"] = getattr(skill_config, "instructions", None)
                    skill_dict["tools"] = getattr(skill_config, "tools", [])
                enriched_skills.append(skill_dict)
            elif isinstance(skill, dict):
                enriched_skills.append(skill)
        
        mcp_tools = node_data.get("mcp_tools", [])
        enriched_mcp = []
        for mcp in mcp_tools:
            if isinstance(mcp, str):
                mcp_dict = {"id": mcp, "name": mcp}
                if mcp_configs and mcp in mcp_configs:
                    mcp_config = mcp_configs[mcp]
                    mcp_dict["name"] = mcp_config.name
                    mcp_dict["command"] = getattr(mcp_config, "command", None)
                    mcp_dict["args"] = getattr(mcp_config, "args", [])
                    mcp_dict["env"] = getattr(mcp_config, "env", {})
                    mcp_dict["transport"] = getattr(mcp_config, "transport", "stdio")
                enriched_mcp.append(mcp_dict)
            elif isinstance(mcp, dict):
                enriched_mcp.append(mcp)
        
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
        tools = [tool_name_map.get(t, t) for t in raw_tools]
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
            mcp_servers=enriched_mcp,
            child_agents=[],
            memory=node_data.get("memory", False),
            user_id=user_id,
            agentic_flow_id=flow_id,
            agentic_flow_run_id=run_id,
            agent_id=node_id,
            max_iters=node_data.get("max_iters", 10),
            stream=node_data.get("stream", True),
            agent_type=node_data.get("agentType", "executor"),
            work_dir=self._get_work_dir(user_id),
            max_tokens=max_tokens,
            temperature=temperature,
        )
        
        return SoloAgent(config)
    
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
        flow_id: str = None,
        context: Dict[str, Any] = None,
        event_callback: Callable[[ExecutionEvent], None] = None,
        stream_callback: Callable[[str], None] = None,
    ) -> Dict[str, Any]:
        """运行 JSON 格式的工作流
        
        Args:
            json_data: 画布 JSON 数据
            input_message: 输入消息
            user_id: 用户 ID
            flow_id: AgenticFlow ID
            context: 执行上下文
            event_callback: 事件回调函数
            stream_callback: 流式输出回调函数
            
        Returns:
            执行结果
        """
        compiler = AgenticFlowCompiler(user_id=user_id)
        compiled_flow = compiler.compile(json_data, user_id=user_id, flow_id=flow_id)
        
        if event_callback:
            compiled_flow.set_event_callback(event_callback)
        if stream_callback:
            compiled_flow.set_stream_callback(stream_callback)
        
        execution_lock = CompiledFlowFactory.get_execution_lock(flow_id)
        if execution_lock:
            async with execution_lock:
                return await compiled_flow.run(input_message, context)
        else:
            return await compiled_flow.run(input_message, context)
    
    @staticmethod
    async def run_node(
        json_data: Dict[str, Any], 
        node_id: str,
        input_message: str,
        user_id: str = None,
        flow_id: str = None,
        context: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """运行指定节点"""
        compiler = AgenticFlowCompiler(user_id=user_id)
        compiled_flow = compiler.compile(json_data, user_id=user_id, flow_id=flow_id)
        
        agent = compiled_flow.get_agent(node_id)
        if agent is None:
            return {"error": f"Agent '{node_id}' not found"}
        
        if not agent._initialized:
            await agent.initialize()
        
        response = await agent.reply(input_message)
        
        return {
            "agent_id": node_id,
            "agent_name": agent.name,
            "output": response,
            "status": "completed"
        }
    
    @staticmethod
    async def stream_run_from_json(
        json_data: Dict[str, Any], 
        input_message: str,
        user_id: str = None,
        flow_id: str = None,
        context: Dict[str, Any] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式运行 JSON 格式的工作流
        
        Args:
            json_data: 画布 JSON 数据
            input_message: 输入消息
            user_id: 用户 ID
            flow_id: AgenticFlow ID
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
                    json_data, input_message, user_id, flow_id, context,
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
                        "child_agent_id": event.child_agent_id,
                        "child_agent_name": event.child_agent_name,
                        "status": event.status,
                        "error": event.error,
                        "timestamp": event.timestamp,
                        "metadata": event.metadata
                    }
                }
