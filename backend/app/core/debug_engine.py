# -*- coding: utf-8 -*-
"""调试执行引擎。"""

import asyncio
import json
import uuid
import logging
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime

logger = logging.getLogger(__name__)


class DebugState(Enum):
    """调试状态。"""
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STEPPING = "stepping"
    STOPPED = "stopped"


class BreakpointType(Enum):
    """断点类型。"""
    BEFORE_THOUGHT = "before_thought"
    BEFORE_ACTION = "before_action"
    AFTER_ACTION = "after_action"
    ON_TOOL_CALL = "on_tool_call"
    ON_ERROR = "on_error"


@dataclass
class Breakpoint:
    """断点定义。"""
    id: str
    step_type: BreakpointType
    node_id: Optional[str] = None
    tool_name: Optional[str] = None
    condition: Optional[str] = None
    hit_count: int = 0
    enabled: bool = True


@dataclass
class DebugStep:
    """调试步骤记录。"""
    step_id: str
    step_type: str
    node_id: str
    node_name: str
    timestamp: str
    input_data: Dict[str, Any]
    output_data: Optional[Dict[str, Any]] = None
    thought: Optional[str] = None
    action: Optional[str] = None
    action_input: Optional[Dict[str, Any]] = None
    observation: Optional[str] = None
    error: Optional[str] = None
    variables: Dict[str, Any] = field(default_factory=dict)


@dataclass
class DebugSession:
    """调试会话。"""
    session_id: str
    flow_id: str
    flow_name: str
    state: DebugState = DebugState.IDLE
    current_step: int = 0
    steps: List[DebugStep] = field(default_factory=list)
    breakpoints: Dict[str, Breakpoint] = field(default_factory=dict)
    variables: Dict[str, Any] = field(default_factory=dict)
    messages: List[Dict[str, Any]] = field(default_factory=list)
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())


