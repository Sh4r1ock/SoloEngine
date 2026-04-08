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
    from ..plugins.tools.agent.mcp import MCPServerInfo

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
        self._mcp_servers_info: Dict[str, "MCPServerInfo"] = {}
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
                {
                    "subagent_name": name, 
                    "subagent_id": agent.agent_id, 
                    "description": agent.config.desc if agent.config.desc else (
                        agent.config.system_prompt[:100] if agent.config.system_prompt else ""
                    )
                }
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
            if hasattr(self._core, '_tool_call_event_manager') and self._core._tool_call_event_manager:
                self._core._tool_call_event_manager.stream_callback = callback
                self._core._tool_call_event_manager.agent_id = self.agent_id
                self._core._tool_call_event_manager.agent_name = self.name
        
        for subagent in self._subagents.values():
            subagent._stream_callback = callback
            if subagent._core:
                subagent._core.stream_callback = callback
                subagent._core.agent_id = subagent.agent_id
                if hasattr(subagent._core, '_tool_call_event_manager') and subagent._core._tool_call_event_manager:
                    subagent._core._tool_call_event_manager.stream_callback = callback
                    subagent._core._tool_call_event_manager.agent_id = subagent.agent_id
                    subagent._core._tool_call_event_manager.agent_name = subagent.name
    
    def set_message_history(self, history: List[Dict[str, Any]]) -> None:
        """设置消息历史（由 CompiledFlow 层调用）"""
        self._message_history = history

    def _convert_history_to_msgs(self, history: List[Dict[str, Any]]) -> List["Msg"]:
        """
        将原始历史数据转换为 Msg 对象列表。

        职责：在 SoloAgent 层完成原始格式到 Msg 对象的转换。
        处理所有类型的 role：user, assistant, system, tool
        处理所有类型的内容：thought, content, tool_calls, tool_result

        Args:
            history: 原始历史数据列表，每个元素包含 role, data 等字段

        Returns:
            List[Msg]: 转换后的 Msg 对象列表
        """
        from ..message import Msg

        msgs = []
        for record in history:
            role = record.get("role", "user")
            data = record.get("data", [])

            if role == "tool":
                # tool 消息：查找 tool_result 类型的块
                tool_call_id = None
                content = ""

                for block in data:
                    if block.get("type") == "tool_result":
                        tool_call_id = block.get("id")
                        output = block.get("output", "")
                        content = output if isinstance(output, str) else str(output)
                        break

                # 特殊情况处理：如果没有找到 tool_call_id，尝试从 metadata 中获取
                if not tool_call_id and record.get("metadata"):
                    tool_call_id = record["metadata"].get("tool_call_id")
                
                # 如果仍然没有 tool_call_id，跳过这条消息
                # 因为 OpenAI API 要求 tool 消息必须有 tool_call_id
                if not tool_call_id:
                    logger.warning(f"[_convert_history_to_msgs] Skipping tool message without tool_call_id. Data: {data}")
                    continue

                msgs.append(Msg(
                    name="tool",
                    content=content,
                    role="tool",
                    tool_call_id=tool_call_id,
                    metadata={"original_data": data}
                ))

            elif role == "assistant":
                # assistant 消息：处理 thinking, tool_calls, content
                content_blocks = []
                tool_calls = []
                thinking_content = []

                for block in data:
                    block_type = block.get("type")

                    if block_type == "text":
                        content_blocks.append(block)
                    elif block_type == "thinking":
                        thinking_content.append(block.get("thinking", ""))
                    elif block_type == "tool_calls":
                        tool_calls.extend(block.get("tool_calls", []))
                    elif block_type == "content":
                        content_blocks.append({"type": "text", "text": block.get("content", "")})

                # 构建 content：优先使用 content_blocks，否则使用原始 data
                if content_blocks:
                    content = content_blocks
                else:
                    content = data

                metadata = {}
                if thinking_content:
                    metadata["thinking"] = "\n".join(thinking_content)
                if tool_calls:
                    metadata["tool_calls"] = tool_calls

                msgs.append(Msg(
                    name="assistant",
                    content=content,
                    role="assistant",
                    metadata=metadata if metadata else None
                ))

            elif role == "user":
                # user 消息：提取文本内容
                content_parts = []
                for block in data:
                    if block.get("type") == "text":
                        content_parts.append(block.get("text", ""))
                    elif block.get("type") == "content":
                        content_parts.append(block.get("content", ""))

                content = "\n".join(content_parts) if content_parts else ""

                msgs.append(Msg(
                    name="user",
                    content=content,
                    role="user"
                ))

            elif role == "system":
                # system 消息：提取文本内容
                content_parts = []
                for block in data:
                    if block.get("type") == "text":
                        content_parts.append(block.get("text", ""))

                content = "\n".join(content_parts) if content_parts else ""

                msgs.append(Msg(
                    name="system",
                    content=content,
                    role="system"
                ))

        return msgs

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
            frequency_penalty=self.config.frequency_penalty,
            presence_penalty=self.config.presence_penalty,
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
        
        logger.info(f"[Agent Initialize] Checking MCP servers info: hasattr={hasattr(self, '_mcp_servers_info')}, value={getattr(self, '_mcp_servers_info', None)}")
        if hasattr(self, '_mcp_servers_info') and self._mcp_servers_info:
            logger.info(f"[Agent Initialize] Loading MCP tools with {len(self._mcp_servers_info)} servers")
            mcp_tool_configs = await self._load_mcp_tools(self._mcp_servers_info)
            tool_configs.extend(mcp_tool_configs)
        elif self.config.mcp_servers:
            if isinstance(self.config.mcp_servers, dict) and any(
                isinstance(v, dict) and 'client' in v 
                for v in self.config.mcp_servers.values()
            ):
                mcp_tool_configs = await self._load_mcp_tools(self.config.mcp_servers)
                tool_configs.extend(mcp_tool_configs)
        
        if self.config.subagents:
            from ..plugins.tools.agent.task import TaskTool
            task_tool = TaskTool(
                parent_agent=self,
                subagents_info=self.config.subagents
            )
            tool_configs.append({
                "name": "Task",
                "function": task_tool.execute,
                "description": task_tool.get_tool_spec()["description"],
                "parameters": task_tool.get_tool_spec()["parameters"],
            })
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
            # SoloAgent 层负责将原始格式转换为 Msg 对象
            history_msgs = self._convert_history_to_msgs(self._message_history)
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
    
    async def _load_mcp_tools(
        self, 
        mcp_servers_info: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """加载MCP工具配置 - 只注册MCPTool，不管理Client
        
        Client由Host(CompiledFlow)统一管理，Agent只负责使用。
        
        Args:
            mcp_servers_info: MCP服务器信息字典(包含Host层Client的引用)
                {"server_name": MCPServerInfo(...), ...}
        
        Returns:
            List[Dict[str, Any]]: 工具配置列表
        """
        tool_configs = []
        
        from ..plugins.tools.agent.mcp import MCPTool, MCPServerInfo
        
        # 只创建MCPTool，Client由Host(CompiledFlow)统一管理
        mcp_tool = MCPTool(mcp_servers_info=mcp_servers_info)
        
        tool_configs.append({
            "name": "MCP",
            "function": mcp_tool.execute,
            "description": mcp_tool.get_tool_spec()["description"],
            "parameters": mcp_tool.get_tool_spec()["parameters"],
        })
        
        # 记录日志，Client由Host管理，Agent不再管理
        for server_name, server_info in mcp_servers_info.items():
            if isinstance(server_info, MCPServerInfo):
                logger.info(
                    f"[MCP] Agent '{self.name}' using MCP server '{server_name}' "
                    f"with {len(server_info.tools)} tools, "
                    f"connected={server_info.is_connected}"
                )
        
        return tool_configs
    
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
        if "frequency_penalty" in llm_config:
            generate_kwargs["frequency_penalty"] = llm_config["frequency_penalty"]
        if "presence_penalty" in llm_config:
            generate_kwargs["presence_penalty"] = llm_config["presence_penalty"]
        
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
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
            frequency_penalty=self.config.frequency_penalty,
            presence_penalty=self.config.presence_penalty,
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
