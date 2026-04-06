# SoloEngine Skills 调用机制重构方案 v2.3

## 一、设计目标

### 1.1 核心理念

用户在画布编辑 `agenticflow.json` 时只需指定 `skill_id`，运行时由编译器从数据库获取详细数据、组装 Skills。参考 Claude Code 的 Skill 调用机制，实现：

1. **模型可见 Skills**：通过 `available_skills` XML 标签让模型感知可用 Skills
2. **自动触发机制**：模型根据 description 自动判断何时调用 Skill
3. **渐进式披露**：先展示 Skill 列表，调用时再加载完整内容
4. **嵌套资源支持**：模型使用 Read 工具按需读取 references/、scripts/、assets/

### 1.2 设计原则

| 原则       | 说明                                                  |
| -------- | --------------------------------------------------- |
| 声明式配置    | 画布 JSON 只存储 ID，详细配置运行时加载                            |
| 渐进式披露    | 列表轻量（\~100 tokens/Skill），详情按需加载                     |
| 阻塞式调用    | 相关时立即调用，不得仅提及而不调用                                   |
| 文件系统即上下文 | SKILL.md 作为"目录"，模型使用 Read 工具读取嵌套资源                  |
| 最小改动     | 优先改造现有代码，需要时新增组件                                    |
| 用户控制     | Skills 由用户在画布中为每个 Agent 单独选择，每个 Agent 只编译自己的 Skills |

### 1.3 Skills 选择机制

**重要说明**：Skills 的选择完全由用户在画布中为每个 Agent 单独决定。

- 用户在画布中编辑 `agenticflow.json`，为**每个 Agent 单独指定**使用的 Skills
- 编译阶段**每个 Agent 只编译自己的 Skills**，不会看到其他 Agent 的 Skills
- 每个 Agent 有独立的 `SoloAgentConfig` 和 `SkillTool` 实例
- 不需要 `disable-model-invocation` 和 `allowed-tools`，因为用户已经决定了每个 Agent 可用哪些 Skills

***

## 二、现有代码详细分析

### 2.1 编译阶段已实现的功能

**关键发现**：编译阶段已经将 Skills 信息（包括 `folder_path`）编译到 Agent 配置中！

#### 2.1.1 编译流程详解

**重要**：agenticflow\.json 中有多个 Agent，每个 Agent 的 Skills 可能不同。编译时每个 Agent 只编译自己的 Skills。

```python
# flow_compiler.py 第625-637行
for node in nodes:  # 遍历所有 Agent 节点
    agent = self._compile_node(  # 每个 Agent 独立编译
        node=node,  # 当前节点的数据
        user_id=user_id,
        agentic_flow_id=agentic_flow_id,
        session_id=session_id,
        run_project_id=run_project_id,
        llm_configs=llm_configs,
        mcp_configs=mcp_configs,
        skills_configs=skills_configs,  # 所有 Skills 配置（用于查找）
        canvas_data=canvas_data,
    )
    agents[agent.agent_id] = agent  # 每个 Agent 有独立的配置
```

**关键点**：

- `skills_configs` 是所有 Skills 的配置字典（用于查找），不是要编译的 Skills 列表
- 每个 Agent 的 Skills 由 `node_data.get("skills", [])` 决定，只获取当前节点的 Skills

#### 2.1.2 单个 Agent 的 Skills 编译

**编译确认**：第786行 `skills = node_data.get("skills", [])` 确认只编译当前 Agent 节点的 skills。

