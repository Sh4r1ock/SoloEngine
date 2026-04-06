# SoloEngine 与 Trae Skill 机制对比分析

## 一、概述

本文档对 SoloEngine 现有 Skill 机制与 Trae Skill 机制进行详细对比分析，明确两者的设计差异、实现差异和功能差异，为后续优化提供依据。

---

## 二、核心架构对比

### 2.1 架构层次对比

| 维度 | SoloEngine | Trae |
|------|------------|------|
| **定位** | AI Agent 多智能体系统 | AI IDE 编程辅助工具 |
| **架构风格** | 编译器 + 执行器 + Agent 三层 | System Prompt 注入 |
| **Skill 角色** | 可复用工具包/能力模块 | 工作手册/技能证书 |
| **调用方式** | 作为 Function Tool 调用 | 通过 LLM 语义触发 |

### 2.2 系统架构图

#### SoloEngine 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     AgenticFlow 实例层 (run.py)                  │
│              模型记忆读取/存储、Session 创建与隔离管理              │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Compiler 层 (flow_compiler.py)                 │
│              编译并执行 Flow，协调多 Agent                        │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                     SoloAgent 层 (agent.py)                      │
│            基于 ReActCore 基类，负责组装各类 Plugins               │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                     ReActCore 层 (react_core.py)                 │
│              核心执行引擎，处理 LLM 调用                          │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                     外部接口 (LLM API)                           │
└─────────────────────────────────────────────────────────────────┘

SoloEngine Skill 流程：
1. FlowCompiler 编译节点时加载 Skills 配置
2. SoloAgent.initialize() 调用 _load_skills()
3. Skill 作为 ToolConfig 注册到 ToolkitExecutor
4. ReActCore 通过 ToolExecutor 调用 Skill Tool
5. SkillTool.execute() 执行业务逻辑
```

#### Trae 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Trae IDE (MCP Host)                       │
│                    负责启动 MCP Server 进程                       │
│                  管理标准输入/输出通道                            │
└─────────────────────────────────────────────────────────────────┘

Trae Skill 流程：
1. 用户输入触发词/描述
2. LLM 识别需要调用的 Skill
3. 读取 ./trae/skills/{skill-name}/SKILL.md 文件
4. 解析 YAML Frontmatter 元数据
5. 将 Skill 内容注入到 System Prompt
6. LLM 基于 Skill 规范执行任务
7. 输出符合 Skill 定义的成果
```

---

## 三、Skill 文件格式对比

### 3.1 文件结构对比

| 维度 | SoloEngine | Trae |
|------|------------|------|
| **根目录** | `./skills/` 或 `./data/system/skills/` | `./trae/skills/` |
| **主文件** | SKILL.md | SKILL.md |
| **子目录** | `skills/`, `common/`, `scripts/` | `test/`, `scripts/` |
| **工作流定义** | 通过 instructions 字段 | manifest.yaml |

### 3.2 SKILL.md 格式对比

#### SoloEngine SKILL.md

```markdown
---
name: skill-name
version: 1.0.0
description: 描述此技能的用途及使用场景
author: 作者
tags: [tag1, tag2]
instructions: 技能的具体指令内容
---

# Skill 内容正文

详细的工作流程、示例代码等内容...

## 子技能 (在 skills/ 子目录)

- skill1/SKILL.md
- skill2/SKILL.md
```

#### Trae SKILL.md

```markdown
---
name: skill-name
description: 描述此技能的用途及使用场景（触发条件）
version: 1.0.0
author: Anthropic
tags: [frontend, ui, react, vue]
triggers: [trigger1, trigger2]
---

# Frontend Design Skill

## 指令
你是一个专业的前端 UI 开发工程师...

## 工作流程
1. 需求分析
2. 技术选型
3. 组件设计
4. 代码实现
5. 响应式适配

## 输出标准
- 遵循原子化设计原则
- 使用 Tailwind CSS
...
```

### 3.3 格式差异分析

| 差异点 | SoloEngine | Trae |
|--------|------------|------|
| **触发条件** | 无专门字段 | `description` 作为触发条件 |
| **触发关键词** | 无 | `triggers` 字段 |
| **指令存储** | `instructions` 字段 | Markdown 正文内容 |
| **多技能支持** | 通过 `skills/` 子目录 | 单一 SKILL.md |

---

## 四、Skill 加载机制对比

### 4.1 SoloEngine Skill 加载流程

