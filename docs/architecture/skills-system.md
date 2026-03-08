# Skills 包系统架构文档

## 1. 模块概述

### 1.1 作用

Skills 包系统是 SoloEngine 的可扩展技能管理模块，提供领域专业知识的封装、管理和复用能力。

### 1.2 定位

- **知识封装**：将领域专业知识封装为可复用的技能包
- **提示词管理**：提供结构化的提示词模板和指令
- **工具集成**：支持与 MCP 工具和其他工具的集成

### 1.3 核心功能

| 功能 | 描述 |
|------|------|
| 包管理 | 创建、导入、导出、删除技能包 |
| 文件管理 | 技能包内的文件和目录管理 |
| 激活控制 | 启用/停用技能包 |
| 提示词生成 | 基于模板生成上下文提示词 |
| 系统技能 | 预置的系统级技能包 |

---

## 2. 设计理念

### 2.1 技能包结构

每个 Skills 包是一个独立的文件夹，包含标准化的结构：

```
my-skill/
├── SKILL.md           # 技能包元数据和主指令（必需）
├── skills/            # 子技能目录
│   ├── skill1.md      # 子技能定义
│   └── skill2.md      # 子技能定义
├── common/            # 公共资源
│   ├── templates/     # 模板文件
│   └── examples/      # 示例文件
└── tools/             # 工具脚本（可选）
```

### 2.2 SKILL.md 格式

使用 YAML Frontmatter 格式定义元数据：

```markdown
---
name: pdf
version: 1.0.0
description: PDF 文档处理技能包
author: system
tags:
  - document
  - pdf
  - processing
---

# PDF 文档处理技能

## 概述
本技能包提供 PDF 文档的读取、分析和处理能力。

## 使用指南
1. 使用 `pdf_extract` 提取文本内容
2. 使用 `pdf_merge` 合并多个 PDF

## 注意事项
- 支持 PDF 1.4 及以上版本
- 加密 PDF 需要先解密
```

### 2.3 技能包类型

| 类型 | 标识 | 描述 | 存储位置 |
|------|------|------|---------|
| 系统技能 | `author: system` | 预置技能，只读 | `data/system_skills/` |
| 用户技能 | `author: 用户名` | 用户创建，可编辑 | `data/skills/{user_id}/` |

---

## 3. 实现方式

### 3.1 目录结构

```
data/
├── system_skills/           # 系统技能包目录
│   ├── pdf/                # PDF 处理
│   ├── docx/               # Word 处理
│   ├── xlsx/               # Excel 处理
│   ├── pptx/               # PowerPoint 处理
│   └── ...
│
└── skills/                  # 用户技能包目录
    └── {user_id}/          # 按用户隔离
        ├── my-skill-1/
        └── my-skill-2/
```

### 3.2 数据模型

```python
class SkillsPackageModel(Base):
    __tablename__ = "skills_packages"
    
    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), nullable=True)  # 系统技能为 None
    name = Column(String(255), nullable=False)
    pkg_version = Column(String(50), default="1.0.0")
    description = Column(Text)
    author = Column(String(255))  # "system" 表示系统技能
    tags = Column(JSON, default=[])
    instructions = Column(Text)   # SKILL.md 内容
    folder_path = Column(String(500))
    is_active = Column(Boolean, default=True)
    is_public = Column(Boolean, default=False)
    version = Column(Integer, default=1)  # 乐观锁
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
```

### 3.3 权限控制

| 操作 | 系统技能 | 用户技能 |
|------|---------|---------|
| 查看 | ✅ 所有用户 | ✅ 创建者 |
| 编辑 | ❌ 禁止 | ✅ 创建者 |
| 删除 | ❌ 禁止 | ✅ 创建者 |
| 激活/停用 | ✅ 所有用户 | ✅ 创建者 |

---

## 4. 组件和库

### 4.1 核心依赖

| 依赖 | 用途 |
|------|------|
| `fastapi` | API 框架 |
| `sqlalchemy` | ORM |
| `pydantic` | 数据验证 |
| `yaml` | Frontmatter 解析 |
| `zipfile` | 导入导出 |

