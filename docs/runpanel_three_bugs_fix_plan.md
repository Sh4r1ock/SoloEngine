# RunPanel三个Bug修复方案 - 修正版

## 一、设计理念（遵循四层架构）

```
AgenticFlow实例层（run.py） → 负责模型记忆读取、存储、session创建、隔离管理
Compiler层 (flow_compiler.py) → 编译并执行flow，协调多个agent
SoloAgent (agent.py) → 基于ReActCore基类，负责组装各项plugins
ReActCore基类 (react_core.py) → 只负责接收数据、运行，处理LLM调用
LLM API
```

***

## 二、Bug问题描述

### Bug 1: thought/tool_calls折叠逻辑错误

**问题根因**：

- 当前代码（RunPanel.tsx第736-758行）只有"有chunk时展开"的逻辑
- 缺少"当chunk类型变化时折叠之前的reasoning/tool_calls"的逻辑
- 导致流式结束后折叠状态不正确

**正确行为**：

- reasoning和tool_calls默认折叠状态
- 当流式传输reasoning_content、tool_calls时 → 展开
- **当chunk类型变化时（如reasoning→tool_calls，或tool_calls→reasoning，或reasoning/tool_calls→content），立即折叠之前的reasoning/tool_calls**

### Bug 2: "正在思考"完全失效

**问题根因**：

- 第1168行设置`setWaitingLLMReply(true)`后
- 没有任何地方在首个chunk到达时将其重置为false
- 导致"正在思考"无法正常显示

**正确行为**：

- 发送消息后，waitingLLMReply为true；当第一个有效chunk到达时，重置waitingLLMReply为false

### Bug 3: session持久化时机

**问题根因**：

- 后端代码已正确实现：session只在execute处理时创建
- WebSocket连接时不做session创建

**正确行为**：

- 点击"新任务"：创建session但不持久化到数据库
- 发送消息时：将session_id持久化到数据库

***

## 三、修正后的执行内容

### 3.1 Bug 1 - 折叠逻辑（修正补充）

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 3.1.1 新增ref用于记录当前流式传输中的tool_call ids

**位置**：在第209行附近（streamingThinkingRef定义之后）

```typescript
const streamingToolCallIdsRef = useRef<Set<string>>(new Set());
```

#### 3.1.2 修改stream事件处理逻辑

**位置**：第736-758行

```typescript
const currentMsgId = llmMessages[llmMessages.length - 1]?.id || `msg_${Date.now()}`;

// 1. 当chunk类型变化时，折叠之前的reasoning/tool_calls（必须在展开之前执行）
if (currentChunkType && lastChunkType && currentChunkType !== lastChunkType) {
  if (lastChunkType === 'reasoning') {
    setCollapsedReasoning(prev => new Set(prev).add(currentMsgId));
  } else if (lastChunkType === 'tool_calls') {
    // 使用ref中记录的tool_call ids进行折叠
    streamingToolCallIdsRef.current.forEach(tcId => {
      setCollapsedToolCalls(prev => new Set(prev).add(tcId));
    });
    // 清空ref，为下一轮tool_calls做准备
    streamingToolCallIdsRef.current.clear();
  }
}

// 2. 当有chunk时，展开对应的内容（仅reasoning和tool_calls）
if (currentChunkType === 'reasoning') {
  setCollapsedReasoning(prev => {
    const newSet = new Set(prev);
    newSet.delete(currentMsgId);
    return newSet;
  });
} else if (currentChunkType === 'tool_calls') {
  (delta as any).tool_calls?.forEach((tc: any) => {
    if (tc.id) {
      // 记录当前正在流式传输的tool_call id
      streamingToolCallIdsRef.current.add(tc.id);
      // 展开该tool_call
      setCollapsedToolCalls(prev => {
        const newSet = new Set(prev);
        newSet.delete(tc.id);
        return newSet;
      });
    }
  });
}

// 3. 更新lastChunkType
if (currentChunkType) {
  setLastChunkType(currentChunkType);
}
```

#### 3.1.3 在execution_complete中清空ref

**位置**：第860-868行

```typescript
setStreamingContent('');
setStreamingThinkingContent('');
streamingRef.current = '';
streamingThinkingRef.current = '';
streamingToolCallIdsRef.current.clear();  // 新增：清空tool_call ids ref
```

***

### 3.2 Bug 2 - "正在思考"失效（新增实现）

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

**位置**：第760-768行（在stream事件处理中）

```typescript
if (delta.content) {
  // 首个content chunk到达，重置waitingLLMReply
  if (streamingRef.current === '') {
    setWaitingLLMReply(false);
  }
  streamingRef.current += delta.content;
  setStreamingContent(prev => prev + delta.content);
}

if (delta.reasoning_content) {
  // 首个reasoning chunk到达，重置waitingLLMReply
  if (streamingThinkingRef.current === '') {
    setWaitingLLMReply(false);
  }
  streamingThinkingRef.current += delta.reasoning_content;
  setStreamingThinkingContent(prev => prev + delta.reasoning_content);
}
```

**还需要处理legacy格式**（第770-781行）：

