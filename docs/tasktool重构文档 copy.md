# TaskTool 重构文档

## 一、背景分析

### 1.1 问题概述

当前代码库中存在两个功能重叠的 Task 工具实现：

| 工具 | 文件位置 | 当前状态 |
|------|----------|----------|
| **TaskTool** | `plugins/tools/agent/task.py` | ❌ 未被实际使用 |
| **SubAgentTaskTool** | `solo_agent/tools.py` (内部类) | ✅ 系统实际使用 |

### 1.2 核心问题

**TaskTool 的问题：**
1. 硬编码的 Agent 类型（`search`, `general_purpose_task`）
2. 硬编码的 System Prompt（`SUBAGENT_SYSTEM_PROMPTS`）
3. 硬编码的工具权限（`SUBAGENT_TOOL_PERMISSIONS`）
4. 硬编码的模型配置（`gpt-4` + `openai`）
5. 动态创建新的 `ReActAgent` 实例（与系统架构不符）
6. **实际上没有内置 Agent 类型，都是用户自定义 Agent**

**SubAgentTaskTool 的优势：**
1. 使用用户配置的 SubAgent 实例
2. 使用用户定义的 System Prompt
3. 使用用户定义的工具权限
4. 使用用户定义的模型配置
5. 完整集成 Flow 编译系统
6. 支持流式回调和事件通知

### 1.3 重构目标

将 `SubAgentTaskTool` 的逻辑迁移到 `TaskTool` 中，统一代码结构，删除冗余代码。

---

## 二、详细对比分析

### 2.1 工具本身对比（10个维度）

| 维度 | TaskTool | SubAgentTaskTool |
|------|----------|------------------|
| **1. 定义位置** | `plugins/tools/agent/task.py` | `solo_agent/tools.py` 内部类 |
| **2. 类类型** | 继承 `BaseAgentTool` 的独立类 | 运行时动态创建的内部类 |
| **3. Agent来源** | 动态创建新 `ReActAgent` 实例 | 使用 `parent_agent.get_subagent()` 获取已存在的实例 |
| **4. Agent配置** | 硬编码的 `search` 和 `general_purpose_task` | 从 `parent_agent.config.subagents` 读取 |
| **5. System Prompt** | `SUBAGENT_SYSTEM_PROMPTS` 字典硬编码 | 使用 SubAgent 自己的 `config.system_prompt` |
| **6. 工具权限** | `SUBAGENT_TOOL_PERMISSIONS` 字典硬编码 | 使用 SubAgent 自己的工具配置 |
| **7. 模型配置** | 硬编码 `gpt-4` + `openai` | 使用 SubAgent 自己的模型配置 |
| **8. 参数设计** | `subagent_type`, `description`, `query`, `response_language` | `subagent_name`, `task` |
| **9. enum值来源** | 硬编码 `["search", "general_purpose_task"]` | 动态生成 `list(self._subagents_info.keys())` |
| **10. 上下文隔离** | 新创建的 Agent，完全隔离 | 已存在的 Agent 实例，独立上下文 |

### 2.2 调用阶段对比（10个维度）

| 维度 | TaskTool | SubAgentTaskTool |
|------|----------|------------------|
| **1. 初始化时机** | 工具创建时 | Agent 初始化时 (`create_task_tool_config`) |
| **2. 配置来源** | 无外部配置依赖 | 依赖 `parent_agent.config.subagents` |
| **3. Agent查找方式** | 无查找，直接创建 | `parent_agent.get_subagent(subagent_id)` |
| **4. 初始化检查** | 无需检查 | 检查 `subagent._initialized` |
| **5. 流式回调传递** | 无 | 传递 `parent_agent._stream_callback` |
| **6. 事件通知** | 无 | 发送 `subagent_start` 和 `subagent_complete` 事件 |
| **7. 错误处理** | 抛出 `AgentToolError` | 返回 `{"success": False, "error": ...}` |
| **8. 执行方法** | `await subagent.reply(config.query)` | `await subagent.reply(task)` |
| **9. 结果提取** | `response.get_text_content()` | `result.content` 或 `result.get('content')` |
| **10. 结果存储** | 存储到 `self._subagent_results` | 无存储 |

### 2.3 输出对比（10个维度）

