# SubAgent 机制技术架构文档

## 一、概述

### 1.1 文档目的

本文档详细描述 SoloEngine 中 SubAgent 机制的技术架构、设计思想和实现细节，为开发者提供完整的技术参考。

### 1.2 SubAgent 定义

SubAgent（子代理）是指在多 Agent 系统中，由主 Agent（MainAgent）通过工具调用方式委托执行特定任务的专门化 Agent 实例。SubAgent 拥有独立的上下文、配置和工具集，能够自主完成分配的任务并返回结果。

### 1.3 设计目标

| 目标 | 描述 |
|------|------|
| 模块化 | 每个 SubAgent 作为独立模块，职责单一 |
| 可扩展 | 支持动态添加新的 SubAgent 类型 |
| 隔离性 | SubAgent 之间上下文隔离，互不干扰 |
| 灵活性 | 模型自主决定何时调用 SubAgent |
| 可观测 | 完整的事件流和日志记录 |

---

## 二、系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              前端层 (Frontend)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  RunPanel                                                        │   │
│  │  ├── MessageManager (消息管理)                                   │   │
│  │  ├── SubagentOutputPanel (SubAgent输出展示)                      │   │
│  │  └── CallRecordPanel (工具调用记录)                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (实时事件流)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              后端层 (Backend)                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  API Layer                                                       │   │
│  │  ├── /api/v1/run/ws (WebSocket 端点)                            │   │
│  │  └── /api/v1/run/sessions (会话管理)                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  FlowCompiler (编译层)                                           │   │
│  │  ├── AgenticFlowCompiler                                        │   │
│  │  │   ├── _calculate_compilation_order() (拓扑排序)              │   │
│  │  │   ├── _compile_node() (节点编译)                             │   │
│  │  │   └── _compile_edges() (边关系编译)                          │   │
│  │  └── CompiledFlow                                               │   │
│  │      ├── agents: Dict[str, SoloAgent]                           │   │
│  │      └── edges: Dict[str, List[str]]                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Agent Layer                                                     │   │
│  │  ├── SoloAgent (主代理)                                          │   │
│  │  │   ├── config: SoloAgentConfig                                │   │
│  │  │   ├── _subagents: Dict[str, SoloAgent]                       │   │
│  │  │   ├── _tools: Dict[str, Any]                                 │   │
│  │  │   └── _stream_callback: callable                             │   │
│  │  └── SubAgentTaskTool (Task工具)                                 │   │
│  │      ├── execute(subagent_name, task)                           │   │
│  │      └── get_tool_spec()                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Core Layer                                                      │   │
│  │  ├── ReActCore (推理-行动核心)                                   │   │
│  │  │   ├── run() (主循环)                                         │   │
│  │  │   ├── _check_completion() (完成检测)                         │   │
│  │  │   └── _execute_tool() (工具执行)                             │   │
│  │  └── ToolCallEventManager (工具调用事件管理)                     │   │
│  │      ├── on_tool_call_start()                                   │   │
│  │      ├── on_tool_call_args()                                    │   │
│  │      ├── on_tool_call_end()                                     │   │
│  │      └── on_tool_call_result()                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Model Layer                                                     │   │
│  │  ├── OpenAIModel / DeepSeekModel / QwenModel                    │   │
│  │  └── ChatResponse (统一响应格式)                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 四层架构说明

| 层级 | 文件 | 职责 |
|------|------|------|
| **AgenticFlow 实例层** | `run.py` | 模型记忆读取/存储、Session 创建与隔离管理 |
| **Compiler 层** | `flow_compiler.py` | 编译并执行 Flow，协调多 Agent |
| **SoloAgent 层** | `agent.py` | 基于 ReActCore 基类，负责组装各类 Plugins |
| **ReActCore 基类** | `react_core.py` | 仅负责接收数据并运行，核心执行引擎 |

---

## 三、核心数据结构

### 3.1 SubAgentInfo 数据类

```python
@dataclass
class SubAgentInfo:
    """SubAgent 信息数据类
    
    用于存储 SubAgent 的元信息，分为显示给模型的字段和后端使用的字段。
    """
    # 显示给模型的字段（用于生成 Tool Spec）
    subagent_name: str    # LLM 调用时使用的名称（enum 中的值）
    description: str      # 功能描述（XML 中显示）
    
    # 不显示给模型的字段（后端调用时需要使用）
    subagent_id: str      # agent 实例的唯一标识（UUID）
```

**设计说明：**
- `subagent_name` 和 `description` 显示给 LLM，帮助模型理解何时调用
- `subagent_id` 不显示给模型，仅用于后端查找 SubAgent 实例

