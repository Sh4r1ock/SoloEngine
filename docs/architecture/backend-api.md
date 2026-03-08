# SoloEngine 后端 API 文档

## 1. 模块概述

SoloEngine 后端是基于 FastAPI 构建的 RESTful API 服务，提供用户认证、项目管理、Agent 执行等核心功能。

### 服务架构

SoloEngine 采用**三服务架构**：

| 服务 | 端口 | 描述 |
|------|------|------|
| **主 API 服务** | 8990 | 核心 RESTful API，包含用户认证、项目管理、LLM 配置、Skills 管理、运行执行等功能 |
| **前端服务** | 8991 | React 前端开发服务器，代理 API 请求到 8990 |
| **MCP 服务** | 8992 | 独立的模型上下文协议服务，提供 MCP 服务器的插件化管理和工具调用 |

**重要说明**：MCP 服务是一个**独立的服务进程**，不包含在主 API 服务中。MCP 相关的 API 文档请参考 [mcp-service.md](./mcp-service.md)。

## 2. 设计理念

### RESTful 设计
- 资源导向的 API 设计，每个端点对应一种资源或操作
- 使用标准 HTTP 方法 (GET, POST, PUT, DELETE)
- 统一的响应格式，包含 `code`, `message`, `data` 字段

### 认证设计
- **JWT 令牌认证**: 使用 Bearer Token 方式传递访问令牌
- **双令牌机制**: Access Token (30分钟过期) + Refresh Token (7天过期)
- **用户数据隔离**: 所有用户相关数据通过 `user_id` 关联，确保数据隔离

### 数据隔离设计
- 用户级别的数据隔离
- 所有业务数据通过 `user_id` 字段关联
- 乐观锁机制: 使用 `version` 字段实现并发控制

## 3. 实现方式

### FastAPI 路由
路由按功能模块分组：

| 路由前缀 | 模块文件 | 功能描述 |
|----------|----------|----------|
| `/api/v1/auth` | auth.py | 用户认证 |
| `/api/v1/llm` | config.py | LLM 配置 |
| `/api/v1/projects` | projects.py | 项目管理 |
| `/api/v1/skills` | skills.py | Skills 包管理 |
| `/api/v1/tools` | tools.py | 工具管理 |
| `/api/v1/run` | run.py | 运行执行 |
| `/api/v1/export` | export.py | 导出导入 |
| `/api/v1/package` | package.py | 项目打包 |
| `/api/v1/history` | history.py | 执行历史 |
| `/api/v1/marketplace` | marketplace.py | 开放市场 |
| `/api/v1/agentic-flows` | agentic_flows.py | 工作流管理 |
| `/api/v1/agent-tools` | agent_tools.py | Agent 工具 |
| `/api/v1/run-project` | run_project.py | 运行项目 |
| `/api/v1/ws/{task_id}` | websocket.py | WebSocket 通信 |

### 中间件
- CORS 中间件
- 认证中间件
- 速率限制中间件

### 依赖注入
- SQLAlchemy Session 依赖注入
- 用户认证依赖注入

### SQLAlchemy ORM
- 数据库: SQLite (文件: `data/database/soloengine.db`)
- 模型定义: 用户、工作流、LLM配置、记忆、Skills包、项目等
- 关系映射: 用户-工作流、项目-Skills 等

### JWT 认证
- 令牌生成: 使用 PyJWT 库生成 JWT 令牌
- 令牌验证: 解码验证令牌有效性和过期时间
- 用户加载: 从数据库加载用户信息验证权限

### 加密服务
- API Key 加密: 使用 AES-GCM 加密敏感数据
- 密码哈希: 使用 Argon2 算法

## 4. 组件和库

| 组件/库 | 版本 | 用途 |
|---------|------|------|
| FastAPI | 0.100+ | Web 框架，构建 RESTful API |
| SQLAlchemy | 2.0+ | ORM 框架，数据库模型和关系映射 |
| PyJWT | 2.0+ | JWT 令牌生成和验证 |
| cryptography | 42.0+ | 加密服务，API Key 加密 |
| pwdlib | 1.0+ | 密码哈希，使用 Argon2 算法 |
| slowapi | 0.1.9 | API 速率限制，防止滥用 |
| httpx | - | HTTP 客户端，用于调用外部 API |
| pydantic | 2.0+ | 数据验证和序列化 |
| uvicorn | 0.20+ | ASGI 服务器 |
| playwright | - | 浏览器自动化 (可选) |
| python-multipart | - | 文件上传处理 |

