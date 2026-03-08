/**
 * @file runProjectStore.ts
 * @description 运行项目状态管理 - 项目选择、文件系统隔离状态管理
 * @author SoloEngine Team
 * @date 2026-02-22
 * 
 * 功能描述：
 * - 管理当前选择的项目状态
 * - 管理最近项目列表
 * - 管理文件系统沙箱状态
 * 
 * 使用场景：
 * - 运行场景中的项目管理
 * - 文件系统沙箱隔离
 */

import { create } from 'zustand';
import { runProjectApi, ProjectInfo, RecentProjectInfo, FileInfo, SelectFolderResponse } from '../services/runProjectApi';

interface RunProjectState {
  currentProject: ProjectInfo | null;
  recentProjects: RecentProjectInfo[];
  files: FileInfo[];
  currentPath: string;
  loading: boolean;
  error: string | null;

  selectFolder: (folderPath: string) => Promise<boolean>;
  openNativeFolderDialog: () => Promise<SelectFolderResponse | null>;
  setProjectFromDialog: (data: SelectFolderResponse) => void;
  setProjectLoading: (loading: boolean) => void;
  loadCurrentProject: () => Promise<void>;
  loadRecentProjects: () => Promise<void>;
  switchProject: (projectId: string) => Promise<boolean>;
  listFiles: (path?: string, pattern?: string) => Promise<void>;
  setCurrentPath: (path: string) => void;
  clearProject: () => void;
  clearError: () => void;
}

export const useRunProjectStore = create<RunProjectState>((set, get) => ({
  currentProject: null,
  recentProjects: [],
  files: [],
  currentPath: '',
  loading: false,
  error: null,

  selectFolder: async (folderPath: string) => {
    set({ loading: true, error: null });
    try {
      const response = await runProjectApi.selectFolder(folderPath);
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

  openNativeFolderDialog: async () => {
    set({ loading: true, error: null });
    try {
      const response = await runProjectApi.openNativeFolderDialog('选择项目文件夹');
      if (response.code === 200 && response.data) {
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
        return response.data;
      }
      set({ loading: false });
      return null;
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '选择文件夹失败';
      set({ loading: false, error: errorMsg });
      return null;
    }
  },

  setProjectFromDialog: (data: SelectFolderResponse) => {
    set({
      currentProject: {
        id: data.project_id,
        name: data.project_name,
        folder_path: data.folder_path,
      },
      recentProjects: data.recent_projects,
      currentPath: '',
    });
  },

  setProjectLoading: (loading: boolean) => {
    set({ loading });
  },

  loadCurrentProject: async () => {
    set({ loading: true, error: null });
    try {
      const response = await runProjectApi.getCurrentProject();
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
      const response = await runProjectApi.getRecentProjects(10);
      if (response.code === 200) {
        set({ recentProjects: response.data });
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '获取最近项目失败';
      set({ error: errorMsg });
      console.error('Failed to load recent projects:', error);
    }
  },

  switchProject: async (projectId: string) => {
    set({ loading: true, error: null });
    try {
      const response = await runProjectApi.switchProject(projectId);
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
      const response = await runProjectApi.listFiles(path, pattern);
      if (response.code === 200) {
        set({
          files: response.data.files,
          currentPath: response.data.relative_path,
          loading: false,
        });
      } else {
        set({ loading: false, error: '获取文件列表失败' });
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '获取文件列表失败';
      set({ loading: false, error: errorMsg });
    }
  },

  setCurrentPath: (path: string) => {
    set({ currentPath: path });
  },

  clearProject: () => {
    set({
      currentProject: null,
      files: [],
      currentPath: '',
      error: null,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
