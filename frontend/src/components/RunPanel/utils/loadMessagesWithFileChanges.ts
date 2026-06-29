import { runApi } from '../../../services/runApi';
import { fileChangesApi } from '../../../services/fileChangesApi';
import { convertToLLMMessages } from './messageUtils';
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

  const rawMessages: SessionMessage[] = (msgs || []).map((msg: any, index: number) => ({
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
    tokens: msg.total_tokens,
    prompt_tokens: msg.prompt_tokens,
    completion_tokens: msg.completion_tokens,
    total_tokens: msg.total_tokens,
  }));

  const restoredMessages: Message[] = convertToLLMMessages(rawMessages);

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
