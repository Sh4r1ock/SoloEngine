# -*- coding: utf-8 -*-
"""
SoloEngine : 正则表达式搜索工具模块，使用ripgrep进行搜索

@file grep.py
@description 使用 ripgrep 进行正则表达式搜索
@author Sh4rlock
@date 2026-04-09

功能描述：
- 基于正则表达式的文本搜索
- 支持 glob 模式过滤
- 支持多种输出模式
- 支持上下文显示

使用场景：
- 代码内容搜索
- 日志文件分析
- 文本模式匹配

状态: ✅ 模块初始化完成
"""

import os
import re
import logging
import subprocess
import shutil
from typing import Dict, Any, List, Optional, Union
from dataclasses import dataclass
from enum import Enum

from .base import BaseSearchTool, SearchToolError

logger = logging.getLogger(__name__)


class OutputMode(Enum):
    """输出模式枚举。"""
    
    CONTENT = "content"
    """显示匹配内容"""
    
    FILES_WITH_MATCHES = "files_with_matches"
    """仅显示匹配的文件路径"""
    
    COUNT = "count"
    """显示匹配计数"""


@dataclass
class MatchResult:
    """
    匹配结果数据类。
    
    存储单个匹配结果的信息。
    
    Attributes:
        file_path (str): 文件路径
        line_number (int): 行号
        line_content (str): 行内容
        match_start (int): 匹配起始位置
        match_end (int): 匹配结束位置
        context_before (List[str]): 前置上下文
        context_after (List[str]): 后置上下文
    """
    
    file_path: str
    line_number: int
    line_content: str
    match_start: int = 0
    match_end: int = 0
    context_before: List[str] = None
    context_after: List[str] = None
    
    def __post_init__(self):
        if self.context_before is None:
            self.context_before = []
        if self.context_after is None:
            self.context_after = []
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        result = {
            "file_path": self.file_path,
            "line_number": self.line_number,
            "line_content": self.line_content,
        }
        
        if self.context_before:
            result["context_before"] = self.context_before
        if self.context_after:
            result["context_after"] = self.context_after
        
        return result


