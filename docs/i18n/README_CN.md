<div align="center">

# SoloEngine

**Agentic AI 可视化低代码平台**

通过可视化拖拽、连线与配置，创建能理解高层目标、智能拆解任务、并自主执行的"AI团队"

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?style=flat-square&logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](../../LICENSE)

**语言**: [English](../../README.md) | 简体中文

</div>

---

## 目录

- [什么是 SoloEngine？](#什么是-soloengine)
- [设计理念](#设计理念)
  - [ReAct 架构](#react-架构)
  - [微内核设计](#微内核设计)
  - [三层节点架构](#三层节点架构)
- [核心特性](#核心特性)
- [快速开始](#快速开始)
  - [环境要求](#环境要求)
  - [安装步骤](#安装步骤)
  - [首次使用](#首次使用)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [API 参考](#api-参考)
- [配置指南](#配置指南)
- [路线图](#路线图)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 什么是 SoloEngine？

SoloEngine 是一个功能完整的 Agentic AI 可视化低代码平台，致力于将复杂的多智能体协作系统的开发门槛降至最低。平台的核心创新在于将智能体管理抽象为"公司管理"隐喻：

- 🏢 **搭建组织架构**：在可视化画布上，拖拽角色、定义职责、建立汇报关系
- 🎯 **下达战略目标**：输入一个宏观的自然语言目标，整个"AI公司"将自主运作

---

## 设计理念

### ReAct 架构

SoloEngine 的核心 SoloAgent 框架基于 **ReAct（Reasoning + Acting）** 架构构建。Agent 循环的每次迭代包含：

1. **Thought（思考）**：分析当前状态，决定下一步行动
2. **Action（行动）**：执行工具调用或生成响应
3. **Observation（观察）**：获取行动结果，更新状态

这种架构使 Agent 能够将复杂任务分解为可管理的步骤，迭代地做出决策并采取行动，直到目标达成。

### 微内核设计

核心框架遵循**微内核架构**，核心只负责控制流，所有功能通过插件接口扩展：

- **IMemory**：记忆插件，用于对话历史和上下文存储
- **IRAG**：检索增强生成插件，用于知识库检索
- **IToolExecutor**：工具执行器，用于函数调用
- **IMCPClient**：MCP 客户端，用于 Model Context Protocol
- **IPlanNotebook**：计划笔记本，用于任务规划
- **ITTSModel**：TTS 模型，用于语音合成

### 三层节点架构

平台提供三种基础节点类型，覆盖公司运作的核心职能：

| 节点类型 | 角色 | 职责 | 颜色标识 |
|----------|------|------|----------|
| **Orchestrator** | CEO/总经理 | 全局指挥，分解宏观阶段，决策调度 | 蓝色 |
| **Planner** | COO/部门总监 | 策略规划，拆解目标为可执行步骤 | 绿色 |
| **Executor** | 专业员工 | 战术执行，调用工具产出成果 | 橙色 |

---

## 核心特性

| 特性 | 描述 |
|------|------|
| 🎨 **可视化编排** | 基于 ReactFlow 的拖拽式画布编辑器，所见即所得 |
| 🤖 **多 LLM 支持** | OpenAI、Anthropic、Qwen、Ollama、DeepSeek、智谱 |
| 🔌 **MCP 协议集成** | 支持 stdio、SSE、HTTP 多种传输协议 |
| 🛠️ **Skills 包系统** | 可扩展的技能包管理机制，封装领域专业知识 |
| ▶️ **运行面板** | 工作流执行、对话记录、操作记录、文件浏览编辑 |
| 🔐 **用户认证** | JWT 认证与乐观锁并发控制，用户数据完全隔离 |
| 🔑 **安全配置** | AES-GCM 加密存储 API Key |

---

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- npm 或 yarn
- Conda（推荐）

### 安装步骤

```bash
# 克隆项目
git clone https://github.com/your-username/SoloEngine.git
cd SoloEngine

# 启动后端
cd backend
conda create -n SoloEngine python=3.11
conda activate SoloEngine
pip install -r requirements.txt
python main.py

# 启动前端（新终端）
cd frontend
npm install
npm run dev
```

**服务地址：**
- 后端API：`http://localhost:8990`
- 前端应用：`http://localhost:8991`
- MCP管理服务：`http://localhost:8992`

### 首次使用

1. 启动后端和前端服务
2. 注册并登录账户
3. 进入「设置」>「模型管理」
4. 添加 LLM 配置（OpenAI、Anthropic、Qwen 等）
5. 测试连接并设为默认

---

## 技术栈

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.11+ | 核心运行时 |
| FastAPI | 0.115+ | Web 框架 |
| SQLAlchemy | 2.0+ | ORM |
| PyJWT | 2.10+ | JWT 认证 |
| MCP SDK | 1.3+ | MCP 协议 |

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.2 | UI 框架 |
| TypeScript | 5.3 | 类型安全 |
| ReactFlow | 11.10 | 流程图编辑 |
| Zustand | 4.4 | 状态管理 |
| Ant Design | 5.11 | UI 组件库 |
| Vite | 5.0 | 构建工具 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     前端应用 (React)                         │
│  画布编辑器 │ 属性编辑器 │ 运行面板 │ 设置                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   后端 API (FastAPI)                         │
│  认证 │ 项目管理 │ LLM配置 │ MCP │ Skills │ 运行             │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  SoloAgent      │ │  MCP 服务       │ │  Skills 系统    │
│  框架           │ │  (端口 8992)    │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## 项目结构

```
SoloEngine/
├── backend/                      # 后端项目
│   ├── SoloAgent/               # Agent 运行时框架
│   │   ├── core/                # 核心：ReAct 循环、接口
│   │   ├── model/               # LLM 实现
│   │   ├── plugins/             # 插件系统
│   │   │   ├── mcp/             # MCP 客户端
│   │   │   ├── memory/          # 记忆插件
│   │   │   ├── rag/             # RAG 插件
│   │   │   ├── tools/           # 工具插件
│   │   │   └── tts/             # TTS 插件
│   │   └── solo_agent/          # Agent 组装
│   ├── app/                     # FastAPI 应用
│   │   ├── api/v1/              # API 路由
│   │   ├── core/                # 核心服务
│   │   └── models/              # 数据模型
│   ├── mcp_service/             # MCP 服务（端口 8992）
│   └── main.py                  # 入口文件（端口 8990）
│
├── frontend/                    # 前端项目
│   ├── src/
│   │   ├── components/          # React 组件
│   │   │   ├── Canvas/          # 画布组件
│   │   │   ├── PropertyEditor/  # 属性编辑器
│   │   │   ├── RunPanel/        # 运行面板
│   │   │   ├── MCPManager/      # MCP 管理
│   │   │   └── SkillsManager/   # Skills 管理
│   │   ├── pages/               # 页面组件
│   │   ├── store/               # Zustand 状态
│   │   └── services/            # API 服务
│   └── vite.config.ts           # Vite 配置（端口 8991）
│
├── data/                        # 数据目录
│   ├── skills/                  # 用户技能包
│   ├── system_skills/           # 系统技能包
│   └── database/                # SQLite 数据库
│
└── docs/                        # 文档
```

---

## API 参考

### 认证 API

| 方法 | 端点 | 描述 |
|------|------|------|
| POST | `/api/v1/auth/register` | 用户注册 |
| POST | `/api/v1/auth/login` | 用户登录 |
| POST | `/api/v1/auth/refresh` | 刷新令牌 |
| GET | `/api/v1/auth/me` | 获取当前用户 |

### LLM 配置 API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/llm/providers` | 获取所有 LLM 提供商 |
| GET | `/api/v1/llm/configs` | 获取用户的所有 LLM 配置 |
| POST | `/api/v1/llm/configs` | 创建 LLM 配置 |
| POST | `/api/v1/llm/test` | 测试 LLM 配置 |

### 项目管理 API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/agentic-flows` | 获取工作流列表 |
| POST | `/api/v1/agentic-flows` | 创建工作流 |
| GET | `/api/v1/agentic-flows/{id}` | 获取工作流详情 |
| PUT | `/api/v1/agentic-flows/{id}/canvas` | 保存画布数据 |

### MCP 管理 API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/mcp/servers` | 列出所有服务器 |
| POST | `/api/v1/mcp/servers` | 添加服务器 |
| GET | `/api/v1/mcp/servers/{id}/tools` | 获取服务器工具 |

### Skills 管理 API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/skills/packages` | 列出所有包 |
| POST | `/api/v1/skills/packages` | 创建包 |
| POST | `/api/v1/skills/import` | 导入包 |

### 运行 API

| 方法 | 端点 | 描述 |
|------|------|------|
| POST | `/api/v1/run/execute` | 执行工作流 |
| POST | `/api/v1/run/execute-node` | 执行单个节点 |
| GET | `/api/v1/run/sessions` | 获取运行会话列表 |
| GET | `/api/v1/run/sessions/{id}` | 获取会话详情 |
| GET | `/api/v1/run/sessions/{id}/export` | 导出会话数据 |

---

## 配置指南

### 系统配置

`.env` 文件包含系统级配置（`backend/.env`）：

```env
SECRET_KEY=your_secret_key_here
ENCRYPTION_KEY=your_encryption_key_here
```

### 用户配置

所有 LLM 配置通过前端设置页面管理：

| 提供商 | 配置位置 |
|--------|----------|
| OpenAI | 设置 > 模型管理 |
| Anthropic | 设置 > 模型管理 |
| 通义千问 | 设置 > 模型管理 |
| Ollama | 设置 > 模型管理 |
| DeepSeek | 设置 > 模型管理 |
| 智谱 | 设置 > 模型管理 |

---

## 路线图

### ✅ 第一阶段：核心功能
- [x] LLM 集成（OpenAI、Claude、Qwen、Ollama、DeepSeek、智谱）
- [x] MCP 协议集成
- [x] Skills 包系统
- [x] 运行面板

### ✅ 第二阶段：用户体验
- [x] 用户认证
- [x] 项目导出/导入
- [x] 执行历史
- [x] 前端模型配置

### 📋 第三阶段：高级功能
- [ ] 开放市场
- [ ] 性能优化
- [ ] 协作功能

---

## 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](../../LICENSE) 文件

---

<div align="center">

**SoloEngine** - 让 AI 智能体开发变得简单

</div>
