# 停止按钮功能重构方案 - 执行版

## 一、设计理念（遵循四层架构）

### 1.1 四层架构原则

```
AgenticFlow实例层（run.py）
    ↓ 职责：模型记忆读取、存储、session创建、隔离管理(管理整个AgenticFlow)
    ↓ 停止职责：接收停止请求、创建cancel_event、向下传递、保存数据、更新状态
Compiler层 (flow_compiler.py)
    ↓ 职责：编译并执行flow，协调多个agent
    ↓ 停止职责：传递cancel_event到各个agent、协调停止信号
SoloAgent (agent.py)
    ↓ 职责：基于ReActCore基类，负责组装各项plugins
    ↓ 停止职责：传递cancel_event到ReActCore
ReActCore基类 (react_core.py)
    ↓ 职责：只负责接收数据、运行.核心执行引擎，处理LLM调用
    ↓ 停止职责：检测cancel_event、中断推理循环、传递到LLM层
LLM API (openai_model.py等)
    ↓ 职责：调用LLM API、处理流式响应
    ↓ 停止职责：检测cancel_event、中断流式循环
```

### 1.2 本次修改遵循的设计原则

1. **逐层传递原则**：cancel_event 从 AgenticFlow实例层创建，逐层向下传递到 LLM API 层
2. **职责单一原则**：每层只负责自己的停止逻辑，不越层处理
3. **主动检测原则**：流式循环主动检测 cancel_event，而非仅依赖异常传播
4. **数据安全原则**：停止时保存已收集的数据，更新 session 状态

---

## 二、当前代码问题分析

### 2.1 已实现但未连接的部分

| 层级 | 文件 | 已有代码 | 问题 |
|------|------|----------|------|
| AgenticFlow实例层 | run.py | ✅ cancel_event 创建 | ❌ 未传递给 FlowRunner.run_from_json |
| Compiler层 | flow_compiler.py | ❌ 无 cancel_event 参数 | 需要添加参数和传递逻辑 |
| SoloAgent层 | agent.py | ❌ 无 cancel_event 参数 | 需要添加参数和传递逻辑 |
| ReActCore层 | react_core.py | ❌ 无 cancel_event 参数 | 需要添加参数和检测逻辑 |
| LLM API层 | openai_model.py | ❌ 无 cancel_event 参数 | 需要在 __call__ 方法中添加参数和检测逻辑 |

### 2.2 前端已实现的功能

| 功能 | 文件 | 状态 |
|------|------|------|
| 按钮切换逻辑 | RunPanel.tsx:2506-2546 | ✅ 已实现 |
| handleStopExecution | RunPanel.tsx:1230-1243 | ✅ 已实现 |
| stopFlow 函数 | useRunWebSocket.ts:372-375 | ✅ 已实现 |
| 停止消息处理 | useRunWebSocket.ts:251-271 | ✅ 已实现 |

### 2.3 后端已实现的功能

| 功能 | 文件 | 状态 |
|------|------|------|
| ExecutionContextManager | execution_context.py | ✅ 已实现 |
| stop 消息处理 | run.py:1068-1095 | ✅ 已实现 |
| cancel_event 创建 | run.py:1145-1152 | ✅ 已实现 |
| CancelledError 处理 | run.py:1166-1174 | ✅ 已实现 |
| 数据保存 | run.py:1200-1237 | ✅ 已实现 |

### 2.4 核心问题：cancel_event 未向下传递

**问题位置**: `run.py:1130-1140`

```python
# 当前代码 - cancel_event 未传递
result = await FlowRunner.run_from_json(
    canvas_data,
    input_message,
    user_id=user_id,
    agentic_flow_id=agentic_flow_id,
    session_id=session_id,
    run_project_id=run_project_id,
    event_callback=event_callback,
    stream_callback=stream_callback_with_collector,
    agent_memories=agent_memories
    # ❌ 缺少 cancel_event=current_cancel_event
)
```

---

## 三、执行内容总览

### 3.1 新增代码

| 文件 | 新增内容 | 位置 |
|------|----------|------|
| 无 | 无 | 无 |

