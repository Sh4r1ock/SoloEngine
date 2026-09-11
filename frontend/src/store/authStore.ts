/**
 * SoloEngine : 认证状态管理模块
 *
 * @file authStore.ts
 * @description 认证状态管理 - 用户认证状态管理模块
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 管理用户登录状态
 *     - 管理用户信息
 *     - 管理认证令牌
 *     - 使用Cookie持久化登录状态
 *     - 支持令牌自动刷新
 *
 * 依赖:
 *     - zustand: 状态管理库
 *     - ../services/authApi: 认证API服务
 *
 * 使用示例:
 *     - import { useAuthStore } from './store/authStore'
 *     - const { user, login, logout } = useAuthStore()
 */
import { create } from 'zustand';
import { authApi, User } from '../services/authApi';
import { getAccessToken, saveTokens, clearTokens } from '../utils/authStorage';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;

  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,

  login: async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await authApi.login(username, password);
      if (response.code === 200) {
        const token = response.data;
        saveTokens(token.access_token, token.refresh_token);
        set({ isAuthenticated: true });

        await get().loadUser();
        return { success: true };
      } else {
        const errorMsg = response.message || '登录失败';
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      let errorMessage = '登录失败';
      const detail = error?.response?.data?.detail;

      // 后端错误信息中文映射
      const errorMap: Record<string, string> = {
        'Incorrect username or password': '用户名或密码错误',
        'User not found': '用户不存在',
        'User already exists': '用户已存在',
        'Email already registered': '邮箱已被注册',
        'Invalid token': '登录已过期，请重新登录',
        'Token expired': '登录已过期，请重新登录',
        'Invalid authorization header': '登录信息无效，请重新登录',
        'Invalid token type': '登录信息无效，请重新登录',
        'Invalid token payload': '登录信息无效，请重新登录',
        'Not authenticated': '请先登录',
        'User is inactive': '账户已被禁用',
        'Not enough permissions': '没有权限执行此操作',
        'Invalid refresh token': '登录已过期，请重新登录',
        'Failed to update user': '更新用户信息失败',
        'Cannot delete yourself': '不能删除自己的账户',
      };

      if (detail) {
        if (detail.includes('per')) {
          errorMessage = '登录请求过于频繁，请稍后再试';
        } else {
          errorMessage = errorMap[detail] || detail;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }

      return { success: false, error: errorMessage };
    }
  },

  register: async (username: string, email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await authApi.register(username, email, password);
      if (response.code === 200) {
        return { success: true };
      } else {
        const errorMsg = response.message || '注册失败';
        return { success: false, error: errorMsg };
      }
    } catch (error: any) {
      let errorMessage = '注册失败';
      const detail = error?.response?.data?.detail;

      // 后端错误信息中文映射
      const errorMap: Record<string, string> = {
        'User already exists': '用户名已被注册',
        'Email already registered': '邮箱已被注册',
        'Invalid username format': '用户名格式不正确',
        'Invalid email format': '邮箱格式不正确',
        'Password too short': '密码长度不能少于6位',
      };

      if (detail) {
        if (detail.includes('per')) {
          errorMessage = '注册请求过于频繁，请稍后再试';
        } else {
          errorMessage = errorMap[detail] || detail;
        }
      } else if (error?.message) {
        errorMessage = error.message;
      }

      return { success: false, error: errorMessage };
    }
  },

  logout: () => {
    clearTokens();
    set({ user: null, isAuthenticated: false });
  },

  loadUser: async () => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      return;
    }

    try {
      const response = await authApi.getMe();
      if (response.code === 200) {
        set({ user: response.data, isAuthenticated: true });
      }
    } catch (error) {
      console.error('Failed to load user:', error);
    }
  },
}));
