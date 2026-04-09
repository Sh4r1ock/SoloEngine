/**
 * SoloEngine : MCP API服务模块
 *
 * @file mcpApi.ts
 * @description MCP API服务 - MCP服务器管理接口封装
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 获取MCP服务器列表
 *     - 添加/更新/删除MCP服务器
 *     - 连接/断开MCP服务器
 *     - Python MCP创建和管理
 *     - MCP工具调用
 *
 * 依赖:
 *     - axios: HTTP客户端
 *
 * 使用示例:
 *     - import { mcpApi } from './mcpApi'
 *     - const servers = await mcpApi.getServers()
 *
 * 使用场景：
 *     - MCP服务器配置和管理
 *     - MCP工具和资源调用
 *     - 自定义Python MCP开发
 *
 * 注意事项：
 *     - 支持多种传输协议（stdio、sse、http）
 *     - 需要正确配置服务器连接参数
 *     - MCP服务已集成到主后端端口8990
 */
import axios, { AxiosResponse, AxiosError } from 'axios';

const MCP_SERVICE_URL = 'http://localhost:8990/api/v1';
const MCP_REQUEST_TIMEOUT = 30000;

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

// 错误消息映射函数 - 将英文错误转换为中文
const getErrorMessage = (error: AxiosError): string => {
  // 网络连接错误
  if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK' || !error.response) {
    return '无法连接到MCP服务器，请检查后端服务是否启动';
  }
  // 超时错误
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    return '请求超时，请稍后重试';
  }
  // HTTP状态码错误
  if (error.response) {
    const status = error.response.status;
    switch (status) {
      case 400:
        return '请求参数错误';
      case 401:
        return '登录已过期，请重新登录';
      case 403:
        return '没有权限执行此操作';
      case 404:
        return '请求的资源不存在';
      case 408:
        return '请求超时，请稍后重试';
      case 500:
        return '服务器内部错误，请稍后重试';
      case 502:
        return '网关错误，请检查后端服务';
      case 503:
        return '服务暂时不可用，请稍后重试';
      case 504:
        return '网关超时，请稍后重试';
      default:
        return `服务器错误 (${status})`;
    }
  }
  return '网络请求失败，请检查网络连接';
};

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
    console.log('MCP API Request Interceptor - Token exists:', !!token);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      console.log('MCP API Request Interceptor - Authorization header set');
    } else {
      console.warn('MCP API Request Interceptor - No token found!');
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
    // 转换错误消息为中文
    const chineseMessage = getErrorMessage(error);
    if (error.message) {
      error.message = chineseMessage;
    }
    console.error('MCP Service API Error:', error.response?.data || chineseMessage);
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
  is_active?: boolean;
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
  folder_path?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  server_id?: string;
  server_name?: string;
  is_enabled?: boolean;
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
  is_active?: boolean;
  share?: boolean;
  tags?: string[];
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
  is_active?: boolean;
  share?: boolean;
  tags?: string[];
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
    is_active?: boolean;
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

  async connectAndGetTools(config: {
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
    return mcpApiRequest.post('/mcp/servers/connect', config);
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

  async createPythonMCP(name: string, description: string, code: string, tools: any[], tags?: string[]) {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    formData.append('tools', JSON.stringify(tools));
    
    if (tags && tags.length > 0) {
      formData.append('tags', JSON.stringify(tags));
    }
    
    const blob = new Blob([code], { type: 'text/x-python' });
    formData.append('file', blob, 'original.py');
    
    return mcpApiRequest.post('/mcp/servers/create/python', formData, {
      headers: { 'Content-Type': undefined },
    });
  }

  async createStdioMCP(name: string, description: string, packageFile?: File | null, files?: File[] | null, filePaths?: string[] | null, tags?: string[] | null) {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description || '');

    if (tags && tags.length > 0) {
      formData.append('tags', JSON.stringify(tags));
    }

    if (packageFile) {
      formData.append('package', packageFile);
    }

    if (files && files.length > 0) {
      files.forEach(file => {
        formData.append('files', file);
      });
    }

    if (filePaths && filePaths.length > 0) {
      filePaths.forEach(path => {
        formData.append('file_paths', path);
      });
    }

    return mcpApiRequest.post('/mcp/servers/create/stdio', formData, {
      timeout: 60000,
      headers: { 'Content-Type': undefined },
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
      headers: { 'Content-Type': undefined },
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

  async updateToolEnabled(serverId: string, toolName: string, isEnabled: boolean) {
    return mcpApiRequest.put(`/mcp/servers/${serverId}/tools/${toolName}/enabled`, {
      is_active: isEnabled,
    });
  }
}

export const mcpApi = new MCPApi();
