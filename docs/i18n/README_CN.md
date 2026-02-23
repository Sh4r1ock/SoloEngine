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

## 📖 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [技术架构](#技术架构)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [配置指南](#配置指南)
- [核心功能](#核心功能)
- [API 文档](#api-文档)
- [项目结构](#项目结构)
- [开发指南](#开发指南)
- [路线图](#路线图)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 🚀 项目简介

SoloEngine 是一个功能完整的 Agentic AI 可视化低代码平台，致力于将复杂的多智能体协作系统的开发门槛降至最低。平台的核心创新在于将智能体管理抽象为"公司管理"隐喻：

- 🏢 **搭建组织架构**：在可视化画布上，拖拽角色、定义职责、建立汇报关系
- 🎯 **下达战略目标**：输入一个宏观的自然语言目标，整个"AI公司"将自主运作

---

## ✨ 核心特性

| 特性 | 描述 |
|------|------|
| 🎨 **可视化编排** | 基于 ReactFlow 的拖拽式画布编辑器，所见即所得 |
| 🤖 **三层节点架构** | Orchestrator 协调者、Planner 规划者、Executor 执行者 |
| 🔌 **MCP 协议集成** | 支持 stdio、SSE、HTTP 多种传输协议 |
| 🛠️ **Skills 包系统** | 可扩展的技能包管理机制，封装领域专业知识 |
| 🐛 **调试面板** | 断点调试、单步执行、变量查看、执行历史回放 |
| 🔐 **用户认证** | JWT 认证与乐观锁并发控制，用户数据完全隔离 |
| 🔑 **安全配置** | API Key 加密存储，前端可视化管理模型配置 |

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端应用层                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  画布编辑器  │ │  属性编辑器  │ │  调试面板   │ │  工具面板  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                         API 网关层                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  RESTful API  │  WebSocket 实时通信  │  文件上传下载         ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│                         业务逻辑层                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  画布解析器  │ │  任务调度器  │ │  上下文管理  │ │ 工具注册  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                       SoloAgent 核心框架                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  ReAct引擎  │ │  消息系统   │ │  插件系统   │ │ 模型适配  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                         插件扩展层                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  MCP客户端  │ │  Skills系统 │ │  记忆插件   │ │  RAG插件  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                         数据存储层                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  项目数据  │  用户数据  │  执行历史  │  Skills包  │  MCP配置 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## 💻 技术栈

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | 3.11+ | 核心运行时 |
| FastAPI | 0.115+ | Web 框架 |
| Uvicorn | 0.32+ | ASGI 服务器 |
| Pydantic | 2.10+ | 数据验证 |
| SQLAlchemy | 2.0+ | ORM |
| OpenAI SDK | 1.59+ | OpenAI API |
| Anthropic SDK | 0.40+ | Claude API |
| DashScope | 1.20+ | 通义千问 API |
| Ollama SDK | 0.6+ | 本地模型 |
| PyJWT | 2.10+ | JWT 认证 |
| pwdlib | 0.3+ | 密码哈希 |
| MCP SDK | 1.3+ | MCP 协议 |
| cryptography | 44.0+ | API Key 加密 |

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.2 | UI 框架 |
| TypeScript | 5.3 | 类型安全 |
| ReactFlow | 11.10 | 流程图编辑 |
| Zustand | 4.4 | 状态管理 |
| Ant Design | 5.11 | UI 组件库 |
| Vite | 5.0 | 构建工具 |
| Axios | 1.6 | HTTP 客户端 |

---

## 🏃 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- npm 或 yarn
- Conda（推荐）

### 安装步骤

#### 1. 克隆项目

```bash
git clone https://github.com/your-username/SoloEngine.git
cd SoloEngine
```

#### 2. 后端启动

```bash
cd backend

# 创建并激活 conda 环境
conda create -n SoloEngine python=3.11
conda activate SoloEngine

# 安装依赖
pip install -r requirements.txt

# 启动服务
python main.py
```

后端服务将在 `http://localhost:8000` 启动。

#### 3. 前端启动

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端应用将在 `http://localhost:3000` 启动。

### 生产构建

```bash
# 前端构建
cd frontend
npm run build

# 后端生产启动
cd backend
conda activate SoloEngine
uvicorn app:app --host 0.0.0.0 --port 8000
```

---

## ⚙️ 配置指南

### 系统配置

`.env` 文件包含系统级配置，位于 `backend/.env`：

```env
# 系统安全配置
SECRET_KEY=your_secret_key_here

# 数据库配置
DATABASE_URL=sqlite:///./data/database/soloengine.db

# 服务器配置
BACKEND_HOST=0.0.0.0
BACKEND_PORT=8000
FRONTEND_URL=http://localhost:5173

# 日志配置
LOG_LEVEL=INFO
LOG_FILE=./logs/soloengine.log
```

> ⚠️ **安全提示**：生产环境请务必修改 `SECRET_KEY` 为随机字符串。

### 用户配置

所有 LLM 相关的用户配置通过前端设置页面管理：

| 配置项 | 配置位置 | 说明 |
|--------|----------|------|
| OpenAI API Key | 设置 > 模型管理 | AES-GCM 加密存储 |
| Anthropic API Key | 设置 > 模型管理 | AES-GCM 加密存储 |
| 通义千问 API Key | 设置 > 模型管理 | AES-GCM 加密存储 |
| Ollama 服务地址 | 设置 > 模型管理 | 本地模型服务地址 |
| 模型参数 | 设置 > 模型管理 | 温度、最大Token等 |

### 首次使用流程

1. 启动后端和前端服务
2. 注册并登录账户
3. 进入「设置」>「模型管理」
4. 点击「新建配置」添加 LLM 配置
5. 填写配置名称、选择提供商、输入 API Key
6. 点击「测试连接」验证配置
7. 保存配置并设为默认

### 画布使用

1. 在画布中选择节点
2. 在右侧属性面板的「LLM配置」下拉框中选择已配置的模型
3. 配置会自动保存到节点中

---

## 🎯 核心功能

### 三层节点架构

平台提供三种基础节点类型，覆盖公司运作的核心职能：

| 节点类型 | 角色 | 职责 | 颜色标识 |
|----------|------|------|----------|
| **Orchestrator** | CEO/总经理 | 全局指挥，分解宏观阶段，决策调度 | 蓝色 |
| **Planner** | COO/部门总监 | 策略规划，拆解目标为可执行步骤 | 绿色 |
| **Executor** | 专业员工 | 战术执行，调用工具产出成果 | 橙色 |

### 多 LLM 支持

| 提供商 | 模型 | 特性 |
|--------|------|------|
| OpenAI | GPT-4, GPT-3.5, GPT-4o, o3-mini | 流式输出、工具调用、Token 计数 |
| Anthropic | Claude 3 系列 | 流式输出、长上下文、工具调用 |
| 阿里云 | 通义千问 | 流式输出、中文优化 |
| Ollama | 本地模型 | 隐私保护、离线运行 |

### MCP 协议集成

- **多传输支持**：HTTP、WebSocket、stdio、SSE
- **工具发现**：自动发现 MCP 服务器提供的工具
- **资源管理**：访问 MCP 资源和提示词
- **开源 MCP 导入**：一键导入开源 MCP 配置

### Skills 包系统

Skills 包是封装专业知识的文件夹，将通用 AI 模型转化为特定任务的领域专家：

```
skill-package/
├── SKILL.md           # 元数据 + 指令
├── skills/            # 具体技能目录
│   └── skill-name/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
└── common/            # 公共资源
```

### 调试面板

- **断点调试**：设置断点，暂停执行
- **单步执行**：逐步调试智能体行为
- **变量查看**：实时查看执行状态
- **执行历史**：完整的执行记录和回放

---

## 📚 API 文档

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
| GET | `/api/v1/llm/providers/{provider}/models` | 获取提供商支持的模型列表 |
| GET | `/api/v1/llm/configs` | 获取用户的所有 LLM 配置 |
| POST | `/api/v1/llm/configs` | 创建 LLM 配置 |
| PUT | `/api/v1/llm/configs/{config_id}` | 更新 LLM 配置 |
| DELETE | `/api/v1/llm/configs/{config_id}` | 删除 LLM 配置 |
| POST | `/api/v1/llm/configs/{config_id}/set-default` | 设置默认配置 |
| POST | `/api/v1/llm/test` | 测试 LLM 配置 |
| GET | `/api/v1/llm/usage` | 获取使用统计 |

### 项目管理 API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/projects` | 获取项目列表 |
| POST | `/api/v1/projects` | 创建新项目 |
| GET | `/api/v1/projects/{id}` | 获取项目详情 |
| PUT | `/api/v1/projects/{id}` | 更新项目 |
| DELETE | `/api/v1/projects/{id}` | 删除项目 |
| GET | `/api/v1/projects/{id}/canvas` | 获取画布数据 |
| PUT | `/api/v1/projects/{id}/canvas` | 保存画布数据 |
| POST | `/api/v1/projects/{id}/run` | 运行项目 |

### MCP 管理 API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/mcp/servers` | 列出所有服务器 |
| POST | `/api/v1/mcp/servers` | 添加服务器 |
| PUT | `/api/v1/mcp/servers/{id}` | 更新服务器 |
| DELETE | `/api/v1/mcp/servers/{id}` | 删除服务器 |
| GET | `/api/v1/mcp/servers/{id}/tools` | 获取服务器工具 |
| POST | `/api/v1/mcp/servers/{id}/connect` | 连接服务器 |
| POST | `/api/v1/mcp/servers/test` | 测试连接 |
| GET | `/api/v1/mcp/open-source` | 获取开源 MCP 列表 |
| POST | `/api/v1/mcp/import` | 导入开源 MCP |

### Skills 管理 API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/v1/skills/packages` | 列出所有包 |
| POST | `/api/v1/skills/packages` | 创建包 |
| GET | `/api/v1/skills/packages/{id}` | 获取包详情 |
| PUT | `/api/v1/skills/packages/{id}` | 更新包 |
| DELETE | `/api/v1/skills/packages/{id}` | 删除包 |
| POST | `/api/v1/skills/packages/{id}/activate` | 激活包 |
| POST | `/api/v1/skills/import` | 导入包 |

### 调试 API

| 方法 | 端点 | 描述 |
|------|------|------|
| POST | `/api/v1/debug/start` | 启动调试会话 |
| POST | `/api/v1/debug/stop` | 停止调试会话 |
| POST | `/api/v1/debug/pause` | 暂停调试 |
| POST | `/api/v1/debug/resume` | 恢复调试 |
| POST | `/api/v1/debug/step` | 单步执行 |
| POST | `/api/v1/debug/breakpoint` | 设置断点 |
| GET | `/api/v1/debug/sessions` | 获取会话列表 |
| POST | `/api/v1/debug/execute` | 执行 JSON 工作流 |

### WebSocket

| 端点 | 描述 |
|------|------|
| `WS /api/v1/debug/ws/{session_id}` | 实时调试消息 |

---

## 📁 项目结构

```
SoloEngine/
├── backend/                      # 后端项目
│   ├── SoloAgent/               # Agent 运行时框架
│   │   ├── core/                # 核心模块
│   │   │   ├── react_core.py    # ReAct 循环实现
│   │   │   └── interfaces.py    # 插件接口定义
│   │   ├── model/               # LLM 模型实现
│   │   │   ├── openai_model.py
│   │   │   ├── anthropic_model.py
│   │   │   ├── qwen_model.py
│   │   │   ├── ollama_model.py
│   │   │   └── llm_factory.py
│   │   ├── plugins/             # 插件系统
│   │   │   ├── mcp/             # MCP 客户端
│   │   │   ├── memory/          # 内存插件
│   │   │   ├── rag/             # RAG 插件
│   │   │   └── tools/           # 工具插件
│   │   ├── embedding/           # 向量嵌入
│   │   ├── token_counter/       # Token 计数
│   │   └── assembly/            # Agent 组装器
│   ├── app/                     # FastAPI 应用
│   │   ├── api/v1/              # API 路由
│   │   ├── core/                # 核心服务
│   │   ├── models/              # 数据模型
│   │   └── schemas/             # 数据校验
│   ├── main.py                  # 应用入口
│   └── requirements.txt         # Python 依赖
│
├── frontend/                    # 前端项目
│   ├── src/
│   │   ├── components/          # React 组件
│   │   │   ├── Canvas/          # 画布组件
│   │   │   ├── PropertyEditor/  # 属性编辑器
│   │   │   ├── DebugPanel/      # 调试面板
│   │   │   ├── MCPManager/      # MCP 管理
│   │   │   ├── SkillsManager/   # Skills 管理
│   │   │   └── Settings/        # 设置组件
│   │   ├── pages/               # 页面组件
│   │   ├── store/               # Zustand 状态
│   │   ├── services/            # API 服务
│   │   └── types/               # TypeScript 类型
│   ├── package.json             # Node 依赖
│   └── vite.config.ts           # Vite 配置
│
├── docs/                        # 文档目录
│   └── i18n/                    # 多语言文档
│       └── README_CN.md         # 中文文档
├── skills/                      # Skills 包目录
├── projects/                    # 项目存储目录
└── README.md                    # 项目主文档
```

---

## 🔧 开发指南

### 添加新的 LLM 提供商

1. 在 `backend/SoloAgent/model/` 创建新模型文件
2. 继承 `ChatModelBase` 接口
3. 实现必要的方法：`__call__()`, 流式输出支持
4. 在 `LLMFactory` 中注册新提供商

### 添加新的 MCP 传输类型

1. 在 `backend/SoloAgent/plugins/mcp/mcp_client.py` 添加新传输方法
2. 实现 `_connect_xxx()` 方法
3. 更新 `MCPServerConfig` 模型

### 添加新的节点类型

1. 在前端 `frontend/src/types/canvas.ts` 添加类型定义
2. 创建对应的节点组件
3. 在 `PropertyEditor` 中添加配置表单

---

## 🗺️ 路线图

### ✅ 第一阶段：核心功能

- [x] LLM 集成（OpenAI、Claude、Qwen、Ollama）
- [x] MCP 协议集成（stdio、SSE、HTTP）
- [x] Skills 包系统
- [x] 调试面板
- [x] OpenAI Function Calling
- [x] 计划系统

### ✅ 第二阶段：用户体验

- [x] 主菜单和路由系统
- [x] 用户认证
- [x] 项目导出/导入
- [x] 打包功能
- [x] 执行历史
- [x] 乐观锁机制
- [x] 前端模型配置管理

### 📋 第三阶段：高级功能

- [ ] 开放市场
- [ ] 性能优化
- [ ] 高级节点类型
- [ ] 模板市场
- [ ] 协作功能

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](../../LICENSE) 文件

---

<div align="center">

**SoloEngine** - 让 AI 智能体开发变得简单

</div>