```python
# 1. FlowCompiler 编译节点时
def _compile_node(self, node, ...):
    skills = node_data.get("skills", [])
    enriched_skills = []
    for skill in skills:
        if isinstance(skill, str):
            skill_dict = {"id": skill, "name": skill}
            if skills_configs and skill in skills_configs:
                skill_config = skills_configs[skill]
                skill_dict["name"] = skill_config.name
                # 加载 folder_path, instructions, tools 等
                enriched_skills.append(skill_dict)

    config = SoloAgentConfig(
        skills=enriched_skills,
        ...
    )

# 2. SoloAgent 初始化时
async def _load_skills(self, skill_names: List[str]) -> List[Dict[str, Any]]:
    tool_configs = []
    for skill_name in skill_names:
        skill_config = await ConfigLoader.load_skill_config(skill_name)
        if skill_config.get("tools"):
            for tool_name in skill_config["tools"]:
                tool_config = ToolRegistry.get_tool_config(tool_name)
                if tool_config:
                    tool_configs.append(tool_config)
        if skill_config.get("system_prompt"):
            self.config.system_prompt = f"{self.config.system_prompt}\n\n{skill_config['system_prompt']}"
    return tool_configs

# 3. SkillTool 执行时
async def execute(self, skill_name: str, action: str = "load", **kwargs) -> Dict[str, Any]:
    if action == "load":
        return await self._load_skill(skill_name)
    elif action == "details":
        return await self._get_skill_details(skill_name)
    elif action == "activate":
        return await self._activate_skill(skill_name)
    elif action == "deactivate":
        return await self._deactivate_skill(skill_name)
```

**SoloEngine 特点**：
- Skill 作为 **Tool** 集成到 ToolkitExecutor
- 通过 `action` 参数控制加载/详情/激活/停用
- 支持渐进式披露（overview → details → activate）
- 将 Skill 的 `system_prompt` 注入到 Agent 的 system prompt

### 4.2 Trae Skill 加载流程

```python
# Trae 的核心机制是 System Prompt 注入
def invoke_skill(user_input: str, context: dict) -> dict:
    # 1. 识别需要调用的 Skill
    skill_name = self._match_skill(user_input)

    # 2. 加载 Skill 内容
    skill_content = self._load_skill(skill_name)

    # 3. 构建 System Prompt
    system_prompt = self._build_system_prompt(skill_content, context)

    # 4. 调用 LLM 执行
    response = self.llm.invoke(system_prompt)

    return {"response": response, "skill_used": skill_name}

def _match_skill(self, user_input: str) -> str:
    # 关键词匹配 + 语义匹配
    scores = []
    for skill in self.registry:
        score = self._calculate_match_score(user_input, skill)
        scores.append((score, skill["name"]))
    return max(scores, key=lambda x: x[0])[1]
```

**Trae 特点**：
- Skill 通过 **语义匹配** 自动触发
- Skill 内容直接 **注入 System Prompt**
- 不存在独立的 Skill 执行器
- LLM 根据 Skill 描述自动决定是否使用

---

## 五、Skill 调用方式对比

### 5.1 触发机制对比

| 维度 | SoloEngine | Trae |
|------|------------|------|
| **触发方式** | 显式调用（通过 Function Calling） | 隐式触发（通过语义匹配） |
| **触发时机** | 预配置在节点中，运行时显式调用 | 用户输入时动态识别 |
| **触发依据** | 节点配置 `skills: ["skill_name"]` | LLM 判断用户意图匹配 |
| **调用命令** | `SkillTool.execute(skill_name, action)` | 自然语言描述 |

### 5.2 执行模式对比

#### SoloEngine 执行模式

```
用户 → Agent.receive() → ReActCore.reply()
    → ToolExecutor.execute(tool_call)
    → SkillTool.execute(skill_name="xxx", action="activate")
    → 激活技能上下文
```

**特点**：
- Skill 是 **可调用的工具**
- 需要显式 `action` 参数
- 支持 **激活/停用** 状态管理
- 渐进式披露：load → details → activate

#### Trae 执行模式

```
用户输入 → LLM 语义匹配 Skill → 自动加载 SKILL.md
    → System Prompt 注入
    → LLM 基于 Skill 规范执行
```

**特点**：
- Skill 是 **隐式的上下文**
- 无需显式调用
- 自动注入 System Prompt
- 语义驱动的自动发现

---

## 六、Skill 功能特性对比

### 6.1 核心功能对比

