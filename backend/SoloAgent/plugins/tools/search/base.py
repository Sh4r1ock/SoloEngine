# -*- coding: utf-8 -*-
"""
SoloEngine : 搜索工具基类模块，提供搜索工具的公共功能

@file base.py
@description 提供搜索工具的公共功能
@author Sh4rlock
@date 2026-04-09

功能描述：
- 搜索工具错误基类
- 搜索工具基类
- 路径处理工具
- 结果格式化工具

状态: ✅ 模块初始化完成
"""

import os
from typing import Dict, Any, List, Optional, Union
from pathlib import Path


class SearchToolError(Exception):
    """
    搜索工具错误基类。
    
    所有搜索工具相关错误的基类，提供统一的错误处理接口。
    
    Attributes:
        message (str): 错误信息
        tool_name (str): 产生错误的工具名称
    
    Example:
        >>> raise SearchToolError("搜索失败", tool_name="Grep")
    """
    
    def __init__(self, message: str, tool_name: Optional[str] = None) -> None:
        """
        初始化搜索工具错误。
        
        Args:
            message (str): 错误信息
            tool_name (Optional[str], optional): 工具名称。默认为 None
        """
        self.message = message
        self.tool_name = tool_name
        super().__init__(self._format_message())
    
    def _format_message(self) -> str:
        """格式化错误信息。"""
        if self.tool_name:
            return f"[{self.tool_name}] {self.message}"
        return self.message


class BaseSearchTool:
    """
    搜索工具基类。
    
    提供搜索工具的公共功能，包括路径处理、结果格式化等。
    
    核心功能：
        1. 路径处理：验证路径、获取绝对路径
        2. 结果格式化：统一输出格式
        3. 错误处理：统一的错误处理机制
    
    子类实现：
        - SearchCodebaseTool: 语义代码搜索
        - GrepTool: 正则表达式搜索
        - GlobTool: 文件模式匹配
    
    Example:
        >>> class MySearchTool(BaseSearchTool):
        ...     async def search(self, query: str) -> Dict[str, Any]:
        ...         return {"results": []}
    """
    
    tool_name: str = "BaseSearchTool"
    """工具名称"""
    
    def __init__(self, working_directory: Optional[str] = None) -> None:
        """
        初始化搜索工具基类。
        
        Args:
            working_directory (Optional[str], optional): 工作目录。
                如果未指定，使用当前工作目录。默认为 None
        """
        self._working_directory = working_directory or os.getcwd()
    
    @property
    def working_directory(self) -> str:
        """获取工作目录。"""
        return self._working_directory
    
    @working_directory.setter
    def working_directory(self, value: str) -> None:
        """设置工作目录。"""
        self._working_directory = os.path.abspath(value)
    
    def resolve_path(self, path: Optional[str] = None) -> str:
        """
        解析路径为绝对路径。
        
        如果路径为空，返回工作目录。如果路径为相对路径，
        则相对于工作目录解析。
        
        Args:
            path (Optional[str], optional): 要解析的路径。默认为 None
        
        Returns:
            str: 绝对路径
        
        Example:
            >>> tool = BaseSearchTool("/home/user/project")
            >>> tool.resolve_path("src/main.py")
            '/home/user/project/src/main.py'
        """
        if path is None:
            return self._working_directory
        
        if os.path.isabs(path):
            return os.path.normpath(path)
        
        return os.path.normpath(os.path.join(self._working_directory, path))
    
    def validate_path(self, path: str) -> bool:
        """
        验证路径是否存在。
        
        Args:
            path (str): 要验证的路径
        
        Returns:
            bool: 路径是否存在
        """
        return os.path.exists(path)
    
    def validate_directory(self, path: str) -> bool:
        """
        验证路径是否为目录。
        
        Args:
            path (str): 要验证的路径
        
        Returns:
            bool: 是否为目录
        """
        return os.path.isdir(path)
    
    def validate_file(self, path: str) -> bool:
        """
        验证路径是否为文件。
        
        Args:
            path (str): 要验证的路径
        
        Returns:
            bool: 是否为文件
        """
        return os.path.isfile(path)
    
    def format_result(
        self,
        success: bool = True,
        content: Optional[Union[str, List[Dict[str, Any]]]] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        格式化搜索结果。
        
        统一搜索结果的输出格式，便于上层处理。
        
        Args:
            success (bool, optional): 是否成功。默认为 True
            content (Optional[Union[str, List[Dict]]], optional): 结果内容。默认为 None
            error_message (Optional[str], optional): 错误信息。默认为 None
            metadata (Optional[Dict], optional): 元数据。默认为 None
        
        Returns:
            Dict[str, Any]: 格式化的结果字典
        
        Example:
            >>> tool.format_result(
            ...     success=True,
            ...     content="找到 10 个结果",
            ...     metadata={"count": 10}
            ... )
            {'success': True, 'content': '找到 10 个结果', 'error_message': None, 'metadata': {'count': 10}}
        """
        result = {
            "success": success,
            "content": content,
            "error_message": error_message,
            "metadata": metadata or {},
        }
        
        return result
    
    def format_error(
        self,
        error_message: str,
        exception: Optional[Exception] = None,
    ) -> Dict[str, Any]:
        """
        格式化错误结果。
        
        Args:
            error_message (str): 错误信息
            exception (Optional[Exception], optional): 异常对象。默认为 None
        
        Returns:
            Dict[str, Any]: 格式化的错误结果
        """
        content = error_message
        if exception:
            content = f"{error_message}: {str(exception)}"
        
        return self.format_result(
            success=False,
            content=content,
            error_message=error_message,
        )
    
    def get_relative_path(self, abs_path: str) -> str:
        """
        获取相对于工作目录的相对路径。
        
        Args:
            abs_path (str): 绝对路径
        
        Returns:
            str: 相对路径
        """
        try:
            return os.path.relpath(abs_path, self._working_directory)
        except ValueError:
            return abs_path
    
    def normalize_separators(self, path: str) -> str:
        """
        规范化路径分隔符。
        
        将路径分隔符转换为当前系统的标准格式。
        
        Args:
            path (str): 原始路径
        
        Returns:
            str: 规范化的路径
        """
        return os.path.normpath(path)
    
    def split_glob_pattern(self, pattern: str) -> tuple[str, str]:
        """
        分离目录和通配符模式。
        
        将 glob 模式分离为基础目录和模式部分。
        
        Args:
            pattern (str): glob 模式
        
        Returns:
            tuple[str, str]: (基础目录, 模式)
        
        Example:
            >>> tool.split_glob_pattern("src/**/*.py")
            ('src', '**/*.py')
        """
        parts = Path(pattern).parts
        base_parts = []
        pattern_parts = []
        found_wildcard = False
        
        for part in parts:
            if not found_wildcard and ('*' in part or '?' in part or '[' in part):
                found_wildcard = True
            
            if found_wildcard:
                pattern_parts.append(part)
            else:
                base_parts.append(part)
        
        base_dir = os.path.join(*base_parts) if base_parts else "."
        pattern_str = os.path.join(*pattern_parts) if pattern_parts else "*"
        
        return base_dir, pattern_str
