# SubAgent 机制重构文档

## 一、重构目标

### 1.1 当前问题

SubAgent 和 MainAgent 的 stream\_callback 设置存在不一致：

| 问题    | 表现                         |
| ----- | -------------------------- |
| 重复设置  | stream\_callback 可能被设置两次   |
| 条件不一致 | 只传递给已初始化的 SubAgent         |
| 职责不清  | TaskTool 承担了 callback 设置职责 |

### 1.2 重构目标

- TaskTool 只作为启动使用，不负责设置 stream\_callback
- 所有 stream\_callback 设置由 CompiledFlow 或 SoloAgent 统一处理
- MainAgent 和 SubAgent 使用完全一致的 stream\_callback 设置方案
- 总而言之，使所有的agent全部用统一的方式运行、存储，且使用体验完全一致，不影响现有功能（重构后 subagent mainagent的区别 只在于 调用不同（mainagent调用，subagent是maniagent通过task工具调用，其他部分再无任何区别）

***

## 二、当前实现分析

### 2.1 MainAgent 的 stream\_callback 设置流程

**位置**：`CompiledFlow._execute_agent()` (flow\_compiler.py 第 233-234 行)

```python
if self._stream_callback and hasattr(agent, 'set_stream_callback'):
    agent.set_stream_callback(self._stream_callback)
```

**流程图**：

```
WebSocket 创建 stream_callback
    ↓
FlowRunner.run_from_json(stream_callback=...)
    ↓
CompiledFlow.run()
    ↓
CompiledFlow._execute_agent(agent)
    ↓
agent.set_stream_callback(self._stream_callback)  ← MainAgent 在这里设置
```

### 2.2 SubAgent 的 stream\_callback 设置流程

**当前有两个设置点**：

**设置点 1**：`SoloAgent.set_stream_callback()` (agent.py 第 94-103 行)

```python
def set_stream_callback(self, callback: callable) -> None:
    """设置流式输出回调函数"""
    self._stream_callback = callback
    if self._core:
        self._core.stream_callback = callback
        self._core.agent_id = self.agent_id
    
    # 递归传递给已初始化的 SubAgent
    for subagent in self._subagents.values():
        if subagent._initialized and hasattr(subagent, 'set_stream_callback'):
            subagent.set_stream_callback(callback)  ← 递归传递
```

**设置点 2**：`TaskTool.execute()` (task.py 第 179-180 行)

```python
if hasattr(self._parent_agent, '_stream_callback') and self._parent_agent._stream_callback:
    subagent.set_stream_callback(self._parent_agent._stream_callback)  ← 再次设置
```

### 2.3 问题分析

| 设置点                               | 触发时机                    | 条件                                  |
| --------------------------------- | ----------------------- | ----------------------------------- |
| SoloAgent.set\_stream\_callback() | MainAgent 设置 callback 时 | SubAgent 已初始化 (`_initialized=True`) |
| TaskTool.execute()                | SubAgent 执行前            | SubAgent 未初始化或 callback 未设置         |

**问题**：

1. 如果 SubAgent 在 MainAgent 初始化时已经 `_initialized=True`，则 callback 会被设置两次
2. 如果 SubAgent 在 MainAgent 初始化时 `_initialized=False`，则 callback 不会被递归传递，需要 TaskTool 补充设置
3. 逻辑不一致，职责不清晰

***

## 三、重构方案

### 3.1 核心原则

- TaskTool 只负责启动 SubAgent，不负责设置 stream\_callback
- stream\_callback 由 CompiledFlow 统一设置给 MainAgent
- MainAgent.set\_stream\_callback() 递归传递给所有 SubAgent（无论是否初始化）

### 3.2 修改内容

#### 3.2.1 修改 `SoloAgent.set_stream_callback()`

**文件**：`backend/SoloAgent/solo_agent/agent.py`

**修改前**：

```python
def set_stream_callback(self, callback: callable) -> None:
    """设置流式输出回调函数"""
    self._stream_callback = callback
    if self._core:
        self._core.stream_callback = callback
        self._core.agent_id = self.agent_id
    
    for subagent in self._subagents.values():
        if subagent._initialized and hasattr(subagent, 'set_stream_callback'):
            subagent.set_stream_callback(callback)
```

