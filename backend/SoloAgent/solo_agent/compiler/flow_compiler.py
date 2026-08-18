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
from typing import Dict, Any, List, Optional, Callable, AsyncGenerator
from collections import OrderedDict
from threading import Lock
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from dataclasses import dataclass, field

from ..config import SoloAgentConfig
from ..agent import SoloAgent
from ...message import Msg
from app.core.config import settings

logger = logging.getLogger("SoloEngine")


# 压缩后 resume 续接指令（参考 Claude Code getCompactUserSummaryMessage 的
# suppressFollowUpQuestions 语义：直接恢复、不复述、不提问、不确认摘要）
RESUME_PROMPT = """[上下文压缩已完成。基于以上摘要继续执行之前的任务。]

直接恢复——不要确认摘要、不要复述之前发生了什么、不要以"我将继续"或类似内容开头。就像中断从未发生过一样，接着完成最后一个任务。

如果根据摘要判断最后一个任务已经全部完成（所有步骤已执行、结果已产出并交付），则立即结束执行并输出最终结果。禁止重新探索工作目录、禁止重新读取已读过的文件、禁止执行与任务无关的操作。"""

# 自动压缩熔断器：连续失败次数上限（参考 Claude Code MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3）
MAX_CONSECUTIVE_COMPACTION_FAILURES = 3


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
    parent_message_id: Optional[str] = None  # 改动 3 文件 E：subagent 消息的 parent_message_id
    status: Optional[str] = None
    error: Optional[str] = None
    file_changes: Optional[List[Dict]] = None
    timestamp: str = field(default_factory=lambda: datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)).isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "event_type": self.event_type,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "agent_type": self.metadata.get("agent_type") if self.metadata else None,
            "content": self.content,
            "tool_name": self.tool_name,
            "tool_type": self.tool_type,
            "tool_args": self.tool_args,
            "tool_result": self.tool_result,
            "tool_call_id": self.tool_call_id,
            "parent_message_id": self.parent_message_id,
            "status": self.status,
            "error": self.error,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
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

        # 执行计时（会话级 token 统计改由 run.py 从 session_messages 聚合，2026-08-04）
        self._start_time: Optional[datetime] = None
        self._event_callback: Optional[Callable[[ExecutionEvent], None]] = None
        self._stream_callback: Optional[Callable[[str], None]] = None
        self._agent_memories: Dict[str, List[Dict]] = {}
        self._created_time: float = time.time()
        self._is_new: bool = True
        self._active_models: Dict[str, Any] = {}
        self._cancel_event: asyncio.Event = asyncio.Event()
        # 压缩熔断器状态：agent_id -> 连续压缩失败次数（成功清零；≥MAX 后跳过压缩轮）
        self._compaction_failures: Dict[str, int] = {}

        # 〇·3 并发方案（第 2 层·实例层隔离）：
        # _agent_configs：编译期 agent 配置快照（create_agent_instance 每次新建独立实例用，
        # 同一 agent 并发 N 次调用 = N 个独立实例，消除编译期单实例共享状态冲突）。
        # _execution_instances：execution_key -> SoloAgent 执行实例注册表（创建即注册、
        # 执行结束清理），保存链路 _get_agent_token_usage（run.py）按此取用实例 usage——
        # 并发实例不在 agents 字典，必须按注册表取。
        self._agent_configs: Dict[str, Any] = {aid: a.config for aid, a in agents.items()}
        self._execution_instances: Dict[str, SoloAgent] = {}

        # 方案 G 改动 1：给每个 agent 设置反向引用，方便被 task 调用的 agent 通过 _parent_agent._compiled_flow 访问 CompiledFlow
        for agent in agents.values():
            agent._compiled_flow = self

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
            "output": output or "",  # ★ 只用 output，不用 error 填充，避免 error 污染 output
            "tokens": tokens,
            # 剪枝（P7）：原 "token_usage": None 为死字段（run.py 已不再读取，
            # 会话级 token_usage 由 run.py 从 session_messages 聚合）
            "duration_ms": duration_ms,
        }
        if error:
            result["error"] = error
        result.update(extra_fields)
        return result

    def _finalize_result(self, result):
        result["status"] = result.get("status", "completed")
        result["duration_ms"] = self._calc_duration_ms()

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

    def _new_execution_key(self, agent_id: str) -> str:
        """生成每次 _execute_agent 调用唯一的执行标识（〇·3，必填无兜底）。

        格式 f"{agent_id}#{uuid.uuid4().hex[:8]}"：同一 agent 并发 N 实例时各实例键唯一。
        execution_key 是每次 _execute_agent 调用必备的唯一标识（可空无语义价值），
        贯穿 ChunkCollector 收集 / 保存字典 / _active_models / _compaction_failures /
        stream_callback / 前端 agent 栈。全部 4 处 _execute_agent 调用方统一调用本方法
        生成并显式传入，无重复代码、无 if None 兜底。
        """
        import uuid
        return f"{agent_id}#{uuid.uuid4().hex[:8]}"

    def create_agent_instance(self, agent_id: str, execution_key: str) -> SoloAgent:
        """为每次 _execute_agent 调用创建独立 SoloAgent 实例（〇·3 第 2 层·实例层隔离）。

        同一 subagent 并发 N 次 Task 调用 = N 个独立实例（独立 _conversation_history/
        _accumulated_usage/_interrupted/_compaction_failures），消除编译期单实例共享冲突。
        - SoloAgent(config) 新建模型/工具配置（MCP 连接 Host 层共享不重建）
        - 补设 _compiled_flow=self（方案 G 改动 1 反向引用，与 __init__ 对模板的处理一致）
        - _mcp_servers_info 取模板（agents[agent_id]），MCP 连接 Host 层共享
        - set_subagents(模板._subagents, 模板._subagents_info)：仅传递子 agent 配置关系；
          子 subagent 的实际执行实例由 Task 工具内统一走本方法惰性创建（嵌套并发同样
          实例隔离），无需递归克隆（"所有 agent 一套逻辑"在嵌套场景的体现）。
        - 创建后注册进 _execution_instances（保存链路 _get_agent_token_usage 按此取用）；
          注册键与传入的 execution_key 一致，create_agent_instance → 执行 → 事件 →
          保存时序保证取用必命中，取不到即 bug（严禁回退 agents[agent_id]）。
        """
        if agent_id not in self.agents:
            raise ValueError(f"[create_agent_instance] Unknown agent_id: {agent_id}")
        template = self.agents[agent_id]
        instance = SoloAgent(config=template.config)
        instance._compiled_flow = self
        if hasattr(template, '_mcp_servers_info'):
            instance._mcp_servers_info = template._mcp_servers_info
        if hasattr(template, '_subagents') and hasattr(template, '_subagents_info'):
            instance.set_subagents(template._subagents, template._subagents_info)
        self._execution_instances[execution_key] = instance
        logger.info(f"[CompiledFlow] create_agent_instance agent_id={agent_id} execution_key={execution_key}")
        return instance
    
    async def run(self, input_message: Msg, context: Dict[str, Any] = None, cancel_event: asyncio.Event = None) -> Dict[str, Any]:
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
        
        logger.info(f"[CompiledFlow.run] Starting run with session_id={self.session_id}, user_id={self.user_id}, run_project_id={self.run_project_id}, agentic_flow_id={self.agentic_flow_id}")

        try:
            result = await self._run_internal(input_message, context, cancel_event=cancel_event)
            return result
        except Exception as e:
            logger.error(f"[CompiledFlow.run] Execution failed: {e}", exc_info=True)
            return self._build_result_dict(
                "failed", error=str(e),  # ★ 不再设置 output=f"执行失败: {str(e)}"，避免 error 写入 output
                session_id=self.session_id, agentic_flow_id=self.agentic_flow_id,
                run_project_id=self.run_project_id,
            )
    
    async def _run_internal(self, input_message: Msg, context: Dict[str, Any], cancel_event: asyncio.Event = None) -> Dict[str, Any]:
        orchestrator = self.get_orchestrator()
        
        if orchestrator is None:
            if len(self.agents) == 1:
                agent = list(self.agents.values())[0]
                result = await self._execute_agent(agent, input_message, context,
                                                   execution_key=self._new_execution_key(agent.agent_id),
                                                   cancel_event=cancel_event)
                
                if isinstance(result, dict):
                    self._finalize_result(result)
                
                return result
            else:
                entry_nodes = self.get_entry_nodes()
                if not entry_nodes:
                    entry_nodes = list(self.agents.keys())
                
                results = {}
                error_messages = []
                for entry_id in entry_nodes:
                    agent = self.agents.get(entry_id)
                    if agent:
                        result = await self._execute_agent(agent, input_message, context,
                                                           execution_key=self._new_execution_key(agent.agent_id),
                                                           cancel_event=cancel_event)
                        results[entry_id] = result
                        if isinstance(result, dict) and result.get("status") == "failed" and result.get("error"):
                            error_messages.append(result["error"])
                
                output = self._aggregate_results(results)
                # flow 自身终态 = entry agents 实际执行状态的聚合（failed > stop > completed）。
                # 状态聚合是 flow 确定终态的唯一逻辑：任一 entry 失败 → failed；
                # 任一 entry 被暂停（用户停止）→ stop；全部正常 → completed。
                # 此前多 agent 分支硬编码 completed，用户暂停的 stop 状态被覆盖丢失。
                final_status = self._aggregate_execution_status(results)
                
                if final_status == "failed":
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
                
                if final_status == "stop":
                    # 用户暂停：保持 stop 终态，不 emit execution_complete
                    #（由 run.py on_execution_done 发 execution_stopped）。
                    logger.info(f"[_run_internal] Entry agent stopped, keeping status='stop'")
                    return self._build_result_dict(
                        "stop", output=output,
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
            result = await self._execute_agent(orchestrator, input_message, context,
                                               execution_key=self._new_execution_key(orchestrator.agent_id),
                                               cancel_event=cancel_event)
            
            if isinstance(result, dict):
                self._finalize_result(result)
            
            return result
    
    async def _execute_agent(
        self,
        agent: SoloAgent,
        input_message: Msg,
        context: Dict[str, Any],
        execution_key: str,
        cancel_event: asyncio.Event = None,
        parent_agent_id: str = None,
        parent_agent_name: str = None,
        task_content: str = None,
    ) -> Dict[str, Any]:
        
        agent_id = agent.agent_id
        agent_name = agent.name

        # str→Msg: 提取文本内容用于事件和内存
        input_text = input_message.get_text_content() if hasattr(input_message, 'get_text_content') else str(input_message)

        # 生成消息ID（用于关联文件变更）
        import uuid
        message_id = str(uuid.uuid4())

        # 获取工作目录
        working_dir = agent.config.work_dir if hasattr(agent.config, 'work_dir') else None

        # 统一 agent_start：所有 agent（mainagent + subagent）统一事件，metadata 携带 message_id + parent 信息
        # execution_key（〇·3）：每次 _execute_agent 调用唯一，随事件透传前端 agent 栈
        #（并发实例同 agent_id 时栈元素按 execution_key 区分）与 run.py 保存链路。
        # parent_execution_key：被 Task 调用时携带调用方实例的执行键（task 消息的
        # parent_message_id 定位依据——_pending_agent_message_ids 键为 execution_key）。
        self._emit_event(ExecutionEvent(
            event_type="agent_start",
            agent_id=agent_id,
            agent_name=agent_name,
            agent_type=agent.agent_type,
            content=input_text,
            metadata={
                "message_id": message_id,
                "parent_agent_id": parent_agent_id,
                "parent_agent_name": parent_agent_name,
                "task_content": task_content or input_text,
                "execution_key": execution_key,
                "parent_execution_key": getattr(agent, '_parent_execution_key', None),
            }
        ))
        
        # 跟踪该 agent 在本次执行中是否产生过流式输出（collector 有数据）：
        # 压缩轮"保存 pre-compaction 输出"的判断依据——只要该 agent 有过 LLM 流式输出
        #（无论最后一次 reply 返回的 Msg 是否为空），collector 中就有 pre-compaction 内容，
        # 就必须在压缩轮 ① 保存为 stop 记录（否则旧输出会残留进 compacted 摘要记录）。
        flow_agent_output = {"has_output": False}
        if self._stream_callback and hasattr(agent, 'set_stream_callback'):
            flow_orig_stream = self._stream_callback

            def flow_tracked_stream(block, **kwargs):
                flow_agent_output["has_output"] = True
                if flow_orig_stream:
                    flow_orig_stream(block, **kwargs)

            agent.set_stream_callback(flow_tracked_stream)
        
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
        
        # 〇·3：写入 execution_key 到 ReActCore（_core 在 initialize 后才存在）。
        # react_core 全部 6 处 stream_callback 调用据此携带 execution_key，
        # ChunkCollector 按 execution_key 独立收集（同一 agent 并发 N 实例互不混淆）。
        # agent._execution_key 同步设置：嵌套 Task 工具据此读取父实例执行键
        #（task 消息 parent_message_id 定位）。
        if hasattr(agent, '_core') and agent._core is not None and hasattr(agent._core, 'set_execution_key'):
            agent._core.set_execution_key(execution_key)
            logger.info(f"[_execute_agent] Set execution_key={execution_key} on core for agent {agent_id}")
        agent._execution_key = execution_key

        # 〇·3：统一注册执行实例（main/sub 同一路径：mainagent 直接 _execute_agent 的模板
        # 实例、subagent 经 create_agent_instance 的独立实例，均按 execution_key 注册），
        # 保存链路 _get_agent_token_usage 按此取用 take_token_usage（取不到 = bug 直接报错）
        self._execution_instances[execution_key] = agent

        # 注册 agent.model 到 _active_models 注册表（键改 execution_key：并发实例独立取消）
        if hasattr(agent, '_core') and hasattr(agent._core, 'model'):
            self._active_models[execution_key] = agent._core.model
            logger.info(f"[_execute_agent] Registered model for agent {agent_id} (execution_key={execution_key})")
        
        try:
            original_reply = agent.reply
            
            async def wrapped_reply(message: Msg) -> str:
                # 每次 reply 独立跟踪流式输出（resume 轮从头计数）
                flow_agent_output["has_output"] = False
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
            
            # 后端聚合改造（3.2-1）：agent_core 取值统一提前到 wrapped_reply 之前，
            # 并重置 agent 级整轮累计（_agent_accumulated_usage 不随 take_accumulated_usage
            # 消费清空，由本次 _execute_agent 执行开始处重置；跨压缩轮 stop/compacted/resume
            # 全部阶段持续累计，是消息头/组头"整轮"显示的数据源）。
            agent_core = agent._core if hasattr(agent, '_core') else None
            if agent_core and hasattr(agent_core, 'reset_agent_usage'):
                agent_core.reset_agent_usage()
            
            response = await wrapped_reply(input_message)

            was_interrupted = agent_core.is_interrupted() if agent_core else False
            logger.info(f"[_execute_agent] agent_id={agent_id}, was_interrupted={was_interrupted}")

            # ★ 压缩轮次：停止 且 非用户停止（用户停止时 cancel_event 必已 set，见 stop_execution 顺序）
            # 完全复用用户手动停止路径：emit agent_complete(stop) → 保存 pre-compaction 输出
            # → 生成摘要并独立保存（压缩轮次）→ 批量标记旧消息 → 恢复执行（while 支持多次压缩）
            while was_interrupted and not (cancel_event and cancel_event.is_set()):
                # 熔断器：连续压缩失败 ≥ MAX 后跳过后续压缩轮（历史完整保留，以 stop 结束）
                # 键改 execution_key（〇·3）：并发实例失败计数隔离
                if not self._compaction_allowed(execution_key):
                    logger.warning(
                        f"[_execute_agent] Compaction skipped for agent {agent_id} "
                        f"(circuit breaker: {self._compaction_failures.get(execution_key, 0)} consecutive failures)"
                    )
                    break

                logger.info(f"[_execute_agent] Compaction round for agent {agent_id}")

                # ① emit agent_complete(status="stop") → event_callback 保存 pre-compaction 输出
                # 仅属于"有实际输出的轮次"：压缩检测在调用 LLM 之前完成（_reasoning 内 L864-870，
                # 超阈值 return None 不调用 LLM）。判断依据 = 该 agent 在本轮执行中是否产生过
                # 流式输出（collector 有该 agent 的 blocks）——有输出则保存为 stop 记录（压缩前
                # 的 LLM 块），同时清空 collector，保证 compacted 摘要记录为纯摘要；未调用 LLM
                # 的无输出压缩轮从流程上不产生空 stop 保存（流程设计使然：无输出实体 → 无空记录；
                # 而非"跳过保存空记录"式补丁）。
                if flow_agent_output["has_output"]:
                    save_done_event = asyncio.Event()
                    # 压缩前 stop 轮的 usage（查询不消费；消息保存时 run.py take 消费）
                    stop_tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
                    self._emit_event(ExecutionEvent(
                        event_type="agent_complete",
                        agent_id=agent_id,
                        agent_name=agent_name,
                        content=response,
                        message=agent.get_last_openai_message() if hasattr(agent, 'get_last_openai_message') else {"role": "assistant", "content": response, "reasoning_content": None},
                        status="stop",
                        metadata={
                            "parent_agent_id": parent_agent_id,
                            "parent_agent_name": parent_agent_name,
                            "tokens": stop_tokens,
                            "agent_usage": agent.get_agent_usage() if hasattr(agent, 'get_agent_usage') else None,
                            "save_done_event": save_done_event,
                            "compaction_round": True,
                            "execution_key": execution_key,
                        }
                    ))
                    # ② 等待 pre-compaction 保存完成（防止 remove_agent_data 未执行导致重复保存）
                    await save_done_event.wait()
                else:
                    logger.info(
                        f"[_execute_agent] No pre-compaction output for agent {agent_id}, "
                        f"skip empty stop save (compaction triggered before LLM call)"
                    )
                # ③ 生成压缩摘要（正常 stream，进 collector + 前端）
                # 失败保护：compact() 抛异常时不标记旧消息、不丢历史（熔断器计数）
                try:
                    if agent_core:
                        await agent_core.compact(cancel_event=cancel_event)
                    self._compaction_failures[execution_key] = 0
                except Exception as e:
                    self._compaction_failures[execution_key] = self._compaction_failures.get(execution_key, 0) + 1
                    logger.error(
                        f"[_execute_agent] Compaction failed for agent {agent_id}: {e} "
                        f"(consecutive_failures={self._compaction_failures[execution_key]})"
                    )
                    break
                # ④ 摘要独立保存（status="compacted"）：压缩轮次作为独立消息，前端块中断、轮次可见
                save_done_event = asyncio.Event()
                # 方案 B（独立快照）：摘要轮 usage = 当前累计（stop 保存时已 take 消费清空），
                # 查询不消费；compacted 消息保存时 run.py take 消费。
                compacted_tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
                self._emit_event(ExecutionEvent(
                    event_type="agent_complete",
                    agent_id=agent_id,
                    agent_name=agent_name,
                    content=None,
                    message=None,
                    status="compacted",
                    metadata={
                        "parent_agent_id": parent_agent_id,
                        "parent_agent_name": parent_agent_name,
                        "tokens": compacted_tokens,
                        "agent_usage": agent.get_agent_usage() if hasattr(agent, 'get_agent_usage') else None,
                        "save_done_event": save_done_event,
                        "compaction_round": True,
                        "execution_key": execution_key,
                    }
                ))
                await save_done_event.wait()
                # ⑤ 批量标记旧消息 is_compressed=1（仅在摘要保存成功后执行，防失败丢历史）
                # 〇·5 统一规则：main/sub 完全同一规则，无 mark_user_msgs 分支
                await self._batch_mark_compressed(agent_id)
                # ⑥ resume：用续接指令继续执行（避免 user_msg 重复；不复述、不提问）
                continue_msg = Msg(name="user", content=RESUME_PROMPT, role="user")
                response = await wrapped_reply(continue_msg)
                was_interrupted = agent_core.is_interrupted() if agent_core else False

            if agent_core and hasattr(agent_core, '_conversation_history'):
                # 原有逻辑：追加本轮历史
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
                    agent_memory.append({"role": "user", "data": [{"type": "content", "content": input_text}]})
                    agent_memory.append({"role": "assistant", "data": [{"type": "content", "content": response}]})
                self._agent_memories[agent_id] = agent_memory
            else:
                agent_memory.append({"role": "user", "data": [{"type": "content", "content": input_text}]})
                agent_memory.append({"role": "assistant", "data": [{"type": "content", "content": response}]})
                self._agent_memories[agent_id] = agent_memory
            
            tool_calls = []
            if hasattr(agent, '_last_tool_calls') and agent._last_tool_calls:
                tool_calls = agent._last_tool_calls.copy()
            
            openai_message = agent.get_last_openai_message() if hasattr(agent, 'get_last_openai_message') else {"role": "assistant", "content": response, "reasoning_content": None}
            
            tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
            
            if tokens:
                logger.info(f"[Token Usage] Final: {tokens}")
            
            result = self._build_result_dict(
                "stop" if was_interrupted else "completed", agent_id=agent_id, agent_name=agent_name,
                output=response, tokens=tokens, duration_ms=self._calc_duration_ms(),
                agent_type=agent.agent_type, user_id=self.user_id,
                agentic_flow_id=self.agentic_flow_id, run_project_id=self.run_project_id,
                session_id=self.session_id, message=openai_message,
                tool_calls=tool_calls,
            )
            
            # 统一 agent_complete：所有 agent 统一事件，metadata 携带 parent 信息和 tokens
            # agent_usage（3.2-3）：agent 级整轮累计（消息头/组头整轮显示，与 tokens 的本阶段语义正交）
            # execution_key（〇·3）：前端 agent 栈按此弹出实例（并发实例独立出栈）
            # save_done_event（〇·3 竞态修复）：最终完成轮与压缩轮 stop/compacted 保存同一
            # 等待语义——保存完成后 finally 才清理 _execution_instances（run.py 异步保存任务
            # 执行时注册表仍可用，_get_agent_token_usage 按 execution_key 取用不落空）
            save_done_event = asyncio.Event()
            self._emit_event(ExecutionEvent(
                event_type="agent_complete",
                agent_id=agent_id,
                agent_name=agent_name,
                content=openai_message.get("content", response) if openai_message else response,
                message=openai_message,
                status="stop" if was_interrupted else "completed",
                metadata={
                    "parent_agent_id": parent_agent_id,
                    "parent_agent_name": parent_agent_name,
                    "tokens": tokens,
                    "agent_usage": agent.get_agent_usage() if hasattr(agent, 'get_agent_usage') else None,
                    "save_done_event": save_done_event,
                    "execution_key": execution_key,
                }
            ))
            await save_done_event.wait()

            return result

        except Exception as e:
            import traceback
            logger.error(f"Agent execution failed: {agent_name} - {e}")
            logger.error(traceback.format_exc())

            partial_tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
            if partial_tokens:
                logger.info(f"[Token Usage] Partial tokens from failed agent: {partial_tokens}")

            # 统一 agent_error：所有 agent 统一事件，metadata 携带 parent 信息
            # execution_key（〇·3）+ save_done_event：与 agent_complete 同一保存等待语义
            #（错误消息也走 _save_agent_messages 统一保存路径，注册表清理前必须等待保存完成）
            save_done_event = asyncio.Event()
            self._emit_event(ExecutionEvent(
                event_type="agent_error",
                agent_id=agent_id,
                agent_name=agent_name,
                error=str(e),
                status="error",
                metadata={
                    "parent_agent_id": parent_agent_id,
                    "parent_agent_name": parent_agent_name,
                    "execution_key": execution_key,
                    "save_done_event": save_done_event,
                }
            ))
            await save_done_event.wait()
            
            return self._build_result_dict(
                "failed", agent_id=agent_id, agent_name=agent_name,
                error=str(e),
            )
        finally:
            # 会话级 token 累计已改由 run.py 从 session_messages 聚合（2026-08-04），
            # 此处不再内存累计；tokens 仅保留日志用途
            tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
            # 键改 execution_key（〇·3）：并发实例独立取消/清理
            self._active_models.pop(execution_key, None)
            self._execution_instances.pop(execution_key, None)
            self._compaction_failures.pop(execution_key, None)
            logger.info(f"[_execute_agent] Unregistered model for agent {agent_id} (execution_key={execution_key})")
    
    def _compaction_allowed(self, execution_key: str) -> bool:
        """熔断器：连续压缩失败是否已达上限（参考 Claude Code MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES）。

        键为 execution_key（〇·3）：同一 agent 并发实例失败计数隔离。
        """
        return self._compaction_failures.get(execution_key, 0) < MAX_CONSECUTIVE_COMPACTION_FAILURES

    async def _batch_mark_compressed(self, agent_id: str = None):
        """批量标记被压缩 agent 的旧消息为 is_compressed=True（〇·5 无分支统一规则）。

        压缩语义核心（见 run.py load_and_distribute_memories 的 is_compressed=False 查询）：
        旧消息被摘要覆盖后标记为已压缩，不再进入 LLM 上下文；
        摘要与压缩后新增消息保持 is_compressed=0。

        标记范围（〇·5 统一规则，main/sub 完全同一规则）：
        压缩 agent A 时，标记 A 上下文内压缩前的所有消息：
        - assistant：A 的全部未压缩消息（含 pre-compaction 输出）
        - user：A 的 user 消息中，message_index < 最后一条 user 的消息
          （最后一条 user = 压缩时刻该 agent 上下文内 message_index 最大的 user 消息，
          保持 is_compressed=0 作为压缩后 resume 的上下文锚点——LLM 直接看到当前
          任务原始指令）
        - 摘要消息（status='compacted'）**排除**（它刚保存，必须保持 is_compressed=0 供下轮加载）
        mainagent 的人类输入 user（on_flow_created 回填后 agent_id=入口 agent）与
        subagent 的 task user（agent_id=subagent）同一规则处理，无任何区分分支。

        依赖：标记端按 agent_id == A 命中 user 消息的前提是 run.py on_flow_created
        回填已完成（〇·5 保存端改造先行实施）。

        仅在摘要保存成功后调用（见 _execute_agent 压缩循环 ⑤），压缩失败时不标记、不丢历史。
        """
        from sqlalchemy import func, or_, and_
        from app.core.database import get_db_context, SessionMessageModel
        try:
            with get_db_context() as db:
                # 1) 先查该 agent 的 user 消息最大 message_index（最后一条 user = resume 锚点）
                last_user_idx = db.query(
                    func.max(SessionMessageModel.message_index)
                ).filter(
                    SessionMessageModel.session_id == self.session_id,
                    SessionMessageModel.agent_id == agent_id,
                    SessionMessageModel.role == "user",
                ).scalar()
                # 2) 统一 UPDATE：assistant 全部 + user 除最后一条（无 user 消息时 last_user_idx
                #    为 None，user 条件 message_index < -1 恒 false → 只标 assistant，天然正确）
                query = db.query(SessionMessageModel).filter(
                    SessionMessageModel.session_id == self.session_id,
                    SessionMessageModel.is_compressed == False,
                    SessionMessageModel.status != "compacted",
                    SessionMessageModel.agent_id == agent_id,
                    or_(
                        SessionMessageModel.role == "assistant",
                        and_(
                            SessionMessageModel.role == "user",
                            SessionMessageModel.message_index < (last_user_idx if last_user_idx is not None else -1),
                        ),
                    ),
                )
                updated = query.update({"is_compressed": True}, synchronize_session=False)
                db.commit()
                logger.info(
                    f"[CompiledFlow] Marked {updated} messages as compressed in session "
                    f"{self.session_id} for agent {agent_id} (last_user_idx={last_user_idx})"
                )
        except Exception as e:
            logger.error(f"[CompiledFlow] Failed to batch mark compressed: {e}", exc_info=True)

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

    def _aggregate_execution_status(self, results: Dict[str, Any]) -> str:
        """聚合 entry agents 执行状态，确定 flow 自身终态（多 agent 分支）。

        优先级：failed > stop > completed。flow 的终态由实际执行的 entry agents
        状态决定——任一失败则整体 failed；任一被暂停（用户停止）则整体 stop；
        全部正常才 completed。此前多 agent 分支硬编码 completed，
        用户暂停的 stop 状态在聚合时被覆盖丢失。
        """
        final_status = "completed"
        for agent_id, result in results.items():
            if not isinstance(result, dict):
                continue
            status = result.get("status")
            if status == "failed":
                return "failed"
            if status == "stop":
                final_status = "stop"
        return final_status
    
    async def run_agent(self, agent_id: str, message: Msg) -> str:
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

            # 修复：只比较 cached agents 实际使用的 config 的版本，而不是所有配置
            cached_llm_config_ids = set()
            for agent in cached.agents.values():
                if hasattr(agent.config, '_llm_config_id') and agent.config._llm_config_id:
                    cached_llm_config_ids.add(agent.config._llm_config_id)

            # cached_config_versions 从 agent.config._llm_config_version（编译时快照）读取
            # current_config_versions 从当前数据库按 cached_llm_config_ids 过滤读取
            # 恢复"快照 vs 当前"的比较语义，保留"收窄比较范围"的本地意图
            cached_config_versions = set()
            for agent in cached.agents.values():
                if hasattr(agent.config, '_llm_config_version') and agent.config._llm_config_version:
                    cached_config_versions.add(agent.config._llm_config_version)

            current_config_versions = set()
            for cfg_id in cached_llm_config_ids:
                if cfg_id in current_llm_configs:
                    cfg = current_llm_configs[cfg_id]
                    if cfg.version:
                        current_config_versions.add(cfg.version)

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
        is_full_url = bool(getattr(config, 'is_full_url', False))
        api_key = encryption_service.decrypt(config.api_key) if config.api_key else None
        timeout = config.timeout
        extra_params = config.extra_params if hasattr(config, 'extra_params') else None

        # ★ 模型参数只能从 canvas node 的 model_config 中获取
        #    model_config 是默认值 → 填入 canvas → 运行时从 canvas 获取
        #    只有 api_key、base_url、provider、model_name 从 DB llm_configs 表获取
        node_name = node_data.get('name', node_id)
        
        temperature = model_config.get("temperature")
        if temperature is None:
            raise ValueError(f"节点 '{node_name}' 未设置 temperature。请在画布中配置后重新保存。")
        
        max_output_tokens = model_config.get("max_output_tokens")
        if max_output_tokens is None:
            raise ValueError(f"节点 '{node_name}' 未设置 max_output_tokens。请在画布中配置后重新保存。")
        
        max_input_tokens = model_config.get("max_input_tokens")
        if max_input_tokens is None:
            raise ValueError(f"节点 '{node_name}' 未设置 max_input_tokens。请在画布中配置后重新保存。")
        
        top_p = model_config.get("top_p")
        frequency_penalty = model_config.get("frequency_penalty", 0)
        presence_penalty = model_config.get("presence_penalty", 0)
        
        # ★ 工具调用轮次：必须从画布节点 model_config 获取（默认值来自 llm_config 并写入 canvas），
        #   禁止降级到默认值；缺失/非法时直接报错，让用户明确得知配置问题（与 max_input_tokens 同规则）。
        max_tool_calls = model_config.get("max_tool_calls")
        if max_tool_calls is None or max_tool_calls <= 0:
            raise ValueError(
                f"节点 '{node_name}' 未设置 max_tool_calls（工具调用轮次）。"
                f"请在画布中为该节点配置 max_tool_calls 后重新保存。"
            )
        
        logger.info(f"Using LLM config: {config.name} ({config.provider}/{config.model_name}), config_id={llm_config_id}")
        logger.info(f"LLM params from selected config: temperature={temperature}, max_output_tokens={max_output_tokens}, max_input_tokens={max_input_tokens}, frequency_penalty={frequency_penalty}, presence_penalty={presence_penalty}, max_tool_calls={max_tool_calls}")
        
        # ★ 任务3：删除 api_key 强制检查，让 LLM API 自己检查 api_key

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
            "enter_plan_mode": "EnterPlanMode",
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
            is_full_url=is_full_url,
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
            # ★ 工具调用轮次（max_tool_calls）：一次 react_core 循环中 agent 允许调用 LLM API 的次数上限。
            #   只能从画布节点 model_config 获取（默认值来自 llm_config 并写入 canvas），禁止降级到默认值。
            #   同时作为 react_core 循环上限（max_iters），保证两者一致。
            max_tool_calls=max_tool_calls,
            max_iters=max_tool_calls,
            stream=node_data.get("stream", True),
            agent_type=node_data.get("agentType", "executor"),
            work_dir=work_dir,
            max_tokens=max_output_tokens,
            max_input_tokens=max_input_tokens,
            max_output_tokens=max_output_tokens,
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
        input_message: Msg,
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