```python
# flow_compiler.py 第786-804行
skills = node_data.get("skills", [])  # 只获取 agenticflow.json 中指定的 skills
enriched_skills = []
for skill in skills:
    if isinstance(skill, str):
        skill_dict = {"id": skill, "name": skill}
        if skills_configs and skill in skills_configs:
            skill_config = skills_configs[skill]
            skill_dict["name"] = skill_config.name
            rel_folder_path = getattr(skill_config, "folder_path", None)
            if rel_folder_path:
                from app.core.data_paths import DataPaths
                skill_dict["folder_path"] = DataPaths.to_absolute_path(rel_folder_path)
            else:
                skill_dict["folder_path"] = None
            skill_dict["instructions"] = getattr(skill_config, "instructions", None)
            skill_dict["tools"] = getattr(skill_config, "tools", [])
            skill_dict["description"] = getattr(skill_config, "description", "")  # 从数据库获取
        enriched_skills.append(skill_dict)
    elif isinstance(skill, dict):
        enriched_skills.append(skill)

# 第859行：传递给 SoloAgentConfig
config = SoloAgentConfig(
    ...
    skills=enriched_skills,  # 已包含 folder_path、description
    ...
)
```

**编译后的** **`enriched_skills`** **结构**：

```python
[
    {
        "id": "skill-id-1",
        "name": "canvas-design",
        "folder_path": "/absolute/path/to/canvas-design",
        "instructions": "SKILL.md 内容或 None",
        "description": "Create beautiful visual art...",  # 从数据库获取
        "tools": []
    }
]
```

### 2.2 SoloAgent 初始化流程

```python
# agent.py 第132-134行
if self.config.skills:
    skill_tool_configs = await self._load_skills(self.config.skills)
    tool_configs.extend(skill_tool_configs)
```

**问题发现**：`_load_skills()` 方法存在问题！

```python
# agent.py 第181-197行
async def _load_skills(self, skill_names: List[str]) -> List[Dict[str, Any]]:
    """加载技能工具配置"""
    tool_configs = []
    for skill_name in skill_names:  # 这里把 Dict 当作 str 处理了！
        try:
            skill_config = await ConfigLoader.load_skill_config(skill_name)
            ...
```

**问题**：

- `self.config.skills` 是 `List[Dict[str, Any]]`，包含 `folder_path`、`description` 等信息
- 但 `_load_skills()` 方法将其当作 `List[str]` 处理
- 导致编译阶段获取的 `folder_path`、`description` 信息丢失

### 2.3 SkillTool 现有实现

```python
# skill.py 第133-150行
def __init__(
    self,
    context: Optional[ToolContext] = None,
    permission: Optional[ToolPermission] = None,
    skills_dir: Optional[str] = None
) -> None:
    super().__init__(context, permission)
    self._skills_dir = skills_dir
    self._loaded_skills: Dict[str, SkillContext] = {}
    self._active_skill: Optional[str] = None
```

**问题**：

- SkillTool 没有接收 Skills 信息
- 无法生成 `available_skills` XML
- 无法知道有哪些 Skills 可用

### 2.4 数据流分析

**重要**：每个 Agent 独立编译，只编译自己的 Skills。

```
agenticflow.json 结构：
{
  "nodes": [
    {
      "id": "agent-1",
      "data": {
        "name": "Designer",
        "skills": ["canvas-design", "pdf"]  # Agent-1 的 Skills
      }
    },
    {
      "id": "agent-2",
      "data": {
        "name": "Developer",
        "skills": ["webapp-testing", "algorithmic-art"]  # Agent-2 的 Skills（不同！）
      }
    }
  ]
}

编译阶段（每个 Agent 独立编译）：
flow_compiler.compile()
├── _load_skills_configs(user_id)  # 加载所有 Skills 配置（用于查找）
├── for node in nodes:  # 遍历每个 Agent 节点
│   └── _compile_node(node)  # 每个 Agent 独立编译
│       ├── skills = node_data.get("skills", [])  # 只获取当前 Agent 的 skills
│       ├── enriched_skills = []  # 当前 Agent 的 Skills 列表
│       │   └── for skill in skills:  # 只处理当前 Agent 的 Skills
│       │       └── 从 skills_configs 查找配置
│       └── SoloAgentConfig(skills=enriched_skills)  # 每个 Agent 有独立的配置

初始化阶段（每个 Agent 独立初始化）：
SoloAgent.initialize()
├── self.config.skills  # 当前 Agent 的 Skills（已包含 folder_path、description）
└── _load_skills(self.config.skills)
    └── 问题：把 Dict 当作 str 处理，丢失 folder_path、description

SkillTool（每个 Agent 独立实例）：
├── 没有接收 Skills 信息
├── 无法生成 available_skills XML
└── 无法知道有哪些 Skills 可用
```

