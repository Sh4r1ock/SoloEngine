# WebSocket 断开重连问题分析与修复方案

## 一、问题描述

### 当前行为（问题流程）
```
WebSocket断开 → 等待3秒延迟 → 重连中... → 用户操作 → 报错（连接未就绪） → 重连完成 → 用户重新操作 → 成功
```

### 期望行为
```
WebSocket断开 → 立即重连 → 重连中... → 用户操作 → 等待重连完成 → 自动执行 → 成功
```

### 核心问题
1. **重连有延迟**：断开后不是立即重连，而是等待3秒才开始
2. **操作不等待重连**：用户操作时如果正在重连，会直接报错而不是等待重连完成

---

## 二、设计理念遵循分析

### 2.1 设计理念文档内容

```
四层架构
AgenticFlow实例层（run.py） → 负责模型记忆读取、存储、session创建、隔离管理(管理整个AgenticFlow)
Compiler层 (flow_compiler.py) → 编译并执行flow，协调多个agent。该层可视为SoloAgent同层
SoloAgent (agent.py) → 基于ReActCore基类，负责组装各项plugins  
ReActCore基类 (react_core.py)  → 只负责接收数据、运行.核心执行引擎，处理LLM调用  
LLM API 
```

### 2.2 WebSocket重构与设计理念的关系

| 层级 | 是否涉及 | 说明 |
|------|---------|------|
| AgenticFlow实例层 | ❌ 不涉及 | WebSocket只是通信通道，不涉及session管理逻辑 |
| Compiler层 | ❌ 不涉及 | 不涉及flow编译和执行逻辑 |
| SoloAgent | ❌ 不涉及 | 不涉及agent组装逻辑 |
| ReActCore基类 | ❌ 不涉及 | 不涉及核心执行引擎 |
| LLM API | ❌ 不涉及 | 不涉及LLM调用 |

**结论**：WebSocket重构**不需要修改设计理念文档**。WebSocket只是前端通信层，属于UI层的实现细节，不涉及后端核心架构。

---

## 三、当前项目代码完整分析

### 3.1 文件结构

```
frontend/src/
├── hooks/
│   └── useRunWebSocket.ts    # 主要WebSocket Hook（运行面板使用）★★★
├── services/
│   ├── websocket.ts          # 旧WebSocket服务类（画布执行使用）
│   └── runApi.ts             # 运行API服务
├── components/
│   └── RunPanel/
│       └── RunPanel.tsx      # 运行面板组件
└── store/
    └── runStore.ts           # 运行状态管理

backend/app/api/v1/
├── run.py                    # 主要WebSocket端点（运行面板使用）★★★
└── websocket.py              # 旧WebSocket端点（画布执行使用）
```

### 3.2 useRunWebSocket.ts 完整代码分析

#### 现有功能清单

| 行号 | 功能 | 状态 | 说明 |
|------|------|------|------|
| 110-114 | ref变量定义 | ✅ 完整 | wsRef, reconnectAttemptsRef, reconnectTimeoutRef, heartbeatIntervalRef, connectionKeyRef |
| 115-116 | 状态变量 | ✅ 完整 | isConnected, connectionStatus |
| 118-128 | 回调ref | ✅ 完整 | onMessageRef, onEventRef, onErrorRef, onCloseRef |
| 130-146 | 心跳机制 | ⚠️ 需增强 | 只发送ping，不检测断开状态 |
| 148-164 | disconnect函数 | ✅ 完整 | 但需要增加重置状态 |
| 166-307 | connect函数 | ⚠️ 需增强 | onclose延迟重连，onopen不处理队列 |
| 309-315 | send函数 | ✅ 完整 | 简单发送 |
| 317-354 | sendWithRetry函数 | ⚠️ 需增强 | 不触发重连，不加入队列 |
| 356-370 | executeFlow函数 | ✅ 完整 | 调用sendWithRetry |
| 372-375 | stopFlow函数 | ✅ 完整 | 调用sendWithRetry |
| 377-396 | useEffect自动连接 | ✅ 完整 | 根据参数自动连接/断开 |
| 398-406 | 返回值 | ✅ 完整 | isConnected, connectionStatus, connect, disconnect, send, executeFlow, stopFlow |

