# session_message修复方案

## 一、设计理念（遵循四层架构）

```
AgenticFlow实例层（run.py） → 负责模型记忆读取、存储、session创建、按AgentId向每个SoloAgent传输记忆、隔离管理(管理整个AgenticFlow)
Compiler层 (flow_compiler.py) → 编译并执行flow，协调多个agent。该层可视为SoloAgent同层
SoloAgent (agent.py) → 基于ReActCore基类，负责组装各项plugins  
ReActCore基类 (react_core.py) → 只负责接收数据、运行.核心执行引擎，处理LLM调用  
LLM API
```

---

## 二、当前代码问题分析

### 2.1 混淆、冗余、待删除的代码和接口

#### 2.1.1 Compiler层 (flow_compiler.py) 中应移除的存储相关代码

| 位置 | 代码 | 问题 | 建议 |
|------|------|------|------|
| 第80行 | `self._session_memory` | 存储职责应在AgenticFlow实例层 | **移除** |
| 第82行 | `self._message_saved` | 存储状态标志，不应在Compiler层 | **移除** |
| 第83-84行 | `self._accumulated_data`, `self._current_block` | chunk收集应在AgenticFlow实例层 | **移除** |
| 第86-90行 | `reset_accumulated_content()` | 配合_accumulated_data，应移除 | **移除** |
| 第92-107行 | `get_accumulated_data()`, `get_accumulated_content()` | 配合_accumulated_data，应移除 | **移除** |
| 第110-164行 | `set_stream_callback()` 及其中的累积逻辑 | 累积逻辑应移至AgenticFlow实例层 | **简化，只保留回调设置** |
| 第200-226行 | `_init_session_memory()` | 存储初始化应在AgenticFlow实例层 | **移除** |
| 第229-261行 | `_save_message_to_memory()` | 存储函数应在AgenticFlow实例层 | **移除** |
| 第263-271行 | `_get_session_messages()` | 获取消息应在AgenticFlow实例层 | **移除** |
| 第283-286行 | `run()`中的`_init_session_memory`和存储user消息 | 应在AgenticFlow实例层 | **移除** |
| 第302-360行 | `run()`中的assistant消息存储逻辑 | 应在AgenticFlow实例层 | **移除** |
| 第443-444行 | `_execute_agent()`中设置stream_callback | 累积逻辑混淆 | **简化** |
| 第505-556行 | `_execute_agent()`中的存储逻辑 | 应在AgenticFlow实例层 | **移除** |
| 第856行 | `cached._session_memory = None` | 配合_session_memory | **移除** |
| 第1176行 | `compiled_flow.set_stream_callback(stream_callback)` | 需保留，但简化回调逻辑 | **简化** |
| 第1218行 | `compiled_flow.reset_accumulated_content()` | 配合reset方法 | **移除** |
| 第1224行 | `compiled_flow._init_session_memory()` | 应在AgenticFlow实例层 | **移除** |
| 第1230-1243行 | `run_node()`中设置stream_callback和累积逻辑 | 应在AgenticFlow实例层 | **移除** |
| 第1235行 | `run_node()`中存储user消息 | 应在AgenticFlow实例层 | **移除** |
| 第1245-1252行 | `run_node()`中存储assistant消息 | 应在AgenticFlow实例层 | **移除** |
| 第1271-1298行 | `run_node()`中获取和存储逻辑 | 应在AgenticFlow实例层 | **移除** |

#### 2.1.2 待删除函数/接口的配套调用分析

以下分析每个待删除函数/属性的所有调用位置，确保删除时不会遗漏：

##### A. `reset_accumulated_content()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:86-90 | `def reset_accumulated_content(self):` |
| 调用1 | flow_compiler.py:1218 | `compiled_flow.reset_accumulated_content()` |

**结论**：定义和调用均在flow_compiler.py，删除方法定义时需同时删除调用。

---

##### B. `get_accumulated_data()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:92-99 | `def get_accumulated_data(self):` |
| 调用1 | flow_compiler.py:306 | `accumulated_data = self.get_accumulated_data()` |
| 调用2 | flow_compiler.py:1271 | `accumulated_data = compiled_flow.get_accumulated_data()` |

**结论**：定义和调用均在flow_compiler.py，删除方法定义时需同时删除两处调用。

---

##### C. `get_accumulated_content()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:101-107 | `def get_accumulated_content(self):` |
| 无调用 | - | - |

**结论**：该方法无任何调用，可直接删除。

---

##### D. `_init_session_memory()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:200-226 | `async def _init_session_memory(self):` |
| 调用1 | flow_compiler.py:283 | `await self._init_session_memory()` |
| 调用2 | flow_compiler.py:1224 | `await compiled_flow._init_session_memory()` |

**结论**：定义和调用均在flow_compiler.py，删除方法定义时需同时删除两处调用。

---

##### E. `_save_message_to_memory()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:229-261 | `async def _save_message_to_memory(...):` |
| 调用1 | flow_compiler.py:286 | `await self._save_message_to_memory("user", user_data)` |
| 调用2 | flow_compiler.py:352 | `await self._save_message_to_memory("assistant", assistant_data, tokens)` |
| 调用3 | flow_compiler.py:556 | `await self._save_message_to_memory(...)` |
| 调用4 | flow_compiler.py:1235 | `await compiled_flow._save_message_to_memory("user", ...)` |
| 调用5 | flow_compiler.py:1252 | `await compiled_flow._save_message_to_memory("assistant", ...)` |
| 调用6 | flow_compiler.py:1298 | `await compiled_flow._save_message_to_memory("assistant", ...)` |

**结论**：定义和6处调用均在flow_compiler.py，删除方法定义时需同时删除所有调用。

---

##### F. `_get_message_history()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:263-271 | `async def _get_message_history(self):` |
| 无调用 | - | - |