### 3.2 修改代码

| 文件 | 修改内容 | 位置 |
|------|----------|------|
| `backend/app/api/v1/run.py` | 调整 cancel_event 创建时序，传递到 FlowRunner | 第1131行 |
| `backend/app/core/execution_context.py` | `register` 方法添加 cancel_event 参数 | 第95行 |
| `backend/SoloAgent/solo_agent/compiler/flow_compiler.py` | `run_from_json` 添加 cancel_event 参数 | 第887行 |
| `backend/SoloAgent/solo_agent/compiler/flow_compiler.py` | `run` 方法添加 cancel_event 参数 | 第129行 |
| `backend/SoloAgent/solo_agent/compiler/flow_compiler.py` | `_execute_agent` 添加 cancel_event 传递 | 第210行 |
| `backend/SoloAgent/solo_agent/compiler/flow_compiler.py` | `run_node` 添加 cancel_event 参数 | 第942行 |
| `backend/SoloAgent/solo_agent/agent.py` | `reply` 方法添加 cancel_event 参数 | 第286行 |
| `backend/SoloAgent/core/react_core.py` | `reply` 方法添加 cancel_event 参数 | 第291行 |
| `backend/SoloAgent/core/react_core.py` | 推理循环添加 cancel_event 检测 | 第342行 |
| `backend/SoloAgent/core/react_core.py` | `_reasoning` 方法添加 cancel_event 参数 | 第434行 |
| `backend/SoloAgent/model/openai_model.py` | `__call__` 方法添加 cancel_event 参数 | 第213行 |
| `backend/SoloAgent/model/openai_model.py` | `_parse_openai_stream_response` 方法添加 cancel_event 参数 | 第364行 |
| `backend/SoloAgent/model/openai_model.py` | 流式循环添加 cancel_event 检测 | 第401行 |

### 3.3 删除代码

| 文件 | 删除内容 | 位置 |
|------|----------|------|
| 无 | 无 | 无 |

---

## 四、待删除代码配套调用分析

本次重构**不涉及删除代码**，仅新增和修改代码。

---

## 五、具体执行步骤

### 5.1 第一阶段：LLM API 层修改（最底层）

**文件**：`backend/SoloAgent/model/openai_model.py`

#### 5.1.1 __call__ 方法签名添加 cancel_event 参数

**位置**：第213行 `async def __call__` 方法签名

**当前代码**（第213-220行）：
```python
async def __call__(
    self,
    messages: list[dict],
    tools: list[dict] | None = None,
    tool_choice: Literal["auto", "none", "required"] | str | None = None,
    structured_model: Type[BaseModel] | None = None,
    **kwargs: Any,
) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
```

**修改后**：
```python
async def __call__(
    self,
    messages: list[dict],
    tools: list[dict] | None = None,
    tool_choice: Literal["auto", "none", "required"] | str | None = None,
    structured_model: Type[BaseModel] | None = None,
    cancel_event: asyncio.Event = None,
    **kwargs: Any,
) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
```

**说明**：添加 cancel_event 参数，允许上层传递取消信号。

---

#### 5.1.2 _parse_openai_stream_response 方法签名添加 cancel_event 参数

**位置**：第364行 `async def _parse_openai_stream_response` 方法签名

**当前代码**（第364-369行）：
```python
async def _parse_openai_stream_response(
    self,
    start_datetime: datetime,
    response: AsyncStream,
    structured_model: Type[BaseModel] | None = None,
) -> AsyncGenerator[ChatResponse, None]:
```

**修改后**：
```python
async def _parse_openai_stream_response(
    self,
    start_datetime: datetime,
    response: AsyncStream,
    structured_model: Type[BaseModel] | None = None,
    cancel_event: asyncio.Event = None,
) -> AsyncGenerator[ChatResponse, None]:
```

**说明**：添加 cancel_event 参数，用于流式循环检测。

---

#### 5.1.3 __call__ 方法传递 cancel_event 到 _parse_openai_stream_response

**位置**：第341行和第350行 `self._parse_openai_stream_response(...)` 调用

