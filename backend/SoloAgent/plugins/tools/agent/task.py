# -*- coding: utf-8 -*-
"""
Task工具模块 - SubAgent架构实现。

@file task.py
@description Task工具 - 启动专门的子Agent处理任务
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 声明启动子Agent（SubAgent）处理特定任务（框架驱动：工具只产出声明，启动由框架钩子完成）
- SubAgent拥有独立的隔离上下文
- 返回SubAgent的最终执行结果（框架钩子返回值覆盖工具声明，注入主Agent上下文）
- 通过 stream_callback + ChunkCollector 机制自动存储消息

设计理念：
    SubAgent架构允许主Agent将复杂任务委托给专门的子Agent处理：
    1. 主Agent的框架（react_core）执行Task工具
    2. Task工具返回启动声明（subagent_name / subagent_id / task），不反向调用框架
    3. 框架（SoloAgent._on_tool_executed 钩子）检测到Task调用后启动SubAgent
    4. SubAgent完成后，框架钩子返回其输出覆盖工具结果，主Agent继续处理

消息存储：
    SubAgent的消息通过 stream_callback + ChunkCollector 机制
    自动存储到数据库，与 MainAgent 存储方式完全一致。

返回值结构（框架钩子覆盖后的最终格式）：
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
from SoloAgent.config import settings

if TYPE_CHECKING:
    from ....solo_agent.agent import SoloAgent

logger = logging.getLogger(__name__)

RETURN_INTERMEDIATE_STEPS = settings.RETURN_INTERMEDIATE_STEPS


class TaskTool(BaseAgentTool):
    needs_runtime_data = True
    """
    Task工具 - 声明启动SubAgent处理任务（框架驱动）。
    
    通过Task工具，主Agent可以将任务委托给配置的SubAgent处理。
    SubAgent在隔离的上下文中执行，完成后返回结果。
    
    框架驱动：工具执行时只返回启动声明，SubAgent的创建与执行由框架侧
    （SoloAgent._on_tool_executed 钩子）完成——工具不反向调用框架。
    
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
        执行Task工具 - 声明启动SubAgent处理任务。
        
        框架驱动架构：本工具被 react_core 执行时只返回"启动哪个 SubAgent、任务内容"
        的声明（subagent_name/subagent_id/task）。实际的 SubAgent 创建与执行由框架侧
        （SoloAgent._on_tool_executed 钩子检测到 Task 调用后调 CompiledFlow._execute_agent）
        完成——工具不反向调用框架，保证调用方向单向：框架 → 工具（执行）、
        工具 → 框架（数据返回）、框架 → 子执行（启动）。
        
        SubAgent 执行结果由框架钩子返回值覆盖本工具的声明结果，注入主 Agent 的 LLM
        上下文（最终返回内容 = SubAgent 的输出，与 HEAD 机制一致）。
        
        Args:
            subagent_name: SubAgent名称
            task: 任务描述
            **kwargs: 额外参数
        
        Returns:
            Dict[str, Any]: 启动声明（框架钩子检测到后启动 SubAgent 并覆盖返回结果）
        """
        subagent_id = self._name_to_id.get(subagent_name)
        if not subagent_id:
            return {
                "success": False,
                "error_message": f"Subagent '{subagent_name}' not found"
            }
        # 仅返回声明：subagent 的创建/执行由框架（_on_tool_executed 钩子）完成，
        # 工具不反向调用框架（单向架构：上级调下级，工具只产出数据）。
        return {
            "success": True,
            "subagent_name": subagent_name,
            "subagent_id": subagent_id,
            "task": task,
            "content": f"[Task] 已声明启动 SubAgent: {subagent_name}",
        }


