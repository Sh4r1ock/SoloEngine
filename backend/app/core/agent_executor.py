# -*- coding: utf-8 -*-
"""
Agent 统一执行器。

@file agent_executor.py
@description Agent执行器 - 统一管理所有Agent功能的调用类
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 统一的Agent调用接口
- 模块化功能管理
- 子级Agent自动调用
- 执行历史记录
- 长期记忆管理
- 用户数据隔离

使用场景：
- 作为所有Agent功能的主入口
- 协调各种模块化组件
"""

import os
import json
import uuid
import logging
import asyncio
import time
from typing import Dict, List, Any, Optional, Union, Callable
from datetime import datetime
from dataclasses import dataclass, field
from collections import OrderedDict
from threading import Lock

from app.core.database import db_manager, get_db_context, AgentModel, AgentMemoryModel
from SoloAgent.assembly.assembler import ReActAgent
from SoloAgent.model import ChatModelBase
from SoloAgent.formatter import FormatterBase
from SoloAgent.core.interfaces import IMemory, IRAG, IToolExecutor, IMCPClient, IPlanNotebook
from SoloAgent.plugins.memory import VectorMemoryPlugin
from SoloAgent.plugins.rag import KnowledgeBaseRAGPlugin
from SoloAgent.plugins.tools import ToolkitExecutor
from SoloAgent.plugins.mcp.mcp_client import MCPClient, MCPClientManager
from SoloAgent.plugins.plan.plan_notebook import PlanNotebookPlugin

logger = logging.getLogger(__name__)


@dataclass
class AgentConfig:
    """Agent配置。"""
    id: str
    name: str
    agent_type: str  # orchestrator, planner, executor
    description: str = ""
    model_provider: str = "openai"
    model_name: str = "gpt-4"
    system_prompt: str = ""
    user_prompt: str = ""
    skills: List[str] = field(default_factory=list)
    mcp_tools: List[str] = field(default_factory=list)
    max_iters: int = 10
    enable_memory: bool = True
    enable_rag: bool = False
    enable_tools: bool = True
    child_agents: List[str] = field(default_factory=list)
    user_id: str = "default_user"
    agentic_flow_id: Optional[str] = None


class PersistentMemory(IMemory):
    """持久化记忆插件。"""

    def __init__(
        self, 
        agent_id: str, 
        user_id: str = "default_user",
        agentic_flow_id: str = None,
        run_id: str = None,
        config: Optional[dict] = None
    ):
        self.agent_id = agent_id
        self.user_id = user_id
        self.agentic_flow_id = agentic_flow_id
        self.run_id = run_id
        self.config = config or {}
        self._cache: List[Any] = []

    async def add(self, msg) -> None:
        with get_db_context() as db:
            db_manager.add_memory(
                db,
                user_id=self.user_id,
                agent_id=self.agent_id,
                flow_id=self.agentic_flow_id,
                run_id=self.run_id,
                role=msg.role if hasattr(msg, 'role') else "user",
                content=msg.get_text_content() if hasattr(msg, 'get_text_content') else str(msg.content),
                metadata={"source": "persistent_memory"}
            )
            self._cache.append(msg)

    async def retrieve(self, query: str, limit: int = 5) -> List:
        with get_db_context() as db:
            memories = db_manager.get_memories(
                db, 
                user_id=self.user_id,
                flow_id=self.agentic_flow_id,
                run_id=self.run_id,
                limit=limit
            )
            from SoloAgent.message import Msg
            return [
                Msg(name=m.role, role=m.role, content=m.content)
                for m in memories
            ]

    async def clear(self) -> None:
        self._cache.clear()

    async def get_memory_state(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "user_id": self.user_id,
            "agentic_flow_id": self.agentic_flow_id,
            "run_id": self.run_id,
            "cache_size": len(self._cache)
        }

    async def set_memory_state(self, state: dict) -> None:
        pass

    def set_run_id(self, run_id: str):
        self.run_id = run_id


