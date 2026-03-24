/**
 * @file stores/runPanelStore.ts
 * @description 运行面板状态管理
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { runApi } from '../../../services/runApi';
import type {
  LLMMessage,
  DataBlock,
  CallRecord,
  ChildAgentOutput,
  FileTab,
  AgenticPanel,
  ExtendedRunSession,
  SessionMessage,
  CurrentProject,
  RecentProjectInfo,
} from '../types';

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

interface RunPanelState {
  sessions: ExtendedRunSession[];
  currentSessionId: string | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  isRunning: boolean;

  messages: LLMMessage[];
  streamingData: DataBlock[];
  inputText: string;
  isWaitingReply: boolean;
  currentMsgId: string;

  callRecords: CallRecord[];
  childAgentOutputs: ChildAgentOutput[];

  editorTabs: FileTab[];
  documentTabs: FileTab[];
  activeEditorTabId: string | null;
  activeDocumentTabId: string | null;

  agenticPanels: AgenticPanel[];
  activeAgenticTab: string | null;
  panelRatios: number[];
  isDragging: number | null;

  expandedReasoning: Set<string>;
  expandedToolCalls: Set<string>;
  streamingExpandedKeys: Set<string>;

  currentProject: CurrentProject | null;
  recentProjects: RecentProjectInfo[];
  projectLoading: boolean;

  canvasData: any | null;

  hoveredMessageId: string | null;

  setCurrentSessionId: (sessionId: string | null) => void;
  setSessions: (sessions: ExtendedRunSession[] | ((prev: ExtendedRunSession[]) => ExtendedRunSession[])) => void;
  setSearchQuery: (query: string) => void;
  startRunning: () => void;
  stopRunning: () => void;

  addMessage: (message: LLMMessage) => void;
  setMessages: (messages: LLMMessage[] | ((prev: LLMMessage[]) => LLMMessage[])) => void;
  clearMessages: () => void;
  setStreamingData: (data: DataBlock[] | ((prev: DataBlock[]) => DataBlock[])) => void;
  clearStreamingData: () => void;
  setInputText: (text: string) => void;
  setIsWaitingReply: (waiting: boolean) => void;
  setCurrentMsgId: (id: string) => void;

  addCallRecord: (record: CallRecord) => void;
  updateCallRecord: (id: string, updates: Partial<CallRecord>) => void;
  setCallRecords: (records: CallRecord[] | ((prev: CallRecord[]) => CallRecord[])) => void;
  clearCallRecords: () => void;

  addChildAgentOutput: (output: ChildAgentOutput) => void;
  updateChildAgentOutput: (id: string, updates: Partial<ChildAgentOutput>) => void;
  setChildAgentOutputs: (outputs: ChildAgentOutput[] | ((prev: ChildAgentOutput[]) => ChildAgentOutput[])) => void;
  clearChildAgentOutputs: () => void;

  addEditorTab: (tab: FileTab) => void;
  updateEditorTab: (id: string, updates: Partial<FileTab>) => void;
  closeEditorTab: (id: string) => void;
  setActiveEditorTabId: (id: string | null) => void;

  addDocumentTab: (tab: FileTab) => void;
  updateDocumentTab: (id: string, updates: Partial<FileTab>) => void;
  closeDocumentTab: (id: string) => void;
  setActiveDocumentTabId: (id: string | null) => void;

  openAgenticPanel: (type: string) => void;
  closeAgenticPanel: (id: string) => void;
  setActiveAgenticTab: (tab: string | null) => void;
  setPanelRatios: (ratios: number[]) => void;
  setIsDragging: (index: number | null) => void;

  toggleReasoningExpand: (key: string) => void;
  toggleToolCallsExpand: (key: string) => void;
  setStreamingExpandedKeys: (keys: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setExpandedReasoning: (keys: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setExpandedToolCalls: (keys: Set<string> | ((prev: Set<string>) => Set<string>)) => void;

  setCurrentProject: (project: CurrentProject | null) => void;
  setRecentProjects: (projects: RecentProjectInfo[]) => void;
  setProjectLoading: (loading: boolean) => void;

  setCanvasData: (data: any | null) => void;

  setHoveredMessageId: (id: string | null) => void;

  loadSessions: (agenticFlowId: string, runProjectId: string) => Promise<void>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
  createNewSession: (agenticFlowId: string, projectId: string) => string | null;
  deleteSession: (sessionId: string) => Promise<void>;
}

export const useRunPanelStore = create<RunPanelState>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      loading: false,
      error: null,
      searchQuery: '',
      isRunning: false,

      messages: [],
      streamingData: [],
      inputText: '',
      isWaitingReply: false,
      currentMsgId: '',

      callRecords: [],
      childAgentOutputs: [],

      editorTabs: [],
      documentTabs: [],
      activeEditorTabId: null,
      activeDocumentTabId: null,

      agenticPanels: [
        { id: 'editor', type: 'editor', title: '编辑器', isOpen: false },
        { id: 'terminal', type: 'terminal', title: '终端', isOpen: false },
        { id: 'browser', type: 'browser', title: '浏览器', isOpen: false },
        { id: 'document', type: 'document', title: '文档', isOpen: false },
        { id: 'changes', type: 'changes', title: '文档变更', isOpen: false },
      ],
      activeAgenticTab: null,
      panelRatios: [1, 4, 4, 1],
      isDragging: null,

      expandedReasoning: new Set<string>(),
      expandedToolCalls: new Set<string>(),
      streamingExpandedKeys: new Set<string>(),

      currentProject: null,
      recentProjects: [],
      projectLoading: false,

      canvasData: null,

      hoveredMessageId: null,

      setCurrentSessionId: (sessionId) => set({ currentSessionId: sessionId }),
      setSessions: (sessionsOrUpdater) => {
        if (typeof sessionsOrUpdater === 'function') {
          set((state) => ({ sessions: sessionsOrUpdater(state.sessions) }));
        } else {
          set({ sessions: sessionsOrUpdater });
        }
      },
      setSearchQuery: (query) => set({ searchQuery: query }),
      startRunning: () => set({ isRunning: true }),
      stopRunning: () => set({ isRunning: false }),

      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      setMessages: (messagesOrUpdater) => {
        if (typeof messagesOrUpdater === 'function') {
          set((state) => ({ messages: messagesOrUpdater(state.messages) }));
        } else {
          set({ messages: messagesOrUpdater });
        }
      },
      clearMessages: () => set({ messages: [] }),
      setStreamingData: (dataOrUpdater) => {
        if (typeof dataOrUpdater === 'function') {
          set((state) => ({ streamingData: dataOrUpdater(state.streamingData) }));
        } else {
          set({ streamingData: dataOrUpdater });
        }
      },
      clearStreamingData: () => set({ streamingData: [] }),
      setInputText: (text) => set({ inputText: text }),
      setIsWaitingReply: (waiting) => set({ isWaitingReply: waiting }),
      setCurrentMsgId: (id) => set({ currentMsgId: id }),

      addCallRecord: (record) => set((state) => ({ callRecords: [...state.callRecords, record] })),
      updateCallRecord: (id, updates) => set((state) => ({
        callRecords: state.callRecords.map((r) => (r.id === id ? { ...r, ...updates } : r)),
      })),
      setCallRecords: (recordsOrUpdater) => {
        if (typeof recordsOrUpdater === 'function') {
          set((state) => ({ callRecords: recordsOrUpdater(state.callRecords) }));
        } else {
          set({ callRecords: recordsOrUpdater });
        }
      },
      clearCallRecords: () => set({ callRecords: [] }),

      addChildAgentOutput: (output) => set((state) => ({ childAgentOutputs: [...state.childAgentOutputs, output] })),
      updateChildAgentOutput: (id, updates) => set((state) => ({
        childAgentOutputs: state.childAgentOutputs.map((o) => (o.id === id ? { ...o, ...updates } : o)),
      })),
      setChildAgentOutputs: (outputsOrUpdater) => {
        if (typeof outputsOrUpdater === 'function') {
          set((state) => ({ childAgentOutputs: outputsOrUpdater(state.childAgentOutputs) }));
        } else {
          set({ childAgentOutputs: outputsOrUpdater });
        }
      },
      clearChildAgentOutputs: () => set({ childAgentOutputs: [] }),

      addEditorTab: (tab) => set((state) => ({ editorTabs: [...state.editorTabs, tab] })),
      updateEditorTab: (id, updates) => set((state) => ({
        editorTabs: state.editorTabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      })),
      closeEditorTab: (id) => {
        const state = get();
        const tabIndex = state.editorTabs.findIndex((t) => t.id === id);
        const newTabs = state.editorTabs.filter((t) => t.id !== id);
        let newActiveId = state.activeEditorTabId;
        if (state.activeEditorTabId === id) {
          if (newTabs.length > 0) {
            const newIndex = Math.min(tabIndex, newTabs.length - 1);
            newActiveId = newTabs[newIndex].id;
          } else {
            newActiveId = null;
          }
        }
        set({ editorTabs: newTabs, activeEditorTabId: newActiveId });
      },
      setActiveEditorTabId: (id) => set({ activeEditorTabId: id }),

      addDocumentTab: (tab) => set((state) => ({ documentTabs: [...state.documentTabs, tab] })),
      updateDocumentTab: (id, updates) => set((state) => ({
        documentTabs: state.documentTabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      })),
      closeDocumentTab: (id) => {
        const state = get();
        const tabIndex = state.documentTabs.findIndex((t) => t.id === id);
        const newTabs = state.documentTabs.filter((t) => t.id !== id);
        let newActiveId = state.activeDocumentTabId;
        if (state.activeDocumentTabId === id) {
          if (newTabs.length > 0) {
            const newIndex = Math.min(tabIndex, newTabs.length - 1);
            newActiveId = newTabs[newIndex].id;
          } else {
            newActiveId = null;
          }
        }
        set({ documentTabs: newTabs, activeDocumentTabId: newActiveId });
      },
      setActiveDocumentTabId: (id) => set({ activeDocumentTabId: id }),

      openAgenticPanel: (type) => set((state) => {
        const newPanels = state.agenticPanels.map((p) =>
          p.type === type ? { ...p, isOpen: true } : p
        );
        return { agenticPanels: newPanels, activeAgenticTab: type };
      }),
      closeAgenticPanel: (id) => set((state) => {
        const panel = state.agenticPanels.find((p) => p.id === id);
        const newPanels = state.agenticPanels.map((p) =>
          p.id === id ? { ...p, isOpen: false } : p
        );
        let newActiveTab = state.activeAgenticTab;
        if (state.activeAgenticTab === panel?.type) {
          const remainingOpen = newPanels.filter((p) => p.isOpen);
          newActiveTab = remainingOpen.length > 0 ? remainingOpen[0].type : null;
        }
        return { agenticPanels: newPanels, activeAgenticTab: newActiveTab };
      }),
      setActiveAgenticTab: (tab) => set({ activeAgenticTab: tab }),
      setPanelRatios: (ratios) => set({ panelRatios: ratios }),
      setIsDragging: (index) => set({ isDragging: index }),

      toggleReasoningExpand: (key) => set((state) => {
        const newSet = new Set(state.expandedReasoning);
        if (newSet.has(key)) {
          newSet.delete(key);
        } else {
          newSet.add(key);
        }
        return { expandedReasoning: newSet };
      }),
      toggleToolCallsExpand: (key) => set((state) => {
        const newSet = new Set(state.expandedToolCalls);
        if (newSet.has(key)) {
          newSet.delete(key);
        } else {
          newSet.add(key);
        }
        return { expandedToolCalls: newSet };
      }),
      setStreamingExpandedKeys: (keysOrUpdater) => {
        if (typeof keysOrUpdater === 'function') {
          set((state) => ({ streamingExpandedKeys: keysOrUpdater(state.streamingExpandedKeys) }));
        } else {
          set({ streamingExpandedKeys: keysOrUpdater });
        }
      },
      setExpandedReasoning: (keysOrUpdater) => {
        if (typeof keysOrUpdater === 'function') {
          set((state) => ({ expandedReasoning: keysOrUpdater(state.expandedReasoning) }));
        } else {
          set({ expandedReasoning: keysOrUpdater });
        }
      },
      setExpandedToolCalls: (keysOrUpdater) => {
        if (typeof keysOrUpdater === 'function') {
          set((state) => ({ expandedToolCalls: keysOrUpdater(state.expandedToolCalls) }));
        } else {
          set({ expandedToolCalls: keysOrUpdater });
        }
      },

      setCurrentProject: (project) => set({ currentProject: project }),
      setRecentProjects: (projects) => set({ recentProjects: projects }),
      setProjectLoading: (loading) => set({ projectLoading: loading }),

      setCanvasData: (data) => set({ canvasData: data }),

      setHoveredMessageId: (id) => set({ hoveredMessageId: id }),

      loadSessions: async (agenticFlowId, runProjectId) => {
        set({ loading: true, error: null });
        try {
          const sessions = await runApi.getSessions({
            agentic_flow_id: agenticFlowId,
            run_project_id: runProjectId,
            limit: 50,
          });

          const currentSessions = get().sessions;

          const extendedSessions: ExtendedRunSession[] = sessions.map((s) => {
            const existingSession = currentSessions.find((cs) => cs.id === s.id);
            return {
              ...s,
              messages: existingSession?.messages || [],
              toolCalls: existingSession?.toolCalls || [],
              childAgentOutputs: existingSession?.childAgentOutputs || [],
            };
          });
          set({ sessions: extendedSessions });
        } catch (error: any) {
          set({ error: error.message || 'Failed to load sessions' });
        } finally {
          set({ loading: false });
        }
      },

      loadSessionMessages: async (sessionId) => {
        try {
          const messages = await runApi.getSessionMessages(sessionId);

          const formattedMessages: SessionMessage[] = messages.map((msg, index) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content || '',
            reasoning_content: msg.reasoning_content,
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
            sessions: state.sessions.map((s) =>
              s.id === sessionId ? { ...s, messages: formattedMessages } : s
            ),
          }));
        } catch (error: any) {
          console.error('Failed to load session messages:', error);
        }
      },

      createNewSession: (agenticFlowId, projectId) => {
        if (!agenticFlowId || !projectId) {
          return null;
        }

        const newSessionId = crypto.randomUUID();
        set({ currentSessionId: newSessionId });

        const newSession: ExtendedRunSession = {
          id: newSessionId,
          status: 'pending',
          name: `会话 ${get().sessions.length + 1}`,
          createdAt: new Date().toISOString(),
          messages: [],
        };

        set((state) => ({ sessions: [newSession, ...state.sessions] }));

        return newSessionId;
      },

      deleteSession: async (sessionId) => {
        await runApi.deleteSession(sessionId);
        const newSessions = get().sessions.filter((s) => s.id !== sessionId);
        set({ sessions: newSessions });

        if (get().currentSessionId === sessionId) {
          if (newSessions.length > 0) {
            set({ currentSessionId: newSessions[0].id });
          } else {
            set({ currentSessionId: null });
          }
        }
      },
    }),
    {
      name: 'run-panel-store',
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
      }),
    }
  )
);

export { generateId };