### 3.2 SoloAgentConfig 配置类

```python
@dataclass
class SoloAgentConfig:
    """SoloAgent 配置 - 简洁的声明式配置"""
    
    name: str
    provider: str
    model: str
    system_prompt: str = ""
    
    skills: List[Dict[str, Any]] = field(default_factory=list)
    tools: List[str] = field(default_factory=list)
    mcp_servers: List[Dict[str, Any]] = field(default_factory=list)
    
    # SubAgent 配置
    subagents: List[Dict[str, Any]] = field(default_factory=list)
    
    # 其他配置...
    agent_id: Optional[str] = None  # UUID，由 __post_init__ 自动生成
    
    def __post_init__(self):
        if self.agent_id is None:
            self.agent_id = str(uuid.uuid4())
```

### 3.3 ExecutionEvent 事件类

```python
@dataclass
class ExecutionEvent:
    """执行事件数据类"""
    event_type: str
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    content: Optional[str] = None
    
    # 工具调用相关
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[str] = None
    
    # SubAgent 相关
    subagent_id: Optional[str] = None
    subagent_name: Optional[str] = None
    
    status: Optional[str] = None
    error: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
```

---

## 四、编译流程

### 4.1 从下向上编译（拓扑排序）

编译器通过边关系（Edge）确定 Agent 之间的父子关系，然后使用拓扑排序确定编译顺序。

```
边关系定义：
  source → target 表示 source 是上级，target 是下级（subagent）

编译顺序：
  先编译下级（没有出边的节点），再编译上级
```

**拓扑排序算法实现：**

```python
def _calculate_compilation_order(self, nodes: List[Dict], edges: List[Dict]) -> List[str]:
    """通过边关系拓扑排序，确定编译顺序"""
    
    # 1. 构建出边和入边映射
    out_edges: Dict[str, List[str]] = {}  # source -> [targets]
    in_edges: Dict[str, List[str]] = {}   # target -> [sources]
    
    for edge in edges:
        source = edge.get("source")
        target = edge.get("target")
        if source and target:
            out_edges.setdefault(source, []).append(target)
            in_edges.setdefault(target, []).append(source)
    
    # 2. 找到底层节点（没有出边的节点）
    all_nodes = {n["id"] for n in nodes}
    nodes_with_out_edges = set(out_edges.keys())
    bottom_nodes = all_nodes - nodes_with_out_edges
    
    # 3. 拓扑排序
    compilation_order = []
    visited = set()
    queue = list(bottom_nodes)
    
    while queue:
        node_id = queue.pop(0)
        if node_id in visited:
            continue
        visited.add(node_id)
        compilation_order.append(node_id)
        
        # 当所有子节点都编译完成后，父节点才能编译
        for parent_id in in_edges.get(node_id, []):
            all_subagents_compiled = all(
                subagent_id in visited 
                for subagent_id in out_edges.get(parent_id, [])
            )
            if all_subagents_compiled and parent_id not in visited:
                queue.append(parent_id)
    
    return compilation_order
```

### 4.2 编译流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                      agenticflow.json                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  nodes: [                                                │   │
│  │    { id: "agent-1", type: "orchestrator", ... },        │   │
│  │    { id: "agent-2", type: "executor", ... },            │   │
│  │    { id: "agent-3", type: "executor", ... }             │   │
│  │  ]                                                       │   │
│  │  edges: [                                                │   │
│  │    { source: "agent-1", target: "agent-2" },            │   │
│  │    { source: "agent-1", target: "agent-3" }             │   │
│  │  ]                                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Step 1: 拓扑排序                              │
│                                                                 │
│  边关系: agent-1 → agent-2, agent-1 → agent-3                   │
│  编译顺序: [agent-2, agent-3, agent-1]                          │
│  (先编译子 Agent，再编译父 Agent)                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Step 2: 创建 SoloAgent 实例                   │
│                                                                 │
│  for node_id in compilation_order:                              │
│      agent = _compile_node(node)                                │
│      agents[agent.agent_id] = agent                             │
│                                                                 │
│      # 设置 SubAgent 关系                                        │
│      subagent_ids = edges.get(agent.agent_id, [])               │
│      if subagent_ids:                                           │
│          subagents = {sid: agents[sid] for sid in subagent_ids} │
│          agent.set_subagents(subagents, subagents_info)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Step 3: 返回 CompiledFlow                     │
│                                                                 │
│  CompiledFlow(                                                  │
│      agents={agent_id: SoloAgent},                              │
│      edges={parent_id: [child_ids]},                            │
│      orchestrator_id=orchestrator_id                            │
│  )                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 SubAgent 写入 MainAgent 的详细过程

