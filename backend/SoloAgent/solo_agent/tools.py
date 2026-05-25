"""
SoloAgent机制-tools.py: 工具注册表，基于自动发现管理所有可用工具

@file tools.py
@description 实现工具注册表，通过__init__.py自动发现和管理所有可用工具
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块实现SoloAgent机制的工具注册表，提供以下功能：
- 从plugins/tools/__init__.py自动发现所有工具类
- 管理所有可用工具的注册和获取
- 支持大小写不敏感的工具名称查找
- 提供工具配置的存储和检索
- 支持动态spec工具（MCP/Skill/Task）的运行时数据标记

依赖:
- logging: 日志记录
- typing: 类型提示支持
"""
import logging
from typing import Dict, Any, List, Optional, Type

logger = logging.getLogger(__name__)


class ToolRegistry:
    """
    工具注册表类
    
    职责:
    - 从plugins/tools/__init__.py自动发现所有工具类
    - 管理所有可用工具的注册和获取
    - 支持大小写不敏感的工具名称查找
    - 提供工具配置的存储和检索
    
    属性:
        _tools (Dict[str, Any]): 工具实例字典
        _configs (Dict[str, Dict]): 工具配置字典
        _tool_classes (Dict[str, type]): 工具类字典
    
    注意：
        工具名称查找不区分大小写
    """
    
    _tools: Dict[str, Any] = {}
    _configs: Dict[str, Dict[str, Any]] = {}
    _tool_classes: Dict[str, Type] = {}
    
    @classmethod
    def register(cls, name: str, tool: Any, config: Dict[str, Any] = None) -> None:
        cls._tools[name] = tool
        if config:
            cls._configs[name] = config
        logger.debug(f"Registered tool: {name}")
    
    @classmethod
    def get_tool(cls, name: str) -> Optional[Any]:
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
    def get_tool_class(cls, name: str) -> Optional[Type]:
        if not cls._tool_classes:
            cls.discover_tools()
        return cls._tool_classes.get(name)
    
    @classmethod
    def list_tools(cls) -> List[str]:
        return list(cls._tools.keys())
    
    @classmethod
    def discover_tools(cls) -> None:
        if cls._tool_classes:
            return
        
        from ..plugins import tools as _tools_module
        
        for name in dir(_tools_module):
            attr = getattr(_tools_module, name)
            if (isinstance(attr, type)
                and hasattr(attr, 'get_tool_spec')
                and callable(getattr(attr, 'get_tool_spec'))
                and hasattr(attr, 'execute')):
                try:
                    instance = attr()
                    spec = instance.get_tool_spec()
                    tool_name = spec.get("name", name)
                    cls._tool_classes[tool_name] = attr
                    cls._tools[tool_name] = instance
                except Exception as e:
                    logger.warning(f"Failed to discover tool {name}: {e}")
        
        logger.info(f"Discovered {len(cls._tool_classes)} tools: {list(cls._tool_classes.keys())}")
    
    @classmethod
    def _create_tool(cls, name: str) -> Optional[Any]:
        if not cls._tool_classes:
            cls.discover_tools()
        
        if name not in cls._tool_classes:
            logger.warning(f"Unknown tool: {name}")
            return None
        
        tool_class = cls._tool_classes[name]
        try:
            return tool_class()
        except Exception as e:
            logger.error(f"Failed to create tool '{name}': {e}")
            return None
    
    @classmethod
    def _create_tool_config(cls, name: str, tool: Any) -> Optional[Dict[str, Any]]:
        spec = None
        
        if hasattr(tool, 'get_tool_spec'):
            try:
                spec_result = tool.get_tool_spec()
                if spec_result:
                    spec = spec_result
            except Exception as e:
                logger.debug(f"Could not get spec via get_tool_spec for '{name}': {e}")
        
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


def register_all_tools() -> None:
    ToolRegistry.discover_tools()
    for name in ToolRegistry._tool_classes:
        ToolRegistry.get_tool(name)
    logger.info(f"Registered {len(ToolRegistry.list_tools())} tools")
