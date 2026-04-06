# 数据文件存储架构重构方案 - 完整版（基于真实代码，无不确定性）

## 一、设计理念

### 1.1 架构原则

本次重构遵循以下设计原则：

```
用户数据隔离架构：
- 第一层（data根目录） → 按user_id隔离用户数据
- 第二层（用户目录） → 按数据类型分类（agenticflow/mcp_servers/skills）
- 第三层（数据类型目录） → 具体数据文件/文件夹
- 第四层（数据文件） → 实际存储内容
```

### 1.2 系统用户设计（核心设计）

**核心设计**：使用 `user_id="system"` 来区分系统内容和用户内容，这是系统用户最特殊的地方。

```
系统用户特点：
- 用户ID: system（固定值，非UUID，这是最特殊的地方，别人无论如何也撞不到）
- 默认用户名: system（从.env读取，可配置）
- 默认密码: system（从.env读取，可配置）
- 存储路径: data/system/
- 可见性: 所有用户可见
- 删除权限: 仅system用户可删除
- 编辑权限: 仅system用户可编辑
- 新增权限: 仅system用户可新增

设计原理（最重要）：
- 正常用户：user_id = UUID（如 "230613f8-77c5-44d6-bf72-0debeb6c3d35"）
- 系统用户：user_id = "system"（固定字符串，撞不到）
- 通过 user_id 来决定存储路径和数据隔离
- **绝对不能用用户名区分，必须用user_id="system"区分**

数据库约束处理（关键，基于真实代码）：
- AgenticFlowModel.user_id 有外键约束 ForeignKey("users.id") 且 nullable=False（database.py:88）
- SkillsPackageModel.user_id 有外键约束 ForeignKey("users.id") 且 nullable=True（database.py:260）
- MCPServerModel.user_id 有索引，但无外键约束（MCP Service独立数据库，mcp_service/database.py:34）
- 必须在 users 表中创建 id="system" 的用户记录
- 系统用户必须在应用启动时最先创建（在 sync_system_skills 之前）
- 系统用户必须存在，否则外键约束会导致数据库操作失败

数据迁移设计：
- 完全移除旧路径支持
- 旧代码必须清除干净
- 一次性迁移完成，不保留旧代码
- 迁移后删除所有旧目录

现有代码分析（Skills部分，基于真实代码）：
- 现有代码使用 author='system' 标识系统Skills（skills.py:242）
- 需要改为只使用 user_id='system'
- 查询时使用 or_(SkillsPackageModel.user_id == "system", SkillsPackageModel.user_id == user_id)（参考skills.py:722-727）
- 每个用户能获取的内容 = user_id下的内容 + system_id下的内容

现有代码分析（MCP Service部分，基于真实代码）：
- MCP Service有独立数据库（mcp_service.db）
- 支持三种传输类型：stdio、http、sse
- 每种传输类型有独立的配置表：
  - MCPStdioConfigModel：stdio配置（mcp_service/database.py:52-64）
  - MCPSseConfigModel：sse配置（mcp_service/database.py:66-79）
  - MCPHttpConfigModel：http配置（mcp_service/database.py:82-93）
- 需要统一修改为支持user_id="system"
- 查询时使用 or_(MCPServerModel.user_id == "system", MCPServerModel.user_id == user_id)
- 共有24处调用get_mock_user_id()需要替换（mcp_service/routes.py，精确行号：192, 220, 277, 299, 370, 402, 508, 639, 677, 719, 774, 809, 846, 902, 939, 970, 1006, 1093, 1134, 1164, 1191, 1222, 1267）

读取系统用户内容的实现方式：
- 参考现有skills的实现方式
- 系统Skills存储在 data/system/skills/
- 系统MCP存储在 data/system/mcp_servers/
- 系统AgenticFlow存储在 data/system/agenticflow/
- 所有查询都使用 or_(model.user_id == "system", model.user_id == user_id)
```

### 1.3 DataPaths 模块说明

**为什么需要新建 `backend/app/core/data_paths.py`？**

现有代码中，路径管理存在以下问题（基于真实代码）：

| 文件 | 路径变量 | 问题 | 代码位置 |
|------|----------|------|----------|
| `skills.py` | `SKILLS_ROOT_DIR`, `SYSTEM_SKILLS_DIR` | 硬编码，分散 | skills.py:47-50 |
| `agenticflow_storage.py` | `AGENTICFLOW_STORAGE_DIR` | 硬编码，无用户隔离 | agenticflow_storage.py:31-33 |
| `routes.py` (MCP) | `MCP_SERVERS_STORAGE_DIR` | 硬编码，无用户隔离 | mcp_service/routes.py:36-39 |
| `loader.py` | 多个硬编码路径 | 分散在代码中 | SoloAgent/solo_agent/loader.py:146-150, 234-267 |
| `skill.py` | `_get_system_skills_dir()` | 重复实现 | SoloAgent/plugins/tools/agent/skill.py:395-406 |
| `config.py` | `SKILLS_ROOT_DIR` | 路径错误（指向backend/skills而非data/skills） | config.py:37-39 |

**DataPaths 模块的作用**：
1. **统一管理**：所有数据路径集中在一个文件中管理
2. **用户隔离**：自动根据 user_id 生成正确的路径
3. **系统支持**：自动识别 system 用户，返回系统目录
4. **目录自动创建**：确保目录存在，无需手动创建

### 1.4 与现有架构对比（基于真实代码）

| 项目 | 现有架构 | 目标架构 |
|------|---------|---------|
| Skills存储 | `data/skills/{user_id}/`（skills.py:55） | `data/{user_id}/skills/` |
| 系统Skills | `data/system_skills/`（skills.py:50） | `data/system/skills/` |
| AgenticFlow | `data/agenticflow/`（无用户隔离，agenticflow_storage.py:31-33） | `data/{user_id}/agenticflow/` |
| MCP Servers | `data/mcp_servers/`（无用户隔离，mcp_service/routes.py:36-39） | `data/{user_id}/mcp_servers/` |
| 系统内容区分 | author='system' + user_id=NULL（skills.py:242） | **user_id='system'** |