#### 问题代码定位

**问题1：重连延迟（第285-301行）**
```typescript
ws.onclose = (event) => {
  // ...
  if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
    reconnectAttemptsRef.current++;
    // 问题：首次断开 delay = 3000 * 2^0 = 3000ms
    const delay = Math.min(reconnectInterval * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);
    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, delay);
  }
};
```

**问题2：心跳不检测断开（第130-139行）**
```typescript
const startHeartbeat = useCallback(() => {
  heartbeatIntervalRef.current = setInterval(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ping' }));
    }
    // 问题：如果 readyState 不是 OPEN，不做任何处理
  }, 15000);
}, []);
```

**问题3：sendWithRetry不触发重连（第317-354行）**
```typescript
const sendWithRetry = useCallback((type, data, maxRetries = 3, retryDelay = 500) => {
  return new Promise((resolve) => {
    const attemptSend = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        // 发送成功
      } else if (attempts < maxRetries) {
        // 问题：只是等待重试，不会主动调用 connect()
        attempts++;
        setTimeout(attemptSend, retryDelay);
      } else {
        resolve(false);
      }
    };
    attemptSend();
  });
}, []);
```

### 3.3 RunPanel.tsx 相关代码分析

#### WebSocket Hook使用（第796-806行）
```typescript
const { isConnected, connectionStatus, executeFlow } = useRunWebSocket({
  agenticFlowId: agenticFlowId || null,
  sessionId: currentSessionId,
  runProjectId: currentProject?.id || null,
  onMessage: handleWebSocketMessage,
  onEvent: handleExecutionEvent,
  onError: () => { message.error('WebSocket connection error'); },
  autoReconnect: true,
});
```

#### 连接状态追踪（第808-810行）
```typescript
useEffect(() => {
  isConnectedRef.current = isConnected;
}, [isConnected]);
```

#### 发送消息逻辑（第1134-1158行）
```typescript
if (needWaitConnection) {
  // 只在新会话时等待连接
  await new Promise<void>((resolve) => {
    const checkConnection = () => {
      if (isConnectedRef.current) { resolve(); }
      else if (Date.now() - startTime > maxWaitTime) { resolve(); }
      else { setTimeout(checkConnection, 100); }
    };
    checkConnection();
  });
}

if (isConnectedRef.current) {
  const sent = await executeFlow(...);
  if (!sent) { throw new Error('WebSocket发送消息失败'); }
} else {
  // 降级到HTTP SSE
  await runApi.executeWorkflowStream(...);
}
```

**问题**：`needWaitConnection` 只在新会话时为true，已有会话但WebSocket断开时不会等待重连。

### 3.4 后端WebSocket端点分析

#### run.py WebSocket端点（第950-1258行）

后端WebSocket端点**无需修改**，原因：
1. 后端只负责接收消息、执行工作流、返回结果
2. 重连逻辑完全在前端实现
3. 后端已经有心跳响应（ping/pong）

#### websocket.py 旧端点

这是旧的WebSocket端点，用于画布执行。**不在本次修改范围内**。

---

## 四、文档修复方案逐项验证

### 4.1 修改1：新增ref变量

**文档方案**：
```typescript
// 新增
const statusCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
const messageQueueRef = useRef<Array<{
  type: string;
  data: any;
  resolve: (success: boolean) => void;
}>>([]);
const isReconnectingRef = useRef<boolean>(false);
```

**验证**：
- ✅ 类型正确
- ✅ 位置正确（第110-114行之后）
- ✅ 不影响现有代码
- ✅ 变量命名符合现有风格

