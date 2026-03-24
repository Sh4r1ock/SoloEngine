# -*- coding: utf-8 -*-
"""
文件工具基类模块。

@file base.py
@description 提供文件操作工具的公共功能
@author SoloEngine Team
@date 2026-03-02

功能描述：
- 路径验证（必须是绝对路径）
- 编码处理（UTF-8）
- 错误处理

状态: ✅ 模块初始化完成
"""

import os
from typing import Dict, Any, Optional

from ....exception import AgentOrientedExceptionBase


class FileToolError(AgentOrientedExceptionBase):
    """文件工具错误基类"""
    pass


class BaseFileTool:
    """
    文件工具基类。
    
    提供文件操作工具的公共功能，包括路径验证、目录创建等。
    
    核心功能：
        1. 路径验证：确保路径为绝对路径
        2. 目录创建：自动创建父目录
        3. 错误处理：统一的异常处理
    
    Example:
        >>> class MyFileTool(BaseFileTool):
        ...     def execute(self, path: str):
        ...         self.validate_absolute_path(path)
        ...         self.ensure_directory_exists(path)
        ...         # 执行文件操作
    """
    
    @staticmethod
    def validate_absolute_path(path: str) -> str:
        """
        验证路径，如果是相对路径则结合当前工作目录转换为绝对路径。
        
        Args:
            path (str): 要验证的路径。
        
        Returns:
            str: 绝对路径。
        
        Raises:
            FileToolError: 当路径无效时抛出。
        
        Example:
            >>> BaseFileTool.validate_absolute_path("/home/user/file.txt")  # Linux
            >>> BaseFileTool.validate_absolute_path("C:\\Users\\file.txt")  # Windows
            >>> BaseFileTool.validate_absolute_path("relative/path")  # 转换为绝对路径
        """
        if not os.path.isabs(path):
            work_dir = os.getcwd()
            path = os.path.join(work_dir, path)
            path = os.path.normpath(path)
        return path
    
    @staticmethod
    def ensure_directory_exists(file_path: str) -> None:
        """
        确保文件所在目录存在。
        
        如果目录不存在，会自动创建所有必要的父目录。
        
        Args:
            file_path (str): 文件路径。
        
        Note:
            使用 os.makedirs 的 exist_ok=True 参数，
            避免目录已存在时抛出异常。
        """
        directory = os.path.dirname(file_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
    
    @staticmethod
    def file_exists(path: str) -> bool:
        """
        检查文件是否存在。
        
        Args:
            path (str): 文件路径。
        
        Returns:
            bool: 文件存在返回 True，否则返回 False。
        """
        return os.path.isfile(path)
    
    @staticmethod
    def directory_exists(path: str) -> bool:
        """
        检查目录是否存在。
        
        Args:
            path (str): 目录路径。
        
        Returns:
            bool: 目录存在返回 True，否则返回 False。
        """
        return os.path.isdir(path)
