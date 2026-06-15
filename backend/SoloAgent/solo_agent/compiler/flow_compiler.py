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
import logging
import time
import asyncio
import hashlib
import json
from datetime import datetime
from typing import Dict, Any, List, Optional, Callable, AsyncGenerator, TYPE_CHECKING
from collections import OrderedDict
from threading import Lock
from zoneinfo import ZoneInfo
from dataclasses import dataclass, field

from ..config import SoloAgentConfig
from ..agent import SoloAgent
from app.core.config import settings

if TYPE_CHECKING:
    from SoloAgent.plugins.tools.agent.mcp import MCPServerInfo
    from SoloAgent.solo_agent.compiler.mcp_host_client_manager import MCPHostClientManager

logger = logging.getLogger("SoloEngine")


@dataclass
class ExecutionEvent:
    """
    执行事件数据类
    
    职责:
    - 封装流程执行过程中的各类事件
    - 支持多种事件类型：消息、工具调用、Skill调用、MCP调用、文件变更等
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
        file_changes (Optional[List[Dict]]): 文件变更列表
    """
    event_type: str
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    agent_type: Optional[str] = None
    content: Optional[str] = None
    message: Optional[Dict[str, Any]] = None
    tool_name: Optional[str] = None
    tool_type: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[Any] = None
    tool_call_id: Optional[str] = None
    subagent_id: Optional[str] = None
    subagent_name: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None
    file_changes: Optional[List[Dict]] = None
    timestamp: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "type": self.event_type,
            "data": {
                "agent_id": self.agent_id,
                "agent_name": self.agent_name,
                "agent_type": self.metadata.get("agent_type") if self.metadata else None,
                "content": self.content,
                "tool_name": self.tool_name,
                "tool_type": self.tool_type,
                "tool_args": self.tool_args,
                "tool_result": self.tool_result,
                "tool_call_id": self.tool_call_id,
                "subagent_id": self.subagent_id,
                "subagent_name": self.subagent_name,
                "status": self.status,
                "error": self.error,
                "timestamp": self.timestamp,
                "metadata": self.metadata,
            },
        }


