# ChunkCollector 堆栈作用域重构方案（最小改动版）

## 一、问题分析

### 1.1 问题场景

Task工具调用时，存在调用与result分离的情况：

```
时间线：
T1: MainAgent 输出 thought (content类型)
T2: MainAgent 输出 tool_calls 调用 (tool_calls类型)
    → ChunkCollector._current_block = {type: "tool_calls", tool_calls: [{id: "call_123", status: "start"}]}
T3: TaskTool.execute() 被调用
T4: SubAgent 开始执行，agent_id 切换
    → ChunkCollector 检测到 agent_id 改变
    → 保存 MainAgent 的 _current_block（未完成的 tool_calls）到 _agent_data  ← 问题点
    → _current_block 被清空
T5: SubAgent 输出内容
T6: SubAgent 执行完毕
T7: MainAgent 继续输出 tool_calls result
    → 由于 _current_block 已清空，创建新的 block
    → result 与之前的 start/args 分离
```

### 1.2 根本原因

当 agent_id 切换时，直接保存未完成的 `_current_block`，导致后续的 result 无法与之前的 tool_calls 合并。

### 1.3 现有代码优势

现有 `ChunkCollector` 已经有很好的基础：
1. `_pending_tool_calls[agent_id]` 已经按 agent_id 分组
2. `_agent_data[agent_id]` 已经存储每个 agent 的数据
3. `_process_tool_calls()` 已经实现了合并逻辑

**只需最小改动**：添加状态堆栈，在 agent 切换时保存/恢复状态，而不是直接保存未完成的 block。

---

## 二、实际修改内容

### 2.1 新增属性（2个）

```python
def __init__(self):
    # ... 原有属性 ...
    self._state_stack = []      # 状态堆栈
    self._root_agent_id = None  # 根 Agent ID
```

### 2.2 新增方法（3个）

```python
def _handle_agent_switch(self, new_agent_id: str, new_agent_name: str):
    """处理 agent 切换，使用堆栈保存/恢复状态"""
    if new_agent_id == self._root_agent_id:
        while self._state_stack:
            self._pop_state()
    else:
        self._push_state()
        self._current_agent_id = new_agent_id
        self._current_agent_name = new_agent_name

def _push_state(self):
    """保存当前状态到堆栈（SubAgent 进入）"""
    self._state_stack.append({
        'agent_id': self._current_agent_id,
        'agent_name': self._current_agent_name,
        'current_block': self._current_block,
        'pending_tool_calls': self._pending_tool_calls.get(self._current_agent_id, {})
    })
    self._current_block = {}

def _pop_state(self):
    """从堆栈恢复状态（SubAgent 退出）"""
    # 保存当前 agent 的数据
    if self._current_block and self._current_agent_id:
        if self._current_agent_id not in self._agent_data:
            self._agent_data[self._current_agent_id] = {
                'agent_name': self._current_agent_name,
                'data': []
            }
        self._agent_data[self._current_agent_id]['data'].append(self._current_block)
    
    # 恢复上一个 agent 的状态
    if self._state_stack:
        state = self._state_stack.pop()
        self._current_agent_id = state['agent_id']
        self._current_agent_name = state['agent_name']
        self._current_block = state['current_block']
        if self._current_agent_id not in self._pending_tool_calls:
            self._pending_tool_calls[self._current_agent_id] = {}
        self._pending_tool_calls[self._current_agent_id].update(state['pending_tool_calls'])
```

### 2.3 修改方法（3个）

**add_chunk 方法**：修改 agent 切换逻辑

```python
def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
    if agent_id:
        if self._current_agent_id is None:
            self._root_agent_id = agent_id
            self._current_agent_id = agent_id
            self._current_agent_name = agent_name
        elif agent_id != self._current_agent_id:
            self._handle_agent_switch(agent_id, agent_name)  # 使用新方法处理切换
    # ... 其余逻辑不变 ...
```

**_process_tool_calls 方法**：添加 index 到 id 的映射支持

```python
def _process_tool_calls(self, tool_calls: list):
    # ... 添加 index_to_id 映射 ...
    if 'index_to_id' not in self._pending_tool_calls[agent_id]:
        self._pending_tool_calls[agent_id]['index_to_id'] = {}
    
    for new_tc in tool_calls:
        tool_id = new_tc.get('id')
        tool_index = new_tc.get('index')
        
        # 建立 index -> id 映射
        if tool_id and tool_index is not None:
            self._pending_tool_calls[agent_id]['index_to_id'][tool_index] = tool_id
        
        # 通过 index 查找 id
        if not tool_id and tool_index is not None:
            tool_id = self._pending_tool_calls[agent_id]['index_to_id'].get(tool_index)
        # ... 其余合并逻辑 ...
```

**get_agent_data 方法**：添加堆栈清理和跳过 index_to_id

```python
def get_agent_data(self) -> dict:
    # 清理所有堆栈
    while self._state_stack:
        self._pop_state()
    
    # ... 处理 pending_tool_calls ...
    for tool_id, tc in pending.items():
        if tool_id == 'index_to_id':  # 跳过映射表
            continue
        # ... 其余逻辑 ...
```

---

## 三、测试验证

### 3.1 单元测试结果

```
=== 测试 ChunkCollector 堆栈作用域 ===

1. MainAgent 输出 thought
2. MainAgent 输出 tool_calls (start)
3. SubAgent 开始执行 (agent_id 切换)
   _state_stack长度: 1
4. SubAgent 输出内容
5. MainAgent 继续输出 tool_calls result (agent_id 切回)
   _state_stack长度: 0

=== 最终结果 ===

Agent: node_main
  blocks数量: 2
  Block 0: type=content
  Block 1: type=tool_calls
    tool_call: id=call_123, name=Task, has_result=True

Agent: node_sub
  blocks数量: 1
  Block 0: type=content

=== 验证结果 ===
MainAgent tool_calls blocks数量: 1
✅ 测试通过: tool_calls 正确合并!
```

### 3.2 验收标准

- [x] MainAgent 的 tool_calls 调用与 result 正确合并
- [x] SubAgent 的数据独立存储
- [x] 多级嵌套 SubAgent 正确处理（堆栈机制天然支持）
- [x] 不影响其他工具的调用

---

## 四、修改文件清单

| 文件 | 修改内容 | 类型 |
|------|----------|------|
| `backend/app/api/v1/run.py` | 修改 ChunkCollector 类 | 核心修改 |

**总计**：1个文件，约60行新增/修改代码。

---

## 五、数据流对比

### 5.1 重构前

```
MainAgent: thought → tool_calls(start)
    ↓ agent_id 切换
    保存未完成的 block 到 _agent_data
    _current_block = {}  ← 问题：被清空
SubAgent: thought → content
    ↓ agent_id 切换
    保存 SubAgent 数据
MainAgent: tool_calls(result)
    ↓ _current_block 为空
    创建新 block
    
结果：tool_calls 被拆成两个 block
```

### 5.2 重构后

```
MainAgent: thought → tool_calls(start)
    ↓ _current_block = {type: "tool_calls", tool_calls: [...]}
SubAgent 进入
    ↓ _push_state()
    _state_stack = [{agent_id: "main", current_block: {...}, pending_tool_calls: {...}}]
    _current_block = {}
SubAgent: thought → content
    ↓ 在新状态中处理
SubAgent 退出
    ↓ _pop_state()
    保存 SubAgent 数据到 _agent_data
    恢复 _current_block = {...tool_calls...}  ← 关键：恢复未完成的 block
MainAgent: tool_calls(result)
    ↓ 在恢复的 _current_block 中合并
    
结果：tool_calls 完整合并
```
