# -*- coding: utf-8 -*-
"""
SoloEngine : 文件工具基类模块，提供文件操作工具的公共功能

@file base.py
@description 提供文件操作工具的公共功能
@author Sh4rlock
@date 2026-04-09

功能描述：
- 路径验证（必须是绝对路径）
- 编码处理（UTF-8）
- 错误处理

状态: ✅ 模块初始化完成
"""

import os
from contextvars import ContextVar

from ....exception import AgentOrientedExceptionBase

_file_tool_working_dir: ContextVar[str] = ContextVar('_file_tool_working_dir', default='')


def set_file_tool_working_dir(working_dir: str) -> None:
    _file_tool_working_dir.set(working_dir)


def get_file_tool_working_dir() -> str:
    return _file_tool_working_dir.get()


class FileToolError(AgentOrientedExceptionBase):
    pass


class BaseFileTool:

    @staticmethod
    def validate_absolute_path(path: str) -> str:
        if not os.path.isabs(path):
            work_dir = get_file_tool_working_dir() or os.getcwd()
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
