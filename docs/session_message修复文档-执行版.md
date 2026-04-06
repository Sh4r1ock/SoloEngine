# session_message修复方案 - 执行版

## 一、设计理念（遵循四层架构）

```
AgenticFlow实例层（run.py） → 负责模型记忆读取、存储、session创建、隔离管理
Compiler层 (flow_compiler.py) → 编译并执行flow，协调多个agent
SoloAgent (agent.py) → 基于ReActCore基类，负责组装各项plugins  
ReActCore基类 (react_core.py) → 只负责接收数据、运行，处理LLM调用  
LLM API
```

---

## 二、执行内容总览

### 2.1 新增代码

| 文件 | 新增内容 | 位置 |
|------|----------|------|
| `run.py` | `ChunkCollector`类 | 文件开头 |
| `run.py` | `save_session_message`函数 | 文件开头 |
| `run.py` | `load_and_distribute_memories`函数 | 文件开头 |
| `run.py` | `_extract_content_from_data`函数 | 文件开头 |
| `flow_compiler.py` | `set_agent_memories`方法 | CompiledFlow类中 |
| `flow_compiler.py` | `_agent_memories`属性 | `__init__`中 |

### 2.2 修改代码

| 文件 | 修改内容 | 位置 |
|------|----------|------|
| `react_core.py` | `__init__`增加agent_id参数 | 第190行 |
| `react_core.py` | stream_callback调用增加agent_id | 第498、513、680行 |
| `agent.py` | `set_stream_callback`注入agent_id | 第79行 |
| `flow_compiler.py` | 简化`set_stream_callback` | 第110行 |
| `flow_compiler.py` | `_execute_agent`从_agent_memories获取记忆 | 第446行 |
| `flow_compiler.py` | `run()`移除记忆初始化逻辑 | 第283行 |
| `run.py` | `stream_callback`签名修改 | 第254、724行 |
| `run.py` | `run_websocket`添加记忆读取、收集、存储逻辑 | 第670行 |
| `database.py` | `SessionMessageModel.agent_id`字段约束 | 第182行 |
| `database.py` | `SessionMessageModel.data`字段约束 | 第185行 |
| `database.py` | `add_session_message`参数默认值 | 第698行 |
| `database_memory.py` | `_save_message_to_database`字段处理 | 第190行 |

### 2.3 删除代码

| 文件 | 删除内容 | 位置 |
|------|----------|------|
| `flow_compiler.py` | `_session_memory`属性 | 第80行 |
| `flow_compiler.py` | `_message_saved`属性 | 第82行 |
| `flow_compiler.py` | `_accumulated_data`属性 | 第83行 |
| `flow_compiler.py` | `_current_block`属性 | 第84行 |
| `flow_compiler.py` | `reset_accumulated_content()`方法 | 第86-90行 |
| `flow_compiler.py` | `get_accumulated_data()`方法 | 第92-99行 |
| `flow_compiler.py` | `get_accumulated_content()`方法 | 第101-107行 |
| `flow_compiler.py` | `set_stream_callback()`中的累积逻辑 | 第110-164行 |
| `flow_compiler.py` | `_init_session_memory()`方法 | 第200-226行 |
| `flow_compiler.py` | `_save_message_to_memory()`方法 | 第229-261行 |
| `flow_compiler.py` | `_get_message_history()`方法 | 第263-271行 |
| `flow_compiler.py` | `run()`中的存储逻辑 | 第283-360行 |
| `flow_compiler.py` | `_execute_agent()`中的存储逻辑 | 第505-556行 |
| `flow_compiler.py` | `cached._session_memory = None` | 第856行 |
| `flow_compiler.py` | `run_node()`中的存储逻辑 | 第1218-1298行 |
| `database_memory.py` | `retrieve_all`方法 | 第312行 |

---

## 三、待删除代码配套调用分析

以下分析每个待删除函数/属性的所有调用位置，确保删除时不会遗漏：

