# 运行面板Bug修复方案（详细验证版）

## 一、设计理念（遵循现有架构）

### 1.1 架构层次

```
前端层 (React + Zustand)
    ├── RunPanel.tsx - 主面板组件（对话栏UI）
    ├── useRunWebSocket.ts - WebSocket连接管理
    ├── runStore.ts - 状态管理（Zustand + persist）
    └── runApi.ts - HTTP API调用

后端层 (FastAPI)
    ├── run.py - 运行API端点
    ├── database.py - 数据模型定义

数据层 (SQLite)
    ├── AgenticFlowSessionModel - 会话元数据
    └── SessionMessageModel - 会话消息
```

### 1.2 设计原则

1. **最小化修改范围** - 仅修改必要的代码
2. **复用现有机制** - 优先使用现有函数和数据
3. **不新增不必要的API** - 能在前端处理的就在前端处理
4. **统一复用逻辑** - 相同功能使用同一个函数

---

## 二、Bug原因详细分析（假设-验证-反驳）

### 2.1 Bug1：流式输出缩进一致性问题

**问题现象**：流式输出时有缩进（左边距），但运行完毕后缩进消失。

#### 假设1：流式输出内容区域没有padding-left

**验证**: 查看第2363-2372行代码：
```tsx
{streamingContent && (
  <div style={{ 
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.7, 
    fontSize: 14, 
    color: 'var(--text-100)',
  }}>
    {streamingContent}
  </div>
)}
```
**结果**: 确实没有padding-left。

#### 假设2：历史消息内容区域没有padding-left

**验证**: 查看第2284-2292行代码：
```tsx
<div style={{ 
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  lineHeight: 1.7,
  fontSize: 14,
  color: 'var(--text-100)',
}}>
  {msg.content}
</div>
```
**结果**: 确实没有padding-left。

#### 假设3：流式输出有头像偏移，历史消息没有

**验证**: 

流式输出结构（第2296-2375行）：
```tsx
<div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
  <div style={{ width: 28, height: 28, ... }}>  // 头像 28px
    <RobotOutlined ... />
  </div>
  <div style={{ flex: 1, minWidth: 0 }}>  // 内容区域在flex容器内
    ...
    {streamingContent && (
      <div style={{ ... }}>  // 内容没有padding-left
        {streamingContent}
      </div>
    )}
  </div>
</div>
```
**结果**: 流式输出使用 `display: 'flex', gap: 8`，头像28px + gap 8px = 36px偏移。内容在 `flex: 1` 的容器内。

历史消息结构（第2105-2294行）：
```tsx
<div style={{
  display: 'flex',
  flexDirection: 'column',  // 垂直排列
  gap: 8,
  alignItems: 'stretch',
}}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, ... }}>
    <div style={{ width: 28, height: 28, ... }}>头像</div>
    <Text>AI助手</Text>
    <Text>时间</Text>
  </div>
  <div style={{ ... }}>  // 内容区域直接在column容器内，没有左侧偏移！
    {msg.content}
  </div>
</div>
```
**结果**: 历史消息使用 `flexDirection: 'column'`，头像和名称在第一行，内容在第二行。**内容区域没有左侧偏移！**

#### 结论

**真实原因**：
- 流式输出：使用 `flexDirection: 'row'`，头像在左侧，内容在右侧容器内，有36px偏移
- 历史消息：使用 `flexDirection: 'column'`，头像和名称在第一行，内容在第二行，**内容没有左侧偏移**

**修复方案**：在历史消息内容区域添加 `padding: '0 0 0 36px'`，使两者一致。

---

### 2.2 Bug2：Session创建时机问题

**问题现象**：
1. 点击新任务，会在任务栏创建新任务
2. 进入运行面板后对话记录只有角色栏，但是对话记录是空的
3. 任务信息只能有一行
4. 任务统计UI有底色和边框

#### 假设1：createNewSession在点击时创建Session栏项目

**验证**: 查看第816-848行代码：
```tsx
const createNewSession = useCallback((name?: string) => {
  ...
  const newSession: ExtendedRunSession = {
    id: newSessionId,
    status: 'pending',
    name: name || `会话 ${sessions.length + 1}`,
    createdAt: new Date().toISOString(),
    messages: [],
  };
  setSessions(prev => [newSession, ...prev]);  // 第838行：创建Session栏项目！
  setLlmMessages([]);
  ...
  return newSession;
}, [sessions.length, setCurrentSessionId, agenticFlowId, currentProject?.id]);
```
**结果**: **确认！** 第838行 `setSessions(prev => [newSession, ...prev])` 会创建Session栏项目。

