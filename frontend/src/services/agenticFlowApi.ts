/**
 * @file agenticFlowApi.ts
 * @description AgenticFlow API服务 - 工作流管理相关API调用
 * @author SoloEngine Team
 * @date 2026-02-19
 */

import { api } from './api';

export interface AgenticFlow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  canvas_data: any;
  is_template: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateFlowRequest {
  name: string;
  description?: string;
  canvas_data?: any;
}

export interface UpdateFlowRequest {
  name?: string;
  description?: string;
  canvas_data?: any;
}

export interface AgenticFlowRun {
  id: string;
  agentic_flow_id: string;
  user_id: string;
  status: string;
  input_message: string | null;
  output_message: string | null;
  error: string | null;
  token_usage: any;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

class AgenticFlowApi {
  async getFlows(): Promise<AgenticFlow[]> {
    const response = await api.get('/agentic-flows');
    return response.data || [];
  }

  async getFlow(flowId: string): Promise<AgenticFlow> {
    const response = await api.get(`/agentic-flows/${flowId}`);
    return response.data;
  }

  async createFlow(data: CreateFlowRequest): Promise<AgenticFlow> {
    const response = await api.post('/agentic-flows', data);
    return response.data;
  }

  async updateFlow(flowId: string, data: UpdateFlowRequest): Promise<AgenticFlow> {
    const response = await api.put(`/agentic-flows/${flowId}`, data);
    return response.data;
  }

  async deleteFlow(flowId: string): Promise<void> {
    await api.delete(`/agentic-flows/${flowId}`);
  }

  async getRuns(flowId: string): Promise<AgenticFlowRun[]> {
    const response = await api.get(`/agentic-flows/${flowId}/runs`);
    return response.data || [];
  }

  async runFlow(flowId: string, inputMessage: string): Promise<AgenticFlowRun> {
    const response = await api.post(`/agentic-flows/${flowId}/run`, {
      input_message: inputMessage,
    });
    return response.data;
  }

  async getCanvas(flowId: string): Promise<any> {
    const response = await api.get(`/agentic-flows/${flowId}/canvas`);
    return response.data;
  }

  async saveCanvas(flowId: string, canvasData: any): Promise<void> {
    await api.put(`/agentic-flows/${flowId}/canvas`, {
      canvas_data: canvasData,
    });
  }
}

export const agenticFlowApi = new AgenticFlowApi();
