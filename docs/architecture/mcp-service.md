# MCP Service 架构文档

## 1. 模块概述

### 1.1 作用

MCP Service 是 Model Context Protocol（模型上下文协议）的独立服务实现，为 AI Agent 提供标准化的工具调用、资源管理和提示词模板能力。

### 1.2 定位

- **协议层**：实现 MCP 协议规范，提供与 MCP 兼容服务器通信的能力
- **服务层**：作为独立微服务运行于 8992 端口，提供 RESTful API 接口
- **集成层**：为 SoloEngine 主服务提供 MCP 能力集成

### 1.3 核心功能

| 功能 | 描述 |
|------|------|
| 工具调用 | 调用 MCP Server 提供的工具函数 |
| 资源管理 | 访问 MCP Server 暴露的资源（文件、数据等） |
| 提示词模板 | 获取和使用 MCP Server 提供的提示词模板 |
| 服务管理 | 注册、配置、启停 MCP Server |
| 网关路由 | 为每个 MCP Server 自动创建 HTTP 网关路由 |

---

## 2. 设计理念

### 2.1 MCP 协议设计

MCP（Model Context Protocol）是 Anthropic 提出的标准化协议，用于 AI 模型与外部工具/资源之间的通信。

```
┌─────────────────┐         ┌─────────────────┐
│   MCP Client    │ ◄─────► │   MCP Server    │
│   (SoloEngine)  │  MCP    │   (Tools/Res)   │
└─────────────────┘ Protocol└─────────────────┘
```

**协议能力**：
- **Tools**：可调用的函数/工具
- **Resources**：可读取的资源（文件、数据库等）
- **Prompts**：预定义的提示词模板

### 2.2 客户端/服务端架构

```
┌──────────────────────────────────────────────────────────────┐
│                      MCP Service (8992)                       │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │   Routes    │  │   Gateway   │  │   Lifecycle Mgr     │   │
│  │  (REST API) │  │  (Dynamic)  │  │   (Connect/Disconn) │   │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │
│         │                │                     │              │
│         └────────────────┼─────────────────────┘              │
│                          │                                    │
│  ┌───────────────────────┴───────────────────────┐           │
│  │              Service Registry                  │           │
│  │         (Server Info & Status Store)           │           │
│  └───────────────────────┬───────────────────────┘           │
│                          │                                    │
│  ┌───────────────────────┴───────────────────────┐           │
│  │              Unified Caller                    │           │
│  │         (Tool/Resource/Prompt Access)          │           │
│  └───────────────────────┬───────────────────────┘           │
│                          │                                    │
│  ┌───────────────────────┴───────────────────────┐           │
│  │              Client Factory                    │           │
│  │      (Stdio / SSE / HTTP Client Creation)      │           │
│  └───────────────────────┬───────────────────────┘           │
└──────────────────────────┼───────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
   ┌─────────┐       ┌─────────┐       ┌─────────┐
   │  Stdio  │       │   SSE   │       │  HTTP   │
   │ Client  │       │ Client  │       │ Client  │
   └────┬────┘       └────┬────┘       └────┬────┘
        │                 │                 │
        ▼                 ▼                 ▼
   ┌─────────┐       ┌─────────┐       ┌─────────┐
   │  Local  │       │  Remote │       │  Remote │
   │ Process │       │   SSE   │       │  HTTP   │
   └─────────┘       └─────────┘       └─────────┘
```

### 2.3 网关设计

当注册名为 `github` 的 MCP Server 后，自动创建以下路由：

```
/github              → 服务器信息
/github/tools        → 工具列表
/github/tools/{name} → 工具详情
/github/tools/{name}/call → 调用工具
/github/resources    → 资源列表
/github/prompts      → 提示词列表
```

---

## 3. 实现方式

### 3.1 传输协议实现

#### Stdio 传输

通过标准输入/输出与本地进程通信，是最基础的 MCP 传输方式。

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server_params = StdioServerParameters(
    command="python",
    args=["mcp_server.py"],
    env={"DEBUG": "1"}
)

