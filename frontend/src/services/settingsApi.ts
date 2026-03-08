/**
 * 设置服务 - 时区设置相关 API
 */
import { api } from './api';

export interface TimezoneResponse {
  timezone: string;
  success: boolean;
  message: string;
}

export interface TimezoneListResponse {
  timezones: string[];
  common_timezones: string[];
}

export interface CurrentTimeResponse {
  utc_time: string;
  user_time: string;
  user_timezone: string;
  formatted_utc: string;
  formatted_user: string;
}

/**
 * 获取当前用户时区设置
 */
export const getTimezone = async (): Promise<TimezoneResponse> => {
  const response = await api.get<TimezoneResponse>('/settings/timezone');
  return response.data;
};

/**
 * 设置用户时区
 * @param timezone IANA 时区名称，如 'Asia/Shanghai'
 */
export const setTimezone = async (timezone: string): Promise<TimezoneResponse> => {
  const response = await api.post<TimezoneResponse>('/settings/timezone', { timezone });
  return response.data;
};

/**
 * 获取所有可用的时区列表
 */
export const getTimezoneList = async (): Promise<TimezoneListResponse> => {
  const response = await api.get<TimezoneListResponse>('/settings/timezone/list');
  return response.data;
};

/**
 * 获取当前时间信息
 */
export const getCurrentTime = async (): Promise<CurrentTimeResponse> => {
  const response = await api.get<CurrentTimeResponse>('/settings/time');
  return response.data;
};
