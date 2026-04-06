# 运行面板Bug修复Plan - Session显示异常

## Bug描述

运行面板存在以下bug：
1. 点击会话后，session栏对应内容无法正常显示
2. 但是session_message正常显示
3. 如果进入其他session再进入该对话，则session_message也无法显示（对话栏有记录但是记录内容是空的）

## 复现步骤

1. 打开运行面板
2. 点击左侧session列表中的某个会话
3. 观察session栏（显示最后一条消息摘要）和对话栏（显示完整对话内容）
4. 发现session栏无内容或显示异常
5. 点击其他session，然后再点击回来
6. 发现session_message也变为空

---

## 一、设计理念（遵循架构原则）

```
层次架构：
- 前端Store层 (runStore.ts) → 负责状态管理，提供sessions数据源，唯一数据源
- 前端组件层 (RunPanel.tsx) → 负责UI展示，从Store获取数据，不维护本地session状态
- 后端API层 (run.py) → 提供session和message数据接口
- 数据库层 (database.py) → 存储session和session_message数据
```

**缓存策略设计**：

| 数据类型 | 缓存策略 | 刷新时机 |
|---------|---------|---------|
| Session列表 | 缓存 | 创建/删除/对话完成/手动刷新 |
| Session_Message | 缓存已加载的 | 点击切换时按需加载/对话完成时更新当前session |

**问题根源分析**：

1. **双重状态管理问题**：RunPanel组件同时维护本地`activeSessionId`和Store的`currentSessionId`，导致状态不同步
2. **N+1查询问题**：`loadSessionsFromBackend`函数预加载所有session的messages，严重影响性能
3. **闭包问题**：`handleSwitchSession`函数使用闭包中的`sessions`变量，可能是旧数据
4. **状态覆盖问题**：对话完成后重新加载所有session，覆盖本地状态

---

## 二、执行内容总览

### 2.1 新增代码

| 文件 | 新增内容 | 位置 |
|------|----------|------|
| `runStore.ts` | `updateSessionMessages`方法 | 第263行后 |
| `RunPanel.tsx` | `loadSessionMessagesIfNeeded`函数 | 第739行前 |

### 2.2 修改代码

| 文件 | 修改内容 | 位置 |
|------|----------|------|
| `RunPanel.tsx` | 移除activeSessionId useState声明 | 第151行 |
| `RunPanel.tsx` | 重构loadSessionsFromBackend函数，移除预加载 | 第212-279行 |
| `RunPanel.tsx` | 重构handleSwitchSession函数，使用Store数据 | 第739-821行 |
| `RunPanel.tsx` | 修改handleDeleteSession函数 | 第823-846行 |
| `RunPanel.tsx` | 修改handleSendLLMMessage函数 | 第883-1062行 |
| `RunPanel.tsx` | 修改clearLLMMessages函数 | 第1064-1075行 |
| `RunPanel.tsx` | 修改execution_complete事件处理 | 第629-671行 |
| `RunPanel.tsx` | 修改session列表渲染中的activeSessionId引用 | 第1817-1895行 |
| `runStore.ts` | 增强loadSessionMessages方法 | 第249-263行 |

### 2.3 删除代码

| 文件 | 删除内容 | 位置 |
|------|----------|------|
| `RunPanel.tsx` | 删除activeSessionId useState声明 | 第151行 |
| `RunPanel.tsx` | 删除loadSessionsFromBackend中的预加载循环 | 第229-269行 |

---

## 三、待删除代码配套调用分析

### 3.1 `activeSessionId` 状态变量