### 4.2 文件操作

```python
def build_file_tree(folder_path: str, parent_key: str = "") -> List[Dict]:
    """递归构建文件树"""
    result = []
    for item in sorted(os.listdir(folder_path)):
        if item.startswith('.'):
            continue
        item_path = os.path.join(folder_path, item)
        is_dir = os.path.isdir(item_path)
        node = {
            "key": f"{parent_key}/{item}" if parent_key else item,
            "title": item,
            "isLeaf": not is_dir,
        }
        if is_dir:
            node["children"] = build_file_tree(item_path, node["key"])
        result.append(node)
    return result

def parse_skill_md(skill_md_path: str) -> Dict[str, Any]:
    """解析 SKILL.md 文件"""
    result = {
        "name": "",
        "version": "1.0.0",
        "description": "",
        "author": "",
        "tags": [],
        "instructions": ""
    }
    
    with open(skill_md_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            frontmatter = yaml.safe_load(parts[1])
            result.update(frontmatter)
            result["instructions"] = parts[2].strip()
    
    return result
```

---

## 5. API 端点

### 5.1 包管理 API

**基础路径**: `/api/v1/skills`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/packages` | 获取所有可见的技能包 |
| POST | `/packages` | 创建新技能包 |
| GET | `/packages/{id}` | 获取技能包详情 |
| PUT | `/packages/{id}` | 更新技能包（带乐观锁） |
| DELETE | `/packages/{id}` | 删除技能包 |
| POST | `/import` | 导入技能包（ZIP） |
| GET | `/packages/{id}/export` | 导出技能包 |
| POST | `/search` | 搜索技能包 |
| POST | `/packages/{id}/activate` | 激活技能包 |
| POST | `/packages/{id}/deactivate` | 停用技能包 |

### 5.2 文件管理 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/packages/{id}/files` | 获取文件树 |
| GET | `/packages/{id}/files/content` | 获取文件内容 |
| POST | `/packages/{id}/files/save` | 保存文件 |
| POST | `/packages/{id}/files/create` | 创建文件/文件夹 |
| POST | `/packages/{id}/files/delete` | 删除文件/文件夹 |

### 5.3 技能内容 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/packages/{id}/skills/{name}` | 获取子技能内容 |
| POST | `/prompt` | 生成提示词 |

---

## 6. 使用示例

### 6.1 创建技能包

```bash
curl -X POST http://localhost:8990/api/v1/skills/packages \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-review",
    "description": "代码审查技能包",
    "author": "developer",
    "tags": ["code", "review", "quality"],
    "pkg_version": "1.0.0"
  }'
```

**响应**:
```json
{
  "code": 200,
  "message": "Skills package created",
  "data": {
    "id": "uuid-string",
    "name": "code-review",
    "pkg_version": "1.0.0",
    "folder_path": "/path/to/skills/user-id/code-review"
  }
}
```

### 6.2 导入技能包

```bash
curl -X POST http://localhost:8990/api/v1/skills/import \
  -H "Authorization: Bearer {token}" \
  -F "file=@my-skill.zip"
```

### 6.3 获取文件树

```bash
curl -X GET "http://localhost:8990/api/v1/skills/packages/{id}/files" \
  -H "Authorization: Bearer {token}"
```

**响应**:
```json
{
  "code": 200,
  "message": "File tree retrieved",
  "data": {
    "package_id": "uuid",
    "files": [
      {
        "key": "SKILL.md",
        "title": "SKILL.md",
        "isLeaf": true
      },
      {
        "key": "skills",
        "title": "skills",
        "isLeaf": false,
        "children": [
          {
            "key": "skills/review.md",
            "title": "review.md",
            "isLeaf": true
          }
        ]
      }
    ]
  }
}
```

### 6.4 生成提示词

```bash
curl -X POST http://localhost:8990/api/v1/skills/prompt \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "package_id": "uuid",
    "context": {
      "language": "Python",
      "framework": "FastAPI"
    }
  }'
```

---

## 7. 系统技能列表

### 7.1 文档处理

