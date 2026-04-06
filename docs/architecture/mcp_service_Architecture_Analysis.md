# mcp\_service 架构分析与重构方案

## 文档信息

| 项目   | 内容                     |
| ---- | ---------------------- |
| 文档名称 | mcp\_service 架构分析与重构方案 |
| 版本   | v2.0.0                 |
| 创建日期 | 2026-03-26             |
| 作者   | SoloEngine Team        |
| 状态   | ✅ 完成                   |

***

## 核心理念

> **MCP Server名字叫做Server，但本质就是Tool。**
>
> 不涉及复杂的网络管理等内容。SSE、HTTP有网络连接，但也不需要复杂管理。

***

## 一、当前架构分析

### 1.1 mcp\_service 目录结构

```
mcp_service/
├── main.py              # FastAPI应用入口 (:8992)
├── config.py            # 配置
├── database.py          # 数据库模型
├── routes.py            # API路由 (1457行)
├── gateway.py           # HTTP网关路由（删除）
├── host/
│   ├── registry.py      # 服务注册表
│   ├── lifecycle.py     # 生命周期管理
│   └── caller.py        # 统一调用接口
└── clients/
    ├── base.py          # 客户端基类（可删除）
    ├── factory.py       # 客户端工厂（可删除）
    ├── stdio_client.py  # stdio客户端（可删除）
    ├── sse_client.py    # SSE客户端（可删除）
    └── http_client.py   # HTTP客户端（可删除）
```

### 1.2 SoloAgent MCP 目录结构

```
SoloAgent/plugins/mcp/
└── mcp_client.py        # MCP客户端实现（统一使用）
```

### 1.3 当前架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        前端                                              │
│  ┌─────────────────┐    ┌─────────────────┐                             │
│  │  MCP管理界面    │    │   运行面板      │                             │
│  └────────┬────────┘    └────────┬────────┘                             │
└───────────┼──────────────────────┼──────────────────────────────────────┘
            ↓ HTTP (:8992)         ↓ WebSocket (:8990)