#### 假设2：restoreSession在Session不存在时没有清除currentSessionId

**验证**: 查看第349-387行代码：
```tsx
useEffect(() => {
  const restoreSession = async () => {
    ...
    if (storedSessionId) {
      try {
        const messages = await runApi.getSessionMessages(storedSessionId);
        ...
      } catch (error) {
        console.log('Stored session not in database');  // 只打印日志！
        // 没有清除currentSessionId和重置llmMessages！
      }
    }
    ...
  };
  restoreSession();
}, [agenticFlowId, currentProject?.id]);
```
**结果**: **确认！** catch块只打印日志，没有清除currentSessionId和重置llmMessages。

#### 假设3：任务信息没有设置为单行显示

**验证**: 查看第1991-2001行代码：
```tsx
<div style={{ 
  fontSize: 11, 
  opacity: 0.65, 
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  // 没有 whiteSpace: 'nowrap' 和 overflow: 'hidden'！
}}>
  <span>{getStatusText(session.status)}</span>
  <span>·</span>
  <span>{formatSmartTime(session.createdAt || session.created_at)}</span>
</div>
```
**结果**: **确认！** 没有 `whiteSpace: 'nowrap'` 和 `overflow: 'hidden'`。

#### 假设4：任务统计UI有底色和边框

**验证**: 查看第1898-1913行代码：
```tsx
{sessions.length > 0 && (
  <div style={{ 
    marginTop: 8, 
    padding: '8px 12px', 
    background: 'var(--bg-300)',  // 有底色！
    borderRadius: 6,  // 有边框！
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }}>
    <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>任务总数</Text>
    <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
      {sessions.length}
    </Text>
  </div>
)}
```
**结果**: **确认！** 有 `background: 'var(--bg-300)'` 和 `borderRadius: 6`。

#### 结论

**真实原因**：以上四个假设都是正确的。

**修复方案**：
1. 删除第838行，不在点击"新任务"时创建Session栏项目
2. 在catch块中清除currentSessionId并重置llmMessages
3. 添加 `whiteSpace: 'nowrap'` 和 `overflow: 'hidden'`
4. 移除 `background` 和 `borderRadius`

---

### 2.3 Bug3：首个chunk等待状态问题

**问题现象**：
1. 用户发送消息后同步显示"等待状态"。现在完全没实现。
2. 在模型名称旁边用"正在输出"替代"时间"，这是严厉禁止的。

#### 假设1：等待状态UI的条件不正确

**验证**: 查看第2079-2103行代码：
```tsx
) : (llmLoading || isRunning) && !streamingContent && !streamingThinkingContent ? (
  <div style={{ ... }}>
    <LoadingOutlined ... />
    <Text>正在思考中...</Text>
  </div>
) : (
```
**结果**: 条件 `(llmLoading || isRunning) && !streamingContent && !streamingThinkingContent` 是正确的。

#### 假设2：发送消息后用户消息被添加到llmMessages，导致条件不满足

**验证**: 查看第1009-1068行 handleSendLLMMessage：
```tsx
const handleSendLLMMessage = async () => {
  ...
  const userMessage: LLMMessage = { ... };
  setLlmMessages(prev => [...prev, userMessage]);  // 用户消息被添加！
  ...
  setLlmLoading(true);
  startRunning();
  ...
};
```

**分析条件逻辑**（第2050-2104行）：
```tsx
{llmMessages.length === 0 && !streamingContent && !streamingThinkingContent && !(llmLoading || isRunning) ? (
  // 空状态
) : (llmLoading || isRunning) && !streamingContent && !streamingThinkingContent ? (
  // 等待状态 - 替代整个消息列表！
) : (
  // 消息列表
)}
```

**场景分析**：
- 用户发送消息后：`llmMessages.length > 0`，`llmLoading = true`，`streamingContent = ''`
- 第一个条件不满足（`llmMessages.length === 0` 为 false）
- 第二个条件满足（`(llmLoading || isRunning) && !streamingContent && !streamingThinkingContent` 为 true）
- **结果：显示等待状态UI，替代整个消息列表！**

