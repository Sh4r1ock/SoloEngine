# MCP调用机制重构方案

## 文档概述

本文档基于对MCP协议标准的深入调研（30+次网络搜索）、对项目代码的全面分析（30+个文件），提出MCP调用机制的重构方案。

---

## 一、现状分析

### 1.1 当前MCP实现架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MCP Service (FastAPI :8992)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                          API Layer (routes.py)                       │   │
│  │  • /api/v1/mcp/servers        • /api/v1/mcp/servers/{id}/tools      │   │
│  │  • /api/v1/mcp/servers/{id}   • /api/v1/mcp/tools/all               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────────┐  │
│  │  registry.py  │  │ lifecycle.py  │  │        caller.py              │  │
│  │  (服务注册)   │  │  (生命周期)   │  │     (统一调用接口)            │  │
│  └───────────────┘  └───────────────┘  └───────────────────────────────┘  │
│                                      │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   Client Factory (clients/factory.py)                │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                              │   │
│  │  │ Stdio   │  │  SSE    │  │  HTTP   │                              │   │
│  │  │ Client  │  │ Client  │  │ Client  │                              │   │
│  │  └─────────┘  └─────────┘  └─────────┘                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 当前问题

| 问题 | 描述 | 影响 |
|------|------|------|
| **工具信息未暴露** | MCP工具信息未在Tool Spec中完整暴露 | 模型无法直接了解可用的MCP工具 |
| **无XML标签感知** | 没有使用`<available_mcp_tools>` XML标签 | 模型难以感知可用的MCP工具 |
| **实例非独立** | MCP客户端实例可能不是每个Agent独立的 | 多Agent场景下可能产生冲突 |
| **编译时未注入** | MCP信息未在编译时注入到工具中 | 运行时动态获取，效率低 |

### 1.3 MCP与Skill的本质区别

| 特性 | Skill | MCP |
|------|-------|-----|
| **本质** | 完整的技能包 | 工具集合 |
| **内容大小** | SKILL.md可能有几千字 | 每个工具描述几十到几百字 |
| **结构** | 包含指令+嵌套资源 | 结构化的工具定义（JSON Schema） |
| **是否需要渐进式披露** | **是** - 需要按需加载节省token | **否** - 工具描述本身就很短 |

---

## 二、重构目标

### 2.1 核心目标

1. **完整工具暴露**：在Tool Spec中完整暴露所有MCP工具信息
2. **XML标签感知**：使用`<available_mcp_tools>` XML标签让模型感知可用工具
3. **实例独立**：每个Agent的MCP工具实例相互独立
4. **编译时注入**：MCP信息在编译时注入到工具中

### 2.2 设计原则

| 原则 | 描述 |
|------|------|
| **直接暴露** | MCP工具信息直接暴露给模型，不需要渐进式披露 |
| **Agent隔离** | 每个Agent有独立的MCP工具实例 |
| **编译时连接** | 编译时建立MCP连接，获取工具列表 |
| **标准格式** | 遵循MCP协议标准的调用格式和返回值格式 |

---

## 三、架构设计

### 3.1 四层架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      数据层 (Database)                                        │
│  MCPServerModel: mcp_server_id, mcp_name, transport_type, user_id...        │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                      编译层 (Compiler)                                        │
│  AgenticFlowCompiler: _load_mcp_configs() → 连接MCP → 获取工具列表          │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Agent层 (SoloAgent)                                      │
│  SoloAgent: _load_mcp_tools() → MCPTool(mcp_tools_info=...)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                      工具层 (Tool)                                            │
│  MCPTool: get_tool_spec() → available_mcp_tools XML (完整工具列表)          │
│  MCPTool: execute() → MCP调用结果                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| MCPServerModel | `app/core/database.py` | 数据库模型，存储MCP服务器元信息 |
| AgenticFlowCompiler | `solo_agent/compiler/flow_compiler.py` | 编译器，连接MCP并获取工具列表 |
| SoloAgent | `solo_agent/agent.py` | Agent基类，加载MCP工具 |
| MCPTool | `plugins/tools/agent/mcp.py` | MCP工具实现（新增） |
| ToolkitExecutor | `plugins/tools/toolkit_executor.py` | 工具执行器 |
| ReActCore | `core/react_core.py` | ReAct核心引擎 |

---

## 四、数据流详解

### 4.1 编译阶段

