import { runApi } from '../../../services/runApi';
import { fileChangesApi } from '../../../services/fileChangesApi';
import { convertToMessages } from './messageUtils';
import type { LLMMessage, Message, DataBlock, FileChangeInfo, SessionMessage, MessageFileChangesMap } from '../types';

const mapFileChange = (c: any): FileChangeInfo => ({
  file_path: c.file_path,
  operation: c.operation,
  content_type: c.content_type || 'text',
  id: c.id,
  tool_call_id: c.tool_call_id,
  status: c.status,
  diff: (c.lines_added || c.lines_removed) ? {
    lines_added: c.lines_added ?? 0,
    lines_removed: c.lines_removed ?? 0,
  } : undefined,
});

export const loadMessages = async (sessionId: string): Promise<{ messages: Message[]; fileChangesMap: MessageFileChangesMap; rawMessages: SessionMessage[] }> => {
  const [msgs, fcResponse] = await Promise.all([
    runApi.getSessionMessages(sessionId),
    fileChangesApi.getSessionFileChanges(sessionId, { limit: 500, diff_type: 'net' } as any).catch(() => null),
  ]);

  let rawMessages: SessionMessage[] = (msgs || []).map((msg: any, index: number) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content || '',
    reasoning_content: msg.reasoning_content,
    status: msg.status || 'completed',
    error: msg.error,
    data: msg.data || [],
    message_index: msg.message_index ?? index,
    timestamp: msg.created_at || new Date().toISOString(),
    created_at: msg.created_at,
    // 后端聚合改造（4.6-1）：mainagent 合并已由后端完成（run.py get_session_messages：
    // 同一 user 下 stop/compacted/completed 合并为一条），tokens 直接读后端聚合字段
    // token_usage.total——前端不再求和（删除 pendingMain 合并逻辑）
    tokens: msg.token_usage?.total,
    // 后端聚合改造（4.6-2）：token_totals 透传后端聚合字段 token_usage（消息头 hover 数据源）
    token_totals: msg.token_usage,
    token_usage_history: msg.token_usage_history,
    agent_id: msg.agent_id,
    agent_name: msg.agent_name,
    parent_agent_id: msg.parent_agent_id,
    parent_message_id: msg.parent_message_id,
  }));

  const restoredMessages: Message[] = convertToMessages(rawMessages);

  const fileChangesMap: MessageFileChangesMap = {};

  if (fcResponse) {
    const fcData = (fcResponse as any)?.data || fcResponse;
    const allChanges: any[] = fcData?.changes || [];
    for (const c of allChanges) {
      const mid = c.message_id;
      if (!mid) continue;
      if (!fileChangesMap[mid]) {
        fileChangesMap[mid] = [];
      }
      fileChangesMap[mid].push(mapFileChange(c));
    }
  }

  return { messages: restoredMessages, fileChangesMap, rawMessages };
};