| 维度 | TaskTool | SubAgentTaskTool |
|------|----------|------------------|
| **1. 成功标识** | `"success": True` | `"success": True` |
| **2. 内容字段** | `"content"` | `"result"` |
| **3. 类型标识** | `"subagent_type"` | `"subagent_name"` |
| **4. 描述字段** | `"description"` | 无 |
| **5. 语言字段** | `"response_language"` | 无 |
| **6. 元数据** | `"metadata": {"tokens": {...}}` | 无 |
| **7. 错误格式** | `create_error_response()` 标准格式 | `{"success": False, "error": ...}` |
| **8. Token统计** | 有（目前为0） | 无 |
| **9. 结果缓存** | `get_subagent_results()` 可获取历史 | 无 |
| **10. 结构一致性** | 高（使用基类方法） | 中（手动构建） |

### 2.4 架构设计对比（10个维度）

| 维度 | TaskTool | SubAgentTaskTool |
|------|----------|------------------|
| **1. 设计模式** | 工厂模式（创建Agent） | 委托模式（调用已有Agent） |
| **2. 依赖注入** | 支持 `agent_factory` 参数 | 依赖 `parent_agent` 实例 |
| **3. 扩展性** | 需修改代码添加新类型 | 通过配置添加新SubAgent |
| **4. 灵活性** | 低（硬编码类型） | 高（配置驱动） |
| **5. 可测试性** | 高（独立类） | 中（依赖父Agent） |
| **6. 代码复用** | 使用基类方法 | 手动实现所有逻辑 |
| **7. 错误处理** | 统一异常体系 | 简单字典返回 |
| **8. 日志记录** | 使用 `logger` | 使用 `logger` |
| **9. 类型安全** | 使用 `Literal` 类型 | 无类型约束 |
| **10. 文档完整性** | 详细docstring | 简单注释 |

### 2.5 实际使用情况对比（10个维度）

| 维度 | TaskTool | SubAgentTaskTool |
|------|----------|------------------|
| **1. 注册方式** | `ToolRegistry._create_tool()` | `create_task_tool_config()` |
| **2. 调用入口** | `ToolRegistry.get_tool("Task")` | `agent.py` 初始化时创建 |
| **3. 当前使用状态** | ❌ 未被实际调用 | ✅ 系统实际使用 |
| **4. 配置来源** | 无配置 | Flow YAML 编译结果 |
| **5. 与Flow编译集成** | 无集成 | 完全集成 |
| **6. 与Agent生命周期** | 独立生命周期 | 绑定父Agent生命周期 |
| **7. 流式输出支持** | 无 | 完整支持 |
| **8. 事件回调支持** | 无 | 完整支持 |
| **9. 多SubAgent管理** | 不支持 | 支持 |
| **10. 生产可用性** | 不完整 | 完整可用 |

---

## 三、涉及文件清单

### 3.1 需要修改的文件

| 文件路径 | 修改内容 |
|----------|----------|
| `backend/SoloAgent/plugins/tools/agent/task.py` | 重写 TaskTool 类，整合 SubAgentTaskTool 逻辑 |
| `backend/SoloAgent/plugins/tools/agent/__init__.py` | 更新导出内容 |
| `backend/SoloAgent/solo_agent/agent.py` | 修改 Task 工具初始化逻辑 |
| `backend/SoloAgent/solo_agent/tools.py` | 删除 `create_task_tool_config` 函数 |

### 3.2 需要删除的内容

| 文件路径 | 删除内容 |
|----------|----------|
| `backend/SoloAgent/plugins/tools/agent/task.py` | `SubAgentConfig` 数据类 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `SubAgentType` 类型定义 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `ResponseLanguage` 类型定义 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `SUBAGENT_SYSTEM_PROMPTS` 字典 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `SUBAGENT_TOOL_PERMISSIONS` 字典 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `_create_subagent()` 方法 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `_run_subagent()` 方法 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `_validate_description()` 方法 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `_validate_query()` 方法 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `get_subagent_results()` 方法 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `task_tool_function()` 函数 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `get_task_tool_spec()` 函数 |
| `backend/SoloAgent/solo_agent/tools.py` | `create_task_tool_config()` 函数整体 |
| `backend/SoloAgent/solo_agent/tools.py` | `SubAgentTaskTool` 内部类 |

### 3.3 需要新增的内容

