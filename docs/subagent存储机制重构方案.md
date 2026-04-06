# SubAgent 存储机制重构方案

## 一、重构目标

1. session\_message列表，添加 `parent_agent_id` 字段，实现 SubAgent 消息与 MainAgent 的关联
2. Task 返回值增加 `subagent_id` 字段，用于前端追溯
3. **TaskTool 返回值结构统一**：将 `result` 改为 `content`，与其他工具保持一致（tasktool其他部分一个字都不改）
4. **过滤模式**：`tool_calls[].result` 存储完整返回值，传递给模型时只提取 `content` 字段（run.py存储数据时，存储tool调用的完整json；读取session\_messaage 拼接模型上下文时自动解析 JSON，只保留 `content` 字段）

***

## 二、当前问题

| 问题               | 描述                                        |
| ---------------- | ----------------------------------------- |
| 无法追溯 SubAgent 来源 | 所有 Agent 消息的 `parent_message_id` 都关联到用户消息 |
| 前端无法关联 SubAgent  | Task 返回值缺少 `subagent_id`，前端无法追溯           |
| 数据库字段缺失          | 缺少 `parent_agent_id` 字段，无法实现多级嵌套          |
| **返回值结构不一致**     | TaskTool 用 `result` 字段，其他工具用 `content` 字段 |

***

## 三、核心设计

### 3.1 TaskTool 返回值结构（修改后）

**完整的 JSON 返回值：**

```json
{
  "success": true,
  "subagent_name": "测试节点",
  "subagent_id": "node_1774589427136",
  "content": "根据test skill的指示，计算结果为：1+1=3",
  "metadata": {"execution_time": "2026-03-28T17:01:29.588486+00:00"}
}
```

**字段说明：**

| 字段             | 类型      | 说明                          |
| -------------- | ------- | --------------------------- |
| success        | boolean | 执行是否成功                      |
| subagent\_name | string  | SubAgent 名称                 |
| subagent\_id   | string  | SubAgent 的 agent\_id，用于前端追溯 |
| content        | string  | SubAgent 的输出内容，传递给模型        |

**与其他工具保持一致：**

| 工具                | 返回值结构                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| Read              | `{"content": "文件内容...", "success": True, ...}`                        |
| Write             | `{"content": "文件写入成功...", "success": True, ...}`                      |
| **TaskTool（修改后）** | `{"content": "SubAgent输出...", "success": True, "subagent_id": "..."}` |

### 3.2 过滤模式

**核心原则：**

- **存储**：`tool_calls[].result` 存储完整的工具返回值（JSON 对象）
- **传递**：传递给模型作为上下文时，只提取 `content` 字段

**数据流：**

```
TaskTool.execute() 返回:
{
  "success": true,
  "subagent_name": "测试节点",
  "subagent_id": "node_1774589427136",
  "content": "根据test skill的指示...",
  "metadata": {"execution_time": "2026-03-28T17:01:29.588486+00:00"}
}
    ↓
存储到 tool_calls[].result（完整JSON）:
{
  "success": true,
  "subagent_name": "测试节点",
  "subagent_id": "node_1774589427136",
  "content": "根据test skill的指示...",
  "metadata": {"execution_time": "2026-03-28T17:01:29.588486+00:00"}
}
    ↓
传递给模型作为上下文:
"根据test skill的指示..."  # 只有 content 字段
```

### 3.3 过滤模式应用位置

**只在 run.py 的** **`load_and_distribute_memories()`** **中处理：**

- 读取 session\_message 时，过滤 tool\_calls\[].result
- 提取 content 字段后传递给模型

### 3.4 parent\_agent\_id 获取方式

**TaskTool 有** **`self._parent_agent`** **属性**，可以直接获取：

- `self._parent_agent.agent_id` 就是 `parent_agent_id`
- SubAgent 的 `agent_id` 就是 `subagent_id`

***

## 四、执行步骤

**按照以下顺序执行：**