## 5. 接口附录

### 5.1 认证 API
**基础路径**: `/api/v1/auth`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/register` | 注册新用户 | 否 |
| POST | `/login` | 用户登录 | 否 |
| POST | `/refresh` | 刷新令牌 | 否 |
| GET | `/me` | 获取当前用户信息 | 是 |
| PUT | `/me` | 更新当前用户信息 | 是 |
| GET | `/users` | 列出所有用户 (超级用户) | 是 |
| DELETE | `/users/{user_id}` | 删除用户 (超级用户) | 是 |

#### POST /api/v1/auth/register
注册新用户账号。

**请求体**:
```json
{
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123"
}
```

**响应**:
```json
{
    "code": 200,
    "message": "User registered successfully",
    "data": {
        "id": "uuid-string",
        "username": "testuser",
        "email": "test@example.com",
        "is_active": true,
        "is_superuser": false
    }
}
```

#### POST /api/v1/auth/login
用户登录，获取访问令牌。

**请求体**:
```json
{
    "username": "testuser",
    "password": "password123"
}
```

**响应**:
```json
{
    "code": 200,
    "message": "Login successful",
    "data": {
        "access_token": "eyJ...",
        "refresh_token": "eyJ...",
        "token_type": "bearer",
        "expires_in": 1800
    }
}
```

#### POST /api/v1/auth/refresh
刷新访问令牌。

**请求体**:
```json
{
    "refresh_token": "eyJ..."
}
```

**响应**:
```json
{
    "code": 200,
    "message": "Token refreshed",
    "data": {
        "access_token": "eyJ...",
        "refresh_token": "eyJ...",
        "token_type": "bearer",
        "expires_in": 1800
    }
}
```

---

### 5.2 LLM 配置 API
**基础路径**: `/api/v1/llm`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/providers` | 获取所有 LLM 提供商 | 否 |
| GET | `/providers/{provider}/models` | 获取提供商支持的模型列表 | 否 |
| GET | `/configs` | 获取用户的所有 LLM 配置 | 是 |
| GET | `/configs/{config_id}` | 获取指定的 LLM 配置 | 是 |
| GET | `/configs/default` | 获取用户的默认 LLM 配置 | 是 |
| POST | `/configs` | 创建 LLM 配置 | 是 |
| PUT | `/configs/{config_id}` | 更新 LLM 配置 | 是 |
| DELETE | `/configs/{config_id}` | 删除 LLM 配置 | 是 |
| POST | `/configs/{config_id}/set-default` | 设置默认配置 | 是 |
| POST | `/test` | 测试 LLM 配置 | 否 |
| GET | `/usage` | 获取使用统计 | 是 |
| GET | `/usage/daily` | 获取每日使用统计 | 是 |
| GET | `/usage/recent` | 获取最近使用记录 | 是 |
| GET | `/usage/export` | 导出使用数据 | 是 |
| DELETE | `/usage` | 清除旧使用记录 | 是 |

#### GET /api/v1/llm/providers
获取所有支持的 LLM 提供商列表。

**响应**:
```json
{
    "code": 200,
    "message": "success",
    "data": [
        {
            "name": "openai",
            "display_name": "OpenAI",
            "requires_api_key": true,
            "default_model": "gpt-4o-mini",
            "models": ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]
        },
        {
            "name": "anthropic",
            "display_name": "Anthropic Claude",
            "requires_api_key": true,
            "default_model": "claude-3-5-sonnet-20241022",
            "models": ["claude-3-5-sonnet-20241022", "claude-sonnet-4-20250514"]
        },
        {
            "name": "qwen",
            "display_name": "通义千问 (Qwen)",
            "requires_api_key": true,
            "default_model": "qwen-turbo",
            "models": ["qwen-turbo", "qwen-plus", "qwen-max"]
        },
        {
            "name": "ollama",
            "display_name": "Ollama (本地)",
            "requires_api_key": false,
            "default_model": "llama3.2",
            "models": ["llama3.2", "llama2", "mistral"]
        }
    ]
}
```

#### POST /api/v1/llm/configs
创建新的 LLM 配置。