**当前代码**（第341-345行，结构化输出 + 流式）：
```python
return self._parse_openai_stream_response(
    start_datetime,
    response,
    structured_model,
)
```

**修改后**：
```python
return self._parse_openai_stream_response(
    start_datetime,
    response,
    structured_model,
    cancel_event,
)
```

**当前代码**（第350-354行，普通流式）：
```python
return self._parse_openai_stream_response(
    start_datetime,
    response,
    structured_model,
)
```

**修改后**：
```python
return self._parse_openai_stream_response(
    start_datetime,
    response,
    structured_model,
    cancel_event,
)
```

**说明**：在调用 _parse_openai_stream_response 时传递 cancel_event 参数。

---

#### 5.1.4 流式循环添加 cancel_event 检测

**位置**：第401行 `async for item in stream:` 循环内

**当前代码**（第398-410行）：
```python
async with response as stream:
    async for item in stream:
        if structured_model:
            if item.type != "chunk":
                continue
            chunk = item.chunk
        else:
            chunk = item
```

**修改后**：
```python
async with response as stream:
    async for item in stream:
        # 检测取消信号
        if cancel_event and cancel_event.is_set():
            logger.info("[OpenAI] Cancel event detected, stopping stream")
            break
        
        if structured_model:
            if item.type != "chunk":
                continue
            chunk = item.chunk
        else:
            chunk = item
```

**说明**：在流式循环中主动检测 cancel_event，实现即时停止。

---

### 5.2 第二阶段：ReActCore 层修改

**文件**：`backend/SoloAgent/core/react_core.py`

#### 5.2.1 reply 方法添加 cancel_event 参数

**位置**：第291行 `async def reply` 方法签名

**当前代码**（第291行）：
```python
async def reply(self, message: str | Msg) -> Msg:
```

**修改后**：
```python
async def reply(self, message: str | Msg, cancel_event: asyncio.Event = None) -> Msg:
```

**说明**：添加 cancel_event 参数，接收上层传递的取消信号。

---

#### 5.2.2 推理循环添加 cancel_event 检测

**位置**：第342行 `for iteration in range(self.max_iters):` 循环内

**当前代码**（第342-347行）：
```python
for iteration in range(self.max_iters):
    # 检查中断标志
    if self._interrupted:
        logger.info(f"[{self.name}] Execution interrupted by user at iteration {iteration}")
        break
```

**修改后**：
```python
for iteration in range(self.max_iters):
    # 检查中断标志
    if self._interrupted:
        logger.info(f"[{self.name}] Execution interrupted by user at iteration {iteration}")
        break
    
    # 检查取消信号
    if cancel_event and cancel_event.is_set():
        logger.info(f"[{self.name}] Cancel event detected at iteration {iteration}")
        break
```

**说明**：在推理循环中主动检测 cancel_event。

---

#### 5.2.3 _reasoning 方法签名添加 cancel_event 参数

**位置**：第434行 `async def _reasoning` 方法签名

**当前代码**（第434-439行）：
```python
async def _reasoning(
    self,
    user_msg: Msg,
    system_prompt: str,
    iteration: int
) -> ChatResponse:
```

**修改后**：
```python
async def _reasoning(
    self,
    user_msg: Msg,
    system_prompt: str,
    iteration: int,
    cancel_event: asyncio.Event = None
) -> ChatResponse:
```

**说明**：添加 cancel_event 参数。

---

#### 5.2.4 _reasoning 方法传递 cancel_event 到 LLM

**位置**：第472行和第475行 `await self.model(...)` 调用

**当前代码**（第472行）：
```python
response = await self.model(formatted, tools=tools)
```

**修改后**：
```python
response = await self.model(formatted, tools=tools, cancel_event=cancel_event)
```

**当前代码**（第475行）：
```python
response = await self.model(formatted)
```

**修改后**：
```python
response = await self.model(formatted, cancel_event=cancel_event)
```

**说明**：将 cancel_event 传递到 LLM 调用。

---

#### 5.2.5 reply 方法传递 cancel_event 到 _reasoning