1. **数据库迁移**
   - 添加 `parent_agent_id` 字段
2. **修改 SessionMessageModel**
   - 添加 `parent_agent_id` 字段
3. **修改 TaskTool.execute()**
   - 返回值 `result` 改为 `content`
   - 添加 `subagent_id` 字段
4. **修改 ReActCore.\_acting()**
   - 存储完整JSON到 `tool_calls[].result`
   - 传递给模型的只有 `content` 字段
5. **修改 run.py**
   - `load_and_distribute_memories()` 应用过滤模式
   - 消息存储逻辑添加 `parent_agent_id` 参数
6. **测试验证**

***

## 五、数据库模型修改（执行步骤1-2）

### 5.1 SessionMessageModel 修改

**文件：** `backend/app/core/database.py`

**添加字段：**

```python
parent_agent_id = Column(String(36), nullable=True, index=True)  # 新增：父 Agent ID
```

### 5.2 数据库迁移

```sql
ALTER TABLE session_messages ADD COLUMN parent_agent_id VARCHAR(36);
CREATE INDEX ix_session_messages_parent_agent_id ON session_messages(parent_agent_id);
```

***

## 六、TaskTool 修改（执行步骤3）

### 6.1 修改返回值

**文件：** `backend/SoloAgent/plugins/tools/agent/task.py`

**当前返回值（第 204-208 行）：**

```python
return {
    "success": True,
    "subagent_name": subagent_name,
    "result": content,
    'metadata': {'execution_time': '2026-03-28T17:01:29.588486+00:00'}
}
```

**修改后返回值：**

```python
return {
    "success": True,
    "subagent_name": subagent_name,
    "subagent_id": subagent.agent_id,  # 新增：用于前端追溯
    "content": content,  # 修改：result key 改为 content key，与其他工具保持一致
    'metadata': {'execution_time': '2026-03-28T17:01:29.588486+00:00'}
}
```

***

## 七、ReActCore 修改（执行步骤4）

### 7.1 修改 on\_tool\_call\_result 发送的数据

**文件：** `backend/SoloAgent/core/react_core.py`

**当前代码（第 959-987 行）：**

```python
result = await self.tool_executor.execute(tool_call)
result_content = result.get("content", str(result)) if isinstance(result, dict) else str(result)

# 使用 ToolCallEventManager 发送 TOOL_CALL_RESULT
self._tool_call_event_manager.on_tool_call_result(
    tool_call_id=tool_call.get("id"),
    result=result_content  # ❌ 发送的是字符串
)

# ...

self._last_tool_results.append({
    "name": tool_call.get("name"),
    "args": tool_call.get("arguments", {}),
    "result": result_content,  # ❌ 存储的是字符串
    "full_result": result,
})
```

**修改后：**

```python
result = await self.tool_executor.execute(tool_call)
result_content = result.get("content", str(result)) if isinstance(result, dict) else str(result)

# 使用 ToolCallEventManager 发送 TOOL_CALL_RESULT
self._tool_call_event_manager.on_tool_call_result(
    tool_call_id=tool_call.get("id"),
    result=result  # 完整JSON对象，ChunkCollector会存储到数据库
)

# ...

self._last_tool_results.append({
    "name": tool_call.get("name"),
    "args": tool_call.get("arguments", {}),
    "result": result,  # 完整JSON对象，flow_compiler会发送给前端
})
```

**说明：**

- `result` 是工具的完整返回值（JSON 对象）
- `result_content` 仍然只包含 `content` 字段（用于传递给模型，不需要修改）
- **只修改发送给 ChunkCollector 和存储到** **`_last_tool_results`** **的数据**
- 删除 `full_result` 字段，因为 `result` 已经是完整 JSON

***

## 八、run.py 修改（执行步骤5）

### 8.1 历史信息读取修改 - load\_and\_distribute\_memories() 函数修改

**文件：** `backend/app/api/v1/run.py`

