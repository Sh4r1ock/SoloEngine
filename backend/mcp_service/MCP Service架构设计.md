## MCP服务相关代码文件汇总

### 1. MCP服务主要入口文件

| 文件路径 | 描述 |
|---------|------|
| [main.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/main.py) | MCP服务主入口文件，独立部署于端口8992，创建FastAPI应用，初始化数据库、网关和生命周期管理器 |
| [config.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/config.py) | MCP服务配置文件，包含服务端口、CORS配置、超时设置等基础配置 |

### 2. MCP服务管理器/管理类

| 文件路径 | 描述 |
|---------|------|
| [host/registry.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/host/registry.py) | **服务注册中心**，存储Server配置信息、维护Server状态、提供查询接口。包含`MCPServerInfo`数据类和`ServiceRegistry`类 |
| [host/lifecycle.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/host/lifecycle.py) | **生命周期管理器**，管理MCP服务器的完整生命周期：注册→创建Client→连接Server→注册网关路由 |
| [host/caller.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/host/caller.py) | **统一调用接口**，提供`call()`、`list_tools()`、`list_servers()`等统一调用方法 |
| [gateway.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/gateway.py) | **MCP网关路由管理器**，为注册的MCP Server自动创建网关路由（如注册"github"后可通过/github/*访问） |

### 3. MCP客户端相关代码

| 文件路径 | 描述 |
|---------|------|
| [clients/base.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/clients/base.py) | **MCP客户端基类**，定义统一的客户端接口（connect、disconnect、call_tool、read_resource等） |
| [clients/factory.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/clients/factory.py) | **客户端工厂**，根据传输类型创建对应的客户端实例 |
| [clients/stdio_client.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/clients/stdio_client.py) | **Stdio传输客户端**，通过标准输入输出与MCP服务器通信 |
| [clients/sse_client.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/clients/sse_client.py) | **SSE传输客户端**，通过Server-Sent Events与MCP服务器通信 |
| [clients/http_client.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/clients/http_client.py) | **HTTP传输客户端**，通过Streamable HTTP与MCP服务器通信 |
| [clients/__init__.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/clients/__init__.py) | 客户端模块初始化，导出所有客户端类和工厂 |

### 4. MCP配置与数据模型

| 文件路径 | 描述 |
|---------|------|
| [database.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/database.py) | MCP服务数据库管理，包含主表`MCPServerModel`和三个配置子表模型 |
| [app/models/mcp_server.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/app/models/mcp_server.py) | MCP服务器数据类定义，包含`MCPTool`、`MCPResource`、`MCPPrompt`、`MCPServerConfig`等数据类 |

### 5. MCP API路由

| 文件路径 | 描述 |
|---------|------|
| [routes.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/mcp_service/routes.py) | **MCP服务API路由**，提供完整的REST API：服务器CRUD、连接管理、工具调用、资源获取、Python MCP创建等 |

### 6. MCP服务构建器

| 文件路径 | 描述 |
|---------|------|
| [app/core/mcp_service_builder.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/app/core/mcp_service_builder.py) | **MCP服务构建器**，提供MCP服务模板生成功能，支持Python和TypeScript |

### 7. SoloAgent MCP客户端

| 文件路径 | 描述 |
|---------|------|
| [SoloAgent/plugins/mcp/mcp_client.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/SoloAgent/plugins/mcp/mcp_client.py) | **SoloAgent MCP客户端**，实现`IMCPClient`接口，提供MCP服务器连接和工具调用功能 |
| [SoloAgent/core/interfaces.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/SoloAgent/core/interfaces.py) | **插件接口定义**，包含`IMCPClient`抽象基类定义 |

### 8. 前端MCP相关代码

| 文件路径 | 描述 |
|---------|------|
| [services/mcpApi.ts](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/services/mcpApi.ts) | **MCP API服务**，封装所有MCP服务器管理接口调用，连接端口8992的MCP服务 |
| [store/mcpStore.ts](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/store/mcpStore.ts) | **MCP状态管理**，使用Zustand管理MCP服务器列表、连接状态、工具列表等 |
| [components/MCPManager/MCPManager.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/MCPManager/MCPManager.tsx) | **MCP管理主组件**，显示MCP服务器列表，支持新建、导入、连接/断开操作 |
| [components/MCPManager/MCPAddServerModal.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/MCPManager/MCPAddServerModal.tsx) | **MCP添加服务器弹窗**，支持添加不同类型的MCP服务器 |
| [components/MCPManager/MCPToolBrowser.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/MCPManager/MCPToolBrowser.tsx) | **MCP工具浏览器**，显示MCP服务器提供的工具列表 |

### 9. 示例MCP服务

| 文件路径 | 描述 |
|---------|------|
| [data/mcp_servers/time/](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/data/mcp_servers/time/) | 时间MCP服务器示例 |
| [data/mcp_servers/fetch/](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/data/mcp_servers/fetch/) | Fetch MCP服务器示例 |
| [data/mcp_servers/git/](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/data/mcp_servers/git/) | Git MCP服务器示例 |
| [data/mcp_servers/official/](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/data/mcp_servers/official/) | 官方MCP服务器集合 |

---

# MCP管理服务架构文档

## 一、三层架构设计

MCP Service 采用 **三层架构**，每层职责明确，Client 与 Server 是 **1:1 绑定**关系。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Host (服务管理层)                           │
│                                                                             │
│  职责：管理 Client 实例、转发调用请求、显示 Server 列表、增删改查 Server    │
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────┐   │
│  │   ServiceRegistry │  │  LifecycleManager │  │    UnifiedCaller      │   │
│  │   (服务注册中心)  │  │  (生命周期管理)   │  │   (统一调用接口)      │   │
│  └───────────────────┘  └───────────────────┘  └───────────────────────┘   │
│                                                                             │
│  核心数据结构: _clients: Dict[str, BaseClient]  # server_id → Client (1:1) │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ 管理 (创建/销毁/调用)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MCP Client (适配器层)                             │
│                                                                             │
│  职责：建立连接、协议处理(握手/消息格式转换/能力协商)、工具调用、统一接口   │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                        │
│  │ StdioClient │  │ SSEClient   │  │ HTTPClient  │                        │
│  │   (1:1)     │  │   (1:1)     │  │   (1:1)     │                        │
│  └─────────────┘  └─────────────┘  └─────────────┘                        │
│                                                                             │
│  特点：每个 Client 实例绑定一个 Server，相互隔离，互不影响                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ 连接/通信
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MCP Server (外部服务)                             │
│                                                                             │
│  职责：提供工具(Tools)、资源(Resources)、提示词(Prompts)                     │
│                                                                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │  Stdio Server   │ │   SSE Server    │ │  HTTP Server    │              │
│  │  (本地进程)     │ │  (远程服务)     │ │  (远程服务)     │              │
│  │                 │ │                 │ │                 │              │
│  │ 标准输入/输出   │ │ Server-Sent     │ │ Streamable HTTP │              │
│  │ 最基础传输方式  │ │ Events 推送     │ │ 双向数据流      │              │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1:1 绑定关系说明

```python
# lifecycle.py 中的核心数据结构
class LifecycleManager:
    def __init__(self):
        self._clients: Dict[str, BaseClient] = {}  # server_id → Client (1:1映射)
    
    async def connect(self, server_id: str) -> bool:
        # 为每个 server_id 创建一个 client 实例
        client = ClientFactory.create_client(server_info)
        await client.connect()
        self._clients[server_id] = client  # 1:1 绑定
```

### 三种传输类型对比

| 类型 | Client类 | Server类型 | 通信方式 | 适用场景 |
|------|----------|------------|----------|----------|
| `stdio` | `StdioClient` | 本地进程 | 标准输入/输出 | 本地MCP服务器，最基础传输方式 |
| `sse` | `SSEClient` | 远程服务 | Server-Sent Events | 远程MCP服务器，支持服务器主动推送 |
| `http` | `HTTPClient` | 远程服务 | Streamable HTTP | 远程MCP服务器，支持双向数据流 |

---

## 二、架构概览（完整视图）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Frontend (React + TypeScript)                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │  MCPManager.tsx  │  │   mcpStore.ts    │  │      mcpApi.ts           │  │
│  │   (UI组件层)     │  │  (Zustand状态)   │  │   (API调用封装)          │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │ HTTP REST API (:8992)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MCP Service (FastAPI :8992)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          API Layer (routes.py)                       │   │
│  │  • /api/v1/mcp/servers        • /api/v1/mcp/servers/{server_id}/tools      │   │
│  │  • /api/v1/mcp/servers/{server_id}   • /api/v1/mcp/tools/all               │   │
│  │  • /api/v1/mcp/servers/create/python  • /api/v1/mcp/servers/{server_id}/connect    │   │
│  │  • /api/v1/mcp/servers/create/stdio   • /api/v1/mcp/servers/{server_id}/code      │   │
│  │  • /api/v1/mcp/servers/create/http    • /api/v1/mcp/servers/{server_id}/original  │   │
│  │  • /api/v1/mcp/servers/create/sse     • /api/v1/mcp/servers/{server_id}/tools/json│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Gateway Layer (gateway.py)                    │   │
│  │  动态路由注册: /{server_name}/tools, /{server_name}/resources       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────────┐  │
│  │  registry.py  │  │ lifecycle.py  │  │        caller.py              │  │
│  │  (服务注册)   │  │  (生命周期)   │  │     (统一调用接口)            │  │
│  └───────────────┘  └───────────────┘  └───────────────────────────────┘  │
│                                      │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   Client Factory (clients/factory.py)                │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                              │   │
│  │  │ Stdio   │  │  SSE    │  │  HTTP   │                              │   │
│  │  │ Client  │  │ Client  │  │ Client  │                              │   │
│  │  └─────────┘  └─────────┘  └─────────┘                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Database Layer (database.py)                     │   │
│  │           SQLite + SQLAlchemy (data/database/mcp_service.db)        │   │
│  │           主表 + 三个配置子表（stdio/sse/http）                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           External MCP Servers                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │  Stdio Servers  │  │   SSE Servers   │  │       HTTP Servers          │ │
│  │  (本地进程)     │  │  (远程服务)     │  │     (远程服务)              │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、核心模块详解

### 1. 主入口

| 属性 | 说明 |
|------|------|
| **端口** | 8992 |
| **框架** | FastAPI |
| **职责** | 创建应用、初始化组件、管理生命周期 |

**生命周期流程**:
```
启动 → init_db() → mcp_gateway.init_app() → 运行服务
关闭 → lifecycle_manager.disconnect_all() → 关闭所有连接
```

---

### 2. 服务注册中心

**核心类**:

| 类名 | 职责 |
|------|------|
| `ServerStatus` | 服务器状态枚举: `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `ERROR` |
| `MCPServerInfo` | 服务器信息数据类，包含所有配置和状态 |
| `ServiceRegistry` | 服务注册中心，管理服务器配置和状态 |

**MCPServerInfo 核心字段**:
```python
id: str                    # 服务器唯一ID
user_id: str               # 用户ID
name: str                  # 服务器名称
transport: str             # 传输类型: stdio/sse/http
url: Optional[str]         # HTTP/SSE URL
command: Optional[str]     # Stdio 命令
args: List[str]            # 命令参数
env: Dict[str, str]        # 环境变量
headers: Dict[str, str]    # HTTP头
timeout: int               # 超时时间
enabled: bool              # 是否启用
is_public: bool            # 是否公开
is_default: bool           # 是否默认
author: Optional[str]      # 作者
source: Optional[str]      # 来源
description: Optional[str] # 描述
tags: List[str]            # 标签
storage_path: Optional[str] # 存储路径（用户创建的MCP）
version: int               # 版本号（乐观锁）
status: ServerStatus       # 当前状态
tools: List[Dict]          # 工具列表
```

---

### 3. 生命周期管理器

**核心方法**:

| 方法 | 功能 |
|------|------|
| `register_and_connect()` | 注册服务器并建立连接 |
| `connect()` | 连接到指定服务器 |
| `disconnect()` | 断开服务器连接 |
| `reconnect()` | 重新连接服务器 |
| `get_client()` | 获取服务器对应的客户端实例 |
| `disconnect_all()` | 断开所有连接 |
| `health_check()` | 健康检查 |

**连接流程**:
```
1. 更新状态为 CONNECTING
2. 通过 ClientFactory 创建客户端
3. 调用 client.connect()
4. 注册网关路由
5. 更新状态为 CONNECTED
```

---

### 4. 统一调用接口

**核心方法**:

| 方法 | 功能 |
|------|------|
| `call(server_id, tool_name, params)` | 调用指定服务器的工具 |
| `list_tools(server_id)` | 列出服务器的所有工具 |
| `list_servers(user_id)` | 列出所有服务器 |
| `list_all_tools(user_id)` | 列出所有服务器的所有工具 |
| `get_resources(server_id)` | 获取服务器资源列表 |
| `get_prompts(server_id)` | 获取服务器提示词列表 |
| `read_resource(server_id, uri)` | 读取服务器资源 |
| `get_prompt(server_id, name, args)` | 获取提示词内容 |

---

### 5. 网关路由管理器

**功能**: 为注册的MCP Server自动创建HTTP网关路由

**路由规则**:
```
/{server_name}              → 服务器信息
/{server_name}/tools        → 工具列表
/{server_name}/tools/{name} → 工具详情
/{server_name}/tools/{name}/call → 调用工具
/{server_name}/resources    → 资源列表
/{server_name}/prompts      → 提示词列表
```

---

### 6. 客户端工厂

**支持的传输类型**:

| 类型 | 客户端类 | 适用场景 |
|------|----------|----------|
| `stdio` | `StdioClient` | 本地进程通信，最基础的传输方式 |
| `sse` | `SSEClient` | Server-Sent Events，远程服务通信 |
| `http` | `HTTPClient` | Streamable HTTP，远程服务通信 |

---

### 7. 客户端实现

#### BaseClient (基类)
```python
class BaseClient(ABC):
    async def connect() -> None           # 连接到MCP服务器
    async def disconnect() -> None        # 断开连接
    async def get_tools() -> List[Dict]   # 获取工具列表
    async def get_resources() -> List[Dict]  # 获取资源列表
    async def get_prompts() -> List[Dict]    # 获取提示词列表
    async def call_tool(name, args) -> Dict  # 调用工具
    async def read_resource(uri) -> Dict     # 读取资源
    async def get_prompt(name, args) -> Dict # 获取提示词
```

#### StdioClient
- 通过标准输入/输出与本地MCP服务器进程通信
- 使用MCP SDK的 `stdio_client` 和 `ClientSession`
- 支持环境变量配置
- 使用后台任务保持连接

#### SSEClient
- 通过Server-Sent Events与远程MCP服务器通信
- 支持自定义HTTP Headers
- 适用于服务器主动推送消息场景

#### HTTPClient
- 通过Streamable HTTP与远程MCP服务器通信
- 支持双向数据流
- 使用MCP SDK的 `streamable_http_client`

---

### 8. 数据库层

**数据库架构（主表 + 子表）**:

```
┌─────────────────────────────────────────────────────────────────┐
│                     MCPServerModel (主表)                        │
│  mcp_server_id (PK)  │ user_id │ mcp_name │ transport_type │ ... │
└─────────────────────────────────────────────────────────────────┘
          │                    │                    │
          │ 1:1                │ 1:1                │ 1:1
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ MCPStdioConfig  │  │ MCPSseConfig    │  │ MCPHttpConfig   │
│ (stdio配置子表) │  │ (sse配置子表)   │  │ (http配置子表)  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**主表字段 (MCPServerModel)**:
```python
mcp_server_id: str      # UUID主键
user_id: str            # 用户ID
mcp_name: str           # 服务器名称
transport_type: str     # 传输类型
description: str        # 描述
enabled: bool           # 是否启用
share: bool             # 是否共享
author: str             # 作者
tags: JSON              # 标签
created_at: DateTime    # 创建时间
updated_at: DateTime    # 更新时间
version: int            # 乐观锁版本号
```

**Stdio配置子表 (MCPStdioConfigModel)**:
```python
mcp_server_id: str      # 外键主键
command: str            # 执行命令
args: JSON              # 命令参数
env: JSON               # 环境变量
storage_path: str       # 存储路径
working_dir: str        # 工作目录
```

**SSE配置子表 (MCPSseConfigModel)**:
```python
mcp_server_id: str      # 外键主键
url: str                # SSE URL
headers: JSON           # HTTP头
timeout: int            # 超时时间
reconnect: bool         # 是否自动重连
sse_endpoint: str       # SSE端点路径
retry_interval: int     # 重试间隔
max_retries: int        # 最大重试次数
```

**HTTP配置子表 (MCPHttpConfigModel)**:
```python
mcp_server_id: str      # 外键主键
url: str                # HTTP URL
headers: JSON           # HTTP头
timeout: int            # 超时时间
session_id: str         # 会话ID
```

**特性**:
- SQLite数据库存储
- 主表+子表设计，不同传输类型配置分离
- 乐观锁机制防止并发冲突
- 数据库路径: `data/database/mcp_service.db`

---

### 9. API路由

**端点列表**:

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/mcp/servers` | 获取服务器列表 |
| POST | `/api/v1/mcp/servers` | 添加服务器 |
| GET | `/api/v1/mcp/servers/{server_id}` | 获取服务器详情 |
| PUT | `/api/v1/mcp/servers/{server_id}` | 更新服务器配置 |
| DELETE | `/api/v1/mcp/servers/{server_id}` | 删除服务器 |
| POST | `/api/v1/mcp/servers/create/python` | 创建Python MCP（上传Python文件编译） |
| POST | `/api/v1/mcp/servers/create/stdio` | 创建Stdio MCP（上传ZIP包或文件夹） |
| POST | `/api/v1/mcp/servers/create/http` | 创建HTTP MCP（填写HTTP连接配置） |
| POST | `/api/v1/mcp/servers/create/sse` | 创建SSE MCP（填写SSE连接配置） |
| POST | `/api/v1/mcp/servers/{server_id}/connect` | 连接服务器 |
| POST | `/api/v1/mcp/servers/{server_id}/disconnect` | 断开服务器 |
| POST | `/api/v1/mcp/servers/test` | 测试服务器连接 |
| GET | `/api/v1/mcp/servers/{server_id}/tools` | 获取工具列表 |
| POST | `/api/v1/mcp/servers/{server_id}/tools/{tool_name}/call` | 调用工具 |
| GET | `/api/v1/mcp/tools/all` | 获取所有工具 |
| GET | `/api/v1/mcp/servers/{server_id}/resources` | 获取资源列表 |
| GET | `/api/v1/mcp/servers/{server_id}/prompts` | 获取提示词列表 |
| GET | `/api/v1/mcp/servers/{server_id}/code` | 获取MCP代码 |
| PUT | `/api/v1/mcp/servers/{server_id}/code` | 更新MCP代码 |
| GET | `/api/v1/mcp/servers/{server_id}/original` | 获取原始Python代码 |
| PUT | `/api/v1/mcp/servers/{server_id}/original` | 更新原始Python代码 |
| GET | `/api/v1/mcp/servers/{server_id}/tools/json` | 获取工具定义JSON |
| PUT | `/api/v1/mcp/servers/{server_id}/tools` | 更新工具定义 |
| GET | `/api/v1/mcp/servers/{server_id}/files` | 获取MCP文件列表 |
| GET | `/api/v1/mcp/health` | 健康检查 |

---

## 四、配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `MCP_SERVICE_PORT` | 8992 | 服务端口 |
| `MCP_SERVICE_HOST` | 0.0.0.0 | 监听地址 |
| `DEFAULT_TIMEOUT` | 30 | 默认超时时间(秒) |
| `MAX_TOOL_ARGUMENTS_SIZE` | 1MB | 工具参数最大大小 |
| `CORS_ORIGINS` | localhost:8991, 8990 | 允许的跨域来源 |

---

## 五、目录结构

```
backend/mcp_service/
├── main.py              # 主入口
├── config.py            # 配置文件
├── routes.py            # API路由
├── gateway.py           # 网关路由管理
├── database.py          # 数据库模型（主表+子表）
├── __init__.py          # 模块初始化
├── host/
│   ├── __init__.py
│   ├── registry.py      # 服务注册中心
│   ├── lifecycle.py     # 生命周期管理
│   └── caller.py        # 统一调用接口
└── clients/
    ├── __init__.py
    ├── base.py          # 客户端基类
    ├── factory.py       # 客户端工厂
    ├── stdio_client.py  # Stdio客户端
    ├── sse_client.py    # SSE客户端
    └── http_client.py   # HTTP客户端

backend/app/
├── models/
│   └── mcp_server.py    # MCP数据类定义
├── core/
│   └── mcp_service_builder.py  # MCP服务构建器

backend/SoloAgent/
├── core/
│   └── interfaces.py    # 插件接口定义（含IMCPClient）
└── plugins/
    └── mcp/
        └── mcp_client.py  # SoloAgent MCP客户端实现

frontend/src/
├── services/
│   └── mcpApi.ts        # MCP API服务
├── store/
│   └── mcpStore.ts      # MCP状态管理
└── components/MCPManager/
    ├── MCPManager.tsx        # MCP管理主组件
    ├── MCPAddServerModal.tsx # 添加服务器弹窗
    ├── MCPToolBrowser.tsx    # 工具浏览器
    └── MCPServerList.tsx     # 服务器列表

data/
├── database/
│   └── mcp_service.db   # MCP服务数据库
└── mcp_servers/         # MCP服务器存储目录
    ├── time/
    ├── fetch/
    ├── git/
    └── official/
```

---

## 六、数据流

### 工具调用流程
```
1. 前端调用 POST /api/v1/mcp/servers/{server_id}/tools/{tool_name}/call
2. routes.py 接收请求，验证参数
3. 调用 unified_caller.call(server_id, tool_name, arguments)
4. caller.py 从 lifecycle_manager 获取客户端
5. 客户端调用 call_tool() 方法
6. 返回结果给前端
```

### 服务器连接流程
```
1. 前端调用 POST /api/v1/mcp/servers/{server_id}/connect
2. routes.py 从数据库获取服务器配置
3. 转换为 MCPServerInfo
4. 调用 lifecycle_manager.register_and_connect()
5. lifecycle_manager 通过 ClientFactory 创建客户端
6. 客户端执行 connect() 建立连接
7. 注册网关路由
8. 更新状态为 CONNECTED
```

### Python MCP创建流程
```
1. 前端上传Python文件和工具定义
2. routes.py 接收请求，验证Python语法
3. 生成MCP Server代码（main.py）
4. 保存原始代码（original.py）
5. 创建数据库记录和配置
6. 返回创建结果
```

---

## 七、MCP Server存储位置

### 1. 存储位置总览

MCP Server存储在以下位置：

| 存储类型 | 路径 | 说明 |
|----------|------|------|
| **所有MCP Server** | `data/mcp_servers/{name}/` | 平铺存储，通过数据库区分类型 |

### 2. 存储结构

**路径结构**:
```
data/mcp_servers/
├── time/                    # 时间工具
│   ├── __init__.py
│   ├── __main__.py
│   └── server.py
├── fetch/                   # HTTP请求工具
│   └── ...
├── git/                     # Git工具
│   └── ...
└── {server_name}/           # 任意MCP Server
    ├── __init__.py
    ├── __main__.py
    ├── main.py              # 编译后的MCP Server代码
    ├── original.py          # 原始上传的Python代码
    └── tools.json           # 工具定义
```

### 3. 数据库区分

通过数据库字段区分MCP Server类型：

| 字段 | 用途 |
|------|------|
| `transport_type` | 传输类型：`stdio` / `sse` / `http` |
| `storage_path` | 存储路径，存在则表示本地存储 |
| `author` | 来源：`user` / 其他 |

### 4. 判断是否可编辑

前端判断逻辑：
```typescript
const isEditable = server.storage_path && server.storage_path.includes('mcp_servers');
```

---

## 八、关键设计特点

1. **三种传输协议支持**: 支持 Stdio、SSE、HTTP 三种传输方式
2. **插件化架构**: MCP服务器可动态注册和注销
3. **网关路由**: 自动为每个MCP服务器创建HTTP端点
4. **主表+子表设计**: 不同传输类型配置分离存储
5. **乐观锁**: 数据库更新使用版本号防止并发冲突
6. **异步设计**: 全异步架构，支持高并发
7. **独立部署**: MCP服务独立运行在8992端口，与主应用解耦
8. **平铺存储**: 所有MCP Server平铺存储，通过数据库区分类型
9. **Python MCP编译**: 支持上传Python文件自动编译为MCP Server
10. **代码管理**: 支持在线编辑MCP代码和工具定义

---

## 九、SoloAgent集成

### IMCPClient接口

SoloAgent通过`IMCPClient`接口与MCP服务交互：

```python
class IMCPClient(ABC):
    async def connect() -> None
    async def disconnect() -> None
    async def get_tools() -> List[dict]
    async def call_tool(tool_name: str, arguments: dict) -> dict
```

### MCPClient实现

`SoloAgent/plugins/mcp/mcp_client.py`实现了`IMCPClient`接口：

- 支持三种传输协议
- 使用官方MCP Python SDK
- 提供MCPClientManager管理多个连接

### MCPClientManager

管理多个MCP服务器连接的管理器：

```python
class MCPClientManager:
    async def add_server(server_config: MCPServerConfig)
    async def remove_server(server_id: str)
    async def get_all_tools() -> List[Dict]
    async def call_tool(server_id, tool_name, arguments)
    async def disconnect_all()
```

---

## 十、前端架构

### 状态管理 (mcpStore.ts)

使用Zustand管理MCP状态：

```typescript
interface MCPState {
  servers: MCPServer[];
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  loading: boolean;
  error: string | null;
  selectedServer: MCPServer | null;
  
  loadServers: () => Promise<void>;
  addServer: (config: any) => Promise<boolean>;
  updateServer: (serverId: string, config: any) => Promise<boolean>;
  deleteServer: (serverId: string) => Promise<boolean>;
  callTool: (serverId, toolName, args) => Promise<any>;
}
```

### API服务 (mcpApi.ts)

封装所有MCP API调用：

- 服务器CRUD操作
- 连接管理
- 工具调用
- Python MCP创建
- 代码管理

### 组件结构

- **MCPManager**: 主组件，显示服务器列表
- **MCPAddServerModal**: 添加/编辑服务器弹窗
- **MCPToolBrowser**: 工具浏览器
- **MCPServerList**: 服务器列表组件
