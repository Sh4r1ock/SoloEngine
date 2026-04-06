# MCP调用机制重构方案

## 文档概述

本文档基于对MCP协议标准的深入调研（30+次网络搜索）、对主流MCP Host实现的分析（Cline、Claude Desktop等），以及对项目代码的全面分析（30+个文件），提出MCP调用机制的重构方案。

---

## 一、现状分析

### 1.1 现有MCP实现（半成品）

在 `backend/SoloAgent/solo_agent/agent.py` 中已有MCP工具加载实现：

```python
async def _load_mcp_servers(self, server_names: List[str]) -> List[Dict[str, Any]]:
    """加载MCP服务器工具配置"""
    for server_name in server_names:
        client = MCPClient({...})
        await client.connect()
        tools = await client.get_tools()
        for tool in tools:
            tool_config = self._create_mcp_tool_config(client, tool)
            tool_configs.append(tool_config)
```

**现有实现特点**：
- 采用**直接注册**方式，每个MCP工具独立注册
- 在Agent初始化时建立连接
- 工具名直接使用原始名称（无前缀）

### 1.2 现有问题

| 问题 | 描述 | 影响 |
|------|------|------|
| **与主流不一致** | 直接注册方式与Cline、Claude Desktop等主流实现不一致 | 用户习惯不同 |
| **工具来源不明确** | MCP工具与本地工具混合，模型无法区分来源 | 模型不知道哪些是MCP工具 |
| **无XML标签感知** | 没有使用`<available_mcp_tools>` XML标签 | 模型难以感知MCP工具 |
| **工具名称冲突** | 不同MCP服务器可能有同名工具 | 可能产生命名冲突 |
| **编译时未注入** | MCP信息未在编译时注入到工具中 | 运行时动态获取，效率低 |

### 1.3 主流MCP调用方式

通过调研Cline、Claude Desktop等主流MCP Host，发现标准调用格式：

```xml
<use_mcp_tool>
<server_name>github</server_name>
<tool_name>create_issue</tool_name>
<arguments>
{
  "owner": "modelcontextprotocol",
  "repo": "servers",
  "title": "Bug report"
}
</arguments>
</use_mcp_tool>
```

**主流方案特点**：
- **统一入口**：使用`use_mcp_tool`工具作为所有MCP调用的入口
- **三参数设计**：`server_name` + `tool_name` + `arguments`
- **System Prompt**：在System Prompt中列出所有MCP服务器的工具信息

---

## 二、重构方案

### 2.1 核心架构

**MCP调用机制与Skill类似：从数据库获取配置，编译到MCPTool实例中，直接执行**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      编译阶段 (参考Skill机制)                                 │
│  AgenticFlowCompiler._load_mcp_configs()                                    │
│  → 从数据库加载MCP服务器配置                                                 │
│  → 建立MCP连接，获取工具列表                                                 │
│  → 组装 mcp_servers_info（包含 MCPClient 实例）                              │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Agent初始化阶段                                         │
│  SoloAgent._load_mcp_tools(mcp_servers_info)                                │
│  → 创建 MCPTool(mcp_servers_info=mcp_servers_info)                          │
│  → 注册到 ToolkitExecutor                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                      工具层                                                  │
│  MCPTool: get_tool_spec() → available_mcp_tools XML                         │
│  MCPTool: execute(server_name, tool_name, arguments)                        │
│         → 直接调用 MCPClient.call_tool()                                     │
│         → 返回 MCP 调用结果                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 mcp_service（端口8992）的职责

mcp_service是一个**独立的管理服务**，与Agent的MCP调用**完全隔离**：

| 职责 | 说明 |
|------|------|
| MCP服务器CRUD | 前端管理界面增删改查MCP服务器配置 |
| 连接测试 | 前端测试MCP服务器连接是否正常 |
| 状态监控 | 查看MCP服务器连接状态 |
| 工具列表查看 | 前端查看MCP服务器提供的工具 |

**注意**：Agent执行MCP工具时，**不通过mcp_service**，而是直接使用MCPClient实例。

### 2.3 与Skill机制对比

