# SubAgent 实现与调用方案调研报告

## 一、调研概述

本报告通过网络搜索（30+次）和代码分析，详细调研当前主流的 SubAgent 实现方案，并分析用户提出的"从下向上创建 SoloAgent 实例，通过 Task 工具调用下层 Agent 作为上层 Agent 的 SubAgent"方案是否可行。

---

## 二、主流 SubAgent 实现方案

### 2.1 Orchestrator-Workers 模式（编排器-工作者模式）

**核心思想：** 中央编排器负责任务分解和协调，Worker Agents 负责执行具体子任务。

**架构图：**
```
┌─────────────────────────────────────────────────────────┐
│                    Orchestrator                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  1. 理解用户请求                                 │    │
│  │  2. 分解任务为子任务                             │    │
│  │  3. 协调多个 Workers 执行                        │    │
│  │  4. 聚合结果返回给用户                           │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                               │
│          ┌──────────────┼──────────────┐                │
│          ↓              ↓              ↓                │
│    ┌───────────┐  ┌───────────┐  ┌───────────┐         │
│    │  Worker1  │  │  Worker2  │  │  Worker3  │         │
│    │ (SubAgent)│  │ (SubAgent)│  │ (SubAgent)│         │
│    └───────────┘  └───────────┘  └───────────┘         │
└─────────────────────────────────────────────────────────┘
```

**特点：**
- 适合复杂任务的分解协调
- Orchestrator 掌握全局视图
- Worker Agents 专业化分工

**代表框架：** Microsoft Agent Framework, LangGraph

---

### 2.2 Hierarchical Agent 模式（层级 Agent 模式）

**核心思想：** 多层 Agent 结构，高层 Agent 监督低层 Agent，类比公司管理层级。

**架构图：**
```
┌─────────────────────────────────────────────────────────┐
│                      Manager Agent                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │  - 任务分配                                      │    │
│  │  - 结果汇总                                      │    │
│  │  - 决策制定                                      │    │
│  └─────────────────────────────────────────────────┘    │
│          ▲              ▲              ▲                 │
│          │              │              │                 │
│    ┌───────────┐  ┌───────────┐  ┌───────────┐         │
│    │Coordinator│  │Coordinator│  │Coordinator│         │
│    └───────────┘  └───────────┘  └───────────┘         │
│          ▲              ▲              ▲                 │
│          │              │              │                 │
│    ┌───────────┐  ┌───────────┐  ┌───────────┐         │
│    │  Worker1  │  │  Worker2  │  │  Worker3  │         │
│    └───────────┘  └───────────┘  └───────────┘         │
└─────────────────────────────────────────────────────────┘
```

**特点：**
- 层级分明，职责清晰
- 支持多级委托
- 适合大规模任务管理

**代表框架：** CrewAI (Hierarchical Process), Microsoft Agent Framework

---

### 2.3 Supervisor-Worker 模式（监督者-工作者模式）

**核心思想：** 单一 Supervisor 协调多个专业 Worker，任务通过函数调用或消息传递分配。

**架构图：**
```
┌─────────────────────────────────────────────────────────┐
│                    Supervisor                           │
│  - 理解任务                                             │
│  - 决定调用哪个 Worker                                   │
│  - 聚合 Worker 返回结果                                  │
└─────────────────────────────────────────────────────────┘
           │                    ▲
           ▼                    │
    ┌─────────────────────────────────────────┐
    │              Worker Agents               │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
    │  │Searcher │ │  Coder  │ │ Reviewer│    │
    │  └─────────┘ └─────────┘ └─────────┘    │
    └─────────────────────────────────────────┘
```

**特点：**
- 简单直接，易于理解
- Supervisor 掌握完整上下文
- Worker 是专家型 Agent

**代表框架：** LangGraph (Supervisor pattern)

---

### 2.4 Group Chat 模式（群聊模式）

**核心思想：** 多个 Agent 在共享上下文中协作，通过群聊机制决定发言顺序。

**架构图：**
```
┌─────────────────────────────────────────────────────────┐
│                  GroupChatManager                        │
│  - 控制发言顺序                                          │
│  - 管理对话历史                                          │
│  - 决定终止条件                                          │
└─────────────────────────────────────────────────────────┘
                         ▲
                         │
    ┌──────────┬──────────┼──────────┬──────────┐
    │          │          │          │          │
    ▼          ▼          ▼          ▼          ▼
┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐
│Agent1 │  │Agent2 │  │Agent3 │  │Agent4 │  │ User  │
│(Coder)│  │(Tester)│  │(Docs) │  │(Review)│  │Proxy  │
└───────┘  └───────┘  └───────┘  └───────┘  └───────┘
```