**位置**：第350行 `await self._reasoning(...)` 调用

**当前代码**：
```python
reasoning_result = await self._reasoning(
    user_msg, 
    full_system_prompt,
    iteration
)
```

**修改后**：
```python
reasoning_result = await self._reasoning(
    user_msg, 
    full_system_prompt,
    iteration,
    cancel_event
)
```

**说明**：将 cancel_event 从 reply 传递到 _reasoning。

---

### 5.3 第三阶段：SoloAgent 层修改

**文件**：`backend/SoloAgent/solo_agent/agent.py`

#### 5.3.1 reply 方法添加 cancel_event 参数

**位置**：第286行 `async def reply` 方法签名

**当前代码**（第286行）：
```python
async def reply(self, message: str) -> str:
```

**修改后**：
```python
async def reply(self, message: str, cancel_event: asyncio.Event = None) -> str:
```

**说明**：添加 cancel_event 参数。

---

#### 5.3.2 reply 方法传递 cancel_event 到 ReActCore

**位置**：第294行 `response = await self._core.reply(message)` 调用

**当前代码**（第294行）：
```python
response = await self._core.reply(message)
```

**修改后**：
```python
response = await self._core.reply(message, cancel_event=cancel_event)
```

**说明**：将 cancel_event 传递到 ReActCore。

---

### 5.4 第四阶段：Compiler 层修改

**文件**：`backend/SoloAgent/solo_agent/compiler/flow_compiler.py`

#### 5.4.1 run_from_json 添加 cancel_event 参数

**位置**：第887行 `async def run_from_json` 方法签名

**当前代码**（第887-911行）：
```python
@staticmethod
async def run_from_json(
    json_data: Dict[str, Any], 
    input_message: str,
    user_id: str = None,
    agentic_flow_id: str = None,
    session_id: str = None,
    run_project_id: str = None,
    context: Dict[str, Any] = None,
    event_callback: Callable[[ExecutionEvent], None] = None,
    stream_callback: Callable[[dict], None] = None,
    agent_memories: Dict[str, List[Dict]] = None,
) -> Dict[str, Any]:
```

**修改后**：
```python
@staticmethod
async def run_from_json(
    json_data: Dict[str, Any], 
    input_message: str,
    user_id: str = None,
    agentic_flow_id: str = None,
    session_id: str = None,
    run_project_id: str = None,
    context: Dict[str, Any] = None,
    event_callback: Callable[[ExecutionEvent], None] = None,
    stream_callback: Callable[[dict], None] = None,
    agent_memories: Dict[str, List[Dict]] = None,
    cancel_event: asyncio.Event = None,
) -> Dict[str, Any]:
```

**说明**：添加 cancel_event 参数。

---

#### 5.4.2 run_from_json 传递 cancel_event

**位置**：第937行 `return await compiled_flow.run(...)` 调用

**当前代码**（第937行）：
```python
return await compiled_flow.run(input_message, context)
```

**修改后**：
```python
return await compiled_flow.run(input_message, context, cancel_event=cancel_event)
```

**说明**：将 cancel_event 传递到 CompiledFlow.run。

---

#### 5.4.3 CompiledFlow.run 添加 cancel_event 参数

**位置**：第129行 `async def run` 方法签名

**当前代码**（第129行）：
```python
async def run(self, input_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
```

**修改后**：
```python
async def run(self, input_message: str, context: Dict[str, Any] = None, cancel_event: asyncio.Event = None) -> Dict[str, Any]:
```

**说明**：添加 cancel_event 参数。

---

#### 5.4.4 _execute_agent 传递 cancel_event

**位置**：第150行、第173行、第207行 `await self._execute_agent(...)` 调用

**当前代码**（第150行）：
```python
result = await self._execute_agent(agent, input_message, db, context)
```

**修改后**：
```python
result = await self._execute_agent(agent, input_message, db, context, cancel_event=cancel_event)
```

**说明**：将 cancel_event 传递到 _execute_agent。

---

#### 5.4.5 _execute_agent 方法签名添加 cancel_event 参数