| 方面 | Skill | MCP |
|------|-------|-----|
| **编译阶段** | `_load_skills_configs()` 加载skill配置 | `_load_mcp_configs()` 加载MCP配置 |
| **连接建立** | 无需连接 | 编译时建立MCP连接 |
| **工具类** | `SkillTool` | `MCPTool` |
| **注册名** | `"Skill"` | `"MCP"` |
| **参数设计** | `name` (skill名称) | `server_name` + `tool_name` + `arguments` |
| **XML标签** | `<available_skills>` | `<available_mcp_tools>` |
| **渐进式披露** | **是** - 需要按需加载 | **否** - 工具描述直接暴露 |
| **执行方式** | 本地执行 | MCPClient直接调用 |
| **实例隔离** | 每个Agent独立SkillTool实例 | 每个Agent独立MCPTool实例 + MCPClient实例 |

### 2.4 可复用的现有代码

| 组件 | 文件 | 复用方式 |
|------|------|----------|
| MCPClient | `plugins/mcp/mcp_client.py` | 直接复用，用于建立连接和调用工具（已支持stdio/sse/http） |
| MCPServerModel | `mcp_service/database.py` | 直接复用，MCP服务器配置存储 |
| ConfigLoader | `solo_agent/loader.py` | 直接复用，加载MCP配置 |
| BaseAgentTool | `plugins/tools/agent/base.py` | 继承，MCPTool基类 |

### 2.5 MCP传输协议支持

**MCPClient**（`plugins/mcp/mcp_client.py`）已完整支持三种MCP传输协议，MCPTool直接使用：

| 协议 | 说明 | 实现方法 |
|------|------|----------|
| **stdio** | 标准输入/输出，本地进程通信 | `MCPClient._connect_stdio()` |
| **sse** | Server-Sent Events，单向推送 | `MCPClient._connect_sse()` |
| **http** | Streamable HTTP，双向通信 | `MCPClient._connect_http()` |

**编译阶段配置示例**：

```python
# 从数据库加载MCP服务器配置后，创建MCPClient实例

# stdio 协议
MCPClient({
    "transport": "stdio",
    "command": "python",
    "args": ["/path/to/server.py"],
    "env": {"API_KEY": "xxx"}
})

# sse 协议
MCPClient({
    "transport": "sse",
    "url": "http://localhost:8080/sse",
    "headers": {"Authorization": "Bearer xxx"}
})

# http 协议
MCPClient({
    "transport": "http",
    "url": "http://localhost:8080/mcp",
    "headers": {"Authorization": "Bearer xxx"}
})
```

### 2.6 与Skill方案设计思路对比

MCP重构方案与Skill重构方案的设计思路**完全一致**：

| 设计要点 | Skill方案 | MCP方案 | 一致性 |
|----------|-----------|---------|--------|
| **编译时注入** | 编译阶段将Skills信息编译到Agent配置 | 编译阶段将MCP服务器信息编译到Agent配置 | ✅ 一致 |
| **构造函数注入** | `SkillTool(skills_info=skills)` | `MCPTool(mcp_servers_info=...)` | ✅ 一致 |
| **XML标签感知** | `<available_skills>` XML | `<available_mcp_tools>` XML | ✅ 一致 |
| **每个Agent独立实例** | 每个Agent有独立SkillTool实例 | 每个Agent有独立MCPTool实例 | ✅ 一致 |
| **直接调用** | SkillTool直接执行，不经过HTTP | MCPTool直接调用MCPClient | ✅ 一致 |
| **渐进式披露** | **有** - 先列表后详情 | **无** - 工具描述直接暴露 | ⚠️ 不同（预期差异） |

**渐进式披露差异说明**：
- Skill需要渐进式披露是因为SKILL.md内容可能很长
- MCP不需要渐进式披露是因为工具描述本身就很短

---

## 三、数据流详解

### 3.1 编译阶段

```
用户画布 JSON (mcp_servers: ["github", "filesystem"])
         ↓
AgenticFlowCompiler._load_mcp_configs()
         ↓
从数据库 MCPServerModel 加载配置
         ↓
为每个MCP服务器创建 MCPClient 实例并建立连接
         ↓
获取工具列表
         ↓
组装 mcp_servers_info:
{
  "github": {
    "server_id": "xxx",
    "server_name": "github",
    "server_description": "GitHub operations...",
    "tools": [
      {"name": "create_issue", "description": "...", "inputSchema": {...}},
      {"name": "list_issues", "description": "...", "inputSchema": {...}}
    ],
    "client": <MCPClient instance>
  },
  "filesystem": {
    "tools": [...],
    "client": <MCPClient instance>
  }
}
         ↓
传递给 SoloAgentConfig.mcp_servers
```

