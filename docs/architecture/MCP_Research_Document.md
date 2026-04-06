# MCP (Model Context Protocol) 调研文档

## 文档概述

本文档基于对MCP协议的深入网络调研（30+次搜索）和对项目代码的全面分析（30+个文件），详细阐述MCP标准的调用规则、范式、返回值规范，以及项目中的MCP实现架构。

---

## 一、MCP协议概述

### 1.1 什么是MCP

**MCP (Model Context Protocol)** 是由 Anthropic 于2024年11月推出的开放标准协议，被称为"AI领域的USB-C接口"。它定义了大语言模型与外部工具、数据源之间的统一通信标准，使AI应用能够安全、标准化地访问外部能力。

### 1.2 核心价值

| 特性 | 描述 |
|------|------|
| **标准化** | 统一的接口规范，一次开发，处处可用 |
| **安全性** | 内置安全机制，支持OAuth 2.1认证 |
| **可扩展** | 支持工具、资源、提示词等多种能力 |
| **互操作性** | 不同AI应用和工具之间的无缝集成 |

### 1.3 协议版本

| 版本 | 发布日期 | 主要特性 |
|------|----------|----------|
| 2024-11-05 | 2024年11月 | 初始版本，支持stdio和SSE传输 |
| 2025-03-26 | 2025年3月 | 新增Streamable HTTP、Elicitation、OAuth 2.1 |

---

## 二、MCP架构设计

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Host (宿主应用)                             │
│                                                                             │
│  职责：管理用户界面、协调多个MCP Client、决定何时调用工具、管理权限和审计    │
│                                                                             │
│  示例：Claude Desktop、Cursor、Trae IDE、自定义AI应用                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ 1:1 连接
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Client (客户端)                             │
│                                                                             │
│  职责：与MCP Server建立连接、协议版本协商、消息路由和转发、会话状态管理     │
│                                                                             │
│  核心能力：                                                                  │
│  - 建立和维护与服务器的连接                                                  │
│  - 处理协议握手和能力协商                                                    │
│  - 发送请求和接收响应                                                        │
│  - 处理服务器通知                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ MCP Protocol
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Server (服务端)                             │
│                                                                             │
│  职责：暴露工具(Tools)、资源(Resources)、提示词(Prompts)                     │
│                                                                             │
│  核心能力：                                                                  │
│  - Tools: 可调用的函数/工具                                                  │
│  - Resources: 可读取的资源（文件、数据库等）                                  │
│  - Prompts: 预定义的提示词模板                                               │
│  - Sampling: 请求LLM采样的能力（可选）                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 三层架构详解

| 层级 | 组件 | 职责 | 示例 |
|------|------|------|------|
| **Host层** | MCP Host | 宿主应用，管理用户交互 | Claude Desktop、Cursor |
| **Client层** | MCP Client | 协议适配，连接管理 | StdioClient、SSEClient、HTTPClient |
| **Server层** | MCP Server | 提供具体能力 | GitHub MCP、Filesystem MCP |

---

## 三、MCP标准调用规则和范式

### 3.1 消息格式

MCP基于 **JSON-RPC 2.0** 协议，定义了三种消息类型：

#### 3.1.1 请求消息 (Request)

```json
{
    "jsonrpc": "2.0",
    "id": "unique-request-id",
    "method": "tools/call",
    "params": {
        "name": "tool_name",
        "arguments": {
            "param1": "value1",
            "param2": "value2"
        }
    }
}
```

**字段说明**：
| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `jsonrpc` | string | 是 | 固定值 "2.0" |
| `id` | string/number | 是 | 请求唯一标识符 |
| `method` | string | 是 | 要调用的方法名 |
| `params` | object/array | 否 | 方法参数 |

#### 3.1.2 响应消息 (Response)

**成功响应**：
```json
{
    "jsonrpc": "2.0",
    "id": "unique-request-id",
    "result": {
        "content": [
            {
                "type": "text",
                "text": "Tool execution result"
            }
        ],
        "isError": false
    }
}
```