| 功能 | SoloEngine | Trae |
|------|------------|------|
| **文件解析** | SkillParser 解析 YAML Frontmatter | 直接读取 SKILL.md |
| **多技能管理** | SkillsManager 包管理 | Skill 注册表 |
| **版本控制** | `version` 字段 | `version` 字段 |
| **标签系统** | `tags` 字段 | `tags` + `triggers` |
| **工具封装** | 支持 `tools` 配置 | 无内置工具配置 |
| **权限控制** | ToolPermission | 无 |
| **渐进式披露** | load → details → activate → deactivate | 无 |
| **上下文注入** | system_prompt 追加 | System Prompt 整体替换 |
| **子技能目录** | `skills/` 子目录 | 无 |
| **脚本支持** | `scripts/` 目录 | `scripts/` + `manifest.yaml` |
| **工作流定义** | instructions 字段 | manifest.yaml |

### 6.2 Skill 类型分类

#### SoloEngine Skill 类型

| 类型 | 说明 | 位置 |
|------|------|------|
| **包级别 Skill** | 整个包的元数据 | `{package}/SKILL.md` |
| **子技能** | 包内的独立技能 | `{package}/skills/{name}/SKILL.md` |
| **通用文件** | 模板、参考资料 | `{package}/common/` |
| **脚本文件** | 自动化脚本 | `{package}/scripts/` |

#### Trae Skill 类型

| 类型 | 说明 |
|------|------|
| **编码偏好型** | 记录团队工作方式 |
| **工具型** | 封装具体工具调用 |
| **工作流型** | 定义复杂多步骤任务 |
| **专业领域型** | 针对特定领域的专业知识 |

---

## 七、目录结构对比

### 7.1 SoloEngine 目录结构

```
./data/system/skills/
├── algorithmic-art/
│   ├── SKILL.md           # 包级别 Skill
│   ├── LICENSE.txt
│   ├── templates/
│   │   └── viewer.html
│   └── ...
├── brand-guidelines/
│   ├── SKILL.md
│   └── ...
├── canvas-design/
│   ├── SKILL.md
│   ├── canvas-fonts/
│   │   ├── *.ttf
│   │   └── *.txt
│   └── ...
├── doc-coauthoring/
│   └── SKILL.md
├── docx/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── office/
│   │   │   ├── helpers/
│   │   │   ├── schemas/
│   │   │   ├── validators/
│   │   │   ├── pack.py
│   │   │   ├── soffice.py
│   │   │   ├── unpack.py
│   │   │   └── validate.py
│   │   ├── accept_changes.py
│   │   └── comment.py
│   └── ...
└── ...

# 用户自定义 Skills
./skills/
├── {user-skill-package-1}/
│   ├── SKILL.md
│   ├── skills/
│   │   └── {subskill}/
│   │       └── SKILL.md
│   └── common/
│       ├── templates/
│       └── references/
└── ...
```

### 7.2 Trae 目录结构

```
./trae/skills/
├── {skill-name-1}/
│   └── SKILL.md           # 必需
├── {skill-name-2}/
│   ├── SKILL.md
│   ├── manifest.yaml      # 可选：工作流定义
│   ├── README.md          # 可选
│   ├── test/              # 可选
│   │   └── test_skill.py
│   └── scripts/           # 可选
│       └── runner.py
└── ...
```

---

## 八、关键代码路径对比

### 8.1 SoloEngine 关键代码

| 模块 | 文件路径 | 职责 |
|------|----------|------|
| **Skill 数据模型** | `backend/app/models/skill.py` | SkillMetadata, SkillFile, SkillsPackage 数据类 |
| **Skill 解析器** | `backend/app/utils/skill_parser.py` | SkillParser 解析 SKILL.md |
| **Skill 管理器** | `backend/app/core/skills_manager.py` | SkillsManager 包管理 |
| **Skill 工具** | `backend/SoloAgent/plugins/tools/agent/skill.py` | SkillTool 执行技能 |
| **Agent 集成** | `backend/SoloAgent/solo_agent/agent.py` | SoloAgent._load_skills() |
| **Flow 编译器** | `backend/SoloAgent/solo_agent/compiler/flow_compiler.py` | 编译时加载 Skills |
| **API 端点** | `backend/app/api/v1/skills.py` | REST API |

### 8.2 Trae 关键概念

| 组件 | 职责 |
|------|------|
| **Skill Registry** | 维护 Skill 元数据索引 |
| **Skill Loader** | 读取并解析 SKILL.md |
| **Skill Manager** | 匹配、注入、处理 |
| **Skill-Creator** | 元 Skill，用于创建新 Skill |

---

## 九、优劣势分析

### 9.1 SoloEngine 优势

