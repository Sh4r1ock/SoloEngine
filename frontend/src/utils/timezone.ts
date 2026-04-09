/**
 * SoloEngine : 时区工具模块
 *
 * @file timezone.ts
 * @description 时区工具 - 提供统一的时间处理方法，支持用户自定义时区
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 设置用户时区
 *     - 获取当前用户时区
 *     - 格式化时间为用户时区
 *     - 格式化时间为短格式
 *     - 获取当前时间
 *     - 获取所有可用时区列表
 *     - 获取常用时区列表
 *
 * 依赖:
 *     - dayjs: 日期时间处理库
 *     - dayjs/plugin/utc: UTC插件
 *     - dayjs/plugin/timezone: 时区插件
 *
 * 使用示例:
 *     - import { setUserTimezone, formatTime, getUserTimezone } from './timezone'
 *     - setUserTimezone('Asia/Shanghai')
 *     - const formatted = formatTime(new Date())
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

let userTimezone = 'Asia/Shanghai';

/**
 * 设置用户时区
 * @param tz IANA 时区名称
 */
export const setUserTimezone = (tz: string): void => {
  userTimezone = tz;
  dayjs.tz.setDefault(tz);
};

/**
 * 获取当前用户时区
 */
export const getUserTimezone = (): string => {
  return userTimezone;
};

/**
 * 格式化时间为用户时区
 * @param date 时间字符串或 Date 对象
 * @param format 格式化字符串，默认 'YYYY-MM-DD HH:mm:ss'
 */
export const formatTime = (date: string | Date | null | undefined, format = 'YYYY-MM-DD HH:mm:ss'): string => {
  if (!date) return '-';
  try {
    return dayjs(date).tz(userTimezone).format(format);
  } catch {
    return '-';
  }
};

/**
 * 格式化时间为短格式 (MM-DD HH:mm)
 * @param date 时间字符串或 Date 对象
 */
export const formatTimeShort = (date: string | Date | null | undefined): string => {
  return formatTime(date, 'MM-DD HH:mm');
};

/**
 * 格式化时间为日期格式 (YYYY-MM-DD)
 * @param date 时间字符串或 Date 对象
 */
export const formatDate = (date: string | Date | null | undefined): string => {
  return formatTime(date, 'YYYY-MM-DD');
};

/**
 * 格式化时间为长日期格式 (YYYY年MM月DD日)
 * @param date 时间字符串或 Date 对象
 */
export const formatDateLong = (date: string | Date | null | undefined): string => {
  return formatTime(date, 'YYYY年MM月DD日');
};

/**
 * 格式化时间为完整格式 (YYYY-MM-DD HH:mm:ss)
 * @param date 时间字符串或 Date 对象
 */
export const formatDateTime = (date: string | Date | null | undefined): string => {
  return formatTime(date, 'YYYY-MM-DD HH:mm:ss');
};

/**
 * 获取当前时间（用户时区）
 * @param format 格式化字符串
 */
export const now = (format = 'YYYY-MM-DD HH:mm:ss'): string => {
  return dayjs().tz(userTimezone).format(format);
};

/**
 * 获取当前时间的 ISO 字符串
 */
export const nowISO = (): string => {
  return dayjs().tz(userTimezone).toISOString();
};

/**
 * 解析时间字符串为 dayjs 对象
 * @param date 时间字符串
 */
export const parseTime = (date: string | Date): dayjs.Dayjs => {
  return dayjs(date).tz(userTimezone);
};

/**
 * 获取相对时间描述（如 "2小时前"）
 * @param date 时间字符串或 Date 对象
 */
export const formatRelative = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  try {
    const now = dayjs().tz(userTimezone);
    const target = dayjs(date).tz(userTimezone);
    const diffMinutes = now.diff(target, 'minute');
    const diffHours = now.diff(target, 'hour');
    const diffDays = now.diff(target, 'day');

    if (diffMinutes < 1) return '刚刚';
    if (diffMinutes < 60) return `${diffMinutes}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    return formatTime(date, 'YYYY-MM-DD');
  } catch {
    return '-';
  }
};

/**
 * 检查是否是今天
 * @param date 时间字符串或 Date 对象
 */
export const isToday = (date: string | Date): boolean => {
  const today = dayjs().tz(userTimezone).format('YYYY-MM-DD');
  const target = dayjs(date).tz(userTimezone).format('YYYY-MM-DD');
  return today === target;
};

/**
 * 检查是否是昨天
 * @param date 时间字符串或 Date 对象
 */
export const isYesterday = (date: string | Date): boolean => {
  const yesterday = dayjs().tz(userTimezone).subtract(1, 'day').format('YYYY-MM-DD');
  const target = dayjs(date).tz(userTimezone).format('YYYY-MM-DD');
  return yesterday === target;
};

export default {
  setUserTimezone,
  getUserTimezone,
  formatTime,
  formatTimeShort,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatRelative,
  now,
  nowISO,
  parseTime,
  isToday,
  isYesterday,
};