**位置**：第210行 `async def _execute_agent` 方法签名

**当前代码**（第210-216行）：
```python
async def _execute_agent(
    self, 
    agent: SoloAgent, 
    input_message: str,
    db,
    context: Dict[str, Any]
) -> Dict[str, Any]:
```

**修改后**：
```python
async def _execute_agent(
    self, 
    agent: SoloAgent, 
    input_message: str,
    db,
    context: Dict[str, Any],
    cancel_event: asyncio.Event = None
) -> Dict[str, Any]:
```

**说明**：添加 cancel_event 参数。

---

#### 5.4.6 _execute_agent 传递 cancel_event 到 SoloAgent

**位置**：第245行 `response = await original_reply(message)` 调用

**当前代码**（第244-245行）：
```python
async def wrapped_reply(message: str) -> str:
    response = await original_reply(message)
```

**修改后**：
```python
async def wrapped_reply(message: str) -> str:
    response = await original_reply(message, cancel_event=cancel_event)
```

**说明**：将 cancel_event 传递到 SoloAgent.reply。

---

#### 5.4.7 run_node 方法添加 cancel_event 参数

**位置**：第942行 `async def run_node` 方法签名

**当前代码**（第942-951行）：
```python
@staticmethod
async def run_node(
    json_data: Dict[str, Any], 
    node_id: str,
    input_message: str,
    user_id: str = None,
    agentic_flow_id: str = None,
    session_id: str = None,
    run_project_id: str = None,
    context: Dict[str, Any] = None,
    agent_memories: Dict[str, List[Dict]] = None,
) -> Dict[str, Any]:
```

**修改后**：
```python
@staticmethod
async def run_node(
    json_data: Dict[str, Any], 
    node_id: str,
    input_message: str,
    user_id: str = None,
    agentic_flow_id: str = None,
    session_id: str = None,
    run_project_id: str = None,
    context: Dict[str, Any] = None,
    agent_memories: Dict[str, List[Dict]] = None,
    cancel_event: asyncio.Event = None,
) -> Dict[str, Any]:
```

**说明**：添加 cancel_event 参数，保持接口一致性。

---

### 5.5 第五阶段：AgenticFlow 实例层修改

**文件**：`backend/app/api/v1/run.py`

#### 5.5.1 修改 cancel_event 的创建时序

**问题说明**：当前代码中 `cancel_event` 在 task 创建后才获取，导致无法在 `run_execution()` 内部使用。

**当前代码时序问题**（第1131-1155行）：
```python
async def run_execution():
    nonlocal status
    result = await FlowRunner.run_from_json(
        ...
        # ❌ 此时 current_cancel_event 还不存在，无法传递
    )
    return result

current_execution_task = asyncio.create_task(run_execution())

context = execution_context_manager.register(...)  # 在这里创建 cancel_event
current_cancel_event = context.cancel_event  # 在这里获取
```

**修改后**（调整时序，先创建 cancel_event）：
```python
# 先创建 cancel_event
current_cancel_event = asyncio.Event()

async def run_execution():
    nonlocal status
    result = await FlowRunner.run_from_json(
        canvas_data,
        input_message,
        user_id=user_id,
        agentic_flow_id=agentic_flow_id,
        session_id=session_id,
        run_project_id=run_project_id,
        event_callback=event_callback,
        stream_callback=stream_callback_with_collector,
        agent_memories=agent_memories,
        cancel_event=current_cancel_event  # ✅ 现在可以传递
    )
    return result

current_execution_task = asyncio.create_task(run_execution())

# 注册时传入已创建的 cancel_event
context = execution_context_manager.register(
    task=current_execution_task,
    user_id=user_id,
    agentic_flow_id=agentic_flow_id,
    session_id=session_id,
    run_project_id=run_project_id,
    cancel_event=current_cancel_event  # 传入已创建的 event
)
```

**说明**：需要修改 `ExecutionContextManager.register` 方法，支持传入外部创建的 `cancel_event`，而不是内部创建。

---

#### 5.5.2 修改 ExecutionContextManager.register 方法