**注意**：编译阶段建立MCP连接，MCPClient实例随Agent生命周期管理。

### 3.2 Agent初始化阶段

```
SoloAgent.initialize()
         ↓
_load_mcp_tools(mcp_servers=mcp_servers_info)
         ↓
创建 MCPTool(mcp_servers_info=mcp_servers_info)
         ↓
注册到 ToolkitExecutor（只有一个工具：MCP）
```

### 3.3 工具规范生成

**MCPTool.get_tool_spec()** 生成包含 `available_mcp_tools` XML 的工具描述：

```json
{
  "name": "MCP",
  "description": "Call a tool from an MCP server.\n\nAvailable MCP tools:\n<available_mcp_tools>\n[github] create_issue: Create a new issue in a GitHub repository\n[github] list_issues: List issues in a GitHub repository\n[filesystem] read_file: Read a file from the filesystem\n</available_mcp_tools>\n\n...",
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

### 3.4 MCP执行阶段

```
模型调用 MCP(server_name="github", tool_name="create_issue", arguments={...})
         ↓
ToolkitExecutor.execute({"name": "MCP", "arguments": {...}})
         ↓
MCPTool.execute(server_name="github", tool_name="create_issue", arguments={...})
         ↓
从 mcp_servers_info 获取对应的 MCPClient 实例
         ↓
直接调用 client.call_tool("create_issue", arguments)
         ↓
返回 MCP 标准格式结果
```

---

## 四、MCPTool详细设计

### 4.1 数据结构

```python
@dataclass
class MCPServerInfo:
    """MCP服务器信息"""
    server_id: str
    server_name: str
    server_description: str = ""
    tools: List[Dict[str, Any]] = field(default_factory=list)
    resources: List[Dict[str, Any]] = field(default_factory=list)
    prompts: List[Dict[str, Any]] = field(default_factory=list)
    client: Optional["MCPClient"] = None
    is_connected: bool = False


@dataclass
class MCPConnectionConfig:
    """MCP连接配置"""
    connect_timeout: int = 30
    call_timeout: int = 60
    max_retries: int = 3
    retry_delay: float = 1.0