### 3.1 `reset_accumulated_content()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:86-90 | `def reset_accumulated_content(self):` |
| 调用 | flow_compiler.py:1218 | `compiled_flow.reset_accumulated_content()` |

**操作**：删除定义和调用。

### 3.2 `get_accumulated_data()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:92-99 | `def get_accumulated_data(self):` |
| 调用1 | flow_compiler.py:306 | `accumulated_data = self.get_accumulated_data()` |
| 调用2 | flow_compiler.py:1271 | `accumulated_data = compiled_flow.get_accumulated_data()` |

**操作**：删除定义和两处调用。

### 3.3 `get_accumulated_content()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:101-107 | `def get_accumulated_content(self):` |

**操作**：无调用，直接删除定义。

### 3.4 `_init_session_memory()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:200-226 | `async def _init_session_memory(self):` |
| 调用1 | flow_compiler.py:283 | `await self._init_session_memory()` |
| 调用2 | flow_compiler.py:1224 | `await compiled_flow._init_session_memory()` |

**操作**：删除定义和两处调用。记忆初始化移至AgenticFlow实例层。

### 3.5 `_save_message_to_memory()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:229-261 | `async def _save_message_to_memory(...):` |
| 调用1 | flow_compiler.py:286 | `await self._save_message_to_memory("user", user_data)` |
| 调用2 | flow_compiler.py:352 | `await self._save_message_to_memory("assistant", assistant_data, tokens)` |
| 调用3 | flow_compiler.py:556 | `await self._save_message_to_memory(...)` |
| 调用4 | flow_compiler.py:1235 | `await compiled_flow._save_message_to_memory("user", ...)` |
| 调用5 | flow_compiler.py:1252 | `await compiled_flow._save_message_to_memory("assistant", ...)` |
| 调用6 | flow_compiler.py:1298 | `await compiled_flow._save_message_to_memory("assistant", ...)` |

**操作**：删除定义和6处调用。消息存储移至AgenticFlow实例层。

### 3.6 `_get_message_history()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:263-271 | `async def _get_message_history(self):` |
| 调用 | flow_compiler.py:446 | `message_history = await self._get_message_history()` |

**操作**：删除定义和调用，改为从`_agent_memories`获取。

**注意**：原文档第31行写的是`_get_session_messages()`，实际方法名是`_get_message_history()`。

### 3.7 `_session_memory` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:80 | `self._session_memory = None` |
| 使用1 | flow_compiler.py:200 | `if not self._session_memory:` |
| 使用2 | flow_compiler.py:206 | `self._session_memory = DatabaseMemory(...)` |
| 使用3 | flow_compiler.py:222 | `message_count = self._session_memory.message_count` |
| 使用4 | flow_compiler.py:265 | `if not self._session_memory:` |
| 使用5 | flow_compiler.py:268 | `messages = await self._session_memory.retrieve_all()` |
| 使用6 | flow_compiler.py:856 | `cached._session_memory = None` |

**操作**：删除定义和6处使用。

### 3.8 `_message_saved` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:82 | `self._message_saved = False` |
| 使用1 | flow_compiler.py:350 | `if not self._message_saved:` |
| 使用2 | flow_compiler.py:351 | `self._message_saved = True` |
| 使用3 | flow_compiler.py:354 | `logger.info("Message already saved...")` |

**操作**：删除定义和3处使用。

### 3.9 `_accumulated_data` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:83 | `self._accumulated_data = []` |
| 使用1 | flow_compiler.py:95 | `return self._accumulated_data` |
| 使用2 | flow_compiler.py:103 | `for item in self._accumulated_data:` |
| 使用3 | flow_compiler.py:133 | `self._accumulated_data.append(self._current_block)` |
| 使用4 | flow_compiler.py:144 | `self._accumulated_data.append(self._current_block)` |
| 使用5 | flow_compiler.py:151 | `self._accumulated_data.append(self._current_block)` |
| 使用6 | flow_compiler.py:157 | `self._accumulated_data.append(tool_block)` |

**操作**：删除定义和6处使用。