**修改后**：

```python
def set_stream_callback(self, callback: callable) -> None:
    """设置流式输出回调函数"""
    self._stream_callback = callback
    if self._core:
        self._core.stream_callback = callback
        self._core.agent_id = self.agent_id
    
    for subagent in self._subagents.values():
        subagent._stream_callback = callback
        if subagent._core:
            subagent._core.stream_callback = callback
            subagent._core.agent_id = subagent.agent_id
```

**关键修改**：

- 移除 `_initialized` 条件检查
- 直接设置 SubAgent 的 `_stream_callback` 属性
- 如果 SubAgent 已初始化，同时设置到 ReActCore

#### 3.2.2 修改 `TaskTool.execute()`

**文件**：`backend/SoloAgent/plugins/tools/agent/task.py`

**修改前**：

```python
async def execute(self, subagent_name: str, task: str, **kwargs) -> Dict[str, Any]:
    # ... 获取 SubAgent ...
    
    if not subagent._initialized:
        await subagent.initialize()
    
    if hasattr(self._parent_agent, '_stream_callback') and self._parent_agent._stream_callback:
        subagent.set_stream_callback(self._parent_agent._stream_callback)
    
    self._send_event("subagent_start", subagent_id=subagent_id, subagent_name=subagent_name)
    
    try:
        result = await subagent.reply(task)
        # ...
```

**修改后**：

```python
async def execute(self, subagent_name: str, task: str, **kwargs) -> Dict[str, Any]:
    # ... 获取 SubAgent ...
    
    if not subagent._initialized:
        await subagent.initialize()
        if subagent._core:
            subagent._core.stream_callback = self._parent_agent._stream_callback
            subagent._core.agent_id = subagent.agent_id
    
    self._send_event("subagent_start", subagent_id=subagent_id, subagent_name=subagent_name)
    
    try:
        result = await subagent.reply(task)
        # ...
```

**关键修改**：

- 移除 `subagent.set_stream_callback()` 调用
- SubAgent 的 `_stream_callback` 已在 MainAgent.set\_stream\_callback() 中设置
- 只需要在 SubAgent 初始化后，设置 ReActCore 的 callback

***

## 四、重构后的流程

### 4.1 完整流程图

