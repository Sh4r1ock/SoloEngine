# SoloAgent 框架架构文档

## 1. 模块概述

### 1.1 作用

SoloAgent 是 SoloEngine 的核心运行时框架，实现了基于 ReAct（Reasoning + Acting）架构的智能体执行引擎。

### 1.2 定位

- **核心引擎**：提供 Agent 的推理-行动循环实现
- **插件架构**：通过标准化接口扩展 Agent 能力
- **模型抽象**：统一多种 LLM 提供商的调用接口

### 1.3 核心功能

| 功能 | 描述 |
|------|------|
| ReAct 循环 | 实现推理-行动-观察的迭代循环 |
| 多模型支持 | OpenAI、Anthropic、Qwen、Ollama、DeepSeek、智谱 |
| 插件系统 | 记忆、RAG、工具执行、MCP 客户端等 |
| 任务完成检测 | 自动判断任务是否完成 |

---

## 2. 设计理念

### 2.1 ReAct 架构

ReAct（Reasoning + Acting）是一种将推理和行动交替进行的 Agent 架构。每轮迭代包含：

```
┌─────────────────────────────────────────────────────────────┐
│                     ReAct 循环                               │
│                                                              │
│    ┌──────────┐    ┌──────────┐    ┌──────────────┐        │
│    │  Thought │ ──►│  Action  │ ──►│  Observation │        │
│    │  (思考)  │    │  (行动)  │    │   (观察)     │        │
│    └──────────┘    └──────────┘    └──────────────┘        │
│         ▲                                  │                │
│         └──────────────────────────────────┘                │
│                   (循环直到完成)                              │
└─────────────────────────────────────────────────────────────┘
```

**迭代过程**：

1. **Thought（思考）**：分析当前状态，决定下一步行动
2. **Action（行动）**：执行工具调用或生成响应
3. **Observation（观察）**：获取行动结果，更新状态

### 2.2 微内核架构

核心框架遵循**微内核架构**，核心只负责控制流，所有功能通过插件接口扩展：

```
┌─────────────────────────────────────────────────────────────┐
│                     ReAct Core (微内核)                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              控制流 (Control Flow)                    │   │
│  │  • 迭代循环管理                                       │   │
│  │  • 任务完成检测                                       │   │
│  │  • 消息格式化                                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
    ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
    │ IMemory │   │  IRAG   │   │IToolExec│   │IMCPClient│
    │ 记忆插件 │   │RAG插件  │   │工具执行器│   │MCP客户端│
    └─────────┘   └─────────┘   └─────────┘   └─────────┘
```

### 2.3 插件接口设计

所有插件通过抽象基类定义统一接口：

| 接口 | 职责 | 核心方法 |
|------|------|---------|
| `IMemory` | 对话历史和上下文存储 | `add()`, `retrieve()`, `clear()` |
| `IRAG` | 知识库检索增强 | `retrieve()`, `add_document()`, `clear()` |
| `IToolExecutor` | 工具调用执行 | `execute()`, `get_available_tools()`, `register_tool()` |
| `IMCPClient` | MCP 协议客户端 | `connect()`, `get_tools()`, `call_tool()` |
| `IPlanNotebook` | 任务规划管理 | `create_plan()`, `update_plan()`, `get_plan()` |
| `ITTSModel` | 语音合成 | `synthesize()` |

---

## 3. 实现方式

### 3.1 ReActCore 核心类

```python
from SoloAgent.core import ReActCore
from SoloAgent.model import LLMFactory
from SoloAgent.formatter import OpenAIChatFormatter

model = LLMFactory.create_model("openai", model_name="gpt-4", api_key="...")
formatter = OpenAIChatFormatter()

core = ReActCore(
    name="assistant",
    model=model,
    formatter=formatter,
    system_prompt="你是一个有帮助的助手。",
    max_iters=10,
)

response = await core.reply("请帮我分析这段代码")
```

**核心流程**：

```python
async def reply(self, message: str | Msg) -> Msg:
    # 1. 添加用户消息到历史
    self._conversation_history.append(user_msg)
    
    # 2. 从记忆和 RAG 检索上下文
    memory_context = await self.memory.retrieve(query)
    rag_context = await self.rag.retrieve(query)
    
    # 3. 进入推理-行动循环
    for iteration in range(self.max_iters):
        # 3.1 推理 (Thought)
        response = await self._reasoning(user_msg, system_prompt, iteration)
        
        # 3.2 检查是否完成
        if self._check_completion(response):
            return await self._generate_final_response(response)
        
        # 3.3 执行行动 (Action)
        tool_results = await self._acting(response)
        
        # 3.4 观察结果 (Observation)
        self._conversation_history.extend(tool_results)
    
    # 4. 达到最大迭代次数
    return await self._generate_final_response("max_iterations")
```