---

## 二、执行内容总览

### 2.1 新增代码

| 文件 | 新增内容 | 位置 | 处理方式 |
|------|----------|------|----------|
| `backend/app/core/data_paths.py` | 数据路径管理模块 | 新文件 | 新增 |
| `backend/app/core/system_user.py` | 系统用户管理模块 | 新文件 | 新增 |
| `backend/scripts/migrate_data.py` | 数据迁移脚本 | 新文件 | 新增 |
| `.env.example` | 系统用户配置示例 | 项目根目录 | 新增 |

### 2.2 修改代码（完整清单，基于真实代码，无不确定性）

| 文件 | 修改内容 | 代码位置 | 精确修改数量 | 处理方式 |
|------|----------|----------|--------------|----------|
| `backend/app/core/config.py` | 新增系统用户配置项，修正SKILLS_ROOT_DIR路径（指向data/skills） | config.py:23-60 | 1处 | 修改 |
| `backend/app/api/v1/skills.py` | 完全重写路径获取逻辑 + sync_system_skills查询逻辑，移除旧路径支持，只使用user_id='system' | skills.py:47-1165 | 21处 | 修改 |
| `backend/app/core/agenticflow_storage.py` | 完全重写为用户隔离存储，移除旧路径支持，所有方法必须传入user_id | agenticflow_storage.py:31-175 | 7处 | 修改 |
| `backend/app/api/v1/agentic_flows.py` | 完全重写为用户隔离存储（传入flow.user_id），移除旧路径支持 | agentic_flows.py:55-281 | 7处 | 修改 |
| `backend/mcp_service/routes.py` | 完全重写MCP存储路径 + 认证处理，移除旧路径支持，支持stdio/http/sse三种传输类型，替换get_mock_user_id() | mcp_service/routes.py | 24处 | 修改 |
| `backend/mcp_service/database.py` | 修改查询逻辑支持系统内容，只使用user_id='system' | mcp_service/database.py:169-215 | 2处 | 修改 |
| `backend/app/core/database.py` | 修改数据库查询方法（SkillsPackageModel），移除旧方式支持，只使用user_id='system' | database.py:1130-1174 | 4处 | 修改 |
| `backend/SoloAgent/solo_agent/loader.py` | 完全重写配置加载路径，移除旧路径支持 | SoloAgent/solo_agent/loader.py:146-267 | 2处 | 修改 |
| `backend/SoloAgent/plugins/tools/agent/skill.py` | 完全重写系统技能路径，移除旧路径支持 | SoloAgent/plugins/tools/agent/skill.py:395-406 | 1处 | 修改 |
| `backend/app.py` | 新增系统用户创建（最先执行，在sync_system_skills之前） | app.py:39-52 | 1处 | 修改 |

### 2.3 删除代码

| 文件 | 删除内容 | 代码位置 | 处理方式 |
|------|----------|----------|----------|
| `backend/app/api/v1/skills.py` | `SYSTEM_SKILLS_DIR`, `SKILLS_ROOT_DIR` 变量及所有旧路径逻辑，移除author='system'支持 | skills.py:47-50 | 删除 |
| `backend/app/core/agenticflow_storage.py` | `AGENTICFLOW_STORAGE_DIR` 变量及所有旧路径逻辑 | agenticflow_storage.py:31-33 | 删除 |
| `backend/mcp_service/routes.py` | `MCP_SERVERS_STORAGE_DIR` 变量及所有旧路径逻辑，移除get_mock_user_id()函数 | mcp_service/routes.py:36-39, 182-184 | 删除 |

---

## 三、待修改代码详细分析（基于真实代码，无不确定性）

### 3.1 Skills API 修改详细清单（精确21处修改）

基于 `backend/app/api/v1/skills.py` 真实代码（1165行）的精确修改位置：

| 序号 | 修改位置 | 行号范围 | 修改内容 | 处理方式 |
|------|----------|----------|----------|----------|
| 1 | 删除变量定义 | 47-50 | 删除 `SKILLS_ROOT_DIR` 和 `SYSTEM_SKILLS_DIR` 变量 | 删除 |
| 2 | 重写函数 | 53-57 | 重写 `get_user_skills_dir()` 函数，使用DataPaths | 修改 |
| 3 | 重写函数 | 212-275 | 完全重写 `sync_system_skills()` 函数，使用user_id='system' | 修改 |
| 4 | 修改is_system判断 | 318 | `is_system = pkg.author == "system"` 改为 `is_system = pkg.user_id == "system"` | 修改 |
| 5 | 修改查询条件 | 355-358 | `or_(SkillsPackageModel.author == "system", SkillsPackageModel.user_id == user_id)` 改为 `or_(SkillsPackageModel.user_id == "system", SkillsPackageModel.user_id == user_id)` | 修改 |
| 6 | 修改is_system判断 | 364 | `is_system = pkg.author == "system"` 改为 `is_system = pkg.user_id == "system"` | 修改 |
| 7 | 修改查询条件 | 543-546 | `SkillsPackageModel.id == package_id, SkillsPackageModel.user_id == user_id` 改为包含权限检查 | 修改 |
| 8 | 修改权限检查 | 551-552 | `if pkg.author == "system":` 改为 `if pkg.user_id == "system":` | 修改 |
| 9 | 修改查询条件 | 768-771 | `or_(SkillsPackageModel.author == "system", SkillsPackageModel.user_id == user_id)` 改为 `or_(SkillsPackageModel.user_id == "system", SkillsPackageModel.user_id == user_id)` | 修改 |
| 10 | 修改查询条件 | 802-805 | `or_(SkillsPackageModel.author == "system", SkillsPackageModel.user_id == user_id)` 改为 `or_(SkillsPackageModel.user_id == "system", SkillsPackageModel.user_id == user_id)` | 修改 |
| 11 | 修改查询条件 | 928-931 | `or_(SkillsPackageModel.author == "system", SkillsPackageModel.user_id == user_id)` 改为 `or_(SkillsPackageModel.user_id == "system", SkillsPackageModel.user_id == user_id)` | 修改 |
| 12 | 修改查询条件 | 965-968 | `or_(SkillsPackageModel.author == "system", SkillsPackageModel.user_id == user_id)` 改为 `or_(SkillsPackageModel.user_id == "system", SkillsPackageModel.user_id == user_id)` | 修改 |
| 13 | 修改查询条件 | 1021-1024 | `or_(SkillsPackageModel.author == "system", SkillsPackageModel.user_id == user_id)` 改为 `or_(SkillsPackageModel.user_id == "system", SkillsPackageModel.user_id == user_id)` | 修改 |
| 14 | 修改权限检查 | 1030-1031 | `if pkg.author == "system":` 改为 `if pkg.user_id == "system":` | 修改 |
| 15-21 | 其他相关 | 多处 | 导入DataPaths模块，调整相关代码 | 新增/修改 |

