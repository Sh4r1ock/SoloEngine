/**
 * SoloEngine : 工作区API服务模块
 *
 * @file workspaceApi.ts
 * @description 工作区API服务 - 文件系统浏览和管理
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 获取工作区根目录列表
 *     - 浏览目录内容
 *     - 文件系统操作
 *
 * 依赖:
 *     - axios: HTTP客户端
 *
 * 使用示例:
 *     - import { workspaceApi } from './workspaceApi'
 *     - const roots = await workspaceApi.getWorkspaceRoots()
 */

import axios from 'axios';

import { APP_CONFIG } from '../config/index';

const API_BASE_URL = APP_CONFIG.API_BASE_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface WorkspaceRoot {
  name: string;
  path: string;
}

export interface BrowseItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface BrowseResult {
  current_path: string;
  parent_path: string;
  items: BrowseItem[];
}

export const workspaceApi = {
  getWorkspaceRoots: async () => {
    const response = await api.get('/api/v1/run-project/workspace-roots');
    return response.data;
  },

  browseDirectory: async (path: string = ''): Promise<{
    code: number;
    message: string;
    data: BrowseResult | { roots: WorkspaceRoot[]; system: string };
  }> => {
    const response = await api.get('/api/v1/run-project/browse', {
      params: { path },
    });
    return response.data;
  },

  selectWorkspace: async (folderPath: string) => {
    const response = await api.post('/api/v1/run-project/select-folder', {
      folder_path: folderPath,
    });
    return response.data;
  },
};

export default workspaceApi;