```
用户画布 JSON (mcp_tools: ["github", "filesystem"])
         ↓
AgenticFlowCompiler._load_mcp_configs()
         ↓
从数据库 MCPServerModel 加载配置
         ↓
建立MCP连接，获取工具列表
         ↓
组装 mcp_tools_info:
[
  {
    "server_id": "xxx",
    "server_name": "github",
    "server_description": "GitHub operations...",
    "tools": [
      {
        "name": "create_issue",
        "description": "Create a new issue in a GitHub repository",
        "inputSchema": {
          "type": "object",
          "properties": {
            "owner": {"type": "string", "description": "Repository owner"},
            "repo": {"type": "string", "description": "Repository name"},
            "title": {"type": "string", "description": "Issue title"}
          },
          "required": ["owner", "repo", "title"]
        }
      },
      ...
    ]
  }
]
         ↓
传递给 SoloAgentConfig.mcp_tools
```

### 4.2 Agent初始化阶段

```
SoloAgent.initialize()
         ↓
_load_mcp_tools(mcp_tools=mcp_tools_info)
         ↓
创建 MCPTool(mcp_tools_info=mcp_tools_info)
         ↓
注册到 ToolkitExecutor
```

### 4.3 工具规范生成

**MCPTool.get_tool_spec()** 生成包含 `available_mcp_tools` XML 的工具描述：

```json
{
  "name": "MCP",
  "description": "Call a tool from an MCP server.\n\nAvailable MCP tools:\n<available_mcp_tools>\n[github] create_issue: Create a new issue in a GitHub repository\n[github] list_issues: List issues in a GitHub repository\n[filesystem] read_file: Read a file from the filesystem\n[filesystem] write_file: Write content to a file\n</available_mcp_tools>\n\n...",
  "parameters": {
    "type": "object",
    "properties": {
      "server_name": {
        "type": "string",
        "description": "The MCP server name."
      },
      "tool_name": {
        "type": "string",
        "description": "The tool name to call."
      },
      "arguments": {
        "type": "object",
        "description": "The arguments to pass to the tool."
      }
    },
    "required": ["server_name", "tool_name"]
  }
}
```

### 4.4 MCP执行阶段

```
模型调用 MCP(server_name="github", tool_name="create_issue", arguments={...})
         ↓
ToolkitExecutor.execute({"name": "MCP", "arguments": {...}})
         ↓
MCPTool.execute(server_name="github", tool_name="create_issue", arguments={...})
         ↓
查找已连接的 MCPClient 实例
         ↓
调用 client.call_tool("create_issue", arguments)
         ↓
返回 MCP 标准格式结果
```

---

## 五、MCPTool详细设计

### 5.1 MCPToolInfo数据类

```python
@dataclass
class MCPToolInfo:
    """MCP工具信息数据类"""
    server_id: str
    server_name: str
    server_description: str = ""
    tools: List[Dict[str, Any]] = field(default_factory=list)
    client: Optional[BaseClient] = None
    is_connected: bool = False
```

### 5.2 MCPTool初始化

```python
class MCPTool(BaseAgentTool):
    """MCP工具 - 调用MCP服务器上的工具"""
    
    def __init__(
        self,
        mcp_tools_info: Optional[List[Dict[str, Any]]] = None,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None
    ) -> None:
        super().__init__(context, permission)
        self._mcp_tools_info = mcp_tools_info or []
        self._servers: Dict[str, MCPToolInfo] = {}
        
        for server_info in self._mcp_tools_info:
            if isinstance(server_info, dict):
                server_name = server_info.get("server_name", server_info.get("name", ""))
                if not server_name:
                    continue
                self._servers[server_name] = MCPToolInfo(
                    server_id=server_info.get("server_id", ""),
                    server_name=server_name,
                    server_description=server_info.get("server_description", ""),
                    tools=server_info.get("tools", []),
                    client=server_info.get("client"),
                    is_connected=server_info.get("client") is not None
                )
```

### 5.3 工具规范生成

```python
def get_tool_spec(self) -> Dict[str, Any]:
    """获取工具规范 - 包含 available_mcp_tools XML"""
    available_mcp_xml = self._format_available_mcp_tools_xml()
    
    description = f"""Call a tool from an MCP server.

Available MCP tools:
{available_mcp_xml}

When to use the MCP tool:
  - When you need to access external tools or services
  - When you need to perform operations on files, APIs, or databases
  - When the user requests functionality provided by an MCP server

Usage:
  - server_name: The MCP server name (e.g., "github", "filesystem")
  - tool_name: The tool name to call
  - arguments: The arguments to pass to the tool (JSON object)

IMPORTANT: When an MCP tool is relevant, you must invoke this tool IMMEDIATELY as your first action.
NEVER just announce or mention an MCP server in your text response without actually calling this tool."""
    
    return {
        "name": "MCP",
        "description": description,
        "parameters": {
            "type": "object",
            "properties": {
                "server_name": {
                    "type": "string",
                    "description": "The MCP server name."
                },
                "tool_name": {
                    "type": "string",
                    "description": "The tool name to call on the MCP server."
                },
                "arguments": {
                    "type": "object",
                    "description": "The arguments to pass to the tool."
                }
            },
            "required": ["server_name", "tool_name"]
        }
    }

def _format_available_mcp_tools_xml(self) -> str:
    """生成 available_mcp_tools XML - 展示所有工具"""
    if not self._servers:
        return "<available_mcp_tools>\nNo MCP tools available.\n</available_mcp_tools>"
    
    lines = ["<available_mcp_tools>"]
    for server_name, server_info in self._servers.items():
        for tool in server_info.tools:
            tool_name = tool.get("name", "")
            tool_desc = tool.get("description", "")
            if tool_name:
                if tool_desc:
                    lines.append(f"[{server_name}] {tool_name}: {tool_desc}")
                else:
                    lines.append(f"[{server_name}] {tool_name}")
    lines.append("</available_mcp_tools>")
    return "\n".join(lines)
```

