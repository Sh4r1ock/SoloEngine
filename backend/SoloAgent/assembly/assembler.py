# -*- coding: utf-8 -*-
"""Agent assembler for SoloEngine."""

from typing import Optional, List, Dict, Any, Union
import inspect

from ..core.react_core import ReActCore
from ..core.interfaces import IMemory, IRAG, IToolExecutor, IMCPClient, IPlanNotebook, ITTSModel
from ..plugins.memory import VectorMemoryPlugin, BlackholeMemoryPlugin
from ..plugins.rag import KnowledgeBaseRAGPlugin
from ..plugins.tools import ToolkitExecutor
from ..plugins.mcp import SimpleMCPClient
from ..model import ChatModelBase
from ..formatter import FormatterBase


class ReActAgent:
    """ReAct agent assembler - main user interface."""
    
    def __init__(
        self,
        name: str,
        model: ChatModelBase,
        formatter: FormatterBase,
        system_prompt: str,
        # ---- Flexible plugin configuration ----
        memory_config: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IMemory]] = None,
        rag_config: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IRAG]] = None,
        tool_configs: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IToolExecutor]] = None,
        mcp_configs: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], List[IMCPClient]]] = None,
        plan_config: Optional[Union[None, Dict[str, Any], IPlanNotebook]] = None,
        tts_config: Optional[Union[None, Dict[str, Any], ITTSModel]] = None,
        # ---- Backward compatibility switches ----
        enable_memory: bool = True,
        enable_rag: bool = False,
        enable_tools: bool = False,
        # ---- Other configuration ----
        print_hint_msg: bool = False,
        max_iters: int = 10,
    ) -> None:
        """Initialize ReAct agent assembler.
        
        Flexible plugin configuration:
        - None: Disable the feature completely
        - dict: Enable single instance with this configuration
        - list[dict]: Enable multiple instances
        - plugin instance: Use the provided instance directly
        
        Examples:
            # Single memory configuration
            memory_config={"type": "vector", "max_size": 1000}
            
            # Multiple RAG knowledge bases
            rag_config=[
                {"type": "knowledge_base", "path": "data1"},
                {"type": "knowledge_base", "path": "data2"}
            ]
            
            # Multiple MCP clients
            mcp_configs=[
                {"type": "stdio", "command": "mcp-server1"},
                {"type": "http", "url": "http://localhost:8000"}
            ]
        """
        self.name = name
        
        # Process memory configuration
        memory_plugin = self._process_memory_config(
            memory_config, enable_memory
        )
        
        # Process RAG configuration
        rag_plugin = self._process_rag_config(rag_config, enable_rag)
        
        # Process tools configuration (including MCP)
        tool_executor = self._process_tools_config(
            tool_configs, mcp_configs, enable_tools
        )
        
        # Process plan configuration
        plan_plugin = self._process_plan_config(plan_config)
        
        # Process TTS configuration
        tts_plugin = self._process_tts_config(tts_config)
        
        # Create microkernel with assembled plugins
        self._core = ReActCore(
            name=name,
            model=model,
            formatter=formatter,
            system_prompt=system_prompt,
            memory=memory_plugin,
            rag=rag_plugin,
            tool_executor=tool_executor,
            max_iters=max_iters,
            print_hint_msg=print_hint_msg,
        )
        
        # Store additional plugins
        self._plan_plugin = plan_plugin
        self._tts_plugin = tts_plugin
    
    async def reply(self, message: str) -> str:
        """Agent reply interface."""
        # For now, delegate to core
        # In a full implementation, this would handle additional features
        # like plan integration, TTS, etc.
        response = await self._core.reply(message)
        return response.get_text_content() or str(response.content)
    
    def _process_memory_config(
        self,
        config: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IMemory]],
        enable_switch: bool,
    ) -> Optional[IMemory]:
        """Process memory configuration."""
        # If config is provided, use it (regardless of enable_switch)
        if config is not None:
            if config is None:
                return None
            elif isinstance(config, IMemory):
                return config
            elif isinstance(config, dict):
                return VectorMemoryPlugin(config)
            elif isinstance(config, list):
                # For now, use first config only
                # In a real implementation, you might combine multiple memories
                if config:
                    return VectorMemoryPlugin(config[0])
                return None
            else:
                raise TypeError(f"Unsupported memory config type: {type(config)}")
        
        # If no config but enable_switch is True, use default
        if enable_switch:
            return VectorMemoryPlugin()
        
        # Otherwise, disable memory
        return None
    
    def _process_rag_config(
        self,
        config: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IRAG]],
        enable_switch: bool,
    ) -> Optional[IRAG]:
        """Process RAG configuration."""
        if config is not None:
            if config is None:
                return None
            elif isinstance(config, IRAG):
                return config
            elif isinstance(config, dict):
                return KnowledgeBaseRAGPlugin(config)
            elif isinstance(config, list):
                # For multiple knowledge bases, create a composite RAG plugin
                # For now, use first config only
                if config:
                    return KnowledgeBaseRAGPlugin(config[0])
                return None
            else:
                raise TypeError(f"Unsupported RAG config type: {type(config)}")
        
        if enable_switch:
            return KnowledgeBaseRAGPlugin()
        
        return None
    
    def _process_tools_config(
        self,
        tool_configs: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IToolExecutor]],
        mcp_configs: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], List[IMCPClient]]],
        enable_switch: bool,
    ) -> Optional[IToolExecutor]:
        """Process tools configuration."""
        # Collect all tool configurations
        all_tool_configs = []
        
        # Process regular tool configs
        if tool_configs is not None:
            if tool_configs is None:
                pass  # Explicit None means no tools
            elif isinstance(tool_configs, IToolExecutor):
                return tool_configs  # Already an executor
            elif isinstance(tool_configs, dict):
                all_tool_configs.append(tool_configs)
            elif isinstance(tool_configs, list):
                all_tool_configs.extend(tool_configs)
            else:
                raise TypeError(f"Unsupported tool configs type: {type(tool_configs)}")
        
        # Process MCP configs (would be integrated here in a real implementation)
        if mcp_configs is not None:
            # In a real implementation, MCP configs would be converted to tool configs
            # For now, we'll just log a warning if MCP configs are provided
            import logging
            logging.warning("MCP configuration provided but not yet fully implemented")
        
        # If no explicit config but enable_switch is True, use default
        if not all_tool_configs and enable_switch:
            # Add some default tools
            all_tool_configs = [
                {
                    "name": "search",
                    "function": self._default_search_tool,
                    "description": "Search for information",
                    "parameters": {
                        "query": {"type": "string", "required": True},
                        "limit": {"type": "integer", "required": False, "default": 5},
                    }
                },
                {
                    "name": "calculator",
                    "function": self._default_calculator_tool,
                    "description": "Evaluate mathematical expressions",
                    "parameters": {
                        "expression": {"type": "string", "required": True},
                    }
                }
            ]
        
        if all_tool_configs:
            return ToolkitExecutor(all_tool_configs)
        
        return None
    
    def _process_plan_config(
        self,
        config: Optional[Union[None, Dict[str, Any], IPlanNotebook]],
    ) -> Optional[IPlanNotebook]:
        """Process plan configuration."""
        # Simplified implementation
        return None
    
    def _process_tts_config(
        self,
        config: Optional[Union[None, Dict[str, Any], ITTSModel]],
    ) -> Optional[ITTSModel]:
        """Process TTS configuration."""
        # Simplified implementation
        return None
    
    async def _default_search_tool(self, query: str, limit: int = 5) -> Dict[str, Any]:
        """Default search tool."""
        return {
            "content": f"Search results for '{query}' (limit: {limit})",
            "success": True,
        }
    
    async def _default_calculator_tool(self, expression: str) -> Dict[str, Any]:
        """Default calculator tool."""
        try:
            # Very basic evaluation (in real implementation, use a safe evaluator)
            result = eval(expression, {"__builtins__": {}})
            return {
                "content": f"{expression} = {result}",
                "success": True,
            }
        except Exception as e:
            return {
                "content": f"Error evaluating expression: {e}",
                "success": False,
                "error_message": str(e),
            }