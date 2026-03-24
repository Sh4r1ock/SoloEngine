# -*- coding: utf-8 -*-
"""
文件写入工具模块。

@file write.py
@description 提供文件写入功能
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 写入内容到文件（UTF-8 编码）
- 自动创建父目录
- 覆盖现有文件

状态: ✅ 模块初始化完成
"""

import os
from typing import Dict, Any

from .base import BaseFileTool, FileToolError


class Write(BaseFileTool):
    """
    文件写入工具。
    
    将内容写入指定文件，支持自动创建父目录。
    
    核心功能：
        1. 文件写入：使用 UTF-8 编码
        2. 目录创建：自动创建父目录
        3. 文件覆盖：覆盖已存在的文件
    
    注意事项：
        - 此工具会覆盖已存在的文件
        - 对于已存在的文件，必须先使用 Read 工具读取
        - 禁止主动创建文档文件（*.md）或 README 文件
    
    Example:
        >>> write_tool = Write()
        >>> result = write_tool.execute(
        ...     file_path="/path/to/file.py",
        ...     content="print('Hello, World!')"
        ... )
    """
    
    def execute(
        self,
        file_path: str,
        content: str,
    ) -> Dict[str, Any]:
        """
        执行文件写入操作。
        
        将内容写入指定文件。如果文件存在则覆盖，不存在则创建。
        会自动创建所有必要的父目录。
        
        Args:
            file_path (str): 文件的绝对路径。
            content (str): 要写入的内容。
        
        Returns:
            Dict[str, Any]: 写入结果，包含：
                - content (str): 操作结果描述
                - success (bool): 是否成功
                - error_message (Optional[str]): 错误信息
                - bytes_written (int): 写入的字节数
        
        Raises:
            FileToolError: 当路径不是绝对路径时抛出。
            FileToolError: 当写入失败时抛出。
        
        Example:
            >>> result = write_tool.execute(
            ...     file_path="/home/user/example.py",
            ...     content="def hello():\\n    print('Hello')"
            ... )
            >>> print(result["success"])  # True
        """
        self.validate_absolute_path(file_path)
        
        self.ensure_directory_exists(file_path)
        
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                bytes_written = f.write(content)
            
            return {
                "content": f"文件写入成功: {file_path}",
                "success": True,
                "error_message": None,
                "bytes_written": bytes_written,
            }
            
        except Exception as e:
            raise FileToolError(f"写入文件失败: {str(e)}")
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取写入工具的规范定义。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容 OpenAI Function Calling 格式。
        """
        return {
            "name": "Write",
            "description": (
                "写入内容到文件。"
                "使用 UTF-8 编码，会自动创建父目录。"
                "如果文件存在则覆盖。"
                "注意：对于已存在的文件，必须先使用 Read 工具读取。"
            ),
            "parameters": {
                "file_path": {
                    "type": "string",
                    "description": "要写入的文件的绝对路径。",
                    "required": True,
                },
                "content": {
                    "type": "string",
                    "description": "要写入文件的内容。",
                    "required": True,
                },
            },
        }


def write_file(
    file_path: str,
    content: str,
) -> Dict[str, Any]:
    """
    写入文件内容的便捷函数。
    
    Args:
        file_path (str): 文件的绝对路径。
        content (str): 要写入的内容。
    
    Returns:
        Dict[str, Any]: 写入结果。
    
    Example:
        >>> result = write_file("/path/to/file.py", "print('Hello')")
    """
    tool = Write()
    return tool.execute(file_path=file_path, content=content)


def get_write_tool_spec() -> Dict[str, Any]:
    """
    获取写入工具的规范定义。
    
    Returns:
        Dict[str, Any]: 工具规范，兼容 OpenAI Function Calling 格式。
    """
    return {
        "name": "Write",
        "description": (
            "写入内容到文件。"
            "使用 UTF-8 编码，会自动创建父目录。"
            "如果文件存在则覆盖。"
            "注意：对于已存在的文件，必须先使用 Read 工具读取。"
        ),
        "parameters": {
            "file_path": {
                "type": "string",
                "description": "要写入的文件的绝对路径。",
                "required": True,
            },
            "content": {
                "type": "string",
                "description": "要写入文件的内容。",
                "required": True,
            },
        },
    }
