/**
 * @file debugProjectStore.ts
 * @description 调试项目状态管理 - 项目选择、文件系统隔离状态管理
 * @author SoloEngine Team
 * @date 2026-02-22
 * 
 * 功能描述：
 * - 管理当前选择的项目状态
 * - 管理最近项目列表
 * - 管理文件系统沙箱状态
 * 
 * 使用场景：
 * - 面试调试场景中的项目管理
 * - 文件系统沙箱隔离
 */

import { create } from 'zustand';
import { debugProjectApi, ProjectInfo, RecentProjectInfo, FileInfo } from '../services/debugProjectApi';

interface DebugProjectState {
  currentProject: ProjectInfo | null;
  recentProjects: RecentProjectInfo[];
  files: FileInfo[];
  currentPath: string;
  loading: boolean;
  error: string | null;

  selectFolder: (folderPath: string) => Promise<boolean>;
  loadCurrentProject: () => Promise<void>;
  loadRecentProjects: () => Promise<void>;
  switchProject: (projectId: string) => Promise<boolean>;
  listFiles: (path?: string, pattern?: string) => Promise<void>;
  setCurrentPath: (path: string) => void;
  clearError: () => void;
}

export const useDebugProjectStore = create<DebugProjectState>((set, get) => ({
  currentProject: null,
  recentProjects: [],
  files: [],
  currentPath: '',
  loading: false,
  error: null,

  selectFolder: async (folderPath: string) => {
    set({ loading: true, error: null });
    try {
      const response = await debugProjectApi.selectFolder(folderPath);
      if (response.code === 200) {
        set({
          currentProject: {
            id: response.data.project_id,
            name: response.data.project_name,
            folder_path: response.data.folder_path,
          },
          recentProjects: response.data.recent_projects,
          loading: false,
          currentPath: '',
        });
        return true;
      }
      set({ loading: false, error: '选择文件夹失败' });
      return false;
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '选择文件夹失败';
      set({ loading: false, error: errorMsg });
      return false;
    }
  },

  loadCurrentProject: async () => {
    set({ loading: true, error: null });
    try {
      const response = await debugProjectApi.getCurrentProject();
      if (response.code === 200 && response.data) {
        set({
          currentProject: response.data,
          loading: false,
        });
      } else {
        set({
          currentProject: null,
          loading: false,
        });
      }
    } catch (error: any) {
      set({ loading: false, error: error.message });
    }
  },

  loadRecentProjects: async () => {
    try {
      const response = await debugProjectApi.getRecentProjects(10);
      if (response.code === 200) {
        set({ recentProjects: response.data });
      }
    } catch (error: any) {
      console.error('Failed to load recent projects:', error);
    }
  },

  switchProject: async (projectId: string) => {
    set({ loading: true, error: null });
    try {
      const response = await debugProjectApi.switchProject(projectId);
      if (response.code === 200) {
        set({
          currentProject: response.data,
          loading: false,
          currentPath: '',
        });
        await get().loadRecentProjects();
        return true;
      }
      set({ loading: false, error: '切换项目失败' });
      return false;
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '切换项目失败';
      set({ loading: false, error: errorMsg });
      return false;
    }
  },

  listFiles: async (path: string = '', pattern: string = '*') => {
    set({ loading: true, error: null });
    try {
      const response = await debugProjectApi.listFiles(path, pattern);
      if (response.code === 200) {
        set({
          files: response.data.files,
          currentPath: response.data.relative_path,
          loading: false,
        });
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '获取文件列表失败';
      set({ loading: false, error: errorMsg });
    }
  },

  setCurrentPath: (path: string) => {
    set({ currentPath: path });
  },

  clearError: () => {
    set({ error: null });
  },
}));
