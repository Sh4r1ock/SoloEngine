/**
 * SoloEngine : 时区工具模块
 *
 * @file timezone.ts
 * @description 时区工具 - 提供统一的时间处理方法
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 设计说明：
 *   SoloEngine 是本地自托管单实例应用，时区由 .env 中 DEFAULT_TIMEZONE 统一控制。
 *   后端所有时间均使用 ZoneInfo(settings.DEFAULT_TIMEZONE) 生成带时区标识符的 ISO 字符串。
 *   前端直接使用 dayjs 解析即可，无需额外时区转换。
 *
 * 依赖:
 *     - dayjs: 日期时间处理库
 */

import dayjs from 'dayjs';

export const formatTime = (date: string | Date | null | undefined, format = 'YYYY-MM-DD HH:mm:ss'): string => {
  if (!date) return '-';
  try {
    return dayjs(date).format(format);
  } catch {
    return '-';
  }
};

export const formatTimeShort = (date: string | Date | null | undefined): string => {
  return formatTime(date, 'MM-DD HH:mm');
};

export const formatDate = (date: string | Date | null | undefined): string => {
  return formatTime(date, 'YYYY-MM-DD');
};

export const formatDateLong = (date: string | Date | null | undefined): string => {
  return formatTime(date, 'YYYY年MM月DD日');
};

export const formatDateTime = (date: string | Date | null | undefined): string => {
  return formatTime(date, 'YYYY-MM-DD HH:mm:ss');
};

export const now = (format = 'YYYY-MM-DD HH:mm:ss'): string => {
  return dayjs().format(format);
};

export const nowISO = (): string => {
  return dayjs().toISOString();
};

export const parseTime = (date: string | Date): dayjs.Dayjs => {
  return dayjs(date);
};

export const formatRelative = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  try {
    const nowDt = dayjs();
    const target = dayjs(date);
    const diffMinutes = nowDt.diff(target, 'minute');
    const diffHours = nowDt.diff(target, 'hour');
    const diffDays = nowDt.diff(target, 'day');

    if (diffMinutes < 1) return '刚刚';
    if (diffMinutes < 60) return `${diffMinutes}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return formatTime(date, 'YYYY-MM-DD');
  } catch {
    return '-';
  }
};

export const isToday = (date: string | Date): boolean => {
  const today = dayjs().format('YYYY-MM-DD');
  const target = dayjs(date).format('YYYY-MM-DD');
  return today === target;
};

export const isYesterday = (date: string | Date): boolean => {
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const target = dayjs(date).format('YYYY-MM-DD');
  return yesterday === target;
};

export const formatSmartTime = (dateStr?: string | Date | null): string => {
  if (!dateStr) return '';
  try {
    const target = dayjs(dateStr);
    const nowDt = dayjs();
    const hours = target.format('HH:mm');
    const isSameYear = target.year() === nowDt.year();
    const isTodayFlag = target.format('YYYY-MM-DD') === nowDt.format('YYYY-MM-DD');
    if (isTodayFlag) return hours;
    const month = target.month() + 1;
    const day = target.date();
    if (isSameYear) return `${month}月${day}日 ${hours}`;
    return `${target.year()}年${month}月${day}日 ${hours}`;
  } catch {
    return '';
  }
};

export default {
  formatTime,
  formatTimeShort,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatSmartTime,
  formatRelative,
  now,
  nowISO,
  parseTime,
  isToday,
  isYesterday,
};
