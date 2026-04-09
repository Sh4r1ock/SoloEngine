"""
SoloAgent机制-tools.py: 工具注册表，注册和管理所有可用工具

@file tools.py
@description 实现工具注册表，管理所有可用工具的注册、获取和配置
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块实现SoloAgent机制的工具注册表，提供以下功能：
- 管理所有可用工具的注册和获取
- 支持大小写不敏感的工具名称查找
- 提供工具配置的存储和检索
- 支持动态工具创建
- 提供工具列表查询功能

依赖:
- asyncio: 异步操作支持
- logging: 日志记录
- typing: 类型提示支持

使用示例:
- ToolRegistry.register("read", ReadTool)
- tool = ToolRegistry.get_tool("read")
- tools = ToolRegistry.list_tools()
"""
import asyncio
import logging
from typing import Dict, Any, List, Optional, Type, Callable

logger = logging.getLogger(__name__)


class ToolRegistry:
    """
    工具注册表类
    
    职责:
    - 管理所有可用工具的注册和获取
    - 支持大小写不敏感的工具名称查找
    - 提供工具配置的存储和检索
    - 支持动态工具创建
    
    属性:
        _tools (Dict[str, Any]): 工具实例字典
        _configs (Dict[str, Dict]): 工具配置字典
    
    注意：
        工具名称查找不区分大小写
    """
    
    _tools: Dict[str, Any] = {}
    _configs: Dict[str, Dict[str, Any]] = {}
    
    @classmethod
    def register(cls, name: str, tool: Any, config: Dict[str, Any] = None) -> None:
        """
        注册工具
        
        Args:
            name: 工具名称
            tool: 工具实例或类
            config: 工具配置（可选）
        """
        cls._tools[name] = tool
        if config:
            cls._configs[name] = config
        logger.debug(f"Registered tool: {name}")
    
    @classmethod
    def get_tool(cls, name: str) -> Optional[Any]:
        """
        获取工具实例
        
        支持大小写不敏感的工具名称查找。
        如果工具不存在，尝试动态创建。
        
        Args:
            name: 工具名称
        
        Returns:
            Optional[Any]: 工具实例，不存在则返回None
        """
        if name in cls._tools:
            return cls._tools[name]
        
        name_lower = name.lower()
        for key in cls._tools:
            if key.lower() == name_lower:
                return cls._tools[key]
        
        tool = cls._create_tool(name)
        if tool:
            cls._tools[name] = tool
        return tool
    
    @classmethod
    def get_tool_config(cls, name: str) -> Optional[Dict[str, Any]]:
        """
        获取工具配置（用于ToolkitExecutor）
        
        Args:
            name: 工具名称
        
        Returns:
            Optional[Dict[str, Any]]: 工具配置字典，不存在则返回None
        """
        if name in cls._configs:
            return cls._configs[name]
        
        tool = cls.get_tool(name)
        if tool:
            config = cls._create_tool_config(name, tool)
            if config:
                cls._configs[name] = config
            return config
        return None
    
    @classmethod
    def list_tools(cls) -> List[str]:
        """
        列出所有已注册的工具名称
        
        Returns:
            List[str]: 工具名称列表
        """
        return list(cls._tools.keys())
    
    @classmethod
    def _get_tool_module_path(cls, base_path: str) -> str:
        """获取工具模块路径，支持多种导入方式"""
        import sys
        
        possible_paths = [
            f"SoloAgent.{base_path}",
            f"backend.SoloAgent.{base_path}",
        ]
        
        for path in possible_paths:
            try:
                import importlib
                importlib.import_module(path)
                return path
            except ImportError:
                continue
        
        return f"SoloAgent.{base_path}"
    
    @classmethod
    def _create_tool(cls, name: str) -> Optional[Any]:
        """创建工具实例
        
        支持大小写不敏感的工具名称查找
        """
        tool_map = {
            "Read": ("plugins.tools.file.read", "Read"),
            "Write": ("plugins.tools.file.write", "Write"),
            "DeleteFile": ("plugins.tools.file.delete_file", "DeleteFile"),
            "LS": ("plugins.tools.file.ls", "LS"),
            "SearchReplace": ("plugins.tools.file.search_replace", "SearchReplace"),
            
            "Grep": ("plugins.tools.search.grep", "Grep"),
            "Glob": ("plugins.tools.search.glob", "Glob"),
            "SearchCodebase": ("plugins.tools.search.search_codebase", "SearchCodebase"),
            
            "RunCommand": ("plugins.tools.command.run_command", "RunCommand"),
            "CheckCommandStatus": ("plugins.tools.command.check_command_status", "CheckCommandStatus"),
            "StopCommand": ("plugins.tools.command.stop_command", "StopCommand"),
            "GetDiagnostics": ("plugins.tools.command.get_diagnostics", "GetDiagnostics"),
            
            "WebFetch": ("plugins.tools.network.web_fetch", "WebFetch"),
            "WebSearch": ("plugins.tools.network.web_search", "WebSearch"),
            
            "Skill": ("plugins.tools.agent.skill", "SkillTool"),
            "Task": ("plugins.tools.agent.task", "TaskTool"),
            "MCP": ("plugins.tools.agent.mcp", "MCPTool"),
            
            "TodoWrite": ("plugins.tools.task.todo_write", "TodoWrite"),
            "AskUserQuestion": ("plugins.tools.task.ask_user_question", "AskUserQuestion"),
            "OpenPreview": ("plugins.tools.other.open_preview", "OpenPreviewTool"),
            "ExitPlanMode": ("plugins.tools.other.exit_plan_mode", "ExitPlanModeTool"),
        }
        
        if name not in tool_map:
            logger.warning(f"Unknown tool: {name}")
            return None
        
        base_path, class_name = tool_map[name]
        module_path = cls._get_tool_module_path(base_path)
        
        try:
            import importlib
            module = importlib.import_module(module_path)
            tool_class = getattr(module, class_name)
            tool_instance = tool_class()
            logger.info(f"Successfully created tool '{name}' from {module_path}.{class_name}")
            return tool_instance
        except Exception as e:
            logger.error(f"Failed to create tool '{name}': {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None
    
    @classmethod
    def _create_tool_config(cls, name: str, tool: Any) -> Optional[Dict[str, Any]]:
        """创建工具配置"""
        spec = None
        
        if hasattr(tool, 'get_tool_spec'):
            try:
                spec_result = tool.get_tool_spec()
                if spec_result:
                    if 'function' in spec_result:
                        spec = spec_result['function']
                    elif 'name' in spec_result:
                        spec = spec_result
            except Exception as e:
                logger.debug(f"Could not get spec via get_tool_spec for '{name}': {e}")
        
        if spec is None and hasattr(tool, 'spec'):
            spec = tool.spec
        
        if spec is None:
            spec = getattr(tool, 'get_spec', lambda: None)()
        
        if not spec:
            logger.warning(f"No spec found for tool '{name}'")
            return None
        
        execute_method = getattr(tool, 'execute', None)
        if execute_method is None:
            logger.warning(f"Tool '{name}' has no execute method")
            return None
        
        return {
            "name": spec.get("name", name),
            "function": execute_method,
            "description": spec.get("description", ""),
            "parameters": spec.get("parameters", {}),
        }
    
    @classmethod
    def _get_tool_spec_from_module(cls, name: str) -> Optional[Dict[str, Any]]:
        """从模块获取工具规范"""
        spec_functions = {
            "Read": ("plugins.tools.file.read", "get_read_tool_spec"),
            "Write": ("plugins.tools.file.write", "get_write_tool_spec"),
            "DeleteFile": ("plugins.tools.file.delete_file", "get_delete_file_tool_spec"),
            "LS": ("plugins.tools.file.ls", "get_ls_tool_spec"),
            "SearchReplace": ("plugins.tools.file.search_replace", "get_search_replace_tool_spec"),
            "Grep": ("plugins.tools.search.grep", "get_grep_tool_spec"),
            "Glob": ("plugins.tools.search.glob", "get_glob_tool_spec"),
            "SearchCodebase": ("plugins.tools.search.search_codebase", "get_search_codebase_tool_spec"),
            "RunCommand": ("plugins.tools.command.run_command", "get_run_command_tool_spec"),
            "CheckCommandStatus": ("plugins.tools.command.check_command_status", "get_check_command_status_tool_spec"),
            "StopCommand": ("plugins.tools.command.stop_command", "get_stop_command_tool_spec"),
            "GetDiagnostics": ("plugins.tools.command.get_diagnostics", "get_get_diagnostics_tool_spec"),
            "WebFetch": ("plugins.tools.network.web_fetch", "get_web_fetch_tool_spec"),
            "WebSearch": ("plugins.tools.network.web_search", "get_web_search_tool_spec"),
            "Skill": ("plugins.tools.agent.skill", "get_skill_tool_spec"),
            "Task": ("plugins.tools.agent.task", "get_task_tool_spec"),
            "TodoWrite": ("plugins.tools.task.todo_write", "get_todo_write_tool_spec"),
            "AskUserQuestion": ("plugins.tools.task.ask_user_question", "get_ask_user_question_tool_spec"),
            "OpenPreview": ("plugins.tools.other.open_preview", "get_open_preview_tool_spec"),
        }
        
        if name not in spec_functions:
            return None
        
        base_path, func_name = spec_functions[name]
        module_path = cls._get_tool_module_path(base_path)
        
        try:
            import importlib
            module = importlib.import_module(module_path)
            spec_func = getattr(module, func_name)
            return spec_func()
        except Exception as e:
            logger.debug(f"Could not get spec from module for '{name}': {e}")
            return None


def register_all_tools() -> None:
    """注册所有工具"""
    tool_names = [
        "Read", "Write", "DeleteFile", "LS", "SearchReplace",
        "Grep", "Glob", "SearchCodebase",
        "RunCommand", "CheckCommandStatus", "StopCommand", "GetDiagnostics",
        "WebFetch", "WebSearch",
        "Skill", "Task",
        "TodoWrite", "AskUserQuestion", "OpenPreview",
    ]
    
    for name in tool_names:
        ToolRegistry.get_tool(name)
    
    logger.info(f"Registered {len(ToolRegistry.list_tools())} tools")
