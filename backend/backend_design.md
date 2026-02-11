# 后端设计文档

## 整体架构

```
backend/
├── frontend_interaction/          # 前后端交互代码文件夹
│   ├── __init__.py
│   └── save_service/            # 保存相关代码文件夹
│       ├── __init__.py
│       ├── file_manager.py      # 文件管理
│       └── flow_saver.py       # 保存flow的逻辑
├── SoloAgent/                   # SoloAgent 核心框架
│   ├── assembly/               # 组装器模块
│   ├── core/                   # 核心接口和实现
│   ├── embedding/               # 嵌入模型
│   ├── exception/               # 异常处理
│   ├── formatter/               # 格式化器
│   ├── message/                # 消息处理
│   ├── model/                  # 模型相关
│   ├── plugins/                # 插件系统
│   ├── session/                # 会话管理
│   ├── token_counter/           # Token 计数
│   ├── tracing/                # 追踪
│   ├── tts/                    # 语音合成
│   ├── types/                  # 类型定义
│   └── utils/                  # 工具函数
├── app/                        # 应用层
│   ├── api/v1/                # API 接口
│   ├── core/                   # 核心业务逻辑
│   ├── models/                 # 数据模型
│   └── schemas/                # 请求/响应模式
├── app.py                      # 主应用（保存服务）
├── main.py                     # 主入口
└── requirements.txt             # 依赖列表
```

## 设计原则

1. **模块化设计**：每个模块职责单一，易于维护和扩展
2. **可扩展性**：通过插件系统支持功能扩展
3. **统一接口**：定义清晰的接口规范
4. **类型安全**：使用类型提示和 Pydantic 模型
5. **前后端分离**：frontend_interaction 专门处理前后端交互

---

## SoloAgent 核心框架

### 1. assembly/ - 组装器模块

**设计思路**：负责将各个组件组装成完整的 Agent

**主要功能**：
- 预设配置管理
- 动态组装 Agent
- 组件依赖管理

**核心文件**：
- `assembler.py` - 组装器实现
- `presets.py` - 预设配置

### 2. core/ - 核心接口和实现

**设计思路**：定义核心抽象接口，提供默认实现

**主要功能**：
- React 核心实现
- 接口定义
- 基础抽象类

**核心文件**：
- `interfaces.py` - 接口定义
- `react_core.py` - React 核心实现

### 3. embedding/ - 嵌入模型

**设计思路**：统一的嵌入模型接口，支持多种嵌入模型

**主要功能**：
- 嵌入计算
- 缓存管理
- 多模型支持（OpenAI、Ollama）

**核心文件**：
- `embedding_base.py` - 嵌入模型基类
- `openai_embedding.py` - OpenAI 嵌入
- `ollama_embedding.py` - Ollama 嵌入
- `cache_base.py` - 缓存基类
- `file_cache.py` - 文件缓存

### 4. exception/ - 异常处理

**设计思路**：统一的异常体系，便于错误处理

**主要功能**：
- 基础异常类
- 工具异常
- 异常传播机制

**核心文件**：
- `exception_base.py` - 基础异常
- `tool.py` - 工具异常

### 5. formatter/ - 格式化器

**设计思路**：统一的消息格式化，支持不同模型格式

**主要功能**：
- OpenAI 格式化
- 截断处理
- 消息转换

**核心文件**：
- `formatter_base.py` - 格式化器基类
- `openai_formatter.py` - OpenAI 格式化
- `truncated_formatter_base.py` - 截断格式化基类

### 6. message/ - 消息处理

**设计思路**：消息块的抽象，支持灵活的消息构建

**主要功能**：
- 消息块定义
- 消息构建
- 消息验证

**核心文件**：
- `message_base.py` - 消息基类
- `message_block.py` - 消息块实现

### 7. model/ - 模型相关

**设计思路**：统一的模型接口，支持多种模型

**主要功能**：
- 模型调用
- 响应处理
- 使用统计
- Token 计算

**核心文件**：
- `model_base.py` - 模型基类
- `openai_model.py` - OpenAI 模型
- `model_response.py` - 模型响应
- `model_usage.py` - 使用统计

### 8. plugins/ - 插件系统

**设计思路**：可扩展的插件架构，支持动态加载

**主要功能**：
- 钩子系统
- MCP（Model Context Protocol）客户端
- 记忆管理
- 规划器
- RAG（检索增强生成）
- 工具执行

**核心文件**：
- `hooks/` - 钩子系统
- `mcp/mcp_client.py` - MCP 客户端
- `memory/` - 记忆插件
  - `blackhole_memory.py` - 黑洞记忆（不存储）
  - `vector_memory.py` - 向量记忆
- `plan/` - 规划器
- `rag/knowledge_base_rag.py` - 知识库 RAG
- `tools/toolkit_executor.py` - 工具执行器

### 9. session/ - 会话管理

**设计思路**：会话状态管理，支持持久化

**主要功能**：
- 会话创建
- 状态保存
- 会话恢复

**核心文件**：
- `session_base.py` - 会话基类
- `json_session.py` - JSON 会话实现