### 3.10 `_current_block` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:84 | `self._current_block = None` |
| 使用1-13 | flow_compiler.py:88,103,131-159 | 多处使用 |

**操作**：删除定义和13处使用。

### 3.11 `set_stream_callback()` 方法（需简化）

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:110-164 | `def set_stream_callback(self, callback):` |
| 调用1 | flow_compiler.py:1176 | `compiled_flow.set_stream_callback(stream_callback)` |
| 调用2 | flow_compiler.py:1230 | `compiled_flow.set_stream_callback(...)` |

**操作**：简化方法（移除累积逻辑），保留回调设置功能，调用处保留。

---

## 四、具体执行步骤

### 4.1 第一阶段：ReActCore层修改

**文件**：`SoloAgent/core/react_core.py`

#### 4.1.1 新增agent_id属性

**位置**：第190行 `__init__`方法

```python
def __init__(
    self,
    name: str,
    model: ChatModelBase,
    formatter: FormatterBase,
    system_prompt: str,
    rag: Optional[IRAG] = None,
    tool_executor: Optional[IToolExecutor] = None,
    max_iters: int = 10,
    print_hint_msg: bool = False,
    stream_callback: Optional[callable] = None,
    agent_id: Optional[str] = None,  # 新增参数
) -> None:
    # ... 其他初始化 ...
    self.agent_id = agent_id or name  # 新增属性
```

#### 4.1.2 修改stream_callback调用

**位置**：第498行、第513行、第680行

```python
# 修改前
self.stream_callback(delta)

# 修改后
self.stream_callback(delta, agent_id=self.agent_id, agent_name=self.name)
```

---

### 4.2 第二阶段：SoloAgent层修改

**文件**：`SoloAgent/solo_agent/agent.py`

**位置**：第79-83行

```python
# 修改前
def set_stream_callback(self, callback: callable) -> None:
    """设置流式输出回调函数"""
    self._stream_callback = callback
    if self._core:
        self._core.stream_callback = callback

# 修改后
def set_stream_callback(self, callback: callable) -> None:
    """设置流式输出回调函数"""
    self._stream_callback = callback
    if self._core:
        self._core.stream_callback = callback
        self._core.agent_id = self.agent_id  # 注入agent_id到ReActCore
```

---

### 4.3 第三阶段：Compiler层修改

**文件**：`SoloAgent/solo_agent/compiler/flow_compiler.py`

#### 4.3.1 新增属性和方法

```python
class CompiledFlow:
    def __init__(self, ...):
        # ... 其他初始化 ...
        self._agent_memories: Dict[str, List[Dict]] = {}  # 新增
    
    def set_agent_memories(self, memories: Dict[str, List[Dict]]) -> None:
        """设置按 agent_id 分组的记忆（由 AgenticFlow实例层调用）"""
        self._agent_memories = memories
```

#### 4.3.2 简化set_stream_callback方法

```python
# 修改前（第110-164行）：包含累积逻辑
def set_stream_callback(self, callback):
    # ... 大量累积逻辑 ...

# 修改后：只保留回调设置
def set_stream_callback(self, callback: Callable[[dict], None]):
    """设置流式输出回调函数"""
    self._stream_callback = callback
```

#### 4.3.3 修改_execute_agent方法

**位置**：第446行

```python
# 修改前
message_history = await self._get_message_history()
if message_history and hasattr(agent, 'set_message_history'):
    agent.set_message_history(message_history)

# 修改后
agent_memory = self._agent_memories.get(agent_id, [])
if agent_memory and hasattr(agent, 'set_message_history'):
    agent.set_message_history(agent_memory)
```

#### 4.3.4 删除存储相关代码

按照第三节的分析，删除所有存储相关代码。

---

### 4.4 第四阶段：AgenticFlow实例层修改

**文件**：`app/api/v1/run.py`

#### 4.4.1 新增ChunkCollector类

