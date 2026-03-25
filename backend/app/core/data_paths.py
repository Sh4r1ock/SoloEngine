import os
from typing import Optional

class DataPaths:
    """统一数据路径管理模块。"""
    
    @staticmethod
    def get_project_root() -> str:
        """获取项目根目录。"""
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    
    @staticmethod
    def get_data_root() -> str:
        """获取data根目录。"""
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    
    @staticmethod
    def to_relative_path(absolute_path: str) -> str:
        r"""将绝对路径转换为相对于项目根目录的相对路径。

        Args:
            absolute_path: 绝对路径

        Returns:
            相对于项目根目录的相对路径，例如: \data\{user_id}\skills\{skill_name}
        """
        project_root = os.path.normpath(DataPaths.get_project_root())
        abs_path = os.path.normpath(absolute_path)
        rel_path = os.path.relpath(abs_path, project_root)
        if not rel_path.startswith('\\'):
            rel_path = '\\' + rel_path
        return rel_path

    @staticmethod
    def to_absolute_path(relative_path: str) -> str:
        r"""将相对于项目根目录的相对路径转换为绝对路径。

        Args:
            relative_path: 相对于项目根目录的相对路径，例如: \data\{user_id}\skills\{skill_name}

        Returns:
            绝对路径
        """
        project_root = os.path.normpath(DataPaths.get_project_root())
        rel_path = relative_path.replace('/', os.sep).replace('\\', os.sep)
        rel_path = rel_path.lstrip('\\')
        return os.path.abspath(os.path.join(project_root, rel_path))
    
    @staticmethod
    def get_user_dir(user_id: str) -> str:
        """获取用户根目录。"""
        return os.path.join(DataPaths.get_data_root(), user_id)
    
    @staticmethod
    def get_user_skills_dir(user_id: str) -> str:
        """获取用户Skills目录。"""
        return os.path.join(DataPaths.get_user_dir(user_id), "skills")
    
    @staticmethod
    def get_system_skills_dir() -> str:
        """获取系统Skills目录。"""
        return DataPaths.get_user_skills_dir("system")
    
    @staticmethod
    def get_user_agenticflow_dir(user_id: str) -> str:
        """获取用户AgenticFlow目录。"""
        return os.path.join(DataPaths.get_user_dir(user_id), "agenticflow")
    
    @staticmethod
    def get_system_agenticflow_dir() -> str:
        """获取系统AgenticFlow目录。"""
        return DataPaths.get_user_agenticflow_dir("system")
    
    @staticmethod
    def get_user_mcp_servers_dir(user_id: str) -> str:
        """获取用户MCP Servers目录。"""
        return os.path.join(DataPaths.get_user_dir(user_id), "mcp_servers")
    
    @staticmethod
    def get_system_mcp_servers_dir() -> str:
        """获取系统MCP Servers目录。"""
        return DataPaths.get_user_mcp_servers_dir("system")
    
    @staticmethod
    def ensure_dir(path: str) -> None:
        """确保目录存在。"""
        os.makedirs(path, exist_ok=True)