**错误响应**：
```json
{
    "jsonrpc": "2.0",
    "id": "unique-request-id",
    "error": {
        "code": -32602,
        "message": "Invalid params",
        "data": {
            "details": "Missing required parameter: name"
        }
    }
}
```

#### 3.1.3 通知消息 (Notification)

```json
{
    "jsonrpc": "2.0",
    "method": "notifications/tools/list_changed",
    "params": {}
}
```

**特点**：通知消息没有 `id` 字段，不需要响应。

### 3.2 标准错误代码

| 错误代码 | 名称 | 描述 |
|----------|------|------|
| -32700 | Parse error | JSON解析错误 |
| -32600 | Invalid Request | 无效的请求对象 |
| -32601 | Method not found | 方法不存在 |
| -32602 | Invalid params | 无效的参数 |
| -32603 | Internal error | 服务器内部错误 |
| -32000 to -32099 | Server error | 服务器自定义错误 |

### 3.3 生命周期管理

#### 3.3.1 初始化流程

```
┌─────────────┐                              ┌─────────────┐
│   Client    │                              │   Server    │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │  ──────── initialize request ──────────►  │
       │  {                                         │
       │    "protocolVersion": "2025-03-26",        │
       │    "capabilities": {...},                  │
       │    "clientInfo": {...}                     │
       │  }                                         │
       │                                            │
       │  ◄─────── initialize response ──────────  │
       │  {                                         │
       │    "protocolVersion": "2025-03-26",        │
       │    "capabilities": {...},                  │
       │    "serverInfo": {...}                     │
       │  }                                         │
       │                                            │
       │  ──────── initialized notification ─────►  │
       │  { "method": "notifications/initialized" } │
       │                                            │
       │           [连接建立完成]                    │
```

#### 3.3.2 初始化请求详解

```json
{
    "jsonrpc": "2.0",
    "id": "init-1",
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {
            "roots": {
                "listChanged": true
            },
            "sampling": {},
            "elicitation": {
                "form": {},
                "url": {}
            }
        },
        "clientInfo": {
            "name": "my-client",
            "version": "1.0.0"
        }
    }
}
```

#### 3.3.3 初始化响应详解

```json
{
    "jsonrpc": "2.0",
    "id": "init-1",
    "result": {
        "protocolVersion": "2025-03-26",
        "capabilities": {
            "tools": {},
            "resources": {
                "subscribe": true,
                "listChanged": true
            },
            "prompts": {},
            "logging": {}
        },
        "serverInfo": {
            "name": "my-server",
            "version": "1.0.0"
        }
    }
}
```

### 3.4 能力协商 (Capabilities)

#### 3.4.1 客户端能力

| 能力 | 描述 | 字段 |
|------|------|------|
| `roots` | 支持根目录管理 | `listChanged: boolean` |
| `sampling` | 支持LLM采样请求 | `{}` |
| `elicitation` | 支持用户交互请求 | `form: {}, url: {}` |

#### 3.4.2 服务端能力

| 能力 | 描述 | 字段 |
|------|------|------|
| `tools` | 支持工具调用 | `listChanged: boolean` |
| `resources` | 支持资源访问 | `subscribe: boolean, listChanged: boolean` |
| `prompts` | 支持提示词模板 | `listChanged: boolean` |
| `logging` | 支持日志输出 | `{}` |
| `completion` | 支持自动完成 | `{}` |

---

## 四、Tools 工具调用规范

### 4.1 工具定义格式

```json
{
    "name": "github_create_issue",
    "description": "Create a new issue in a GitHub repository",
    "inputSchema": {
        "type": "object",
        "properties": {
            "owner": {
                "type": "string",
                "description": "Repository owner"
            },
            "repo": {
                "type": "string",
                "description": "Repository name"
            },
            "title": {
                "type": "string",
                "description": "Issue title"
            },
            "body": {
                "type": "string",
                "description": "Issue body content"
            }
        },
        "required": ["owner", "repo", "title"]
    },
    "annotations": {
        "title": "Create GitHub Issue",
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": true
    }
}
```