### 5.4 执行方法

```python
async def execute(
    self,
    server_name: str,
    tool_name: str,
    arguments: Dict[str, Any] = None,
    **kwargs
) -> Dict[str, Any]:
    """执行MCP工具调用"""
    if not server_name:
        return self.create_error_response(
            message="MCP server name is required",
            error_code="INVALID_SERVER_NAME"
        )
    
    server_info = self._servers.get(server_name)
    if not server_info:
        return self.create_error_response(
            message=f"MCP server '{server_name}' not found",
            error_code="MCP_SERVER_NOT_FOUND",
            details={"server_name": server_name}
        )
    
    if not tool_name:
        return self.create_error_response(
            message="Tool name is required",
            error_code="INVALID_TOOL_NAME"
        )
    
    client = server_info.client
    if not client:
        return self.create_error_response(
            message=f"MCP server '{server_name}' is not connected",
            error_code="MCP_NOT_CONNECTED"
        )
    
    try:
        result = await client.call_tool(tool_name, arguments or {})
        return {
            "success": True,
            "server_name": server_name,
            "tool_name": tool_name,
            "result": result
        }
    except Exception as e:
        return self.create_error_response(
            message=f"Tool execution failed: {str(e)}",
            error_code="TOOL_EXECUTION_ERROR",
            details={"server_name": server_name, "tool_name": tool_name}
        )
```

---

## 六、MCP标准调用格式

### 6.1 工具调用请求

```json
{
    "server_name": "github",
    "tool_name": "create_issue",
    "arguments": {
        "owner": "modelcontextprotocol",
        "repo": "servers",
        "title": "Bug report",
        "body": "Description of the bug..."
    }
}
```

### 6.2 成功返回

遵循MCP协议标准格式：

```json
{
    "success": true,
    "server_name": "github",
    "tool_name": "create_issue",
    "result": {
        "content": [
            {
                "type": "text",
                "text": "Issue created successfully: https://github.com/owner/repo/issues/123"
            }
        ],
        "isError": false
    }
}
```

### 6.3 错误返回

```json
{
    "success": false,
    "server_name": "github",
    "tool_name": "create_issue",
    "error": {
        "code": "TOOL_EXECUTION_ERROR",
        "message": "Repository not found",
        "details": {
            "owner": "modelcontextprotocol",
            "repo": "nonexistent"
        }
    }
}
```

---

## 七、文件结构

### 7.1 新增文件

```
backend/SoloAgent/plugins/tools/agent/
├── mcp.py                    # MCPTool实现（新增）
├── skill.py                  # SkillTool实现（已有）
└── task.py                   # TaskTool实现（已有）
```

### 7.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `backend/SoloAgent/solo_agent/agent.py` | 添加`_load_mcp_tools()`方法 |
| `backend/SoloAgent/solo_agent/config.py` | 添加`mcp_tools`配置项 |
| `backend/SoloAgent/solo_agent/compiler/flow_compiler.py` | 完善`_load_mcp_configs()`方法，编译时建立连接获取工具列表 |
| `backend/SoloAgent/plugins/tools/toolkit_executor.py` | 支持MCP工具注册 |

---

## 八、执行方案

### 8.1 第一阶段：创建MCPTool

1. 创建 `backend/SoloAgent/plugins/tools/agent/mcp.py`
2. 实现 `MCPToolInfo` 数据类
3. 实现 `MCPTool` 类
4. 实现 `get_tool_spec()` 方法（包含完整工具列表XML）
5. 实现 `execute()` 方法

### 8.2 第二阶段：修改编译层

1. 修改 `flow_compiler.py` 中的 `_load_mcp_configs()` 方法
2. 从数据库加载MCP服务器配置
3. **编译时建立MCP连接，获取工具列表**
4. 将工具列表和客户端实例一起传递给 `SoloAgentConfig.mcp_tools`

