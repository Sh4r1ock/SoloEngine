/**
 * @file runProjectApi.ts
 * @description 运行项目API服务 - 项目选择、文件系统隔离、最近项目记录
 * @author SoloEngine Team
 * @date 2026-02-22
 * 
 * 功能描述：
 * - 项目选择和创建API
 * - 文件夹选择对话框接口
 * - 最近项目记录管理
 * - 沙箱文件系统操作
 * 
 * 使用场景：
 * - 运行场景中的项目管理
 * - 文件系统沙箱隔离
 */

import { api } from './api';

export interface SelectOrCreateProjectRequest {
  agentic_flow_id: string;
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

export interface SelectOrCreateProjectResponse {
  project_id: string;
  project_name: string;
  folder_path: string;
  is_new: boolean;
  recent_projects: RecentProjectInfo[];
}

export interface NativeFolderDialogResponse {
  folder_path: string;
  folder_name: string;
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

export const runProjectApi = {
  async selectOrCreateProject(
    agenticFlowId: string,
    folderPath: string
  ): Promise<{ code: number; data: SelectOrCreateProjectResponse }> {
    return await api.post('/run-project/select-or-create', {
      agentic_flow_id: agenticFlowId,
      folder_path: folderPath,
    });
  },

  async browseDirectory(path: string = ''): Promise<{ code: number; data: BrowseResponse | WorkspaceRootsResponse }> {
    return await api.get('/run-project/browse', { params: { path } });
  },

  async openNativeFolderDialog(
    agenticFlowId: string,
    title: string = '选择项目文件夹',
    initialdir: string = ''
  ): Promise<{ code: number; data: SelectOrCreateProjectResponse | null }> {
    return await api.get('/run-project/native-folder-dialog', { 
      params: { agentic_flow_id: agenticFlowId, title, initialdir } 
    });
  },

  async getCurrentProject(agenticFlowId?: string): Promise<{ code: number; data: ProjectInfo | null }> {
    const params: any = {};
    if (agenticFlowId) {
      params.agentic_flow_id = agenticFlowId;
    }
    return await api.get('/run-project/current', { params });
  },

  async getRecentProjects(
    agenticFlowId: string,
    limit: number = 10
  ): Promise<{ code: number; data: RecentProjectInfo[] }> {
    return await api.get('/run-project/recent', { 
      params: { 
        agentic_flow_id: agenticFlowId,
        limit 
      } 
    });
  },

  async listFiles(path: string = '', pattern: string = '*'): Promise<{ code: number; data: FileListResponse }> {
    return await api.post('/run-project/files/list', {
      path,
      pattern,
    });
  },

  async readFile(path: string, encoding: string = 'utf-8'): Promise<{ code: number; data: FileReadResponse }> {
    return await api.post('/run-project/files/read', {
      path,
      encoding,
    });
  },

  async writeFile(
    path: string,
    content: string,
    encoding: string = 'utf-8',
    mode: 'write' | 'append' = 'write'
  ): Promise<{ code: number; data: FileWriteResponse }> {
    return await api.post('/run-project/files/write', {
      path,
      content,
      encoding,
      mode,
    });
  },

  async deleteFile(path: string): Promise<{ code: number; data: { path: string; type: string; deleted: boolean } }> {
    return await api.delete('/run-project/files/delete', { params: { path } });
  },

  async createDirectory(path: string): Promise<{ code: number; data: { path: string; created: boolean } }> {
    return await api.post('/run-project/files/mkdir', null, { params: { path } });
  },

  async getFileInfo(path: string): Promise<{ code: number; data: FileInfo }> {
    return await api.get('/run-project/files/info', { params: { path } });
  },

  async fileExists(path: string): Promise<{ code: number; data: { path: string; exists: boolean } }> {
    return await api.get('/run-project/files/exists', { params: { path } });
  },

  getFileAccessUrl(path: string): string {
    return `/api/v1/run-project/files/access?path=${encodeURIComponent(path)}`;
  },
};

export default runProjectApi;