**请求体**:
```json
{
    "name": "我的 GPT-4 配置",
    "provider": "openai",
    "model_name": "gpt-4o",
    "api_key": "sk-xxx",
    "temperature": 0.7,
    "max_tokens": 4096,
    "is_default": true
}
```

**响应**:
```json
{
    "code": 200,
    "message": "LLM config created successfully",
    "data": {
        "id": "uuid-string",
        "name": "我的 GPT-4 配置",
        "provider": "openai",
        "model_name": "gpt-4o",
        "is_default": true
    }
}
```

---

### 5.3 项目管理 API
**基础路径**: `/api/v1/projects`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `` | 获取用户的所有项目 | 是 |
| POST | `` | 创建新项目 | 是 |
| GET | `/{project_id}` | 获取项目详情 | 是 |
| PUT | `/{project_id}` | 更新项目信息 | 是 |
| DELETE | `/{project_id}` | 删除项目 | 是 |
| GET | `/{project_id}/canvas` | 获取画布数据 | 是 |
| PUT | `/{project_id}/canvas` | 保存画布数据 | 是 |
| POST | `/{project_id}/run` | 运行项目 | 是 |

#### POST /api/v1/projects
创建新项目。

**查询参数**:
- `name` (必填): 项目名称
- `description` (可选): 项目描述

**响应**:
```json
{
    "code": 201,
    "message": "created",
    "data": {
        "id": "uuid-string",
        "user_id": "user-uuid",
        "name": "我的项目",
        "description": "项目描述",
        "canvas": {"nodes": [], "edges": []},
        "version": 1,
        "created_at": "2024-01-01T00:00:00"
    }
}
```

#### GET /api/v1/projects/{project_id}/canvas
获取项目的画布数据。

**响应**:
```json
{
    "code": 200,
    "message": "success",
    "data": {
        "id": "project-uuid",
        "name": "我的项目",
        "canvas": {
            "nodes": [
                {
                    "id": "node-1",
                    "type": "agent",
                    "position": {"x": 100, "y": 100},
                    "data": {"name": "Agent 1"}
                }
            ],
            "edges": [
                {
                    "id": "edge-1",
                    "source": "node-1",
                    "target": "node-2"
                }
            ]
        },
        "version": 1
    }
}
```

---

### 5.4 Skills API
**基础路径**: `/api/v1/skills`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/packages` | 获取所有 Skills 包 | 是 |
| GET | `/packages/{package_id}` | 获取 Skills 包详情 | 是 |
| POST | `/packages` | 创建 Skills 包 | 是 |
| PUT | `/packages/{package_id}` | 更新 Skills 包 | 是 |
| DELETE | `/packages/{package_id}` | 删除 Skills 包 | 是 |
| POST | `/import` | 导入 Skills 包 | 是 |
| GET | `/packages/{package_id}/export` | 导出 Skills 包 | 是 |
| POST | `/search` | 搜索 Skills 包 | 是 |
| POST | `/packages/{package_id}/activate` | 激活 Skills 包 | 是 |
| POST | `/packages/{package_id}/deactivate` | 停用 Skills 包 | 是 |
| GET | `/packages/{package_id}/files` | 获取文件树 | 是 |
| GET | `/packages/{package_id}/files/content` | 获取文件内容 | 是 |
| POST | `/packages/{package_id}/files/save` | 保存文件 | 是 |
| POST | `/packages/{package_id}/files/create` | 创建文件/文件夹 | 是 |
| POST | `/packages/{package_id}/files/delete` | 删除文件/文件夹 | 是 |
| GET | `/packages/{package_id}/skills/{skill_name}` | 获取技能内容 | 是 |
| POST | `/prompt` | 生成提示词 | 是 |

#### POST /api/v1/skills/packages
创建新的 Skills 包。

**请求体**:
```json
{
    "name": "my-skills",
    "description": "我的技能包",
    "author": "开发者",
    "tags": ["automation", "productivity"],
    "pkg_version": "1.0.0"
}
```

**响应**:
```json
{
    "code": 200,
    "message": "Skills package created",
    "data": {
        "id": "uuid-string",
        "name": "my-skills",
        "pkg_version": "1.0.0",
        "description": "我的技能包",
        "author": "开发者",
        "tags": ["automation", "productivity"],
        "folder_path": "/path/to/skills/my-skills"
    }
}
```

---

### 5.5 工具管理 API
**基础路径**: `/api/v1/tools`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `` | 获取所有可用工具 | 是 |
| GET | `/{tool_name}` | 获取指定工具信息 | 是 |
| POST | `` | 注册工具 | 是 |
| DELETE | `/{tool_name}` | 注销工具 | 是 |
| POST | `/{tool_name}/call` | 调用工具 | 是 |

#### GET /api/v1/tools
获取所有可用工具。

**响应**:
```json
{
    "code": 200,
    "message": "success",
    "data": [
        {
            "name": "web_search",
            "description": "搜索网页内容",
            "parameters": {...},
            "tool_type": "python"
        }
    ]
}
```

#### POST /api/v1/tools/{tool_name}/call
调用工具。

**请求体**:
```json
{
    "arguments": {
        "query": "搜索关键词"
    }
}
```

**响应**:
```json
{
    "code": 200,
    "message": "Tool executed successfully",
    "data": {
        "tool_name": "web_search",
        "result": "搜索结果..."
    }
}
```

---

### 5.6 Run API
**基础路径**: `/api/v1/run`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/execute` | 执行 JSON 工作流 | 是 |
| POST | `/execute-node` | 执行单个节点 | 是 |
| GET | `/sessions` | 获取运行会话列表 | 是 |
| GET | `/sessions/{session_id}` | 获取会话详情 | 是 |
| GET | `/sessions/{session_id}/steps` | 获取会话执行步骤 | 是 |
| GET | `/sessions/{session_id}/tools` | 获取会话工具调用 | 是 |
| GET | `/sessions/{session_id}/export` | 导出会话数据 | 是 |
| WebSocket | `/ws/{session_id}` | WebSocket 实时通信 | 是 |