**结论**：该方法无任何调用，可直接删除。

---

##### G. `_session_memory` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:80 | `self._session_memory = None` |
| 使用1 | flow_compiler.py:200 | `if not self._session_memory:` |
| 使用2 | flow_compiler.py:206 | `self._session_memory = DatabaseMemory(...)` |
| 使用3 | flow_compiler.py:222 | `message_count = self._session_memory.message_count` |
| 使用4 | flow_compiler.py:265 | `if not self._session_memory:` |
| 使用5 | flow_compiler.py:268 | `messages = await self._session_memory.retrieve_all()` |
| 使用6 | flow_compiler.py:856 | `cached._session_memory = None` |

**结论**：该属性有6处使用，需全部删除。

---

##### H. `_message_saved` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:82 | `self._message_saved = False` |
| 使用1 | flow_compiler.py:350 | `if not self._message_saved:` |
| 使用2 | flow_compiler.py:351 | `self._message_saved = True` |
| 使用3 | flow_compiler.py:354 | `logger.info("Message already saved...")` |

**结论**：该属性有3处使用，需全部删除。

---

##### I. `_accumulated_data` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:83 | `self._accumulated_data = []` |
| 使用1 | flow_compiler.py:95 | `return self._accumulated_data` |
| 使用2 | flow_compiler.py:103 | `for item in self._accumulated_data:` |
| 使用3 | flow_compiler.py:133 | `self._accumulated_data.append(self._current_block)` |
| 使用4 | flow_compiler.py:144 | `self._accumulated_data.append(self._current_block)` |
| 使用5 | flow_compiler.py:151 | `self._accumulated_data.append(self._current_block)` |
| 使用6 | flow_compiler.py:157 | `self._accumulated_data.append(tool_block)` |

**结论**：该属性有6处使用，需全部删除。

---

##### J. `_current_block` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:84 | `self._current_block = None` |
| 使用1 | flow_compiler.py:88 | `self._current_block = None` |
| 使用2 | flow_compiler.py:103 | `if self._current_block:` |
| 使用3 | flow_compiler.py:131 | `if self._current_block and self._current_block.get("type") == "content":` |
| 使用4 | flow_compiler.py:132 | `self._current_block["content"] = ...` |
| 使用5 | flow_compiler.py:135 | `self._current_block = {...}` |
| 使用6 | flow_compiler.py:136 | `self._accumulated_data.append(self._current_block)` |
| 使用7 | flow_compiler.py:142 | `if self._current_block and self._current_block.get("type") == "reasoning_content":` |
| 使用8 | flow_compiler.py:143 | `self._current_block["reasoning_content"] = ...` |
| 使用9 | flow_compiler.py:145 | `self._current_block = {...}` |
| 使用10 | flow_compiler.py:149 | `self._current_block = None` |
| 使用11 | flow_compiler.py:155 | `if self._current_block and self._current_block.get("type") == "content":` |
| 使用12 | flow_compiler.py:156 | `self._current_block["content"] = ...` |
| 使用13 | flow_compiler.py:159 | `self._current_block = {...}` |

**结论**：该属性有13处使用，需全部删除。

---

##### K. `set_stream_callback()` 方法（需简化）

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:110-164 | `def set_stream_callback(self, callback):` |
| 调用1 | flow_compiler.py:1176 | `compiled_flow.set_stream_callback(stream_callback)` |
| 调用2 | flow_compiler.py:1230 | `compiled_flow.set_stream_callback(...)` |

**结论**：方法需简化（移除累积逻辑），保留回调设置功能，调用处保留。

---

#### 2.1.3 待修改函数/接口

以下函数需要修改但保留：

| 位置 | 函数/接口 | 修改内容 |
|------|----------|----------|
| flow_compiler.py:110-164 | `set_stream_callback()` | 移除累积逻辑，简化为只设置回调 |
| run.py:254-260 | `stream_callback` (SSE版本) | 添加ChunkCollector收集 |
| run.py:724-750 | `stream_callback` (WebSocket版本) | 添加ChunkCollector收集 |
| run.py:265-274 | `FlowRunner.run_from_json`调用 | 添加存储逻辑 |
| run.py:767-776 | `FlowRunner.run_from_json`调用 | 添加存储逻辑 |

---

#### 2.1.4 AgenticFlow实例层 (run.py) 中需要修改的代码

| 位置 | 代码 | 问题 | 建议 |
|------|------|------|------|
| 第254-260行 | `stream_callback` (SSE版本) | 只转发不收集 | **添加ChunkCollector收集** |
| 第724-750行 | `stream_callback` (WebSocket版本) | 只转发不收集 | **添加ChunkCollector收集** |
| 第265-274行 | `FlowRunner.run_from_json`调用 | 缺少存储逻辑 | **添加存储逻辑** |
| 第767-776行 | `FlowRunner.run_from_json`调用 | 缺少存储逻辑 | **添加存储逻辑** |

#### 2.1.5 Memory插件层 (database_memory.py) 保留

| 位置 | 代码 | 说明 | 建议 |
|------|------|------|------|
| 第190-234行 | `_save_message_to_database()` | 实际写入数据库 | **保留** |
| 第283行 | `add()` | 调用存储 | **保留** |

**说明**：Memory插件层是底层数据访问层，应保留。但调用入口应从AgenticFlow实例层调用，而非Compiler层。

---

## 三、架构调整

