# MCP调用方法三方对比方案（修正版）

## 文档信息

| 项目 | 内容 |
|------|------|
| 文档名称 | MCP调用方法三方对比方案（修正版） |
| 版本 | v2.0.0 |
| 创建日期 | 2026-03-26 |
| 作者 | SoloEngine Team |
| 状态 | ✅ 完成 |
| 搜索次数 | 35+ |

---

## 一、核心概念澄清

### 1.1 FastMCP 的四种传输模式

根据网络搜索结果，FastMCP 支持四种传输模式：

| 模式 | 是否需要端口 | 是否需要启动服务 | 通信方式 |
|------|-------------|-----------------|----------|
| **stdio** | ❌ 不需要 | ❌ 客户端spawn子进程 | 标准输入输出 |
| **SSE** | ✅ 需要端口 | ✅ 需要先启动服务器 | HTTP长连接 |
| **HTTP** | ✅ 需要端口 | ✅ 需要先启动服务器 | HTTP请求响应 |
| **memory** | ❌ 不需要 | ❌ 同进程内通信 | 内存直接调用 |

**关键发现**：
> "如果要做 Web 部署，可以用 HTTP 或 SSE 传输：`mcp.run(transport='http', host='127.0.0.1', port=8000, path='/mcp')`服务跑起来以后，客户端就能远程调用工具了。"

### 1.2 三种方案的正确定义

| 方案 | 定义 | 是否需要启动服务 |
|------|------|-----------------|
| **方案A：直接调用MCPClient** | 使用官方MCP SDK的MCPClient | stdio不需要，SSE/HTTP需要 |
| **方案B：通过mcp_service调用** | Agent通过HTTP调用mcp_service代理 | 需要mcp_service运行在8992端口 |
| **方案C：使用FastMCP** | 使用FastMCP框架 | stdio/memory不需要，SSE/HTTP需要 |

---

## 二、详细对比分析

### 2.1 方案A：直接调用MCPClient（官方SDK）

**stdio模式**：
```python
from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

server_params = StdioServerParameters(
    command="python",
    args=["server.py"]
)

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool("tool_name", arguments)
```

**特点**：
- 客户端spawn子进程
- 不需要端口
- 本地通信，延迟最低

**SSE/HTTP模式**：
```python
from mcp import ClientSession
from mcp.client.sse import sse_client

async with sse_client("http://localhost:8000/sse") as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool("tool_name", arguments)
```

**特点**：
- 需要先启动MCP Server监听端口
- 支持远程连接

### 2.2 方案B：通过mcp_service调用

```python
import httpx

async def call_mcp_tool(server_name, tool_name, arguments):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://localhost:8992/call_tool",
            json={"server_name": server_name, "tool_name": tool_name, "arguments": arguments}
        )
    return response.json()
```

**特点**：
- mcp_service必须运行在8992端口
- Agent通过HTTP调用mcp_service
- mcp_service内部再调用MCPClient
- 多一层代理

### 2.3 方案C：使用FastMCP

**stdio模式**：
```python
from fastmcp import Client

# 客户端spawn子进程，不需要端口
async with Client("my_server.py") as client:
    tools = await client.list_tools()
    result = await client.call_tool("tool_name", arguments)
```

**SSE/HTTP模式**：
```python
from fastmcp import Client

# 服务端先启动：mcp.run(transport="sse", port=8000)
async with Client("http://localhost:8000/mcp") as client:
    result = await client.call_tool("tool_name", arguments)
```

**memory模式**：
```python
from fastmcp import FastMCP, Client

mcp = FastMCP("my-server")

@mcp.tool()
def add(a: int, b: int) -> int:
    return a + b

# 同进程内通信，不需要端口，不需要启动服务
async with Client(mcp) as client:
    result = await client.call_tool("add", {"a": 1, "b": 2})
```

---

## 三、核心对比表

### 3.1 按传输模式对比

| 对比维度 | 方案A (MCPClient) | 方案B (mcp_service) | 方案C (FastMCP) |
|----------|-------------------|---------------------|-----------------|
| **stdio模式** | ✅ 支持 | ❌ 不支持 | ✅ 支持 |
| **SSE模式** | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| **HTTP模式** | ✅ 支持 | ✅ 支持 | ✅ 支持 |
| **memory模式** | ❌ 不支持 | ❌ 不支持 | ✅ 独有 |

### 3.2 按架构层级对比

| 对比维度 | 方案A (MCPClient) | 方案B (mcp_service) | 方案C (FastMCP stdio/memory) | 方案C (FastMCP SSE/HTTP) |
|----------|-------------------|---------------------|------------------------------|--------------------------|
| **架构层级** | 2层 | 3层 | 2层 | 2层 |
| **是否需要端口** | stdio不需要 | 需要8992 | 不需要 | 需要 |
| **是否需要启动服务** | stdio不需要 | 需要 | 不需要 | 需要 |
| **延迟** | 低 | 高（多一层HTTP） | 最低 | 低 |