#### POST /api/v1/run/execute
执行 JSON 格式的工作流。

**请求体**:
```json
{
    "canvas_data": {
        "nodes": [...],
        "edges": [...]
    },
    "input_message": "帮我分析这段代码",
    "project_name": "代码分析"
}
```

**响应**:
```json
{
    "code": 200,
    "message": "Agentic executed",
    "data": {
        "status": "completed",
        "output": "分析结果...",
        "duration_ms": 1500
    }
}
```

---

### 5.7 导出 API
**基础路径**: `/api/v1/export`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/project/{project_name}` | 导出项目 | 是 |
| POST | `/import` | 导入项目 | 是 |
| GET | `/formats` | 获取支持的导出格式 | 否 |

#### POST /api/v1/export/project/{project_name}
导出项目为 JSON 或 ZIP 格式。

**查询参数**:
- `format`: 导出格式 (json/zip)
- `include_history`: 是否包含执行历史
- `include_skills`: 是否包含 Skills 包

**响应**: 返回文件下载 (JSON 或 ZIP)

---

### 5.8 打包 API
**基础路径**: `/api/v1/package`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/create` | 创建包 | 是 |
| GET | `/list` | 列出所有包 | 是 |
| GET | `/{package_name}` | 获取包信息 | 是 |
| GET | `/{package_name}/download` | 下载包 | 是 |
| DELETE | `/{package_name}` | 删除包 | 是 |

#### POST /api/v1/package/create
创建可部署包。

**请求体**:
```json
{
    "project_name": "my-project",
    "name": "my-package",
    "version": "1.0.0",
    "description": "项目打包",
    "author": "开发者",
    "entry_point": "main",
    "runtime": "python",
    "dependencies": ["fastapi", "sqlalchemy"],
    "environment_vars": {"API_KEY": "xxx"}
}
```

**响应**:
```json
{
    "success": true,
    "package_path": "/path/to/package.zip",
    "files_count": 25,
    "size_bytes": 102400
}
```

---