**当前代码（第 302-342 行）：**

```python
async def load_and_distribute_memories(
    db: Session,
    session_id: str,
    user_id: str
) -> Dict[str, List[Dict]]:
    """从数据库读取记忆并按 agent_id 分发"""
    from app.core.database import SessionMessageModel
    
    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id
    ).order_by(SessionMessageModel.message_index).all()
    
    agent_memories = {}
    shared_memories = []
    
    for record in records:
        data = record.data or []
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                data = []
        message = {
            "role": record.role,
            "content": data,  # ❌ 直接使用 data，没有应用过滤模式
            "agent_id": record.agent_id
        }
        
        if record.agent_id and record.agent_id != "default":
            if record.agent_id not in agent_memories:
                agent_memories[record.agent_id] = []
            agent_memories[record.agent_id].append(message)
        else:
            shared_memories.append(message)
    
    for agent_id in agent_memories:
        agent_memories[agent_id] = shared_memories + agent_memories[agent_id]
    
    if not agent_memories and shared_memories:
        agent_memories["default"] = shared_memories
    
    return agent_memories
```

**修改后：**

```python
async def load_and_distribute_memories(
    db: Session,
    session_id: str,
    user_id: str
) -> Dict[str, List[Dict]]:
    """从数据库读取记忆并按 agent_id 分发
    
    应用过滤模式：tool_calls[].result 中的完整 JSON 只提取 content 字段
    """
    from app.core.database import SessionMessageModel
    
    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id
    ).order_by(SessionMessageModel.message_index).all()
    
    agent_memories = {}
    shared_memories = []
    
    for record in records:
        data = record.data or []
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                data = []
        
        # 应用过滤模式：提取 tool_calls[].result 中的 content 字段
        filtered_data = _filter_tool_results(data)
        
        message = {
            "role": record.role,
            "content": filtered_data,
            "agent_id": record.agent_id
        }
        
        if record.agent_id and record.agent_id != "default":
            if record.agent_id not in agent_memories:
                agent_memories[record.agent_id] = []
            agent_memories[record.agent_id].append(message)
        else:
            shared_memories.append(message)
    
    for agent_id in agent_memories:
        agent_memories[agent_id] = shared_memories + agent_memories[agent_id]
    
    if not agent_memories and shared_memories:
        agent_memories["default"] = shared_memories
    
    return agent_memories


def _filter_tool_results(data: list) -> list:
    """
    过滤 tool_calls 中的 result，提取 content 字段。
    
    当 tool_calls[].result 是 dict 时，只提取 content 字段传递给模型。
    这样模型上下文中只包含 content 字段，而数据库中存储完整 JSON。
    
    Args:
        data (list): 消息数据块列表。
    
    Returns:
        list: 过滤后的数据块列表。
    """
    if not isinstance(data, list):
        return data
    
    filtered = []
    for block in data:
        if not isinstance(block, dict):
            filtered.append(block)
            continue
            
        if block.get("type") == "tool_calls":
            filtered_block = {"type": "tool_calls", "tool_calls": []}
            for tc in block.get("tool_calls", []):
                filtered_tc = tc.copy()
                # 如果 result 是 dict，提取 content 字段
                if "result" in tc and isinstance(tc["result"], dict):
                    if "content" in tc["result"]:
                        filtered_tc["result"] = tc["result"]["content"]
                    elif "result" in tc["result"]:
                        # 兼容旧格式
                        filtered_tc["result"] = tc["result"]["result"]
                filtered_block["tool_calls"].append(filtered_tc)
            filtered.append(filtered_block)
        else:
            filtered.append(block)
    return filtered
```

### 8.2 消息存储逻辑修改 - save\_session\_message 函数签名

**文件：** `backend/app/api/v1/run.py`

**添加 parent\_agent\_id 参数：**