```
改进前：
┌─────────────────────────────────────────────────────────────┐
│ AgenticFlow实例层 (run.py)                                  │
│   - 创建session                                             │
│   - stream_callback: 只转发                                 │
│   - [缺失] chunk收集                                        │
│   - [缺失] 消息存储                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Compiler层 (flow_compiler.py)                               │
│   - _session_memory (混淆)                                  │
│   - _accumulated_data (收集不完善)                          │
│   - _save_message_to_memory() (职责错位)                    │
│   - 多处存储调用 (逻辑分散)                                  │
└─────────────────────────────────────────────────────────────┘

改进后：
┌─────────────────────────────────────────────────────────────┐
│ AgenticFlow实例层 (run.py)                                  │
│   - 创建session ✅                                          │
│   - stream_callback: 转发 + 收集 + agent_id ✅              │
│   - ChunkCollector: 收集并合并chunk，支持多agent ✅         │
│   - 存储user/assistant消息 ✅                               │
│   - 异常安全：finally块确保存储 ✅                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Compiler层 (flow_compiler.py)                               │
│   - 编译flow                                                │
│   - 执行flow                                                │
│   - 协调多个agent                                           │
│   - [移除] 所有存储相关代码                                  │
│   - [移除] _accumulated_data相关代码                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、数据流对比

### 4.1 改进前

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
_execute_agent
    ↓
[尝试] _accumulated_data收集 (不完善)
    ↓
[尝试] _save_message_to_memory() (可能不执行)
    ↓
数据库 (内容不完整)
```

### 4.2 改进后

```
用户输入
    ↓
run_websocket
    ├── 存储user消息 → 数据库
    ↓
stream_callback
    ├── collector.add_chunk() → ChunkCollector
    └── websocket.send_json() → 前端
    ↓
FlowRunner.run_from_json
    ↓
compiled_flow.run() (专注执行，不存储)
    ↓
finally块
    └── collector.get_merged_data() → 存储assistant消息 → 数据库
```

---

## 五、实施步骤

### 5.1 第一阶段：底层修改（ReActCore → SoloAgent → Compiler）

1. 修改`react_core.py`：`__init__`增加agent_id参数，stream_callback调用传递agent_id
2. 修改`agent.py`：`set_stream_callback`注入agent_id到ReActCore
3. 简化`flow_compiler.py`：移除存储相关代码

### 5.2 第二阶段：AgenticFlow实例层修改

1. 在`run.py`中新增`ChunkCollector`类（支持agent_id）
2. 在`run.py`中新增`save_session_message`函数
3. 修改`stream_callback`签名，增加agent_id参数
4. 修改`run_websocket`函数，添加收集和存储逻辑

### 5.3 第三阶段：数据库修改

1. 修改`SessionMessageModel`字段约束（agent_id、data必填）
2. 修改`add_session_message`方法
3. 执行数据迁移脚本

### 5.4 第四阶段：记忆读取修改

1. 新增`retrieve_by_agent`方法
2. 修改`retrieve_all`方法

### 5.5 第五阶段：测试验证

1. 测试正常流程的消息存储
2. 测试异常情况的消息存储
3. 测试多Agent场景的消息区分
4. 测试记忆按agent_id读取
5. 验证前端显示正常

---

## 六、存储格式示例

### 6.1 单Agent场景 - data字段内容

```json
[
    {
        "type": "reasoning_content",
        "reasoning_content": "让我思考一下这个问题..."
    },
    {
        "type": "content",
        "content": "你好！很高兴见到你！有什么我可以帮助你的吗？"
    }
]
```

### 6.2 多Agent场景 - data字段内容
Agent1的data字段：
```json
[
    {
        "type": "reasoning_content",
        "reasoning_content": "让我思考一下这个问题..."
    },
    {
        "type": "reasoning_content",
        "content": "我需要调用mcp..."
    },
    {
        "type": "tool_calls",
        "id": "call_abc123",
        "name": "playwright",
        "input": {"query": "xxx"}
    },
    {
        "type": "reasoning_content",
        "content": "执行如下..."
    },
    {
        "type": "content",
        "content": "根据..."
    }
]
```

Agent2的data字段：
```json
[
    {
        "type": "reasoning_content",
        "reasoning_content": "让我思考一下这个问题..."
    },
    {
        "type": "reasoning_content",
        "content": "我需要调用搜索工具..."
    },
    {
        "type": "tool_calls",
        "id": "call_abc123",
        "name": "search",
        "input": {"query": "xxx"}
    },
    {
        "type": "reasoning_content",
        "content": "搜索结果如下..."
    },
    {
        "type": "content",
        "content": "根据搜索..."
    }
]
```

**说明**：data字段只存储消息内容数组，agent_id和agent_name存储在session_messages表的独立字段中。

### 6.3 数据库记录示例

**session_messages表记录**：

| 字段 | 值 |
|------|-----|
| session_id | session_001 |
| user_id | user_001 |
| agent_id | main_agent |
| role | assistant |
| data | [{"type": "content", "content": "你好！..."}] |
| status | completed |
| message_index | 2 |

**多Agent场景下，每个Agent的输出存储为独立记录**：

| session_id | agent_id | role | data |
|------------|----------|------|------|
| session_001 | main_agent | assistant | [{"type": "content", "content": "我需要调用搜索..."}] |
| session_001 | search_agent | assistant | [{"type": "content", "content": "搜索结果如下..."}] |

---

## 七、异常安全保证

```python
try:
    result = await FlowRunner.run_from_json(...)
    status = "completed"
except asyncio.CancelledError:
    status = "cancelled"
    # 用户取消，仍然存储已收集的内容
except Exception as e:
    status = "error"
    # 执行错误，仍然存储已收集的内容
finally:
    # 无论如何都执行存储
    if collector.get_merged_data():
        await save_session_message(..., status=status)
```

---

## 八、多Agent场景支持

### 8.1 问题背景

一个AgenticFlow可能包含多个Agent（MainAgent和SubAgent），不同Agent的输出需要区分存储。

**当前问题**：
- `stream_callback(delta)` 只传递内容，无agent_id信息
- `ChunkCollector` 无法区分不同agent的内容
- 数据库`SessionMessageModel`有`agent_id`字段，但未被正确使用

