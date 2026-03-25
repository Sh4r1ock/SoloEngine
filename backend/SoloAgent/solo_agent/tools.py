"""
工具注册表
注册和管理所有可用工具
"""
import asyncio
import logging
from typing import Dict, Any, List, Optional, Type, Callable

logger = logging.getLogger(__name__)


class ToolRegistry:
    """工具注册表
    
    管理所有可用工具的注册和获取
    """
    
    _tools: Dict[str, Any] = {}
    _configs: Dict[str, Dict[str, Any]] = {}
    
    @classmethod
    def register(cls, name: str, tool: Any, config: Dict[str, Any] = None) -> None:
        """注册工具"""
        cls._tools[name] = tool
        if config:
            cls._configs[name] = config
        logger.debug(f"Registered tool: {name}")
    
    @classmethod
    def get_tool(cls, name: str) -> Optional[Any]:
        """获取工具实例
        
        支持大小写不敏感的工具名称查找
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
        """获取工具配置（用于 ToolkitExecutor）"""
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
        """列出所有已注册的工具名称"""
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
            
            "TodoWrite": ("plugins.tools.task.todo_write", "TodoWrite"),
            "AskUserQuestion": ("plugins.tools.task.ask_user_question", "AskUserQuestion"),
            "OpenPreview": ("plugins.tools.other.open_preview", "OpenPreviewTool"),
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


def create_task_tool_config(agent: "SoloAgent") -> Dict[str, Any]:
    """创建 Task 工具配置，用于调用子 Agent
    
    Args:
        agent: SoloAgent 实例，包含 subagents 信息
    
    Returns:
        Dict[str, Any]: Task 工具配置
    """
    
    class SubAgentTaskTool:
        """子 Agent 调用工具 - 基于 SubAgentInfo 结构"""
        
        def __init__(self, parent_agent):
            self.parent_agent = parent_agent
            self._subagents_info: Dict[str, Dict[str, Any]] = {}
            self._name_to_id: Dict[str, str] = {}
            
            for sa in parent_agent.config.subagents:
                name = sa.get("subagent_name")
                subagent_id = sa.get("subagent_id")
                description = sa.get("description", "")
                if name:
                    self._subagents_info[name] = {
                        "subagent_name": name,
                        "description": description,
                        "subagent_id": subagent_id or name
                    }
                    self._name_to_id[name] = subagent_id or name
        
        def get_tool_spec(self) -> Dict[str, Any]:
            names = list(self._subagents_info.keys())
            xml = self._format_available_subagents_xml()
            
            return {
                "name": "Task",
                "description": f"""Launch a agent and assign a task to it.

Available agents:
{xml}

When to use this tool:
  - When the task requires specialized capabilities
  - When you need to delegate a task to a subagent

IMPORTANT: When a subagent is relevant, invoke this tool IMMEDIATELY.""",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "subagent_name": {
                            "type": "string",
                            "description": "The subagent name to call",
                            "enum": names
                        },
                        "task": {
                            "type": "string",
                            "description": "Detailed task description"
                        }
                    },
                    "required": ["subagent_name", "task"]
                }
            }
        
        def _format_available_subagents_xml(self) -> str:
            lines = ["<available_subagents>"]
            for name, info in self._subagents_info.items():
                lines.append(f"- {name}: {info.get('description', '')}")
            lines.append("</available_subagents>")
            return "\n".join(lines)
        
        async def execute(self, subagent_name: str, task: str) -> Dict[str, Any]:
            subagent_id = self._name_to_id.get(subagent_name)
            if not subagent_id:
                return {"success": False, "error": f"Subagent '{subagent_name}' not found"}
            
            subagent = self.parent_agent.get_subagent(subagent_id)
            if not subagent:
                for agent in self.parent_agent._subagents.values():
                    if agent.config.name == subagent_name:
                        subagent = agent
                        break
            
            if not subagent:
                return {"success": False, "error": f"Subagent instance '{subagent_id}' not found"}
            
            if not subagent._initialized:
                await subagent.initialize()
            
            if hasattr(self.parent_agent, '_stream_callback') and self.parent_agent._stream_callback:
                subagent.set_stream_callback(self.parent_agent._stream_callback)
            
            if hasattr(self.parent_agent, '_stream_callback') and self.parent_agent._stream_callback:
                try:
                    self.parent_agent._stream_callback(
                        {"type": "subagent_start", "subagent_id": subagent_id, "subagent_name": subagent_name},
                        agent_id=subagent_id,
                        agent_name=subagent_name
                    )
                except Exception as e:
                    logger.warning(f"Failed to send subagent_start event: {e}")
            
            result = await subagent.reply(task)
            
            if hasattr(self.parent_agent, '_stream_callback') and self.parent_agent._stream_callback:
                try:
                    self.parent_agent._stream_callback(
                        {"type": "subagent_complete", "subagent_id": subagent_id, "subagent_name": subagent_name},
                        agent_id=subagent_id,
                        agent_name=subagent_name
                    )
                except Exception as e:
                    logger.warning(f"Failed to send subagent_complete event: {e}")
            
            if hasattr(result, 'content'):
                content = result.content
            elif isinstance(result, dict):
                content = result.get('content', str(result))
            else:
                content = str(result)
            
            return {
                "success": True,
                "subagent_name": subagent_name,
                "result": content
            }
    
    tool = SubAgentTaskTool(agent)
    spec = tool.get_tool_spec()
    
    return {
        "name": spec["name"],
        "function": tool.execute,
        "description": spec["description"],
        "parameters": spec["parameters"],
    }


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