**关键结论**：

- 每个 Agent 有独立的 `SoloAgentConfig`，包含自己的 `skills` 列表
- 每个 Agent 有独立的 `SkillTool` 实例
- Agent A 的 SkillTool 只能看到 Agent A 的 Skills，不会看到 Agent B 的 Skills

***

## 三、可行性分析

### 3.1 编译阶段：生成 `available_skills` XML

**问题**：`available_skills` XML 需要在哪里生成？

**选项分析**：

| 选项 | 位置            | 可行性  | 说明                               |
| -- | ------------- | ---- | -------------------------------- |
| A  | Tool Spec     | ✅ 可行 | SkillTool.get\_tool\_spec() 动态生成 |
| B  | System Prompt | ✅ 可行 | 编译时注入到 system\_prompt            |
| C  | 单独消息          | ✅ 可行 | 作为独立的 system message             |

**推荐方案**：选项 A - 在 SkillTool.get\_tool\_spec() 中动态生成

**实现方式**：

1. 编译阶段将 Skills 信息传递给 SkillTool
2. SkillTool 在 get\_tool\_spec() 中生成 `available_skills` XML

### 3.2 SkillTool 获取 Skills 信息

**问题**：SkillTool 如何获取 Skills 信息？

**选项分析**：

| 选项 | 方式     | 可行性   | 说明                           |
| -- | ------ | ----- | ---------------------------- |
| A  | 构造函数注入 | ✅ 可行  | `SkillTool(skills_info=...)` |
| B  | 全局注册表  | ⚠️ 复杂 | 需要新增 SkillsRegistry          |
| C  | 从配置加载  | ⚠️ 重复 | 已在编译阶段加载                     |

**推荐方案**：选项 A - 构造函数注入

**实现方式**：

1. 修改 SkillTool 构造函数，接收 `skills_info` 参数
2. SoloAgent.\_load\_skills() 将 Skills 信息传递给 SkillTool

### 3.3 模型读取嵌套文档

**问题**：模型如何读取 references/、scripts/、assets/ 中的文件？

**答案**：模型使用已有的 Read 工具！

**流程**：

1. 模型调用 `Skill(name="canvas-design")`
2. SkillTool 返回 `{content, folder_path}`
3. 模型看到 SKILL.md 内容，其中包含指引：`参考 ./references/design-principles.md`
4. 模型使用 `Read("{folder_path}/references/design-principles.md")` 读取文件

**关键**：SkillTool 必须返回 `folder_path`，这样模型才知道文件的完整路径。

***

## 四、详细设计

### 4.1 改动点汇总

| 改动 | 文件                 | 说明                                             |
| -- | ------------------ | ---------------------------------------------- |
| 1  | `agent.py`         | 修复 `_load_skills()` 方法，正确处理 Dict 类型            |
| 2  | `skill.py`         | 修改构造函数，接收 Skills 信息                            |
| 3  | `skill.py`         | 改进 `get_tool_spec()`，生成 `available_skills` XML |
| 4  | `skill.py`         | 改进 `execute()`，返回 `folder_path`                |
| 5  | `flow_compiler.py` | 确认 `description` 从数据库获取并传递                     |

### 4.2 改动1：修复 `_load_skills()` 方法

