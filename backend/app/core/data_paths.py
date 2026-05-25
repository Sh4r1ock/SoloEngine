# -*- coding: utf-8 -*-
"""
SoloEngine : 统一数据路径管理模块

@file data_paths.py
@description 统一的数据路径解析和生成逻辑
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供统一数据路径管理功能，包括：
    - 项目根目录获取
    - 相对路径与绝对路径转换
    - 用户和系统目录结构路径生成

依赖:
    - os: 操作系统接口
    - typing.Optional: 可选类型

使用示例:
    - from app.core.data_paths import DataPaths
    - root = DataPaths.get_project_root()
"""

import os

class DataPaths:
    """
    统一数据路径管理模块
    
    职责:
        - 提供项目根目录和数据目录路径
        - 支持相对路径与绝对路径转换
        - 生成用户和系统目录结构路径
    
    属性:
        无（纯静态方法类）
    
    示例:
        >>> root = DataPaths.get_project_root()
        >>> user_dir = DataPaths.get_user_dir("user_123")
    """
    
    @staticmethod
    def get_project_root() -> str:
        """
        获取项目根目录
        
        Returns:
            项目根目录的绝对路径
            
        Example:
            >>> root = DataPaths.get_project_root()
        """
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    
    @staticmethod
    def get_data_root() -> str:
        """
        获取data根目录
        
        Returns:
            data目录的绝对路径
            
        Example:
            >>> data_root = DataPaths.get_data_root()
        """
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    
    @staticmethod
    def to_relative_path(absolute_path: str) -> str:
        """
        将绝对路径转换为相对于项目根目录的相对路径

        Args:
            absolute_path: 绝对路径

        Returns:
            相对于项目根目录的相对路径，例如: \\data\\{user_id}\\skills\\{skill_name}
            
        Example:
            >>> rel = DataPaths.to_relative_path("/path/to/project/data/user/skill")
        """
        project_root = os.path.normpath(DataPaths.get_project_root())
        abs_path = os.path.normpath(absolute_path)
        data_root = os.path.normpath(DataPaths.get_data_root())

        if abs_path.startswith(data_root):
            rel_path = abs_path[len(project_root):]
        else:
            rel_path = os.path.relpath(abs_path, project_root)

        if not rel_path.startswith('\\'):
            rel_path = '\\' + rel_path

        rel_path = rel_path.replace('..\\', '').replace('../', '')
        while '\\\\' in rel_path:
            rel_path = rel_path.replace('\\\\', '\\')

        return rel_path

    @staticmethod
    def to_absolute_path(relative_path: str) -> str:
        """
        将相对于项目根目录的相对路径转换为绝对路径

        Args:
            relative_path: 相对于项目根目录的相对路径，例如: \\data\\{user_id}\\skills\\{skill_name}

        Returns:
            绝对路径
            
        Example:
            >>> abs_path = DataPaths.to_absolute_path("\\data\\user\\skill")
        """
        project_root = os.path.normpath(DataPaths.get_project_root())
        rel_path = relative_path.replace('/', os.sep).replace('\\', os.sep)
        rel_path = rel_path.lstrip('\\')
        return os.path.abspath(os.path.join(project_root, rel_path))
    
    @staticmethod
    def get_user_dir(user_id: str) -> str:
        """
        获取用户根目录
        
        Args:
            user_id: 用户ID
            
        Returns:
            用户根目录路径
            
        Example:
            >>> user_dir = DataPaths.get_user_dir("user_123")
        """
        return os.path.join(DataPaths.get_data_root(), user_id)
    
    @staticmethod
    def get_user_skills_dir(user_id: str) -> str:
        """
        获取用户Skills目录
        
        Args:
            user_id: 用户ID
            
        Returns:
            用户Skills目录路径
            
        Example:
            >>> skills_dir = DataPaths.get_user_skills_dir("user_123")
        """
        return os.path.join(DataPaths.get_user_dir(user_id), "skills")
    
    @staticmethod
    def get_system_skills_dir() -> str:
        """
        获取系统Skills目录
        
        Returns:
            系统Skills目录路径
            
        Example:
            >>> system_skills = DataPaths.get_system_skills_dir()
        """
        return DataPaths.get_user_skills_dir("system")
    
    @staticmethod
    def get_user_mcp_servers_dir(user_id: str) -> str:
        """
        获取用户MCP Servers目录
        
        Args:
            user_id: 用户ID
            
        Returns:
            用户MCP Servers目录路径
            
        Example:
            >>> mcp_dir = DataPaths.get_user_mcp_servers_dir("user_123")
        """
        return os.path.join(DataPaths.get_user_dir(user_id), "mcp_servers")
    
    @staticmethod
    def get_system_mcp_servers_dir() -> str:
        """
        获取系统MCP Servers目录
        
        Returns:
            系统MCP Servers目录路径
            
        Example:
            >>> system_mcp = DataPaths.get_system_mcp_servers_dir()
        """
        return DataPaths.get_user_mcp_servers_dir("system")
    
    @staticmethod
    def get_config_dir() -> str:
        """
        获取配置目录
        
        Returns:
            配置目录路径
            
        Example:
            >>> config_dir = DataPaths.get_config_dir()
        """
        return os.path.join(DataPaths.get_data_root(), "config")
    
    @staticmethod
    def get_agent_presets_path() -> str:
        """
        获取Agent预设配置文件路径
        
        Returns:
            Agent预设配置文件路径
            
        Example:
            >>> presets_path = DataPaths.get_agent_presets_path()
        """
        return os.path.join(DataPaths.get_config_dir(), "agent_presets.json")
    
    @staticmethod
    def ensure_dir(path: str) -> None:
        """
        确保目录存在
        
        Args:
            path: 目录路径
            
        Example:
            >>> DataPaths.ensure_dir("/path/to/dir")
        """
        os.makedirs(path, exist_ok=True)