| 调用位置 | 文件 | 代码 | 修改方案 |
|---------|------|------|---------|
| 定义 | RunPanel.tsx:151 | `const [activeSessionId, setActiveSessionId] = useState<string \| null>(null);` | **删除** |
| 使用(比较) | RunPanel.tsx:740 | `if (activeSessionId === sessionId)` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:829 | `if (activeSessionId === sessionId)` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:1826 | `background: activeSessionId === session.id` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:1829 | `color: activeSessionId === session.id ? '#fff'` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:1834 | `border: activeSessionId === session.id` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:1837 | `if (activeSessionId !== session.id)` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:1843 | `if (activeSessionId !== session.id)` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:1849 | `fontWeight: activeSessionId === session.id` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:1883 | `opacity: activeSessionId === session.id ? 0.9` | 改为`currentSessionId` |
| 使用(比较) | RunPanel.tsx:1885 | `color: activeSessionId === session.id ? '#fff'` | 改为`currentSessionId` |
| 设置 | RunPanel.tsx:727 | `setActiveSessionId(newSession.id);` | **删除** |
| 设置 | RunPanel.tsx:744 | `setActiveSessionId(sessionId);` | **删除** |
| 设置 | RunPanel.tsx:830 | `setActiveSessionId(newSessions.length > 0 ? newSessions[0].id : null);` | **删除** |
| 设置 | RunPanel.tsx:916 | `setActiveSessionId(currentSessionIdLocal);` | **删除** |
| 使用 | RunPanel.tsx:897 | `let currentSessionIdLocal = activeSessionId;` | 改为`currentSessionId` |
| 使用 | RunPanel.tsx:1068 | `if (activeSessionId)` | 改为`currentSessionId` |
| 使用 | RunPanel.tsx:1070 | `s.id === activeSessionId` | 改为`currentSessionId` |

### 3.2 `loadSessionsFromBackend` 中的预加载循环

| 调用位置 | 文件 | 代码 | 修改方案 |
|---------|------|------|---------|
| 循环 | RunPanel.tsx:229-269 | `for (const session of sessions) { const messages = await runApi.getSessionMessages(session.id); ... }` | **删除整个循环** |

**操作**：删除预加载逻辑，改为只加载session列表元数据

---

## 四、具体执行步骤

### 4.1 第一阶段：移除双重状态管理

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.1.1 删除activeSessionId useState声明

**位置**：第151行

```tsx
// 修改前
const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

// 修改后
// 删除此行，统一使用currentSessionId from useRunStore
```

**说明**：移除本地useState状态，统一使用useRunStore中的currentSessionId状态，避免状态不同步

---

### 4.2 第二阶段：优化Session列表加载（移除N+1问题）

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.2.1 重构loadSessionsFromBackend函数

**位置**：第212-279行

```tsx
// 修改前
const loadSessionsFromBackend = useCallback(async () => {
  if (!agenticFlowId) {
    console.log('No agenticFlowId, skipping session load');
    return;
  }
  
  if (!currentProject?.id) {
    console.log('No currentProject, skipping session load');
    return;
  }
  
  try {
    await loadSessions(agenticFlowId, currentProject.id);
    
    const sessions = useRunStore.getState().sessions;
    
    const loadedSessions: ExtendedRunSession[] = [];
    for (const session of sessions) {
      try {
        const messages = await runApi.getSessionMessages(session.id); // N+1问题！
        loadedSessions.push({
          ...session,
          id: session.id,
          name: `会话 ${session.id.substring(0, 8)}`,
          createdAt: session.created_at || new Date().toISOString(),
          messages: messages.map((msg, index): SessionMessage => {
            // ... 消息处理
          }),
        });
      } catch (error) {
        console.warn(`Failed to load messages for session ${session.id}:`, error);
      }
    }
    
    loadedSessions.sort((a, b) => 
      new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
    );
    
    setSessions(loadedSessions);
  } catch (error) {
    console.warn('Failed to load sessions from backend:', error);
  }
}, [agenticFlowId, currentProject?.id, loadSessions]);

// 修改后
const loadSessionsFromBackend = useCallback(async () => {
  if (!agenticFlowId) {
    console.log('No agenticFlowId, skipping session load');
    return;
  }
  
  if (!currentProject?.id) {
    console.log('No currentProject, skipping session load');
    return;
  }
  
  try {
    // 只加载session列表，不预加载messages
    await loadSessions(agenticFlowId, currentProject.id);
    
    // 获取Store中的sessions并添加显示所需的属性
    const storeSessions = useRunStore.getState().sessions;
    const displaySessions: ExtendedRunSession[] = storeSessions.map(s => ({
      ...s,
      name: `会话 ${s.id.substring(0, 8)}`,
      createdAt: s.created_at || new Date().toISOString(),
      // messages保持为空数组，按需加载
      messages: [],
    }));
    
    displaySessions.sort((a, b) => 
      new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
    );
    
    setSessions(displaySessions);
  } catch (error) {
    console.warn('Failed to load sessions from backend:', error);
  }
}, [agenticFlowId, currentProject?.id, loadSessions]);
```

**说明**：移除预加载逻辑，只加载session列表元数据。messages将在用户点击session时按需加载，解决N+1查询问题