```python
class ChunkCollector:
    """收集流式chunk并合并，支持多agent"""
    
    def __init__(self):
        self._chunks = []
        self._agent_data = {}
        self._current_agent_id = None
        self._current_agent_name = None
        self._current_block = {}
    
    def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
        """添加chunk，支持agent_id分组"""
        if agent_id and agent_id != self._current_agent_id:
            if self._current_block and self._current_agent_id:
                if self._current_agent_id not in self._agent_data:
                    self._agent_data[self._current_agent_id] = {
                        'agent_name': self._current_agent_name,
                        'data': []
                    }
                self._agent_data[self._current_agent_id]['data'].append(self._current_block)
                self._current_block = {}
            self._current_agent_id = agent_id
            self._current_agent_name = agent_name
        
        if self._current_agent_id and self._current_agent_id not in self._agent_data:
            self._agent_data[self._current_agent_id] = {
                'agent_name': self._current_agent_name,
                'data': []
            }
        
        chunk_type = self._normalize_type(delta)
        content = self._extract_content(delta, chunk_type)
        
        if self._current_block and self._current_block.get('type') == chunk_type:
            self._current_block[chunk_type] = (self._current_block.get(chunk_type, "") or "") + content
        else:
            if self._current_block:
                self._agent_data[self._current_agent_id]['data'].append(self._current_block)
            self._current_block = {chunk_type: content, 'type': chunk_type}
        
        self._chunks.append({'delta': delta, 'agent_id': agent_id})
    
    def _normalize_type(self, delta: dict) -> str:
        if isinstance(delta, str):
            return 'content'
        raw_type = delta.get("type", "content")
        if raw_type in ('thinking', 'think', 'reason', 'reasoning', 'reasoning_content'):
            return 'reasoning_content'
        if raw_type in ('tool_use', 'tool_call', 'tool_calls') or 'tool_calls' in delta:
            return 'tool_calls'
        return 'content'
    
    def _extract_content(self, delta: dict, chunk_type: str) -> str:
        if isinstance(delta, str):
            return delta
        if chunk_type == 'reasoning_content':
            return delta.get('reasoning_content', '') or delta.get('thinking', '') or delta.get('text', '')
        elif chunk_type == 'tool_calls':
            return ''
        else:
            return delta.get('content', '') or delta.get('text', '')
    
    def get_agent_data(self) -> dict:
        if self._current_block and self._current_agent_id:
            if self._current_agent_id not in self._agent_data:
                self._agent_data[self._current_agent_id] = {
                    'agent_name': self._current_agent_name,
                    'data': []
                }
            self._agent_data[self._current_agent_id]['data'].append(self._current_block)
            self._current_block = {}
        return self._agent_data
    
    def get_merged_data(self) -> list:
        agent_data = self.get_agent_data()
        for agent_id, data in agent_data.items():
            return data['data']
        return []
    
    def get_chunk_count(self) -> int:
        return len(self._chunks)
    
    def get_agent_ids(self) -> list:
        return list(self._agent_data.keys())
```

#### 4.4.2 新增save_session_message函数

```python
async def save_session_message(
    db: Session, session_id: str, user_id: str, role: str,
    data: list, status: str = "completed", agent_id: str = "default",
    tokens: dict = None
):
    """保存session消息到数据库"""
    from app.core.database import SessionMessageModel
    
    if not data:
        data = [{"type": "content", "content": "empty"}]
    
    if not agent_id:
        agent_id = "default"
    
    try:
        max_index = db.query(func.max(SessionMessageModel.message_index)).filter(
            SessionMessageModel.session_id == session_id
        ).scalar() or 0
        
        message = SessionMessageModel(
            session_id=session_id,
            user_id=user_id,
            agent_id=agent_id,
            role=role,
            data=data,
            status=status,
            message_index=max_index + 1
        )
        
        if tokens:
            message.prompt_tokens = tokens.get('prompt_tokens')
            message.completion_tokens = tokens.get('completion_tokens')
            message.total_tokens = tokens.get('total_tokens')
        
        db.add(message)
        db.commit()
        logger.info(f"Saved {role} message to session {session_id}: {len(data)} blocks")
    except Exception as e:
        logger.error(f"Failed to save message: {e}")
        db.rollback()
        raise
```

