/**
 * @file stores/runPanelStore.ts
 * @description 运行面板状态管理
 */

import { create } from 'zustand';
import { runApi } from '../../../services/runApi';
import { runProjectApi } from '../../../services/runProjectApi';
import type {
  LLMMessage,
  DataBlock,
  CallRecord,
  SubagentOutput,
  FileTab,
  AgenticPanel,
  ExtendedRunSession,
  CurrentProject,
  RecentProjectInfo,
  MessageFileChangesMap,
  FileSystemChange,
} from '../types';

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

function normalizeFilePath(p: string): string {
  return p.replace(/\\/g, '/');
}

const _lastExternalChangeTime: Record<string, number> = {};

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
  subagentOutputs: SubagentOutput[];

  editorTabs: FileTab[];
  documentTabs: FileTab[];
  activeEditorTabId: string | null;
  activeDocumentTabId: string | null;

  agenticPanels: AgenticPanel[];
  activeAgenticTab: string | null;
  panelRatios: number[];
  isDragging: number | null;

  currentProject: CurrentProject | null;
  recentProjects: RecentProjectInfo[];
  projectLoading: boolean;

  canvasData: any | null;

  hoveredMessageId: string | null;

  expandedReasoning: string[];
  expandedToolCalls: string[];
  streamingExpandedKeys: string[];

  recallingMessageId: string | null;
  recallPreviewFiles: Record<string, Array<{ file_path: string; original_operation: string; recall_action: string; lines_added: number; lines_removed: number }>>;
  recallPreviewMessageId: string | null;
  fileChangeRefreshKey: number;
  fileChangesMap: MessageFileChangesMap;
  fileChangesLoaded: boolean;
  activeChangesMessageId: string | null;

  expandedBlockKeys: Record<string, boolean>;
  toggleBlockExpand: (blockKey: string, currentIsExpanding: boolean) => void;

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

  addSubagentOutput: (output: SubagentOutput) => void;
  updateSubagentOutput: (id: string, updates: Partial<SubagentOutput>) => void;
  setSubagentOutputs: (outputs: SubagentOutput[] | ((prev: SubagentOutput[]) => SubagentOutput[])) => void;
  clearSubagentOutputs: () => void;

  addEditorTab: (tab: FileTab) => void;
  updateEditorTab: (id: string, updates: Partial<FileTab>) => void;
  closeEditorTab: (id: string) => void;
  setActiveEditorTabId: (id: string | null) => void;

  addDocumentTab: (tab: FileTab) => void;
  updateDocumentTab: (id: string, updates: Partial<FileTab>) => void;
  closeDocumentTab: (id: string) => void;
  setActiveDocumentTabId: (id: string | null) => void;

  openOrNavigateFile: (params: { filePath: string; fileName: string; isCode: boolean; isBinary: boolean; projectFolderPath: string | null }) => { tab: FileTab; existed: boolean };

  openAgenticPanel: (type: string) => void;
  closeAgenticPanel: (id: string) => void;
  setActiveAgenticTab: (tab: string | null) => void;
  setPanelRatios: (ratios: number[]) => void;
  setIsDragging: (index: number | null) => void;

  setCurrentProject: (project: CurrentProject | null) => void;
  setRecentProjects: (projects: RecentProjectInfo[]) => void;
  setProjectLoading: (loading: boolean) => void;

  setCanvasData: (data: any | null) => void;

  setHoveredMessageId: (id: string | null) => void;

  setExpandedReasoning: (keys: string[]) => void;
  setExpandedToolCalls: (keys: string[]) => void;
  setStreamingExpandedKeys: (keys: string[]) => void;

  setRecallingMessageId: (messageId: string | null) => void;
  setRecallPreviewFiles: (messageId: string, files: Array<{ file_path: string; original_operation: string; recall_action: string; lines_added: number; lines_removed: number }>) => void;
  clearRecallPreview: () => void;
  incrementFileChangeRefreshKey: () => void;
  setFileChangesMap: (map: MessageFileChangesMap | ((prev: MessageFileChangesMap) => MessageFileChangesMap)) => void;
  setActiveChangesMessageId: (messageId: string | null) => void;

  createNewSession: (agenticFlowId: string | null, projectId: string | null) => string | null;
  deleteSession: (sessionId: string, agenticFlowId?: string | null, projectId?: string | null) => Promise<boolean>;
  loadSessionsForProject: (agenticFlowId: string, projectId: string) => Promise<void>;

  handleExternalFileChanges: (changes: FileSystemChange[]) => void;
  resolveExternalChange: (tabId: string) => Promise<void>;
}

