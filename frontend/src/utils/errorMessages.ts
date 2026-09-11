/**
 * SoloEngine : 错误码 → 中文提示唯一映射（F2 路径合并）
 *
 * api.ts / mcpApi.ts 等 axios 客户端的响应拦截器统一复用本函数，
 * 不再各自维护一份错误码映射表。
 */
import { AxiosError } from 'axios';

export const getErrorMessage = (error: AxiosError): string => {
  // 网络连接错误
  if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK' || !error.response) {
    return '无法连接到服务器，请检查后端服务是否启动';
  }
  // 超时错误
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    return '请求超时，请稍后重试';
  }
  // HTTP状态码错误
  if (error.response) {
    const status = error.response.status;
    switch (status) {
      case 400:
        return '请求参数错误';
      case 401:
        return '登录已过期，请重新登录';
      case 403:
        return '没有权限执行此操作';
      case 404:
        return '请求的资源不存在';
      case 408:
        return '请求超时，请稍后重试';
      case 500:
        return '服务器内部错误，请稍后重试';
      case 502:
        return '网关错误，请刷新页面重试';
      case 503:
        return '服务暂时不可用，请稍后重试';
      case 504:
        return '网关超时，请稍后重试';
      default:
        return `服务器错误 (${status})`;
    }
  }
  return '网络请求失败，请检查网络连接';
};
