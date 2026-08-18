# -*- coding: utf-8 -*-
"""
Task工具模块 - SubAgent架构实现。

@file task.py
@description Task工具 - 启动专门的子Agent处理任务
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 启动专门的子Agent（SubAgent）处理特定任务
- SubAgent拥有独立的隔离上下文
- 返回SubAgent的最终执行结果
- 通过 stream_callback + ChunkCollector 机制自动存储消息

设计理念：
    SubAgent架构允许主Agent将复杂任务委托给专门的子Agent处理：
    1. 主Agent通过Task工具启动SubAgent
    2. SubAgent在隔离的上下文中执行任务
    3. SubAgent完成后返回最终结果给主Agent
    4. 主Agent继续处理后续任务

消息存储：
    SubAgent的消息通过 stream_callback + ChunkCollector 机制
    自动存储到数据库，与 MainAgent 存储方式完全一致。

返回值结构：
    {
        "success": true,
        "subagent_name": "测试节点",
        "subagent_id": "node_1774589427136",
        "content": "SubAgent的输出内容"
    }

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional, List, TYPE_CHECKING
import logging

from .base import BaseAgentTool
from app.core.config import settings
from ....message import Msg

if TYPE_CHECKING:
    from ....solo_agent.agent import SoloAgent

logger = logging.getLogger(__name__)

RETURN_INTERMEDIATE_STEPS = settings.RETURN_INTERMEDIATE_STEPS


class TaskTool(BaseAgentTool):
    needs_runtime_data = True
    """
    Task工具 - 调用SubAgent处理任务。
    
    通过Task工具，主Agent可以将任务委托给配置的SubAgent处理。
    SubAgent在隔离的上下文中执行，完成后返回结果。
    
    消息存储：SubAgent的消息通过 stream_callback + ChunkCollector 机制
    自动存储到数据库，与 MainAgent 存储方式完全一致。
    """
    
    def __init__(
        self,
        parent_agent: Optional["SoloAgent"] = None,
        subagents_info: Optional[List[Dict[str, Any]]] = None,
        context: Optional[Any] = None,
        permission: Optional[Any] = None
    ) -> None:
        """
        初始化Task工具。
        
        Args:
            parent_agent: 父Agent实例，用于获取SubAgent
            subagents_info: SubAgent信息列表
            context: 工具上下文
            permission: 工具权限
        """
        super().__init__(context, permission)
        self._parent_agent = parent_agent
        self._subagents_info: Dict[str, Dict[str, Any]] = {}
        self._name_to_id: Dict[str, str] = {}
        
        if subagents_info:
            for sa in subagents_info:
                name = sa.get("subagent_name")
                subagent_id = sa.get("subagent_id")
                description = sa.get("description", "")
                if name:
                    self._subagents_info[name] = {
                        "subagent_name": name,
                        "description": description,
                        "subagent_id": subagent_id or name
                    }
                    self._name_to_id[name] = subagent_id or name
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取Task工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式。
        """
        names = list(self._subagents_info.keys())
        xml = self._format_available_subagents_xml()
        
        return {
            "name": "Task",
            "description": f"""Launch a agent and assign a task to it.

Available agents:
{xml}

When to use this tool:
  - When the task requires specialized capabilities
  - When you need to delegate a task to a subagent

IMPORTANT: When a subagent is relevant, invoke this tool IMMEDIATELY.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "subagent_name": {
                        "type": "string",
                        "description": "The subagent name to call",
                        "enum": names
                    },
                    "task": {
                        "type": "string",
                        "description": "Detailed task description"
                    }
                },
                "required": ["subagent_name", "task"]
            }
        }
    
    def _format_available_subagents_xml(self) -> str:
        """
        格式化可用SubAgent列表为XML格式。
        
        Returns:
            str: XML格式的SubAgent列表
        """
        lines = ["<available_subagents>"]
        for name, info in self._subagents_info.items():
            lines.append(f"- {name}: {info.get('description', '')}")
        lines.append("</available_subagents>")
        return "\n".join(lines)
    
    async def execute(
        self,
        subagent_name: str,
        task: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行Task工具 - 启动SubAgent处理任务。
        
        Args:
            subagent_name: SubAgent名称
            task: 任务描述
            **kwargs: 额外参数
        
        Returns:
            Dict[str, Any]: 执行结果
        """
        subagent_id = self._name_to_id.get(subagent_name)
        if not subagent_id:
            return {
                "success": False,
                "error_message": f"Subagent '{subagent_name}' not found"
            }
        
        # 〇·3 并发方案（第 2 层·实例层隔离）：每次 Task 调用统一走 create_agent_instance
        # 创建独立实例（不再 get_subagent 复用编译期单实例）——同一 subagent 并发 N 次调用
        # = N 个独立实例（独立 _conversation_history/_accumulated_usage/_interrupted），
        # 消除"同一 subagent 并发 = 同一 ReActCore 状态冲突"的根本原因。
        # execution_key 生成点先于 create_agent_instance（满足其入参时序），并贯穿
        # _execute_agent → agent_start/agent_complete 事件 → stream_callback →
        # ChunkCollector/保存字典 → 前端 agent 栈（并发实例独立收集/保存/出栈）。
        task_msg = Msg(name="user", content=task, role="user")
        cancel_event = getattr(self._parent_agent._core, '_current_cancel_event', None) if (self._parent_agent and self._parent_agent._core) else None
        compiled_flow = getattr(self._parent_agent, '_compiled_flow', None)

        if not compiled_flow:
            raise RuntimeError(
                f"Parent agent {self._parent_agent.agent_id} has no _compiled_flow reference — "
                "CompiledFlow.__init__ must set agent._compiled_flow = self"
            )

        execution_key = compiled_flow._new_execution_key(subagent_id)
        subagent = compiled_flow.create_agent_instance(subagent_id, execution_key)
        # 〇·3：记录调用方实例的执行键（agent_start 事件 metadata.parent_execution_key 来源，
        # task 消息的 parent_message_id 定位依据——_pending_agent_message_ids 键为 execution_key）
        subagent._parent_execution_key = getattr(self._parent_agent, '_execution_key', None)

        # 完全复用 _execute_agent（所有 agent 统一，无任何路径分叉）
        result = await compiled_flow._execute_agent(
            subagent,
            task_msg,
            context={},
            execution_key=execution_key,
            cancel_event=cancel_event,
            parent_agent_id=self._parent_agent.agent_id,
            parent_agent_name=self._parent_agent.name,
            task_content=task
        )

        # _execute_agent 返回 dict（含 output/error/status 字段），适配 task 工具返回格式
        if isinstance(result, dict):
            if result.get("status") == "failed":
                return {
                    "success": False,
                    "error_message": f"SubAgent执行失败: {result.get('error', 'Unknown error')}",
                    "execution_key": execution_key,
                }
            final_content = result.get("output", "")
        else:
            final_content = str(result)

        # 返回逻辑
        if RETURN_INTERMEDIATE_STEPS:
            openai_msg = subagent.get_last_openai_message()
            intermediate_steps = {
                "reasoning_content": openai_msg.get("reasoning_content"),
                "tool_calls": subagent._last_tool_calls if hasattr(subagent, '_last_tool_calls') else []
            }
        else:
            intermediate_steps = None

        return {
            "success": True,
            "subagent_name": subagent_name,
            "subagent_id": subagent.agent_id,
            "error_message": None,
            "content": final_content,
            "intermediate_steps": intermediate_steps,
            # 〇·3 b3 前置依赖：run.py _inject_subagent_link_to_tool_call 从 result 提取
            # execution_key 查 _subagent_message_ids[execution_key] 注入正确 message_id
            #（并发实例各 tool_call 注入自己的 task 消息 id，互不覆盖）
            "execution_key": execution_key,
        }
    
    def _send_event(
        self,
        event_type: str,
        subagent_id: str,
        subagent_name: str,
        tokens: dict = None,
        error: str = None,
        task_content: str = None
    ) -> None:
        # 方案 1.2.1：完全迁移到 event_callback，删除 stream_callback 兜底
        if hasattr(self._parent_agent, '_event_callback') and self._parent_agent._event_callback:
            try:
                from ....solo_agent.compiler.flow_compiler import ExecutionEvent
                event_data = ExecutionEvent(
                    event_type=event_type,
                    subagent_id=subagent_id,
                    subagent_name=subagent_name,
                )
                # 传递 parent_agent_id，用于 subagent 消息保存时构建父子关系
                parent_agent_id = getattr(self._parent_agent, 'agent_id', None)
                if parent_agent_id:
                    event_data.metadata["parent_agent_id"] = parent_agent_id
                if tokens:
                    event_data.metadata["tokens"] = tokens
                if error:
                    event_data.error = error
                # 传递 task_content，用于 RunContext 保存 subagent 的 task 消息作为 parent_message_id
                if task_content:
                    event_data.metadata["task_content"] = task_content
                self._parent_agent._event_callback(event_data)
            except Exception as e:
                logger.warning(f"Failed to send {event_type} event: {e}")