### 5.9 历史 API
**基础路径**: `/api/v1/history`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/create` | 创建执行记录 | 是 |
| POST | `/{execution_id}/start` | 开始执行 | 是 |
| POST | `/{execution_id}/complete` | 完成执行 | 是 |
| POST | `/{execution_id}/fail` | 执行失败 | 是 |
| POST | `/{execution_id}/steps` | 添加执行步骤 | 是 |
| POST | `/{execution_id}/steps/{step_id}/complete` | 完成执行步骤 | 是 |
| POST | `/{execution_id}/tool-calls` | 添加工具调用记录 | 是 |
| GET | `/list` | 列出执行记录 | 是 |
| GET | `/{execution_id}` | 获取执行记录 | 是 |
| DELETE | `/{execution_id}` | 删除执行记录 | 是 |
| DELETE | `/clear` | 清除旧记录 | 是 |
| GET | `/statistics` | 获取执行统计 | 是 |
| GET | `/{execution_id}/export` | 导出执行记录 | 是 |

---

### 5.10 市场 API
**基础路径**: `/api/v1/marketplace`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `/mcp` | 获取 MCP 市场列表 | 否 |
| GET | `/mcp/{item_id}` | 获取 MCP 市场项目详情 | 否 |
| GET | `/skills` | 获取 Skills 市场列表 | 否 |
| GET | `/skills/{item_id}` | 获取 Skills 市场项目详情 | 否 |
| POST | `/mcp/{item_id}/install` | 安装 MCP 市场项目 | 是 |
| POST | `/skills/{item_id}/install` | 安装 Skills 市场项目 | 是 |
| GET | `/featured` | 获取精选项目 | 否 |
| GET | `/stats` | 获取市场统计 | 否 |
| GET | `/cache/stats` | 获取缓存统计 | 否 |
| POST | `/cache/clear` | 清除缓存 | 否 |

#### GET /api/v1/marketplace/mcp
获取 MCP 市场列表。

**查询参数**:
- `category`: 分类过滤
- `search`: 搜索关键词
- `sort_by`: 排序字段 (downloads/rating/name)

**响应**:
```json
{
    "code": 200,
    "message": "MCP market items retrieved",
    "data": {
        "items": [
            {
                "id": "filesystem",
                "name": "Filesystem MCP",
                "description": "文件系统操作工具",
                "author": "ModelContextProtocol",
                "category": "file",
                "tags": ["file", "filesystem"],
                "downloads": 15000,
                "rating": 4.8,
                "verified": true
            }
        ],
        "categories": [...],
        "total": 10
    }
}
```

---

### 5.11 Agentic Flows API
**基础路径**: `/api/v1/agentic-flows`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| GET | `` | 获取所有工作流 | 是 |
| POST | `` | 创建工作流 | 是 |
| GET | `/{flow_id}` | 获取工作流详情 | 是 |
| PUT | `/{flow_id}` | 更新工作流 | 是 |
| DELETE | `/{flow_id}` | 删除工作流 | 是 |
| GET | `/{flow_id}/canvas` | 获取画布数据 | 是 |
| PUT | `/{flow_id}/canvas` | 保存画布数据 | 是 |
| GET | `/{flow_id}/runs` | 获取运行历史 | 是 |
| POST | `/{flow_id}/run` | 运行工作流 | 是 |

#### POST /api/v1/agentic-flows
创建新的 AgenticFlow。

**请求体**:
```json
{
    "name": "我的工作流",
    "description": "工作流描述",
    "canvas_data": {
        "nodes": [],
        "edges": []
    }
}
```

**响应**:
```json
{
    "code": 200,
    "message": "AgenticFlow created",
    "data": {
        "id": "uuid-string",
        "user_id": "user-uuid",
        "name": "我的工作流",
        "description": "工作流描述",
        "canvas_data": {"nodes": [], "edges": []},
        "is_template": false,
        "is_active": true,
        "created_at": "2024-01-01T00:00:00"
    }
}
```

---

### 5.12 Agent Tools API
**基础路径**: `/api/v1/agent-tools`

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/llm/chat` | LLM 对话接口 | 是 |
| POST | `/browser/navigate` | 浏览器导航 | 是 |
| POST | `/browser/action` | 浏览器操作 | 是 |
| POST | `/document/read` | 文档读取 | 是 |
| POST | `/document/write` | 文档写入 | 是 |
| POST | `/document/search` | 文档搜索 | 是 |
| POST | `/document/summarize` | 文档摘要 | 是 |

#### POST /api/v1/agent-tools/llm/chat
LLM 对话接口，使用用户配置的模型进行对话。

**请求体**:
```json
{
    "message": "你好，请帮我分析这段代码",
    "config_id": "config-uuid",
    "model": "gpt-4o",
    "temperature": 0.7,
    "max_tokens": 2048,
    "system_prompt": "你是一个代码分析助手",
    "conversation_history": [
        {"role": "user", "content": "之前的问题"},
        {"role": "assistant", "content": "之前的回答"}
    ],
    "project_id": "project-uuid"
}
```

