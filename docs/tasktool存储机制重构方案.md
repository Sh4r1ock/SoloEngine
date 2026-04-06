# TaskTool 存储机制重构方案

## 一、背景概述

### 1.1 当前存储机制现状

当前系统采用 `ChunkCollector` + `stream_callback` 机制实现多 Agent 的消息存储与上下文隔离：

| 组件 | 文件位置 | 职责 |
|------|----------|------|
| `ChunkCollector` | `app/api/v1/run.py` | 收集流式chunk并按agent_id分组 |
| `stream_callback` | 跨组件传递 | 流式输出回调，连接Agent与Collector |
| `save_session_message` | `app/api/v1/run.py` | 保存消息到数据库 |
| `load_and_distribute_memories` | `app/api/v1/run.py` | 从数据库读取记忆并按agent_id分发 |
| `TaskTool` | `plugins/tools/agent/task.py` | SubAgent调用，传递stream_callback |

### 1.2 核心设计理念

**stream_callback + ChunkCollector 统一存储机制**

- MainAgent 和 SubAgent 使用相同的存储路径
- 通过 `agent_id` 区分不同 Agent 的消息
- 通过 `parent_message_id` 关联 SubAgent 消息到 MainAgent

---

## 二、核心架构

### 2.1 四层架构数据流

```
┌─────────────────────────────────────────────────────────────────┐
│  WebSocket 层 (run.py)                                          │
│  ├── 创建 ChunkCollector                                        │
│  ├── 定义 stream_callback_with_collector                        │
│  │   └── collector.add_chunk(delta, agent_id, agent_name)      │
│  │   └── websocket.send_json({type: "stream", delta, ...})     │
│  └── 执行完成后调用 save_session_message()                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  FlowRunner 层 (flow_compiler.py)                               │
│  ├── FlowRunner.run_from_json()                                 │
│  │   ├── stream_callback=stream_callback_with_collector        │
│  │   └── agent_memories=agent_memories                         │
│  └── CompiledFlow.run()                                         │
│      └── _execute_agent()                                       │
│          ├── agent.set_stream_callback(self._stream_callback)  │
│          └── agent.set_message_history(agent_memory)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  SoloAgent 层 (agent.py)                                        │
│  ├── set_stream_callback(callback)                              │
│  │   └── self._stream_callback = callback                      │
│  │   └── self._core.stream_callback = callback                 │
│  │   └── 传递给所有 SubAgent                                    │
│  └── TaskTool 初始化                                            │
│      └── TaskTool(parent_agent=self, subagents_info=...)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  TaskTool 层 (task.py)                                          │
│  ├── execute(subagent_name, task)                               │
│  │   ├── subagent.set_stream_callback(parent_agent._stream_callback) │
│  │   └── result = await subagent.reply(task)                   │
│  │       └── SubAgent 通过 stream_callback 发送消息            │
│  └── 返回 {success, subagent_name, result}                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 关键发现

1. **统一存储路径**：MainAgent 和 SubAgent 都通过 `stream_callback` 发送消息到 `ChunkCollector`
2. **agent_id 区分**：`ChunkCollector.add_chunk(delta, agent_id, agent_name)` 按 agent_id 分组
3. **SubAgent 消息自动存储**：TaskTool 传递 `stream_callback` 给 SubAgent，SubAgent 的消息自动被收集
4. **parent_message_id 关联**：保存消息时关联到触发 SubAgent 的 MainAgent 消息

---

## 三、核心组件详解

### 3.1 ChunkCollector

**位置**：`backend/app/api/v1/run.py`

**职责**：
- 收集流式chunk并合并
- 按 agent_id 分组管理数据
- 支持多种 chunk 类型（content, reasoning_content, tool_calls）

**核心方法**：

```python
class ChunkCollector:
    def __init__(self):
        self._chunks = []
        self._agent_data = {}
        self._current_agent_id = None
        self._current_agent_name = None
        self._current_block = {}
    
    def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
        """添加chunk，支持agent_id分组"""
        # 切换 agent 时保存当前块
        if agent_id and agent_id != self._current_agent_id:
            if self._current_block and self._current_agent_id:
                self._agent_data[self._current_agent_id]['data'].append(self._current_block)
                self._current_block = {}
            self._current_agent_id = agent_id
            self._current_agent_name = agent_name
        
        # 按 chunk 类型合并
        chunk_type = self._normalize_type(delta)
        # ... 合并逻辑
    
    def get_agent_data(self) -> dict:
        """获取按 agent_id 分组的数据"""
        return self._agent_data