```typescript
if (event.content !== undefined && event.content_type !== undefined) {
  const legacyContent = event.content || '';
  const contentType = event.content_type || 'text';

  if (contentType === 'thinking') {
    // 首个thinking chunk到达
    if (streamingThinkingRef.current === '') {
      setWaitingLLMReply(false);
    }
    streamingThinkingRef.current += legacyContent;
    setStreamingThinkingContent(prev => prev + legacyContent);
  } else {
    // 首个content chunk到达
    if (streamingRef.current === '') {
      setWaitingLLMReply(false);
    }
    streamingRef.current += legacyContent;
    setStreamingContent(prev => prev + legacyContent);
  }
}
```

***

### 3.3 Bug 3 - session持久化时机（已正确实现，无需修改）

后端代码（run.py第1091-1104行）已正确实现：

- session只在execute处理时创建
- WebSocket连接时不做session创建

***

## 四、具体执行步骤

### 4.1 第一阶段：修复Bug 1 - 折叠逻辑

#### 步骤1：新增ref

**位置**：第209行附近

```typescript
const streamingToolCallIdsRef = useRef<Set<string>>(new Set());
```

#### 步骤2：修改stream事件处理

**位置**：第736-758行

将现有代码替换为：

```typescript
const currentMsgId = llmMessages[llmMessages.length - 1]?.id || `msg_${Date.now()}`;

// 1. 当chunk类型变化时，折叠之前的reasoning/tool_calls
if (currentChunkType && lastChunkType && currentChunkType !== lastChunkType) {
  if (lastChunkType === 'reasoning') {
    setCollapsedReasoning(prev => new Set(prev).add(currentMsgId));
  } else if (lastChunkType === 'tool_calls') {
    streamingToolCallIdsRef.current.forEach(tcId => {
      setCollapsedToolCalls(prev => new Set(prev).add(tcId));
    });
    streamingToolCallIdsRef.current.clear();
  }
}

// 2. 当有chunk时，展开对应的内容
if (currentChunkType === 'reasoning') {
  setCollapsedReasoning(prev => {
    const newSet = new Set(prev);
    newSet.delete(currentMsgId);
    return newSet;
  });
} else if (currentChunkType === 'tool_calls') {
  (delta as any).tool_calls?.forEach((tc: any) => {
    if (tc.id) {
      streamingToolCallIdsRef.current.add(tc.id);
      setCollapsedToolCalls(prev => {
        const newSet = new Set(prev);
        newSet.delete(tc.id);
        return newSet;
      });
    }
  });
}

// 3. 更新lastChunkType
if (currentChunkType) {
  setLastChunkType(currentChunkType);
}
```

#### 步骤3：在execution_complete中清空ref

**位置**：第860-868行

在`streamingThinkingRef.current = '';`之后添加：

```typescript
streamingToolCallIdsRef.current.clear();
```

### 4.2 第二阶段：修复Bug 2 - "正在思考"失效

**位置**：第760-768行

修改现有代码：

```typescript
if (delta.content) {
  if (streamingRef.current === '') {
    setWaitingLLMReply(false);
  }
  streamingRef.current += delta.content;
  setStreamingContent(prev => prev + delta.content);
}

if (delta.reasoning_content) {
  if (streamingThinkingRef.current === '') {
    setWaitingLLMReply(false);
  }
  streamingThinkingRef.current += delta.reasoning_content;
  setStreamingThinkingContent(prev => prev + delta.reasoning_content);
}
```

**位置**：第770-781行

修改legacy格式处理：

```typescript
if (event.content !== undefined && event.content_type !== undefined) {
  const legacyContent = event.content || '';
  const contentType = event.content_type || 'text';

  if (contentType === 'thinking') {
    if (streamingThinkingRef.current === '') {
      setWaitingLLMReply(false);
    }
    streamingThinkingRef.current += legacyContent;
    setStreamingThinkingContent(prev => prev + legacyContent);
  } else {
    if (streamingRef.current === '') {
      setWaitingLLMReply(false);
    }
    streamingRef.current += legacyContent;
    setStreamingContent(prev => prev + legacyContent);
  }
}
```

### 4.3 第三阶段：验证Bug 3 - 无需修改

后端已正确实现session持久化逻辑。

***

## 五、测试验证计划

### 5.1 测试目标

1. 验证折叠逻辑正确：有chunk时展开，chunk类型变化时折叠（仅reasoning/tool_calls）
2. 验证"正在思考"在首轮chunk前显示，chunk到达后消失
3. 验证点击"新任务"不持久化session，发送消息时才持久化

### 5.2 测试环境

- 登录账号: admin
- 密码: admin123
- 测试URL: http://localhost:8991/run

### 5.3 测试项目（每项执行3轮）

#### 测试1: 折叠逻辑测试

**测试步骤:**

1. 发送消息触发AI回复
2. 观察思考内容是否在流式输出时展开
3. 当chunk类型从reasoning变为content时，观察思考内容是否折叠
4. 验证多次reasoning→tool_calls→reasoning的场景

#### 测试2: "正在思考"占位消息测试

**测试步骤:**

1. 发送消息
2. 观察是否立即显示"正在思考..."
3. 等待首轮chunk返回
4. 观察"正在思考"是否在chunk到达后消失
5. 再次发送消息，重复观察

#### 测试3: Session持久化时机测试

**测试步骤:**

1. 点击"新任务"按钮
2. 检查数据库session数量
3. 发送消息
4. 检查数据库session数量