### 3.3 按功能对比

| 对比维度 | 方案A (MCPClient) | 方案B (mcp_service) | 方案C (FastMCP) |
|----------|-------------------|---------------------|-----------------|
| **MCP服务器CRUD** | ❌ 不提供 | ✅ 数据库持久化 | ❌ 不提供 |
| **用户隔离** | ❌ 不提供 | ✅ user_id隔离 | ❌ 不提供 |
| **HTTP管理API** | ❌ 不提供 | ✅ RESTful API | ❌ 不提供 |
| **前端管理界面** | ❌ 不提供 | ✅ 前端集成 | ❌ 不提供 |
| **装饰器语法** | ❌ 不提供 | ❌ 不提供 | ✅ @mcp.tool() |
| **服务器组合** | ❌ 不支持 | ❌ 不支持 | ✅ import_server/mount |
| **中间件** | ❌ 不支持 | ❌ 不支持 | ✅ 内置中间件 |
| **Inspector调试** | ❌ 不提供 | ❌ 不提供 | ✅ fastmcp dev |

---

## 四、关键结论

### 4.1 方案B（mcp_service）的本质

**mcp_service 是 MCP 管理平台，不是调用框架**

| 职责 | 说明 |
|------|------|
| MCP服务器CRUD | 创建、读取、更新、删除MCP服务器配置 |
| 用户隔离 | 按user_id隔离用户的MCP服务器 |
| 数据持久化 | 使用SQLAlchemy存储服务器配置 |
| HTTP管理API | 为前端管理界面提供API |
| 代码生成 | 将Python函数编译为MCP Server |

**mcp_service 不应该代理Agent的工具调用**：
- 增加延迟（多一层HTTP）
- 与主流实现不一致
- 架构复杂度高

### 4.2 方案C（FastMCP）的本质

**FastMCP 是 MCP 开发框架，提供两种角色**：

| 角色 | 说明 |
|------|------|
| 服务端 | 使用装饰器快速定义工具、资源、提示词 |
| 客户端 | 提供简洁的客户端API连接任意MCP Server |

**FastMCP 的四种传输模式**：

| 模式 | 适用场景 |
|------|----------|
| stdio | 本地开发、调试 |
| SSE | 远程部署、流式传输 |
| HTTP | 远程部署、传统请求响应 |
| memory | 测试、同进程内通信 |

### 4.3 三种方案的关系

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        管理层                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     mcp_service (:8992)                          │   │
│  │  - MCP服务器CRUD                                                 │   │
│  │  - 用户隔离                                                      │   │
│  │  - HTTP管理API                                                   │   │
│  │  - 代码生成（使用FastMCP）                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ 管理配置
┌─────────────────────────────────────────────────────────────────────────┐
│                        调用层                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              方案A: MCPClient / 方案C: FastMCP Client            │   │
│  │  - 直接连接MCP Server                                            │   │
│  │  - 支持stdio/SSE/HTTP传输                                        │   │
│  │  - FastMCP额外支持memory传输                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ MCP协议
┌─────────────────────────────────────────────────────────────────────────┐
│                        服务层                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        MCP Server                                │   │
│  │  - 使用官方SDK开发                                               │   │
│  │  - 或使用FastMCP框架开发                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 五、推荐方案

### 5.1 Agent调用MCP工具

**推荐**：方案A（直接调用MCPClient）或 方案C（FastMCP Client）

**原因**：
- 直接连接，无额外代理层
- 延迟最低
- 与主流实现一致

### 5.2 前端管理MCP服务器

**推荐**：通过mcp_service HTTP API

**原因**：
- mcp_service提供完整的CRUD功能
- 用户隔离
- 数据持久化

### 5.3 开发新的MCP Server

**推荐**：使用FastMCP框架

**原因**：
- 装饰器语法简洁
- 内置调试工具
- 支持四种传输模式

---

## 六、总结

| 场景 | 推荐方案 |
|------|----------|
| Agent调用MCP工具 | 方案A或方案C（直接连接） |
| 前端管理MCP服务器 | mcp_service HTTP API |
| 开发新的MCP Server | FastMCP框架 |
| 测试MCP功能 | FastMCP memory模式 |

**关键结论**：
1. mcp_service 是管理平台，不是调用代理
2. FastMCP 是开发框架，支持四种传输模式
3. Agent应该直接调用MCPClient或FastMCP Client，不通过mcp_service代理

---

## 七、参考文献

1. FastMCP传输协议全解析：STDIO、HTTP、SSE的适用场景
2. MCP三种通信机制对比：Stdio、SSE、StreamableHTTP
3. FastMCP v2: 快速构建一个Pythonic风格的 MCP Server 和 MCP Client
4. MCP Gateway 综述与实战指南
5. FastMCP客户端深度解析

---

## 八、变更历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0.0 | 2026-03-26 | 初始版本（存在错误） |
| v2.0.0 | 2026-03-26 | 修正版本，正确理解FastMCP的四种传输模式，重新对比三种方案 |