SubAgent 编译完成后，需要将其信息写入父 Agent（MainAgent），这个过程分为三个关键步骤：

#### 4.3.1 步骤一：编译时设置 SubAgent 关系

在 `flow_compiler.py` 的 `compile()` 方法中，遍历编译顺序创建 Agent，并根据边关系设置 SubAgent：

```python
# flow_compiler.py - compile() 方法

for node_id in compilation_order:
    node = node_map.get(node_id)
    if not node:
        continue
    
    # 1. 创建 SoloAgent 实例
    agent = self._compile_node(
        node=node,
        user_id=user_id,
        agentic_flow_id=agentic_flow_id,
        session_id=session_id,
        run_project_id=run_project_id,
        llm_configs=llm_configs,
        mcp_configs=mcp_configs,
        skills_configs=skills_configs,
        canvas_data=canvas_data,
    )
    agents[agent.agent_id] = agent

    # 2. 根据边关系设置 SubAgent
    subagent_ids = edge_map.get(agent.agent_id, [])
    if subagent_ids:
        subagents = {}
        subagents_info = []
        
        # 3. 遍历所有子 Agent ID
        for sid in subagent_ids:
            if sid in agents:
                sub_agent = agents[sid]
                subagents[sid] = sub_agent
                
                # 4. 构建 SubAgentInfo
                subagents_info.append({
                    "subagent_name": sub_agent.config.name,
                    "subagent_id": sub_agent.agent_id,
                    "description": sub_agent.config.system_prompt[:100] 
                        if sub_agent.config.system_prompt 
                        else f"SubAgent: {sub_agent.config.name}"
                })
        
        # 5. 调用 set_subagents 写入父 Agent
        if subagents:
            agent.set_subagents(subagents, subagents_info)
            logger.info(f"[SubAgents] Agent '{agent.config.name}' has subagents: "
                       f"{[s['subagent_name'] for s in subagents_info]}")
```

**关键点：**
- `edge_map` 存储边关系：`{parent_id: [child_ids]}`
- `subagents_info` 包含 SubAgentInfo 结构的信息
- 调用 `set_subagents()` 将 SubAgent 写入父 Agent

#### 4.3.2 步骤二：SoloAgent.set_subagents() 方法

`set_subagents()` 方法负责将 SubAgent 实例和信息写入父 Agent：

```python
# agent.py

def set_subagents(self, agents: Dict[str, "SoloAgent"], 
                  subagents_info: List[Dict[str, Any]] = None) -> None:
    """设置 SubAgent 关系
    
    Args:
        agents: SubAgent 实例字典 {agent_id: SoloAgent}
        subagents_info: SubAgent 信息列表，用于生成 Task 工具配置
    """
    # 1. 存储 SubAgent 实例引用
    self._subagents = agents
    
    # 2. 更新配置中的 subagents 字段
    if subagents_info:
        self._subagents_info = subagents_info
        self.config.subagents = subagents_info
    elif agents:
        # 如果没有提供 subagents_info，自动生成
        self.config.subagents = [
            {
                "subagent_name": name, 
                "subagent_id": agent.agent_id, 
                "description": agent.config.system_prompt[:100] 
                    if agent.config.system_prompt 
                    else f"SubAgent: {name}"
            }
            for name, agent in agents.items()
        ]

def get_subagent(self, agent_id: str) -> Optional["SoloAgent"]:
    """根据 agent_id 获取 SubAgent 实例"""
    return self._subagents.get(agent_id)
```

**存储结构：**
- `_subagents`: `Dict[str, SoloAgent]` - SubAgent 实例引用
- `config.subagents`: `List[Dict]` - SubAgentInfo 信息列表

#### 4.3.3 步骤三：初始化时注册 Task 工具

当父 Agent 调用 `initialize()` 方法时，会检查 `config.subagents` 并注册 Task 工具：

