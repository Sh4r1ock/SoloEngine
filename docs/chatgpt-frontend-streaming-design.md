# ChatGPT 前端流式设计完整指南

## 目录

1. [概述](#1-概述)
2. [技术方案对比](#2-技术方案对比)
3. [SSE (Server-Sent Events) 技术详解](#3-sse-server-sent-events-技术详解)
4. [前端实现方案](#4-前端实现方案)
5. [框架实现示例](#5-框架实现示例)
6. [错误处理与最佳实践](#6-错误处理与最佳实践)
7. [性能优化](#7-性能优化)
8. [完整代码示例](#8-完整代码示例)
9. [AI IDE 流式实现（Trae/Cursor 等）](#9-ai-ide-流式实现traecursor-等)
   - [9.10 OpenClaw 架构参考](#910-openclaw-架构参考)

---

## 1. 概述

### 1.1 什么是流式输出？

流式输出（Streaming Response）是一种允许服务端将生成的内容以"数据流"的形式，按 Token 分块实时推送给客户端的技术。它实现了"边生成、边显示"的丝滑体验，让用户能够像看打字机一样看到 AI 的回答逐字出现。

### 1.2 为什么需要流式输出？

**传统请求模式的问题：**
- 用户提交问题后需要等待完整响应
- 长时间等待让用户感觉"卡住了"
- 首字响应时间（TTFT）过长
- 用户体验差

**流式输出的优势：**
- 用户更快感知反馈
- 更强的交互沉浸感
- 降低首字响应时间
- 用户可以提前阅读已生成的部分

### 1.3 ChatGPT 的流式设计理念

ChatGPT 采用流式输出的核心原因：
1. **单向通信需求**：AI 对话场景主要是服务端向客户端推送内容
2. **实时性要求**：用户希望尽快看到 AI 的回复
3. **长文本处理**：AI 生成的回复可能很长，流式输出可以提前展示
4. **资源效率**：避免长时间占用连接等待完整响应

---

## 2. 技术方案对比

### 2.1 主流实现方案

| 方案 | 特点 | 适用场景 | 复杂度 |
|------|------|----------|--------|
| **SSE (EventSource)** | 单向通信、基于HTTP、自动重连 | AI对话、消息推送 | 低 |
| **WebSocket** | 双向通信、独立协议、实时性强 | 聊天应用、游戏 | 中 |
| **Fetch + ReadableStream** | 灵活控制、原生API、无需额外库 | 流式下载、AI对话 | 中 |
| **轮询 (Polling)** | 简单实现、兼容性好 | 低频更新场景 | 低 |
| **长轮询 (Long Polling)** | 比轮询高效、兼容性好 | 消息通知 | 低 |

### 2.2 为什么 ChatGPT 选择 SSE 而非 WebSocket？

**SSE 的优势：**

1. **协议简单**
   - 基于标准 HTTP 协议
   - 无需握手过程
   - 服务端实现简单

2. **自动重连**
   - 浏览器原生支持断线重连
   - 无需手动实现心跳机制

3. **单向通信足够**
   - AI 对话场景主要是服务端推送
   - 不需要客户端持续发送数据

4. **资源消耗低**
   - 相比 WebSocket 更轻量
   - 适合单向数据流场景

**WebSocket 更适合的场景：**
- 需要双向实时通信（如在线游戏、协作编辑）
- 需要频繁的客户端-服务端交互
- 需要二进制数据传输

### 2.3 技术选型建议

```
AI 对话场景推荐：
├── 简单场景 → SSE (EventSource)
├── 需要更多控制 → Fetch + ReadableStream
├── 需要双向通信 → WebSocket
└── 兼容性要求高 → 长轮询
```

---

## 3. SSE (Server-Sent Events) 技术详解

### 3.1 SSE 协议格式

SSE 使用特定的文本格式传输数据：

```
data: {"content": "Hello"}\n\n
data: {"content": " World"}\n\n
data: [DONE]\n\n
```

**格式规范：**
- 每条消息以 `data:` 开头
- 消息以两个换行符 `\n\n` 结束
- `[DONE]` 表示流结束

### 3.2 SSE 消息字段

| 字段 | 说明 | 示例 |
|------|------|------|
| `data` | 消息内容 | `data: {"text": "hello"}` |
| `event` | 事件类型 | `event: message` |
| `id` | 消息ID | `id: 123` |
| `retry` | 重连间隔 | `retry: 3000` |

### 3.3 OpenAI API 流式响应格式

```json
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"index":0}]}

data: [DONE]
```

**关键字段说明：**
- `delta.content`：增量文本内容
- `choices[0].delta`：当前 token 的增量信息
- `[DONE]`：流结束标志

---

## 4. 前端实现方案

### 4.1 方案一：使用 EventSource API

**优点：**
- 浏览器原生支持
- 自动重连
- API 简单

**缺点：**
- 只支持 GET 请求
- 无法自定义请求头（除 Cookie）
- 无法发送请求体

```javascript
const eventSource = new EventSource('/api/chat?message=hello');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.content) {
    console.log(data.content);
  }
};

eventSource.onerror = (error) => {
  console.error('SSE Error:', error);
  eventSource.close();
};

eventSource.addEventListener('done', () => {
  eventSource.close();
});
```

### 4.2 方案二：使用 Fetch + ReadableStream

**优点：**
- 支持 POST 请求
- 可自定义请求头
- 更灵活的控制

**缺点：**
- 需要手动处理重连
- 实现相对复杂

```javascript
async function streamChat(message) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          return;
        }
        try {
          const parsed = JSON.parse(data);
          console.log(parsed.choices[0]?.delta?.content);
        } catch (e) {
          // JSON 解析失败，可能是数据不完整
        }
      }
    }
  }
}
```

### 4.3 方案三：使用封装库

**推荐库：**

1. **@microsoft/fetch-event-source**
   - 支持 POST 请求
   - 自动重连
   - 完善的错误处理

```javascript
import { fetchEventSource } from '@microsoft/fetch-event-source';

await fetchEventSource('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message }),
  onmessage(msg) {
    if (msg.data === '[DONE]') return;
    const data = JSON.parse(msg.data);
    console.log(data.choices[0]?.delta?.content);
  },
  onerror(err) {
    console.error('Stream error:', err);
  },
});
```

2. **ai-sdk (Vercel)**
   - 专为 AI 应用设计
   - 支持 React/Vue hooks
   - 内置状态管理

---

## 5. 框架实现示例

### 5.1 React 实现

```tsx
import { useState, useCallback, useRef } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function useStreamingChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentContent, setCurrentContent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);
    setCurrentContent('');

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              if (content) {
                setCurrentContent(prev => prev + content);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: currentContent },
      ]);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Stream aborted');
      } else {
        console.error('Stream error:', error);
      }
    } finally {
      setIsStreaming(false);
      setCurrentContent('');
    }
  }, [messages]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return {
    messages,
    isStreaming,
    currentContent,
    sendMessage,
    stopStreaming,
  };
}
```

### 5.2 Vue 3 实现

```vue
<template>
  <div class="chat-container">
    <div class="messages">
      <div v-for="(msg, index) in messages" :key="index" :class="['message', msg.role]">
        <div class="content">{{ msg.content }}</div>
      </div>
      <div v-if="isStreaming" class="message assistant">
        <div class="content">{{ currentContent }}<span class="cursor">|</span></div>
      </div>
    </div>
    
    <div class="input-area">
      <textarea v-model="inputText" @keydown.enter.prevent="sendMessage" />
      <button @click="sendMessage" :disabled="isStreaming">发送</button>
      <button v-if="isStreaming" @click="stopStreaming">停止</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const messages = ref<Message[]>([]);
const inputText = ref('');
const isStreaming = ref(false);
const currentContent = ref('');
const abortController = ref<AbortController | null>(null);

const sendMessage = async () => {
  if (!inputText.value.trim() || isStreaming.value) return;

  const userMessage: Message = { role: 'user', content: inputText.value };
  messages.value.push(userMessage);
  const messageToSend = inputText.value;
  inputText.value = '';
  isStreaming.value = true;
  currentContent.value = '';

  abortController.value = new AbortController();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.value,
        stream: true,
      }),
      signal: abortController.value.signal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              currentContent.value += content;
              await nextTick();
              scrollToBottom();
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    messages.value.push({
      role: 'assistant',
      content: currentContent.value,
    });
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') {
      console.error('Stream error:', error);
    }
  } finally {
    isStreaming.value = false;
    currentContent.value = '';
  }
};

const stopStreaming = () => {
  abortController.value?.abort();
};

const scrollToBottom = () => {
  const container = document.querySelector('.messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
};
</script>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 800px;
  margin: 0 auto;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.message {
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: 8px;
}

.message.user {
  background: #e3f2fd;
  margin-left: 20%;
}

.message.assistant {
  background: #f5f5f5;
  margin-right: 20%;
}

.cursor {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.input-area {
  display: flex;
  padding: 16px;
  border-top: 1px solid #eee;
}

.input-area textarea {
  flex: 1;
  resize: none;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.input-area button {
  margin-left: 8px;
  padding: 8px 16px;
  background: #2196f3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.input-area button:disabled {
  background: #ccc;
}
</style>
```

---

## 6. 错误处理与最佳实践

### 6.1 错误处理策略

```javascript
async function robustStreamChat(message) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await processStream(response);

    } catch (error) {
      retryCount++;
      
      if (error.name === 'AbortError') {
        console.error('Request timeout');
      } else if (error.name === 'TypeError') {
        console.error('Network error');
      } else {
        console.error('Stream error:', error);
      }

      if (retryCount < MAX_RETRIES) {
        console.log(`Retrying... (${retryCount}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * retryCount));
      } else {
        throw error;
      }
    }
  }
}

async function processStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const content = parseSSELine(line);
        if (content) {
          result += content;
        }
      }
    }

    return result;
  } catch (error) {
    reader.cancel();
    throw error;
  }
}

function parseSSELine(line) {
  if (!line.startsWith('data: ')) return null;
  
  const data = line.slice(6).trim();
  
  if (data === '[DONE]') return null;
  
  try {
    const parsed = JSON.parse(data);
    return parsed.choices?.[0]?.delta?.content || '';
  } catch {
    console.warn('Failed to parse SSE line:', line);
    return null;
  }
}
```

### 6.2 最佳实践清单

**1. 安全性**
- ✅ API Key 存储在环境变量中
- ✅ 不在前端代码中硬编码敏感信息
- ✅ 使用 HTTPS 传输
- ✅ 验证和清理用户输入

**2. 用户体验**
- ✅ 显示加载状态
- ✅ 提供停止生成按钮
- ✅ 自动滚动到最新内容
- ✅ 显示打字光标动画
- ✅ 支持断点续传（保存已生成内容）

**3. 性能优化**
- ✅ 使用防抖处理快速更新
- ✅ 虚拟滚动处理长对话
- ✅ 及时清理不需要的引用
- ✅ 合理设置超时时间

**4. 错误处理**
- ✅ 网络错误重试机制
- ✅ 超时处理
- ✅ 优雅降级（流式失败时切换到普通请求）
- ✅ 错误信息友好展示

**5. 兼容性**
- ✅ 检测浏览器支持情况
- ✅ 提供降级方案
- ✅ 处理不同 API 的响应格式差异

---

## 7. 性能优化

### 7.1 渲染优化

```javascript
import { useCallback, useRef } from 'react';

function useThrottledUpdate(callback, delay = 50) {
  const lastUpdateRef = useRef(0);
  const pendingContentRef = useRef('');
  const timeoutRef = useRef<NodeJS.Timeout>();

  const update = useCallback((content: string) => {
    pendingContentRef.current = content;
    const now = Date.now();

    if (now - lastUpdateRef.current >= delay) {
      callback(pendingContentRef.current);
      lastUpdateRef.current = now;
    } else {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        callback(pendingContentRef.current);
        lastUpdateRef.current = Date.now();
      }, delay);
    }
  }, [callback, delay]);

  return update;
}
```

### 7.2 内存管理

```javascript
function useStreamingChat() {
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const startStream = async () => {
    abortControllerRef.current = new AbortController();
    
    try {
      const response = await fetch(url, {
        signal: abortControllerRef.current.signal,
      });
      
      const reader = response.body!.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          reader.cancel();
          break;
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Stream aborted');
      }
    }
  };

  return { startStream };
}
```

### 7.3 Markdown 实时渲染优化

```javascript
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';

