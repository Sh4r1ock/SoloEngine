# -*- coding: utf-8 -*-
"""
TodoWrite 工具模块。

@file todo_write.py
@description 任务列表管理工具，用于创建和管理结构化任务列表
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 管理结构化任务列表
- 支持任务状态：pending, in_progress, completed
- 支持任务优先级：high, medium, low
- 支持完成任务的摘要字段
- 限制同时只能有一个任务处于 in_progress 状态
- 返回任务统计信息

使用场景：
- 复杂任务的规划和跟踪
- 多步骤任务管理
- 进度可视化

状态: ✅ 模块初始化完成
"""

from typing import Dict, Any, List, Optional
from .base import BaseTaskTool, TaskToolError, TaskStatus


class TodoWrite(BaseTaskTool):
    """
    TodoWrite 工具类。
    
    用于创建和管理结构化任务列表，帮助 Agent 跟踪任务进度。
    
    核心功能：
        1. 创建任务列表（3-10 个任务）
        2. 更新任务状态
        3. 验证状态转换规则
        4. 生成任务统计信息
    
    状态规则：
        - 同时只能有一个任务处于 in_progress 状态
        - 完成任务时可以添加 summary 字段
    
    Example:
        >>> tool = TodoWrite()
        >>> result = tool.execute(
        ...     todos=[
        ...         {"id": "1", "content": "任务1", "status": "completed", "priority": "high"},
        ...         {"id": "2", "content": "任务2", "status": "in_progress", "priority": "medium"},
        ...         {"id": "3", "content": "任务3", "status": "pending", "priority": "low"},
        ...     ],
        ...     summary="完成了任务1的实现"
        ... )
    """
    
    def __init__(self):
        """初始化 TodoWrite 工具。"""
        super().__init__()
        self._todos: List[Dict[str, Any]] = []
        """当前任务列表"""
    
    def execute(
        self,
        todos: List[Dict[str, Any]],
        summary: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        执行任务列表更新。
        
        Args:
            todos (List[Dict[str, Any]]): 任务列表，每个任务包含：
                - id (str): 任务唯一标识
                - content (str): 任务内容描述
                - status (str): 任务状态 (pending/in_progress/completed)
                - priority (str): 任务优先级 (high/medium/low)
                - summary (Optional[str]): 完成摘要（仅 completed 状态）
            summary (Optional[str], optional): 整体摘要。默认为 None。
        
        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success: 是否成功
                - todos: 更新后的任务列表
                - statistics: 任务统计信息
                - error: 错误信息（如果失败）
        
        Raises:
            TaskToolError: 当验证失败时抛出
        """
        validation_error = self.validate_todos(todos)
        if validation_error:
            return self.format_error(validation_error, "VALIDATION_ERROR")
        
        in_progress_count = self.count_in_progress(todos)
        if in_progress_count > 1:
            return self.format_error(
                f"只能有一个任务处于 in_progress 状态，当前有 {in_progress_count} 个",
                "MULTIPLE_IN_PROGRESS"
            )
        
        validated_todos = []
        for todo in todos:
            validated_todo = {
                "id": todo["id"],
                "content": todo["content"],
                "status": todo["status"],
                "priority": todo.get("priority", "medium"),
            }
            
            if todo["status"] == TaskStatus.COMPLETED.value and "summary" in todo:
                validated_todo["summary"] = todo["summary"]
            
            validated_todos.append(validated_todo)
        
        self._todos = validated_todos
        
        statistics = self.get_task_statistics(validated_todos)
        
        result = {
            "todos": validated_todos,
            "statistics": statistics,
            "success": True,
        }
        
        if summary:
            result["summary"] = summary
        
        result["metadata"] = {}
        
        return result
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取工具规范。
        
        返回兼容 OpenAI Function Calling 格式的工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范
        """
        return {
            "type": "function",
            "function": {
                "name": "TodoWrite",
                "description": (
                    "使用此工具可以创建和管理工作会话的结构化任务列表。"
                    "这有助于跟踪进度、组织复杂任务，并向用户展示完成情况。"
                    "任务列表应包含3-10个任务项，每个任务包含id、content、status和priority字段。"
                    "同时只能有一个任务处于in_progress状态。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "description": "任务列表（3-10个任务）",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {
                                        "type": "string",
                                        "description": "任务唯一标识"
                                    },
                                    "content": {
                                        "type": "string",
                                        "description": "任务内容描述"
                                    },
                                    "status": {
                                        "type": "string",
                                        "enum": ["pending", "in_progress", "completed"],
                                        "description": "任务状态"
                                    },
                                    "priority": {
                                        "type": "string",
                                        "enum": ["high", "medium", "low"],
                                        "description": "任务优先级"
                                    },
                                    "summary": {
                                        "type": "string",
                                        "description": "完成摘要（仅completed状态时使用）"
                                    }
                                },
                                "required": ["id", "content", "status"]
                            },
                            "minItems": 3,
                            "maxItems": 10
                        },
                        "summary": {
                            "type": "string",
                            "description": "整体摘要（可选）"
                        }
                    },
                    "required": ["todos"]
                }
            }
        }
    
    @property
    def todos(self) -> List[Dict[str, Any]]:
        """获取当前任务列表。"""
        return self._todos.copy()
    
    def get_todo_by_id(self, todo_id: str) -> Optional[Dict[str, Any]]:
        """
        根据 ID 获取任务。
        
        Args:
            todo_id (str): 任务 ID
        
        Returns:
            Optional[Dict[str, Any]]: 任务信息，如果不存在则返回 None
        """
        for todo in self._todos:
            if todo["id"] == todo_id:
                return todo.copy()
        return None
    
    def clear(self) -> None:
        """清空任务列表。"""
        self._todos = []


def get_todo_write_tool_spec() -> Dict[str, Any]:
    """
    获取 TodoWrite 工具规范。
    
    Returns:
        Dict[str, Any]: 工具规范
    """
    tool = TodoWrite()
    return tool.get_tool_spec()


async def todo_write(
    todos: List[Dict[str, Any]],
    summary: Optional[str] = None,
) -> Dict[str, Any]:
    """
    TodoWrite 工具函数。
    
    异步包装器，用于注册到工具执行器。
    
    Args:
        todos (List[Dict[str, Any]]): 任务列表
        summary (Optional[str], optional): 整体摘要。默认为 None。
    
    Returns:
        Dict[str, Any]: 执行结果
    """
    tool = TodoWrite()
    return tool.execute(todos=todos, summary=summary)