**文件**：`backend/app/core/execution_context.py`

**当前代码**（第95-141行）：
```python
def register(
    self,
    task: asyncio.Task,
    user_id: str,
    agentic_flow_id: str,
    session_id: str,
    run_project_id: str,
    metadata: Dict[str, Any] = None
) -> ExecutionContext:
    key = self._make_key(user_id, agentic_flow_id, session_id, run_project_id)
    cancel_event = asyncio.Event()  # ❌ 内部创建，无法提前使用
    
    context = ExecutionContext(
        task=task,
        cancel_event=cancel_event,
        ...
    )
```

**修改后**：
```python
def register(
    self,
    task: asyncio.Task,
    user_id: str,
    agentic_flow_id: str,
    session_id: str,
    run_project_id: str,
    metadata: Dict[str, Any] = None,
    cancel_event: asyncio.Event = None  # 新增参数
) -> ExecutionContext:
    key = self._make_key(user_id, agentic_flow_id, session_id, run_project_id)
    
    # 使用传入的 cancel_event，如果没有则创建新的
    if cancel_event is None:
        cancel_event = asyncio.Event()
    
    context = ExecutionContext(
        task=task,
        cancel_event=cancel_event,
        ...
    )
```

**说明**：允许外部传入已创建的 cancel_event，保持向后兼容。

---

## 六、接口改动影响分析

### 6.1 run_from_json 接口修改影响

| 调用位置 | 文件 | 需要修改 |
|---------|------|----------|
| `backend/app/api/v1/run.py:1130` | `FlowRunner.run_from_json(...)` | **是** - 添加 cancel_event 参数 |

### 6.2 ExecutionContextManager.register 接口修改影响

| 调用位置 | 文件 | 需要修改 |
|---------|------|----------|
| `backend/app/api/v1/run.py:1148` | `execution_context_manager.register(...)` | **是** - 添加 cancel_event 参数 |

### 6.3 reply 接口修改影响

| 调用位置 | 文件 | 需要修改 |
|---------|------|----------|
| `backend/SoloAgent/solo_agent/compiler/flow_compiler.py:245` | `original_reply(message)` | **是** - 添加 cancel_event 参数 |
| `backend/SoloAgent/solo_agent/agent.py:294` | `self._core.reply(message)` | **是** - 添加 cancel_event 参数 |

### 6.4 __call__ 接口修改影响

| 调用位置 | 文件 | 需要修改 |
|---------|------|----------|
| `backend/SoloAgent/core/react_core.py` | `model(...)` | **是** - 添加 cancel_event 参数 |

---

### 6.5 _parse_openai_stream_response 接口修改影响

| 调用位置 | 文件 | 需要修改 |
|---------|------|----------|
| `backend/SoloAgent/model/openai_model.py` | `_parse_openai_stream_response(...)` | **是** - 添加 cancel_event 参数 |

---

## 七、数据流对比

### 7.1 改进前

```
用户点击停止
    ↓
前端发送 stop 消息
    ↓
后端 run.py 收到 stop
    ↓
cancel_event.set() 设置取消信号
    ↓
task.cancel() 直接取消任务
    ↓
❌ cancel_event 未向下传递
    ↓
依赖 CancelledError 异常传播
    ↓
流式循环可能继续运行直到下一个 chunk
```

**问题**：
- cancel_event 创建后未向下传递
- 流式循环无主动检测
- 停止延迟取决于 chunk 到达时间

### 7.2 改进后

```
用户点击停止
    ↓
前端发送 stop 消息
    ↓
后端 run.py 收到 stop
    ↓
cancel_event.set() 设置取消信号
    ↓
cancel_event 逐层向下传递：
    run.py → flow_compiler.py → agent.py → react_core.py → openai_model.py
    ↓
各层主动检测 cancel_event：
    - react_core.py: 推理循环检测
    - openai_model.py: 流式循环检测
    ↓
立即中断执行
    ↓
保存数据、更新状态
```

**改进**：
- cancel_event 按四层架构逐层传递
- 流式循环主动检测取消信号
- 即时停止，无延迟

