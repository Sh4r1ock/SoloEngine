# SoloEngine 前端架构文档

## 1. 模块概述

### 1.1 作用
SoloEngine 前端是一个基于 React 18 构建的现代化 Web 应用，作为 SoloEngine 智能体工作流平台的用户交互界面。

### 1.2 定位
- 工作流可视化编辑界面
- Agent 运行界面
- MCP 工具与 Skills 技能包管理界面
- 用户认证与系统设置界面

### 1.3 核心功能
| 功能模块 | 描述 |
|---------|------|
| 画布编辑 | 基于 ReactFlow 的工作流可视化编辑，支持节点拖拽、连线、多选、注释 |
| 节点配置 | Agent 节点属性编辑，包括 LLM 配置、Prompt 模板、Skills 绑定 |
| 运行面板 | 工作流执行界面，支持 LLM 对话、Agentic 操作、文件浏览 |
| MCP 管理 | MCP 服务器配置、连接管理、工具浏览 |
| Skills 管理 | 技能包创建、导入、编辑、版本管理 |

---

## 2. 设计理念

### 2.1 组件化设计
采用 React 函数组件 + Hooks 模式，组件按功能域划分：

```
src/
├── components/          # 可复用组件
│   ├── Canvas/          # 画布相关组件
│   ├── RunPanel/        # 运行面板组件
│   ├── MCPManager/      # MCP 管理组件
│   ├── SkillsManager/   # Skills 管理组件
│   ├── PropertyEditor/  # 属性编辑器
│   └── ...
├── pages/               # 页面组件
│   ├── Editor/          # 编辑器页面
│   ├── Run/             # 运行页面
│   └── MainMenu/        # 主菜单页面
└── store/               # 状态管理
```

### 2.2 状态管理设计
使用 Zustand 实现集中式状态管理，按功能域划分 Store：

| Store | 职责 |
|-------|------|
| `canvasStore` | 画布节点、边、选中状态、撤销/重做历史 |
| `authStore` | 用户认证、登录状态、令牌管理 |
| `runStore` | 运行会话、执行状态、消息过滤 |
| `runProjectStore` | 运行项目、文件系统 |
| `mcpStore` | MCP 服务器列表、连接状态 |
| `skillsStore` | Skills 包列表、状态 |

状态管理示例：
```typescript
// canvasStore.ts
export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  history: [{ nodes: [], edges: [] }],
  historyIndex: 0,
  
  addNode: (node) => set((state) => {
    const newNodes = [...state.nodes, node];
    get().autoSave();
    get().pushHistory();
    return { nodes: newNodes };
  }),
  
  undo: () => { /* 撤销逻辑 */ },
  redo: () => { /* 重做逻辑 */ },
}));
```

### 2.3 路由设计
使用 React Router 6 实现页面导航，支持懒加载和路由保护：

```typescript
// router.tsx
const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/mainmenu" replace /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { 
    path: '/mainmenu', 
    element: <ProtectedRoute><MainMenu /></ProtectedRoute> 
  },
  { 
    path: '/editor/:projectId', 
    element: <ProtectedRoute><EditorPage /></ProtectedRoute> 
  },
  { 
    path: '/run/:projectId', 
    element: <ProtectedRoute><RunPage /></ProtectedRoute> 
  },
]);
```

---

## 3. 实现方式

### 3.1 React 组件结构
采用函数组件 + Hooks 模式：

```typescript
// Canvas.tsx
const Canvas: React.FC = () => {
  const { nodes, edges, setNodes, setEdges, addNode } = useCanvasStore();
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  
  const onNodesChange: OnNodesChange = useCallback((changes) => {
    const updatedNodes = applyNodeChanges(changes, nodes as any);
    setNodes(updatedNodes as NodeData[]);
  }, [nodes, setNodes]);
  
  const onConnect = useCallback((params: Connection) => {
    const newEdge = {
      id: `e_${params.source}_${params.target}`,
      source: params.source!,
      target: params.target!,
    };
    storeAddEdge(newEdge);
  }, [storeAddEdge]);
  
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodeTypes={nodeTypes}
      snapToGrid={snapToGrid}
    />
  );
};
```

