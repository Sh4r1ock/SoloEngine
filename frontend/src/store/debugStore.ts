/**
 * @file debugStore.ts
 * @description 调试状态管理 - 工作流调试状态管理模块
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 管理调试会话状态、执行日志、变量状态等
 * - 管理调试状态、存储执行日志、管理变量快照
 * 
 * 使用场景：
 * - 工作流调试功能
 * - 断点管理和单步执行
 * 
 * 注意事项：
 * - 支持多会话管理
 * - 支持变量监控
 */
import { create } from 'zustand';
import { debugApi, DebugSession, DebugStep, Breakpoint } from '../services/debugApi';

export interface ExtendedDebugSession extends DebugSession {
  agentId?: string;
  agentName?: string;
  messages?: any[];
  toolCalls?: any[];
  startTime?: number;
}

interface DebugState {
  sessions: ExtendedDebugSession[];
  currentSession: ExtendedDebugSession | null;
  activeSessionId: string | null;
  steps: DebugStep[];
  breakpoints: Breakpoint[];
  variables: Record<string, any>;
  loading: boolean;
  error: string | null;
  currentAgentId: string | null;
  currentAgentName: string | null;
  currentThought: string | null;
  currentAction: string | null;
  isDebugging: boolean;
  isPaused: boolean;
  messageFilter: string;
  toolFilter: string;
  searchQuery: string;

  loadSessions: () => Promise<void>;
  createSession: (flowId: string) => Promise<ExtendedDebugSession | null>;
  sendMessage: (sessionId: string, message: string) => Promise<void>;
  setBreakpoint: (sessionId: string, nodeId: string, enabled: boolean) => Promise<void>;
  stepExecution: (sessionId: string, stepType: 'over' | 'into' | 'out') => Promise<void>;
  continueExecution: (sessionId: string) => Promise<void>;
  getVariables: (sessionId: string) => Promise<void>;
  selectSession: (session: ExtendedDebugSession | null) => void;
  addBreakpoint: (params: { nodeId: string; stepType: string; enabled: boolean }) => void;
  removeBreakpoint: (id: string) => void;
  toggleBreakpoint: (id: string) => void;
  startDebugging: () => void;
  stopDebugging: () => void;
  pauseDebugging: () => void;
  resumeDebugging: () => void;
  stepOver: () => void;
  addSession: (session: Partial<ExtendedDebugSession>) => void;
  setActiveSession: (sessionId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setMessageFilter: (filter: string) => void;
  setToolFilter: (filter: string) => void;
}

export const useDebugStore = create<DebugState>((set, get) => ({
  sessions: [],
  currentSession: null,
  activeSessionId: null,
  steps: [],
  breakpoints: [],
  variables: {},
  loading: false,
  error: null,
  currentAgentId: null,
  currentAgentName: null,
  currentThought: null,
  currentAction: null,
  isDebugging: false,
  isPaused: false,
  messageFilter: 'all',
  toolFilter: 'all',
  searchQuery: '',

  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const sessions = await debugApi.getSessions();
      set({ sessions, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  createSession: async (flowId: string) => {
    set({ loading: true, error: null });
    try {
      const session = await debugApi.getSession(flowId);
      set((state) => ({
        sessions: [...state.sessions, session],
        currentSession: session,
        loading: false,
      }));
      return session;
    } catch (error) {
      set({ error: String(error), loading: false });
      return null;
    }
  },

  sendMessage: async (sessionId: string, message: string) => {
    try {
      await debugApi.stepControl(sessionId, message);
    } catch (error) {
      set({ error: String(error) });
    }
  },

  setBreakpoint: async (sessionId: string, nodeId: string, enabled: boolean) => {
    try {
      const bp = await debugApi.setBreakpoint({
        nodeId: nodeId,
        stepType: 'before_thought',
        enabled: enabled,
      });
      set((state) => ({
        breakpoints: enabled
          ? [...state.breakpoints, { id: bp.id, node_id: nodeId, step_type: bp.step_type, enabled: true }]
          : state.breakpoints.filter((b) => b.node_id !== nodeId),
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  stepExecution: async (sessionId: string, stepType: 'over' | 'into' | 'out') => {
    try {
      await debugApi.stepControl(sessionId, stepType);
    } catch (error) {
      set({ error: String(error) });
    }
  },

  continueExecution: async (sessionId: string) => {
    try {
      await debugApi.resumeDebugSession(sessionId);
    } catch (error) {
      set({ error: String(error) });
    }
  },

  getVariables: async (sessionId: string) => {
    try {
      const variables = await debugApi.getVariables(sessionId);
      set({ variables });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  selectSession: (session: ExtendedDebugSession | null) => {
    set({ currentSession: session, steps: [], variables: {} });
  },

  addBreakpoint: (params: { nodeId: string; stepType: string; enabled: boolean }) => {
    const newBp: Breakpoint = {
      id: `bp-${Date.now()}`,
      node_id: params.nodeId,
      step_type: params.stepType,
      enabled: params.enabled,
    };
    set((state) => ({
      breakpoints: [...state.breakpoints, newBp],
    }));
  },

  removeBreakpoint: (id: string) => {
    set((state) => ({
      breakpoints: state.breakpoints.filter((b) => b.id !== id),
    }));
  },

  toggleBreakpoint: (id: string) => {
    set((state) => ({
      breakpoints: state.breakpoints.map((b) =>
        b.id === id ? { ...b, enabled: !b.enabled } : b
      ),
    }));
  },

  startDebugging: () => {
    set({ isDebugging: true, isPaused: false });
  },

  stopDebugging: () => {
    set({ isDebugging: false, isPaused: false, activeSessionId: null });
  },

  pauseDebugging: () => {
    set({ isPaused: true });
  },

  resumeDebugging: () => {
    set({ isPaused: false });
  },

  stepOver: () => {
    // Step over logic handled by API call
  },

  addSession: (session: Partial<ExtendedDebugSession>) => {
    const newSession: ExtendedDebugSession = {
      id: session.id || `session-${Date.now()}`,
      status: session.status || 'running',
      input_message: '',
      output_message: '',
      started_at: new Date().toISOString(),
      agentId: session.agentId,
      agentName: session.agentName,
      messages: session.messages || [],
      toolCalls: session.toolCalls || [],
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
}));
