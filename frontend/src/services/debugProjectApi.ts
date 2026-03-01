/**
 * @file debugProjectApi.ts
 * @description 调试项目API服务 - 项目选择、文件系统隔离、最近项目记录
 * @author SoloEngine Team
 * @date 2026-02-22
 * 
 * 功能描述：
 * - 项目选择和切换API
 * - 文件夹选择对话框接口
 * - 最近项目记录管理
 * - 沙箱文件系统操作
 * 
 * 使用场景：
 * - 面试调试场景中的项目管理
 * - 文件系统沙箱隔离
 */

import { api } from './api';

export interface SelectFolderRequest {
  folder_path: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  folder_path: string;
  description?: string;
  last_accessed_at?: string;
  created_at?: string;
}

export interface RecentProjectInfo {
  id: string;
  project_id: string;
  project_name: string;
  folder_path: string;
  accessed_at?: string;
}

export interface SelectFolderResponse {
  project_id: string;
  project_name: string;
  folder_path: string;
  is_new: boolean;
  recent_projects: RecentProjectInfo[];
}

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface FileListResponse {
  base_path: string;
  relative_path: string;
  files: FileInfo[];
}

export interface FileReadResponse {
  path: string;
  content: string;
  size: number;
  modified: string;
}

export interface FileWriteResponse {
  path: string;
  size: number;
  modified: string;
  mode: string;
}

export interface BrowseItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface BrowseResponse {
  current_path: string;
  parent_path: string;
  items: BrowseItem[];
}

export interface WorkspaceRoot {
  name: string;
  path: string;
}

export interface WorkspaceRootsResponse {
  roots: WorkspaceRoot[];
  system: string;
}

export const debugProjectApi = {
  async selectFolder(folderPath: string): Promise<{ code: number; data: SelectFolderResponse }> {
    const response = await api.post('/debug-project/select-folder', {
      folder_path: folderPath,
    });
    return response.data;
  },

  async browseDirectory(path: string = ''): Promise<{ code: number; data: BrowseResponse | WorkspaceRootsResponse }> {
    const response = await api.get('/debug-project/browse', { params: { path } });
    return response.data;
  },

  async openNativeFolderDialog(title: string = '选择项目文件夹'): Promise<{ code: number; data: SelectFolderResponse | null }> {
    const response = await api.get('/debug-project/native-folder-dialog', { params: { title } });
    return response.data;
  },

  async getCurrentProject(): Promise<{ code: number; data: ProjectInfo | null }> {
    const response = await api.get('/debug-project/current');
    return response.data;
  },

  async getRecentProjects(limit: number = 10): Promise<{ code: number; data: RecentProjectInfo[] }> {
    const response = await api.get('/debug-project/recent', { params: { limit } });
    return response.data;
  },

  async switchProject(projectId: string): Promise<{ code: number; data: ProjectInfo }> {
    const response = await api.post(`/debug-project/switch/${projectId}`);
    return response.data;
  },

  async listFiles(path: string = '', pattern: string = '*'): Promise<{ code: number; data: FileListResponse }> {
    const response = await api.post('/debug-project/files/list', {
      path,
      pattern,
    });
    return response.data;
  },

  async readFile(path: string, encoding: string = 'utf-8'): Promise<{ code: number; data: FileReadResponse }> {
    const response = await api.post('/debug-project/files/read', {
      path,
      encoding,
    });
    return response.data;
  },

  async writeFile(
    path: string,
    content: string,
    encoding: string = 'utf-8',
    mode: 'write' | 'append' = 'write'
  ): Promise<{ code: number; data: FileWriteResponse }> {
    const response = await api.post('/debug-project/files/write', {
      path,
      content,
      encoding,
      mode,
    });
    return response.data;
  },

  async deleteFile(path: string): Promise<{ code: number; data: { path: string; type: string; deleted: boolean } }> {
    const response = await api.delete('/debug-project/files/delete', { params: { path } });
    return response.data;
  },

  async createDirectory(path: string): Promise<{ code: number; data: { path: string; created: boolean } }> {
    const response = await api.post('/debug-project/files/mkdir', null, { params: { path } });
    return response.data;
  },

  async getFileInfo(path: string): Promise<{ code: number; data: FileInfo }> {
    const response = await api.get('/debug-project/files/info', { params: { path } });
    return response.data;
  },

  async fileExists(path: string): Promise<{ code: number; data: { path: string; exists: boolean } }> {
    const response = await api.get('/debug-project/files/exists', { params: { path } });
    return response.data;
  },
};

export default debugProjectApi;