```python
# agent.py

async def _load_skills(self, skills: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """加载技能工具配置
    
    Args:
        skills: 已在编译阶段组装的 Skills 信息列表
            [{"id": "...", "name": "...", "folder_path": "...", "description": "...", ...}]
    """
    tool_configs = []
    
    # 创建 SkillTool，注入 Skills 信息
    from ..plugins.tools.agent.skill import SkillTool
    
    skill_tool = SkillTool(skills_info=skills)
    
    # 注册 Skill 工具
    tool_configs.append({
        "name": "Skill",
        "function": skill_tool.execute,
        "description": skill_tool.get_tool_spec()["description"],
        "parameters": skill_tool.get_tool_spec()["parameters"],
    })
    
    # 加载 Skill 关联的工具
    for skill in skills:
        if isinstance(skill, dict):
            skill_tools = skill.get("tools", [])
            for tool_name in skill_tools:
                tool_config = ToolRegistry.get_tool_config(tool_name)
                if tool_config:
                    tool_configs.append(tool_config)
            
            # 将 Skill 指令添加到 system_prompt
            instructions = skill.get("instructions")
            if instructions:
                self.config.system_prompt = f"{self.config.system_prompt}\n\n{instructions}"
    
    return tool_configs
```

### 4.3 改动2：修改 SkillTool 构造函数

```python
# skill.py

class SkillTool(BaseAgentTool):
    
    def __init__(
        self,
        skills_info: List[Dict[str, Any]] = None,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None,
    ) -> None:
        """
        初始化 Skill 工具
        
        Args:
            skills_info: Skills 信息列表（从编译阶段传入）
                [{"id": "...", "name": "...", "folder_path": "...", "description": "...", ...}]
            context: 工具上下文
            permission: 工具权限
        """
        super().__init__(context, permission)
        self._skills_info = skills_info or []
        self._loaded_skills: Dict[str, SkillContext] = {}
        self._active_skill: Optional[str] = None
        
        # 预加载 Skills 信息
        for skill in self._skills_info:
            if isinstance(skill, dict):
                name = skill.get("name", skill.get("id", ""))
                self._loaded_skills[name] = SkillContext(
                    skill_name=name,
                    system_prompt=skill.get("instructions", ""),
                    instructions=skill.get("instructions", ""),
                    metadata={
                        "id": skill.get("id"),
                        "name": name,
                        "description": skill.get("description", ""),  # 从数据库获取
                        "folder_path": skill.get("folder_path"),
                    },
                    is_active=False
                )
```

### 4.4 改动3：改进 `get_tool_spec()`

```python
# skill.py

def get_tool_spec(self) -> Dict[str, Any]:
    """获取工具规范 - 包含 available_skills XML"""
    available_skills_xml = self._format_available_skills_xml()
    skill_names = list(self._loaded_skills.keys())
    
    description = f"""Launch a agent and assign a task to it.

Available agents:
{available_skills_xml}

When to use the Agent tool:
  - When the user asks for a specific skill or capability that matches one of the available agents
  - When searching for high-level concepts that need specialized knowledge
  - When you need to combine multiple techniques to solve a complex problem

IMPORTANT: When a skill is relevant, you must invoke this tool IMMEDIATELY as your first action.
NEVER just announce or mention a skill in your text response without actually calling this tool.

Do not invoke a skill if it is already running."""
    
    return {
        "name": "Skill",
        "description": description,
        "parameters": {
            "name": {
                "type": "string",
                "description": "The skill name (no arguments).",
                "required": True,
                "enum": skill_names
            }
        }
    }

def _format_available_skills_xml(self) -> str:
    """生成 available_skills XML"""
    lines = ["<available_skills>"]
    for skill_name, skill_context in self._loaded_skills.items():
        description = skill_context.metadata.get("description", "")
        if description:
            lines.append(f"- {skill_name}: {description}")
        else:
            lines.append(f"- {skill_name}")
    lines.append("</available_skills>")
    return "\n".join(lines)
```

### 4.5 改动4：改进 `execute()`

