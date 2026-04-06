# SoloEngine Skills 调用机制重构方案

## 一、背景与问题

### 1.1 当前问题

SoloEngine 现有 Skills 机制存在以下核心问题：

1. **模型不可见**：模型无法看到有哪些 Skills 可用
2. **无 available_skills 列表**：Skill 工具的 description 是静态的，不包含可用 Skills 信息
3. **无法自动触发**：模型不知道何时应该调用 Skill

### 1.2 现有实现分析

**编译流程**（`flow_compiler.py`）：

```python
def _compile_node(self, node, ...):
    # 1. 从节点配置获取 skill_ids
    skills = node_data.get("skills", [])  # 只有 skill_id 列表
    
    # 2. 从数据库加载完整配置
    skills_configs = self._load_skills_configs(user_id)
    
    # 3. 拼装为 enriched_skills
    for skill in skills:
        if isinstance(skill, str):
            skill_dict = {"id": skill, "name": skill}
            if skills_configs and skill in skills_configs:
                skill_config = skills_configs[skill]
                skill_dict["name"] = skill_config.name
                skill_dict["folder_path"] = ...
                skill_dict["instructions"] = ...
            enriched_skills.append(skill_dict)
    
    # 4. 传递给 SoloAgentConfig
    config = SoloAgentConfig(
        skills=enriched_skills,
        ...
    )
```

**SkillTool 实现**（`skill.py`）：

```python
def get_tool_spec(self) -> Dict[str, Any]:
    return {
        "name": "Skill",
        "description": "在主对话中执行技能（Skills）。技能提供专门的上下文和权限控制...",
        # 问题：description 是静态的，不包含可用 Skills 列表
        "parameters": {...}
    }
```

---

## 二、Claude Code Skills 调用机制详解

### 2.1 核心机制

通过网络搜索验证，Claude Code 的 Skills 调用机制包含以下关键要素：

#### 2.1.1 available_skills 标签

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

**关键发现**：
> "Claude Code 实现了一个 skill 工具，工具的描述定义如下，其中 `<available_skills/>` 标签包含了可以被加载的 skill 名称和描述信息，模型会根据这些信息判断何时以及如何调用该工具进行 skill 加载"

#### 2.1.2 阻塞式调用要求

```
- when a skill is relevant, invoke this tool IMMEDIATELY as your first action
- NEVER just announce or mention a skill in your text response without actually calling this tool
- this is a blocking requirement
```

**关键发现**：
> "如果 Claude 判断某个 skill 相关，它必须立刻调用，不能先说'我来帮你用 xxx skill'然后再调用。为什么这么设计？防止 Claude '光说不练'。"

#### 2.1.3 渐进式披露

| 层级 | 内容 | Token 消耗 | 加载时机 |
|------|------|-----------|----------|
| Level 1 | 元数据（name + description） | ~100 tokens/Skill | 始终加载 |
| Level 2 | SKILL.md Body（完整指令） | 数千 tokens | 按需加载 |

**关键发现**：
> "Claude Code 团队在内部设计中反复强调 'progressive disclosure'，意思不是让模型一次性看到所有信息，而是先获得索引和导航，再按需拉取细节"

#### 2.1.4 description 作为触发器

**关键发现**：
> "Description 不是描述，而是触发器。Claude 在启动时扫描 Descriptions 来决定何时使用 Skill。如果 Description 模糊或被动，Skill 会保持休眠。"

---

## 三、重构方案设计

### 3.1 设计原则

1. **agenticflow.json 只存 skill_id**：保持现有数据结构不变
2. **编译时获取完整信息**：在 FlowCompiler 中从数据库加载完整 Skills 配置
3. **动态生成 Tool Spec**：Skill 工具的 description 动态包含 available_skills 列表
4. **阻塞式调用**：明确要求模型立即调用，不能先说后做