| 文件路径 | 新增内容 |
|----------|----------|
| `backend/SoloAgent/plugins/tools/agent/task.py` | `SubAgentInfo` 数据类（从 config.py 迁移或导入） |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `parent_agent` 参数 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `subagents_info` 参数 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | `_format_available_subagents_xml()` 方法 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | 流式回调传递逻辑 |
| `backend/SoloAgent/plugins/tools/agent/task.py` | 事件通知逻辑 |

---

## 四、完整数据流分析

### 4.1 核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│  AgenticFlow 实例层 (run.py)                                    │
│  ├── load_and_distribute_memories()                             │
│  │   ├── 查询 session_messages                                  │
│  │   └── 按 agent_id 分组 → agent_memories                     │
│  └── compiled_flow.set_agent_memories(memories)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  CompiledFlow (flow_compiler.py)                                │
│  ├── _agent_memories: Dict[str, List[Dict]] = {}               │
│  ├── set_agent_memories(memories)                               │
│  └── _execute_agent(agent_id)                                   │
│      ├── memory = _agent_memories.get(agent_id, [])            │
│      └── agent.set_message_history(memory)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  MainAgent 执行                                                  │
│  ├── agent.reply(input)                                         │
│  │   └── TaskTool.execute()                                     │
│  │       └── SubAgent.reply(task)                               │
│  │           └── SubAgent 使用 agent_memories[agent_id]        │
│  └── 存储到 session_messages (agent_id="main_001")              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  SubAgent 执行                                                   │
│  ├── agent_id = "sub_search_001"                                │
│  ├── memory = agent_memories.get("sub_search_001", [])         │
│  ├── agent.reply(task)                                          │
│  └── 存储到 session_messages (agent_id="sub_search_001")        │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 关键发现

1. **agent_memories 机制**：`load_and_distribute_memories()` 从数据库加载消息并按 `agent_id` 分组
2. **SubAgent 有独立记忆**：通过 `agent_memories[agent_id]` 获取自己的历史消息
3. **SubAgent 消息持久化**：SubAgent 的消息存储到 `session_messages` 表，使用自己的 `agent_id`
4. **一次模型输出 = 一个 msg 记录**：`msg.data` 数组包含所有 blocks

### 4.3 数据存储结构

**一次模型输出 = 一个 msg 记录**

```
msg = {
  id: "msg_xxx",
  session_id: "session_001",
  agent_id: "main_001",           // 区分不同 Agent
  parent_message_id: null,        // SubAgent 消息关联到 MainAgent 消息
  role: "assistant",
  data: [                         // data 数组包含所有 blocks
    {type: "reasoning_content", reasoning_content: "让我思考..."},
    {type: "tool_calls", tool_calls: [{id: "call_123", name: "Task", ...}]},
    {type: "tool_result", id: "call_123", output: {...}},
    {type: "content", content: "最终回答..."}
  ]
}
```

**SubAgent 消息存储：**

```
msg = {
  id: "msg_yyy",
  session_id: "session_001",
  agent_id: "sub_search_001",     // SubAgent 自己的 agent_id
  parent_message_id: "msg_xxx",   // 关联到 MainAgent 的消息
  role: "assistant",
  data: [
    {type: "reasoning_content", ...},
    {type: "tool_calls", ...},
    {type: "tool_result", ...},
    {type: "content", content: "搜索结果..."}
  ]
}
```

**当前存储机制：**

- MainAgent 消息：`agent_id = "main_001"`
- SubAgent 消息：`agent_id = "sub_xxx"`，`parent_message_id` 关联到 MainAgent
- `load_and_distribute_memories()` 按 `agent_id` 分组加载
- 每个 Agent 执行时获取自己的记忆

---

## 五、方案C简化版：最终设计

### 5.1 核心设计理念

**零数据库改动 + 利用现有 agent_memories 机制**

| 现有机制 | 说明 |
|----------|------|
| `agent_id` | 区分 MainAgent 和 SubAgent |
| `parent_message_id` | SubAgent 消息关联到 MainAgent 消息 |
| `agent_memories` | `load_and_distribute_memories()` 按 agent_id 分组加载 |
| `set_agent_memories()` | CompiledFlow 设置所有 Agent 的记忆 |

### 5.2 数据存储结构

