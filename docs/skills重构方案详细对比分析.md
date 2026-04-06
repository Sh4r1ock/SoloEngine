# Skills 重构方案详细对比分析

## 一、背景与问题

### 1.1 当前问题

SoloEngine 现有 Skills 机制存在以下核心问题：

1. **模型不可见**：模型无法看到有哪些 Skills 可用
2. **无 list_skills 工具**：没有工具让模型查询可用 Skills 列表
3. **上下文未注入**：Skills 信息未注入到模型上下文中
4. **配置与运行时分离**：Skills 配置仅存在于数据库/节点配置中，运行时无法动态发现

### 1.2 现有实现分析

通过代码审查发现，现有 SkillTool 实现：

```python
# backend/SoloAgent/plugins/tools/agent/skill.py

class SkillTool(BaseAgentTool):
    def __init__(self, ...):
        self._loaded_skills: Dict[str, SkillContext] = {}
        self._active_skill: Optional[str] = None
    
    async def execute(self, skill_name: str, action: str = "load", **kwargs):
        if action == "load":
            return await self._load_skill(skill_name)
        elif action == "details":
            return await self._get_skill_details(skill_name)
        elif action == "activate":
            return await self._activate_skill(skill_name)
        elif action == "deactivate":
            return await self._deactivate_skill(skill_name)
    
    def get_tool_spec(self) -> Dict[str, Any]:
        return {
            "name": "Skill",
            "description": "在主对话中执行技能（Skills）。技能提供专门的上下文和权限控制...",
            "parameters": {...}
        }
    
    def get_loaded_skills(self) -> List[str]:
        return list(self._loaded_skills.keys())
```

**关键缺陷**：
- `get_tool_spec()` 中的 description 是静态的，不包含可用 Skills 列表
- `get_loaded_skills()` 方法存在但未被模型调用
- 缺少 `list_skills` 工具让模型发现可用 Skills

---

## 二、五种重构方案详细设计

### 方案一：Claude Code 风格 - Available Skills Tool 方案

#### 2.1.1 来源与验证

**来源**：Claude Code 官方实现

**网络搜索验证**：
- Claude Code 实现了一个 skill 工具，工具描述中包含 `<available_skills/>` 标签
- 标签内包含所有可加载的 skill 名称和描述信息
- 模型根据这些信息判断何时以及如何调用该工具进行 skill 加载
- 采用渐进式披露（Progressive Disclosure）机制

**关键发现**：
> "Claude Code 实现了一个 skill 工具，工具的描述定义如下，其中 `<available_skills/>` 标签包含了可以被加载的 skill 名称和描述信息，模型会根据这些信息判断何时以及如何调用该工具进行 skill 加载"

#### 2.1.2 核心机制

**两层加载机制**：

| 层级 | 内容 | Token 消耗 | 加载时机 |
|------|------|-----------|----------|
| 第一层 | YAML Frontmatter（name + description） | ~100 tokens/Skill | 始终加载 |
| 第二层 | SKILL.md Body（完整指令） | 数千 tokens | 按需加载 |

**Tool Description 格式**：

```xml
<available_skills>
- canvas-design: Create beautiful visual art in .png and .pdf documents using design philosophy
- frontend-design: Create distinctive, production-grade frontend interfaces with high design quality
- algorithmic-art: Creating algorithmic art using p5.js with seeded randomness
- theme-factory: Toolkit for styling artifacts with a theme
- web-artifacts-builder: Suite of tools for creating elaborate, multi-component HTML artifacts
- webapp-testing: Toolkit for interacting with and testing local web applications
- skill-creator: MANDATORY tool for creating SKILLs
</available_skills>
```

#### 2.1.3 实现设计