| 技能包 | 描述 |
|--------|------|
| `pdf` | PDF 文档处理（提取、合并、分析） |
| `docx` | Word 文档处理 |
| `xlsx` | Excel 电子表格处理 |
| `pptx` | PowerPoint 演示文稿处理 |

### 7.2 开发工具

| 技能包 | 描述 |
|--------|------|
| `code-review` | 代码审查和质量分析 |
| `api-design` | API 设计和文档生成 |
| `database-design` | 数据库设计和优化 |
| `git-workflow` | Git 工作流和版本控制 |
| `docker-deployment` | Docker 容器部署 |
| `python-best-practices` | Python 最佳实践 |

### 7.3 测试和安全

| 技能包 | 描述 |
|--------|------|
| `testing-assistant` | 测试用例生成和执行 |
| `security-audit` | 安全审计和漏洞检测 |
| `webapp-testing` | Web 应用测试 |

### 7.4 创意和设计

| 技能包 | 描述 |
|--------|------|
| `frontend-design` | 前端界面设计 |
| `algorithmic-art` | 算法艺术生成 |
| `brand-guidelines` | 品牌指南创建 |

### 7.5 其他

| 技能包 | 描述 |
|--------|------|
| `technical-writing` | 技术文档写作 |
| `data-analysis` | 数据分析和可视化 |
| `skill-creator` | 技能包创建助手 |
| `mcp-builder` | MCP 服务器构建 |

---

## 8. 安全考虑

### 8.1 路径遍历防护

所有文件操作都进行路径安全检查：

```python
def validate_path(folder_path: str, file_path: str) -> str:
    safe_path = os.path.normpath(file_path)
    if safe_path.startswith("..") or safe_path.startswith("/"):
        raise HTTPException(400, "Invalid file path")
    
    full_path = os.path.normpath(os.path.join(folder_path, safe_path))
    if not full_path.startswith(os.path.normpath(folder_path)):
        raise HTTPException(403, "Access denied: path traversal detected")
    
    return full_path
```

### 8.2 文件大小限制

- 导入文件最大：50MB
- 仅允许 ZIP 格式导入

### 8.3 权限隔离

- 用户技能按 `user_id` 隔离
- 系统技能只读，不可修改删除

---

## 9. 前端集成

### 9.1 SkillsManager 组件

前端提供 `SkillsManager` 组件用于技能包管理：

```typescript
interface SkillsPackage {
  id: string;
  name: string;
  pkg_version: string;
  description: string;
  author: string;
  tags: string[];
  is_active: boolean;
  is_system: boolean;
  folder_path: string;
}
```

### 9.2 状态管理

```typescript
// skillsStore.ts
interface SkillsState {
  packages: SkillsPackage[];
  currentPackage: SkillsPackage | null;
  loading: boolean;
  error: string | null;
  
  fetchPackages: () => Promise<void>;
  createPackage: (data: CreatePackageRequest) => Promise<void>;
  deletePackage: (id: string) => Promise<void>;
  activatePackage: (id: string) => Promise<void>;
  deactivatePackage: (id: string) => Promise<void>;
}
```

---

## 10. 扩展开发

### 10.1 创建自定义技能包

1. 创建技能包目录
2. 编写 SKILL.md 文件
3. 添加子技能文件
4. 导入到系统

### 10.2 SKILL.md 模板

```markdown
---
name: my-skill
version: 1.0.0
description: 我的自定义技能包
author: your-name
tags:
  - custom
  - example
---

# 我的技能包

## 概述
描述这个技能包的用途和能力。

## 使用场景
- 场景1：描述
- 场景2：描述

## 使用指南
1. 步骤1
2. 步骤2

## 示例
提供使用示例。

## 注意事项
- 注意点1
- 注意点2
```

### 10.3 子技能定义

在 `skills/` 目录下创建子技能文件：

```markdown
# 子技能名称

## 功能描述
描述这个子技能的功能。

## 参数
- `param1`: 参数1描述
- `param2`: 参数2描述

## 返回值
描述返回值格式。

## 示例
提供调用示例。
```