### 8.3 第三阶段：修改Agent层

1. 修改 `SoloAgentConfig` 添加 `mcp_tools` 字段
2. 修改 `SoloAgent.initialize()` 添加 `_load_mcp_tools()` 调用
3. 实现 `_load_mcp_tools()` 方法
4. 创建 `MCPTool` 实例并注册到 `ToolkitExecutor`

### 8.4 第四阶段：测试验证

1. 单元测试：MCPTool的各个方法
2. 集成测试：编译流程（包括MCP连接）
3. 端到端测试：完整的MCP调用流程

---

## 九、与现有MCP Service的关系

### 9.1 架构对比

| 组件 | 现有MCP Service | 新增MCPTool |
|------|-----------------|-------------|
| **位置** | 独立服务(:8992) | Agent内部工具 |
| **生命周期** | 服务级 | Agent级 |
| **实例** | 全局共享 | 每Agent独立 |
| **调用方式** | HTTP API | 工具调用 |

### 9.2 协同工作

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     MCP管理界面                                       │   │
│  │  • 创建/编辑/删除MCP服务器                                            │   │
│  │  • 测试连接                                                          │   │
│  │  • 查看工具列表                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP API
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MCP Service (:8992)                                  │
│  职责：MCP服务器的CRUD管理、连接测试、工具列表查询                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 数据库
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Database                                          │
│  MCPServerModel: 存储MCP服务器配置                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ 编译时读取 + 建立连接
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SoloAgent (Agent级)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ MCPTool: 每个Agent独立的MCP工具实例                                    │   │
│  │  • 完整工具列表暴露                                                   │   │
│  │  • XML标签感知                                                        │   │
│  │  • 工具调用执行                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 职责划分

| 职责 | MCP Service | MCPTool |
|------|-------------|---------|
| MCP服务器CRUD | ✅ | ❌ |
| 连接测试 | ✅ | ❌ |
| 工具列表查询 | ✅ | ✅ |
| 工具调用执行 | ❌ | ✅ |
| XML标签生成 | ❌ | ✅ |

---

## 十、错误处理

### 10.1 MCP服务器不存在

```python
if not server_info:
    return self.create_error_response(
        message=f"MCP server '{server_name}' not found",
        error_code="MCP_SERVER_NOT_FOUND",
        details={"server_name": server_name}
    )
```

### 10.2 连接未建立

```python
if not client:
    return self.create_error_response(
        message=f"MCP server '{server_name}' is not connected",
        error_code="MCP_NOT_CONNECTED"
    )
```

### 10.3 工具不存在

```python
tool_names = [t.get("name") for t in server_info.tools]
if tool_name not in tool_names:
    return self.create_error_response(
        message=f"Tool '{tool_name}' not found on server '{server_name}'",
        error_code="TOOL_NOT_FOUND",
        details={"server_name": server_name, "tool_name": tool_name, "available_tools": tool_names}
    )
```

### 10.4 参数验证失败

```python
validation_error = self._validate_arguments(tool_schema, arguments)
if validation_error:
    return self.create_error_response(
        message=f"Invalid arguments: {validation_error}",
        error_code="INVALID_ARGUMENTS"
    )
```

---

## 十一、性能优化

### 11.1 编译时连接

- MCP连接在编译阶段建立，避免运行时延迟
- 工具列表在编译阶段获取，直接注入到工具中

### 11.2 客户端复用

- 编译时创建的客户端实例直接传递给MCPTool
- 避免重复创建连接

### 11.3 连接池

- 每个Agent维护自己的MCP客户端实例
- 避免重复创建连接

---

## 十二、安全考虑

### 12.1 权限控制

- 每个Agent只能访问其配置的MCP服务器
- MCP服务器按用户隔离

### 12.2 参数验证

- 使用JSON Schema验证工具参数
- 防止注入攻击

### 12.3 错误信息

- 不暴露内部实现细节
- 提供清晰、可操作的错误信息

---

## 十三、总结

本重构方案的核心设计：

1. **完整工具暴露**：MCP工具信息直接暴露给模型，不需要渐进式披露
2. **Agent隔离**：每个Agent有独立的MCPTool实例
3. **编译时注入**：MCP连接和工具列表在编译时获取并注入
4. **标准格式**：遵循MCP协议标准的调用格式和返回值格式

**关键区别**：与Skill不同，MCP工具描述本身就很短，不需要渐进式披露。模型可以直接看到所有可用工具及其参数规范。

---

**文档版本**: 1.1.0  
**最后更新**: 2025-03-25  
**作者**: SoloEngine Team