class AgentExecutor:
    """
    Agent统一执行器。
    
    统一管理所有Agent功能模块：
    - 模型调用
    - 记忆管理
    - RAG检索
    - 工具执行
    - MCP客户端
    - 计划笔记本
    - 子Agent调用
    - 用户数据隔离
    """

    def __init__(self, config: AgentConfig):
        self.config = config
        self.agent_id = config.id
        self.agent_name = config.name
        self.agent_type = config.agent_type
        self.user_id = config.user_id
        self.agentic_flow_id = config.agentic_flow_id

        self._react_agent: Optional[ReActAgent] = None
        self._model: Optional[ChatModelBase] = None
        self._formatter: Optional[FormatterBase] = None
        self._memory: Optional[IMemory] = None
        self._rag: Optional[IRAG] = None
        self._tool_executor: Optional[IToolExecutor] = None
        self._mcp_manager: Optional[MCPClientManager] = None
        self._plan_plugin: Optional[IPlanNotebook] = None

        self._child_executors: Dict[str, 'AgentExecutor'] = {}
        self._execution_id: Optional[str] = None
        self._run_id: Optional[str] = None
        self._is_initialized = False

        self._register_to_database()

    def _register_to_database(self):
        with get_db_context() as db:
            existing = db_manager.get_agent(db, self.agent_id)
            if not existing:
                db_manager.create_agent(
                    db,
                    agent_id=self.agent_id,
                    name=self.agent_name,
                    agent_type=self.agent_type,
                    description=self.config.description,
                    config={
                        "model_provider": self.config.model_provider,
                        "model_name": self.config.model_name,
                        "skills": self.config.skills,
                        "mcp_tools": self.config.mcp_tools,
                        "user_id": self.user_id,
                        "agentic_flow_id": self.agentic_flow_id,
                    }
                )

    async def initialize(self):
        if self._is_initialized:
            return

        from SoloAgent.model.llm_factory import LLMFactory
        from SoloAgent.formatter.openai_formatter import OpenAIFunctionCallFormatter

        self._model = LLMFactory.create(
            provider=self.config.model_provider,
            model_name=self.config.model_name,
        )

        self._formatter = OpenAIFunctionCallFormatter()

        if self.config.enable_memory:
            self._memory = PersistentMemory(
                agent_id=self.agent_id,
                user_id=self.user_id,
                agentic_flow_id=self.agentic_flow_id,
                run_id=self._run_id
            )

        if self.config.enable_rag:
            self._rag = KnowledgeBaseRAGPlugin()

        if self.config.enable_tools:
            self._tool_executor = ToolkitExecutor([])

        self._mcp_manager = MCPClientManager()
        self._plan_plugin = PlanNotebookPlugin()

        self._react_agent = ReActAgent(
            name=self.agent_name,
            model=self._model,
            formatter=self._formatter,
            system_prompt=self.config.system_prompt,
            memory_config={"agent_id": self.agent_id, "user_id": self.user_id} if self.config.enable_memory else None,
            rag_config=None,
            tool_configs=None,
            mcp_configs=None,
            plan_config=None,
            enable_memory=self.config.enable_memory,
            enable_rag=self.config.enable_rag,
            enable_tools=self.config.enable_tools,
            max_iters=self.config.max_iters,
        )

        self._is_initialized = True
        logger.info(f"AgentExecutor initialized: {self.agent_id} ({self.agent_type}) for user {self.user_id}")

    async def execute(self, input_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        if not self._is_initialized:
            await self.initialize()

        start_time = datetime.now()

        with get_db_context() as db:
            if self.agentic_flow_id:
                run = db_manager.create_run(
                    db,
                    flow_id=self.agentic_flow_id,
                    user_id=self.user_id,
                    input_message=input_message
                )
                self._run_id = run.id
                
                if self._memory and isinstance(self._memory, PersistentMemory):
                    self._memory.set_run_id(self._run_id)

            try:
                if self.agent_type == "orchestrator":
                    result = await self._execute_as_orchestrator(input_message, context)
                elif self.agent_type == "planner":
                    result = await self._execute_as_planner(input_message, context)
                else:
                    result = await self._execute_as_executor(input_message, context)

                end_time = datetime.now()
                duration_ms = int((end_time - start_time).total_seconds() * 1000)

                if self._run_id:
                    db_manager.update_run(
                        db, self._run_id,
                        status="completed",
                        output_message=result.get("output", ""),
                        duration_ms=duration_ms
                    )

                return result

            except Exception as e:
                logger.error(f"Agent execution failed: {e}")
                if self._run_id:
                    db_manager.update_run(
                        db, self._run_id,
                        status="failed",
                        error=str(e)
                    )
                raise

    async def _execute_as_orchestrator(self, input_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        context = context or {}
        result = {
            "agent_id": self.agent_id,
            "agent_type": "orchestrator",
            "user_id": self.user_id,
            "agentic_flow_id": self.agentic_flow_id,
            "run_id": self._run_id,
            "output": "",
            "child_results": [],
            "status": "completed"
        }

        if self._react_agent:
            response = await self._react_agent.reply(input_message)
            result["output"] = response

        for child_id in self.config.child_agents:
            child_executor = self._child_executors.get(child_id)
            if child_executor:
                child_result = await child_executor.execute(input_message, context)
                result["child_results"].append(child_result)

        return result

    async def _execute_as_planner(self, input_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        context = context or {}
        result = {
            "agent_id": self.agent_id,
            "agent_type": "planner",
            "user_id": self.user_id,
            "agentic_flow_id": self.agentic_flow_id,
            "run_id": self._run_id,
            "output": "",
            "plan": None,
            "status": "completed"
        }

        if self._plan_plugin:
            plan = await self._plan_plugin.create_plan(
                goal=input_message,
                steps=[]
            )
            result["plan"] = plan

        if self._react_agent:
            response = await self._react_agent.reply(input_message)
            result["output"] = response

        return result

    async def _execute_as_executor(self, input_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        context = context or {}
        result = {
            "agent_id": self.agent_id,
            "agent_type": "executor",
            "user_id": self.user_id,
            "agentic_flow_id": self.agentic_flow_id,
            "run_id": self._run_id,
            "output": "",
            "tool_calls": [],
            "status": "completed"
        }

        if self._react_agent:
            response = await self._react_agent.reply(input_message)
            result["output"] = response

        return result

    def register_child_agent(self, child_executor: 'AgentExecutor'):
        self._child_executors[child_executor.agent_id] = child_executor
        if child_executor.agent_id not in self.config.child_agents:
            self.config.child_agents.append(child_executor.agent_id)
        logger.info(f"Registered child agent: {child_executor.agent_id} -> {self.agent_id}")

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if not self._tool_executor:
            raise RuntimeError("Tool executor not initialized")

        start_time = datetime.now()
        result = await self._tool_executor.execute({"name": tool_name, "arguments": arguments})
        end_time = datetime.now()
        duration_ms = int((end_time - start_time).total_seconds() * 1000)

        with get_db_context() as db:
            if self._run_id:
                db_manager.add_tool_call(
                    db,
                    run_id=self._run_id,
                    tool_name=tool_name,
                    arguments=arguments,
                    result=json.dumps(result) if result else None,
                    duration_ms=duration_ms
                )

        return result

    async def add_memory(self, role: str, content: str, metadata: Dict = None):
        with get_db_context() as db:
            db_manager.add_memory(
                db,
                user_id=self.user_id,
                agent_id=self.agent_id,
                flow_id=self.agentic_flow_id,
                run_id=self._run_id,
                role=role,
                content=content,
                metadata=metadata
            )

    async def get_memories(self, limit: int = 100) -> List[Dict]:
        with get_db_context() as db:
            memories = db_manager.get_memories(
                db, 
                user_id=self.user_id,
                flow_id=self.agentic_flow_id,
                run_id=self._run_id,
                limit=limit
            )
            return [
                {
                    "id": m.id,
                    "role": m.role,
                    "content": m.content,
                    "user_id": m.user_id,
                    "agentic_flow_id": m.agentic_flow_id,
                    "run_id": m.run_id,
                    "created_at": m.created_at.isoformat() if m.created_at else None
                }
                for m in memories
            ]

    async def add_execution_step(
        self, 
        step_type: str,
        node_id: str = None,
        node_name: str = None,
        thought: str = None,
        action: str = None,
        action_input: Dict = None,
        observation: str = None,
        error: str = None,
        duration_ms: int = None
    ):
        with get_db_context() as db:
            if self._run_id:
                db_manager.add_execution_step(
                    db,
                    run_id=self._run_id,
                    step_type=step_type,
                    node_id=node_id,
                    node_name=node_name,
                    thought=thought,
                    action=action,
                    action_input=action_input,
                    observation=observation,
                    error=error,
                    duration_ms=duration_ms
                )

    async def connect_mcp_server(self, server_config: Dict[str, Any]) -> bool:
        if not self._mcp_manager:
            self._mcp_manager = MCPClientManager()

        try:
            from SoloAgent.plugins.mcp.mcp_client import MCPServerConfig
            config = MCPServerConfig(
                id=server_config.get("id", str(uuid.uuid4())),
                name=server_config.get("name", ""),
                transport=server_config.get("transport", "http"),
                url=server_config.get("url", ""),
                headers=server_config.get("headers"),
                timeout=server_config.get("timeout", 30),
                enabled=True
            )
            await self._mcp_manager.add_server(config)
            logger.info(f"Connected MCP server: {config.name}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect MCP server: {e}")
            return False

    async def get_available_tools(self) -> List[Dict]:
        tools = []
        if self._tool_executor:
            tools.extend(self._tool_executor.get_available_tools())
        if self._mcp_manager:
            mcp_tools = await self._mcp_manager.get_all_tools()
            tools.extend(mcp_tools)
        return tools

    def get_execution_history(self, limit: int = 10) -> List[Dict]:
        with get_db_context() as db:
            runs = db_manager.get_runs(
                db, 
                flow_id=self.agentic_flow_id,
                user_id=self.user_id,
                limit=limit
            )
            return [
                {
                    "id": r.id,
                    "status": r.status,
                    "input_message": r.input_message,
                    "output_message": r.output_message,
                    "error": r.error,
                    "duration_ms": r.duration_ms,
                    "started_at": r.started_at.isoformat() if r.started_at else None,
                    "completed_at": r.completed_at.isoformat() if r.completed_at else None
                }
                for r in runs
            ]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.agent_id,
            "name": self.agent_name,
            "type": self.agent_type,
            "user_id": self.user_id,
            "agentic_flow_id": self.agentic_flow_id,
            "config": {
                "model_provider": self.config.model_provider,
                "model_name": self.config.model_name,
                "skills": self.config.skills,
                "mcp_tools": self.config.mcp_tools,
                "child_agents": self.config.child_agents,
            },
            "is_initialized": self._is_initialized
        }


class AgentExecutorFactory:
    """Agent执行器工厂，带LRU缓存和自动清理。"""

    MAX_INSTANCES = 100
    INSTANCE_TIMEOUT = 3600

    _instances: OrderedDict[str, tuple] = OrderedDict()
    _lock = Lock()

    @classmethod
    def create(cls, config: AgentConfig) -> AgentExecutor:
        with cls._lock:
            cls._cleanup_expired()
            
            if config.id in cls._instances:
                cls._instances.move_to_end(config.id)
                executor, _ = cls._instances[config.id]
                return executor

            if len(cls._instances) >= cls.MAX_INSTANCES:
                oldest_id = next(iter(cls._instances))
                del cls._instances[oldest_id]
                logger.info(f"Removed oldest executor instance: {oldest_id}")

            executor = AgentExecutor(config)
            cls._instances[config.id] = (executor, time.time())
            return executor

    @classmethod
    def get(cls, agent_id: str) -> Optional[AgentExecutor]:
        with cls._lock:
            if agent_id in cls._instances:
                cls._instances.move_to_end(agent_id)
                executor, _ = cls._instances[agent_id]
                return executor
            return None

    @classmethod
    def _cleanup_expired(cls):
        current_time = time.time()
        expired_ids = [
            aid for aid, (_, created_time) in cls._instances.items()
            if current_time - created_time > cls.INSTANCE_TIMEOUT
        ]
        for aid in expired_ids:
            del cls._instances[aid]
            logger.info(f"Removed expired executor instance: {aid}")

    @classmethod
    def remove(cls, agent_id: str) -> bool:
        with cls._lock:
            if agent_id in cls._instances:
                del cls._instances[agent_id]
                return True
            return False

    @classmethod
    def from_json(cls, json_data: Dict[str, Any], user_id: str = "default_user", agentic_flow_id: str = None) -> AgentExecutor:
        config = AgentConfig(
            id=json_data.get("id", str(uuid.uuid4())),
            name=json_data.get("name", "Unnamed Agent"),
            agent_type=json_data.get("agent_type", "executor"),
            description=json_data.get("description", ""),
            model_provider=json_data.get("model_provider", "openai"),
            model_name=json_data.get("model_name", "gpt-4"),
            system_prompt=json_data.get("system_prompt", ""),
            user_prompt=json_data.get("user_prompt", ""),
            skills=json_data.get("skills", []),
            mcp_tools=json_data.get("mcp_tools", []),
            max_iters=json_data.get("max_iters", 10),
            enable_memory=json_data.get("enable_memory", True),
            enable_rag=json_data.get("enable_rag", False),
            enable_tools=json_data.get("enable_tools", True),
            child_agents=json_data.get("child_agents", []),
            user_id=json_data.get("user_id", user_id),
            agentic_flow_id=json_data.get("agentic_flow_id", agentic_flow_id),
        )
        return cls.create(config)

    @classmethod
    def from_json_file(cls, file_path: str, user_id: str = "default_user", agentic_flow_id: str = None) -> AgentExecutor:
        with open(file_path, 'r', encoding='utf-8') as f:
            json_data = json.load(f)
        return cls.from_json(json_data, user_id, agentic_flow_id)

    @classmethod
    def list_all(cls) -> List[AgentExecutor]:
        with cls._lock:
            return [executor for executor, _ in cls._instances.values()]

    @classmethod
    def clear_all(cls):
        with cls._lock:
            cls._instances.clear()
            logger.info("Cleared all executor instances")

    @classmethod
    def get_stats(cls) -> Dict[str, Any]:
        with cls._lock:
            return {
                "total_instances": len(cls._instances),
                "max_instances": cls.MAX_INSTANCES,
                "instance_timeout": cls.INSTANCE_TIMEOUT,
            }