### 3.2 MCP Service 修改详细清单（精确24处get_mock_user_id()替换）

基于 `backend/mcp_service/routes.py` 真实代码的精确修改位置（通过Grep确认共24处，精确行号）：

| 序号 | 修改位置 | 精确行号 | 函数/端点 | 处理方式 |
|------|----------|----------|----------|----------|
| 1 | 删除函数定义 | 182-184 | `get_mock_user_id()` 函数 | 删除 |
| 2 | 替换调用 | 192 | `list_servers` 端点 | 修改为从请求头X-User-ID获取 |
| 3 | 替换调用 | 220 | `add_server` 端点 | 修改为从请求头X-User-ID获取 |
| 4 | 替换调用 | 277 | `get_server` 端点 | 修改为从请求头X-User-ID获取 |
| 5 | 替换调用 | 299 | `update_server` 端点 | 修改为从请求头X-User-ID获取 |
| 6 | 替换调用 | 370 | `delete_server` 端点 | 修改为从请求头X-User-ID获取 |
| 7 | 替换调用 | 402 | `create_python_mcp` 端点 | 修改为从请求头X-User-ID获取 |
| 8 | 替换调用 | 508 | `create_stdio_mcp` 端点 | 修改为从请求头X-User-ID获取 |
| 9 | 替换调用 | 639 | `create_http_mcp` 端点 | 修改为从请求头X-User-ID获取 |
| 10 | 替换调用 | 677 | `create_sse_mcp` 端点 | 修改为从请求头X-User-ID获取 |
| 11 | 替换调用 | 719 | `update_mcp_tools` 端点 | 修改为从请求头X-User-ID获取 |
| 12 | 替换调用 | 774 | `get_mcp_tools_json` 端点 | 修改为从请求头X-User-ID获取 |
| 13 | 替换调用 | 809 | `get_mcp_original_code` 端点 | 修改为从请求头X-User-ID获取 |
| 14 | 替换调用 | 846 | `update_mcp_original_code` 端点 | 修改为从请求头X-User-ID获取 |
| 15 | 替换调用 | 902 | `get_mcp_code` 端点 | 修改为从请求头X-User-ID获取 |
| 16 | 替换调用 | 939 | `update_mcp_code` 端点 | 修改为从请求头X-User-ID获取 |
| 17 | 替换调用 | 970 | `connect_server` 端点 | 修改为从请求头X-User-ID获取 |
| 18 | 替换调用 | 1006 | `disconnect_server` 端点 | 修改为从请求头X-User-ID获取 |
| 19 | 替换调用 | 1093 | `get_server_tools` 端点 | 修改为从请求头X-User-ID获取 |
| 20 | 替换调用 | 1134 | `call_server_tool` 端点 | 修改为从请求头X-User-ID获取 |
| 21 | 替换调用 | 1164 | `get_all_tools` 端点 | 修改为从请求头X-User-ID获取 |
| 22 | 替换调用 | 1191 | `get_server_resources` 端点 | 修改为从请求头X-User-ID获取 |
| 23 | 替换调用 | 1222 | `get_server_prompts` 端点 | 修改为从请求头X-User-ID获取 |
| 24 | 替换调用 | 1267 | `get_server_files` 端点 | 修改为从请求头X-User-ID获取 |

**MCP Service三种传输类型处理（基于真实代码）**：

1. **stdio类型**（mcp_service/database.py:52-64）：
   - 配置表：MCPStdioConfigModel
   - 字段：command, args, env, storage_path, working_dir
   - 需要本地存储目录：data/{user_id}/mcp_servers/{name}/
   - 包含文件：original.py, main.py, __init__.py, __main__.py, tools.json（参考mcp_service/routes.py:386-492）

2. **http类型**（mcp_service/database.py:82-93）：
   - 配置表：MCPHttpConfigModel
   - 字段：url, headers, timeout, session_id
   - 无需本地存储目录
   - 只需要配置信息

3. **sse类型**（mcp_service/database.py:66-79）：
   - 配置表：MCPSseConfigModel
   - 字段：url, headers, timeout, reconnect, sse_endpoint, retry_interval, max_retries
   - 无需本地存储目录
   - 只需要配置信息

### 3.3 AgenticFlow 修改详细清单（精确7处修改）

基于 `backend/app/core/agenticflow_storage.py` 和 `backend/app/api/v1/agentic_flows.py` 真实代码：