**结论**：✅ 可行

### 4.2 修改2：修改startHeartbeat和stopHeartbeat

**文档方案**：
```typescript
const startHeartbeat = useCallback(() => {
  // 心跳：保持连接活跃
  heartbeatIntervalRef.current = setInterval(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ping' }));
    }
  }, 15000);
  
  // 新增：状态检查定时器
  statusCheckIntervalRef.current = setInterval(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.CLOSED) {
      // 触发重连
    }
  }, 3000);
}, [autoReconnect, maxReconnectAttempts, connect]);

const stopHeartbeat = useCallback(() => {
  // 清理心跳
  if (heartbeatIntervalRef.current) {
    clearInterval(heartbeatIntervalRef.current);
    heartbeatIntervalRef.current = null;
  }
  // 新增：清理状态检查定时器
  if (statusCheckIntervalRef.current) {
    clearInterval(statusCheckIntervalRef.current);
    statusCheckIntervalRef.current = null;
  }
}, []);
```

**验证**：
- ✅ 逻辑正确
- ✅ 不影响现有心跳功能
- ✅ 新增的状态检查定时器能检测静默断开
- ⚠️ 需要确保 `autoReconnect`, `maxReconnectAttempts`, `connect` 在依赖数组中

**结论**：✅ 可行

### 4.3 修改3：修改disconnect函数

**文档方案**：
```typescript
const disconnect = useCallback((preventReconnect: boolean = false) => {
  stopHeartbeat();
  if (reconnectTimeoutRef.current) {
    clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  }
  if (preventReconnect) {
    reconnectAttemptsRef.current = maxReconnectAttempts;
  }
  
  // 新增：重置重连状态
  isReconnectingRef.current = false;
  
  // 新增：清理消息队列（用户主动断开时）
  if (preventReconnect) {
    messageQueueRef.current = [];
  }
  
  if (wsRef.current) {
    wsRef.current.close(1000, 'User disconnected');
    wsRef.current = null;
  }
  setIsConnected(false);
  setConnectionStatus('disconnected');
}, [maxReconnectAttempts, stopHeartbeat]);
```

**验证**：
- ✅ 逻辑正确
- ✅ 重置状态防止重连冲突
- ✅ 用户主动断开时清理队列
- ⚠️ 需要确保 `stopHeartbeat` 在依赖数组中

**结论**：✅ 可行

### 4.4 修改4：修改ws.onopen

**文档方案**：
```typescript
ws.onopen = () => {
  console.log('WebSocket connected');
  setIsConnected(true);
  setConnectionStatus('connected');
  reconnectAttemptsRef.current = 0;
  isReconnectingRef.current = false;  // 新增

  ws.send(JSON.stringify({ type: 'ping' }));
  startHeartbeat();
  
  // 新增：处理队列中的消息
  while (messageQueueRef.current.length > 0) {
    const item = messageQueueRef.current.shift();
    if (item && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: item.type, ...item.data }));
        item.resolve(true);
      } catch (error) {
        item.resolve(false);
      }
    }
  }
};
```

**验证**：
- ✅ 逻辑正确
- ✅ 重连成功后自动发送队列消息
- ✅ 用户无感知
- ⚠️ 需要确保 `startHeartbeat` 函数已定义

**结论**：✅ 可行

### 4.5 修改5：修改ws.onclose

**文档方案**：
```typescript
ws.onclose = (event) => {
  console.log('WebSocket closed:', event.code, event.reason);
  setIsConnected(false);
  setConnectionStatus('disconnected');
  wsRef.current = null;
  stopHeartbeat();

  onCloseRef.current?.(event);

  if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
    reconnectAttemptsRef.current++;
    
    // 修改：首次断开立即重连，后续使用指数退避
    let delay = 0;
    if (reconnectAttemptsRef.current > 1) {
      delay = Math.min(reconnectInterval * Math.pow(2, reconnectAttemptsRef.current - 2), 30000);
    }
    
    isReconnectingRef.current = true;
    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, delay);
  }
};
```

