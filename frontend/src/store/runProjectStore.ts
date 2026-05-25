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
import { 
  runProjectApi, 
  ProjectInfo, 
  RecentProjectInfo, 
  FileInfo, 
  SelectOrCreateProjectResponse
} from '../services/runProjectApi';
import { insertTreeNode, removeTreeNode, moveTreeNode } from '../components/RunPanel/utils/treePatchUtils';
import type { FileSystemChange } from '../components/RunPanel/types';

interface RunProjectState {
  currentProject: ProjectInfo | null;
  recentProjects: RecentProjectInfo[];
  files: FileInfo[];
  currentPath: string;
  loading: boolean;
  error: string | null;

  selectOrCreateProject: (agenticFlowId: string, folderPath: string) => Promise<SelectOrCreateProjectResponse | null>;
  openNativeFolderDialog: (agenticFlowId: string, title?: string, initialdir?: string) => Promise<SelectOrCreateProjectResponse | null>;
  setProjectFromSelectOrCreate: (data: SelectOrCreateProjectResponse) => void;
  setProjectLoading: (loading: boolean) => void;
  loadCurrentProject: (agenticFlowId?: string) => Promise<void>;
  loadRecentProjects: (agenticFlowId: string) => Promise<RecentProjectInfo[]>;
  listFiles: (path?: string, pattern?: string) => Promise<void>;
  setCurrentPath: (path: string) => void;
  clearProject: () => void;
  clearError: () => void;
  applyIncrementalChanges: (changes: FileSystemChange[]) => void;
}

export const useRunProjectStore = create<RunProjectState>((set, get) => ({
  currentProject: null,
  recentProjects: [],
  files: [],
  currentPath: '',
  loading: false,
  error: null,

  selectOrCreateProject: async (agenticFlowId: string, folderPath: string) => {
    set({ loading: true, error: null });
    try {
      const response = await runProjectApi.selectOrCreateProject(agenticFlowId, folderPath);
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
        return response.data;
      }
      set({ loading: false, error: '选择或创建项目失败' });
      return null;
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '选择或创建项目失败';
      set({ loading: false, error: errorMsg });
      return null;
    }
  },

  openNativeFolderDialog: async (agenticFlowId: string, title: string = '选择项目文件夹', initialdir: string = '') => {
    set({ loading: true, error: null });
    try {
      const response = await runProjectApi.openNativeFolderDialog(agenticFlowId, title, initialdir);
      set({ loading: false });
      if (response.code === 200 && response.data) {
        set({
          currentProject: {
            id: response.data.project_id,
            name: response.data.project_name,
            folder_path: response.data.folder_path,
          },
          recentProjects: response.data.recent_projects || [],
          currentPath: '',
        });
        return response.data;
      }
      return null;
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '选择文件夹失败';
      set({ loading: false, error: errorMsg });
      return null;
    }
  },

  setProjectFromSelectOrCreate: (data: SelectOrCreateProjectResponse) => {
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

  loadCurrentProject: async (agenticFlowId?: string) => {
    set({ loading: true, error: null });
    try {
      const response = await runProjectApi.getCurrentProject(agenticFlowId);
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

  loadRecentProjects: async (agenticFlowId: string) => {
    try {
      const response = await runProjectApi.getRecentProjects(agenticFlowId, 10);
      if (response.code === 200) {
        set({ recentProjects: response.data });
        return response.data;
      }
      return [];
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '获取最近项目失败';
      set({ error: errorMsg });
      console.error('Failed to load recent projects:', error);
      return [];
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

  applyIncrementalChanges: (changes) => {
    set((state) => {
      let newTree: any[] = state.files as any;
      for (const change of changes) {
        if (change.operation === 'created') {
          newTree = insertTreeNode(newTree, change.file_path, change.is_directory);
        } else if (change.operation === 'deleted') {
          newTree = removeTreeNode(newTree, change.file_path);
        } else if (change.operation === 'moved' && change.dest_path) {
          newTree = moveTreeNode(newTree, change.file_path, change.dest_path, change.is_directory);
        }
      }
      return { files: newTree as FileInfo[] };
    });
  },
}));