```python
async def save_session_message(
    db: Session, session_id: str, user_id: str, role: str,
    data: list, status: str = "completed", agent_id: str = "default",
    tokens: dict = None,
    agentic_flow_id: str = None,
    run_project_id: str = None,
    parent_message_id: str = None,
    parent_agent_id: str = None  # 新增
):
```

### 8.3 消息存储循环修改

**文件：** `backend/app/api/v1/run.py`

**修改位置：** 第 1357-1369 行

```python
if agent_data:
    main_agent_id = None
    
    for agent_id_key, agent_info in agent_data.items():
        data_to_save = agent_info['data']
        if not data_to_save:
            data_to_save = []
        
        # 确定 parent_agent_id
        if main_agent_id is None:
            main_agent_id = agent_id_key
            parent_agent_id = None
        else:
            parent_agent_id = main_agent_id
        
        await save_session_message(
            db=db, session_id=session_id, user_id=user_id,
            role="assistant", data=data_to_save, status=status, agent_id=agent_id_key,
            tokens=tokens,
            agentic_flow_id=agentic_flow_id, run_project_id=run_project_id,
            parent_message_id=last_user_message_id,
            parent_agent_id=parent_agent_id
        )
```

***

## 九、前端获取 subagent\_id

**无需额外修改代码。**

修改 `_last_tool_results[].result` 存储完整 JSON 后，`ExecutionEvent.tool_result` 会自动获得完整 JSON 数据，前端通过 WebSocket 即可获取 `subagent_id`。

***

## 十、目标数据结构

**session\_messages 表结构：**

| 字段                | 类型          | 说明                     |
| ----------------- | ----------- | ---------------------- |
| agent\_id         | VARCHAR(36) | Agent ID（node\_xxx 格式） |
| parent\_agent\_id | VARCHAR(36) | 父 Agent ID（新增）         |
| data              | JSON        | 消息数据                   |

**data 字段中的 tool\_calls：**

```json
{
  "type": "tool_calls",
  "tool_calls": [
    {
      "id": "call_123",
      "name": "Task",
      "result": {
        "success": true,
        "subagent_name": "测试节点",
        "subagent_id": "node_1774589427136",
        "content": "根据test skill的指示，计算结果为：1+1=3",
        "metadata": {
          "execution_time": "2026-03-28T17:01:29.588Z"
        }
      }
    }
  ]
}
```

**前端追溯方式**：

1. 从 `tool_calls[].result` 获取完整JSON
2. 获取 `subagent_id` 字段
3. 通过 `subagent_id+parent_agent_id` 筛选+查询 SubAgent 的消息

**目标存储关系：**

```
MainAgent (agent_id: "node_main")
├── parent_agent_id: None
│
└── SubAgent (agent_id: "node_sub")
    └── parent_agent_id: "node_main"
```

***

## 十一、验收标准

- [ ] 数据库添加 `parent_agent_id` 字段
- [ ] TaskTool 返回值 `result` 改为 `content`
- [ ] TaskTool 返回值包含 `subagent_id`
- [ ] `tool_calls[].result` 存储完整JSON
- [ ] 模型上下文只包含 `content` 字段
- [ ] 历史信息读取时应用过滤模式（run.py）
- [ ] SubAgent 消息的 `parent_agent_id` 关联到 MainAgent
- [ ] 前端可通过 `tool_calls[].result.subagent_id` 追溯 SubAgent

***

## 十二、涉及文件

| 文件                                              | 修改内容                                                                 | 类型    |
| ----------------------------------------------- | -------------------------------------------------------------------- | ----- |
| `backend/app/core/database.py`                  | SessionMessageModel 添加 `parent_agent_id` 字段                          | 数据库模型 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | TaskTool 返回值 `result` 改为 `content`，添加 `subagent_id`                  | 核心修改  |
| `backend/SoloAgent/core/react_core.py`          | `_acting()` 存储完整JSON，传递给模型只有 `content`                               | 核心修改  |
| `backend/app/api/v1/run.py`                     | `load_and_distribute_memories()` 应用过滤模式 + 消息存储逻辑添加 `parent_agent_id` | 核心修改  |