```python
class SkillTool(BaseAgentTool):
    def __init__(self, skills_registry: SkillsRegistry, ...):
        self._registry = skills_registry
    
    def get_tool_spec(self) -> Dict[str, Any]:
        # 动态生成 available_skills 列表
        available_skills = self._generate_available_skills_xml()
        
        return {
            "name": "Skill",
            "description": f"""Execute a skill within the main conversation.

When a skill is relevant, invoke this tool IMMEDIATELY as your first action.

<available_skills>
{available_skills}
</available_skills>

How to use skills:
- Invoke skills using this tool with the skill name only (no arguments)
- When you invoke a skill, you will see the "{name}" skill is loading
- The skill's prompt will expand and provide detailed instructions

Important:
- When a skill is relevant, you MUST invoke this tool IMMEDIATELY
- NEVER just announce or mention a skill in your text response without actually calling this tool
- Only use skills listed in <available_skills> below
- Do not invoke a skill if it is already running
""",
            "parameters": {
                "name": {
                    "type": "string",
                    "description": "The skill name (no arguments). E.g. 'pdf' or 'xlsx'",
                    "enum": self._get_skill_names()
                }
            }
        }
    
    def _generate_available_skills_xml(self) -> str:
        lines = []
        for skill in self._registry.get_all_skills():
            lines.append(f"- {skill.name}: {skill.description}")
        return "\n".join(lines)
```

#### 2.1.4 编译时处理

```python
class FlowCompiler:
    def _compile_skills_tool(self, skill_ids: List[str]) -> Dict[str, Any]:
        """编译时生成 Skills Tool"""
        # 1. 根据 skill_ids 从数据库/文件系统加载完整配置
        skills_configs = self._load_skills_configs(skill_ids)
        
        # 2. 构建 Skills Registry
        registry = SkillsRegistry(skills_configs)
        
        # 3. 生成包含 available_skills 的 Tool Spec
        skill_tool = SkillTool(registry)
        return skill_tool.get_tool_spec()
```

---

### 方案二：Trae 风格 - Semantic Matching + System Prompt 方案

#### 2.2.1 来源与验证

**来源**：字节跳动 Trae IDE

**网络搜索验证**：
- Trae 通过 Plan + Skills + MCP 三者联动实现全自动闭环
- Skills 信息通过 System Prompt 注入
- 支持语义匹配自动发现 Skill
- description 字段作为触发条件

**关键发现**：
> "Trae 的核心能力——通过 Plan（任务规划）、Skills（技能复用）、MCP（工具调用协议）三者联动，搭建一套从需求输入到成品交付的全自动闭环"

#### 2.2.2 核心机制

**System Prompt 注入**：

```markdown
## 可用 Skills

模型可以根据用户需求自动选择合适的 Skill：

- **canvas-design**: Create beautiful visual art in .png and .pdf documents
- **frontend-design**: Create distinctive, production-grade frontend interfaces
- **algorithmic-art**: Creating algorithmic art using p5.js
- **theme-factory**: Toolkit for styling artifacts with a theme
- **web-artifacts-builder**: Suite of tools for creating elaborate HTML artifacts
- **webapp-testing**: Toolkit for interacting with and testing local web applications
- **skill-creator**: MANDATORY tool for creating SKILLs

使用 list_skills 工具查看所有 Skills，使用 load_skill 工具加载需要的 Skill。
```

**语义匹配机制**：

```python
class SemanticSkillMatcher:
    def __init__(self, skills_registry):
        self._registry = skills_registry
        self._embedding_model = load_embedding_model()
    
    def match_skill(self, user_input: str) -> Optional[Skill]:
        """根据用户输入语义匹配最佳 Skill"""
        input_embedding = self._embedding_model.encode(user_input)
        
        best_skill = None
        best_score = 0.0
        
        for skill in self._registry.get_all_skills():
            # 计算与 description 的语义相似度
            desc_embedding = self._embedding_model.encode(skill.description)
            score = cosine_similarity(input_embedding, desc_embedding)
            
            # 检查 triggers 关键词匹配
            if skill.triggers:
                for trigger in skill.triggers:
                    if trigger.lower() in user_input.lower():
                        score += 0.2  # 关键词匹配加分
            
            if score > best_score and score > THRESHOLD:
                best_score = score
                best_skill = skill
        
        return best_skill
```