```

### 4.2 MCPTool类设计

```python
class MCPTool(BaseAgentTool):
    """MCP工具 - 调用MCP服务器上的工具
    
    参考SkillTool的设计模式：
    - 编译时注入mcp_servers_info（包含MCPClient实例）
    - 统一入口调用方式
    - XML标签展示可用工具
    - 直接调用MCPClient，不通过HTTP
    """
    
    def __init__(
        self,
        mcp_servers_info: Optional[Dict[str, MCPServerInfo]] = None,
        connection_config: Optional[MCPConnectionConfig] = None,
        context: Optional[ToolContext] = None,
        permission: Optional[ToolPermission] = None
    ) -> None:
        super().__init__(context, permission)
        self._mcp_servers_info = mcp_servers_info or {}
        self._connection_config = connection_config or MCPConnectionConfig()
    
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
    
    def _format_available_mcp_tools_xml(self) -> str:
        """生成 available_mcp_tools XML"""
        if not self._mcp_servers_info:
            return "<available_mcp_tools>\nNo MCP tools available.\n</available_mcp_tools>"
        
        lines = ["<available_mcp_tools>"]
        for server_name, server_info in self._mcp_servers_info.items():
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
    
    async def execute(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """执行MCP工具调用 - 直接调用MCPClient"""
        import time
        from datetime import datetime, timezone
        
        start_time = time.time()
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        if not server_name:
            return self._create_error_result(
                error_code="INVALID_SERVER_NAME",
                message="MCP server name is required",
                execution_time=execution_time
            )
        
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info:
            return self._create_error_result(
                error_code="MCP_SERVER_NOT_FOUND",
                message=f"MCP server '{server_name}' not found",
                details={"available_servers": list(self._mcp_servers_info.keys())},
                execution_time=execution_time
            )
        
        if not tool_name:
            return self._create_error_result(
                error_code="INVALID_TOOL_NAME",
                message="Tool name is required",
                execution_time=execution_time,
                server_name=server_name
            )
        
        client = server_info.client
        if not client:
            return self._create_error_result(
                error_code="MCP_NOT_CONNECTED",
                message=f"MCP server '{server_name}' is not connected",
                execution_time=execution_time,
                server_name=server_name,
                tool_name=tool_name
            )
        
        try:
            result = await self._call_with_retry(
                client.call_tool, 
                tool_name, 
                arguments or {}
            )
            call_duration_ms = int((time.time() - start_time) * 1000)
            
            return {
                "success": True,
                "server_name": server_name,
                "tool_name": tool_name,
                "content": json.dumps({
                    "result": result
                }, ensure_ascii=False),
                "metadata": {
                    "execution_time": execution_time,
                    "server_id": server_info.server_id,
                    "connection_status": "connected",
                    "call_duration_ms": call_duration_ms
                }
            }
        except Exception as e:
            return self._create_error_result(
                error_code="TOOL_EXECUTION_ERROR",
                message=f"Tool execution failed: {str(e)}",
                details={"server_name": server_name, "tool_name": tool_name},
                execution_time=execution_time,
                server_name=server_name,
                tool_name=tool_name
            )
    
    async def _call_with_retry(
        self, 
        func, 
        *args, 
        **kwargs
    ) -> Any:
        """带重试的调用"""
        last_error = None
        for attempt in range(self._connection_config.max_retries):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                last_error = e
                if attempt < self._connection_config.max_retries - 1:
                    await asyncio.sleep(self._connection_config.retry_delay * (attempt + 1))
        raise last_error
    
    def _create_error_result(
        self,
        error_code: str,
        message: str,
        execution_time: str,
        details: Dict[str, Any] = None,
        server_name: str = None,
        tool_name: str = None
    ) -> Dict[str, Any]:
        """创建错误返回结果"""
        return {
            "success": False,
            "server_name": server_name,
            "tool_name": tool_name,
            "content": json.dumps({
                "error": {
                    "code": error_code,
                    "message": message,
                    "details": details or {}
                }
            }, ensure_ascii=False),
            "metadata": {
                "execution_time": execution_time,
                "error_code": error_code
            }
        }
    
    async def disconnect(self, server_name: str = None) -> Dict[str, Any]:
        """断开MCP连接"""
        from datetime import datetime, timezone
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        disconnected_servers = []
        
        if server_name:
            server_info = self._mcp_servers_info.get(server_name)
            if server_info and server_info.client:
                await server_info.client.disconnect()
                server_info.client = None
                server_info.is_connected = False
                disconnected_servers.append(server_name)
        else:
            for name, server_info in self._mcp_servers_info.items():
                if server_info.client:
                    await server_info.client.disconnect()
                    server_info.client = None
                    server_info.is_connected = False
                    disconnected_servers.append(name)
        
        return {
            "success": True,
            "content": json.dumps({
                "disconnected_servers": disconnected_servers
            }, ensure_ascii=False),
            "metadata": {
                "execution_time": execution_time
            }
        }
    
    async def list_resources(self, server_name: str) -> Dict[str, Any]:
        """列出MCP服务器的资源"""
        from datetime import datetime, timezone
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info:
            return self._create_error_result(
                error_code="MCP_SERVER_NOT_FOUND",
                message=f"MCP server '{server_name}' not found",
                execution_time=execution_time
            )
        
        return {
            "success": True,
            "server_name": server_name,
            "content": json.dumps({
                "resources": server_info.resources
            }, ensure_ascii=False),
            "metadata": {
                "execution_time": execution_time,
                "server_id": server_info.server_id
            }
        }
    
    async def read_resource(self, server_name: str, uri: str) -> Dict[str, Any]:
        """读取MCP资源"""
        import time
        from datetime import datetime, timezone
        
        start_time = time.time()
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info or not server_info.client:
            return self._create_error_result(
                error_code="MCP_NOT_CONNECTED",
                message=f"MCP server '{server_name}' is not connected",
                execution_time=execution_time,
                server_name=server_name
            )
        
        try:
            result = await server_info.client.read_resource(uri)
            call_duration_ms = int((time.time() - start_time) * 1000)
            
            return {
                "success": True,
                "server_name": server_name,
                "content": json.dumps({
                    "resource": result
                }, ensure_ascii=False),
                "metadata": {
                    "execution_time": execution_time,
                    "uri": uri,
                    "call_duration_ms": call_duration_ms
                }
            }
        except Exception as e:
            return self._create_error_result(
                error_code="RESOURCE_READ_ERROR",
                message=f"Failed to read resource: {str(e)}",
                execution_time=execution_time,
                server_name=server_name
            )
    
    async def list_prompts(self, server_name: str) -> Dict[str, Any]:
        """列出MCP服务器的提示词"""
        from datetime import datetime, timezone
        execution_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info:
            return self._create_error_result(
                error_code="MCP_SERVER_NOT_FOUND",
                message=f"MCP server '{server_name}' not found",
                execution_time=execution_time
            )
        
        return {
            "success": True,
            "server_name": server_name,
            "content": json.dumps({
                "prompts": server_info.prompts
            }, ensure_ascii=False),
            "metadata": {
                "execution_time": execution_time,
                "server_id": server_info.server_id
            }
        }
```

---

## 五、MCPTool返回值规范

### 5.1 返回值字段说明

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `success` | boolean | 是 | 执行是否成功 |
| `server_name` | string | 否 | MCP服务器名称 |
| `tool_name` | string | 否 | 工具名称 |
| `content` | string | 是 | 返回给agent的主要内容（JSON字符串格式） |
| `metadata` | object | 是 | 元数据，不传入模型，用于调试 |

### 5.2 metadata字段说明

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `execution_time` | string | 是 | ISO 8601格式时间戳，记录执行时间 |
| `server_id` | string | 否 | MCP服务器ID |
| `connection_status` | string | 否 | 连接状态 |
| `call_duration_ms` | integer | 否 | 调用耗时（毫秒） |
| `error_code` | string | 否 | 错误代码（失败时） |

### 5.3 成功返回示例

```python
return {
    "success": True,
    "server_name": "github",
    "tool_name": "create_issue",
    "content": json.dumps({
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": "Issue created successfully: https://github.com/owner/repo/issues/123"
                }
            ],
            "isError": False
        }
    }, ensure_ascii=False),
    "metadata": {
        "execution_time": "2026-03-25T10:00:00Z",
        "server_id": "xxx-xxx-xxx",
        "connection_status": "connected",
        "call_duration_ms": 150
    }
}
```

### 5.4 错误返回示例

```python
return {
    "success": False,
    "server_name": "github",
    "tool_name": "create_issue",
    "content": json.dumps({
        "error": {
            "code": "TOOL_EXECUTION_ERROR",
            "message": "Repository not found",
            "details": {
                "owner": "modelcontextprotocol",
                "repo": "nonexistent"
            }
        }
    }, ensure_ascii=False),
    "metadata": {
        "execution_time": "2026-03-25T10:00:00Z",
        "error_code": "TOOL_EXECUTION_ERROR"
    }
}
```

### 5.5 与SkillTool返回值对比

| 字段 | SkillTool | MCPTool | 说明 |
|------|-----------|---------|------|
| `success` | ✅ | ✅ | 执行状态 |
| `skill_name`/`server_name` | ✅ | ✅ | 名称标识 |
| `tool_name` | ❌ | ✅ | MCP特有：工具名称 |
| `content` | ✅ | ✅ | 主要内容 |
| `metadata` | ✅ | ✅ | 元数据 |
| `metadata.execution_time` | ❌ | ✅ | MCPTool必须包含 |
| `metadata.resources_used` | ✅ | ❌ | SkillTool特有 |
| `metadata.call_duration_ms` | ❌ | ✅ | MCPTool特有 |

---

## 六、画布配置格式

### 6.1 节点配置示例

```json
{
  "nodes": [
    {
      "id": "agent-1",
      "type": "agent",
      "data": {
        "name": "My Agent",
        "model": "gpt-4",
        "mcp_servers": ["github", "filesystem"],
        "skills": ["algorithmic-art"],
        "system_prompt": "You are a helpful assistant."
      }
    }
  ]
}
```

### 6.2 MCP服务器配置字段

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `mcp_servers` | array | 否 | MCP服务器名称列表 |

---

## 七、生命周期管理

### 7.1 连接管理

```python
class MCPTool(BaseAgentTool):
    async def connect(self, server_name: str) -> Dict[str, Any]:
        """建立MCP连接"""
        pass
    
    async def disconnect(self, server_name: str = None) -> Dict[str, Any]:
        """断开MCP连接"""
        pass
    
    async def reconnect(self, server_name: str) -> Dict[str, Any]:
        """重新连接MCP服务器"""
        pass