**反驳**: 用户发送消息后，应该显示消息列表（包含用户消息），然后在消息列表内部显示等待状态（如spinner），而不是替代整个消息列表！

**结果**: **确认！** 这是问题所在。等待状态UI替代了整个消息列表，而不是在消息列表内部显示。

#### 假设3："正在输出..."字样不应该存在

**验证**: 查看第2311-2313行代码：
```tsx
<div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
  <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
  <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>正在输出...</Text>  // 应该显示时间！
</div>
```
**结果**: **确认！** 第2313行显示了"正在输出..."，应该显示时间。

#### 结论

**真实原因**：
1. 等待状态UI的条件逻辑有问题：当用户发送消息后，等待状态UI替代了整个消息列表，而不是在消息列表内部显示
2. "正在输出..."应该改为时间

**修复方案**：
1. **修改条件逻辑**：删除单独的等待状态UI分支，在消息列表内部显示等待状态
2. **删除"正在输出..."**：显示时间

---

### 2.4 Bug4：运行面板布局与滚动条问题

**问题现象**：整个页面似乎超出了正常浏览器状态。

#### 假设1：Layout的父容器不是100vh

**验证**: 查看第1727行代码：
```tsx
<Layout style={{ height: '100%', background: 'var(--bg-100)' }}>
```
**结果**: Layout的高度是100%，依赖于它的父容器。如果父容器不是100vh，会导致问题。

#### 假设2：`calc(100% - 52px)` 计算不正确

**验证**: 查看第1858-1864行代码：
```tsx
<div ref={containerRef} style={{ 
  height: 'calc(100% - 52px)',  // 依赖于父容器的高度
  position: 'relative', 
  display: 'flex',
  flexDirection: 'row',
  background: 'var(--bg-100)',
}}>
```
**结果**: 主容器使用 `height: 'calc(100% - 52px)'`，依赖于父容器的高度。

#### 假设3：某些子元素超出了容器高度

**验证**: 查看消息列表容器第2040-2049行代码：
```tsx
<div style={{ 
  flex: 1, 
  overflow: 'auto', 
  overflowX: 'hidden',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-100)',
  minHeight: 0,  // 正确
}}>
```
**结果**: 消息列表容器有 `minHeight: 0`，这是正确的。

#### 结论

**真实原因**：主容器使用 `height: 'calc(100% - 52px)'` 依赖于父容器的高度。如果父容器的高度不是100vh，会导致问题。应该使用 `calc(100vh - 52px)` 直接计算。

**修复方案**：使用 `height: 'calc(100vh - 52px)'` 替代 `height: 'calc(100% - 52px)'`，并添加 `overflow: 'hidden'` 防止内容溢出。

---

## 三、执行内容总览

### 3.1 新增代码

无

### 3.2 修改代码

| 文件 | 修改内容 | 位置 |
|------|----------|------|
| `RunPanel.tsx` | 历史消息内容区域添加padding-left: 36px | 第2284-2292行 |
| `RunPanel.tsx` | 删除"正在输出..."文本，显示时间 | 第2311-2313行 |
| `RunPanel.tsx` | 删除单独的等待状态UI分支 | 第2079-2103行 |
| `RunPanel.tsx` | 任务信息显示改为单行 | 第1991-2001行 |
| `RunPanel.tsx` | 任务统计UI移除底色和边框 | 第1898-1913行 |
| `RunPanel.tsx` | createNewSession函数修改 | 第816-848行 |
| `RunPanel.tsx` | restoreSession逻辑修改 | 第349-387行 |
| `RunPanel.tsx` | 主容器高度计算修改 | 第1858-1864行 |

### 3.3 删除代码

无

---

## 四、具体执行步骤

### 4.1 第一阶段：修复流式输出缩进一致性问题

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.1.1 历史消息内容区域添加padding-left

**位置**：第2284-2292行

```tsx
// 修改前
<div style={{ 
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  lineHeight: 1.7,
  fontSize: 14,
  color: 'var(--text-100)',
}}>
  {msg.content}
</div>

// 修改后
<div style={{ 
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  lineHeight: 1.7,
  fontSize: 14,
  color: 'var(--text-100)',
  padding: '0 0 0 36px',
}}>
  {msg.content}
</div>
```