async with stdio_client(server_params) as (read_stream, write_stream):
    async with ClientSession(read_stream, write_stream) as session:
        await session.initialize()
        tools = await session.list_tools()
```

**适用场景**：本地 Python 脚本、命令行工具

#### SSE 传输

Server-Sent Events，支持服务器主动推送消息。

```python
from mcp import ClientSession
from mcp.client.sse import sse_client

async with sse_client("http://localhost:8080/sse", headers={}) as (read_stream, write_stream):
    async with ClientSession(read_stream, write_stream) as session:
        await session.initialize()
```

**适用场景**：远程 MCP Server、需要服务器推送的场景

#### HTTP 传输

Streamable HTTP，支持双向数据流。

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async with streamable_http_client(url, headers=headers) as (read_stream, write_stream, _):
    async with ClientSession(read_stream, write_stream) as session:
        await session.initialize()
```

**适用场景**：远程 MCP Server、需要双向通信的场景

### 3.2 工具调用机制

统一调用接口提供标准化的工具调用方式：

```python
from mcp_service.host.caller import unified_caller

result = await unified_caller.call(
    server_id="github-server-id",
    tool_name="create_issue",
    params={
        "title": "Bug Report",
        "body": "Description..."
    }
)
```

**调用流程**：

1. 从 LifecycleManager 获取已连接的 Client
2. 若未连接且服务器已启用，自动建立连接
3. 通过 Client 调用工具
4. 返回标准化结果格式

### 3.3 服务注册和生命周期管理

```python
from mcp_service.host.lifecycle import lifecycle_manager
from mcp_service.host.registry import MCPServerInfo

server_info = MCPServerInfo(
    id="unique-id",
    name="my-server",
    transport="stdio",
    command="python",
    args=["server.py"],
    enabled=True
)

await lifecycle_manager.register_and_connect(server_info)
```

**生命周期状态**：

| 状态 | 描述 |
|------|------|
| DISCONNECTED | 未连接 |
| CONNECTING | 连接中 |
| CONNECTED | 已连接 |
| ERROR | 连接错误 |

---

## 4. 组件和库

### 4.1 MCP SDK

使用官方 Python SDK：`mcp`

```bash
pip install mcp
```

**核心模块**：
- `mcp.server.fastmcp.FastMCP`：快速创建 MCP Server
- `mcp.ClientSession`：客户端会话管理
- `mcp.client.stdio`：Stdio 客户端
- `mcp.client.sse`：SSE 客户端
- `mcp.client.streamable_http`：HTTP 客户端

### 4.2 HTTP/WebSocket 库

- **FastAPI**：提供 RESTful API 和动态路由
- **Uvicorn**：ASGI 服务器

### 4.3 数据库

- **SQLite**：轻量级本地存储
- **SQLAlchemy**：ORM 框架

### 4.4 进程管理

- **asyncio**：异步子进程管理
- **asyncio.create_task**：后台任务管理

---

## 5. 功能附录

### 5.1 传输协议详解

#### Stdio 传输

| 特性 | 说明 |
|------|------|
| 通信方式 | 标准输入/输出 |
| 适用场景 | 本地进程通信 |
| 启动方式 | 通过 command + args 启动子进程 |
| 环境变量 | 支持自定义环境变量 |
| 工作目录 | 支持指定工作目录 |

**配置示例**：

```json
{
    "transport": "stdio",
    "command": "python",
    "args": ["/path/to/server.py"],
    "env": {"DEBUG": "1"}
}
```

#### SSE 传输

| 特性 | 说明 |
|------|------|
| 通信方式 | Server-Sent Events |
| 适用场景 | 远程服务通信 |
| URL 格式 | http(s)://host:port/sse |
| 重连机制 | 支持自动重连 |
| 自定义端点 | 可配置 SSE 端点路径 |

**配置示例**：

```json
{
    "transport": "sse",
    "url": "http://localhost:8080/sse",
    "headers": {"Authorization": "Bearer token"},
    "reconnect": true,
    "retry_interval": 5,
    "max_retries": 3
}
```