```python
# agent.py - initialize() 方法

async def initialize(self) -> None:
    """初始化 Agent，加载工具和配置"""
    
    tool_configs = []
    
    # 1. 加载本地工具
    for tool_name in self.config.tools:
        tool_config = await self._load_tool(tool_name)
        if tool_config:
            tool_configs.append(tool_config)
    
    # 2. 加载 Skills
    for skill_config in self.config.skills:
        skill_tools = await self._load_skill(skill_config)
        tool_configs.extend(skill_tools)
    
    # 3. 加载 MCP 工具
    if self.config.mcp_servers:
        mcp_tool_configs = await self._load_mcp_servers(self.config.mcp_servers)
        tool_configs.extend(mcp_tool_configs)
    
    # 4. 关键：如果有 SubAgent，注册 Task 工具
    if self.config.subagents:
        from .tools import create_task_tool_config
        task_config = create_task_tool_config(self)
        tool_configs.append(task_config)
        logger.info(f"[SubAgents] Added Task tool for subagents: "
                   f"{[s.get('subagent_name') for s in self.config.subagents]}")
    
    # 5. 创建 ReActCore 实例
    self._core = ReActCore(
        agent_id=self.agent_id,
        agent_name=self.name,
        llm=self._llm,
        tools=tool_configs,
        system_prompt=self.config.system_prompt,
        max_iters=self.config.max_iters,
        stream_callback=self._stream_callback,
    )
    
    self._initialized = True
```

#### 4.3.4 步骤四：create_task_tool_config() 创建 Task 工具

`create_task_tool_config()` 函数根据 `config.subagents` 创建 Task 工具：

```python
# tools.py

def create_task_tool_config(agent: "SoloAgent") -> Dict[str, Any]:
    """创建 Task 工具配置，用于调用子 Agent
    
    Args:
        agent: SoloAgent 实例，包含 subagents 信息
    
    Returns:
        Dict[str, Any]: Task 工具配置
    """
    
    class SubAgentTaskTool:
        """子 Agent 调用工具 - 基于 SubAgentInfo 结构"""
        
        def __init__(self, parent_agent):
            self.parent_agent = parent_agent
            self._subagents_info: Dict[str, Dict[str, Any]] = {}
            self._name_to_id: Dict[str, str] = {}
            
            # 从 parent_agent.config.subagents 读取 SubAgent 信息
            for sa in parent_agent.config.subagents:
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
            """生成工具规范，包含 enum 和 XML 描述"""
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
                            "enum": names  # 限制可选值为已注册的 SubAgent
                        },
                        "task": {
                            "type": "string",
                            "description": "Detailed task description"
                        }
                    },
                    "required": ["subagent_name", "task"]
                }
            }
        
        async def execute(self, subagent_name: str, task: str) -> Dict[str, Any]:
            """执行 SubAgent 调用"""
            # ... 执行逻辑见第五章
    
    tool = SubAgentTaskTool(agent)
    spec = tool.get_tool_spec()
    
    return {
        "name": spec["name"],
        "function": tool.execute,
        "description": spec["description"],
        "parameters": spec["parameters"],
    }
```

#### 4.3.5 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SubAgent 编译写入 MainAgent 完整流程                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 1: 编译阶段 (flow_compiler.py)                                    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  for node_id in compilation_order:                              │   │
│  │      agent = _compile_node(node)                                │   │
│  │      agents[agent.agent_id] = agent                             │   │
│  │                                                                 │   │
│  │      # 检查边关系，设置 SubAgent                                  │   │
│  │      subagent_ids = edge_map.get(agent.agent_id, [])            │   │
│  │      if subagent_ids:                                           │   │
│  │          subagents = {sid: agents[sid] for sid in subagent_ids} │   │
│  │          subagents_info = [...]  # 构建 SubAgentInfo 列表       │   │
│  │          agent.set_subagents(subagents, subagents_info)         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  输出: agent._subagents = {subagent_id: SoloAgent}                     │
│        agent.config.subagents = [SubAgentInfo, ...]                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 2: 初始化阶段 (agent.py - initialize())                           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  async def initialize(self):                                    │   │
│  │      tool_configs = []                                          │   │
│  │                                                                 │   │
│  │      # 加载其他工具...                                           │   │
│  │                                                                 │   │
│  │      # 关键：检查 config.subagents                               │   │
│  │      if self.config.subagents:                                  │   │
│  │          from .tools import create_task_tool_config             │   │
│  │          task_config = create_task_tool_config(self)            │   │
│  │          tool_configs.append(task_config)                       │   │
│  │                                                                 │   │
│  │      # 创建 ReActCore，传入工具配置                               │   │
│  │      self._core = ReActCore(tools=tool_configs, ...)            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  输出: Task 工具注册到 ReActCore._tools                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Step 3: 运行时 (ReActCore)                                             │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  模型收到工具列表:                                                │   │
│  │  [                                                               │   │
│  │    {"name": "Read", ...},                                        │   │
│  │    {"name": "LS", ...},                                          │   │
│  │    {"name": "Task",                                              │   │
│  │     "description": "Launch a agent...",                          │   │
│  │     "parameters": {                                              │   │
│  │       "subagent_name": {"enum": ["search_agent", "coder"]},      │   │
│  │       "task": {...}                                              │   │
│  │     }                                                            │   │
│  │    }                                                             │   │
│  │  ]                                                               │   │
│  │                                                                 │   │
│  │  模型可自主决定是否调用 Task 工具                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.3.6 数据流向总结