function StreamingMarkdown({ content }: { content: string }) {
  const [renderedContent, setRenderedContent] = useState('');
  const updateTimeoutRef = useRef<NodeJS.Timeout>();

  useMemo(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    updateTimeoutRef.current = setTimeout(() => {
      setRenderedContent(content);
    }, 16);

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [content]);

  return (
    <ReactMarkdown>{renderedContent}</ReactMarkdown>
  );
}
```

---

## 8. 完整代码示例

### 8.1 完整 React 组件

```tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatPanelProps {
  apiEndpoint?: string;
  maxRetries?: number;
  timeout?: number;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  apiEndpoint = '/api/chat',
  maxRetries = 3,
  timeout = 30000,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const parseSSELine = (line: string): string => {
    if (!line.startsWith('data: ')) return '';
    const data = line.slice(6).trim();
    if (data === '[DONE]') return '';
    
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || '';
    } catch {
      return '';
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    setError(null);

    abortControllerRef.current = new AbortController();
    const timeoutId = setTimeout(() => {
      abortControllerRef.current?.abort();
    }, timeout);

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const content = parseSSELine(line);
          if (content) {
            fullContent += content;
            setStreamingContent(fullContent);
          }
        }
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullContent,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('请求已取消或超时');
      } else {
        setError(err instanceof Error ? err.message : '发生未知错误');
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      clearTimeout(timeoutId);
    }
  };

  const stopStreaming = () => {
    abortControllerRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-panel">
      <div className="messages-container">
        {messages.map(message => (
          <div key={message.id} className={`message ${message.role}`}>
            <div className="message-content">{message.content}</div>
          </div>
        ))}
        
        {isStreaming && streamingContent && (
          <div className="message assistant streaming">
            <div className="message-content">
              {streamingContent}
              <span className="cursor">▊</span>
            </div>
          </div>
        )}
        
        {error && <div className="error-message">{error}</div>}
        
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={isStreaming}
          rows={3}
        />
        
        <div className="button-group">
          {isStreaming ? (
            <button onClick={stopStreaming} className="stop-button">
              停止生成
            </button>
          ) : (
            <button onClick={sendMessage} disabled={!input.trim()}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
```

### 8.2 样式文件

```css
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 900px;
  margin: 0 auto;
  background: #fff;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.message {
  margin-bottom: 16px;
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.6;
}

.message.user {
  margin-left: auto;
  background: #2196f3;
  color: white;
}

.message.assistant {
  margin-right: auto;
  background: #f5f5f5;
  color: #333;
}

.message.streaming {
  opacity: 0.9;
}

.cursor {
  animation: blink 0.8s infinite;
  margin-left: 2px;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.error-message {
  background: #ffebee;
  color: #c62828;
  padding: 12px;
  border-radius: 8px;
  margin: 16px 0;
}

.input-container {
  padding: 16px;
  border-top: 1px solid #e0e0e0;
  background: #fafafa;
}

.input-container textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  resize: none;
  font-size: 14px;
  font-family: inherit;
}

.input-container textarea:focus {
  outline: none;
  border-color: #2196f3;
}

.button-group {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.button-group button {
  padding: 10px 24px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.button-group button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.button-group button:not(:disabled) {
  background: #2196f3;
  color: white;
}

.button-group button:not(:disabled):hover {
  background: #1976d2;
}

.stop-button {
  background: #f44336 !important;
}

.stop-button:hover {
  background: #d32f2f !important;
}
```

---

## 9. AI IDE 流式实现（Trae/Cursor 等）

### 9.1 Trae 简介

**Trae** 是字节跳动于 2025 年推出的国内首个 AI 原生集成开发环境（AI IDE），其名字源于 "The Real AI Engineer"。Trae 深度整合了字节跳动在大模型领域的技术积累，为开发者提供智能化的编程体验。

**核心特性：**
- 集成多种 AI 模型：Claude 3.5、GPT-4o、doubao-1.5-pro、DeepSeek R1/V3
- 支持 MCP (Model Context Protocol) 协议
- 智能代码补全、生成、优化
- 多模态输入支持
- 原生中文界面

### 9.2 AI IDE 技术架构

AI IDE（如 Trae、Cursor）的技术架构通常分为三个核心部分：

```
┌─────────────────────────────────────────────────────────────┐
│                      AI IDE 架构                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │           编辑器核心 (VS Code Base)                   │   │
│  │  • 代码编辑器                                         │   │
│  │  • 文件系统                                           │   │
│  │  • 扩展机制                                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           AI 模型集成层                               │   │
│  │  • NLP 模型（自然语言理解）                           │   │
│  │  • 代码生成模型                                       │   │
│  │  • 代码补全模型                                       │   │
│  │  • 错误检测模型                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │        本地与云端协同计算框架                          │   │
│  │  ┌─────────────┐        ┌─────────────────────┐     │   │
│  │  │  本地模型    │        │     云端模型         │     │   │
│  │  │  (轻量级)    │        │   (计算密集型)       │     │   │
│  │  │  • 补全      │        │   • 代码生成         │     │   │
│  │  │  • 错误检测  │        │   • 复杂优化         │     │   │
│  │  └─────────────┘        └─────────────────────┘     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 流式通信方案对比

AI IDE 场景下的流式通信有多种选择：

| 方案 | 特点 | Trae/Cursor 选择 |
|------|------|------------------|
| **SSE** | 单向、HTTP、自动重连 | ✅ 适合 AI 对话 |
| **gRPC Streaming** | 双向、高性能、Protobuf | ✅ 适合服务端架构 |
| **WebSocket** | 双向、实时性强 | 可选，用于协作场景 |
| **本地调用** | 零延迟、隐私保护 | ✅ 轻量级任务 |

### 9.4 Trae/Cursor 的混合计算模式

```javascript
// 任务分类与调度策略
const TaskScheduler = {
  // 实时性任务 → 本地模型
  realtime: {
    tasks: ['代码补全', '语法检查', '简单错误检测'],
    strategy: 'local',
    latency: '< 50ms',
  },
  
  // 计算密集型任务 → 云端模型
  computeIntensive: {
    tasks: ['代码生成', '代码优化', '重构建议'],
    strategy: 'cloud',
    latency: '500ms - 5s',
    streaming: true,
  },
  
  // 混合任务 → 动态选择
  hybrid: {
    tasks: ['代码重构', '文档生成'],
    strategy: 'adaptive',
    fallback: 'local',
  },
};
```

### 9.5 AI IDE 流式实现架构

```typescript
// AI IDE 流式通信架构
interface StreamConfig {
  endpoint: string;
  model: 'local' | 'cloud';
  protocol: 'sse' | 'grpc' | 'websocket';
}

class AIStreamManager {
  private abortController: AbortController | null = null;
  private localModel: LocalModelRunner;
  private cloudClient: CloudModelClient;

  async streamGenerate(prompt: string, config: StreamConfig) {
    if (config.model === 'local') {
      return this.streamFromLocal(prompt);
    }
    return this.streamFromCloud(prompt, config);
  }

  // 本地模型流式输出
  private async *streamFromLocal(prompt: string) {
    const tokens = await this.localModel.generate(prompt);
    for (const token of tokens) {
      yield { type: 'token', content: token };
    }
  }

  // 云端模型流式输出 (SSE/gRPC)
  private async *streamFromCloud(prompt: string, config: StreamConfig) {
    this.abortController = new AbortController();

    if (config.protocol === 'sse') {
      yield* this.streamViaSSE(prompt, config);
    } else if (config.protocol === 'grpc') {
      yield* this.streamViaGRPC(prompt, config);
    }
  }

  // SSE 流式通信
  private async *streamViaSSE(prompt: string, config: StreamConfig) {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, stream: true }),
      signal: this.abortController.signal,
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          yield { type: 'token', content: data.content };
        }
      }
    }
  }

  // gRPC 流式通信 (更高效)
  private async *streamViaGRPC(prompt: string, config: StreamConfig) {
    const stream = this.cloudClient.createStream(config.endpoint);
    
    stream.write({ prompt });
    
    for await (const response of stream) {
      yield { type: 'token', content: response.content };
    }
  }

  abort() {
    this.abortController?.abort();
  }
}
```

### 9.6 MCP 协议与流式传输

**MCP (Model Context Protocol)** 是 Anthropic 推出的开放协议，定义了 AI 如何与外部工具、数据源进行标准化交互。Trae 支持 MCP 协议，实现更灵活的流式交互。

```typescript
// MCP 流式通信示例
interface MCPStreamMessage {
  type: 'request' | 'response' | 'stream';
  tool: string;
  data: any;
}

class MCPStreamHandler {
  // MCP 支持双向流式传输
  async handleStream(message: MCPStreamMessage) {
    switch (message.type) {
      case 'stream':
        // 处理流式响应
        for await (const chunk of this.processStream(message)) {
          this.emit('chunk', chunk);
        }
        break;
      case 'request':
        // 处理请求并返回流式响应
        return this.createStreamResponse(message);
    }
  }

  // MCP 流式传输实现
  private async *processStream(message: MCPStreamMessage) {
    // 基于 gRPC Streaming 或 WebSocket 实现
    const connection = await this.connectMCP(message.tool);
    
    for await (const data of connection.stream()) {
      yield {
        tool: message.tool,
        content: data,
        timestamp: Date.now(),
      };
    }
  }
}
```

### 9.7 Trae vs ChatGPT 流式设计对比

| 维度 | ChatGPT (Web) | Trae (AI IDE) |
|------|---------------|---------------|
| **主要场景** | AI 对话 | 代码开发 |
| **通信方式** | SSE (HTTP) | SSE + gRPC + 本地调用 |
| **模型位置** | 纯云端 | 本地 + 云端混合 |
| **延迟要求** | 适中 | 实时性要求更高 |
| **数据隐私** | 代码不上传 | 敏感代码可本地处理 |
| **离线支持** | 不支持 | 部分功能支持 |
| **协议选择** | SSE 足够 | 多协议协同 |

### 9.8 AI IDE 流式最佳实践

**1. 任务分级策略**

```typescript
const TaskPriority = {
  // P0: 实时性要求最高，必须本地处理
  P0_LOCAL: {
    examples: ['代码补全', '语法高亮'],
    maxLatency: 50, // ms
    strategy: 'local',
  },
  
  // P1: 需要快速响应，优先本地
  P1_PREFER_LOCAL: {
    examples: ['简单错误检测', '格式化'],
    maxLatency: 200,
    strategy: 'local-first',
    fallback: 'cloud',
  },
  
  // P2: 可以接受一定延迟
  P2_CLOUD_STREAMING: {
    examples: ['代码生成', '重构建议'],
    maxLatency: 5000,
    strategy: 'cloud-streaming',
  },
};
```

**2. 智能降级策略**

```typescript
class IntelligentFallback {
  async execute(task: Task) {
    try {
      // 优先尝试云端
      if (this.shouldUseCloud(task)) {
        return await this.streamFromCloud(task);
      }
    } catch (error) {
      // 云端失败，降级到本地
      console.warn('Cloud failed, falling back to local');
      return await this.executeLocal(task);
    }
  }

  private shouldUseCloud(task: Task): boolean {
    return (
      this.networkAvailable &&
      !task.containsSensitiveData &&
      task.complexity > LOCAL_MODEL_THRESHOLD
    );
  }
}
```

**3. 缓存与预加载**

```typescript
class StreamCache {
  private cache = new Map<string, CachedResponse>();
  private preloadQueue: string[] = [];

  // 缓存常用响应
  async getCachedOrStream(key: string, streamFn: () => AsyncGenerator) {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const result = [];
    for await (const chunk of streamFn()) {
      result.push(chunk);
      yield chunk;
    }

    this.cache.set(key, result);
  }

  // 预加载常用模型
  async preloadModels() {
    for (const model of this.preloadQueue) {
      await this.loadModel(model);
    }
  }
}
```

### 9.9 自动化 IDE（SOLO 模式）通信架构

#### 什么是 SOLO 模式？

**SOLO 模式** 是 Trae 推出的以 AI 为主导的全流程自动化开发模式，核心是让 AI 自主完成从需求理解、任务拆解、编码、测试到部署的完整开发链路。

**核心特点：**
- AI 作为"全能开发团队"，开发者是"指挥者"
- 用户仅需自然语言输入需求
- AI 自主拆解任务、规划步骤、调度工具
- 支持多任务并行处理

#### SOLO 模式 vs 传统 AI IDE

| 维度 | 传统 AI IDE | SOLO 模式（自动化 IDE） |
|------|-------------|------------------------|
| **AI 角色** | 辅助工具 | 主导执行者 |
| **任务类型** | 单次问答 | 多步骤任务链 |
| **执行方式** | 用户驱动 | AI 自主驱动 |
| **状态管理** | 无状态 | 有状态（任务进度） |
| **工具调用** | 简单 | 复杂（文件、终端、浏览器等） |
| **通信需求** | 单向推送 | 单向推送（足够） |

#### 推荐方案：**纯 SSE + 工具调用协议**

对于自动化 IDE（SOLO 模式），**纯 SSE 完全足够**，不需要 WebSocket：

```
┌─────────────────────────────────────────────────────────────────┐
│                自动化 IDE (SOLO 模式) 通信架构                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  用户输入需求（自然语言）                                         │
│           ↓                                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              AI 自主执行全流程                            │   │
│  │  1. 需求理解                                              │   │
│  │  2. 任务拆解（Planning）                                  │   │
│  │  3. 代码编写                                              │   │
│  │  4. 测试执行                                              │   │
│  │  5. 部署上线                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│           ↓                                                      │
│  输出可运行项目 + 预览链接 + 文档                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 为什么 SSE 完全足够？

**1. 任务执行是单向的**
- AI 执行任务 → 推送进度给用户
- 不需要用户实时干预

**2. 工具调用在服务端完成**
- 文件操作、终端执行都在服务端
- 只需要推送结果给客户端展示

**3. 状态由服务端管理**
- 任务进度、执行状态都在服务端
- 客户端只是展示层

**4. 用户干预通过新请求实现**
- 用户想修改 → 发起新的 SSE 请求
- 不需要双向实时通信

#### 完整架构实现

```typescript
// 自动化 IDE 通信架构
class SoloModeArchitecture {
  
  // SSE 流式推送任务执行过程
  async *executeTask(requirement: string): AsyncGenerator<TaskEvent> {
    
    // 1. 需求理解 + 任务规划
    yield { type: 'planning', status: 'analyzing', message: '理解需求中...' };
    const plan = await this.planner.analyze(requirement);
    yield { type: 'plan', tasks: plan.subtasks };
    
    // 2. 逐步执行子任务
    for (const task of plan.subtasks) {
      yield { type: 'task_start', task };
      
      // 根据任务类型调用不同工具
      switch (task.type) {
        case 'create_file':
          yield* this.createFile(task);
          break;
        case 'edit_file':
          yield* this.editFile(task);
          break;
        case 'run_command':
          yield* this.runCommand(task);
          break;
        case 'test':
          yield* this.runTest(task);
          break;
      }
      
      yield { type: 'task_complete', task };
    }
    
    // 3. 部署预览
    yield { type: 'deploying', message: '部署中...' };
    const previewUrl = await this.deploy();
    yield { type: 'complete', previewUrl };
  }
  
  // 文件创建工具
  async *createFile(task: FileTask): AsyncGenerator<TaskEvent> {
    yield { type: 'file_create', path: task.path };
    
    // 流式生成代码
    const stream = await this.llm.generateCode(task.spec);
    let content = '';
    
    for await (const chunk of stream) {
      content += chunk;
      yield { 
        type: 'file_content', 
        path: task.path, 
        delta: chunk,
        content // 实时推送完整内容
      };
    }
    
    // 写入文件
    await this.fs.writeFile(task.path, content);
    yield { type: 'file_saved', path: task.path };
  }
  
  // 终端执行工具
  async *runCommand(task: CommandTask): AsyncGenerator<TaskEvent> {
    yield { type: 'terminal_start', command: task.command };
    
    const process = this.terminal.execute(task.command);
    
    // 流式推送终端输出
    for await (const output of process.stdout) {
      yield { type: 'terminal_output', output };
    }
    
    yield { type: 'terminal_complete', exitCode: process.exitCode };
  }
}
```

#### SSE 事件类型设计

```typescript
// 自动化 IDE 的事件类型
type TaskEvent = 
  // 规划阶段
  | { type: 'planning'; status: string; message: string }
  | { type: 'plan'; tasks: SubTask[] }
  
  // 任务执行
  | { type: 'task_start'; task: SubTask }
  | { type: 'task_complete'; task: SubTask }
  
  // 文件操作
  | { type: 'file_create'; path: string }
  | { type: 'file_content'; path: string; delta: string; content: string }
  | { type: 'file_saved'; path: string }
  
  // 终端操作
  | { type: 'terminal_start'; command: string }
  | { type: 'terminal_output'; output: string }
  | { type: 'terminal_complete'; exitCode: number }
  
  // 测试结果
  | { type: 'test_result'; passed: number; failed: number }
  
  // 部署
  | { type: 'deploying'; message: string }
  | { type: 'complete'; previewUrl: string }
  
  // 错误
  | { type: 'error'; task?: SubTask; error: string };
```

#### 客户端事件处理

```typescript
// 客户端事件处理
class SoloModeClient {
  
  handleEvent(event: TaskEvent) {
    switch (event.type) {
      case 'planning':
        this.ui.showStatus('正在分析需求...');
        break;
        
      case 'plan':
        this.ui.showTaskList(event.tasks);
        break;
        
      case 'file_content':
        // 实时更新编辑器内容
        this.editor.updateFile(event.path, event.content);
        break;
        
      case 'terminal_output':
        // 实时更新终端输出
        this.terminal.appendOutput(event.output);
        break;
        
      case 'complete':
        // 打开预览
        this.browser.open(event.previewUrl);
        break;
    }
  }
}
```

#### 工具调用架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      工具调度器架构                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    AI Agent 核心                          │   │
│  │  • 需求理解                                              │   │
│  │  • 任务规划                                              │   │
│  │  • 工具调度决策                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│           ┌───────────────┼───────────────┐                     │
│           ↓               ↓               ↓                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │
│  │  文件工具    │  │  终端工具   │  │  其他工具            │     │
│  │  • 读取文件  │  │  • 执行命令 │  │  • Git 操作         │     │
│  │  • 写入文件  │  │  • 获取输出 │  │  • 数据库操作       │     │
│  │  • 删除文件  │  │  • 杀进程   │  │  • API 调用         │     │
│  └─────────────┘  └─────────────┘  └─────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 架构决策总结

| 功能模块 | 推荐方案 | 原因 |
|----------|----------|------|
| 需求理解 | **SSE** | 流式输出思考过程 |
| 任务规划 | **SSE** | 推送任务列表 |
| 文件创建/编辑 | **SSE** | 流式推送代码内容 |
| 终端执行 | **SSE** | 推送执行输出 |
| 测试运行 | **SSE** | 推送测试结果 |
| 部署预览 | **SSE** | 推送预览链接 |

#### 最终建议

**对于自动化 IDE（SOLO 模式），推荐以下架构：**

```
核心架构：
├── SSE 通信层（唯一需要的网络通信）
│   ├── 任务规划流式输出
│   ├── 代码生成流式输出
│   ├── 终端输出流式推送
│   └── 进度状态推送
│
├── 工具调用层（服务端）
│   ├── 文件系统操作
│   ├── 终端命令执行
│   ├── Git 操作
│   └── 部署工具
│
└── 状态管理层（服务端）
    ├── 任务状态
    ├── 执行进度
    └── 错误处理
```

**结论：对于自动化 IDE（SOLO 模式），纯 SSE 完全足够，不需要 WebSocket。**

---

### 9.10 OpenClaw 架构参考

#### OpenClaw 简介

**OpenClaw** 是一款开源的自主 AI 智能体（Autonomous AI Agent）框架，其核心定位是将大语言模型(LLM)从"信息生成者"转化为具备系统操作能力的"数字员工"。

#### OpenClaw 通信架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway 架构                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Gateway (核心网关)                     │   │
│  │  运行在: ws://127.0.0.1:18789                            │   │
│  │  功能: 多路复用 WebSocket + HTTP                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│           ↑                        ↑                            │
│           │ WebSocket              │ HTTP                       │
│           │                        │                            │
│  ┌────────┴────────┐      ┌────────┴────────┐                  │
│  │  内部客户端      │      │  外部平台        │                  │
│  │  • CLI          │      │  • Telegram     │                  │
│  │  • WebChat UI   │      │  • WhatsApp     │                  │
│  │  • macOS App    │      │  • Discord      │                  │
│  │  • iOS/Android  │      │                 │                  │
│  └─────────────────┘      └─────────────────┘                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### OpenClaw 为什么选择 WebSocket？

OpenClaw 选择 WebSocket 的**三个核心原因**：

**1. 流式推理输出**

```
Agent 执行过程：Thought → Action → Observation → Thought → Final Answer

WebSocket：每一步都能实时推送给客户端
HTTP：必须等整个循环跑完才能拿到结果
```

```typescript
// Agent 推理循环示例
// Thought: 用户想看 PR 列表，需要调用 github skill
// Action: exec("gh pr list --state open --json number,title,author")
// Observation: [{"number":42,"title":"Fix login bug"...}]
// Thought: 拿到数据了，整理成自然语言回复
// Final Answer: "当前有 3 个 open PR..."
```

**2. 双向确认交互**

```
场景：Agent 执行到一半需要用户确认

WebSocket：服务端可以随时主动发消息
HTTP：服务端无法主动联系客户端
```

**3. 多客户端状态同步**

```
场景：手机发消息，电脑上看进度

WebSocket：同一个 Agent 状态广播给所有客户端
HTTP：每个客户端各自轮询，需要额外协调层
```

#### OpenClaw 的混合方案

| 通道 | 协议 | 原因 |
|------|------|------|
| **CLI / WebChat / App** | **WebSocket** | 实时性、双向通信、多客户端同步 |
| **Telegram / WhatsApp** | **HTTP (Long Polling)** | 平台限制，零配置优先 |

#### 协议对比

| 方案 | 服务端主动推 | 流式中间状态 | 双向通信 | 多客户端广播 | 连接开销 |
|------|-------------|-------------|----------|-------------|----------|
| 短轮询 | ❌ | ❌ | ❌ | ❌ | 高（每次重建） |
| 长轮询 | △ 模拟 | ❌ | ❌ | ❌ | 中 |
| **WebSocket** | ✅ 原生 | ✅ | ✅ | ✅ | 低（一次握手） |

#### OpenClaw 断线重连实现

```typescript
class ReconnectingWebSocket {
  private ws: WebSocket;
  private retryDelay = 1000;
  private maxDelay = 30000;

  constructor(private url: string) {
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.retryDelay = 1000; // 连上了，重置退避计时
    };

    this.ws.onclose = () => {
      setTimeout(() => {
        this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay);
        this.connect();
      }, this.retryDelay);
    };

    this.ws.onmessage = ({ data }) => {
      this.handleMessage(JSON.parse(data));
    };
  }

  private handleMessage(data: any) {
    // 处理消息
  }
}
```

#### OpenClaw 架构启示

**OpenClaw 的选择原则：根据场景选择协议**

```
OpenClaw 架构决策：

├── 内部客户端（CLI、WebChat、App）
│   └── WebSocket ✅
│   原因：需要多客户端同步、双向交互、流式推理输出
│
├── 外部平台接入（Telegram、WhatsApp）
│   └── HTTP Long Polling ✅
│   原因：平台限制、零配置优先
│
└── 核心原则
    ├── 不是"WebSocket 更好"，而是"Agent 模型需要它"
    └── 技术选型是找最匹配约束的解，不是找最优解
```

#### 对比：OpenClaw vs 自动化 IDE

| 维度 | OpenClaw | 自动化 IDE (SOLO 模式) |
|------|----------|------------------------|
| **多客户端同步** | ✅ 需要 | ❌ 不需要 |
| **双向交互** | ✅ 需要（用户确认） | ❌ 不需要 |
| **外部平台接入** | ✅ 需要 | ❌ 不需要 |
| **推荐协议** | WebSocket + HTTP | SSE + HTTP |

**结论：OpenClaw 用 WebSocket 是因为它需要多客户端同步和双向交互。如果你的项目主要是 AI 对话和代码生成，SSE 足够；如果未来需要多客户端同步，再加 WebSocket。**

---

## 附录

### A. 常见问题 FAQ

**Q1: SSE 和 WebSocket 如何选择？**

A: 如果只需要服务端向客户端推送数据（如 AI 对话），选择 SSE；如果需要双向实时通信（如在线协作），选择 WebSocket。

**Q2: 如何处理网络断开？**

A: 使用 EventSource 时浏览器会自动重连；使用 Fetch API 时需要手动实现重连逻辑。

**Q3: 如何实现多轮对话？**

A: 维护一个 messages 数组，每次请求时发送完整的对话历史。

**Q4: 如何优化长对话的性能？**

A: 
- 使用虚拟滚动
- 限制发送的历史消息数量
- 使用滑动窗口策略

### B. 参考资源

- [MDN - Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference/streaming)
- [Fetch API - ReadableStream](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)

### C. 术语表

| 术语 | 说明 |
|------|------|
| SSE | Server-Sent Events，服务器推送事件 |
| TTFT | Time To First Token，首字响应时间 |
| Token | AI 模型处理文本的基本单位 |
| Chunk | 数据分块，流式传输的基本单位 |
| Delta | 增量数据，流式响应中的变化部分 |

---

*文档版本: 1.0*
*最后更新: 2024年*
