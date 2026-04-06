<div align="center">

# SoloEngine

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache--2.0-yellow?style=flat-square)](./LICENSE)

**Language**: English | [简体中文](./docs/i18n/README_CN.md)

</div>

---

## Table of Contents

- [What is SoloEngine?](#what-is-soloengine)
- [Design Philosophy](#design-philosophy)
- [System Architecture](#system-architecture)
- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

---

## What is SoloEngine?

SoloEngine is an **open-source multi-agent orchestration framework** designed to help developers easily build, deploy, and manage complex AI Agent workflows. It features a visual canvas design, supporting multi-agent collaboration, tool invocation, MCP protocol integration, and a progressive skill disclosure mechanism.

At its core, SoloEngine is built on the **ReAct (Reasoning + Acting)** paradigm, implementing a highly extensible agent execution engine through a plugin-based architecture that supports multiple LLM providers and tool integrations.

---

## Design Philosophy

### Core Design Principles

| Principle | Description |
|-----------|-------------|
| **Visual Orchestration** | Drag-and-drop canvas based on React Flow for intuitive multi-agent workflow design |
| **Plugin Architecture** | Modular extension through abstract interfaces (IMemory, IToolExecutor, IMCPClient, etc.) |
| **ReAct Paradigm** | Reasoning + Acting cycle enabling agents to think, act, observe, and iterate |
| **Unified Model Layer** | Unified model adaptation layer that abstracts API differences across LLM providers |
| **Progressive Disclosure** | Skills and tools display lightweight metadata first, loading details on demand to optimize token consumption |
| **Secure Sandbox** | Project isolation, tool permission control, and command security checks ensure safe execution |

---

## System Architecture

### SoloAgent Architecture — Agentic Runtime Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      AgenticFlow Instance Layer                 │
│                           (run.py)                              │
│       Model memory read/write, Session creation & isolation     │
├─────────────────────────────────────────────────────────────────┤
│                          Compiler Layer                         │
│                     (flow_compiler.py)                          │
│           Compile and execute Flow, coordinate multi-agent      │
├─────────────────────────────────────────────────────────────────┤
│                         SoloAgent Layer                         │
│                        (agent.py)                               │
│   Based on ReActCore, assembles Plugins into complete Agent    │
├─────────────────────────────────────────────────────────────────┤
│                         ReActCore Layer                         │
│                      (react_core.py)                            │
│      Pure execution engine, handles LLM call loops only         │
├─────────────────────────────────────────────────────────────────┤
│                        External Interface                       │
│            LLM API (OpenAI / Anthropic / Ollama / Qwen)         │
└─────────────────────────────────────────────────────────────────┘
```

### Data Persistence (SoloAgent Architecture)

SoloEngine implements complete session persistence using SQLite:

**Session Management**:
- `AgenticFlowSessionModel`: Session metadata (status, token usage, execution duration)
- `SessionMessageModel`: Message records (grouped by agent_id, supports parent_agent_id for SubAgent hierarchy)

**Memory Distribution Mechanism**:
```python
# Load memories from database and distribute by agent_id
agent_memories = await load_and_distribute_memories(db, session_id, user_id)
# Set to CompiledFlow
compiled_flow.set_agent_memories(agent_memories)
```

### Compilation Cache Mechanism (Compiler Layer)

`CompiledFlowFactory` implements LRU caching to avoid redundant compilation:

| Configuration | Default | Description |
|---------------|---------|-------------|
| `MAX_INSTANCES` | 100 | Maximum cached instances |
| `CACHE_TIMEOUT` | 1800s | Cache timeout duration |

**Cache Key Format**: `{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}`

**Cache Features**:
- Automatic cleanup of expired instances
- Concurrent execution locks (independent asyncio.Lock per Flow)
- User registration tracking

### Core Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| **ReActCore** | `core/react_core.py` | ReAct core engine, handles LLM call loops, tool invocations, message formatting |
| **SoloAgent** | `solo_agent/agent.py` | Agent base class, assembles Memory, Tools, MCP, Skills plugins |
| **AgenticFlowCompiler** | `solo_agent/compiler/flow_compiler.py` | Compiler, transforms canvas JSON into executable Agent instance tree |
| **ToolkitExecutor** | `plugins/tools/toolkit_executor.py` | Tool executor, manages and executes tools available to Agent |
| **MCPClient** | `plugins/mcp/mcp_client.py` | MCP client, communicates with MCP servers |
| **SkillTool** | `plugins/tools/agent/skill.py` | Skill tool, implements progressive skill disclosure |

### Model Adaptation Layer

SoloEngine supports multiple LLM providers through a unified model adaptation layer:

```
┌─────────────────────────────────────────────────────────────┐
│                    ReActCore (Unified Call)                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Model Adaptation Layer                   │
│  OpenAIModel | AnthropicModel | OllamaModel | QwenModel    │
│  DeepSeekModel | ZhipuModel                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                        LLM API                              │
│  OpenAI GPT-4 | Claude | Ollama Llama | Qwen               │
│  DeepSeek | Zhipu GLM                                      │
└─────────────────────────────────────────────────────────────┘
```

Each model adapter handles:
- Unified message format conversion
- Streaming/non-streaming response processing
- Tool calling (Function Calling) adaptation
- Special feature support (e.g., Claude Extended Thinking)

---

## Core Features

### 🤖 Multi-Agent Orchestration

- **Visual Canvas**: Drag-and-drop workflow design based on React Flow
- **Flexible Agent Configuration**: Define different agent roles by setting prompts, tools, and skills
  - **Three Preset Agent Types**:
    - **Orchestrator**: Coordinates multiple SubAgents, distributes tasks, aggregates results
    - **Planner**: Analyzes problems, formulates execution plans
    - **Executor**: Executes specific tasks, invokes tools and skills
- **Topological Sort Compilation**: Bottom-up compilation with automatic Agent dependency resolution
- **Concurrent Execution**: Supports parallel multi-agent execution and result aggregation
- **SubAgent Delegation**: Delegate subtasks to specialized SubAgents via Task tool

### 🔧 Rich Tool Ecosystem

SoloEngine includes a comprehensive built-in toolset covering file operations, command execution, network access, and more:

| Category | Tool | Description |
|----------|------|-------------|
| **File Operations** | Read | Read file contents with line range support |
| | Write | Write to files |
| | DeleteFile | Delete files |
| | LS | List directory contents |
| **Search** | Grep | Regex search in file contents |
| | Glob | Pattern matching file search |
| | SearchCodebase | Semantic code search |
| **Command** | RunCommand | Execute shell commands with blocking/non-blocking modes |
| | CheckCommandStatus | Check command execution status |
| | StopCommand | Stop running commands |
| **Network** | WebSearch | Web search |
| | WebFetch | Fetch web page content |
| **Agent** | Skill | Invoke skills |
| | Task | Launch SubAgent |
| | MCP | Invoke MCP tools |

**Streaming Tool Call Four-Event Mechanism**:

SoloEngine implements a complete four-event lifecycle management for tool calls, ensuring real-time frontend display of tool call status:

| Event | Trigger | Data Content |
|-------|---------|--------------|
| `TOOL_CALL_START` | New tool call ID detected | `{id, name, status: "start"}` |
| `TOOL_CALL_ARGS` | Incremental argument transmission (may occur multiple times) | `{id, arguments: "..."}` |
| `TOOL_CALL_END` | Argument transmission complete | `{id, status: "end"}` |
| `TOOL_CALL_RESULT` | Tool execution result returned | `{id, result, error?}` |

**Unified Frontend Format**: All events are converted to `{type: "tool_calls", tool_calls: [...]}` format and pushed in real-time via WebSocket.

### 🎯 Skill System

Skills are reusable AI capability modules designed with **progressive disclosure**:

```
skill-name/
├── SKILL.md          # Required: Skill definition and instructions
├── references/       # Optional: Reference documentation
├── scripts/          # Optional: Helper scripts
├── templates/        # Optional: Template files
└── assets/           # Optional: Asset files
```

**Progressive Disclosure Mechanism**:

| Level | Timing | Content | Token Cost |
|-------|--------|---------|------------|
| Level 1 | Tool Spec | name + description | ~100 tokens |
| Level 2 | Skill Invocation | Full SKILL.md content + folder_path | On demand |
| Level 3 | Model Autonomous | Nested resources (references/, templates/) | On demand |

**Skill Editing and Creation System**:

SoloEngine provides comprehensive skill management functionality:

- **Create Skill**: Create new skill packages via API or UI
- **Edit SKILL.md**: Online editing of skill definitions and instructions
- **File Management**: Manage references/, scripts/, templates/, assets/ directories
- **Import/Export**: Support ZIP format for skill package import/export
- **System Skills**: Pre-installed system-level skills for user reference

### 🔌 MCP Protocol Support

Full support for **Model Context Protocol** (proposed by Anthropic):

- **Multiple Transport Protocols**:
  - **stdio**: Communicate with local MCP servers via standard input/output
  - **SSE**: Communicate with remote servers via Server-Sent Events
  - **HTTP**: Bidirectional communication via Streamable HTTP
- **Tool Discovery**: Automatically discover tools, resources, and prompts provided by MCP servers
- **Unified Invocation Interface**: Call external services uniformly through MCP tools

**Writing MCP Services in Python**:

SoloEngine supports users writing custom MCP servers in Python:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-custom-server")

@mcp.tool()
def my_tool(param: str) -> str:
    """Custom tool description"""
    return f"Result: {param}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

**MCP Service Management**:

- Support for HTTP/SSE/Stdio transport protocols
- Import open-source MCP Server configurations (GitHub, Filesystem, PostgreSQL, etc.)
- Create and manage custom MCP Servers
- Online editing of Python Function code with automatic compilation to MCP Server
- Test MCP Server connections
- Retrieve MCP Server lists and resources

### 💬 Run Panel

- **Real-time Streaming Output**: WebSocket-based real-time push of execution status and LLM responses
- **Session Management**: Support for multi-session switching and history
- **File Explorer**: Integrated project file management
- **Code Editor**: Code editing experience based on Monaco Editor
- **Call Records**: Real-time display of tool calls, skill calls, MCP call status

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

---

## Tech Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| [Python](https://www.python.org/) | 3.11+ | Core runtime |
| [FastAPI](https://fastapi.tiangolo.com/) | 0.115+ | Web framework, REST API |
| [SQLAlchemy](https://www.sqlalchemy.org/) | 2.0+ | ORM database operations |
| [SQLite](https://www.sqlite.org/) | 3.x | Embedded database |
| [Pydantic](https://pydantic-docs.helpmanual.io/) | 2.0+ | Data validation |
| [WebSockets](https://websockets.readthedocs.io/) | 12.0+ | Real-time communication |
| [MCP Python SDK](https://modelcontextprotocol.io/) | latest | Model Context Protocol |

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| [React](https://reactjs.org/) | 18.2 | UI framework |
| [TypeScript](https://www.typescriptlang.org/) | 5.3 | Type safety |
| [Vite](https://vitejs.dev/) | 5.0+ | Build tool |
| [React Flow](https://reactflow.dev/) | 11.x | Canvas visualization |
| [Zustand](https://zustand-demo.pmnd.rs/) | 4.x | State management |
| [Ant Design](https://ant.design/) | 5.x | UI component library |
| [Tailwind CSS](https://tailwindcss.com/) | 3.x | CSS framework |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | 0.45+ | Code editor |

### Supported LLM Provider Paradigms

SoloEngine adopts a unified model adaptation layer supporting the following providers:

| Provider | Adaptation Mode | Feature Support |
|----------|-----------------|-----------------|
| [OpenAI](https://openai.com/) | Native SDK | Function Calling, Streaming |
| [Anthropic](https://www.anthropic.com/) | Native SDK | Extended Thinking, Tool Use |
| [Ollama](https://ollama.ai/) | OpenAI-compatible API | Local deployment, No API Key required |
| [Alibaba Qwen](https://tongyi.aliyun.com/) | OpenAI-compatible API | Chinese optimized, Long context |
| [DeepSeek](https://www.deepseek.com/) | OpenAI-compatible API | Reasoning enhanced, Code generation |
| [Zhipu GLM](https://open.bigmodel.cn/) | OpenAI-compatible API | Chinese optimized, Multimodal |

---

## Quick Start

### Requirements

- Python 3.11+
- Node.js 18+
- npm or yarn

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/your-repo/SoloEngine.git
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

Open your browser and visit `http://localhost:8991`

### Port Configuration

| Service | Port | Description |
|---------|------|-------------|
| Backend | 8990 | FastAPI service |
| Frontend | 8991 | React development server |

---

## Core Concepts

### AgenticFlow

AgenticFlow is the core concept of SoloEngine, representing a complete AI workflow. It is defined by canvas JSON, containing nodes (Agents) and edges (invocation relationships).

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

In SoloEngine, all Agents are fundamentally identical — **every Agent is the same execution unit**. The so-called "types" are merely different preset configurations:

| Configuration | Description |
|---------------|-------------|
| **system_prompt** | System prompt defining the Agent's role and behavior |
| **tools** | Available tools list determining what operations the Agent can perform |
| **skills** | Skill list providing domain-specific capabilities |
| **mcp_servers** | MCP server list extending external tool capabilities |
| **subagents** | SubAgent list enabling task delegation |

By combining different configurations, you can achieve:
- **Orchestrator Role**: Configure Task tool with coordination-focused prompts
- **Planner Role**: Configure planning-related prompts
- **Executor Role**: Configure rich tools and skills

### ReAct Loop

SoloEngine adopts the ReAct (Reasoning + Acting) paradigm:

```
┌─────────────────────────────────────────────────────────────┐
│                      ReAct Loop                             │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ Reasoning │ →  │ Acting   │ →  │ Observing │             │
│   └──────────┘    └──────────┘    └──────────┘             │
│        ↑                                    │               │
│        └────────────────────────────────────┘               │
│                  Iterate until complete                      │
└─────────────────────────────────────────────────────────────┘
```

1. **Reasoning**: The model analyzes the current state and decides the next action
2. **Acting**: Execute tool calls, skill invocations, or MCP calls
3. **Observing**: Obtain execution results and update context
4. **Iteration**: Repeat the above steps until task completion

### Skill

Skills are reusable AI capability modules designed with progressive disclosure. When a model needs to use a skill:

1. **Tool Spec Display**: The model sees the skill name and brief description
2. **Skill Invocation**: The model calls the Skill tool to get the full SKILL.md content
3. **Resource Reading**: The model autonomously reads nested resources based on folder_path

### MCP (Model Context Protocol)

MCP is a model context protocol proposed by Anthropic, fully supported by SoloEngine:

```python
# Connect to MCP server
client = MCPClient({
    "transport": "stdio",
    "command": "mcp-server-github",
    "args": [],
    "env": {"GITHUB_TOKEN": "..."}
})
await client.connect()

# Get available tools
tools = await client.get_tools()

# Call tool
result = await client.call_tool("create_issue", {
    "owner": "xxx",
    "repo": "xxx",
    "title": "Bug report"
})
```

---

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
│   │   ├── model/              # LLM model adapters
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
│   └── run.py                  # Entry point
├── frontend/                   # Frontend code
│   ├── src/
│   │   ├── components/         # React components
│   │   │   ├── Canvas/         # Canvas components
│   │   │   ├── RunPanel/       # Run panel
│   │   │   ├── Settings/       # Settings components
│   │   │   ├── SkillsManager/  # Skills management
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
    └── i18n/                   # Internationalization
```

---

## API Reference

### REST API

#### User Authentication

```http
POST /api/auth/login
POST /api/auth/register
```

#### AgenticFlow Management

```http
GET    /api/agentic-flow/list
POST   /api/agentic-flow/create
GET    /api/agentic-flow/{flow_id}
PUT    /api/agentic-flow/{flow_id}
DELETE /api/agentic-flow/{flow_id}
```

#### Runtime API

```http
POST /api/run/execute          # Execute workflow
GET  /api/run/sessions         # Get session list
GET  /api/run/sessions/{id}/messages  # Get session messages
```

#### Skills Management

```http
GET  /api/skills/list
POST /api/skills/create
GET  /api/skills/{skill_id}
PUT  /api/skills/{skill_id}
```

### WebSocket API

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:8990/ws/run/{flow_id}');

// Send execution request
ws.send(JSON.stringify({
  type: 'execute',
  canvas_data: {...},
  input_message: '...',
  session_id: '...',
  run_project_id: '...'
}));

// Receive events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Handle execution events
};
```

**Event Types**:

| Event Type | Description |
|------------|-------------|
| `execution_start` | Execution started |
| `agent_start` | Agent started |
| `tool_call` | Tool call |
| `tool_result` | Tool result |
| `skill_call` | Skill call |
| `mcp_call` | MCP call |
| `subagent_start` | SubAgent started |
| `stream` | Streaming output |
| `execution_complete` | Execution complete |
| `execution_error` | Execution error |

---

## Contributing

We welcome all forms of contributions!

### Development Setup

1. Fork this repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Install development dependencies: `pip install -r requirements-dev.txt`
4. Run tests: `pytest tests/`

### Code Standards

- Python: Follow PEP 8, use Black for formatting
- TypeScript: Use ESLint + Prettier
- Commit messages: Follow Conventional Commits

### Submitting PRs

1. Ensure all tests pass
2. Update relevant documentation
3. Submit a Pull Request

---

## License

This project is licensed under the Apache-2.0 License. See the [LICENSE](./LICENSE) file for details.

---

## Acknowledgments

SoloEngine development is made possible by the following open-source projects:

- [FastAPI](https://fastapi.tiangolo.com/) - Modern high-performance Python web framework
- [React](https://reactjs.org/) - JavaScript library for building user interfaces
- [React Flow](https://reactflow.dev/) - Library for building interactive diagrams and flowcharts
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - VS Code's code editor
- [Model Context Protocol](https://modelcontextprotocol.io/) - Anthropic's model context protocol
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework

---

<div align="center">

**Made with ❤️ by SoloEngine Team**

</div>
