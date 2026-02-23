<div align="center">

# SoloEngine

**Agentic AI Visual Low-Code Platform**

Create "AI teams" that understand high-level goals, intelligently break down tasks, and execute autonomously through visual drag-and-drop, wiring, and configuration.

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**Language**: English | [简体中文](docs/i18n/README_CN.md)

</div>

---

## 📖 Table of Contents

- [Introduction](#introduction)
- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Core Features](#core-features-1)
- [API Documentation](#api-documentation)
- [Project Structure](#project-structure)
- [Development Guide](#development-guide)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## 🚀 Introduction

SoloEngine is a fully-featured Agentic AI visual low-code platform designed to minimize the barrier to developing complex multi-agent collaborative systems. The platform's core innovation lies in abstracting agent management as a "company management" metaphor:

- 🏢 **Build Organizational Structure**: Drag roles, define responsibilities, and establish reporting relationships on a visual canvas
- 🎯 **Set Strategic Goals**: Input a macro natural language goal, and the entire "AI company" operates autonomously

---

## ✨ Core Features

| Feature | Description |
|---------|-------------|
| 🎨 **Visual Orchestration** | Drag-and-drop canvas editor based on ReactFlow, WYSIWYG |
| 🤖 **Three-Layer Node Architecture** | Orchestrator, Planner, Executor |
| 🔌 **MCP Protocol Integration** | Support for stdio, SSE, HTTP transport protocols |
| 🛠️ **Skills Package System** | Extensible skill package management mechanism |
| 🐛 **Debug Panel** | Breakpoint debugging, step execution, variable inspection |
| 🔐 **User Authentication** | JWT authentication with optimistic locking |
| 🔑 **Secure Configuration** | Encrypted API Key storage, frontend model management |

---

## 💻 Tech Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Python | 3.11+ | Core runtime |
| FastAPI | 0.115+ | Web framework |
| Uvicorn | 0.32+ | ASGI server |
| Pydantic | 2.10+ | Data validation |
| SQLAlchemy | 2.0+ | ORM |
| OpenAI SDK | 1.59+ | OpenAI API |
| Anthropic SDK | 0.40+ | Claude API |
| DashScope | 1.20+ | Qwen API |
| Ollama SDK | 0.6+ | Local models |
| PyJWT | 2.10+ | JWT authentication |
| pwdlib | 0.3+ | Password hashing |
| MCP SDK | 1.3+ | MCP protocol |
| cryptography | 44.0+ | API Key encryption |

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.2 | UI framework |
| TypeScript | 5.3 | Type safety |
| ReactFlow | 11.10 | Flowchart editing |
| Zustand | 4.4 | State management |
| Ant Design | 5.11 | UI component library |
| Vite | 5.0 | Build tool |
| Axios | 1.6 | HTTP client |

---

## 🏃 Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- npm or yarn
- Conda (recommended)

### Installation

#### 1. Clone the repository

```bash
git clone https://github.com/your-username/SoloEngine.git
cd SoloEngine
```

#### 2. Start Backend

```bash
cd backend

# Create and activate conda environment
conda create -n SoloEngine python=3.11
conda activate SoloEngine

# Install dependencies
pip install -r requirements.txt

# Start server
python main.py
```

Backend service will start at `http://localhost:8000`.

#### 3. Start Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend application will start at `http://localhost:3000`.

### Production Build

```bash
# Frontend build
cd frontend
npm run build

# Backend production start
cd backend
conda activate SoloEngine
uvicorn app:app --host 0.0.0.0 --port 8000
```

---

## ⚙️ Configuration

### System Configuration

The `.env` file contains system-level configuration, located at `backend/.env`:

```env
# Security configuration
SECRET_KEY=your_secret_key_here

# Database configuration
DATABASE_URL=sqlite:///./data/database/soloengine.db

# Server configuration
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
FRONTEND_URL=http://localhost:5173

# Logging configuration
LOG_LEVEL=INFO
LOG_FILE=./logs/soloengine.log
```

> ⚠️ **Security Notice**: Please change `SECRET_KEY` to a random string in production.

### User Configuration

All LLM-related user configurations are managed through the frontend settings page:

| Configuration | Location | Description |
|---------------|----------|-------------|
| OpenAI API Key | Settings > Model Management | AES-GCM encrypted storage |
| Anthropic API Key | Settings > Model Management | AES-GCM encrypted storage |
| Qwen API Key | Settings > Model Management | AES-GCM encrypted storage |
| Ollama Service URL | Settings > Model Management | Local model service address |
| Model Parameters | Settings > Model Management | Temperature, max tokens, etc. |

### First-time Setup

1. Start backend and frontend services
2. Register and login to your account
3. Navigate to Settings > Model Management
4. Click "New Configuration" to add LLM config
5. Fill in config name, select provider, enter API Key
6. Click "Test Connection" to verify
7. Save and set as default

---

## 🎯 Core Features

### Three-Layer Node Architecture

The platform provides three basic node types covering core corporate functions:

| Node Type | Role | Responsibility | Color |
|-----------|------|----------------|-------|
| **Orchestrator** | CEO/General Manager | Global command, macro phase decomposition, decision scheduling | Blue |
| **Planner** | COO/Department Director | Strategy planning, breaking down goals into executable steps | Green |
| **Executor** | Professional Staff | Tactical execution, calling tools to produce results | Orange |

### Multi-LLM Support

| Provider | Models | Features |
|----------|--------|----------|
| OpenAI | GPT-4, GPT-3.5, GPT-4o, o3-mini | Streaming output, tool calling, token counting |
| Anthropic | Claude 3 series | Streaming output, long context, tool calling |
| Alibaba Cloud | Qwen | Streaming output, Chinese optimization |
| Ollama | Local models | Privacy protection, offline operation |

### MCP Protocol Integration

- **Multi-transport Support**: HTTP, WebSocket, stdio, SSE
- **Tool Discovery**: Automatically discover tools provided by MCP servers
- **Resource Management**: Access MCP resources and prompts
- **Open-source MCP Import**: One-click import of open-source MCP configurations

### Skills Package System

Skills packages are folders that encapsulate professional knowledge, transforming general AI models into domain experts for specific tasks:

```
skill-package/
├── SKILL.md           # Metadata + instructions
├── skills/            # Specific skills directory
│   └── skill-name/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
└── common/            # Common resources
```

### Debug Panel

- **Breakpoint Debugging**: Set breakpoints, pause execution
- **Step Execution**: Debug agent behavior step by step
- **Variable Inspection**: Real-time view of execution state
- **Execution History**: Complete execution records and playback

---

## 📚 API Documentation

### Authentication API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | User registration |
| POST | `/api/v1/auth/login` | User login |
| POST | `/api/v1/auth/refresh` | Refresh token |
| GET | `/api/v1/auth/me` | Get current user |

### LLM Configuration API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/llm/providers` | Get all LLM providers |
| GET | `/api/v1/llm/providers/{provider}/models` | Get models for a provider |
| GET | `/api/v1/llm/configs` | Get all user LLM configs |
| POST | `/api/v1/llm/configs` | Create LLM config |
| PUT | `/api/v1/llm/configs/{config_id}` | Update LLM config |
| DELETE | `/api/v1/llm/configs/{config_id}` | Delete LLM config |
| POST | `/api/v1/llm/configs/{config_id}/set-default` | Set default config |
| POST | `/api/v1/llm/test` | Test LLM config |
| GET | `/api/v1/llm/usage` | Get usage statistics |

### Project Management API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/projects` | Get project list |
| POST | `/api/v1/projects` | Create new project |
| GET | `/api/v1/projects/{id}` | Get project details |
| PUT | `/api/v1/projects/{id}` | Update project |
| DELETE | `/api/v1/projects/{id}` | Delete project |
| GET | `/api/v1/projects/{id}/canvas` | Get canvas data |
| PUT | `/api/v1/projects/{id}/canvas` | Save canvas data |
| POST | `/api/v1/projects/{id}/run` | Run project |

### MCP Management API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/mcp/servers` | List all servers |
| POST | `/api/v1/mcp/servers` | Add server |
| PUT | `/api/v1/mcp/servers/{id}` | Update server |
| DELETE | `/api/v1/mcp/servers/{id}` | Delete server |
| GET | `/api/v1/mcp/servers/{id}/tools` | Get server tools |
| POST | `/api/v1/mcp/servers/{id}/connect` | Connect to server |
| POST | `/api/v1/mcp/servers/test` | Test connection |
| GET | `/api/v1/mcp/open-source` | Get open-source MCP list |
| POST | `/api/v1/mcp/import` | Import open-source MCP |

### Skills Management API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/skills/packages` | List all packages |
| POST | `/api/v1/skills/packages` | Create package |
| GET | `/api/v1/skills/packages/{id}` | Get package details |
| PUT | `/api/v1/skills/packages/{id}` | Update package |
| DELETE | `/api/v1/skills/packages/{id}` | Delete package |
| POST | `/api/v1/skills/packages/{id}/activate` | Activate package |
| POST | `/api/v1/skills/import` | Import package |

### Debug API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/debug/start` | Start debug session |
| POST | `/api/v1/debug/stop` | Stop debug session |
| POST | `/api/v1/debug/pause` | Pause debugging |
| POST | `/api/v1/debug/resume` | Resume debugging |
| POST | `/api/v1/debug/step` | Step execution |
| POST | `/api/v1/debug/breakpoint` | Set breakpoint |
| GET | `/api/v1/debug/sessions` | Get session list |
| POST | `/api/v1/debug/execute` | Execute JSON workflow |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `WS /api/v1/debug/ws/{session_id}` | Real-time debug messages |

---

## 📁 Project Structure

```
SoloEngine/
├── backend/                      # Backend project
│   ├── SoloAgent/               # Agent runtime framework
│   │   ├── core/                # Core modules
│   │   │   ├── react_core.py    # ReAct loop implementation
│   │   │   └── interfaces.py    # Plugin interface definitions
│   │   ├── model/               # LLM model implementations
│   │   │   ├── openai_model.py
│   │   │   ├── anthropic_model.py
│   │   │   ├── qwen_model.py
│   │   │   ├── ollama_model.py
│   │   │   └── llm_factory.py
│   │   ├── plugins/             # Plugin system
│   │   │   ├── mcp/             # MCP client
│   │   │   ├── memory/          # Memory plugin
│   │   │   ├── rag/             # RAG plugin
│   │   │   └── tools/           # Tool plugin
│   │   ├── embedding/           # Vector embedding
│   │   ├── token_counter/       # Token counting
│   │   └── assembly/            # Agent assembler
│   ├── app/                     # FastAPI application
│   │   ├── api/v1/              # API routes
│   │   ├── core/                # Core services
│   │   ├── models/              # Data models
│   │   └── schemas/             # Data validation
│   ├── main.py                  # Application entry
│   └── requirements.txt         # Python dependencies
│
├── frontend/                    # Frontend project
│   ├── src/
│   │   ├── components/          # React components
│   │   │   ├── Canvas/          # Canvas components
│   │   │   ├── PropertyEditor/  # Property editor
│   │   │   ├── DebugPanel/      # Debug panel
│   │   │   ├── MCPManager/      # MCP management
│   │   │   ├── SkillsManager/   # Skills management
│   │   │   └── Settings/        # Settings components
│   │   ├── pages/               # Page components
│   │   ├── store/               # Zustand state
│   │   ├── services/            # API services
│   │   └── types/               # TypeScript types
│   ├── package.json             # Node dependencies
│   └── vite.config.ts           # Vite configuration
│
├── docs/                        # Documentation
│   └── i18n/                    # Internationalization
│       └── README_CN.md         # Chinese documentation
├── skills/                      # Skills packages directory
├── projects/                    # Project storage directory
└── README.md                    # Main documentation
```

---

## 🔧 Development Guide

### Adding a New LLM Provider

1. Create a new model file in `backend/SoloAgent/model/`
2. Inherit from `ChatModelBase` interface
3. Implement required methods: `__call__()`, streaming support
4. Register the new provider in `LLMFactory`

### Adding a New MCP Transport Type

1. Add new transport method in `backend/SoloAgent/plugins/mcp/mcp_client.py`
2. Implement `_connect_xxx()` method
3. Update `MCPServerConfig` model

### Adding a New Node Type

1. Add type definition in `frontend/src/types/canvas.ts`
2. Create corresponding node component
3. Add configuration form in `PropertyEditor`

---

## 🗺️ Roadmap

### ✅ Phase 1: Core Features

- [x] LLM Integration (OpenAI, Claude, Qwen, Ollama)
- [x] MCP Protocol Integration (stdio, SSE, HTTP)
- [x] Skills Package System
- [x] Debug Panel
- [x] OpenAI Function Calling
- [x] Planning System

### ✅ Phase 2: User Experience

- [x] Main menu and routing system
- [x] User authentication
- [x] Project export/import
- [x] Packaging functionality
- [x] Execution history
- [x] Optimistic locking
- [x] Frontend model configuration management

### 📋 Phase 3: Advanced Features

- [ ] Open marketplace
- [ ] Performance optimization
- [ ] Advanced node types
- [ ] Template marketplace
- [ ] Collaboration features

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Create a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**SoloEngine** - Making AI Agent Development Simple

</div>
