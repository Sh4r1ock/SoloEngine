/**
 * @file debugApi.ts
 * @description 调试API服务 - 工作流调试相关API调用
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 调试会话管理API
 * - JSON工作流执行API
 * - 断点管理API
 * - 执行历史API
 * 
 * 使用场景：
 * - 调试面板调用后端调试服务
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

export interface DebugSession {
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

export interface DebugStep {
  id: string;
  node_id: string;
  step_type: string;
  thought?: string;
  action?: string;
  observation?: string;
  error?: string;
  created_at: string;
}

export interface Breakpoint {
  id: string;
  node_id: string;
  step_type: string;
  enabled: boolean;
}

export interface ToolCallRecord {
  id: string;
  tool_name: string;
  arguments: Record<string, any>;
  result?: string;
  error?: string;
  created_at: string;
}

export const debugApi = {
  async executeWorkflow(
    canvasData: any,
    inputMessage: string,
    projectName?: string,
    context?: Record<string, any>
  ): Promise<ExecutionResult> {
    const response = await api.post('/debug/execute', {
      canvas_data: canvasData,
      input_message: inputMessage,
      project_name: projectName,
      context: context,
    });
    return response.data;
  },

  async executeNode(
    canvasData: any,
    nodeId: string,
    inputMessage: string,
    context?: Record<string, any>
  ): Promise<ExecutionResult> {
    const response = await api.post('/debug/execute-node', {
      canvas_data: canvasData,
      node_id: nodeId,
      input_message: inputMessage,
      context: context,
    });
    return response.data;
  },

  async startDebugSession(params: {
    sessionId?: string;
    agentId?: string;
    nodeId?: string;
    breakpoints?: Array<{ node_id: string; step_type: string }>;
  }): Promise<{ session_id: string; status: string }> {
    const response = await api.post('/debug/start', {
      session_id: params.sessionId,
      agent_id: params.agentId,
      node_id: params.nodeId,
      breakpoints: params.breakpoints,
    });
    return response.data;
  },

  async stopDebugSession(sessionId: string): Promise<void> {
    await api.post('/debug/stop', { session_id: sessionId });
  },

  async pauseDebugSession(sessionId: string): Promise<void> {
    await api.post('/debug/pause', { session_id: sessionId });
  },

  async resumeDebugSession(sessionId: string): Promise<void> {
    await api.post('/debug/resume', { session_id: sessionId });
  },

  async stepControl(sessionId: string, command: string): Promise<void> {
    await api.post('/debug/step', {
      session_id: sessionId,
      command: command,
    });
  },

  async setBreakpoint(params: {
    nodeId: string;
    stepType: string;
    enabled?: boolean;
  }): Promise<{ id: string; node_id: string; step_type: string }> {
    const response = await api.post('/debug/breakpoint', {
      node_id: params.nodeId,
      step_type: params.stepType,
      enabled: params.enabled ?? true,
    });
    return response.data;
  },

  async removeBreakpoint(breakpointId: string): Promise<void> {
    await api.delete(`/debug/breakpoint/${breakpointId}`);
  },

  async getBreakpoints(): Promise<any[]> {
    const response = await api.get('/debug/breakpoints');
    return response.data;
  },

  async getSessions(params?: {
    agentId?: string;
    status?: string;
    limit?: number;
  }): Promise<DebugSession[]> {
    const response = await api.get('/debug/sessions', { params });
    return response.data;
  },

  async getSession(sessionId: string): Promise<DebugSession> {
    const response = await api.get(`/debug/sessions/${sessionId}`);
    return response.data;
  },

  async getSessionSteps(sessionId: string): Promise<ExecutionStep[]> {
    const response = await api.get(`/debug/sessions/${sessionId}/steps`);
    return response.data;
  },

  async getSessionToolCalls(sessionId: string): Promise<ToolCallRecord[]> {
    const response = await api.get(`/debug/sessions/${sessionId}/tools`);
    return response.data;
  },

  async exportSession(
    sessionId: string,
    format: string = 'json'
  ): Promise<any> {
    const response = await api.get(`/debug/sessions/${sessionId}/export`, {
      params: { format },
    });
    return response.data;
  },

  async getVariables(sessionId: string): Promise<Record<string, any>> {
    const response = await api.get(`/debug/variables/${sessionId}`);
    return response.data;
  },

  createWebSocket(sessionId: string): WebSocket {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('access_token');
    return new WebSocket(`${protocol}//${host}/api/v1/debug/ws/${sessionId}?token=${token}`);
  },

  createDebugWebSocket(sessionId: string): WebSocket {
    return this.createWebSocket(sessionId);
  },

  async startDebug(params?: {
    agentId?: string;
    nodeId?: string;
    breakpoints?: Array<{ node_id: string; step_type: string }>;
  }): Promise<{ code: number; data: { session_id: string; agent_id?: string; agent_name?: string } }> {
    const response = await api.post('/debug/start', {
      agent_id: params?.agentId,
      node_id: params?.nodeId,
      breakpoints: params?.breakpoints,
    });
    return response.data;
  },

  stopDebug: function(sessionId: string): Promise<void> {
    return this.stopDebugSession(sessionId);
  },

  pauseDebug: function(sessionId: string): Promise<void> {
    return this.pauseDebugSession(sessionId);
  },

  resumeDebug: function(sessionId: string): Promise<void> {
    return this.resumeDebugSession(sessionId);
  },
};

export default debugApi;
