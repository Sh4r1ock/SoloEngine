"""
SoloAgent 基础类
简洁的 Agent 配置类，支持声明式配置
"""
import asyncio
import json
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
    - 支持子Agent调用：通过 subagents 列表
    
    注意：记忆管理由 CompiledFlow 层统一处理，Agent 不再管理 _memory_plugin
    """
    
    def __init__(self, config: SoloAgentConfig):
        self.config = config
        self._initialized = False
        
        self._llm: Optional["BaseLLM"] = None
        self._core: Optional["ReActCore"] = None
        self._mcp_clients: List["MCPClient"] = []
        self._tools: Dict[str, Any] = {}
        self._subagents: Dict[str, "SoloAgent"] = {}
        self._subagents_info: List[Dict[str, Any]] = []
        self._message_history: List[Dict[str, Any]] = []
        self._last_tool_calls: List[Dict[str, Any]] = []
        self._last_response: Optional[Any] = None
        self._stream_callback: Optional[callable] = None
        
    @property
    def name(self) -> str:
        return self.config.name
    
    @property
    def agent_id(self) -> str:
        return self.config.agent_id or self.config.name
    
    @property
    def subagents(self) -> List[Dict[str, Any]]:
        return self.config.subagents
    
    @property
    def agent_type(self) -> str:
        return self.config.agent_type
    
    @property
    def last_tool_calls(self) -> List[Dict[str, Any]]:
        return self._last_tool_calls
    
    def set_last_tool_calls(self, tool_calls: List[Dict[str, Any]]) -> None:
        self._last_tool_calls = tool_calls or []
    
    def set_subagents(self, agents: Dict[str, "SoloAgent"], subagents_info: List[Dict[str, Any]] = None) -> None:
        self._subagents = agents
        if subagents_info:
            self._subagents_info = subagents_info
            self.config.subagents = subagents_info
        elif agents:
            self.config.subagents = [
                {"subagent_name": name, "subagent_id": agent.agent_id, "description": agent.config.system_prompt[:100] if agent.config.system_prompt else ""}
                for name, agent in agents.items()
            ]
    
    def get_subagent(self, agent_id: str) -> Optional["SoloAgent"]:
        return self._subagents.get(agent_id)
    
    def set_stream_callback(self, callback: callable) -> None:
        """设置流式输出回调函数"""
        self._stream_callback = callback
        if self._core:
            self._core.stream_callback = callback
            self._core.agent_id = self.agent_id
        
        for subagent in self._subagents.values():
            if subagent._initialized and hasattr(subagent, 'set_stream_callback'):
                subagent.set_stream_callback(callback)
    
    def set_message_history(self, history: List[Dict[str, Any]]) -> None:
        """设置消息历史（由 CompiledFlow 层调用）"""
        self._message_history = history
    
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
                base_url=llm_config.get("base_url"),
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
        
        if self.config.subagents:
            from .tools import create_task_tool_config
            task_config = create_task_tool_config(self)
            tool_configs.append(task_config)
            logger.info(f"[SubAgents] Added Task tool for subagents: {[s.get('subagent_name') for s in self.config.subagents]}")
        
        toolkit_executor = ToolkitExecutor(tool_configs) if tool_configs else None
        
        if toolkit_executor:
            available_tools = toolkit_executor.get_available_tools()
            logger.info(f"[Toolkit] Available tools: {[t.get('function', {}).get('name') for t in available_tools]}")
        
        formatter = OpenAIChatFormatter()
        
        self._core = ReActCore(
            name=self.config.name,
            model=self._llm,
            formatter=formatter,
            system_prompt=self.config.system_prompt,
            max_iters=self.config.max_iters,
            stream_callback=self._stream_callback,
            agent_id=self.agent_id,
        )
        
        if toolkit_executor:
            self._core.tool_executor = toolkit_executor
        
        if self._message_history:
            from ..message import Msg
            history_msgs = []
            for msg in self._message_history:
                content = msg["content"]
                if isinstance(content, list):
                    history_msgs.append(Msg(name=msg["role"], content=content, role=msg["role"]))
                else:
                    history_msgs.append(Msg(name=msg["role"], content=content, role=msg["role"]))
            self._core.load_history(history_msgs)
        
        self._initialized = True
        logger.info(f"SoloAgent '{self.name}' initialized with {len(tool_configs)} tools")
    
    async def _load_skills(self, skills: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """加载技能工具配置
        
        Args:
            skills: 已在编译阶段组装的 Skills 信息列表
                [{"id": "...", "name": "...", "folder_path": "...", "description": "...", ...}]
        """
        tool_configs = []
        
        from ..plugins.tools.agent.skill import SkillTool
        
        skill_tool = SkillTool(skills_info=skills)
        
        tool_configs.append({
            "name": "Skill",
            "function": skill_tool.execute,
            "description": skill_tool.get_tool_spec()["description"],
            "parameters": skill_tool.get_tool_spec()["parameters"],
        })
        
        for skill in skills:
            if isinstance(skill, dict):
                skill_tools = skill.get("tools", [])
                for tool_name in skill_tools:
                    tool_config = ToolRegistry.get_tool_config(tool_name)
                    if tool_config:
                        tool_configs.append(tool_config)
                
                instructions = skill.get("instructions")
                if instructions:
                    self.config.system_prompt = f"{self.config.system_prompt}\n\n{instructions}"
                
                skill_name = skill.get("name", skill.get("id", "unknown"))
                logger.info(f"Loaded skill '{skill_name}' with {len(skill_tools)} tools")
        
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
    
    async def reply(self, message: str, cancel_event: asyncio.Event = None) -> str:
        if not self._initialized:
            await self.initialize()
        
        if self._core is None:
            raise RuntimeError("Agent core not initialized")
        
        try:
            response = await self._core.reply(message, cancel_event=cancel_event)
            
            self._last_response = response
            
            if hasattr(self._core, '_last_tool_results'):
                self._last_tool_calls = self._core._last_tool_results.copy() if self._core._last_tool_results else []
            
            response_text = response.get_text_content() if hasattr(response, 'get_text_content') else str(response)
            
            return response_text
        except Exception as e:
            logger.error(f"Agent reply error: {e}")
            raise
    
    def get_last_openai_message(self) -> dict:
        """
        获取最后一次响应的 OpenAI 格式消息。
        
        Returns:
            dict: OpenAI 格式的消息，包含 role, content, reasoning_content 字段
        """
        if self._last_response is None:
            return {"role": "assistant", "content": "", "reasoning_content": None}
        
        if hasattr(self._last_response, 'to_openai_message'):
            return self._last_response.to_openai_message()
        
        if hasattr(self._last_response, 'get_text_content'):
            content = self._last_response.get_text_content()
            reasoning = self._last_response.get_reasoning_content() if hasattr(self._last_response, 'get_reasoning_content') else None
            return {"role": "assistant", "content": content, "reasoning_content": reasoning}
        
        return {"role": "assistant", "content": str(self._last_response), "reasoning_content": None}
    
    async def stream(self, message: str) -> AsyncGenerator[str, None]:
        if not self._initialized:
            await self.initialize()
        
        if self._core is None:
            raise RuntimeError("Agent core not initialized")
        
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
                        elif block.get("type") == "thinking":
                            thinking = block.get("thinking", "")
                            yield f"<think:{thinking}>"
                    elif hasattr(block, 'text'):
                        yield block.text
            elif isinstance(chunk, str):
                yield chunk
    
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
    
    async def call_subagent(self, subagent_name: str, task: str) -> str:
        subagent = self.get_subagent(subagent_name)
        if subagent is None:
            for agent in self._subagents.values():
                if agent.config.name == subagent_name:
                    subagent = agent
                    break
        
        if subagent is None:
            raise ValueError(f"Subagent '{subagent_name}' not found")
        
        logger.info(f"[call_subagent] Calling subagent '{subagent_name}' with task: {task[:100]}...")
        
        if not subagent._initialized:
            await subagent.initialize()
        
        result = await subagent.reply(task)
        
        if hasattr(result, 'content'):
            content = result.content
        elif isinstance(result, dict):
            content = result.get('content', str(result))
        else:
            content = str(result)
        
        logger.info(f"[call_subagent] Subagent '{subagent_name}' returned: {content[:200]}...")
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