```

### 7.2 连接状态监控

```python
class MCPTool(BaseAgentTool):
    def get_connection_status(self, server_name: str) -> str:
        """获取连接状态"""
        server_info = self._mcp_servers_info.get(server_name)
        if not server_info:
            return "not_found"
        if server_info.is_connected and server_info.client:
            return "connected"
        return "disconnected"
    
    def get_all_connection_status(self) -> Dict[str, str]:
        """获取所有服务器连接状态"""
        return {
            name: self.get_connection_status(name)
            for name in self._mcp_servers_info.keys()
        }
```

### 7.3 资源清理

```python
class MCPTool(BaseAgentTool):
    async def cleanup(self) -> None:
        """清理所有资源"""
        await self.disconnect()
        self._mcp_servers_info.clear()
```

---

## 八、错误处理

### 8.1 错误代码定义

| 错误代码 | 描述 |
|----------|------|
| `INVALID_SERVER_NAME` | 服务器名称无效 |
| `MCP_SERVER_NOT_FOUND` | MCP服务器未找到 |
| `INVALID_TOOL_NAME` | 工具名称无效 |
| `MCP_NOT_CONNECTED` | MCP服务器未连接 |
| `TOOL_EXECUTION_ERROR` | 工具执行错误 |
| `CONNECTION_TIMEOUT` | 连接超时 |
| `CALL_TIMEOUT` | 调用超时 |
| `RESOURCE_READ_ERROR` | 资源读取错误 |

### 8.2 超时处理

```python
class MCPTool(BaseAgentTool):
    async def execute_with_timeout(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
        timeout: int = None
    ) -> Dict[str, Any]:
        """带超时的执行"""
        timeout = timeout or self._connection_config.call_timeout
        try:
            return await asyncio.wait_for(
                self.execute(server_name, tool_name, arguments),
                timeout=timeout
            )
        except asyncio.TimeoutError:
            return self._create_error_result(
                error_code="CALL_TIMEOUT",
                message=f"Tool call timed out after {timeout} seconds",
                execution_time=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                server_name=server_name,
                tool_name=tool_name
            )