export const useRunPanelStore = create<RunPanelState>()(
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
      subagentOutputs: [],

      editorTabs: [],
      documentTabs: [],
      activeEditorTabId: null,
      activeDocumentTabId: null,

      agenticPanels: [
        { id: 'editor', type: 'editor', title: '编辑器', isOpen: false },
        { id: 'terminal', type: 'terminal', title: '终端', isOpen: false },
        { id: 'browser', type: 'browser', title: '浏览器', isOpen: false },
        { id: 'document', type: 'document', title: '文档', isOpen: false },
        { id: 'changes', type: 'changes', title: '文件变更', isOpen: false },
      ],
      activeAgenticTab: null,
      panelRatios: [1, 4, 4, 1],
      isDragging: null,

      currentProject: null,
      recentProjects: [],
      projectLoading: false,

      canvasData: null,

      hoveredMessageId: null,

      expandedReasoning: [],
      expandedToolCalls: [],
      streamingExpandedKeys: [],

      recallingMessageId: null,
      recallPreviewFiles: {},
      recallPreviewMessageId: null,
      fileChangeRefreshKey: 0,
      fileChangesMap: {},
      fileChangesLoaded: false,
      activeChangesMessageId: null,

      expandedBlockKeys: {},
      toggleBlockExpand: (blockKey: string, currentIsExpanding: boolean) => {
        set((state) => ({
          expandedBlockKeys: {
            ...state.expandedBlockKeys,
            [blockKey]: !currentIsExpanding,
          },
        }));
      },

      setCurrentSessionId: (sessionId) => set({ currentSessionId: sessionId }),
      setSessions: (sessionsOrUpdater) => {
        if (typeof sessionsOrUpdater === 'function') {
          set((state) => ({ sessions: sessionsOrUpdater(state.sessions) }));
        } else {
          set({ sessions: sessionsOrUpdater });
        }
      },
      setSearchQuery: (query) => set({ searchQuery: query }),
      startRunning: () => set((state) => {
        if (state.isRunning) return state;
        return { isRunning: true };
      }),
      stopRunning: () => set((state) => {
        if (!state.isRunning && !state.isWaitingReply) return state;
        return { isRunning: false, isWaitingReply: false };
      }),

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
          set((state) => {
            const newData = dataOrUpdater(state.streamingData);
            if (newData === state.streamingData) return state;
            return { streamingData: newData };
          });
        } else {
          set((state) => {
            if (dataOrUpdater === state.streamingData) return state;
            return { streamingData: dataOrUpdater };
          });
        }
      },
      clearStreamingData: () => set({ streamingData: [] }),
      setInputText: (text) => set({ inputText: text }),
      setIsWaitingReply: (waiting) => set((state) => {
        if (state.isWaitingReply === waiting) return state;
        return { isWaitingReply: waiting };
      }),
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

      addSubagentOutput: (output) => set((state) => ({ subagentOutputs: [...state.subagentOutputs, output] })),
      updateSubagentOutput: (id, updates) => set((state) => ({
        subagentOutputs: state.subagentOutputs.map((o) => (o.id === id ? { ...o, ...updates } : o)),
      })),
      setSubagentOutputs: (outputsOrUpdater) => {
        if (typeof outputsOrUpdater === 'function') {
          set((state) => ({ subagentOutputs: outputsOrUpdater(state.subagentOutputs) }));
        } else {
          set({ subagentOutputs: outputsOrUpdater });
        }
      },
      clearSubagentOutputs: () => set({ subagentOutputs: [] }),

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

      openOrNavigateFile: ({ filePath, fileName, isCode, isBinary }) => {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const tabId = `tab_${normalizedPath}`;
        const state = get();
        const panelType = isCode ? 'editor' : 'document';
        const tabs = isCode ? state.editorTabs : state.documentTabs;
        
        const existingTab = tabs.find(t => t.id === tabId);
        
        if (existingTab) {
          const newPanels = state.agenticPanels.map(p =>
            p.type === panelType ? { ...p, isOpen: true } : p
          );
          isCode
            ? set({ activeEditorTabId: tabId, agenticPanels: newPanels, activeAgenticTab: panelType })
            : set({ activeDocumentTabId: tabId, agenticPanels: newPanels, activeAgenticTab: panelType });
          return { tab: existingTab, existed: true };
        }
        
        const newTab: FileTab = {
          id: tabId,
          name: fileName,
          path: normalizedPath,
          content: '',
          isModified: false,
          isLoading: true,
          isBinary,
          hasExternalChange: false,
          type: isCode ? 'editor' : 'document',
        };
        
        const newPanels = state.agenticPanels.map(p =>
          p.type === panelType ? { ...p, isOpen: true } : p
        );
        
        isCode
          ? set({
              editorTabs: [...state.editorTabs, newTab],
              activeEditorTabId: tabId,
              agenticPanels: newPanels,
              activeAgenticTab: panelType,
            })
          : set({
              documentTabs: [...state.documentTabs, newTab],
              activeDocumentTabId: tabId,
              agenticPanels: newPanels,
              activeAgenticTab: panelType,
            });
        
        return { tab: newTab, existed: false };
      },

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

      setCurrentProject: (project) => set({ currentProject: project }),
      setRecentProjects: (projects) => set({ recentProjects: projects }),
      setProjectLoading: (loading) => set({ projectLoading: loading }),

      setCanvasData: (data) => set({ canvasData: data }),

      setHoveredMessageId: (id) => set({ hoveredMessageId: id }),

      setExpandedReasoning: (keys) => set({ expandedReasoning: keys }),
      setExpandedToolCalls: (keys) => set({ expandedToolCalls: keys }),
      setStreamingExpandedKeys: (keys) => set({ streamingExpandedKeys: keys }),

      setRecallingMessageId: (messageId) => set({ recallingMessageId: messageId }),

      setRecallPreviewFiles: (messageId, files) => set((state) => ({
        recallPreviewFiles: { ...state.recallPreviewFiles, [messageId]: files },
        recallPreviewMessageId: messageId,
      })),

      clearRecallPreview: () => set({ recallPreviewMessageId: null }),

      incrementFileChangeRefreshKey: () => set((state) => ({
        fileChangeRefreshKey: state.fileChangeRefreshKey + 1,
      })),

      setFileChangesMap: (mapOrUpdater) => {
        if (typeof mapOrUpdater === 'function') {
          set((state) => ({ fileChangesMap: mapOrUpdater(state.fileChangesMap) }));
        } else {
          set({ fileChangesMap: mapOrUpdater });
        }
      },

      setActiveChangesMessageId: (messageId) => set({ activeChangesMessageId: messageId }),

      createNewSession: (agenticFlowId, projectId) => {
        if (!agenticFlowId || !projectId) {
          return null;
        }
        const newSessionId = crypto.randomUUID();
        set({
          currentSessionId: newSessionId,
          messages: [],
          fileChangesLoaded: false,
          callRecords: [],
        });
        return newSessionId;
      },

      deleteSession: async (sessionId, agenticFlowId, projectId) => {
        try {
          await runApi.deleteSession(sessionId);
          const state = get();
          const newSessions = state.sessions.filter(s => s.id !== sessionId);
          let updates: Partial<RunPanelState> = { sessions: newSessions };

          if (state.currentSessionId === sessionId) {
            if (newSessions.length > 0) {
              updates.currentSessionId = newSessions[0].id;
            } else {
              updates.currentSessionId = null;
              if (agenticFlowId && projectId) {
                const key = `soloengine-session-${agenticFlowId}-${projectId}`;
                localStorage.removeItem(key);
              }
            }
            updates.messages = [];
          }
          set(updates);
          return true;
        } catch {
          return false;
        }
      },

      loadSessionsForProject: async (agenticFlowId, projectId) => {
        try {
          const sessionsData = await runApi.getSessions({
            agentic_flow_id: agenticFlowId,
            run_project_id: projectId,
            limit: 50,
          });

          const currentSessions = get().sessions;
          const extendedSessions: ExtendedRunSession[] = sessionsData.map((s: any) => {
            const existingSession = currentSessions.find((cs: any) => cs.id === s.id);
            return {
              ...s,
              firstAssistantContent: s.first_assistant_content || undefined,
              createdAt: s.created_at || new Date().toISOString(),
              messages: existingSession?.messages || [],
              fileChangesMap: existingSession?.fileChangesMap,
            };
          });

          extendedSessions.sort((a: any, b: any) =>
            new Date(b.updated_at || b.createdAt || '').getTime() - new Date(a.updated_at || a.createdAt || '').getTime()
          );

          set({ sessions: extendedSessions });
        } catch (error) {
          console.warn('Failed to load sessions:', error);
        }
      },

      handleExternalFileChanges: (changes) => {
        const state = get();
        const now = Date.now();

        for (const change of changes) {
          if (change.operation !== 'modified') continue;

          const normalizedPath = normalizeFilePath(change.file_path);

          const key = `${normalizedPath}:modified`;
          const lastTime = _lastExternalChangeTime[key] || 0;
          if (now - lastTime < 500) continue;
          _lastExternalChangeTime[key] = now;

          const editorTab = state.editorTabs.find(
            (t) => normalizeFilePath(t.path) === normalizedPath
          );
          if (editorTab) {
            if (editorTab.isModified) {
              set({
                editorTabs: state.editorTabs.map((t) =>
                  t.id === editorTab.id ? { ...t, hasExternalChange: true } : t
                ),
              });
            } else {
              runProjectApi.readFile(editorTab.path).then((response) => {
                set({
                  editorTabs: get().editorTabs.map((t) =>
                    t.id === editorTab.id ? { ...t, content: response.data.content, isLoading: false } : t
                  ),
                });
              });
            }
          }

          const docTab = state.documentTabs.find(
            (t) => normalizeFilePath(t.path) === normalizedPath
          );
          if (docTab && !docTab.isModified) {
            runProjectApi.readFile(docTab.path).then((response) => {
              set({
                documentTabs: get().documentTabs.map((t) =>
                  t.id === docTab.id ? { ...t, content: response.data.content, isLoading: false } : t
                ),
              });
            });
          }
        }
      },

      resolveExternalChange: async (tabId: string) => {
        const state = get();
        const tab = state.editorTabs.find((t) => t.id === tabId)
            || state.documentTabs.find((t) => t.id === tabId);
        if (!tab) return;

        const response = await runProjectApi.readFile(tab.path);
        const fileContent = response.data.content;
        set({
          editorTabs: state.editorTabs.map((t) =>
            t.id === tabId
              ? { ...t, content: fileContent, isLoading: false, hasExternalChange: false, isModified: false }
              : t
          ),
          documentTabs: state.documentTabs.map((t) =>
            t.id === tabId
              ? { ...t, content: fileContent, isLoading: false, hasExternalChange: false, isModified: false }
              : t
          ),
        });
      },


    }),
);

export { generateId };
