# SubAgent/Task 工具修复方案

## 一、问题描述

### 1.1 当前问题

SubAgent 的消息存储存在以下问题：

| 问题 | 表现 | 影响 |
|------|------|------|
| 空 content 字段 | `{"content": "", "type": "content"}` | 数据冗余，前端显示异常 |
| tool_calls 未正确记录 | data 字段中缺少 tool_calls 类型数据 | SubAgent 的工具调用记录丢失 |

### 1.2 问题示例

```json
[
  {
    "content": "",
    "type": "content"
  },
  {
    "reasoning_content": "用户想要使用test skill来计算1+1...",
    "type": "reasoning_content"
  },
  {
    "content": "根据test skill的指引，计算结果为：\n\n**1+1=3**",
    "type": "content"
  }
]
```

**问题分析**：
1. 第一个块 `{"content": "", "type": "content"}` 是空的，不应该存在
2. 缺少 tool_calls 类型的数据块

---

## 二、根因分析

### 2.1 空 content 字段的产生原因

**位置**：`backend/app/api/v1/run.py` 第 140-145 行

```python
# ChunkCollector.add_chunk() 方法
else:
    if self._current_block and self._current_block.get('type') == chunk_type:
        self._current_block[chunk_type] = (self._current_block.get(chunk_type, "") or "") + content
    else:
        if self._current_block:
            self._agent_data[self._current_agent_id]['data'].append(self._current_block)
        self._current_block = {chunk_type: content, 'type': chunk_type}  # ← 问题在这里
```

**问题**：
- 当 `content` 为空字符串 `""` 时，仍然会创建块 `{chunk_type: "", 'type': chunk_type}`
- `_extract_content()` 方法在没有内容时返回空字符串，而不是跳过

**触发场景**：
1. 流式响应开始时，模型可能发送空的 content delta
2. 切换 agent_id 时，可能产生空块
3. `to_delta()` 返回空字典时，仍然被添加到 collector

### 2.2 tool_calls 未正确记录的原因

**位置**：`backend/SoloAgent/core/react_core.py` 第 828-831 行

```python
# 过滤掉 tool_use 和 tool_calls 块（由 ToolCallEventManager 处理）
filtered_content = [
    block for block in chunk.content
    if not (isinstance(block, dict) and block.get("type") in ("tool_use", "tool_calls"))
]
```

**问题**：
- `to_delta()` 方法将 `tool_use` 块转换为 `tool_calls` 格式
- 但在 `_reasoning()` 中，`tool_use` 和 `tool_calls` 块被过滤掉了
- 这些块由 `ToolCallEventManager` 处理，通过 `_convert_to_frontend_format()` 发送

**关键发现**：
- `ToolCallEventManager._convert_to_frontend_format()` 正确发送了 tool_calls 格式的 delta
- `ChunkCollector` 正确处理了 tool_calls 类型
- 但问题可能在于 **SubAgent 的 agent_id 切换时机**

### 2.3 MainAgent vs SubAgent 的差异

| 维度 | MainAgent | SubAgent |
|------|-----------|----------|
| agent_id 来源 | 节点 ID | 节点 ID |
| stream_callback 设置 | `CompiledFlow._execute_agent()` | `TaskTool.execute()` |
| 消息收集 | ChunkCollector | ChunkCollector（相同） |
| tool_calls 处理 | ToolCallEventManager | ToolCallEventManager（相同） |

**关键差异**：
- MainAgent 在 `CompiledFlow._execute_agent()` 中设置 `stream_callback`
- SubAgent 在 `TaskTool.execute()` 中设置 `stream_callback`
- 两者使用相同的 `ChunkCollector`，但 **SubAgent 的 agent_id 可能在某些时刻未正确传递**

---

## 三、修复方案

### 3.1 修复空 content 字段

**修改位置**：`backend/app/api/v1/run.py` - `ChunkCollector.add_chunk()` 方法

**修改内容**：

```python
def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
    """添加chunk，支持agent_id分组"""
    # ... 省略前面的代码 ...
    
    chunk_type = self._normalize_type(delta)
    content = self._extract_content(delta, chunk_type)
    
    # 新增：跳过空内容
    if not content and chunk_type != 'tool_calls':
        # tool_calls 可能为空列表（表示结束），不跳过
        return
    
    if chunk_type == 'tool_calls':
        # tool_calls 类型：按 id 拼接合并
        # ... 省略 tool_calls 处理代码 ...
    else:
        if self._current_block and self._current_block.get('type') == chunk_type:
            self._current_block[chunk_type] = (self._current_block.get(chunk_type, "") or "") + content
        else:
            if self._current_block:
                self._agent_data[self._current_agent_id]['data'].append(self._current_block)
            self._current_block = {chunk_type: content, 'type': chunk_type}
    
    self._chunks.append({'delta': delta, 'agent_id': agent_id})
```

**关键修改**：
1. 在提取 content 后，检查是否为空
2. 如果 content 为空且不是 tool_calls 类型，直接返回，跳过该 chunk

### 3.2 确保 tool_calls 正确记录

**修改位置**：`backend/app/api/v1/run.py` - `ChunkCollector.add_chunk()` 方法

**修改内容**：

```python
if chunk_type == 'tool_calls':
    # tool_calls 类型：按 id 拼接合并
    if not content:  # 空的 tool_calls，跳过
        return
    
    if self._current_block and self._current_block.get('type') == 'tool_calls':
        existing_tool_calls = self._current_block.get('tool_calls', [])
        for new_tool_call in content:
            # ... 省略合并逻辑 ...
        self._current_block['tool_calls'] = existing_tool_calls
    else:
        # 当前块不是 tool_calls 类型，保存旧块，创建新块
        if self._current_block and self._current_agent_id:
            if self._current_agent_id not in self._agent_data:
                self._agent_data[self._current_agent_id] = {
                    'agent_name': self._current_agent_name,
                    'data': []
                }
            self._agent_data[self._current_agent_id]['data'].append(self._current_block)
        self._current_block = {'type': 'tool_calls', 'tool_calls': content}
```