---

### 4.3 第三阶段：优化Session切换逻辑（按需加载messages）

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.3.1 重构handleSwitchSession函数

**位置**：第739-821行

```tsx
// 修改前
const handleSwitchSession = async (sessionId: string) => {
  if (activeSessionId === sessionId) {
    return;
  }
  
  setActiveSessionId(sessionId);
  setCurrentSessionId(sessionId);
  
  const session = sessions.find(s => s.id === sessionId);
  if (session && session.messages && session.messages.length > 0) {
    // 从本地缓存加载
    const llmMsgs: LLMMessage[] = session.messages.map(msg => ({...}));
    setLlmMessages(llmMsgs);
  } else {
    // 从后端API加载
    setLlmMessages([]);
    try {
      const messages = await runApi.getSessionMessages(sessionId);
      // ... 处理消息
      setLlmMessages(restoredMessages);
      setSessions(prev => prev.map(s => 
        s.id === sessionId ? { ...s, messages: restoredMessages.map(...) } : s
      ));
    } catch (error) {
      console.warn('Failed to restore session messages:', error);
    }
  }
  
  setCallRecords([]);
  setChildAgentOutputs([]);
  setStreamingContent('');
  setStreamingThinkingContent('');
  streamingRef.current = '';
  streamingThinkingRef.current = '';
};

// 修改后
const handleSwitchSession = useCallback(async (sessionId: string) => {
  // 使用Store中的currentSessionId进行比较
  if (currentSessionId === sessionId) {
    return;
  }
  
  // 只更新Store状态
  setCurrentSessionId(sessionId);
  
  // 从Store获取最新的sessions数据（避免闭包问题）
  const storeSessions = useRunStore.getState().sessions;
  const session = storeSessions.find(s => s.id === sessionId);
  
  // 清空当前显示，准备加载新session
  setLlmMessages([]);
  setCallRecords([]);
  setChildAgentOutputs([]);
  setStreamingContent('');
  setStreamingThinkingContent('');
  streamingRef.current = '';
  streamingThinkingRef.current = '';
  
  if (session && session.messages && session.messages.length > 0) {
    // 优先使用缓存数据（快速响应）
    const llmMsgs: LLMMessage[] = session.messages.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content || '',
      reasoning_content: msg.reasoning_content,
      data: msg.data,
      timestamp: msg.timestamp || msg.created_at || new Date().toISOString(),
      tokens: msg.tokens || msg.prompt_tokens,
    }));
    setLlmMessages(llmMsgs);
  } else {
    // 缓存未命中，从后端加载
    try {
      const messages = await runApi.getSessionMessages(sessionId);
      const restoredMessages: LLMMessage[] = messages.map(msg => {
        const data: DataBlock[] = msg.data || [];
        let content = '';
        let reasoningContent: string | undefined;
        
        for (const block of data) {
          if (block.type === 'content') {
            content = block.content || '';
          } else if (block.type === 'reasoning_content') {
            reasoningContent = block.reasoning_content;
          }
        }
        
        return {
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          content,
          reasoning_content: reasoningContent,
          data,
          timestamp: msg.created_at || new Date().toISOString(),
          tokens: msg.total_tokens,
        };
      });
      
      setLlmMessages(restoredMessages);
      
      // 更新Store缓存
      const sessionMessages: SessionMessage[] = restoredMessages.map((m, i): SessionMessage => {
        const data = m.data || [];
        let extractedContent = '';
        for (const block of data) {
          if (block.type === 'content' && block.content) {
            extractedContent = block.content;
            break;
          }
        }
        return {
          id: m.id,
          role: m.role,
          content: extractedContent,
          reasoning_content: m.reasoning_content,
          data: m.data || [],
          message_index: i,
          timestamp: m.timestamp,
          created_at: m.timestamp,
          tokens: m.tokens,
        };
      });
      
      setSessions(prev => prev.map(s => 
        s.id === sessionId ? { ...s, messages: sessionMessages } : s
      ));
    } catch (error) {
      console.warn('Failed to load session messages:', error);
    }
  }
}, [currentSessionId, setCurrentSessionId]);
```

**说明**：
1. 使用`currentSessionId`替代`activeSessionId`
2. 使用`useRunStore.getState().sessions`获取最新数据，避免闭包问题
3. 优先使用缓存数据，缓存未命中时才从后端加载
4. 加载完成后更新Store缓存