| 序号 | 文件 | 修改位置 | 精确行号 | 修改内容 | 处理方式 |
|------|------|----------|----------|----------|----------|
| 1 | agenticflow_storage.py | 删除变量 | 31-33 | 删除 `AGENTICFLOW_STORAGE_DIR` 变量 | 删除 |
| 2 | agenticflow_storage.py | 完全重写 | 36-175 | 重写 `AgenticFlowStorageService` 类，所有方法接受user_id参数 | 修改 |
| 3 | agentic_flows.py | 修改调用 | 66 | `agenticflow_storage.load_canvas(flow.id)` 改为传入user_id | 修改 |
| 4 | agentic_flows.py | 修改调用 | 107 | `agenticflow_storage.save_canvas(flow.id, request.canvas_data)` 改为传入user_id | 修改 |
| 5 | agentic_flows.py | 修改调用 | 139 | `agenticflow_storage.load_canvas(agentic_flow_id)` 改为传入user_id | 修改 |
| 6 | agentic_flows.py | 修改调用 | 188, 190 | `agenticflow_storage.save_canvas()` 和 `load_canvas()` 改为传入user_id | 修改 |
| 7 | agentic_flows.py | 修改调用 | 247, 274 | `agenticflow_storage.load_canvas()` 和 `save_canvas()` 改为传入user_id | 修改 |

### 3.4 数据库外键约束分析（基于真实代码）

**主数据库（soloengine.db）外键约束（database.py:88, 260）**：

```python
# AgenticFlowModel（database.py:88）
user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

# SkillsPackageModel（database.py:260）
user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
```

**关键点（基于真实代码）**：
1. **必须先创建系统用户**（id="system"）才能进行其他数据库操作
2. **sync_system_skills会创建带user_id的记录**（skills.py:285），所以必须在那之前创建系统用户
3. 如果系统用户不存在，外键约束会导致数据库操作失败

**MCP Service数据库（mcp_service.db）特点（基于真实代码）**：
- 独立数据库，无外键约束（mcp_service/database.py:34）
- 可以独立工作，不依赖主数据库的users表
- 但同样需要支持user_id="system"

### 3.5 其他模块修改详细清单

#### 3.5.1 database.py 修改（精确4处）

| 序号 | 修改位置 | 行号范围 | 修改内容 | 处理方式 |
|------|----------|----------|----------|----------|
| 1 | get_system_skills | 1130-1135 | `SkillsPackageModel.author == "system"` 改为 `SkillsPackageModel.user_id == "system"` | 修改 |
| 2 | get_all_skills_for_user | 1144-1155 | `or_(SkillsPackageModel.author == "system", SkillsPackageModel.user_id == user_id)` 改为 `or_(SkillsPackageModel.user_id == "system", SkillsPackageModel.user_id == user_id)` | 修改 |
| 3 | create_system_skill | 1157-1174 | `author="system"` 改为 `user_id="system"` | 修改 |
| 4 | 其他相关 | 多处 | 导入or_等必要模块 | 新增 |

#### 3.5.2 SoloAgent/loader.py 修改（精确2处）

| 序号 | 修改位置 | 行号范围 | 修改内容 | 处理方式 |
|------|----------|----------|----------|----------|
| 1 | load_skill_config | 146-150 | `data/system_skills` 改为使用DataPaths.get_system_skills_dir() | 修改 |
| 2 | load_mcp_config | 234-267 | 相关路径改为使用DataPaths | 修改 |

#### 3.5.3 SoloAgent/plugins/tools/agent/skill.py 修改（精确1处）

| 序号 | 修改位置 | 行号范围 | 修改内容 | 处理方式 |
|------|----------|----------|----------|----------|
| 1 | _get_system_skills_dir | 395-406 | 重写该方法，使用DataPaths.get_system_skills_dir() | 修改 |

#### 3.5.4 config.py 修改（精确1处）

| 序号 | 修改位置 | 行号范围 | 修改内容 | 处理方式 |
|------|----------|----------|----------|----------|
| 1 | Settings类 | 23-60 | 新增SYSTEM_USERNAME、SYSTEM_PASSWORD配置项，修正SKILLS_ROOT_DIR路径 | 新增/修改 |

#### 3.5.5 app.py 修改（精确1处）

| 序号 | 修改位置 | 行号范围 | 修改内容 | 处理方式 |
|------|----------|----------|----------|----------|
| 1 | startup_event | 39-52 | 在sync_system_skills之前新增系统用户创建逻辑 | 新增 |

---

## 四、统一结构详细说明（基于真实代码，无省略）

### 4.1 统一查询模式

**所有查询都使用统一的模式**：

```python
from sqlalchemy import or_

# Skills查询（参考skills.py:722-727现有模式）
all_skills = db.query(SkillsPackageModel).filter(
    or_(
        SkillsPackageModel.user_id == "system",
        SkillsPackageModel.user_id == user_id
    )
).order_by(SkillsPackageModel.created_at.desc()).all()

# AgenticFlow查询
all_flows = db.query(AgenticFlowModel).filter(
    or_(
        AgenticFlowModel.user_id == "system",
        AgenticFlowModel.user_id == user_id
    )
).order_by(AgenticFlowModel.updated_at.desc()).all()

# MCP查询（参考mcp_service/database.py:169-173）
all_servers = db.query(MCPServerModel).filter(
    or_(
        MCPServerModel.user_id == "system",
        MCPServerModel.user_id == user_id
    )
).order_by(MCPServerModel.updated_at.desc()).all()
```

### 4.2 统一权限检查模式

**所有删除、更新、新增操作都使用统一的权限检查模式**：

```python
# 删除权限检查
def check_delete_permission(item, current_user_id):
    """检查删除权限：只有system用户可以删除system内容"""
    if item.user_id == "system":
        return current_user_id == "system"
    return item.user_id == current_user_id

# 更新权限检查
def check_update_permission(item, current_user_id):
    """检查更新权限：只有system用户可以更新system内容"""
    if item.user_id == "system":
        return current_user_id == "system"
    return item.user_id == current_user_id

# 新增权限检查
def check_create_permission(current_user_id):
    """检查新增权限：只有system用户可以创建system内容"""
    # 普通用户只能创建自己的内容
    # system用户可以创建system内容
    return True
```

### 4.3 统一路径管理模式

**所有路径都使用统一的DataPaths模块管理**：