**特点：**
- 去中心化协作
- 共享上下文
- 支持人类参与

**代表框架：** AutoGen (GroupChat)

---

### 2.5 Handoff 模式（交接模式）

**核心思想：** Agent 之间通过函数返回进行切换，实现无缝交接。

**架构图：**
```
┌─────────────────────────────────────────────────────────┐
│                       Agent A                            │
│  instructions="..."                                      │
│  functions=[transfer_to_B]  ──────►  ┌──────────────┐ │
└─────────────────────────────────────────►│   Agent B    │
                                          └──────────────┘
                                           instructions="..."
```

**特点：**
- 轻量级实现
- 无状态设计
- 通过函数返回切换

**代表框架：** OpenAI Swarm

---

### 2.6 Subagent as Tool 模式（Subagent 作为工具模式）

**核心思想：** Subagent 被定义为一种特殊工具，主 Agent 通过工具调用触发 Subagent。

**架构图：**
```
┌─────────────────────────────────────────────────────────┐
│                      Main Agent                         │
│  - 理解用户请求                                         │
│  - 决定是否调用 Subagent                                 │
│  - 聚合 Subagent 返回结果                                │
└─────────────────────────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
    ┌───────────────┐          ┌───────────────┐
    │  Tool: Read   │          │Tool: Subagent │
    │               │          │ ┌───────────┐ │
    │               │          │ │ searcher  │ │
    └───────────────┘          │ │ developer │ │
                                │ │ reviewer  │ │
                                │ └───────────┘ │
                                └───────────────┘
```

**特点：**
- 通过 Function Calling 调用
- Subagent 作为工具注册
- 工具 schema 定义 Subagent

**代表框架：** Claude Code, 主流 Agent 框架

---

## 三、主流框架 SubAgent 实现对比

### 3.1 LangGraph 实现

```python
from langgraph.prebuilt import create_react_agent

# 创建 Supervisor
supervisor_agent = create_react_agent(
    model,
    tools=[search, code],
    state_modifier="You are a supervisor..."
)

# 定义工作节点
def research_node(state):
    # 调用研究 Agent
    return {"research_result": ...}

def coding_node(state):
    # 调用编码 Agent
    return {"code_result": ...}

# 构建图
graph.add_node("supervisor", supervisor_agent)
graph.add_node("research", research_node)
graph.add_node("coding", coding_node)

# 定义边
graph.add_edge("supervisor", "research", condition=needs_research)
graph.add_edge("research", "supervisor")
```

**特点：**
- 基于状态图
- 节点可以是 Agent 或函数
- 支持条件边

---

### 3.2 AutoGen 实现

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChatManager

# 创建 Worker Agents
coder = AssistantAgent(name="coder", system_message="You are a coder...")
reviewer = AssistantAgent(name="reviewer", system_message="You are a reviewer...")

# 创建群聊
groupchat = GroupChat(
    agents=[coder, reviewer, user_proxy],
    messages=[],
    max_round=10
)

# 创建 Manager
manager = GroupChatManager(groupchat=groupchat)

# 启动群聊
user_proxy.initiate_chat(manager, message="Write a function...")
```

**特点：**
- 基于对话协作
- GroupChatManager 协调
- 支持动态发言人选择

---

### 3.3 CrewAI 实现

```python
from crewai import Crew, Agent, Task, Process

# 创建 Worker Agents
architect = Agent(role="Architect", goal="Design system", ...)
developer = Agent(role="Developer", goal="Write code", ...)
qa = Agent(role="QA Engineer", goal="Test system", ...)

# 创建任务
design_task = Task(description="Design the system", agent=architect)
dev_task = Task(description="Implement the system", agent=developer)
test_task = Task(description="Test the system", agent=qa)

# 创建 Crew（支持 hierarchical 模式）
crew = Crew(
    agents=[architect, developer, qa],
    tasks=[design_task, dev_task, test_task],
    process=Process.hierarchical,  # 层级模式
    manager_llm=llm
)

# 启动
result = crew.kickoff()
```

**特点：**
- 角色驱动设计
- 支持 Sequential/ Hierarchical/ Consensus 模式
- Manager Agent 自动分配任务

---

### 3.4 Claude Code Subagents 实现

```python
# Claude Code 中 Subagent 作为工具使用
subagent = SubAgent(
    name="code_reviewer",
    description="专门负责代码审查",
    instructions="你是一个代码审查专家...",
    tools=[read_file, grep, search_code],
    max_iterations=5
)

