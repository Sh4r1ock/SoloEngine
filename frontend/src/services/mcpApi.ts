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
import { apiClient } from './api';

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

// F1：MCP 与主 API 共用同一后端（baseURL 相同），直接复用 api.ts 的 apiClient
//（auth token 注入 / 401 刷新 / 错误中文映射均由 apiClient 拦截器统一处理）。

const mcpApiRequest = {
  get: async <T = any>(url: string, config?: any): Promise<ApiResponse<T>> => {
    const response = await apiClient.get(url, config);
    return response.data;
  },
  post: async <T = any>(url: string, data?: any, config?: any): Promise<ApiResponse<T>> => {
    const response = await apiClient.post(url, data, config);
    return response.data;
  },
  put: async <T = any>(url: string, data?: any, config?: any): Promise<ApiResponse<T>> => {
    const response = await apiClient.put(url, data, config);
    return response.data;
  },
  delete: async <T = any>(url: string, config?: any): Promise<ApiResponse<T>> => {
    const response = await apiClient.delete(url, config);
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

  async updateServer(serverId: string, config: Partial<MCPServer> & { version?: number }) {
    return mcpApiRequest.put(`/mcp/servers/${serverId}`, config);
  }

  async deleteServer(serverId: string) {
    return mcpApiRequest.delete(`/mcp/servers/${serverId}`);
  }

  async getServerTools(serverId: string) {
    return mcpApiRequest.get(`/mcp/servers/${serverId}/tools`);
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

  async connectServer(serverId: string) {
    return mcpApiRequest.post(`/mcp/servers/${serverId}/connect`);
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

  async getMCPOriginalCode(serverId: string): Promise<MCPCodeResponse> {
    // C1 修复：后端无 /original 端点，复用已有 /code（get_mcp_code 返回 data.code）
    const response = await mcpApiRequest.get(`/mcp/servers/${serverId}/code`);
    return response.data;
  }

  async updateMCPOriginalCode(serverId: string, code: string) {
    // C1 修复：后端无 /original 端点，复用已有 PUT /code（update_mcp_code）
    return mcpApiRequest.put(`/mcp/servers/${serverId}/code`, { code });
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
}

export const mcpApi = new MCPApi();