| 阶段 | 数据存储位置 | 数据内容 |
|------|------------|---------|
| 编译时 | `agent._subagents` | `{subagent_id: SoloAgent}` 实例引用 |
| 编译时 | `agent.config.subagents` | `[SubAgentInfo, ...]` 信息列表 |
| 初始化时 | `ReActCore._tools` | Task 工具配置（含 enum 限制） |
| 运行时 | 模型上下文 | Task 工具的 Tool Spec |

---

## 五、Task 工具实现

### 5.1 工具规范（Tool Spec）

Task 工具使用 **enum + XML** 的渐进式披露机制：

```python
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
                    "enum": names  # 限制可选值
                },
                "task": {
                    "type": "string",
                    "description": "Detailed task description"
                }
            },
            "required": ["subagent_name", "task"]
        }
    }
```

**XML 格式示例：**

```xml
<available_subagents>
- search_agent: 专门用于信息检索和搜索任务
- code_reviewer: 代码审查和质量检查
- data_analyst: 数据分析和可视化
</available_subagents>
```

### 5.2 执行流程

```python
async def execute(self, subagent_name: str, task: str) -> Dict[str, Any]:
    # 1. 查找 SubAgent 实例
    subagent_id = self._name_to_id.get(subagent_name)
    subagent = self.parent_agent.get_subagent(subagent_id)
    
    # 2. 确保初始化
    if not subagent._initialized:
        await subagent.initialize()
    
    # 3. 设置流式回调（继承父 Agent 的回调）
    if self.parent_agent._stream_callback:
        subagent.set_stream_callback(self.parent_agent._stream_callback)
    
    # 4. 发送 subagent_start 事件
    self._send_event("subagent_start", subagent_id, subagent_name)
    
    # 5. 执行 SubAgent
    result = await subagent.reply(task)
    
    # 6. 发送 subagent_complete 事件
    self._send_event("subagent_complete", subagent_id, subagent_name, result)
    
    return {
        "success": True,
        "subagent_name": subagent_name,
        "result": content
    }
```

### 5.3 流式输出支持

SubAgent 的流式输出通过继承父 Agent 的 `stream_callback` 实现：

```python
# agent.py
def set_stream_callback(self, callback: callable) -> None:
    """设置流式输出回调函数"""
    self._stream_callback = callback
    if self._core:
        self._core.stream_callback = callback
        self._core.agent_id = self.agent_id
    
    # 同时为所有 subagent 设置回调
    for subagent in self._subagents.values():
        if subagent._initialized:
            subagent.set_stream_callback(callback)
```

### 5.4 TaskTool 核心代码

TaskTool 是 Task 工具的实际实现类，负责管理 SubAgent 信息和执行调用：

```python
class TaskTool(BaseAgentTool):
    """Task 工具 - 用于调用 SubAgent"""
    
    def __init__(self, subagents_info: List[Dict[str, Any]], parent_agent: "SoloAgent"):
        super().__init__()
        self._subagents_info = {}      # 存储 SubAgentInfo
        self._name_to_id = {}          # subagent_name -> subagent_id 映射
        self._parent_agent = parent_agent
        
        # 初始化时解析 SubAgent 信息
        for sa in subagents_info:
            name = sa.get("subagent_name")
            subagent_id = sa.get("subagent_id")
            if name:
                self._subagents_info[name] = SubAgentInfo(
                    subagent_name=name,
                    description=sa.get("description", ""),
                    subagent_id=subagent_id or name
                )
                self._name_to_id[name] = subagent_id or name
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """生成 Tool Spec - 只使用 subagent_name 和 description"""
        xml = self._format_available_subagents_xml()
        names = list(self._subagents_info.keys())
        
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
                        "enum": names  # 限制可选值为已注册的 SubAgent
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
        """生成 XML - 只显示 subagent_name 和 description"""
        lines = ["<available_subagents>"]
        for name, info in self._subagents_info.items():
            lines.append(f"- {name}: {info.description}")
        lines.append("</available_subagents>")
        return "\n".join(lines)
    
    async def execute(self, subagent_name: str, task: str) -> Dict[str, Any]:
        """执行 - 使用 subagent_id 查找 agent 实例"""
        # 1. 通过 subagent_name 找到 subagent_id
        subagent_id = self._name_to_id.get(subagent_name)
        if not subagent_id:
            return {"success": False, "error": f"Subagent '{subagent_name}' not found"}
        
        # 2. 通过 subagent_id 找到 agent 实例
        subagent = self._parent_agent.get_subagent(subagent_id)
        if not subagent:
            return {"success": False, "error": f"Subagent instance '{subagent_id}' not found"}
        
        # 3. 调用 agent 执行任务
        result = await subagent.reply(task)
        return {
            "success": True,
            "subagent_name": subagent_name,
            "result": result.get_text_content()
        }
```