---

## 八、数据格式示例

### 8.1 WebSocket 消息格式

**停止请求（前端 → 后端）**:
```json
{
  "type": "stop"
}
```

**停止响应（后端 → 前端）**:
```json
{
  "type": "execution_stopped",
  "session_id": "xxx-xxx-xxx",
  "timestamp": "2026-03-16T12:00:00.000Z",
  "message": "Execution stopped by user"
}
```

**取消响应（后端 → 前端）**:
```json
{
  "type": "execution_cancelled",
  "session_id": "xxx-xxx-xxx",
  "timestamp": "2026-03-16T12:00:00.000Z"
}
```

### 8.2 ExecutionEvent 格式

**停止事件**:
```json
{
  "event_type": "execution_error",
  "status": "stopped",
  "error": "Execution stopped by user",
  "timestamp": "2026-03-16T12:00:00.000Z"
}
```

---

## 九、总结

| 项目 | 改进前 | 改进后 |
|------|--------|--------|
| 架构符合性 | ❌ 不符合四层架构 | ✅ 完全符合四层架构 |
| cancel_event 传递 | ❌ 创建后未传递 | ✅ 逐层传递到 LLM 层 |
| 流式循环检测 | ❌ 无主动检测 | ✅ 主动检测 cancel_event |
| 停止延迟 | ❌ 依赖 chunk 到达 | ✅ 即时停止 |
| 数据保存 | ✅ 已实现 | ✅ 保持不变 |
| session 状态 | ✅ 已实现 | ✅ 保持不变 |
| 前端按钮 | ✅ 已实现 | ✅ 保持不变 |

---

## 十、执行顺序

按照四层架构**自底向上**的顺序执行：

1. **第一阶段**：LLM API 层（openai_model.py）
2. **第二阶段**：ReActCore 层（react_core.py）
3. **第三阶段**：SoloAgent 层（agent.py）
4. **第四阶段**：Compiler 层（flow_compiler.py）
5. **第五阶段**：AgenticFlow 实例层

---

## 十一、注意事项

1. **参数传递**：所有新增的 cancel_event 参数必须设置默认值 `None`，保持向后兼容
2. **异步安全**：在检测 cancel_event 时要注意异步上下文
3. **资源清理**：停止时要正确关闭 HTTP 连接和释放资源
4. **日志记录**：每层停止时记录日志，便于调试
5. **前端状态**：前端已实现，无需修改

---

## 十二、验证清单

### 12.1 代码修改验证

- [ ] openai_model.py: __call__ 方法添加 cancel_event 参数
- [ ] openai_model.py: _parse_openai_stream_response 添加 cancel_event 参数
- [ ] openai_model.py: __call__ 传递 cancel_event 到 _parse_openai_stream_response
- [ ] openai_model.py: 流式循环添加 cancel_event 检测
- [ ] react_core.py: reply 添加 cancel_event 参数
- [ ] react_core.py: 推理循环添加 cancel_event 检测
- [ ] react_core.py: _reasoning 方法添加 cancel_event 参数
- [ ] react_core.py: _reasoning 传递 cancel_event 到 LLM
- [ ] react_core.py: reply 传递 cancel_event 到 _reasoning
- [ ] agent.py: reply 添加 cancel_event 参数
- [ ] agent.py: 传递 cancel_event 到 ReActCore
- [ ] flow_compiler.py: run_from_json 添加 cancel_event 参数
- [ ] flow_compiler.py: run 添加 cancel_event 参数
- [ ] flow_compiler.py: _execute_agent 添加 cancel_event 参数
- [ ] flow_compiler.py: run_node 添加 cancel_event 参数
- [ ] execution_context.py: register 方法添加 cancel_event 参数
- [ ] run.py: 调整 cancel_event 创建时序，传递到 FlowRunner

### 12.2 功能测试验证

- [ ] 点击停止按钮后，按钮变成发送按钮
- [ ] 流式输出立即停止
- [ ] session 状态更新为 stopped
- [ ] session_message 正确保存