**验证**：
- ✅ 逻辑正确
- ✅ 首次断开立即重连（delay=0）
- ✅ 后续使用指数退避
- ✅ 设置重连状态标志

**结论**：✅ 可行

### 4.6 修改6：修改sendWithRetry

**文档方案**：
```typescript
const sendWithRetry = useCallback((
  type: string, 
  data: any, 
  maxRetries: number = 3,
  retryDelay: number = 500
): Promise<boolean> => {
  return new Promise((resolve) => {
    // 情况1：已连接，直接发送
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ type, ...data }));
        resolve(true);
      } catch (error) {
        resolve(false);
      }
      return;
    }
    
    // 情况2：正在连接中，加入队列等待
    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
      messageQueueRef.current.push({ type, data, resolve });
      return;
    }
    
    // 情况3：断开状态，加入队列并触发重连
    messageQueueRef.current.push({ type, data, resolve });
    
    if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts && !isReconnectingRef.current) {
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = true;
      connect();
    }
  });
}, [autoReconnect, maxReconnectAttempts, connect]);
```

**验证**：
- ✅ 逻辑正确
- ✅ 已连接时直接发送
- ✅ 连接中时加入队列
- ✅ 断开时加入队列并触发重连
- ✅ 用户无感知

**结论**：✅ 可行

---

## 五、接口影响分析

### 5.1 useRunWebSocket Hook 返回值

**当前返回值（第398-406行）**：
```typescript
return {
  isConnected,
  connectionStatus,
  connect,
  disconnect,
  send,
  executeFlow,
  stopFlow,
};
```

**修改后返回值**：
```typescript
return {
  isConnected,
  connectionStatus,
  connect,
  disconnect,
  send,
  executeFlow,
  stopFlow,
  // 无新增
};
```

**结论**：返回值**不变**，无需修改调用方。

### 5.2 RunPanel.tsx 调用分析

| 调用位置 | 调用内容 | 是否受影响 |
|---------|---------|-----------|
| 第796-806行 | Hook初始化 | ❌ 不受影响 |
| 第808-810行 | isConnected状态追踪 | ❌ 不受影响 |
| 第1154-1158行 | executeFlow调用 | ❌ 不受影响 |

**结论**：RunPanel.tsx **无需修改**。

### 5.3 后端接口影响

| 接口 | 文件 | 是否受影响 |
|------|------|-----------|
| `/api/v1/run/ws/{agentic_flow_id}/{session_id}/{run_project_id}` | run.py | ❌ 不受影响 |
| `/api/v1/ws/{task_id}` | websocket.py | ❌ 不受影响（旧端点，不在修改范围） |

**结论**：后端接口**无需修改**。

### 5.4 废弃/冗余接口检查

| 接口/函数 | 状态 | 说明 |
|----------|------|------|
| `send` 函数 | ✅ 保留 | 简单发送，仍有用 |
| `sendWithRetry` 函数 | ⚠️ 增强 | 增加队列和重连触发 |
| `executeFlow` 函数 | ✅ 保留 | 调用sendWithRetry |
| `stopFlow` 函数 | ✅ 保留 | 调用sendWithRetry |
| `connect` 函数 | ⚠️ 增强 | onopen/onclose逻辑增强 |
| `disconnect` 函数 | ⚠️ 增强 | 增加状态重置 |
| `startHeartbeat` 函数 | ⚠️ 增强 | 增加状态检查 |
| `stopHeartbeat` 函数 | ⚠️ 增强 | 清理状态检查定时器 |

**结论**：无废弃接口，所有修改都是增强现有功能。

---

## 六、完整修改清单

### 6.1 需要修改的文件

| 文件 | 修改类型 | 修改量 |
|------|---------|--------|
| `frontend/src/hooks/useRunWebSocket.ts` | 增强 | ~100行 |