**说明**：添加 `padding: '0 0 0 36px'` 使历史消息内容区域与流式输出内容区域的左侧偏移一致（36px = 28px头像 + 8px gap）。

---

### 4.2 第二阶段：修复首个chunk等待状态问题

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.2.1 删除单独的等待状态UI分支

**位置**：第2050-2104行

```tsx
// 修改前
{llmMessages.length === 0 && !streamingContent && !streamingThinkingContent && !(llmLoading || isRunning) ? (
  <div style={{ ... }}>
    // 空状态UI
  </div>
) : (llmLoading || isRunning) && !streamingContent && !streamingThinkingContent ? (
  <div style={{ ... }}>
    // 等待状态UI - 替代整个消息列表！
  </div>
) : (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    // 消息列表
  </div>
)}

// 修改后
{llmMessages.length === 0 && !streamingContent && !streamingThinkingContent && !(llmLoading || isRunning) ? (
  <div style={{ ... }}>
    // 空状态UI
  </div>
) : (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    // 消息列表
    // 等待状态在消息列表内部显示
  </div>
)}
```

**说明**：删除单独的等待状态UI分支，让等待状态在消息列表内部显示。

#### 4.2.2 在消息列表内部显示等待状态

**位置**：第2295行之后（消息列表末尾）

```tsx
// 在 </div> 之前添加等待状态
{(llmLoading || isRunning) && !streamingContent && !streamingThinkingContent && llmMessages.length > 0 && (
  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
    <div style={{
      width: 28,
      height: 28,
      borderRadius: 6,
      background: 'linear-gradient(135deg, var(--primary-100), var(--primary-200))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <LoadingOutlined style={{ color: '#fff', fontSize: 14 }} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
        <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>{formatTime(new Date().toISOString())}</Text>
      </div>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 8,
        padding: '8px 0',
      }}>
        <LoadingOutlined style={{ fontSize: 14, color: 'var(--primary-100)' }} />
        <Text style={{ fontSize: 13, color: 'var(--text-200)' }}>正在思考...</Text>
      </div>
    </div>
  </div>
)}
```

**说明**：在消息列表内部显示等待状态，包含头像、名称、时间和"正在思考..."提示。

#### 4.2.3 删除"正在输出..."文本，显示时间

**位置**：第2311-2313行

```tsx
// 修改前
<div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
  <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
  <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>正在输出...</Text>
</div>

// 修改后
<div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
  <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
  <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>{formatTime(new Date().toISOString())}</Text>
</div>
```

**说明**：删除"正在输出..."文本，改为显示当前时间，符合设计规范要求。

---

### 4.3 第三阶段：修复Session创建时机问题

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.3.1 修改createNewSession函数

**位置**：第816-848行

```tsx
// 修改前
const createNewSession = useCallback((name?: string) => {
  if (!agenticFlowId) {
    message.error('请先选择工作流');
    return null;
  }
  
  if (!currentProject?.id) {
    message.error('请先选择项目');
    return null;
  }
  
  const newSessionId = crypto.randomUUID();
  
  setCurrentSessionId(newSessionId);
  
  const newSession: ExtendedRunSession = {
    id: newSessionId,
    status: 'pending',
    name: name || `会话 ${sessions.length + 1}`,
    createdAt: new Date().toISOString(),
    messages: [],
  };
  setSessions(prev => [newSession, ...prev]);  // 删除这行！
  setLlmMessages([]);
  setCallRecords([]);
  setChildAgentOutputs([]);
  setStreamingContent('');
  setStreamingThinkingContent('');
  streamingRef.current = '';
  streamingThinkingRef.current = '';
  
  return newSession;
}, [sessions.length, setCurrentSessionId, agenticFlowId, currentProject?.id]);

// 修改后
const createNewSession = useCallback((name?: string) => {
  if (!agenticFlowId) {
    message.error('请先选择工作流');
    return null;
  }
  
  if (!currentProject?.id) {
    message.error('请先选择项目');
    return null;
  }
  
  const newSessionId = crypto.randomUUID();
  
  setCurrentSessionId(newSessionId);
  setLlmMessages([]);
  setCallRecords([]);
  setChildAgentOutputs([]);
  setStreamingContent('');
  setStreamingThinkingContent('');
  streamingRef.current = '';
  streamingThinkingRef.current = '';
  
  return newSessionId;
}, [setCurrentSessionId, agenticFlowId, currentProject?.id]);
```

