# -*- coding: utf-8 -*-
"""
获取诊断工具模块。

@file get_diagnostics.py
@description 获取 VS Code 语言诊断信息
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 获取语言服务器诊断信息
- 支持按文件 URI 过滤
- 返回错误、警告等信息

诊断类型：
    - error: 错误
    - warning: 警告
    - information: 信息
    - hint: 提示

使用场景：
    - 检查代码错误
    - 获取类型检查结果
    - 查看 Linter 警告

状态: ✅ 模块初始化完成
"""

import os
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from enum import Enum


class DiagnosticSeverity(Enum):
    """诊断严重程度枚举。"""
    ERROR = "error"
    WARNING = "warning"
    INFORMATION = "information"
    HINT = "hint"


@dataclass
class Diagnostic:
    """
    诊断信息数据类。
    
    Attributes:
        uri (str): 文件 URI。
        severity (DiagnosticSeverity): 严重程度。
        message (str): 诊断消息。
        range_start_line (int): 起始行号（从 0 开始）。
        range_start_character (int): 起始列号。
        range_end_line (int): 结束行号。
        range_end_character (int): 结束列号。
        source (Optional[str]): 诊断来源。
        code (Optional[str]): 诊断代码。
    """
    uri: str
    severity: DiagnosticSeverity
    message: str
    range_start_line: int = 0
    range_start_character: int = 0
    range_end_line: int = 0
    range_end_character: int = 0
    source: Optional[str] = None
    code: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式。"""
        return {
            "uri": self.uri,
            "severity": self.severity.value,
            "message": self.message,
            "range": {
                "start": {
                    "line": self.range_start_line,
                    "character": self.range_start_character,
                },
                "end": {
                    "line": self.range_end_line,
                    "character": self.range_end_character,
                },
            },
            "source": self.source,
            "code": self.code,
        }


class GetDiagnostics:
    """
    获取诊断工具。
    
    获取 VS Code 语言服务器的诊断信息。
    
    功能：
        1. 获取所有文件的诊断信息
        2. 按文件 URI 过滤诊断
        3. 返回错误、警告、信息和提示
    
    诊断来源：
        - TypeScript/JavaScript: tsserver
        - Python: Pylance, mypy, ruff
        - 其他语言: 各自的语言服务器
    
    Example:
        >>> # 获取所有诊断
        >>> result = await GetDiagnostics.execute()
        >>> for diag in result["diagnostics"]:
        ...     print(f"{diag['severity']}: {diag['message']}")
        
        >>> # 获取特定文件的诊断
        >>> result = await GetDiagnostics.execute(
        ...     uri="file:///path/to/file.py"
        ... )
    """
    
    _diagnostics_cache: Dict[str, List[Diagnostic]] = {}
    
    @classmethod
    async def execute(
        cls,
        uri: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        获取语言诊断信息。
        
        Args:
            uri (Optional[str]): 文件 URI。
                如果指定，只返回该文件的诊断信息。
                如果未指定，返回所有文件的诊断信息。
                默认为 None。
        
        Returns:
            Dict[str, Any]: 诊断信息。
                - diagnostics (List[Dict]): 诊断列表
                - count (int): 诊断总数
                - error_count (int): 错误数量
                - warning_count (int): 警告数量
                - information_count (int): 信息数量
                - hint_count (int): 提示数量
        
        Example:
            >>> result = await GetDiagnostics.execute()
            >>> print(f"发现 {result['error_count']} 个错误")
            
            >>> result = await GetDiagnostics.execute(
            ...     uri="file:///path/to/file.py"
            ... )
        """
        if uri:
            diagnostics = cls._get_diagnostics_for_uri(uri)
        else:
            diagnostics = cls._get_all_diagnostics()
        
        error_count = sum(1 for d in diagnostics if d.severity == DiagnosticSeverity.ERROR)
        warning_count = sum(1 for d in diagnostics if d.severity == DiagnosticSeverity.WARNING)
        information_count = sum(1 for d in diagnostics if d.severity == DiagnosticSeverity.INFORMATION)
        hint_count = sum(1 for d in diagnostics if d.severity == DiagnosticSeverity.HINT)
        
        return {
            "diagnostics": [d.to_dict() for d in diagnostics],
            "count": len(diagnostics),
            "error_count": error_count,
            "warning_count": warning_count,
            "information_count": information_count,
            "hint_count": hint_count,
            "metadata": {
                "resources_used": [uri] if uri else []
            }
        }
    
    @classmethod
    def _get_all_diagnostics(cls) -> List[Diagnostic]:
        """
        获取所有诊断信息。
        
        Returns:
            List[Diagnostic]: 所有诊断信息列表。
        """
        all_diagnostics = []
        for file_diagnostics in cls._diagnostics_cache.values():
            all_diagnostics.extend(file_diagnostics)
        return all_diagnostics
    
    @classmethod
    def _get_diagnostics_for_uri(cls, uri: str) -> List[Diagnostic]:
        """
        获取指定文件的诊断信息。
        
        Args:
            uri (str): 文件 URI。
        
        Returns:
            List[Diagnostic]: 该文件的诊断信息列表。
        """
        return cls._diagnostics_cache.get(uri, [])
    
    @classmethod
    def update_diagnostics(
        cls,
        uri: str,
        diagnostics: List[Dict[str, Any]],
    ) -> None:
        """
        更新诊断缓存。
        
        此方法由 VS Code 扩展调用，用于更新诊断信息。
        
        Args:
            uri (str): 文件 URI。
            diagnostics (List[Dict]): 诊断信息列表。
        """
        parsed_diagnostics = []
        for diag in diagnostics:
            severity = cls._parse_severity(diag.get("severity", 1))
            range_info = diag.get("range", {})
            start = range_info.get("start", {})
            end = range_info.get("end", {})
            
            parsed_diagnostics.append(Diagnostic(
                uri=uri,
                severity=severity,
                message=diag.get("message", ""),
                range_start_line=start.get("line", 0),
                range_start_character=start.get("character", 0),
                range_end_line=end.get("line", 0),
                range_end_character=end.get("character", 0),
                source=diag.get("source"),
                code=str(diag.get("code")) if diag.get("code") else None,
            ))
        
        cls._diagnostics_cache[uri] = parsed_diagnostics
    
    @classmethod
    def clear_diagnostics(cls, uri: Optional[str] = None) -> None:
        """
        清除诊断缓存。
        
        Args:
            uri (Optional[str]): 文件 URI。
                如果指定，只清除该文件的诊断。
                如果未指定，清除所有诊断。
        """
        if uri:
            cls._diagnostics_cache.pop(uri, None)
        else:
            cls._diagnostics_cache.clear()
    
    @staticmethod
    def _parse_severity(severity: int) -> DiagnosticSeverity:
        """
        解析诊断严重程度。
        
        VS Code 使用数字表示严重程度：
        - 0: Error
        - 1: Warning
        - 2: Information
        - 3: Hint
        
        Args:
            severity (int): 严重程度数字。
        
        Returns:
            DiagnosticSeverity: 严重程度枚举值。
        """
        severity_map = {
            0: DiagnosticSeverity.ERROR,
            1: DiagnosticSeverity.WARNING,
            2: DiagnosticSeverity.INFORMATION,
            3: DiagnosticSeverity.HINT,
        }
        return severity_map.get(severity, DiagnosticSeverity.INFORMATION)
    
    @staticmethod
    def get_tool_spec() -> Dict[str, Any]:
        """
        获取工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范字典，用于注册到工具执行器。
        """
        return {
            "name": "GetDiagnostics",
            "description": "获取 VS Code 语言诊断信息。返回错误、警告、信息和提示。",
            "parameters": {
                "uri": {
                    "type": "string",
                    "description": "文件 URI（可选）。如果指定，只返回该文件的诊断信息。",
                    "required": False,
                },
            },
        }