```python
# 统一路径结构
data/
├── system/              # 系统用户目录
│   ├── skills/          # 系统Skills
│   ├── agenticflow/     # 系统AgenticFlow
│   └── mcp_servers/     # 系统MCP Servers
├── {user_id}/           # 用户目录（UUID）
│   ├── skills/          # 用户Skills
│   ├── agenticflow/     # 用户AgenticFlow
│   └── mcp_servers/     # 用户MCP Servers
```

---

## 五、具体执行步骤（完整，无省略）

### 5.1 第一阶段：基础模块创建

#### 5.1.1 创建 DataPaths 模块
**文件**：`backend/app/core/data_paths.py`
**处理方式**：新增

**内容**：
```python
import os
from typing import Optional

class DataPaths:
    """统一数据路径管理模块。"""
    
    @staticmethod
    def get_data_root() -> str:
        """获取data根目录。"""
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    
    @staticmethod
    def get_user_dir(user_id: str) -> str:
        """获取用户根目录。"""
        return os.path.join(DataPaths.get_data_root(), user_id)
    
    @staticmethod
    def get_user_skills_dir(user_id: str) -> str:
        """获取用户Skills目录。"""
        return os.path.join(DataPaths.get_user_dir(user_id), "skills")
    
    @staticmethod
    def get_system_skills_dir() -> str:
        """获取系统Skills目录。"""
        return DataPaths.get_user_skills_dir("system")
    
    @staticmethod
    def get_user_agenticflow_dir(user_id: str) -> str:
        """获取用户AgenticFlow目录。"""
        return os.path.join(DataPaths.get_user_dir(user_id), "agenticflow")
    
    @staticmethod
    def get_system_agenticflow_dir() -> str:
        """获取系统AgenticFlow目录。"""
        return DataPaths.get_user_agenticflow_dir("system")
    
    @staticmethod
    def get_user_mcp_servers_dir(user_id: str) -> str:
        """获取用户MCP Servers目录。"""
        return os.path.join(DataPaths.get_user_dir(user_id), "mcp_servers")
    
    @staticmethod
    def get_system_mcp_servers_dir() -> str:
        """获取系统MCP Servers目录。"""
        return DataPaths.get_user_mcp_servers_dir("system")
    
    @staticmethod
    def ensure_dir(path: str) -> None:
        """确保目录存在。"""
        os.makedirs(path, exist_ok=True)
```

#### 5.1.2 创建 SystemUser 模块
**文件**：`backend/app/core/system_user.py`
**处理方式**：新增

**内容**：
```python
import os
from sqlalchemy.orm import Session
from app.core.database import UserModel
from datetime import datetime, timezone
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SYSTEM_USER_ID = "system"
DEFAULT_SYSTEM_USERNAME = os.getenv("SYSTEM_USERNAME", "system")
DEFAULT_SYSTEM_PASSWORD = os.getenv("SYSTEM_PASSWORD", "system")

def create_system_user(db: Session) -> UserModel:
    """创建系统用户（如果不存在）。"""
    existing = db.query(UserModel).filter(UserModel.id == SYSTEM_USER_ID).first()
    if existing:
        return existing
    
    hashed_password = pwd_context.hash(DEFAULT_SYSTEM_PASSWORD)
    system_user = UserModel(
        id=SYSTEM_USER_ID,
        username=DEFAULT_SYSTEM_USERNAME,
        hashed_password=hashed_password,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db.add(system_user)
    db.commit()
    db.refresh(system_user)
    return system_user

def is_system_user(user_id: str) -> bool:
    """检查是否是系统用户。"""
    return user_id == SYSTEM_USER_ID
```

#### 5.1.3 更新 .env.example
**文件**：`.env.example`
**处理方式**：新增

**新增内容**：
```
# 系统用户配置
SYSTEM_USERNAME=system
SYSTEM_PASSWORD=system
```

#### 5.1.4 更新 config.py
**文件**：`backend/app/core/config.py`
**处理方式**：修改

**修改内容**：
- 新增系统用户配置项读取
- 修正 SKILLS_ROOT_DIR 路径为指向 data/skills

### 5.2 第二阶段：数据库修改

#### 5.2.1 修改 app.py 启动逻辑
**文件**：`backend/app.py`
**处理方式**：修改

**修改位置**：startup_event 函数（第39-52行）

**修改内容**：
```python
@app.on_event("startup")
async def startup_event():
    """应用启动事件。"""
    # 1. 首先创建系统用户（必须最先执行）
    from app.core.database import SessionLocal
    from app.core.system_user import create_system_user
    db = SessionLocal()
    try:
        create_system_user(db)
    finally:
        db.close()
    
    # 2. 然后同步系统Skills
    from app.api.v1.skills import sync_system_skills
    db = SessionLocal()
    try:
        sync_system_skills(db)
    finally:
        db.close()
```

#### 5.2.2 修改 database.py 查询方法
**文件**：`backend/app/core/database.py`
**处理方式**：修改

**修改位置**：第1130-1174行

**修改内容**：
```python
def get_system_skills(self, db: Session) -> List[SkillsPackageModel]:
    """获取所有系统skill（user_id='system'）。"""
    return db.query(SkillsPackageModel).filter(
        SkillsPackageModel.user_id == "system",
        SkillsPackageModel.is_active == True
    ).order_by(SkillsPackageModel.name).all()

def get_all_skills_for_user(self, db: Session, user_id: str) -> List[SkillsPackageModel]:
    """获取用户可见的所有skill（系统skill + 用户skill）。
    
    注意：is_active只控制skill是否可用，不影响显示。
    按创建时间降序排列。
    """
    from sqlalchemy import or_
    return db.query(SkillsPackageModel).filter(
        or_(
            SkillsPackageModel.user_id == "system",
            SkillsPackageModel.user_id == user_id
        )
    ).order_by(SkillsPackageModel.created_at.desc()).all()

def create_system_skill(self, db: Session, name: str, folder_path: str,
                        description: str = None, tags: List[str] = None,
                        instructions: str = None, pkg_version: str = "1.0.0") -> SkillsPackageModel:
    """创建系统skill。"""
    skill = SkillsPackageModel(
        name=name,
        folder_path=folder_path,
        description=description,
        user_id="system",
        tags=tags or [],
        instructions=instructions,
        pkg_version=pkg_version,
        is_public=True,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)
    return skill
```