### 3.2 Zustand 状态管理
状态管理支持自动保存和撤销/重做：

```typescript
// canvasStore.ts - 自动保存与历史记录
const MAX_HISTORY_SIZE = 30;
const AUTO_SAVE_DELAY = 1000;

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  autoSave: debounce(async () => {
    const { nodes, edges, currentProject } = get();
    if (!currentProject) return;
    await agenticFlowApi.saveCanvas(currentProject.id, { nodes, edges });
  }, AUTO_SAVE_DELAY),
  
  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    if (newHistory.length > MAX_HISTORY_SIZE) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },
}));
```

### 3.3 服务层调用
API 服务封装在 `services/` 目录，统一使用 axios：

```typescript
// api.ts
const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

// 请求拦截器 - 自动附加认证令牌
apiClient.interceptors.request.use((config) => {
  const token = getCookie('access_token') || localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 响应拦截器 - 令牌刷新
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      // 尝试刷新令牌
      const refreshToken = getCookie('refresh_token');
      const response = await axios.post('/api/v1/auth/refresh', { refresh_token: refreshToken });
      // 更新令牌并重试请求
    }
    return Promise.reject(error);
  }
);
```

---

## 4. 组件和库

### 4.1 核心依赖

| 库 | 版本 | 用途 |
|---|------|------|
| React | 18.2.0 | 核心框架 |
| React DOM | 18.2.0 | DOM 渲染 |
| ReactFlow | 11.10.1 | 工作流画布 |
| Ant Design | 5.11.7 | UI 组件库 |
| Zustand | 4.4.7 | 状态管理 |
| Axios | 1.6.2 | HTTP 客户端 |
| React Router DOM | 6.20.0 | 路由管理 |
| TypeScript | 5.3.2 | 类型系统 |
| Vite | 5.0.8 | 构建工具 |
| ECharts | 6.0.0 | 图表可视化 |
| Day.js | 1.11.19 | 日期处理 |

### 4.2 项目配置

```json
// package.json
{
  "name": "agentic-workflow-frontend",
  "type": "module",
  "scripts": {
    "dev": "npx vite",
    "build": "npx vite build",
    "build:check": "npx tsc --noEmit && npx vite build",
    "preview": "npx vite preview"
  }
}
```

---

## 5. 组件附录

### 5.1 Canvas 组件
**文件**: [Canvas.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/Canvas/Canvas.tsx)

工作流画布核心组件，基于 ReactFlow 实现。

**核心功能**:
- 节点拖拽与连线
- 右键菜单添加节点
- 多选、复制、删除节点
- 网格对齐
- 画布注释
- 撤销/重做 (Ctrl+Z/Y)

**节点类型**:
```typescript
const nodeTypes: NodeTypes = {
  agent: AgentNode,      // Agent 节点
  annotation: AnnotationNode,  // 注释节点
};
```

**关键代码**:
```typescript
<ReactFlow
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
  onConnect={onConnect}
  onDrop={onDrop}
  nodeTypes={nodeTypes}
  snapToGrid={snapToGrid}
  snapGrid={[20, 20]}
  selectionMode={SelectionMode.Partial}
/>
```

### 5.2 AgentNode 组件
**文件**: [AgentNode.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/Canvas/AgentNode.tsx)

Agent 节点渲染组件，作为 ReactFlow 的自定义节点类型。

**节点类型与颜色**:
| 类型 | 颜色 | 描述 |
|------|------|------|
| orchestrator | #3F51B5 | 协调者 |
| planner | #4CAF50 | 规划者 |
| executor | #FF9800 | 执行者 |

**数据结构**:
```typescript
interface NodeData {
  id: string;
  type: 'agent' | 'annotation';
  position: { x: number; y: number };
  data: {
    name?: string;
    agentType?: 'orchestrator' | 'planner' | 'executor';
    llm_config_id?: string;
    system_prompt?: string;
    skills?: string[];
    mcp_tools?: string[];
  };
}
```

### 5.3 PropertyEditor 组件
**文件**: [PropertyEditor.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/PropertyEditor/PropertyEditor.tsx)

节点属性编辑器，提供 Agent 节点的详细配置界面。

