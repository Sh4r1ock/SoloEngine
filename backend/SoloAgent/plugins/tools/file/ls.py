# -*- coding: utf-8 -*-
"""
SoloEngine : 目录列表工具模块，提供目录内容列表功能

@file ls.py
@description 提供目录内容列表功能
@author Sh4rlock
@date 2026-04-09

功能描述：
- 列出目录内容
- 支持忽略模式（glob 模式）
- 返回文件类型（文件/目录）
- 按名称排序

状态: ✅ 模块初始化完成
"""

import os
import fnmatch
from typing import Dict, Any, List, Optional

from .base import BaseFileTool, FileToolError


class LS(BaseFileTool):
    """
    目录列表工具。
    
    列出指定目录的内容，支持过滤和排序。
    
    核心功能：
        1. 目录列表：列出目录中的文件和子目录
        2. 忽略模式：支持 glob 模式过滤
        3. 类型识别：区分文件和目录
        4. 名称排序：按名称排序结果
    
    Example:
        >>> ls_tool = LS()
        >>> result = ls_tool.execute(
        ...     path="/path/to/directory",
        ...     ignore=["*.pyc", "__pycache__"]
        ... )
    """
    
    def execute(
        self,
        path: str,
        ignore: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        执行目录列表操作。
        
        列出指定目录的内容，返回文件和子目录列表。
        
        Args:
            path (str): 目录的绝对路径。
            ignore (Optional[List[str]], optional): 要忽略的 glob 模式列表。
                例如 ["*.pyc", "__pycache__", ".git"]。默认为 None。
        
        Returns:
            Dict[str, Any]: 列表结果，包含：
                - content (str): 格式化的目录列表
                - success (bool): 是否成功
                - error_message (Optional[str]): 错误信息
                - entries (List[Dict]): 目录条目列表
                    - name: 名称
                    - type: "file" 或 "directory"
                - total_count (int): 总条目数
                - file_count (int): 文件数
                - dir_count (int): 目录数
        
        Raises:
            FileToolError: 当路径不是绝对路径时抛出。
            FileToolError: 当目录不存在时抛出。
        
        Example:
            >>> result = ls_tool.execute(
            ...     path="/home/user/project",
            ...     ignore=["*.pyc", ".git"]
            ... )
            >>> for entry in result["entries"]:
            ...     print(f"{entry['name']} ({entry['type']})")
        """
        path = self.validate_absolute_path(path)
        
        if not self.directory_exists(path):
            raise FileToolError(f"目录不存在: {path}")
        
        ignore = ignore or []
        
        try:
            entries = []
            file_count = 0
            dir_count = 0
            
            for name in os.listdir(path):
                if self._should_ignore(name, ignore):
                    continue
                
                full_path = os.path.join(path, name)
                is_dir = os.path.isdir(full_path)
                
                entries.append({
                    "name": name,
                    "type": "directory" if is_dir else "file",
                })
                
                if is_dir:
                    dir_count += 1
                else:
                    file_count += 1
            
            entries.sort(key=lambda x: (x["type"] == "file", x["name"].lower()))
            
            formatted_lines = []
            for entry in entries:
                prefix = "-" if entry["type"] == "file" else "d"
                formatted_lines.append(f"{prefix} {entry['name']}")
            
            content = "\n".join(formatted_lines) if formatted_lines else "(空目录)"
            
            return {
                "content": content,
                "success": True,
                "error_message": None,
                "entries": entries,
                "total_count": len(entries),
                "file_count": file_count,
                "dir_count": dir_count,
                "metadata": {
                    "resources_used": [path]
                }
            }
            
        except Exception as e:
            raise FileToolError(f"列出目录失败: {str(e)}")
    
    @staticmethod
    def _should_ignore(name: str, patterns: List[str]) -> bool:
        """
        检查名称是否应该被忽略。
        
        Args:
            name (str): 文件或目录名称。
            patterns (List[str]): glob 模式列表。
        
        Returns:
            bool: 如果匹配任何模式则返回 True。
        """
        for pattern in patterns:
            if fnmatch.fnmatch(name, pattern):
                return True
        return False
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取目录列表工具的规范定义。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容 OpenAI Function Calling 格式。
        """
        return {
            "name": "LS",
            "description": (
                "列出目录内容。"
                "返回文件和子目录列表，支持 glob 模式过滤。"
                "结果按名称排序，目录在前，文件在后。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要列出的目录的绝对路径。",
                    },
                    "ignore": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要忽略的 glob 模式列表，例如 ['*.pyc', '__pycache__']。",
                    },
                },
                "required": ["path"],
            },
        }