| 优势 | 说明 |
|------|------|
| **显式控制** | Skill 作为工具显式调用，可精确控制 |
| **渐进式披露** | 支持 load → details → activate → deactivate 生命周期 |
| **多工具集成** | 内置 tools 配置，可组合多个工具 |
| **权限控制** | ToolPermission 支持工具权限管理 |
| **子技能目录** | 支持 `skills/` 子目录组织复杂技能 |
| **包管理** | SkillsManager 支持导入导出包 |
| **多智能体** | 与 AgenticFlow 多智能体架构深度集成 |

### 9.2 SoloEngine 劣势

| 劣势 | 说明 |
|------|------|
| **触发机制** | 依赖预配置，无法根据用户输入自动发现 |
| **语义匹配** | 缺乏基于 description 的自动匹配 |
| **触发关键词** | 无 `triggers` 字段辅助识别 |
| **工作流定义** | 缺乏 manifest.yaml 声明式工作流支持 |
| **Skill-Creator** | 无元 Skill 自动创建机制 |

### 9.3 Trae 优势

| 优势 | 说明 |
|------|------|
| **自动发现** | LLM 语义匹配自动触发 Skill |
| **触发关键词** | triggers 字段辅助精准匹配 |
| **工作流声明** | manifest.yaml 支持声明式工作流 |
| **简单直接** | System Prompt 注入，机制简单 |
| **Skill-Creator** | 元 Skill 支持自动化创建 |

### 9.4 Trae 劣势

| 劣势 | 说明 |
|------|------|
| **无工具封装** | Skill 仅是 Prompt 封装，无工具集成 |
| **无权限控制** | 无法限制 Skill 可调用的工具 |
| **隐式执行** | 无法显式控制 Skill 激活/停用 |
| **状态管理** | 无 Skill 激活状态概念 |
| **IDE 强耦合** | 依赖 Trae IDE 环境 |

---

## 十、融合建议

### 10.1 保留 SoloEngine 既有能力

1. **ToolExecutor 集成**：保持 Skill 作为工具的架构
2. **渐进式披露**：保留 load → details → activate → deactivate 机制
3. **多工具配置**：保持 `tools` 字段支持
4. **权限控制**：保留 ToolPermission 机制
5. **包管理**：保留 SkillsManager 的导入导出

### 10.2 引入 Trae 优秀特性

1. **语义匹配**：在 `skills` 配置中增加 `auto_match` 字段
2. **触发关键词**：增加 `triggers` 字段
3. **工作流声明**：增加 `manifest.yaml` 支持
4. **Skill-Creator**：创建元 Skill 自动创建其他 Skill

### 10.3 融合后的调用流程

```
用户输入 → 语义匹配（新增） → 自动发现匹配的 Skill
    ↓
预配置的显式调用（保留） OR 自动注入（新增）
    ↓
SkillTool.execute() → 激活技能上下文
    ↓
ToolExecutor 执行 Skill 定义的工作流程
    ↓
可选：调用 MCP 工具（集成）
```

---

## 十一、总结

| 维度 | SoloEngine | Trae |
|------|------------|------|
| **设计理念** | 显式工具调用 + 多智能体 | 隐式 Prompt 注入 |
| **触发方式** | 预配置 + 显式调用 | 语义匹配 + 自动发现 |
| **执行机制** | ToolExecutor 执行 SkillTool | System Prompt 注入 |
| **复杂度** | 高（多组件协同） | 低（单一机制） |
| **可控性** | 高（显式状态管理） | 低（隐式自动） |
| **灵活性** | 高（工具集成） | 中（Prompt 模板） |

两者代表了 Skill 系统的两种不同设计哲学：
- **SoloEngine**：将 Skill 视为**可执行工具**，强调显式控制和状态管理
- **Trae**：将 Skill 视为**上下文增强**，强调自动发现和简洁性

融合两者优势可以获得更完善的 Skill 系统实现。

---

## 参考资料

1. SoloEngine 源码：
   - `backend/app/models/skill.py`
   - `backend/app/utils/skill_parser.py`
   - `backend/app/core/skills_manager.py`
   - `backend/SoloAgent/plugins/tools/agent/skill.py`
   - `backend/SoloAgent/solo_agent/agent.py`
   - `backend/SoloAgent/solo_agent/compiler/flow_compiler.py`

2. Trae Skill 文档：
   - [Trae Skill 实现方案分析](../trae_skill_implementation_analysis.md)
   - Anthropic 官方 Skills 仓库：https://github.com/anthropics/skills
   - Skill-Creator：https://github.com/anthropics/skills/tree/main/skills/skill-creator