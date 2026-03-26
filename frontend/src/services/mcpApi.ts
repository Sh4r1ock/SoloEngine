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
 * - 支持多种传输协议（stdio、sse、http）
 * - 需要正确配置服务器连接参数
 * - MCP服务已集成到主后端端口8990
 * 
 * 状态: ✅ 完整实现
 */
import axios, { AxiosResponse, AxiosError } from 'axios';

const MCP_SERVICE_URL = 'http://localhost:8990/api/v1';
const MCP_REQUEST_TIMEOUT = 30000;

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return decodeURIComponent(parts.pop()?.split(';').shift() || '');
  }
  return null;
}

const mcpClient = axios.create({
  baseURL: MCP_SERVICE_URL,
  timeout: MCP_REQUEST_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

mcpClient.interceptors.request.use(
  (config) => {
    const token = getCookie('access_token') || localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

mcpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    console.error('MCP Service API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

const mcpApiRequest = {
  get: async <T = any>(url: string, config?: any): Promise<ApiResponse<T>> => {
    const response = await mcpClient.get(url, config);
    return response.data;
  },
  post: async <T = any>(url: string, data?: any, config?: any): Promise<ApiResponse<T>> => {
    const response = await mcpClient.post(url, data, config);
    return response.data;
  },
  put: async <T = any>(url: string, data?: any, config?: any): Promise<ApiResponse<T>> => {
    const response = await mcpClient.put(url, data, config);
    return response.data;
  },
  delete: async <T = any>(url: string, config?: any): Promise<ApiResponse<T>> => {
    const response = await mcpClient.delete(url, config);
    return response.data;
  },
};

export interface MCPServer {
  id: string;
  user_id?: string;
  name: string;
  transport: string;
  transport_type?: string;
  source_type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
  is_public?: boolean;
  share?: boolean;
  is_default?: boolean;
  author?: string;
  source?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  version?: number;
  status: string;
  created_at?: string;
  updated_at?: string;
  tools?: MCPTool[];
  resources?: MCPResource[];
  prompts?: MCPPrompt[];
  error_message?: string;
  lastError?: string;
  module?: string;
  function?: string;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  python_code?: string;
  storage_path?: string;
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

export interface PythonMCPTool {
  name: string;
  description?: string;
  function_name?: string;
  parameters?: {
    type: string;
    properties: Record<string, {
      type: string;
      description?: string;
    }>;
    required?: string[];
  };
}

export interface MCPCodeResponse {
  server_id: string;
  name: string;
  code: string;
  path: string;
}

export interface CreateHttpServerRequest {
  name: string;
  description?: string;
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  session_id?: string;
  enabled?: boolean;
  share?: boolean;
}

export interface CreateSseServerRequest {
  name: string;
  description?: string;
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  reconnect?: boolean;
  sse_endpoint?: string;
  retry_interval?: number;
  max_retries?: number;
  enabled?: boolean;
  share?: boolean;
}

class MCPApi {
  async getServers() {
    return mcpApiRequest.get('/mcp/servers');
  }

  async getServer(serverId: string) {
    return mcpApiRequest.get(`/mcp/servers/${serverId}`);
  }

  async addServer(config: {
    name: string;
    transport: string;
    description?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    timeout?: number;
    enabled?: boolean;
    share?: boolean;
  }) {
    return mcpApiRequest.post('/mcp/servers', config);
  }

  async updateServer(serverId: string, config: Partial<MCPServer> & { version?: number }) {
    return mcpApiRequest.put(`/mcp/servers/${serverId}`, config);
  }

  async deleteServer(serverId: string) {
    return mcpApiRequest.delete(`/mcp/servers/${serverId}`);
  }

  async getServerTools(serverId: string) {
    return mcpApiRequest.get(`/mcp/servers/${serverId}/tools`);
  }

  async testConnection(serverId: string) {
    return mcpApiRequest.post(`/mcp/servers/${serverId}/test`);
  }

  async testServer(config: {
    name: string;
    transport: string;
    description?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    timeout?: number;
  }) {
    return mcpApiRequest.post('/mcp/servers/test', config);
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>) {
    return mcpApiRequest.post(`/mcp/servers/${serverId}/tools/${toolName}/call`, {
      arguments: args,
    });
  }

  async getResources(serverId: string) {
    return mcpApiRequest.get(`/mcp/servers/${serverId}/resources`);
  }

  async getPrompts(serverId: string) {
    return mcpApiRequest.get(`/mcp/servers/${serverId}/prompts`);
  }

  async connectServer(serverId: string) {
    return mcpApiRequest.post(`/mcp/servers/${serverId}/connect`);
  }

  async disconnectServer(serverId: string) {
    return mcpApiRequest.post(`/mcp/servers/${serverId}/disconnect`);
  }

  async getAllTools() {
    return mcpApiRequest.get('/mcp/tools/all');
  }

  async createPythonMCP(name: string, description: string, code: string, tools: any[]) {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    formData.append('tools', JSON.stringify(tools));
    
    const blob = new Blob([code], { type: 'text/x-python' });
    formData.append('file', blob, 'original.py');
    
    return mcpApiRequest.post('/mcp/servers/create/python', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }

  async createStdioMCP(name: string, description: string, packageFile?: File, files?: File[]) {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    
    if (packageFile) {
      formData.append('package', packageFile);
    }
    
    if (files && files.length > 0) {
      files.forEach(file => {
        formData.append('files', file);
      });
    }
    
    return mcpApiRequest.post('/mcp/servers/create/stdio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }

  async createHttpMCP(request: CreateHttpServerRequest) {
    return mcpApiRequest.post('/mcp/servers/create/http', request);
  }

  async createSseMCP(request: CreateSseServerRequest) {
    return mcpApiRequest.post('/mcp/servers/create/sse', request);
  }

  async getMCPCode(serverId: string): Promise<MCPCodeResponse> {
    const response = await mcpApiRequest.get(`/mcp/servers/${serverId}/code`);
    return response.data;
  }

  async getMCPOriginalCode(serverId: string): Promise<MCPCodeResponse> {
    const response = await mcpApiRequest.get(`/mcp/servers/${serverId}/original`);
    return response.data;
  }

  async updateMCPOriginalCode(serverId: string, code: string) {
    return mcpApiRequest.put(`/mcp/servers/${serverId}/original`, { code });
  }

  async getMCPToolsJson(serverId: string) {
    const response = await mcpApiRequest.get(`/mcp/servers/${serverId}/tools/json`);
    return response.data;
  }

  async updateMCPTools(serverId: string, tools: any[]) {
    const formData = new FormData();
    formData.append('tools', JSON.stringify(tools));
    return mcpApiRequest.put(`/mcp/servers/${serverId}/tools`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }

  async updateMCPCode(serverId: string, code: string) {
    return mcpApiRequest.put(`/mcp/servers/${serverId}/code`, { code });
  }

  async getServerFiles(serverId: string) {
    return mcpApiRequest.get(`/mcp/servers/${serverId}/files`);
  }

  async healthCheck() {
    return mcpApiRequest.get('/mcp/health');
  }

  async getOpenMCPList() {
    return mcpApiRequest.get('/mcp/open/list');
  }

  async importOpenMCP(mcpId: string) {
    return mcpApiRequest.post(`/mcp/open/import/${mcpId}`);
  }
}

export const mcpApi = new MCPApi();