---

### 4.4 第四阶段：修改其他相关函数

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.4.1 修改createNewSession函数

**位置**：第704-737行

```tsx
// 修改前
const createNewSession = useCallback((name?: string) => {
  // ...
  setCurrentSessionId(newSessionId);
  // ...
  setSessions(prev => [newSession, ...prev]);
  setActiveSessionId(newSession.id); // 删除此行
  // ...
}, [sessions.length, setCurrentSessionId, agenticFlowId, currentProject?.id]);

// 修改后
const createNewSession = useCallback((name?: string) => {
  // ...
  setCurrentSessionId(newSessionId);
  // ...
  setSessions(prev => [newSession, ...prev]);
  // 删除setActiveSessionId调用，setCurrentSessionId已经设置了Store状态
  // ...
}, [sessions.length, setCurrentSessionId, agenticFlowId, currentProject?.id]);
```

#### 4.4.2 修改handleDeleteSession函数

**位置**：第823-846行

```tsx
// 修改前
const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
  e.stopPropagation();
  try {
    await runApi.deleteSession(sessionId);
    const newSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(newSessions);
    if (activeSessionId === sessionId) {
      setActiveSessionId(newSessions.length > 0 ? newSessions[0].id : null);
      setLlmMessages(newSessions.length > 0 && newSessions[0].messages ? newSessions[0].messages.map(m => ({...})) : []);
    }
    message.success('会话已删除');
  } catch (error) {
    console.error('Failed to delete session:', error);
    message.error('删除会话失败');
  }
};

// 修改后
const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
  e.stopPropagation();
  try {
    await runApi.deleteSession(sessionId);
    const newSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(newSessions);
    
    // 如果删除的是当前session，切换到第一个或清空
    if (currentSessionId === sessionId) {
      if (newSessions.length > 0) {
        // 切换到第一个session
        setCurrentSessionId(newSessions[0].id);
        // 加载第一个session的消息
        if (newSessions[0].messages && newSessions[0].messages.length > 0) {
          setLlmMessages(newSessions[0].messages.map(m => ({
            id: m.id,
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content || '',
            reasoning_content: m.reasoning_content,
            data: m.data,
            timestamp: m.timestamp || m.created_at || new Date().toISOString(),
            tokens: m.tokens,
          })));
        } else {
          setLlmMessages([]);
        }
      } else {
        // 没有session了，清空
        setCurrentSessionId(null);
        setLlmMessages([]);
      }
    }
    message.success('会话已删除');
  } catch (error) {
    console.error('Failed to delete session:', error);
    message.error('删除会话失败');
  }
};
```

#### 4.4.3 修改handleSendLLMMessage函数

**位置**：第883-1062行

```tsx
// 修改前
let sessionId = currentSessionId;
let currentSessionIdLocal = activeSessionId; // 问题：使用本地状态
// ...
if (!currentSessionIdLocal) {
  // ...
  setActiveSessionId(currentSessionIdLocal); // 问题：设置本地状态
}

// 修改后
let sessionId = currentSessionId;
// 删除currentSessionIdLocal变量，直接使用currentSessionId
// ...
if (!sessionId) {
  sessionId = crypto.randomUUID();
  setCurrentSessionId(sessionId);
  needWaitConnection = true;
  
  const newSession: ExtendedRunSession = {
    id: sessionId,
    status: 'pending',
    name: `会话 ${sessions.length + 1}`,
    createdAt: new Date().toISOString(),
    messages: [],
  };
  setSessions(prev => [...prev, newSession]);
}
```

#### 4.4.4 修改clearLLMMessages函数

**位置**：第1064-1075行

```tsx
// 修改前
const clearLLMMessages = () => {
  setLlmMessages([]);
  setCallRecords([]);
  setChildAgentOutputs([]);
  if (activeSessionId) {
    setSessions(prev => prev.map(s => 
      s.id === activeSessionId 
        ? { ...s, messages: [] }
        : s
    ));
  }
};

// 修改后
const clearLLMMessages = () => {
  setLlmMessages([]);
  setCallRecords([]);
  setChildAgentOutputs([]);
  if (currentSessionId) {
    setSessions(prev => prev.map(s => 
      s.id === currentSessionId 
        ? { ...s, messages: [] }
        : s
    ));
  }
};
```

---

