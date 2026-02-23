/**
 * @file mcpApi.ts
 * @description MCP API服务 - MCP服务器管理接口封装
 * @author SoloEngine Team
 * @date 2026-02-20
 * 
 * 功能描述：
 * - 提供MCP服务器管理相关的接口调用
 * - 获取服务器列表、添加/更新/删除服务器、连接/断开服务器
 * - Python MCP 创建和管理
 * - MCP 工具调用
 * 
 * 使用场景：
 * - MCP服务器配置和管理
 * - MCP工具和资源调用
 * - 自定义 Python MCP 开发
 * 
 * 注意事项：
 * - 支持多种传输协议（stdio、sse等）
 * - 需要正确配置服务器连接参数
 * 
 * 状态: ✅ 完整实现
 */
import { api } from './api';

/**
 * MCP服务器接口
 */
export interface MCPServer {
  id: string;
  user_id?: string;
  name: string;
  transport: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
  is_public?: boolean;
  version?: number;
  status: string;
  created_at?: string;
  updated_at?: string;
  tools?: MCPTool[];
  resources?: MCPResource[];
  prompts?: MCPPrompt[];
  error_message?: string;
  lastError?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  server_id?: string;
  server_name?: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mime_type?: string;
  server_id?: string;
  server_name?: string;
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments?: any[];
  server_id?: string;
  server_name?: string;
}

/**
 * Python MCP 工具定义
 */
export interface PythonMCPTool {
  name: string;
  description?: string;
  parameters?: {
    type: string;
    properties: Record<string, {
      type: string;
      description?: string;
    }>;
    required?: string[];
  };
}

/**
 * 创建 Python MCP 请求
 */
export interface CreatePythonMCPRequest {
  name: string;
  description?: string;
  tools: PythonMCPTool[];
}

/**
 * MCP 代码响应
 */
export interface MCPCodeResponse {
  server_id: string;
  name: string;
  code: string;
  path: string;
}

/**
 * 开源 MCP 配置
 */
export interface OpenSourceMCP {
  id: string;
  name: string;
  description: string;
  transport: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  category: string;
}

class MCPApi {
  async getServers() {
    return api.get('/mcp/servers');
  }

  async getServer(serverId: string) {
    return api.get(`/mcp/servers/${serverId}`);
  }

  async addServer(config: {
    name: string;
    transport: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    timeout?: number;
    enabled?: boolean;
  }) {
    return api.post('/mcp/servers', config);
  }

  async updateServer(serverId: string, config: Partial<MCPServer> & { version?: number }) {
    return api.put(`/mcp/servers/${serverId}`, config);
  }

  async deleteServer(serverId: string) {
    return api.delete(`/mcp/servers/${serverId}`);
  }

  async getServerTools(serverId: string) {
    return api.get(`/mcp/servers/${serverId}/tools`);
  }

  async testConnection(serverId: string) {
    return api.post(`/mcp/servers/${serverId}/test`);
  }

  async testServer(config: {
    name: string;
    transport: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    timeout?: number;
  }) {
    return api.post('/mcp/servers/test', config);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>) {
    return api.post(`/mcp/servers/${serverId}/tools/${toolName}/call`, {
      arguments: args,
    });
  }

  async importMCP(config: Record<string, any>) {
    return api.post('/mcp/import', config);
  }

  async getResources(serverId: string) {
    return api.get(`/mcp/servers/${serverId}/resources`);
  }

  async getPrompts(serverId: string) {
    return api.get(`/mcp/servers/${serverId}/prompts`);
  }

  async getOpenSourceMCPS() {
    return api.get('/mcp/open-source');
  }

  async connectServer(serverId: string) {
    return api.post(`/mcp/servers/${serverId}/connect`);
  }

  async disconnectServer(serverId: string) {
    return api.post(`/mcp/servers/${serverId}/disconnect`);
  }

  async getAllTools() {
    return api.get('/mcp/tools/all');
  }

  async getOpenMCPList() {
    return api.get('/mcp/open-source');
  }

  async importOpenMCP(mcpId: string) {
    return api.post('/mcp/import', null, { params: { mcp_id: mcpId } });
  }

  /**
   * 创建 Python MCP
   */
  async createPythonMCP(request: CreatePythonMCPRequest) {
    return api.post('/mcp/servers/python', request);
  }

  /**
   * 获取 MCP Python 代码
   */
  async getMCPCode(serverId: string): Promise<MCPCodeResponse> {
    const response = await api.get(`/mcp/servers/${serverId}/code`);
    return response.data;
  }

  /**
   * 更新 MCP Python 代码
   */
  async updateMCPCode(serverId: string, code: string) {
    return api.put(`/mcp/servers/${serverId}/code`, null, { params: { code } });
  }

  /**
   * 初始化默认MCP服务器
   */
  async initDefaultMCPS() {
    return api.post('/mcp/init-defaults');
  }
}

export const mcpApi = new MCPApi();