**响应**:
```json
{
    "code": 200,
    "message": "LLM响应已生成",
    "data": {
        "content": "这是我的分析结果...",
        "model": "gpt-4o",
        "provider": "openai",
        "config_id": "config-uuid",
        "config_name": "我的配置",
        "tokens_used": {
            "prompt_tokens": 150,
            "completion_tokens": 200,
            "total_tokens": 350
        },
        "finish_reason": "stop"
    }
}
```

---

### 5.13 Run Project API
**基础路径**: `/api/v1/run-project`

运行项目文件管理接口。

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/select-folder` | 选择项目文件夹 | 是 |
| GET | `/current` | 获取当前项目 | 是 |
| GET | `/recent` | 获取最近项目列表 | 是 |
| POST | `/switch/{project_id}` | 切换项目 | 是 |
| POST | `/files/list` | 列出项目文件 | 是 |
| POST | `/files/read` | 读取项目文件 | 是 |
| POST | `/files/write` | 写入项目文件 | 是 |
| DELETE | `/files/delete` | 删除文件或目录 | 是 |
| POST | `/files/mkdir` | 创建目录 | 是 |
| GET | `/files/info` | 获取文件信息 | 是 |
| GET | `/files/exists` | 检查文件是否存在 | 是 |
| GET | `/workspace-roots` | 获取工作区根目录 | 否 |
| GET | `/browse` | 浏览目录内容 | 是 |
| GET | `/native-folder-dialog` | 打开原生文件夹选择对话框 | 是 |

#### POST /api/v1/run-project/select-folder
选择项目文件夹。

**请求体**:
```json
{
    "folder_path": "D:/Projects/my-project"
}
```

**响应**:
```json
{
    "code": 200,
    "message": "Project selected successfully",
    "data": {
        "project_id": "uuid-string",
        "project_name": "my-project",
        "folder_path": "D:/Projects/my-project",
        "is_new": true,
        "recent_projects": [...]
    }
}
```

---

### 5.14 WebSocket 端点
**端点**: `/api/v1/ws/{task_id}`

用于实时工作流执行通信。

**连接方式**:
```
ws://host/api/v1/ws/{task_id}?token={jwt_token}
```

**客户端发送消息格式**:
```json
{
    "type": "execution-start",
    "project_id": "project-uuid",
    "input": "用户输入"
}
```

**服务端推送事件类型**:

| 事件类型 | 描述 |
|---------|------|
| `execution-start` | 开始执行工作流 |
| `agent-update` | Agent 状态更新 |
| `tool-call` | 工具调用事件 |
| `response-streaming` | 响应流式输出 |
| `execution-complete` | 执行完成 |
| `error` | 错误事件 |

**服务端推送消息格式**:
```json
{
    "type": "agent-update",
    "node_id": "node-1",
    "status": "running",
    "message": "正在处理..."
}
```

---

## 6. 数据模型

### 6.1 UserModel
用户模型。

| 字段 | 类型 | 描述 |
|------|------|------|
| id | String(36) | 主键 UUID |
| username | String(255) | 用户名，唯一 |
| email | String(255) | 邮箱，唯一 |
| hashed_password | String(255) | 哈希密码 |
| is_active | Boolean | 是否激活 |
| is_superuser | Boolean | 是否超级用户 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |
| last_login | DateTime | 最后登录时间 |
| version | Integer | 乐观锁版本号 |

### 6.2 AgenticFlowModel
工作流模型。

| 字段 | 类型 | 描述 |
|------|------|------|
| id | String(36) | 主键 UUID |
| user_id | String(36) | 用户 ID 外键 |
| name | String(255) | 工作流名称 |
| description | Text | 描述 |
| canvas_data | JSON | 画布数据 |
| is_template | Boolean | 是否模板 |
| is_active | Boolean | 是否激活 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |
| version | Integer | 乐观锁版本号 |

### 6.3 LLMConfigModel
LLM 配置模型。

| 字段 | 类型 | 描述 |
|------|------|------|
| id | String(36) | 主键 UUID |
| user_id | String(36) | 用户 ID 外键 |
| name | String(255) | 配置名称 |
| provider | String(50) | 提供商 (openai/anthropic/qwen/ollama) |
| model_name | String(255) | 模型名称 |
| api_key | Text | 加密的 API 密钥 |
| base_url | String(500) | 自定义 API 地址 |
| temperature | Float | 温度参数 (0-2) |
| max_tokens | Integer | 最大 Token 数 |
| top_p | Float | Top P 参数 (0-1) |
| frequency_penalty | Float | 频率惩罚 (-2 - 2) |
| presence_penalty | Float | 存在惩罚 (-2 - 2) |
| timeout | Integer | 超时时间 (秒) |
| extra_params | JSON | 额外参数 |
| is_default | Boolean | 是否默认 |
| is_active | Boolean | 是否激活 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |
| version | Integer | 乐观锁版本号 |

### 6.4 AgentMemoryModel
Agent 记忆模型。

| 字段 | 类型 | 描述 |
|------|------|------|
| id | String(36) | 主键 UUID |
| agent_id | String(36) | Agent ID 外键 |
| user_id | String(36) | 用户 ID 外键 |
| agentic_flow_id | String(36) | 工作流 ID 外键 |
| run_id | String(36) | 运行记录 ID 外键 |
| run_project_id | String(36) | 运行项目 ID 外键 |
| role | String(50) | 角色 (user/assistant/system) |
| content | Text | 内容 |
| embedding_hash | String(64) | 嵌入哈希 |
| meta_data | JSON | 元数据 |
| created_at | DateTime | 创建时间 |
| version | Integer | 乐观锁版本号 |

### 6.5 SkillsPackageModel
Skills 包模型。

| 字段 | 类型 | 描述 |
|------|------|------|
| id | String(36) | 主键 UUID |
| user_id | String(36) | 用户 ID 外键 |
| name | String(255) | 包名称 |
| pkg_version | String(50) | 包版本 |
| description | Text | 描述 |
| author | String(255) | 作者 (system 表示系统包) |
| tags | JSON | 标签列表 |
| instructions | Text | 使用说明 |
| folder_path | String(500) | 文件夹路径 |
| is_active | Boolean | 是否激活 |
| is_public | Boolean | 是否公开 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |
| version | Integer | 乐观锁版本号 |

### 6.6 ProjectModel
项目模型。

| 字段 | 类型 | 描述 |
|------|------|------|
| id | String(36) | 主键 UUID |
| user_id | String(36) | 用户 ID 外键 |
| name | String(255) | 项目名称 |
| description | Text | 描述 |
| canvas_data | JSON | 画布数据 |
| is_active | Boolean | 是否激活 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |
| version | Integer | 乐观锁版本号 |

### 6.7 RunProjectModel
运行项目模型。

| 字段 | 类型 | 描述 |
|------|------|------|
| id | String(36) | 主键 UUID |
| user_id | String(36) | 用户 ID 外键 |
| name | String(255) | 项目名称 |
| folder_path | String(1000) | 文件夹路径 |
| description | Text | 描述 |
| is_active | Boolean | 是否激活 |
| last_accessed_at | DateTime | 最后访问时间 |
| created_at | DateTime | 创建时间 |
| updated_at | DateTime | 更新时间 |
| version | Integer | 乐观锁版本号 |

---

## 7. 错误处理

### 标准错误响应
```json
{
    "detail": "错误信息"
}
```

### HTTP 状态码

| 状态码 | 描述 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未授权 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 409 | 乐观锁冲突 |
| 413 | 请求实体过大 |
| 500 | 服务器内部错误 |

---

## 8. 安全考虑

### 认证安全
- JWT 令牌使用 HS256 算法签名
- 密码使用 Argon2 算法哈希
- API Key 使用 AES-GCM 加密存储

### 数据隔离
- 所有用户数据通过 `user_id` 关联
- 用户只能访问自己的数据

### 文件安全
- 文件路径验证防止目录遍历攻击
- 文件大小限制 (最大 50MB)

---

## 9. 独立服务说明

### MCP 服务
MCP (Model Context Protocol) 服务是一个**独立的服务进程**，运行在端口 8992。

- MCP 服务的 API 文档请参考 [mcp-service.md](./mcp-service.md)
- MCP 服务与主 API 服务通过 HTTP 通信
- MCP 服务提供模型上下文协议的插件化管理

### 服务间通信
- 主 API 服务 (8990) 可以调用 MCP 服务 (8992) 的工具
- 前端服务 (8991) 通过代理访问主 API 服务
