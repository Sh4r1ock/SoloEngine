# Trae Skill 调用实现方案分析

## 一、Skill 核心概念

### 1.1 Skill 定义
Skill（技能）是 AI Agent 的可复用能力模块，以 SKILL.md 文件为载体，封装了固定的执行规则、工作流程、输出标准和优化逻辑。Skill 相当于 AI Agent 的"专业技能证书"或"工作手册"，让 AI 能够按照特定规范输出符合要求的成果。

### 1.2 Skill 物理形态
- **文件形式**：SKILL.md 的 Markdown 文件
- **存放位置**：项目根目录下的 `./trae/skills` 路径
- **必需文件**：仅有 SKILL.md 是必需的
- **可选文件**：测试文件、README、脚本、manifest.yaml（用于描述工作流步骤）

### 1.3 Skill 与相关概念的区别

| 概念 | 定位 | 关系 |
|------|------|------|
| Function Calling | LLM 调用工具的基础能力 | 底层基础 |
| MCP | 外部工具调用的开放标准协议 | 扩展外部能力 |
| Skill | AI Agent 的工作方式封装 | 上层应用，可调用 MCP |

**关系总结**：
- Function Calling 是"决策行为"——决定用哪个工具、怎么用
- MCP 是"通信协议"——规定工具的调用、传参、返回值规则
- Skill 是"能力封装"——封装工作流程和规范，可调用 MCP

---

## 二、Skill 调用实现原理

### 2.1 核心调用机制

Skill 的调用本质上是 **System Prompt 注入机制**：

```
用户输入 → LLM 判断是否触发 Skill → 读取 SKILL.md → 注入 System Prompt → 执行任务
```

### 2.2 触发方式

Trae 中 Skill 的触发方式有三种：

1. **技能调用输入框**：在专门的技能输入框中输入描述
2. **指令终端**：通过 `/<skill>` 命令直接调用
3. **聊天面板**：在聊天中描述需求，AI 自动识别

触发判断逻辑：
- **精准关键词匹配**：匹配 SKILL.md 中 YAML Frontmatter 的 name 和 description 字段
- **语义匹配**：LLM 根据用户意图判断需要哪个 Skill
- **自动发现**：AI Agent 根据任务自动发现和加载不同的 Skill

### 2.3 Skill 加载流程

```
1. 用户输入触发词/描述
2. LLM 识别需要调用的 Skill
3. 读取 ./trae/skills/{skill-name}/SKILL.md 文件
4. 解析 YAML Frontmatter 元数据
5. 将 Skill 内容注入到 System Prompt
6. LLM 基于 Skill 规范执行任务
7. 输出符合 Skill 定义的成果
```

---

## 三、SKILL.md 文件格式规范

### 3.1 标准结构

SKILL.md 文件必须包含 YAML Frontmatter（前置元数据），后跟 Markdown 内容：

```markdown
---
name: skill-name
description: 描述此技能的用途及使用场景（触发条件）
---

# Skill 内容正文

## 指令
详细的执行指令、工作流程...

## 示例
使用示例...
```

### 3.2 YAML Frontmatter 必需字段

| 字段 | 说明 |
|------|------|
| name | Skill 名称，用于唯一标识 |
| description | 技能描述/触发条件，用于 LLM 判断是否调用 |

### 3.3 YAML Frontmatter 可选字段

| 字段 | 说明 |
|------|------|
| version | Skill 版本号 |
| author | 作者 |
| tags | 标签列表 |
| triggers | 触发关键词列表 |

### 3.4 Skill 内容结构建议

```markdown
---
name: frontend-design
description: 用于生成高质量前端 UI 界面，擅长 React/Vue 组件开发
version: 1.0.0
author: Anthropic
tags: [frontend, ui, react, vue]
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
- 组件必须可复用
...
```

---

## 四、Skill-Creator 元 Skill

### 4.1 定义
Skill-Creator 是 Anthropic 官方推出的"创造技能的技能"（Meta-Skill），用于自动化创建和迭代 Skill。

**官方地址**：https://github.com/anthropics/skills/tree/main/skills/skill-creator

### 4.2 核心功能
- 自动化生成 Skill 目录结构
- 指导编写 SKILL.md 内容
- 提供测试和迭代框架
- 支持 manifest.yaml 工作流定义

### 4.3 Skill-Creator 生成的目录结构

```
{skill-name}/
├── SKILL.md           # 必需：技能定义文件
├── manifest.yaml      # 可选：工作流定义
├── README.md          # 可选：使用说明
├── test/              # 可选：测试文件
│   └── test_skill.py
└── scripts/           # 可选：自动化脚本
    └── runner.py
```

### 4.4 manifest.yaml 格式（高级 Skill）

```yaml
name: example-skill
version: 1.0.0
description: 示例技能

steps:
  - name: step1
    action: execute_script
    script: scripts/step1.py
    resume_on_block: true

  - name: step2
    action: llm_process
    depends_on: step1
    resume_on_block: true
```

---

## 五、Skill 调用与 MCP 的协同

### 5.1 协作模式

```
User Input
    ↓
Skill（工作流程封装）
    ↓ 调用
MCP（工具服务）
    ↓
External Tools/APIs
```

### 5.2 调用示例

```python
# Skill 中调用 MCP 工具
skills_response = mcp_client.call_tool(
    tool_name="seedance2.0视频生成规范",
    arguments={
        "style": style,
        "scene": scene,
        "duration": duration,
        "resolution": resolution,
        "aspect_ratio": aspect_ratio
    }
)
```

### 5.3 三者协同闭环

```
Plan（任务规划） + Skills（技能复用） + MCP（工具调用）
         ↓
    需求输入 → 成品交付
         ↓
    全自动闭环
```

---

## 六、Skill 调用实现方案设计

