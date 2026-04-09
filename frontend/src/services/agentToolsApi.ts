/**
 * SoloEngine : Agent工具API服务模块
 *
 * @file agentToolsApi.ts
 * @description Agent工具API服务 - LLM调用、浏览器操作、文档读写等工具接口
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - LLM对话API
 *     - 浏览器自动化操作API
 *     - 文档读写操作API
 *     - 代码执行API
 *     - 文件操作API
 *
 * 依赖:
 *     - ./api: API基础服务
 *
 * 使用示例:
 *     - import { agentToolsApi } from './agentToolsApi'
 *     - const response = await agentToolsApi.chat({ message: 'Hello' })
 *
 * 使用场景：
 *     - 调试面板调用Agent工具
 *     - 工作流执行过程中的工具调用
 */

import { api } from './api';

export interface LLMChatRequest {
  message: string;
  config_id?: string;
  model?: string;
  provider?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  conversation_history?: Array<{ role: string; content: string }>;
  project_id?: string;
}

export interface LLMChatResponse {
  content: string;
  model: string;
  provider: string;
  config_id?: string;
  config_name?: string;
  tokens_used: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  finish_reason: string;
  project_id?: string;
}

export interface BrowserNavigateRequest {
  url: string;
}

export interface BrowserActionRequest {
  action_type: 'navigate' | 'click' | 'type' | 'scroll' | 'screenshot' | 'extract';
  selector?: string;
  text?: string;
  direction?: 'up' | 'down';
}

export interface DocumentReadRequest {
  filename: string;
  encoding?: string;
}

export interface DocumentWriteRequest {
  filename: string;
  content: string;
  encoding?: string;
  mode?: 'write' | 'append';
}

export interface DocumentSearchRequest {
  path?: string;
  pattern: string;
  recursive?: boolean;
}

export interface DocumentSummarizeRequest {
  content: string;
  max_length?: number;
  config_id?: string;
}

export const agentToolsApi = {
  async llmChat(request: LLMChatRequest): Promise<{ code: number; message: string; data: LLMChatResponse }> {
    const response = await api.post('/agent-tools/llm/chat', {
      message: request.message,
      config_id: request.config_id,
      model: request.model,
      provider: request.provider,
      temperature: request.temperature,
      max_tokens: request.max_tokens,
      system_prompt: request.system_prompt,
      conversation_history: request.conversation_history,
      project_id: request.project_id,
    });
    return response.data;
  },

  async browserNavigate(request: BrowserNavigateRequest): Promise<{ code: number; message: string; data: any }> {
    const response = await api.post('/agent-tools/browser/navigate', {
      url: request.url,
    });
    return response.data;
  },

  async browserAction(request: BrowserActionRequest): Promise<{ code: number; message: string; data: any }> {
    const response = await api.post('/agent-tools/browser/action', {
      action_type: request.action_type,
      selector: request.selector,
      text: request.text,
      direction: request.direction,
    });
    return response.data;
  },

  async documentRead(request: DocumentReadRequest): Promise<{ code: number; message: string; data: any }> {
    const response = await api.post('/agent-tools/document/read', {
      filename: request.filename,
      encoding: request.encoding || 'utf-8',
    });
    return response.data;
  },

  async documentWrite(request: DocumentWriteRequest): Promise<{ code: number; message: string; data: any }> {
    const response = await api.post('/agent-tools/document/write', {
      filename: request.filename,
      content: request.content,
      encoding: request.encoding || 'utf-8',
      mode: request.mode || 'write',
    });
    return response.data;
  },

  async documentSearch(request: DocumentSearchRequest): Promise<{ code: number; message: string; data: any }> {
    const response = await api.post('/agent-tools/document/search', {
      path: request.path || '.',
      pattern: request.pattern,
      recursive: request.recursive ?? true,
    });
    return response.data;
  },

  async documentSummarize(request: DocumentSummarizeRequest): Promise<{ code: number; message: string; data: any }> {
    const response = await api.post('/agent-tools/document/summarize', {
      content: request.content,
      max_length: request.max_length || 500,
      config_id: request.config_id,
    });
    return response.data;
  },
};

export default agentToolsApi;
