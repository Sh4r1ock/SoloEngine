/**
 * @file utils/dataBlockUtils.ts
 * @description 数据块处理工具函数
 */

import type { DataBlock } from '../types';

export const detectOperationType = (block: DataBlock): string => {
  if (block.type === 'reasoning') {
    return 'reasoning';
  }
  if (block.type === 'tool_call') {
    return 'tool_call';
  }
  if (block.type === 'content') {
    return 'content';
  }
  return 'unknown';
};

export const formatJson = (obj: any, indent: number = 2): string => {
  try {
    if (typeof obj === 'string') {
      try {
        const parsed = JSON.parse(obj);
        return JSON.stringify(parsed, null, indent);
      } catch {
        return obj;
      }
    }
    return JSON.stringify(obj, null, indent);
  } catch {
    return String(obj);
  }
};

/**
 * 将文本写入系统剪贴板，确保 Windows 剪贴板历史(Win+V)能正确捕获。
 *
 * 原理：execCommand('copy') 走 WM_COPY → SetClipboardData → WM_CLIPBOARDUPDATE
 * 传统路径，与 Ctrl+C 完全一致，Windows 剪贴板历史服务一定能捕获。
 *
 * 注：navigator.clipboard.write() / writeText() 使用 Chromium 内部 HWND 作为
 * clipboard owner，Windows 剪贴板历史服务不识别该 owner，导致 Win+V 不记录。
 */
export const copyToClipboard = (text: string): boolean => {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
};

export const truncateText = (text: string, maxLength: number = 100): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

export const getBlockPreview = (block: DataBlock): string => {
  switch (block.type) {
    case 'reasoning':
      return truncateText(block.content || '', 80);
    case 'tool_call':
      return block.name || 'Unknown Tool';
    case 'content':
      return truncateText(block.content || '', 80);
    default:
      return 'Unknown Block';
  }
};

export const isBlockExpandable = (block: DataBlock): boolean => {
  if (block.type === 'reasoning') {
    return (block.content?.length || 0) > 100;
  }
  if (block.type === 'tool_call') {
    return true;
  }
  if (block.type === 'content') {
    return (block.content?.length || 0) > 200;
  }
  return false;
};

export const getBlockIcon = (block: DataBlock): string => {
  switch (block.type) {
    case 'reasoning':
      return '🧠';
    case 'tool_call':
      return '🔧';
    case 'content':
      return '📝';
    default:
      return '📄';
  }
};

export const getBlockColor = (block: DataBlock): string => {
  switch (block.type) {
    case 'reasoning':
      return '#722ed1';
    case 'tool_call':
      return '#1890ff';
    case 'content':
      return '#52c41a';
    default:
      return '#8c8c8c';
  }
};
