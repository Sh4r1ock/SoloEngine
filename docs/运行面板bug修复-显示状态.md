# 运行面板Bug修复 - 执行文档

## 修复原则
- **最小改动原则**：只修改必要的代码，不创建新组件
- **统一渲染逻辑**：AI消息统一使用流式输出过程中的渲染方式
- **保持用户消息格式**：用户消息保持现有的渲染方式

---

## Bug 1：流式输出缩进一致性问题

### 问题原因
AI消息在流式输出过程中和历史消息使用了不同的渲染结构，导致缩进不一致。

### 修复方案
**AI消息统一使用流式输出过程中的渲染方式**，删除AI历史消息的独立渲染逻辑。用户消息保持现有渲染方式。

### 执行步骤

#### 步骤1：修改历史消息渲染代码块

**修改位置**：第2083-2272行

**修改前**：现有的历史消息渲染代码（区分用户和AI）

**修改后**：
```jsx
{llmMessages.map(msg => (
  msg.role === 'user' ? (
    // 用户消息：保持现有渲染方式
    <div 
      key={msg.id}
      onMouseEnter={() => setHoveredMessageId(msg.id)}
      onMouseLeave={() => setHoveredMessageId(null)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'flex-end',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexDirection: 'row-reverse',
      }}>
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
          <span style={{ color: '#fff', fontWeight: 500, fontSize: 12 }}>U</span>
        </div>
        <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>用户</Text>
        <Text style={{ 
          fontSize: 12, 
          color: 'var(--text-300)', 
          opacity: hoveredMessageId === msg.id ? 1 : 0,
          transition: 'opacity 0.2s',
        }}>
          {formatTime(msg.timestamp)}
        </Text>
      </div>
      <div style={{
        padding: '12px 14px',
        borderRadius: 8,
        background: 'var(--bg-200)',
        maxWidth: '90%',
      }}>
        <div style={{ 
          whiteSpace: 'pre-wrap', 
          lineHeight: 1.7,
          fontSize: 14,
          color: 'var(--text-100)',
          textAlign: 'right',
        }}>
          {msg.content}
        </div>
      </div>
    </div>
  ) : (
    // AI消息：使用流式输出过程中的渲染方式
    <div key={msg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
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
        <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
          <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>{formatTime(msg.timestamp)}</Text>
        </div>
        {msg.reasoning_content && (
          <div style={{ width: '100%' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              userSelect: 'none',
            }}>
              <span style={{ 
                fontSize: 12, 
                color: 'var(--text-200)',
                width: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>ⓘ</span>
              <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
                Thought
              </Text>
            </div>
            <div style={{
              display: 'flex',
              gap: 0,
              marginTop: 4,
            }}>
              <div style={{
                width: 14,
                display: 'flex',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <div style={{ width: 2, background: 'var(--bg-300)' }} />
              </div>
              <div style={{
                flex: 1,
                padding: '0 0 6px 6px',
                fontSize: 12,
                color: 'var(--text-200)',
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
              }}>
                {msg.reasoning_content}
              </div>
            </div>
          </div>
        )}
        {msg.content && (
          <div style={{ 
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.7, 
            fontSize: 14, 
            color: 'var(--text-100)',
          }}>
            {msg.content}
          </div>
        )}
      </div>
    </div>
  )
))}
```

---

## Bug 2：useEffect执行顺序问题

### 问题原因
两个useEffect都依赖相同条件，执行顺序不确定，导致restoreSession可能被覆盖。

### 修复方案
**合并两个useEffect**，确保执行顺序：先加载sessions，再恢复session。

### 执行步骤

#### 步骤1：删除原有的两个useEffect

**删除位置1**：第343-347行
```jsx
useEffect(() => {
  if (agenticFlowId && currentProject?.id) {
    loadSessionsFromBackend();
  }
}, [agenticFlowId, currentProject?.id, loadSessionsFromBackend]);
```

**删除位置2**：第349-387行
```jsx
useEffect(() => {
  const restoreSession = async () => { ... };
  restoreSession();
}, [agenticFlowId, currentProject?.id, setCurrentSessionId, setLlmMessages]);
```

#### 步骤2：添加合并后的useEffect

**添加位置**：在第343行（原useEffect位置）

