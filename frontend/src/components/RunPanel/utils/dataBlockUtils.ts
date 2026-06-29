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

export const copyToClipboard = async (text: string): Promise<boolean> => {
  // 显式以 text/plain MIME 写入剪贴板，确保 Windows 剪贴板历史(Win+V)能正确捕获
  // 单条路径：W3C Clipboard API (Baseline 2024) + ClipboardItem，无降级、无 DOM 操纵
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
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

export const mergeDataBlocks = (existing: DataBlock[], newBlocks: DataBlock[]): DataBlock[] => {
  const merged = [...existing];
  
  for (const newBlock of newBlocks) {
    const existingIndex = merged.findIndex(
      b => b.type === newBlock.type && b.id === newBlock.id
    );
    
    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...newBlock,
        content: (merged[existingIndex].content || '') + (newBlock.content || ''),
      };
    } else {
      merged.push(newBlock);
    }
  }
  
  return merged;
};

export const parseStreamChunk = (chunk: string): DataBlock[] => {
  const blocks: DataBlock[] = [];
  
  try {
    const data = JSON.parse(chunk);
    
    if (data.reasoning_content) {
      blocks.push({
        id: `reasoning_${Date.now()}`,
        type: 'reasoning',
        content: data.reasoning_content,
      });
    }
    
    if (data.tool_calls) {
      for (const toolCall of data.tool_calls) {
        blocks.push({
          id: toolCall.id || `tool_${Date.now()}`,
          type: 'tool_call',
          name: toolCall.function?.name,
          arguments: toolCall.function?.arguments,
        });
      }
    }
    
    if (data.content) {
      blocks.push({
        id: `content_${Date.now()}`,
        type: 'content',
        content: data.content,
      });
    }
  } catch {
    if (chunk.trim()) {
      blocks.push({
        id: `content_${Date.now()}`,
        type: 'content',
        content: chunk,
      });
    }
  }
  
  return blocks;
};
