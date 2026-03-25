<div align="center">

# SoloEngine

**Agentic AI Visual Low-Code Platform**

Create "AI Teams" that understand high-level goals, intelligently decompose tasks, and execute autonomously through visual drag-and-drop, wiring, and configuration

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)

**Language**: English | [简体中文](./docs/i18n/README_CN.md)

</div>

---

## Table of Contents

- [What is SoloEngine?](#what-is-soloengine)
- [Design Philosophy](#design-philosophy)
  - [ReAct Architecture](#react-architecture)
  - [Microkernel Design](#microkernel-design)
  - [Three-Layer Node Architecture](#three-layer-node-architecture)
- [Core Features](#core-features)
- [Quick Start](#quick-start)
  - [Requirements](#requirements)
  - [Installation](#installation)
  - [First Time Setup](#first-time-setup)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Configuration Guide](#configuration-guide)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What is SoloEngine?

SoloEngine is a fully-featured Agentic AI visual low-code platform dedicated to minimizing the barrier to developing complex multi-agent collaborative systems. The platform's core innovation lies in abstracting agent management as a "company management" metaphor:

- 🏢 **Build Organizational Structure**: Drag roles, define responsibilities, and establish reporting relationships on a visual canvas
- 🎯 **Set Strategic Goals**: Input a high-level natural language goal, and the entire "AI company" operates autonomously

---

## Design Philosophy

### ReAct Architecture

SoloEngine's core SoloAgent framework is built on the **ReAct (Reasoning + Acting)** architecture. Each iteration of the Agent loop includes:

1. **Thought**: Analyze current state, decide next action
2. **Action**: Execute tool calls or generate responses
3. **Observation**: Get action results, update state

This architecture enables Agents to decompose complex tasks into manageable steps, iteratively make decisions and take actions until goals are achieved.

### Microkernel Design

The core framework follows a **microkernel architecture**, where the core only handles control flow, and all functionality is extended through plugin interfaces:

- **IMemory**: Memory plugin for conversation history and context storage
- **IRAG**: Retrieval-Augmented Generation plugin for knowledge base retrieval
- **IToolExecutor**: Tool executor for function calls
- **IMCPClient**: MCP client for Model Context Protocol
- **IPlanNotebook**: Plan notebook for task planning
- **ITTSModel**: TTS model for speech synthesis

### Three-Layer Node Architecture

The platform provides three basic node types covering core functions of company operations:

| Node Type | Role | Responsibility | Color |
|-----------|------|----------------|-------|
| **Orchestrator** | CEO/General Manager | Global command, decompose macro phases, decision scheduling | Blue |
| **Planner** | COO/Department Director | Strategic planning, break down goals into executable steps | Green |
| **Executor** | Professional Staff | Tactical execution, call tools to produce results | Orange |

---

## Core Features

| Feature | Description |
|---------|-------------|
| 🎨 **Visual Orchestration** | ReactFlow-based drag-and-drop canvas editor, WYSIWYG |
| 🤖 **Multi-LLM Support** | OpenAI, Anthropic, Qwen, Ollama, DeepSeek, Zhipu |
| 🔌 **MCP Protocol Integration** | Support for stdio, SSE, HTTP transport protocols |
| 🛠️ **Skills Package System** | Extensible skill package management mechanism, encapsulating domain expertise |
| ▶️ **Run Panel** | Workflow execution, conversation logs, operation records, file browsing and editing |
| 🔐 **User Authentication** | JWT authentication with optimistic lock concurrency control, complete user data isolation |
| 🔑 **Secure Configuration** | AES-GCM encrypted storage of API Keys |

---

## Quick Start

### Requirements

- Python 3.11+
- Node.js 18+
- npm or yarn
- Conda (recommended)

### Installation

```bash
# Clone the project
git clone https://github.com/your-username/SoloEngine.git
cd SoloEngine

# Start backend
cd backend
conda create -n SoloEngine python=3.11
conda activate SoloEngine
pip install -r requirements.txt
python main.py

# Start frontend (new terminal)
cd frontend
npm install
npm run dev
```

**Service Addresses:**
- Backend API: `http://localhost:8990`
- Frontend App: `http://localhost:8991`
- MCP Management Service: `http://localhost:8992`

### First Time Setup

1. Start backend and frontend services
2. Register and login to your account
3. Go to "Settings" > "Model Management"
4. Add LLM configuration (OpenAI, Anthropic, Qwen, etc.)
5. Test connection and set as default

---

## Tech Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Python | 3.11+ | Core runtime |
| FastAPI | 0.115+ | Web framework |
| SQLAlchemy | 2.0+ | ORM |
| PyJWT | 2.10+ | JWT authentication |
| MCP SDK | 1.3+ | MCP protocol |

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.2 | UI framework |
| TypeScript | 5.3 | Type safety |
| ReactFlow | 11.10 | Flowchart editing |
| Zustand | 4.4 | State management |
| Ant Design | 5.11 | UI component library |
| Vite | 5.0 | Build tool |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend App (React)                    │
│  Canvas Editor │ Property Editor │ Run Panel │ Settings     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend API (FastAPI)                     │
│  Auth │ Project Mgmt │ LLM Config │ MCP │ Skills │ Run      │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  SoloAgent      │ │  MCP Service    │ │  Skills System  │
│  Framework      │ │  (Port 8992)    │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Project Structure

```
SoloEngine/
├── backend/                      # Backend project
│   ├── SoloAgent/               # Agent runtime framework
│   │   ├── core/                # Core: ReAct loop, interfaces
│   │   ├── model/               # LLM implementations
│   │   ├── plugins/             # Plugin system
│   │   │   ├── mcp/             # MCP client
│   │   │   ├── memory/          # Memory plugin
│   │   │   ├── rag/             # RAG plugin
│   │   │   ├── tools/           # Tool plugins
│   │   │   └── tts/             # TTS plugin
│   │   └── solo_agent/          # Agent assembly
│   ├── app/                     # FastAPI application
│   │   ├── api/v1/              # API routes
│   │   ├── core/                # Core services
│   │   └── models/              # Data models
│   ├── mcp_service/             # MCP service (port 8992)
│   └── main.py                  # Entry file (port 8990)
│
├── frontend/                    # Frontend project
│   ├── src/
│   │   ├── components/          # React components
│   │   │   ├── Canvas/          # Canvas components
│   │   │   ├── PropertyEditor/  # Property editor
│   │   │   ├── RunPanel/        # Run panel
│   │   │   ├── MCPManager/      # MCP management
│   │   │   └── SkillsManager/   # Skills management
│   │   ├── pages/               # Page components
│   │   ├── store/               # Zustand state
│   │   └── services/            # API services
│   └── vite.config.ts           # Vite config (port 8991)
│
├── data/                        # Data directory
│   ├── skills/                  # User skill packages
│   ├── system_skills/           # System skill packages
│   └── database/                # SQLite database
│
└── docs/                        # Documentation
```

---

## API Reference

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
| GET | `/api/v1/llm/configs` | Get all user LLM configs |
| POST | `/api/v1/llm/configs` | Create LLM config |
| POST | `/api/v1/llm/test` | Test LLM config |

### Project Management API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/agentic-flows` | Get workflow list |
| POST | `/api/v1/agentic-flows` | Create workflow |
| GET | `/api/v1/agentic-flows/{id}` | Get workflow details |
| PUT | `/api/v1/agentic-flows/{id}/canvas` | Save canvas data |

### MCP Management API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/mcp/servers` | List all servers |
| POST | `/api/v1/mcp/servers` | Add server |
| GET | `/api/v1/mcp/servers/{id}/tools` | Get server tools |

### Skills Management API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/skills/packages` | List all packages |
| POST | `/api/v1/skills/packages` | Create package |
| POST | `/api/v1/skills/import` | Import package |

### Run API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/run/execute` | Execute workflow |
| POST | `/api/v1/run/execute-node` | Execute single node |
| GET | `/api/v1/run/sessions` | Get run session list |
| GET | `/api/v1/run/sessions/{id}` | Get session details |
| GET | `/api/v1/run/sessions/{id}/export` | Export session data |

---

## Configuration Guide

### System Configuration

The `.env` file contains system-level configuration (`backend/.env`):

```env
SECRET_KEY=your_secret_key_here
ENCRYPTION_KEY=your_encryption_key_here
```

### User Configuration

All LLM configurations are managed through the frontend settings page:

| Provider | Configuration Location |
|----------|------------------------|
| OpenAI | Settings > Model Management |
| Anthropic | Settings > Model Management |
| Tongyi Qwen | Settings > Model Management |
| Ollama | Settings > Model Management |
| DeepSeek | Settings > Model Management |
| Zhipu | Settings > Model Management |

---

## Roadmap

### ✅ Phase 1: Core Features
- [x] LLM Integration (OpenAI, Claude, Qwen, Ollama, DeepSeek, Zhipu)
- [x] MCP Protocol Integration
- [x] Skills Package System
- [x] Run Panel

### ✅ Phase 2: User Experience
- [x] User Authentication
- [x] Project Export/Import
- [x] Execution History
- [x] Frontend Model Configuration

### 📋 Phase 3: Advanced Features
- [ ] Open Marketplace
- [ ] Performance Optimization
- [ ] Collaboration Features

---

## Contributing

1. Fork this repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Create Pull Request

---

## License

This project is licensed under the MIT License - see [LICENSE](./LICENSE) file for details

---

<div align="center">

**SoloEngine** - Making AI Agent Development Simple

</div>