#### 2.2.3 实现设计

```python
class FlowCompiler:
    def _build_system_prompt(self, base_prompt: str, skill_ids: List[str]) -> str:
        """编译时构建包含 Skills 信息的 System Prompt"""
        skills_configs = self._load_skills_configs(skill_ids)
        
        skills_section = "\n\n## 可用 Skills\n\n"
        skills_section += "模型可以根据用户需求自动选择合适的 Skill：\n\n"
        
        for skill in skills_configs:
            skills_section += f"- **{skill.name}**: {skill.description}\n"
        
        skills_section += "\n使用 list_skills 工具查看所有 Skills，使用 load_skill 工具加载需要的 Skill。"
        
        return base_prompt + skills_section
```

---

### 方案三：OpenClaw 风格 - Marketplace + Find-Skills 方案

#### 2.3.1 来源与验证

**来源**：OpenClaw 开源项目

**网络搜索验证**：
- OpenClaw 有 ClawHub Marketplace，包含 11,600+ Skills
- 内置 find-skills 元 Skill，用于发现生态中的宝藏
- 支持 trigger.keywords 和 trigger.description 进行匹配
- 采用渐进式披露策略

**关键发现**：
> "ClawHub 上有 11,600 多个 skills，手动找太慢了。find-skills 是一个'元 skill'——它的作用是帮助发现其他 Skills"

> "通过 trigger.description 和 trigger.keywords，LLM 会在 function calling 阶段决定是否调用。描述写得越清晰准确，触发越可靠"

#### 2.3.2 核心机制

**Skill Manifest 格式**：

```yaml
name: daily-report
version: 1.0.0
description: 生成每日工作报告

trigger:
  description: "当用户需要生成日报、周报或工作总结时触发"
  keywords:
    - 日报
    - 周报
    - 工作总结
    - report

parameters:
  date_range:
    type: string
    description: 报告日期范围
  format:
    type: string
    enum: [markdown, html, pdf]
    default: markdown

entry: scripts/generate_report.py
```

**Find-Skills 元 Skill**：

```python
class FindSkillsTool(BaseTool):
    """元 Skill - 发现其他 Skills"""
    
    def get_tool_spec(self):
        return {
            "name": "find-skills",
            "description": "在技能市场搜索并发现新的 Skills",
            "parameters": {
                "query": {"type": "string", "description": "搜索关键词"},
                "category": {"type": "string", "description": "技能类别"},
                "tags": {"type": "array", "items": {"type": "string"}}
            }
        }
    
    async def execute(self, query: str, category: str = None, tags: List[str] = None):
        # 搜索 ClawHub Marketplace
        results = await self._marketplace.search(query, category, tags)
        return self._format_results(results)
```

#### 2.3.3 实现设计

```python
class SkillsIndexTool(BaseTool):
    """Skills 索引工具"""
    
    def __init__(self, skills_registry, marketplace_client=None):
        self._registry = skills_registry
        self._marketplace = marketplace_client
    
    def get_tool_spec(self):
        return {
            "name": "skills_index",
            "description": """获取所有已安装 Skills 的索引，支持搜索和筛选。

内置动作：
- list: 列出所有已安装的 Skills
- search: 搜索匹配的 Skills（本地 + Marketplace）
- install: 从 Marketplace 安装新 Skill
""",
            "parameters": {
                "action": {
                    "type": "string",
                    "enum": ["list", "search", "install"]
                },
                "query": {"type": "string"},
                "category": {"type": "string"}
            }
        }
    
    async def execute(self, action: str, query: str = None, category: str = None):
        if action == "list":
            return self._list_installed_skills()
        elif action == "search":
            return await self._search_skills(query, category)
        elif action == "install":
            return await self._install_skill(query)
```

---

### 方案四：Cursor 风格 - Rules + Progressive Disclosure 方案

