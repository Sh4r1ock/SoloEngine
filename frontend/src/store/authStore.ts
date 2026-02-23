/**
 * @file authStore.ts
 * @description 认证状态管理 - 用户认证状态管理模块
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 管理用户登录状态、用户信息、认证令牌等
 * - 使用Cookie持久化登录状态
 * - 支持令牌自动刷新
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

  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, email: string, password: string) => Promise<boolean>;
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

  login: async (username: string, password: string) => {
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
        return true;
      } else {
        set({ error: response.message || '登录失败', loading: false });
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      set({ error: errorMessage, loading: false });
      return false;
    }
  },

  register: async (username: string, email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const response = await authApi.register(username, email, password);
      if (response.code === 200) {
        set({ loading: false });
        return true;
      } else {
        set({ error: response.message || '注册失败', loading: false });
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      set({ error: errorMessage, loading: false });
      return false;
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
