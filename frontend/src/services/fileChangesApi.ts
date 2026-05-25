import { api } from './api';
import { FileOperationType, ChangeStatusType } from '../components/RunPanel/constants/fileChangeTypes';

export interface FileChange {
  id: string;
  session_id: string;
  message_id: string;
  agent_id?: string;
  file_path: string;
  operation: FileOperationType;
  tool_call_id?: string;
  content_type: string;
  lines_added: number;
  lines_removed: number;
  status: ChangeStatusType;
  created_at: string;
}

export interface FileChangesSummary {
  total_changes: number;
  created_count: number;
  modified_count: number;
  deleted_count: number;
  total_lines_added: number;
  total_lines_removed: number;
}

export interface RewindRequest {
  session_id: string;
  from_message_id: string;
}

export interface DeleteMessagesRequest {
  session_id: string;
  from_message_id: string;
}

export interface RewindFileInfo {
  file_path: string;
  operation: string;
  lines_added: number;
  lines_removed: number;
}

export interface RecallPreviewFileInfo {
  file_path: string;
  original_operation: string;
  recall_action: string;
  lines_added: number;
  lines_removed: number;
}

export interface RewindResponse {
  files: RewindFileInfo[];
  failed_files: string[];
  total_reverted: number;
  total_failed: number;
  recalled_message_count: number;
  rewinded_token_delta: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface RevertRequest {
  session_id: string;
  message_id: string;
  file_paths?: string[];
}

export interface UpdateStatusRequest {
  change_id: string;
  status: 'accepted' | 'rejected';
}

export const fileChangesApi = {
  getSessionFileChanges: async (sessionId: string, options?: { limit?: number; message_ids?: string[]; diff_type?: string }) => {
    const params: Record<string, any> = { limit: options?.limit ?? 100 };
    if (options?.message_ids && options.message_ids.length > 0) {
      params.message_ids = options.message_ids.join(',');
    }
    if (options?.diff_type) {
      params.diff_type = options.diff_type;
    }
    const response = await api.get(`/file-changes/session/${sessionId}`, {
      params
    });
    return response;
  },

  getMessageFileContent: async (sessionId: string, messageId: string) => {
    const response = await api.get(`/file-changes/message-content/${sessionId}/${messageId}`);
    return response;
  },

  rewindMessages: async (request: RewindRequest) => {
    const response = await api.post('/file-changes/rewind', request);
    return response;
  },

  previewRewind: async (request: RewindRequest) => {
    const response = await api.post('/file-changes/rewind/preview', request);
    return response;
  },

  deleteMessages: async (request: DeleteMessagesRequest) => {
    const response = await api.post('/file-changes/delete-messages', request);
    return response;
  },

  getSessionFileChangeSummaries: async (sessionId: string) => {
    const response = await api.get(`/file-changes/summaries/${sessionId}`);
    return response;
  },

  revertFileChanges: async (request: RevertRequest) => {
    const response = await api.post('/file-changes/revert', request);
    return response;
  },

  updateChangeStatus: async (request: UpdateStatusRequest) => {
    const response = await api.post('/file-changes/update-status', request);
    return response;
  },

  getChangeDiff: async (changeId: string) => {
    const response = await api.get(`/file-changes/diff/${changeId}`);
    return response;
  },

  getSessionStats: async (sessionId: string) => {
    const response = await api.get(`/file-changes/stats/${sessionId}`);
    return response;
  },

  getFileDiffHunks: async (sessionId: string, filePath: string, status: string = 'pending') => {
    const response = await api.get(`/file-changes/file-diff/${sessionId}`, {
      params: { file_path: filePath, status }
    });
    return response;
  },
};