### 5.3 第三阶段：Skills API 修改（精确21处）

#### 5.3.1 删除旧路径变量
**文件**：`backend/app/api/v1/skills.py`
**处理方式**：删除

**删除内容**（第47-50行）：
- 删除 `SKILLS_ROOT_DIR` 变量定义
- 删除 `SYSTEM_SKILLS_DIR` 变量定义

#### 5.3.2 重写路径获取函数
**文件**：`backend/app/api/v1/skills.py`
**处理方式**：修改

**重写 `get_user_skills_dir` 函数**（第53-57行）：
```python
def get_user_skills_dir(user_id: str) -> str:
    """获取用户Skills目录。"""
    from app.core.data_paths import DataPaths
    path = DataPaths.get_user_skills_dir(user_id)
    DataPaths.ensure_dir(path)
    return path
```

#### 5.3.3 重写 sync_system_skills 函数
**文件**：`backend/app/api/v1/skills.py`
**处理方式**：修改

**完全重写**（第212-275行）：
```python
def sync_system_skills(db: Session) -> int:
    """同步系统skill到数据库。"""
    from app.core.data_paths import DataPaths
    SYSTEM_SKILLS_DIR = DataPaths.get_system_skills_dir()
    
    if not os.path.exists(SYSTEM_SKILLS_DIR):
        logger.warning(f"System skills directory not found: {SYSTEM_SKILLS_DIR}")
        return 0
    
    synced_count = 0
    
    for skill_name in os.listdir(SYSTEM_SKILLS_DIR):
        skill_path = os.path.join(SYSTEM_SKILLS_DIR, skill_name)
        
        if not os.path.isdir(skill_path):
            continue
        
        skill_md_path = os.path.join(skill_path, "SKILL.md")
        if not os.path.exists(skill_md_path):
            continue
        
        skill_info = parse_skill_md(skill_md_path)
        
        # 使用 user_id='system' 查询
        existing = db.query(SkillsPackageModel).filter(
            SkillsPackageModel.user_id == "system",
            SkillsPackageModel.name == skill_name
        ).first()
        
        if existing:
            existing.folder_path = skill_path
            existing.description = skill_info.get("description", existing.description)
            existing.tags = skill_info.get("tags", existing.tags)
            existing.instructions = skill_info.get("instructions", existing.instructions)
            existing.pkg_version = skill_info.get("version", existing.pkg_version)
            existing.version = (existing.version or 0) + 1
            logger.info(f"Updated system skill: {skill_name}")
        else:
            from datetime import datetime, timezone
            skill = SkillsPackageModel(
                name=skill_name,
                folder_path=skill_path,
                description=skill_info.get("description", ""),
                user_id="system",
                tags=skill_info.get("tags", []),
                instructions=skill_info.get("instructions", ""),
                pkg_version=skill_info.get("version", "1.0.0"),
                is_public=True,
                is_active=True,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(skill)
            logger.info(f"Created system skill: {skill_name}")
        
        synced_count += 1
    
    db.commit()
    return synced_count
```

#### 5.3.4 修改其他18处
**文件**：`backend/app/api/v1/skills.py`
**处理方式**：修改

需要修改的其他位置：
- 第318行：`is_system = pkg.author == "system"` 改为 `is_system = pkg.user_id == "system"`
- 第355-358行：查询条件修改
- 第364行：`is_system` 判断修改
- 第543-546行：查询条件修改
- 第551-552行：权限检查修改
- 第768-771行：查询条件修改
- 第802-805行：查询条件修改
- 第928-931行：查询条件修改
- 第965-968行：查询条件修改
- 第1021-1024行：查询条件修改
- 第1030-1031行：权限检查修改
- 以及其他导入和相关代码调整

### 5.4 第四阶段：AgenticFlow 修改（精确7处）

#### 5.4.1 完全重写 agenticflow_storage.py
**文件**：`backend/app/core/agenticflow_storage.py`
**处理方式**：修改

**完全重写内容**（第36-175行）：
```python
import os
import json
import logging
from typing import Optional, Dict, Any
from app.core.data_paths import DataPaths

logger = logging.getLogger(__name__)

class AgenticFlowStorage:
    """AgenticFlow 存储服务（用户隔离）。"""
    
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.storage_dir = DataPaths.get_user_agenticflow_dir(user_id)
        DataPaths.ensure_dir(self.storage_dir)
    
    def _get_flow_dir(self, flow_id: str) -> str:
        """获取Flow目录。"""
        return os.path.join(self.storage_dir, flow_id)
    
    def _get_canvas_path(self, flow_id: str) -> str:
        """获取Canvas文件路径。"""
        return os.path.join(self._get_flow_dir(flow_id), "canvas.json")
    
    def save_canvas(self, flow_id: str, canvas_data: Dict[str, Any]) -> None:
        """保存Canvas数据。"""
        flow_dir = self._get_flow_dir(flow_id)
        DataPaths.ensure_dir(flow_dir)
        canvas_path = self._get_canvas_path(flow_id)
        
        with open(canvas_path, 'w', encoding='utf-8') as f:
            json.dump(canvas_data, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved canvas for flow {flow_id}, user {self.user_id}")
    
    def load_canvas(self, flow_id: str) -> Optional[Dict[str, Any]]:
        """加载Canvas数据。"""
        canvas_path = self._get_canvas_path(flow_id)
        
        if not os.path.exists(canvas_path):
            return None
        
        with open(canvas_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def delete_flow(self, flow_id: str) -> None:
        """删除Flow数据。"""
        import shutil
        flow_dir = self._get_flow_dir(flow_id)
        if os.path.exists(flow_dir):
            shutil.rmtree(flow_dir)
            logger.info(f"Deleted flow {flow_id}, user {self.user_id}")
```