```
┌─────────────────────────────────────────────────────────────────┐
│  session_messages 表（零改动）                                   │
│                                                                  │
│  ════════════════════════════════════════════════════════════   │
│  MainAgent (agent_id: "main_001")                               │
│  ════════════════════════════════════════════════════════════   │
│                                                                  │
│  msg_1 (id: "msg_1"): role=user                                 │
│  data: [{type: "text", text: "帮我搜索相关文件"}]               │
│                                                                  │
│  msg_2 (id: "msg_2"): role=assistant                            │
│  data: [                                                        │
│    {type: "text", text: "让我帮你搜索..."},                     │
│    {type: "tool_use", id: "call_123", name: "Task",             │
│     input: {subagent_name: "search", task: "搜索相关文件"}}     │
│  ]                                                              │
│                                                                  │
│  msg_3 (id: "msg_3"): role=tool                                 │
│  data: [{type: "tool_result", id: "call_123",                   │
│          output: {                                              │
│            success: true,                                       │
│            subagent_name: "search",                             │
│            result: "找到了3个相关文件：..." ← 完整内容          │
│          }}]                                                    │
│                                                                  │
│  msg_4 (id: "msg_4"): role=assistant                            │
│  data: [{type: "text", text: "根据搜索结果..."}]                │
│                                                                  │
│  ════════════════════════════════════════════════════════════   │
│  SubAgent (agent_id: "sub_search_001")                          │
│  ════════════════════════════════════════════════════════════   │
│                                                                  │
│  msg_5: role=user, parent_message_id: "msg_2"                   │
│  data: [{type: "text", text: "搜索相关文件"}]                   │
│                                                                  │
│  msg_6: role=assistant, parent_message_id: "msg_2"              │
│  data: [                                                        │
│    {type: "reasoning_content", ...},                            │
│    {type: "tool_calls", ...},                                   │
│    {type: "tool_result", ...},                                  │
│    {type: "content", content: "找到了3个相关文件..."}           │
│  ]                                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 关键关联说明

| 字段 | MainAgent | SubAgent |
|------|-----------|----------|
| `agent_id` | `"main_001"` | `"sub_search_001"` |
| `parent_message_id` | 无 | MainAgent 的 message_id（如 `msg_2`） |

**关联逻辑：**
- `parent_message_id` 关联到 MainAgent 的 session_message_id
- 关联到触发 SubAgent 的那条消息（不是 tool_result）
- 上下文追溯：通过 `agent_id` 分组，每个 Agent 独立加载自己的记忆

### 5.4 上下文构建流程（agent_memories 机制）

```
load_and_distribute_memories() 流程：
├── 1. 查询 session_messages (session_id="xxx")
├── 2. 按 agent_id 分组
│   ├── agent_memories["main_001"] = [msg_1, msg_2, msg_3, msg_4]
│   └── agent_memories["sub_search_001"] = [msg_5, msg_6]
└── 3. 返回 agent_memories

CompiledFlow 执行流程：
├── 1. set_agent_memories(agent_memories)
├── 2. _execute_agent("main_001")
│   ├── memory = _agent_memories.get("main_001", [])
│   └── agent.set_message_history(memory)
└── 3. _execute_agent("sub_search_001")
    ├── memory = _agent_memories.get("sub_search_001", [])
    └── agent.set_message_history(memory)
```

### 5.5 核心优势

| 维度 | 设计 |
|------|------|
| **数据库改动** | 零改动 |
| **数据冗余** | 无冗余 |
| **数据一致性** | 单一数据源 |
| **流式输出** | 保持 SubAgentTaskTool 的流式回调 |
| **前端实时显示** | 通过事件机制实时推送 |
| **上下文构建** | agent_memories 自动按 agent_id 分组 |
| **存储效率** | 最优 |

### 5.6 TaskTool 返回值设计

**TaskTool.execute() 返回完整内容，而非引用：**

```python
return {
    "success": True,
    "subagent_name": subagent_name,
    "result": content  # 完整内容，直接可用于 MainAgent 上下文
}
```

**原因：**
1. MainAgent 需要 SubAgent 的完整结果来继续处理
2. tool_result 中存储完整内容，LLM 可以直接使用
3. SubAgent 的详细执行过程存储在自己的 agent_id 下，不影响 MainAgent 上下文

### 5.7 SubAgent 消息存储设计

#### 5.7.1 存储时机

SubAgent 的消息存储发生在 Flow 执行过程中：

1. **SubAgent.reply() 执行后**：消息自动存储到 session_messages
2. **agent_id = SubAgent 的 ID**
3. **parent_message_id = MainAgent 触发 SubAgent 的消息 ID**

#### 5.7.2 存储逻辑

```
TaskTool.execute() 流程：
├── 1. 获取 SubAgent 实例
├── 2. 获取 MainAgent 当前消息 ID（parent_message_id）
├── 3. 设置流式回调
├── 4. 发送 subagent_start 事件
├── 5. 执行 SubAgent.reply(task)
│   └── SubAgent 内部存储消息：agent_id=sub_id, parent_message_id=main_msg_id
├── 6. 发送 subagent_complete 事件
└── 7. 返回 {success, subagent_name, result}（完整内容）
```

#### 5.7.3 上下文构建

```
构建 Agent 上下文时（通过 agent_memories 机制）：
1. load_and_distribute_memories() 按 agent_id 分组
2. 每个 Agent 获取自己的记忆：
   - MainAgent: agent_memories["main_001"]
   - SubAgent: agent_memories["sub_search_001"]