### 4.2 工具注解 (Annotations)

| 注解 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `title` | string | - | 人类可读的工具标题 |
| `readOnlyHint` | boolean | false | 工具是否不修改环境 |
| `destructiveHint` | boolean | true | 工具是否可能执行破坏性操作 |
| `idempotentHint` | boolean | false | 相同参数重复调用是否无额外效果 |
| `openWorldHint` | boolean | true | 工具是否与外部实体交互 |

### 4.3 工具调用流程

```
┌─────────────┐                              ┌─────────────┐
│   Client    │                              │   Server    │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │  ──────── tools/list request ──────────►  │
       │  { "method": "tools/list" }                │
       │                                            │
       │  ◄─────── tools/list response ──────────  │
       │  { "result": { "tools": [...] } }          │
       │                                            │
       │  ──────── tools/call request ──────────►  │
       │  {                                         │
       │    "method": "tools/call",                 │
       │    "params": {                             │
       │      "name": "github_create_issue",        │
       │      "arguments": {                        │
       │        "owner": "modelcontextprotocol",    │
       │        "repo": "servers",                  │
       │        "title": "Bug report"               │
       │      }                                     │
       │    }                                       │
       │  }                                         │
       │                                            │
       │  ◄─────── tools/call response ──────────  │
       │  {                                         │
       │    "result": {                             │
       │      "content": [...],                     │
       │      "isError": false                      │
       │    }                                       │
       │  }                                         │
```

### 4.4 工具调用请求格式

```json
{
    "jsonrpc": "2.0",
    "id": "tool-call-1",
    "method": "tools/call",
    "params": {
        "name": "tool_name",
        "arguments": {
            "param1": "value1",
            "param2": "value2"
        }
    }
}
```

### 4.5 工具返回值格式

#### 4.5.1 成功返回

```json
{
    "jsonrpc": "2.0",
    "id": "tool-call-1",
    "result": {
        "content": [
            {
                "type": "text",
                "text": "Issue created successfully: https://github.com/owner/repo/issues/123"
            }
        ],
        "isError": false
    }
}
```

#### 4.5.2 错误返回

```json
{
    "jsonrpc": "2.0",
    "id": "tool-call-1",
    "result": {
        "content": [
            {
                "type": "text",
                "text": "Error: Repository not found. Please check the owner and repo name."
            }
        ],
        "isError": true
    }
}
```

#### 4.5.3 多内容类型返回

```json
{
    "jsonrpc": "2.0",
    "id": "tool-call-1",
    "result": {
        "content": [
            {
                "type": "text",
                "text": "Here is the screenshot:"
            },
            {
                "type": "image",
                "data": "base64-encoded-image-data",
                "mimeType": "image/png"
            },
            {
                "type": "resource",
                "resource": {
                    "uri": "file:///path/to/document.pdf",
                    "mimeType": "application/pdf"
                }
            }
        ],
        "isError": false
    }
}
```

### 4.6 内容类型详解

| 类型 | 字段 | 描述 |
|------|------|------|
| `text` | `text` | 文本内容 |
| `image` | `data`, `mimeType` | 图片内容（Base64编码） |
| `resource` | `resource` | 资源引用 |

---

## 五、Resources 资源规范

### 5.1 资源定义格式

```json
{
    "uri": "file:///path/to/document.md",
    "name": "document.md",
    "description": "Project documentation",
    "mimeType": "text/markdown"
}
```

### 5.2 资源模板

```json
{
    "uriTemplate": "github://repos/{owner}/{repo}/issues/{issue_number}",
    "name": "GitHub Issue",
    "description": "Access a specific GitHub issue",
    "mimeType": "application/json"
}
```