┌───────────────────┐    ┌───────────────────────────────────────────────┐
│   mcp_service     │    │              主后端 :8990                      │
│   :8992           │    │                                               │
│  ┌─────────────┐  │    │  ┌─────────────────────────────────┐          │
│  │ clients/    │  │    │  │         AgenticFlowCompiler     │          │
│  │ (重复代码)  │  │    │  │  - 编译时创建MCPClient实例      │          │
│  └─────────────┘  │    │  │  - 注入到Agent                  │          │
│                   │    │  └─────────────────────────────────┘          │
│  ┌─────────────┐  │    │                    ↓                           │
│  │ host/       │  │    │  ┌─────────────────────────────────┐          │
│  │ - registry  │  │    │  │           SoloAgent             │          │
│  │ - lifecycle │  │    │  │  ┌─────────────────────────┐    │          │
│  │ - caller    │  │    │  │  │ MCPTool → MCPClient     │    │          │
│  └─────────────┘  │    │  │  └─────────────────────────┘    │          │
│                   │    │  └─────────────────────────────────┘          │
│  ┌─────────────┐  │    │                                               │
│  │ gateway.py  │  │    │                                               │
│  │ (不需要)    │  │    │                                               │
│  └─────────────┘  │    │                                               │
└───────────────────┘    └───────────────────────────────────────────────┘
```

***

## 二、问题分析

### 2.1 两套客户端实现（重复代码）

| 位置                     | 文件   | 功能                |
| ---------------------- | ---- | ----------------- |
| mcp\_service/clients/  | 4个文件 | mcp\_service专用客户端 |
| SoloAgent/plugins/mcp/ | 1个文件 | Agent专用客户端        |

**问题**：代码重复，功能完全相同

### 2.2 两个端口

| 服务           | 端口   | 职责                  |
| ------------ | ---- | ------------------- |
| 主后端          | 8990 | Agent运行、WebSocket通信 |
| mcp\_service | 8992 | MCP管理               |

**问题**：增加部署复杂度，前端需要连接两个端口

### 2.3 功能重叠

| 功能         | mcp\_service | SoloAgent |
| ---------- | ------------ | --------- |
| MCP服务器CRUD | ✅            | ❌         |
| 代码生成       | ✅            | ❌         |
| 连接管理       | ✅            | ✅（编译时）    |
| 工具调用       | ✅（HTTP代理）    | ✅（直接调用）   |

**问题**：工具调用方式不一致

***

## 三、重构方案

### 3.1 核心原则

> **MCP Server本质就是Tool，不需要复杂的网络管理。**
>
> **端口是MCP Server的事，不是MCPClient的事，更不是mcp\_service的事。**

| MCP Server传输方式 | MCP Server是否需要端口    | MCPClient是否需要端口      | mcp\_service是否需要端口 |
| -------------- | ------------------- | -------------------- | ------------------ |
| stdio          | ❌ 不需要（spawn子进程）     | ❌ 不需要                | ❌ 不需要              |
| SSE            | ✅ 需要端口（如 :1234/sse） | ❌ 不需要（连接到Server的URL） | ❌ 不需要              |
| HTTP           | ✅ 需要端口              | ❌ 不需要（连接到Server的URL） | ❌ 不需要              |

**关键理解**：

- MCPClient只是**连接到**MCP Server的URL，不需要自己监听端口
- mcp\_service只是**存储配置**和**创建MCPClient**，根本不涉及端口
- 只有MCP Server在SSE/HTTP模式下才需要监听端口

### 3.2 目标架构（统一到主后端）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        前端                                              │
│  ┌─────────────────┐    ┌─────────────────┐                             │
│  │  MCP管理界面    │    │   运行面板      │                             │
│  └────────┬────────┘    └────────┬────────┘                             │
└───────────┼──────────────────────┼──────────────────────────────────────┘
            ↓                      ↓
            └──────────────────────┼──────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                        主后端 :8990（统一入口）                           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     MCP管理模块                                   │   │
│  │  - MCP服务器CRUD                                                 │   │
│  │  - 代码生成                                                      │   │
│  │  - 连接测试                                                      │   │
│  │  - 统一使用MCPClient直接调用                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     MCP调用模块                                   │   │
│  │  - MCPClient（统一客户端）                                        │   │
│  │  - MCPTool（Agent工具）                                          │   │
│  │  - MCPServerInfo（服务器信息）                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     Agent模块                                     │   │
│  │  - SoloAgent                                                     │   │
│  │  - AgenticFlowCompiler                                           │   │
│  │  - ReActCore                                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

<br />

数据流：
```
┌─────────────────────────────────────────────────────────────────────────┐
│                           数据库                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     MCP配置表                                    │   │
│  │  - server_id, server_name, transport, url, command, args...    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
            ↑ 写入                                    ↓ 读取
┌───────────────────┐                    ┌───────────────────────────────┐
│   mcp_service     │                    │         SoloAgent             │
│   (管理工具)      │                    │                               │
│                   │                    │  ┌─────────────────────────┐  │
│  - MCP服务器CRUD  │                    │  │ AgenticFlowCompiler     │  │
│  - 代码生成       │                    │  │ - _load_mcp_configs()   │  │
│  - 连接测试       │                    │  │ - 创建MCPClient实例     │  │
│  - 使用MCPClient  │                    │  └─────────────────────────┘  │
│    进行测试       │                    │               ↓               │
│                   │                    │  ┌─────────────────────────┐  │
│                   │                    │  │ MCPTool → MCPClient     │  │
│                   │                    │  │ (直接调用MCP Server)    │  │
│                   │                    │  └─────────────────────────┘  │
└───────────────────┘                    └───────────────────────────────┘
```

<br />

### 3.3 重构步骤

#### 步骤1：删除重复代码

删除 `mcp_service/clients/` 目录，统一使用 `SoloAgent/plugins/mcp/mcp_client.py`。

#### 步骤2：删除不需要的功能

删除 `mcp_service/gateway.py`（动态路由注册不需要，外部系统应通过主后端统一API调用）。

#### 步骤3：将mcp\_service路由注册到主后端

```python
# backend/main.py

from mcp_service.routes import router as mcp_router

app = FastAPI()

# 注册MCP管理路由
app.include_router(mcp_router, prefix="/api/v1/mcp")
```

#### 步骤4：修改mcp\_service使用统一客户端

```python
# mcp_service/host/lifecycle.py