### 3.2 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     agenticflow.json                             │
│  { "skills": ["skill-id-1", "skill-id-2", ...] }                │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                     FlowCompiler 编译层                          │
│  1. _load_skills_configs(user_id) 从数据库加载完整配置            │
│  2. 构建 SkillsRegistry                                          │
│  3. 动态生成 Skill 工具的 Tool Spec（包含 available_skills）      │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│                     SoloAgent 运行时                             │
│  1. 接收包含 available_skills 的 Tool Spec                       │
│  2. 模型根据 description 判断是否调用 Skill                       │
│  3. 调用 Skill 工具时返回完整 SKILL.md 内容                       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 核心改动

#### 3.3.1 新增 SkillsRegistry 类

```python
# backend/SoloAgent/skills/registry.py

from dataclasses import dataclass
from typing import Dict, List, Any, Optional
import os

@dataclass
class SkillInfo:
    """Skill 信息数据类"""
    id: str
    name: str
    description: str
    folder_path: Optional[str] = None
    version: str = "1.0.0"
    author: str = ""
    tags: List[str] = None
    
    def __post_init__(self):
        if self.tags is None:
            self.tags = []
    
    def get_full_content(self) -> str:
        """获取完整 SKILL.md 内容"""
        if not self.folder_path:
            return f"# {self.name}\n\n{self.description}"
        
        skill_md_path = os.path.join(self.folder_path, "SKILL.md")
        if os.path.exists(skill_md_path):
            with open(skill_md_path, "r", encoding="utf-8") as f:
                return f.read()
        
        return f"# {self.name}\n\n{self.description}"


class SkillsRegistry:
    """Skills 注册表"""
    
    def __init__(self):
        self._skills: Dict[str, SkillInfo] = {}
    
    def register(self, skill_id: str, skill_info: SkillInfo):
        """注册 Skill"""
        self._skills[skill_id] = skill_info
    
    def get_skill(self, skill_id: str) -> Optional[SkillInfo]:
        """获取 Skill 信息"""
        return self._skills.get(skill_id)
    
    def get_all_skills(self) -> List[SkillInfo]:
        """获取所有 Skill 信息"""
        return list(self._skills.values())
    
    def get_skill_by_name(self, name: str) -> Optional[SkillInfo]:
        """根据名称获取 Skill"""
        for skill in self._skills.values():
            if skill.name == name:
                return skill
        return None
    
    def format_available_skills_xml(self) -> str:
        """生成 available_skills XML 格式"""
        lines = []
        for skill in self._skills.values():
            lines.append(f"- {skill.name}: {skill.description}")
        return "\n".join(lines)
    
    def get_skill_names(self) -> List[str]:
        """获取所有 Skill 名称"""
        return [skill.name for skill in self._skills.values()]
```

#### 3.3.2 修改 SkillTool

