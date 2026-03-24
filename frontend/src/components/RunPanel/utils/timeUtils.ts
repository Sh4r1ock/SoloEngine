/**
 * @file utils/timeUtils.ts
 * @description 时间格式化工具函数
 */

export const formatSmartTime = (dateStr?: string): string => {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  const now = new Date();
  
  const isSameYear = date.getFullYear() === now.getFullYear();
  const isToday = date.toDateString() === now.toDateString();
  
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;
  
  if (isToday) {
    return timeStr;
  }
  
  const month = date.getMonth() + 1;
  const day = date.getDate();
  
  if (isSameYear) {
    return `${month}月${day}日 ${timeStr}`;
  }
  
  const year = date.getFullYear();
  return `${year}年${month}月${day}日 ${timeStr}`;
};

export const formatTimeShort = (dateStr?: string): string => {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  return `${hours}:${minutes}`;
};

export const formatTimeFull = (dateStr?: string): string => {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

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

export const getRelativeTime = (dateStr?: string): string => {
  if (!dateStr) return '';
  
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) {
    return '刚刚';
  }
  
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  }
  
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`;
  }
  
  if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)}天前`;
  }
  
  return formatSmartTime(dateStr);
};

export const isToday = (dateStr?: string): boolean => {
  if (!dateStr) return false;
  
  const date = new Date(dateStr);
  const now = new Date();
  
  return date.toDateString() === now.toDateString();
};

export const isYesterday = (dateStr?: string): boolean => {
  if (!dateStr) return false;
  
  const date = new Date(dateStr);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  return date.toDateString() === yesterday.toDateString();
};
