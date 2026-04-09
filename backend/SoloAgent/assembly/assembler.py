# -*- coding: utf-8 -*-
"""
SoloEngine : Agent组装器模块，提供灵活的Agent组装功能

@file assembler.py
@description 提供灵活的Agent组装功能，支持多种插件配置方式
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块提供Agent组装器，包括：
    - ReActAgent: ReAct Agent组装器
    - 支持灵活的插件配置方式（字典、列表、实例）
    - 自动处理插件依赖和初始化
    - 支持多种传输协议的MCP客户端
    - 支持记忆、RAG、工具、MCP、计划、TTS插件

配置方式：
    1. None: 完全禁用该功能
    2. dict: 使用配置字典创建单个实例
    3. list[dict]: 创建多个实例
    4. 实例对象: 直接使用提供的实例

支持的插件类型：
    - memory_config: 记忆插件配置（向量记忆/黑洞记忆）
    - rag_config: RAG插件配置（知识库检索）
    - tool_configs: 工具配置（本地工具）
    - mcp_configs: MCP客户端配置（远程工具）
    - plan_config: 计划插件配置（任务规划）
    - tts_config: TTS插件配置（语音合成）

依赖:
    - typing: 类型提示
    - inspect: 反射检查
    - logging: 日志记录
    - ..core.react_core: ReAct核心
    - ..core.interfaces: 核心接口
    - ..plugins.memory: 记忆插件
    - ..plugins.rag: RAG插件
    - ..plugins.tools: 工具插件
    - ..plugins.mcp: MCP客户端
    - ..plugins.plan: 计划插件
    - ..model: 聊天模型
    - ..formatter: 格式化器

使用示例:
    - from SoloAgent.assembly import ReActAgent
    - agent = ReActAgent(
    -     name="assistant",
    -     model=model,
    -     formatter=formatter,
    -     system_prompt="你是一个助手"
    - )
    - await agent.connect_mcp_servers()
    - response = await agent.reply("你好！")
"""

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
    """
    ReAct Agent组装器

    职责:
        - 提供Agent组装的主要入口
        - 支持灵活的插件配置（字典、列表、实例）
        - 管理MCP客户端连接
        - 注入计划上下文
        - 集成TTS语音合成

    属性:
        name: Agent名称
        _core: ReActCore核心实例
        _plan_plugin: 计划插件
        _tts_plugin: TTS插件
        _mcp_clients: MCP客户端列表
        _model: 聊天模型
        _formatter: 格式化器
        _system_prompt: 系统提示词

    生命周期:
        1. 创建实例：解析配置，创建插件实例
        2. 连接MCP：调用connect_mcp_servers()
        3. 使用Agent：调用reply()方法
        4. 断开连接：调用disconnect_mcp_servers()

    示例:
        >>> from SoloAgent.model import OpenAIChatModel
        >>> from SoloAgent.formatter import OpenAIChatFormatter
        >>> model = OpenAIChatModel(model_name="gpt-4")
        >>> formatter = OpenAIChatFormatter()
        >>> agent = ReActAgent(
        ...     name="assistant",
        ...     model=model,
        ...     formatter=formatter,
        ...     system_prompt="你是一个助手",
        ...     enable_memory=True,
        ...     enable_tools=True
        ... )
        >>> await agent.connect_mcp_servers()
        >>> response = await agent.reply("你好！")
    """
    
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
        """
        初始化 ReAct Agent 组装器。
        
        Args:
            name (str): Agent 名称，用于标识和日志。
            model (ChatModelBase): LLM 模型实例，用于推理。
            formatter (FormatterBase): 消息格式化器，将 Msg 对象
                转换为模型 API 所需的格式。
            system_prompt (str): 系统提示词，定义 Agent 的角色和行为。
            
            memory_config (None | dict | list[dict] | IMemory, optional):
                记忆插件配置。支持以下格式：
                - None: 禁用记忆功能
                - dict: 单个记忆配置，如 {"type": "vector", "max_size": 1000}
                - list[dict]: 多个记忆配置（使用第一个）
                - IMemory 实例: 直接使用提供的实例
                默认为 None。
            
            rag_config (None | dict | list[dict] | IRAG, optional):
                RAG 插件配置。支持以下格式：
                - None: 禁用 RAG 功能
                - dict: 单个 RAG 配置
                - list[dict]: 多个 RAG 配置（使用第一个）
                - IRAG 实例: 直接使用提供的实例
                默认为 None。
            
            tool_configs (None | dict | list[dict] | IToolExecutor, optional):
                本地工具配置。支持以下格式：
                - None: 无本地工具
                - dict: 单个工具配置
                - list[dict]: 多个工具配置
                - IToolExecutor 实例: 直接使用提供的实例
                默认为 None。
            
            mcp_configs (None | dict | list[dict] | list[IMCPClient], optional):
                MCP 客户端配置。支持以下格式：
                - None: 无 MCP 客户端
                - dict: 单个 MCP 配置
                - list[dict]: 多个 MCP 配置
                - list[IMCPClient]: 直接使用提供的客户端列表
                默认为 None。
            
            plan_config (None | dict | IPlanNotebook, optional):
                计划插件配置。支持以下格式：
                - None: 禁用计划功能
                - dict: 计划配置，如 {"storage_path": "./plans", "auto_save": True}
                - IPlanNotebook 实例: 直接使用提供的实例
                默认为 None。
            
            tts_config (None | dict | ITTSModel, optional):
                TTS 插件配置。支持以下格式：
                - None: 禁用 TTS 功能
                - dict: TTS 配置，如 {"provider": "openai", "voice": "alloy"}
                - ITTSModel 实例: 直接使用提供的实例
                默认为 None。
            
            enable_memory (bool, optional): 当 memory_config 为 None 时，
                是否启用默认记忆插件。默认为 True。
            enable_rag (bool, optional): 当 rag_config 为 None 时，
                是否启用默认 RAG 插件。默认为 False。
            enable_tools (bool, optional): 当 tool_configs 和 mcp_configs
                都为 None 时，是否启用默认工具。默认为 False。
            print_hint_msg (bool, optional): 是否打印调试信息。
                默认为 False。
            max_iters (int, optional): 最大迭代次数。默认为 10。
        
        Note:
            - enable_* 参数仅在对应 config 为 None 时生效
            - MCP 客户端需要单独调用 connect_mcp_servers() 连接
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
        """
        处理用户消息并生成回复。
        
        这是 Agent 的主要交互方法，执行以下步骤：
        1. 如果配置了计划插件，注入计划上下文
        2. 调用 ReActCore 生成回复
        3. 如果配置了 TTS 插件，将回复转换为语音
        
        Args:
            message (str): 用户输入消息。
        
        Returns:
            str: Agent 的回复文本。
        
        Note:
            - TTS 转换失败不会影响文本回复
            - 计划上下文会自动注入到消息开头
        """
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
        """
        将计划上下文注入到用户消息中。
        
        在消息开头添加当前计划的状态信息，帮助 Agent 了解
        当前的任务进度和待执行步骤。
        
        Args:
            message (str): 原始用户消息。
            plan (dict): 当前计划对象，包含：
                - name: 计划名称
                - current_step: 当前步骤索引
                - total_steps: 总步骤数
                - progress: 完成进度（0-1）
                - steps: 步骤列表
        
        Returns:
            str: 注入计划上下文后的消息。
        """
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
        """
        格式化待执行步骤列表。
        
        将步骤列表格式化为可读的文本，最多显示 5 个步骤。
        
        Args:
            steps (list): 步骤列表，每个步骤包含：
                - status: 步骤状态（pending, in_progress, completed）
                - description: 步骤描述
        
        Returns:
            str: 格式化后的步骤文本。
        """
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
        """
        处理记忆插件配置。
        
        根据配置类型创建或返回记忆插件实例。
        
        Args:
            config: 记忆配置，支持多种格式。
            enable_switch: 当 config 为 None 时是否启用默认记忆。
        
        Returns:
            Optional[IMemory]: 记忆插件实例，如果禁用则返回 None。
        
        Raises:
            TypeError: 当配置类型不支持时抛出。
        
        Note:
            - type="vector": 创建 VectorMemoryPlugin（默认）
            - type="blackhole": 创建 BlackholeMemoryPlugin（不存储）
        """
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
        """
        处理 RAG 插件配置。
        
        根据配置类型创建或返回 RAG 插件实例。
        
        Args:
            config: RAG 配置，支持多种格式。
            enable_switch: 当 config 为 None 时是否启用默认 RAG。
        
        Returns:
            Optional[IRAG]: RAG 插件实例，如果禁用则返回 None。
        
        Raises:
            TypeError: 当配置类型不支持时抛出。
        """
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
        """
        处理工具配置（包括本地工具和 MCP 工具）。
        
        合并本地工具和 MCP 工具，创建统一的工具执行器。
        
        Args:
            tool_configs: 本地工具配置。
            mcp_configs: MCP 客户端配置。
            enable_switch: 当两者都为 None 时是否启用默认工具。
        
        Returns:
            tuple: (工具执行器, MCP 客户端列表)
                - 工具执行器: 如果没有工具则返回 None
                - MCP 客户端列表: 所有创建的 MCP 客户端
        
        Note:
            - MCP 工具会自动从客户端获取并添加到执行器
            - 默认工具包括 search 和 calculator
        """
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
        """
        处理 MCP 客户端配置列表。
        
        将配置转换为 MCP 客户端实例列表。
        
        Args:
            configs: MCP 配置，支持多种格式。
        
        Returns:
            List[IMCPClient]: MCP 客户端实例列表。
        """
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
        """
        根据配置创建 MCP 客户端。
        
        支持三种传输协议：
        - stdio: 通过标准输入输出通信
        - sse: 通过 Server-Sent Events 通信
        - http: 通过 HTTP/Streamable HTTP 通信
        
        Args:
            config (dict): MCP 客户端配置，包含：
                - transport: 传输协议类型
                - command: stdio 命令（stdio 协议）
                - args: 命令参数（stdio 协议）
                - url: 服务器 URL（sse/http 协议）
                - headers: 请求头（sse/http 协议）
                - timeout: 超时时间（http 协议）
        
        Returns:
            Optional[IMCPClient]: MCP 客户端实例，创建失败返回 None。
        """
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
        """
        处理计划插件配置。
        
        根据配置创建或返回计划插件实例。
        
        Args:
            config: 计划配置，支持多种格式。
        
        Returns:
            Optional[IPlanNotebook]: 计划插件实例，如果禁用则返回 None。
        """
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
        """
        处理 TTS 插件配置。
        
        根据配置创建或返回 TTS 插件实例。
        
        Args:
            config: TTS 配置，支持多种格式。
        
        Returns:
            Optional[ITTSModel]: TTS 插件实例，如果禁用则返回 None。
        """
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
        """
        根据配置创建 TTS 插件。
        
        支持四种 TTS 提供商：
        - openai: OpenAI TTS API
        - azure: Azure Cognitive Services
        - edge: Edge TTS（免费）
        - local: 本地模型
        
        Args:
            config (dict): TTS 配置，包含：
                - provider: 提供商类型
                - api_key: API 密钥（openai）
                - model: 模型名称（openai）
                - voice: 语音角色
                - output_path: 输出路径
        
        Returns:
            Optional[ITTSModel]: TTS 插件实例，创建失败返回 None。
        """
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
        """
        默认搜索工具。
        
        提供基本的搜索功能占位实现。
        实际使用时应替换为真实的搜索服务。
        
        Args:
            query (str): 搜索查询。
            limit (int, optional): 结果数量限制。默认为 5。
        
        Returns:
            dict: 搜索结果，包含 content 和 success 字段。
        """
        return {
            "content": f"Search results for '{query}' (limit: {limit})",
            "success": True,
        }
    
    async def _default_calculator_tool(self, expression: str) -> Dict[str, Any]:
        """
        默认计算器工具。
        
        使用 Python eval 函数计算数学表达式。
        注意：使用受限的 eval 环境，仅支持数学运算。
        
        Args:
            expression (str): 数学表达式，如 "2 + 3 * 4"。
        
        Returns:
            dict: 计算结果，包含 content 和 success 字段。
        
        Warning:
            虽然使用了受限的 eval 环境，但仍需注意安全性。
            生产环境建议使用更安全的表达式解析器。
        """
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
        """
        连接所有 MCP 服务器。
        
        遍历所有 MCP 客户端并建立连接。
        应在使用 Agent 前调用此方法。
        
        Returns:
            dict: 连接结果，键为客户端索引，值为是否成功。
        
        Example:
            >>> results = await agent.connect_mcp_servers()
            >>> print(results)  # {"mcp_client_0": True, "mcp_client_1": False}
        """
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
        """
        断开所有 MCP 服务器连接。
        
        清理所有 MCP 客户端资源。
        应在使用完 Agent 后调用此方法。
        """
        for client in self._mcp_clients:
            try:
                await client.disconnect()
            except Exception as e:
                logger.warning(f"Failed to disconnect MCP client: {e}")
    
    def get_plan_plugin(self) -> Optional[IPlanNotebook]:
        """
        获取计划插件实例。
        
        Returns:
            Optional[IPlanNotebook]: 计划插件实例，如果未配置则返回 None。
        """
        return self._plan_plugin
    
    def get_tts_plugin(self) -> Optional[ITTSModel]:
        """
        获取 TTS 插件实例。
        
        Returns:
            Optional[ITTSModel]: TTS 插件实例，如果未配置则返回 None。
        """
        return self._tts_plugin
    
    def get_mcp_clients(self) -> List[IMCPClient]:
        """
        获取所有 MCP 客户端实例。
        
        Returns:
            List[IMCPClient]: MCP 客户端列表的副本。
        """
        return self._mcp_clients.copy()