```python
# skill.py

async def execute(self, name: str, **kwargs) -> Dict[str, Any]:
    """执行 Skill 工具 - 返回完整内容 + folder_path"""
    if not name:
        return {"success": False, "error": "Skill name is required"}
    
    # 检查 Skill 是否正在运行
    if self._active_skill == name:
        return {"success": False, "error": f"Skill '{name}' is already running"}
    
    # 获取 Skill 上下文
    skill_context = self._loaded_skills.get(name)
    if not skill_context:
        return {"success": False, "error": f"Skill '{name}' not found"}
    
    # 标记为活跃
    self._active_skill = name
    
    # 获取 folder_path
    folder_path = skill_context.metadata.get("folder_path", "")
    
    # 如果没有 instructions，尝试从 SKILL.md 加载
    instructions = skill_context.instructions
    if not instructions and folder_path:
        skill_md_path = os.path.join(folder_path, "SKILL.md")
        if os.path.exists(skill_md_path):
            with open(skill_md_path, "r", encoding="utf-8") as f:
                instructions = f.read()
    
    return {
        "success": True,
        "skill_name": name,
        "content": instructions,  # 完整 SKILL.md 内容
        "folder_path": folder_path,  # 关键：提供文件夹路径
        "metadata": {
            "id": skill_context.metadata.get("id"),
            "name": skill_context.metadata.get("name", name),
        }
    }
```

### 4.6 改动5：确认 flow\_compiler.py 传递 description

```python
# flow_compiler.py 第786-804行（确认已实现）

skills = node_data.get("skills", [])  # 只获取 agenticflow.json 中指定的 skills
enriched_skills = []
for skill in skills:
    if isinstance(skill, str):
        skill_dict = {"id": skill, "name": skill}
        if skills_configs and skill in skills_configs:
            skill_config = skills_configs[skill]
            skill_dict["name"] = skill_config.name
            skill_dict["description"] = getattr(skill_config, "description", "")  # 从数据库获取
            # ... 其他字段
```

***

## 五、渐进式披露流程

### 5.1 两级加载系统

| 级别      | 内容                           | Token 消耗     | 加载时机            |
| ------- | ---------------------------- | ------------ | --------------- |
| **第一级** | Metadata（name + description） | \~100 tokens | 始终在 Tool Spec 中 |
| **第二级** | SKILL.md 完整内容 + folder\_path | 完整内容         | Skill 触发时加载     |

### 5.2 嵌套资源读取机制

**核心洞察**：模型本身就有 **Read 工具**，可以直接读取任何文件！

```
Skill 文件夹结构：
canvas-design/
├── SKILL.md                 # 模型调用 Skill 工具获取
├── references/
│   └── design-principles.md  # 模型使用 Read 工具读取
├── scripts/
│   └── generate-palette.py   # 模型使用 Read 工具读取或 RunCommand 执行
└── assets/
    └── templates/            # 模型使用 Read 工具读取
```

**流程**：

1. 模型调用 `Skill(name="canvas-design")` → 获取 SKILL.md 内容 + folder\_path
2. SKILL.md 中包含指引：`参考 ./references/design-principles.md`
3. 模型使用 `Read("{folder_path}/references/design-principles.md")` → 获取资源内容

