<div align="center">

<img src="icon/SoloEngine.png" alt="SoloEngine" width="300"/>

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](./LICENSE)

**Languages**: English | [简体中文](i18n/docs/README_CN.md)

</div>

***

## Table of Contents

- [What is SoloEngine?](#what-is-soloengine)
- [Design Philosophy](#design-philosophy)
- [System Architecture](#system-architecture)
- [Core Features](#core-features)
- [Roadmap](#roadmap)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

***

## What is SoloEngine?

SoloEngine is an **open-source low-code Agentic AI development framework** designed to empower developers to easily build, deploy, and manage complex AI Agent workflows. It features a visual canvas design with native support for multi-Agent collaboration, tool invocation, MCP protocol integration, and progressive Skill disclosure mechanisms.

At its core, SoloEngine is powered by a **ReAct (Reasoning + Acting)** paradigm-based intelligent execution engine. Through its plugin-based architecture, it achieves high extensibility and supports multiple LLM providers and tool integrations.

***

## Design Philosophy

### Core Design Principles

| Principle | Description |
| --------- | ----------- |
| **Visual Orchestration** | Drag-and-drop canvas based on React Flow for intuitive multi-Agent workflow design |
| **Plugin Architecture** | Modular expansion through abstract interface definitions (IMemory, IToolExecutor, IMCPClient, etc.) |
| **ReAct Paradigm** | Adopts Reasoning + Acting loops, enabling Agents to think, act, observe, and iterate |
| **Multi-Model Unification** | Unified model adaptation layer that abstracts away API differences across LLM providers |
| **Progressive Disclosure** | Skills and tools display lightweight metadata initially, with details loaded on-demand to optimize Token consumption |
| **Secure Sandbox** | Project isolation, tool permission control, and command security checks ensure safe execution |

***

## System Architecture

### SoloAgent Architecture — Agentic Runtime Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AgenticFlow Instance Layer                   │
│                      (run.py)                                    │
│    Model memory read/write, Session creation and isolation       │
├─────────────────────────────────────────────────────────────────┤
│                       Compiler Layer                             │
│                   (flow_compiler.py)                             │
│         Compile and execute Flow, coordinate multi-Agent         │
├─────────────────────────────────────────────────────────────────┤
│                      SoloAgent Layer                             │
│                     (agent.py)                                   │
│   Based on ReActCore, assembles various Plugins into full Agent  │
├─────────────────────────────────────────────────────────────────┤
│                      ReActCore Layer                             │
│                    (react_core.py)                               │
│      Receives data and executes, core ReAct execution engine     │
├─────────────────────────────────────────────────────────────────┤
│                      External Interfaces                         │
│          LLM API (OpenAI / Anthropic / Ollama / Qwen)            │
└─────────────────────────────────────────────────────────────────┘
```

### Data Persistence

SoloEngine uses SQLite database for complete session persistence:

**Session Management**:

- `AgenticFlowSessionModel`: Session metadata (status, Token usage, execution duration)
- `SessionMessageModel`: Message records (grouped by agent_id, supports parent_agent_id for SubAgent hierarchy)

**Memory Distribution Mechanism**:

```python
# Read memories from database and distribute by agent_id
agent_memories = await load_and_distribute_memories(db, session_id, user_id)
# Set to CompiledFlow
compiled_flow.set_agent_memories(agent_memories)
```

### Compilation Cache Mechanism (Compiler Layer)

`CompiledFlowFactory` implements LRU cache to avoid repeated compilation:

| Configuration | Default | Description |
| ------------- | ------- | ----------- |
| `MAX_INSTANCES` | 100 | Maximum cached instances |
| `CACHE_TIMEOUT` | 1800s | Cache timeout |

**Cache Key Format**: `{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}`

**Cache Features**:

- Automatic cleanup of expired instances
- Concurrent execution lock (asyncio.Lock per Flow)
- User registration tracking

### Core Component Responsibilities

| Component | File | Responsibility |
| --------- | ---- | -------------- |
| **ReActCore** | `core/react_core.py` | ReAct core engine, handles LLM call loops, tool invocation, message formatting |
| **SoloAgent** | `solo_agent/agent.py` | Agent base class, assembles Memory, Tools, MCP, Skills plugins |
| **AgenticFlowCompiler** | `solo_agent/compiler/flow_compiler.py` | Compiler, transforms canvas JSON into executable Agent instance trees |
| **ToolkitExecutor** | `plugins/tools/toolkit_executor.py` | Tool executor, manages and executes Agent-available tools |
| **MCPHostClientManager** | `solo_agent/compiler/mcp_host_client_manager.py` | MCP Host layer manager,统一管理所有MCP Client connections |
| **MCPClient** | `plugins/mcp/mcp_client.py` | MCP client, communicates with MCP servers |
| **MCPTool** | `plugins/tools/agent/mcp.py` | MCP tool, implements progressive discovery (Discovery→Schema→Execution) |
| **SkillTool** | `plugins/tools/agent/skill.py` | Skill tool, implements progressive skill disclosure |

### Model Adaptation Layer

SoloEngine supports multiple LLM providers through a unified model adaptation layer:

```
┌─────────────────────────────────────────────────────────────┐
│              ReActCore (Unified Invocation)                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Model Adaptation Layer                      │
│   OpenAIModel | AnthropicModel | OllamaModel | QwenModel    │
│   DeepSeekModel | ZhipuModel                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     LLM API                                  │
│   OpenAI GPT-4 | Claude | Ollama Llama | Qwen               │
│   DeepSeek | Zhipu GLM                                       │
└─────────────────────────────────────────────────────────────┘
```

Each model adapter is responsible for:

- Unified message format conversion
- Streaming/non-streaming response handling
- Tool invocation (Function Calling) adaptation
- Special feature support (e.g., Claude Extended Thinking)

***

## Core Features

### 🤖 Multi-Agent Orchestration

- **Visual Canvas**: Drag-and-drop workflow design based on React Flow
- **Flexible Agent Configuration**: Achieve different Agent roles through different prompts, tools, and skills
  - **Four Preset Agent Types**:
    - **Custom**: User-configured Agent, used as a blank template
    - **Orchestrator**: Coordinates multiple SubAgents, assigns tasks, aggregates results
    - **Planner**: Analyzes problems, formulates execution plans
    - **Executor**: Executes specific tasks, invokes tools and skills
- **Topological Sort Compilation**: Compiles from bottom to top, automatically resolves Agent dependencies
- **Concurrent Execution**: Supports multi-Agent parallel execution and result aggregation
- **SubAgent Delegation**: Delegates subtasks to specialized SubAgents via Task tool

### 🔧 Rich Tool Ecosystem

SoloEngine includes a complete toolset covering file operations, command execution, network access, and more:

| Tool Category | Tool Name | Description |
| ------------- | --------- | ----------- |
| **File Operations** | Read | Read file content, supports line range |
| | Write | Write files |
| | DeleteFile | Delete files |
| | LS | List directory contents |
| | SearchReplace | Search and replace file content |
| **Search** | Grep | Regex search file content |
| | Glob | Pattern matching file search |
| | SearchCodebase | Semantic code search |
| **Commands** | RunCommand | Execute Shell commands, supports blocking/non-blocking modes |
| | CheckCommandStatus | Check command execution status |
| | StopCommand | Stop running commands |
| | GetDiagnostics | Get code diagnostic information |
| **Network** | WebSearch | Web search |
| | WebFetch | Fetch web page content |
| **Agent** | Skill | Invoke skills |
| | Task | Launch SubAgent |
| | MCP | Invoke MCP tools |
| **Ask** | AskUserQuestion | Ask user questions |
| | TodoWrite | Create todo items |

**Tool Invocation Streaming Four-Event Mechanism**:

SoloEngine implements a complete four-event lifecycle management for tool invocation, ensuring real-time display of tool invocation status on the frontend:

| Event | Trigger Timing | Data Content |
| ----- | -------------- | ------------ |
| `TOOL_CALL_START` | New tool invocation ID detected | `{id, name, status: "start"}` |
| `TOOL_CALL_ARGS` | Incremental parameter transmission (may occur multiple times) | `{id, arguments: "..."}` |
| `TOOL_CALL_END` | Parameter transmission complete | `{id, status: "end"}` |
| `TOOL_CALL_RESULT` | Tool execution result returned | `{id, result, error?}` |

**Unified Frontend Format**: All events are converted to `{type: "tool_calls", tool_calls: [...]}` format and pushed in real-time via WebSocket.

### 🎯 Skill System

Skill is a reusable AI capability module with **progressive disclosure** design:

```
skill-name/
├── SKILL.md          # Required: Skill definition and instructions
├── references/       # Optional: Reference documents
├── scripts/          # Optional: Helper scripts
├── templates/        # Optional: Template files
└── assets/           # Optional: Asset files
```

**Progressive Disclosure Mechanism**:

| Level | Timing | Content | Token Consumption |
| ----- | ------ | ------- | ----------------- |
| Level 1 | Tool Spec | name + description | ~100 tokens |
| Level 2 | Skill Invocation | Full SKILL.md content + folder_path | On-demand |
| Level 3 | Model Autonomy | Nested resources (references/, templates/) | On-demand |

**Skill Editing and Creation System**:

SoloEngine provides complete Skill management functionality:

- **Create Skill**: Create new Skill packages via API or interface
- **Edit SKILL.md**: Online editing of skill definitions and instructions
- **File Management**: Manage references/, scripts/, templates/, assets/ directories
- **Import/Export**: Support ZIP format import/export of Skill packages
- **System Skills**: Pre-installed system-level Skills for user reference

### 🔌 MCP Protocol Support

Full support for **Model Context Protocol** (proposed by Anthropic), adopting **Host-Client layered architecture** and **progressive discovery mode**:

**Architecture Design**:

```
┌─────────────────────────────────────────────────────────────┐
│                  CompiledFlow (Host Layer)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         MCPHostClientManager (Unified Management)   │   │
│  │  - Collects union of mcp_servers from all Agents    │   │
│  │    at compile time                                  │   │
│  │  - Creates and registers MCPClient uniformly        │   │
│  │  - Manages Client lifecycle (connect, disconnect)   │   │
│  │  - Multiple Agents share the same Client            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   MCPTool (Tool Layer)                       │
│  - Unified entry for invoking MCP server tools               │
│  - Progressive discovery: Discovery → Schema → Execution     │
│  - Only injects server list into System Prompt, not tools    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  MCPClient (Client Layer)                    │
│  - stdio: Communicates with local MCP servers via stdin/stdout |
│  - SSE: Communicates with remote servers via Server-Sent Events |
│  - HTTP: Bidirectional communication via Streamable HTTP     │
└─────────────────────────────────────────────────────────────┘
```

**Progressive Discovery Mode (Three-Tier Progression)**:

| Tier | Invocation | Return Content | Token Savings |
| ---- | ---------- | -------------- | ------------- |
| **Tier 1 - Discovery** | `MCP(server_name="github")` | All tool list for the server (name + description) | Avoids injecting all tools |
| **Tier 2 - Schema** | `MCP(server_name="github", tool_name="create_issue")` | Single/batch tool details (with parameter schema) | On-demand loading |
| **Tier 3 - Execution** | `MCP(server_name="github", tool_name="create_issue", arguments={...})` | Tool execution result | Precise execution |

**Token Savings**: Compared to traditional methods injecting all tool schemas, progressive discovery saves **85%+** Token consumption.

**Writing MCP Services in Python**:

SoloEngine supports users writing custom MCP servers in Python:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-custom-server")

@mcp.tool()
def my_tool(param: str) -> str:
    """Custom tool description"""
    return f"Processing result: {param}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

**MCP Service Management**:

- Support for HTTP/SSE/Stdio transport protocols
- Import open-source MCP Server configurations (GitHub, Filesystem, PostgreSQL, etc.)
- Create and manage custom MCP Servers
- Online editing of Python Function code, auto-compiled to MCP Server
- Test MCP Server connections
- Get MCP Server lists and resources

### 💬 Run Panel

- **Real-time Streaming Output**: WebSocket real-time push of execution status and LLM responses
- **Session Management**: Support for multi-session switching and history
- **File Browser**: Integrated project file management
- **Code Editor**: Code editing experience based on Monaco Editor
- **Invocation Records**: Real-time display of tool invocation, skill invocation, and MCP invocation status

### 🔌 Plugin Architecture

Highly extensible through abstract interfaces:

```python
class IMemory(ABC):
    """Memory plugin interface"""
    async def add(self, msg: Msg) -> None: ...
    async def retrieve(self, query: str, limit: int = 5) -> List[Msg]: ...

class IToolExecutor(ABC):
    """Tool executor interface"""
    async def execute(self, tool_call: dict) -> dict: ...
    def get_available_tools(self) -> List[dict]: ...

class IMCPClient(ABC):
    """MCP client interface"""
    async def connect(self) -> None: ...
    async def call_tool(self, tool_name: str, arguments: dict) -> dict: ...
```

***

## Roadmap

- Export mechanism and one-click packaging
- Integration with external APIs (Feishu, Telegram, etc.)
- Equal Agent mechanism
- i18n multi-language support
- Dark mode
- Agentic AI operation following

***

## Tech Stack

### Backend

| Technology | Version | Purpose |
| ---------- | ------- | ------- |
| [Python](https://www.python.org/) | 3.11+ | Core runtime |
| [FastAPI](https://fastapi.tiangolo.com/) | 0.115+ | Web framework, REST API |
| [SQLAlchemy](https://www.sqlalchemy.org/) | 2.0+ | ORM database operations |
| [SQLite](https://www.sqlite.org/) | 3.x | Embedded database |
| [Pydantic](https://pydantic-docs.helpmanual.io/) | 2.0+ | Data validation |
| [WebSockets](https://websockets.readthedocs.io/) | 12.0+ | Real-time communication |
| [MCP Python SDK](https://modelcontextprotocol.io/) | latest | Model Context Protocol |

### Frontend

| Technology | Version | Purpose |
| ---------- | ------- | ------- |
| [React](https://reactjs.org/) | 18.2 | UI framework |
| [TypeScript](https://www.typescriptlang.org/) | 5.3 | Type safety |
| [Vite](https://vitejs.dev/) | 5.0+ | Build tool |
| [React Flow](https://reactflow.dev/) | 11.x | Canvas visualization |
| [Zustand](https://zustand-demo.pmnd.rs/) | 4.x | State management |
| [Ant Design](https://ant.design/) | 5.x | UI component library |
| [Tailwind CSS](https://tailwindcss.com/) | 3.x | Styling framework |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | 0.45+ | Code editor |

### Supported LLM Provider Paradigms

SoloEngine adopts a unified model adaptation layer, supporting the following providers:

| Provider | Adaptation Mode | Feature Support |
| -------- | --------------- | --------------- |
| [OpenAI](https://openai.com/) | Native SDK | Function Calling, Streaming |
| [Anthropic](https://www.anthropic.com/) | Native SDK | Extended Thinking, Tool Use |
| [Ollama](https://ollama.ai/) | OpenAI-compatible API | Local deployment, no API Key required |
| [Alibaba Qwen](https://tongyi.aliyun.com/) | OpenAI-compatible API | Chinese optimization, long context |
| [DeepSeek](https://www.deepseek.com/) | OpenAI-compatible API | Reasoning enhancement, code generation |
| [Zhipu GLM](https://open.bigmodel.cn/) | OpenAI-compatible API | Chinese optimization, multimodal |

***

## Quick Start

### Requirements

- Python 3.11+
- Node.js 18+
- npm or yarn

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/Sh4r1ock/SoloEngine.git
cd SoloEngine
```

2. **Install backend dependencies**

```bash
cd backend
pip install -r requirements.txt
```

3. **Install frontend dependencies**

```bash
cd frontend
npm install
```

4. **Start services**

```bash
# Start backend (port 8990)
cd backend
python main.py

# Start frontend (port 8991)
cd frontend
npm run dev
```

5. **Access the application**

Open browser and visit `http://localhost:8991`

### Port Configuration

| Service | Port | Description |
| ------- | ---- | ----------- |
| Main Backend | 8990 | FastAPI service |
| Frontend | 8991 | React dev server |

***

## Core Concepts

### AgenticFlow

AgenticFlow is SoloEngine's core concept, representing a complete AI workflow. It is defined by canvas JSON, containing nodes (Agents) and edges (invocation relationships).

```json
{
  "nodes": [
    {
      "id": "agent_1",
      "type": "agent",
      "data": {
        "name": "Code Assistant",
        "agentType": "executor",
        "system_prompt": "You are a professional programming assistant...",
        "tools": ["Read", "Write", "RunCommand"],
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

### Agent Configuration

Agents in SoloEngine have no essential difference—**all Agents are identical execution units**. The so-called "types" are just different preset configurations:

| Configuration | Description |
| ------------- | ----------- |
| **system_prompt** | System prompt, defines Agent's role and behavior |
| **tools** | Available tool list, determines what operations Agent can perform |
| **skills** | Skill list, provides professional domain capabilities |
| **mcp_servers** | MCP server list, extends external tool capabilities |
| **subagents** | Sub-Agent list, enables task delegation |

By combining different configurations, you can achieve:

- **Orchestrator role**: Configure Task tool and coordination prompts
- **Planner role**: Configure planning-related prompts
- **Executor role**: Configure rich tools and skills

### ReAct Loop

SoloEngine adopts the ReAct (Reasoning + Acting) paradigm:

```
┌─────────────────────────────────────────────────────────────┐
│                      ReAct Loop                              │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ Reasoning │ →  │ Acting   │ →  │ Observing │             │
│   │ (Think)   │    │ (Act)    │    │ (Observe) │             │
│   └──────────┘    └──────────┘    └──────────┘             │
│        ↑                                    │               │
│        └────────────────────────────────────┘               │
│                    Iterate until complete                    │
└─────────────────────────────────────────────────────────────┘
```

1. **Reasoning**: Model analyzes current state, decides next action
2. **Acting**: Execute tool invocation, skill invocation, or MCP invocation
3. **Observing**: Get execution results, update context
4. **Iterate**: Repeat above steps until task completion

### Skill

Skill is a reusable AI capability module with progressive disclosure design. When a model needs to use a Skill:

1. **Tool Spec Display**: Model sees skill name and brief description
2. **Skill Invocation**: Model invokes Skill tool, gets full SKILL.md content
3. **Resource Reading**: Model autonomously reads nested resources based on folder_path

### MCP (Model Context Protocol)

MCP is the Model Context Protocol proposed by Anthropic. SoloEngine fully supports it with **Host-Client layered architecture** and **progressive discovery mode**:

**Architecture Features**:

- **Host Layer**: `CompiledFlow`统一管理所有 MCP Client connections through `MCPHostClientManager`
- **Client Layer**: Each MCP Server corresponds to one `MCPClient` instance
- **Agent Layer**: Each Agent independently configures its MCP server list, using Host layer Clients by reference
- **Tool Layer**: `MCPTool` provides unified entry, implementing progressive discovery mode

**Progressive Discovery Mode**:

```python
# Tier 1: Discovery - Get all tool list for the server
result = await mcp_tool.execute(server_name="github")
# Returns: [{"name": "create_issue", "description": "..."}, ...]

# Tier 2: Schema - Get single/batch tool details
result = await mcp_tool.execute(
    server_name="github",
    tool_name="create_issue"  # or tool_name=["create_issue", "list_issues"]
)
# Returns: Complete tool schema (parameters, types, descriptions)

# Tier 3: Execution - Execute tool
result = await mcp_tool.execute(
    server_name="github",
    tool_name="create_issue",
    arguments={"owner": "xxx", "repo": "xxx", "title": "Bug report"}
)
# Returns: Tool execution result
```

**XML Injection Optimization**:

- **Traditional**: System Prompt injects all tools' complete schemas (~15,000 tokens for 50 tools)
- **New**: System Prompt only injects server list (~200 tokens), tool details fetched on-demand
- **Savings**: Token consumption reduced by **85%+**

***

## Project Structure

```
SoloEngine/
├── backend/                    # Backend code
│   ├── app/                    # FastAPI application
│   │   ├── core/               # Core modules
│   │   │   ├── database.py     # Database models
│   │   │   ├── config.py       # Configuration management
│   │   │   └── data_paths.py   # Path management
│   │   └── routers/            # API routes
│   ├── SoloAgent/              # Agent core
│   │   ├── core/               # Core engine
│   │   │   ├── react_core.py   # ReAct core implementation
│   │   │   └── interfaces.py   # Plugin interface definitions
│   │   ├── model/              # LLM model adaptation
│   │   │   ├── openai_model.py # OpenAI adapter
│   │   │   ├── anthropic_model.py # Anthropic adapter
│   │   │   ├── ollama_model.py # Ollama adapter
│   │   │   └── qwen_model.py   # Qwen adapter
│   │   ├── plugins/            # Plugin system
│   │   │   ├── tools/          # Tool plugins
│   │   │   │   ├── agent/      # Agent tools (Skill, MCP, Task)
│   │   │   │   ├── file/       # File tools (Read, Write, Delete)
│   │   │   │   ├── command/    # Command tools (RunCommand)
│   │   │   │   ├── network/    # Network tools (WebSearch, WebFetch)
│   │   │   │   └── search/     # Search tools (Grep, Glob, SearchCodebase)
│   │   │   ├── mcp/            # MCP client
│   │   │   │   └── mcp_client.py
│   │   │   └── memory/         # Memory plugins
│   │   └── solo_agent/         # SoloAgent configuration and compilation
│   │       ├── agent.py        # Agent implementation
│   │       ├── config.py       # Configuration definitions
│   │       └── compiler/       # Compiler
│   │           └── flow_compiler.py
│   └── main.py                 # Entry point
├── frontend/                   # Frontend code
│   ├── src/
│   │   ├── components/         # React components
│   │   │   ├── Canvas/         # Canvas components
│   │   │   ├── RunPanel/       # Run panel
│   │   │   ├── Settings/       # Settings components
│   │   │   ├── SkillsManager/  # Skill management
│   │   │   └── MCPManager/     # MCP management
│   │   ├── pages/              # Page components
│   │   ├── services/           # API services
│   │   ├── store/              # Zustand state
│   │   └── hooks/              # React Hooks
│   └── package.json
├── data/                       # Data directory
│   ├── database/               # SQLite database
│   └── system/                 # System resources
│       └── skills/             # System skills
└── docs/                       # Documentation
    └── i18n/                   # Internationalization docs
```

***

## API Reference

### REST API

#### User Authentication

```http
POST /api/v1/auth/login
POST /api/v1/auth/register
GET  /api/v1/auth/me
```

#### AgenticFlow Management

```http
GET    /api/v1/agentic-flows
POST   /api/v1/agentic-flows
GET    /api/v1/agentic-flows/{flow_id}
PUT    /api/v1/agentic-flows/{flow_id}
DELETE /api/v1/agentic-flows/{flow_id}
```

#### Runtime API

```http
POST /api/v1/run/execute              # Execute workflow
POST /api/v1/run/execute-node         # Execute single node
GET  /api/v1/run/sessions             # Get session list
GET  /api/v1/run/sessions/{id}        # Get session details
DELETE /api/v1/run/sessions/{id}      # Delete session
GET  /api/v1/run/sessions/{id}/messages           # Get session messages
GET  /api/v1/run/sessions/{id}/messages/by-agent  # Get messages grouped by Agent
```

#### Skill Management

```http
GET  /api/v1/skills
POST /api/v1/skills
GET  /api/v1/skills/{skill_id}
PUT  /api/v1/skills/{skill_id}
DELETE /api/v1/skills/{skill_id}
GET  /api/v1/skills/{skill_id}/content
PUT  /api/v1/skills/{skill_id}/content
```

#### MCP Management

```http
GET  /api/v1/mcp/servers
POST /api/v1/mcp/servers
GET  /api/v1/mcp/servers/{server_id}
PUT  /api/v1/mcp/servers/{server_id}
DELETE /api/v1/mcp/servers/{server_id}
POST /api/v1/mcp/servers/{server_id}/test
GET  /api/v1/mcp/servers/{server_id}/tools
POST /api/v1/mcp/servers/{server_id}/tools/call
```

#### LLM Configuration Management

```http
GET  /api/v1/llm/configs
POST /api/v1/llm/configs
GET  /api/v1/llm/configs/{config_id}
PUT  /api/v1/llm/configs/{config_id}
DELETE /api/v1/llm/configs/{config_id}
GET  /api/v1/llm/providers
GET  /api/v1/llm/providers/{provider}/models
```

### WebSocket API

```javascript
// Connect WebSocket
const ws = new WebSocket(
  'ws://localhost:8990/ws/run/{agentic_flow_id}/{session_id}/{run_project_id}'
);

// Send execution request
ws.send(JSON.stringify({
  type: 'execute',
  canvas_data: {...},        // Canvas data
  input_message: '...',       // User input message
  session_id: '...',          // Session ID
  run_project_id: '...'       // Run project ID
}));

// Receive events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle execution events
};
```

**Event Types**:

| Event Type | Description |
| ---------- | ----------- |
| `execution_start` | Execution started |
| `execution_complete` | Execution completed |
| `execution_error` | Execution error |
| `agent_start` | Agent started |
| `agent_complete` | Agent completed |
| `subagent_start` | SubAgent started |
| `subagent_complete` | SubAgent completed |
| `tool_call_start` | Tool invocation started |
| `tool_call_args` | Tool invocation arguments |
| `tool_call_end` | Tool invocation ended |
| `tool_call_result` | Tool invocation result |
| `skill_call_start` | Skill invocation started |
| `skill_call_end` | Skill invocation ended |
| `mcp_call_start` | MCP invocation started |
| `mcp_call_end` | MCP invocation ended |
| `stream` | Streaming output |
| `error` | Error event |

***

## 🤝 Partnership & Investment

SoloEngine is in rapid development. We are committed to building an open-source, open, and powerful low-code Agentic AI development platform. We believe AI Agent technology will profoundly change the way we work, and SoloEngine will be a key driver of this transformation.

### What We're Looking For

| Partnership | Description |
| ----------- | ----------- |
| **Technical Partners** | Co-develop core features, explore Agent technology boundaries |
| **Product Partnerships** | Integrate SoloEngine into your products, build industry solutions together |
| **Ecosystem Building** | Develop plugins, skills, MCP services, enrich the ecosystem |

### Contact Us

If you're interested in SoloEngine, please reach out:

- 📧 **Email**: <sh4rlock@qq.com>
- 🐙 **GitHub Issues**: [Submit Issue](https://github.com/Sh4r1ock/SoloEngine/issues)

> **We look forward to working with you to advance SoloEngine's development!**

***

## Contributing

We welcome all forms of contributions!

### Development Environment Setup

1. Fork this repository
2. Create feature branch: `git checkout -b feature/your-feature`
3. Install dependencies: `pip install -r backend/requirements.txt`

### Code Standards

- Python: Follow PEP 8, use Black formatter
- TypeScript: Use ESLint + Prettier
- Commits: Follow Conventional Commits

### Submitting PRs

1. Ensure all tests pass
2. Update relevant documentation
3. Submit Pull Request

***

## License

This project is licensed under Apache-2.0. See [LICENSE](./LICENSE) file for details.

***

## Acknowledgments

SoloEngine's development benefits from the following open-source projects:

- [FastAPI](https://fastapi.tiangolo.com/) - Modern, high-performance Python web framework
- [React](https://reactjs.org/) - JavaScript library for building user interfaces
- [React Flow](https://reactflow.dev/) - For building interactive diagrams and flowcharts
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - VS Code's code editor
- [Model Context Protocol](https://modelcontextprotocol.io/) - Anthropic's Model Context Protocol
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework

***

<div align="center">

**Made with ❤️ by SoloEngine Team**

</div>
