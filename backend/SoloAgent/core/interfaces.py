# -*- coding: utf-8 -*-
"""
ReAct核心机制-interfaces.py: 定义SoloEngine的核心插件接口，实现模块化的Agent架构

@file interfaces.py
@description 定义ReAct核心所需的插件接口规范，支持可扩展的插件架构
@author Sh4rlock
@date 2026-04-09

功能描述：
本模块定义ReAct核心机制所需的插件接口规范，提供以下核心接口：
- IMemory: 记忆插件接口，用于对话历史和上下文存储
- IRAG: 检索增强生成插件接口，用于知识库检索
- IToolExecutor: 工具执行器接口，用于工具调用
- IMCPClient: MCP客户端接口，用于Model Context Protocol
- IPlanNotebook: 计划笔记本接口，用于任务规划
- ITTSModel: TTS模型接口，用于语音合成

设计模式：
- 策略模式：不同插件实现相同接口，可互换使用
- 依赖注入：ReAct核心通过接口注入插件依赖
- 开闭原则：对扩展开放，对修改关闭

依赖:
- abc: 抽象基类定义
- typing: 类型提示
- ..message: 消息类型
- ..types: 可序列化对象类型

使用示例:
- class MyMemory(IMemory): ...
- core = ReActCore(memory=MyMemory())
"""

from abc import ABC, abstractmethod
from typing import Optional, List

from ..message import Msg
from ..types import JSONSerializableObject


class IMemory(ABC):
    """
    记忆插件接口。
    
    定义 Agent 记忆系统的标准接口，用于存储和检索对话历史、
    上下文信息等。支持向量检索和语义相似度匹配。
    
    实现类：
        - VectorMemoryPlugin: 基于向量相似度的记忆检索
        - BlackholeMemoryPlugin: 不存储任何内容的空记忆实现
    
    设计理念：
        记忆系统是 Agent 的长期记忆层，区别于对话历史的短期记忆。
        通过语义检索，Agent 可以在大量历史对话中找到相关上下文。
    
    Example:
        >>> memory = VectorMemoryPlugin(config)
        >>> await memory.add(user_message)
        >>> relevant_msgs = await memory.retrieve("用户之前问过什么？")
    """
    
    @abstractmethod
    async def add(self, msg: Msg) -> None:
        """
        将消息添加到记忆存储中。
        
        将消息向量化后存储，用于后续的相似度检索。
        消息会被自动分配向量嵌入（如果配置了嵌入服务）。
        
        Args:
            msg (Msg): 要添加的消息对象，包含角色、内容等信息。
                消息内容会被提取文本后进行向量化。
        
        Raises:
            EmbeddingError: 当向量化失败时抛出（如果使用向量记忆）
        
        Note:
            - 消息添加后可能不会立即可检索，取决于具体实现
            - 部分实现可能有容量限制，会自动淘汰旧消息
        """
        pass
    
    @abstractmethod
    async def retrieve(
        self, 
        query: str, 
        limit: int = 5
    ) -> List[Msg]:
        """
        从记忆中检索相关消息。
        
        基于语义相似度检索与查询最相关的历史消息。
        返回的消息按相关性降序排列。
        
        Args:
            query (str): 查询文本，用于计算与存储消息的相似度。
            limit (int, optional): 返回消息的最大数量。默认为 5。
        
        Returns:
            List[Msg]: 相关消息列表，按相似度降序排列。
                如果没有匹配的消息，返回空列表。
        
        Note:
            - 相似度阈值由具体实现配置决定
            - 查询文本会被向量化后与存储的向量比较
        """
        pass
    
    @abstractmethod
    async def clear(self) -> None:
        """
        清空记忆存储。
        
        删除所有存储的消息和对应的向量嵌入。
        此操作不可逆，谨慎使用。
        
        Warning:
            此操作会永久删除所有记忆数据，无法恢复。
        """
        pass
    
    @abstractmethod
    async def get_memory_state(self) -> dict:
        """
        获取当前记忆状态。
        
        返回记忆系统的状态信息，用于持久化和恢复。
        状态信息包括消息数量、配置参数等。
        
        Returns:
            dict: 记忆状态字典，包含：
                - message_count: 当前存储的消息数量
                - max_size: 最大容量
                - config: 配置参数
                - 其他实现特定的状态信息
        
        Note:
            返回的状态可用于 set_memory_state 恢复状态。
        """
        pass
    
    @abstractmethod
    async def set_memory_state(self, state: dict) -> None:
        """
        设置记忆状态。
        
        从状态字典恢复记忆系统的状态。
        通常用于从持久化存储加载记忆。
        
        Args:
            state (dict): 记忆状态字典，由 get_memory_state 生成。
        
        Note:
            - 设置状态会覆盖当前状态
            - 状态格式应与 get_memory_state 返回的格式一致
        """
        pass