### 3.2 任务完成检测

支持多种模型的 API 响应格式：

| 模型 | 完成字段 | 完成值 | 工具调用值 |
|------|---------|--------|-----------|
| Claude | `stop_reason` | `end_turn` | `tool_use` |
| OpenAI | `finish_reason` | `stop` | `tool_calls` |
| GLM/DeepSeek | `finish_reason` | `stop` | `tool_calls` |

```python
class StopReason(Enum):
    END_TURN = "end_turn"
    TOOL_USE = "tool_use"
    MAX_TOKENS = "max_tokens"
    
    @classmethod
    def from_api_response(cls, response: ChatResponse) -> "StopReason":
        stop_reason = getattr(response, "stop_reason", None)
        finish_reason = getattr(response, "finish_reason", None)
        
        reason = stop_reason or finish_reason
        
        if reason in ("end_turn", "stop"):
            return cls.END_TURN
        elif reason in ("tool_use", "tool_calls"):
            return cls.TOOL_USE
        # ...
```

### 3.3 LLM 模型抽象

通过工厂模式创建不同提供商的模型实例：

```python
from SoloAgent.model import LLMFactory

# 创建 OpenAI 模型
model = LLMFactory.create_model(
    provider="openai",
    model_name="gpt-4o",
    api_key="sk-..."
)

# 创建 Anthropic 模型
model = LLMFactory.create_model(
    provider="anthropic",
    model_name="claude-3-5-sonnet-20241022",
    api_key="..."
)

# 创建 Ollama 本地模型
model = LLMFactory.create_model(
    provider="ollama",
    model_name="llama3",
    base_url="http://localhost:11434"
)

# 查询可用模型
providers = LLMFactory.get_available_providers()
models = LLMFactory.get_available_models("openai")
```

---

## 4. 组件和库

### 4.1 目录结构

```
backend/SoloAgent/
├── core/                    # 核心模块
│   ├── react_core.py       # ReAct 核心实现
│   └── interfaces.py       # 插件接口定义
│
├── model/                   # LLM 模型层
│   ├── model_base.py       # 模型基类
│   ├── llm_factory.py      # 模型工厂
│   ├── openai_model.py     # OpenAI 实现
│   ├── anthropic_model.py  # Anthropic 实现
│   ├── qwen_model.py       # 通义千问实现
│   ├── ollama_model.py     # Ollama 实现
│   └── ...
│
├── formatter/               # 消息格式化器
│   ├── formatter_base.py   # 格式化器基类
│   ├── openai_formatter.py # OpenAI 格式
│   └── ...
│
├── plugins/                 # 插件实现
│   ├── memory/             # 记忆插件
│   ├── rag/                # RAG 插件
│   ├── tools/              # 工具插件
│   ├── mcp/                # MCP 客户端
│   └── tts/                # TTS 插件
│
├── solo_agent/              # Agent 组装
│   └── solo_agent.py       # Agent 实例构建
│
├── message.py               # 消息类型定义
├── types.py                 # 类型定义
└── utils/                   # 工具函数
```

### 4.2 核心依赖

| 依赖 | 用途 |
|------|------|
| `asyncio` | 异步执行 |
| `openai` | OpenAI API 客户端 |
| `anthropic` | Anthropic API 客户端 |
| `dashscope` | 通义千问 API 客户端 |
| `mcp` | MCP 协议 SDK |

---

## 5. 插件接口详解

### 5.1 IMemory 记忆插件

用于存储和检索对话历史，支持向量相似度检索：

```python
from SoloAgent.core.interfaces import IMemory

class VectorMemoryPlugin(IMemory):
    async def add(self, msg: Msg) -> None:
        # 将消息向量化后存储
        embedding = await self._get_embedding(msg.get_text_content())
        self._store(msg, embedding)
    
    async def retrieve(self, query: str, limit: int = 5) -> List[Msg]:
        # 基于相似度检索相关消息
        query_embedding = await self._get_embedding(query)
        return self._search(query_embedding, limit)
    
    async def clear(self) -> None:
        self._messages.clear()
```

### 5.2 IRAG 检索增强插件

用于从知识库中检索相关文档：

```python
from SoloAgent.core.interfaces import IRAG

class KnowledgeBaseRAGPlugin(IRAG):
    async def retrieve(self, query: str, limit: int = 5) -> List[dict]:
        # 检索相关文档
        results = await self._vector_search(query, limit)
        return [{"content": r.content, "metadata": r.metadata} for r in results]
    
    async def add_document(self, content: str, metadata: dict = None) -> str:
        # 添加文档到知识库
        doc_id = self._generate_id()
        chunks = self._split_content(content)
        for chunk in chunks:
            await self._store_chunk(doc_id, chunk, metadata)
        return doc_id
```

### 5.3 IToolExecutor 工具执行器