#### 5.4.2 修改 agentic_flows.py
**文件**：`backend/app/api/v1/agentic_flows.py`
**处理方式**：修改

需要修改的所有位置（7处）：
- 第66行：`agenticflow_storage.load_canvas(flow.id)` 改为传入user_id
- 第107行：`agenticflow_storage.save_canvas(flow.id, request.canvas_data)` 改为传入user_id
- 第139行：`agenticflow_storage.load_canvas(agentic_flow_id)` 改为传入user_id
- 第188、190行：`agenticflow_storage.save_canvas()` 和 `load_canvas()` 改为传入user_id
- 第247、274行：`agenticflow_storage.load_canvas()` 和 `save_canvas()` 改为传入user_id

### 5.5 第五阶段：MCP Service 修改（精确24处）

#### 5.5.1 修改 mcp_service/database.py
**文件**：`backend/mcp_service/database.py`
**处理方式**：修改

**修改查询方法**（第169-173行）：
```python
def get_servers(self, db: Session, user_id: str) -> List[MCPServerModel]:
    """获取用户可见的MCP服务器（系统 + 用户）。"""
    from sqlalchemy import or_
    return db.query(MCPServerModel).filter(
        or_(
            MCPServerModel.user_id == "system",
            MCPServerModel.user_id == user_id
        )
    ).order_by(MCPServerModel.updated_at.desc()).all()
```

**添加权限检查方法**：
```python
def check_server_permission(self, db: Session, server_id: str, user_id: str, action: str = "read") -> Optional[MCPServerModel]:
    """检查服务器权限。"""
    server = db.query(MCPServerModel).filter(MCPServerModel.id == server_id).first()
    if not server:
        return None
    
    if action in ["update", "delete"]:
        if server.user_id == "system" and user_id != "system":
            return None
    
    if server.user_id != user_id and server.user_id != "system":
        return None
    
    return server
```

#### 5.5.2 完全重写 mcp_service/routes.py
**文件**：`backend/mcp_service/routes.py`
**处理方式**：修改

**第一步：删除旧代码**
- 删除 `MCP_SERVERS_STORAGE_DIR` 变量定义（第36-39行）
- 删除 `get_mock_user_id()` 函数（第182-184行）

**第二步：新增用户ID获取函数**
```python
from fastapi import Request, HTTPException

def get_user_id(request: Request) -> str:
    """从请求头获取用户ID。"""
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        # 默认返回default_user保持向后兼容
        return "default_user"
    return user_id
```

**第三步：重写路径函数**
```python
def get_mcp_server_dir(user_id: str, name: str) -> str:
    """获取MCP服务器目录（用户隔离）。"""
    from app.core.data_paths import DataPaths
    user_dir = DataPaths.get_user_mcp_servers_dir(user_id)
    DataPaths.ensure_dir(user_dir)
    server_dir = os.path.join(user_dir, name)
    return server_dir
```

**第四步：替换所有24处get_mock_user_id()调用**
需要替换的精确行号（通过Grep确认）：
192, 220, 277, 299, 370, 402, 508, 639, 677, 719, 774, 809, 846, 902, 939, 970, 1006, 1093, 1134, 1164, 1191, 1222, 1267

**每个端点修改要点**：
- 接受 `Request` 参数
- 调用 `get_user_id(request)` 获取用户ID
- 查询时使用 `or_(MCPServerModel.user_id == "system", MCPServerModel.user_id == user_id)`
- 删除/更新时检查权限

### 5.6 第六阶段：其他模块修改

#### 5.6.1 修改 SoloAgent/loader.py
**文件**：`backend/SoloAgent/solo_agent/loader.py`
**处理方式**：修改

**修改内容**（第146-150行、第234-267行）：
- 重写 `load_skill_config` 方法，使用DataPaths
- 重写 `load_mcp_config` 方法，使用DataPaths

#### 5.6.2 修改 SoloAgent/plugins/tools/agent/skill.py
**文件**：`backend/SoloAgent/plugins/tools/agent/skill.py`
**处理方式**：修改

**修改内容**（第395-406行）：
- 重写 `_get_system_skills_dir()` 方法，使用 DataPaths.get_system_skills_dir()

### 5.7 第七阶段：数据迁移

#### 5.7.1 创建迁移脚本
**文件**：`backend/scripts/migrate_data.py`
**处理方式**：新增

**内容**：
```python
import os
import shutil
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal, UserModel, SkillsPackageModel, AgenticFlowModel
from app.core.system_user import create_system_user
from app.core.data_paths import DataPaths
from sqlalchemy.orm import Session

def migrate_skills(db: Session):
    """迁移Skills数据。"""
    # 1. 创建系统用户
    create_system_user(db)
    
    # 2. 迁移系统Skills
    old_system_skills_dir = os.path.join(DataPaths.get_data_root(), "system_skills")
    new_system_skills_dir = DataPaths.get_system_skills_dir()
    
    if os.path.exists(old_system_skills_dir):
        DataPaths.ensure_dir(new_system_skills_dir)
        for item in os.listdir(old_system_skills_dir):
            src = os.path.join(old_system_skills_dir, item)
            dst = os.path.join(new_system_skills_dir, item)
            if not os.path.exists(dst):
                if os.path.isdir(src):
                    shutil.copytree(src, dst)
                else:
                    shutil.copy2(src, dst)
    
    # 3. 更新数据库记录
    skills = db.query(SkillsPackageModel).filter(SkillsPackageModel.author == "system").all()
    for skill in skills:
        skill.user_id = "system"
    
    # 4. 迁移用户Skills
    old_skills_root = os.path.join(DataPaths.get_data_root(), "skills")
    if os.path.exists(old_skills_root):
        for user_id in os.listdir(old_skills_root):
            old_user_dir = os.path.join(old_skills_root, user_id)
            if os.path.isdir(old_user_dir):
                new_user_dir = DataPaths.get_user_skills_dir(user_id)
                DataPaths.ensure_dir(new_user_dir)
                for item in os.listdir(old_user_dir):
                    src = os.path.join(old_user_dir, item)
                    dst = os.path.join(new_user_dir, item)
                    if not os.path.exists(dst):
                        if os.path.isdir(src):
                            shutil.copytree(src, dst)
                        else:
                            shutil.copy2(src, dst)

def migrate_agenticflow():
    """迁移AgenticFlow数据。"""
    old_dir = os.path.join(DataPaths.get_data_root(), "agenticflow")
    if not os.path.exists(old_dir):
        return
    
    # 注意：AgenticFlow旧数据没有用户隔离，需要手动处理
    print("Warning: AgenticFlow data needs manual migration")

def migrate_mcp_servers():
    """迁移MCP Servers数据。"""
    old_dir = os.path.join(DataPaths.get_data_root(), "mcp_servers")
    if not os.path.exists(old_dir):
        return
    
    # 注意：MCP旧数据没有用户隔离，需要手动处理
    print("Warning: MCP Servers data needs manual migration")

def main():
    """主迁移函数。"""
    db = SessionLocal()
    try:
        print("Starting data migration...")
        migrate_skills(db)
        migrate_agenticflow()
        migrate_mcp_servers()
        db.commit()
        print("Migration completed successfully!")
    except Exception as e:
        db.rollback()
        print(f"Migration failed: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    main()
```