### 8.2 解决方案：修改stream_callback签名

修改回调签名，增加agent_id参数，实现显式传递：

```python
# 修改签名，增加agent_id参数
def stream_callback(delta: dict, agent_id: str = None, agent_name: str = None):
    collector.add_chunk(delta, agent_id, agent_name)
```

**方案优势**：
1. **显式优于隐式**：agent_id与delta原子传递，不依赖外部状态
2. **无时序依赖**：即使未来代码修改导致时序变化，方案仍然安全
3. **接口清晰**：函数签名明确表达意图
4. **运行时性能**：无额外开销，数据原子传递
5. **稳定性**：不依赖状态追踪，数据一致性有保障

---

## 九、执行方案详细实现

### 9.1 修改链路总览

需要修改的层级和文件：

| 层级 | 文件 | 修改内容 |
|------|------|----------|
| ReActCore层 | `react_core.py` | 修改stream_callback调用，传递agent_id |
| SoloAgent层 | `agent.py` | 透传agent_id，修改set_stream_callback |
| Compiler层 | `flow_compiler.py` | 简化回调设置 |
| AgenticFlow实例层 | `run.py` | 修改stream_callback签名，ChunkCollector支持agent_id |

### 9.2 ReActCore层修改

**文件**：`SoloAgent/core/react_core.py`

#### 9.2.1 新增agent_id属性

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

#### 9.2.2 修改stream_callback调用

**位置**：第498行、第513行、第680行

```python
# 修改前
self.stream_callback(delta)

# 修改后
self.stream_callback(delta, agent_id=self.agent_id, agent_name=self.name)
```

### 9.3 SoloAgent层修改

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

### 9.4 Compiler层修改

**文件**：`SoloAgent/solo_agent/compiler/flow_compiler.py`

**位置**：第443-444行

```python
# 无需修改，agent_id已通过SoloAgent注入到ReActCore
if self._stream_callback and hasattr(agent, 'set_stream_callback'):
    agent.set_stream_callback(self._stream_callback)
```

### 9.5 AgenticFlow实例层修改

**文件**：`app/api/v1/run.py`

#### 9.5.1 修改ChunkCollector类

**位置**：文件开头新增类

```python
class ChunkCollector:
    """收集流式chunk并合并，支持多agent
    
    注意：agent_id用于区分不同agent的输出，不存储在data字段中
    """
    
    def __init__(self):
        self._chunks = []  # 原始chunk列表
        self._agent_data = {}  # 按agent_id分组的合并数据
        self._current_agent_id = None  # 当前agent_id
        self._current_agent_name = None  # 当前agent_name
        self._current_block = {}  # 当前agent的当前块
    
    def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
        """添加chunk，支持agent_id分组"""
        # 如果agent变化，切换到新agent的数据组
        if agent_id and agent_id != self._current_agent_id:
            # 保存当前agent的当前块
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
        
        # 确保当前agent有数据组
        if self._current_agent_id and self._current_agent_id not in self._agent_data:
            self._agent_data[self._current_agent_id] = {
                'agent_name': self._current_agent_name,
                'data': []
            }
        
        chunk_type = self._normalize_type(delta)
        content = self._extract_content(delta, chunk_type)
        
        # 合并逻辑：相同类型拼接到当前块，不同类型创建新块
        if self._current_block and self._current_block.get('type') == chunk_type:
            key = chunk_type
            self._current_block[key] = (self._current_block.get(key, "") or "") + content
        else:
            if self._current_block:
                self._agent_data[self._current_agent_id]['data'].append(self._current_block)
            self._current_block = {chunk_type: content, 'type': chunk_type}
        
        self._chunks.append({'delta': delta, 'agent_id': agent_id})
    
    def _normalize_type(self, delta: dict) -> str:
        """统一类型名称"""
        if isinstance(delta, str):
            return 'content'
        
        raw_type = delta.get("type", "content")
        
        if raw_type in ('thinking', 'think', 'reason', 'reasoning', 'reasoning_content'):
            return 'reasoning_content'
        
        if raw_type in ('tool_use', 'tool_call', 'tool_calls') or 'tool_calls' in delta:
            return 'tool_calls'
        
        return 'content'
    
    def _extract_content(self, delta: dict, chunk_type: str) -> str:
        """提取内容"""
        if isinstance(delta, str):
            return delta
        
        if chunk_type == 'reasoning_content':
            return delta.get('reasoning_content', '') or delta.get('thinking', '') or delta.get('text', '')
        elif chunk_type == 'tool_calls':
            return ''
        else:
            return delta.get('content', '') or delta.get('text', '')
    
    def get_agent_data(self) -> dict:
        """获取按agent_id分组的数据
        
        Returns:
            dict: {agent_id: {'agent_name': str, 'data': list}}
        """
        # 保存最后一块
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
        """获取合并后的数据（兼容单agent场景）"""
        agent_data = self.get_agent_data()
        # 返回第一个agent的数据
        for agent_id, data in agent_data.items():
            return data['data']
        return []
    
    def get_chunk_count(self) -> int:
        """获取原始chunk数量"""
        return len(self._chunks)
    
    def get_agent_ids(self) -> list:
        """获取所有涉及的agent_id列表"""
        return list(self._agent_data.keys())
```

#### 9.5.2 修改stream_callback函数

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
        # 1. 收集chunk（带agent_id）
        collector.add_chunk(delta, agent_id, agent_name)
        
        # 2. 发送到前端（带agent信息）
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

#### 9.5.3 修改run_websocket函数

**位置**：第670行附近

