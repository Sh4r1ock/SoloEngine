/**
 * @file runStore.ts
 * @description 运行状态管理 - 工作流运行状态管理模块
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 管理运行会话状态、执行日志等
 * - 管理运行状态、存储执行日志
 * 
 * 使用场景：
 * - 工作流运行功能
 */
import { create } from 'zustand';

export interface RunSession {
  id: string;
  status: string;
  input_message: string;
  output_message: string;
  error?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  token_usage?: Record<string, number>;
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

export interface ChildAgentOutput {
  id: string;
  name: string;
  output: string;
  status: 'running' | 'completed' | 'error';
  calls: ToolCallRecord[];
}

export interface ExtendedRunSession extends RunSession {
  agentId?: string;
  agentName?: string;
  messages?: any[];
  toolCalls?: ToolCallRecord[];
  childAgentOutputs?: ChildAgentOutput[];
  startTime?: number;
}

export type OperationPanelType = 'tools' | 'childAgents' | 'history' | null;

interface RunState {
  sessions: ExtendedRunSession[];
  currentSession: ExtendedRunSession | null;
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;
  messageFilter: string;
  toolFilter: string;
  searchQuery: string;
  isRunning: boolean;
  isPaused: boolean;
  toolCalls: ToolCallRecord[];
  childAgentOutputs: ChildAgentOutput[];
  sessionHistory: ExtendedRunSession[];
  activeOperationPanel: OperationPanelType;

  selectSession: (session: ExtendedRunSession | null) => void;
  addSession: (session: Partial<ExtendedRunSession>) => void;
  setActiveSession: (sessionId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setMessageFilter: (filter: string) => void;
  setToolFilter: (filter: string) => void;
  startRunning: () => void;
  stopRunning: () => void;
  pauseRunning: () => void;
  resumeRunning: () => void;
  addToolCall: (toolCall: ToolCallRecord) => void;
  updateToolCall: (id: string, updates: Partial<ToolCallRecord>) => void;
  clearToolCalls: () => void;
  addChildAgentOutput: (output: ChildAgentOutput) => void;
  updateChildAgentOutput: (id: string, updates: Partial<ChildAgentOutput>) => void;
  clearChildAgentOutputs: () => void;
  loadSessionHistory: (sessions: ExtendedRunSession[]) => void;
  addToSessionHistory: (session: ExtendedRunSession) => void;
  clearSessionHistory: () => void;
  setActiveOperationPanel: (panel: OperationPanelType) => void;
}

export const useRunStore = create<RunState>((set, get) => ({
  sessions: [],
  currentSession: null,
  activeSessionId: null,
  loading: false,
  error: null,
  messageFilter: 'all',
  toolFilter: 'all',
  searchQuery: '',
  isRunning: false,
  isPaused: false,
  toolCalls: [],
  childAgentOutputs: [],
  sessionHistory: [],
  activeOperationPanel: null,

  selectSession: (session: ExtendedRunSession | null) => {
    set({ currentSession: session });
  },

  addSession: (session: Partial<ExtendedRunSession>) => {
    const newSession: ExtendedRunSession = {
      id: session.id || `session-${Date.now()}`,
      status: session.status || 'running',
      input_message: '',
      output_message: '',
      started_at: new Date().toISOString(),
      agentId: session.agentId,
      agentName: session.agentName,
      messages: session.messages || [],
      toolCalls: session.toolCalls || [],
      childAgentOutputs: session.childAgentOutputs || [],
      startTime: session.startTime,
    };
    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: newSession.id,
    }));
  },

  setActiveSession: (sessionId: string | null) => {
    set({ activeSessionId: sessionId });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setMessageFilter: (filter: string) => {
    set({ messageFilter: filter });
  },

  setToolFilter: (filter: string) => {
    set({ toolFilter: filter });
  },

  startRunning: () => {
    set({ isRunning: true, isPaused: false });
  },

  stopRunning: () => {
    set({ isRunning: false, isPaused: false, activeSessionId: null });
  },

  pauseRunning: () => {
    set({ isPaused: true });
  },

  resumeRunning: () => {
    set({ isPaused: false });
  },

  addToolCall: (toolCall: ToolCallRecord) => {
    set((state) => ({
      toolCalls: [...state.toolCalls, toolCall],
    }));
  },

  updateToolCall: (id: string, updates: Partial<ToolCallRecord>) => {
    set((state) => ({
      toolCalls: state.toolCalls.map((tc) =>
        tc.id === id ? { ...tc, ...updates } : tc
      ),
    }));
  },

  clearToolCalls: () => {
    set({ toolCalls: [] });
  },

  addChildAgentOutput: (output: ChildAgentOutput) => {
    set((state) => ({
      childAgentOutputs: [...state.childAgentOutputs, output],
    }));
  },

  updateChildAgentOutput: (id: string, updates: Partial<ChildAgentOutput>) => {
    set((state) => ({
      childAgentOutputs: state.childAgentOutputs.map((cao) =>
        cao.id === id ? { ...cao, ...updates } : cao
      ),
    }));
  },

  clearChildAgentOutputs: () => {
    set({ childAgentOutputs: [] });
  },

  loadSessionHistory: (sessions: ExtendedRunSession[]) => {
    set({ sessionHistory: sessions });
  },

  addToSessionHistory: (session: ExtendedRunSession) => {
    set((state) => ({
      sessionHistory: [session, ...state.sessionHistory],
    }));
  },

  clearSessionHistory: () => {
    set({ sessionHistory: [] });
  },

  setActiveOperationPanel: (panel: OperationPanelType) => {
    set({ activeOperationPanel: panel });
  },
}));