```
WebSocket 创建 stream_callback
    ↓
FlowRunner.run_from_json(stream_callback=...)
    ↓
CompiledFlow.run()
    ↓
CompiledFlow._execute_agent(main_agent)
    ↓
main_agent.set_stream_callback(callback)
    ↓
┌─────────────────────────────────────────────────────────────┐
│  MainAgent.set_stream_callback(callback)                    │
│  ├── self._stream_callback = callback                       │
│  ├── self._core.stream_callback = callback                  │
│  └── for subagent in self._subagents.values():              │
│      ├── subagent._stream_callback = callback  ← 统一设置   │
│      └── if subagent._core:                                 │
│          ├── subagent._core.stream_callback = callback      │
│          └── subagent._core.agent_id = subagent.agent_id    │
└─────────────────────────────────────────────────────────────┘
    ↓
TaskTool.execute(subagent_name, task)
    ↓
┌─────────────────────────────────────────────────────────────┐
│  TaskTool.execute() - 只负责启动                             │
│  ├── 获取 SubAgent 实例                                     │
│  ├── if not subagent._initialized:                          │
│  │   ├── await subagent.initialize()                        │
│  │   └── 设置 ReActCore callback（如果初始化时未设置）       │
│  ├── 发送 subagent_start 事件                               │
│  ├── result = await subagent.reply(task)                    │
│  └── 发送 subagent_complete 事件                            │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 关键改进

| 改进点  | 说明                                     |
| ---- | -------------------------------------- |
| 统一设置 | 所有 Agent 的 callback 由 MainAgent 统一管理   |
| 更早设置 | SubAgent 在 MainAgent 初始化时就已经有 callback |
| 减少重复 | 避免多次设置 callback                        |
| 职责清晰 | TaskTool 只负责启动，不负责 callback 设置         |

***

## 五、涉及文件清单

| 文件                                              | 修改内容                          |
| ----------------------------------------------- | ----------------------------- |
| `backend/SoloAgent/solo_agent/agent.py`         | 修改 `set_stream_callback()` 方法 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | 修改 `execute()` 方法             |

***

## 六、验收标准

### 6.1 功能验收

- [ ] MainAgent 设置 stream\_callback 时，所有 SubAgent 同时设置
- [ ] TaskTool 不再负责设置 stream\_callback
- [ ] SubAgent 初始化后，ReActCore 正确接收 callback
- [ ] MainAgent 和 SubAgent 的消息存储格式完全一致

### 6.2 测试验收

- [ ] 使用测试面板验证 SubAgent 调用
- [ ] 检查数据库中的 session\_messages 表
- [ ] 验证前端显示效果一致

***

## 七、可行性分析

### 7.1 初始化流程对比

| 维度             | MainAgent         | SubAgent          | 是否一致   |
| -------------- | ----------------- | ----------------- | ------ |
| 创建方法           | `_compile_node()` | `_compile_node()` | ✅ 完全一致 |
| agent\_id 来源   | node\_id          | node\_id          | ✅ 完全一致 |
| 配置加载           | 从数据库加载            | 从数据库加载            | ✅ 完全一致 |
| LLM/MCP/Skills | 按需加载              | 按需加载              | ✅ 完全一致 |

**结论：初始化流程完全一致。**

### 7.2 运行流程对比

| 维度                    | MainAgent                       | SubAgent             | 差异              |
| --------------------- | ------------------------------- | -------------------- | --------------- |
| stream\_callback 设置位置 | `CompiledFlow._execute_agent()` | `TaskTool.execute()` | 设置位置不同          |
| message\_history 设置   | `CompiledFlow._execute_agent()` | 不设置                  | SubAgent 没有历史消息 |
| 调用入口                  | 用户/CompiledFlow                 | TaskTool             | 设计差异            |

**结论：运行流程存在差异，需要统一 stream\_callback 设置方案。**

### 7.3 存储流程对比

| 维度    | MainAgent              | SubAgent               | 是否一致   |
| ----- | ---------------------- | ---------------------- | ------ |
| 消息发送  | stream\_callback       | stream\_callback       | ✅ 完全一致 |
| 消息收集  | ChunkCollector         | ChunkCollector         | ✅ 完全一致 |
| 分组方式  | agent\_id              | agent\_id              | ✅ 完全一致 |
| 数据库保存 | save\_session\_message | save\_session\_message | ✅ 完全一致 |

**结论：存储流程完全一致。**

### 7.4 前端显示对比

| 维度             | MainAgent                             | SubAgent                              | 是否一致   |
| -------------- | ------------------------------------- | ------------------------------------- | ------ |
| WebSocket 消息格式 | `{type, delta, agent_id, agent_name}` | `{type, delta, agent_id, agent_name}` | ✅ 完全一致 |
| 流式输出           | 支持                                    | 支持                                    | ✅ 完全一致 |
| 思考过程显示         | reasoning\_content                    | reasoning\_content                    | ✅ 完全一致 |
| 工具调用显示         | tool\_calls                           | tool\_calls                           | ✅ 完全一致 |

**结论：前端显示完全一致。**

### 7.5 唯一差异：调用入口

| 维度   | MainAgent           | SubAgent                 |
| ---- | ------------------- | ------------------------ |
| 调用入口 | 用户通过 WebSocket 发送请求 | MainAgent 通过 TaskTool 调用 |
| 触发方式 | 外部触发                | 内部触发                     |

**这是设计上的差异，不影响统一性。**

### 7.6 最终结论

| 目标      | 是否可实现 | 说明                               |
| ------- | ----- | -------------------------------- |
| 统一运行方式  | ✅ 可实现 | 修改 `set_stream_callback()` 后完全统一 |
| 统一存储方式  | ✅ 已实现 | 当前代码已完全统一                        |
| 统一前端显示  | ✅ 已实现 | 当前代码已完全统一                        |
| 使用体验一致  | ✅ 可实现 | 修改后完全一致                          |
| 不影响现有功能 | ✅ 可实现 | 修改完全向后兼容                         |

**总结论：能够实现"所有 Agent 统一运行、存储"的目标。**

***

## 八、附加问题及解决方案

### 8.1 问题 1：SubAgent 的 tool\_calls 未正确记录

**现象**：

- SubAgent 的 data 字段中缺少 tool\_calls 类型数据
- MainAgent 的 tool\_calls 正常记录

**根因分析**：

当前代码中，SubAgent 初始化时 `stream_callback` 可能未正确设置。

**原方案能否解决**：

✅ **可以解决！**

执行顺序分析：

```
CompiledFlow._execute_agent(main_agent)
    ↓