from SoloAgent.plugins.mcp.mcp_client import MCPClient

class LifecycleManager:
    async def connect(self, server_id: str) -> bool:
        server_info = await self._registry.get_server(server_id)
        
        # 使用统一的MCPClient
        client = MCPClient({
            "transport": server_info.transport,
            "url": server_info.url,
            "command": server_info.command,
            "args": server_info.args,
            "env": server_info.env,
            "headers": server_info.headers,
            "timeout": server_info.timeout,
        })
        
        await client.connect()
        self._clients[server_id] = client
```

#### 步骤5：删除mcp\_service独立入口

删除 `mcp_service/main.py`，不再作为独立服务运行。

***

## 四、功能分配

### 4.1 重构后的mcp\_service功能

| 功能         | 说明                     | 状态   |
| ---------- | ---------------------- | ---- |
| MCP服务器CRUD | 创建、读取、更新、删除MCP服务器配置    | ✅ 保留 |
| 代码生成       | 将Python函数编译为MCP Server | ✅ 保留 |
| 连接测试       | 测试MCP服务器是否可用           | ✅ 保留 |
| 用户隔离       | 按user\_id隔离用户的MCP服务器   | ✅ 保留 |
| ~~HTTP网关~~ | ~~动态路由注册~~             | ❌ 删除 |

### 4.2 统一调用方式

| 调用场景         | 调用方式                     |
| ------------ | ------------------------ |
| Agent调用MCP工具 | 直接使用MCPClient            |
| 前端管理界面       | 通过主后端API，后端直接调用MCPClient |
| 外部系统调用       | 通过主后端统一API               |

***

## 五、关键问题回答

### 5.1 mcp\_service是否应该使用 `mcp_client.py`？

**是的，应该统一使用** **`SoloAgent/plugins/mcp/mcp_client.py`**

原因：

- 消除代码重复
- 统一客户端实现
- 降低维护成本

### 5.2 是否应该将8992接口融入8990？

**是的，应该将mcp\_service的路由注册到主后端**

原因：

- 减少端口数量
- 简化部署架构
- 前端只需连接一个端口

### 5.3 mcp\_service是否应该支持"Agent调用MCP工具"？

**不应该。Agent应该直接使用MCPClient，不通过HTTP代理。**

原因：

- 减少延迟
- 与主流实现一致
- MCP Server本质就是Tool，不需要复杂管理

### 5.4 是否需要HTTP网关（动态路由注册）？

**不需要。**

原因：

- 外部系统应通过主后端统一API调用
- 动态路由注册破坏架构统一性
- 增加不必要的复杂度

***

## 六、目标架构 vs FastMCP 对比

### 6.1 定位对比

| 维度       | 目标架构           | FastMCP               |
| -------- | -------------- | --------------------- |
| **定位**   | MCP管理平台        | MCP开发框架               |
| **主要功能** | CRUD、代码生成、连接测试 | Server/Client开发、装饰器语法 |
| **目标用户** | 前端管理界面、Agent   | Python开发者             |

### 6.2 功能对比

| 功能                  | 目标架构           | FastMCP                |
| ------------------- | -------------- | ---------------------- |
| **MCP Server CRUD** | ✅ 数据库持久化       | ❌ 不提供                  |
| **用户隔离**            | ✅ user\_id隔离   | ❌ 不提供                  |
| **代码生成**            | ✅ Python→MCP编译 | ❌ 不提供                  |
| **HTTP管理API**       | ✅ RESTful API  | ❌ 不提供                  |
| **装饰器语法**           | ❌ 不提供          | ✅ @mcp.tool()          |
| **memory传输**        | ❌ 不支持          | ✅ 支持                   |
| **服务器组合**           | ❌ 不支持          | ✅ import\_server/mount |
| **中间件**             | ❌ 不支持          | ✅ 内置中间件                |

### 6.3 关系定位

**目标架构和FastMCP是互补关系**：

- 目标架构负责**管理**（CRUD、代码生成、连接测试）
- FastMCP负责**开发**（装饰器语法、快速开发）
- 目标架构生成代码时**使用FastMCP语法**

***

## 七、功能介绍

### 7.1 重构后的mcp\_service功能（100字）

mcp\_service是MCP服务器管理平台，提供三大核心功能：**MCP服务器CRUD**（创建、读取、更新、删除配置）、**代码生成**（将Python函数编译为MCP Server）、**连接测试**（验证MCP服务器可用性）。集成到主后端8990端口，统一使用MCPClient直接调用，支持用户隔离和数据持久化。

### 7.2 SoloAgent与mcp\_service的关系（100字）

SoloAgent是Agent执行引擎，mcp\_service是MCP管理平台。两者关系：**编译时**，AgenticFlowCompiler从mcp\_service数据库读取MCP配置，创建MCPClient实例注入到Agent；**运行时**，Agent通过MCPTool直接调用MCPClient执行工具。mcp\_service负责管理配置，Agent负责执行调用，职责分离，单向依赖。

***

## 八、总结

| 问题                                  | 答案                        |
| ----------------------------------- | ------------------------- |
| mcp\_service是否应该使用 `mcp_client.py`？ | ✅ 是，统一客户端实现               |
| 是否应该将8992接口融入8990？                  | ✅ 是，简化部署架构                |
| 是否需要HTTP网关？                         | ❌ 不需要，外部系统应通过主后端统一API调用   |
| 目标架构 vs FastMCP                     | 互补关系：目标架构负责管理，FastMCP负责开发 |

***

## 九、变更历史

| 版本     | 日期         | 变更内容                                         |
| ------ | ---------- | -------------------------------------------- |
| v1.0.0 | 2026-03-26 | 初始版本                                         |
| v2.0.0 | 2026-03-26 | 整合深度分析内容，强调"MCP Server本质就是Tool"理念，删除HTTP网关功能 |
| v2.1.0 | 2026-03-26 | 添加完整修改清单，包含所有需要删除、修改、迁移的代码文件                  |

***

## 十、完整修改清单

### 10.1 需要删除的文件

| 文件路径 | 删除原因 | 影响范围 |
| --- | --- | --- |
| `backend/mcp_service/main.py` | 不再独立运行，路由注册到主后端 | mcp_service启动入口 |
| `backend/mcp_service/gateway.py` | HTTP网关不需要，外部系统应通过主后端统一API调用 | 动态路由注册功能 |
| `backend/mcp_service/clients/__init__.py` | 重复代码，统一使用SoloAgent的MCPClient | mcp_service内部客户端导入 |
| `backend/mcp_service/clients/base.py` | 重复代码，统一使用SoloAgent的MCPClient | mcp_service客户端基类 |
| `backend/mcp_service/clients/factory.py` | 重复代码，统一使用SoloAgent的MCPClient | mcp_service客户端工厂 |
| `backend/mcp_service/clients/stdio_client.py` | 重复代码，统一使用SoloAgent的MCPClient | mcp_service stdio客户端 |
| `backend/mcp_service/clients/sse_client.py` | 重复代码，统一使用SoloAgent的MCPClient | mcp_service SSE客户端 |
| `backend/mcp_service/clients/http_client.py` | 重复代码，统一使用SoloAgent的MCPClient | mcp_service HTTP客户端 |

**删除目录**：`backend/mcp_service/clients/` 整个目录

### 10.2 需要修改的文件

#### 10.2.1 后端文件

| 文件路径 | 修改内容 | 修改类型 |
| --- | --- | --- |
| `backend/main.py` | 注册mcp_service路由到主后端 | 新增代码 |
| `backend/mcp_service/config.py` | 删除`MCP_SERVICE_PORT`和`MCP_SERVICE_HOST`配置 | 删除配置 |
| `backend/mcp_service/host/lifecycle.py` | 改用`SoloAgent.plugins.mcp.mcp_client.MCPClient` | 重构导入和实现 |
| `backend/mcp_service/host/caller.py` | 改用统一的MCPClient | 重构实现 |
| `backend/mcp_service/routes.py` | 1. 删除`from .clients import ClientFactory`导入<br>2. 改用`SoloAgent.plugins.mcp.mcp_client.MCPClient`<br>3. 删除health_check中的port: 8992 | 重构导入和实现 |
| `backend/mcp_service/database.py` | 保持不变，数据库模型继续使用 | 无需修改 |
| `backend/mcp_service/host/registry.py` | 保持不变，服务注册表继续使用 | 无需修改 |
| `backend/app/core/mcp_service_builder.py` | 保持不变，代码生成功能继续使用 | 无需修改 |

#### 10.2.2 前端文件

| 文件路径 | 修改内容 | 修改类型 |
| --- | --- | --- |
| `frontend/src/services/mcpApi.ts` | 1. 修改`MCP_SERVICE_URL`从`http://localhost:8992/api/v1`改为`http://localhost:8990/api/v1`<br>2. 更新注释中的端口说明 | 端口迁移 |

