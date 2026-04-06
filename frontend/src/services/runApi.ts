/**
 * @file runApi.ts
 * @description 运行API服务 - 工作流运行相关API调用
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 运行会话管理API
 * - JSON工作流执行API
 * - 执行历史API
 * - 会话消息持久化API
 * 
 * 使用场景：
 * - 运行面板调用后端运行服务
 * - 执行工作流JSON
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
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  created_at?: string;
  timestamp?: string;
  reasoning_content?: string;
  tokens?: number;
}

export interface ExecutionStep {
  id: string;
  step_type: string;
  node_id: string;
  node_name: string;
  thought?: string;
  action?: string;
  observation?: string;
  error?: string;
  created_at: string;
}

export interface ToolCallRecord {
  id: string;
  tool_name: string;
  arguments: Record<string, any>;
  result?: string;
  error?: string;
  created_at: string;
}

export const runApi = {
  async executeWorkflow(
    canvasData: any,
    inputMessage: string,
    projectName?: string,
    context?: Record<string, any>
  ): Promise<ExecutionResult> {
    const response = await api.post('/run/execute', {
      canvas_data: canvasData,
      input_message: inputMessage,
      project_name: projectName,
      context: context,
    });
    
    if (response.data && response.data.data) {
      return response.data.data;
    } else if (response.data && response.data.output) {
      return response.data;
    } else if (response.data && response.data.error) {
      return {
        execution_id: '',
        status: 'error',
        output: '',
        error: response.data.error,
      };
    } else {
      console.error('Unexpected response structure:', response.data);
      return {
        execution_id: '',
        status: 'error',
        output: '',
        error: 'Unexpected response structure from server',
      };
    }
  },

  async executeNode(
    canvasData: any,
    nodeId: string,
    inputMessage: string,
    context?: Record<string, any>,
    agenticFlowId?: string,
    sessionId?: string,
    runProjectId?: string
  ): Promise<ExecutionResult> {
    const response = await api.post('/run/execute-node', {
      canvas_data: canvasData,
      node_id: nodeId,
      input_message: inputMessage,
      context: context,
      agentic_flow_id: agenticFlowId,
      session_id: sessionId,
      run_project_id: runProjectId,
    });
    return response.data;
  },

  async executeWorkflowStream(
    canvasData: any,
    inputMessage: string,
    onStream: (delta: any) => void,
    onComplete: (result: any) => void,
    onError: (error: string) => void,
    agenticFlowId?: string,
    sessionId?: string,
    context?: Record<string, any>
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
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
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
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data.data) {
      return data.data;
    }
    return [];
  },

  async getSessionSteps(sessionId: string): Promise<ExecutionStep[]> {
    const response = await api.get(`/run/sessions/${sessionId}/steps`);
    if (response.data && response.data.data) {
      return response.data.data;
    }
    return response.data;
  },

  async getSessionToolCalls(sessionId: string): Promise<ToolCallRecord[]> {
    const response = await api.get(`/run/sessions/${sessionId}/tools`);
    if (response.data && response.data.data) {
      return response.data.data;
    }
    return response.data;
  },

  async exportSession(
    sessionId: string,
    format: string = 'json'
  ): Promise<any> {
    const response = await api.get(`/run/sessions/${sessionId}/export`, {
      params: { format },
    });
    return response.data;
  },

  createWebSocket(agenticFlowId: string, sessionId: string, runProjectId: string): WebSocket {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('access_token');
    return new WebSocket(`${protocol}//${host}/api/v1/run/ws/${agenticFlowId}/${sessionId}/${runProjectId}?token=${token}`);
  },
};

export default runApi;
