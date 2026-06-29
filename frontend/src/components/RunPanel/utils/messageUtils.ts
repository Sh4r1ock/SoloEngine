import { DataBlock, LLMMessage, Message } from '../types';

export const convertToLLMMessages = (msgs: any[]): Message[] => {
  const result: Message[] = [];
  for (const msg of msgs) {
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

    const timestamp = msg.created_at || msg.timestamp || new Date().toISOString();

    result.push({
      id: msg.id,
      role: msg.role as 'user' | 'assistant' | 'system',
      content: content || msg.content || '',
      reasoning_content: reasoningContent,
      data,
      timestamp,
      tokens: msg.total_tokens || msg.tokens,
      agent_id: msg.agent_id,
      agent_name: msg.agent_name,
      parent_agent_id: msg.parent_agent_id,
      status: msg.status,
      error: msg.error,
    });

    if (msg.error) {
      result.push({
        id: `${msg.id}_error`,
        role: 'error',
        error: msg.error,
        timestamp,
        status: 'error',
      });
    }
  }
  return result;
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
