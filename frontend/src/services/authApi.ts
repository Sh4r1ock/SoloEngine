/**
 * @file authApi.ts
 * @description 认证API服务 - 用户认证相关接口封装
 * @author SoloEngine Team
 * @date 2026-02-20
 * 
 * 功能描述：
 * - 提供用户登录、注册、登出、获取当前用户等认证相关接口调用
 * - 用户登录、用户注册、用户登出、获取用户信息
 * 
 * 使用场景：
 * - 用户身份验证和会话管理
 * - 用户账户管理
 * 
 * 注意事项：
 * - 登录成功后会返回JWT令牌
 * - 需要妥善处理令牌的存储和刷新
 * 
 * 状态: ✅ 完整实现
 */
import { api, ApiResponse } from './api';

export interface User {
  id: string;
  username: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
}

export interface Token {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

class AuthApi {
  async login(username: string, password: string): Promise<ApiResponse<Token>> {
    return api.post<Token>('/auth/login', { username, password });
  }

  async register(username: string, email: string, password: string): Promise<ApiResponse<User>> {
    return api.post<User>('/auth/register', { username, email, password });
  }

  async refreshToken(refreshToken: string): Promise<ApiResponse<Token>> {
    return api.post<Token>('/auth/refresh', { refresh_token: refreshToken });
  }

  async getMe(): Promise<ApiResponse<User>> {
    return api.get<User>('/auth/me');
  }

  async updateMe(email?: string, password?: string): Promise<ApiResponse<User>> {
    return api.put<User>('/auth/me', { email, password });
  }

  async getUsers(): Promise<ApiResponse<User[]>> {
    return api.get<User[]>('/auth/users');
  }

  async deleteUser(userId: string): Promise<ApiResponse<{ user_id: string }>> {
    return api.delete<{ user_id: string }>(`/auth/users/${userId}`);
  }
}

export const authApi = new AuthApi();
