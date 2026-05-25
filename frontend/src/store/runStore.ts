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
import { runApi, Session, SessionMessage } from '../services/runApi';
import type {
  RunSession,
  ToolCallRecord,
  ExtendedRunSession,
} from '../components/RunPanel/types';

export type { RunSession, ToolCallRecord, ExtendedRunSession };

export interface SubagentOutput {
  id: string;
  name: string;
  output: string;
  status: 'running' | 'completed' | 'error';
  calls: ToolCallRecord[];
}

export type OperationPanelType = 'tools' | 'subagents' | 'history' | null;

interface RunState {
  sessions: ExtendedRunSession[];
  currentSession: ExtendedRunSession | null;
  currentSessionId: string | null;
  loading: boolean;
  error: string | null;
  messageFilter: string;
  toolFilter: string;
  searchQuery: string;
  isRunning: boolean;
  isPaused: boolean;
  toolCalls: ToolCallRecord[];
  subagentOutputs: SubagentOutput[];
  sessionHistory: ExtendedRunSession[];
  activeOperationPanel: OperationPanelType;

  selectSession: (session: ExtendedRunSession | null) => void;
  setCurrentSessionId: (sessionId: string | null) => void;
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
  addSubagentOutput: (output: SubagentOutput) => void;
  updateSubagentOutput: (id: string, updates: Partial<SubagentOutput>) => void;
  clearSubagentOutputs: () => void;
  loadSessionHistory: (sessions: ExtendedRunSession[]) => void;
  addToSessionHistory: (session: ExtendedRunSession) => void;
  clearSessionHistory: () => void;
  setActiveOperationPanel: (panel: OperationPanelType) => void;
  
  loadSessions: (agenticFlowId: string, runProjectId: string) => Promise<void>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
  updateCurrentSession: (updates: Partial<ExtendedRunSession>) => void;
  setSessions: (sessionsOrUpdater: ExtendedRunSession[] | ((prev: ExtendedRunSession[]) => ExtendedRunSession[])) => void;
}

export const useRunStore = create<RunState>()(
  (set, get) => ({
      sessions: [],
      currentSession: null,
      currentSessionId: null,
      loading: false,
      error: null,
      messageFilter: 'all',
      toolFilter: 'all',
      searchQuery: '',
      isRunning: false,
      isPaused: false,
      toolCalls: [],
      subagentOutputs: [],
      sessionHistory: [],
      activeOperationPanel: null,

      selectSession: (session: ExtendedRunSession | null) => {
        set({ currentSession: session, currentSessionId: session?.id || null });
        if (session) {
          get().loadSessionMessages(session.id);
        }
      },

      setCurrentSessionId: (sessionId: string | null) => {
        set({ currentSessionId: sessionId });
        if (sessionId) {
          const session = get().sessions.find(s => s.id === sessionId);
          if (session) {
            set({ currentSession: session });
          }
        } else {
          set({ currentSession: null });
        }
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
        set({ isRunning: false, isPaused: false });
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

      addSubagentOutput: (output: SubagentOutput) => {
        set((state) => ({
          subagentOutputs: [...state.subagentOutputs, output],
        }));
      },

      updateSubagentOutput: (id: string, updates: Partial<SubagentOutput>) => {
        set((state) => ({
          subagentOutputs: state.subagentOutputs.map((so) =>
            so.id === id ? { ...so, ...updates } : so
          ),
        }));
      },

      clearSubagentOutputs: () => {
        set({ subagentOutputs: [] });
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

      loadSessions: async (agenticFlowId: string, runProjectId: string) => {
        set({ loading: true, error: null });
        try {
          const sessions = await runApi.getSessions({ 
            agentic_flow_id: agenticFlowId,
            run_project_id: runProjectId,
            limit: 50 
          });
          
          const currentSessions = get().sessions;
          
          const extendedSessions: ExtendedRunSession[] = sessions.map(s => {
            const existingSession = currentSessions.find(cs => cs.id === s.id);
            return {
              ...s,
              messages: existingSession?.messages || [],
              toolCalls: existingSession?.toolCalls || [],
              subagentOutputs: existingSession?.subagentOutputs || [],
            };
          });
          set({ sessions: extendedSessions, sessionHistory: extendedSessions });
        } catch (error: any) {
          set({ error: error.message || 'Failed to load sessions' });
        } finally {
          set({ loading: false });
        }
      },

      loadSessionMessages: async (sessionId: string) => {
        try {
          const messages = await runApi.getSessionMessages(sessionId);
          
          const formattedMessages: SessionMessage[] = messages.map((msg, index) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content || '',
            reasoning_content: msg.reasoning_content,
            status: msg.status,
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
          
          set((state) => ({
            sessions: state.sessions.map(s =>
              s.id === sessionId ? { ...s, messages: formattedMessages } : s
            ),
            currentSession: state.currentSession?.id === sessionId
              ? { ...state.currentSession, messages: formattedMessages }
              : state.currentSession,
          }));
        } catch (error: any) {
          console.error('Failed to load session messages:', error);
        }
      },

      updateCurrentSession: (updates: Partial<ExtendedRunSession>) => {
        set((state) => ({
          currentSession: state.currentSession
            ? { ...state.currentSession, ...updates }
            : null,
        }));
      },

      setSessions: (sessionsOrUpdater: ExtendedRunSession[] | ((prev: ExtendedRunSession[]) => ExtendedRunSession[])) => {
        if (typeof sessionsOrUpdater === 'function') {
          set((state) => ({ sessions: sessionsOrUpdater(state.sessions) }));
        } else {
          set({ sessions: sessionsOrUpdater });
        }
      },
    }),
);
