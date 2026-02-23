# -*- coding: utf-8 -*-
"""Agent assembler for SoloEngine."""

from typing import Optional, List, Dict, Any, Union
import inspect
import logging

from ..core.react_core import ReActCore
from ..core.interfaces import IMemory, IRAG, IToolExecutor, IMCPClient, IPlanNotebook, ITTSModel
from ..plugins.memory import VectorMemoryPlugin, BlackholeMemoryPlugin
from ..plugins.rag import KnowledgeBaseRAGPlugin
from ..plugins.tools import ToolkitExecutor
from ..plugins.mcp import MCPClient, MCPServerConfig
from ..plugins.plan import PlanNotebookPlugin
from ..model import ChatModelBase
from ..formatter import FormatterBase

logger = logging.getLogger(__name__)


class ReActAgent:
    """ReAct agent assembler - main user interface."""
    
    def __init__(
        self,
        name: str,
        model: ChatModelBase,
        formatter: FormatterBase,
        system_prompt: str,
        memory_config: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IMemory]] = None,
        rag_config: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IRAG]] = None,
        tool_configs: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IToolExecutor]] = None,
        mcp_configs: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], List[IMCPClient]]] = None,
        plan_config: Optional[Union[None, Dict[str, Any], IPlanNotebook]] = None,
        tts_config: Optional[Union[None, Dict[str, Any], ITTSModel]] = None,
        enable_memory: bool = True,
        enable_rag: bool = False,
        enable_tools: bool = False,
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
        
        memory_plugin = self._process_memory_config(memory_config, enable_memory)
        rag_plugin = self._process_rag_config(rag_config, enable_rag)
        tool_executor, mcp_clients = self._process_tools_config(
            tool_configs, mcp_configs, enable_tools
        )
        plan_plugin = self._process_plan_config(plan_config)
        tts_plugin = self._process_tts_config(tts_config)
        
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
        
        self._plan_plugin = plan_plugin
        self._tts_plugin = tts_plugin
        self._mcp_clients = mcp_clients
        self._model = model
        self._formatter = formatter
        self._system_prompt = system_prompt
    
    async def reply(self, message: str) -> str:
        """Agent reply interface."""
        if self._plan_plugin:
            await self._plan_plugin.initialize_if_needed()
            
            current_plan = self._plan_plugin.get_current_plan()
            if current_plan:
                message = self._inject_plan_context(message, current_plan)
        
        response = await self._core.reply(message)
        response_text = response.get_text_content() or str(response.content)
        
        if self._tts_plugin:
            try:
                await self._tts_plugin.synthesize(response_text)
            except Exception as e:
                logger.warning(f"TTS synthesis failed: {e}")
        
        return response_text
    
    def _inject_plan_context(self, message: str, plan: Dict[str, Any]) -> str:
        plan_context = f"""
当前计划状态:
- 计划名称: {plan.get('name', '未命名计划')}
- 当前步骤: {plan.get('current_step', 0)}/{plan.get('total_steps', 0)}
- 进度: {plan.get('progress', 0):.1%}

待执行步骤:
{self._format_pending_steps(plan.get('steps', []))}
"""
        return f"{plan_context}\n\n用户输入: {message}"
    
    def _format_pending_steps(self, steps: List[Dict[str, Any]]) -> str:
        pending = [s for s in steps if s.get('status') == 'pending']
        if not pending:
            return "无待执行步骤"
        
        formatted = []
        for i, step in enumerate(pending[:5], 1):
            formatted.append(f"{i}. {step.get('description', '未知步骤')}")
        
        if len(pending) > 5:
            formatted.append(f"... 还有 {len(pending) - 5} 个步骤")
        
        return "\n".join(formatted)
    
    def _process_memory_config(
        self,
        config: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IMemory]],
        enable_switch: bool,
    ) -> Optional[IMemory]:
        """Process memory configuration."""
        if config is not None:
            if isinstance(config, IMemory):
                return config
            elif isinstance(config, dict):
                memory_type = config.get("type", "vector")
                if memory_type == "blackhole":
                    return BlackholeMemoryPlugin()
                else:
                    return VectorMemoryPlugin(config)
            elif isinstance(config, list):
                if config:
                    return self._process_memory_config(config[0], True)
                return None
            else:
                raise TypeError(f"Unsupported memory config type: {type(config)}")
        
        if enable_switch:
            return VectorMemoryPlugin()
        
        return None
    
    def _process_rag_config(
        self,
        config: Optional[Union[None, Dict[str, Any], List[Dict[str, Any]], IRAG]],
        enable_switch: bool,
    ) -> Optional[IRAG]:
        """Process RAG configuration."""
        if config is not None:
            if isinstance(config, IRAG):
                return config
            elif isinstance(config, dict):
                return KnowledgeBaseRAGPlugin(config)
            elif isinstance(config, list):
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
    ) -> tuple[Optional[IToolExecutor], List[IMCPClient]]:
        """Process tools configuration including MCP clients."""
        all_tool_configs = []
        mcp_clients: List[IMCPClient] = []
        
        if tool_configs is not None:
            if isinstance(tool_configs, IToolExecutor):
                return tool_configs, mcp_clients
            elif isinstance(tool_configs, dict):
                all_tool_configs.append(tool_configs)
            elif isinstance(tool_configs, list):
                all_tool_configs.extend(tool_configs)
            else:
                raise TypeError(f"Unsupported tool configs type: {type(tool_configs)}")
        
        if mcp_configs is not None:
            processed_mcp = self._process_mcp_configs(mcp_configs)
            mcp_clients.extend(processed_mcp)
            
            for client in processed_mcp:
                try:
                    tools = client.get_tools()
                    for tool in tools:
                        tool_config = {
                            "name": tool.get("name"),
                            "description": tool.get("description", ""),
                            "parameters": tool.get("inputSchema", {}),
                            "mcp_client": client,
                            "type": "mcp_tool"
                        }
                        all_tool_configs.append(tool_config)
                except Exception as e:
                    logger.warning(f"Failed to get tools from MCP client: {e}")
        
        if not all_tool_configs and enable_switch:
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
            return ToolkitExecutor(all_tool_configs), mcp_clients
        
        return None, mcp_clients
    
    def _process_mcp_configs(
        self,
        configs: Union[Dict[str, Any], List[Dict[str, Any]], List[IMCPClient]]
    ) -> List[IMCPClient]:
        """Process MCP client configurations."""
        clients: List[IMCPClient] = []
        
        if isinstance(configs, list):
            for config in configs:
                if isinstance(config, IMCPClient):
                    clients.append(config)
                elif isinstance(config, dict):
                    client = self._create_mcp_client(config)
                    if client:
                        clients.append(client)
        elif isinstance(configs, dict):
            client = self._create_mcp_client(configs)
            if client:
                clients.append(client)
        elif isinstance(configs, IMCPClient):
            clients.append(configs)
        
        return clients
    
    def _create_mcp_client(self, config: Dict[str, Any]) -> Optional[IMCPClient]:
        """Create an MCP client from configuration."""
        try:
            transport = config.get("transport", "stdio")
            
            if transport == "stdio":
                client = MCPClient(
                    MCPServerConfig(
                        transport="stdio",
                        command=config.get("command"),
                        args=config.get("args", []),
                        env=config.get("env", {})
                    )
                )
            elif transport == "sse":
                client = MCPClient(
                    MCPServerConfig(
                        transport="sse",
                        url=config.get("url"),
                        headers=config.get("headers", {})
                    )
                )
            elif transport == "http":
                client = MCPClient(
                    MCPServerConfig(
                        transport="http",
                        url=config.get("url"),
                        headers=config.get("headers", {}),
                        timeout=config.get("timeout", 30)
                    )
                )
            else:
                logger.warning(f"Unknown MCP transport type: {transport}")
                return None
            
            return client
            
        except Exception as e:
            logger.error(f"Failed to create MCP client: {e}")
            return None
    
    def _process_plan_config(
        self,
        config: Optional[Union[None, Dict[str, Any], IPlanNotebook]],
    ) -> Optional[IPlanNotebook]:
        """Process plan configuration."""
        if config is None:
            return None
        
        if isinstance(config, IPlanNotebook):
            return config
        
        if isinstance(config, dict):
            plan_notebook = PlanNotebookPlugin(
                storage_path=config.get("storage_path"),
                auto_save=config.get("auto_save", True),
                max_plans=config.get("max_plans", 10)
            )
            return plan_notebook
        
        logger.warning(f"Unsupported plan config type: {type(config)}")
        return None
    
    def _process_tts_config(
        self,
        config: Optional[Union[None, Dict[str, Any], ITTSModel]],
    ) -> Optional[ITTSModel]:
        """Process TTS configuration."""
        if config is None:
            return None
        
        if isinstance(config, ITTSModel):
            return config
        
        if isinstance(config, dict):
            tts_plugin = self._create_tts_plugin(config)
            return tts_plugin
        
        logger.warning(f"Unsupported TTS config type: {type(config)}")
        return None
    
    def _create_tts_plugin(self, config: Dict[str, Any]) -> Optional[ITTSModel]:
        """Create TTS plugin from configuration."""
        try:
            provider = config.get("provider", "openai")
            
            if provider == "openai":
                from ..plugins.tts import OpenAITTSModel
                return OpenAITTSModel(
                    api_key=config.get("api_key"),
                    model=config.get("model", "tts-1"),
                    voice=config.get("voice", "alloy"),
                    output_path=config.get("output_path", "./tts_output")
                )
            elif provider == "azure":
                from ..plugins.tts import AzureTTSModel
                return AzureTTSModel(
                    subscription_key=config.get("subscription_key"),
                    region=config.get("region"),
                    voice=config.get("voice"),
                    output_path=config.get("output_path", "./tts_output")
                )
            elif provider == "edge":
                from ..plugins.tts import EdgeTTSModel
                return EdgeTTSModel(
                    voice=config.get("voice", "en-US-AriaNeural"),
                    output_path=config.get("output_path", "./tts_output")
                )
            elif provider == "local":
                from ..plugins.tts import LocalTTSModel
                return LocalTTSModel(
                    model_path=config.get("model_path"),
                    output_path=config.get("output_path", "./tts_output")
                )
            else:
                logger.warning(f"Unknown TTS provider: {provider}")
                return None
                
        except ImportError as e:
            logger.warning(f"TTS plugin not available: {e}")
            return None
        except Exception as e:
            logger.error(f"Failed to create TTS plugin: {e}")
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
    
    async def connect_mcp_servers(self) -> Dict[str, bool]:
        """Connect all MCP servers."""
        results = {}
        for i, client in enumerate(self._mcp_clients):
            try:
                await client.connect()
                results[f"mcp_client_{i}"] = True
            except Exception as e:
                logger.error(f"Failed to connect MCP client {i}: {e}")
                results[f"mcp_client_{i}"] = False
        return results
    
    async def disconnect_mcp_servers(self) -> None:
        """Disconnect all MCP servers."""
        for client in self._mcp_clients:
            try:
                await client.disconnect()
            except Exception as e:
                logger.warning(f"Failed to disconnect MCP client: {e}")
    
    def get_plan_plugin(self) -> Optional[IPlanNotebook]:
        """Get the plan plugin instance."""
        return self._plan_plugin
    
    def get_tts_plugin(self) -> Optional[ITTSModel]:
        """Get the TTS plugin instance."""
        return self._tts_plugin
    
    def get_mcp_clients(self) -> List[IMCPClient]:
        """Get all MCP client instances."""
        return self._mcp_clients.copy()