### 3.3 清理已保存的空块

**修改位置**：`backend/app/api/v1/run.py` - `ChunkCollector.get_agent_data()` 方法

**修改内容**：

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
            # 检查块是否有效
            block_type = block.get('type')
            if block_type == 'content' and not block.get('content', '').strip():
                continue  # 跳过空的 content 块
            if block_type == 'reasoning_content' and not block.get('reasoning_content', '').strip():
                continue  # 跳过空的 reasoning_content 块
            if block_type == 'tool_calls' and not block.get('tool_calls', []):
                continue  # 跳过空的 tool_calls 块
            cleaned_data.append(block)
        self._agent_data[agent_id]['data'] = cleaned_data
    
    return self._agent_data
```

---

## 四、完整修复代码

### 4.1 ChunkCollector 完整修复

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
        
        # 跳过空内容（tool_calls 除外，因为可能有 status/result 更新）
        if chunk_type != 'tool_calls' and not content:
            return
        
        if chunk_type == 'tool_calls':
            if not content:  # 空的 tool_calls 列表，跳过
                return
            
            if self._current_block and self._current_block.get('type') == 'tool_calls':
                existing_tool_calls = self._current_block.get('tool_calls', [])
                for new_tool_call in content:
                    tool_id = new_tool_call.get('id')
                    if tool_id:
                        found = False
                        for existing_call in existing_tool_calls:
                            if existing_call.get('id') == tool_id:
                                found = True
                                for key, value in new_tool_call.items():
                                    if key == 'function' and isinstance(value, dict):
                                        if 'function' not in existing_call:
                                            existing_call['function'] = {}
                                        existing_func = existing_call['function']
                                        for func_key, func_value in value.items():
                                            if func_key == 'arguments':
                                                existing_func['arguments'] = existing_func.get('arguments', '') + func_value
                                            else:
                                                if func_key not in existing_func:
                                                    existing_func[func_key] = func_value
                                    elif key not in existing_call or existing_call.get(key) is None:
                                        existing_call[key] = value
                                    elif key in ['status', 'result', 'error']:
                                        existing_call[key] = value
                                break
                        if not found:
                            existing_tool_calls.append(new_tool_call)
                self._current_block['tool_calls'] = existing_tool_calls
            else:
                if self._current_block and self._current_agent_id:
                    if self._current_agent_id not in self._agent_data:
                        self._agent_data[self._current_agent_id] = {
                            'agent_name': self._current_agent_name,
                            'data': []
                        }
                    self._agent_data[self._current_agent_id]['data'].append(self._current_block)
                self._current_block = {'type': 'tool_calls', 'tool_calls': content}
        else:
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
        raw_type = delta.get("type", None)
        if raw_type in ('thinking', 'think', 'reason', 'reasoning_content'):
            return 'reasoning_content'
        if raw_type in ('tool_use', 'tool_call', 'tool_calls') or 'tool_calls' in delta:
            return 'tool_calls'
        if 'reasoning_content' in delta and delta.get('reasoning_content'):
            return 'reasoning_content'
        if 'content' in delta:
            return 'content'
        return 'content'
    
    def _extract_content(self, delta: dict, chunk_type: str):
        if isinstance(delta, str):
            return delta
        if chunk_type == 'reasoning_content':
            return delta.get('reasoning_content', '') or delta.get('thinking', '') or delta.get('text', '')
        elif chunk_type == 'tool_calls':
            return delta.get('tool_calls', [])
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
        
        # 清理空块
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

---

## 五、修复效果预期

### 5.1 修复前

```json
[
  {
    "content": "",
    "type": "content"
  },
  {
    "reasoning_content": "用户想要使用test skill来计算1+1...",
    "type": "reasoning_content"
  },
  {
    "content": "根据test skill的指引，计算结果为：\n\n**1+1=3**",
    "type": "content"
  }
]
```

### 5.2 修复后

```json
[
  {
    "reasoning_content": "用户想要使用test skill来计算1+1...",
    "type": "reasoning_content"
  },
  {
    "tool_calls": [
      {
        "id": "call_xxx",
        "type": "function",
        "function": {
          "name": "Skill",
          "arguments": "{\"skill_name\": \"test\", \"task\": \"计算1+1\"}"
        }
      }
    ],
    "type": "tool_calls"
  },
  {
    "content": "根据test skill的指引，计算结果为：\n\n**1+1=3**",
    "type": "content"
  }
]
```

---

## 六、验收标准

### 6.1 功能验收

- [ ] MainAgent 和 SubAgent 的消息存储格式完全一致
- [ ] 不再出现空的 content 字段
- [ ] tool_calls 正确记录到 data 字段中
- [ ] reasoning_content 正确记录

### 6.2 数据一致性验收

- [ ] 无空块数据
- [ ] 无数据丢失
- [ ] 消息关联关系正确

### 6.3 前端显示验收

- [ ] MainAgent 和 SubAgent 的前端显示效果一致
- [ ] 工具调用过程正确显示
- [ ] 思考过程正确显示

---

## 七、执行步骤

1. **修改 `ChunkCollector.add_chunk()` 方法**
   - 添加空内容跳过逻辑
   - 添加空 tool_calls 跳过逻辑

2. **修改 `ChunkCollector.get_agent_data()` 方法**
   - 添加空块清理逻辑

3. **测试验证**
   - 使用测试面板验证 MainAgent 和 SubAgent 的消息存储
   - 检查数据库中的 session_messages 表
   - 验证前端显示效果