#### HTTP 传输

| 特性 | 说明 |
|------|------|
| 通信方式 | Streamable HTTP |
| 适用场景 | 远程服务通信 |
| URL 格式 | http(s)://host:port/mcp |
| 会话管理 | 支持会话 ID |
| 双向通信 | 支持请求/响应流 |

**配置示例**：

```json
{
    "transport": "http",
    "url": "http://localhost:8080/mcp",
    "headers": {"Authorization": "Bearer token"},
    "timeout": 30,
    "session_id": "optional-session-id"
}
```

### 5.2 客户端实现

#### BaseClient 基类

定义统一的客户端接口：

```python
class BaseClient(ABC):
    @abstractmethod
    async def connect(self) -> None: ...
    
    @abstractmethod
    async def disconnect(self) -> None: ...
    
    @abstractmethod
    async def call_tool(self, tool_name: str, arguments: Dict) -> Dict: ...
    
    @abstractmethod
    async def read_resource(self, uri: str) -> Dict: ...
    
    @abstractmethod
    async def get_prompt(self, name: str, arguments: Dict) -> Dict: ...
```

#### ClientFactory 工厂类

根据传输类型创建对应客户端：

```python
from mcp_service.clients import ClientFactory

client = ClientFactory.create_client(server_info)

supported = ClientFactory.get_supported_transports()
# ['stdio', 'sse', 'http']

is_supported = ClientFactory.is_transport_supported('websocket')
# False
```

### 5.3 服务端实现

#### 服务注册表 (ServiceRegistry)

存储和管理 MCP Server 信息：

```python
from mcp_service.host.registry import service_registry, MCPServerInfo, ServerStatus

await service_registry.register(server_info)
await service_registry.unregister(server_id)
server = await service_registry.get_server(server_id)
servers = await service_registry.get_servers_by_user(user_id)
await service_registry.update_status(server_id, ServerStatus.CONNECTED)
```

#### 统一调用器 (UnifiedCaller)

提供统一的工具/资源/提示词访问接口：

```python
from mcp_service.host.caller import unified_caller

tools = await unified_caller.list_tools(server_id)
all_tools = await unified_caller.list_all_tools(user_id)
result = await unified_caller.call(server_id, tool_name, params)
resources = await unified_caller.get_resources(server_id)
prompts = await unified_caller.get_prompts(server_id)
```

### 5.4 网关实现

#### MCPGateway 类

动态路由注册和管理：

```python
from mcp_service.gateway import mcp_gateway

mcp_gateway.init_app(app)
await mcp_gateway.register_route("github", server_id)
await mcp_gateway.unregister_route("github")
routes = mcp_gateway.get_registered_routes()
```

**路由映射**：

| 请求路径 | 处理逻辑 |
|---------|---------|
| `/{name}` | 返回服务器信息 |
| `/{name}/tools` | 返回工具列表 |
| `/{name}/tools/{tool}` | 返回工具详情 |
| `/{name}/tools/{tool}/call` | 调用工具 |
| `/{name}/resources` | 返回资源列表 |
| `/{name}/prompts` | 返回提示词列表 |

### 5.5 API 端点

**基础路径**: `/api/v1/mcp`

#### 服务器管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/servers` | 获取服务器列表 |
| POST | `/servers` | 添加服务器 |
| GET | `/servers/{server_id}` | 获取服务器详情 |
| PUT | `/servers/{server_id}` | 更新服务器配置（带乐观锁） |
| DELETE | `/servers/{server_id}` | 删除服务器 |

#### 创建服务器

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/servers/create/python` | 创建 Python MCP（上传 .py 文件） |
| POST | `/servers/create/stdio` | 创建 Stdio MCP（上传 ZIP 包或文件夹） |
| POST | `/servers/create/http` | 创建 HTTP MCP（填写 HTTP 连接配置） |
| POST | `/servers/create/sse` | 创建 SSE MCP（填写 SSE 连接配置） |

#### 连接管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/servers/{server_id}/connect` | 连接服务器 |
| POST | `/servers/{server_id}/disconnect` | 断开连接 |
| POST | `/servers/test` | 测试连接 |

