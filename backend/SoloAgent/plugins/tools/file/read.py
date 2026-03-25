# -*- coding: utf-8 -*-
"""
文件读取工具模块。

@file read.py
@description 提供文件读取功能
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 支持读取文件并显示行号
- 支持 offset 和 limit 参数
- 默认限制 2000 行
- 超过 2000 字符的行会被截断
- 返回 cat -n 格式的输出

状态: ✅ 模块初始化完成
"""

import os
from typing import Dict, Any, Optional

from .base import BaseFileTool, FileToolError


class Read(BaseFileTool):
    """
    文件读取工具。
    
    读取文件内容并返回带行号的格式化输出。
    
    核心功能：
        1. 行号显示：类似 cat -n 格式
        2. 分页读取：支持 offset 和 limit
        3. 行截断：超长行自动截断
        4. 编码处理：统一使用 UTF-8
    
    Attributes:
        DEFAULT_LIMIT (int): 默认读取行数限制 (2000)
        MAX_LINE_LENGTH (int): 单行最大字符数 (2000)
    
    Example:
        >>> read_tool = Read()
        >>> result = read_tool.execute(
        ...     file_path="/path/to/file.py",
        ...     offset=0,
        ...     limit=100
        ... )
    """
    
    DEFAULT_LIMIT: int = 2000
    MAX_LINE_LENGTH: int = 2000
    
    def execute(
        self,
        file_path: str,
        offset: int = 0,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        执行文件读取操作。
        
        读取指定文件的内容，返回带行号的格式化输出。
        
        Args:
            file_path (str): 文件的绝对路径。
            offset (int, optional): 起始行号偏移量。默认为 0。
            limit (Optional[int], optional): 读取行数限制。
                默认为 2000 行。设置为 -1 或 None 时使用默认值。
        
        Returns:
            Dict[str, Any]: 读取结果，包含：
                - content (str): 格式化的文件内容
                - success (bool): 是否成功
                - error_message (Optional[str]): 错误信息
                - total_lines (int): 文件总行数
                - lines_read (int): 实际读取行数
        
        Raises:
            FileToolError: 当路径不是绝对路径时抛出。
            FileToolError: 当文件不存在时抛出。
            FileToolError: 当 offset 为负数时抛出。
        
        Example:
            >>> result = read_tool.execute(
            ...     file_path="/home/user/example.py",
            ...     offset=10,
            ...     limit=50
            ... )
            >>> print(result["content"])
            11→def hello():
            12→    print("Hello, World!")
            ...
        """
        file_path = self.validate_absolute_path(file_path)
        
        if limit is None or limit < 0:
            limit = self.DEFAULT_LIMIT
        
        if offset < 0:
            raise FileToolError(f"offset 必须是非负整数: {offset}")
        
        if not self.file_exists(file_path):
            raise FileToolError(f"文件不存在: {file_path}")
        
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                all_lines = f.readlines()
            
            total_lines = len(all_lines)
            
            start = offset
            end = min(offset + limit, total_lines)
            
            selected_lines = all_lines[start:end]
            
            max_line_num = total_lines
            line_num_width = len(str(max_line_num))
            
            formatted_lines = []
            for i, line in enumerate(selected_lines):
                line_num = start + i + 1
                stripped_line = line.rstrip("\n\r")
                
                if len(stripped_line) > self.MAX_LINE_LENGTH:
                    stripped_line = stripped_line[:self.MAX_LINE_LENGTH]
                
                formatted_line = f"{line_num:>{line_num_width}}→{stripped_line}"
                formatted_lines.append(formatted_line)
            
            content = "\n".join(formatted_lines)
            
            return {
                "content": content,
                "success": True,
                "error_message": None,
                "total_lines": total_lines,
                "lines_read": len(selected_lines),
                "metadata": {
                    "resources_used": [file_path]
                }
            }
            
        except UnicodeDecodeError as e:
            raise FileToolError(f"文件编码错误，请确保文件使用 UTF-8 编码: {file_path}")
        except Exception as e:
            raise FileToolError(f"读取文件失败: {str(e)}")
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取读取工具的规范定义。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容 OpenAI Function Calling 格式。
        """
        return {
            "name": "Read",
            "description": (
                "读取文件内容。"
                "支持指定行号范围读取，返回带行号的格式化输出。"
                "默认读取最多 2000 行，超过 2000 字符的行会被截断。"
            ),
            "parameters": {
                "file_path": {
                    "type": "string",
                    "description": "要读取的文件的绝对路径。",
                    "required": True,
                },
                "offset": {
                    "type": "integer",
                    "description": "起始行号偏移量（从 0 开始）。默认为 0。",
                    "required": False,
                    "default": 0,
                },
                "limit": {
                    "type": "integer",
                    "description": "读取行数限制。默认为 2000。",
                    "required": False,
                    "default": 2000,
                },
            },
        }


def read_file(
    file_path: str,
    offset: int = 0,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    """
    读取文件内容的便捷函数。
    
    Args:
        file_path (str): 文件的绝对路径。
        offset (int, optional): 起始行号偏移量。默认为 0。
        limit (Optional[int], optional): 读取行数限制。默认为 2000。
    
    Returns:
        Dict[str, Any]: 读取结果。
    
    Example:
        >>> result = read_file("/path/to/file.py", limit=100)
    """
    tool = Read()
    return tool.execute(file_path=file_path, offset=offset, limit=limit)


def get_read_tool_spec() -> Dict[str, Any]:
    """
    获取读取工具的规范定义。
    
    Returns:
        Dict[str, Any]: 工具规范，兼容 OpenAI Function Calling 格式。
    """
    return {
        "name": "Read",
        "description": (
            "读取文件内容。"
            "支持指定行号范围读取，返回带行号的格式化输出。"
            "默认读取最多 2000 行，超过 2000 字符的行会被截断。"
        ),
        "parameters": {
            "file_path": {
                "type": "string",
                "description": "要读取的文件的绝对路径。",
                "required": True,
            },
            "offset": {
                "type": "integer",
                "description": "起始行号偏移量（从 0 开始）。默认为 0。",
                "required": False,
                "default": 0,
            },
            "limit": {
                "type": "integer",
                "description": "读取行数限制。默认为 2000。",
                "required": False,
                "default": 2000,
            },
        },
    }