### 4.5 第五阶段：优化对话完成后的处理

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.5.1 修改execution_complete事件处理

**位置**：第629-671行

```tsx
// 修改前
case 'execution_complete':
  {
    // ... 添加assistant消息到llmMessages
    // ...
    if (agenticFlowId && currentProject?.id) {
      loadSessionsFromBackend(); // 问题：重新加载所有session
    }
  }
  stopRunning();
  break;

// 修改后
case 'execution_complete':
  {
    // ... 添加assistant消息到llmMessages
    
    // 更新当前session的messages缓存
    if (currentSessionId) {
      const updatedMessages = [...llmMessages];
      if (textContent || reasoningContent) {
        updatedMessages.push({
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: textContent,
          reasoning_content: reasoningContent,
          timestamp: new Date().toISOString(),
        });
      }
      
      // 更新Store中的session messages
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { 
              ...s, 
              messages: updatedMessages.map((m, i): SessionMessage => ({
                id: m.id,
                role: m.role,
                content: m.content || '',
                reasoning_content: m.reasoning_content,
                data: m.data || [],
                message_index: i,
                timestamp: m.timestamp,
                created_at: m.timestamp,
                tokens: m.tokens,
              }))
            }
          : s
      ));
    }
    
    // 不再重新加载所有session，只更新当前session的缓存
  }
  stopRunning();
  break;
```

**说明**：对话完成后只更新当前session的messages缓存，避免重新加载所有session导致状态覆盖

---

### 4.6 第六阶段：修改UI渲染中的引用

**文件**：`frontend/src/components/RunPanel/RunPanel.tsx`

#### 4.6.1 替换session列表渲染中的activeSessionId

**位置**：第1817-1895行

```tsx
// 修改前
{sessions.map(session => (
  <div
    key={session.id}
    onClick={() => handleSwitchSession(session.id)}
    style={{
      background: activeSessionId === session.id 
        ? 'linear-gradient(135deg, var(--primary-100), var(--primary-200))' 
        : 'transparent',
      color: activeSessionId === session.id ? '#fff' : 'var(--text-100)',
      // ...
    }}
  >
    // ...
  </div>
))}

// 修改后
{sessions.map(session => (
  <div
    key={session.id}
    onClick={() => handleSwitchSession(session.id)}
    style={{
      background: currentSessionId === session.id 
        ? 'linear-gradient(135deg, var(--primary-100), var(--primary-200))' 
        : 'transparent',
      color: currentSessionId === session.id ? '#fff' : 'var(--text-100)',
      // ...
    }}
  >
    // ...
  </div>
))}
```

**说明**：所有UI渲染中的`activeSessionId`替换为`currentSessionId`

---

### 4.7 第七阶段：增强Store的loadSessionMessages方法

**文件**：`frontend/src/store/runStore.ts`

#### 4.7.1 增强loadSessionMessages方法

**位置**：第249-263行

```tsx
// 修改前
loadSessionMessages: async (sessionId: string) => {
  try {
    const messages = await runApi.getSessionMessages(sessionId);
    set((state) => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, messages } : s
      ),
      currentSession: state.currentSession?.id === sessionId
        ? { ...state.currentSession, messages }
        : state.currentSession,
    }));
  } catch (error: any) {
    console.error('Failed to load session messages:', error);
  }
},

// 修改后
loadSessionMessages: async (sessionId: string) => {
  try {
    const messages = await runApi.getSessionMessages(sessionId);
    
    // 转换消息格式，确保数据一致性
    const formattedMessages: SessionMessage[] = messages.map((msg, index) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content || '',
      reasoning_content: msg.reasoning_content,
      data: msg.data || [],
      message_index: msg.message_index ?? index,
      timestamp: msg.created_at || new Date().toISOString(),
      created_at: msg.created_at,
      tokens: msg.total_tokens,
      prompt_tokens: msg.prompt_tokens,
      completion_tokens: msg.completion_tokens,
      total_tokens: msg.total_tokens,
    }));
    
    set((state) => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, messages: formattedMessages } : s
      ),
      currentSession: state.currentSession?.id === sessionId
        ? { ...state.currentSession, messages: formattedMessages }
        : state.currentSession,
    }));
  } catch (error: any) {
    console.error('Failed to load session messages:', error);
  }
},
```

**说明**：增强消息格式转换，确保数据一致性

---

## 五、接口改动影响分析

