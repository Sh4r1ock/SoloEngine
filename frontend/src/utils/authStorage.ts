/**
 * SoloEngine : 认证 token 存储唯一实现（F3 路径合并）
 *
 * getCookie / token 读取 / token 落盘 / token 清除统一收敛到本模块，
 * api.ts / mcpApi.ts / authStore 等一律复用，不再各自实现。
 */

export const getCookie = (name: string): string | null => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return decodeURIComponent(parts.pop()?.split(';').shift() || '');
  }
  return null;
};

export const getAccessToken = (): string | null =>
  getCookie('access_token') || localStorage.getItem('access_token');

export const getRefreshToken = (): string | null =>
  getCookie('refresh_token') || localStorage.getItem('refresh_token');

export const saveTokens = (accessToken: string, refreshToken: string): void => {
  document.cookie = `access_token=${encodeURIComponent(accessToken)}; path=/; max-age=604800; SameSite=Strict`;
  document.cookie = `refresh_token=${encodeURIComponent(refreshToken)}; path=/; max-age=604800; SameSite=Strict`;
  localStorage.setItem('access_token', accessToken);
  localStorage.setItem('refresh_token', refreshToken);
};

export const clearTokens = (): void => {
  document.cookie = 'access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  document.cookie = 'refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
};