```

### 8.3 重试机制

```python
class MCPTool(BaseAgentTool):
    async def _call_with_retry(
        self, 
        func, 
        *args, 
        **kwargs
    ) -> Any:
        """带重试的调用"""
        last_error = None
        for attempt in range(self._connection_config.max_retries):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                last_error = e
                if attempt < self._connection_config.max_retries - 1:
                    await asyncio.sleep(
                        self._connection_config.retry_delay * (attempt + 1)
                    )
        raise last_error
```

---

## 九、文件修改清单

### 9.1 新增文件

| 文件 | 内容 |
|------|------|
| `backend/SoloAgent/plugins/tools/agent/mcp.py` | MCPTool实现 |

### 9.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `backend/SoloAgent/solo_agent/compiler/flow_compiler.py` | 添加`_load_mcp_configs()`方法，编译时建立MCP连接 |
| `backend/SoloAgent/solo_agent/agent.py` | 修改`_load_mcp_servers()`为`_load_mcp_tools()`，创建MCPTool实例 |
| `backend/SoloAgent/solo_agent/config.py` | 添加`mcp_servers`配置项 |

---

## 十、执行方案

### 10.1 第一阶段：创建MCPTool

1. 创建 `backend/SoloAgent/plugins/tools/agent/mcp.py`
2. 实现 `MCPServerInfo` 和 `MCPConnectionConfig` 数据类
3. 实现 `MCPTool` 类（参考SkillTool设计）
4. 实现 `get_tool_spec()` 方法（包含完整工具列表XML）
5. 实现 `execute()` 方法
6. 实现生命周期管理方法
7. 实现错误处理和重试机制

### 10.2 第二阶段：修改编译层

1. 在 `flow_compiler.py` 中添加 `_load_mcp_configs()` 方法
2. 从数据库加载MCP服务器配置
3. **编译时建立MCP连接，获取工具列表**
4. 添加连接超时和失败降级处理
5. 将工具列表和客户端实例传递给Agent

### 10.3 第三阶段：修改Agent层

1. 修改 `SoloAgentConfig` 添加 `mcp_servers` 字段
2. 修改 `SoloAgent.initialize()` 添加 `_load_mcp_tools()` 调用
3. 实现 `_load_mcp_tools()` 方法
4. 创建 `MCPTool` 实例并注册到 `ToolkitExecutor`
5. 添加资源清理逻辑

### 10.4 第四阶段：测试验证

1. 单元测试：MCPTool的各个方法
2. 集成测试：编译流程（包括MCP连接）
3. 端到端测试：完整的MCP调用流程
4. 错误场景测试：连接失败、超时、重试

---

## 十一、与现有MCP Service的关系

### 11.1 职责划分

mcp_service（端口8992）是一个**独立的管理服务**，与Agent的MCP调用**完全隔离**：

| 职责 | MCP Service (:8992) | MCPTool |
|------|---------------------|---------|
| MCP服务器CRUD | ✅ 前端管理界面 | ❌ |
| 连接测试 | ✅ 前端测试连接 | ❌ |
| 状态监控 | ✅ 查看连接状态 | ❌ |
| 工具列表查看 | ✅ 前端查看工具 | ❌ |
| 工具调用执行 | ❌ | ✅ 直接调用MCPClient |
| System Prompt生成 | ❌ | ✅ |

### 11.2 完全隔离的架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端管理界面                              │
│   MCP服务器配置 / 连接测试 / 状态监控                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTP API
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Service (:8992)                           │
│   lifecycle_manager / unified_caller / service_registry         │
│   用于前端管理，与Agent调用无关                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Agent运行时                               │
│   MCPTool → MCPClient → MCP Server                              │
│   完全独立，不经过mcp_service                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 11.3 数据共享

Agent和mcp_service共享同一数据库中的MCP服务器配置：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Database                                  │
│   MCPServerModel / MCPStdioConfigModel / ...                    │
└─────────────────────────────────────────────────────────────────┘
         ↓                                    ↓
┌─────────────────────┐            ┌─────────────────────┐
│   MCP Service       │            │   AgenticFlow       │
│   前端管理读取配置   │            │   Compiler读取配置   │
└─────────────────────┘            └─────────────────────┘
```