### 5.5 调用示例

**LLM 调用格式：**

```json
{
  "name": "Task",
  "arguments": {
    "subagent_name": "search_agent",
    "task": "搜索最新的 Python 异步编程教程，并总结要点"
  }
}
```

**返回格式：**

```json
{
  "success": true,
  "subagent_name": "search_agent",
  "result": "找到以下 Python 异步编程教程：\n1. 官方文档 asyncio...\n要点总结：..."
}
```

### 5.6 Task 工具的完整执行流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Task 工具完整执行流程                                  │
└─────────────────────────────────────────────────────────────────────────┘

1. 编译阶段
   ┌─────────────────────────────────────────────────────────────────┐
   │  flow_compiler.py                                                │
   │                                                                  │
   │  subagents_info = [                                              │
   │    {                                                             │
   │      "subagent_name": "search_agent",    # 显示给模型            │
   │      "description": "专门负责搜索任务",   # 显示给模型            │
   │      "subagent_id": "agent_001"          # 不显示给模型          │
   │    }                                                             │
   │  ]                                                               │
   │                                                                  │
   │  agent.set_subagents(subagents, subagents_info)                  │
   └─────────────────────────────────────────────────────────────────┘
                              ↓
2. 初始化阶段
   ┌─────────────────────────────────────────────────────────────────┐
   │  agent.py - initialize()                                         │
   │                                                                  │
   │  if self.config.subagents:                                       │
   │      task_tool = TaskTool(subagents_info=self.config.subagents)  │
   │                                                                  │
   │  TaskTool 内部存储：                                              │
   │  - _subagents_info = {                                           │
   │      "search_agent": SubAgentInfo(                               │
   │        subagent_name="search_agent",                             │
   │        description="专门负责搜索任务",                            │
   │        subagent_id="agent_001"                                   │
   │      )                                                           │
   │    }                                                             │
   │  - _name_to_id = {"search_agent": "agent_001"}                   │
   └─────────────────────────────────────────────────────────────────┘
                              ↓
3. Tool Spec 生成（LLM 看到的）
   ┌─────────────────────────────────────────────────────────────────┐
   │  {                                                               │
   │    "name": "Task",                                               │
   │    "description": "Launch a agent...\n                           │
   │                    Available agents:\n                           │
   │                    <available_subagents>\n                       │
   │                    - search_agent: 专门负责搜索任务\n             │
   │                    </available_subagents>...",                   │
   │    "parameters": {                                               │
   │      "properties": {                                             │
   │        "subagent_name": {                                        │
   │          "type": "string",                                       │
   │          "enum": ["search_agent"]  # 限制可选值                  │
   │        },                                                        │
   │        "task": {                                                 │
   │          "type": "string"                                        │
   │        }                                                         │
   │      }                                                           │
   │    }                                                             │
   │  }                                                               │
   └─────────────────────────────────────────────────────────────────┘
                              ↓
4. LLM 调用
   ┌─────────────────────────────────────────────────────────────────┐
   │  Task(subagent_name="search_agent", task="搜索 Python 教程")     │
   │                                                                  │
   │  TaskTool.execute() 执行：                                       │
   │  1. subagent_id = _name_to_id["search_agent"] → "agent_001"      │
   │  2. subagent = parent_agent.get_subagent("agent_001")            │
   │  3. result = await subagent.reply(task)                         │
   │  4. return {"success": true, "result": ...}                      │
   └─────────────────────────────────────────────────────────────────┘
