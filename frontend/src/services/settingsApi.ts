/**
 * SoloEngine : 设置API服务模块
 *
 * @file settingsApi.ts
 * @description 设置服务 - 时区设置相关API
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 获取当前用户时区设置
 *     - 设置用户时区
 *     - 获取所有可用时区列表
 *     - 获取当前时间信息
 *
 * 依赖:
 *     - ./api: API基础服务
 *
 * 使用示例:
 *     - import { getTimezone, setTimezone } from './settingsApi'
 *     - const timezone = await getTimezone()
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
