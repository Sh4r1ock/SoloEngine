/**
 * @file types/index.ts
 * @description 运行面板类型定义
 */

export type DataBlockType = 'content' | 'reasoning_content' | 'tool_calls';

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
  result?: string;
}

export interface DataBlock {
  type: DataBlockType;
  content?: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  agent_id?: string;
  agent_name?: string;
  agent_level?: number;
  // 新增：存储展开状态
  _isExpanding?: boolean;
  // 新增：用户是否手动操作过
  _userToggled?: boolean;
}

export interface LLMMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning_content?: string;
  data?: DataBlock[];
  timestamp: string;
  tokens?: number;
  agent_id?: string;
  agent_name?: string;
  parent_agent_id?: string;
  status?: 'completed' | 'error' | 'stopped' | 'running';
}

export type CallType = 'tool' | 'skill' | 'mcp' | 'subagent';
export type CallStatus = 'pending' | 'running' | 'success' | 'error';

export interface CallRecord {
  id: string;
  type: CallType;
  name: string;
  status: CallStatus;
  duration?: number;
  arguments?: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: string;
  startTime?: number;
  endTime?: number;
  output?: string;
  callId?: string;
  metadata?: Record<string, any>;
  childCalls?: CallRecord[];
}

export interface SubagentOutput {
  id: string;
  name: string;
  output: string;
  status: string;
  calls: CallRecord[];
  startTime?: number;
  endTime?: number;
  duration?: number;
  input?: string;
  agentType?: string;
}

export interface FileTab {
  id: string;
  name: string;
  path: string;
  content: string;
  isModified: boolean;
  isLoading: boolean;
  isBinary: boolean;
  type: 'editor' | 'document';
}

export type PanelType = 'editor' | 'terminal' | 'browser' | 'document' | 'changes';

export interface AgenticPanel {
  id: string;
  type: PanelType;
  title: string;
  isOpen: boolean;
  content?: string;
}

export interface AgenticStep {
  id: string;
  type: 'thinking' | 'action' | 'observation' | 'result';
  content: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  timestamp: string;
}

export interface RunSession {
  id: string;
  status: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
  duration_ms?: number;
  token_usage?: Record<string, number>;
}

export interface ExtendedRunSession extends RunSession {
  name?: string;
  createdAt?: string;
  agentId?: string;
  agentName?: string;
  messages?: SessionMessage[];
  toolCalls?: ToolCallRecord[];
  subagentOutputs?: SubagentOutput[];
  startTime?: number;
  firstAssistantContent?: string;
}

export interface ToolCallRecord {
  id: string;
  type: 'tool' | 'skill' | 'mcp';
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  arguments?: Record<string, any>;
  result?: any;
  error?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface SessionMessage {
  id: string;
  role: string;
  content?: string;
  reasoning_content?: string;
  data: DataBlock[];
  message_index: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  created_at?: string;
  timestamp?: string;
  tokens?: number;
}

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: string;
}

export interface CurrentProject {
  id: string;
  name: string;
  folder_path: string;
}

export interface RecentProjectInfo {
  id: string;
  project_id: string;
  project_name: string;
  folder_path: string;
  accessed_at: string;
}

export const TOOL_NAME_MAP: Record<string, string> = {
  'Read': '读取文件',
  'Write': '写入文件',
  'DeleteFile': '删除文件',
  'LS': '列出目录',
  'SearchReplace': '搜索替换',
  'Grep': '正则搜索',
  'Glob': '文件匹配',
  'SearchCodebase': '搜索代码库',
  'RunCommand': '执行命令',
  'CheckCommandStatus': '检查命令状态',
  'StopCommand': '停止命令',
  'GetDiagnostics': '获取诊断',
  'WebFetch': '获取网页',
  'WebSearch': '网络搜索',
  'Skill': '技能',
  'Task': '任务',
  'TodoWrite': '待办事项',
  'AskUserQuestion': '询问用户',
  'OpenPreview': '打开预览',
  'mcp_list_tools': 'MCP工具列表',
  'mcp_call_tool': 'MCP调用工具',
};

export type FileCategory = 
  | 'code' 
  | 'markdown' 
  | 'office'
  | 'pdf' 
  | 'image' 
  | 'text' 
  | 'binary' 
  | 'unsupported';

export interface FileTypeInfo {
  category: FileCategory;
  language?: string;
  editable: boolean;
  viewer: string;
  requiresOnlyOffice?: boolean;
  fallbackViewer?: string;
}

export interface EditorInstance {
  instanceId: string;
  viewerName: string;
  category: FileCategory;
  tabId: string;
  createdAt: number;
}

export type EditorStatus = 'unloaded' | 'loading' | 'loaded';

export interface EditorRegistryEntry {
  status: EditorStatus;
  refCount: number;
  instanceIds: Set<string>;
}