### 5.3 资源操作

#### 5.3.1 列出资源

**请求**：
```json
{
    "jsonrpc": "2.0",
    "id": "resources-1",
    "method": "resources/list"
}
```

**响应**：
```json
{
    "jsonrpc": "2.0",
    "id": "resources-1",
    "result": {
        "resources": [
            {
                "uri": "file:///path/to/file1.md",
                "name": "file1.md",
                "mimeType": "text/markdown"
            },
            {
                "uri": "file:///path/to/file2.json",
                "name": "file2.json",
                "mimeType": "application/json"
            }
        ]
    }
}
```

#### 5.3.2 读取资源

**请求**：
```json
{
    "jsonrpc": "2.0",
    "id": "read-1",
    "method": "resources/read",
    "params": {
        "uri": "file:///path/to/document.md"
    }
}
```

**响应**：
```json
{
    "jsonrpc": "2.0",
    "id": "read-1",
    "result": {
        "contents": [
            {
                "uri": "file:///path/to/document.md",
                "mimeType": "text/markdown",
                "text": "# Document Title\n\nContent here..."
            }
        ]
    }
}
```

#### 5.3.3 订阅资源变更

**请求**：
```json
{
    "jsonrpc": "2.0",
    "id": "subscribe-1",
    "method": "resources/subscribe",
    "params": {
        "uri": "file:///path/to/document.md"
    }
}
```

**变更通知**：
```json
{
    "jsonrpc": "2.0",
    "method": "notifications/resources/updated",
    "params": {
        "uri": "file:///path/to/document.md"
    }
}
```

---

## 六、Prompts 提示词规范

### 6.1 提示词定义格式

```json
{
    "name": "analyze_code",
    "description": "Analyze code for potential improvements",
    "arguments": [
        {
            "name": "language",
            "description": "Programming language",
            "required": true
        },
        {
            "name": "style",
            "description": "Analysis style (quick/detailed)",
            "required": false
        }
    ]
}
```

### 6.2 获取提示词

**请求**：
```json
{
    "jsonrpc": "2.0",
    "id": "prompt-1",
    "method": "prompts/get",
    "params": {
        "name": "analyze_code",
        "arguments": {
            "language": "python",
            "style": "detailed"
        }
    }
}
```

**响应**：
```json
{
    "jsonrpc": "2.0",
    "id": "prompt-1",
    "result": {
        "description": "Analyze Python code in detail",
        "messages": [
            {
                "role": "user",
                "content": {
                    "type": "text",
                    "text": "Please analyze the following Python code in detail..."
                }
            }
        ]
    }
}
```

---

## 七、Sampling 采样机制

### 7.1 概述

Sampling 允许 MCP Server 请求 Client 调用 LLM 进行文本生成。这是 Server 向 Client 发起的请求。

### 7.2 采样请求

**Server → Client 请求**：
```json
{
    "jsonrpc": "2.0",
    "id": "sampling-1",
    "method": "sampling/createMessage",
    "params": {
        "messages": [
            {
                "role": "user",
                "content": {
                    "type": "text",
                    "text": "What is the capital of France?"
                }
            }
        ],
        "modelPreferences": {
            "hints": [
                {
                    "name": "claude-3-sonnet"
                }
            ],
            "intelligencePriority": 0.8,
            "speedPriority": 0.5
        },
        "systemPrompt": "You are a helpful assistant.",
        "maxTokens": 1000,
        "temperature": 0.7
    }
}
```

### 7.3 采样响应

```json
{
    "jsonrpc": "2.0",
    "id": "sampling-1",
    "result": {
        "role": "assistant",
        "content": {
            "type": "text",
            "text": "The capital of France is Paris."
        },
        "model": "claude-3-sonnet-20240229",
        "stopReason": "endTurn"
    }
}
```

---

## 八、Elicitation 用户交互机制

