import { DataBlock, LLMMessage, Message, TokenTotals } from '../types';

/**
 * LLMMessage 统一构造器（去重：回显 convertToMessages 与流式 commit createLLMMessage
 * 共用同一构造，消除"严格同构但两处实现"的重复——路径合并原则的落地）。
 * 字段显式传入，默认值收敛：content 空串、data 不填（undefined）、status 不填。
 */
export const buildLLMMessage = (options: {
  id: string;
  role?: 'user' | 'assistant';
  content?: string;
  reasoning_content?: string;
  timestamp: string;
  data?: DataBlock[];
  status?: LLMMessage['status'];
  tokens?: number;
  token_totals?: TokenTotals;
  token_usage_history?: any[];
  agent_id?: string;
  agent_name?: string;
  parent_agent_id?: string;
  parent_message_id?: string;
  isCompaction?: boolean;
}): LLMMessage => ({
  id: options.id,
  role: options.role ?? 'assistant',
  content: options.content ?? '',
  reasoning_content: options.reasoning_content,
  data: options.data,
  timestamp: options.timestamp,
  status: options.status,
  tokens: options.tokens,
  token_totals: options.token_totals,
  token_usage_history: options.token_usage_history,
  agent_id: options.agent_id,
  agent_name: options.agent_name,
  parent_agent_id: options.parent_agent_id,
  parent_message_id: options.parent_message_id,
  isCompaction: options.isCompaction,
});

/**
 * 历史回显转换 —— 两条独立规则，与 commitExecutionMessages 严格同构：
 *   有 LLM  → push LLMMessage       （不论 data 是否为空，LLM 调过就有块）
 *   有 error → push SystemMessage  （独立判断，与 LLM 块并列）
 *
 * 不写 if-else，不嵌套，不写"data=[] 就跳过"的兜底分支。
 */
export const convertToMessages = (msgs: any[]): Message[] => {
  const result: Message[] = [];
  for (const msg of msgs) {
    const data: DataBlock[] = msg.data || [];
    const errorText: string | undefined = msg.error;
    const role = msg.role;

    // 规则 1：有 LLM → push LLM（数据有无不影响，0 产出也建占位）
    let content = '';
    let reasoningContent: string | undefined;
    for (const block of data) {
      if (block.type === 'content') content = block.content || '';
      else if (block.type === 'reasoning_content') reasoningContent = block.reasoning_content;
    }

    result.push(buildLLMMessage({
      id: msg.id,
      role,
      content: content || msg.content || '',
      reasoning_content: reasoningContent,
      data,
      timestamp: msg.created_at || msg.timestamp || new Date().toISOString(),
      // 后端聚合改造（4.7）：tokens 读 rawMessages 映射好的后端聚合值（loadMessagesWithFileChanges
      // 已将后端 token_usage.total 写入 msg.tokens），不再前端求和
      tokens: msg.tokens ?? msg.token_totals?.total,
      // 后端聚合改造（4.7）：token_totals 透传后端聚合字段（loadMessagesWithFileChanges
      // 已将后端 token_usage 映射为 msg.token_totals，消息头 hover 数据源）
      token_totals: msg.token_totals,
      token_usage_history: msg.token_usage_history,
      agent_id: msg.agent_id,
      agent_name: msg.agent_name,
      parent_agent_id: msg.parent_agent_id,
      parent_message_id: msg.parent_message_id,
      status: msg.status,
      isCompaction: msg.status === 'compacted',
    }));

    // 规则 2：有 error → push SM（独立判断，平级）
    if (errorText) {
      result.push({
        id: `${msg.id}_error`,
        role: 'error',
        error: errorText,
        timestamp: msg.created_at || msg.timestamp || new Date().toISOString(),
      });
    }
  }
  return result;
};

export const formatJson = (obj: any) => {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
};

export { copyToClipboard } from './dataBlockUtils';

export const formatDuration = (duration?: number) => {
  if (!duration) return '-';
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(2)}s`;
  return `${(duration / 60000).toFixed(2)}m`;
};