main_agent.set_stream_callback(callback)  ← 第一步：设置 callback
    ↓
    └── for subagent in self._subagents.values():
            subagent._stream_callback = callback  ← SubAgent 的 _stream_callback 被设置
    ↓
if not agent._initialized:
    await agent.initialize()  ← 第二步：初始化（此时 callback 已设置）
        ↓
        ReActCore.__init__(stream_callback=self._stream_callback)  ← 使用已设置的 callback
            ↓
            ToolCallEventManager(stream_callback=callback)  ← callback 正确传递
```

**关键点**：

1. `set_stream_callback()` 在 `initialize()` **之前**执行
2. SubAgent 的 `_stream_callback` 在 MainAgent 设置 callback 时就被设置
3. SubAgent 初始化时，`ReActCore` 使用已设置的 callback
4. `ToolCallEventManager` 获得正确的 callback

**结论**：原重构方案可以解决此问题，无需额外修改。

### 8.2 问题 2：空 content 字段

**现象**：

- SubAgent 的 data 字段中存在空的 content 块：`{"content": "", "type": "content"}`
- MainAgent 也可能遇到此问题

**根因分析**：

`ChunkCollector.add_chunk()` 未过滤空内容：

```python
# ChunkCollector.add_chunk() 第 140-145 行
else:
    if self._current_block and self._current_block.get('type') == chunk_type:
        self._current_block[chunk_type] = (self._current_block.get(chunk_type, "") or "") + content
    else:
        if self._current_block:
            self._agent_data[self._current_agent_id]['data'].append(self._current_block)
        self._current_block = {chunk_type: content, 'type': chunk_type}  # ← 即使 content 为空也创建块
```

**与 Agent 统一的关系**：

❌ **无关！** 这是 `ChunkCollector` 的独立问题，MainAgent 和 SubAgent 都可能遇到。

**解决方案**：

在 `ChunkCollector.add_chunk()` 中添加空内容过滤：

```python
def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
    # ... 省略前面的代码 ...
    
    chunk_type = self._normalize_type(delta)
    content = self._extract_content(delta, chunk_type)
    
    # 新增：跳过空内容
    if chunk_type != 'tool_calls' and not content:
        return
    if chunk_type == 'tool_calls' and not content:
        return
    
    # ... 后续处理逻辑 ...
```

在 `ChunkCollector.get_agent_data()` 中添加空块清理：

```python
def get_agent_data(self) -> dict:
    if self._current_block and self._current_agent_id:
        if self._current_agent_id not in self._agent_data:
            self._agent_data[self._current_agent_id] = {
                'agent_name': self._current_agent_name,
                'data': []
            }
        self._agent_data[self._current_agent_id]['data'].append(self._current_block)
        self._current_block = {}
    
    # 新增：清理空块
    for agent_id in list(self._agent_data.keys()):
        cleaned_data = []
        for block in self._agent_data[agent_id]['data']:
            block_type = block.get('type')
            if block_type == 'content' and not block.get('content', '').strip():
                continue
            if block_type == 'reasoning_content' and not block.get('reasoning_content', '').strip():
                continue
            if block_type == 'tool_calls' and not block.get('tool_calls', []):
                continue
            cleaned_data.append(block)
        self._agent_data[agent_id]['data'] = cleaned_data
    
    return self._agent_data