### 8.1 概述

Elicitation 允许 Server 通过 Client 界面向用户请求额外信息或确认。

### 8.2 用户输入请求

```json
{
    "jsonrpc": "2.0",
    "id": "elicit-1",
    "method": "elicitation/create",
    "params": {
        "message": "Please provide your API key for authentication:",
        "requestedSchema": {
            "type": "object",
            "properties": {
                "apiKey": {
                    "type": "string",
                    "description": "Your API key",
                    "format": "password"
                }
            },
            "required": ["apiKey"]
        }
    }
}
```

### 8.3 用户响应

```json
{
    "jsonrpc": "2.0",
    "id": "elicit-1",
    "result": {
        "action": "accept",
        "content": {
            "apiKey": "sk-xxxxx"
        }
    }
}
```

---

## 九、传输层协议

### 9.1 Stdio 传输

**特点**：
- 通过标准输入/输出通信
- 适用于本地进程通信
- 最基础的传输方式

**配置示例**：
```json
{
    "transport": "stdio",
    "command": "python",
    "args": ["/path/to/server.py"],
    "env": {
        "DEBUG": "1"
    }
}
```

**消息格式**：
- 每条消息以换行符分隔
- 消息内容为JSON字符串

### 9.2 SSE (Server-Sent Events) 传输

**特点**：
- 基于HTTP的单向推送
- 服务器可主动推送消息
- 适用于远程服务

**配置示例**：
```json
{
    "transport": "sse",
    "url": "http://localhost:8080/sse",
    "headers": {
        "Authorization": "Bearer token"
    },
    "reconnect": true,
    "retry_interval": 5,
    "max_retries": 3
}
```

### 9.3 Streamable HTTP 传输

**特点**：
- 基于HTTP的双向通信
- 支持多客户端同时连接
- 可部署为Web服务

**配置示例**：
```json
{
    "transport": "http",
    "url": "http://localhost:8080/mcp",
    "headers": {
        "Authorization": "Bearer token"
    },
    "timeout": 30,
    "session_id": "optional-session-id"
}
```

### 9.4 传输方式对比

| 特性 | Stdio | SSE | Streamable HTTP |
|------|-------|-----|-----------------|
| **部署位置** | 本地 | 远程 | 远程 |
| **客户端数量** | 单个 | 多个 | 多个 |
| **复杂度** | 低 | 中 | 中 |
| **实时推送** | 否 | 是 | 是 |
| **双向通信** | 是 | 有限 | 是 |
| **推荐场景** | 本地工具 | 远程服务 | Web服务 |

---

## 十、安全性机制

### 10.1 OAuth 2.1 认证

MCP 2025-03-26 版本支持完整的 OAuth 2.1 流程：

```
┌─────────────┐                              ┌─────────────┐
│   Client    │                              │   Server    │
└──────┬──────┘                              └──────┬──────┘
       │                                            │
       │  ──────── Authorization Request ────────► │
       │  (重定向到授权服务器)                       │
       │                                            │
       │  ◄─────── Authorization Code ──────────── │
       │  (用户授权后回调)                           │
       │                                            │
       │  ──────── Token Request ────────────────► │
       │  (使用授权码换取访问令牌)                    │
       │                                            │
       │  ◄─────── Access Token ────────────────── │
       │                                            │
       │  ──────── API Request with Token ────────► │
       │  (使用访问令牌调用API)                       │
```

### 10.2 安全最佳实践

| 实践 | 描述 |
|------|------|
| **输入验证** | 使用JSON Schema验证所有输入 |
| **路径清理** | 防止目录遍历攻击 |
| **DNS重绑定保护** | 验证Origin头，绑定127.0.0.1 |
| **敏感数据保护** | API密钥存储在环境变量中 |
| **错误处理** | 不暴露内部实现细节 |

---

## 十一、项目MCP实现分析

### 11.1 架构概览