class DebugEngine:
    """调试执行引擎。"""

    MAX_SESSIONS = 100
    SESSION_TIMEOUT = 3600

    def __init__(self):
        self.sessions: Dict[str, DebugSession] = {}
        self._session_timestamps: Dict[str, float] = {}
        self._step_event = asyncio.Event()
        self._continue_event = asyncio.Event()
        self._callbacks: Dict[str, List[Callable]] = {
            "step": [],
            "breakpoint": [],
            "variable_change": [],
            "message": [],
            "tool_call": [],
        }

    def _cleanup_expired_sessions(self):
        """清理过期会话。"""
        import time
        current_time = time.time()
        expired = [
            sid for sid, ts in self._session_timestamps.items()
            if current_time - ts > self.SESSION_TIMEOUT
        ]
        for sid in expired:
            del self.sessions[sid]
            del self._session_timestamps[sid]
            logger.info(f"Cleaned up expired session: {sid}")

    def on(self, event_type: str, callback: Callable):
        """注册事件回调。"""
        if event_type in self._callbacks:
            self._callbacks[event_type].append(callback)

    def off(self, event_type: str, callback: Callable):
        """取消事件回调。"""
        if event_type in self._callbacks:
            if callback in self._callbacks[event_type]:
                self._callbacks[event_type].remove(callback)

    async def _emit(self, event_type: str, data: Any):
        """触发事件。"""
        for callback in self._callbacks.get(event_type, []):
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(data)
                else:
                    callback(data)
            except Exception as e:
                logger.error(f"Error in callback for {event_type}: {e}")

    async def create_session(self, flow_id: str, flow_name: str) -> DebugSession:
        """创建调试会话。"""
        import time
        
        self._cleanup_expired_sessions()
        
        if len(self.sessions) >= self.MAX_SESSIONS:
            oldest_id = next(iter(self.sessions))
            del self.sessions[oldest_id]
            del self._session_timestamps[oldest_id]
            logger.info(f"Removed oldest session to make room: {oldest_id}")
        
        session_id = str(uuid.uuid4())
        session = DebugSession(
            session_id=session_id,
            flow_id=flow_id,
            flow_name=flow_name,
        )
        self.sessions[session_id] = session
        self._session_timestamps[session_id] = time.time()
        logger.info(f"Created debug session: {session_id}")
        return session

    async def get_session(self, session_id: str) -> Optional[DebugSession]:
        """获取调试会话。"""
        return self.sessions.get(session_id)

    async def delete_session(self, session_id: str) -> bool:
        """删除调试会话。"""
        if session_id in self.sessions:
            del self.sessions[session_id]
            self._session_timestamps.pop(session_id, None)
            logger.info(f"Deleted debug session: {session_id}")
            return True
        return False

    async def list_sessions(self) -> List[DebugSession]:
        """列出所有调试会话。"""
        return list(self.sessions.values())

    async def add_breakpoint(
        self,
        session_id: str,
        step_type: BreakpointType,
        node_id: Optional[str] = None,
        tool_name: Optional[str] = None,
        condition: Optional[str] = None,
    ) -> Breakpoint:
        """添加断点。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        breakpoint_id = str(uuid.uuid4())
        bp = Breakpoint(
            id=breakpoint_id,
            step_type=step_type,
            node_id=node_id,
            tool_name=tool_name,
            condition=condition,
        )
        session.breakpoints[breakpoint_id] = bp
        logger.info(f"Added breakpoint {breakpoint_id} to session {session_id}")
        return bp

    async def remove_breakpoint(self, session_id: str, breakpoint_id: str) -> bool:
        """移除断点。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        if breakpoint_id in session.breakpoints:
            del session.breakpoints[breakpoint_id]
            logger.info(f"Removed breakpoint {breakpoint_id}")
            return True
        return False

    async def list_breakpoints(self, session_id: str) -> List[Breakpoint]:
        """列出断点。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")
        return list(session.breakpoints.values())

    async def start_debug(self, session_id: str) -> None:
        """开始调试。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        session.state = DebugState.RUNNING
        session.current_step = 0
        session.steps = []
        session.messages = []
        session.tool_calls = []
        session.updated_at = datetime.now().isoformat()
        
        self._continue_event.set()
        logger.info(f"Started debug session: {session_id}")

    async def stop_debug(self, session_id: str) -> None:
        """停止调试。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        session.state = DebugState.STOPPED
        session.updated_at = datetime.now().isoformat()
        
        self._step_event.set()
        self._continue_event.set()
        logger.info(f"Stopped debug session: {session_id}")

    async def pause_debug(self, session_id: str) -> None:
        """暂停调试。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        session.state = DebugState.PAUSED
        session.updated_at = datetime.now().isoformat()
        
        self._continue_event.clear()
        logger.info(f"Paused debug session: {session_id}")

    async def resume_debug(self, session_id: str) -> None:
        """继续调试。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        session.state = DebugState.RUNNING
        session.updated_at = datetime.now().isoformat()
        
        self._continue_event.set()
        logger.info(f"Resumed debug session: {session_id}")

    async def step(
        self,
        session_id: str,
        step_type: str = "step_over",
    ) -> None:
        """单步执行。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        session.state = DebugState.STEPPING
        session.updated_at = datetime.now().isoformat()
        
        self._step_event.set()
        self._continue_event.set()
        logger.info(f"Step {step_type} in session: {session_id}")

    async def record_step(
        self,
        session_id: str,
        step_type: str,
        node_id: str,
        node_name: str,
        input_data: Dict[str, Any],
        thought: Optional[str] = None,
        action: Optional[str] = None,
        action_input: Optional[Dict[str, Any]] = None,
    ) -> DebugStep:
        """记录执行步骤。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        step_id = str(uuid.uuid4())
        step = DebugStep(
            step_id=step_id,
            step_type=step_type,
            node_id=node_id,
            node_name=node_name,
            timestamp=datetime.now().isoformat(),
            input_data=input_data,
            thought=thought,
            action=action,
            action_input=action_input,
            variables=session.variables.copy(),
        )
        
        session.steps.append(step)
        session.current_step = len(session.steps)
        session.updated_at = datetime.now().isoformat()
        
        await self._emit("step", step)
        
        return step

    async def complete_step(
        self,
        session_id: str,
        step_id: str,
        output_data: Dict[str, Any],
        observation: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        """完成执行步骤。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        for step in session.steps:
            if step.step_id == step_id:
                step.output_data = output_data
                step.observation = observation
                step.error = error
                break

    async def record_message(
        self,
        session_id: str,
        role: str,
        content: str,
        node_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """记录消息。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        message = {
            "id": str(uuid.uuid4()),
            "role": role,
            "content": content,
            "node_id": node_id,
            "timestamp": datetime.now().isoformat(),
        }
        
        session.messages.append(message)
        session.updated_at = datetime.now().isoformat()
        
        await self._emit("message", message)
        
        return message

    async def record_tool_call(
        self,
        session_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        result: Optional[Any] = None,
        error: Optional[str] = None,
        node_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """记录工具调用。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        tool_call = {
            "id": str(uuid.uuid4()),
            "tool_name": tool_name,
            "arguments": arguments,
            "result": result,
            "error": error,
            "node_id": node_id,
            "timestamp": datetime.now().isoformat(),
        }
        
        session.tool_calls.append(tool_call)
        session.updated_at = datetime.now().isoformat()
        
        await self._emit("tool_call", tool_call)
        
        return tool_call

    async def update_variable(
        self,
        session_id: str,
        name: str,
        value: Any,
    ) -> None:
        """更新变量。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        old_value = session.variables.get(name)
        session.variables[name] = value
        session.updated_at = datetime.now().isoformat()
        
        await self._emit("variable_change", {
            "name": name,
            "old_value": old_value,
            "new_value": value,
        })

    async def get_variables(self, session_id: str) -> Dict[str, Any]:
        """获取所有变量。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")
        return session.variables.copy()

    async def check_breakpoint(
        self,
        session_id: str,
        step_type: BreakpointType,
        node_id: Optional[str] = None,
        tool_name: Optional[str] = None,
    ) -> Optional[Breakpoint]:
        """检查是否命中断点。"""
        session = await self.get_session(session_id)
        if not session:
            return None

        for bp in session.breakpoints.values():
            if not bp.enabled:
                continue
            
            if bp.step_type != step_type:
                continue
            
            if bp.node_id and bp.node_id != node_id:
                continue
            
            if bp.tool_name and bp.tool_name != tool_name:
                continue
            
            bp.hit_count += 1
            
            await self._emit("breakpoint", {
                "breakpoint": bp,
                "step_type": step_type,
                "node_id": node_id,
                "tool_name": tool_name,
            })
            
            return bp
        
        return None

    async def wait_for_continue(self, session_id: str) -> None:
        """等待继续执行。"""
        session = await self.get_session(session_id)
        if not session:
            return

        if session.state == DebugState.STEPPING:
            await self._step_event.wait()
            self._step_event.clear()
        elif session.state == DebugState.PAUSED:
            await self._continue_event.wait()
        elif session.state == DebugState.RUNNING:
            pass
        else:
            raise RuntimeError(f"Invalid debug state: {session.state}")

    async def export_session(
        self,
        session_id: str,
        format: str = "json",
    ) -> str:
        """导出调试会话。"""
        session = await self.get_session(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        if format == "json":
            return json.dumps({
                "session_id": session.session_id,
                "flow_id": session.flow_id,
                "flow_name": session.flow_name,
                "state": session.state.value,
                "steps": [
                    {
                        "step_id": s.step_id,
                        "step_type": s.step_type,
                        "node_id": s.node_id,
                        "node_name": s.node_name,
                        "timestamp": s.timestamp,
                        "input_data": s.input_data,
                        "output_data": s.output_data,
                        "thought": s.thought,
                        "action": s.action,
                        "action_input": s.action_input,
                        "observation": s.observation,
                        "error": s.error,
                    }
                    for s in session.steps
                ],
                "messages": session.messages,
                "tool_calls": session.tool_calls,
                "variables": session.variables,
                "created_at": session.created_at,
                "updated_at": session.updated_at,
            }, indent=2, ensure_ascii=False)
        elif format == "txt":
            lines = [
                f"Debug Session: {session.session_id}",
                f"Flow: {session.flow_name}",
                f"State: {session.state.value}",
                f"Created: {session.created_at}",
                "",
                "=== Steps ===",
            ]
            for i, s in enumerate(session.steps, 1):
                lines.append(f"\nStep {i}: {s.step_type}")
                lines.append(f"  Node: {s.node_name}")
                if s.thought:
                    lines.append(f"  Thought: {s.thought}")
                if s.action:
                    lines.append(f"  Action: {s.action}")
                if s.observation:
                    lines.append(f"  Observation: {s.observation}")
                if s.error:
                    lines.append(f"  Error: {s.error}")
            
            lines.append("\n=== Messages ===")
            for m in session.messages:
                lines.append(f"\n[{m['role']}] {m['content']}")
            
            lines.append("\n=== Tool Calls ===")
            for t in session.tool_calls:
                lines.append(f"\n{t['tool_name']}({t['arguments']})")
                if t.get('result'):
                    lines.append(f"  Result: {t['result']}")
                if t.get('error'):
                    lines.append(f"  Error: {t['error']}")
            
            return "\n".join(lines)
        else:
            raise ValueError(f"Unsupported format: {format}")


debug_engine = DebugEngine()