### 10.3 需要修改的具体代码

#### 10.3.1 `backend/main.py` 新增内容

```python
# 在文件末尾添加

from mcp_service.routes import router as mcp_router
from mcp_service.database import init_db as init_mcp_db

# 初始化MCP数据库
init_mcp_db()

# 注册MCP管理路由
app.include_router(mcp_router, prefix="/api/v1/mcp", tags=["mcp"])
```

#### 10.3.2 `backend/mcp_service/config.py` 修改

```python
# 删除以下两行
MCP_SERVICE_PORT = 8992
MCP_SERVICE_HOST = "0.0.0.0"

# 保留以下内容
DEFAULT_TIMEOUT = 30
MAX_TOOL_ARGUMENTS_SIZE = 1024 * 1024

CORS_ORIGINS = [
    "http://localhost:8991",
    "http://127.0.0.1:8991",
    "http://localhost:8990",
    "http://127.0.0.1:8990",
]
```

#### 10.3.3 `backend/mcp_service/host/lifecycle.py` 修改

```python
# 修改导入
# 删除
from ..clients import ClientFactory, BaseClient

# 新增
from SoloAgent.plugins.mcp.mcp_client import MCPClient

# 修改LifecycleManager类
class LifecycleManager:
    def __init__(self, registry: ServiceRegistry = None):
        self._registry = registry or service_registry
        self._clients: Dict[str, MCPClient] = {}  # 类型改为MCPClient
        self._lock = asyncio.Lock()
    
    async def connect(self, server_id: str) -> bool:
        server_info = await self._registry.get_server(server_id)
        if not server_info:
            logger.error(f"Server {server_id} not found")
            return False
        
        async with self._lock:
            if server_id in self._clients:
                logger.warning(f"Server {server_id} already connected")
                return True
        
        await self._registry.update_status(server_id, ServerStatus.CONNECTING)
        
        try:
            # 使用统一的MCPClient
            client_config = {
                "transport": server_info.transport,
                "timeout": server_info.timeout,
            }
            
            if server_info.transport == "stdio":
                client_config["command"] = server_info.command
                client_config["args"] = server_info.args or []
                client_config["env"] = server_info.env or {}
            elif server_info.transport in ("sse", "http"):
                client_config["url"] = server_info.url
                client_config["headers"] = server_info.headers or {}
            
            client = MCPClient(client_config)
            await client.connect()
            
            async with self._lock:
                self._clients[server_id] = client
            
            await self._registry.update_status(server_id, ServerStatus.CONNECTED)
            logger.info(f"Connected to MCP server: {server_info.name}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to server {server_info.name}: {e}")
            await self._registry.update_status(
                server_id,
                ServerStatus.ERROR,
                str(e)
            )
            return False
```