本项目实现了一个完整的MCP管理服务，独立部署于端口 **8992**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MCP Service (FastAPI :8992)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          API Layer (routes.py)                       │   │
│  │  • /api/v1/mcp/servers        • /api/v1/mcp/servers/{id}/tools      │   │
│  │  • /api/v1/mcp/servers/{id}   • /api/v1/mcp/tools/all               │   │
│  │  • /api/v1/mcp/servers/create/python  • /api/v1/mcp/servers/{id}/connect │
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
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 核心模块分析

#### 11.2.1 服务注册中心 (registry.py)

**核心类**：
- `ServerStatus`: 服务器状态枚举
- `MCPServerInfo`: 服务器信息数据类
- `ServiceRegistry`: 服务注册中心

**关键方法**：
```python
class ServiceRegistry:
    async def register(server_info: MCPServerInfo) -> None
    async def unregister(server_id: str) -> bool
    async def get_server(server_id: str) -> Optional[MCPServerInfo]
    async def get_servers_by_user(user_id: str) -> List[MCPServerInfo]
    async def update_status(server_id: str, status: ServerStatus) -> bool
```

#### 11.2.2 生命周期管理器 (lifecycle.py)

**核心职责**：
- 注册 → 创建Client → 连接Server → 注册网关路由
- 注销 → 断开连接 → 销毁Client → 注销网关路由

**关键方法**：
```python
class LifecycleManager:
    async def register_and_connect(server_info: MCPServerInfo) -> bool
    async def connect(server_id: str) -> bool
    async def disconnect(server_id: str) -> bool
    async def get_client(server_id: str) -> Optional[BaseClient]
    async def disconnect_all() -> None
```

#### 11.2.3 统一调用接口 (caller.py)

**关键方法**：
```python
class UnifiedCaller:
    async def call(server_id: str, tool_name: str, params: Dict) -> Dict
    async def list_tools(server_id: str) -> List[Dict]
    async def list_servers(user_id: str) -> List[Dict]
    async def list_all_tools(user_id: str) -> List[Dict]
    async def get_resources(server_id: str) -> List[Dict]
    async def get_prompts(server_id: str) -> List[Dict]
```

#### 11.2.4 客户端实现

**BaseClient 基类**：
```python
class BaseClient(ABC):
    async def connect() -> None
    async def disconnect() -> None
    async def get_tools() -> List[Dict]
    async def call_tool(tool_name: str, arguments: Dict) -> Dict
    async def read_resource(uri: str) -> Dict
    async def get_prompt(name: str, arguments: Dict) -> Dict
```

**StdioClient**：
- 通过标准输入/输出与本地MCP服务器进程通信
- 使用MCP SDK的 `stdio_client` 和 `ClientSession`

**SSEClient**：
- 通过Server-Sent Events与远程MCP服务器通信
- 支持自定义HTTP Headers

**HTTPClient**：
- 通过Streamable HTTP与远程MCP服务器通信
- 支持双向数据流

### 11.3 数据库设计

**主表+子表架构**：

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

### 11.4 API端点设计

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/mcp/servers` | 获取服务器列表 |
| POST | `/api/v1/mcp/servers` | 添加服务器 |
| GET | `/api/v1/mcp/servers/{id}` | 获取服务器详情 |
| PUT | `/api/v1/mcp/servers/{id}` | 更新服务器配置 |
| DELETE | `/api/v1/mcp/servers/{id}` | 删除服务器 |
| POST | `/api/v1/mcp/servers/create/python` | 创建Python MCP |
| POST | `/api/v1/mcp/servers/create/stdio` | 创建Stdio MCP |
| POST | `/api/v1/mcp/servers/create/http` | 创建HTTP MCP |
| POST | `/api/v1/mcp/servers/create/sse` | 创建SSE MCP |
| POST | `/api/v1/mcp/servers/{id}/connect` | 连接服务器 |
| POST | `/api/v1/mcp/servers/{id}/disconnect` | 断开服务器 |
| GET | `/api/v1/mcp/servers/{id}/tools` | 获取工具列表 |
| POST | `/api/v1/mcp/servers/{id}/tools/{name}/call` | 调用工具 |
| GET | `/api/v1/mcp/tools/all` | 获取所有工具 |
| GET | `/api/v1/mcp/servers/{id}/resources` | 获取资源列表 |
| GET | `/api/v1/mcp/servers/{id}/prompts` | 获取提示词列表 |

### 11.5 SoloAgent集成

**IMCPClient接口**：
```python
class IMCPClient(ABC):
    async def connect() -> None
    async def disconnect() -> None
    async def get_tools() -> List[dict]
    async def call_tool(tool_name: str, arguments: dict) -> dict
