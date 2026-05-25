# -*- coding: utf-8 -*-
"""
SoloEngine : 文件模式匹配工具模块，使用glob模式进行文件匹配

@file glob.py
@description 使用 glob 模式进行文件匹配
@author Sh4rlock
@date 2026-04-09

功能描述：
- 基于 glob 模式的文件匹配
- 支持递归模式 (**/*.py)
- 按修改时间排序
- 支持路径参数

使用场景：
- 按名称查找文件
- 批量文件操作
- 文件列表获取

状态: ✅ 模块初始化完成
"""

import os
import logging
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from pathlib import Path
import fnmatch

from .base import BaseSearchTool

logger = logging.getLogger(__name__)


@dataclass
class FileMatch:
    """
    文件匹配结果数据类。
    
    存储匹配文件的信息。
    
    Attributes:
        file_path (str): 文件路径
        is_directory (bool): 是否为目录
        size (int): 文件大小（字节）
        modification_time (float): 修改时间戳
    """
    
    file_path: str
    is_directory: bool = False
    size: int = 0
    modification_time: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            "file_path": self.file_path,
            "is_directory": self.is_directory,
            "size": self.size,
            "modification_time": self.modification_time,
        }


class Glob(BaseSearchTool):
    """
    文件模式匹配工具。
    
    使用 glob 模式进行文件匹配，支持递归搜索和按修改时间排序。
    
    核心功能：
        1. glob 模式匹配
        2. 递归搜索 (**/*.py)
        3. 按修改时间排序（最新优先）
        4. 路径参数支持
    
    Glob 模式语法：
        - *: 匹配任意字符（不包括路径分隔符）
        - **: 匹配任意字符（包括路径分隔符，递归）
        - ?: 匹配单个字符
        - [abc]: 匹配指定字符集中的字符
        - [!abc]: 匹配不在指定字符集中的字符
    
    Example:
        >>> tool = Glob("/home/user/project")
        >>> results = await tool.execute(
        ...     pattern="**/*.py",
        ...     path="src"
        ... )
    """
    
    tool_name: str = "Glob"
    
    def __init__(self, working_directory: Optional[str] = None) -> None:
        """
        初始化文件模式匹配工具。
        
        Args:
            working_directory (Optional[str], optional): 工作目录。默认为 None
        """
        super().__init__(working_directory)
    
    async def execute(
        self,
        pattern: str,
        path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        执行文件模式匹配。
        
        Args:
            pattern (str): glob 模式
            path (Optional[str], optional): 搜索路径。默认为 None（工作目录）
        
        Returns:
            Dict[str, Any]: 匹配结果
        
        Raises:
            SearchToolError: 当搜索失败时抛出
        """
        try:
            search_path = self.resolve_path(path)
            
            if not self.validate_path(search_path):
                return self.format_error(f"路径不存在: {search_path}")
            
            matches = self._glob_search(
                pattern=pattern,
                path=search_path,
            )
            
            sorted_matches = self._sort_by_modification_time(matches)
            
            relative_paths = [
                self.get_relative_path(m.file_path)
                for m in sorted_matches
            ]
            
            content = self._format_content(relative_paths, pattern, search_path)
            
            return self.format_result(
                success=True,
                content=content,
                metadata={
                    "pattern": pattern,
                    "path": self.get_relative_path(search_path),
                    "total_matches": len(relative_paths),
                    "files": [m.to_dict() for m in sorted_matches],
                    "resources_used": [search_path]
                },
            )
            
        except Exception as e:
            logger.error(f"Glob error: {e}")
            return self.format_error(f"文件匹配失败: {str(e)}", exception=e)
    
    def _glob_search(
        self,
        pattern: str,
        path: str,
    ) -> List[FileMatch]:
        """
        执行 glob 搜索。
        
        Args:
            pattern (str): glob 模式
            path (str): 搜索路径
        
        Returns:
            List[FileMatch]: 匹配的文件列表
        """
        matches = []
        
        if '**' in pattern:
            full_pattern = os.path.join(path, pattern)
            matched_paths = Path(path).glob(pattern)
        else:
            full_pattern = os.path.join(path, pattern)
            matched_paths = Path(path).glob(pattern)
        
        for matched_path in matched_paths:
            try:
                stat = matched_path.stat()
                
                file_match = FileMatch(
                    file_path=str(matched_path),
                    is_directory=matched_path.is_dir(),
                    size=stat.st_size if matched_path.is_file() else 0,
                    modification_time=stat.st_mtime,
                )
                matches.append(file_match)
                
            except OSError as e:
                logger.debug(f"Cannot access {matched_path}: {e}")
                continue
        
        return matches
    
    def _sort_by_modification_time(
        self,
        matches: List[FileMatch],
    ) -> List[FileMatch]:
        """
        按修改时间排序（最新优先）。
        
        Args:
            matches (List[FileMatch]): 文件匹配列表
        
        Returns:
            List[FileMatch]: 排序后的列表
        """
        return sorted(
            matches,
            key=lambda x: x.modification_time,
            reverse=True,
        )
    
    def _format_content(
        self,
        file_paths: List[str],
        pattern: str,
        path: str,
    ) -> str:
        """
        格式化匹配结果为可读文本。
        
        Args:
            file_paths (List[str]): 文件路径列表
            pattern (str): glob 模式
            path (str): 搜索路径
        
        Returns:
            str: 格式化的结果文本
        """
        if not file_paths:
            return f"未找到匹配 '{pattern}' 的文件"
        
        lines = [f"找到 {len(file_paths)} 个匹配 '{pattern}' 的文件:\n"]
        
        for file_path in file_paths:
            lines.append(file_path)
        
        return "\n".join(lines)
    
    def match_pattern(self, filename: str, pattern: str) -> bool:
        """
        检查文件名是否匹配 glob 模式。
        
        Args:
            filename (str): 文件名
            pattern (str): glob 模式
        
        Returns:
            bool: 是否匹配
        """
        return fnmatch.fnmatch(filename, pattern)
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取工具规范。
        
        返回兼容 OpenAI Function Calling 的工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范
        """
        return {
            "name": "Glob",
            "description": (
                "快速文件模式匹配工具，适用于任何规模的代码库。\n"
                "支持 glob 模式如 \"/*.js\" 或 \"src/**/*.ts\"\n"
                "返回按修改时间排序的匹配文件路径（最新优先）\n"
                "当需要按名称查找文件时使用此工具。\n"
                "对于需要多轮 glob 和 grep 的开放式搜索，请使用 Agent 工具代替。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "要匹配的 glob 模式",
                    },
                    "path": {
                        "type": "string",
                        "description": (
                            "搜索目录。如果未指定，使用当前工作目录。"
                            "不要输入 \"undefined\" 或 \"null\" - 直接省略此字段使用默认行为。"
                            "如果提供，必须是有效的绝对目录路径。"
                        ),
                    },
                },
                "required": ["pattern"],
            },
        }

