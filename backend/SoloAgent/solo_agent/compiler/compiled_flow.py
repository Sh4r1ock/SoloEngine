# -*- coding: utf-8 -*-
import logging
import asyncio
import hashlib
import json
from typing import Dict, Any, List, Optional, Callable, TYPE_CHECKING
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

if TYPE_CHECKING:
    from .mcp_host_client_manager import MCPHostClientManager


# 压缩后 resume 续接指令（参考 Claude Code getCompactUserSummaryMessage 的
# suppressFollowUpQuestions 语义：直接恢复、不复述、不提问、不确认摘要）
RESUME_PROMPT = """[上下文压缩已完成。基于以上摘要继续执行之前的任务。]

直接恢复——不要确认摘要、不要复述之前发生了什么、不要以"我将继续"或类似内容开头。就像中断从未发生过一样，接着完成最后一个任务。

如果根据摘要判断最后一个任务已经全部完成（所有步骤已执行、结果已产出并交付），则立即结束执行并输出最终结果。禁止重新探索工作目录、禁止重新读取已读过的文件、禁止执行与任务无关的操作。"""

# 自动压缩熔断器：连续失败次数上限（参考 Claude Code MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3）
MAX_CONSECUTIVE_COMPACTION_FAILURES = 3


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
        self._is_new: bool = True
        self._active_models: Dict[str, Any] = {}
        self._cancel_event: asyncio.Event = asyncio.Event()
        # 压缩熔断器状态：agent_id -> 连续压缩失败次数（成功清零；≥MAX 后跳过压缩轮）
        self._compaction_failures: Dict[str, int] = {}

        # 〇·3 并发方案（第 2 层·实例层隔离）：
        # _instances：message_id -> SoloAgent 执行实例注册表（创建即注册、
        # 执行结束清理），保存链路 _get_agent_token_usage（run.py）按此取用实例 usage——
        # 并发实例不在 agents 字典，必须按注册表取。
        self._instances: Dict[str, SoloAgent] = {}

        # 方案 G 改动 1：给每个 agent 设置反向引用，方便被 task 调用的 agent 通过 _parent_agent._compiled_flow 访问 CompiledFlow
        # C2：改经 SoloAgent 公开 setter 写入（不直接写私有属性 _compiled_flow）
        for agent in agents.values():
            agent.set_compiled_flow(self)

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

    # ---- B4 路径合并：agent_complete / agent_error 事件唯一构造（3 处 + 1 处收敛）----

    def _emit_agent_complete(
        self,
        agent_id: str,
        agent_name: str,
        content,
        message,
        status: str,
        parent_agent_id: Optional[str],
        parent_agent_name: Optional[str],
        tokens,
        agent_usage,
        message_id: str,
        save_done_event: asyncio.Event,
        compaction_round: bool = False,
        record_message_id: str = None,
    ) -> None:
        """agent_complete 事件唯一构造（B4：压缩轮 stop/compacted + 最终完成轮 3 处收敛）。

        metadata 统一携带 parent 信息 / tokens / agent_usage / save_done_event /
        message_id；压缩轮（compaction_round=True）额外携带 compaction_round 标记。
        record_message_id：DB 记录 id 覆盖（压缩轮 compacted 摘要保存专用——stop 记录已
        占用执行实例 message_id，摘要必须独立 id 才能落库，否则 UNIQUE 冲突摘要丢失；
        取数仍走 message_id，记录 id 独立）。
        """
        metadata = {
            "parent_agent_id": parent_agent_id,
            "parent_agent_name": parent_agent_name,
            "tokens": tokens,
            "agent_usage": agent_usage,
            "save_done_event": save_done_event,
            "message_id": message_id,
        }
        if record_message_id:
            metadata["record_message_id"] = record_message_id
        if compaction_round:
            metadata["compaction_round"] = True
        self._emit_event(ExecutionEvent(
            event_type="agent_complete",
            agent_id=agent_id,
            agent_name=agent_name,
            content=content,
            message=message,
            status=status,
            metadata=metadata,
        ))

    def _emit_agent_error(
        self,
        agent_id: str,
        agent_name: str,
        error: str,
        parent_agent_id: Optional[str],
        parent_agent_name: Optional[str],
        message_id: str,
        save_done_event: asyncio.Event,
        record_message_id: str = None,
    ) -> None:
        """agent_error 事件唯一构造（B4：agent 级错误事件收敛）。

        message_id + save_done_event：与 agent_complete 同一保存等待语义
        （错误消息也走 _save_agent_messages 统一保存路径，注册表清理前必须等待保存完成）。
        record_message_id：DB 记录 id 覆盖（与 agent_complete 同一语义——执行实例
        message_id 已被压缩轮 stop 记录占用时，错误消息必须独立 id 落库）。
        """
        metadata = {
            "parent_agent_id": parent_agent_id,
            "parent_agent_name": parent_agent_name,
            "message_id": message_id,
            "save_done_event": save_done_event,
        }
        if record_message_id:
            metadata["record_message_id"] = record_message_id
        self._emit_event(ExecutionEvent(
            event_type="agent_error",
            agent_id=agent_id,
            agent_name=agent_name,
            error=error,
            status="error",
            metadata=metadata,
        ))
    
    def get_agent(self, agent_id: str) -> Optional[SoloAgent]:
        return self.agents.get(agent_id)

    def get_instance_agent(self, message_id: str) -> Optional[SoloAgent]:
        """公开查询执行实例（A3：run 层不读私有 _instances 注册表）。

        message_id（session_message_id，实例标识）：每个 _execute_agent 调用唯一——
        由 _execute_agent 内部生成（HEAD 机制）。子执行与产生它的 tool_call 的关联
        由 source_tool_call_id（tc.id）承载：保存链路持久化到 task 消息，回显按 tc.id 对号。
        返回该实例的 SoloAgent 对象；未注册时返回 None（由调用方按业务处理）。
        """
        return self._instances.get(message_id)
    
    def get_orchestrator(self) -> Optional[SoloAgent]:
        if self.orchestrator_id:
            return self.agents.get(self.orchestrator_id)
        return None
    
    def get_entry_nodes(self) -> List[str]:
        target_nodes = set()
        for child_ids in self.edges.values():
            target_nodes.update(child_ids)
        return [node_id for node_id in self.agents.keys() if node_id not in target_nodes]

    def create_agent_instance(self, agent_id: str) -> SoloAgent:
        """为每次 _execute_agent 调用创建独立 SoloAgent 实例（〇·3 第 2 层·实例层隔离）。

        同一 subagent 并发 N 次 Task 调用 = N 个独立实例（独立 _conversation_history/
        _accumulated_usage/_interrupted/_compaction_failures），消除编译期单实例共享冲突。
        - SoloAgent(config) 新建模型/工具配置（MCP 连接 Host 层共享不重建）
        - 补设 _compiled_flow=self（方案 G 改动 1 反向引用，与 __init__ 对模板的处理一致）
        - _mcp_servers_info 取模板（agents[agent_id]），MCP 连接 Host 层共享
        - set_subagents(模板._subagents, 模板._subagents_info)：仅传递子 agent 配置关系；
          子 subagent 的实际执行实例由框架钩子（SoloAgent._launch_subagent）统一走本方法
          惰性创建（嵌套并发同样实例隔离），无需递归克隆（"所有 agent 一套逻辑"在嵌套
          场景的体现）。
        - 不注册 _instances：message_id 由 _execute_agent 内部生成后统一注册
          （保存链路 _get_agent_token_usage 按 message_id 取用必命中，取不到即 bug）。
        """
        if agent_id not in self.agents:
            raise ValueError(f"[create_agent_instance] Unknown agent_id: {agent_id}")
        template = self.agents[agent_id]
        instance = SoloAgent(config=template.config)
        # C2：改经 SoloAgent 公开 setter（set_compiled_flow / set_mcp_servers_info），
        # 不直接写私有属性 _compiled_flow / _mcp_servers_info
        instance.set_compiled_flow(self)
        instance.set_mcp_servers_info(template.get_mcp_servers_info())
        if hasattr(template, '_subagents') and hasattr(template, '_subagents_info'):
            instance.set_subagents(template._subagents, template._subagents_info)
        logger.info(f"[CompiledFlow] create_agent_instance agent_id={agent_id}")
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
                                               cancel_event=cancel_event)
            
            if isinstance(result, dict):
                self._finalize_result(result)
            
            return result
    
    # C1：公开执行入口——跨层（SoloAgent._launch_subagent）经公开方法调用，
    # 不直接调用私有 _execute_agent（私有方法保留，_run_internal 内部使用）。
    async def execute_agent(
        self,
        agent: SoloAgent,
        input_message: Msg,
        context: Dict[str, Any],
        cancel_event: asyncio.Event = None,
        parent_agent_id: str = None,
        parent_agent_name: str = None,
        task_content: str = None,
        message_id: str = None,
        source_tool_call_id: str = None,
    ) -> Dict[str, Any]:
        """公开执行单个 Agent（与 _execute_agent 签名/行为完全一致）。"""
        return await self._execute_agent(
            agent, input_message, context,
            cancel_event=cancel_event,
            parent_agent_id=parent_agent_id,
            parent_agent_name=parent_agent_name,
            task_content=task_content,
            message_id=message_id,
            source_tool_call_id=source_tool_call_id,
        )

    async def _execute_agent(
        self,
        agent: SoloAgent,
        input_message: Msg,
        context: Dict[str, Any],
        cancel_event: asyncio.Event = None,
        parent_agent_id: str = None,
        parent_agent_name: str = None,
        task_content: str = None,
        message_id: str = None,
        source_tool_call_id: str = None,
    ) -> Dict[str, Any]:
        
        agent_id = agent.agent_id
        agent_name = agent.name

        # str→Msg: 提取文本内容用于事件和内存
        input_text = input_message.get_text_content() if hasattr(input_message, 'get_text_content') else str(input_message)

        # 生成消息ID（session_message_id，实例标识）：所有 agent 统一由 _execute_agent
        # 内部生成（HEAD 机制，历史消息 id）；subagent 不传参（message_id=None）。
        # 前端对号统一走 tc.id 方案：agent_start 携带 source_tool_call_id（产生本执行的
        # tool_call id），保存链路持久化到 task 消息，流式/回显均按 tc.id 精确对号。
        import uuid
        message_id = message_id or str(uuid.uuid4())

        # 获取工作目录
        working_dir = agent.config.work_dir if hasattr(agent.config, 'work_dir') else None

        # 统一 agent_start：所有 agent（mainagent + subagent）统一事件，metadata 携带 message_id + parent 信息
        # message_id：执行实例标识（session_message_id），随事件透传前端 agent 栈/归组与保存链路。
        # parent_message_id：父实例的 message_id（被工具调用启动时由工具写入 agent._parent_message_id），
        # 前端据此建立父子层级；保存链路 task 消息的 parent_message_id 亦用该值。
        # source_tool_call_id：产生本子执行的 tool_call 的 id（tc.id，LLM 生成，由产生它的工具传入）——
        # 前端在 agent_start（子组出现）时按 source_tool_call_id 精确嵌套到对应 tc 下（流式对号）。
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
                "parent_message_id": getattr(agent, '_parent_message_id', None),
                "source_tool_call_id": source_tool_call_id,
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
        
        # A2：执行前统一准备（SoloAgent.prepare_execution 封装全部私有属性访问：
        # _event_callback 注入 / set_file_change_context / set_message_history /
        # initialize / _on_tool_executed 桥接 / set_message_id + _message_id）。
        agent_memory = self._agent_memories.get(agent_id, [])
        working_dir = agent.config.work_dir if hasattr(agent.config, 'work_dir') else None
        if hasattr(agent, 'prepare_execution'):
            await agent.prepare_execution(
                message_id=message_id,
                cancel_event=cancel_event,
                event_callback=self._event_callback,
                working_dir=working_dir,
                memory=agent_memory,
            )
            logger.info(f"[_execute_agent] prepare_execution done for agent {agent_id} (message_id={message_id})")
        else:
            logger.warning(f"[_execute_agent] agent {agent_id} missing prepare_execution, skip execution prep")

        # 〇·3：统一注册执行实例（main/sub 同一路径：mainagent 直接 _execute_agent 的模板
        # 实例、subagent 经 create_agent_instance 的独立实例，均按 message_id 注册），
        # 保存链路 _get_agent_token_usage 按此取用 take_token_usage（取不到 = bug 直接报错）
        self._instances[message_id] = agent

        # 注册 agent.model 到 _active_models 注册表（键改 message_id：并发实例独立取消）
        core_model = agent.get_core_model() if hasattr(agent, 'get_core_model') else None
        if core_model:
            self._active_models[message_id] = core_model
            logger.info(f"[_execute_agent] Registered model for agent {agent_id} (message_id={message_id})")
        
        try:
            original_reply = agent.reply
            
            async def wrapped_reply(message: Msg) -> str:
                # 每次 reply 独立跟踪流式输出（resume 轮从头计数）
                flow_agent_output["has_output"] = False
                response = await original_reply(message, cancel_event=cancel_event or self._cancel_event)
                
                # A2：经公开方法读取最近一轮工具调用（不直接读 _last_tool_calls；
                # C2：SoloAgent 恒有公开方法 get_last_tool_calls，删除私有兜底）
                last_tool_calls = agent.get_last_tool_calls()
                for call in last_tool_calls:
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
            
            # 后端聚合改造（3.2-1）：agent 级整轮累计在 wrapped_reply 之前重置
            # （_agent_accumulated_usage 不随 take_accumulated_usage 消费清空，由本次
            # _execute_agent 执行开始处重置；跨压缩轮 stop/compacted/resume 全部阶段
            # 持续累计，是消息头/组头"整轮"显示的数据源）。A2：经公开方法调用。
            if hasattr(agent, 'reset_agent_usage'):
                agent.reset_agent_usage()
            
            # 多轮压缩状态变量必须在 wrapped_reply 之前初始化：首次 LLM 调用即抛异常时
            # （如鉴权失败），except 错误路径的 _emit_agent_error 会引用 stop_saved，
            # 未初始化则 UnboundLocalError 覆盖原始错误，错误消息无法保存。
            stop_saved = False
            compaction_round_count = 0
            
            response = await wrapped_reply(input_message)

            was_interrupted = agent.is_interrupted() if hasattr(agent, 'is_interrupted') else False
            logger.info(f"[_execute_agent] agent_id={agent_id}, was_interrupted={was_interrupted}")

            # ★ 压缩轮次：停止 且 非用户停止（用户停止时 cancel_event 必已 set，见 stop_execution 顺序）
            # 完全复用用户手动停止路径：emit agent_complete(stop) → 保存 pre-compaction 输出
            # → 生成摘要并独立保存（压缩轮次）→ 批量标记旧消息 → 恢复执行（while 支持多次压缩）
            # 多轮压缩 DB 记录 id 独立性（stop_saved/compaction_round_count）：
            # 执行实例 message_id 是前端归组键（流式 agent_start 携带、回显按该执行第一条
            # 记录 id 注入，见 run_api build_flattened_blocks instance_message_id）——它只能被
            # 一条 DB 记录占用（UNIQUE(session_id,id)）。第一条 stop 记录沿用 message_id
            # （保持与流式实例归组一致）；后续压缩轮 stop / compacted / 最终 completed 必须
            # 独立 id 落库，否则 UNIQUE 冲突 → 空记录兜底 + collector 清空 → pre-compaction
            # 输出/最终输出丢失（DB 实测：第二次起 stop 记录 blocks=0）。
            while was_interrupted and not (cancel_event and cancel_event.is_set()):
                # 熔断器：连续压缩失败 ≥ MAX 后跳过后续压缩轮（历史完整保留，以 stop 结束）
                # 键改 message_id（〇·3）：并发实例失败计数隔离
                if not self._compaction_allowed(message_id):
                    logger.warning(
                        f"[_execute_agent] Compaction skipped for agent {agent_id} "
                        f"(circuit breaker: {self._compaction_failures.get(message_id, 0)} consecutive failures)"
                    )
                    break

                compaction_round_count += 1
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
                    self._emit_agent_complete(
                        agent_id, agent_name,
                        response,
                        agent.get_last_openai_message() if hasattr(agent, 'get_last_openai_message') else {"role": "assistant", "content": response, "reasoning_content": None},
                        "stop",
                        parent_agent_id, parent_agent_name,
                        stop_tokens,
                        agent.get_agent_usage() if hasattr(agent, 'get_agent_usage') else None,
                        message_id, save_done_event,
                        compaction_round=True,
                        # 多轮压缩修复：仅第一条 stop 记录沿用执行实例 message_id（保持与
                        # 流式 agent_start 归组一致，回显按它注入同执行全部块）；后续压缩轮
                        # stop 必须独立 id 落库（否则 UNIQUE 冲突 → pre-compaction 输出丢失）
                        record_message_id=str(uuid.uuid4()) if stop_saved else None,
                    )
                    stop_saved = True
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
                    if hasattr(agent, 'compact'):
                        await agent.compact(cancel_event=cancel_event)
                    self._compaction_failures[message_id] = 0
                except Exception as e:
                    self._compaction_failures[message_id] = self._compaction_failures.get(message_id, 0) + 1
                    logger.error(
                        f"[_execute_agent] Compaction failed for agent {agent_id}: {e} "
                        f"(consecutive_failures={self._compaction_failures[message_id]})"
                    )
                    break
                # ④ 摘要独立保存（status="compacted"）：压缩轮次作为独立消息，前端块中断、轮次可见
                save_done_event = asyncio.Event()
                # 方案 B（独立快照）：摘要轮 usage = 当前累计（stop 保存时已 take 消费清空），
                # 查询不消费；compacted 消息保存时 run.py take 消费。
                compacted_tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
                self._emit_agent_complete(
                    agent_id, agent_name,
                    None, None,
                    "compacted",
                    parent_agent_id, parent_agent_name,
                    compacted_tokens,
                    agent.get_agent_usage() if hasattr(agent, 'get_agent_usage') else None,
                    message_id, save_done_event,
                    compaction_round=True,
                    # 摘要独立 DB 记录 id：stop 记录已占用执行实例 message_id，
                    # compacted 摘要必须独立 id 落库（否则 UNIQUE 冲突摘要丢失）；
                    # collector 取数仍按 message_id，二者解耦。
                    record_message_id=str(uuid.uuid4()),
                )
                await save_done_event.wait()
                # ⑤ 批量标记旧消息 is_compressed=1（仅在摘要保存成功后执行，防失败丢历史）
                # 〇·5 统一规则：main/sub 完全同一规则，无 mark_user_msgs 分支
                await self._batch_mark_compressed(agent_id)
                # ⑥ resume：用续接指令继续执行（避免 user_msg 重复；不复述、不提问）
                continue_msg = Msg(name="user", content=RESUME_PROMPT, role="user")
                response = await wrapped_reply(continue_msg)
                was_interrupted = agent.is_interrupted() if hasattr(agent, 'is_interrupted') else False

            # A2：经公开方法读取对话历史（不直接读 _core._conversation_history）
            history = agent.get_conversation_history() if hasattr(agent, 'get_conversation_history') else []
            if history:
                # 原有逻辑：追加本轮历史
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
            
            tool_calls = agent.get_last_tool_calls()
            
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
                message_id=message_id,
            )
            
            # 统一 agent_complete：所有 agent 统一事件，metadata 携带 parent 信息和 tokens
            # agent_usage（3.2-3）：agent 级整轮累计（消息头/组头整轮显示，与 tokens 的本阶段语义正交）
            # message_id（〇·3）：前端 agent 栈按此弹出实例（并发实例独立出栈）
            # save_done_event（〇·3 竞态修复）：最终完成轮与压缩轮 stop/compacted 保存同一
            # 等待语义——保存完成后 finally 才清理 _instances（run.py 异步保存任务
            # 执行时注册表仍可用，_get_agent_token_usage 按 message_id 取用不落空）
            save_done_event = asyncio.Event()
            self._emit_agent_complete(
                agent_id, agent_name,
                openai_message.get("content", response) if openai_message else response,
                openai_message,
                "stop" if was_interrupted else "completed",
                parent_agent_id, parent_agent_name,
                tokens,
                agent.get_agent_usage() if hasattr(agent, 'get_agent_usage') else None,
                message_id, save_done_event,
                # 多轮压缩修复：执行实例 message_id 已被压缩轮 stop 记录占用时（stop_saved），
                # 最终完成轮必须独立 id 落库（否则 UNIQUE 冲突 → 最终输出丢失）
                record_message_id=str(uuid.uuid4()) if stop_saved else None,
            )
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
            # message_id（〇·3）+ save_done_event：与 agent_complete 同一保存等待语义
            #（错误消息也走 _save_agent_messages 统一保存路径，注册表清理前必须等待保存完成）
            save_done_event = asyncio.Event()
            self._emit_agent_error(
                agent_id, agent_name,
                str(e),
                parent_agent_id, parent_agent_name,
                message_id, save_done_event,
                # 多轮压缩修复：执行实例 message_id 已被压缩轮 stop 记录占用时（stop_saved），
                # 错误消息必须独立 id 落库（否则 UNIQUE 冲突 → 错误消息丢失）
                record_message_id=str(uuid.uuid4()) if stop_saved else None,
            )
            await save_done_event.wait()
            
            return self._build_result_dict(
                "failed", agent_id=agent_id, agent_name=agent_name,
                error=str(e),
            )
        finally:
            # 会话级 token 累计已改由 run.py 从 session_messages 聚合（2026-08-04），
            # 此处不再内存累计；tokens 仅保留日志用途
            tokens = agent.get_token_usage() if hasattr(agent, 'get_token_usage') else None
            # 键改 message_id（〇·3）：并发实例独立取消/清理
            self._active_models.pop(message_id, None)
            self._instances.pop(message_id, None)
            self._compaction_failures.pop(message_id, None)
            logger.info(f"[_execute_agent] Unregistered model for agent {agent_id} (message_id={message_id})")
    
    def _compaction_allowed(self, message_id: str) -> bool:
        """熔断器：连续压缩失败是否已达上限（参考 Claude Code MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES）。

        键为 message_id（〇·3）：同一 agent 并发实例失败计数隔离。
        """
        return self._compaction_failures.get(message_id, 0) < MAX_CONSECUTIVE_COMPACTION_FAILURES

    async def _batch_mark_compressed(self, agent_id: str = None):
        """批量标记被压缩 agent 的旧消息为 is_compressed=True（A1：emit 事件，run 层唯一写权）。

        架构红线：compiler 层只读配置、不直接写对话记忆 DB。此处仅 emit
        `compression_marked` 事件并等待完成信号，由 run.py（AgenticFlowRunContext）
        执行实际 UPDATE（标记逻辑随事件透传：agent_id + session_id + save_done_event）。

        标记语义（见 run.py load_and_distribute_memories 的 is_compressed=False 查询）：
        旧消息被摘要覆盖后标记为已压缩，不再进入 LLM 上下文；摘要与压缩后新增
        消息保持 is_compressed=0。仅在摘要保存成功后调用（见 _execute_agent 压缩
        循环 ⑤），压缩失败时不标记、不丢历史。
        """
        save_done_event = asyncio.Event()
        self._emit_event(ExecutionEvent(
            event_type="compression_marked",
            agent_id=agent_id,
            metadata={"save_done_event": save_done_event},
        ))
        await save_done_event.wait()

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