**说明**：点击"新任务"按钮时，只设置currentSessionId和清空消息，不创建Session栏项目。只有发送消息时才创建。

#### 4.3.2 修改restoreSession逻辑

**位置**：第349-387行

```tsx
// 修改前
useEffect(() => {
  const restoreSession = async () => {
    if (!agenticFlowId || !currentProject?.id) return;
    
    const storedState = localStorage.getItem('run-store');
    if (storedState) {
      try {
        const parsed = JSON.parse(storedState);
        const storedSessionId = parsed.state?.currentSessionId;
        
        if (storedSessionId) {
          try {
            const messages = await runApi.getSessionMessages(storedSessionId);
            if (messages && messages.length >= 0) {
              setCurrentSessionId(storedSessionId);
              if (messages.length > 0) {
                const llmMsgs: LLMMessage[] = messages.map(msg => ({
                  id: msg.id,
                  role: msg.role,
                  content: msg.content || '',
                  reasoning_content: msg.reasoning_content,
                  data: msg.data || [],
                  timestamp: msg.created_at || msg.timestamp,
                }));
                setLlmMessages(llmMsgs);
              }
            }
          } catch (error) {
            console.log('Stored session not in database');  // 只打印日志！
          }
        }
      } catch (e) {
        console.error('Failed to parse stored session:', e);
      }
    }
  };
  
  restoreSession();
}, [agenticFlowId, currentProject?.id]);

// 修改后
useEffect(() => {
  const restoreSession = async () => {
    if (!agenticFlowId || !currentProject?.id) return;
    
    const storedState = localStorage.getItem('run-store');
    if (storedState) {
      try {
        const parsed = JSON.parse(storedState);
        const storedSessionId = parsed.state?.currentSessionId;
        
        if (storedSessionId) {
          try {
            const messages = await runApi.getSessionMessages(storedSessionId);
            if (messages && messages.length >= 0) {
              setCurrentSessionId(storedSessionId);
              if (messages.length > 0) {
                const llmMsgs: LLMMessage[] = messages.map(msg => ({
                  id: msg.id,
                  role: msg.role,
                  content: msg.content || '',
                  reasoning_content: msg.reasoning_content,
                  data: msg.data || [],
                  timestamp: msg.created_at || msg.timestamp,
                }));
                setLlmMessages(llmMsgs);
              }
            }
          } catch (error) {
            console.log('Stored session not in database, clearing currentSessionId');
            setCurrentSessionId(null);  // 清除currentSessionId
            setLlmMessages([]);  // 重置llmMessages
          }
        }
      } catch (e) {
        console.error('Failed to parse stored session:', e);
      }
    }
  };
  
  restoreSession();
}, [agenticFlowId, currentProject?.id, setCurrentSessionId, setLlmMessages]);
```

**说明**：如果存储的sessionId在数据库中不存在，清除currentSessionId并重置llmMessages，保证空面板状态。

---

### 4.4 第四阶段：修复任务栏UI问题

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.4.1 任务信息显示改为单行

**位置**：第1991-2001行

```tsx
// 修改前
<div style={{ 
  fontSize: 11, 
  opacity: 0.65, 
  display: 'flex',
  alignItems: 'center',
  gap: 4,
}}>
  <span>{getStatusText(session.status)}</span>
  <span>·</span>
  <span>{formatSmartTime(session.createdAt || session.created_at)}</span>
</div>

// 修改后
<div style={{ 
  fontSize: 11, 
  opacity: 0.65, 
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}}>
  <span>{getStatusText(session.status)}</span>
  <span>·</span>
  <span>{formatSmartTime(session.createdAt || session.created_at)}</span>
</div>
```

**说明**：任务信息改为单行显示，缩进与会话名一致。

#### 4.4.2 任务统计UI移除底色和边框

**位置**：第1898-1913行

```tsx
// 修改前
{sessions.length > 0 && (
  <div style={{ 
    marginTop: 8, 
    padding: '8px 12px', 
    background: 'var(--bg-300)', 
    borderRadius: 6,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }}>
    <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>任务总数</Text>
    <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
      {sessions.length}
    </Text>
  </div>
)}

// 修改后
{sessions.length > 0 && (
  <div style={{ 
    marginTop: 8, 
    padding: '6px 10px', 
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }}>
    <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>任务总数</Text>
    <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
      {sessions.length}
    </Text>
  </div>
)}
```

