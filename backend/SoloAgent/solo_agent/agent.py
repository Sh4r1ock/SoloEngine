"""
SoloAgent 基础类
简洁的 Agent 配置类，支持声明式配置
"""
import asyncio
import logging
from typing import Optional, List, Dict, Any, AsyncGenerator, TYPE_CHECKING

from .config import SoloAgentConfig

if TYPE_CHECKING:
    from ..core.react_core import ReActCore
    from ..model.model_base import BaseLLM
    from ..plugins.memory.database_memory import DatabaseMemoryPlugin
    from ..plugins.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)


class SoloAgent:
    """SoloAgent - 简洁的 Agent 基础类
    
    特点：
    - 声明式配置：只需指定名称，自动加载详细配置
    - 延迟加载：配置细节在运行时按需加载
    - 支持多模型：通过 provider + model 自动选择模型
    - 支持流式输出：原生支持流式响应
    - 支持持久化记忆：memory=True 时自动存储对话
    - 支持子Agent调用：通过 child_agents 列表
    """
    
    def __init__(self, config: SoloAgentConfig):
        self.config = config
        self._initialized = False
        
        self._llm: Optional["BaseLLM"] = None
        self._core: Optional["ReActCore"] = None
        self._memory_plugin: Optional["DatabaseMemoryPlugin"] = None
        self._mcp_clients: List["MCPClient"] = []
        self._tools: Dict[str, Any] = {}
        self._child_agents: Dict[str, "SoloAgent"] = {}
        self._message_history: List[Dict[str, Any]] = []
        self._last_tool_calls: List[Dict[str, Any]] = []
        self._stream_callback: Optional[callable] = None
        
    @property
    def name(self) -> str:
        return self.config.name
    
    @property
    def agent_id(self) -> str:
        return self.config.agent_id or self.config.name
    
    @property
    def child_agents(self) -> List[str]:
        return self.config.child_agents
    
    @property
    def agent_type(self) -> str:
        return self.config.agent_type
    
    @property
    def last_tool_calls(self) -> List[Dict[str, Any]]:
        return self._last_tool_calls
    
    def set_last_tool_calls(self, tool_calls: List[Dict[str, Any]]) -> None:
        self._last_tool_calls = tool_calls or []
    
    def set_child_agents(self, agents: Dict[str, "SoloAgent"]) -> None:
        self._child_agents = agents
        if agents:
            self.config.child_agents = list(agents.keys())
    
    def get_child_agent(self, agent_id: str) -> Optional["SoloAgent"]:
        return self._child_agents.get(agent_id)
    
    def set_stream_callback(self, callback: callable) -> None:
        """设置流式输出回调函数"""
        self._stream_callback = callback
        if self._core:
            self._core.stream_callback = callback
    
    async def initialize(self) -> None:
        if self._initialized:
            return
            
        from ..model.llm_factory import LLMFactory
        from ..core.react_core import ReActCore
        from ..formatter.openai_formatter import OpenAIChatFormatter
        from ..plugins.tools.toolkit_executor import ToolkitExecutor
        from .loader import ConfigLoader
        from .tools import ToolRegistry
        
        llm_config = await ConfigLoader.load_llm_config(
            provider=self.config.provider,
            model=self.config.model,
            user_id=self.config.user_id,
            api_key=self.config.api_key,
            base_url=self.config.base_url,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
        )
        
        provider = llm_config.get("provider", self.config.provider).lower()
        
        openai_compatible_providers = ["deepseek", "zhipu", "qwen"]
        
        if provider in openai_compatible_providers:
            self._llm = self._create_openai_compatible_model(llm_config, stream=True)
        else:
            self._llm = LLMFactory.create_model(
                provider=provider,
                model_name=llm_config.get("model", self.config.model),
                api_key=llm_config.get("api_key"),
                stream=True,
            )
        
        tool_configs = []
        for tool_name in self.config.tools:
            tool_config = ToolRegistry.get_tool_config(tool_name)
            if tool_config:
                tool_configs.append(tool_config)
        
        if self.config.skills:
            skill_tool_configs = await self._load_skills(self.config.skills)
            tool_configs.extend(skill_tool_configs)
        
        if self.config.mcp_servers:
            mcp_tool_configs = await self._load_mcp_servers(self.config.mcp_servers)
            tool_configs.extend(mcp_tool_configs)
        
        if self.config.child_agents:
            from .tools import create_task_tool_config
            task_config = create_task_tool_config(self)
            tool_configs.append(task_config)
            logger.info(f"[Child Agents] Added Task tool for child agents: {self.config.child_agents}")
        
        toolkit_executor = ToolkitExecutor(tool_configs) if tool_configs else None
        
        if toolkit_executor:
            available_tools = toolkit_executor.get_available_tools()
            logger.info(f"[Toolkit] Available tools: {[t.get('function', {}).get('name') for t in available_tools]}")
        
        if self.config.memory:
            await self._init_memory()
        
        formatter = OpenAIChatFormatter()
        
        self._core = ReActCore(
            name=self.config.name,
            model=self._llm,
            formatter=formatter,
            system_prompt=self.config.system_prompt,
            max_iters=self.config.max_iters,
            stream_callback=self._stream_callback,
            memory=self._memory_plugin,
        )
        
        if toolkit_executor:
            self._core.tool_executor = toolkit_executor
        
        self._initialized = True
        logger.info(f"SoloAgent '{self.name}' initialized with {len(tool_configs)} tools")
    
    async def _load_skills(self, skill_names: List[str]) -> List[Dict[str, Any]]:
        """加载技能工具配置"""
        tool_configs = []
        for skill_name in skill_names:
            try:
                skill_config = await ConfigLoader.load_skill_config(skill_name)
                if skill_config.get("tools"):
                    for tool_name in skill_config["tools"]:
                        tool_config = ToolRegistry.get_tool_config(tool_name)
                        if tool_config:
                            tool_configs.append(tool_config)
                if skill_config.get("system_prompt"):
                    self.config.system_prompt = f"{self.config.system_prompt}\n\n{skill_config['system_prompt']}"
                logger.info(f"Loaded skill '{skill_name}' with {len(skill_config.get('tools', []))} tools")
            except Exception as e:
                logger.warning(f"Failed to load skill '{skill_name}': {e}")
        return tool_configs
    
    async def _load_mcp_servers(self, server_names: List[str]) -> List[Dict[str, Any]]:
        """加载MCP服务器工具配置"""
        tool_configs = []
        from ..plugins.mcp.mcp_client import MCPClient
        
        for server_name in server_names:
            try:
                mcp_config = await ConfigLoader.load_mcp_config(server_name)
                if not mcp_config.get("command"):
                    logger.warning(f"MCP server '{server_name}' has no command configured")
                    continue
                
                client = MCPClient({
                    "transport": "stdio",
                    "command": mcp_config.get("command"),
                    "args": mcp_config.get("args", []),
                    "env": mcp_config.get("env", {}),
                })
                
                await client.connect()
                self._mcp_clients.append(client)
                
                tools = await client.get_tools()
                for tool in tools:
                    tool_config = self._create_mcp_tool_config(client, tool)
                    tool_configs.append(tool_config)
                
                logger.info(f"Loaded MCP server '{server_name}' with {len(tools)} tools")
            except Exception as e:
                logger.warning(f"Failed to load MCP server '{server_name}': {e}")
        
        return tool_configs
    
    def _create_mcp_tool_config(self, client: "MCPClient", tool: Dict[str, Any]) -> Dict[str, Any]:
        """创建MCP工具配置"""
        async def mcp_tool_executor(**kwargs):
            result = await client.call_tool(tool["name"], kwargs)
            if result.get("success") and result.get("content"):
                texts = []
                for item in result["content"]:
                    if item.get("type") == "text":
                        texts.append(item.get("text", ""))
                return {"content": "\n".join(texts), "success": True}
            return {"content": result.get("error_message", "Unknown error"), "success": False}
        
        input_schema = tool.get("inputSchema", {})
        properties = input_schema.get("properties", {})
        required = input_schema.get("required", [])
        
        parameters = {}
        for param_name, param_def in properties.items():
            parameters[param_name] = {
                "type": param_def.get("type", "string"),
                "description": param_def.get("description", ""),
                "required": param_name in required,
            }
        
        return {
            "name": tool["name"],
            "function": mcp_tool_executor,
            "description": tool.get("description", ""),
            "parameters": parameters,
        }
    
    def _create_openai_compatible_model(self, llm_config: Dict[str, Any], stream: bool = False):
        """创建 OpenAI 兼容模型（DeepSeek, Zhipu, Qwen 等）
        
        Args:
            llm_config: LLM 配置字典
            stream: 是否启用流式输出。对于 reply 方法应该使用 False，
                    对于 stream 方法应该使用 True。
        """
        from ..model.openai_model import OpenAIChatModel
        
        generate_kwargs = {}
        if "max_tokens" in llm_config:
            generate_kwargs["max_tokens"] = llm_config["max_tokens"]
        if "temperature" in llm_config:
            generate_kwargs["temperature"] = llm_config["temperature"]
        
        return OpenAIChatModel(
            model_name=llm_config.get("model", self.config.model),
            api_key=llm_config.get("api_key"),
            stream=stream,
            client_kwargs={
                "base_url": llm_config.get("base_url"),
            } if llm_config.get("base_url") else None,
            generate_kwargs=generate_kwargs if generate_kwargs else None,
        )
    
    async def _init_memory(self) -> None:
        from ..plugins.memory.database_memory import DatabaseMemoryPlugin
        from ..message import Msg
        
        if not self.config.agentic_flow_run_id:
            logger.warning("agentic_flow_run_id is required for memory, memory disabled")
            return
        
        if not self.config.user_id:
            logger.warning("user_id is required for memory, memory disabled")
            return
        
        self._memory_plugin = DatabaseMemoryPlugin({
            "run_id": self.config.agentic_flow_run_id,
            "user_id": self.config.user_id,
            "agentic_flow_id": self.config.agentic_flow_id,
            "agent_id": self.config.agent_id,
            "auto_load": True,
        })
        
        history_msgs = await self._memory_plugin.retrieve_all()
        self._message_history = [
            {"role": msg.role, "content": msg.get_text_content() or ""}
            for msg in history_msgs
        ]
        logger.info(f"SoloAgent '{self.name}' loaded {len(self._message_history)} messages from memory")
    
    async def _save_to_memory(self, role: str, content: str, metadata: Dict = None) -> None:
        if self._memory_plugin:
            from ..message import Msg
            msg = Msg(
                name=role,
                content=content,
                role=role,
            )
            await self._memory_plugin.add(msg, metadata)
    
    async def reply(self, message: str) -> str:
        if not self._initialized:
            await self.initialize()
        
        await self._save_to_memory("user", message)
        self._message_history.append({"role": "user", "content": message})
        
        if self._core is None:
            raise RuntimeError("Agent core not initialized")
        
        response = await self._core.reply(message)
        
        # 从 core 获取工具调用信息
        if hasattr(self._core, '_last_tool_results'):
            self._last_tool_calls = self._core._last_tool_results.copy() if self._core._last_tool_results else []
        
        response_text = response.get_text_content() if hasattr(response, 'get_text_content') else str(response)
        
        await self._save_to_memory("assistant", response_text)
        self._message_history.append({"role": "assistant", "content": response_text})
        
        return response_text
    
    async def stream(self, message: str) -> AsyncGenerator[str, None]:
        if not self._initialized:
            await self.initialize()
        
        await self._save_to_memory("user", message)
        self._message_history.append({"role": "user", "content": message})
        
        if self._core is None:
            raise RuntimeError("Agent core not initialized")
        
        full_response = ""
        
        from ..formatter.openai_formatter import OpenAIChatFormatter
        from ..message import Msg
        from .loader import ConfigLoader
        
        llm_config = await ConfigLoader.load_llm_config(
            provider=self.config.provider,
            model=self.config.model,
            user_id=self.config.user_id,
            api_key=self.config.api_key,
            base_url=self.config.base_url,
        )
        
        stream_model = self._create_openai_compatible_model(llm_config, stream=True)
        
        formatter = OpenAIChatFormatter()
        messages = [
            Msg(name="system", content=self.config.system_prompt, role="system"),
        ]
        for msg in self._message_history:
            messages.append(Msg(
                name=msg["role"],
                content=msg["content"],
                role=msg["role"],
            ))
        messages.append(Msg(name="user", content=message, role="user"))
        
        formatted = await formatter.format(messages)
        
        stream_result = await stream_model(formatted)
        
        async for chunk in stream_result:
            if hasattr(chunk, 'content'):
                for block in chunk.content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text = block.get("text", "")
                            yield text
                            full_response += text
                        elif block.get("type") == "thinking":
                            thinking = block.get("thinking", "")
                            yield f"<think:{thinking}>"
                    elif hasattr(block, 'text'):
                        yield block.text
                        full_response += block.text
            elif isinstance(chunk, str):
                yield chunk
                full_response += chunk
        
        await self._save_to_memory("assistant", full_response)
        self._message_history.append({"role": "assistant", "content": full_response})
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        from .tools import ToolRegistry
        
        tool = ToolRegistry.get_tool(tool_name)
        if tool is None:
            raise ValueError(f"Tool '{tool_name}' not found")
        
        if hasattr(tool, 'execute'):
            result = tool.execute(**arguments)
            if asyncio.iscoroutine(result):
                result = await result
            return {"success": True, "result": result}
        else:
            raise ValueError(f"Tool '{tool_name}' does not have execute method")
    
    async def call_subagent(self, agent_id: str, message: str) -> str:
        child = self.get_child_agent(agent_id)
        if child is None:
            raise ValueError(f"Child agent '{agent_id}' not found")
        
        logger.info(f"[call_subagent] Calling child agent '{agent_id}' with message: {message[:100]}...")
        
        if not child._initialized:
            await child.initialize()
        
        result = await child.reply(message)
        
        # 提取文本内容
        if hasattr(result, 'content'):
            content = result.content
        elif isinstance(result, dict):
            content = result.get('content', str(result))
        else:
            content = str(result)
        
        logger.info(f"[call_subagent] Child agent '{agent_id}' returned: {content[:200]}...")
        return content
    
    def interrupt(self) -> None:
        """
        中断当前正在进行的模型输出。
        
        调用此方法后，流式输出会立即停止，API 不再发送请求。
        这是一个真实的中断，不会消耗额外的 token。
        
        Example:
            >>> # 在另一个线程中调用
            >>> agent.interrupt()
        """
        if hasattr(self, '_core') and self._core:
            self._core.interrupt()
            logger.info(f"[SoloAgent] Interrupt requested for agent '{self.config.name}'")
    
    def is_interrupted(self) -> bool:
        """
        检查是否已被中断。
        
        Returns:
            bool: 如果已被中断返回 True，否则返回 False。
        """
        if hasattr(self, '_core') and self._core:
            return self._core.is_interrupted()
        return False
    
    async def close(self) -> None:
        for client in self._mcp_clients:
            if hasattr(client, 'close'):
                await client.close()
        
        self._mcp_clients = []
        self._initialized = False