#### 2.4.1 来源与验证

**来源**：Cursor IDE

**网络搜索验证**：
- Cursor 使用 .cursorrules 文件和 Project Rules
- 本质上是 System Prompt 注入
- 支持按文件类型设置不同规则
- Rules 作为"工作习惯约束"

**关键发现**：
> "Cursor rules（就是 .cursorrules 文件），本质上是给 AI 助手加一层'工作习惯约束'，让它在帮你写代码/改代码时更符合团队规范"

> "Cursor 提供了 Rules for AI、Project Rules、.cursorrules 三种配置 AI 行为提示词的方式"

#### 2.4.2 核心机制

**Project Rules 结构**：

```
.cursor/rules/
├── general.mdc          # 通用规则
├── python.mdc           # Python 文件规则
├── typescript.mdc       # TypeScript 文件规则
└── frontend.mdc         # 前端文件规则
```

**渐进式披露**：

```python
class ProgressiveDisclosureManager:
    """渐进式披露管理器"""
    
    def __init__(self, skills_registry):
        self._registry = skills_registry
        self._disclosure_levels = {
            "overview": self._get_overview,
            "details": self._get_details,
            "execute": self._get_full_context
        }
    
    def disclose(self, skill_name: str, level: str = "overview"):
        """按级别披露 Skill 信息"""
        skill = self._registry.get_skill(skill_name)
        return self._disclosure_levels[level](skill)
    
    def _get_overview(self, skill):
        """第一层：概述（~100 tokens）"""
        return f"**{skill.name}**: {skill.description}"
    
    def _get_details(self, skill):
        """第二层：详细信息"""
        return f"""## {skill.name}

### 描述
{skill.description}

### 使用场景
{skill.use_cases}

### 参数
{skill.parameters}
"""
    
    def _get_full_context(self, skill):
        """第三层：完整上下文"""
        return skill.full_content
```

#### 2.4.3 实现设计

```python
class FlowCompiler:
    def _build_composite_system_prompt(self, skill_ids: List[str]) -> str:
        """构建复合 System Prompt"""
        sections = []
        
        for skill_id in skill_ids:
            skill = self._load_skill_config(skill_id)
            # 第一层披露：仅注入概述
            sections.append(self._skill_to_overview(skill))
        
        return "\n\n---\n\n".join(sections)
    
    def _skill_to_overview(self, skill):
        """将 Skill 转换为概述段落"""
        return f"""## {skill.name}

### 触发条件
{skill.description}

### 可用操作
- load: 加载技能详情
- activate: 激活技能上下文
"""
```

---

### 方案五：混合架构 - Tool + Semantic + 两层注入方案

#### 2.5.1 设计理念

融合 Claude Code（Tool 注册）+ Trae（语义匹配）+ 渐进式披露机制。

#### 2.5.2 核心机制

**三层架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                    第一层：Tool Registry                      │
│  通过 list_skills 工具暴露所有 Skills 信息（Claude Code 风格）  │
│  Token 消耗：~100 tokens/Skill                               │
└─────────────────────────────────────────────────────────────┘
                              ↓ 模型调用 load_skill
┌─────────────────────────────────────────────────────────────┐
│                    第二层：System Prompt 注入                  │
│  将 Skill 的 YAML Frontmatter 注入到 System Prompt           │
│  Token 消耗：~200-500 tokens/Skill                           │
└─────────────────────────────────────────────────────────────┘
                              ↓ 模型需要完整指令