```

### 3.2 save_session_message

**位置**：`backend/app/api/v1/run.py`

**职责**：
- 保存消息到 `session_messages` 表
- 支持 agent_id、parent_message_id 关联
- 支持 tokens 记录

**核心参数**：

```python
async def save_session_message(
    db: Session, 
    session_id: str, 
    user_id: str, 
    role: str,
    data: list,              # 消息数据列表
    status: str = "completed",
    agent_id: str = "default",  # Agent ID
    tokens: dict = None,
    agentic_flow_id: str = None,
    run_project_id: str = None,
    parent_message_id: str = None  # 父消息ID
):
```

### 3.3 load_and_distribute_memories

**位置**：`backend/app/api/v1/run.py`

**职责**：
- 从数据库读取记忆
- 按 agent_id 分发

**返回格式**：

```python
async def load_and_distribute_memories(
    db: Session, 
    session_id: str, 
    user_id: str
) -> Dict[str, List[Dict]]:
    """返回按 agent_id 分组的记忆"""
    agent_memories = {
        "main_agent_id": [
            {"role": "user", "content": [...], "agent_id": "main_agent_id"},
            {"role": "assistant", "content": [...], "agent_id": "main_agent_id"},
        ],
        "sub_agent_id": [
            {"role": "user", "content": [...], "agent_id": "sub_agent_id"},
            {"role": "assistant", "content": [...], "agent_id": "sub_agent_id"},
        ]
    }
    return agent_memories
```

### 3.4 TaskTool

**位置**：`backend/SoloAgent/plugins/tools/agent/task.py`

**职责**：
- 调用 SubAgent 处理任务
- 传递 stream_callback 给 SubAgent
- 发送 subagent_start/subagent_complete 事件

**核心逻辑**：

```python
class TaskTool(BaseAgentTool):
    async def execute(self, subagent_name: str, task: str, **kwargs) -> Dict[str, Any]:
        # 1. 获取 SubAgent 实例
        subagent = self._parent_agent.get_subagent(subagent_id)
        
        # 2. 传递 stream_callback（关键！）
        if hasattr(self._parent_agent, '_stream_callback') and self._parent_agent._stream_callback:
            subagent.set_stream_callback(self._parent_agent._stream_callback)
        
        # 3. 发送 subagent_start 事件
        self._send_event("subagent_start", subagent_id, subagent_name)
        
        # 4. 执行 SubAgent（消息自动通过 stream_callback 发送）
        result = await subagent.reply(task)
        
        # 5. 发送 subagent_complete 事件
        self._send_event("subagent_complete", subagent_id, subagent_name)
        
        # 6. 返回结果
        return {"success": True, "subagent_name": subagent_name, "result": content}
```

---

## 四、数据存储结构

### 4.1 session_messages 表结构

```
SessionMessageModel:
  - id: 主键
  - session_id: 会话ID
  - user_id: 用户ID
  - agent_id: Agent ID（区分 MainAgent 和 SubAgent）
  - role: 角色（user/assistant）
  - data: 消息数据列表（JSON）
  - status: 状态（completed/stop/error）
  - message_index: 消息序号
  - parent_message_id: 父消息ID（SubAgent 消息关联到 MainAgent）
  - prompt_tokens: 输入token数
  - completion_tokens: 输出token数
  - total_tokens: 总token数
  - created_at: 创建时间
