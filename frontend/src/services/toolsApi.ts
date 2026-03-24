/**
 * @file toolsApi.ts
 * @description 工具API服务 - 本地工具列表获取
 * @author SoloEngine Team
 * @date 2026-03-17
 * 
 * 功能描述：
 * - 获取本地工具列表
 * - 工具信息查询
 */

import { api } from './api';

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, any>;
  tool_type: string;
}

export const toolsApi = {
  async getTools(): Promise<{ code: number; message: string; data: ToolInfo[] }> {
    const response = await api.get('/tools');
    return response.data;
  },

  async getTool(toolName: string): Promise<{ code: number; message: string; data: ToolInfo }> {
    const response = await api.get(`/tools/${toolName}`);
    return response.data;
  },
};

export default toolsApi;