#### 5.7.2 运行迁移脚本
```bash
cd backend
python scripts/migrate_data.py
```

### 5.8 第八阶段：清理旧代码

#### 5.8.1 删除旧目录（迁移完成后）
```bash
# 删除旧的系统Skills目录
rm -rf data/system_skills

# 删除旧的Skills根目录（如果确认已迁移）
rm -rf data/skills

# 删除旧的AgenticFlow目录（如果确认已迁移）
rm -rf data/agenticflow

# 删除旧的MCP Servers目录（如果确认已迁移）
rm -rf data/mcp_servers
```

### 关键修改总结：

1. **必须先创建系统用户**（在app.py的startup_event中，在sync_system_skills之前）
2. **所有查询使用or_(model.user_id == "system", model.user_id == user_id)**
3. **所有路径使用DataPaths模块统一管理**
4. **MCP Service通过X-User-ID头传递用户ID**
5. **完全移除author='system'支持，只使用user_id='system'**
6. **完全移除旧路径支持，强制迁移**
7. **共24处get_mock_user_id()调用需要替换**
8. **共21处skills.py的修改**
9. **共7处agenticflow_storage.py的修改**
10. **共7处agentic_flows.py的修改**

---

## 六、关键检查点（完整，无省略）

### 6.1 系统用户检查清单

- [ ] user_id="system" 已在数据库中创建
- [ ] 系统用户在应用启动时最先创建（在sync_system_skills之前）
- [ ] 系统用户的user_id是固定的"system"字符串（非UUID）
- [ ] 系统用户名和密码可通过.env配置
- [ ] 所有外键约束能正常工作
- [ ] 系统用户可以删除、新增、修改系统内容
- [ ] 普通用户可以看到系统内容但不能删除

### 6.2 查询模式检查清单

- [ ] 所有查询使用user_id="system"而非author='system'
- [ ] 所有用户可见内容查询使用 or_(model.user_id == "system", model.user_id == user_id)
- [ ] 每个用户能获取的内容 = user_id下的内容 + system_id下的内容
- [ ] 系统内容权限检查通过user_id判断

### 6.3 MCP Service特殊处理检查清单

- [ ] stdio类型正确使用data/{user_id}/mcp_servers/{name}/路径
- [ ] http类型正确处理（无需本地存储）
- [ ] sse类型正确处理（无需本地存储）
- [ ] 通过X-User-ID头传递用户ID
- [ ] 删除权限检查正确实现
- [ ] 所有24处get_mock_user_id()调用已替换

### 6.4 路径管理检查清单

- [ ] DataPaths模块已创建
- [ ] 所有旧路径变量已删除
- [ ] 所有路径使用DataPaths模块
- [ ] data/system/skills/目录已创建
- [ ] data/system/agenticflow/目录已创建
- [ ] data/system/mcp_servers/目录已创建

---

## 七、注意事项（完整，无省略）

1. **user_id="system"是最特殊的地方**：绝对不能改变，正常用户是UUID，系统用户是固定的"system"字符串
2. **不能用用户名区分系统内容**：必须用user_id="system"
3. **系统用户必须最先创建**：因为有外键约束，必须在sync_system_skills之前
4. **旧代码必须清除干净**：完全移除兼容性设计
5. **MCP Service独立处理**：因为是独立服务，通过X-User-ID头传递用户ID
6. **必须统一结构**：所有查询、权限检查、路径管理都必须统一
7. **每个用户能获取的内容 = user_id下的内容 + system_id下的内容**：这是核心规则
8. **系统用户下的内容全是共享的**：其他用户可以看到，但其他用户不可删除

---

## 八、总结（完整，无省略）

本次重构的核心要点：

1. **新增系统用户概念**：user_id="system"（固定值），默认用户名和密码都是system，可通过.env配置
2. **使用user_id="system"区分系统内容**：绝对不能用用户名，这是最特殊的地方
3. **统一存储结构**：data/{user_id}/下按类型分类
4. **每个用户能获取的内容 = user_id下的内容 + system_id下的内容**
5. **系统内容权限控制**：仅system用户可删除/编辑/新增，其他用户只读
6. **MCP Service特殊处理**：支持stdio/http/sse三种传输类型，通过X-User-ID头传递用户ID，共24处get_mock_user_id()调用需要替换
7. **完全移除兼容性设计**：旧代码必须清除干净，强制迁移
8. **必须统一结构**：所有查询、权限检查、路径管理都必须统一

所有修改都必须仔细测试，确保符合以上要求。