**添加内容**：
```jsx
useEffect(() => {
  if (!agenticFlowId || !currentProject?.id) return;
  
  let isMounted = true;
  
  const init = async () => {
    // 先加载session列表
    await loadSessionsFromBackend();
    
    // 然后恢复当前session
    if (!isMounted) return;
    
    const storedState = localStorage.getItem('run-store');
    if (storedState) {
      try {
        const parsed = JSON.parse(storedState);
        const storedSessionId = parsed.state?.currentSessionId;
        
        if (storedSessionId && isMounted) {
          try {
            const messages = await runApi.getSessionMessages(storedSessionId);
            if (messages && messages.length >= 0 && isMounted) {
              setCurrentSessionId(storedSessionId);
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
          } catch (error) {
            if (isMounted) {
              console.log('Stored session not in database, clearing currentSessionId');
              setCurrentSessionId(null);
              setLlmMessages([]);
            }
          }
        }
      } catch (e) {
        console.error('Failed to parse stored session:', e);
      }
    }
  };
  
  init();
  
  return () => {
    isMounted = false;
  };
}, [agenticFlowId, currentProject?.id]);
```

---

## Bug 3：发送消息后没有立刻显示"正在思考..."

### 问题原因
等待状态的条件包含`llmMessages.length > 0`，但用户发送消息后，消息列表区域进入渲染，但历史消息为空，等待状态条件不满足。

### 修复方案
**将等待状态合并到流式输出结构中**，移除独立的等待状态代码块，移除`llmMessages.length > 0`条件。

### 执行步骤

#### 步骤1：删除独立的等待状态代码块

**删除位置**：第2273-2309行

**删除内容**：
```jsx
{(llmLoading || isRunning) && !streamingContent && !streamingThinkingContent && llmMessages.length > 0 && (
  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
    ...等待状态代码
  </div>
)}
```

#### 步骤2：修改流式输出代码块，添加等待状态

**修改位置**：第2310行开始的流式输出代码块

**修改前**：
```jsx
{(streamingContent || streamingThinkingContent) && (
  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
    ...
  </div>
)}
```

**修改后**：
```jsx
{(llmLoading || isRunning || streamingContent || streamingThinkingContent) && (
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
      <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 13, color: 'var(--text-100)', fontWeight: 500 }}>AI助手</Text>
        <Text style={{ fontSize: 12, color: 'var(--text-300)' }}>{formatTime(new Date().toISOString())}</Text>
      </div>
      
      {/* 等待状态：没有内容时显示 */}
      {(llmLoading || isRunning) && !streamingContent && !streamingThinkingContent && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 14,
            height: 14,
            border: '2px solid var(--bg-300)',
            borderTopColor: 'var(--primary-100)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <Text style={{ fontSize: 14, color: 'var(--text-200)' }}>正在思考...</Text>
        </div>
      )}
      
      {/* 流式思考内容 */}
      {streamingThinkingContent && (
        <div style={{ width: '100%' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            userSelect: 'none',
          }}>
            <span style={{ 
              fontSize: 12, 
              color: 'var(--text-200)',
              width: 14,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>ⓘ</span>
            <Text style={{ fontSize: 12, color: 'var(--text-200)', fontWeight: 500 }}>
              Thought
            </Text>
          </div>
          <div style={{
            display: 'flex',
            gap: 0,
            marginTop: 4,
          }}>
            <div style={{
              width: 14,
              display: 'flex',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <div style={{ width: 2, background: 'var(--bg-300)' }} />
            </div>
            <div style={{
              flex: 1,
              padding: '0 0 6px 6px',
              fontSize: 12,
              color: 'var(--text-200)',
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
            }}>
              {streamingThinkingContent}
            </div>
          </div>
        </div>
      )}
      
      {/* 流式内容 */}
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
    </div>
  </div>
)}
```

---

## 执行顺序

1. **先执行Bug 2**：合并useEffect（因为这是基础改动）
2. **再执行Bug 3**：修改等待状态和流式输出结构
3. **最后执行Bug 1**：修改历史消息渲染，AI消息统一使用流式输出渲染方式

---

## 验证要点

1. **缩进一致性**：AI消息在流式输出过程中和流式结束后，缩进应该一致
2. **用户消息格式**：用户消息右对齐有背景色，保持不变
3. **Session恢复**：进入运行面板后，对话记录应该正确显示
4. **等待状态**：发送消息后应该立刻显示"正在思考..."（转圈效果）
5. **首个chunk替换**：首个chunk到来后，"正在思考..."应该被替换为实际内容