```python
@router.websocket("/ws/{agentic_flow_id}/{session_id}/{run_project_id}")
async def run_websocket(...):
    # ... 认证和初始化代码 ...
    
    # 创建chunk收集器
    collector = ChunkCollector()
    
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
    
    # 存储user消息
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
            event_callback=event_callback, stream_callback=stream_callback
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
        # 按agent_id分组存储assistant消息
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
            # 无数据时也存储一条记录
            await save_session_message(
                db=db, session_id=session_id, user_id=user_id,
                role="assistant", 
                data=[{"type": "content", "content": f"No output. Status: {status}"}],
                status=status, agent_id="default"
            )
```

#### 9.5.4 新增save_session_message函数

**位置**：文件开头

```python
async def save_session_message(
    db: Session, session_id: str, user_id: str, role: str,
    data: list, status: str = "completed", agent_id: str = "default",
    tokens: dict = None
):
    """保存session消息到数据库"""
    from app.core.database import SessionMessageModel
    
    # data不允许为空
    if not data:
        data = [{"type": "content", "content": "empty"}]
    
    # agent_id不允许为空
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

---

## 十、记忆读取修改方案

### 10.1 当前问题

**database_memory.py**中的`retrieve_all`方法：
- 不返回`agent_id`信息
- 无法按agent_id过滤记忆
- 所有agent共享全部记忆

**查询条件缺失agent_id过滤**：
```python
# database_memory.py:155-158
query = db.query(SessionMessageModel).filter(
    SessionMessageModel.session_id == self._session_id,
    SessionMessageModel.user_id == self._user_id
    # ❌ 缺少 agent_id 过滤
)
```

### 10.2 记忆读取应该在哪一层执行？

根据四层架构设计理念：

| 层级 | 职责 | 是否适合记忆读取 |
|------|------|------------------|
| **AgenticFlow实例层** | 负责模型记忆读取、存储、session创建、隔离管理 | **✅ 适合** |
| Compiler层 | 编译并执行flow，协调多个agent | ❌ 不适合 |
| SoloAgent层 | 基于ReActCore基类，负责组装各项plugins | ❌ 不适合 |
| ReActCore层 | 只负责接收数据、运行 | ❌ 不适合 |

**结论**: 记忆读取应该在 **AgenticFlow实例层** 执行，然后按 agent_id 分发给对应的 agent。

### 10.3 改进后的记忆分发流程

```
┌─────────────────────────────────────────────────────────────────┐
│ AgenticFlow实例层 (run.py)                                      │
│                                                                 │
│  1. 从数据库读取所有记忆 (按 session_id + user_id)              │
│     └─→ SELECT * FROM session_messages                         │
│         WHERE session_id = ? AND user_id = ?                   │
│                                                                 │
│  2. 按 agent_id 分组                                            │
│     └─→ {                                                       │
│             "main_agent": [msg1, msg2, ...],                   │
│             "search_agent": [msg3, msg4, ...],                 │
│             "default": [msg0]  # 无 agent_id 的共享记忆         │
│         }                                                       │
│                                                                 │
│  3. 传递给 Compiler 层                                          │
│     └─→ compiled_flow.set_agent_memories(agent_memories)       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Compiler层 (flow_compiler.py)                                   │
│                                                                 │
│  4. 在 _execute_agent 时，获取对应 agent 的记忆                 │
│     └─→ agent_memory = self._agent_memories.get(agent_id, [])  │
│     └─→ agent.set_message_history(agent_memory)                │
└─────────────────────────────────────────────────────────────────┘
```

### 10.4 记忆分发策略

| Agent类型 | 获取的记忆 |
|-----------|-----------|
| MainAgent | 自己的记忆 + 共享记忆 (agent_id=null 或 default) |
| SubAgent | 只获取自己的记忆 (agent_id 匹配) |
| 新Agent | 无历史记忆 |

### 10.5 代码实现

#### 10.5.1 AgenticFlow实例层 - 记忆读取与分发

**文件**: `app/api/v1/run.py`

```python
async def load_and_distribute_memories(
    db: Session, 
    session_id: str, 
    user_id: str
) -> Dict[str, List[Dict]]:
    """从数据库读取记忆并按 agent_id 分发
    
    Returns:
        Dict[str, List[Dict]]: {agent_id: [message1, message2, ...]}
    """
    from app.core.database import SessionMessageModel
    
    # 1. 查询所有记忆
    records = db.query(SessionMessageModel).filter(
        SessionMessageModel.session_id == session_id,
        SessionMessageModel.user_id == user_id
    ).order_by(SessionMessageModel.message_index).all()
    
    # 2. 按 agent_id 分组
    agent_memories = {}
    shared_memories = []  # 无 agent_id 的共享记忆
    
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
    
    # 3. 将共享记忆合并到每个 agent 的记忆中
    for agent_id in agent_memories:
        agent_memories[agent_id] = shared_memories + agent_memories[agent_id]
    
    # 4. 如果没有 agent_id 分组，创建默认组
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

#### 10.5.2 修改run_websocket函数

```python
@router.websocket("/ws/{agentic_flow_id}/{session_id}/{run_project_id}")
async def run_websocket(...):
    # ... 认证和初始化代码 ...
    
    # 1. 读取并分发记忆
    agent_memories = await load_and_distribute_memories(db, session_id, user_id)
    
    # 2. 创建chunk收集器
    collector = ChunkCollector()
    
    # ... stream_callback 定义 ...
    
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
            event_callback=event_callback, 
            stream_callback=stream_callback,
            agent_memories=agent_memories  # 新增：传递分发后的记忆
        )
        # ...
```

#### 10.5.3 Compiler层 - 接收并分发记忆

**文件**: `SoloAgent/solo_agent/compiler/flow_compiler.py`