```python
# backend/SoloAgent/plugins/tools/agent/skill.py

class SkillTool(BaseAgentTool):
    """Skill 工具 - 基于 Claude Code 风格实现"""
    
    def __init__(
        self,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None,
        skills_registry: Optional[SkillsRegistry] = None
    ) -> None:
        super().__init__(context, permission)
        self._registry = skills_registry
    
    def get_tool_spec(self) -> Dict[str, Any]:
        """动态生成 Tool Spec，包含 available_skills 列表"""
        if not self._registry or not self._registry.get_all_skills():
            return self._get_empty_tool_spec()
        
        available_skills_xml = self._registry.format_available_skills_xml()
        skill_names = self._registry.get_skill_names()
        
        return {
            "name": "Skill",
            "description": f"""Execute a skill within the main conversation.

When a skill is relevant, invoke this tool IMMEDIATELY as your first action.
NEVER just announce or mention a skill in your text response without actually calling this tool.
This is a blocking requirement.

<available_skills>
{available_skills_xml}
</available_skills>

How to use skills:
- Invoke skills using this tool with the skill name only (no arguments)
- When you invoke a skill, you will see the skill's prompt expand
- The skill will provide detailed instructions for the task

Important:
- When a skill is relevant, you MUST invoke this tool IMMEDIATELY
- NEVER just announce or mention a skill in your text response without actually calling this tool
- Only use skills listed in <available_skills> above
- Do not invoke a skill if it is already running
- Use the fully qualified name if provided (e.g., "ms-office-suite:pdf" instead of just "pdf")
""",
            "parameters": {
                "name": {
                    "type": "string",
                    "description": "The skill name (no arguments). E.g. 'canvas-design' or 'frontend-design'",
                    "enum": skill_names
                }
            }
        }
    
    def _get_empty_tool_spec(self) -> Dict[str, Any]:
        """返回空的 Tool Spec（无可用 Skills 时）"""
        return {
            "name": "Skill",
            "description": "No skills are currently available.",
            "parameters": {
                "name": {
                    "type": "string",
                    "description": "The skill name"
                }
            }
        }
    
    async def execute(self, name: str, **kwargs) -> Dict[str, Any]:
        """执行 Skill 工具"""
        if not self._registry:
            return self.create_error_response(
                message="Skills registry not initialized",
                error_code="REGISTRY_NOT_INITIALIZED"
            )
        
        skill = self._registry.get_skill_by_name(name)
        if not skill:
            return self.create_error_response(
                message=f"Skill '{name}' not found",
                error_code="SKILL_NOT_FOUND",
                details={"available_skills": self._registry.get_skill_names()}
            )
        
        full_content = skill.get_full_content()
        
        return self.create_success_response(
            content=full_content,
            metadata={
                "skill_id": skill.id,
                "skill_name": skill.name,
                "description": skill.description
            }
        )
```

#### 3.3.3 修改 FlowCompiler

```python
# backend/SoloAgent/solo_agent/compiler/flow_compiler.py

class AgenticFlowCompiler:
    
    def _compile_node(
        self,
        node: Dict[str, Any],
        user_id: str,
        ...
        skills_configs: Dict[str, Any] = None,
        ...
    ) -> SoloAgent:
        """编译单个节点为 Agent"""
        
        # ... 现有代码 ...
        
        # 构建 SkillsRegistry
        skills = node_data.get("skills", [])
        skills_registry = self._build_skills_registry(skills, skills_configs)
        
        # 传递给 SoloAgentConfig
        config = SoloAgentConfig(
            name=node_data.get("name", "Agent"),
            ...
            skills_registry=skills_registry,  # 新增：传递 Registry
            ...
        )
        
        return SoloAgent(config)
    
    def _build_skills_registry(
        self,
        skill_ids: List[str],
        skills_configs: Dict[str, Any]
    ) -> SkillsRegistry:
        """构建 SkillsRegistry"""
        from ..skills.registry import SkillsRegistry, SkillInfo
        
        registry = SkillsRegistry()
        
        for skill_id in skill_ids:
            if isinstance(skill_id, str):
                if skills_configs and skill_id in skills_configs:
                    config = skills_configs[skill_id]
                    
                    # 获取 folder_path
                    rel_folder_path = getattr(config, "folder_path", None)
                    if rel_folder_path:
                        from app.core.data_paths import DataPaths
                        folder_path = DataPaths.to_absolute_path(rel_folder_path)
                    else:
                        folder_path = None
                    
                    # 从 SKILL.md 解析 name 和 description
                    name, description = self._parse_skill_metadata(folder_path)
                    if not name:
                        name = config.name
                    if not description:
                        description = getattr(config, "instructions", "")[:200] if hasattr(config, "instructions") else ""
                    
                    skill_info = SkillInfo(
                        id=skill_id,
                        name=name,
                        description=description,
                        folder_path=folder_path,
                        version=getattr(config, "version", "1.0.0"),
                        author=getattr(config, "author", ""),
                        tags=getattr(config, "tags", [])
                    )
                    registry.register(skill_id, skill_info)
        
        return registry
    
    def _parse_skill_metadata(self, folder_path: str) -> tuple:
        """从 SKILL.md 解析 name 和 description"""
        if not folder_path:
            return None, None
        
        skill_md_path = os.path.join(folder_path, "SKILL.md")
        if not os.path.exists(skill_md_path):
            return None, None
        
        try:
            with open(skill_md_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            # 解析 YAML Frontmatter
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 2:
                    frontmatter = parts[1].strip()
                    name = None
                    description = None
                    
                    for line in frontmatter.split("\n"):
                        if ":" in line:
                            key, value = line.split(":", 1)
                            key = key.strip().lower()
                            value = value.strip()
                            
                            if key == "name":
                                name = value
                            elif key == "description":
                                description = value
                    
                    return name, description
        except Exception as e:
            logger.warning(f"Failed to parse skill metadata: {e}")
        
        return None, None
```

