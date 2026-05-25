# -*- coding: utf-8 -*-
"""
任务管理工具基类模块。

@file base.py
@description 提供任务管理工具的公共功能和基础类
@author SoloEngine Team
@date 2026-03-02

功能描述：
- TaskToolError: 任务工具错误基类
- BaseTaskTool: 任务工具基类
- 状态管理
- 结果格式化

状态: ✅ 模块初始化完成
"""

from typing import Dict, Any, List, Optional
from enum import Enum


class TaskToolError(Exception):
    """
    任务管理工具错误基类。
    
    所有任务管理工具相关的错误都继承此类。
    
    Attributes:
        message (str): 错误信息
        error_code (str): 错误代码
    
    Example:
        >>> raise TaskToolError("任务不存在", "TASK_NOT_FOUND")
    """
    
    def __init__(self, message: str, error_code: Optional[str] = None):
        """
        初始化任务工具错误。
        
        Args:
            message (str): 错误信息
            error_code (Optional[str], optional): 错误代码。默认为 None。
        """
        self.message = message
        self.error_code = error_code or "TASK_ERROR"
        super().__init__(message)
    
    def to_dict(self) -> Dict[str, Any]:
        """
        转换为字典格式。
        
        Returns:
            Dict[str, Any]: 包含 message 和 error_code 的字典。
        """
        return {
            "success": False,
            "error_message": self.message,
            "error_code": self.error_code,
        }


class TaskStatus(str, Enum):
    """任务状态枚举。"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class TaskPriority(str, Enum):
    """任务优先级枚举。"""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class BaseTaskTool:
    """
    任务管理工具基类。
    
    提供任务管理工具的公共功能：
    - 状态验证
    - 优先级验证
    - 结果格式化
    
    Example:
        >>> class MyTaskTool(BaseTaskTool):
        ...     def execute(self, **kwargs):
        ...         return self.format_success({"result": "ok"})
    """
    
    VALID_STATUSES = [s.value for s in TaskStatus]
    """有效的任务状态列表"""
    
    VALID_PRIORITIES = [p.value for p in TaskPriority]
    """有效的任务优先级列表"""
    
    @staticmethod
    def format_success(data: Dict[str, Any], message: Optional[str] = None) -> Dict[str, Any]:
        """
        格式化成功响应。
        
        Args:
            data (Dict[str, Any]): 响应数据
            message (Optional[str], optional): 成功消息。默认为 None。
        
        Returns:
            Dict[str, Any]: 格式化的成功响应
        """
        result = {
            "success": True,
            "error_message": None,
            "metadata": {},
            **data,
        }
        if message:
            result["message"] = message
        return result
    
    @staticmethod
    def format_error(message: str, error_code: Optional[str] = None) -> Dict[str, Any]:
        """
        格式化错误响应。
        
        Args:
            message (str): 错误信息
            error_code (Optional[str], optional): 错误代码。默认为 None。
        
        Returns:
            Dict[str, Any]: 格式化的错误响应
        """
        return {
            "success": False,
            "content": message,
            "error_message": message,
            "error_code": error_code or "TASK_ERROR",
            "metadata": {}
        }
    
    def validate_status(self, status: str) -> bool:
        """
        验证任务状态是否有效。
        
        Args:
            status (str): 任务状态
        
        Returns:
            bool: 状态是否有效
        """
        return status in self.VALID_STATUSES
    
    def validate_priority(self, priority: str) -> bool:
        """
        验证任务优先级是否有效。
        
        Args:
            priority (str): 任务优先级
        
        Returns:
            bool: 优先级是否有效
        """
        return priority in self.VALID_PRIORITIES
    
    def validate_todo(self, todo: Dict[str, Any]) -> Optional[str]:
        """
        验证单个 todo 项的有效性。
        
        Args:
            todo (Dict[str, Any]): todo 项
        
        Returns:
            Optional[str]: 错误信息，如果验证通过则返回 None
        """
        if not isinstance(todo, dict):
            return "todo 项必须是字典类型"
        
        if "id" not in todo:
            return "todo 项缺少必需的 'id' 字段"
        
        if "content" not in todo:
            return "todo 项缺少必需的 'content' 字段"
        
        if "status" not in todo:
            return "todo 项缺少必需的 'status' 字段"
        
        if not self.validate_status(todo["status"]):
            return f"无效的任务状态: {todo['status']}，有效值为: {self.VALID_STATUSES}"
        
        if "priority" in todo and not self.validate_priority(todo["priority"]):
            return f"无效的任务优先级: {todo['priority']}，有效值为: {self.VALID_PRIORITIES}"
        
        return None
    
    def validate_todos(self, todos: List[Dict[str, Any]]) -> Optional[str]:
        """
        验证 todos 列表的有效性。
        
        Args:
            todos (List[Dict[str, Any]]): todos 列表
        
        Returns:
            Optional[str]: 错误信息，如果验证通过则返回 None
        """
        if not isinstance(todos, list):
            return "todos 必须是列表类型"
        
        if len(todos) < 3 or len(todos) > 10:
            return "todos 列表长度必须在 3-10 之间"
        
        for i, todo in enumerate(todos):
            error = self.validate_todo(todo)
            if error:
                return f"第 {i + 1} 个 todo 项验证失败: {error}"
        
        return None
    
    def count_in_progress(self, todos: List[Dict[str, Any]]) -> int:
        """
        统计进行中的任务数量。
        
        Args:
            todos (List[Dict[str, Any]]): todos 列表
        
        Returns:
            int: 进行中的任务数量
        """
        return sum(1 for todo in todos if todo.get("status") == TaskStatus.IN_PROGRESS.value)
    
    def get_task_statistics(self, todos: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        获取任务统计信息。
        
        Args:
            todos (List[Dict[str, Any]]): todos 列表
        
        Returns:
            Dict[str, int]: 统计信息，包含 total, in_progress, completed, pending
        """
        return {
            "total": len(todos),
            "in_progress": self.count_in_progress(todos),
            "completed": sum(1 for t in todos if t.get("status") == TaskStatus.COMPLETED.value),
            "pending": sum(1 for t in todos if t.get("status") == TaskStatus.PENDING.value),
        }
