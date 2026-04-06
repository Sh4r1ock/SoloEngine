# TaskTool 重构文档

## 一、背景

当前代码库中存在两个功能重叠的 Task 工具实现：

| 工具 | 文件位置 | 当前状态 |
|------|----------|----------|
| **TaskTool** | `plugins/tools/agent/task.py` | 未被实际使用，硬编码配置 |
| **SubAgentTaskTool** | `solo_agent/tools.py` (内部类) | 系统实际使用 |

**重构目标**：将 `SubAgentTaskTool` 的逻辑迁移到 `TaskTool` 中，统一代码结构，删除冗余代码。

---

## 二、涉及文件

| 文件路径 | 操作 |
|----------|------|
| `backend/SoloAgent/plugins/tools/agent/task.py` | 重写 TaskTool 类 |
| `backend/SoloAgent/plugins/tools/agent/__init__.py` | 更新导出 |
| `backend/SoloAgent/solo_agent/agent.py` | 修改 Task 工具初始化 |
| `backend/SoloAgent/solo_agent/tools.py` | 删除 `create_task_tool_config` 函数 |

---

## 三、SubAgent 消息存储机制

### 3.1 存储原理

SubAgent 的消息存储与 MainAgent 完全一致，通过 **stream_callback + ChunkCollector** 实现：

```
┌─────────────────────────────────────────────────────────────────┐
│  1. SubAgentTaskTool.execute()                                   │
│     └── subagent.set_stream_callback(parent_agent._stream_callback)│
│         └── SubAgent 使用和 MainAgent 相同的 stream_callback     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. ReActCore.reply()                                            │
│     └── self.stream_callback(delta, agent_id=self.agent_id,     │
│                              agent_name=self.name)               │
│         └── 每个 Agent 都传递自己的 agent_id                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. WebSocket stream_callback_with_collector()                   │
│     └── current_collector.add_chunk(delta, agent_id, agent_name)│
│         └── ChunkCollector 按 agent_id 分组收集                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. 执行完成后                                                    │
│     └── agent_data = current_collector.get_agent_data()         │
│         └── for agent_id_key, agent_info in agent_data.items(): │
│             └── save_session_message(..., agent_id=agent_id_key)│
│                 └── 每个 Agent 的消息独立存储到数据库              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 关键代码

**ChunkCollector 按 agent_id 分组**（`run.py`）：

```python
def add_chunk(self, delta: dict, agent_id: str = None, agent_name: str = None):
    if agent_id and agent_id != self._current_agent_id:
        # 切换到新的 agent
        self._current_agent_id = agent_id
        self._current_agent_name = agent_name
    # 按 agent_id 收集数据
    if self._current_agent_id not in self._agent_data:
        self._agent_data[self._current_agent_id] = {'agent_name': ..., 'data': []}
    self._agent_data[self._current_agent_id]['data'].append(...)
```

**统一存储**（`run.py` WebSocket 主循环）：

```python
agent_data = current_collector.get_agent_data()
for agent_id_key, agent_info in agent_data.items():
    await save_session_message(
        db=db, session_id=session_id, user_id=user_id,
        role="assistant", data=data_to_save, 
        agent_id=agent_id_key,  # 每个 Agent 独立存储
        parent_message_id=last_user_message_id
    )
```

### 3.3 数据库存储结果

```
session_messages 表：
├── MainAgent (agent_id: "main_001")
│   ├── msg_1: role=user, data=[{type: "content", content: "用户输入"}]
│   └── msg_2: role=assistant, data=[{type: "content", ...}, {type: "tool_calls", ...}]
│
└── SubAgent (agent_id: "sub_search_001")
    └── msg_3: role=assistant, parent_message_id=msg_2
        data=[{type: "reasoning_content", ...}, {type: "tool_calls", ...}, {type: "content", ...}]
```

### 3.4 上下文恢复

`load_and_distribute_memories()` 按 `agent_id` 分组加载：

```python
def load_and_distribute_memories(db, session_id, user_id):
    records = db.query(SessionMessageModel).filter(...).all()
    
    agent_memories = {}
    for record in records:
        message = {"role": record.role, "content": record.data, "agent_id": record.agent_id}
        if record.agent_id not in agent_memories:
            agent_memories[record.agent_id] = []
        agent_memories[record.agent_id].append(message)
    
    return agent_memories
```

`CompiledFlow._execute_agent()` 获取对应记忆：

```python
agent_memory = self._agent_memories.get(agent_id, [])
agent.set_message_history(agent_memory)
```

---

## 四、代码修改

### 4.1 重写 TaskTool 类

**文件**：`backend/SoloAgent/plugins/tools/agent/task.py`

```python
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
    
    消息存储：SubAgent的消息通过 stream_callback + ChunkCollector 机制
    自动存储到数据库，与 MainAgent 存储方式完全一致。
    """
    
    def __init__(
        self,
        parent_agent: Optional["SoloAgent"] = None,
        subagents_info: Optional[List[Dict[str, Any]]] = None,
        context: Optional[Any] = None,
        permission: Optional[Any] = None
    ) -> None:
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
        
        # 关键：传递 stream_callback，使 SubAgent 消息被 ChunkCollector 收集
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
    return {
        "name": "Task",
        "description": "Task tool for subagent delegation",
        "parameters": {}
    }
```

### 4.2 更新 __init__.py 导出

**文件**：`backend/SoloAgent/plugins/tools/agent/__init__.py`

```python
from .task import (
    TaskTool,
    get_task_tool_spec,
)

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

### 4.3 修改 agent.py 初始化

**文件**：`backend/SoloAgent/solo_agent/agent.py`

```python
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

### 4.4 删除废弃代码

**文件**：`backend/SoloAgent/solo_agent/tools.py`

删除 `create_task_tool_config` 函数（约135行代码）

---

## 五、测试验证

### 5.1 单元测试

- 测试 TaskTool 初始化
- 测试 get_tool_spec() 输出
- 测试 execute() 方法

### 5.2 集成测试

- 测试 Flow 编译后的 SubAgent 调用
- 测试流式回调传递
- 测试事件通知
- **测试 SubAgent 消息存储到数据库**
- **测试 SubAgent 上下文恢复**

### 5.3 端到端测试

使用测试面板验证完整流程

---

## 六、验收标准

- [ ] TaskTool 正确初始化
- [ ] get_tool_spec() 返回正确的规范
- [ ] execute() 正确调用 SubAgent
- [ ] 流式回调正确传递
- [ ] 事件通知正确发送
- [ ] 错误处理正确返回
- [ ] 无冗余代码
- [ ] 无循环导入
- [ ] **SubAgent 消息正确存储到数据库**
- [ ] **SubAgent 上下文正确恢复**