### 5.3 完整流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    编译阶段                                       │
├─────────────────────────────────────────────────────────────────┤
│  flow_compiler._compile_node()                                   │
│  ├── skills = node_data.get("skills", [])  # 只编译用户选择的     │
│  ├── _load_skills_configs(user_id)  # 从数据库加载 Skills 配置    │
│  ├── 构建 enriched_skills（包含 folder_path、description）        │
│  └── 传递给 SoloAgentConfig.skills                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    初始化阶段                                     │
├─────────────────────────────────────────────────────────────────┤
│  SoloAgent.initialize()                                          │
│  ├── _load_skills(self.config.skills)                            │
│  │   ├── 创建 SkillTool(skills_info=skills)                      │
│  │   └── SkillTool 预加载 Skills 信息                             │
│  └── 注册 Skill 工具                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    第一级：静默态（模型看到 Tool Spec）             │
├─────────────────────────────────────────────────────────────────┤
│  Tool Spec 包含 available_skills XML:                           │
│  <available_skills>                                              │
│  - canvas-design: Create beautiful visual art...                │
│  - pdf: Create and manipulate PDF documents...                  │
│  </available_skills>                                             │
│                                                                  │
│  Token 消耗: ~100 tokens/Skill                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ 模型判断需要调用 Skill
┌─────────────────────────────────────────────────────────────────┐
│                    第二级：展开态（模型调用 Skill 工具）            │
├─────────────────────────────────────────────────────────────────┤
│  模型调用: Skill(name="canvas-design")                           │
│                                                                  │
│  SkillTool 返回:                                                 │
│  {                                                               │
│    "success": true,                                              │
│    "skill_name": "canvas-design",                                │
│    "content": "# canvas-design\n\n完整 SKILL.md 内容...",         │
│    "folder_path": "/path/to/canvas-design"                       │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ 模型根据 SKILL.md 指引按需读取
┌─────────────────────────────────────────────────────────────────┐
│                    嵌套资源读取（模型使用 Read 工具）               │
├─────────────────────────────────────────────────────────────────┤
│  模型根据 SKILL.md 中的指引，使用 Read 工具读取 references/ 文件:   │
│  Read("/path/to/canvas-design/references/design-principles.md")  │
│                                                                  │
│  或执行 scripts/ 中的脚本:                                        │
│  RunCommand("python /path/to/scripts/generate-palette.py")       │
└─────────────────────────────────────────────────────────────────┘
```

***

## 六、执行顺序

### 阶段一：SkillTool 改进（0.5天）

1. 修改构造函数，接收 `skills_info` 参数
2. 预加载 Skills 信息到 `_loaded_skills`
3. 改进 `get_tool_spec()`，生成 `available_skills` XML
4. 改进 `execute()`，返回 `folder_path`

### 阶段二：SoloAgent 改进（0.5天）

1. 修复 `_load_skills()` 方法，正确处理 Dict 类型
2. 将 Skills 信息传递给 SkillTool

### 阶段三：测试验证（0.5天）

1. 创建测试 Skill（SKILL.md + references/）
2. 验证编译阶段正确传递 Skills 信息
3. 验证 SkillTool 正确生成 `available_skills` XML
4. 验证模型能读取嵌套文档

***

## 七、总结

### 核心发现

1. **编译阶段已实现**：`folder_path`、`description` 已在编译时注入到 Agent 配置
2. **每个 Agent 独立编译**：第786行 `skills = node_data.get("skills", [])` 确认每个 Agent 只编译自己的 Skills
3. **问题在初始化阶段**：`_load_skills()` 方法将 Dict 当作 str 处理，丢失信息
4. **不需要新组件**：模型可直接使用 Read 工具读取嵌套资源
5. **不需要安全控制字段**：用户已在画布中为每个 Agent 决定哪些 Skill 可用

### 核心改动

| 改动              | 文件         | 说明                                          |
| --------------- | ---------- | ------------------------------------------- |
| 构造函数注入          | `skill.py` | SkillTool 接收 `skills_info` 参数               |
| 预加载 Skills      | `skill.py` | SkillTool 预加载 Skills 信息                     |
| 生成 XML          | `skill.py` | `get_tool_spec()` 生成 `available_skills` XML |
| 返回 folder\_path | `skill.py` | `execute()` 返回 `folder_path`                |
| 修复方法签名          | `agent.py` | `_load_skills()` 正确处理 Dict 类型               |

### 设计理念

**文件系统即上下文**：

- SKILL.md 作为"目录"和"指引"
- 模型根据指引，使用已有的 Read/RunCommand 工具按需读取/执行资源
- 不需要预扫描、预加载任何资源

**用户控制**：

- Skills 由用户在画布中为每个 Agent 单独选择
- 每个 Agent 只编译自己的 Skills，不会看到其他 Agent 的 Skills
- 每个 Agent 有独立的 `SoloAgentConfig` 和 `SkillTool` 实例
- 不需要 `disable-model-invocation` 和 `allowed-tools`

