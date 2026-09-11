"""
SoloAgent机制-agent.py: SoloAgent基础类，简洁的Agent配置类，支持声明式配置

@file agent.py
@description SoloAgent基础类实现，支持声明式配置和延迟加载
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块实现SoloAgent机制的基础类，提供以下核心功能：
- 声明式配置：只需指定名称，自动加载详细配置
- 延迟加载：配置细节在运行时按需从数据库/文件加载
- 多模型支持：通过provider + model自动选择模型
- 流式输出：原生支持流式响应
- 子Agent调用：支持通过subagents列表调用子Agent
- 记忆管理：与CompiledFlow层协作，统一处理历史消息

依赖:
- asyncio: 异步操作支持
- json: JSON数据处理
- logging: 日志记录
- typing: 类型提示
- .config: SoloAgentConfig配置类

使用示例:
- config = SoloAgentConfig(name="my_agent", provider="openai", model="gpt-4")
- agent = SoloAgent(config)
- async for chunk in agent.run("用户输入"): process(chunk)
"""
import asyncio
import logging
import os
from typing import Optional, List, Dict, Any, TYPE_CHECKING

from .config import SoloAgentConfig
from ..utils.message_utils import MessageBlockExtractor
from ..model.model_response import ChatResponse
from ..message import Msg
from .file_change_tracking import FileChangeTracker

if TYPE_CHECKING:
    from ..core.react_core import ReActCore
    from ..model.model_base import BaseLLM
    from ..plugins.mcp.mcp_client import MCPClient
    from ..plugins.tools.agent.mcp import MCPServerInfo
    from .compiler.compiled_flow import CompiledFlow

logger = logging.getLogger("SoloEngine")



