# -*- coding: utf-8 -*-
"""
SoloEngine : 搜索替换工具模块，提供文件内容搜索替换功能

@file search_replace.py
@description 提供文件内容搜索替换功能
@author Sh4rlock
@date 2026-04-09

功能描述：
- 在文件中查找并替换唯一文本
- old_str 必须在文件中唯一（只出现一次）
- 只替换第一个匹配项

状态: ✅ 模块初始化完成
"""

from typing import Dict, Any

from .base import BaseFileTool, FileToolError
from .._hitl import plan_mode_guard


class SearchReplace(BaseFileTool):
    """
    搜索替换工具。
    
    在文件中查找指定的文本并替换为新文本。
    要求 old_str 在文件中必须唯一（只出现一次）。
    
    核心功能：
        1. 唯一匹配：确保 old_str 只出现一次
        2. 精确替换：只替换第一个匹配项
        3. 安全操作：替换前验证文件存在
    
    使用规则：
        - old_str 必须是连续的文本块
        - old_str 和 new_str 必须不同
        - 只替换第一个匹配项
    
    Example:
        >>> sr_tool = SearchReplace()
        >>> result = sr_tool.execute(
        ...     file_path="/path/to/file.py",
        ...     old_str="def old_func():",
        ...     new_str="def new_func():"
        ... )
    """
    
    def execute(
        self,
        file_path: str,
        old_str: str,
        new_str: str,
    ) -> Dict[str, Any]:
        """
        执行搜索替换操作。
        
        在文件中查找 old_str 并替换为 new_str。
        old_str 必须在文件中唯一（只出现一次）。
        
        Args:
            file_path (str): 文件的绝对路径。
            old_str (str): 要查找的文本（必须在文件中唯一）。
            new_str (str): 替换后的文本。
        
        Returns:
            Dict[str, Any]: 替换结果，包含：
                - content (str): 操作结果描述
                - success (bool): 是否成功
                - error_message (Optional[str]): 错误信息
                - occurrences (int): old_str 在文件中出现的次数
        
        Raises:
            FileToolError: 当路径不是绝对路径时抛出。
            FileToolError: 当文件不存在时抛出。
            FileToolError: 当 old_str 和 new_str 相同时抛出。
            FileToolError: 当 old_str 在文件中出现多次时抛出。
            FileToolError: 当 old_str 在文件中未找到时抛出。
        
        Example:
            >>> result = sr_tool.execute(
            ...     file_path="/home/user/example.py",
            ...     old_str="print('Hello')",
            ...     new_str="print('World')"
            ... )
        """
        # Plan 模式守卫（read-only 锁定）：处于计划模式时拒绝修改（特殊点位处理，非 plan 模式返回 None 放行原路径）
        guard = plan_mode_guard(__class__.__name__)
        if guard:
            return guard

        self.validate_absolute_path(file_path)
        
        if not self.file_exists(file_path):
            raise FileToolError(f"文件不存在: {file_path}")
        
        if old_str == new_str:
            raise FileToolError("old_str 和 new_str 不能相同")
        
        try:
            with open(file_path, "rb") as f:
                content = f.read().decode("utf-8", errors="replace")
            
            occurrences = content.count(old_str)
            
            if occurrences == 0:
                raise FileToolError(
                    f"在文件中未找到要替换的文本。"
                    f"请确保 old_str 与文件中的内容完全一致。"
                )
            
            if occurrences > 1:
                raise FileToolError(
                    f"old_str 在文件中出现 {occurrences} 次，必须是唯一的。"
                    f"请提供更具体的文本块以确保唯一性。"
                )
            
            new_content = content.replace(old_str, new_str, 1)
            
            with open(file_path, "wb") as f:
                f.write(new_content.encode("utf-8"))
            
            return {
                "content": f"成功替换文件 {file_path} 中的内容",
                "success": True,
                "error_message": None,
                "occurrences": occurrences,
                "metadata": {
                    "resources_used": [file_path]
                }
            }
            
        except FileToolError:
            raise
        except Exception as e:
            raise FileToolError(f"搜索替换失败: {str(e)}")
    
    def get_tool_spec(self) -> Dict[str, Any]:
        return {
            "name": "SearchReplace",
            "description": (
                "在文件中搜索并替换文本。"
                "old_str 必须在文件中唯一（只出现一次）。"
                "只替换第一个匹配项。"
                "old_str 和 new_str 必须不同。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "要修改的文件的绝对路径。",
                    },
                    "old_str": {
                        "type": "string",
                        "description": "要搜索的文本（必须在文件中唯一）。",
                    },
                    "new_str": {
                        "type": "string",
                        "description": "替换后的文本。",
                    },
                },
                "required": ["file_path", "old_str", "new_str"],
            },
        }