class Grep(BaseSearchTool):
    """
    正则表达式搜索工具。
    
    使用 ripgrep (rg) 进行高性能正则表达式搜索，
    支持多种输出模式和过滤选项。
    
    核心功能：
        1. 正则表达式模式匹配
        2. glob 模式文件过滤
        3. 多种输出模式
        4. 行号和上下文显示
        5. 大小写敏感控制
    
    输出模式：
        - content: 显示匹配内容和行号
        - files_with_matches: 仅显示匹配的文件路径
        - count: 显示每个文件的匹配计数
    
    Example:
        >>> tool = Grep("/home/user/project")
        >>> results = await tool.execute(
        ...     pattern="def \\w+\\(",
        ...     glob="*.py",
        ...     output_mode="content",
        ...     n=True
        ... )
    """
    
    tool_name: str = "Grep"
    
    def __init__(self, working_directory: Optional[str] = None) -> None:
        """
        初始化正则表达式搜索工具。
        
        Args:
            working_directory (Optional[str], optional): 工作目录。默认为 None
        """
        super().__init__(working_directory)
        self._rg_path = self._find_ripgrep()
    
    def _find_ripgrep(self) -> Optional[str]:
        """
        查找 ripgrep 可执行文件。
        
        Returns:
            Optional[str]: ripgrep 路径，如果未找到返回 None
        """
        rg_path = shutil.which("rg")
        if rg_path:
            return rg_path
        
        return None
    
    def _has_ripgrep(self) -> bool:
        """检查是否安装了 ripgrep。"""
        return self._rg_path is not None
    
    async def execute(
        self,
        pattern: str,
        path: Optional[str] = None,
        glob: Optional[str] = None,
        output_mode: str = "files_with_matches",
        n: bool = False,
        C: int = 0,
        A: int = 0,
        B: int = 0,
        i: bool = False,
        head_limit: int = 100,
        multiline: bool = False,
        type: Optional[str] = None,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """
        执行正则表达式搜索。
        
        Args:
            pattern (str): 正则表达式模式
            path (Optional[str], optional): 搜索路径。默认为 None（工作目录）
            glob (Optional[str], optional): glob 模式过滤。默认为 None
            output_mode (str, optional): 输出模式。默认为 "files_with_matches"
                - content: 显示匹配内容
                - files_with_matches: 仅显示文件路径
                - count: 显示匹配计数
            n (bool, optional): 是否显示行号。默认为 False
            C (int, optional): 上下文行数。默认为 0
            A (int, optional): 匹配后行数。默认为 0
            B (int, optional): 匹配前行数。默认为 0
            i (bool, optional): 是否忽略大小写。默认为 False
            head_limit (int, optional): 结果数量限制。默认为 100
            multiline (bool, optional): 是否启用多行模式。默认为 False
            type (Optional[str], optional): 文件类型过滤。默认为 None
            offset (int, optional): 跳过前 N 个结果。默认为 0
        
        Returns:
            Dict[str, Any]: 搜索结果
        
        Raises:
            SearchToolError: 当搜索失败时抛出
        """
        try:
            search_path = self.resolve_path(path)
            
            if not self.validate_path(search_path):
                return self.format_error(f"路径不存在: {search_path}")
            
            try:
                re.compile(pattern)
            except re.error as e:
                return self.format_error(f"无效的正则表达式: {e}")
            
            if self._has_ripgrep():
                results = await self._search_with_ripgrep(
                    pattern=pattern,
                    path=search_path,
                    glob=glob,
                    output_mode=output_mode,
                    n=n,
                    C=C,
                    A=A,
                    B=B,
                    i=i,
                    head_limit=head_limit,
                    multiline=multiline,
                    type=type,
                    offset=offset,
                )
            else:
                results = await self._search_with_python(
                    pattern=pattern,
                    path=search_path,
                    glob=glob,
                    output_mode=output_mode,
                    n=n,
                    C=C,
                    A=A,
                    B=B,
                    i=i,
                    head_limit=head_limit,
                    multiline=multiline,
                    type=type,
                    offset=offset,
                )
            
            return results
            
        except Exception as e:
            logger.error(f"Grep error: {e}")
            return self.format_error(f"搜索失败: {str(e)}", exception=e)
    
    async def _search_with_ripgrep(
        self,
        pattern: str,
        path: str,
        glob: Optional[str],
        output_mode: str,
        n: bool,
        C: int,
        A: int,
        B: int,
        i: bool,
        head_limit: int,
        multiline: bool,
        type: Optional[str],
        offset: int,
    ) -> Dict[str, Any]:
        """
        使用 ripgrep 执行搜索。
        
        Args:
            pattern (str): 正则表达式模式
            path (str): 搜索路径
            glob (Optional[str]): glob 模式
            output_mode (str): 输出模式
            n (bool): 是否显示行号
            C (int): 上下文行数
            A (int): 匹配后行数
            B (int): 匹配前行数
            i (bool): 是否忽略大小写
            head_limit (int): 结果限制
            multiline (bool): 是否多行模式
            type (Optional[str]): 文件类型
            offset (int): 偏移量
        
        Returns:
            Dict[str, Any]: 搜索结果
        """
        cmd = [self._rg_path]
        
        if output_mode == "files_with_matches":
            cmd.append("-l")
        elif output_mode == "count":
            cmd.append("-c")
        else:
            if n:
                cmd.append("-n")
        
        if i:
            cmd.append("-i")
        
        if multiline:
            cmd.append("-U")
            cmd.append("--multiline-dotall")
        
        if C > 0:
            cmd.extend(["-C", str(C)])
        if A > 0:
            cmd.extend(["-A", str(A)])
        if B > 0:
            cmd.extend(["-B", str(B)])
        
        if glob:
            cmd.extend(["--glob", glob])
        
        if type:
            cmd.extend(["--type", type])
        
        cmd.extend(["--", pattern, path])
        
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode not in (0, 1):
                error_msg = stderr.decode('utf-8', errors='ignore').strip()
                if error_msg:
                    return self.format_error(f"ripgrep 错误: {error_msg}")
            
            output = stdout.decode('utf-8', errors='ignore')
            lines = output.strip().split('\n') if output.strip() else []
            
            if offset > 0:
                lines = lines[offset:]
            
            if head_limit > 0:
                lines = lines[:head_limit]
            
            return self._format_results(
                lines=lines,
                output_mode=output_mode,
                pattern=pattern,
                path=path,
            )
            
        except FileNotFoundError:
            return self.format_error("ripgrep 未安装")
        except Exception as e:
            return self.format_error(f"执行 ripgrep 失败: {e}")
    
    async def _search_with_python(
        self,
        pattern: str,
        path: str,
        glob: Optional[str],
        output_mode: str,
        n: bool,
        C: int,
        A: int,
        B: int,
        i: bool,
        head_limit: int,
        multiline: bool,
        type: Optional[str],
        offset: int,
    ) -> Dict[str, Any]:
        """
        使用 Python 实现搜索（ripgrep 不可用时的后备方案）。
        
        Args:
            pattern (str): 正则表达式模式
            path (str): 搜索路径
            glob (Optional[str]): glob 模式
            output_mode (str): 输出模式
            n (bool): 是否显示行号
            C (int): 上下文行数
            A (int): 匹配后行数
            B (int): 匹配前行数
            i (bool): 是否忽略大小写
            head_limit (int): 结果限制
            multiline (bool): 是否多行模式
            type (Optional[str]): 文件类型
            offset (int): 偏移量
        
        Returns:
            Dict[str, Any]: 搜索结果
        """
        import fnmatch
        from pathlib import Path as PathlibPath
        
        flags = re.MULTILINE if multiline else 0
        if i:
            flags |= re.IGNORECASE
        
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return self.format_error(f"无效的正则表达式: {e}")
        
        type_extensions = {
            'py': ['.py'],
            'js': ['.js', '.jsx', '.mjs'],
            'ts': ['.ts', '.tsx'],
            'java': ['.java'],
            'go': ['.go'],
            'rs': ['.rs'],
            'c': ['.c', '.h'],
            'cpp': ['.cpp', '.hpp', '.cc', '.cxx'],
            'rb': ['.rb'],
            'php': ['.php'],
            'md': ['.md', '.markdown'],
            'json': ['.json'],
            'yaml': ['.yaml', '.yml'],
            'html': ['.html', '.htm'],
            'css': ['.css', '.scss', '.sass'],
        }
        
        allowed_extensions = None
        if type and type in type_extensions:
            allowed_extensions = set(type_extensions[type])
        
        results = []
        file_counts: Dict[str, int] = {}
        files_with_matches: List[str] = []
        
        path_obj = PathlibPath(path)
        
        if path_obj.is_file():
            files_to_search = [path_obj]
        else:
            files_to_search = path_obj.rglob('*')
        
        skip_count = offset
        
        for file_path in files_to_search:
            if not file_path.is_file():
                continue
            
            if glob and not fnmatch.fnmatch(file_path.name, glob):
                continue
            
            if allowed_extensions:
                if file_path.suffix.lower() not in allowed_extensions:
                    continue
            
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
                
                file_matched = False
                file_count = 0
                
                for line_num, line in enumerate(lines, 1):
                    if regex.search(line):
                        file_matched = True
                        file_count += 1
                        
                        if output_mode == "content":
                            if skip_count > 0:
                                skip_count -= 1
                                continue
                            
                            context_before = []
                            context_after = []
                            
                            if B > 0 or C > 0:
                                before_count = max(B, C)
                                context_before = [
                                    lines[i].rstrip('\n\r')
                                    for i in range(max(0, line_num - before_count - 1), line_num - 1)
                                ]
                            
                            if A > 0 or C > 0:
                                after_count = max(A, C)
                                context_after = [
                                    lines[i].rstrip('\n\r')
                                    for i in range(line_num, min(len(lines), line_num + after_count))
                                ]
                            
                            result = MatchResult(
                                file_path=str(file_path),
                                line_number=line_num,
                                line_content=line.rstrip('\n\r'),
                                context_before=context_before,
                                context_after=context_after,
                            )
                            results.append(result)
                            
                            if head_limit > 0 and len(results) >= head_limit:
                                break
                
                if file_matched:
                    files_with_matches.append(str(file_path))
                    file_counts[str(file_path)] = file_count
                
                if head_limit > 0 and output_mode == "content" and len(results) >= head_limit:
                    break
                    
            except Exception as e:
                logger.debug(f"Failed to read {file_path}: {e}")
                continue
        
        return self._format_python_results(
            results=results,
            files_with_matches=files_with_matches,
            file_counts=file_counts,
            output_mode=output_mode,
            pattern=pattern,
            path=path,
            n=n,
        )
    
    def _format_results(
        self,
        lines: List[str],
        output_mode: str,
        pattern: str,
        path: str,
    ) -> Dict[str, Any]:
        """
        格式化 ripgrep 结果。
        
        Args:
            lines (List[str]): 输出行
            output_mode (str): 输出模式
            pattern (str): 搜索模式
            path (str): 搜索路径
        
        Returns:
            Dict[str, Any]: 格式化的结果
        """
        if output_mode == "files_with_matches":
            content = "\n".join(lines) if lines else "未找到匹配的文件"
            
            return self.format_result(
                success=True,
                content=content,
                metadata={
                    "output_mode": output_mode,
                    "pattern": pattern,
                    "path": self.get_relative_path(path),
                    "total_files": len(lines),
                    "resources_used": [path]
                },
            )
        
        elif output_mode == "count":
            content = "\n".join(lines) if lines else "未找到匹配"
            
            return self.format_result(
                success=True,
                content=content,
                metadata={
                    "output_mode": output_mode,
                    "pattern": pattern,
                    "path": self.get_relative_path(path),
                    "resources_used": [path]
                },
            )
        
        else:
            content = "\n".join(lines) if lines else "未找到匹配"
            
            return self.format_result(
                success=True,
                content=content,
                metadata={
                    "output_mode": output_mode,
                    "pattern": pattern,
                    "path": self.get_relative_path(path),
                    "total_matches": len(lines),
                    "resources_used": [path]
                },
            )
    
    def _format_python_results(
        self,
        results: List[MatchResult],
        files_with_matches: List[str],
        file_counts: Dict[str, int],
        output_mode: str,
        pattern: str,
        path: str,
        n: bool,
    ) -> Dict[str, Any]:
        """
        格式化 Python 搜索结果。
        
        Args:
            results (List[MatchResult]): 匹配结果列表
            files_with_matches (List[str]): 匹配的文件列表
            file_counts (Dict[str, int]): 文件计数
            output_mode (str): 输出模式
            pattern (str): 搜索模式
            path (str): 搜索路径
            n (bool): 是否显示行号
        
        Returns:
            Dict[str, Any]: 格式化的结果
        """
        if output_mode == "files_with_matches":
            lines = [self.get_relative_path(f) for f in files_with_matches]
            content = "\n".join(lines) if lines else "未找到匹配的文件"
            
            return self.format_result(
                success=True,
                content=content,
                metadata={
                    "output_mode": output_mode,
                    "pattern": pattern,
                    "path": self.get_relative_path(path),
                    "total_files": len(files_with_matches),
                    "resources_used": [path]
                },
            )
        
        elif output_mode == "count":
            lines = [
                f"{self.get_relative_path(f)}:{c}"
                for f, c in file_counts.items()
            ]
            content = "\n".join(lines) if lines else "未找到匹配"
            
            return self.format_result(
                success=True,
                content=content,
                metadata={
                    "output_mode": output_mode,
                    "pattern": pattern,
                    "path": self.get_relative_path(path),
                    "resources_used": [path]
                },
            )
        
        else:
            lines = []
            for result in results:
                file_path = self.get_relative_path(result.file_path)
                if n:
                    lines.append(f"{file_path}:{result.line_number}:{result.line_content}")
                else:
                    lines.append(f"{file_path}:{result.line_content}")
            
            content = "\n".join(lines) if lines else "未找到匹配"
            
            return self.format_result(
                success=True,
                content=content,
                metadata={
                    "output_mode": output_mode,
                    "pattern": pattern,
                    "path": self.get_relative_path(path),
                    "total_matches": len(results),
                    "resources_used": [path]
                },
            )
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取工具规范。
        
        返回兼容 OpenAI Function Calling 的工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范
        """
        return {
            "type": "function",
            "function": {
                "name": "Grep",
                "description": (
                    "基于 ripgrep 构建的强大搜索工具。\n\n"
                    "用法:\n"
                    "  - 始终使用 Grep 进行搜索任务。不要作为 Bash 命令调用 `grep` 或 `rg`。\n"
                    "  - 支持完整的正则表达式语法（如 \"log.*Error\", \"function\\s+\\w+\")\n"
                    "  - 使用 glob 参数过滤文件（如 \"*.js\", \"**/*.tsx\")\n"
                    "  - 使用 type 参数按文件类型过滤（如 js, py, rust）\n"
                    "  - 输出模式: \"content\" 显示匹配行, \"files_with_matches\" 仅显示文件路径, "
                    "\"count\" 显示匹配计数\n"
                    "  - 多行匹配: 使用 multiline=true，模式可以跨行匹配\n"
                    "  - ripgrep 模式语法: 注意在 Go 代码中需要转义字面大括号，如 `interface\\{\\}`\n"
                    "  - 默认情况下模式在单行内匹配。跨行模式使用 multiline=true\n"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {
                            "type": "string",
                            "description": "要搜索的正则表达式模式",
                        },
                        "path": {
                            "type": "string",
                            "description": "搜索路径（rg PATH）。默认为当前工作目录。",
                        },
                        "glob": {
                            "type": "string",
                            "description": "glob 模式过滤文件（rg --glob），如 \"*.js\", \"**/*.tsx\"",
                        },
                        "output_mode": {
                            "type": "string",
                            "enum": ["content", "files_with_matches", "count"],
                            "description": "输出模式",
                        },
                        "n": {
                            "type": "boolean",
                            "description": "显示行号（rg -n）。仅在 output_mode 为 content 时有效。",
                        },
                        "C": {
                            "type": "integer",
                            "description": "显示匹配前后 N 行上下文（rg -C）。仅在 output_mode 为 content 时有效。",
                        },
                        "A": {
                            "type": "integer",
                            "description": "显示匹配后 N 行（rg -A）。仅在 output_mode 为 content 时有效。",
                        },
                        "B": {
                            "type": "integer",
                            "description": "显示匹配前 N 行（rg -B）。仅在 output_mode 为 content 时有效。",
                        },
                        "i": {
                            "type": "boolean",
                            "description": "忽略大小写（rg -i）",
                        },
                        "head_limit": {
                            "type": "integer",
                            "description": "限制输出前 N 条结果。适用于所有输出模式。",
                        },
                        "multiline": {
                            "type": "boolean",
                            "description": "启用多行模式（rg -U --multiline-dotall）。默认为 false。",
                        },
                        "type": {
                            "type": "string",
                            "description": "文件类型过滤（rg --type）。常见类型: js, py, rust, go, java 等。",
                        },
                        "offset": {
                            "type": "integer",
                            "description": "跳过前 N 条结果后再应用 head_limit。适用于所有输出模式。",
                        },
                    },
                    "required": ["pattern"],
                },
            },
        }


import asyncio


async def grep(
    pattern: str,
    path: Optional[str] = None,
    glob: Optional[str] = None,
    output_mode: str = "files_with_matches",
    n: bool = False,
    C: int = 0,
    i: bool = False,
    head_limit: int = 100,
    working_directory: Optional[str] = None,
) -> Dict[str, Any]:
    """
    正则表达式搜索便捷函数。
    
    Args:
        pattern (str): 正则表达式模式
        path (Optional[str], optional): 搜索路径。默认为 None
        glob (Optional[str], optional): glob 模式。默认为 None
        output_mode (str, optional): 输出模式。默认为 "files_with_matches"
        n (bool, optional): 是否显示行号。默认为 False
        C (int, optional): 上下文行数。默认为 0
        i (bool, optional): 是否忽略大小写。默认为 False
        head_limit (int, optional): 结果限制。默认为 100
        working_directory (Optional[str], optional): 工作目录。默认为 None
    
    Returns:
        Dict[str, Any]: 搜索结果
    """
    tool = Grep(working_directory=working_directory)
    return await tool.execute(
        pattern=pattern,
        path=path,
        glob=glob,
        output_mode=output_mode,
        n=n,
        C=C,
        i=i,
        head_limit=head_limit,
    )