#### 3.3.4 修改 SoloAgentConfig

```python
# backend/SoloAgent/config.py

@dataclass
class SoloAgentConfig:
    name: str = "Agent"
    ...
    skills: List[Dict[str, Any]] = field(default_factory=list)  # 保留兼容
    skills_registry: Optional[Any] = None  # 新增：SkillsRegistry
    ...
```

#### 3.3.5 修改 SoloAgent

```python
# backend/SoloAgent/agent.py

class SoloAgent:
    
    async def initialize(self):
        """初始化 Agent"""
        # ... 现有代码 ...
        
        # 注册 Skill 工具（使用 SkillsRegistry）
        if self.config.skills_registry:
            skill_tool = SkillTool(skills_registry=self.config.skills_registry)
            self._tool_executor.register_tool(skill_tool.get_tool_spec(), skill_tool.execute)
```

---

## 四、数据流详解

### 4.1 编译时数据流

```
1. 用户保存 agenticflow.json
   {
     "nodes": [{
       "data": {
         "skills": ["skill-id-1", "skill-id-2"]
       }
     }]
   }
                    ↓
2. FlowCompiler.compile() 被调用
                    ↓
3. _load_skills_configs(user_id) 从数据库加载
   {
     "skill-id-1": SkillConfig(
       id="skill-id-1",
       name="canvas-design",
       folder_path="data/system/skills/canvas-design",
       ...
     ),
     "skill-id-2": SkillConfig(...)
   }
                    ↓
4. _build_skills_registry() 构建 Registry
   SkillsRegistry {
     _skills: {
       "skill-id-1": SkillInfo(
         id="skill-id-1",
         name="canvas-design",
         description="Create beautiful visual art...",
         folder_path="/absolute/path/to/canvas-design"
       ),
       ...
     }
   }
                    ↓
5. 生成 Skill Tool Spec
   {
     "name": "Skill",
     "description": "...<available_skills>
- canvas-design: Create beautiful visual art...
- frontend-design: Create distinctive frontend...
</available_skills>...",
     "parameters": {
       "name": {"enum": ["canvas-design", "frontend-design"]}
     }
   }
                    ↓
6. SoloAgent 接收 skills_registry 和 Tool Spec
```

### 4.2 运行时数据流

```
1. 用户输入："帮我创建一个海报"
                    ↓
2. LLM 接收 System Prompt + Tools
   Tools 中包含 Skill 工具，description 中有 available_skills 列表
                    ↓
3. LLM 判断：用户需求匹配 "canvas-design" Skill
                    ↓
4. LLM 立即调用 Skill 工具（阻塞式要求）
   tool_calls: [{"name": "Skill", "args": {"name": "canvas-design"}}]
                    ↓
5. SkillTool.execute(name="canvas-design")
                    ↓
6. SkillsRegistry.get_skill_by_name("canvas-design")
                    ↓
7. SkillInfo.get_full_content() 读取 SKILL.md
                    ↓
8. 返回完整 SKILL.md 内容给 LLM
                    ↓
9. LLM 基于 Skill 指令执行任务
```

---

## 五、关键设计决策

### 5.1 为什么选择 Claude Code 风格？