```

### 8.3 总结

| 问题              | 原方案能否解决  | 说明                                   |
| --------------- | -------- | ------------------------------------ |
| tool\_calls 未记录 | ✅ 可以解决   | 执行顺序保证 callback 在初始化前设置              |
| 空 content 字段    | ❌ 需要额外修复 | 这是 ChunkCollector 的独立问题，与 Agent 统一无关 |

***

## 九、完整修改清单

### 9.1 修改 `SoloAgent.set_stream_callback()`

**文件**：`backend/SoloAgent/solo_agent/agent.py`

**修改后**：

```python
def set_stream_callback(self, callback: callable) -> None:
    """设置流式输出回调函数"""
    self._stream_callback = callback
    if self._core:
        self._core.stream_callback = callback
        self._core.agent_id = self.agent_id
    
    for subagent in self._subagents.values():
        subagent._stream_callback = callback
        if subagent._core:
            subagent._core.stream_callback = callback
            subagent._core.agent_id = subagent.agent_id
```

### 9.2 修改 `TaskTool.execute()`

**文件**：`backend/SoloAgent/plugins/tools/agent/task.py`

**修改后**：

```python
async def execute(self, subagent_name: str, task: str, **kwargs) -> Dict[str, Any]:
    # ... 获取 SubAgent ...
    
    if not subagent._initialized:
        await subagent.initialize()
        if subagent._core:
            subagent._core.stream_callback = self._parent_agent._stream_callback
            subagent._core.agent_id = subagent.agent_id
    
    self._send_event("subagent_start", subagent_id=subagent_id, subagent_name=subagent_name)
    
    try:
        result = await subagent.reply(task)
        # ...
```

### 9.3 修改 `ChunkCollector.add_chunk()`（附加修复）

**文件**：`backend/app/api/v1/run.py`

**修改后**：

```python
def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
    # ... 省略前面的代码 ...
    
    chunk_type = self._normalize_type(delta)
    content = self._extract_content(delta, chunk_type)
    
    # 新增：跳过空内容
    if chunk_type != 'tool_calls' and not content:
        return
    if chunk_type == 'tool_calls' and not content:
        return
    
    # ... 后续处理逻辑 ...
```

### 9.4 修改 `ChunkCollector.get_agent_data()`（附加修复）

**文件**：`backend/app/api/v1/run.py`

**修改后**：

```python
def get_agent_data(self) -> dict:
    if self._current_block and self._current_agent_id:
        if self._current_agent_id not in self._agent_data:
            self._agent_data[self._current_agent_id] = {
                'agent_name': self._current_agent_name,
                'data': []
            }
        self._agent_data[self._current_agent_id]['data'].append(self._current_block)
        self._current_block = {}
    
    # 新增：清理空块
    for agent_id in list(self._agent_data.keys()):
        cleaned_data = []
        for block in self._agent_data[agent_id]['data']:
            block_type = block.get('type')
            if block_type == 'content' and not block.get('content', '').strip():
                continue
            if block_type == 'reasoning_content' and not block.get('reasoning_content', '').strip():
                continue
            if block_type == 'tool_calls' and not block.get('tool_calls', []):
                continue
            cleaned_data.append(block)
        self._agent_data[agent_id]['data'] = cleaned_data
    
    return self._agent_data
```

***

## 十、涉及文件清单

| 文件                                              | 修改内容                                                    | 类型   |
| ----------------------------------------------- | ------------------------------------------------------- | ---- |
| `backend/SoloAgent/solo_agent/agent.py`         | 修改 `set_stream_callback()` 方法                           | 核心修改 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | 修改 `execute()` 方法                                       | 核心修改 |
| `backend/app/api/v1/run.py`                     | 修改 `ChunkCollector.add_chunk()` 和 `get_agent_data()` 方法 | 附加修复 |

***

## 十一、执行步骤

1. **修改** **`SoloAgent.set_stream_callback()`** **方法**（核心修改）
   - 移除 `_initialized` 条件检查
   - 直接设置 SubAgent 的 `_stream_callback` 属性
2. **修改** **`TaskTool.execute()`** **方法**（核心修改）
   - 移除 `subagent.set_stream_callback()` 调用
   - 只在初始化后设置 ReActCore callback
3. **修改** **`ChunkCollector.add_chunk()`** **方法**（附加修复）
   - 添加空内容跳过逻辑
4. **修改** **`ChunkCollector.get_agent_data()`** **方法**（附加修复）
   - 添加空块清理逻辑
5. **测试验证**
   - 使用测试面板验证 MainAgent 和 SubAgent 的消息存储
   - 检查数据库中的 session\_messages 表
   - 验证前端显示效果

