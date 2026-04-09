<div align="center">

<img src="../../icon/SoloEngine.png" alt="SoloEngine" width="300"/>

[!\[Python\](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square\&logo=python\&logoColor=white null)](https://www.python.org/)
[!\[FastAPI\](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square\&logo=fastapi\&logoColor=white null)](https://fastapi.tiangolo.com/)
[!\[React\](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square\&logo=react\&logoColor=white null)](https://reactjs.org/)
[!\[TypeScript\](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square\&logo=typescript\&logoColor=white null)](https://www.typescriptlang.org/)
[!\[License\](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square null)](./LICENSE)

**语言**: [English](../../README.md) | 简体中文 | [Español](./README_ES.md) | [Deutsch](./README_DE.md) | [Français](./README_FR.md)

</div>

***

## 目录

- [什么是 SoloEngine？](#什么是-soloengine)
- [设计理念](#设计理念)
- [核心功能](#核心功能)
- [快速开始](#快速开始)
- [系统架构](#系统架构)
- [核心概念](#核心概念)
- [项目结构](#项目结构)
- [技术栈](#技术栈)
- [路线图](#路线图)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

***

## 什么是 SoloEngine？

SoloEngine 是一个**开源的低代码Agentic AI开发框架**，旨在让开发者能够轻松构建、部署和管理复杂的 AI Agent 工作流。它采用可视化画布设计，原生支持多 Agent 协作、工具调用、MCP 协议集成，以及渐进式Skill披露机制。

SoloEngine 的核心是一个基于 **ReAct（Reasoning + Acting）** 范式的智能体执行引擎，通过插件化架构实现高度可扩展性，支持多种 LLM 提供商和工具集成。

***

## 设计理念

### 核心设计原则

| 原则           | 说明                                                  |
| ------------ | --------------------------------------------------- |
| **可视化编排**    | 基于 React Flow 的拖拽式画布，直观设计多 Agent 协作流程               |
| **插件化架构**    | 通过抽象接口定义（IMemory、IToolExecutor、IMCPClient 等）实现模块化扩展 |
| **ReAct 范式** | 采用 Reasoning + Acting 循环，让 Agent 能够思考、行动、观察并迭代      |
| **多模型统一**    | 统一的模型适配层，屏蔽不同 LLM 提供商的 API 差异                       |
| **渐进式披露**    | Skill 和工具采用轻量元数据展示，详情按需加载，优化 Token 消耗                   |
| **安全沙箱**     | 项目隔离、工具权限控制、命令安全检查，确保执行安全                           |

***

## 核心功能

### 🤖 多智能体编排

- **可视化画布**：基于 React Flow 的拖拽式工作流设计
- **灵活的 Agent 配置**：通过设置不同的提示词、工具、Skill，实现不同的 Agent 角色
  - **四种预设 Agent 类型**：
    - **Custom（自定义）**：用户自由配置的 Agent，作为空白模板使用
    - **Orchestrator（协调者）**：协调多个 SubAgent，分配任务，汇总结果
    - **Planner（规划者）**：分析问题，制定执行计划
    - **Executor（执行者）**：执行具体任务，调用工具和 Skill
- **拓扑排序编译**：从下向上编译，自动解析 Agent 依赖关系
- **并发执行**：支持多 Agent 并行执行和结果聚合
- **SubAgent 委托**：通过 Task 工具将子任务委托给专门的 SubAgent 执行

### 🔧 丰富的工具生态

SoloEngine 内置完整的工具集，覆盖文件操作、命令执行、网络访问等场景：

| 工具类别      | 工具名称               | 功能描述                   |
| --------- | ------------------ | ---------------------- |
| **文件操作**  | Read               | 读取文件内容，支持行号范围          |
| <br />    | Write              | 写入文件                   |
| <br />    | DeleteFile         | 删除文件                   |
| <br />    | LS                 | 列出目录内容                 |
| <br />    | SearchReplace      | 搜索并替换文件内容              |
| **搜索**    | Grep               | 正则搜索文件内容               |
| <br />    | Glob               | 模式匹配搜索文件               |
| <br />    | SearchCodebase     | 语义化代码搜索                |
| **命令**    | RunCommand         | 执行 Shell 命令，支持阻塞/非阻塞模式 |
| <br />    | CheckCommandStatus | 检查命令执行状态               |
| <br />    | StopCommand        | 停止运行中的命令               |
| <br />    | GetDiagnostics     | 获取代码诊断信息               |
| **网络**    | WebSearch          | 网络搜索                   |
| <br />    | WebFetch           | 抓取网页内容                 |
| **Agent** | Skill              | 调用 Skill                 |
| <br />    | Task               | 启动 SubAgent            |
| <br />    | MCP                | 调用 MCP 工具              |
| **Ask**   | AskUserQuestion    | 向用户提问                  |
| <br />    | TodoWrite          | 创建待办事项                 |

**工具调用流式输出四事件机制**：

SoloEngine 实现了完整的工具调用四事件生命周期管理，确保前端实时展示工具调用状态：

| 事件                 | 触发时机         | 数据内容                          |
| ------------------ | ------------ | ----------------------------- |
| `TOOL_CALL_START`  | 检测到新的工具调用 ID | `{id, name, status: "start"}` |
| `TOOL_CALL_ARGS`   | 增量传输参数（可能多次） | `{id, arguments: "..."}`      |
| `TOOL_CALL_END`    | 参数传输完成       | `{id, status: "end"}`         |
| `TOOL_CALL_RESULT` | 工具执行结果返回     | `{id, result, error?}`        |

**前端格式统一**：所有事件转换为 `{type: "tool_calls", tool_calls: [...]}` 格式，通过 WebSocket 实时推送。

### 🎯 Skill 系统（Skills）

Skill 是可复用的 AI 能力模块，采用**渐进式披露**设计：

```
skill-name/
├── SKILL.md          # 必需：Skill 定义和指令
├── references/       # 可选：参考文档
├── scripts/          # 可选：辅助脚本
├── templates/        # 可选：模板文件
└── assets/           # 可选：资源文件
```

**渐进式披露机制**：

| 级别  | 时机        | 内容                           | Token 消耗     |
| --- | --------- | ---------------------------- | ------------ |
| 第一级 | Tool Spec | name + description           | \~100 tokens |
| 第二级 | Skill 调用  | SKILL.md 完整内容 + folder\_path | 按需           |
| 第三级 | 模型自主      | 嵌套资源（references/、templates/） | 按需           |

**Skill 编辑与创建系统**：

SoloEngine 提供完整的 Skill 管理功能：

- **创建 Skill**：通过 API 或界面创建新的 Skill 包
- **编辑 SKILL.md**：在线编辑 Skill 定义和指令
- **文件管理**：管理 references/、scripts/、templates/、assets/ 目录
- **导入导出**：支持 ZIP 格式导入导出 Skill 包
- **系统 Skill**：预置系统级 Skill，用户可参考学习

### 🔌 MCP 协议支持

完整支持 **Model Context Protocol**（Anthropic 提出的模型上下文协议），采用 **Host-Client 分层架构** 和 **渐进发现模式**：

**架构设计**：

```
┌─────────────────────────────────────────────────────────────┐
│                     CompiledFlow (Host层)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           MCPHostClientManager (统一管理)            │   │
│  │  - 编译时收集所有Agent配置的mcp_servers并集            │   │
│  │  - 统一创建和注册MCPClient                           │   │
│  │  - 管理Client生命周期(连接、断开)                     │   │
│  │  - 多个Agent共享同一个Client                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        MCPTool (工具层)                      │
│  - 统一入口调用MCP服务器工具                                 │
│  - 渐进发现模式: Discovery → Schema → Execution            │
│  - 只注入服务器列表到System Prompt，不注入具体工具            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                       MCPClient (Client层)                   │
│  - stdio：通过标准输入输出与本地 MCP 服务器通信               │
│  - SSE：通过 Server-Sent Events 与远程服务器通信             │
│  - HTTP：通过 Streamable HTTP 进行双向通信                   │
└─────────────────────────────────────────────────────────────┘
```

**渐进发现模式（三层递进）**：

| 层级                     | 调用方式                                                                   | 返回内容                 | Token节省  |
| ---------------------- | ---------------------------------------------------------------------- | -------------------- | -------- |
| **Tier 1 - Discovery** | `MCP(server_name="github")`                                            | 该服务器所有工具列表（名称+简介）    | 避免注入全部工具 |
| **Tier 2 - Schema**    | `MCP(server_name="github", tool_name="create_issue")`                  | 单个/批量工具详情（含参数schema） | 按需加载     |
| **Tier 3 - Execution** | `MCP(server_name="github", tool_name="create_issue", arguments={...})` | 工具执行结果               | 精确执行     |

**Python 编写 MCP 服务**：

SoloEngine 支持用户使用 Python 编写自定义 MCP 服务器：

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-custom-server")

@mcp.tool()
def my_tool(param: str) -> str:
    """自定义工具描述"""
    return f"处理结果: {param}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

**MCP 服务管理**：

- 支持 HTTP/SSE/Stdio 传输协议
- 导入开源 MCP Server 配置（GitHub、Filesystem、PostgreSQL 等）
- 创建和管理自定义 MCP Server
- 在线编辑 Python Function 代码，自动编译为 MCP Server
- 测试 MCP Server 连接
- 获取 MCP Server 列表和资源

### 💬 运行面板

- **实时流式输出**：WebSocket 实时推送执行状态和 LLM 响应
- **会话管理**：支持多会话切换和历史记录
- **文件浏览器**：集成项目文件管理
- **代码编辑器**：基于 Monaco Editor 的代码编辑体验
- **调用记录**：实时展示工具调用、Skill 调用、MCP 调用状态

### 🔌 插件化架构

通过抽象接口实现高度可扩展性：

```python
class IToolExecutor(ABC):
    """工具执行器接口"""
    async def execute(self, tool_call: dict) -> dict: ...
    def get_available_tools(self) -> List[dict]: ...

class IMCPClient(ABC):
    """MCP 客户端接口"""
    async def connect(self) -> None: ...
    async def call_tool(self, tool_name: str, arguments: dict) -> dict: ...
```

***

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- npm 或 yarn

### 安装步骤

1. **克隆仓库**

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine
```

2. **安装后端依赖**

```bash
cd backend
pip install -r requirements.txt
```

3. **安装前端依赖**

```bash
cd frontend
npm install
```

4. **启动服务**

```bash
# 启动后端 (端口 8990)
cd backend
python main.py

# 启动前端 (端口 8991)
cd frontend
npm run dev
```

5. **访问应用**

打开浏览器访问 `http://localhost:8991`

### 端口配置

| 服务   | 端口   | 说明          |
| ---- | ---- | ----------- |
| 主后端  | 8990 | FastAPI 服务  |
| 前端页面 | 8991 | React 开发服务器 |

***

## 核心概念

### AgenticFlow

AgenticFlow 是 SoloEngine 的核心概念，代表一个完整的 AI 工作流。它由画布 JSON 定义，包含节点（Agent）和边（调用关系）。

```json
{
  "nodes": [
    {
      "id": "agent_1",
      "type": "agent",
      "data": {
        "name": "代码助手",
        "agentType": "executor",
        "system_prompt": "你是一个专业的编程助手...",
        "tools": ["Read", "Write", "RunCommand", "Skill", "MCP"],
        "skills": ["algorithmic-art"],
        "mcp_tools": ["github"]
      }
    }
  ],
  "edges": [
    { "source": "agent_1", "target": "agent_2" }
  ]
}
```

### Agent 配置

SoloEngine 中的各 Agent 没有本质区别，**所有 Agent 都是相同的执行单元**。所谓的"类型"只是预设的不同配置：

| 配置项                | 说明                      |
| ------------------ | ----------------------- |
| **system\_prompt** | 系统提示词，定义 Agent 的角色和行为   |
| **tools**          | 可用工具列表，决定 Agent 能执行什么操作 |
| **skills**         | Skill 列表，提供专业领域能力           |
| **mcp\_servers**   | MCP 服务器列表，扩展外部工具能力      |
| **subagents**      | 子 Agent 列表，实现任务委托       |

通过组合不同的配置，可以实现：

- **协调者角色**：配置 Task 工具和协调性提示词
- **规划者角色**：配置规划相关提示词
- **执行者角色**：配置丰富的工具和 Skill

***

## 系统架构

### SoloAgent架构——Agentic运行架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        AgenticFlow 实例层                        │
│                         (run.py)                                │
│         模型记忆读取/存储、Session 创建与隔离管理                  │
├─────────────────────────────────────────────────────────────────┤
│                          Compiler 层                            │
│                     (flow_compiler.py)                          │
│              编译并执行 Flow，协调多 Agent 协作                   │
├─────────────────────────────────────────────────────────────────┤
│                         SoloAgent 层                            │
│                        (agent.py)                               │
│        基于 ReActCore，负责组装各类 Plugins，编译为完整Agent       │
├─────────────────────────────────────────────────────────────────┤
│                         ReActCore 层                            │
│                      (react_core.py)                            │
│          仅负责接收数据并运行，核心 ReAct 执行引擎                 │
├─────────────────────────────────────────────────────────────────┤
│                          外部接口                                │
│              LLM API (OpenAI / Anthropic / Ollama / Qwen)       │
└─────────────────────────────────────────────────────────────────┘
```

### 数据持久化

SoloEngine 采用 SQLite 数据库实现完整的会话持久化：

**会话管理**：

- `AgenticFlowSessionModel`：会话元数据（状态、Token 使用量、执行时长）
- `SessionMessageModel`：消息记录（按 agent\_id 分组，支持 parent\_agent\_id 记录 SubAgent 层级关系）

**记忆分发机制**：

```python
# 从数据库读取记忆并按 agent_id 分发
agent_memories = await load_and_distribute_memories(db, session_id, user_id)
# 设置到 CompiledFlow
compiled_flow.set_agent_memories(agent_memories)
```

### 编译缓存机制（Compiler 层）

`CompiledFlowFactory` 实现了 LRU 缓存，避免重复编译：

| 配置              | 默认值   | 说明      |
| --------------- | ----- | ------- |
| `MAX_INSTANCES` | 100   | 最大缓存实例数 |
| `CACHE_TIMEOUT` | 1800s | 缓存超时时间  |

**缓存 Key 格式**：`{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}`

**缓存特性**：

- 自动清理过期实例
- 并发执行锁（每个 Flow 独立的 asyncio.Lock）
- 用户注册追踪

### 核心组件职责

| 组件                       | 文件                                               | 职责                                         |
| ------------------------ | ------------------------------------------------ | ------------------------------------------ |
| **ReActCore**            | `core/react_core.py`                             | ReAct 核心引擎，处理 LLM 调用循环、工具调用、消息格式化          |
| **SoloAgent**            | `solo_agent/agent.py`                            | Agent 基类，组装 Memory、Tools、MCP、Skills 等插件    |
| **AgenticFlowCompiler**  | `solo_agent/compiler/flow_compiler.py`           | 编译器，将画布 JSON 编译为可执行的 Agent 实例树             |
| **ToolkitExecutor**      | `plugins/tools/toolkit_executor.py`              | 工具执行器，管理和执行 Agent 可用的工具                    |
| **MCPHostClientManager** | `solo_agent/compiler/mcp_host_client_manager.py` | MCP Host层管理器，统一管理所有MCP Client连接            |
| **MCPClient**            | `plugins/mcp/mcp_client.py`                      | MCP 客户端，与 MCP 服务器通信                        |
| **MCPTool**              | `plugins/tools/agent/mcp.py`                     | MCP工具，实现渐进发现模式（Discovery→Schema→Execution） |
| **SkillTool**            | `plugins/tools/agent/skill.py`                   | Skill 工具，实现渐进式 Skill 披露                             |

### 模型适配层

SoloEngine 通过统一的模型适配层支持多种 LLM 提供商：

```
┌─────────────────────────────────────────────────────────────┐
│                    ReActCore (统一调用)                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     模型适配层                               │
│  OpenAIModel | AnthropicModel | OllamaModel | QwenModel    │
│  DeepSeekModel | ZhipuModel                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     LLM API                                 │
│  OpenAI | Claude | Ollama Llama | 通义千问                   │
│  DeepSeek | 智谱GLM                                         │
└─────────────────────────────────────────────────────────────┘
```

每种模型适配器负责：

- 统一的消息格式转换
- 流式/非流式响应处理
- 工具调用（Function Calling）适配
- 特殊功能支持（如 Claude Extended Thinking）

***

## 项目结构

```
SoloEngine/
├── backend/                    # 后端代码
│   ├── app/                    # FastAPI 应用
│   │   ├── core/               # 核心模块
│   │   │   ├── database.py     # 数据库模型
│   │   │   ├── config.py       # 配置管理
│   │   │   └── data_paths.py   # 路径管理
│   │   └── routers/            # API 路由
│   ├── SoloAgent/              # Agent 核心
│   │   ├── core/               # 核心引擎
│   │   │   ├── react_core.py   # ReAct 核心实现
│   │   │   └── interfaces.py   # 插件接口定义
│   │   ├── model/              # LLM 模型适配
│   │   │   ├── openai_model.py # OpenAI 适配
│   │   │   ├── anthropic_model.py # Anthropic 适配
│   │   │   ├── ollama_model.py # Ollama 适配
│   │   │   └── qwen_model.py   # 通义千问适配
│   │   ├── plugins/            # 插件系统
│   │   │   ├── tools/          # 工具插件
│   │   │   │   ├── agent/      # Agent 工具 (Skill, MCP, Task)
│   │   │   │   ├── file/       # 文件工具 (Read, Write, Delete)
│   │   │   │   ├── command/    # 命令工具 (RunCommand)
│   │   │   │   ├── network/    # 网络工具 (WebSearch, WebFetch)
│   │   │   │   └── search/     # 搜索工具 (Grep, Glob, SearchCodebase)
│   │   │   ├── mcp/            # MCP 客户端
│   │   │   │   └── mcp_client.py
│   │   │   └── memory/         # 记忆插件
│   │   └── solo_agent/         # SoloAgent 配置与编译
│   │       ├── agent.py        # Agent 实现
│   │       ├── config.py       # 配置定义
│   │       └── compiler/       # 编译器
│   │           └── flow_compiler.py
│   └── main.py                 # 运行入口
├── frontend/                   # 前端代码
│   ├── src/
│   │   ├── components/         # React 组件
│   │   │   ├── Canvas/         # 画布组件
│   │   │   ├── RunPanel/       # 运行面板
│   │   │   ├── Settings/       # 设置组件
│   │   │   ├── SkillsManager/  # Skill 管理
│   │   │   └── MCPManager/     # MCP 管理
│   │   ├── pages/              # 页面组件
│   │   ├── services/           # API 服务
│   │   ├── store/              # Zustand 状态
│   │   └── hooks/              # React Hooks
│   └── package.json
├── data/                       # 数据目录
│   ├── database/               # SQLite 数据库
│   └── system/                 # 系统资源
│       ├── mcp_servers/        # 系统 MCP
│       └── skills/             # 系统 Skill
└── i18n/                       # 国际化文档
    └── docs/                   # 文档
```

***

## 技术栈

### 后端

| 技术                                                 | 版本     | 用途                     |
| -------------------------------------------------- | ------ | ---------------------- |
| [Python](https://www.python.org/)                  | 3.11+  | 核心运行时                  |
| [FastAPI](https://fastapi.tiangolo.com/)           | 0.115+ | Web 框架，REST API        |
| [SQLAlchemy](https://www.sqlalchemy.org/)          | 2.0+   | ORM 数据库操作              |
| [SQLite](https://www.sqlite.org/)                  | 3.x    | 嵌入式数据库                 |
| [Pydantic](https://pydantic-docs.helpmanual.io/)   | 2.0+   | 数据验证                   |
| [WebSockets](https://websockets.readthedocs.io/)   | 12.0+  | 实时通信                   |
| [MCP Python SDK](https://modelcontextprotocol.io/) | latest | Model Context Protocol |

### 前端

| 技术                                                          | 版本    | 用途     |
| ----------------------------------------------------------- | ----- | ------ |
| [React](https://reactjs.org/)                               | 18.2  | UI 框架  |
| [TypeScript](https://www.typescriptlang.org/)               | 5.3   | 类型安全   |
| [Vite](https://vitejs.dev/)                                 | 5.0+  | 构建工具   |
| [React Flow](https://reactflow.dev/)                        | 11.x  | 画布可视化  |
| [Zustand](https://zustand-demo.pmnd.rs/)                    | 4.x   | 状态管理   |
| [Ant Design](https://ant.design/)                           | 5.x   | UI 组件库 |
| [Tailwind CSS](https://tailwindcss.com/)                    | 3.x   | 样式框架   |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | 0.45+ | 代码编辑器  |

### 支持的 LLM 提供商范式

SoloEngine 采用统一的模型适配层，支持以下提供商：

| 提供商                                        | 适配模式          | 特性支持                    |
| ------------------------------------------ | ------------- | ----------------------- |
| [OpenAI](https://openai.com/)              | 原生 SDK        | Function Calling, 流式输出  |
| [Anthropic](https://www.anthropic.com/)    | 原生 SDK        | Extended Thinking, 工具使用 |
| [Ollama](https://ollama.ai/)               | OpenAI 兼容 API | 本地部署, 无需 API Key        |
| [Alibaba Qwen](https://tongyi.aliyun.com/) | OpenAI 兼容 API | 中文优化, 长上下文              |
| [DeepSeek](https://www.deepseek.com/)      | OpenAI 兼容 API | 推理增强, 代码生成              |
| [智谱 GLM](https://open.bigmodel.cn/)        | OpenAI 兼容 API | 中文优化, 多模态               |

***

## 路线图

- 导出机制与一键打包
- 接入飞书、Telegram等外部API
- 平等Agent机制
- i18n多语言适配
- 夜间模式
- Agentic AI操作跟随

***

## 🤝 合作与投资

SoloEngine 正处于快速发展阶段，我们致力于打造一个开源、开放、强大的低代码Agentic AI开发平台。我们相信，AI Agent 技术将深刻改变未来的工作方式，而 SoloEngine 将成为这一变革的重要推动者。

### 我们正在寻找

| 合作方向       | 说明                               |
| ---------- | -------------------------------- |
| **技术合作伙伴** | 共同开发核心功能，探索 Agent 技术边界           |
| **产品合作**   | 将 SoloEngine 集成到您的产品中，共同打造行业解决方案 |
| **生态共建**   | 开发插件、Skill、MCP 服务，丰富生态系统            |

### 联系我们

如果您对 SoloEngine 感兴趣，欢迎通过以下方式与我们联系：

- 📧 **邮箱**：<sh4r1ock@qq.com>
- 🐙 **GitHub Issues**：[提交 Issue](https://github.com/Sh4r1ock/SoloEngine/issues)

> **我们期待与您携手，共同推动 SoloEngine 的完善与发展！**

***

## 贡献指南

我们欢迎所有形式的贡献！

### 开发环境设置

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 安装依赖：`pip install -r backend/requirements.txt`

### 代码规范

- Python：遵循 PEP 8 规范，使用 Black 格式化
- TypeScript：使用 ESLint + Prettier
- 提交信息：遵循 Conventional Commits

### 提交 PR

1. 确保所有测试通过
2. 更新相关文档
3. 提交 Pull Request

***

## 许可证

Copyright 2026 Sh4rlock

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

详见 [LICENSE](../../LICENSE) 文件。

***

## 致谢

SoloEngine 的开发得益于以下开源项目：

- [FastAPI](https://fastapi.tiangolo.com/) - 现代高性能 Python Web 框架
- [React](https://reactjs.org/) - 用于构建用户界面的 JavaScript 库
- [React Flow](https://reactflow.dev/) - 用于构建交互式图表和流程图
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - VS Code 的代码编辑器
- [Model Context Protocol](https://modelcontextprotocol.io/) - Anthropic 的模型上下文协议
- [Tailwind CSS](https://tailwindcss.com/) - 实用优先的 CSS 框架

***

<div align="center">

**Made with ❤️ by SoloEngine Team**

</div>