```python
class CompiledFlow:
    def __init__(self, ...):
        # ... 其他初始化 ...
        self._agent_memories: Dict[str, List[Dict]] = {}  # 新增
    
    def set_agent_memories(self, memories: Dict[str, List[Dict]]) -> None:
        """设置按 agent_id 分组的记忆（由 AgenticFlow实例层调用）"""
        self._agent_memories = memories
    
    async def _execute_agent(self, agent, input_message, db, context):
        agent_id = agent.agent_id
        agent_name = agent.name
        
        # 获取该 agent 的记忆
        agent_memory = self._agent_memories.get(agent_id, [])
        
        # 传递给 agent
        if agent_memory and hasattr(agent, 'set_message_history'):
            agent.set_message_history(agent_memory)
        
        # ... 其他执行逻辑 ...
```

#### 10.5.4 修改FlowRunner.run_from_json

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
    
    # 新增：设置分发后的记忆
    if agent_memories:
        compiled_flow.set_agent_memories(agent_memories)
    
    return await compiled_flow.run(input_message, context)
```

---

## 十一、数据库修改要求

### 11.1 agent_id字段修改

**文件**：`app/core/database.py`

**当前定义**（第182行）：
```python
agent_id = Column(String(36), nullable=True, index=True)
```

**修改为**：
```python
agent_id = Column(String(36), nullable=False, index=True, default="default")
```

### 11.2 data字段修改

**当前定义**（第185行）：
```python
data = Column(JSON, nullable=True)
```

**修改为**：
```python
data = Column(JSON, nullable=False, default=[])
```

### 11.3 相关代码修改

#### 11.3.1 add_session_message方法

**文件**：`app/core/database.py` 第698-726行

```python
def add_session_message(self, db: Session, session_id: str, user_id: str,
                        role: str, data: list = None, agent_id: str = None,
                        parent_message_id: str = None,
                        prompt_tokens: int = None, completion_tokens: int = None,
                        total_tokens: int = None) -> SessionMessageModel:
    """添加会话消息。"""
    # data不允许为空，至少是空列表
    if data is None:
        data = []
    
    # agent_id不允许为空
    if agent_id is None:
        agent_id = "default"
    
    # ... 其余代码 ...
```

#### 11.3.2 _save_message_to_database方法

**文件**：`SoloAgent/plugins/memory/database_memory.py` 第190-237行

```python
def _save_message_to_database(self, message_data: Dict[str, Any]) -> Optional[str]:
    """保存单条消息到数据库。"""
    data = message_data.get("data", [])
    if data is None:
        data = []
    
    agent_id = message_data.get("agent_id") or self._agentic_flow_id or "default"
    
    record = SessionMessageModel(
        session_id=self._session_id,
        user_id=self._user_id,
        agent_id=agent_id,
        role=message_data.get("role", "user"),
        data=data,
        # ...
    )
```

### 11.4 数据迁移脚本

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

## 十二、完整代码改动清单

### 12.1 新增代码

| 文件 | 新增内容 | 位置 |
|------|----------|------|
| `run.py` | `ChunkCollector`类 | 文件开头 |
| `run.py` | `save_session_message`函数 | 文件开头 |
| `run.py` | `load_and_distribute_memories`函数 | 文件开头 |
| `run.py` | `_extract_content_from_data`函数 | 文件开头 |
| `flow_compiler.py` | `set_agent_memories`方法 | CompiledFlow类中 |
| `flow_compiler.py` | `_agent_memories`属性 | `__init__`中 |

### 12.2 修改代码

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

### 12.3 删除代码

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
| `database_memory.py` | `retrieve_all`方法（移除或改为调用新方法） | 第312行 |

### 12.4 待删除函数/接口的配套调用分析

以下分析每个待删除函数/属性的所有调用位置，确保删除时不会遗漏：

#### A. `reset_accumulated_content()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:86-90 | `def reset_accumulated_content(self):` |
| 调用1 | flow_compiler.py:1218 | `compiled_flow.reset_accumulated_content()` |

**结论**：定义和调用均在flow_compiler.py，需同时删除。

---

#### B. `get_accumulated_data()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:92-99 | `def get_accumulated_data(self):` |
| 调用1 | flow_compiler.py:306 | `accumulated_data = self.get_accumulated_data()` |
| 调用2 | flow_compiler.py:1271 | `accumulated_data = compiled_flow.get_accumulated_data()` |

**结论**：定义和调用均在flow_compiler.py，需同时删除。

---

#### C. `get_accumulated_content()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:101-107 | `def get_accumulated_content(self):` |
| 无调用 | - | - |

**结论**：该方法无任何调用，可直接删除。

---

#### D. `_init_session_memory()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:200-226 | `async def _init_session_memory(self):` |
| 调用1 | flow_compiler.py:283 | `await self._init_session_memory()` |
| 调用2 | flow_compiler.py:1224 | `await compiled_flow._init_session_memory()` |

**结论**：定义和调用均在flow_compiler.py，需同时删除。记忆初始化移至AgenticFlow实例层。

---

#### E. `_save_message_to_memory()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:229-261 | `async def _save_message_to_memory(...):` |
| 调用1 | flow_compiler.py:286 | `await self._save_message_to_memory("user", user_data)` |
| 调用2 | flow_compiler.py:352 | `await self._save_message_to_memory("assistant", assistant_data, tokens)` |
| 调用3 | flow_compiler.py:556 | `await self._save_message_to_memory(...)` |
| 调用4 | flow_compiler.py:1235 | `await compiled_flow._save_message_to_memory("user", ...)` |
| 调用5 | flow_compiler.py:1252 | `await compiled_flow._save_message_to_memory("assistant", ...)` |
| 调用6 | flow_compiler.py:1298 | `await compiled_flow._save_message_to_memory("assistant", ...)` |

**结论**：定义和6处调用均在flow_compiler.py，需同时删除。消息存储移至AgenticFlow实例层。

---

#### F. `_get_message_history()` 方法

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:263-271 | `async def _get_message_history(self):` |
| 调用1 | flow_compiler.py:446 | `message_history = await self._get_message_history()` |

**结论**：需删除，改为从`_agent_memories`获取。

---