```

### 4.2 完整消息存储示例

```
┌─────────────────────────────────────────────────────────────────┐
│  session_messages 表                                             │
│                                                                  │
│  ════════════════════════════════════════════════════════════   │
│  MainAgent (agent_id: "node_main_001")                          │
│  ════════════════════════════════════════════════════════════   │
│                                                                  │
│  msg_1: role=user, agent_id="node_main_001"                    │
│  data: [{type: "content", content: "帮我搜索相关文件"}]          │
│  parent_message_id: null                                        │
│                                                                  │
│  msg_2: role=assistant, agent_id="node_main_001"               │
│  data: [                                                        │
│    {type: "content", content: "让我帮你搜索..."},               │
│    {type: "tool_calls", tool_calls: [{                         │
│      id: "call_123", name: "Task",                              │
│      function: {name: "Task", arguments: {...}}                 │
│    }]}                                                          │
│  ]                                                              │
│  parent_message_id: null                                        │
│                                                                  │
│  msg_3: role=assistant, agent_id="node_main_001"               │
│  data: [{type: "tool_calls", tool_calls: [{                    │
│    id: "call_123", result: "找到了3个相关文件..."               │
│  }]}]                                                           │
│  parent_message_id: null                                        │
│                                                                  │
│  ════════════════════════════════════════════════════════════   │
│  SubAgent (agent_id: "node_search_001")                         │
│  ════════════════════════════════════════════════════════════   │
│                                                                  │
│  msg_4: role=assistant, agent_id="node_search_001"             │
│  data: [                                                        │
│    {type: "reasoning_content", reasoning_content: "让我搜索..."},│
│    {type: "tool_calls", tool_calls: [...]},                     │
│    {type: "content", content: "找到了3个相关文件..."}           │
│  ]                                                              │
│  parent_message_id: "msg_2"  ← 关联到 MainAgent 的消息          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、消息存储流程

### 5.1 完整存储流程

```
WebSocket 接收 execute 请求
├── 1. 创建 ChunkCollector
├── 2. 定义 stream_callback_with_collector
│   ├── collector.add_chunk(delta, agent_id, agent_name)
│   └── websocket.send_json({type: "stream", delta, agent_id, ...})
├── 3. 保存 user 消息
│   └── save_session_message(role="user", data=[...], agent_id="default")
├── 4. 执行 FlowRunner.run_from_json
│   ├── stream_callback=stream_callback_with_collector
│   └── agent_memories=agent_memories
│   └── CompiledFlow.run()
│       └── _execute_agent(agent)
│           ├── agent.set_stream_callback(stream_callback)
│           └── agent.reply(input_message)
│               └── ReActCore.reply()
│                   └── stream_callback(delta, agent_id, agent_name)
│                       └── ChunkCollector.add_chunk()
│               └── TaskTool.execute() (如果调用 SubAgent)
│                   └── subagent.set_stream_callback(parent_stream_callback)
│                   └── subagent.reply(task)
│                       └── SubAgent 消息通过 stream_callback 发送
│                           └── ChunkCollector.add_chunk(delta, subagent_id, ...)
├── 5. 执行完成，获取 agent_data
│   └── agent_data = collector.get_agent_data()
├── 6. 保存各 agent 的消息
│   └── for agent_id, agent_info in agent_data.items():
│       └── save_session_message(
│           role="assistant", 
│           data=agent_info['data'],
│           agent_id=agent_id,
│           parent_message_id=last_user_message_id  # SubAgent 关联
│       )
└── 7. 更新 session 状态
```

### 5.2 SubAgent 消息存储关键点

**TaskTool.execute() 中的关键代码**：

```python
# 传递 stream_callback 给 SubAgent
if hasattr(self._parent_agent, '_stream_callback') and self._parent_agent._stream_callback:
    subagent.set_stream_callback(self._parent_agent._stream_callback)

# SubAgent 执行时，消息自动通过 stream_callback 发送到 ChunkCollector
result = await subagent.reply(task)
```

**存储时机**：
- WebSocket 执行完成后统一保存
- 按 agent_id 分组保存
- SubAgent 消息关联到 MainAgent 的 parent_message_id

---

## 六、上下文构建流程

### 6.1 load_and_distribute_memories 流程

```python
async def load_and_distribute_memories(db, session_id, user_id) -> Dict[str, List[Dict]]:
    # 1. 查询所有消息
    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id
    ).order_by(SessionMessageModel.message_index).all()
    
    # 2. 按 agent_id 分组
    agent_memories = {}
    shared_memories = []
    
    for record in records:
        message = {
            "role": record.role,
            "content": record.data,
            "agent_id": record.agent_id
        }
        
        if record.agent_id and record.agent_id != "default":
            if record.agent_id not in agent_memories:
                agent_memories[record.agent_id] = []
            agent_memories[record.agent_id].append(message)
        else:
            shared_memories.append(message)
    
    # 3. 共享记忆添加到各 agent
    for agent_id in agent_memories:
        agent_memories[agent_id] = shared_memories + agent_memories[agent_id]
    
    return agent_memories
```