**说明**：移除底色和边框，简化样式，减小padding。

---

### 4.5 第五阶段：修复运行面板布局与滚动条问题

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.5.1 主容器高度计算修改

**位置**：第1858-1864行

```tsx
// 修改前
<div ref={containerRef} style={{ 
  height: 'calc(100% - 52px)', 
  position: 'relative', 
  display: 'flex',
  flexDirection: 'row',
  background: 'var(--bg-100)',
}}>

// 修改后
<div ref={containerRef} style={{ 
  height: 'calc(100vh - 52px)', 
  position: 'relative', 
  display: 'flex',
  flexDirection: 'row',
  background: 'var(--bg-100)',
  overflow: 'hidden',
}}>
```

**说明**：使用 `calc(100vh - 52px)` 直接计算高度，添加 `overflow: 'hidden'` 防止内容溢出。

---

## 五、接口改动影响分析

无接口改动。

---

## 六、数据流对比

### 6.1 Session创建流程

**修改前**：
```
点击"新任务" → 创建Session栏项目 + 设置currentSessionId
```

**修改后**：
```
点击"新任务" → 设置currentSessionId（不创建Session栏项目）
发送消息 → 创建Session栏项目
```

### 6.2 等待状态显示流程

**修改前**：
```
发送消息 → 用户消息添加到llmMessages → 等待状态UI替代整个消息列表
```

**修改后**：
```
发送消息 → 用户消息添加到llmMessages → 消息列表正常显示 → 等待状态在消息列表内部显示
```

---

## 七、总结

| 项目 | 修改前 | 修改后 |
|------|--------|--------|
| 流式输出缩进 | 历史消息无padding-left | 历史消息有padding-left: 36px |
| 等待状态显示 | 替代整个消息列表 | 在消息列表内部显示 |
| "正在输出..." | 显示"正在输出..." | 显示时间 |
| Session创建 | 点击即创建 | 仅发送消息时创建 |
| 任务信息 | 可能换行 | 单行显示 |
| 任务统计UI | 有底色边框 | 无底色边框，简化样式 |
| 面板高度 | calc(100% - 52px) | calc(100vh - 52px) |

---

## 八、测试验证计划

### 8.1 测试目标

1. 验证流式输出缩进一致性
2. 验证Session创建时机正确
3. 验证等待状态UI正常显示
4. 验证任务栏UI正确
5. 验证布局无滚动条问题

### 8.2 测试环境

* 登录账号: admin
* 密码: admin123
* 测试URL: http://localhost:8991

### 8.3 测试项目（每项执行3轮）

#### 测试1: 流式输出缩进一致性测试

**测试步骤:**
1. 发送消息触发流式输出
2. 观察流式输出时的缩进
3. 等待输出完成
4. 检查完成后的缩进是否一致

**记录内容（每轮）:**
* 流式输出时的内容
* 完成后的内容
* 两者缩进是否一致

**分析维度（10个）:**
1. 流式输出是否有左边距
2. 完成后是否有左边距
3. 两者padding-left值是否相同
4. 内容是否完全一致
5. 视觉效果是否统一
6. 是否有wordBreak属性
7. 是否有overflow问题
8. 布局是否正确
9. 用户体验是否良好
10. 是否符合设计规范

#### 测试2: Session创建时机测试

**测试步骤:**
1. 点击"新任务"按钮
2. 检查是否创建Session栏项目
3. 检查currentSessionId是否设置
4. 发送消息
5. 检查是否在发送消息后才创建Session

**记录内容（每轮）:**
* 点击前Session栏数量
* 点击后Session栏数量
* currentSessionId值
* 发送消息后Session栏变化

**分析维度（10个）:**
1. 点击新任务是否创建Session栏
2. currentSessionId是否正确设置
3. 发送消息后是否创建Session
4. Session创建时机是否正确
5. 空面板状态是否正确
6. 消息列表是否正确显示
7. 数据库记录是否正确
8. 前后端数据一致性
9. 用户体验是否符合预期
10. 是否有副作用

#### 测试3: 等待状态UI测试

**测试步骤:**
1. 发送消息
2. 观察等待状态UI
3. 检查是否显示时间
4. 检查用户消息是否正常显示
5. 等待首个chunk到达
6. 检查UI是否正确切换