┌─────────────────────────────────────────────────────────────┐
│                    第三层：完整 Skill Body                     │
│  按需加载 SKILL.md 的完整内容                                 │
│  Token 消耗：数千 tokens/Skill                               │
└─────────────────────────────────────────────────────────────┘
```

#### 2.5.3 实现设计

```python
class HybridSkillsSystem:
    """混合架构 Skills 系统"""
    
    def __init__(self, skills_dir: str, db_configs: Dict):
        self._registry = self._build_registry(skills_dir, db_configs)
        self._semantic_matcher = SemanticSkillMatcher(self._registry)
    
    def compile_tools(self, skill_ids: List[str]) -> List[Dict]:
        """编译时生成工具列表"""
        tools = []
        
        # 1. 生成 list_skills 工具
        tools.append(self._compile_list_skills_tool(skill_ids))
        
        # 2. 生成 load_skill 工具
        tools.append(self._compile_load_skill_tool())
        
        return tools
    
    def _compile_list_skills_tool(self, skill_ids: List[str]) -> Dict:
        """生成 list_skills 工具（Claude Code 风格）"""
        skills_info = []
        for skill_id in skill_ids:
            skill = self._registry.get_skill(skill_id)
            skills_info.append({
                "name": skill.name,
                "description": skill.description,
                "tags": skill.tags
            })
        
        return {
            "name": "list_skills",
            "description": f"""列出所有可用的 Skills。

<available_skills>
{self._format_skills_xml(skills_info)}
</available_skills>

当用户询问可用技能或需要选择技能时调用此工具。
使用 load_skill 工具加载需要的 Skill。
""",
            "parameters": {
                "filter": {
                    "type": "string",
                    "description": "可选的过滤条件（按名称或标签筛选）"
                }
            }
        }
    
    def _compile_load_skill_tool(self) -> Dict:
        """生成 load_skill 工具（两层加载）"""
        return {
            "name": "load_skill",
            "description": """加载指定 Skill 到当前上下文。

两级加载机制：
- 第一级：加载 YAML frontmatter（始终加载，~100 tokens）
- 第二级：加载完整 SKILL.md body（按需加载）

当用户需要使用特定 Skill 执行任务时调用。
""",
            "parameters": {
                "skill_name": {
                    "type": "string",
                    "description": "Skill 名称"
                },
                "level": {
                    "type": "string",
                    "enum": ["overview", "full"],
                    "default": "overview",
                    "description": "加载级别：overview 仅加载概述，full 加载完整内容"
                }
            }
        }
    
    def build_system_prompt(self, base_prompt: str, skill_ids: List[str]) -> str:
        """构建包含 Skills 信息的 System Prompt（Trae 风格）"""
        skills_intro = self._generate_skills_intro(skill_ids)
        return f"{base_prompt}\n\n{skills_intro}"
    
    def _generate_skills_intro(self, skill_ids: List[str]) -> str:
        """生成 Skills 简介"""
        lines = ["## 可用 Skills", 
                 "模型可以根据用户需求自动选择合适的 Skill：", ""]
        
        for skill_id in skill_ids:
            skill = self._registry.get_skill(skill_id)
            lines.append(f"- **{skill.name}**：{skill.description}")
        
        lines.append("\n使用 list_skills 工具查看所有 Skills，"
                    "使用 load_skill 工具加载需要的 Skill。")
        
        return "\n".join(lines)
    
    async def auto_match_skill(self, user_input: str) -> Optional[Skill]:
        """自动语义匹配（Trae 风格）"""
        return self._semantic_matcher.match_skill(user_input)
```

---

## 三、现有方案分析

### 3.1 现有实现架构

```
┌─────────────────────────────────────────────────────────────┐
│                    FlowCompiler 编译层                       │
│  从节点配置读取 skill_ids，传递给 SoloAgent                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    SoloAgent 初始化层                        │
│  _load_skills() 加载 Skills 配置，注册 ToolConfigs           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    SkillTool 执行层                          │
│  execute(skill_name, action) 执行 load/details/activate     │
│  get_loaded_skills() 返回已加载列表（但模型不可见）            │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 现有方案缺陷