#### 工具调用

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/servers/{server_id}/tools` | 获取工具列表 |
| GET | `/servers/{server_id}/tools/json` | 获取工具定义 JSON |
| PUT | `/servers/{server_id}/tools` | 更新工具定义（自动重编译） |
| POST | `/servers/{server_id}/tools/{tool_name}/call` | 调用工具 |
| GET | `/tools/all` | 获取所有已启用服务器的工具 |

#### 资源和提示词

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/servers/{server_id}/resources` | 获取资源列表 |
| GET | `/servers/{server_id}/prompts` | 获取提示词列表 |

#### 代码管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/servers/{server_id}/code` | 获取 MCP 代码（main.py） |
| PUT | `/servers/{server_id}/code` | 更新 MCP 代码 |
| GET | `/servers/{server_id}/original` | 获取原始代码（original.py） |
| PUT | `/servers/{server_id}/original` | 更新原始代码（自动重编译） |
| GET | `/servers/{server_id}/files` | 获取服务器文件列表 |

#### 健康检查

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/health` | 健康检查 |

### 5.6 数据模型

#### MCPServerInfo

```python
@dataclass
class MCPServerInfo:
    id: str                    # 服务器唯一标识
    name: str                  # 服务器名称
    transport: str             # 传输类型: stdio/sse/http
    user_id: str               # 所属用户
    url: Optional[str]         # 远程服务器 URL
    command: Optional[str]     # Stdio 命令
    args: List[str]            # 命令参数
    env: Dict[str, str]        # 环境变量
    headers: Dict[str, str]    # HTTP 头
    timeout: int               # 超时时间
    enabled: bool              # 是否启用
    status: ServerStatus       # 连接状态
    tools: List[Dict]          # 工具列表
    description: Optional[str] # 描述
    tags: List[str]            # 标签
```

#### 数据库模型

```python
class MCPServerModel(Base):
    mcp_server_id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=False)
    mcp_name = Column(String(255), nullable=False)
    transport_type = Column(String(50), nullable=False)
    source_type = Column(String(50))  # python_function/stdio/http/sse
    description = Column(Text)
    enabled = Column(Boolean, default=True)
    version = Column(Integer, default=1)  # 乐观锁
```

---

## 6. 快速开始

### 6.1 启动服务

```bash
cd backend
python mcp_service/main.py
```

服务将在 `http://localhost:8992` 启动。

### 6.2 创建 Python MCP

```bash
curl -X POST http://localhost:8992/api/v1/mcp/servers/create/python \
  -F "name=my-tool" \
  -F "description=My custom tool" \
  -F "file=@tool.py" \
  -F 'tools=[{"function_name":"hello","description":"Say hello","parameters":[]}]'
```

### 6.3 连接并调用

```bash
# 连接服务器
curl -X POST http://localhost:8992/api/v1/mcp/servers/{server_id}/connect

# 调用工具
curl -X POST http://localhost:8992/api/v1/mcp/servers/{server_id}/tools/hello/call \
  -H "Content-Type: application/json" \
  -d '{"arguments": {}}'
```

---

## 7. 目录结构

```
backend/mcp_service/
├── __init__.py
├── main.py              # 服务入口
├── config.py            # 配置
├── database.py          # 数据库模型
├── routes.py            # API 路由
├── gateway.py           # 网关路由
├── clients/
│   ├── __init__.py
│   ├── base.py          # 客户端基类
│   ├── factory.py       # 客户端工厂
│   ├── stdio_client.py  # Stdio 客户端
│   ├── sse_client.py    # SSE 客户端
│   └── http_client.py   # HTTP 客户端
└── host/
    ├── __init__.py
    ├── registry.py      # 服务注册表
    ├── lifecycle.py     # 生命周期管理
    └── caller.py        # 统一调用器
```