#### 4.4.3 新增load_and_distribute_memories函数

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
        message = {
            "role": record.role,
            "content": _extract_content_from_data(record.data),
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


def _extract_content_from_data(data: list) -> str:
    """从 data 字段提取文本内容"""
    if not data:
        return ""
    for item in data:
        if item.get("type") == "content":
            return item.get("content", "")
    return ""
```

#### 4.4.4 修改stream_callback函数

**位置**：第254行、第724行

```python
# 修改前
def stream_callback(delta: dict):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(websocket.send_json({...}))
    except Exception as e:
        logger.error(f"Stream callback error: {e}")

# 修改后
def stream_callback(delta: dict, agent_id: str = None, agent_name: str = None):
    """流式输出回调函数 - 转发 + 收集"""
    try:
        collector.add_chunk(delta, agent_id, agent_name)
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(websocket.send_json({
                "type": "stream",
                "delta": delta,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "timestamp": datetime.now().isoformat()
            }))
    except Exception as e:
        logger.error(f"Stream callback error: {e}")
```

#### 4.4.5 修改run_websocket函数

**位置**：第670行附近

```python
@router.websocket("/ws/{agentic_flow_id}/{session_id}/{run_project_id}")
async def run_websocket(...):
    # ... 认证和初始化代码 ...
    
    # 1. 读取并分发记忆
    agent_memories = await load_and_distribute_memories(db, session_id, user_id)
    
    # 2. 创建chunk收集器
    collector = ChunkCollector()
    
    def stream_callback(delta: dict, agent_id: str = None, agent_name: str = None):
        try:
            collector.add_chunk(delta, agent_id, agent_name)
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(websocket.send_json({
                    "type": "stream",
                    "delta": delta,
                    "agent_id": agent_id,
                    "agent_name": agent_name,
                    "timestamp": datetime.now().isoformat()
                }))
        except Exception as e:
            logger.error(f"Stream callback error: {e}")
    
    # 3. 存储user消息
    user_data = [{"type": "content", "content": input_message}]
    await save_session_message(
        db=db, session_id=session_id, user_id=user_id,
        role="user", data=user_data, agent_id="default"
    )
    
    try:
        result = await FlowRunner.run_from_json(
            canvas_data, input_message,
            user_id=user_id, agentic_flow_id=agentic_flow_id,
            session_id=session_id, run_project_id=run_project_id,
            context=context,
            event_callback=event_callback, 
            stream_callback=stream_callback,
            agent_memories=agent_memories
        )
        status = "completed"
    except asyncio.CancelledError:
        status = "cancelled"
        raise
    except Exception as e:
        status = "error"
        logger.error(f"Execution error: {e}")
        raise
    finally:
        agent_data = collector.get_agent_data()
        if agent_data:
            for agent_id, agent_info in agent_data.items():
                data = agent_info['data']
                if not data:
                    data = [{"type": "content", "content": f"Status: {status}"}]
                await save_session_message(
                    db=db, session_id=session_id, user_id=user_id,
                    role="assistant", data=data, status=status, agent_id=agent_id
                )
        else:
            await save_session_message(
                db=db, session_id=session_id, user_id=user_id,
                role="assistant", 
                data=[{"type": "content", "content": f"No output. Status: {status}"}],
                status=status, agent_id="default"
            )
```

---

### 4.5 第五阶段：FlowRunner.run_from_json修改

**文件**：`SoloAgent/solo_agent/compiler/flow_compiler.py`

```python
@staticmethod
async def run_from_json(
    json_data: Dict[str, Any], 
    input_message: str,
    user_id: str = None,
    agentic_flow_id: str = None,
    session_id: str = None,
    run_project_id: str = None,
    context: Dict[str, Any] = None,
    event_callback: Callable[[ExecutionEvent], None] = None,
    stream_callback: Callable[[str], None] = None,
    agent_memories: Dict[str, List[Dict]] = None,  # 新增参数
) -> Dict[str, Any]:
    """运行 JSON 格式的工作流"""
    compiler = AgenticFlowCompiler(user_id=user_id)
    compiled_flow = compiler.compile(...)
    
    if event_callback:
        compiled_flow.set_event_callback(event_callback)
    
    if stream_callback:
        compiled_flow.set_stream_callback(stream_callback)
    
    if agent_memories:
        compiled_flow.set_agent_memories(agent_memories)
    
    return await compiled_flow.run(input_message, context)
```

---

### 4.6 第六阶段：数据库修改

**文件**：`app/core/database.py`

#### 4.6.1 修改字段约束

```python
# agent_id字段（第182行）
# 修改前
agent_id = Column(String(36), nullable=True, index=True)
# 修改后
agent_id = Column(String(36), nullable=False, index=True, default="default")

# data字段（第185行）
# 修改前
data = Column(JSON, nullable=True)
# 修改后
data = Column(JSON, nullable=False, default=[])
```

#### 4.6.2 修改add_session_message方法

**位置**：第698-726行

```python
def add_session_message(self, db: Session, session_id: str, user_id: str,
                        role: str, data: list = None, agent_id: str = None,
                        parent_message_id: str = None,
                        prompt_tokens: int = None, completion_tokens: int = None,
                        total_tokens: int = None) -> SessionMessageModel:
    """添加会话消息。"""
    if data is None:
        data = []
    
    if agent_id is None:
        agent_id = "default"
    
    # ... 其余代码 ...
```

#### 4.6.3 数据迁移脚本

```sql
-- 将现有NULL的agent_id更新为'default'
UPDATE session_messages SET agent_id = 'default' WHERE agent_id IS NULL;

-- 将现有NULL的data更新为空数组
UPDATE session_messages SET data = '[]' WHERE data IS NULL;

-- 修改字段约束
ALTER TABLE session_messages MODIFY agent_id VARCHAR(36) NOT NULL DEFAULT 'default';
ALTER TABLE session_messages MODIFY data JSON NOT NULL DEFAULT '[]';
```

---

## 五、接口改动影响分析

### 5.1 stream_callback签名修改影响

| 调用位置 | 文件 | 需要修改 |
|---------|------|----------|
| react_core.py:498 | `self.stream_callback(delta)` | **是** - 增加agent_id参数 |
| react_core.py:513 | `self.stream_callback(delta)` | **是** - 增加agent_id参数 |
| react_core.py:680 | `self.stream_callback({"content": ...})` | **是** - 增加agent_id参数 |
| agent.py:79 | `set_stream_callback(callback)` | **是** - 注入agent_id |
| flow_compiler.py:444 | `agent.set_stream_callback(...)` | **否** - 透传 |
| flow_compiler.py:1176 | `compiled_flow.set_stream_callback(...)` | **否** - 透传 |
| run.py:254 | `def stream_callback(delta: dict):` | **是** - 修改签名 |
| run.py:724 | `def stream_callback(delta: dict):` | **是** - 修改签名 |

### 5.2 FlowRunner.run_from_json参数修改影响

| 文件 | 行号 | 函数 | 需要修改 |
|------|------|------|----------|
| run.py | 172 | execute_workflow | **否** |
| run.py | 265 | stream_workflow | **是** - 添加agent_memories参数 |
| run.py | 767 | run_websocket | **是** - 添加agent_memories参数 |
| flow_compiler.py | 1349 | stream_run_from_json | **是** - 添加agent_memories参数 |
| agenticflow_gateway.py | 194 | run_agentic_flow | **否** |
| agenticflow_gateway.py | 270 | run_agentic_flow_async | **否** |

### 5.3 前端接口修改

#### 5.3.1 修改get_session_messages接口

新增agent_id过滤参数：

```python
@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    agent_id: str = None,  # 新增参数
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == current_user.id
    )
    
    if agent_id:
        query = query.filter(SessionMessageModel.agent_id == agent_id)
    
    messages = query.order_by(SessionMessageModel.message_index).offset(offset).limit(limit).all()
    # ...