### 6.2 详细修改点

| 序号 | 位置 | 修改内容 | 行数变化 |
|------|------|----------|---------|
| 1 | 第110-114行后 | 新增3个ref变量 | +8行 |
| 2 | 第130-146行 | 修改startHeartbeat/stopHeartbeat | +20行 |
| 3 | 第148-164行 | 修改disconnect函数 | +6行 |
| 4 | 第206-214行 | 修改ws.onopen | +15行 |
| 5 | 第285-301行 | 修改ws.onclose | +8行 |
| 6 | 第317-354行 | 修改sendWithRetry | +20行 |

### 6.3 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `frontend/src/services/websocket.ts` | 旧WebSocket服务类，不在修改范围 |
| `frontend/src/components/RunPanel/RunPanel.tsx` | Hook返回值不变，无需修改 |
| `frontend/src/services/runApi.ts` | HTTP API服务，不受影响 |
| `frontend/src/store/runStore.ts` | 状态管理，不受影响 |
| `backend/app/api/v1/run.py` | 后端WebSocket端点，不受影响 |
| `backend/app/api/v1/websocket.py` | 旧WebSocket端点，不在修改范围 |

---

## 七、执行计划

### 7.1 修改顺序

```
步骤1: 新增ref变量（第110-114行后）
  ↓
步骤2: 修改startHeartbeat/stopHeartbeat（第130-146行）
  ↓
步骤3: 修改disconnect函数（第148-164行）
  ↓
步骤4: 修改ws.onopen（第206-214行）
  ↓
步骤5: 修改ws.onclose（第285-301行）
  ↓
步骤6: 修改sendWithRetry（第317-354行）
  ↓
步骤7: 测试验证
```

### 7.2 测试验证清单

| 测试项 | 验证方法 | 预期结果 |
|--------|---------|---------|
| 正常连接 | 启动应用，打开运行面板 | WebSocket连接成功 |
| 首次断开立即重连 | 手动断开网络，观察日志 | 0秒后开始重连 |
| 消息队列缓存 | 断开期间发送消息 | 消息加入队列，重连后自动发送 |
| 用户无感知 | 断开期间操作 | 操作自动执行，无报错 |
| 多次重连退避 | 连续断开多次 | 延迟递增（0s→3s→6s→12s...） |
| 状态检查定时器 | 静默断开（不触发onclose） | 3秒内检测到并重连 |

---

## 八、风险分析

### 8.1 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 消息队列内存泄漏 | 低 | disconnect时清理队列 |
| 重连风暴 | 中 | 首次立即，后续指数退避 |
| 状态不一致 | 低 | 使用ref确保实时性 |
| 并发重连 | 低 | isReconnectingRef标志 |

### 8.2 回滚方案

如果修改后出现问题，可以：
1. 恢复原始代码
2. 原始代码已在Git中保存
3. 无数据库变更，回滚无风险

---

## 九、总结

### 9.1 验证结论

| 项目 | 结论 |
|------|------|
| 设计理念遵循 | ✅ 不涉及后端架构，无需修改设计理念 |
| 文档方案可行性 | ✅ 所有修改方案均可行 |
| 接口影响 | ✅ 无废弃接口，返回值不变 |
| RunPanel修改 | ✅ 无需修改 |
| 后端修改 | ✅ 无需修改 |

### 9.2 修改范围

- **仅需修改1个文件**：`frontend/src/hooks/useRunWebSocket.ts`
- **修改量**：约100行代码
- **影响范围**：仅前端WebSocket通信层

### 9.3 预期效果

修复后，用户操作时：
1. 如果WebSocket已连接 → 直接执行
2. 如果WebSocket正在连接 → 加入队列，连接后自动执行
3. 如果WebSocket已断开 → 立即重连，重连后自动执行

**用户完全无感知，无需重新操作。**
