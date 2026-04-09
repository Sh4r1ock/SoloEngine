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
import { authApi, User, Token } from '../services/authApi';

const COOKIE_OPTIONS = 'path=/; max-age=604800; SameSite=Strict';

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; ${COOKIE_OPTIONS}`;
}

function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return decodeURIComponent(parts.pop()?.split(';').shift() || '');
  }
  return null;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

interface AuthState {
  user: User | null;
  token: Token | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshToken: () => Promise<boolean>;
  loadUser: () => Promise<void>;
  updateUser: (email?: string, password?: string) => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  loading: false,
  error: null,

  login: async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    set({ loading: true, error: null });
    try {
      const response = await authApi.login(username, password);
      if (response.code === 200) {
        const token = response.data;
        setCookie('access_token', token.access_token);
        setCookie('refresh_token', token.refresh_token);
        localStorage.setItem('access_token', token.access_token);
        localStorage.setItem('refresh_token', token.refresh_token);
        set({ token, isAuthenticated: true, loading: false });
        
        await get().loadUser();
        return { success: true };
      } else {
        const errorMsg = response.message || '登录失败';
        set({ error: errorMsg, loading: false });
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

      set({ error: errorMessage, loading: false });
      return { success: false, error: errorMessage };
    }
  },

  register: async (username: string, email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    set({ loading: true, error: null });
    try {
      const response = await authApi.register(username, email, password);
      if (response.code === 200) {
        set({ loading: false });
        return { success: true };
      } else {
        const errorMsg = response.message || '注册失败';
        set({ error: errorMsg, loading: false });
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

      set({ error: errorMessage, loading: false });
      return { success: false, error: errorMessage };
    }
  },

  logout: () => {
    deleteCookie('access_token');
    deleteCookie('refresh_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    set({ user: null, token: null, isAuthenticated: false });
  },

  refreshToken: async () => {
    const refreshToken = getCookie('refresh_token') || localStorage.getItem('refresh_token');
    if (!refreshToken) {
      return false;
    }

    try {
      const response = await authApi.refreshToken(refreshToken);
      if (response.code === 200) {
        const token = response.data;
        setCookie('access_token', token.access_token);
        setCookie('refresh_token', token.refresh_token);
        localStorage.setItem('access_token', token.access_token);
        localStorage.setItem('refresh_token', token.refresh_token);
        set({ token });
        return true;
      } else {
        get().logout();
        return false;
      }
    } catch (error) {
      get().logout();
      return false;
    }
  },

  loadUser: async () => {
    const accessToken = getCookie('access_token') || localStorage.getItem('access_token');
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

  updateUser: async (email?: string, password?: string) => {
    set({ loading: true, error: null });
    try {
      const response = await authApi.updateMe(email, password);
      if (response.code === 200) {
        set({ user: response.data, loading: false });
        return true;
      } else {
        set({ error: response.message || '更新失败', loading: false });
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      set({ error: errorMessage, loading: false });
      return false;
    }
  },
}));
