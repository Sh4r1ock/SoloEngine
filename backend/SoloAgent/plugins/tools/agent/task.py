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
        
        subagent = self._parent_agent.get_subagent(subagent_id)
        
        if not subagent:
            for agent in self._parent_agent._subagents.values():
                if agent.config.name == subagent_name:
                    subagent = agent
                    break
        
        if not subagent:
            return {
                "success": False,
                "error_message": f"Subagent instance '{subagent_id}' not found"
            }
        
        if not subagent._initialized:
            await subagent.initialize()
            if subagent._core:
                subagent._core.stream_callback = self._parent_agent._stream_callback
                subagent._core.agent_id = subagent.agent_id
                subagent._core.agent_name = subagent_name
        
        self._send_event(
            "subagent_start",
            subagent_id=subagent_id,
            subagent_name=subagent_name
        )
        
        try:
            result = await subagent.reply(task)
            
            self._send_event(
                "subagent_complete",
                subagent_id=subagent_id,
                subagent_name=subagent_name
            )
            
            if hasattr(result, 'content'):
                final_content = result.content
            elif isinstance(result, dict):
                final_content = result.get('content', str(result))
            else:
                final_content = str(result)
            
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
                "intermediate_steps": intermediate_steps
            }
            
        except Exception as e:
            logger.error(f"SubAgent execution failed: {e}")
            return {
                "success": False,
                "error_message": f"SubAgent执行失败: {str(e)}"
            }
    
    def _send_event(
        self,
        event_type: str,
        subagent_id: str,
        subagent_name: str
    ) -> None:
        """
        发送事件通知。
        
        Args:
            event_type: 事件类型
            subagent_id: SubAgent ID
            subagent_name: SubAgent名称
        """
        if hasattr(self._parent_agent, '_stream_callback') and self._parent_agent._stream_callback:
            try:
                self._parent_agent._stream_callback(
                    {
                        "type": event_type,
                        "subagent_id": subagent_id,
                        "subagent_name": subagent_name
                    },
                    agent_id=subagent_id,
                    agent_name=subagent_name
                )
            except Exception as e:
                logger.warning(f"Failed to send {event_type} event: {e}")


