# Agentic AI 可视化低代码平台

一个革命性的低代码/无代码平台，致力于将复杂的Agentic AI（自主多智能体协作系统）的开发门槛降至最低。用户通过简单的拖拽、连线与配置，即可创建出能理解高层目标、智能拆解任务、并自主执行的"AI团队"。

## 项目概述

### 核心特性

- **三种节点类型**：Orchestrator（协调者）、Planner（规划者）、Executor（执行者）
- **可视化编排**：基于React Flow的拖拽式流程图编辑器
- **智能提示词生成**：根据节点连接关系自动生成提示词
- **实时执行监控**：通过WebSocket实时查看执行状态
- **工具集成**：支持MCP协议和OpenAI Function Calling
- **多LLM支持**：支持OpenAI、Anthropic、通义千问等多种大语言模型

### 技术架构

```
[用户浏览器]
    ↓
[前端可视化层 (React + React Flow)]
    ↓
[后端API网关层 (FastAPI)]
    ↓
[Agentic 运行时引擎]
    ↓
[外部服务层 (LLM, MCP, 第三方API)]
```

## 技术栈

### 后端

- **框架**：FastAPI 0.104.1
- **服务器**：Uvicorn 0.24.0
- **WebSocket**：WebSockets 12.0
- **数据校验**：Pydantic 2.5.0
- **LLM API**：OpenAI 1.3.5

### 前端

- **框架**：React 18 + TypeScript
- **流程图**：React Flow 11.10.1
- **状态管理**：Zustand 4.4.7
- **UI组件**：Ant Design 5.11.7
- **构建工具**：Vite 5.0.8

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+
- npm 或 yarn

### 后端启动

1. 进入后端目录：
```bash
cd backend
```

2. 安装依赖：
```bash
pip install -r requirements.txt
```

3. 配置环境变量：
编辑 `.env` 文件，设置必要的配置：
```env
OPENAI_API_KEY=your_openai_api_key_here
DATABASE_URL=sqlite:///./agentic_workflow.db
SECRET_KEY=your_secret_key_here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
```

4. 启动后端服务：
```bash
python main.py
```

后端服务将在 `http://localhost:8000` 启动。

### 前端启动

1. 进入前端目录：
```bash
cd frontend
```

2. 安装依赖：
```bash
npm install
```

3. 启动前端开发服务器：
```bash
npm run dev
```

前端应用将在 `http://localhost:3000` 启动。

## 使用指南

### 创建项目

1. 点击顶部导航栏的"新建项目"按钮
2. 输入项目名称并确认

### 添加节点

1. 从左侧节点面板拖拽节点到画布
2. 支持三种节点类型：
   - **协调者 Orchestrator**：负责管理整体流程
   - **规划者 Planner**：负责拆解复杂目标
   - **执行者 Executor**：负责执行具体任务

### 连接节点

1. 从节点的输出端口（底部）拖拽到另一个节点的输入端口（顶部）
2. 连线代表智能体间的协作关系

### 配置节点

1. 点击画布上的节点
2. 在右侧属性编辑器中配置：
   - 节点名称和简介
   - 系统提示词、用户提示词、助手提示词
   - 模型配置（提供商和模型名称）
   - 绑定的技能

### 智能提示词生成

1. 选中节点后，点击"智能生成提示词"按钮
2. 系统会根据节点连接关系自动生成提示词

### 执行任务

1. 在右侧预览面板输入任务描述
2. 点击"开始执行"按钮
3. 在监控面板查看实时执行状态

## API接口

### 项目管理

- `GET /api/v1/projects` - 获取项目列表
- `POST /api/v1/projects` - 创建新项目
- `GET /api/v1/projects/{project_id}/canvas` - 获取画布数据
- `PUT /api/v1/projects/{project_id}/canvas` - 更新画布数据
- `POST /api/v1/projects/{project_id}/run` - 启动任务执行

### 工具管理

- `GET /api/v1/tools` - 获取工具列表
- `POST /api/v1/tools` - 注册新工具
- `DELETE /api/v1/tools/{tool_id}` - 删除工具

### WebSocket

- `WS /api/v1/ws/{task_id}` - 实时执行状态推送

## 项目结构

```
.
├── backend/                 # 后端项目
│   ├── app/
│   │   ├── api/            # API路由
│   │   ├── core/           # 核心引擎
│   │   ├── models/         # 数据模型
│   │   └── schemas/        # 数据校验
│   ├── main.py             # 应用入口
│   ├── requirements.txt    # Python依赖
│   └── .env                # 环境配置
├── frontend/               # 前端项目
│   ├── src/
│   │   ├── components/     # React组件
│   │   ├── services/       # API服务
│   │   ├── store/          # 状态管理
│   │   ├── types/          # TypeScript类型
│   │   └── utils/          # 工具函数
│   ├── package.json        # Node依赖
│   └── vite.config.ts      # Vite配置
└── README.md              # 项目文档
```

## 开发计划

- [x] 后端项目结构搭建
- [x] 核心引擎实现
- [x] API接口实现
- [x] 前端项目结构搭建
- [x] 核心组件实现
- [x] WebSocket通信实现
- [x] 智能提示词生成
- [ ] MCP服务器集成
- [ ] OpenAI Function Calling集成
- [ ] 用户认证与权限管理
- [ ] 项目导出与导入
- [ ] 执行历史记录
- [ ] 性能优化

## 贡献指南

欢迎提交Issue和Pull Request！

## 许可证

MIT License

## 联系方式

如有问题或建议，请通过Issue联系我们。