| 缺陷 | 说明 | 影响 |
|------|------|------|
| **无 list_skills** | 模型无法查询可用 Skills | 模型不知道有哪些 Skill 可用 |
| **Tool Spec 静态** | description 不包含 Skills 列表 | 模型无法自动发现 |
| **无语义匹配** | 缺少自动触发机制 | 需要用户显式指定 |
| **无 triggers 字段** | SKILL.md 无触发关键词 | 无法精准匹配 |
| **上下文未注入** | Skills 信息未注入 System Prompt | 模型无法感知 |

### 3.3 现有方案优势

| 优势 | 说明 |
|------|------|
| **渐进式披露** | 支持 load → details → activate → deactivate |
| **权限控制** | ToolPermission 支持工具权限管理 |
| **多工具集成** | 支持 tools 配置，可组合多个工具 |
| **状态管理** | 支持激活/停用状态 |

---

## 四、十维度详细对比

### 4.1 评分标准定义

| 维度 | 定义 | 评分标准 |
|------|------|----------|
| **稳定性** | 系统崩溃、数据丢失的风险程度 | 5=无风险，1=高风险 |
| **鲁棒性** | 异常输入、边界条件的处理能力 | 5=完美处理，1=易崩溃 |
| **Skills 效果** | 最终用户获得的技能执行质量 | 5=高质量，1=低质量 |
| **模型可见性** | 模型能否正确识别和使用可用 Skills | 5=完全可见，1=不可见 |
| **自动发现能力** | 无需显式调用，系统自动匹配 Skill 的能力 | 5=完全自动，1=完全手动 |
| **渐进式披露** | 按需加载、控制 Token 消耗的能力 | 5=完美控制，1=一次性加载 |
| **多 Skill 组合** | 同时激活多个 Skills 的支持程度 | 5=完美支持，1=不支持 |
| **Token 效率** | 初始化和运行时的 Token 消耗 | 5=高效，1=低效 |
| **可扩展性** | 新增 Skill 类型、功能的便捷程度 | 5=极易扩展，1=难以扩展 |
| **错误处理** | Skill 执行失败时的恢复能力 | 5=完美恢复，1=无恢复 |

### 4.2 详细评分对比

| 维度 | 现有方案 | 方案一<br>Claude Code | 方案二<br>Trae | 方案三<br>OpenClaw | 方案四<br>Cursor | 方案五<br>混合架构 |
|------|----------|----------------------|---------------|-------------------|------------------|-------------------|
| **稳定性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **鲁棒性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Skills 效果** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **模型可见性** | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **自动发现能力** | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **渐进式披露** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **多 Skill 组合** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Token 效率** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **可扩展性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **错误处理** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **总分** | **30** | **43** | **39** | **36** | **36** | **48** |

### 4.3 各维度详细分析

#### 4.3.1 稳定性

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐⭐⭐⭐ | 已有完善的错误处理，但模型不可见导致 Skills 无法使用 |
| Claude Code | ⭐⭐⭐⭐⭐ | Tool Registry 机制成熟，两层加载确保稳定性 |
| Trae | ⭐⭐⭐⭐ | 语义匹配可能误判，但 System Prompt 注入稳定 |
| OpenClaw | ⭐⭐⭐ | 依赖外部 Marketplace，网络问题可能影响稳定性 |
| Cursor | ⭐⭐⭐⭐ | Rules 文件机制简单稳定 |
| 混合架构 | ⭐⭐⭐⭐⭐ | 结合多种机制，互为备份，稳定性最高 |

#### 4.3.2 鲁棒性

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐⭐⭐⭐ | 有完善的异常处理和状态管理 |
| Claude Code | ⭐⭐⭐⭐⭐ | 两层加载机制，即使部分失败也能降级运行 |
| Trae | ⭐⭐⭐ | 语义匹配可能受用户输入干扰 |
| OpenClaw | ⭐⭐⭐ | 外部依赖多，异常情况复杂 |
| Cursor | ⭐⭐⭐⭐ | 简单的文件机制，鲁棒性较好 |
| 混合架构 | ⭐⭐⭐⭐⭐ | 多重机制互为补充，鲁棒性最高 |