用于执行 Agent 决定调用的工具：

```python
from SoloAgent.core.interfaces import IToolExecutor

class ToolkitExecutor(IToolExecutor):
    def __init__(self):
        self._tools: Dict[str, Callable] = {}
    
    async def execute(self, tool_call: dict, **kwargs) -> dict:
        tool_name = tool_call["name"]
        arguments = tool_call.get("arguments", {})
        
        if tool_name not in self._tools:
            return {"error": f"Tool '{tool_name}' not found"}
        
        try:
            result = await self._tools[tool_name](**arguments)
            return {"content": result, "success": True}
        except Exception as e:
            return {"content": str(e), "success": False}
    
    def get_available_tools(self) -> List[dict]:
        return [self._get_tool_spec(name) for name in self._tools]
    
    async def register_tool(self, tool_spec: dict) -> None:
        self._tools[tool_spec["name"]] = tool_spec["function"]
```

### 5.4 IMCPClient MCP 客户端

用于与 MCP 服务器交互：

```python
from SoloAgent.core.interfaces import IMCPClient

class MCPClient(IMCPClient):
    async def connect(self) -> None:
        # 建立 MCP 连接
        self._session = await self._create_session()
        await self._session.initialize()
    
    async def get_tools(self) -> List[dict]:
        # 获取 MCP 服务器提供的工具
        result = await self._session.list_tools()
        return result.tools
    
    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        # 调用 MCP 工具
        result = await self._session.call_tool(tool_name, arguments)
        return {"content": result.content, "is_error": result.isError}
```

---

## 6. LLM 模型支持

### 6.1 支持的提供商

| 提供商 | 标识符 | 默认模型 | 特点 |
|--------|--------|---------|------|
| OpenAI | `openai` | `gpt-4` | GPT-4, GPT-4o, o3-mini |
| Anthropic | `anthropic` | `claude-3-5-sonnet-20241022` | Claude 3 系列 |
| 通义千问 | `qwen` | `qwen-plus` | 阿里云大模型 |
| Ollama | `ollama` | `llama2` | 本地模型 |
| DeepSeek | `deepseek` | `deepseek-chat` | DeepSeek 模型 |
| 智谱 | `zhipu` | `glm-4` | GLM 系列 |

### 6.2 模型创建示例

```python
from SoloAgent.model import LLMFactory

# OpenAI
openai_model = LLMFactory.create_model(
    provider="openai",
    model_name="gpt-4o",
    api_key="sk-...",
    stream=True
)

# Anthropic Claude
claude_model = LLMFactory.create_model(
    provider="anthropic",
    model_name="claude-3-5-sonnet-20241022",
    api_key="..."
)

# 通义千问
qwen_model = LLMFactory.create_model(
    provider="qwen",
    model_name="qwen-max",
    api_key="..."
)

# Ollama 本地模型
ollama_model = LLMFactory.create_model(
    provider="ollama",
    model_name="llama3",
    base_url="http://localhost:11434"
)

# DeepSeek
deepseek_model = LLMFactory.create_model(
    provider="deepseek",
    model_name="deepseek-chat",
    api_key="..."
)

# 智谱 GLM
zhipu_model = LLMFactory.create_model(
    provider="zhipu",
    model_name="glm-4",
    api_key="..."
)
```

### 6.3 模型基类

所有模型继承自 `ChatModelBase`：

```python
from SoloAgent.model import ChatModelBase, ChatResponse

class ChatModelBase(ABC):
    @abstractmethod
    async def __call__(
        self,
        messages: List[dict],
        tools: List[dict] = None,
        **kwargs
    ) -> ChatResponse:
        """调用 LLM API"""
        pass
    
    @property
    @abstractmethod
    def model_name(self) -> str:
        """模型名称"""
        pass
    
    @property
    @abstractmethod
    def provider(self) -> str:
        """提供商名称"""
        pass
```

---

## 7. 消息格式

### 7.1 Msg 消息类

统一的消息格式：

```python
from SoloAgent.message import Msg

# 创建消息
msg = Msg(
    name="user",
    content="你好，请帮我分析这段代码",
    role="user"
)

# 获取文本内容
text = msg.get_text_content()

# 添加到对话历史
conversation_history.append(msg)
```

### 7.2 内容块类型

支持多种内容块：

| 类型 | 描述 |
|------|------|
| `TextBlock` | 文本内容 |
| `ToolUseBlock` | 工具调用请求 |
| `ToolResultBlock` | 工具调用结果 |

```python
# 工具调用消息
tool_use_msg = Msg(
    name="assistant",
    content=[
        {"type": "text", "text": "让我帮你搜索..."},
        {"type": "tool_use", "id": "call_123", "name": "search", "input": {"query": "test"}}
    ],
    role="assistant"
)

# 工具结果消息
tool_result_msg = Msg(
    name="tool",
    content={"type": "tool_result", "tool_use_id": "call_123", "content": "搜索结果..."},
    role="user"
)
```

