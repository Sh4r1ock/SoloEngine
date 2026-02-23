/**
 * @file llmApi.ts
 * @description LLM配置API服务 - 模型管理接口封装
 * @author SoloEngine Team
 * @date 2026-02-20
 */
import { api } from './api';

export interface ProviderConfig {
  name: string;
  display_name: string;
  requires_api_key: boolean;
  default_model: string;
  models: string[];
}

export interface LLMConfig {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  model_name: string;
  base_url?: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  timeout: number;
  extra_params: Record<string, any>;
  is_default: boolean;
  is_active: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateLLMConfigRequest {
  name: string;
  provider: string;
  model_name: string;
  api_key?: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  timeout?: number;
  extra_params?: Record<string, any>;
  is_default?: boolean;
}

export interface UpdateLLMConfigRequest {
  name?: string;
  model_name?: string;
  api_key?: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  timeout?: number;
  extra_params?: Record<string, any>;
  is_default?: boolean;
  version?: number;
}

class LLMApi {
  async getProviders(): Promise<ProviderConfig[]> {
    const response = await api.get('/llm/providers');
    return response.data;
  }

  async getProviderModels(provider: string): Promise<string[]> {
    const response = await api.get(`/llm/providers/${provider}/models`);
    return response.data.models;
  }

  async getConfigs(): Promise<LLMConfig[]> {
    const response = await api.get('/llm/configs');
    return response.data;
  }

  async getConfig(configId: string): Promise<LLMConfig> {
    const response = await api.get(`/llm/configs/${configId}`);
    return response.data;
  }

  async getDefaultConfig(): Promise<LLMConfig | null> {
    const response = await api.get('/llm/configs/default');
    return response.data;
  }

  async createConfig(request: CreateLLMConfigRequest): Promise<LLMConfig> {
    const response = await api.post('/llm/configs', request);
    return response.data;
  }

  async updateConfig(configId: string, request: UpdateLLMConfigRequest): Promise<LLMConfig> {
    const response = await api.put(`/llm/configs/${configId}`, request);
    return response.data;
  }

  async deleteConfig(configId: string): Promise<void> {
    await api.delete(`/llm/configs/${configId}`);
  }

  async setDefaultConfig(configId: string): Promise<LLMConfig> {
    const response = await api.post(`/llm/configs/${configId}/set-default`);
    return response.data;
  }

  async testConfig(request: CreateLLMConfigRequest): Promise<{
    status: 'success' | 'error';
    provider: string;
    model_name: string;
    error?: string;
  }> {
    const response = await api.post('/llm/test', request);
    return response.data;
  }

  async getUsage(params?: {
    time_range_hours?: number;
    provider?: string;
    model_name?: string;
  }): Promise<{
    total_requests: number;
    total_tokens: number;
    avg_tokens_per_request: number;
    avg_time_per_request: number;
  }> {
    const response = await api.get('/llm/usage', { params });
    return response.data;
  }

  async getRecentUsage(limit?: number, provider?: string): Promise<any[]> {
    const response = await api.get('/llm/usage/recent', {
      params: { limit, provider },
    });
    return response.data;
  }

  async exportUsage(format?: 'json' | 'csv'): Promise<{ path: string; format: string }> {
    const response = await api.get('/llm/usage/export', {
      params: { format },
    });
    return response.data;
  }

  async clearUsage(daysToKeep?: number): Promise<{ removed_count: number }> {
    const response = await api.delete('/llm/usage', {
      params: { days_to_keep: daysToKeep },
    });
    return response.data;
  }
}

export const llmApi = new LLMApi();