**配置项**:
- 基本信息：名称、描述、类型
- LLM 配置：模型选择、配置绑定
- Prompt 模板：系统提示、用户提示、助手提示
- Skills 绑定：技能包选择
- MCP 工具：工具选择

**核心逻辑**:
```typescript
const PropertyPanel: React.FC = () => {
  const { selectedNode, updateNode } = useCanvasStore();
  const [form] = Form.useForm();
  
  useEffect(() => {
    if (selectedNode) {
      form.setFieldsValue({
        name: selectedNode.data.name,
        agentType: selectedNode.data.agentType,
        llm_config_id: selectedNode.data.llm_config_id,
      });
    }
  }, [selectedNode]);
  
  const handleValuesChange = (changedValues: any) => {
    if (selectedNode) {
      updateNode(selectedNode.id, changedValues);
    }
  };
};
```

### 5.4 RunPanel 组件
**文件**: [RunPanel.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/RunPanel/RunPanel.tsx)

运行面板主组件，提供工作流执行功能。

**子组件**:
- `RunSidebar`: 运行侧边栏
- `FileExplorer`: 文件浏览器
- `FileEditor`: 文件编辑器
- `ConversationHistory`: 对话历史
- `OperationRecords`: 操作记录

**运行状态**:
```typescript
interface RunState {
  sessions: ExtendedRunSession[];
  currentSession: ExtendedRunSession | null;
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;
}
```

### 5.5 MCPManager 组件
**文件**: [MCPManager.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/MCPManager/MCPManager.tsx)

MCP (Model Context Protocol) 服务器管理组件。

**功能**:
- 服务器列表展示
- 新建/编辑服务器配置
- 连接/断开服务器
- 支持传输类型：stdio、http、sse

**服务器数据结构**:
```typescript
interface ServerData {
  id: string;
  name: string;
  transport: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeout: number;
  enabled: boolean;
  status?: 'connected' | 'connecting' | 'error';
}
```

### 5.6 SkillsManager 组件
**文件**: [SkillsManager.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/SkillsManager/SkillsManager.tsx)

Skills 技能包管理组件。

**功能**:
- 技能包列表展示
- 创建新技能包
- 导入技能包
- 编辑基本信息
- 状态筛选与搜索

**子组件**:
- `SkillsPackageList`: 技能包列表
- `SkillsCreateModal`: 创建弹窗
- `SkillsImportDialog`: 导入对话框

---

## 6. 页面结构

### 6.1 EditorPage
**文件**: [EditorPage.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/pages/Editor/EditorPage.tsx)

工作流编辑器主页面，集成画布、节点面板、属性编辑器、工具栏。

**布局结构**:
```
┌─────────────────────────────────────────────┐
│                  Toolbar                     │
├────────┬─────────────────────────┬──────────┤
│        │                         │          │
│ Node   │       Canvas            │ Property │
│ Panel  │       (ReactFlow)       │ Editor   │
│        │                         │          │
└────────┴─────────────────────────┴──────────┘
```

**核心组件**:
```typescript
const EditorPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentProject, setCurrentProject, selectedNode } = useCanvasStore();
  
  return (
    <Layout>
      <Sider><NodePanel /></Sider>
      <Content><Canvas /></Content>
      <Sider><PropertyEditor /></Sider>
    </Layout>
  );
};
```

### 6.2 RunPage
**文件**: [RunPage.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/pages/Run/RunPage.tsx)

工作流运行页面，包装 RunPanel 组件。

```typescript
const RunPage: React.FC = () => {
  return (
    <div style={{ height: '100vh' }}>
      <RunPanel />
    </div>
  );
};
```

### 6.3 MainMenu
**文件**: [MainMenu.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/pages/MainMenu/MainMenu.tsx)

系统主菜单页面，提供导航功能。

**菜单项**:
| Tab | 组件 | 描述 |
|-----|------|------|
| AgenticFlow | AgenticFlowList | 工作流列表 |
| Skills | SkillsManager | 技能包管理 |
| MCP | MCPManager | MCP 工具管理 |
| LLM | LLMPage | LLM 配置管理 |
| Marketplace | MarketplacePage | 市场 |
| Settings | SettingsPage | 系统设置 |