#### 4.3.3 Skills 效果

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐⭐ | 模型无法发现 Skills，效果受限 |
| Claude Code | ⭐⭐⭐⭐ | Tool Registry 确保模型可见，效果较好 |
| Trae | ⭐⭐⭐⭐⭐ | 语义匹配 + System Prompt 注入，效果最佳 |
| OpenClaw | ⭐⭐⭐ | Marketplace 丰富，但触发机制依赖描述质量 |
| Cursor | ⭐⭐⭐ | Rules 机制简单，效果一般 |
| 混合架构 | ⭐⭐⭐⭐⭐ | 结合多种机制，效果最佳 |

#### 4.3.4 模型可见性

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐ | **核心问题**：模型完全看不到可用 Skills |
| Claude Code | ⭐⭐⭐⭐⭐ | `<available_skills/>` 标签直接注入 Tool Description |
| Trae | ⭐⭐⭐⭐ | System Prompt 注入，模型可见 |
| OpenClaw | ⭐⭐⭐⭐ | skills_index 工具提供可见性 |
| Cursor | ⭐⭐⭐ | Rules 文件需要模型读取，可见性一般 |
| 混合架构 | ⭐⭐⭐⭐⭐ | Tool + System Prompt 双重注入，可见性最高 |

#### 4.3.5 自动发现能力

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐ | 无自动发现机制，需要显式配置 |
| Claude Code | ⭐⭐⭐ | 模型根据 available_skills 自行判断，半自动 |
| Trae | ⭐⭐⭐⭐⭐ | 语义匹配 + triggers 关键词，自动发现能力最强 |
| OpenClaw | ⭐⭐⭐⭐⭐ | find-skills 元 Skill + Marketplace，自动发现能力最强 |
| Cursor | ⭐⭐ | 无自动发现，需要手动配置 Rules |
| 混合架构 | ⭐⭐⭐⭐ | 语义匹配 + Tool Registry，自动发现能力较强 |

#### 4.3.6 渐进式披露

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐⭐⭐⭐⭐ | load → details → activate → deactivate 四级披露 |
| Claude Code | ⭐⭐⭐⭐⭐ | 两层加载（Frontmatter + Body），Token 效率高 |
| Trae | ⭐⭐ | System Prompt 一次性注入，无渐进式披露 |
| OpenClaw | ⭐⭐⭐ | 有渐进式披露，但实现较简单 |
| Cursor | ⭐⭐⭐⭐⭐ | Rules 可按文件类型分级，渐进式披露完善 |
| 混合架构 | ⭐⭐⭐⭐⭐ | 三层架构，渐进式披露最完善 |

#### 4.3.7 多 Skill 组合

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐⭐⭐ | 支持多 Skill 配置，但激活状态单一 |
| Claude Code | ⭐⭐⭐ | 一次只能激活一个 Skill |
| Trae | ⭐⭐⭐⭐⭐ | System Prompt 可同时包含多个 Skill 信息 |
| OpenClaw | ⭐⭐⭐⭐ | workflow.yaml 支持多 Skill 组合 |
| Cursor | ⭐⭐⭐⭐⭐ | 多个 Rules 文件可同时生效 |
| 混合架构 | ⭐⭐⭐⭐⭐ | 支持多 Skill 同时激活和组合 |

#### 4.3.8 Token 效率

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐⭐⭐⭐ | 渐进式披露，Token 效率较高 |
| Claude Code | ⭐⭐⭐⭐⭐ | 两层加载，初始仅 ~100 tokens/Skill |
| Trae | ⭐⭐⭐ | System Prompt 一次性注入，Token 消耗较大 |
| OpenClaw | ⭐⭐⭐ | 需要加载 Marketplace 信息，Token 消耗中等 |
| Cursor | ⭐⭐⭐⭐ | Rules 文件按需加载，Token 效率较高 |
| 混合架构 | ⭐⭐⭐⭐ | 三层架构，Token 效率较高 |