class CompiledFlow:
    """
    编译后的AgenticFlow类 - 作为MCP Host
    
    职责:
    - 管理多个Agent的执行
    - 协调会话生命周期
    - Host层统一管理MCP Client
    - 事件管理和流式输出
    - 文件变更追踪与管理
    
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

        # 执行计时与token统计
        self._start_time: Optional[datetime] = None
        self._token_usage: Dict[str, int] = {}
        self._token_usage_recorded: set = set()  # 新增：记录已计算的 message_id，防止重复计算
        self._event_callback: Optional[Callable[[ExecutionEvent], None]] = None
        self._stream_callback: Optional[Callable[[str], None]] = None
        self._agent_memories: Dict[str, List[Dict]] = {}
        self._created_time: float = time.time()
        self._is_new: bool = True
        self._active_models: Dict[str, Any] = {}
        self._cancel_event: asyncio.Event = asyncio.Event()
        
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
        self._agent_memories = memories

    def _calc_duration_ms(self, end_time=None):
        if not self._start_time:
            return 0
        end = end_time or datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        return int((end - self._start_time).total_seconds() * 1000)

    def _build_result_dict(self, status, agent_id=None, agent_name=None,
                           output=None, error=None, tokens=None, duration_ms=0,
                           **extra_fields):
        result = {
            "agent_id": agent_id,
            "agent_name": agent_name,
            "status": status,
            "output": output or error or "",
            "tokens": tokens,
            "token_usage": self._token_usage if self._token_usage else None,
            "duration_ms": duration_ms,
        }
        if error:
            result["error"] = error
        result.update(extra_fields)
        return result

    def _accumulate_token_usage(self, tokens, message_id=None):
        if message_id and message_id in self._token_usage_recorded:
            return
        if tokens and tokens.get("prompt_tokens") is not None:
            self._token_usage["prompt_tokens"] = self._token_usage.get("prompt_tokens", 0) + (tokens.get("prompt_tokens") or 0)
            self._token_usage["completion_tokens"] = self._token_usage.get("completion_tokens", 0) + (tokens.get("completion_tokens") or 0)
            self._token_usage["total_tokens"] = self._token_usage.get("total_tokens", 0) + (tokens.get("total_tokens") or 0)
            self._token_usage["duration_ms"] = self._token_usage.get("duration_ms", 0) + (tokens.get("duration_ms") or 0)
            if message_id:
                self._token_usage_recorded.add(message_id)

    def _finalize_result(self, result):
        result["status"] = result.get("status", "completed")
        result["duration_ms"] = self._calc_duration_ms()
        result["token_usage"] = self._token_usage if self._token_usage else None

    async def close(self):
        """关闭 CompiledFlow 并清理资源（MCP Client 等）"""
        if self._mcp_client_manager:
            await self._mcp_client_manager.close_all()
        logger.info(f"[CompiledFlow] Closed and cleaned up resources")
    
    async def cancel(self):
        """取消当前执行，关闭所有活跃的 HTTP 连接"""
        if self._cancel_event:
            self._cancel_event.set()
        for agent_id, model in list(self._active_models.items()):
            try:
                await model.cancel()
            except Exception as e:
                logger.warning(f"[CompiledFlow] Error cancelling model for agent {agent_id}: {e}")
        logger.info(f"[CompiledFlow] Cancel completed, cleared {len(self._active_models)} active models")
    
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
        self._start_time = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        self._token_usage = {}
        self._token_usage_recorded = set()
        
        logger.info(f"[CompiledFlow.run] Starting run with session_id={self.session_id}, user_id={self.user_id}, run_project_id={self.run_project_id}, agentic_flow_id={self.agentic_flow_id}")

        try:
            result = await self._run_internal(input_message, context, cancel_event=cancel_event)
            return result
        except Exception as e:
            logger.error(f"[CompiledFlow.run] Execution failed: {e}", exc_info=True)
            return self._build_result_dict(
                "failed", error=str(e), output=f"执行失败: {str(e)}",
                session_id=self.session_id, agentic_flow_id=self.agentic_flow_id,
                run_project_id=self.run_project_id,
            )
    
    async def _run_internal(self, input_message: str, context: Dict[str, Any], cancel_event: asyncio.Event = None) -> Dict[str, Any]:
        orchestrator = self.get_orchestrator()
        
        if orchestrator is None:
            if len(self.agents) == 1:
                agent = list(self.agents.values())[0]
                result = await self._execute_agent(agent, input_message, context, cancel_event=cancel_event)
                
                if isinstance(result, dict):
                    self._finalize_result(result)
                
                return result
            else:
                entry_nodes = self.get_entry_nodes()
                if not entry_nodes:
                    entry_nodes = list(self.agents.keys())
                
                results = {}
                has_failed = False
                error_messages = []
                for entry_id in entry_nodes:
                    agent = self.agents.get(entry_id)
                    if agent:
                        result = await self._execute_agent(agent, input_message, context, cancel_event=cancel_event)
                        results[entry_id] = result
                        if isinstance(result, dict) and result.get("status") == "failed":
                            has_failed = True
                            if result.get("error"):
                                error_messages.append(result["error"])
                
                output = self._aggregate_results(results)
                
                if has_failed:
                    combined_error = "; ".join(error_messages) if error_messages else "部分Agent执行失败"
                    self._emit_event(ExecutionEvent(
                        event_type="agent_error",
                        content=output,
                        error=combined_error,
                        metadata={"duration_ms": self._calc_duration_ms()}
                    ))
                    return self._build_result_dict(
                        "failed", output=output, error=combined_error,
                        session_id=self.session_id, agentic_flow_id=self.agentic_flow_id,
                        run_project_id=self.run_project_id, node_results=results,
                        duration_ms=self._calc_duration_ms(),
                    )
                
                self._emit_event(ExecutionEvent(
                    event_type="execution_complete",
                    content=output,
                    metadata={"duration_ms": self._calc_duration_ms()}
                ))
                
                return self._build_result_dict(
                    "completed", output=output,
                    session_id=self.session_id, agentic_flow_id=self.agentic_flow_id,
                    run_project_id=self.run_project_id, node_results=results,
                    duration_ms=self._calc_duration_ms(),
                )
        else:
            result = await self._execute_agent(orchestrator, input_message, context, cancel_event=cancel_event)
            
            if isinstance(result, dict):
                self._finalize_result(result)
            
            return result
    
    async def _execute_agent(
        self, 
        agent: SoloAgent, 
        input_message: str,
        context: Dict[str, Any],
        cancel_event: asyncio.Event = None
    ) -> Dict[str, Any]:
        
        agent_id = agent.agent_id
        agent_name = agent.name
        
        # 生成消息ID（用于关联文件变更）
        import uuid
        message_id = str(uuid.uuid4())
        
        # 获取工作目录
        working_dir = agent.config.work_dir if hasattr(agent.config, 'work_dir') else None
        
        self._emit_event(ExecutionEvent(
            event_type="agent_start",
            agent_id=agent_id,
            agent_name=agent_name,
            agent_type=agent.agent_type,
            content=input_message,
        ))
        
        if self._stream_callback and hasattr(agent, 'set_stream_callback'):
            agent.set_stream_callback(self._stream_callback)
        
        if self._event_callback and hasattr(agent, '_event_callback'):
            agent._event_callback = self._event_callback
        
        agent_memory = self._agent_memories.get(agent_id, [])
        
        # 传递文件变更上下文给 SoloAgent 层（必须在 initialize 之前，因为 _on_tool_executed 需要 working_dir）
        # 每轮执行都必须调用 set_file_change_context，确保：
        # 1. _pre_tool_hashes 正确初始化（增量diff依赖此数据判断 created/modified）
        # 2. set_file_tool_working_dir 被调用（文件工具依赖此上下文变量定位工作目录）
        if hasattr(agent, 'set_file_change_context'):
            working_dir = agent.config.work_dir if hasattr(agent.config, 'work_dir') else None
            if working_dir:
                agent.set_file_change_context(working_dir)
                logger.info(f"[_execute_agent] set_file_change_context called, working_dir={working_dir}")
            else:
                logger.warning(f"[_execute_agent] No working_dir available for agent {agent_id}")
        
        logger.warning(f"[_execute_agent] agent._initialized={agent._initialized}, agent._core={agent._core is not None}")
        
        if not agent._initialized:
            if agent_memory and hasattr(agent, 'set_message_history'):
                agent.set_message_history(agent_memory)
            await agent.initialize()
        
        # 确保 _on_tool_executed 回调被设置（即使 agent 已经被初始化）
        if hasattr(agent, '_core') and hasattr(agent, '_on_tool_executed'):
            if hasattr(agent._core, '_on_tool_executed'):
                agent._core._on_tool_executed = agent._on_tool_executed
                logger.warning(f"[_execute_agent] Set _on_tool_executed callback, agent._initialized={agent._initialized}")
            else:
                logger.warning(f"[_execute_agent] agent._core does not have _on_tool_executed attribute")
        else:
            logger.warning(f"[_execute_agent] agent._core={agent._core is not None}, hasattr _on_tool_executed={hasattr(agent, '_on_tool_executed')}")
        
        # 注册 agent.model 到 _active_models 注册表
        if hasattr(agent, '_core') and hasattr(agent._core, 'model'):
            self._active_models[agent_id] = agent._core.model
            logger.info(f"[_execute_agent] Registered model for agent {agent_id}")
        
        try:
            original_reply = agent.reply
            
            async def wrapped_reply(message: str) -> str:
                response = await original_reply(message, cancel_event=cancel_event or self._cancel_event)
                
                if hasattr(agent, '_last_tool_calls') and agent._last_tool_calls:
                    for call in agent._last_tool_calls:
                        tool_name = call.get("name")
                        if not tool_name:
                            continue
                        
                        tool_result_data = call.get("result")
                        tool_error = None
                        if isinstance(tool_result_data, dict) and tool_result_data.get("success") is False:
                            tool_error = tool_result_data.get("error_message", tool_result_data.get("content"))
                        
                        self._emit_event(ExecutionEvent(
                            event_type="tool_call",
                            agent_id=agent_id,
                            agent_name=agent_name,
                            tool_name=tool_name,
                            tool_type=call.get("tool_type", "tool"),
                            tool_args=call.get("args"),
                            tool_result=tool_result_data,
                            tool_call_id=call.get("id"),
                            error=tool_error,
                            metadata=call.get("metadata", {})
                        ))
                
                return response
            
            response = await wrapped_reply(input_message)

            agent_core = agent._core if hasattr(agent, '_core') else None
            if agent_core and hasattr(agent_core, '_conversation_history'):
                history = agent_core.get_conversation_history()
                last_user_idx = None
                for i in range(len(history) - 1, -1, -1):
                    if history[i].role == "user" and i < len(history) - 1:
                        last_user_idx = i
                        break
                
                if last_user_idx is not None:
                    for msg in history[last_user_idx:]:
                        msg_dict = self._msg_to_memory_dict(msg)
                        if msg_dict:
                            agent_memory.append(msg_dict)
                else:
                    agent_memory.append({"role": "user", "data": [{"type": "content", "content": input_message}]})
                    agent_memory.append({"role": "assistant", "data": [{"type": "content", "content": response}]})
            else:
                agent_memory.append({"role": "user", "data": [{"type": "content", "content": input_message}]})
                agent_memory.append({"role": "assistant", "data": [{"type": "content", "content": response}]})
            self._agent_memories[agent_id] = agent_memory
            
            tool_calls = []
            if hasattr(agent, '_last_tool_calls') and agent._last_tool_calls:
                tool_calls = agent._last_tool_calls.copy()
            
            openai_message = agent.get_last_openai_message() if hasattr(agent, 'get_last_openai_message') else {"role": "assistant", "content": response, "reasoning_content": None}
            
            tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
            
            if tokens and message_id and message_id not in self._token_usage_recorded:
                logger.info(f"[Token Usage] Accumulated: {tokens}, message_id: {message_id}")
            
            result = self._build_result_dict(
                "completed", agent_id=agent_id, agent_name=agent_name,
                output=response, tokens=tokens, duration_ms=self._calc_duration_ms(),
                agent_type=agent.agent_type, user_id=self.user_id,
                agentic_flow_id=self.agentic_flow_id, run_project_id=self.run_project_id,
                session_id=self.session_id, message=openai_message,
                tool_calls=tool_calls,
            )
            
            self._emit_event(ExecutionEvent(
                event_type="agent_complete",
                agent_id=agent_id,
                agent_name=agent_name,
                content=openai_message.get("content", response) if openai_message else response,
                message=openai_message,
                status="completed",
            ))
            
            return result
            
        except Exception as e:
            import traceback
            logger.error(f"Agent execution failed: {agent_name} - {e}")
            logger.error(traceback.format_exc())

            partial_tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
            if partial_tokens:
                logger.info(f"[Token Usage] Partial tokens from failed agent: {partial_tokens}")

            self._emit_event(ExecutionEvent(
                event_type="agent_error",
                agent_id=agent_id,
                agent_name=agent_name,
                error=str(e),
                status="failed",
            ))
            
            return self._build_result_dict(
                "failed", agent_id=agent_id, agent_name=agent_name,
                error=str(e),
            )
        finally:
            tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
            self._accumulate_token_usage(tokens, message_id=message_id)
            self._active_models.pop(agent_id, None)
            logger.info(f"[_execute_agent] Unregistered model for agent {agent_id}")
    
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
    
    @staticmethod
    def _msg_to_memory_dict(msg) -> dict | None:
        if msg.role == "user":
            content = msg.content if isinstance(msg.content, str) else (msg.get_text_content() if hasattr(msg, 'get_text_content') else str(msg.content))
            return {"role": "user", "data": [{"type": "content", "content": content}]}
        elif msg.role == "assistant":
            data = []
            if isinstance(msg.content, list):
                data = msg.content
            elif isinstance(msg.content, str):
                data = [{"type": "content", "content": msg.content}]
            return {"role": "assistant", "data": data}
        elif msg.role == "tool":
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            return {
                "role": "tool",
                "tool_call_id": msg.tool_call_id,
                "content": content,
                "name": msg.name
            }
        return None


class CompiledFlowFactory:
    """CompiledFlow 工厂，带 LRU 缓存、并发控制和自动清理
    
    缓存 key 格式: {user_id}:{agentic_flow_id}:{session_id}:{run_project_id}
    """
    
    MAX_INSTANCES = settings.COMPILED_FLOW_MAX_INSTANCES
    CACHE_TIMEOUT = settings.COMPILED_FLOW_CACHE_TIMEOUT
    
    _instances: OrderedDict[str, tuple] = OrderedDict()
    _lock = Lock()
    _execution_locks: Dict[str, asyncio.Lock] = {}
    _flow_users: Dict[str, set] = {}
    _last_cleanup_time: float = 0.0
    _cleanup_interval: float = settings.COMPILED_FLOW_CLEANUP_INTERVAL
    
    @classmethod
    def _schedule_close(cls, compiled_flow: CompiledFlow):
        """调度异步关闭 CompiledFlow 的资源"""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(compiled_flow.close())
            else:
                loop.run_until_complete(compiled_flow.close())
        except RuntimeError:
            try:
                asyncio.create_task(compiled_flow.close())
            except Exception:
                pass
        except Exception as e:
            logger.warning(f"Failed to schedule close for CompiledFlow: {e}")

    @classmethod
    def _make_cache_key(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str) -> str:
        from app.utils.common_utils import make_cache_key
        return make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
    
    @classmethod
    def create(cls, user_id: str, agentic_flow_id: str, session_id: str, run_project_id: str, compiled_flow: CompiledFlow) -> CompiledFlow:
        cache_key = cls._make_cache_key(user_id, agentic_flow_id, session_id, run_project_id)
        
        with cls._lock:
            cls._maybe_cleanup()
            
            if cache_key in cls._instances:
                cls._instances.move_to_end(cache_key)
                compiled_flow, _ = cls._instances[cache_key]
                return compiled_flow
            
            if len(cls._instances) >= cls.MAX_INSTANCES:
                oldest_key = next(iter(cls._instances))
                oldest_flow, _ = cls._instances[oldest_key]
                cls._schedule_close(oldest_flow)
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
            cls._maybe_cleanup()
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
    def _maybe_cleanup(cls):
        current_time = time.time()
        if current_time - cls._last_cleanup_time < cls._cleanup_interval:
            return
        cls._last_cleanup_time = current_time
        cls._cleanup_expired()

    @classmethod
    def _cleanup_expired(cls):
        current_time = time.time()
        expired_ids = [
            fid for fid, (_, created_time) in cls._instances.items()
            if current_time - created_time > cls.CACHE_TIMEOUT
        ]
        for fid in expired_ids:
            expired_flow, _ = cls._instances[fid]
            cls._schedule_close(expired_flow)
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
                compiled_flow, _ = cls._instances[cache_key]
                cls._schedule_close(compiled_flow)
                del cls._instances[cache_key]
                if cache_key in cls._execution_locks:
                    del cls._execution_locks[cache_key]
                if cache_key in cls._flow_users:
                    del cls._flow_users[cache_key]
                logger.info(f"[CompiledFlowFactory] Removed cache for key: {cache_key}")
                return True
            logger.info(f"[CompiledFlowFactory] No cache found for key: {cache_key}")
            return False
    
    @classmethod
    def clear_all(cls):
        with cls._lock:
            for cache_key, (compiled_flow, _) in cls._instances.items():
                cls._schedule_close(compiled_flow)
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
        register_gateway: bool = True,
    ) -> CompiledFlow:
        """编译 AgenticFlow JSON 为可执行结构
        
        Args:
            flow_data: AgenticFlow JSON 数据
            user_id: 用户 ID（必需）
            agentic_flow_id: AgenticFlow ID（必需）
            session_id: 会话 ID（必需）
            run_project_id: 项目 ID（必需）
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
        
        cached = CompiledFlowFactory.get(user_id, agentic_flow_id, session_id, run_project_id)
        if cached:
            current_llm_configs = self._load_llm_configs(user_id)
            
            cached_config_versions = set()
            for agent in cached.agents.values():
                if hasattr(agent.config, '_llm_config_version') and agent.config._llm_config_version:
                    cached_config_versions.add(agent.config._llm_config_version)
            
            current_config_versions = {cfg.version for cfg in current_llm_configs.values() if cfg.version}

            canvas_hash = hashlib.md5(json.dumps(flow_data, sort_keys=True).encode()).hexdigest()
            canvas_changed = getattr(cached, '_canvas_hash', None) != canvas_hash

            mcp_skills_changed = False
            if not canvas_changed:
                canvas_data_tmp = flow_data.get("canvas_data", flow_data)
                tmp_mcp_ids = set()
                tmp_skill_ids = set()
                for node in canvas_data_tmp.get("nodes", []):
                    node_data = node.get("data", {})
                    for mcp in node_data.get("mcp_servers", []):
                        tmp_mcp_ids.add(mcp if isinstance(mcp, str) else mcp.get("id"))
                    for skill in node_data.get("skills", []):
                        tmp_skill_ids.add(skill if isinstance(skill, str) else skill.get("id"))
                tmp_mcp_ids.discard(None)
                tmp_skill_ids.discard(None)

                cached_mcp_versions = getattr(cached, '_mcp_versions', {})
                cached_skill_versions = getattr(cached, '_skill_versions', {})

                current_mcp_versions = self._load_config_versions(tmp_mcp_ids, 'mcp')
                current_skill_versions = self._load_config_versions(tmp_skill_ids, 'skill')

                mcp_skills_changed = (cached_mcp_versions != current_mcp_versions or cached_skill_versions != current_skill_versions)
            
            if cached_config_versions == current_config_versions and not canvas_changed and not mcp_skills_changed and (len(cached_config_versions) > 0 or len(current_config_versions) == 0):
                logger.info(f"Using cached CompiledFlow (canvas unchanged, LLM/MCP/Skills versions match)")
                CompiledFlowFactory.register_user(user_id, agentic_flow_id, session_id, run_project_id, user_id)
                cached.session_id = session_id
                cached.run_project_id = run_project_id
                cached.user_id = user_id
                cached.agentic_flow_id = agentic_flow_id
                cached._is_new = False
                return cached
            else:
                logger.info(f"Cache invalidated (canvas_changed={canvas_changed}, mcp_skills_changed={mcp_skills_changed}, llm_versions: cached={cached_config_versions}, current={current_config_versions}), recompiling...")
                CompiledFlowFactory.remove(user_id, agentic_flow_id, session_id, run_project_id)
        
        canvas_data = flow_data.get("canvas_data", flow_data)
        nodes = canvas_data.get("nodes", [])
        edges = canvas_data.get("edges", [])
        
        # 收集所有Agent节点引用的MCP服务器ID、Skills ID、Tool ID
        all_mcp_server_ids = set()
        all_skill_ids = set()
        all_tool_ids = set()
        
        node_map = {n["id"]: n for n in nodes}
        for node in nodes:
            node_data = node.get("data", {})
            # 收集MCP服务器ID
            mcp_servers = node_data.get("mcp_servers", [])
            for mcp in mcp_servers:
                if isinstance(mcp, str):
                    all_mcp_server_ids.add(mcp)
                elif isinstance(mcp, dict) and mcp.get("id"):
                    all_mcp_server_ids.add(mcp["id"])
            # 收集Skills ID
            skills = node_data.get("skills", [])
            for skill in skills:
                if isinstance(skill, str):
                    all_skill_ids.add(skill)
                elif isinstance(skill, dict) and skill.get("id"):
                    all_skill_ids.add(skill["id"])
            # 收集Tool ID
            tools = node_data.get("tools", [])
            for tool in tools:
                if isinstance(tool, str):
                    all_tool_ids.add(tool)
                elif isinstance(tool, dict) and tool.get("id"):
                    all_tool_ids.add(tool["id"])
        
        # 按需加载配置（只加载引用的配置）
        llm_configs, mcp_configs, skills_configs = await asyncio.gather(
            asyncio.to_thread(self._load_llm_configs, user_id),
            asyncio.to_thread(self._load_mcp_configs_by_ids, list(all_mcp_server_ids), user_id),
            asyncio.to_thread(self._load_skills_configs_by_ids, list(all_skill_ids), user_id),
        )
        
        # 使用按需加载的mcp_configs构建all_mcp_servers
        all_mcp_servers = {}
        for server_id, server in mcp_configs.items():
            all_mcp_servers[server.name] = {"id": server.id}
        
        from SoloAgent.solo_agent.compiler.mcp_host_client_manager import MCPHostClientManager
        mcp_client_manager = MCPHostClientManager()
        
        # 加载MCP服务器配置到manager（不连接）
        if all_mcp_servers and mcp_configs:
            mcp_client_manager.load_server_configs(mcp_configs)
            logger.info(
                f"[Compiler] MCP servers configs loaded: {len(all_mcp_servers)} servers"
            )
        
        # 后台异步连接MCP服务器（不阻塞编译）
        if all_mcp_servers and mcp_client_manager:
            asyncio.create_task(mcp_client_manager.connect_servers_async(
                all_mcp_servers, 
                user_id=user_id
            ))
        
        compilation_order = self._calculate_compilation_order(nodes, edges)
        
        edge_map = self._compile_edges(edges)
        
        work_dir = await asyncio.to_thread(self._get_work_dir, user_id, agentic_flow_id)
        
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
                    mcp_client_manager,
                    user_id=user_id
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
                work_dir=work_dir,
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
        compiled_flow._canvas_hash = hashlib.md5(json.dumps(flow_data, sort_keys=True).encode()).hexdigest()
        compiled_flow._mcp_versions = self._load_config_versions(all_mcp_server_ids, 'mcp')
        compiled_flow._skill_versions = self._load_config_versions(all_skill_ids, 'skill')
        
        CompiledFlowFactory.create(user_id, agentic_flow_id, session_id, run_project_id, compiled_flow)
        CompiledFlowFactory.register_user(user_id, agentic_flow_id, session_id, run_project_id, user_id)
        
        if register_gateway:
            self._register_to_gateway(agentic_flow_id, compiled_flow)
        
        logger.info(
            f"Compiled AgenticFlow with {len(agents)} agents, "
            f"orchestrator: {orchestrator_id}"
        )
        
        return compiled_flow
    
    def _create_agent_server_info(
        self,
        agent_mcp_servers: List[str],
        client_manager: "MCPHostClientManager",
        user_id: str = None
    ) -> Dict[str, "MCPServerInfo"]:
        """为Agent创建MCPServerInfo(引用Host的Client)
        
        Args:
            agent_mcp_servers: Agent配置的mcp_server ID列表
            client_manager: Host层Client管理器
            user_id: 用户ID，用于重新加载时权限检查
        
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
            
            if not config:
                logger.warning(f"[Compiler] Config for '{server_name}' not available")
                continue
            
            # 创建MCPServerInfo，引用Host的Client
            # client可能为None（异步连接中），这是允许的
            server_info[server_name] = MCPServerInfo(
                server_id=config["id"],
                server_name=server_name,
                server_description=config.get("description", ""),
                tools=config.get("tools", []),
                resources=config.get("resources", []),
                prompts=config.get("prompts", []),
                client=client,  # 可能为None，异步连接后填充
                is_connected=client is not None,
                _manager=client_manager,  # 传递manager引用，用于动态获取client
                _user_id=user_id,  # 传递user_id，用于重新加载时权限检查
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
    
    def _load_mcp_configs_by_ids(self, mcp_server_ids: List[str], user_id: str) -> Dict[str, Any]:
        """从数据库按需加载指定的 MCP 配置
        
        Args:
            mcp_server_ids: MCP服务器ID列表
            user_id: 用户ID
            
        Returns:
            Dict[str, Any]: MCP配置字典，key为server_id
        """
        if not mcp_server_ids:
            return {}
            
        try:
            from app.core.database import get_db_context, MCPServerModel
            from sqlalchemy.orm import joinedload
            from sqlalchemy import or_
            
            with get_db_context() as db:
                # 使用 joinedload 预加载关联数据，避免懒加载问题
                servers = db.query(MCPServerModel).options(
                    joinedload(MCPServerModel.sse_config),
                    joinedload(MCPServerModel.stdio_config),
                    joinedload(MCPServerModel.http_config)
                ).filter(
                    MCPServerModel.id.in_(mcp_server_ids),
                    or_(
                        MCPServerModel.is_public == True,
                        MCPServerModel.user_id == user_id
                    )
                ).all()
                
                # 在会话内访问所有需要的属性，确保数据被加载
                for server in servers:
                    _ = server.sse_config
                    _ = server.stdio_config
                    _ = server.http_config
                    _ = server.tools
                
                return {str(server.id): server for server in servers}
        except Exception as e:
            logger.warning(f"Failed to load MCP configs by ids: {e}")
            return {}
    
    def _load_skills_configs_by_ids(self, skill_ids: List[str], user_id: str) -> Dict[str, Any]:
        """从数据库按需加载指定的 Skills 配置
        
        Args:
            skill_ids: Skills ID列表
            user_id: 用户ID
            
        Returns:
            Dict[str, Any]: Skills配置字典，key为skill_id
        """
        if not skill_ids:
            return {}
            
        try:
            from app.core.database import get_db_context, SkillsPackageModel
            from sqlalchemy import or_
            
            with get_db_context() as db:
                skills = db.query(SkillsPackageModel).filter(
                    SkillsPackageModel.id.in_(skill_ids),
                    or_(
                        SkillsPackageModel.is_public == True,
                        SkillsPackageModel.user_id == user_id
                    )
                ).all()
                return {str(skill.id): skill for skill in skills}
        except Exception as e:
            logger.warning(f"Failed to load Skills configs by ids: {e}")
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

    def _load_config_versions(self, config_ids: set, config_type: str) -> Dict[str, int]:
        if not config_ids:
            return {}
        try:
            from app.core.database import get_db_context
            with get_db_context() as db:
                if config_type == 'mcp':
                    from app.core.database import MCPServerModel
                    rows = db.query(MCPServerModel.id, MCPServerModel.version).filter(
                        MCPServerModel.id.in_(config_ids)
                    ).all()
                elif config_type == 'skill':
                    from app.core.database import SkillsPackageModel
                    rows = db.query(SkillsPackageModel.id, SkillsPackageModel.version).filter(
                        SkillsPackageModel.id.in_(config_ids)
                    ).all()
                else:
                    return {}
                return {str(row[0]): row[1] for row in rows}
        except Exception as e:
            logger.warning(f"Failed to load {config_type} config versions: {e}")
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
    
    def _build_system_prompt_with_work_dir(
        self,
        base_prompt: str,
        work_dir: Optional[str] = None,
    ) -> str:
        if not work_dir:
            return base_prompt
        
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
        work_dir: str = None,
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
        llm_config_id = model_config.get("llm_config_id")
        
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
        base_url = config.base_url
        api_key = encryption_service.decrypt(config.api_key) if config.api_key else None
        timeout = config.timeout
        extra_params = config.extra_params if hasattr(config, 'extra_params') else None

        required_params = ["temperature", "max_tokens", "frequency_penalty", "presence_penalty"]
        missing_params = [p for p in required_params if p not in model_config]
        if missing_params:
            raise ValueError(
                f"节点 '{node_data.get('name', node_id)}' 的模型参数缺失: {', '.join(missing_params)}。"
                f"请在画布中打开该节点，重新选择模型并保存。"
            )

        temperature = model_config["temperature"]
        max_tokens = model_config["max_tokens"]
        top_p = model_config.get("top_p", 1.0)
        frequency_penalty = model_config["frequency_penalty"]
        presence_penalty = model_config["presence_penalty"]
        logger.info(f"Using LLM config: {config.name} ({provider}/{model}), config_id={llm_config_id}")
        logger.info(f"LLM params from node model_config: temperature={temperature}, max_tokens={max_tokens}, frequency_penalty={frequency_penalty}, presence_penalty={presence_penalty}")
        
        if not api_key:
            raise ValueError(
                f"未配置 LLM API Key。请在设置中配置模型（节点: {node_data.get('name', node_id)}）。"
                f"您可以在「设置 > LLM配置」中添加 API Key。"
            )
        
        skills = node_data.get("skills", [])
        enriched_skills = []
        logger.info(f"[Skills DEBUG] node_id={node_id}, raw skills={skills}")
        logger.info(f"[Skills DEBUG] skills_configs keys={list(skills_configs.keys()) if skills_configs else []}")
        for skill in skills:
            if isinstance(skill, str):
                skill_dict = {"id": skill, "name": skill}
                # 尝试用skill作为key查找（可能是ID或name）
                skill_config = None
                if skills_configs:
                    if skill in skills_configs:
                        skill_config = skills_configs[skill]
                    else:
                        # 尝试通过name查找
                        for sid, sc in skills_configs.items():
                            if sc.name == skill:
                                skill_config = sc
                                break
                if skill_config:
                    skill_dict["name"] = skill_config.name
                    skill_dict["description"] = getattr(skill_config, "description", "")
                    rel_folder_path = getattr(skill_config, "folder_path", None)
                    if rel_folder_path:
                        from app.core.data_paths import DataPaths
                        skill_dict["folder_path"] = DataPaths.to_absolute_path(rel_folder_path)
                    else:
                        skill_dict["folder_path"] = None
                    skill_dict["tools"] = getattr(skill_config, "tools", [])
                    logger.info(f"[Skills DEBUG] Enriched skill '{skill}' -> name='{skill_config.name}'")
                else:
                    logger.warning(f"[Skills DEBUG] Skill '{skill}' not found in configs")
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
            system_prompt=self._build_system_prompt_with_work_dir(
                base_prompt=node_data.get("system_prompt", ""),
                work_dir=work_dir,
            ),
            desc=node_data.get("desc", ""),
            skills=enriched_skills,
            tools=tools,
            mcp_servers=node_mcp_servers_info,
            subagents=[],
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
            work_dir=work_dir,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
            timeout=timeout,
            _llm_config_id=llm_config_id,
            _llm_config_version=config.version if config else None,
        )
        if extra_params:
            config.extra.update(extra_params)
        
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
        if execution_lock:
            async with execution_lock:
                result = await compiled_flow.run(input_message, context, cancel_event=cancel_event)
                compiled_flow._is_new = False
                return result
        else:
            result = await compiled_flow.run(input_message, context, cancel_event=cancel_event)
            compiled_flow._is_new = False
            return result
    
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
        
        if not agent._initialized:
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
            "token_usage": tokens,
            "duration_ms": duration_ms
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
                yield event.to_dict()
