/**
 * SoloEngine : 运行API服务模块
 *
 * @file runApi.ts
 * @description 运行API服务 - 工作流运行相关API调用
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 运行会话管理API
 *     - JSON工作流执行API
 *     - 执行历史API
 *     - 会话消息持久化API
 *     - 获取会话消息列表
 *     - 添加消息到会话
 *
 * 依赖:
 *     - ./api: API基础服务
 *
 * 使用示例:
 *     - import { runApi } from './runApi'
 *     - const result = await runApi.executeFlow(flowId, input)
 *
 * 使用场景：
 *     - 运行面板调用后端运行服务
 *     - 执行工作流JSON
 */

import { api } from './api';

export interface ExecutionResult {
  execution_id: string;
  status: string;
  output: string;
  node_results?: Record<string, any>;
  error?: string;
}

export interface Session {
  id: string;
  status: string;
  error?: string;
  token_usage?: Record<string, number>;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
  duration_ms?: number;
  first_assistant_content?: string;
}

export interface DataBlock {
  type: 'content' | 'reasoning_content' | 'tool_calls';
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
    result?: string;
  }>;
}

export interface SessionMessage {
  id: string;
  role: string;
  content?: string;
  data: DataBlock[];
  message_index: number;
  token_usage_history?: any[];
  created_at?: string;
  timestamp?: string;
  reasoning_content?: string;
  tokens?: number;
  error?: string;
}

export const runApi = {
  async executeWorkflowStream(
    canvasData: any,
    inputMessage: string,
    onStream: (delta: any) => void,
    onComplete: (result: any) => void,
    onError: (error: string) => void,
    agenticFlowId?: string,
    sessionId?: string,
    context?: Record<string, any>,
    signal?: AbortSignal
  ): Promise<void> {
    const token = localStorage.getItem('access_token');
    const response = await fetch('/api/v1/run/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        canvas_data: canvasData,
        input_message: inputMessage,
        agentic_flow_id: agenticFlowId,
        session_id: sessionId,
        context: context,
      }),
      signal,
    });

    if (!response.ok) {
      const statusMap: Record<number, string> = {
        400: '请求参数错误',
        401: '登录已过期，请重新登录',
        403: '没有权限执行此操作',
        404: '请求的资源不存在',
        500: '服务器内部错误，请检查后端服务',
        502: '网关错误，请刷新页面重试',
        503: '服务暂时不可用，请稍后重试',
        504: '网关超时，请稍后重试',
      };
      throw new Error(statusMap[response.status] || `服务器错误 (${response.status})`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('响应内容为空');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (data.type) {
                case 'stream':
                  if (data.delta) {
                    onStream(data.delta);
                  }
                  break;
                case 'execution_complete':
                  onComplete(data);
                  break;
                case 'error':
                  onError(data.message || 'Unknown error');
                  break;
                case 'status':
                  console.log('[SSE Status]', data.message);
                  break;
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data:', line, parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  async getSessions(params: {
    agentic_flow_id: string;
    run_project_id: string;
    status?: string;
    limit?: number;
  }): Promise<Session[]> {
    const response = await api.get('/run/sessions', { params });
    if (response.data && response.data.data) {
      return response.data.data;
    }
    return response.data;
  },

  async getSession(sessionId: string): Promise<Session> {
    const response = await api.get(`/run/sessions/${sessionId}`);
    if (response.data && response.data.data) {
      return response.data.data;
    }
    return response.data;
  },

  async deleteSession(sessionId: string): Promise<void> {
    await api.delete(`/run/sessions/${sessionId}`);
  },

  async getSessionMessages(sessionId: string, params?: {
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    // 使用 fetch 替代 axios，避免某些情况下的问题
    const token = localStorage.getItem('access_token');
    const queryParams = params ? new URLSearchParams(params as any).toString() : '';
    const url = `/api/v1/run/sessions/${sessionId}/messages${queryParams ? '?' + queryParams : ''}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const statusMap: Record<number, string> = {
        400: '请求参数错误',
        401: '登录已过期，请重新登录',
        403: '没有权限执行此操作',
        404: '会话不存在',
        500: '服务器内部错误，请检查后端服务',
        502: '网关错误，请刷新页面重试',
        503: '服务暂时不可用，请稍后重试',
        504: '网关超时，请稍后重试',
      };
      throw new Error(statusMap[response.status] || `服务器错误 (${response.status})`);
    }
    
    const data = await response.json();
    if (data && data.data) {
      return data.data;
    }
    return [];
  },
};

export default runApi;