```

**MCPClient实现**：
- 支持三种传输协议
- 使用官方MCP Python SDK
- 提供MCPClientManager管理多个连接

---

## 十二、最佳实践总结

### 12.1 工具命名规范

| 规范 | 示例 |
|------|------|
| 使用snake_case | `search_users`, `create_project` |
| 包含服务前缀 | `slack_send_message`, `github_create_issue` |
| 动作导向 | `get_`, `list_`, `search_`, `create_`, `update_`, `delete_` |

### 12.2 响应格式

**支持多种格式**：
- **JSON**: 机器可读，适合程序处理
- **Markdown**: 人类可读，适合直接展示

**分页支持**：
```json
{
    "total": 150,
    "count": 20,
    "offset": 0,
    "items": [...],
    "has_more": true,
    "next_offset": 20
}
```

### 12.3 错误处理

- 使用标准JSON-RPC错误代码
- 在result对象中报告工具错误
- 提供清晰、可操作的错误信息
- 不暴露内部实现细节

### 12.4 安全建议

- 使用OAuth 2.1进行认证
- 验证所有输入参数
- 清理文件路径防止目录遍历
- API密钥存储在环境变量中
- 启用DNS重绑定保护

---

## 十三、附录

### 13.1 协议版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| 2024-11-05 | 2024-11 | 初始版本 |
| 2025-03-26 | 2025-03 | Streamable HTTP、Elicitation、OAuth 2.1 |

### 13.2 参考资源

- [MCP官方规范](https://modelcontextprotocol.io/specification/)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [FastMCP文档](https://github.com/modelcontextprotocol/python-sdk/blob/main/README.md)

### 13.3 项目文件索引

| 文件 | 描述 |
|------|------|
| `backend/mcp_service/main.py` | MCP服务主入口 |
| `backend/mcp_service/config.py` | 配置文件 |
| `backend/mcp_service/routes.py` | API路由 |
| `backend/mcp_service/gateway.py` | 网关路由管理 |
| `backend/mcp_service/database.py` | 数据库模型 |
| `backend/mcp_service/host/registry.py` | 服务注册中心 |
| `backend/mcp_service/host/lifecycle.py` | 生命周期管理 |
| `backend/mcp_service/host/caller.py` | 统一调用接口 |
| `backend/mcp_service/clients/base.py` | 客户端基类 |
| `backend/mcp_service/clients/factory.py` | 客户端工厂 |
| `backend/mcp_service/clients/stdio_client.py` | Stdio客户端 |
| `backend/mcp_service/clients/sse_client.py` | SSE客户端 |
| `backend/mcp_service/clients/http_client.py` | HTTP客户端 |
| `backend/SoloAgent/plugins/mcp/mcp_client.py` | SoloAgent MCP客户端 |
| `backend/app/core/mcp_service_builder.py` | MCP服务构建器 |
| `frontend/src/services/mcpApi.ts` | 前端API服务 |
| `frontend/src/store/mcpStore.ts` | 前端状态管理 |

---

**文档版本**: 1.0.0  
**最后更新**: 2025-03-25  
**作者**: SoloEngine Team
