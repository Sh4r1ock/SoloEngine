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

export interface RunSession {
  id: string;
  status: string;
  input_message: string;
  output_message: string;
  error?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  token_usage?: Record<string, number>;
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

export interface CreateSessionResponse {
  session_id: string;
  execution_id: string;
  created_at: string;
  status: string;
}

export const runApi = {
  async createSession(params?: {
    flowId?: string;
    canvasData?: Record<string, any>;
    projectName?: string;
  }): Promise<CreateSessionResponse> {
    const response = await api.post('/run/sessions', {
      flow_id: params?.flowId,
      canvas_data: params?.canvasData,
      project_name: params?.projectName,
    });
    return response.data;
  },

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
    return response.data.data;
  },

  async executeNode(
    canvasData: any,
    nodeId: string,
    inputMessage: string,
    context?: Record<string, any>
  ): Promise<ExecutionResult> {
    const response = await api.post('/run/execute-node', {
      canvas_data: canvasData,
      node_id: nodeId,
      input_message: inputMessage,
      context: context,
    });
    return response.data;
  },

  async getSessions(params?: {
    agentId?: string;
    status?: string;
    limit?: number;
  }): Promise<RunSession[]> {
    const response = await api.get('/run/sessions', { params });
    return response.data;
  },

  async getSession(sessionId: string): Promise<RunSession> {
    const response = await api.get(`/run/sessions/${sessionId}`);
    return response.data;
  },

  async getSessionSteps(sessionId: string): Promise<ExecutionStep[]> {
    const response = await api.get(`/run/sessions/${sessionId}/steps`);
    return response.data;
  },

  async getSessionToolCalls(sessionId: string): Promise<ToolCallRecord[]> {
    const response = await api.get(`/run/sessions/${sessionId}/tools`);
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

  createWebSocket(sessionId: string): WebSocket {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('access_token');
    return new WebSocket(`${protocol}//${host}/api/v1/run/ws/${sessionId}?token=${token}`);
  },
};

export default runApi;