### 5.1 状态管理接口修改影响

| 调用位置 | 文件 | 需要修改 | 说明 |
|---------|------|----------|------|
| RunPanel.tsx:151 | useState声明 | **是** | 删除activeSessionId useState |
| RunPanel.tsx:727 | setActiveSessionId调用 | **是** | 删除此调用 |
| RunPanel.tsx:740 | activeSessionId比较 | **是** | 改为currentSessionId |
| RunPanel.tsx:744 | setActiveSessionId调用 | **是** | 删除此调用 |
| RunPanel.tsx:829-830 | activeSessionId比较和设置 | **是** | 改为currentSessionId，删除设置 |
| RunPanel.tsx:897 | activeSessionId使用 | **是** | 改为currentSessionId |
| RunPanel.tsx:916 | setActiveSessionId调用 | **是** | 删除此调用 |
| RunPanel.tsx:1068-1070 | activeSessionId使用 | **是** | 改为currentSessionId |
| RunPanel.tsx:1826-1885 | activeSessionId比较 | **是** | 改为currentSessionId |

### 5.2 数据格式变化

**无数据格式变化** - 只修改前端状态管理逻辑和缓存策略

---

## 六、数据流对比

### 6.1 修复前

```
┌─────────────────────────────────────────────────────────────────┐
│                     初始化加载                                   │
├─────────────────────────────────────────────────────────────────┤
│ loadSessionsFromBackend()                                       │
│   ↓                                                             │
│ loadSessions() → 获取session列表                                 │
│   ↓                                                             │
│ for (session of sessions) {                                     │
│   getSessionMessages(session.id) → N次API调用（N+1问题）         │
│ }                                                               │
│   ↓                                                             │
│ setSessions(loadedSessions) → 设置到本地组件状态                 │
│                                                                 │
│ 问题：                                                          │
│ 1. N+1查询问题，性能极差                                         │
│ 2. sessions存储在组件本地状态，与Store不同步                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     点击Session                                  │
├─────────────────────────────────────────────────────────────────┤
│ handleSwitchSession(sessionId)                                  │
│   ↓                                                             │
│ setActiveSessionId(sessionId) → 设置本地状态                    │
│ setCurrentSessionId(sessionId) → 设置Store状态                  │
│   ↓                                                             │
│ const session = sessions.find() → 使用闭包中的旧数据             │
│   ↓                                                             │
│ 问题：                                                          │
│ 1. 双重状态管理，可能不同步                                      │
│ 2. 闭包问题，sessions可能是旧数据                                │
│ 3. session栏显示异常                                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     对话完成后                                   │
├─────────────────────────────────────────────────────────────────┤
│ execution_complete事件                                           │
│   ↓                                                             │
│ loadSessionsFromBackend() → 重新加载所有session和messages        │
│   ↓                                                             │
│ 问题：                                                          │
│ 1. 覆盖本地状态                                                 │
│ 2. 再次触发N+1查询                                              │
│ 3. 切换session后messages丢失                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 修复后

```
┌─────────────────────────────────────────────────────────────────┐
│                     初始化加载                                   │
├─────────────────────────────────────────────────────────────────┤
│ loadSessionsFromBackend()                                       │
│   ↓                                                             │
│ loadSessions() → 获取session列表（不含messages）                 │
│   ↓                                                             │
│ setSessions(displaySessions) → 设置到Store                      │
│                                                                 │
│ 优点：                                                          │
│ 1. 只需1次API调用                                               │
│ 2. sessions存储在Store，统一管理                                │
│ 3. messages按需加载                                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     点击Session                                  │
├─────────────────────────────────────────────────────────────────┤
│ handleSwitchSession(sessionId)                                  │
│   ↓                                                             │
│ setCurrentSessionId(sessionId) → 只设置Store状态                │
│   ↓                                                             │
│ const session = useRunStore.getState().sessions.find()          │
│   ↓                                                             │
│ if (session.messages.length > 0) {                              │
│   // 使用缓存数据（快速响应）                                    │
│   setLlmMessages(session.messages)                              │
│ } else {                                                        │
│   // 按需加载                                                   │
│   getSessionMessages(sessionId)                                 │
│   setLlmMessages(messages)                                      │
│   setSessions() → 更新Store缓存                                 │
│ }                                                               │
│                                                                 │
│ 优点：                                                          │
│ 1. 单一状态管理，无同步问题                                      │
│ 2. 从Store获取最新数据                                          │
│ 3. 缓存优先，按需加载                                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     对话完成后                                   │
├─────────────────────────────────────────────────────────────────┤
│ execution_complete事件                                           │
│   ↓                                                             │
│ // 只更新当前session的messages缓存                               │
│ setSessions(prev => prev.map(s =>                               │
│   s.id === currentSessionId ? {...s, messages: updatedMessages} │
│   : s                                                           │
│ ))                                                              │
│                                                                 │
│ 优点：                                                          │
│ 1. 不覆盖其他session的状态                                       │
│ 2. 不触发额外的API调用                                          │
│ 3. 切换session后messages正常显示                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 七、数据格式示例