### 6.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    Skill System                      │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │ Skill Loader│  │Skill Manager│  │ Skill Cache│ │
│  └─────────────┘  └─────────────┘  └────────────┘ │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐│
│  │           Skill Registry (注册表)               ││
│  │  - name → SKILL.md path                         ││
│  │  - description → trigger keywords               ││
│  │  - version, tags, author                        ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### 6.2 核心组件

#### 6.2.1 Skill Registry（注册表）
维护所有可用 Skill 的元数据索引：
- `name`: Skill 唯一名称
- `path`: SKILL.md 文件路径
- `description`: 描述/触发条件
- `version`: 版本号
- `tags`: 标签

#### 6.2.2 Skill Loader（加载器）
负责 Skill 的读取和解析：
- 读取 `./trae/skills/` 目录
- 解析 YAML Frontmatter
- 验证 SKILL.md 格式
- 缓存已加载的 Skill

#### 6.2.3 Skill Manager（管理器）
负责 Skill 的调用逻辑：
- 接收用户输入
- 匹配最佳 Skill（关键词/语义）
- 注入 System Prompt
- 处理 Skill 执行结果

### 6.3 调用流程实现

```python
class SkillManager:
    def __init__(self, skills_dir="./trae/skills"):
        self.skills_dir = skills_dir
        self.registry = self._load_registry()

    def invoke_skill(self, user_input: str, context: dict) -> dict:
        # 1. 识别需要调用的 Skill
        skill_name = self._match_skill(user_input)

        # 2. 加载 Skill 内容
        skill_content = self._load_skill(skill_name)

        # 3. 构建 System Prompt
        system_prompt = self._build_system_prompt(skill_content, context)

        # 4. 调用 LLM 执行
        response = self.llm.invoke(system_prompt)

        # 5. 返回结果
        return {"response": response, "skill_used": skill_name}

    def _match_skill(self, user_input: str) -> str:
        # 关键词匹配 + 语义匹配
        scores = []
        for skill in self.registry:
            score = self._calculate_match_score(user_input, skill)
            scores.append((score, skill["name"]))
        return max(scores, key=lambda x: x[0])[1]

    def _load_skill(self, skill_name: str) -> str:
        # 读取 SKILL.md 内容
        skill_path = f"{self.skills_dir}/{skill_name}/SKILL.md"
        with open(skill_path, "r", encoding="utf-8") as f:
            return f.read()

    def _build_system_prompt(self, skill_content: str, context: dict) -> str:
        # 将 Skill 内容注入到 System Prompt
        return f"{skill_content}\n\n---\n\nContext: {json.dumps(context)}"
```

---

## 七、Skill 类型分类

### 7.1 编码偏好型 Skill（Encoded Preference）
记录"团队的工作方式"：
- 代码风格规范
- 命名约定
- 提交流范
- 工作流程

### 7.2 工具型 Skill（Tool Skill）
封装具体工具调用能力：
- Excel 读取/生成
- Word 文档处理
- 特定 API 调用

### 7.3 工作流型 Skill（Workflow Skill）
定义复杂多步骤任务：
- 使用 manifest.yaml 定义步骤
- 支持断点续传（resume_on_block）
- 脚本自动化执行

### 7.4 专业领域型 Skill（Domain Skill）
针对特定领域的专业知识：
- 前端设计
- 后端架构
- 数据分析

---

## 八、Skill 系统优势

### 8.1 相比传统 Prompt 的优势

| 特性 | 传统 Prompt | Skill |
|------|-------------|-------|
| 复用性 | 单次使用 | 可重复调用 |
| 可测试性 | 难以测试 | 支持测试框架 |
| 版本控制 | 无 | 支持版本管理 |
| 团队协作 | 各自为战 | 共享资产 |
| 确定性 | 不稳定 | 确定性交付 |

### 8.2 核心价值
- **模块化**：将能力封装为独立模块
- **可复用**：一次定义，多次使用
- **可测试**：支持自动化测试
- **可迭代**：持续优化改进
- **团队共享**：成为团队资产

---

## 九、实施建议

### 9.1 目录结构规范
```
./trae/skills/
├── {skill-name-1}/
│   └── SKILL.md
├── {skill-name-2}/
│   ├── SKILL.md
│   ├── manifest.yaml
│   └── scripts/
└── ...
```

### 9.2 SKILL.md 编写规范
1. name 字段必须唯一
2. description 必须清晰描述触发条件
3. 内容结构建议包含：指令、工作流程、输出标准
4. 使用 Markdown 格式，便于解析

### 9.3 最佳实践
1. **精准描述**：description 要能准确触发 Skill
2. **结构化内容**：使用标题、分层结构
3. **提供示例**：帮助 LLM 理解期望输出
4. **版本管理**：使用 version 字段追踪迭代
5. **测试覆盖**：为复杂 Skill 编写测试

---

## 十、技术总结

Trae Skill 的调用实现本质上是 **System Prompt 动态注入机制**：

1. **触发层**：通过关键词/语义匹配识别 Skill 调用需求
2. **加载层**：读取并解析 SKILL.md 文件
3. **注入层**：将 Skill 内容注入到 LLM 的 System Prompt
4. **执行层**：LLM 基于 Skill 规范执行任务

Skill 作为上层封装，可以协调 MCP 调用外部工具，形成完整的能力体系。相比 Function Calling 的单轮工具调用，Skill 更强调工作流程和输出标准的封装，实现更高层次的 AI Agent 能力复用。

---

## 参考资料

1. Anthropic 官方 Skills 仓库：https://github.com/anthropics/skills
2. Skill-Creator 官方地址：https://github.com/anthropics/skills/tree/main/skills/skill-creator
3. Trae 官方文档和社区实践
4. Claude Code Skills 最佳实践指南