class IRAG(ABC):
    """
    检索增强生成（RAG）插件接口。
    
    定义知识库检索的标准接口，用于从外部知识库中检索
    相关文档以增强 Agent 的回答能力。
    
    实现类：
        - KnowledgeBaseRAGPlugin: 基于向量相似度的知识库检索
    
    设计理念：
        RAG 系统为 Agent 提供外部知识访问能力，通过语义检索
        从知识库中找到与用户问题相关的文档片段。
    
    与 IMemory 的区别：
        - IMemory: 存储对话历史，用于上下文记忆
        - IRAG: 存储外部知识，用于知识增强
    
    Example:
        >>> rag = KnowledgeBaseRAGPlugin(config)
        >>> await rag.add_document("产品说明书内容...", metadata={"source": "manual"})
        >>> docs = await rag.retrieve("如何使用产品？")
    """
    
    @abstractmethod
    async def retrieve(
        self, 
        query: str, 
        limit: int = 5
    ) -> List[dict]:
        """
        从知识库中检索相关文档。
        
        基于语义相似度检索与查询最相关的文档。
        返回的文档按相关性降序排列。
        
        Args:
            query (str): 查询文本，用于计算与文档的相似度。
            limit (int, optional): 返回文档的最大数量。默认为 5。
        
        Returns:
            List[dict]: 相关文档列表，每个文档是包含以下字段的字典：
                - content (str): 文档内容
                - metadata (dict): 文档元数据
                - similarity (float): 相似度分数（可选）
                如果没有匹配的文档，返回空列表。
        
        Note:
            - 相似度阈值由具体实现配置决定
            - 文档可能被分块存储，返回的是相关块
        """
        pass
    
    @abstractmethod
    async def add_document(
        self,
        content: str,
        metadata: Optional[dict[str, JSONSerializableObject]] = None
    ) -> str:
        """
        将文档添加到知识库中。
        
        将文档内容向量化后存储到知识库。
        支持自动分块处理长文档。
        
        Args:
            content (str): 文档内容文本。
            metadata (dict, optional): 文档元数据，可包含：
                - source: 文档来源
                - title: 文档标题
                - created_at: 创建时间
                - 其他自定义字段
        
        Returns:
            str: 文档 ID，用于后续操作（如删除）。
        
        Note:
            - 长文档会自动分块存储
            - 元数据会关联到所有分块
        """
        pass
    
    @abstractmethod
    async def clear(self) -> None:
        """
        清空知识库。
        
        删除所有存储的文档和对应的向量嵌入。
        此操作不可逆，谨慎使用。
        
        Warning:
            此操作会永久删除所有知识库数据，无法恢复。
        """
        pass


