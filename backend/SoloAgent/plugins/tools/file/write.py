# -*- coding: utf-8 -*-
"""
SoloEngine : 文件写入工具模块，提供文件写入功能

@file write.py
@description 提供文件写入功能
@author Sh4rlock
@date 2026-04-09

功能描述：
- 写入内容到文件（UTF-8 编码）
- 自动创建父目录
- 覆盖现有文件

状态: ✅ 模块初始化完成
"""

from typing import Dict, Any

from .base import BaseFileTool, FileToolError
from .._hitl import plan_mode_guard


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
        # Plan 模式守卫（read-only 锁定）：处于计划模式时拒绝写入（特殊点位处理，非 plan 模式返回 None 放行原路径）
        guard = plan_mode_guard(__class__.__name__)
        if guard:
            return guard

        self.validate_absolute_path(file_path)
        
        self.ensure_directory_exists(file_path)
        
        try:
            with open(file_path, "wb") as f:
                bytes_written = f.write(content.encode("utf-8"))
            
            return {
                "content": f"文件写入成功: {file_path}",
                "success": True,
                "error_message": None,
                "bytes_written": bytes_written,
                "metadata": {
                    "resources_used": [file_path]
                }
            }
            
        except Exception as e:
            raise FileToolError(f"写入文件失败: {str(e)}")
    
    def get_tool_spec(self) -> Dict[str, Any]:
        return {
            "name": "Write",
            "description": (
                "写入内容到文件。"
                "使用 UTF-8 编码，会自动创建父目录。"
                "如果文件存在则覆盖。"
                "注意：对于已存在的文件，必须先使用 Read 工具读取。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "要写入的文件的绝对路径。",
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入文件的内容。",
                    },
                },
                "required": ["file_path", "content"],
            },
        }