### 10. token_counter/ - Token 计数

**设计思路**：精确的 token 计算，支持不同模型

**主要功能**：
- Token 计算
- 模型适配
- 成本估算

**核心文件**：
- `token_base.py` - Token 计数基类
- `openai_token_counter.py` - OpenAI Token 计数

### 11. tracing/ - 追踪

**设计思路**：执行追踪和调试，便于问题排查

**主要功能**：
- 调用链追踪
- 性能监控
- 日志记录

### 12. tts/ - 语音合成

**设计思路**：文本转语音功能

**主要功能**：
- TTS 调用
- 音频流处理

**核心文件**：
- `simple_tts.py` - 简单 TTS 实现

### 13. types/ - 类型定义

**设计思路**：类型系统，提供类型安全

**主要功能**：
- 钩子类型
- JSON 类型
- 对象类型
- 工具类型

**核心文件**：
- `hook.py` - 钩子类型
- `json.py` - JSON 类型
- `object.py` - 对象类型
- `tool.py` - 工具类型

### 14. utils/ - 工具函数

**设计思路**：通用工具库，提供常用功能

**主要功能**：
- 异步工具
- 通用函数
- 日志记录
- 混入模式
- 状态模块

**核心文件**：
- `async_utils.py` - 异步工具
- `common.py` - 通用函数
- `logging.py` - 日志记录
- `mixin.py` - 混入模式
- `state_module.py` - 状态模块

---

## 应用层

### 1. api/v1/ - API 接口

**设计思路**：RESTful API，提供标准化的接口

**主要功能**：
- 项目管理
- 工具管理
- WebSocket 实时通信

**核心文件**：
- `projects.py` - 项目管理接口
- `tools.py` - 工具管理接口
- `websocket.py` - WebSocket 接口

### 2. core/ - 核心业务逻辑

**设计思路**：业务逻辑层，处理核心业务

**主要功能**：
- 画布解析
- 上下文管理
- 调度器
- 工具注册

**核心文件**：
- `canvas_parser.py` - 画布解析器
- `context_manager.py` - 上下文管理器
- `scheduler.py` - 调度器
- `tool_registry.py` - 工具注册表

### 3. models/ - 数据模型

**设计思路**：数据模型定义，与数据库对应

**主要功能**：
- 节点模型
- 数据验证

**核心文件**：
- `node.py` - 节点模型

### 4. schemas/ - 请求/响应模式

**设计思路**：API 数据验证，使用 Pydantic

**主要功能**：
- 请求模式
- 响应模式
- 数据验证

**核心文件**：
- `response.py` - 响应模式

---

## 前后端交互

### 1. frontend_interaction/ - 前后端交互代码文件夹

**设计思路**：专门处理前端与后端的交互，解耦业务逻辑

**主要功能**：
- Flow 保存
- Flow 加载
- Flow 列表
- Flow 删除

### 2. save_service/ - 保存相关代码文件夹

**设计思路**：封装文件保存逻辑，提供统一的保存接口

**主要功能**：
- 文件管理
- Flow 数据序列化
- 文件读写

**核心文件**：
- `file_manager.py` - 文件管理器
  - `ensure_saved_flows_dir()` - 确保 saved_flows 文件夹存在
  - `get_flow_file_path(project_name)` - 获取 flow 文件路径
  - `save_flow_to_file(project_name, flow_data)` - 保存 flow 到文件
  - `load_flow_from_file(project_name)` - 从文件加载 flow
  - `delete_flow_file(project_name)` - 删除 flow 文件
  - `list_all_flows()` - 列出所有 flow
  - `flow_exists(project_name)` - 检查 flow 是否存在

- `flow_saver.py` - Flow 保存器
  - `save_flow(project_name, nodes, edges)` - 保存 flow
  - `load_flow(project_name)` - 加载 flow
  - `list_flows()` - 列出所有 flow
  - `delete_flow(project_name)` - 删除 flow
  - `flow_exists(project_name)` - 检查 flow 是否存在

---

## 主应用

### 1. app.py - 保存服务主应用

**设计思路**：独立的 FastAPI 应用，专门处理保存服务

**主要功能**：
- 保存 Flow 到文件
- 加载 Flow
- 列出所有 Flow
- 删除 Flow

**接口**：
- `POST /api/v1/save-flow` - 保存 flow
- `GET /api/v1/flows` - 列出所有 flow
- `GET /api/v1/flows/{project_name}` - 获取指定 flow
- `DELETE /api/v1/flows/{project_name}` - 删除 flow

**端口**：8901

### 2. main.py - 主入口

**设计思路**：主应用入口，启动 API 服务

**端口**：8000

---

## 设计总结

1. **分层架构**：SoloAgent 框架、应用层、前后端交互层清晰分离
2. **模块化**：每个模块职责单一，易于维护
3. **可扩展**：插件系统支持功能扩展
4. **统一接口**：定义清晰的接口规范
5. **类型安全**：使用类型提示和 Pydantic 模型
6. **前后端分离**：frontend_interaction 专门处理前后端交互
7. **独立服务**：app.py 作为独立的保存服务，运行在 8901 端口