### 7.1 Session数据结构

```json
{
  "id": "session_uuid",
  "status": "completed",
  "name": "会话 abc12345",
  "createdAt": "2026-03-15T10:00:00Z",
  "messages": [
    {
      "id": "msg_uuid_1",
      "role": "user",
      "content": "用户消息内容",
      "data": [{"type": "content", "content": "用户消息内容"}],
      "message_index": 0,
      "timestamp": "2026-03-15T10:00:00Z",
      "created_at": "2026-03-15T10:00:00Z",
      "tokens": 10
    },
    {
      "id": "msg_uuid_2",
      "role": "assistant",
      "content": "助手回复内容",
      "reasoning_content": "思考过程...",
      "data": [
        {"type": "reasoning_content", "reasoning_content": "思考过程..."},
        {"type": "content", "content": "助手回复内容"}
      ],
      "message_index": 1,
      "timestamp": "2026-03-15T10:01:00Z",
      "created_at": "2026-03-15T10:01:00Z",
      "tokens": 100
    }
  ]
}
```

### 7.2 LLMMessage数据结构（UI显示用）

```json
{
  "id": "msg_uuid",
  "role": "assistant",
  "content": "助手回复内容",
  "reasoning_content": "思考过程...",
  "data": [
    {"type": "reasoning_content", "reasoning_content": "思考过程..."},
    {"type": "content", "content": "助手回复内容"}
  ],
  "timestamp": "2026-03-15T10:01:00Z",
  "tokens": 100
}
```

---

## 八、总结

| 项目 | 修复前 | 修复后 |
|------|--------|--------|
| 状态管理 | 双重状态(activeSessionId + currentSessionId) | 单一状态(统一使用currentSessionId) |
| 数据获取 | 从闭包sessions变量获取(可能stale) | 从Store实时获取(getState().sessions) |
| Session列表加载 | 预加载所有messages（N+1问题） | 只加载元数据，messages按需加载 |
| Session切换 | 状态不同步，闭包问题 | 缓存优先，按需加载，数据一致 |
| 对话完成处理 | 重新加载所有session | 只更新当前session缓存 |
| session栏显示 | 首次点击显示异常 | 正常显示 |
| session_message显示 | 进入其他session后显示空 | 正常显示 |
| 性能 | N+1查询，性能差 | 1次查询，性能优 |

---

## 九、测试验证计划

### 9.1 测试目标

1. 验证点击session后session栏正常显示最后一条消息摘要
2. 验证点击session后对话栏正常显示完整消息
3. 验证进入其他session后再返回，消息仍然正常显示
4. 验证首次加载性能（无N+1问题）
5. 确认无副作用

### 9.2 测试环境

* 登录账号: [账号]
* 密码: [密码]
* 测试URL: [URL]

### 9.3 测试项目（每项执行3轮）

#### 测试1: 首次加载性能测试

**测试步骤:**
1. 打开浏览器开发者工具，切换到Network标签
2. 打开运行面板
3. 观察API请求数量和响应时间
4. 确认只发送了1次getSessions请求

**记录内容（每轮）:**
* API请求数量
* 总响应时间
* 是否存在N+1查询问题

**分析维度（10个）:**
1. 是否只发送了1次getSessions请求
2. 是否没有发送getSessionMessages请求（首次加载时）
3. 响应时间是否合理（<2秒）
4. session列表是否正确显示
5. session栏是否显示正确的摘要信息
6. 是否有重复请求
7. 是否有失败的请求
8. 网络带宽使用是否合理
9. 是否有缓存命中
10. 整体加载体验是否流畅

#### 测试2: 首次点击Session显示测试