```

#### 5.3.2 新增get_session_messages_by_agent接口

```python
@router.get("/sessions/{session_id}/messages/by-agent")
async def get_session_messages_by_agent(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取按agent_id分组的会话消息"""
    agent_memories = await load_and_distribute_memories(db, session_id, current_user.id)
    
    return {
        "code": 200,
        "message": "Messages retrieved by agent",
        "data": agent_memories
    }
```

### 5.4 WebSocket消息格式变化

**修改前**:
```json
{
    "type": "stream",
    "delta": {"content": "文本内容"},
    "timestamp": "2024-01-01T00:00:00"
}
```

**修改后**:
```json
{
    "type": "stream",
    "delta": {"content": "文本内容"},
    "agent_id": "main_agent",
    "agent_name": "主助手",
    "timestamp": "2024-01-01T00:00:00"
}
```

### 5.5 可删除/简化的接口

| 文件 | 接口/方法 | 处理方式 | 原因 |
|------|----------|----------|------|
| run.py | get_session_history | **评估删除** | 功能与get_session_messages重复 |
| flow_compiler.py | _get_message_history | **删除** | 改用_agent_memories |
| database_memory.py | retrieve_all | **简化或删除** | 记忆读取移至AgenticFlow实例层 |

---

## 六、数据流对比

### 6.1 改进前

```
用户输入
    ↓
run_websocket
    ↓
stream_callback → websocket.send_json() → 前端
    ↓
FlowRunner.run_from_json
    ↓
compiled_flow.run()
    ↓
[尝试] _accumulated_data收集 (不完善)
    ↓
[尝试] _save_message_to_memory() (可能不执行)
    ↓
数据库 (内容不完整)
```

### 6.2 改进后

```
用户输入
    ↓
run_websocket
    ├── load_and_distribute_memories() → 读取记忆
    ├── 存储user消息 → 数据库
    ↓
stream_callback
    ├── collector.add_chunk() → ChunkCollector
    └── websocket.send_json() → 前端
    ↓
FlowRunner.run_from_json(agent_memories=...)
    ↓
compiled_flow.run() (专注执行，不存储)
    ↓
finally块
    └── collector.get_agent_data() → 按agent_id存储assistant消息 → 数据库
```

---

## 七、存储格式示例

### 7.1 data字段内容

```json
[
    {
        "type": "reasoning_content",
        "reasoning_content": "让我思考一下这个问题..."
    },
    {
        "type": "content",
        "content": "你好！很高兴见到你！"
    },
    {
        "type": "tool_calls",
        "id": "call_abc123",
        "name": "search",
        "input": {"query": "xxx"}
    }
]
```

**说明**：data字段只存储消息内容数组，agent_id存储在session_messages表的独立字段中。

### 7.2 多Agent场景数据库记录

| session_id | agent_id | role | data |
|------------|----------|------|------|
| session_001 | main_agent | assistant | [{"type": "content", "content": "我需要调用搜索..."}] |
| session_001 | search_agent | assistant | [{"type": "content", "content": "搜索结果如下..."}] |

---

## 八、总结

| 项目 | 改进前 | 改进后 |
|------|--------|--------|
| 存储位置 | Compiler层（错位） | AgenticFlow实例层（正确） |
| chunk收集 | 不完善 | ChunkCollector统一收集 |
| 多Agent支持 | 无 | 支持agent_id区分 |
| 记忆读取 | 无agent过滤 | 支持按agent_id分发 |
| 异常安全 | 无保证 | finally块确保存储 |
| 数据完整性 | data可为空 | data必填，至少空数组 |
| agent_id | 可为空 | 必填 |
| 代码清晰度 | 逻辑分散 | 职责明确 |
| 架构遵循 | 违反四层架构 | 遵循四层架构 |
