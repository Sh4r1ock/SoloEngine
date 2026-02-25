# -*- coding: utf-8 -*-
"""
Finish 工具模块 - Function Calling 模式。

@file finish_function_calling.py
@description 定义 finish 工具规范，用于 LLM 通过 Function Calling 表示任务完成
@author SoloEngine Team
@date 2026-02-25

功能描述：
- 定义 finish 工具规范（工具描述、参数 schema）
- 支持 Function Calling 模式的任务完成检测

设计理念：
- finish 工具是一个特殊的控制工具
- 当 LLM 调用此工具时，表示任务已完成
- 语言无关，不依赖文本标记词
- 工具描述使用英文，现代通用模型都能理解

使用场景：
- ReAct 循环中的任务完成检测
- 支持 Function Calling 的模型

状态: ✅ 完整实现
"""

from typing import Dict, Any, Optional


FINISH_TOOL_NAME = "finish"
"""finish 工具名称"""


FINISH_TOOL_SPEC = {
    "name": FINISH_TOOL_NAME,
    "description": "Submit the final answer and complete the task. Call this tool when you have completed the task and have a final answer for the user.",
    "parameters": {
        "type": "object",
        "properties": {
            "answer": {
                "type": "string",
                "description": "The final answer or result to submit to the user"
            }
        },
        "required": ["answer"]
    }
}
"""finish 工具规范"""


def get_finish_tool_spec() -> Dict[str, Any]:
    """
    获取 finish 工具规范。
    
    Returns:
        Dict[str, Any]: finish 工具规范字典。
    """
    return FINISH_TOOL_SPEC.copy()


def is_finish_tool_call(tool_call: Dict[str, Any]) -> bool:
    """
    检查工具调用是否为 finish 工具。
    
    Args:
        tool_call (Dict[str, Any]): 工具调用字典。
    
    Returns:
        bool: 是否为 finish 工具调用。
    """
    if not tool_call:
        return False
    return tool_call.get("name") == FINISH_TOOL_NAME


def extract_finish_answer(tool_call: Dict[str, Any]) -> Optional[str]:
    """
    从 finish 工具调用中提取最终答案。
    
    Args:
        tool_call (Dict[str, Any]): finish 工具调用字典。
    
    Returns:
        Optional[str]: 最终答案字符串，如果提取失败返回 None。
    """
    if not is_finish_tool_call(tool_call):
        return None
    
    arguments = tool_call.get("arguments", {})
    return arguments.get("answer")


def check_finish_by_function_calling(response: Any) -> Dict[str, Any]:
    """
    通过 Function Calling 检测任务是否完成。
    
    解析 LLM 响应中的工具调用，检查是否包含 finish 工具。
    
    Args:
        response: LLM 响应对象，应包含 content 属性。
    
    Returns:
        Dict[str, Any]: 检测结果，包含：
            - is_finished (bool): 是否任务完成
            - answer (Optional[str]): 最终答案（如果完成）
            - has_other_tools (bool): 是否有其他工具调用
    """
    result = {
        "is_finished": False,
        "answer": None,
        "has_other_tools": False,
    }
    
    if not hasattr(response, "content"):
        return result
    
    tool_calls = []
    for block in response.content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            tool_calls.append({
                "name": block.get("name"),
                "arguments": block.get("input", {}),
            })
    
    for tool_call in tool_calls:
        if is_finish_tool_call(tool_call):
            result["is_finished"] = True
            result["answer"] = extract_finish_answer(tool_call)
            return result
    
    if tool_calls:
        result["has_other_tools"] = True
    
    return result


__all__ = [
    "FINISH_TOOL_NAME",
    "FINISH_TOOL_SPEC",
    "get_finish_tool_spec",
    "is_finish_tool_call",
    "extract_finish_answer",
    "check_finish_by_function_calling",
]
