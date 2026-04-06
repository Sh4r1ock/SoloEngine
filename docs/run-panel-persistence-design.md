# 运行面板数据持久化存储方案详细分析文档

## 目录

- [1. 问题分析](#1-问题分析)
- [2. 数据持久化需求](#2-数据持久化需求)
- [3. 数据库表设计](#3-数据库表设计)
- [4. 数据关系分析](#4-数据关系分析)
- [5. 技术方案调研](#5-技术方案调研)
- [6. 实现建议](#6-实现建议)
- [7. 潜在问题与解决方案](#7-潜在问题与解决方案)
- [8. 实施步骤](#8-实施步骤)
- [9. 测试方案](#9-测试方案)
- [10. 结论与建议](#10-结论与建议)

---

## 1. 问题分析

### 1.1 当前运行面板数据丢失的具体表现

经过对前端代码 [RunPanel.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/RunPanel/RunPanel.tsx) 的分析，当前运行面板存在以下数据丢失问题：

#### 1.1.1 任务记录丢失

```typescript
// 当前任务数据存储在前端状态中
const [tasks, setTasks] = useState<Task[]>([]);
const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

interface Task {
  id: string;
  name: string;
  createdAt: string;
  messages: LLMMessage[];
}
```

**具体表现**：
- 用户创建的任务列表在页面刷新后完全清空
- 任务名称、创建时间、关联的对话记录全部丢失
- 无法恢复之前的任务上下文

#### 1.1.2 对话记录丢失

```typescript
// 对话消息存储在前端状态中
const [llmMessages, setLlmMessages] = useState<LLMMessage[]>([]);

interface LLMMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning_content?: string;
  timestamp: string;
  tokens?: number;
}
```

**具体表现**：
- 用户与AI的完整对话历史在刷新后丢失
- 包含用户提问、AI回答、思考过程(reasoning_content)的所有内容
- 无法追溯之前的交互上下文

#### 1.1.3 执行状态丢失

```typescript
// 执行调用记录存储在前端状态中
const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
const [childAgentOutputs, setChildAgentOutputs] = useState<ChildAgentOutput[]>([]);
```

**具体表现**：
- 工具调用记录(tool calls)丢失
- 子Agent执行输出丢失
- 执行过程中的中间状态无法恢复

### 1.2 问题发生频率

| 场景 | 频率 | 影响 |
|------|------|------|
| 用户主动刷新页面 | 高 | 完全丢失 |
| 浏览器崩溃恢复 | 中 | 完全丢失 |
| 网络断开重连 | 低 | 部分丢失 |
| 标签页切换 | 低 | 状态保持 |
| 长时间未操作导致会话超时 | 中 | 完全丢失 |

### 1.3 对用户体验的影响

#### 1.3.1 严重影响

1. **工作连续性中断**：用户无法继续之前的任务，需要重新描述需求
2. **上下文丢失**：AI无法获取之前的对话历史，导致回答质量下降
3. **重复劳动**：用户需要重新输入相同的问题和配置

#### 1.3.2 中等影响

1. **调试困难**：无法回溯执行过程中的问题
2. **学习成本增加**：新用户可能因为数据丢失而放弃使用
3. **信任度降低**：用户对系统稳定性的信心下降

#### 1.3.3 轻微影响

1. **界面状态重置**：面板布局、滚动位置等需要重新调整
2. **临时数据丢失**：正在编辑但未发送的内容丢失

---

## 2. 数据持久化需求

### 2.1 任务记录持久化需求

| 需求项 | 具体要求 | 优先级 |
|--------|----------|--------|
| 数据保存时长 | 永久保存，支持用户手动删除 | P0 |
| 访问频率 | 高频访问（任务列表、切换任务） | P0 |
| 数据完整性 | 必须保证任务名称、创建时间、关联对话的完整性 | P0 |
| 一致性要求 | 强一致性，确保任务与对话记录的关联正确 | P0 |
| 查询效率 | 支持按用户、项目、时间范围快速查询 | P1 |
| 数据隔离 | 不同用户的任务数据完全隔离 | P0 |

### 2.2 对话记录持久化需求

| 需求项 | 具体要求 | 优先级 |
|--------|----------|--------|
| 数据保存时长 | 与任务记录同生命周期 | P0 |
| 访问频率 | 高频访问（对话展示、上下文加载） | P0 |
| 数据完整性 | 必须保证消息顺序、角色、内容、时间戳的完整性 | P0 |
| 一致性要求 | 强一致性，确保对话顺序正确 | P0 |
| 模型上下文支持 | 支持作为LLM上下文存储，便于后续对话引用 | P1 |
| 大文本支持 | 支持存储长文本内容（代码、文档等） | P1 |
| Token统计 | 每条消息独立记录 token 使用量 | P1 |

### 2.3 数据量预估

基于典型使用场景的数据量预估：

| 数据类型 | 单条记录大小 | 日均新增 | 月均存储 | 年均存储 |
|----------|--------------|----------|----------|----------|
| 会话记录 | ~500 bytes | 50条 | ~750KB | ~9MB |
| 对话消息 | ~2KB | 500条 | ~30MB | ~360MB |
| 思考内容 | ~5KB | 100条 | ~15MB | ~180MB |
| 工具调用记录 | ~1KB | 200条 | ~6MB | ~72MB |

**单用户年均存储需求**：约 621MB

---

## 3. 数据库表设计

### 3.1 现有表分析

#### 3.1.1 agentic_flow_runs 表（将改名为 agentic_flow_sessions）

当前字段：
```python
id = Column(String(36), primary_key=True)
agentic_flow_id = Column(String(36), ForeignKey("agentic_flows.id"), nullable=False)
user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
status = Column(String(50), nullable=False, default="pending")
input_message = Column(Text, nullable=True)      # 将删除
output_message = Column(Text, nullable=True)     # 将删除
error = Column(Text, nullable=True)
token_usage = Column(JSON, nullable=True)        # 整个会话的累计 token
duration_ms = Column(Integer, nullable=True)
started_at = Column(DateTime)
completed_at = Column(DateTime)
version = Column(Integer, nullable=False, default=1)
```

**问题**：
- `input_message` 和 `output_message` 与 `agent_memories` 中的消息重复
- 职责不清晰，既有运行元数据，又有对话内容

#### 3.1.2 agent_memories 表（将改名为 session_messages）

当前字段：
```python
id = Column(String(36), primary_key=True)
agent_id = Column(String(36), ForeignKey("agents.id"), nullable=True)
user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
agentic_flow_id = Column(String(36), ForeignKey("agentic_flows.id"), nullable=True)
run_id = Column(String(36), ForeignKey("agentic_flow_runs.id"), nullable=True)
run_project_id = Column(String(36), ForeignKey("run_projects.id"), nullable=True)
role = Column(String(50), nullable=False)
content = Column(Text, nullable=False)           # 存储完整对话的 JSON
embedding_hash = Column(String(64), nullable=True)  # 将删除
meta_data = Column(JSON, nullable=True)         # 将删除
created_at = Column(DateTime)
version = Column(Integer, nullable=False, default=1)
```

**问题**：
- 当前一条记录存储整个对话（JSON格式），不支持分支
- 缺少 `message_index`、`reasoning_content`、token 统计等字段
- `embedding_hash` 和 `meta_data` 字段用途不明确

### 3.2 重叠部分分析

#### 3.2.1 对话内容存储重复

```
agentic_flow_runs:
  - input_message: "用户首次输入"
  - output_message: "AI最终回复"

agent_memories:
  - content: {"messages": [
      {"role": "user", "content": "用户首次输入"},
      {"role": "assistant", "content": "AI最终回复"}
    ]}
```

**问题**：input_message 和 output_message 与 agent_memories 中的消息重复

#### 3.2.2 职责边界模糊

- `agentic_flow_runs` 既有运行元数据，又有对话内容
- `agent_memories` 名字暗示"记忆"，但实际存储对话消息

### 3.3 表重命名与职责划分

| 原表名 | 新表名 | 职责 |
|--------|--------|------|
| `agentic_flow_runs` | `agentic_flow_sessions` | 会话元数据（状态、时间、统计） |
| `agent_memories` | `session_messages` | 对话消息（每条消息一条记录） |

### 3.4 agentic_flow_sessions 表设计

```sql
CREATE TABLE agentic_flow_sessions (
    -- 主键
    id VARCHAR(36) PRIMARY KEY,
    
    -- 外键关联
    agentic_flow_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    run_project_id VARCHAR(36),
    
    -- 会话状态
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error TEXT,
    
    -- 统计信息（整个会话的累计）
    token_usage JSON,
    duration_ms INTEGER,
    
    -- 时间戳
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- 版本控制（乐观锁）
    version INTEGER NOT NULL DEFAULT 1,
    
    -- 索引
    INDEX idx_user_id (user_id),
    INDEX idx_agentic_flow_id (agentic_flow_id),
    INDEX idx_run_project_id (run_project_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    
    -- 外键约束
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (agentic_flow_id) REFERENCES agentic_flows(id) ON DELETE CASCADE,
    FOREIGN KEY (run_project_id) REFERENCES run_projects(id) ON DELETE SET NULL
);
```

#### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | VARCHAR(36) | 是 | 主键，UUID格式 |
| agentic_flow_id | VARCHAR(36) | 是 | 外键，关联工作流表 |
| user_id | VARCHAR(36) | 是 | 外键，关联用户表 |
| run_project_id | VARCHAR(36) | 否 | 外键，关联运行项目表 |
| status | VARCHAR(50) | 是 | 会话状态：pending/running/completed/failed/cancelled |
| error | TEXT | 否 | 错误信息 |
| token_usage | JSON | 否 | 整个会话的累计 token 使用量 |
| duration_ms | INTEGER | 否 | 执行耗时（毫秒） |
| started_at | DATETIME | 否 | 开始时间 |
| completed_at | DATETIME | 否 | 完成时间 |

**删除的字段**：
- `input_message`：改为从 session_messages 查询第一条 user 消息
- `output_message`：改为从 session_messages 查询最后一条 assistant 消息

### 3.5 session_messages 表设计

**存储方式**：一条记录 = 一条消息

#### 3.5.1 业界最佳实践参考

根据 LangChain SQLChatMessageHistory 和 OpenAI ChatGPT 的设计，消息内容应以 **JSON 格式** 存储在 `content` 字段中：

**LangChain 消息格式**：
```json
{
  "type": "human",
  "data": {
    "content": "用户输入内容",
    "additional_kwargs": {}
  }
}
```

**OpenAI 消息格式**：
```json
{
  "role": "user",
  "content": "用户消息"
}
```

**DeepSeek 消息格式**（包含思考过程）：
```json
{
  "role": "assistant",
  "content": "最终回复内容",
  "reasoning_content": "思考过程内容"
}
```

#### 3.5.2 表结构设计

```sql
CREATE TABLE session_messages (
    -- 主键
    id VARCHAR(36) PRIMARY KEY,
    
    -- 外键关联
    session_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    agent_id VARCHAR(36),
    
    -- 消息内容（JSON格式，包含所有消息相关信息）
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    
    -- 消息顺序
    message_index INTEGER NOT NULL,
    parent_message_id VARCHAR(36),
    
    -- Token 统计（每条消息独立记录）
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    
    -- 时间戳
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- 版本控制
    version INTEGER NOT NULL DEFAULT 1,
    
    -- 索引
    INDEX idx_session_id (session_id),
    INDEX idx_user_id (user_id),
    INDEX idx_agent_id (agent_id),
    INDEX idx_role (role),
    INDEX idx_session_index (session_id, message_index),
    INDEX idx_timestamp (timestamp),
    
    -- 外键约束
    FOREIGN KEY (session_id) REFERENCES agentic_flow_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);
```

#### 3.5.3 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| id | VARCHAR(36) | 是 | 主键，UUID格式 |
| session_id | VARCHAR(36) | 是 | 外键，关联会话表 |
| user_id | VARCHAR(36) | 是 | 外键，关联用户表 |
| agent_id | VARCHAR(36) | 否 | 外键，关联Agent表 |
| role | VARCHAR(50) | 是 | 消息角色：user/assistant/system/tool |
| content | TEXT | 是 | 消息内容（JSON格式，见下方说明） |
| message_index | INTEGER | 是 | 消息在对话中的顺序索引 |
| parent_message_id | VARCHAR(36) | 否 | 父消息ID，支持对话分支 |
| prompt_tokens | INTEGER | 否 | 输入 token 数 |
| completion_tokens | INTEGER | 否 | 输出 token 数 |
| total_tokens | INTEGER | 否 | 总 token 数 |
| timestamp | DATETIME | 是 | 消息时间戳 |

#### 3.5.4 content 字段 JSON 格式说明

`content` 字段存储 JSON 格式的消息内容，支持不同模型的消息格式：

**用户消息**：
```json
{
  "content": "用户输入的问题"
}
```

**AI 回复消息（普通格式）**：
```json
{
  "content": "AI的回复内容"
}
```

**AI 回复消息（DeepSeek 推理格式）**：
```json
{
  "content": "最终回复内容",
  "reasoning_content": "思考过程内容"
}
```

**工具调用消息**：
```json
{
  "content": "",
  "tool_calls": [
    {
      "id": "call_xxx",
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"location\": \"Beijing\"}"
      }
    }
  ]
}
```

**工具结果消息**：
```json
{
  "content": "{\"temperature\": 25, \"weather\": \"sunny\"}",
  "tool_call_id": "call_xxx"
}
```

#### 3.5.5 设计优势

| 设计点 | 说明 |
|--------|------|
| JSON 格式存储 | 支持不同模型的消息格式，扩展性好 |
| 思考内容不分离 | reasoning_content 作为 JSON 的一部分，符合 API 返回格式 |
| 工具调用内嵌 | tool_calls 作为 JSON 的一部分，无需额外字段 |
| 兼容 OpenAI 格式 | 便于与其他系统集成 |

**删除的字段**（原 agent_memories 表）：
- `embedding_hash`：不需要向量检索功能
- `meta_data`：不需要额外元数据
- `agentic_flow_id`：通过 session_id 关联
- `run_project_id`：通过 session_id 关联
- `reasoning_content`：合并到 content JSON 中
- `tool_calls`：合并到 content JSON 中
- `tool_call_id`：合并到 content JSON 中

### 3.6 存储方式对比

| 方式 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **方式A：一条记录 = 全部对话** | content 存储完整对话的 JSON | 查询简单、记录数少 | 更新开销大、不支持分支、JSON解析开销 |
| **方式B：一条记录 = 一条消息** | 每条消息独立存储 | 查询灵活、支持分支、增量更新 | 记录数多、需要维护顺序 |

**选择方式B的理由**：
1. **支持对话分支**：通过 `parent_message_id` 支持
2. **增量更新**：新增消息只需插入一条记录
3. **Token 统计**：每条消息可以独立记录 token
4. **符合 OpenClaw 理念**：append-only 模式

---

## 4. 数据关系分析

### 4.1 ER图

```
┌─────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
│     users       │       │   agentic_flows     │       │   run_projects      │
├─────────────────┤       ├─────────────────────┤       ├─────────────────────┤
│ id (PK)         │◄──┐   │ id (PK)             │◄──┐   │ id (PK)             │◄──┐
│ username        │   │   │ user_id (FK)        │───┘   │ user_id (FK)        │───┘
│ email           │   │   │ name                │       │ name                │
│ ...             │   │   │ description         │       │ folder_path         │
└─────────────────┘   │   │ canvas_data         │       │ ...                 │
        ▲             │   │ ...                 │       └─────────────────────┘
        │             │   └─────────────────────┘                 │
        │             │                                           │
        │             │   ┌─────────────────────────────────────────────────────────┐
        │             │   │                 agentic_flow_sessions                   │
        │             │   ├─────────────────────────────────────────────────────────┤
        │             │   │ id (PK)                                                 │
        │             ├───┤ user_id (FK) ──────────────────► users.id              │
        │             │   │ agentic_flow_id (FK) ──────────► agentic_flows.id       │
        │             │   │ run_project_id (FK) ───────────► run_projects.id        │
        │             │   │ status                                                  │
        │             │   │ token_usage (累计)                                      │
        │             │   │ duration_ms                                             │
        │             │   │ ...                                                     │
        │             │   └─────────────────────────────────────────────────────────┘
        │             │                                │
        │             │                                │ 1:N
        │             │                                ▼
        │             │   ┌─────────────────────────────────────────────────────────┐
        │             │   │                   session_messages                      │
        │             │   ├─────────────────────────────────────────────────────────┤
        │             │   │ id (PK)                                                 │
        │             ├───┤ user_id (FK) ──────────────────► users.id              │
        │             │   │ session_id (FK) ───────────────► agentic_flow_sessions.id│
        │             │   │ agent_id (FK) ─────────────────► agents.id              │
        │             │   │ role                                                    │
        │             │   │ content (JSON格式，含contentreasoning_content)                 │
        │             │   │ message_index                                           │
        │             │   │ parent_message_id (自关联)                              │
        │             │   │ prompt_tokens / completion_tokens / total_tokens        │
        │             │   │ ...                                                     │
        │             │   └─────────────────────────────────────────────────────────┘
        │             │
        │             │   ┌─────────────────────┐
        │             │   │      agents         │
        │             │   ├─────────────────────┤
        │             └───┤ id (PK)             │
        │                 │ user_id (FK)        │
        │                 │ agentic_flow_id(FK) │
        │                 │ name                │
        │                 │ agent_type          │
        │                 │ ...                 │
        │                 └─────────────────────┘
        │
        │   ┌─────────────────────────┐
        │   │   execution_steps       │
        │   ├─────────────────────────┤
        │   │ id (PK)                 │
        │   │ run_id (FK) ────────────┼───► agentic_flow_sessions.id
        │   │ user_id (FK)            │
        │   │ step_type               │
        │   │ ...                     │
        │   └─────────────────────────┘
        │
        │   ┌─────────────────────────┐
        │   │   tool_call_records     │
        │   ├─────────────────────────┤
        │   │ id (PK)                 │
        │   │ run_id (FK) ────────────┼───► agentic_flow_sessions.id
        │   │ user_id (FK)            │
        │   │ tool_name               │
        │   │ ...                     │
        │   └─────────────────────────┘
```

### 4.2 表关系说明

#### 4.2.1 核心关系

```
users (1) ──────────── (N) agentic_flow_sessions
users (1) ──────────── (N) session_messages
agentic_flow_sessions (1) ──────── (N) session_messages
agentic_flows (1) ──── (N) agentic_flow_sessions
run_projects (1) ───── (N) agentic_flow_sessions
agents (1) ─────────── (N) session_messages
```

#### 4.2.2 与现有表的关系

| 新表 | 关联的现有表 | 关系说明 |
|------|--------------|----------|
| agentic_flow_sessions | execution_steps | execution_steps.run_id 关联到 agentic_flow_sessions.id |
| agentic_flow_sessions | tool_call_records | tool_call_records.run_id 关联到 agentic_flow_sessions.id |
| session_messages | 无直接关联 | 通过 session_id 间接关联 |

### 4.3 数据流向

```
┌──────────────────────────────────────────────────────────────────┐
│                         前端 RunPanel                             │
├──────────────────────────────────────────────────────────────────┤
│  Task[] ←─────────────────────────────────────┐                  │
│  LLMMessage[] ←───────────────────────────────┼───┐              │
│  CallRecord[] ←───────────────────────────────┼───┼───┐          │
└────────────────────────────────────────────────┼───┼───┼──────────┘
                                                 │   │   │
                                                 ▼   ▼   ▼
┌──────────────────────────────────────────────────────────────────┐
│                         后端 API层                                │
├──────────────────────────────────────────────────────────────────┤
│  POST /api/v1/sessions              创建会话                    │
│  GET  /api/v1/sessions              获取会话列表                │
│  POST /api/v1/sessions/{id}/messages 添加消息                   │
│  GET  /api/v1/sessions/{id}/messages 获取消息列表               │
└──────────────────────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                       数据库持久层                                │
├──────────────────────────────────────────────────────────────────┤
│  agentic_flow_sessions                                           │
│  session_messages                                                │
│  execution_steps                                                 │
│  tool_call_records                                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. 技术方案调研

### 5.1 Trae SOLO模式数据持久化分析

根据网络搜索结果，Trae SOLO模式具有以下特点：

#### 5.1.1 核心特性

> "SOLO 模式是 TRAE 2.0 的最大突破，将 AI 从'辅助者'升级为'主导者'" - [掘金文章](https://juejin.cn/post/7534903589253791770)

**关键特点**：
1. **数据持久化**：刷新页面后数据不丢失
2. **浏览器存储优先**：所有用户数据和应用状态必须使用浏览器存储
3. **协作模式**：支持用户与AI协作开发

#### 5.1.2 数据持久化要求

| 要求 | 说明 | 实现方式 |
|------|------|----------|
| 页面刷新恢复 | 刷新后数据不丢失 | localStorage / IndexedDB |
| 会话状态保持 | 保持用户操作状态 | 状态持久化 |
| 数据同步 | 多标签页数据同步 | Storage事件监听 |
| 离线支持 | 断网后仍可访问 | Service Worker + Cache |

#### 5.1.3 对本系统的启示

1. **前端缓存层**：需要在前端实现一层缓存，减少后端压力
2. **实时同步**：数据变更需要实时同步到后端
3. **增量更新**：支持增量更新，避免全量数据传输

### 5.2 OpenClaw对话存储设计分析

根据网络搜索结果，OpenClaw的对话存储设计具有以下特点：

#### 5.2.1 存储架构

> "所有对话以 append-only JSONL 形式落盘于 ~/.openclaw/agents/<agentId>/sessions/" - [头条文章](http://m.toutiao.com/group/7610034142239113780/)

**核心设计理念**：
1. **Append-Only**：只追加不修改，保证数据完整性
2. **JSONL格式**：每行一个JSON对象，便于流式读取
3. **本地存储优先**：数据存储在用户设备，不上传第三方平台
4. **支持分支**：支持对话树fork与恢复

#### 5.2.2 记忆读取优先级

OpenClaw的记忆读取遵循严格的优先级顺序：

```
1. 当前会话实时对话
2. 当前Agent的长期记忆
3. 项目级别的共享记忆
4. 全局用户偏好设置
```

#### 5.2.3 对话存储结构

```json
{
  "id": "msg_xxx",
  "role": "user|assistant|system",
  "content": "消息内容",
  "timestamp": "2026-03-10T10:00:00Z",
  "metadata": {
    "tokens": 150,
    "model": "deepseek-chat"
  }
}
```

#### 5.2.4 对本系统的启示

1. **追加写入模式**：对话记录采用追加写入，避免修改历史数据
2. **时间戳索引**：基于时间戳建立索引，支持快速查询
3. **元数据分离**：将消息内容与元数据分离存储
4. **上下文管理**：支持标记重要消息作为上下文

### 5.3 技术方案对比

| 方案 | Trae SOLO | OpenClaw | 本系统推荐 |
|------|-----------|----------|------------|
| 存储位置 | 浏览器 + 后端 | 本地文件 | 后端数据库 + 前端缓存 |
| 存储格式 | JSON | JSONL | 关系型数据库 |
| 写入模式 | 实时同步 | Append-Only | 追加写入 |
| 分支支持 | 否 | 是 | 是 |
| 多设备同步 | 是 | 否 | 是 |
| 查询效率 | 中 | 低 | 高 |

### 5.4 推荐技术方案

综合Trae SOLO和OpenClaw的设计理念，本系统推荐采用以下技术方案：

#### 5.4.1 存储架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端缓存层                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   IndexedDB     │  │  localStorage   │  │   内存缓存      │ │
│  │  (大数据存储)   │  │  (配置信息)     │  │  (实时状态)     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket / HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        后端持久层                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   SQLite DB     │  │   文件存储      │  │   缓存层        │ │
│  │  (结构化数据)   │  │  (大文件/附件)  │  │  (热点数据)     │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

#### 5.4.2 数据同步策略

1. **实时同步**：对话消息实时通过WebSocket同步到后端
2. **批量同步**：会话状态变更批量同步
3. **冲突解决**：采用乐观锁机制解决并发冲突
4. **离线支持**：前端缓存支持离线操作，联网后自动同步

---

## 6. 实现建议

### 6.1 数据库表创建建议

#### 6.1.1 SQLAlchemy模型定义

```python
# backend/app/models/agentic_flow_session.py

from sqlalchemy import Column, String, Text, Integer, DateTime, Boolean, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
from ..core.database import Base

class AgenticFlowSessionModel(Base):
    __tablename__ = "agentic_flow_sessions"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agentic_flow_id = Column(String(36), ForeignKey("agentic_flows.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    run_project_id = Column(String(36), ForeignKey("run_projects.id"), nullable=True, index=True)
    
    status = Column(String(50), nullable=False, default="pending", index=True)
    error = Column(Text, nullable=True)
    
    token_usage = Column(JSON, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    version = Column(Integer, nullable=False, default=1)
    
    agentic_flow = relationship("AgenticFlowModel", back_populates="sessions")
    user = relationship("UserModel", backref="sessions")
    run_project = relationship("RunProjectModel", backref="sessions")
    messages = relationship("SessionMessageModel", back_populates="session", cascade="all, delete-orphan")
```

```python
# backend/app/models/session_message.py

from sqlalchemy import Column, String, Text, Integer, DateTime, Boolean, ForeignKey, JSON, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
from ..core.database import Base

class SessionMessageModel(Base):
    __tablename__ = "session_messages"
    __table_args__ = (
        Index('ix_session_messages_session_index', 'session_id', 'message_index'),
    )
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("agentic_flow_sessions.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    agent_id = Column(String(36), ForeignKey("agents.id"), nullable=True, index=True)
    
    role = Column(String(50), nullable=False, index=True)
    content = Column(Text, nullable=False)  # JSON格式，包含content和reasoning_content
    
    message_index = Column(Integer, nullable=False)
    parent_message_id = Column(String(36), nullable=True)
    
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    
    timestamp = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    version = Column(Integer, nullable=False, default=1)
    
    session = relationship("AgenticFlowSessionModel", back_populates="messages")
    user = relationship("UserModel", backref="session_messages")
    agent = relationship("AgentModel", backref="session_messages")
```

### 6.2 数据存储流程

#### 6.2.1 会话创建流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 用户在RunPanel输入消息                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. 前端调用 createSession API                                   │
│    POST /api/v1/sessions                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. 后端创建会话记录                                             │
│    - 生成session_id                                             │
│    - 关联user_id, agentic_flow_id                               │
│    - 设置status = 'pending'                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. 返回session_id给前端                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. 前端存储到本地状态                                           │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.2.2 对话消息存储流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 用户发送消息 / AI返回消息                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. 前端通过WebSocket发送消息                                    │
│    { type: 'message', session_id, role, content, tokens, ... }  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. 后端接收并存储到数据库                                       │
│    - 计算message_index                                          │
│    - 存储到session_messages表                                   │
│    - 更新session的token_usage累计值                             │
│    - 更新session的updated_at                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. 返回确认消息给前端                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 数据读取流程

#### 6.3.1 页面加载时数据恢复

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. RunPanel组件挂载                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. 调用API获取用户会话列表                                      │
│    GET /api/v1/sessions?user_id=xxx                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. 后端查询agentic_flow_sessions表                              │
│    - 过滤status != 'deleted'                                    │
│    - 按updated_at降序排列                                       │
│    - 返回会话列表                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. 前端恢复会话列表状态                                         │
│    setSessions(response.data)                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. 用户选择会话时，加载对话历史                                 │
│    GET /api/v1/sessions/{session_id}/messages                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. 后端查询session_messages表                                   │
│    - 按message_index排序                                        │
│    - 返回消息记录列表                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. 前端恢复对话状态                                             │
│    setMessages(response.data)                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 数据维护策略

#### 6.4.1 定期清理策略

```python
# backend/app/services/session_cleanup.py

from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from ..core.database import AgenticFlowSessionModel

def cleanup_old_sessions(db: Session, days: int = 90):
    """清理超过指定天数的已完成会话"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    old_sessions = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.status.in_(['completed', 'failed', 'cancelled']),
        AgenticFlowSessionModel.completed_at < cutoff_date
    ).all()
    
    for session in old_sessions:
        db.delete(session)
    
    db.commit()
    return len(old_sessions)
```

#### 6.4.2 数据归档策略

```python
def archive_completed_sessions(db: Session, days: int = 30):
    """归档已完成的会话到历史表"""
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    sessions_to_archive = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.status == 'completed',
        AgenticFlowSessionModel.completed_at < cutoff_date
    ).all()
    
    for session in sessions_to_archive:
        # 创建归档记录
        archive_record = SessionArchiveModel(
            original_id=session.id,
            user_id=session.user_id,
            name=session.agentic_flow.name if session.agentic_flow else "",
            summary=generate_session_summary(session),
            archived_at=datetime.now(timezone.utc)
        )
        db.add(archive_record)
        
        # 删除原始数据
        db.delete(session)
    
    db.commit()
```

---

## 7. 潜在问题与解决方案

### 7.1 数据量大导致的性能问题

#### 7.1.1 问题描述

随着用户使用时间增长，对话消息数量会急剧增加，可能导致：
- 查询速度变慢
- 数据库体积膨胀
- 内存占用过高

#### 7.1.2 解决方案

| 问题 | 解决方案 | 实现方式 |
|------|----------|----------|
| 查询慢 | 分页查询 + 索引优化 | 添加复合索引，限制单次查询数量 |
| 数据库膨胀 | 数据归档 + 压缩 | 定期归档旧数据，压缩存储 |
| 内存占用高 | 懒加载 + 虚拟滚动 | 只加载可见区域的消息 |

```python
# 分页查询示例
def get_messages_paginated(
    db: Session, 
    session_id: str, 
    page: int = 1, 
    page_size: int = 50
):
    offset = (page - 1) * page_size
    return db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id
    ).order_by(
        SessionMessageModel.message_index
    ).offset(offset).limit(page_size).all()
```

### 7.2 并发访问问题

#### 7.2.1 问题描述

多用户同时访问或同一用户多标签页操作可能导致：
- 数据竞争
- 乐观锁冲突
- 消息顺序错乱

#### 7.2.2 解决方案

```python
# 使用乐观锁解决并发冲突
def update_session_with_lock(db: Session, session_id: str, version: int, **kwargs):
    session = db.query(AgenticFlowSessionModel).filter(
        AgenticFlowSessionModel.id == session_id
    ).first()
    if not session:
        return None
    
    if session.version != version:
        raise OptimisticLockError(
            f"Version conflict: expected {version}, got {session.version}"
        )
    
    for key, value in kwargs.items():
        setattr(session, key, value)
    
    session.version += 1
    db.commit()
    db.refresh(session)
    return session
```

### 7.3 数据一致性问题

#### 7.3.1 问题描述

前端缓存与后端数据不一致可能导致：
- 显示旧数据
- 操作失败
- 数据丢失

#### 7.3.2 解决方案

```typescript
// 前端实现数据同步机制
class DataSyncManager {
  private syncQueue: SyncItem[] = [];
  private isSyncing: boolean = false;

  async addToQueue(item: SyncItem) {
    this.syncQueue.push({
      ...item,
      timestamp: Date.now(),
      retryCount: 0
    });
    
    if (!this.isSyncing) {
      await this.processQueue();
    }
  }

  private async processQueue() {
    this.isSyncing = true;
    
    while (this.syncQueue.length > 0) {
      const item = this.syncQueue[0];
      try {
        await this.syncItem(item);
        this.syncQueue.shift();
      } catch (error) {
        if (item.retryCount < 3) {
          item.retryCount++;
          await new Promise(r => setTimeout(r, 1000 * item.retryCount));
        } else {
          console.error('Sync failed after 3 retries:', item);
          this.syncQueue.shift();
        }
      }
    }
    
    this.isSyncing = false;
  }
}
```

### 7.4 网络异常问题

#### 7.4.1 问题描述

网络不稳定可能导致：
- 数据同步失败
- 消息丢失
- 用户体验中断

#### 7.4.2 解决方案

```typescript
// 离线支持 + 自动重连
class OfflineManager {
  private offlineQueue: OfflineAction[] = [];
  private isOnline: boolean = navigator.onLine;

  constructor() {
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  private handleOffline() {
    this.isOnline = false;
    console.log('已离线，数据将暂存本地');
  }

  private async handleOnline() {
    this.isOnline = true;
    console.log('已恢复在线，开始同步数据');
    await this.syncOfflineData();
  }

  async saveMessage(message: LLMMessage) {
    // 先保存到本地
    await this.saveToLocal(message);
    
    if (this.isOnline) {
      // 在线时直接同步
      await this.syncToServer(message);
    } else {
      // 离线时加入队列
      this.offlineQueue.push({
        type: 'message',
        data: message,
        timestamp: Date.now()
      });
    }
  }
}
```

---

## 8. 实施步骤

### 8.1 完成顺序

| 顺序 | 任务 | 依赖 | 说明 |
|------|------|------|------|
| 1 | 数据库表重命名和字段调整 | 无 | agentic_flow_runs → agentic_flow_sessions，agent_memories → session_messages |
| 2 | 更新 SQLAlchemy 模型定义 | 1 | 修改 database.py 中的模型定义 |
| 3 | 更新关联表的外键引用 | 1 | execution_steps、tool_call_records 等表的 run_id 改为 session_id |
| 4 | 更新后端 API 接口 | 2, 3 | 修改相关 API 的字段名和逻辑 |
| 5 | 更新 DatabaseMemoryPlugin | 2 | 修改存储逻辑，一条消息一条记录 |
| 6 | 更新前端 API 调用 | 4 | 修改前端调用的接口名和字段 |
| 7 | 实现前端数据持久化 | 5, 6 | IndexedDB 缓存 + 离线支持 |
| 8 | 数据迁移脚本 | 1-7 | 将现有数据迁移到新表结构 |
| 9 | 测试验证 | 1-8 | 单元测试、集成测试、E2E测试 |

### 8.2 详细步骤

#### 步骤1：数据库表重命名和字段调整

```sql
-- 1. 重命名 agentic_flow_runs 为 agentic_flow_sessions
ALTER TABLE agentic_flow_runs RENAME TO agentic_flow_sessions;

-- 2. 删除 input_message 和 output_message 字段
ALTER TABLE agentic_flow_sessions DROP COLUMN input_message;
ALTER TABLE agentic_flow_sessions DROP COLUMN output_message;

-- 3. 创建新的 session_messages 表
CREATE TABLE session_messages (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    agent_id VARCHAR(36),
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,  -- JSON格式，包含content和reasoning_content
    message_index INTEGER NOT NULL,
    parent_message_id VARCHAR(36),
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1
);

-- 4. 创建索引
CREATE INDEX idx_session_messages_session_id ON session_messages(session_id);
CREATE INDEX idx_session_messages_session_index ON session_messages(session_id, message_index);

-- 5. 迁移 agent_memories 数据到 session_messages
-- 需要编写脚本解析 JSON 并拆分为多条记录

-- 6. 删除旧表
DROP TABLE agent_memories;
```

#### 步骤2：更新 SQLAlchemy 模型定义

修改 `backend/app/core/database.py`：
- 重命名 `AgenticFlowRunModel` 为 `AgenticFlowSessionModel`
- 删除 `input_message` 和 `output_message` 字段
- 重命名 `AgentMemoryModel` 为 `SessionMessageModel`
- 添加新字段

#### 步骤3：更新关联表的外键引用

修改 `execution_steps` 和 `tool_call_records` 表：
- `run_id` 改为 `session_id`
- 更新外键约束

#### 步骤4：更新后端 API 接口

修改 `backend/app/api/v1/` 下的相关文件：
- `agentic_flows.py`：更新 run 相关的 API
- `history.py`：更新历史记录 API
- `run.py`：更新运行 API

#### 步骤5：更新 DatabaseMemoryPlugin

修改 `backend/SoloAgent/plugins/memory/database_memory.py`：
- 改为一条消息一条记录的存储方式
- 添加 token 统计字段

#### 步骤6：更新前端 API 调用

修改 `frontend/src/services/runApi.ts`：
- 更新 API 路径和字段名

#### 步骤7：实现前端数据持久化

- 实现 IndexedDB 缓存
- 实现离线支持
- 实现数据同步

### 8.3 概念澄清与代码重构

当前系统中存在"长期记忆"概念混淆的问题，需要区分两个不同的概念：

#### 8.3.1 概念区分

| 概念 | 实际用途 | 处理方式 |
|------|----------|----------|
| **长期记忆（VectorMemoryPlugin）** | 基于向量相似度的语义检索，跨会话的知识记忆 | **保留**，为未来实现提供基础 |
| **对话消息（AgentMemoryModel）** | 存储会话中的对话消息，被错误命名为"记忆" | **改名**为 `SessionMessageModel` |

#### 8.3.2 问题分析

| 文件 | 问题 | 说明 |
|------|------|------|
| `database.py` | `AgentMemoryModel` 注释为"长期记忆模型" | **错误**：实际存储的是对话消息，不是长期记忆 |
| `interfaces.py` | `IMemory` 注释为"长期记忆层" | **需要澄清**：区分"对话消息"和"长期记忆" |
| `vector_memory.py` | 注释为"长期记忆" | **正确**：这是真正的长期记忆功能，应保留 |
| `agent_memories` 表 | `embedding_hash` 字段 | **删除**：对话消息不需要向量检索 |

#### 8.3.3 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        记忆系统架构                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              对话消息（Session Messages）                 │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ session_messages 表                             │    │   │
│  │  │ - 存储会话中的每条对话消息                       │    │   │
│  │  │ - 支持对话历史恢复                               │    │   │
│  │  │ - 作为模型的上下文记忆                           │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              长期记忆（Long-term Memory）                 │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │ VectorMemoryPlugin                              │    │   │
│  │  │ - 基于向量相似度的语义检索                       │    │   │
│  │  │ - 跨会话的知识记忆                               │    │   │
│  │  │ - 未来实现：用户偏好、项目知识等                  │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 8.3.4 需要修改的代码

**1. database.py - 模型重命名和注释修正**

```python
# 修改前（概念混淆）
class AgentMemoryModel(Base):
    """Agent 长期记忆模型。"""  # 错误注释
    __tablename__ = "agent_memories"
    # ...
    embedding_hash = Column(String(64), nullable=True)  # 不需要的字段

# 修改后（概念清晰）
class SessionMessageModel(Base):
    """会话消息模型 - 存储会话中的对话消息，作为模型的上下文记忆。"""
    __tablename__ = "session_messages"
    # 删除 embedding_hash 字段（对话消息不需要向量检索）
    # 删除 meta_data 字段（不需要额外元数据）
```

**2. interfaces.py - 接口注释澄清**

```python
# 修改前（概念混淆）
class IMemory(ABC):
    """
    记忆插件接口。
    
    设计理念：
        记忆系统是 Agent 的长期记忆层，区别于对话历史的短期记忆。
    """

# 修改后（概念清晰）
class IMemory(ABC):
    """
    记忆插件接口。
    
    设计理念：
        记忆系统分为两个层次：
        1. 对话消息（Session Messages）：存储会话中的对话历史，作为模型的上下文记忆
        2. 长期记忆（Long-term Memory）：基于向量相似度的语义检索，跨会话的知识记忆
        
        本接口定义长期记忆的标准实现，对话消息由 SessionMessageModel 存储。
    """
```

**3. vector_memory.py - 保持不变**

```python
# 这是真正的长期记忆功能，保留不变
# 未来可用于：
# - 用户偏好记忆
# - 项目知识库
# - 跨会话的知识检索

使用场景：
    - Agent 长期记忆：存储重要知识，按相关性检索
    - 用户偏好记忆：记住用户的偏好设置
    - 项目知识库：存储项目相关的知识
```

**4. agent_executor.py - 引用更新**

```python
# 修改前
from app.core.database import db_manager, get_db_context, AgentModel, AgentMemoryModel

# 修改后
from app.core.database import db_manager, get_db_context, AgentModel, SessionMessageModel
```

#### 8.3.5 概念统一对照表

| 原概念 | 新概念 | 说明 |
|--------|--------|------|
| AgentMemoryModel | SessionMessageModel | 更准确地反映实际用途：存储对话消息 |
| agent_memories | session_messages | 表名更清晰 |
| "长期记忆模型"（注释） | "会话消息模型" | 修正错误的注释 |
| VectorMemoryPlugin | VectorMemoryPlugin（保留） | 真正的长期记忆功能 |

#### 8.3.6 删除的字段

| 删除项 | 原因 |
|--------|------|
| `embedding_hash` 字段 | 对话消息不需要向量检索，长期记忆由 VectorMemoryPlugin 单独实现 |
| `meta_data` 字段 | 对话消息不需要额外元数据 |

#### 8.3.7 保留的代码

| 保留项 | 原因 |
|--------|------|
| `VectorMemoryPlugin` | **真正的长期记忆功能**，为未来实现提供基础 |
| `IMemory` 接口 | 核心接口，只需更新注释澄清概念 |
| `DatabaseMemoryPlugin` | 核心功能，只需重构存储方式 |

#### 8.3.8 未来扩展

长期记忆（VectorMemoryPlugin）的未来扩展方向：

1. **用户偏好记忆**：记住用户的编码风格、常用工具等
2. **项目知识库**：存储项目相关的技术栈、架构决策等
3. **跨会话知识**：在不同会话间共享重要信息
4. **智能推荐**：基于历史记忆推荐相关代码或文档

#### 步骤8：数据迁移脚本

编写数据迁移脚本，将现有数据迁移到新表结构。

#### 步骤9：测试验证

编写并执行测试用例，验证功能正确性。

---

## 9. 测试方案

### 9.1 单元测试

#### 9.1.1 数据库模型测试

```python
# tests/test_models.py

import pytest
from app.core.database import SessionLocal, AgenticFlowSessionModel, SessionMessageModel

def test_create_session():
    db = SessionLocal()
    try:
        session = AgenticFlowSessionModel(
            user_id="test_user",
            agentic_flow_id="test_flow",
            status="pending"
        )
        db.add(session)
        db.commit()
        
        assert session.id is not None
        assert session.status == "pending"
        assert session.created_at is not None
    finally:
        db.close()

def test_create_message():
    db = SessionLocal()
    try:
        session = AgenticFlowSessionModel(user_id="test_user", agentic_flow_id="test_flow")
        db.add(session)
        db.commit()
        
        message = SessionMessageModel(
            session_id=session.id,
            user_id="test_user",
            role="user",
            content="测试消息",
            message_index=0,
            prompt_tokens=10,
            completion_tokens=0,
            total_tokens=10
        )
        db.add(message)
        db.commit()
        
        assert message.id is not None
        assert message.message_index == 0
        assert message.total_tokens == 10
    finally:
        db.close()
```

#### 9.1.2 API测试

```python
# tests/test_api.py

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_create_session_api():
    response = client.post("/api/v1/sessions", json={
        "agentic_flow_id": "test_flow",
        "user_id": "test_user"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "pending"

def test_get_sessions_api():
    response = client.get("/api/v1/sessions?user_id=test_user")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_add_message_api():
    # 先创建会话
    session_resp = client.post("/api/v1/sessions", json={
        "agentic_flow_id": "test_flow",
        "user_id": "test_user"
    })
    session_id = session_resp.json()["id"]
    
    # 添加消息
    response = client.post(f"/api/v1/sessions/{session_id}/messages", json={
        "role": "user",
        "content": "测试消息",
        "prompt_tokens": 10,
        "total_tokens": 10
    })
    assert response.status_code == 200
```

### 9.2 集成测试

#### 9.2.1 端到端测试场景

```typescript
// tests/e2e/session-persistence.spec.ts

describe('会话持久化测试', () => {
  beforeEach(() => {
    cy.login('test_user', 'password');
    cy.visit('/run');
  });

  it('创建会话后刷新页面应保留数据', () => {
    // 创建新会话
    cy.get('[data-testid="new-session-button"]').click();
    cy.get('[data-testid="message-input"]').type('测试持久化会话');
    cy.get('[data-testid="send-button"]').click();
    
    // 等待会话创建完成
    cy.get('[data-testid="session-item"]').should('contain', '测试持久化会话');
    
    // 刷新页面
    cy.reload();
    
    // 验证会话仍然存在
    cy.get('[data-testid="session-item"]').should('contain', '测试持久化会话');
  });

  it('对话历史应在刷新后保留', () => {
    // 选择会话
    cy.get('[data-testid="session-item"]').first().click();
    
    // 发送消息
    cy.get('[data-testid="message-input"]').type('这是一条测试消息');
    cy.get('[data-testid="send-button"]').click();
    
    // 等待AI响应
    cy.get('[data-testid="assistant-message"]').should('exist');
    
    // 刷新页面
    cy.reload();
    
    // 验证对话历史
    cy.get('[data-testid="user-message"]').should('contain', '这是一条测试消息');
  });
});
```

### 9.3 性能测试

#### 9.3.1 数据库性能测试

```python
# tests/performance/test_db_performance.py

import time
from app.core.database import SessionLocal, AgenticFlowSessionModel, SessionMessageModel

def test_large_messages_query():
    """测试大量消息记录的查询性能"""
    db = SessionLocal()
    try:
        # 创建测试数据
        session = AgenticFlowSessionModel(user_id="perf_test", agentic_flow_id="test_flow")
        db.add(session)
        db.commit()
        
        # 插入1000条消息记录
        for i in range(1000):
            message = SessionMessageModel(
                session_id=session.id,
                user_id="perf_test",
                role="user" if i % 2 == 0 else "assistant",
                content=f"消息内容 {i}",
                message_index=i,
                total_tokens=10
            )
            db.add(message)
        db.commit()
        
        # 测试查询性能
        start_time = time.time()
        messages = db.query(SessionMessageModel).filter(
            SessionMessageModel.session_id == session.id
        ).order_by(SessionMessageModel.message_index).limit(50).all()
        query_time = time.time() - start_time
        
        assert query_time < 0.1  # 查询时间应小于100ms
        assert len(messages) == 50
    finally:
        db.close()
```

### 9.4 异常场景测试

| 场景 | 测试方法 | 预期结果 |
|------|----------|----------|
| 网络断开 | 断开网络后发送消息 | 消息保存到本地，网络恢复后同步 |
| 并发修改 | 两个标签页同时修改会话 | 后提交者收到冲突提示 |
| 数据损坏 | 手动修改数据库导致数据不一致 | 系统检测并提示错误 |
| 存储空间不足 | 模拟存储空间不足场景 | 提示用户清理旧数据 |
| 浏览器崩溃 | 强制关闭浏览器后重新打开 | 数据从服务器恢复 |

---

## 10. 结论与建议

### 10.1 分析总结

通过对当前系统的深入分析，我们得出以下结论：

1. **问题确认**：运行面板确实存在数据持久化缺失的问题，严重影响用户体验
2. **方案可行**：基于现有表的改造方案完全可行，能够满足系统需求
3. **技术成熟**：参考Trae SOLO和OpenClaw的设计理念，技术方案成熟可靠
4. **实施可控**：分步骤实施计划清晰，风险可控

### 10.2 最终实施建议

#### 10.2.1 完成顺序

| 顺序 | 功能模块 | 依赖关系 |
|------|----------|----------|
| 1 | 数据库表重命名和字段调整 | 无 |
| 2 | 更新 SQLAlchemy 模型定义 | 1 |
| 3 | 更新关联表的外键引用 | 1 |
| 4 | 更新后端 API 接口 | 2, 3 |
| 5 | 更新 DatabaseMemoryPlugin | 2 |
| 6 | 更新前端 API 调用 | 4 |
| 7 | 实现前端数据持久化 | 5, 6 |
| 8 | 数据迁移脚本 | 1-7 |
| 9 | 测试验证 | 1-8 |

#### 10.2.2 技术选型建议

| 组件 | 推荐方案 | 备选方案 |
|------|----------|----------|
| 数据库 | SQLite（现有） | PostgreSQL（大规模场景） |
| 前端缓存 | IndexedDB | localStorage |
| 同步机制 | WebSocket | Server-Sent Events |
| 离线支持 | Service Worker | AppCache |

### 10.3 风险评估

| 风险项 | 风险等级 | 影响 | 缓解措施 |
|--------|----------|------|----------|
| 数据迁移失败 | 中 | 现有数据丢失 | 备份数据库，提供回滚机制 |
| 性能下降 | 低 | 用户体验变差 | 充分测试，优化查询 |
| 存储空间不足 | 低 | 无法保存新数据 | 实现数据清理机制 |
| 并发冲突 | 中 | 数据不一致 | 乐观锁 + 冲突提示 |

### 10.4 预期收益

实施本方案后，预期将带来以下收益：

1. **用户体验提升**：刷新页面不再丢失数据，工作连续性得到保障
2. **系统稳定性增强**：数据持久化存储，避免意外丢失
3. **功能扩展基础**：为后续功能（如对话分支、数据导出）奠定基础
4. **运维成本降低**：减少用户投诉，降低支持成本

---

## 附录

### A. 参考文档

- [Trae SOLO模式介绍](https://juejin.cn/post/7534903589253791770)
- [OpenClaw会话机制与记忆系统](http://m.toutiao.com/group/7610034142239113780/)
- [SQLite官方文档](https://www.sqlite.org/docs.html)
- [SQLAlchemy文档](https://docs.sqlalchemy.org/)

### B. 相关代码文件

- [RunPanel.tsx](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/components/RunPanel/RunPanel.tsx)
- [runStore.ts](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/frontend/src/store/runStore.ts)
- [database.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/app/core/database.py)
- [database_memory.py](file:///d:/Project/Python/Sh4rlock/SoloEngine-main/backend/SoloAgent/plugins/memory/database_memory.py)

### C. 数据库迁移脚本

```sql
-- 迁移脚本：重命名表并调整字段
-- 版本：001
-- 日期：2026-03-10

-- 1. 备份原表
CREATE TABLE agentic_flow_runs_backup AS SELECT * FROM agentic_flow_runs;
CREATE TABLE agent_memories_backup AS SELECT * FROM agent_memories;

-- 2. 重命名 agentic_flow_runs 为 agentic_flow_sessions
ALTER TABLE agentic_flow_runs RENAME TO agentic_flow_sessions;

-- 3. 删除不需要的字段（SQLite不支持DROP COLUMN，需要重建表）
CREATE TABLE agentic_flow_sessions_new (
    id VARCHAR(36) PRIMARY KEY,
    agentic_flow_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    run_project_id VARCHAR(36),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error TEXT,
    token_usage TEXT,
    duration_ms INTEGER,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO agentic_flow_sessions_new 
SELECT id, agentic_flow_id, user_id, NULL, status, error, token_usage, duration_ms, started_at, completed_at, created_at, updated_at, version
FROM agentic_flow_sessions;

DROP TABLE agentic_flow_sessions;
ALTER TABLE agentic_flow_sessions_new RENAME TO agentic_flow_sessions;

-- 4. 创建索引
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON agentic_flow_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agentic_flow_id ON agentic_flow_sessions(agentic_flow_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON agentic_flow_sessions(status);

-- 5. 创建 session_messages 表
CREATE TABLE session_messages (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    agent_id VARCHAR(36),
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,  -- JSON格式，包含content和reasoning_content
    message_index INTEGER NOT NULL,
    parent_message_id VARCHAR(36),
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1
);

-- 6. 创建索引
CREATE INDEX idx_session_messages_session_id ON session_messages(session_id);
CREATE INDEX idx_session_messages_user_id ON session_messages(user_id);
CREATE INDEX idx_session_messages_session_index ON session_messages(session_id, message_index);

-- 7. 数据迁移（需要 Python 脚本处理 JSON 解析）
-- 见 backend/scripts/migrate_memories.py
```

---

**文档版本**：v2.0  
**创建日期**：2026-03-10  
**最后更新**：2026-03-10  
**作者**：SoloEngine Team
