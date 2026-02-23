/**
 * @file agentToolsApi.ts
 * @description Agent工具API服务 - LLM调用、浏览器操作、文档读写等工具接口
 * @author SoloEngine Team
 * @date 2026-02-22
 * 
 * 功能描述：
 * - LLM对话API
 * - 浏览器自动化操作API
 * - 文档读写操作API
 * 
 * 使用场景：
 * - 调试面板调用Agent工具
 * - 工作流执行过程中的工具调用
 */

import { api } from './api';

export interface LLMChatRequest {
  message: string;
  model?: string;
  provider?: string;
  temperature?: number;
  max_tokens?: number;
  system_prompt?: string;
  conversation_history?: Array<{ role: string; content: string }>;
}

export interface LLMChatResponse {
  content: string;
  model: string;
  tokens_used: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  finish_reason: string;
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
}

export const agentToolsApi = {
  async llmChat(request: LLMChatRequest): Promise<{ code: number; data: LLMChatResponse }> {
    const response = await api.post('/agent-tools/llm/chat', {
      message: request.message,
      model: request.model || 'gpt-4',
      provider: request.provider || 'openai',
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens || 4096,
      system_prompt: request.system_prompt,
      conversation_history: request.conversation_history,
    });
    return response.data;
  },

  async browserNavigate(request: BrowserNavigateRequest): Promise<{ code: number; data: any }> {
    const response = await api.post('/agent-tools/browser/navigate', {
      url: request.url,
    });
    return response.data;
  },

  async browserAction(request: BrowserActionRequest): Promise<{ code: number; data: any }> {
    const response = await api.post('/agent-tools/browser/action', {
      action_type: request.action_type,
      selector: request.selector,
      text: request.text,
      direction: request.direction,
    });
    return response.data;
  },

  async documentRead(request: DocumentReadRequest): Promise<{ code: number; data: any }> {
    const response = await api.post('/agent-tools/document/read', {
      filename: request.filename,
      encoding: request.encoding || 'utf-8',
    });
    return response.data;
  },

  async documentWrite(request: DocumentWriteRequest): Promise<{ code: number; data: any }> {
    const response = await api.post('/agent-tools/document/write', {
      filename: request.filename,
      content: request.content,
      encoding: request.encoding || 'utf-8',
      mode: request.mode || 'write',
    });
    return response.data;
  },

  async documentSearch(request: DocumentSearchRequest): Promise<{ code: number; data: any }> {
    const response = await api.post('/agent-tools/document/search', {
      path: request.path || '.',
      pattern: request.pattern,
      recursive: request.recursive ?? true,
    });
    return response.data;
  },

  async documentSummarize(request: DocumentSummarizeRequest): Promise<{ code: number; data: any }> {
    const response = await api.post('/agent-tools/document/summarize', {
      content: request.content,
      max_length: request.max_length || 500,
    });
    return response.data;
  },
};

export default agentToolsApi;