**测试步骤:**
1. 打开运行面板
2. 确保至少有一个会话存在
3. 点击左侧session列表中的某个会话
4. 观察session栏（显示最后一条消息摘要的区域）
5. 观察对话栏（显示完整对话内容的区域）

**记录内容（每轮）:**
* session栏显示的内容（最后一条消息摘要）
* 对话栏显示的消息列表（完整消息内容）
* 后端返回的session数据
* 前端状态中的sessions数据
* API请求次数

**分析维度（10个）:**
1. session栏是否显示最后一条消息
2. session栏显示的内容是否与实际最后一条消息一致
3. 对话栏是否显示所有消息
4. 消息内容是否完整（非空）
5. 消息顺序是否正确
6. user消息和assistant消息是否正确区分
7. 点击后状态栏是否正确高亮当前session
8. currentSessionId是否正确更新
9. sessions数组是否包含正确的messages
10. 前端数据与后端返回数据是否一致

#### 测试3: 跨Session切换测试

**测试步骤:**
1. 打开运行面板
2. 创建或选择一个session进行对话
3. 切换到另一个session
4. 观察两个session的消息显示是否正确
5. 切换回第一个session

**记录内容（每轮）:**
* 第一个session的完整消息列表
* 第二个session的完整消息列表
* 切换过程中的状态变化
* 切换回来后session栏和对话栏的内容
* API请求次数（是否使用缓存）

**分析维度（10个）:**
1. 切换后原session的active状态是否正确取消
2. 切换后新session是否正确高亮
3. 切换后对话栏是否显示正确session的消息
4. 再次切换回来后消息是否仍然存在
5. session栏摘要是否正确更新
6. 是否出现消息丢失现象
7. 是否出现消息内容为空的情况
8. 状态切换是否流畅
9. 多次切换是否累积问题
10. 数据是否正确持久化

#### 测试4: 连续对话后查看历史测试

**测试步骤:**
1. 选择一个session
2. 进行多次对话（至少3轮）
3. 刷新页面或重新加载组件
4. 点击该session查看历史消息

**记录内容（每轮）:**
* 每次对话后的消息数量
* 刷新后加载的完整消息列表
* 数据库中存储的消息记录
* session栏摘要内容
* API请求次数

**分析维度（10个）:**
1. 新对话消息是否正确保存
2. 刷新后消息是否正确加载
3. 刷新后session栏摘要是否正确
4. 数据库记录与前端显示是否一致
5. 消息内容是否完整（非截断）
6. 消息时间戳是否正确
7. 消息顺序是否正确
8. token统计是否正确
9. 多轮对话是否正确累积
10. 长期使用是否稳定

#### 测试5: 删除Session后状态测试

**测试步骤:**
1. 创建多个session（至少3个）
2. 在第一个session中进行对话
3. 删除当前session
4. 观察是否正确切换到其他session
5. 观察消息显示是否正确

**记录内容（每轮）:**
* 删除前的session列表
* 删除后的session列表
* 删除后当前选中的session
* 删除后显示的消息内容
* API请求情况

**分析维度（10个）:**
1. 删除后session是否从列表中移除
2. 删除后是否自动切换到其他session
3. 切换后的session消息是否正确显示
4. currentSessionId是否正确更新
5. 删除最后一个session时是否正确清空
6. 删除操作是否流畅
7. 是否有残留数据
8. 后端数据是否同步删除
9. 删除后刷新页面是否正常
10. 删除操作是否有错误提示

### 9.4 测试循环流程

```
测试 → 记录数据 → 分析（200字以上） → 发现问题 → 修复 → 重新测试
```

**核心原则：**
1. 禁止只测试不修复
2. 发现问题必须修复（不论是否由模型产生）
3. 修复后必须重新测试验证
4. 全部通过才能进入下一轮

### 9.5 修复原则

1. 遵循现有架构设计 - 保持Store作为唯一数据源
2. 最小化修改范围 - 只修改状态管理逻辑
3. 保持数据一致性 - 确保前后端数据同步
4. 不引入新问题 - 修复后不影响其他功能
5. 优化性能 - 解决N+1查询问题

### 9.6 测试完成标准

1. 所有测试项执行3轮
2. 每轮数据完整记录
3. 前后端、数据库数据完全一致
4. 所有分析完成
5. 所有测试文件删除
6. 无N+1查询问题
7. 首次加载性能符合预期