# 通过 Task 工具调用
result = await task_tool.execute(
    agent="code_reviewer",
    query="审查这个函数的安全性"
)
```

**特点：**
- Subagent 作为可复用单元
- 通过工具调用接口
- 支持渐进式披露

---

## 四、用户方案分析

### 4.1 用户描述的方案

> "在 agenticflow.json 编译时，从下向上创建 SoloAgent 实例，然后通过 Task，使下层 Agent 成为上级 Agent 的 SubAgent"

**预期架构：**
```json
{
  "nodes": [
    {"id": "main_agent", "level": 0},
    {"id": "sub_agent_1", "level": 1},
    {"id": "sub_agent_2", "level": 1},
    {"id": "sub_agent_1_1", "level": 2}
  ],
  "edges": [
    {"from": "main_agent", "to": "sub_agent_1"},
    {"from": "main_agent", "to": "sub_agent_2"},
    {"from": "sub_agent_1", "to": "sub_agent_1_1"}
  ]
}
```

**预期执行流程：**
```
编译时（从下向上）：
1. 创建 sub_agent_1_1
2. 创建 sub_agent_1，并将 sub_agent_1_1 作为其 child_agent
3. 创建 sub_agent_2
4. 创建 main_agent，并将 sub_agent_1, sub_agent_2 作为其 child_agents

运行时（通过 Task 调用）：
main_agent.reply()
  → LLM 调用 Task(agent_id="sub_agent_1", message="...")
    → sub_agent_1.call_subagent("sub_agent_1_1", ...)
      → sub_agent_1_1.reply()
```

---

### 4.2 方案评估：是否符合主流实现？

**结论：用户的方案是可行的，符合主流的 Subagent 实现方式。**

| 评估维度 | 用户方案 | 主流方案 | 是否符合 |
|---------|---------|---------|---------|
| 架构模式 | Hierarchical | Hierarchical/Orchestrator | ✅ |
| Subagent 定义 | 作为工具/child_agent | 作为工具/子 Agent | ✅ |
| 调用方式 | Task 工具 | Function Calling / Handoff | ✅ |
| 上下文隔离 | 可配置 | 可配置 | ✅ |
| 编译时创建 | 是 | 部分框架是 | ✅ |

---

### 4.3 当前代码实现分析

**当前代码中的相关组件：**

1. **SoloAgent.child_agents 机制**
   ```python
   class SoloAgent:
       def set_child_agents(self, agents: Dict[str, "SoloAgent"]) -> None:
           self._child_agents = agents
   ```

2. **Task 工具调用**
   ```python
   class SubAgentTaskTool:
       async def execute(self, agent_id: str, message: str) -> str:
           return await self.parent_agent.call_subagent(agent_id, message)
   ```

3. **FlowCompiler 边编译**
   ```python
   for agent_id, child_ids in edge_map.items():
       agents[agent_id].set_child_agents({cid: agents[cid] for cid in child_ids})
   ```

---

### 4.4 当前代码存在的问题

**问题一：Task 工具创建时机错误**

```python
# FlowCompiler.compile() 中的执行顺序：
1. _compile_node() 创建 SoloAgent
2. agent.initialize() ← 此时 child_agents 为空！
3. _compile_edges() 设置 child_agents
4. set_child_agents() ← 太晚了，Task 工具已注册
```

**问题二：SubAgentTaskTool 与 TaskTool 并存**

| | SubAgentTaskTool | TaskTool |
|---|---|---|
| 用途 | 调用已存在 child_agent | 动态创建新 Agent |
| 来源 | parent_agent.call_subagent() | ReActAgent.reply() |

**问题三：没有实现"从下向上"编译**

当前实现是：
```python
for node in nodes:
    agent = self._compile_node(node, ...)
    agents[agent_id] = agent
# 然后再设置边关系
```

应该是：
```python
# 1. 按层级从下到上创建
# 2. 先创建 level=2 的 Agent
# 3. 再创建 level=1 的 Agent，设置 child_agents
# 4. 最后创建 level=0 的 Agent，设置 child_agents
```

---

## 五、建议修复方案

### 5.1 修复 Task 工具创建时机

```python
async def compile(self, flow_data, ...):
    # 1. 先编译所有节点
    for node in nodes:
        agent = self._compile_node(node, ...)
        agents[agent.agent_id] = agent

    # 2. 编译边关系并设置 child_agents
    edge_map = self._compile_edges(edges)
    for agent_id, child_ids in edge_map.items():
        if agent_id in agents:
            agents[agent_id].config.child_agents = child_ids
            child_agents = {cid: agents[cid] for cid in child_ids if cid in agents}
            agents[agent_id].set_child_agents(child_agents)

    # 3. 然后再初始化所有 Agent（此时 child_agents 已设置）
    for agent in agents.values():
        await agent.initialize()
```

### 5.2 实现从下向上的编译顺序

```python
def _get_node_level(self, node: Dict[str, Any]) -> int:
    """获取节点层级"""
    return node.get("level", 0)