**记录内容（每轮）:**
* 发送消息时间
* 用户消息是否显示
* 等待状态显示内容
* 时间显示是否正确
* 首个chunk到达时间
* UI切换时间

**分析维度（10个）:**
1. 是否显示等待状态
2. 等待状态是否在消息列表内部
3. 是否显示时间
4. 时间格式是否正确
5. 是否删除了"正在输出..."
6. 用户消息是否正常显示
7. 用户体验是否良好
8. 是否有视觉闪烁
9. 动画是否流畅
10. 是否有性能问题

#### 测试4: 任务栏UI测试

**测试步骤:**
1. 查看任务栏显示
2. 检查任务信息是否单行
3. 检查任务统计UI
4. 检查缩进是否一致

**记录内容（每轮）:**
* 任务信息显示内容
* 是否单行显示
* 任务统计UI样式
* 缩进是否一致

**分析维度（10个）:**
1. 任务信息是否单行
2. 任务统计是否无底色边框
3. 缩进是否与会话名一致
4. 时间显示是否正确
5. 状态图标是否正确
6. 布局是否合理
7. 是否有溢出
8. 用户体验是否良好
9. 是否符合设计规范
10. 是否有副作用

#### 测试5: 布局与滚动条测试

**测试步骤:**
1. 打开运行面板
2. 检查页面是否超出视口
3. 检查是否有不必要的滚动条
4. 调整窗口大小
5. 检查布局是否正确

**记录内容（每轮）:**
* 页面高度
* 是否有滚动条
* 滚动条位置
* 布局是否正确
* 窗口大小变化时布局

**分析维度（10个）:**
1. 页面是否超出视口
2. 是否有底部滚动条
3. 是否有右侧滚动条
4. 布局是否正确
5. flex布局是否生效
6. 高度计算是否正确
7. overflow设置是否正确
8. 用户体验是否良好
9. 是否有布局问题
10. 是否符合设计规范

### 8.4 测试循环流程

```
测试 → 记录数据 → 分析（200字以上）→ 发现问题 → 修复 → 重新测试
```

**核心原则：**
1. 禁止只测试不修复
2. 发现问题必须修复（不论是否由模型产生）
3. 修复后必须重新测试验证
4. 全部通过才能进入下一轮

### 8.5 修复原则

1. 遵循现有架构设计
2. 最小化修改范围
3. 保持数据一致性
4. 不引入新问题

### 8.6 测试完成标准

1. 所有测试项执行3轮
2. 每轮数据完整记录
3. 前后端、数据库数据完全一致
4. 所有分析完成
5. 所有测试文件删除

---

## 九、检查清单

### 9.1 修改前检查

- [x] 理解所有需求点
- [x] 确认涉及文件
- [x] 了解架构约束

### 9.2 修改中检查

- [x] 每个修改有位置、代码、说明
- [x] 每个修改不影响现有功能
- [x] 每个修改遵循现有代码风格

### 9.3 修改后检查

- [ ] npm run build成功
- [ ] 后端启动成功
- [ ] 前端启动成功
- [ ] Playwright测试通过

### 9.4 测试后检查

- [ ] 所有测试项执行完成
- [ ] 所有数据完整记录
- [ ] 所有分析完成
- [ ] 无遗留问题
- [ ] 检查真实日志和返回值

---

## 十、注意事项

### 10.1 必须验证

1. 代码位置必须通过搜索验证
2. 行号必须准确
3. 调用位置必须完整
4. 修改影响必须分析
5. 修复效果必须测试验证

### 10.2 禁止行为

1. 禁止猜测代码位置
2. 禁止遗漏调用位置
3. 禁止使用模糊描述
4. 禁止不验证就记录
5. 禁止只测试不修复
6. 禁止发现问题跳过
7. 禁止预设测试成功
8. 禁止粗略查看日志
9. 禁止使用统计数据代替详细数据
10. 禁止让用户自己检查

### 10.3 质量标准

1. Plan文档可直接用于执行
2. 每个步骤都有明确的代码
3. 每个修改都有原因说明
4. 测试验证计划完整可执行

---

## 十一、执行检查口诀

```
一搜二读三定位
四修五测六验证
七记八析九总结
全部通过才算完
```