### 6.2 CompiledFlow 执行流程

```python
# flow_compiler.py - CompiledFlow._execute_agent()
async def _execute_agent(self, agent, input_message, db, context, cancel_event):
    # 1. 设置 stream_callback
    if self._stream_callback and hasattr(agent, 'set_stream_callback'):
        agent.set_stream_callback(self._stream_callback)
    
    # 2. 设置 message_history（从 agent_memories 获取）
    agent_memory = self._agent_memories.get(agent_id, [])
    if agent_memory and hasattr(agent, 'set_message_history'):
        agent.set_message_history(agent_memory)
    
    # 3. 执行 agent
    response = await agent.reply(input_message)
    
    return result
```

---

## 七、关键关联说明

### 7.1 字段关联

| 字段 | MainAgent | SubAgent |
|------|-----------|----------|
| `agent_id` | 节点ID（如 `node_main_001`） | 节点ID（如 `node_search_001`） |
| `parent_message_id` | null | MainAgent 触发 SubAgent 的消息ID |

### 7.2 关联逻辑

- `parent_message_id` 关联到 MainAgent 的 session_message_id
- 关联到触发 SubAgent 的那条消息（MainAgent 调用 Task 的消息）
- 上下文追溯：通过 `agent_id` 分组，每个 Agent 独立加载自己的记忆

---

## 八、核心优势

| 维度 | 设计 |
|------|------|
| **存储路径** | 统一使用 stream_callback + ChunkCollector |
| **数据冗余** | 无冗余，SubAgent 消息独立存储 |
| **数据一致性** | 单一数据源（session_messages 表） |
| **流式输出** | MainAgent 和 SubAgent 都支持流式 |
| **前端实时显示** | 通过 WebSocket 实时推送 |
| **上下文构建** | agent_memories 自动按 agent_id 分组 |
| **存储效率** | 最优，一次执行一次保存 |

---

## 九、当前存储机制总结

### 9.1 存储规则

- MainAgent 消息：`agent_id = 节点ID`
- SubAgent 消息：`agent_id = SubAgent节点ID`，`parent_message_id` 关联到 MainAgent
- `load_and_distribute_memories()` 按 `agent_id` 分组加载
- 每个 Agent 执行时获取自己的记忆

### 9.2 关键实现点

1. **消息存储**：通过 `stream_callback` + `ChunkCollector` 机制，MainAgent 和 SubAgent 使用相同的存储路径
2. **agent_id 设置**：Agent 在初始化时设置 `agent_id`（来自节点ID）
3. **parent_message_id 设置**：WebSocket 保存消息时，SubAgent 消息关联到 MainAgent 的消息
4. **上下文隔离**：通过 `agent_memories` 按 `agent_id` 分组，实现上下文隔离

### 9.3 与旧方案的区别

| 维度 | 旧方案（文档描述） | 当前实现 |
|------|-------------------|----------|
| 存储路径 | agent_memories 机制 | stream_callback + ChunkCollector |
| 存储时机 | SubAgent.reply() 后自动存储 | WebSocket 执行完成后统一保存 |
| agent_id 来源 | 硬编码（main_001, sub_search_001） | 节点ID（node_xxx） |
| 消息收集 | 无明确机制 | ChunkCollector 按 agent_id 分组 |

---

## 十、验收标准

### 10.1 存储功能验收

- [ ] MainAgent 消息正确存储（agent_id = 节点ID）
- [ ] SubAgent 消息正确存储（agent_id = SubAgent节点ID）
- [ ] parent_message_id 正确关联
- [ ] ChunkCollector 正确按 agent_id 分组

### 10.2 上下文隔离验收

- [ ] MainAgent 上下文不包含 SubAgent 消息
- [ ] SubAgent 上下文独立加载
- [ ] 多轮对话上下文正确累积

### 10.3 数据一致性验收

- [ ] 无数据冗余
- [ ] 无数据丢失
- [ ] 消息关联关系正确
