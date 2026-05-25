import { DataBlock, LLMMessage } from '../types';

export const convertToLLMMessages = (msgs: any[]): LLMMessage[] => {
  return msgs.map((msg: any) => {
    const data: DataBlock[] = msg.data || [];
    let content = '';
    let reasoningContent: string | undefined;

    for (const block of data) {
      if (block.type === 'content') {
        content = block.content || '';
      } else if (block.type === 'reasoning_content') {
        reasoningContent = block.reasoning_content;
      }
    }

    return {
      id: msg.id,
      role: msg.role as 'user' | 'assistant' | 'system',
      content: content || msg.content || '',
      reasoning_content: reasoningContent,
      data,
      timestamp: msg.created_at || msg.timestamp || new Date().toISOString(),
      tokens: msg.total_tokens || msg.tokens,
      agent_id: msg.agent_id,
      agent_name: msg.agent_name,
      parent_agent_id: msg.parent_agent_id,
      status: msg.status,
      error: msg.error,
    };
  });
};

export const formatJson = (obj: any) => {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
};

export const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); };

export const formatDuration = (duration?: number) => {
  if (!duration) return '-';
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(2)}s`;
  return `${(duration / 60000).toFixed(2)}m`;
};