class IToolExecutor(ABC):
    """
    工具执行器接口。
    
    定义工具调用和管理的标准接口，用于执行 Agent 决定调用的工具。
    支持同步和异步工具函数。
    
    实现类：
        - ToolkitExecutor: 默认工具执行器实现
    
    设计理念：
        工具执行器是 Agent 与外部系统交互的桥梁。Agent 通过
        工具调用执行各种操作，如搜索、计算、API 调用等。
    
    工具生命周期：
        1. 注册工具（register_tool）
        2. 获取可用工具列表（get_available_tools）
        3. 执行工具调用（execute）
    
    Example:
        >>> executor = ToolkitExecutor()
        >>> executor.register_function(search_function, name="search")
        >>> result = await executor.execute({"name": "search", "arguments": {"query": "test"}})
    """
    
    @abstractmethod
    async def execute(
        self, 
        tool_call: dict,
        **kwargs
    ) -> dict:
        """
        执行工具调用。
        
        根据工具调用规范执行对应的工具函数，返回执行结果。
        
        Args:
            tool_call (dict): 工具调用规范，包含：
                - name (str): 工具名称
                - id (str): 调用 ID（可选）
                - arguments (dict): 工具参数
            **kwargs: 额外的执行上下文参数，如：
                - timeout: 超时时间
                - retry_count: 重试次数
        
        Returns:
            dict: 工具执行结果，包含：
                - content: 执行结果内容
                - success (bool): 是否成功
                - error_message (str): 错误信息（如果失败）
        
        Raises:
            ToolNotFoundError: 当工具不存在时抛出
            ToolInvalidArgumentsError: 当参数无效时抛出
            ToolExecutionError: 当工具执行失败时抛出
        
        Note:
            - 异步工具函数会被自动 await
            - 执行错误会被捕获并返回在结果中
        """
        pass
    
    @abstractmethod
    def get_available_tools(self) -> List[dict]:
        """
        获取可用工具列表。
        
        返回所有已注册工具的规范列表，用于告知 LLM 可用的工具。
        
        Returns:
            List[dict]: 工具规范列表，每个规范包含：
                - name (str): 工具名称
                - description (str): 工具描述
                - parameters (dict): 参数规范（JSON Schema 格式）
        
        Note:
            返回的规范格式兼容 OpenAI Function Calling 格式。
        """
        pass
    
    @abstractmethod
    async def register_tool(self, tool_spec: dict) -> None:
        """
        注册新工具。
        
        将工具添加到执行器的工具注册表中。
        
        Args:
            tool_spec (dict): 工具规范，包含：
                - name (str): 工具名称（唯一标识）
                - function (Callable): 工具函数
                - description (str): 工具描述
                - parameters (dict): 参数规范
        
        Raises:
            ValueError: 当工具名称已存在或规范无效时抛出
        
        Note:
            - 工具名称必须唯一
            - 工具函数可以是同步或异步函数
        """
        pass


class IMCPClient(ABC):
    """
    MCP（Model Context Protocol）客户端接口。
    
    定义与 MCP 服务器交互的标准接口。MCP 是一种标准化的
    工具和资源协议，允许 Agent 访问外部工具和资源。
    
    传输协议：
        - stdio: 通过标准输入输出通信
        - sse: 通过 Server-Sent Events 通信
        - http: 通过 HTTP/Streamable HTTP 通信
    
    实现类：
        - MCPClient: 使用官方 MCP Python SDK 的客户端实现
    
    设计理念：
        MCP 提供了一种标准化的方式来扩展 Agent 的能力，
        支持工具调用、资源访问和提示词模板。
    
    Example:
        >>> client = MCPClient({"transport": "stdio", "command": "mcp-server"})
        >>> await client.connect()
        >>> tools = await client.get_tools()
        >>> result = await client.call_tool("search", {"query": "test"})
    """
    
    @abstractmethod
    async def connect(self) -> None:
        """
        连接到 MCP 服务器。
        
        建立与 MCP 服务器的连接，初始化会话。
        连接成功后可以获取工具、资源和提示词列表。
        
        Raises:
            ConnectionError: 当连接失败时抛出
            TimeoutError: 当连接超时时抛出
        
        Note:
            - 连接是幂等的，重复调用不会重新连接
            - 连接失败时会抛出异常
        """
        pass
    
    @abstractmethod
    async def disconnect(self) -> None:
        """
        断开与 MCP 服务器的连接。
        
        关闭连接并清理资源。断开后所有工具、资源和提示词
        将不可用，直到重新连接。
        
        Note:
            - 断开是幂等的，重复调用不会报错
            - 断开后应重新调用 connect 才能使用
        """
        pass
    
    @abstractmethod
    async def get_tools(self) -> List[dict]:
        """
        获取 MCP 服务器提供的工具列表。
        
        返回服务器上所有可用工具的规范列表。
        
        Returns:
            List[dict]: 工具规范列表，每个规范包含：
                - name (str): 工具名称
                - description (str): 工具描述
                - inputSchema (dict): 输入参数规范（JSON Schema）
        
        Note:
            如果未连接，会自动尝试连接。
        """
        pass
    
    @abstractmethod
    async def call_tool(
        self,
        tool_name: str,
        arguments: dict
    ) -> dict:
        """
        调用 MCP 服务器上的工具。
        
        执行远程工具调用并返回结果。
        
        Args:
            tool_name (str): 要调用的工具名称。
            arguments (dict): 工具参数字典。
        
        Returns:
            dict: 工具执行结果，包含：
                - success (bool): 是否成功
                - content (list): 内容列表
                - is_error (bool): 是否为错误结果
        
        Raises:
            ToolNotFoundError: 当工具不存在时抛出
            ConnectionError: 当连接断开时抛出
        
        Note:
            如果未连接，会自动尝试连接。
        """
        pass