#### G. `_session_memory` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:80 | `self._session_memory = None` |
| 使用1 | flow_compiler.py:200 | `if not self._session_memory:` |
| 使用2 | flow_compiler.py:206 | `self._session_memory = DatabaseMemoryPlugin(...)` |
| 使用3 | flow_compiler.py:222 | `message_count = self._session_memory.message_count` |
| 使用4 | flow_compiler.py:265 | `if not self._session_memory:` |
| 使用5 | flow_compiler.py:268 | `messages = await self._session_memory.retrieve_all()` |
| 使用6 | flow_compiler.py:856 | `cached._session_memory = None` |

**结论**：该属性有6处使用，需全部删除。记忆管理移至AgenticFlow实例层。

---

#### H. `_message_saved` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:82 | `self._message_saved = False` |
| 使用1 | flow_compiler.py:350 | `if not self._message_saved:` |
| 使用2 | flow_compiler.py:351 | `self._message_saved = True` |
| 使用3 | flow_compiler.py:354 | `logger.info("Message already saved...")` |

**结论**：该属性有3处使用，需全部删除。

---

#### I. `_accumulated_data` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:83 | `self._accumulated_data = []` |
| 使用1 | flow_compiler.py:95 | `return self._accumulated_data` |
| 使用2 | flow_compiler.py:103 | `for item in self._accumulated_data:` |
| 使用3 | flow_compiler.py:133 | `self._accumulated_data.append(self._current_block)` |
| 使用4 | flow_compiler.py:144 | `self._accumulated_data.append(self._current_block)` |
| 使用5 | flow_compiler.py:151 | `self._accumulated_data.append(self._current_block)` |
| 使用6 | flow_compiler.py:157 | `self._accumulated_data.append(tool_block)` |

**结论**：该属性有6处使用，需全部删除。收集逻辑移至AgenticFlow实例层的ChunkCollector。

---

#### J. `_current_block` 属性

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:84 | `self._current_block = None` |
| 使用1 | flow_compiler.py:88 | `self._current_block = None` |
| 使用2 | flow_compiler.py:103 | `if self._current_block:` |
| 使用3 | flow_compiler.py:131 | `if self._current_block and self._current_block.get("type") == "content":` |
| 使用4 | flow_compiler.py:132 | `self._current_block["content"] = ...` |
| 使用5 | flow_compiler.py:135 | `self._current_block = {...}` |
| 使用6 | flow_compiler.py:136 | `self._accumulated_data.append(self._current_block)` |
| 使用7 | flow_compiler.py:142 | `if self._current_block and self._current_block.get("type") == "reasoning_content":` |
| 使用8 | flow_compiler.py:143 | `self._current_block["reasoning_content"] = ...` |
| 使用9 | flow_compiler.py:145 | `self._current_block = {...}` |
| 使用10 | flow_compiler.py:149 | `self._current_block = None` |
| 使用11 | flow_compiler.py:155 | `if self._current_block and self._current_block.get("type") == "content":` |
| 使用12 | flow_compiler.py:156 | `self._current_block["content"] = ...` |
| 使用13 | flow_compiler.py:159 | `self._current_block = {...}` |

**结论**：该属性有13处使用，需全部删除。收集逻辑移至AgenticFlow实例层的ChunkCollector。

---

#### K. `set_stream_callback()` 方法（需简化）

| 调用位置 | 文件 | 代码 |
|---------|------|------|
| 定义 | flow_compiler.py:110-164 | `def set_stream_callback(self, callback):` |
| 调用1 | flow_compiler.py:1176 | `compiled_flow.set_stream_callback(stream_callback)` |
| 调用2 | flow_compiler.py:1230 | `compiled_flow.set_stream_callback(...)` |

**结论**：方法需简化（移除累积逻辑），保留回调设置功能，调用处保留。

---

## 十四、接口改动影响分析

### 14.1 stream_callback签名修改影响

**修改内容**: `stream_callback(delta: dict)` → `stream_callback(delta: dict, agent_id: str = None, agent_name: str = None)`

**影响范围**:

| 调用位置 | 文件 | 代码 | 需要修改 |
|---------|------|------|----------|
| 定义 | react_core.py:498 | `self.stream_callback(delta)` | **是** - 增加agent_id参数 |
| 定义 | react_core.py:513 | `self.stream_callback(delta)` | **是** - 增加agent_id参数 |
| 定义 | react_core.py:680 | `self.stream_callback({"content": ...})` | **是** - 增加agent_id参数 |
| 传递 | agent.py:79 | `set_stream_callback(callback)` | **是** - 注入agent_id |
| 传递 | flow_compiler.py:444 | `agent.set_stream_callback(self._stream_callback)` | **否** - 透传 |
| 传递 | flow_compiler.py:1176 | `compiled_flow.set_stream_callback(stream_callback)` | **否** - 透传 |
| 实现 | run.py:254 | `def stream_callback(delta: dict):` | **是** - 修改签名 |
| 实现 | run.py:724 | `def stream_callback(delta: dict):` | **是** - 修改签名 |

---

### 14.2 FlowRunner.run_from_json参数修改影响

**修改内容**: 新增 `agent_memories: Dict[str, List[Dict]] = None` 参数

**所有调用位置分析**:

| 文件 | 行号 | 函数 | 是否需要修改 | 说明 |
|------|------|------|-------------|------|
| run.py | 172 | execute_workflow | **否** | 非流式执行，无需记忆分发 |
| run.py | 265 | stream_workflow | **是** | 需要添加记忆读取和agent_memories参数 |
| run.py | 767 | run_websocket | **是** | 需要添加记忆读取和agent_memories参数 |
| flow_compiler.py | 1349 | stream_run_from_json | **是** | 需要添加agent_memories参数传递 |
| agenticflow_gateway.py | 194 | run_agentic_flow | **否** | 非流式执行，无需记忆分发 |
| agenticflow_gateway.py | 270 | run_agentic_flow_async | **否** | 非流式执行，无需记忆分发 |
| test_run.py | 9 | 测试代码 | **否** | 测试代码可选修改 |

