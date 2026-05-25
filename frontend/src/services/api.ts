/**
 * SoloEngine : API基础服务模块
 *
 * @file api.ts
 * @description API基础服务 - HTTP请求封装模块
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 封装axios实例
 *     - 提供统一的HTTP请求处理
 *     - 包含请求拦截、响应拦截、错误处理
 *     - 支持认证令牌自动附加
 *     - 错误消息中英文映射
 *
 * 依赖:
 *     - axios: HTTP客户端
 *     - ../types/canvas: 画布类型定义
 *
 * 使用示例:
 *     - import apiClient from './api'
 *     - const response = await apiClient.get('/projects')
 */
import axios, { AxiosResponse, AxiosError } from 'axios';
import { ProjectData, CanvasData, ToolData } from '../types/canvas';

import { APP_CONFIG } from '../config/index';

const API_BASE_URL = APP_CONFIG.API_BASE_URL + '/api/v1';
const API_REQUEST_TIMEOUT = APP_CONFIG.API_REQUEST_TIMEOUT;

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

// 错误消息映射函数 - 将英文错误转换为中文
const getErrorMessage = (error: AxiosError): string => {
  // 网络连接错误
  if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK' || !error.response) {
    return '无法连接到服务器，请检查后端服务是否启动';
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
        return '服务器内部错误，请检查后端服务';
      case 502:
        return '网关错误，请刷新页面重试';
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
    const url = originalRequest?.url || '';

    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');

    // 转换错误消息为中文
    const chineseMessage = getErrorMessage(error);
    if (error.message) {
      error.message = chineseMessage;
    }

    if (error.response?.status === 401 && originalRequest && !isAuthEndpoint) {
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
