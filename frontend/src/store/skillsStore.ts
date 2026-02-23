/**
 * @file skillsStore.ts
 * @description Skills状态管理 - Skills包状态管理模块
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 管理已安装Skills列表、安装状态等
 * - 管理Skills列表、跟踪安装状态、缓存Skills详情
 * 
 * 使用场景：
 * - Skills包管理界面
 * - Skills包的创建、导入和删除
 * 
 * 注意事项：
 * - 支持搜索过滤功能
 * - 支持文件导入
 */
import { create } from 'zustand';
import { SkillsPackage, skillsApi } from '../services/skillsApi';

/**
 * Skills状态接口
 */
interface SkillsState {
  packages: SkillsPackage[];
  loading: boolean;
  error: string | null;
  selectedPackage: SkillsPackage | null;

  loadPackages: () => Promise<void>;
  createPackage: (name: string, description?: string, author?: string, tags?: string[]) => Promise<boolean>;
  deletePackage: (name: string) => Promise<boolean>;
  importPackage: (file: File) => Promise<boolean>;
  selectPackage: (pkg: SkillsPackage | null) => void;
  searchPackages: (query: string, tags?: string[]) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  packages: [],
  loading: false,
  error: null,
  selectedPackage: null,

  loadPackages: async () => {
    set({ loading: true, error: null });
    try {
      const response = await skillsApi.getPackages();
      if (response.code === 200) {
        set({ packages: response.data, loading: false });
      } else {
        set({ error: response.message, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  createPackage: async (name: string, description?: string, author?: string, tags?: string[]) => {
    set({ loading: true, error: null });
    try {
      const response = await skillsApi.createPackage({ name, description, author, tags });
      if (response.code === 200) {
        await get().loadPackages();
        return true;
      } else {
        set({ error: response.message, loading: false });
        return false;
      }
    } catch (error) {
      set({ error: String(error), loading: false });
      return false;
    }
  },

  deletePackage: async (name: string) => {
    set({ loading: true, error: null });
    try {
      const response = await skillsApi.deletePackage(name);
      if (response.code === 200) {
        await get().loadPackages();
        return true;
      } else {
        set({ error: response.message, loading: false });
        return false;
      }
    } catch (error) {
      set({ error: String(error), loading: false });
      return false;
    }
  },

  importPackage: async (file: File) => {
    set({ loading: true, error: null });
    try {
      const response = await skillsApi.importPackage(file);
      if (response.code === 200) {
        await get().loadPackages();
        return true;
      } else {
        set({ error: response.message, loading: false });
        return false;
      }
    } catch (error) {
      set({ error: String(error), loading: false });
      return false;
    }
  },

  selectPackage: (pkg: SkillsPackage | null) => {
    set({ selectedPackage: pkg });
  },

  searchPackages: async (query: string, tags?: string[]) => {
    set({ loading: true, error: null });
    try {
      const response = await skillsApi.searchPackages(query, tags);
      if (response.code === 200) {
        set({ packages: response.data, loading: false });
      } else {
        set({ error: response.message, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
}));