---

## 十二、总结

### 12.1 核心设计

1. **统一入口**：使用`MCP`工具作为所有MCP调用的入口
2. **三参数设计**：`server_name` + `tool_name` + `arguments`
3. **参考Skill机制**：编译时注入、统一入口、XML标签
4. **复用现有代码**：MCPClient、MCPServerModel、ConfigLoader
5. **直接调用**：MCPTool直接调用MCPClient，不经过HTTP

### 12.2 与现有实现对比

| 方面 | 现有实现（直接注册） | 新方案（统一入口） |
|------|---------------------|-------------------|
| **工具注册** | 每个MCP工具独立注册 | 只有一个`MCP`工具 |
| **调用方式** | 直接调用工具名 | `MCP(server_name, tool_name, arguments)` |
| **名称冲突** | 可能冲突 | 不冲突 |
| **主流一致性** | ❌ | ✅ |
| **参考模式** | - | SkillTool |

### 12.3 关键优势

1. **与主流一致**：与Cline、Claude Desktop等主流实现一致
2. **避免名称冲突**：不同MCP服务器的同名工具不会冲突
3. **清晰的服务器归属**：模型明确知道工具来自哪个服务器
4. **复用现有代码**：最大化利用已有的MCPClient等组件
5. **完善的错误处理**：超时、重试、生命周期管理
6. **架构隔离**：Agent调用与mcp_service管理服务完全隔离

### 12.4 实例隔离保证

- 每个Agent拥有独立的`MCPTool`实例
- 每个Agent拥有独立的`MCPClient`实例列表
- 多Agent并发执行时，MCP调用互不干扰
- mcp_service（端口8992）仅用于前端管理，与Agent调用无关

---

**文档版本**: 6.1.0  
**最后更新**: 2025-03-26  
**作者**: SoloEngine Team