class IPlanNotebook(ABC):
    """
    计划笔记本接口。
    
    定义任务计划和目标管理的标准接口。支持创建、更新、
    查询和删除计划，用于复杂任务的分解和跟踪。
    
    设计理念：
        计划笔记本帮助 Agent 管理复杂任务的执行过程，
        将大任务分解为可追踪的小步骤。
    
    计划结构：
        - goal: 计划目标
        - steps: 执行步骤列表
        - status: 步骤状态（pending, in_progress, completed）
        - progress: 完成进度
    
    Example:
        >>> planner = PlanNotebookPlugin()
        >>> plan = await planner.create_plan("完成项目报告", steps=[...])
        >>> await planner.update_plan(plan["id"], {"current_step": 1})
    """
    
    @abstractmethod
    async def create_plan(
        self,
        goal: str,
        **kwargs
    ) -> dict:
        """
        创建新计划。
        
        根据目标创建执行计划，可包含预定义的步骤。
        
        Args:
            goal (str): 计划目标描述。
            **kwargs: 额外参数，可包含：
                - steps (list): 预定义步骤列表
                - metadata (dict): 计划元数据
        
        Returns:
            dict: 创建的计划对象，包含：
                - id (str): 计划 ID
                - goal (str): 计划目标
                - steps (list): 步骤列表
                - status (str): 计划状态
                - created_at (str): 创建时间
        """
        pass
    
    @abstractmethod
    async def update_plan(
        self,
        plan_id: str,
        updates: dict
    ) -> None:
        """
        更新计划。
        
        更新计划的属性或步骤状态。
        
        Args:
            plan_id (str): 计划 ID。
            updates (dict): 更新内容，可包含：
                - current_step: 当前步骤索引
                - steps: 步骤列表更新
                - status: 计划状态
                - metadata: 元数据更新
        
        Raises:
            PlanNotFoundError: 当计划不存在时抛出
        """
        pass
    
    @abstractmethod
    async def get_plan(self, plan_id: str) -> Optional[dict]:
        """
        获取计划详情。
        
        根据计划 ID 获取完整的计划信息。
        
        Args:
            plan_id (str): 计划 ID。
        
        Returns:
            Optional[dict]: 计划对象，如果不存在则返回 None。
        """
        pass
    
    @abstractmethod
    async def delete_plan(self, plan_id: str) -> None:
        """
        删除计划。
        
        删除指定的计划及其所有步骤。
        
        Args:
            plan_id (str): 计划 ID。
        
        Raises:
            PlanNotFoundError: 当计划不存在时抛出
        
        Warning:
            删除操作不可逆，计划数据将永久丢失。
        """
        pass


class ITTSModel(ABC):
    """
    TTS（Text-to-Speech）模型接口。
    
    定义语音合成的标准接口，支持将文本转换为语音。
    
    实现类：
        - OpenAITTSModel: OpenAI TTS API 实现
        - AzureTTSModel: Azure Cognitive Services 实现
        - EdgeTTSModel: Edge TTS 实现
        - LocalTTSModel: 本地模型实现
    
    设计理念：
        TTS 插件为 Agent 提供语音输出能力，支持多种
        语音合成服务和模型。
    
    Example:
        >>> tts = OpenAITTSModel(api_key="...", voice="alloy")
        >>> audio_data = await tts.synthesize("你好，世界！")
        >>> with open("output.mp3", "wb") as f:
        ...     f.write(audio_data)
    """
    
    @abstractmethod
    async def synthesize(
        self,
        text: str,
        **kwargs
    ) -> bytes:
        """
        将文本合成为语音。
        
        Args:
            text (str): 要合成的文本内容。
            **kwargs: 额外参数，可包含：
                - voice: 语音角色
                - speed: 语速
                - format: 输出格式
        
        Returns:
            bytes: 音频数据（二进制格式）。
        
        Raises:
            TTSError: 当语音合成失败时抛出
        
        Note:
            - 返回的音频格式取决于具体实现
            - 长文本可能需要分块处理
        """
        pass


__all__ = [
    "IMemory",
    "IRAG",
    "IToolExecutor",
    "IMCPClient",
    "IPlanNotebook",
    "ITTSModel",
]
