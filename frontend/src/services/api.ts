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

import { APP_CONFIG } from '../config/index';
import { getErrorMessage } from '../utils/errorMessages';
import { getAccessToken, getRefreshToken, saveTokens, clearTokens } from '../utils/authStorage';

const API_BASE_URL = APP_CONFIG.API_BASE_URL + '/api/v1';
const API_REQUEST_TIMEOUT = APP_CONFIG.API_REQUEST_TIMEOUT;

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_REQUEST_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
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
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });
          const { access_token, refresh_token } = response.data.data;
          saveTokens(access_token, refresh_token);
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return apiClient(originalRequest);
        } catch (refreshError) {
          clearTokens();
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
