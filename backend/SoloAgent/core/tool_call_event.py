# -*- coding: utf-8 -*-
import logging
from enum import Enum
from typing import Dict, Optional

from ..types.protocols import StreamCallback

logger = logging.getLogger("SoloEngine")


class ToolCallEventType(str, Enum):
    TOOL_CALL_START = "TOOL_CALL_START"
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
    TOOL_CALL_END = "TOOL_CALL_END"
    TOOL_CALL_RESULT = "TOOL_CALL_RESULT"


class ToolCallEventManager:
    
    def __init__(self, stream_callback: Optional[StreamCallback] = None, agent_id: str = None,
                 agent_name: str = None, message_id: str = None):
        self.stream_callback = stream_callback
        self.agent_id = agent_id
        self.agent_name = agent_name
        # 执行实例标识（session_message_id）：由 ReActCore.set_message_id 在每次
        # _execute_agent 执行时同步设置，_emit_to_frontend 的 stream_callback 调用据此携带
        #（所有 agent 统一由 _execute_agent 内部生成）。
        self.message_id = message_id
        self._active_tool_calls: Dict[str, dict] = {}
        self._ended_tool_calls: set = set()
    
    def on_tool_call_start(self, tool_call_id: str, tool_name: str):
        if tool_call_id in self._active_tool_calls:
            return
        
        # START 事件不携带 message_id：message_id 是执行实例标识（session_message_id），
        # 由 _execute_agent 每次执行时统一生成，与具体工具调用无对应关系——框架在
        # START 预生成会使所有工具调用携带与自身无关的 message_id（污染前端/DB）。
        # message_id 仅在 RESULT 事件由执行方按需传入（有值则透传，无值则为 None）。
        self._active_tool_calls[tool_call_id] = {
            "id": tool_call_id,
            "name": tool_name,
            "arguments": "",
            "status": "start"
        }
        
        logger.info(f"[ToolCallEventManager] TOOL_CALL_START: {tool_name} ({tool_call_id})")
        self._emit_to_frontend({
            "type": ToolCallEventType.TOOL_CALL_START,
            "tool_call_id": tool_call_id,
            "tool_name": tool_name
        })
    
    def on_tool_call_args(self, tool_call_id: str, delta: str):
        if tool_call_id not in self._active_tool_calls:
            logger.warning(f"[ToolCallEventManager] Unknown tool_call_id: {tool_call_id}")
            return
        
        self._active_tool_calls[tool_call_id]["arguments"] += delta
        logger.debug(f"[ToolCallEventManager] TOOL_CALL_ARGS: {tool_call_id} delta={delta[:50]}...")
        
        self._emit_to_frontend({
            "type": ToolCallEventType.TOOL_CALL_ARGS,
            "tool_call_id": tool_call_id,
            "delta": delta
        })
    
    def on_tool_call_end(self, tool_call_id: str):
        if tool_call_id not in self._active_tool_calls:
            return
        
        self._active_tool_calls[tool_call_id]["status"] = "end"
        self._ended_tool_calls.add(tool_call_id)
        
        logger.info(f"[ToolCallEventManager] TOOL_CALL_END: {tool_call_id}")
        self._emit_to_frontend({
            "type": ToolCallEventType.TOOL_CALL_END,
            "tool_call_id": tool_call_id
        })
    
    def on_tool_call_result(self, tool_call_id: str, result: str, error: str = None):
        logger.info(f"[ToolCallEventManager] TOOL_CALL_RESULT: {tool_call_id} error={error is not None}")
        self._emit_to_frontend({
            "type": ToolCallEventType.TOOL_CALL_RESULT,
            "tool_call_id": tool_call_id,
            "result": result,
            "error": error,
        })
    
    def end_all_active_tool_calls(self):
        for tool_call_id in list(self._active_tool_calls.keys()):
            if tool_call_id not in self._ended_tool_calls:
                self.on_tool_call_end(tool_call_id)
    
    def get_active_tool_calls(self) -> Dict[str, dict]:
        return self._active_tool_calls.copy()
    
    def reset(self):
        self._active_tool_calls.clear()
        self._ended_tool_calls.clear()
        logger.debug("[ToolCallEventManager] Reset")
    
    def _emit_to_frontend(self, event: dict):
        frontend_delta = self._convert_to_frontend_format(event)
        if self.stream_callback and frontend_delta:
            self.stream_callback(frontend_delta, agent_id=self.agent_id, agent_name=self.agent_name,
                                 message_id=self.message_id)
    
    def _convert_to_frontend_format(self, event: dict) -> dict:
        event_type = event["type"]
        tool_call_id = event["tool_call_id"]
        
        if event_type == ToolCallEventType.TOOL_CALL_START:
            return {
                "type": "tool_calls",
                "tool_calls": [{
                    "id": tool_call_id,
                    "type": "function",
                    "function": {
                        "name": event["tool_name"]
                    },
                    "status": "start"
                }]
            }
        elif event_type == ToolCallEventType.TOOL_CALL_ARGS:
            return {
                "type": "tool_calls",
                "tool_calls": [{
                    "id": tool_call_id,
                    "function": {
                        "arguments": event["delta"]
                    }
                }]
            }
        elif event_type == ToolCallEventType.TOOL_CALL_END:
            return {
                "type": "tool_calls",
                "tool_calls": [{
                    "id": tool_call_id,
                    "status": "end"
                }]
            }
        elif event_type == ToolCallEventType.TOOL_CALL_RESULT:
            import copy
            result_data = {
                "id": tool_call_id,
                "result": copy.deepcopy(event["result"])
            }
            if event.get("error"):
                result_data["error"] = event["error"]
            return {
                "type": "tool_calls",
                "tool_calls": [result_data]
            }
        
        return None
