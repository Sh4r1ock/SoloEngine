/**
 * @file api.ts
 * @description API基础服务 - HTTP请求封装模块
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 封装axios实例
 * - 提供统一的HTTP请求处理
 * - 包含请求拦截、响应拦截、错误处理
 * - 支持认证令牌自动附加
 */
import axios, { AxiosResponse, AxiosError } from 'axios';
import { ProjectData, CanvasData, ToolData } from '../types/canvas';

const API_BASE_URL = '/api/v1';
const API_REQUEST_TIMEOUT = 30000;

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

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_REQUEST_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
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

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && originalRequest) {
      const refreshToken = getCookie('refresh_token') || localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });
          const { access_token, refresh_token } = response.data.data;
          document.cookie = `access_token=${encodeURIComponent(access_token)}; path=/; max-age=604800; SameSite=Strict`;
          document.cookie = `refresh_token=${encodeURIComponent(refresh_token)}; path=/; max-age=604800; SameSite=Strict`;
          localStorage.setItem('access_token', access_token);
          localStorage.setItem('refresh_token', refresh_token);
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return apiClient(originalRequest);
        } catch (refreshError) {
          document.cookie = 'access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          document.cookie = 'refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      } else {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const api = {
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

export const projectApi = {
  getProjects: async (): Promise<ProjectData[]> => {
    const response = await api.get('/projects');
    return response.data;
  },

  createProject: async (name: string): Promise<ProjectData> => {
    const response = await api.post('/projects', null, { params: { name } });
    return response.data;
  },

  getCanvas: async (projectId: string): Promise<CanvasData> => {
    const response = await api.get(`/projects/${projectId}/canvas`);
    return response.data.canvas;
  },

  updateCanvas: async (projectId: string, canvasData: CanvasData): Promise<CanvasData> => {
    const response = await api.put(`/projects/${projectId}/canvas`, canvasData);
    return response.data.canvas;
  },

  runProject: async (projectId: string, input: string): Promise<{ session_id: string }> => {
    const response = await api.post(`/projects/${projectId}/run`, { input });
    return response.data;
  },
};

export const toolApi = {
  getTools: async (): Promise<ToolData[]> => {
    const response = await api.get('/tools');
    return response.data;
  },

  getTool: async (toolName: string): Promise<ToolData> => {
    const response = await api.get(`/tools/${toolName}`);
    return response.data;
  },

  registerTool: async (config: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
    tool_type?: string;
    server_id?: string;
  }): Promise<ToolData> => {
    const response = await api.post('/tools', config);
    return response.data;
  },

  deleteTool: async (toolName: string): Promise<void> => {
    await api.delete(`/tools/${toolName}`);
  },

  callTool: async (toolName: string, args: Record<string, any>): Promise<any> => {
    const response = await api.post(`/tools/${toolName}/call`, { arguments: args });
    return response.data.result;
  },
};

export { apiClient };