async def compile(self, flow_data, ...):
    # 1. 收集所有节点
    nodes = flow_data.get("nodes", [])
    edges = flow_data.get("edges", [])

    # 2. 构建节点层级映射
    node_levels = {node["id"]: self._get_node_level(node) for node in nodes}

    # 3. 按层级从低到高排序
    sorted_nodes = sorted(nodes, key=lambda n: node_levels[n["id"]])

    # 4. 从下向上编译
    agents = {}
    for node in sorted_nodes:
        agent = self._compile_node(node, ...)
        agents[agent.agent_id] = agent

    # 5. 构建边关系映射
    edge_map = self._build_edge_map(edges)

    # 6. 从上往下设置 child_agents（level 大的作为 level 小的 child）
    for agent_id, agent in agents.items():
        child_ids = edge_map.get(agent_id, [])
        if child_ids:
            child_agents = {cid: agents[cid] for cid in child_ids if cid in agents}
            agent.set_child_agents(child_agents)

    # 7. 初始化所有 Agent
    for agent in agents.values():
        await agent.initialize()

    return CompiledFlow(agents=agents, edges=edge_map)
```

### 5.3 统一 Task 工具实现

```python
def create_task_tool_config(agent: "SoloAgent") -> Dict[str, Any]:
    """创建 Task 工具配置 - 用于调用子 Agent"""

    async def execute(agent_id: str, message: str, **kwargs) -> str:
        """执行子 Agent 调用"""
        if not agent._child_agents:
            raise AgentToolError("No child agents configured")

        child = agent._child_agents.get(agent_id)
        if not child:
            available = list(agent._child_agents.keys())
            raise AgentToolError(f"Child agent '{agent_id}' not found. Available: {available}")

        if not child._initialized:
            await child.initialize()

        result = await child.reply(message)
        return result.get_text_content()

    return {
        "name": "Task",
        "function": execute,
        "description": "调用子 Agent 执行任务",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "子 Agent ID",
                    "enum": list(agent._child_agents.keys()) if agent._child_agents else []
                },
                "message": {
                    "type": "string",
                    "description": "发送给子 Agent 的消息"
                }
            },
            "required": ["agent_id", "message"]
        }
    }
```

---

## 六、方案对比总结

| 特性 | 用户方案 | LangGraph | AutoGen | CrewAI | OpenAI Swarm |
|------|---------|-----------|---------|--------|--------------|
| 架构模式 | Hierarchical | 状态图 | 对话协作 | 层级/顺序/投票 | Handoff |
| 编译时创建 | ✅ 是 | ❌ 否 | ❌ 否 | ✅ 是 | ❌ 否 |
| 工具调用 Subagent | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 | ❌ 否 |
| 从下向上编译 | ❌ 否 | N/A | N/A | N/A | N/A |
| 上下文隔离 | 可配置 | 完善 | 完善 | 完善 | 无状态 |
| 动态任务分配 | ✅ 是 | ✅ 是 | ✅ 是 | ✅ 是 | ✅ 是 |

---

## 七、结论

### 7.1 用户方案评估

用户的方案"在 agenticflow.json 编译时，从下向上创建 SoloAgent 实例，然后通过 Task，使下层 Agent 成为上级 Agent 的 SubAgent"**是主流的 Subagent 实现方式之一**，类似于：

- CrewAI 的 Hierarchical Process
- Claude Code 的 Subagent as Tool
- Microsoft Agent Framework 的 Delegating Agent

### 7.2 当前代码问题

当前代码存在以下问题需要修复：

1. **Task 工具创建时机错误**：initialize() 在 set_child_agents() 之前执行
2. **没有实现从下向上编译**：所有节点同时创建，没有层级顺序
3. **两套 Task 工具并存**：SubAgentTaskTool 和 TaskTool 容易混淆

### 7.3 建议

1. 修改 FlowCompiler.compile() 方法，调整执行顺序
2. 实现按层级从下向上的编译顺序
3. 统一 Task 工具实现，移除或明确区分两套实现
4. 在 agenticflow.json 中添加 level 字段支持层级定义

---

## 八、参考资料

1. LangGraph Documentation - https://langchain.com/
2. AutoGen Documentation - https://microsoft.github.io/autogen/
3. CrewAI Documentation - https://crewai.com/
4. OpenAI Swarm - https://github.com/openai/swarm
5. Claude Code Subagents - Anthropic 官方文档
6. Microsoft Agent Framework - Microsoft 官方博客
7. Orchestrator-Workers Pattern - AI Agent Design Patterns
8. Hierarchical Agent Systems - Multi-Agent System Research

---

**报告完成时间：** 2026-03-25
**网络搜索次数：** 30+