---

## 8. 使用示例

### 8.1 基础 Agent

```python
from SoloAgent.core import ReActCore
from SoloAgent.model import LLMFactory
from SoloAgent.formatter import OpenAIChatFormatter

# 创建模型
model = LLMFactory.create_model("openai", model_name="gpt-4o", api_key="...")
formatter = OpenAIChatFormatter()

# 创建 Agent
agent = ReActCore(
    name="assistant",
    model=model,
    formatter=formatter,
    system_prompt="你是一个有帮助的助手。",
    max_iters=10
)

# 对话
response = await agent.reply("你好！")
print(response.get_text_content())
```

### 8.2 带工具的 Agent

```python
from SoloAgent.plugins.tools import ToolkitExecutor

# 创建工具执行器
executor = ToolkitExecutor()

# 注册工具
@executor.register
def search(query: str) -> str:
    """搜索网页内容"""
    return f"搜索结果: {query}"

@executor.register
def calculate(expression: str) -> float:
    """计算数学表达式"""
    return eval(expression)

# 创建带工具的 Agent
agent = ReActCore(
    name="assistant",
    model=model,
    formatter=formatter,
    system_prompt="你是一个有帮助的助手，可以使用工具。",
    tool_executor=executor,
    max_iters=10
)

response = await agent.reply("帮我搜索 Python 教程")
```

### 8.3 带记忆的 Agent

```python
from SoloAgent.plugins.memory import VectorMemoryPlugin

# 创建记忆插件
memory = VectorMemoryPlugin(embedding_model="text-embedding-3-small")

# 创建带记忆的 Agent
agent = ReActCore(
    name="assistant",
    model=model,
    formatter=formatter,
    system_prompt="你是一个有帮助的助手。",
    memory=memory,
    max_iters=10
)

# 多轮对话
await agent.reply("我叫张三")
await agent.reply("我喜欢编程")
response = await agent.reply("你还记得我的名字吗？")
# Agent 会从记忆中检索之前的信息
```

---

## 9. 配置选项

### 9.1 ReActCore 参数

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `name` | str | 必填 | Agent 名称 |
| `model` | ChatModelBase | 必填 | LLM 模型实例 |
| `formatter` | FormatterBase | 必填 | 消息格式化器 |
| `system_prompt` | str | 必填 | 系统提示词 |
| `memory` | IMemory | None | 记忆插件 |
| `rag` | IRAG | None | RAG 插件 |
| `tool_executor` | IToolExecutor | None | 工具执行器 |
| `max_iters` | int | 10 | 最大迭代次数 |
| `print_hint_msg` | bool | False | 是否打印调试信息 |

### 9.2 模型参数

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `model_name` | str | 提供商默认 | 模型名称 |
| `stream` | bool | True | 是否流式输出 |
| `api_key` | str | None | API 密钥 |
| `base_url` | str | None | 自定义 API 地址 |
| `temperature` | float | 0.7 | 温度参数 |
| `max_tokens` | int | 4096 | 最大 Token 数 |

---

## 10. 扩展开发

### 10.1 实现自定义插件

```python
from SoloAgent.core.interfaces import IMemory
from SoloAgent.message import Msg

class CustomMemoryPlugin(IMemory):
    def __init__(self, storage_path: str):
        self._storage = self._load_storage(storage_path)
    
    async def add(self, msg: Msg) -> None:
        self._storage.append(msg)
        self._save()
    
    async def retrieve(self, query: str, limit: int = 5) -> List[Msg]:
        # 自定义检索逻辑
        return self._search(query, limit)
    
    async def clear(self) -> None:
        self._storage.clear()
    
    async def get_memory_state(self) -> dict:
        return {"messages": [m.to_dict() for m in self._storage]}
    
    async def set_memory_state(self, state: dict) -> None:
        self._storage = [Msg.from_dict(m) for m in state.get("messages", [])]
```

### 10.2 实现自定义模型

```python
from SoloAgent.model import ChatModelBase, ChatResponse

class CustomModel(ChatModelBase):
    def __init__(self, model_name: str, api_key: str, **kwargs):
        self._model_name = model_name
        self._client = CustomClient(api_key)
    
    async def __call__(
        self,
        messages: List[dict],
        tools: List[dict] = None,
        **kwargs
    ) -> ChatResponse:
        response = await self._client.chat(messages, tools=tools)
        return ChatResponse(
            content=response.content,
            stop_reason=response.stop_reason,
            usage=response.usage
        )
    
    @property
    def model_name(self) -> str:
        return self._model_name
    
    @property
    def provider(self) -> str:
        return "custom"
```