```

### 5.7 关键设计要点

| 设计要点 | 说明 |
|---------|------|
| **enum 限制** | `subagent_name` 使用 enum 限制可选值，防止 LLM 幻觉 |
| **XML 描述** | 使用 `<available_subagents>` XML 标签提供清晰的功能描述 |
| **双层映射** | `_name_to_id` 实现 subagent_name → subagent_id 的映射 |
| **实例引用** | 通过 `parent_agent.get_subagent()` 获取实际的 SoloAgent 实例 |
| **流式继承** | SubAgent 继承父 Agent 的 stream_callback，实现流式输出 |

---

## 六、事件流机制

### 6.1 事件类型

| 事件类型 | 触发时机 | 数据字段 |
|---------|---------|---------|
| `execution_start` | 执行开始 | agent_id, agent_name |
| `execution_complete` | 执行完成 | agent_id, result |
| `agent_start` | Agent 开始执行 | agent_id, agent_name, agent_type |
| `agent_complete` | Agent 执行完成 | agent_id, output |
| `tool_call` | 工具调用开始 | tool_name, tool_args |
| `tool_result` | 工具调用结果 | tool_name, tool_result |
| `subagent_start` | SubAgent 开始 | subagent_id, subagent_name |
| `subagent_complete` | SubAgent 完成 | subagent_id, output |
| `stream` | 流式输出 | delta (content, reasoning_content) |

### 6.2 事件流图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Backend Event Flow                         │
│                                                                 │
│  ReActCore                                                      │
│      │                                                          │
│      ├── stream_callback(delta) ──────────────────────────────┐│
│      │                                                        ││
│      ├── ToolCallEventManager                                 ││
│      │       │                                                ││
│      │       ├── on_tool_call_start() ───────────────────────┐││
│      │       ├── on_tool_call_args() ───────────────────────┐││
│      │       ├── on_tool_call_end() ────────────────────────┐││
│      │       └── on_tool_call_result() ────────────────────┐││
│      │                                                      │││
│      └── SubAgentTaskTool                                    │││
│              │                                              │││
│              ├── "subagent_start" event ───────────────────┐│││
│              ├── subagent.reply()                          ││││
│              │       │                                      ││││
│              │       └── stream_callback() ───────────────┐││││
│              │                                            ││││
│              └── "subagent_complete" event ──────────────┐││││
│                                                          │││││
└──────────────────────────────────────────────────────────┼─┼─┼─┼─┘
                                                           │ │ │ │
                                                           ▼ ▼ ▼ ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WebSocket Connection                       │
│                                                                 │
│  {                                                              │
│    "type": "stream",                                            │
│    "delta": { "content": "..." }                                │
│  }                                                              │
│                                                                 │
│  {                                                              │
│    "type": "subagent_start",                                    │
│    "subagent_id": "uuid",                                       │
│    "subagent_name": "search_agent"                              │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend Event Handler                     │
│                                                                 │
│  case 'subagent_start':                                         │
│      setSubagentOutputs(prev => [...prev, {                     │
│          id: subagent_id,                                       │
│          name: subagent_name,                                   │
│          status: 'running'                                      │
│      }])                                                        │
│                                                                 │
│  case 'subagent_complete':                                      │
│      setSubagentOutputs(prev => prev.map(sa => ({               │
│          ...sa,                                                 │
│          output: content,                                       │
│          status: 'completed'                                    │
│      })))                                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 七、前端实现

### 7.1 类型定义

```typescript
// types/index.ts

export type CallType = 'tool' | 'skill' | 'mcp' | 'subagent';

export interface SubagentOutput {
  id: string;
  name: string;
  output: string;
  status: 'running' | 'completed' | 'error';
  calls: CallRecord[];
  startTime?: number;
  endTime?: number;
  duration?: number;
  input?: string;
  agentType?: string;
}
```

### 7.2 状态管理

```typescript
// stores/runPanelStore.ts

interface RunPanelState {
  // ... 其他状态
  subagentOutputs: SubagentOutput[];
  
  addSubagentOutput: (output: SubagentOutput) => void;
  updateSubagentOutput: (id: string, updates: Partial<SubagentOutput>) => void;
  setSubagentOutputs: (outputs: SubagentOutput[]) => void;
  clearSubagentOutputs: () => void;
}
```

### 7.3 事件处理

```typescript
// index.tsx

case 'subagent_start':
  setSubagentOutputs((prev: SubagentOutput[]) => {
    return [...prev, {
      id: event.subagent_id || generateId(),
      name: event.subagent_name || 'Unknown Agent',
      output: '',
      status: 'running',
      calls: [],
      startTime: Date.now(),
      input: event.subagent_input,
      agentType: event.subagent_type,
    }];
  });
  break;

