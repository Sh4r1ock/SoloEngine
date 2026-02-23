/**
 * @file historyApi.ts
 * @description 执行历史API服务 - 执行记录管理相关接口封装
 * @author SoloEngine Team
 * @date 2026-02-20
 * 
 * 功能描述：
 * - 提供执行记录的创建、查询、删除等接口
 * - 执行步骤管理
 * - 工具调用记录
 * - 执行统计
 * 
 * 使用场景：
 * - 执行历史查看
 * - 调试分析
 * - 性能统计
 * 
 * 状态: ✅ 完整实现
 */
import { api } from './api';

/**
 * 执行记录接口
 */
export interface ExecutionRecord {
  execution_id: string;
  project_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input_message?: string;
  output_message?: string;
  error?: string;
  token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  duration_ms?: number;
  started_at?: string;
  completed_at?: string;
  steps?: ExecutionStep[];
  tool_calls?: ToolCallRecord[];
}

/**
 * 执行步骤接口
 */
export interface ExecutionStep {
  step_id: string;
  step_type: string;
  node_id: string;
  node_name: string;
  input_data?: any;
  output_data?: any;
  thought?: string;
  action?: string;
  observation?: string;
  error?: string;
  duration_ms?: number;
  created_at?: string;
}

/**
 * 工具调用记录接口
 */
export interface ToolCallRecord {
  tool_name: string;
  arguments?: any;
  result?: any;
  error?: string;
  duration_ms?: number;
  created_at?: string;
}

/**
 * 执行统计接口
 */
export interface ExecutionStatistics {
  total_executions: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  total_tokens: number;
  total_duration_ms: number;
  average_duration_ms: number;
}

/**
 * 创建执行记录请求
 */
export interface CreateExecutionRequest {
  project_name: string;
  input_message?: string;
  metadata?: any;
}

/**
 * 添加步骤请求
 */
export interface AddStepRequest {
  step_type: string;
  node_id: string;
  node_name: string;
  input_data: any;
  thought?: string;
  action?: string;
}

/**
 * 完成步骤请求
 */
export interface CompleteStepRequest {
  output_data?: any;
  observation?: string;
  error?: string;
}

/**
 * 添加工具调用请求
 */
export interface AddToolCallRequest {
  tool_name: string;
  arguments: any;
  result?: any;
  error?: string;
}

/**
 * 完成执行请求
 */
export interface CompleteExecutionRequest {
  output_message?: string;
  token_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 执行历史API类
 */
class HistoryApi {
  /**
   * 创建执行记录
   */
  async createExecution(request: CreateExecutionRequest): Promise<ExecutionRecord> {
    const response = await api.post('/history/create', request);
    return response.data;
  }

  /**
   * 开始执行
   */
  async startExecution(executionId: string): Promise<{ execution_id: string; status: string }> {
    const response = await api.post(`/history/${executionId}/start`);
    return response.data;
  }

  /**
   * 完成执行
   */
  async completeExecution(executionId: string, request: CompleteExecutionRequest): Promise<ExecutionRecord> {
    const response = await api.post(`/history/${executionId}/complete`, request);
    return response.data;
  }

  /**
   * 标记执行失败
   */
  async failExecution(executionId: string, error: string): Promise<ExecutionRecord> {
    const response = await api.post(`/history/${executionId}/fail`, null, { params: { error } });
    return response.data;
  }

  /**
   * 添加执行步骤
   */
  async addStep(executionId: string, request: AddStepRequest): Promise<{ step_id: string; step_type: string; node_id: string }> {
    const response = await api.post(`/history/${executionId}/steps`, request);
    return response.data;
  }

  /**
   * 完成执行步骤
   */
  async completeStep(executionId: string, stepId: string, request: CompleteStepRequest): Promise<{ execution_id: string; step_id: string }> {
    const response = await api.post(`/history/${executionId}/steps/${stepId}/complete`, request);
    return response.data;
  }

  /**
   * 添加工具调用记录
   */
  async addToolCall(executionId: string, request: AddToolCallRequest): Promise<{ execution_id: string; tool_name: string }> {
    const response = await api.post(`/history/${executionId}/tool-calls`, request);
    return response.data;
  }

  /**
   * 列出执行记录
   */
  async listExecutions(params?: {
    project_name?: string;
    status?: string;
    limit?: number;
  }): Promise<ExecutionRecord[]> {
    const response = await api.get('/history/list', { params });
    return response.data;
  }

  /**
   * 获取执行记录详情
   */
  async getExecution(executionId: string): Promise<ExecutionRecord> {
    const response = await api.get(`/history/${executionId}`);
    return response.data;
  }

  /**
   * 删除执行记录
   */
  async deleteExecution(executionId: string): Promise<void> {
    await api.delete(`/history/${executionId}`);
  }

  /**
   * 清除旧记录
   */
  async clearOldRecords(days: number = 30): Promise<{ removed_count: number }> {
    const response = await api.delete('/history/clear', { params: { days } });
    return response.data;
  }

  /**
   * 获取执行统计
   */
  async getStatistics(projectName?: string): Promise<ExecutionStatistics> {
    const response = await api.get('/history/statistics', { params: { project_name: projectName } });
    return response.data;
  }

  /**
   * 导出执行记录
   */
  async exportExecution(executionId: string, format: string = 'json'): Promise<any> {
    const response = await api.get(`/history/${executionId}/export`, { params: { format } });
    return response.data;
  }
}

export const historyApi = new HistoryApi();