#### 4.3.9 可扩展性

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐⭐⭐⭐ | 支持自定义 Skill，扩展性较好 |
| Claude Code | ⭐⭐⭐⭐ | skill-creator 元 Skill 支持自动创建 |
| Trae | ⭐⭐⭐⭐ | SKILL.md 格式简单，易于扩展 |
| OpenClaw | ⭐⭐⭐⭐⭐ | Marketplace 生态，扩展性最强 |
| Cursor | ⭐⭐⭐ | Rules 文件格式固定，扩展性一般 |
| 混合架构 | ⭐⭐⭐⭐⭐ | 支持多种扩展方式，扩展性最强 |

#### 4.3.10 错误处理

| 方案 | 评分 | 分析 |
|------|------|------|
| 现有方案 | ⭐⭐⭐⭐ | 有完善的错误处理和状态回滚 |
| Claude Code | ⭐⭐⭐⭐⭐ | 两层加载，失败可降级 |
| Trae | ⭐⭐⭐ | 语义匹配失败无降级机制 |
| OpenClaw | ⭐⭐⭐ | 外部依赖多，错误处理复杂 |
| Cursor | ⭐⭐⭐⭐ | 简单文件机制，错误处理简单 |
| 混合架构 | ⭐⭐⭐⭐⭐ | 多重机制互为备份，错误处理最完善 |

---

## 五、方案推荐

### 5.1 综合推荐

**推荐方案：方案五（混合架构）**

**理由**：
1. **总分最高**：48 分，领先第二名 5 分
2. **模型可见性满分**：Tool + System Prompt 双重注入
3. **渐进式披露满分**：三层架构，Token 效率高
4. **稳定性满分**：多重机制互为备份
5. **兼容现有方案**：可保留现有渐进式披露机制

### 5.2 实施路径

```
Phase 1: 添加 list_skills 工具
├── 在编译时生成 available_skills 列表
├── 将 Skills 信息注入 Tool Description
└── 模型可通过 list_skills 查询可用 Skills

Phase 2: 添加语义匹配
├── 增加 triggers 字段到 SKILL.md
├── 实现语义匹配器
└── 支持自动发现 Skill

Phase 3: 优化 System Prompt 注入
├── 将 Skills 概述注入 System Prompt
├── 支持多 Skill 组合
└── 优化 Token 消耗

Phase 4: 集成 Marketplace（可选）
├── 支持 find-skills 元 Skill
├── 支持在线安装 Skill
└── 构建生态
```

### 5.3 关键改动点

| 改动点 | 文件 | 说明 |
|--------|------|------|
| Skills Registry | 新建 `skills_registry.py` | 统一管理 Skills 元数据 |
| list_skills Tool | 修改 `skill.py` | 添加 list_skills 工具 |
| Tool Spec 动态生成 | 修改 `skill.py` | 在 description 中注入 available_skills |
| System Prompt 注入 | 修改 `flow_compiler.py` | 编译时注入 Skills 概述 |
| triggers 字段 | 修改 SKILL.md 格式 | 添加触发关键词 |

---

## 六、参考资料

### 6.1 网络搜索来源

1. Claude Code Skills 机制：渐进式披露、available_skills 列表
2. Trae Skills 机制：语义匹配、System Prompt 注入
3. OpenClaw Skills 机制：Marketplace、find-skills 元 Skill
4. Cursor Rules 机制：.cursorrules、Project Rules
5. Agent Skills 对比分析：Skill vs Workflow vs Agent

### 6.2 代码来源

1. `backend/SoloAgent/plugins/tools/agent/skill.py`：现有 SkillTool 实现
2. `backend/SoloAgent/solo_agent/compiler/flow_compiler.py`：Flow 编译器
3. `backend/SoloAgent/solo_agent/agent.py`：SoloAgent 初始化
4. `backend/app/utils/skill_parser.py`：SKILL.md 解析器
5. `data/system/skills/skill-creator/SKILL.md`：Skill-Creator 参考