#### 10.3.4 `backend/mcp_service/routes.py` 修改

```python
# 修改导入（第1080行附近）
# 删除
from .clients import ClientFactory

# 新增
from SoloAgent.plugins.mcp.mcp_client import MCPClient

# 修改test_server函数（第1077-1128行）
@router.post("/servers/test")
async def test_server(server: MCPServerCreate):
    """测试 MCP 服务器连接。"""
    client_config = {
        "transport": server.transport,
        "timeout": server.timeout,
    }
    
    if server.transport == "stdio":
        client_config["command"] = server.command
        client_config["args"] = server.args or []
        client_config["env"] = server.env or {}
    elif server.transport in ("sse", "http"):
        client_config["url"] = server.url
        client_config["headers"] = server.headers or {}
    
    client = None
    try:
        client = MCPClient(client_config)
        await client.connect()
        tools = await client.get_tools()
        
        return {
            "code": 200,
            "message": "Connection test successful",
            "data": {
                "connected": True,
                "tools_count": len(tools),
                "tools": [{"name": t.get("name"), "description": t.get("description", "")} for t in tools[:5]],
            },
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "code": 500,
                "message": f"Connection test failed: {str(e)}",
                "data": {
                    "connected": False,
                    "error": str(e),
                },
            }
        )
    finally:
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass

# 修改health_check函数（第1295-1307行）
@router.get("/health")
async def health_check():
    """健康检查端点。"""
    return {
        "code": 200,
        "message": "MCP Service is running",
        "data": {
            "service": "mcp-service",
            "version": "2.1.0",
            "integrated": True,  # 新增：表示已集成到主后端
        },
    }
```

