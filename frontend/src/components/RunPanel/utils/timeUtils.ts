/**
 * @file utils/timeUtils.ts
 * @description 时间格式化工具函数 - 统一使用 timezone.ts 的时区感知函数
 */

import {
  formatSmartTime as tzFormatSmartTime,
  formatTimeShort as tzFormatTimeShort,
  formatDateTime,
  formatRelative,
  isToday as tzIsToday,
  isYesterday as tzIsYesterday,
} from '../../../utils/timezone';

export const formatSmartTime = tzFormatSmartTime;

export const formatTimeShort = tzFormatTimeShort;

export const formatTimeFull = formatDateTime;

export const formatDuration = (ms?: number): string => {
  if (!ms) return '-';

  if (ms < 1000) {
    return `${ms}ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);

  return `${minutes}m ${seconds}s`;
};

export const getRelativeTime = formatRelative;

export const isToday = tzIsToday;

export const isYesterday = tzIsYesterday;