| 对比项 | Claude Code 风格 | 其他方案 |
|--------|-----------------|----------|
| **模型可见性** | ✅ 通过 available_skills 直接可见 | ⚠️ 需要额外机制 |
| **实现复杂度** | ✅ 简单，只需修改 Tool Spec | ⚠️ 需要额外组件 |
| **Token 效率** | ✅ 仅 ~100 tokens/Skill | ⚠️ 可能更高 |
| **触发准确性** | ✅ description 作为触发器 | ⚠️ 可能需要语义匹配 |

### 5.2 为什么在编译时构建 Registry？

1. **数据隔离**：每个 AgenticFlow 实例有独立的 Skills 配置
2. **性能优化**：避免运行时重复查询数据库
3. **缓存友好**：CompiledFlow 有缓存机制，Registry 随之缓存

### 5.3 为什么保留现有 skills 字段？

1. **向后兼容**：现有配置不中断
2. **渐进迁移**：可以逐步迁移到 skills_registry

---

## 六、实施步骤

### Phase 1：新增 SkillsRegistry

1. 创建 `backend/SoloAgent/skills/registry.py`
2. 实现 SkillInfo 和 SkillsRegistry 类
3. 添加单元测试

### Phase 2：修改 SkillTool

1. 修改 `backend/SoloAgent/plugins/tools/agent/skill.py`
2. 动态生成 Tool Spec
3. 使用 SkillsRegistry 获取 Skill 内容

### Phase 3：修改 FlowCompiler

1. 修改 `backend/SoloAgent/solo_agent/compiler/flow_compiler.py`
2. 添加 `_build_skills_registry()` 方法
3. 添加 `_parse_skill_metadata()` 方法

### Phase 4：修改 SoloAgent

1. 修改 `backend/SoloAgent/config.py` 添加 skills_registry 字段
2. 修改 `backend/SoloAgent/agent.py` 使用 skills_registry

### Phase 5：测试验证

1. 单元测试
2. 集成测试
3. 端到端测试

---

## 七、预期效果

### 7.1 模型视角

**修改前**：
```
Tool: Skill
Description: 在主对话中执行技能（Skills）。技能提供专门的上下文和权限控制...
Parameters: skill_name (string), action (string)
```

模型不知道有哪些 Skills 可用。

**修改后**：
```
Tool: Skill
Description: Execute a skill within the main conversation.
When a skill is relevant, invoke this tool IMMEDIATELY as your first action.

<available_skills>
- canvas-design: Create beautiful visual art in .png and .pdf documents
- frontend-design: Create distinctive, production-grade frontend interfaces
- algorithmic-art: Creating algorithmic art using p5.js
</available_skills>

Parameters: name (enum: ["canvas-design", "frontend-design", "algorithmic-art"])
```

模型可以清楚看到所有可用 Skills 及其描述。

### 7.2 调用流程

```
用户: "帮我设计一个海报"

模型思考: 用户需求匹配 "canvas-design" Skill
模型调用: Skill(name="canvas-design")
工具返回: canvas-design 的完整 SKILL.md 内容
模型执行: 基于 Skill 指令生成海报
```

---

## 八、参考资料

### 8.1 网络搜索来源（30+ 次）

1. Claude Code skill tool available_skills XML tag format
2. Claude Code skill invoke mechanism blocking requirement
3. Claude Code skill progressive disclosure two-level loading
4. Claude Code skill description trigger matching
5. Claude Code skill tool parameters name description
6. Claude Code skill SKILL.md format frontmatter
7. Claude Code skill system prompt injection
8. Claude Code skill three-level loading metadata body files
9. Claude Code skill tool when relevant IMMEDIATELY invoke
10. Claude Code skill tool return content expand prompt
... (共 30+ 次搜索)

### 8.2 关键发现总结

| 发现 | 来源 |
|------|------|
| available_skills 标签格式 | Claude Code 系统提示词拆解 |
| 阻塞式调用要求 | Claude Code 系统提示词拆解 |
| 渐进式披露机制 | Claude Code 工程实践 |
| description 作为触发器 | Claude Code Skills 最佳实践 |
| 两层加载机制 | Claude Skills 构建指南 |