#### 10.3.5 `frontend/src/services/mcpApi.ts` 修改

```typescript
// 修改第27行
// 删除
const MCP_SERVICE_URL = 'http://localhost:8992/api/v1';

// 新增
const MCP_SERVICE_URL = 'http://localhost:8990/api/v1';

// 修改注释（第21行）
// 删除
 * - MCP服务独立部署于端口8992

// 新增
 * - MCP服务已集成到主后端端口8990
```

### 10.4 需要保留的文件

| 文件路径 | 保留原因 |
| --- | --- |
| `backend/mcp_service/__init__.py` | 模块初始化 |
| `backend/mcp_service/config.py` | 配置常量（删除端口配置后） |
| `backend/mcp_service/database.py` | 数据库模型和操作 |
| `backend/mcp_service/routes.py` | API路由（修改后） |
| `backend/mcp_service/host/__init__.py` | host模块初始化 |
| `backend/mcp_service/host/registry.py` | 服务注册表 |
| `backend/mcp_service/host/lifecycle.py` | 生命周期管理（修改后） |
| `backend/mcp_service/host/caller.py` | 统一调用接口（修改后） |
| `backend/SoloAgent/plugins/mcp/mcp_client.py` | 统一MCP客户端（核心保留） |

### 10.5 端口迁移影响

| 原端口 | 新端口 | 影响范围 |
| --- | --- | --- |
| 8992 | 8990 | 前端mcpApi.ts调用 |
| - | - | 后端main.py启动脚本 |
| - | - | 部署配置文件 |

### 10.6 重构后的目录结构

```
backend/
├── main.py                          # 主后端入口（新增mcp_service路由注册）
├── mcp_service/
│   ├── __init__.py                  # 保留
│   ├── config.py                    # 保留（删除端口配置）
│   ├── database.py                  # 保留
│   ├── routes.py                    # 保留（修改客户端导入）
│   └── host/
│       ├── __init__.py              # 保留
│       ├── registry.py              # 保留
│       ├── lifecycle.py             # 保留（改用统一MCPClient）
│       └── caller.py                # 保留（改用统一MCPClient）
├── SoloAgent/
│   └── plugins/
│       └── mcp/
│           └── mcp_client.py        # 统一MCP客户端（核心）
└── app/
    └── core/
        └── mcp_service_builder.py   # 保留（代码生成功能）

frontend/
└── src/
    └── services/
        └── mcpApi.ts                # 修改端口从8992到8990
```

### 10.7 重构执行顺序

| 步骤 | 操作 | 说明 |
| --- | --- | --- |
| 1 | 修改`frontend/src/services/mcpApi.ts` | 修改端口配置 |
| 2 | 删除`backend/mcp_service/clients/`目录 | 删除重复代码 |
| 3 | 删除`backend/mcp_service/gateway.py` | 删除不需要的功能 |
| 4 | 修改`backend/mcp_service/config.py` | 删除端口配置 |
| 5 | 修改`backend/mcp_service/host/lifecycle.py` | 改用统一MCPClient |
| 6 | 修改`backend/mcp_service/host/caller.py` | 改用统一MCPClient |
| 7 | 修改`backend/mcp_service/routes.py` | 改用统一MCPClient |
| 8 | 修改`backend/main.py` | 注册mcp_service路由 |
| 9 | 删除`backend/mcp_service/main.py` | 删除独立入口 |
| 10 | 测试验证 | 确保所有功能正常 |