class SoloAgent:
    """
    SoloAgent基础类
    
    职责:
    - 提供简洁的Agent基础实现
    - 支持声明式配置和延迟加载
    - 管理LLM模型、ReAct核心、MCP客户端
    - 协调子Agent调用
    - 与CompiledFlow层协作处理历史消息
    
    属性:
        config (SoloAgentConfig): Agent配置
        _initialized (bool): 是否已初始化
        _llm (Optional[BaseLLM]): LLM模型实例
        _core (Optional[ReActCore]): ReAct核心实例
        _tools (Dict[str, Any]): 工具字典
        _subagents (Dict[str, SoloAgent]): 子Agent字典
        _message_history (List[Dict]): 消息历史
    
    注意：
        记忆管理由CompiledFlow层统一处理，Agent本身不直接管理_memory_plugin
    """
    
    def __init__(self, config: SoloAgentConfig):
        """
        初始化SoloAgent
        
        Args:
            config: SoloAgent配置对象
        """
        self.config = config
        self._initialized = False
        
        self._llm: Optional["BaseLLM"] = None
        self._core: Optional["ReActCore"] = None
        self._mcp_servers_info: Dict[str, "MCPServerInfo"] = {}
        self._tools: Dict[str, Any] = {}
        self._subagents: Dict[str, "SoloAgent"] = {}
        self._subagents_info: List[Dict[str, Any]] = []
        self._message_history: List[Dict[str, Any]] = []
        self._last_tool_calls: List[Dict[str, Any]] = []
        self._last_response: Optional[Any] = None
        self._stream_callback: Optional[callable] = None
        self._event_callback: Optional[callable] = None
        self._working_dir: str = ""
        self._pre_tool_hashes: Dict[str, str] = {}
        self._file_change_tracker = FileChangeTracker(self)
        # C1：本实例当前执行的有效取消事件（prepare_execution 注入），
        # 替代跨层读 ReactCore._current_cancel_event 私有属性
        self._exec_cancel_event: Optional[asyncio.Event] = None
        # 编译流反向引用（C2：经 set_compiled_flow 公开 setter 写入）
        self._compiled_flow: Optional["CompiledFlow"] = None
        # 父实例 message_id（agent_start 事件 parent_message_id 来源，C1：经公开 setter 写入）
        self._parent_message_id: Optional[str] = None
        # 执行实例 message_id（session_message_id，prepare_execution 注入）
        self._message_id: Optional[str] = None
        
    @property
    def name(self) -> str:
        return self.config.name
    
    @property
    def agent_id(self) -> str:
        return self.config.agent_id or self.config.name
    
    @property
    def agent_type(self) -> str:
        return self.config.agent_type

    def set_file_change_context(self, working_dir: str) -> None:
        self._working_dir = working_dir or ""
        self._pre_tool_hashes = {}
        from ..plugins.tools.file.base import set_file_tool_working_dir
        set_file_tool_working_dir(self._working_dir)
        logger.info(f"[set_file_change_context] working_dir={working_dir}")

    async def _on_tool_executing(self, tool_call: Dict) -> None:
        await self._file_change_tracker.on_tool_executing(tool_call)

    async def _on_tool_executed(self, tool_call: Dict, result: Any):
        await self._file_change_tracker.on_tool_executed(tool_call, result)
        # 框架驱动（单向架构：上级调下级，工具只产出数据）：
        # 数据驱动（非工具名集合）：任何工具只要返回子代理启动声明
        #（subagent_id + task），框架即启动该子执行并返回其执行结果，
        # react_core 用它覆盖工具声明结果注入 LLM 上下文；无声明返回 None（行为不变）。
        if isinstance(result, dict):
            subagent_id = result.get("subagent_id")
            task_content = result.get("task")
            if subagent_id and task_content and self._compiled_flow is not None:
                return await self._launch_subagent(
                    tool_call,
                    result.get("subagent_name"),
                    subagent_id,
                    task_content,
                )
        return None

    async def _launch_subagent(
        self,
        tool_call: Dict,
        subagent_name: str,
        subagent_id: str,
        task_content: str,
    ) -> Dict[str, Any]:
        """启动 SubAgent 并返回其执行结果（框架侧，_on_tool_executed 钩子内调用）。"""
        try:
            subagent = self._compiled_flow.create_agent_instance(subagent_id)
            task_msg = Msg(name="user", content=task_content, role="user")
            # C1：取消事件使用 SoloAgent 自身维护的 _exec_cancel_event
            #（prepare_execution 注入，与 ReactCore._current_cancel_event 语义等价），
            # 不再跨三层私有链读 self._core._current_cancel_event。
            cancel_event = self._exec_cancel_event
            # 父实例 message_id（agent_start 事件 metadata.parent_message_id 来源，
            # 前端层级关联 + 保存链路 task 消息的 parent_message_id 定位依据）
            # C1：经公开 setter 写入，不直接赋值子实例私有字段 _parent_message_id
            subagent.set_parent_message_id(self._message_id)
            # message_id 不传 → execute_agent 内部生成（HEAD 机制，作为历史消息 id）；
            # source_tool_call_id = 本次 Task 调用的 tc.id（agent_start 携带，前端流式对号）
            # C1：经 CompiledFlow 公开方法 execute_agent 调用，不调私有 _execute_agent
            result = await self._compiled_flow.execute_agent(
                subagent,
                task_msg,
                context={},
                cancel_event=cancel_event,
                parent_agent_id=self.agent_id,
                parent_agent_name=self.name,
                task_content=task_content,
                source_tool_call_id=tool_call.get("id"),
            )
            # 子执行消息 id：_execute_agent 内部生成后经 prepare_execution 写入 subagent._message_id
            #（agent_start/stream 事件携带，前端归组/实例标识，HEAD 机制）
            if isinstance(result, dict):
                if result.get("status") == "failed":
                    error_msg = result.get("error", "Unknown error")
                    return {
                        "success": False,
                        "error_message": f"SubAgent执行失败: {error_msg}",
                        "content": str(error_msg),
                    }
                final_content = result.get("output", "")
            else:
                final_content = str(result)

            return {
                "success": True,
                "subagent_name": subagent_name,
                "subagent_id": subagent_id,
                "error_message": None,
                "content": final_content,
            }
        except Exception as e:
            logger.error(f"[SoloAgent] SubAgent launch failed: {e}")
            return {
                "success": False,
                "error_message": str(e),
                "content": str(e),
            }

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
    
    def set_stream_callback(self, callback: callable) -> None:
        """
        设置流式输出回调函数

        Args:
            callback: 流式输出回调函数，接收delta数据和agent信息

        Returns:
            None

        Raises:
            无异常抛出

        Example:
            >>> def on_stream(delta, agent_id=None, agent_name=None):
            ...     print(delta)
            >>> agent.set_stream_callback(on_stream)
        """
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
            if subagent._core and hasattr(subagent, 'set_stream_callback'):
                subagent.set_stream_callback(callback)
    
    def set_message_history(self, history: List[Dict[str, Any]]) -> None:
        """
        设置消息历史（由 CompiledFlow 层调用）

        Args:
            history: 消息历史列表，每个元素包含role和data字段

        Returns:
            None

        Raises:
            无异常抛出

        Example:
            >>> history = [{"role": "user", "data": [{"type": "text", "text": "Hello"}]}]
            >>> agent.set_message_history(history)
        """
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
                tool_call_id = record.get("tool_call_id")
                if not tool_call_id:
                    tool_result = MessageBlockExtractor.extract_tool_result(data)
                    if tool_result:
                        tool_call_id = tool_result.get("id")

                if not tool_call_id:
                    logger.warning(f"[_convert_history_to_msgs] Skipping tool message without tool_call_id. Data: {data}")
                    continue

                content = record.get("content", "")
                if not content:
                    tool_result = MessageBlockExtractor.extract_tool_result(data)
                    if tool_result:
                        output = tool_result.get("output", "")
                        content = output if isinstance(output, str) else str(output)

                tool_name = record.get("name", "tool")

                msgs.append(Msg(
                    name=tool_name,
                    content=content,
                    role="tool",
                    tool_call_id=tool_call_id,
                ))

            elif role == "assistant":
                content = record.get("content")
                if content is None:
                    content = data

                content_list = []
                if isinstance(data, list):
                    for block in data:
                        if not isinstance(block, dict):
                            content_list.append(block)
                            continue
                        block_type = block.get("type")
                        if block_type == "thinking":
                            content_list.append({"type": "thinking", "thinking": block.get("thinking", "")})
                        elif block_type == "reasoning_content":
                            reasoning_content = block.get("reasoning_content", block.get("content", ""))
                            content_list.append({"type": "reasoning_content", "reasoning_content": reasoning_content if isinstance(reasoning_content, str) else str(reasoning_content)})
                        else:
                            content_list.append(block)

                metadata = {}
                if isinstance(data, list):
                    thinking_parts = []
                    for block in data:
                        if isinstance(block, dict):
                            if block.get("type") == "thinking":
                                thinking_parts.append(block.get("thinking", ""))
                            elif block.get("type") == "reasoning_content":
                                reasoning_content = block.get("reasoning_content", block.get("content", ""))
                                thinking_parts.append(reasoning_content if isinstance(reasoning_content, str) else str(reasoning_content or ""))
                    if thinking_parts:
                        metadata["thinking"] = "\n".join(thinking_parts)

                msgs.append(Msg(
                    name="assistant",
                    content=content_list if content_list else content,
                    role="assistant",
                    metadata=metadata if metadata else None
                ))

            elif role == "user":
                content = MessageBlockExtractor.extract_text_content(data, include_content_type=True)

                msgs.append(Msg(
                    name="user",
                    content=content,
                    role="user"
                ))

            elif role == "system":
                content = MessageBlockExtractor.extract_text_content(data, include_content_type=False)

                msgs.append(Msg(
                    name="system",
                    content=content,
                    role="system"
                ))

        return msgs

    async def initialize(self) -> None:
        """
        初始化Agent

        加载LLM模型、工具、MCP服务器等配置，创建ReAct核心实例。
        这是一个异步方法，需要在首次调用reply或stream之前执行。

        Args:
            无参数

        Returns:
            None

        Raises:
            RuntimeError: 当核心初始化失败时抛出

        Example:
            >>> await agent.initialize()
            >>> print(f"Agent '{agent.name}' initialized")
        """
        if self._initialized:
            return
            
        from ..model.llm_factory import LLMFactory
        from ..core.react_core import ReActCore
        from ..formatter.openai_formatter import OpenAIChatFormatter
        from ..plugins.tools.toolkit_executor import ToolkitExecutor
        from .tools import ToolRegistry

        provider = self.config.provider.lower()

        openai_compatible_providers = ["deepseek", "zhipu", "qwen"]

        if provider in openai_compatible_providers:
            self._llm = self._create_openai_compatible_model(stream=True)
        else:
            factory_kwargs = {}
            client_kwargs_holder = {}
            if self.config.base_url:
                client_kwargs_holder["base_url"] = self.config.base_url
            if self.config.timeout:
                import httpx
                client_kwargs_holder["timeout"] = httpx.Timeout(float(self.config.timeout), connect=10.0)
            if client_kwargs_holder:
                factory_kwargs["client_kwargs"] = client_kwargs_holder
            generate_kwargs = {}
            if self.config.max_tokens is not None:
                generate_kwargs["max_tokens"] = self.config.max_tokens
            if self.config.temperature is not None:
                generate_kwargs["temperature"] = self.config.temperature
            if self.config.frequency_penalty is not None:
                generate_kwargs["frequency_penalty"] = self.config.frequency_penalty
            if self.config.presence_penalty is not None:
                generate_kwargs["presence_penalty"] = self.config.presence_penalty
            if generate_kwargs:
                factory_kwargs["generate_kwargs"] = generate_kwargs
            
            self._llm = LLMFactory.create_model(
                provider=provider,
                model_name=self.config.model,
                api_key=self.config.api_key,
                stream=True,
                **factory_kwargs,
            )
        
        tool_configs = []
        for tool_name in self.config.tools:
            tool_class = ToolRegistry.get_tool_class(tool_name)
            if not tool_class:
                continue
            
            if getattr(tool_class, 'needs_runtime_data', False):
                continue
            
            tool_config = ToolRegistry.get_tool_config(tool_name)
            if tool_config:
                tool_configs.append(tool_config)
        
        if self.config.skills:
            skill_class = ToolRegistry.get_tool_class("Skill")
            if skill_class:
                skill_tool = skill_class(skills_info=self.config.skills)
                tool_configs.append({
                    "name": "Skill",
                    "function": skill_tool.execute,
                    "description": skill_tool.get_tool_spec()["description"],
                    "parameters": skill_tool.get_tool_spec()["parameters"],
                })
                for skill in self.config.skills:
                    if isinstance(skill, dict):
                        skill_tools = skill.get("tools", [])
                        for tool_name in skill_tools:
                            tool_config = ToolRegistry.get_tool_config(tool_name)
                            if tool_config:
                                tool_configs.append(tool_config)
                        
                        skill_name = skill.get("name", skill.get("id", "unknown"))
                        logger.info(f"Loaded skill '{skill_name}' with {len(skill_tools)} tools")
        
        logger.info(f"[Agent Initialize] Checking MCP servers info: hasattr={hasattr(self, '_mcp_servers_info')}, value={getattr(self, '_mcp_servers_info', None)}")
        if hasattr(self, '_mcp_servers_info') and self._mcp_servers_info:
            logger.info(f"[Agent Initialize] Loading MCP tools with {len(self._mcp_servers_info)} servers")
            mcp_class = ToolRegistry.get_tool_class("MCP")
            if mcp_class:
                mcp_tool = mcp_class(mcp_servers_info=self._mcp_servers_info)
                tool_configs.append({
                    "name": "MCP",
                    "function": mcp_tool.execute,
                    "description": mcp_tool.get_tool_spec()["description"],
                    "parameters": mcp_tool.get_tool_spec()["parameters"],
                })
                for server_name, server_info in self._mcp_servers_info.items():
                    from ..plugins.tools.agent.mcp import MCPServerInfo
                    if isinstance(server_info, MCPServerInfo):
                        logger.info(
                            f"[MCP] Agent '{self.name}' using MCP server '{server_name}' "
                            f"with {len(server_info.tools)} tools, "
                            f"connected={server_info.is_connected}"
                        )
        elif self.config.mcp_servers:
            if isinstance(self.config.mcp_servers, dict) and any(
                isinstance(v, dict) and 'client' in v 
                for v in self.config.mcp_servers.values()
            ):
                mcp_class = ToolRegistry.get_tool_class("MCP")
                if mcp_class:
                    mcp_tool = mcp_class(mcp_servers_info=self.config.mcp_servers)
                    tool_configs.append({
                        "name": "MCP",
                        "function": mcp_tool.execute,
                        "description": mcp_tool.get_tool_spec()["description"],
                        "parameters": mcp_tool.get_tool_spec()["parameters"],
                    })
        
        if self.config.subagents:
            task_class = ToolRegistry.get_tool_class("Task")
            if task_class:
                task_tool = task_class(
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
            provider=self.config.provider,
            max_input_tokens=self.config.max_input_tokens,
            max_tool_calls=self.config.max_tool_calls,
        )
        
        if toolkit_executor:
            self._core.tool_executor = toolkit_executor

        # M9：_core._on_tool_executed/_on_tool_executing 回调桥接统一在 prepare_execution 注入
        #（initialize 仅负责构建 _core；prepare_execution 是执行前统一入口，每次执行都兜底注入，
        #  已初始化实例也确保生效，因此此处不再重复设置）

        if self._message_history:
            # SoloAgent 层负责将原始格式转换为 Msg 对象
            history_msgs = self._convert_history_to_msgs(self._message_history)
            self._core.load_history(history_msgs)
        
        self._initialized = True
        logger.info(f"SoloAgent '{self.name}' initialized with {len(tool_configs)} tools")
    
    def _create_openai_compatible_model(self, stream: bool = False):
        from ..model.openai_model import OpenAIChatModel

        generate_kwargs = {}
        if self.config.max_tokens is not None:
            generate_kwargs["max_tokens"] = self.config.max_tokens
        if self.config.temperature is not None:
            generate_kwargs["temperature"] = self.config.temperature
        if self.config.frequency_penalty is not None:
            generate_kwargs["frequency_penalty"] = self.config.frequency_penalty
        if self.config.presence_penalty is not None:
            generate_kwargs["presence_penalty"] = self.config.presence_penalty
        
        client_kwargs = {}
        if self.config.base_url:
            client_kwargs["base_url"] = self.config.base_url
        if self.config.timeout:
            import httpx
            client_kwargs["timeout"] = httpx.Timeout(float(self.config.timeout), connect=10.0)
        
        return OpenAIChatModel(
            model_name=self.config.model,
            api_key=self.config.api_key,
            stream=stream,
            client_kwargs=client_kwargs if client_kwargs else None,
            generate_kwargs=generate_kwargs if generate_kwargs else None,
            is_full_url=self.config.is_full_url,
        )
    
    async def reply(self, message: Msg, cancel_event: asyncio.Event = None) -> str:
        """
        处理用户消息并生成回复

        这是Agent的主要入口方法，使用ReAct核心处理用户输入并返回文本回复。

        Args:
            message: 用户输入消息
            cancel_event: 取消事件，用于中断处理

        Returns:
            str: Agent的文本回复

        Raises:
            RuntimeError: 当Agent核心未初始化时抛出
            Exception: 当处理过程中发生错误时抛出

        Example:
            >>> response = await agent.reply("Hello, how are you?")
            >>> print(response)
        """
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
        except asyncio.CancelledError:
            core = self._core
            content_list = getattr(core, '_last_collected_content', []) if core else []
            if not content_list and core:
                for msg in reversed(getattr(core, '_conversation_history', [])):
                    if getattr(msg, 'role', None) == "assistant":
                        content = getattr(msg, 'content', "")
                        if isinstance(content, str):
                            return content
                        if isinstance(content, list):
                            content_list = content
                            break
            return ChatResponse(content=content_list).get_text_content() or "任务执行被取消"
        except Exception as e:
            logger.error(f"Agent reply error: {e}")
            raise
    
    def get_last_openai_message(self) -> dict:
        if self._last_response is None:
            return {"role": "assistant", "content": "", "reasoning_content": None}
        
        if hasattr(self._last_response, 'to_openai_message'):
            return self._last_response.to_openai_message()
        
        if hasattr(self._last_response, 'get_text_content'):
            content = self._last_response.get_text_content()
            reasoning = self._last_response.get_reasoning_content() if hasattr(self._last_response, 'get_reasoning_content') else None
            return {"role": "assistant", "content": content, "reasoning_content": reasoning}
        
        return {"role": "assistant", "content": str(self._last_response), "reasoning_content": None}
    
    def get_token_usage(self) -> Optional[Dict]:
        # 剪枝（P8）：删除 _last_response.usage 遗留回退分支——core 无数据时（take 消费后）
        # 回退到最后一次响应 usage 会静默返回过期值（用户规则：错误直接暴露，禁止静默回退）。
        # 调用方（flow_compiler agent_complete metadata.tokens 等）均处理 None。
        if self._core:
            result = self._core.get_accumulated_usage()
            if result:
                return result
        return None

    def get_agent_usage(self) -> Optional[Dict]:
        """返回 agent 级整轮累计（后端聚合改造 3.2-2 透传方法）。

        透传 _core.get_agent_usage()：本次 _execute_agent 调用（整轮，含压缩轮
        stop/compacted/resume 各阶段）的完整累计。由 flow_compiler 在 agent_complete
        事件 metadata 中采集（agent_usage 字段）。
        """
        if self._core:
            return self._core.get_agent_usage()
        return None

    def take_token_usage(self) -> Optional[Dict]:
        """取走当前累计 usage 并清空（消息保存时消费，方案 B 独立快照）。

        替代 compact() 的主动重置：消息保存后调用，使下一条消息的 usage 从 0
        开始累计——压缩轮 stop / compacted / resume 与正常轮完全同路径。
        """
        if self._core:
            return self._core.take_accumulated_usage()
        return None

    # ---- A2：compiler 层经公开方法访问 agent/core 私有状态（不直接改私有属性）----

    # C2/C3：CompiledFlow 反向引用 & MCP 服务器信息 公开 setter/getter
    #（compiler 层不再直接写 _compiled_flow / _mcp_servers_info 私有字段）
    def set_compiled_flow(self, compiled_flow) -> None:
        """经公开 setter 写入 CompiledFlow 反向引用（C2：替代直接赋值 _compiled_flow）。"""
        self._compiled_flow = compiled_flow

    def set_mcp_servers_info(self, mcp_servers_info: Dict[str, "MCPServerInfo"]) -> None:
        """经公开 setter 写入 MCP 服务器信息（C2/C3：替代直接赋值 _mcp_servers_info）。"""
        self._mcp_servers_info = mcp_servers_info or {}

    def get_mcp_servers_info(self) -> Dict[str, "MCPServerInfo"]:
        """公开获取 MCP 服务器信息（C2：compiler 层经公开方法读取）。"""
        return self._mcp_servers_info

    # C1：父实例 message_id 公开 setter（替代直接写子实例私有 _parent_message_id）
    def set_parent_message_id(self, parent_message_id: Optional[str]) -> None:
        """设置父实例 message_id（agent_start 事件 metadata.parent_message_id 来源）。"""
        self._parent_message_id = parent_message_id

    # C4：初始化状态公开查询（替代直接读 _initialized 私有字段）
    def is_initialized(self) -> bool:
        """当前 Agent 是否已完成初始化（C4：flow_runner 经公开方法查询）。"""
        return self._initialized

    # C1：当前执行有效取消事件公开查询（prepare_execution 注入，跨层不再读 ReactCore 私有）
    def get_cancel_event(self) -> Optional[asyncio.Event]:
        """当前执行的有效取消事件（未开始执行时为 None）。"""
        return self._exec_cancel_event

    async def prepare_execution(
        self,
        message_id: str,
        cancel_event: asyncio.Event = None,
        event_callback: callable = None,
        working_dir: str = None,
        memory: List[Dict[str, Any]] = None,
    ) -> None:
        """执行前统一准备（A2：compiler 层唯一入口，封装对私有属性的全部直接访问）。

        统一封装 compiled_flow._execute_agent 此前直接改动的私有状态：
        - _event_callback 注入
        - set_file_change_context（working_dir，增量 diff 依赖）
        - set_message_history + initialize（未初始化时）
        - _core._on_tool_executed / _on_tool_executing 回调桥接（已初始化实例也确保生效）
        - _core.set_message_id + _message_id（执行实例标识 = session_message_id：
          所有 agent 统一由 _execute_agent 内部生成，prepare_execution 注入）
        """
        self._event_callback = event_callback
        # C1：保存当前执行的有效取消事件（_launch_subagent 传递子执行时使用）
        self._exec_cancel_event = cancel_event
        if working_dir:
            self.set_file_change_context(working_dir)
        if memory and hasattr(self, 'set_message_history'):
            self.set_message_history(memory)
        if not self._initialized:
            await self.initialize()
        if self._core is not None:
            self._core._on_tool_executed = self._on_tool_executed
            self._core._on_tool_executing = self._on_tool_executing
            self._core.set_message_id(message_id)
        self._message_id = message_id

    def get_core_model(self):
        """公开获取核心模型实例（A2：compiler 层不直接读 _core.model）。"""
        return self._core.model if self._core else None

    def is_interrupted(self) -> bool:
        """公开查询中断状态（A2：compiler 层不直接读 _core）。"""
        return self._core.is_interrupted() if self._core else False

    def get_conversation_history(self):
        """公开获取对话历史（A2：compiler 层不直接读 _core）。"""
        return self._core.get_conversation_history() if self._core else []

    def get_last_tool_calls(self) -> List[Dict[str, Any]]:
        """公开获取最近一轮工具调用（A2：compiler 层不直接读 _last_tool_calls）。"""
        return self._last_tool_calls.copy() if self._last_tool_calls else []

    def reset_agent_usage(self) -> None:
        """公开重置 agent 级整轮累计（A2：compiler 层不直接读 _core）。"""
        if self._core:
            self._core.reset_agent_usage()

    async def compact(self, cancel_event: asyncio.Event = None) -> None:
        """公开执行上下文压缩（A2：compiler 层不直接读 _core）。"""
        if self._core:
            await self._core.compact(cancel_event=cancel_event)