**布局结构**:
```
┌─────────────────────────────────────────────┐
│  Logo    [菜单项...]          用户信息      │
├─────────────────────────────────────────────┤
│                                             │
│              Content Area                   │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 7. 类型定义

### 7.1 画布类型
**文件**: [canvas.ts](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/types/canvas.ts)

```typescript
export interface NodeData {
  id: string;
  type: 'agent' | 'annotation';
  position: { x: number; y: number };
  data: {
    name?: string;
    desc?: string;
    agentType?: 'orchestrator' | 'planner' | 'executor';
    system_prompt?: string;
    user_prompt?: string;
    assistant_prompt?: string;
    llm_config_id?: string;
    model_config?: {
      provider: string;
      model: string;
    };
    skills?: string[];
    mcp_tools?: string[];
  };
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CanvasData {
  nodes: NodeData[];
  edges: EdgeData[];
}

export interface ProjectData {
  id: string;
  name: string;
  canvas: CanvasData;
}
```

---

## 8. 服务层

### 8.1 API 服务列表

| 服务文件 | 功能 |
|---------|------|
| `api.ts` | 基础 HTTP 封装、项目 API |
| `authApi.ts` | 用户认证 |
| `runApi.ts` | 运行会话管理 |
| `runProjectApi.ts` | 运行项目管理 |
| `mcpApi.ts` | MCP 服务器管理 |
| `skillsApi.ts` | Skills 包管理 |
| `llmApi.ts` | LLM 配置管理 |
| `agenticFlowApi.ts` | 工作流管理 |
| `historyApi.ts` | 执行历史 |
| `marketplaceApi.ts` | 市场接口 |
| `websocket.ts` | WebSocket 连接 |

---

## 9. 样式系统

项目使用 CSS 变量实现主题系统：

```css
/* 主要颜色 */
--primary-100: #1890ff;
--primary-200: #40a9ff;

/* 背景颜色 */
--bg-100: #ffffff;
--bg-200: #f5f5f5;
--bg-300: #e8e8e8;

/* 文字颜色 */
--text-100: #262626;
--text-200: #595959;
--text-300: #8c8c8c;

/* 圆角与阴影 */
--radius-base: 8px;
--shadow-base: 0 2px 8px rgba(0, 0, 0, 0.1);
```

---

## 10. 构建与开发

### 10.1 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 类型检查 + 构建
npm run build:check
```

### 10.2 环境要求

- Node.js >= 16.0.0
- npm >= 7.0.0

---

## 11. 目录结构总览

```
frontend/
├── src/
│   ├── components/           # 可复用组件
│   │   ├── Auth/             # 认证组件
│   │   ├── Canvas/           # 画布组件
│   │   ├── RunPanel/         # 运行面板
│   │   ├── Export/           # 导入导出
│   │   ├── History/          # 历史记录
│   │   ├── LLMUsage/         # LLM 用量
│   │   ├── MCPManager/       # MCP 管理
│   │   ├── Monitor/          # 监控组件
│   │   ├── NavigationBar/    # 导航栏
│   │   ├── NodePanel/        # 节点面板
│   │   ├── Packager/         # 打包器
│   │   ├── Preview/          # 预览组件
│   │   ├── PropertyEditor/   # 属性编辑器
│   │   ├── Settings/         # 设置组件
│   │   ├── SkillsManager/    # Skills 管理
│   │   ├── Toolbar/          # 工具栏
│   │   └── common/           # 通用组件
│   ├── pages/                # 页面组件
│   │   ├── Auth/             # 登录/注册
│   │   ├── Editor/           # 编辑器页面
│   │   ├── MainMenu/         # 主菜单
│   │   ├── Marketplace/      # 市场页面
│   │   ├── Run/              # 运行页面
│   │   └── SkillsEditor/     # Skills 编辑器
│   ├── services/             # API 服务
│   ├── store/                # 状态管理
│   ├── types/                # 类型定义
│   ├── utils/                # 工具函数
│   ├── index.css             # 全局样式
│   ├── index.tsx             # 入口文件
│   └── router.tsx            # 路由配置
├── package.json
└── vite.config.ts
```
