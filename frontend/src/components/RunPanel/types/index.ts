/**
 * @file types/index.ts
 * @description 运行面板类型定义
 */

import { FileOperationType, FileContentTypeType } from '../constants/fileChangeTypes';

export type DataBlockType = 'content' | 'reasoning_content' | 'reasoning' | 'tool_calls' | 'tool_call' | 'file_changes';

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
  result?: string;
}

export interface FileChangeInfo {
  file_path: string;
  operation: FileOperationType;
  content_type: FileContentTypeType;
  id?: string;
  diff?: {
    lines_added: number;
    lines_removed: number;
  };
  tool_call_id?: string;
  status?: string;
  _preview?: boolean;
}

/** 后端聚合的 5 字段 token 统计（后端聚合改造：前端只显示，不再求和）。
 *  后端 get_session_messages 返回的 token_usage 与本类型逐字段一致；
 *  流式 agent_token_usage 推送的 agent_usage 经 updateAgentTokens 映射后写入块级/消息级。 */
export interface TokenTotals {
  system_prompt: number;
  user_prompt: number;
  assistant_prompt: number;
  completion: number;
  total: number;
}

export interface DataBlock {
  id?: string;
  type: DataBlockType;
  content?: string;
  reasoning_content?: string;
  text?: string;
  tool_calls?: ToolCall[];
  file_changes?: FileChangeInfo[];
  agent_id?: string;
  agent_name?: string;
  agent_level?: number;
  agent_tokens?: number;
  agent_prompt_tokens?: number;
  agent_completion_tokens?: number;
  /** agent 级 token_usage_history（subagent 组头/压缩气泡 hover 详情数据源，
   *  流式由 updateAgentTokens 注入、回显由 build_flattened_blocks 注入，两端同构） */
  agent_token_history?: any[];
  /** 块级本阶段聚合（后端聚合改造 4.1-1，压缩气泡 hover 用；回显由
   *  build_flattened_blocks 注入 agent_token_totals、流式由 updateAgentTokens 写入） */
  agent_token_totals?: TokenTotals;
  /** 组级整轮累计（后端聚合改造：subagent 组头回显用。该 subagent 本次 task 调用
   *  下全部消息 history 求和，与流式 agentUsageMap[agent_id] 整轮累计同构；
   *  mainagent 不注入，组头走消息级 token_usage 聚合） */
  group_agent_tokens?: number;
  group_agent_totals?: TokenTotals;
  group_agent_history?: any[];
  /** 流式块实例归属键（〇·3 并发方案 4.1-2）：流式由 processStreamChunk 注入、
   *  回显由 build_flattened_blocks 按消息 agent 归属注入——并发栈/块级 token
   *  匹配依据（同一 agent 多实例时块级 token 不混写） */
  execution_key?: string;
  name?: string;
  arguments?: string;
  _isExpanding?: boolean;
  _userToggled?: boolean;
  parent_message_id?: string;
  /** 压缩摘要块标记：嵌套在 subagent 层级内的压缩块，前端渲染为折叠气泡 */
  _is_compaction?: boolean;
  /** 流式 token 阶段完成标记（问题 1 修复）：阶段切换时锁定，保持块级阶段值 */
  _stageDone?: boolean;
}

export interface LLMMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning_content?: string;
  data?: DataBlock[];
  timestamp: string;
  tokens?: number;
  token_usage_history?: TokenUsageHistoryEntry[];
  /** 消息级聚合（后端聚合改造 4.1-3，消息头 hover 用；回显后端 token_usage 映射而来） */
  token_totals?: TokenTotals;
  agent_id?: string;
  agent_name?: string;
  parent_agent_id?: string;
  parent_message_id?: string;
  status?: 'completed' | 'error' | 'stopped' | 'running' | 'compacted' | 'stop';
  isCompaction?: boolean;
}

export interface SystemMessage {
  id: string;
  role: 'error';
  error: string;
  timestamp: string;
}

export type Message = LLMMessage | SystemMessage;

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
  key?: string;
  name: string;
  title?: string;
  path: string;
  content: string;
  originalContent?: string;
  language?: string;
  isModified: boolean;
  isLoading: boolean;
  isBinary: boolean;
  hasExternalChange: boolean;
  type: 'editor' | 'document' | 'markdown';
  fileSize?: number;
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
  fileChangesMap?: { [messageId: string]: FileChangeInfo[] };
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

export interface TokenUsageHistoryEntry {
  iteration: number;
  timestamp: string;
  system_prompt_token: number;
  user_prompt_token: number;
  assistant_prompt_token: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  duration_ms: number;
  finish_reason: string;
}

export interface SessionMessage {
  id: string;
  role: string;
  content?: string;
  reasoning_content?: string;
  status?: 'completed' | 'error' | 'stopped' | 'running';
  error?: string;
  data: DataBlock[];
  message_index: number;
  parent_message_id?: string;
  token_usage_history?: TokenUsageHistoryEntry[];
  /** 消息级聚合（后端聚合改造 4.1-5）：后端 get_session_messages 返回的
   *  token_usage 映射为 token_totals（4.6/4.7 透传数据源） */
  token_totals?: TokenTotals;
  created_at?: string;
  timestamp?: string;
  tokens?: number;
  agent_id?: string;
  agent_name?: string;
  parent_agent_id?: string;
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
  accessed_at?: string;
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

export interface MessageFileChangesMap {
  [messageId: string]: FileChangeInfo[];
}

export interface FileSystemChange {
  file_path: string;
  operation: 'created' | 'deleted' | 'modified' | 'moved';
  is_directory: boolean;
  dest_path?: string;
}