case 'subagent_complete':
  setSubagentOutputs((prev: SubagentOutput[]) => {
    const endTime = Date.now();
    return prev.map(sa => {
      if (sa.id === event.subagent_id) {
        return {
          ...sa,
          output: event.content || '',
          status: event.error ? 'error' : 'completed',
          endTime,
          duration: endTime - (sa.startTime || endTime),
        };
      }
      return sa;
    });
  });
  break;
```

---

## 八、设计决策

### 8.1 为什么选择 Task 工具调用而非边关系自动执行？

| 对比维度 | 边关系自动执行 | Task 工具调用 |
|---------|--------------|--------------|
| **决策方式** | 静态配置，自动执行 | 模型动态决策 |
| **灵活性** | 低，固定路径 | 高，根据上下文调整 |
| **资源效率** | 可能浪费（强制执行） | 按需调用，节省 token |
| **智能化** | 无智能决策 | 模型选择最合适的 subagent |
| **上下文管理** | 每次调用增加上下文 | 模型可控制上下文传递 |
| **符合 Agent 理念** | 否 | 是，Agent 自主决策是核心特性 |
| **主流框架采用** | 少数 | 主流（Claude Code, LangGraph 等） |

**结论：** Task 工具调用方式更符合 Agent 自主决策的设计理念，也是行业主流趋势。

### 8.2 边关系的作用

边关系在当前设计中仅用于：
1. **编译时确定父子关系**：通过边关系确定哪些 Agent 是 SubAgent
2. **拓扑排序**：确定编译顺序（从下向上）
3. **生成 Task 工具配置**：为父 Agent 生成 SubAgentInfo 列表

**不再用于：**
- ~~运行时自动执行 SubAgent~~（已移除）

### 8.3 UUID vs Name 作为 agent_id

**选择 UUID 的原因：**
1. **唯一性保证**：避免同名 Agent 冲突
2. **分布式友好**：支持多实例部署
3. **数据库主键**：便于关联查询

---

## 九、最佳实践

### 9.1 SubAgent 设计原则

1. **单一职责**：每个 SubAgent 应专注于特定领域
2. **明确描述**：description 应清晰说明功能和适用场景
3. **工具限制**：为 SubAgent 配置必要的工具，避免过度权限
4. **上下文隔离**：SubAgent 不应依赖父 Agent 的上下文

### 9.2 配置示例

```json
{
  "nodes": [
    {
      "id": "main-agent",
      "type": "orchestrator",
      "data": {
        "name": "Main Agent",
        "system_prompt": "你是主代理，负责协调任务...",
        "model_config": { "provider": "openai", "model": "gpt-4" }
      }
    },
    {
      "id": "search-agent",
      "type": "executor",
      "data": {
        "name": "search_agent",
        "system_prompt": "你是搜索专家，负责信息检索...",
        "tools": ["SearchCodebase", "WebSearch", "Read"]
      }
    }
  ],
  "edges": [
    { "source": "main-agent", "target": "search-agent" }
  ]
}
```

### 9.3 调试建议

1. **查看编译顺序**：检查日志中的 `[Compilation Order]`
2. **检查 SubAgent 注册**：查看 `[SubAgents] Agent 'xxx' has subagents: [...]`
3. **监控事件流**：使用浏览器开发者工具查看 WebSocket 消息
4. **数据库验证**：检查 `run_sessions` 和 `session_messages` 表

---

## 十、故障排除

### 10.1 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| SubAgent 未被调用 | Task 工具未注册 | 检查 `config.subagents` 配置 |
| 输出不流式 | stream_callback 未传递 | 检查 `set_stream_callback` 调用 |
| 重复调用 | 边关系自动执行未移除 | 确认使用最新代码 |
| SubAgent 找不到 | agent_id 不匹配 | 检查 `_name_to_id` 映射 |

### 10.2 日志关键字

```
[Compilation Order]     # 编译顺序
[SubAgents]            # SubAgent 注册
[call_subagent]        # SubAgent 调用
[Stream Chunk]         # 流式输出
finish_reason=stop     # 完成原因
```

---

## 十一、参考资料

1. [Claude Code Agent 模式深度解读](https://juejin.cn/post/...)
2. [LangGraph Multi-Agent Patterns](https://langchain-ai.github.io/langgraph/)
3. [CrewAI Hierarchical Process](https://docs.crewai.com/)
4. [OpenAI Swarm Handoff Pattern](https://github.com/openai/swarm)
5. [AutoGen Multi-Agent Conversation](https://microsoft.github.io/autogen/)

---

**文档版本：** 1.0.0  
**最后更新：** 2026-03-25  
**作者：** SoloEngine Team
