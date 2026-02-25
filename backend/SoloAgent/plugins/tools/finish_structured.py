# -*- coding: utf-8 -*-
"""
Finish 工具模块 - Structured Output 模式。

@file finish_structured.py
@description 通过解析结构化 JSON 输出检测任务完成
@author SoloEngine Team
@date 2026-02-25

功能描述：
- 定义结构化输出的 finish 格式
- 解析 JSON 输出中的 action 字段判断任务状态
- 支持 Structured Output 模式的任务完成检测

设计理念：
- 当模型输出 JSON 格式时，通过 action 字段判断
- action == "finish" 表示任务完成
- 与 Function Calling 模式功能相同，但触发方式不同

使用场景：
- ReAct 循环中的任务完成检测
- 支持 Structured Output / JSON Mode 的模型
- 不支持 Function Calling 但支持 JSON 输出的模型

状态: ✅ 完整实现
"""

import re
import json
from typing import Dict, Any, Optional


FINISH_ACTION = "finish"
"""finish action 名称"""


STRUCTURED_FINISH_SCHEMA = {
    "type": "object",
    "properties": {
        "thought": {
            "type": "string",
            "description": "Your reasoning process"
        },
        "action": {
            "type": "string",
            "enum": ["finish", "think", "search", "calculate", "other"],
            "description": "The action to take. Use 'finish' when you have the final answer."
        },
        "action_input": {
            "type": "string",
            "description": "The input for the action. For 'finish', this is the final answer."
        }
    },
    "required": ["action"]
}
"""结构化输出的 JSON Schema"""


def get_structured_finish_schema() -> Dict[str, Any]:
    """
    获取结构化输出的 JSON Schema。
    
    Returns:
        Dict[str, Any]: JSON Schema 字典。
    """
    return STRUCTURED_FINISH_SCHEMA.copy()


def parse_structured_output(text: str) -> Optional[Dict[str, Any]]:
    """
    从文本中解析结构化 JSON 输出。
    
    Args:
        text (str): LLM 输出文本。
    
    Returns:
        Optional[Dict[str, Any]]: 解析后的 JSON 对象，解析失败返回 None。
    """
    if not text or not text.strip():
        return None
    
    json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
    if not json_match:
        return None
    
    try:
        return json.loads(json_match.group())
    except json.JSONDecodeError:
        return None


def is_finish_action(parsed: Dict[str, Any]) -> bool:
    """
    检查解析后的 JSON 是否为 finish action。
    
    Args:
        parsed (Dict[str, Any]): 解析后的 JSON 对象。
    
    Returns:
        bool: 是否为 finish action。
    """
    if not parsed:
        return False
    return parsed.get("action", "").lower() == FINISH_ACTION


def extract_structured_answer(parsed: Dict[str, Any]) -> Optional[str]:
    """
    从结构化输出中提取最终答案。
    
    Args:
        parsed (Dict[str, Any]): 解析后的 JSON 对象。
    
    Returns:
        Optional[str]: 最终答案，提取失败返回 None。
    """
    if not is_finish_action(parsed):
        return None
    
    return parsed.get("action_input") or parsed.get("answer")


def check_finish_by_structured_output(text: str) -> Dict[str, Any]:
    """
    通过 Structured Output 检测任务是否完成。
    
    解析文本中的 JSON，检查 action 字段是否为 finish。
    
    Args:
        text (str): LLM 输出文本。
    
    Returns:
        Dict[str, Any]: 检测结果，包含：
            - is_finished (bool): 是否任务完成
            - answer (Optional[str]): 最终答案（如果完成）
            - has_other_action (bool): 是否有其他 action
            - parsed (Optional[Dict]): 解析后的 JSON 对象
    """
    result = {
        "is_finished": False,
        "answer": None,
        "has_other_action": False,
        "parsed": None,
    }
    
    parsed = parse_structured_output(text)
    if not parsed:
        return result
    
    result["parsed"] = parsed
    
    action = parsed.get("action", "").lower()
    
    if action == FINISH_ACTION:
        result["is_finished"] = True
        result["answer"] = extract_structured_answer(parsed)
        return result
    
    non_finish_actions = ["think", "thought", "observe", "observation"]
    if action and action not in non_finish_actions:
        result["has_other_action"] = True
    
    return result


__all__ = [
    "FINISH_ACTION",
    "STRUCTURED_FINISH_SCHEMA",
    "get_structured_finish_schema",
    "parse_structured_output",
    "is_finish_action",
    "extract_structured_answer",
    "check_finish_by_structured_output",
]
