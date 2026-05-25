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
from typing import Optional, List, Dict, Any, AsyncGenerator, TYPE_CHECKING

from .config import SoloAgentConfig
from ..utils.message_utils import MessageBlockExtractor

if TYPE_CHECKING:
    from ..core.react_core import ReActCore
    from ..model.model_base import BaseLLM
    from ..plugins.mcp.mcp_client import MCPClient
    from ..plugins.tools.agent.mcp import MCPServerInfo

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
        _mcp_clients (List[MCPClient]): MCP客户端列表
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
        self._mcp_clients: List["MCPClient"] = []
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

    def set_file_change_context(self, working_dir: str) -> None:
        self._working_dir = working_dir or ""
        self._pre_tool_hashes = {}
        from ..plugins.tools.file.base import set_file_tool_working_dir
        set_file_tool_working_dir(self._working_dir)
        logger.info(f"[set_file_change_context] working_dir={working_dir}")

    FILE_OP_TOOLS = {"Write", "SearchReplace", "DeleteFile", "write_file", "search_replace", "delete_file", "create_file", "edit_file"}

    MCP_FILE_PATH_PARAMS = {
        "path", "file_path", "filePath", "filepath",
        "source_path", "target_path", "output_path", "destination",
        "notebook_path", "image_path", "document_path",
        "directory", "dir_path", "folder_path",
    }

    MCP_FILE_PATH_ARRAY_PARAMS = {
        "paths", "files", "file_paths", "filePaths",
    }

    async def _on_tool_executing(self, tool_call: Dict) -> None:
        tool_name = tool_call.get("name")

        if tool_name in self.FILE_OP_TOOLS:
            file_paths = self._extract_all_file_paths(tool_call)
            for fp in file_paths:
                abs_path = os.path.join(self._working_dir, fp) if not os.path.isabs(fp) else fp
                if os.path.exists(abs_path):
                    from app.core.content_addressable_storage import cas
                    from app.utils.file_utils import normalize_file_path
                    before_hash = cas.store_file(abs_path)
                    rel_path = normalize_file_path(abs_path, self._working_dir)
                    self._pre_tool_hashes[rel_path] = before_hash

        elif self._is_mcp_tool(tool_name):
            file_paths = self._extract_mcp_file_paths(tool_call)
            for fp in file_paths:
                abs_path = os.path.join(self._working_dir, fp) if not os.path.isabs(fp) else fp
                if os.path.exists(abs_path):
                    from app.core.content_addressable_storage import cas
                    from app.utils.file_utils import normalize_file_path
                    before_hash = cas.store_file(abs_path)
                    rel_path = normalize_file_path(abs_path, self._working_dir)
                    self._pre_tool_hashes[rel_path] = before_hash

    def _extract_file_path(self, tool_call: Dict) -> Optional[str]:
        args = tool_call.get("arguments", {}) or tool_call.get("function", {}).get("arguments", {})
        if isinstance(args, str):
            import json
            try:
                args = json.loads(args)
            except Exception:
                return None
        return args.get("path") or args.get("file_path") or args.get("filePath")

    def _extract_all_file_paths(self, tool_call: Dict) -> List[str]:
        args = tool_call.get("arguments", {}) or tool_call.get("function", {}).get("arguments", {})
        if isinstance(args, str):
            import json
            try:
                args = json.loads(args)
            except Exception:
                return []

        paths = []
        single = args.get("path") or args.get("file_path") or args.get("filePath")
        if single and isinstance(single, str):
            paths.append(single)

        multi = args.get("file_paths") or args.get("filePaths")
        if multi and isinstance(multi, list):
            paths.extend([p for p in multi if isinstance(p, str)])

        return paths

    def _is_mcp_tool(self, tool_name: str) -> bool:
        return tool_name not in self.FILE_OP_TOOLS and tool_name not in {"RunCommand", "Task"}

    def _extract_mcp_file_paths(self, tool_call: Dict) -> List[str]:
        args = tool_call.get("arguments", {}) or {}
        if isinstance(args, str):
            import json
            try:
                args = json.loads(args)
            except Exception:
                return []

        file_paths = []

        for param_name in self.MCP_FILE_PATH_PARAMS:
            if param_name in args and isinstance(args[param_name], str):
                val = args[param_name]
                if self._looks_like_file_path(val):
                    file_paths.append(val)

        for param_name, val in args.items():
            if param_name in self.MCP_FILE_PATH_PARAMS:
                continue
            if isinstance(val, str) and self._looks_like_file_path(val):
                param_lower = param_name.lower()
                if any(kw in param_lower for kw in ("path", "file", "dir", "output", "dest", "source", "target", "folder", "location", "uri")):
                    file_paths.append(val)

        for param_name in self.MCP_FILE_PATH_ARRAY_PARAMS:
            if param_name in args and isinstance(args[param_name], list):
                file_paths.extend([p for p in args[param_name] if isinstance(p, str) and self._looks_like_file_path(p)])

        if "uri" in args and isinstance(args["uri"], str) and args["uri"].startswith("file://"):
            from urllib.parse import urlparse
            parsed = urlparse(args["uri"])
            if parsed.path:
                file_paths.append(parsed.path)

        return list(set(file_paths))

    def _looks_like_file_path(self, val: str) -> bool:
        if not val or len(val) < 2:
            return False
        return (
            val.startswith("/") or
            val.startswith("./") or
            val.startswith("..") or
            val.startswith("~") or
            (len(val) > 2 and val[1] == ":") or
            "." in os.path.basename(val)
        )

    async def _on_tool_executed(self, tool_call: Dict, result: Any):
        if not self._working_dir:
            return

        tool_name = tool_call.get("name")
        change_list = []

        try:
            if tool_name in self.FILE_OP_TOOLS:
                from app.services.file_change import file_change_manager
                changes = file_change_manager.compute_incremental_change(
                    tool_call=tool_call,
                    working_dir=self._working_dir
                )
                change_list = changes if isinstance(changes, list) else ([changes] if changes else [])
                for change in change_list:
                    if change:
                        fp = change.get("file_path", "")
                        abs_path = os.path.join(self._working_dir, fp)

                        if fp in self._pre_tool_hashes and change.get("operation") == "created":
                            change["operation"] = "modified"

                        if change.get("operation") == "deleted":
                            change["before_content_hash"] = self._pre_tool_hashes.pop(fp, None)
                            change["after_content_hash"] = None
                        elif os.path.exists(abs_path):
                            from app.core.content_addressable_storage import cas
                            after_hash = cas.store_file(abs_path)
                            change["before_content_hash"] = self._pre_tool_hashes.get(fp)
                            change["after_content_hash"] = after_hash
                            self._pre_tool_hashes[fp] = after_hash

                        if change.get("content_type", "text") == "text":
                            if change.get("operation") == "deleted":
                                if change.get("before_content_hash"):
                                    try:
                                        from app.core.content_addressable_storage import cas
                                        from app.utils.file_utils import compute_text_diff
                                        old_bytes = cas.get_content(change["before_content_hash"])
                                        old_content = old_bytes.decode('utf-8', errors='replace') if old_bytes else ""
                                        diff_data = compute_text_diff(old_content, "", fp)
                                        change["diff"] = diff_data
                                    except Exception as e:
                                        logger.warning(f"Failed to compute diff for deleted {fp}: {e}")
                            elif os.path.exists(abs_path):
                                try:
                                    from app.core.content_addressable_storage import cas
                                    from app.utils.file_utils import compute_text_diff
                                    if change.get("before_content_hash"):
                                        old_bytes = cas.get_content(change["before_content_hash"])
                                        old_content = old_bytes.decode('utf-8', errors='replace') if old_bytes else ""
                                    else:
                                        old_content = ""
                                    with open(abs_path, 'rb') as f:
                                        new_content = f.read().decode('utf-8', errors='replace')
                                    diff_data = compute_text_diff(old_content, new_content, fp)
                                    change["diff"] = diff_data
                                except Exception as e:
                                    logger.warning(f"Failed to compute diff for {fp}: {e}")

                        if "content_type" not in change:
                            from app.utils.file_utils import get_content_type
                            change["content_type"] = get_content_type(fp)

            elif self._is_mcp_tool(tool_name):
                file_paths = self._extract_mcp_file_paths(tool_call)
                from app.core.content_addressable_storage import cas
                from app.utils.file_utils import get_content_type, normalize_file_path
                for fp in file_paths:
                    abs_path = os.path.join(self._working_dir, fp) if not os.path.isabs(fp) else fp
                    rel_path = normalize_file_path(abs_path, self._working_dir)
                    before_hash = self._pre_tool_hashes.get(rel_path)
                    content_type = get_content_type(rel_path)

                    if os.path.exists(abs_path):
                        after_hash = cas.store_file(abs_path)
                        if before_hash and before_hash != after_hash:
                            change_list.append({
                                "file_path": rel_path,
                                "operation": "modified",
                                "tool_call_id": tool_call.get("id"),
                                "before_content_hash": before_hash,
                                "after_content_hash": after_hash,
                                "content_type": content_type,
                            })
                        elif not before_hash:
                            change_list.append({
                                "file_path": rel_path,
                                "operation": "created",
                                "tool_call_id": tool_call.get("id"),
                                "before_content_hash": None,
                                "after_content_hash": after_hash,
                                "content_type": content_type,
                            })
                    elif before_hash:
                        change_list.append({
                            "file_path": rel_path,
                            "operation": "deleted",
                            "tool_call_id": tool_call.get("id"),
                            "before_content_hash": before_hash,
                            "after_content_hash": None,
                            "content_type": content_type,
                        })

            if change_list and self._event_callback:
                from ..solo_agent.compiler.flow_compiler import ExecutionEvent
                event = ExecutionEvent(
                    event_type="file_change_preview",
                    agent_id=self.agent_id,
                    agent_name=self.name,
                    file_changes=change_list,
                )
                self._event_callback(event)

        except Exception as e:
            logger.warning(f"Failed to compute change: {e}", exc_info=True)
    
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
            if subagent._core:
                subagent._core.stream_callback = callback
                subagent._core.agent_id = subagent.agent_id
                if hasattr(subagent._core, '_tool_call_event_manager') and subagent._core._tool_call_event_manager:
                    subagent._core._tool_call_event_manager.stream_callback = callback
                    subagent._core._tool_call_event_manager.agent_id = subagent.agent_id
                    subagent._core._tool_call_event_manager.agent_name = subagent.name
    
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
                            rc = block.get("reasoning_content", block.get("content", ""))
                            content_list.append({"type": "reasoning_content", "reasoning_content": rc if isinstance(rc, str) else str(rc)})
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
                                rc = block.get("reasoning_content", block.get("content", ""))
                                thinking_parts.append(rc if isinstance(rc, str) else str(rc or ""))
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
            timeout=self.config.timeout if hasattr(self.config, 'timeout') and self.config.timeout else 60,
        )
        
        provider = llm_config.get("provider", self.config.provider).lower()
        
        openai_compatible_providers = ["deepseek", "zhipu", "qwen"]
        
        if provider in openai_compatible_providers:
            self._llm = self._create_openai_compatible_model(llm_config, stream=True)
        else:
            factory_kwargs = {}
            if llm_config.get("base_url"):
                factory_kwargs["base_url"] = llm_config.get("base_url")
            if llm_config.get("timeout"):
                import httpx
                factory_kwargs["client_kwargs"] = {"timeout": httpx.Timeout(float(llm_config["timeout"]), connect=10.0)}
            if llm_config.get("max_tokens"):
                factory_kwargs["generate_kwargs"] = {"max_tokens": llm_config["max_tokens"]}
            if llm_config.get("temperature") is not None:
                factory_kwargs.setdefault("generate_kwargs", {})["temperature"] = llm_config["temperature"]
            
            self._llm = LLMFactory.create_model(
                provider=provider,
                model_name=llm_config.get("model", self.config.model),
                api_key=llm_config.get("api_key"),
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
        )
        
        if toolkit_executor:
            self._core.tool_executor = toolkit_executor

        if hasattr(self._core, '_on_tool_executed') and hasattr(self._core, '_on_tool_executing'):
            self._core._on_tool_executed = self._on_tool_executed
            self._core._on_tool_executing = self._on_tool_executing
            logger.info(f"[SoloAgent] Set _on_tool_executed callback, pre_tool_hashes={len(self._pre_tool_hashes)}, working_dir={self._working_dir}")
            logger.info(f"[SoloAgent] _core._on_tool_executed is now: {self._core._on_tool_executed is not None}")
        else:
            logger.warning(f"[SoloAgent] _core does not have _on_tool_executed attribute")

        if self._message_history:
            # SoloAgent 层负责将原始格式转换为 Msg 对象
            history_msgs = self._convert_history_to_msgs(self._message_history)
            self._core.load_history(history_msgs)
        
        self._initialized = True
        logger.info(f"SoloAgent '{self.name}' initialized with {len(tool_configs)} tools")
    
    def _create_openai_compatible_model(self, llm_config: Dict[str, Any], stream: bool = False):
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
        
        client_kwargs = {}
        if llm_config.get("base_url"):
            client_kwargs["base_url"] = llm_config.get("base_url")
        if llm_config.get("timeout"):
            import httpx
            client_kwargs["timeout"] = httpx.Timeout(float(llm_config["timeout"]), connect=10.0)
        
        return OpenAIChatModel(
            model_name=llm_config.get("model", self.config.model),
            api_key=llm_config.get("api_key"),
            stream=stream,
            client_kwargs=client_kwargs if client_kwargs else None,
            generate_kwargs=generate_kwargs if generate_kwargs else None,
        )
    
    async def reply(self, message: str, cancel_event: asyncio.Event = None) -> str:
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
        if self._core:
            result = self._core.get_accumulated_usage()
            if result:
                return result
        if self._last_response and hasattr(self._last_response, 'usage') and self._last_response.usage:
            usage = self._last_response.usage
            return {
                "prompt_tokens": getattr(usage, 'input_tokens', None),
                "completion_tokens": getattr(usage, 'output_tokens', None),
                "total_tokens": (getattr(usage, 'input_tokens', 0) or 0) + (getattr(usage, 'output_tokens', 0) or 0),
                "duration_ms": int(getattr(usage, 'time', 0) * 1000) if hasattr(usage, 'time') else 0,
            }
        return None
    
    async def stream(self, message: str) -> AsyncGenerator[str, None]:
        """
        流式处理用户消息并生成回复

        以流式方式处理用户输入，逐步返回生成的文本片段。

        Args:
            message: 用户输入消息

        Returns:
            AsyncGenerator[str, None]: 文本片段的异步生成器

        Raises:
            RuntimeError: 当Agent核心未初始化时抛出

        Example:
            >>> async for chunk in agent.stream("Tell me a story"):
            ...     print(chunk, end="")
        """
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
        """
        调用指定工具

        根据工具名称查找并执行工具，返回执行结果。

        Args:
            tool_name: 工具名称
            arguments: 工具参数字典

        Returns:
            Dict[str, Any]: 工具执行结果，包含success和result字段

        Raises:
            ValueError: 当工具不存在或没有execute方法时抛出

        Example:
            >>> result = await agent.call_tool("search", {"query": "python"})
            >>> print(result["result"])
        """
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
        """
        调用子Agent执行任务

        根据子Agent名称查找并分配任务，返回执行结果。

        Args:
            subagent_name: 子Agent名称
            task: 任务描述

        Returns:
            str: 子Agent的执行结果

        Raises:
            ValueError: 当子Agent不存在时抛出

        Example:
            >>> result = await agent.call_subagent("code_reviewer", "Review this code")
            >>> print(result)
        """
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
        """
        关闭Agent并清理资源

        关闭所有MCP客户端连接，重置初始化状态。

        Args:
            无参数

        Returns:
            None

        Raises:
            无异常抛出

        Example:
            >>> await agent.close()
            >>> print("Agent closed")
        """
        for client in self._mcp_clients:
            if hasattr(client, 'close'):
                await client.close()
        
        self._mcp_clients = []
        self._initialized = False