**详细修改说明**:

#### run.py:265 - stream_workflow函数

```python
# 修改前
result = await FlowRunner.run_from_json(
    request.canvas_data,
    request.input_message,
    user_id=current_user.id,
    agentic_flow_id=request.agentic_flow_id,
    session_id=request.session_id,
    run_project_id=request.run_project_id,
    context=request.context or {},
    stream_callback=stream_callback
)

# 修改后
agent_memories = await load_and_distribute_memories(db, request.session_id, current_user.id)
result = await FlowRunner.run_from_json(
    request.canvas_data,
    request.input_message,
    user_id=current_user.id,
    agentic_flow_id=request.agentic_flow_id,
    session_id=request.session_id,
    run_project_id=request.run_project_id,
    context=request.context or {},
    stream_callback=stream_callback,
    agent_memories=agent_memories
)
```

#### run.py:767 - run_websocket函数

```python
# 修改前
result = await FlowRunner.run_from_json(
    canvas_data,
    input_message,
    user_id=user_id,
    agentic_flow_id=agentic_flow_id,
    session_id=session_id,
    run_project_id=run_project_id,
    event_callback=event_callback,
    stream_callback=stream_callback
)

# 修改后
agent_memories = await load_and_distribute_memories(db, session_id, user_id)
result = await FlowRunner.run_from_json(
    canvas_data,
    input_message,
    user_id=user_id,
    agentic_flow_id=agentic_flow_id,
    session_id=session_id,
    run_project_id=run_project_id,
    context=context,  # 补充缺失的context参数
    event_callback=event_callback,
    stream_callback=stream_callback,
    agent_memories=agent_memories
)
```

#### flow_compiler.py:1349 - stream_run_from_json函数

```python
# 修改前
result = await FlowRunner.run_from_json(
    json_data, input_message, user_id, agentic_flow_id, session_id, run_project_id, context,
    event_callback=event_callback
)

# 修改后
result = await FlowRunner.run_from_json(
    json_data, input_message, user_id, agentic_flow_id, session_id, run_project_id, context,
    event_callback=event_callback,
    agent_memories=agent_memories  # 新增参数
)
```

---

### 14.3 前端接口影响分析

#### 14.3.1 get_session_messages接口

**当前接口**: `GET /sessions/{session_id}/messages`

**影响**: 需要新增agent_id过滤参数

```python
# 修改后
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

#### 14.3.2 新增接口: get_session_messages_by_agent

**新增接口**: `GET /sessions/{session_id}/messages/by-agent`

**用途**: 返回按agent_id分组的消息，供前端显示和WebSocket复用

```python
@router.get("/sessions/{session_id}/messages/by-agent")
async def get_session_messages_by_agent(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取按agent_id分组的会话消息"""
    # 复用load_and_distribute_memories函数
    agent_memories = await load_and_distribute_memories(db, session_id, current_user.id)
    
    return {
        "code": 200,
        "message": "Messages retrieved by agent",
        "data": agent_memories
    }
```

#### 14.3.3 WebSocket消息格式变化

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

**前端影响**: 前端需要适配新的消息格式，支持按agent_id显示不同agent的输出。

---

### 14.4 可删除/简化的接口

| 文件 | 接口/方法 | 处理方式 | 原因 |
|------|----------|----------|------|
| run.py | get_session_history | **评估删除** | 功能与get_session_messages重复 |
| flow_compiler.py | _get_message_history | **删除** | 改用_agent_memories |
| database_memory.py | retrieve_all | **简化或删除** | 记忆读取移至AgenticFlow实例层 |
| flow_compiler.py | _init_session_memory | **删除** | 记忆初始化移至AgenticFlow实例层 |
| flow_compiler.py | _save_message_to_memory | **删除** | 消息存储移至AgenticFlow实例层 |

---

### 14.5 接口统一化方案

```
┌─────────────────────────────────────────────────────────────────┐
│                    接口调用关系图                                │
└─────────────────────────────────────────────────────────────────┘

前端请求
    │
    ├── GET /sessions/{session_id}/messages
    │   └── 返回消息列表（支持agent_id过滤）
    │
    ├── GET /sessions/{session_id}/messages/by-agent
    │   └── load_and_distribute_memories()
    │   └── 返回按agent_id分组的消息
    │
    └── WebSocket /ws/{agentic_flow_id}/{session_id}/{run_project_id}
        ├── load_and_distribute_memories() → 读取记忆
        ├── FlowRunner.run_from_json(agent_memories=...) → 传递给Compiler层
        └── save_session_message() → 存储消息
```

**统一化优势**:
1. **代码复用**: 前端记忆显示和WebSocket执行复用同一函数
2. **数据一致性**: 确保前端显示和后端执行使用相同的数据格式
3. **维护简单**: 只需维护一套记忆读取逻辑
4. **前端友好**: 提供多种接口格式供前端选择

---

## 十五、总结

| 项目 | 改进前 | 改进后 |
|------|--------|--------|
| 存储位置 | Compiler层（错位） | AgenticFlow实例层（正确） |
| chunk收集 | 不完善 | ChunkCollector统一收集 |
| 多Agent支持 | 无 | 支持agent_id区分 |
| 记忆读取 | 无agent过滤 | 支持按agent_id读取 |
| 异常安全 | 无保证 | finally块确保存储 |
| 数据完整性 | data可为空 | data必填，至少空数组 |
| agent_id | 可为空 | 必填 |
| 代码清晰度 | 逻辑分散 | 职责明确 |
| 架构遵循 | 违反四层架构 | 遵循四层架构 |