3. 各 Agent 独立上下文，互不干扰
```

---

## 六、重构方案

### 6.1 新的 TaskTool 类设计

```python
# backend/SoloAgent/plugins/tools/agent/task.py

from typing import Dict, Any, Optional, List, TYPE_CHECKING
import logging

from .base import BaseAgentTool, AgentToolError

if TYPE_CHECKING:
    from ....solo_agent.agent import SoloAgent

logger = logging.getLogger(__name__)


class TaskTool(BaseAgentTool):
    """
    Task工具 - 调用SubAgent处理任务。
    
    通过Task工具，主Agent可以将任务委托给配置的SubAgent处理。
    SubAgent在隔离的上下文中执行，完成后返回结果。
    
    核心功能：
        1. SubAgent调用：调用已配置的SubAgent实例
        2. 上下文隔离：SubAgent拥有独立的对话历史
        3. 流式回调：支持流式输出传递
        4. 事件通知：发送SubAgent开始/完成事件
    
    参数说明：
        - subagent_name: SubAgent名称（从配置动态生成enum）
        - task: 详细任务描述
    
    使用场景：
        - 需要专门Agent处理的复杂任务
        - 需要隔离上下文的独立任务
        - 需要特定工具集的任务
    """
    
    def __init__(
        self,
        parent_agent: Optional["SoloAgent"] = None,
        subagents_info: Optional[List[Dict[str, Any]]] = None,
        context: Optional[Any] = None,
        permission: Optional[Any] = None
    ) -> None:
        """
        初始化Task工具。
        
        Args:
            parent_agent: 父Agent实例，用于获取SubAgent
            subagents_info: SubAgent信息列表，格式：
                [{"subagent_name": "...", "subagent_id": "...", "description": "..."}]
            context: 工具上下文（继承自基类）
            permission: 工具权限（继承自基类）
        """
        super().__init__(context, permission)
        self._parent_agent = parent_agent
        self._subagents_info: Dict[str, Dict[str, Any]] = {}
        self._name_to_id: Dict[str, str] = {}
        
        if subagents_info:
            for sa in subagents_info:
                name = sa.get("subagent_name")
                subagent_id = sa.get("subagent_id")
                description = sa.get("description", "")
                if name:
                    self._subagents_info[name] = {
                        "subagent_name": name,
                        "description": description,
                        "subagent_id": subagent_id or name
                    }
                    self._name_to_id[name] = subagent_id or name
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """
        获取Task工具规范。
        
        Returns:
            Dict[str, Any]: 工具规范，兼容OpenAI Function Calling格式。
        """
        names = list(self._subagents_info.keys())
        xml = self._format_available_subagents_xml()
        
        return {
            "name": "Task",
            "description": f"""Launch a agent and assign a task to it.

Available agents:
{xml}

When to use this tool:
  - When the task requires specialized capabilities
  - When you need to delegate a task to a subagent

IMPORTANT: When a subagent is relevant, invoke this tool IMMEDIATELY.""",
            "parameters": {
                "type": "object",
                "properties": {
                    "subagent_name": {
                        "type": "string",
                        "description": "The subagent name to call",
                        "enum": names
                    },
                    "task": {
                        "type": "string",
                        "description": "Detailed task description"
                    }
                },
                "required": ["subagent_name", "task"]
            }
        }
    
    def _format_available_subagents_xml(self) -> str:
        """
        格式化可用SubAgent列表为XML格式。
        
        Returns:
            str: XML格式的SubAgent列表
        """
        lines = ["<available_subagents>"]
        for name, info in self._subagents_info.items():
            lines.append(f"- {name}: {info.get('description', '')}")
        lines.append("</available_subagents>")
        return "\n".join(lines)
    
    async def execute(
        self,
        subagent_name: str,
        task: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        执行Task工具 - 调用SubAgent处理任务。
        
        Args:
            subagent_name: SubAgent名称
            task: 详细任务描述
            **kwargs: 额外参数（忽略）
        
        Returns:
            Dict[str, Any]: 执行结果，包含：
                - success (bool): 是否成功
                - subagent_name (str): SubAgent名称
                - result (str): 执行结果
        """
        subagent_id = self._name_to_id.get(subagent_name)
        if not subagent_id:
            return {
                "success": False,
                "error": f"Subagent '{subagent_name}' not found"
            }
        
        subagent = self._parent_agent.get_subagent(subagent_id)
        
        if not subagent:
            for agent in self._parent_agent._subagents.values():
                if agent.config.name == subagent_name:
                    subagent = agent
                    break
        
        if not subagent:
            return {
                "success": False,
                "error": f"Subagent instance '{subagent_id}' not found"
            }
        
        if not subagent._initialized:
            await subagent.initialize()
        
        if hasattr(self._parent_agent, '_stream_callback') and self._parent_agent._stream_callback:
            subagent.set_stream_callback(self._parent_agent._stream_callback)
        
        self._send_event(
            "subagent_start",
            subagent_id=subagent_id,
            subagent_name=subagent_name
        )
        
        try:
            result = await subagent.reply(task)
            
            self._send_event(
                "subagent_complete",
                subagent_id=subagent_id,
                subagent_name=subagent_name
            )
            
            if hasattr(result, 'content'):
                content = result.content
            elif isinstance(result, dict):
                content = result.get('content', str(result))
            else:
                content = str(result)
            
            return {
                "success": True,
                "subagent_name": subagent_name,
                "result": content
            }
            
        except Exception as e:
            logger.error(f"SubAgent execution failed: {e}")
            return {
                "success": False,
                "error": f"SubAgent执行失败: {str(e)}"
            }
    
    def _send_event(
        self,
        event_type: str,
        subagent_id: str,
        subagent_name: str
    ) -> None:
        """
        发送SubAgent事件通知。
        
        Args:
            event_type: 事件类型（subagent_start/subagent_complete）
            subagent_id: SubAgent ID
            subagent_name: SubAgent名称
        """
        if hasattr(self._parent_agent, '_stream_callback') and self._parent_agent._stream_callback:
            try:
                self._parent_agent._stream_callback(
                    {
                        "type": event_type,
                        "subagent_id": subagent_id,
                        "subagent_name": subagent_name
                    },
                    agent_id=subagent_id,
                    agent_name=subagent_name
                )
            except Exception as e:
                logger.warning(f"Failed to send {event_type} event: {e}")


def get_task_tool_spec() -> Dict[str, Any]:
    """
    获取Task工具规范（兼容性函数）。
    
    注意：此函数返回空规范，实际使用需要通过 TaskTool 实例。
    
    Returns:
        Dict[str, Any]: 空工具规范
    """
    return {
        "name": "Task",
        "description": "Task tool for subagent delegation",
        "parameters": {}
    }
```

### 6.2 agent.py 修改方案

```python
# backend/SoloAgent/solo_agent/agent.py
# 第 166-170 行修改

# 修改前：
if self.config.subagents:
    from .tools import create_task_tool_config
    task_config = create_task_tool_config(self)
    tool_configs.append(task_config)
    logger.info(f"[SubAgents] Added Task tool for subagents: {[s.get('subagent_name') for s in self.config.subagents]}")

# 修改后：
if self.config.subagents:
    from .plugins.tools.agent.task import TaskTool
    task_tool = TaskTool(
        parent_agent=self,
        subagents_info=self.config.subagents
    )
    tool_configs.append({
        "name": "Task",
        "function": task_tool.execute,
        "description": task_tool.get_tool_spec()["description"],
        "parameters": task_tool.get_tool_spec()["parameters"],
    })
    logger.info(f"[SubAgents] Added Task tool for subagents: {[s.get('subagent_name') for s in self.config.subagents]}")
```

### 6.3 tools.py 修改方案

```python
# backend/SoloAgent/solo_agent/tools.py
# 删除第 219-353 行的 create_task_tool_config 函数

# 删除前（第 219-353 行）：
def create_task_tool_config(agent: "SoloAgent") -> Dict[str, Any]:
    """创建 Task 工具配置，用于调用子 Agent..."""
    # ... 整个函数删除

# 删除后：无此函数
```

### 6.4 __init__.py 修改方案

```python
# backend/SoloAgent/plugins/tools/agent/__init__.py
# 修改导出内容

# 修改前：
from .task import (
    TaskTool,
    SubAgentConfig,
    SubAgentType,
    ResponseLanguage,
    task_tool_function,
    get_task_tool_spec,
)

# 修改后：
from .task import (
    TaskTool,
    get_task_tool_spec,
)

# 更新 __all__ 列表
__all__ = [
    "Task",
    "Skill",
    "MCP",
    "TaskTool",
    "SkillTool",
    "MCPTool",
    "BaseAgentTool",
    "AgentToolError",
    "ToolContext",
    "ToolPermission",
    "SkillContext",
    "MCPServerInfo",
    "MCPConnectionConfig",
    "skill_tool_function",
    "mcp_tool_function",
    "get_task_tool_spec",
    "get_skill_tool_spec",
    "get_mcp_tool_spec",
]
```

---

## 七、执行步骤

### 7.1 第一阶段：代码修改

1. **修改 `plugins/tools/agent/task.py`**
   - 删除所有硬编码内容
   - 重写 `TaskTool` 类
   - 保留 `get_task_tool_spec()` 函数（兼容性）

2. **修改 `plugins/tools/agent/__init__.py`**
   - 更新导入和导出

3. **修改 `solo_agent/agent.py`**
   - 修改 Task 工具初始化逻辑

4. **修改 `solo_agent/tools.py`**
   - 删除 `create_task_tool_config` 函数

### 7.2 第二阶段：测试验证

1. **单元测试**
   - 测试 TaskTool 初始化
   - 测试 get_tool_spec() 输出
   - 测试 execute() 方法

2. **集成测试**
   - 测试 Flow 编译后的 SubAgent 调用
   - 测试流式回调传递
   - 测试事件通知

3. **端到端测试**
   - 使用测试面板验证完整流程

### 7.3 第三阶段：清理工作

1. **删除废弃代码**
   - 确认所有引用已更新
   - 删除不再使用的函数和类

2. **更新文档**
   - 更新技术文档
   - 更新 API 文档

---

## 八、风险评估

### 8.1 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 导入路径变更 | 中 | 保持 `TaskTool` 类名不变 |
| 参数签名变更 | 低 | 新旧参数不冲突 |
| 返回格式变更 | 低 | 保持 `success` 和 `result` 字段 |
| 流式回调丢失 | 高 | 确保回调正确传递 |

### 8.2 回滚方案

如果重构后出现问题，可以通过以下步骤回滚：

1. 恢复 `tools.py` 中的 `create_task_tool_config` 函数
2. 恢复 `agent.py` 中的原始调用方式
3. 恢复 `task.py` 中的原始代码

---

## 九、验收标准

### 9.1 功能验收

- [ ] TaskTool 正确初始化
- [ ] get_tool_spec() 返回正确的规范
- [ ] execute() 正确调用 SubAgent
- [ ] 流式回调正确传递
- [ ] 事件通知正确发送
- [ ] 错误处理正确返回

### 9.2 代码质量验收

- [ ] 无冗余代码
- [ ] 无循环导入
- [ ] 类型注解完整
- [ ] 文档完整

### 9.3 测试验收

- [ ] 单元测试通过
- [ ] 集成测试通过
- [ ] 端到端测试通过

---

## 十、附录

### 10.1 文件变更摘要

| 文件 | 变更类型 | 行数变化 |
|------|----------|----------|
| `plugins/tools/agent/task.py` | 重写 | -200 +100 |
| `plugins/tools/agent/__init__.py` | 修改 | -5 |
| `solo_agent/agent.py` | 修改 | -3 +8 |
| `solo_agent/tools.py` | 删除 | -135 |

### 10.2 相关参考

- Claude Code Task Tool 设计文档
- SoloEngine SubAgent 架构文档
- Flow 编译器设计文档