***

## 十三、return\_intermediate\_steps 参数

### 13.1 功能说明

参考 LangChain AgentExecutor 的 `return_intermediate_steps=True` 参数，添加类似功能：

- **默认值：`false`** - TaskTool 返回值的 `content` 字段只包含最终结果文本
- **设置为** **`true`** - TaskTool 返回值的 `content` 字段包含完整的模型调用流程（和 agent 存储的数据一样）

### 13.2 .env 配置

```env
# SubAgent 返回中间步骤
# false: content 只包含最终结果文本（默认）
# true: content 包含完整的模型调用流程（content, reasoning_content, tool_calls）
RETURN_INTERMEDIATE_STEPS=false
```

### 13.3 TaskTool 返回值结构

**返回值结构（无论 true 或 false）：**

```json
{
  "success": true,
  "subagent_name": "测试节点",
  "subagent_id": "node_1774589427136",
  "content": "..."
}
```

**content 字段内容差异：**

| 配置值                                   | content 字段内容                          |
| ------------------------------------- | ------------------------------------- |
| `RETURN_INTERMEDIATE_STEPS=false`（默认） | `"根据test skill的指示，计算结果为：1+1=3"` （纯文本） |
| `RETURN_INTERMEDIATE_STEPS=true`      | 完整的模型调用流程，和 agent 存储的数据一样             |

**RETURN\_INTERMEDIATE\_STEPS=true 时，content 字段结构：**

```json
{
  "content": "根据test skill的指示，计算结果为：1+1=3",
  "reasoning_content": "让我分析一下...",
  "tool_calls": [
    {
      "id": "call_123",
      "name": "read",
      "result": "文件内容..."
    }
  ]
}
```

### 13.4 修改文件

**文件：** `backend/SoloAgent/plugins/tools/agent/task.py`

**当前获取返回值的流程：**

1. `result = await subagent.reply(task)` 返回的是 **字符串**（response_text）
2. `subagent.reply()` 内部：
   - `response = await self._core.reply(message)` - 返回 Msg 对象
   - `self._last_response = response` - 存储完整的 Msg 对象
   - `self._last_tool_calls = self._core._last_tool_results.copy()` - 存储工具调用结果
   - `response_text = response.get_text_content()` - 提取文本内容
   - `return response_text` - 返回字符串

**SoloAgent 可用的数据：**

| 属性/方法 | 类型 | 说明 |
| --- | --- | --- |
| `_last_response` | Msg 对象 | 完整的响应消息 |
| `_last_tool_calls` | List[Dict] | 工具调用结果列表 |
| `get_last_openai_message()` | dict | 返回 OpenAI 格式消息，包含 content、reasoning_content |

**修改位置：** execute() 方法返回值部分

```python
import os

# 读取配置
RETURN_INTERMEDIATE_STEPS = os.getenv("RETURN_INTERMEDIATE_STEPS", "false").lower() == "true"

# 在构建返回值时
if RETURN_INTERMEDIATE_STEPS:
    # content 包含完整的模型调用流程
    openai_msg = subagent.get_last_openai_message()
    content = {
        "content": openai_msg.get("content", ""),
        "reasoning_content": openai_msg.get("reasoning_content"),
        "tool_calls": subagent._last_tool_calls
    }
else:
    # content 只包含最终结果文本
    content = final_content

return {
    "success": True,
    "subagent_name": subagent_name,
    "subagent_id": subagent.agent_id,
    "content": content
}
```

### 13.5 涉及文件

| 文件                                              | 修改内容                                 |
| ----------------------------------------------- | ------------------------------------ |
| `.env`                                          | 添加 `RETURN_INTERMEDIATE_STEPS=false` |
| `backend/SoloAgent/plugins/tools/agent/task.py` | 根据配置决定 content 字段内容                  |

