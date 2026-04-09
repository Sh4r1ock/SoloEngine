/**
 * SoloEngine : 工具API服务模块
 *
 * @file toolsApi.ts
 * @description 工具API服务 - 本地工具列表获取
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 获取本地工具列表
 *     - 工具信息查询
 *     - Agent预设获取
 *
 * 依赖:
 *     - ./api: API基础服务
 *
 * 使用示例:
 *     - import { toolsApi } from './toolsApi'
 *     - const tools = await toolsApi.getTools()
 */

import { api } from './api';

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, any>;
  tool_type: string;
}

export interface AgentPreset {
  id: string;
  name: string;
  name_en: string;
  description: string;
  icon: string;
  color: string;
  tools: string[];
  skills: string[];
  mcp_tools: string[];
  mcp_servers?: string[];
  system_prompt: string;
}

export const toolsApi = {
  async getTools(): Promise<{ code: number; message: string; data: ToolInfo[] }> {
    const response = await api.get('/tools');
    if (response.data.data && Array.isArray(response.data.data.tools)) {
      return { code: response.data.code, message: response.data.message, data: response.data.data.tools };
    }
    return response.data;
  },

  async getTool(toolName: string): Promise<{ code: number; message: string; data: ToolInfo }> {
    const response = await api.get(`/tools/${toolName}`);
    return response.data;
  },
};

export default toolsApi;
