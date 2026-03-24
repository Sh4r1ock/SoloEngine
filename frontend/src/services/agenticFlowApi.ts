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
  icon?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateFlowRequest {
  name: string;
  description?: string;
  canvas_data?: any;
  icon?: string;
}

export interface UpdateFlowRequest {
  name?: string;
  description?: string;
  canvas_data?: any;
  icon?: string;
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

  async getFlow(agenticFlowId: string): Promise<AgenticFlow> {
    const response = await api.get(`/agentic-flows/${agenticFlowId}`);
    return response.data;
  }

  async createFlow(data: CreateFlowRequest): Promise<AgenticFlow> {
    const response = await api.post('/agentic-flows', data);
    return response.data;
  }

  async updateFlow(agenticFlowId: string, data: UpdateFlowRequest): Promise<AgenticFlow> {
    const response = await api.put(`/agentic-flows/${agenticFlowId}`, data);
    return response.data;
  }

  async deleteFlow(agenticFlowId: string): Promise<void> {
    await api.delete(`/agentic-flows/${agenticFlowId}`);
  }

  async getRuns(agenticFlowId: string): Promise<AgenticFlowRun[]> {
    const response = await api.get(`/agentic-flows/${agenticFlowId}/runs`);
    return response.data || [];
  }

  async runFlow(agenticFlowId: string, inputMessage: string): Promise<AgenticFlowRun> {
    const response = await api.post(`/agentic-flows/${agenticFlowId}/run`, {
      input_message: inputMessage,
    });
    return response.data;
  }

  async getCanvas(agenticFlowId: string): Promise<any> {
    const response = await api.get(`/agentic-flows/${agenticFlowId}/canvas`);
    return response.data;
  }

  async saveCanvas(agenticFlowId: string, canvasData: any): Promise<void> {
    await api.put(`/agentic-flows/${agenticFlowId}/canvas`, {
      canvas_data: canvasData,
    });
  }
}

export const agenticFlowApi = new AgenticFlowApi();
