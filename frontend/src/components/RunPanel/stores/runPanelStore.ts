/**
 * @file stores/runPanelStore.ts
 * @description 运行面板状态管理
 */

import { createContext, useContext } from 'react';
import { createStore, useStore } from 'zustand';
import { runApi } from '../../../services/runApi';
import { runProjectApi, SelectOrCreateProjectResponse, FileInfo as ProjectFileInfo } from '../../../services/runProjectApi';
import { insertTreeNode, removeTreeNode, moveTreeNode } from '../utils/treePatchUtils';
import type {
  LLMMessage,
  Message,
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
  TokenTotals,
} from '../types';

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

function normalizeFilePath(p: string): string {
  return p.replace(/\\/g, '/');
}

const _lastExternalChangeTime: Record<string, number> = {};

interface RunPanelState {
  agenticFlowId: string;
  sessions: ExtendedRunSession[];
  currentSessionId: string | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  isRunning: boolean;

  messages: Message[];
  streamingData: DataBlock[];
  inputText: string;
  isWaitingReply: boolean;
  currentMsgId: string;

  // 后端聚合改造（4.2）：agent 级整轮 token 状态（消息头/组头整轮显示数据源）。
  // 由 updateAgentTokens 写入（agent_token_usage 推送的 agent_usage / agent_complete
  // metadata.agent_usage），执行开始时 clearAgentUsage 清空。
  // 〇·3 并发修复：同一 agent 多次调用（多个 execution_key 实例，如 subagent 被 Task
  // 调用两次）时，键控维度区分实例——executionKey 键（实例准确值，组头用）+ agentId 键
  // （mainagent 消息头兼容，单实例场景），后写入不覆盖不同实例的组级聚合。
  agentUsageMap: Record<string, { tokens: number; totals: TokenTotals; history: any[] }>;
  setAgentUsage: (agentId: string, usage: any, executionKey?: string) => void;
  clearAgentUsage: () => void;

  callRecords: CallRecord[];
  subagentOutputs: SubagentOutput[];

  editorTabs: FileTab[];
  documentTabs: FileTab[];
  activeEditorTabId: string | null;
  activeDocumentTabId: string | null;
  _contentCache: Record<string, string>;

  agenticPanels: AgenticPanel[];
  activeAgenticTab: string | null;
  /** 浏览器面板当前显示的 URL（OpenPreview 可跳转块点击后写入，AgenticPanel 浏览器 iframe 渲染） */
  browserUrl: string | null;
  /** 浏览器外部导航信号（OpenPreview 点击时递增，BrowserPanel 依赖其变化触发导航，解决同 URL 重复点击不触发的问题） */
  browserNavSeq: number;
  panelRatios: number[];
  isDragging: number | null;

  currentProject: CurrentProject | null;
  recentProjects: RecentProjectInfo[];
  projectLoading: boolean;
  files: ProjectFileInfo[];
  currentPath: string;

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

  // 工具交互回答发送器：AskUserQuestion / ExitPlanMode 交互面板点击后调用。
  // 由 RunPanel 注入（内部调用 executeFlow 发送回答），避免逐层传 props。
  userAnswerSender: ((text: string) => void) | null;
  setUserAnswerSender: (fn: ((text: string) => void) | null) => void;

  setCurrentSessionId: (sessionId: string | null) => void;
  setSessions: (sessions: ExtendedRunSession[] | ((prev: ExtendedRunSession[]) => ExtendedRunSession[])) => void;
  setSearchQuery: (query: string) => void;
  startRunning: () => void;
  stopRunning: () => void;

  addMessage: (message: Message) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
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
  closeEditorTabs: (ids: string[]) => void;
  setActiveEditorTabId: (id: string | null) => void;
  setTabContent: (tabId: string, content: string) => void;
  getTabContent: (tabId: string) => string;

  addDocumentTab: (tab: FileTab) => void;
  updateDocumentTab: (id: string, updates: Partial<FileTab>) => void;
  closeDocumentTab: (id: string) => void;
  closeDocumentTabs: (ids: string[]) => void;
  setActiveDocumentTabId: (id: string | null) => void;

  openOrNavigateFile: (params: { filePath: string; fileName: string; isCode: boolean; isBinary: boolean; projectFolderPath: string | null }) => { tab: FileTab; existed: boolean };

  openAgenticPanel: (type: string, url?: string) => void;
  closeAgenticPanel: (id: string) => void;
  closeAgenticPanels: (ids: string[]) => void;
  setActiveAgenticTab: (tab: string | null) => void;
  setPanelRatios: (ratios: number[]) => void;
  setIsDragging: (index: number | null) => void;

  setCurrentProject: (project: CurrentProject | null) => void;
  setRecentProjects: (projects: RecentProjectInfo[]) => void;
  setProjectLoading: (loading: boolean) => void;

  selectOrCreateProject: (agenticFlowId: string, folderPath: string) => Promise<SelectOrCreateProjectResponse | null>;
  openNativeFolderDialog: (agenticFlowId: string, title?: string, initialdir?: string) => Promise<SelectOrCreateProjectResponse | null>;
  setProjectFromSelectOrCreate: (data: SelectOrCreateProjectResponse) => void;
  loadCurrentProject: (agenticFlowId?: string) => Promise<void>;
  loadRecentProjects: (agenticFlowId: string) => Promise<RecentProjectInfo[]>;
  listFiles: (path?: string, pattern?: string) => Promise<void>;
  setCurrentPath: (path: string) => void;
  clearProject: () => void;
  clearError: () => void;
  applyIncrementalChanges: (changes: FileSystemChange[]) => void;

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

  reset: (mode: 'session' | 'project' | 'full') => void;
  saveContext: (flowId: string, projectId: string) => void;
  loadContext: (flowId: string, projectId: string) => { currentSessionId: string | null };
}

const CACHE_KEY_PREFIX = 'soloengine-session';

const DEFAULT_PANELS: AgenticPanel[] = [
  { id: 'editor', type: 'editor', title: '编辑器', isOpen: false },
  { id: 'terminal', type: 'terminal', title: '终端', isOpen: false },
  { id: 'browser', type: 'browser', title: '浏览器', isOpen: false },
  { id: 'document', type: 'document', title: '文档', isOpen: false },
  { id: 'changes', type: 'changes', title: '文件变更', isOpen: false },
];

function makeCacheKey(flowId: string, projectId: string): string {
  return `${CACHE_KEY_PREFIX}-${flowId}-${projectId}`;
}

interface ContextCache {
  currentSessionId: string | null;
  inputText: string;
  editorTabs: Array<Pick<FileTab, 'id' | 'name' | 'path' | 'type' | 'isBinary'>>;
  documentTabs: Array<Pick<FileTab, 'id' | 'name' | 'path' | 'type' | 'isBinary'>>;
  activeEditorTabId: string | null;
  activeDocumentTabId: string | null;
  agenticPanels: Array<{ id: string; type: string; title: string; isOpen: boolean }>;
  activeAgenticTab: string | null;
}

const _createStore = () => createStore<RunPanelState>()(
  (set, get) => ({
      agenticFlowId: '',
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
      _contentCache: {},

      agenticPanels: [
        { id: 'editor', type: 'editor', title: '编辑器', isOpen: false },
        { id: 'terminal', type: 'terminal', title: '终端', isOpen: false },
        { id: 'browser', type: 'browser', title: '浏览器', isOpen: false },
        { id: 'document', type: 'document', title: '文档', isOpen: false },
        { id: 'changes', type: 'changes', title: '文件变更', isOpen: false },
      ],
      activeAgenticTab: null,
      browserUrl: null,
      browserNavSeq: 0,
      panelRatios: [1, 4, 4, 1],
      isDragging: null,

      currentProject: null,
      recentProjects: [],
      projectLoading: false,
      files: [],
      currentPath: '',

      canvasData: null,

      // 后端聚合改造（4.2-3）：agent 级整轮 token 累计（setAgentUsage 写入）
      agentUsageMap: {} as Record<string, { tokens: number; totals: TokenTotals; history: any[] }>,

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

      userAnswerSender: null,
      setUserAnswerSender: (fn) => set({ userAnswerSender: fn }),

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

      // 后端聚合改造（4.2）：写入 agent 级整轮累计（tokens=total、totals=5 字段、history=全数组）。
      // 消息头/组头整轮显示的数据源（与块级本阶段 usage 正交）。
      // 〇·3 并发修复：executionKey 与 agentId 双键写入——executionKey 键为实例准确值
      //（subagent 组头按实例查询，同 agent 多实例互不覆盖）；agentId 键兼容 mainagent
      // 消息头（index.tsx 按 rootAgentId 查询）与单实例场景。
      setAgentUsage: (agentId, usage, executionKey) => {
        if (!agentId || !usage) return;
        const value = {
          tokens: usage.total_tokens ?? usage.total ?? 0,
          totals: {
            system_prompt: usage.system_prompt_token ?? usage.system_prompt ?? 0,
            user_prompt: usage.user_prompt_token ?? usage.user_prompt ?? 0,
            assistant_prompt: usage.assistant_prompt_token ?? usage.assistant_prompt ?? 0,
            completion: usage.completion_tokens ?? usage.completion ?? 0,
            total: usage.total_tokens ?? usage.total ?? 0,
          },
          history: usage.token_usage_history ?? [],
        };
        set((state) => ({
          agentUsageMap: {
            ...state.agentUsageMap,
            [agentId]: value,
            ...(executionKey && executionKey !== agentId ? { [executionKey]: value } : {}),
          },
        }));
      },
      clearAgentUsage: () => set({ agentUsageMap: {} }),

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
      closeEditorTab: (id) => get().closeEditorTabs([id]),
      closeEditorTabs: (ids) => {
        const state = get();
        if (!ids || ids.length === 0) return;
        const closingSet = new Set(ids);
        // 被关 tab 的最小索引：激活 tab 被关闭时，落点取该位置（与单个关闭行为一致）
        let minClosedIndex = Infinity;
        state.editorTabs.forEach((t, i) => {
          if (closingSet.has(t.id)) minClosedIndex = Math.min(minClosedIndex, i);
        });
        const newTabs = state.editorTabs.filter((t) => !closingSet.has(t.id));
        let newActiveId = state.activeEditorTabId;
        if (state.activeEditorTabId && closingSet.has(state.activeEditorTabId)) {
          if (newTabs.length > 0) {
            const newIndex = Math.min(minClosedIndex, newTabs.length - 1);
            newActiveId = newTabs[newIndex].id;
          } else {
            newActiveId = null;
          }
        }
        set({ editorTabs: newTabs, activeEditorTabId: newActiveId });
      },
      setActiveEditorTabId: (id) => set({ activeEditorTabId: id }),

      setTabContent: (tabId, content) => {
        set((state) => {
          const newCache = { ...state._contentCache, [tabId]: content };
          const needsModifiedUpdate = state.editorTabs.some(t => t.id === tabId && !t.isModified)
            || state.documentTabs.some(t => t.id === tabId && !t.isModified);
          if (needsModifiedUpdate) {
            return {
              _contentCache: newCache,
              editorTabs: state.editorTabs.map(t => t.id === tabId ? { ...t, isModified: true } : t),
              documentTabs: state.documentTabs.map(t => t.id === tabId ? { ...t, isModified: true } : t),
            };
          }
          return { _contentCache: newCache };
        });
      },

      getTabContent: (tabId) => {
        const state = get();
        return state._contentCache[tabId]
          ?? state.editorTabs.find(t => t.id === tabId)?.content
          ?? state.documentTabs.find(t => t.id === tabId)?.content
          ?? '';
      },

      addDocumentTab: (tab) => set((state) => ({ documentTabs: [...state.documentTabs, tab] })),
      updateDocumentTab: (id, updates) => set((state) => ({
        documentTabs: state.documentTabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      })),
      closeDocumentTab: (id) => get().closeDocumentTabs([id]),
      closeDocumentTabs: (ids) => {
        const state = get();
        if (!ids || ids.length === 0) return;
        const closingSet = new Set(ids);
        let minClosedIndex = Infinity;
        state.documentTabs.forEach((t, i) => {
          if (closingSet.has(t.id)) minClosedIndex = Math.min(minClosedIndex, i);
        });
        const newTabs = state.documentTabs.filter((t) => !closingSet.has(t.id));
        let newActiveId = state.activeDocumentTabId;
        if (state.activeDocumentTabId && closingSet.has(state.activeDocumentTabId)) {
          if (newTabs.length > 0) {
            const newIndex = Math.min(minClosedIndex, newTabs.length - 1);
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
        // 实时跟随（画布设置 globalSettings.followMode）：开启（默认）时自动跳转到文件所属
        // 标签页（activeAgenticTab）；关闭时仅打开文件 tab 并展开对应面板，不强制跳转。
        const follow = state.canvasData?.globalSettings?.followMode ?? true;
        const followState = follow ? { activeAgenticTab: panelType } : {};
        
        const existingTab = tabs.find(t => t.id === tabId);
        
        if (existingTab) {
          const newPanels = state.agenticPanels.map(p =>
            p.type === panelType ? { ...p, isOpen: true } : p
          );
          isCode
            ? set({ activeEditorTabId: tabId, agenticPanels: newPanels, ...followState })
            : set({ activeDocumentTabId: tabId, agenticPanels: newPanels, ...followState });
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
              ...followState,
            })
          : set({
              documentTabs: [...state.documentTabs, newTab],
              activeDocumentTabId: tabId,
              agenticPanels: newPanels,
              ...followState,
            });
        
        return { tab: newTab, existed: false };
      },

      openAgenticPanel: (type, url) => set((state) => {
        const newPanels = state.agenticPanels.map((p) =>
          p.type === type ? { ...p, isOpen: true } : p
        );
        // 实时跟随（画布设置 globalSettings.followMode）：开启（默认）时自动跳转对应标签页；
        // 关闭时仅展开对应面板（isOpen=true），不强制跳转，保留用户当前查看的标签页。
        const follow = state.canvasData?.globalSettings?.followMode ?? true;
        const followState = follow ? { activeAgenticTab: type } : {};
        // 浏览器面板支持携带 URL：OpenPreview 可跳转块点击后写入 browserUrl，
        // 同时递增 browserNavSeq（导航信号，BrowserPanel 依赖其变化触发导航——
        // 解决重复点击同一 URL 时 browserUrl 值不变导致 useEffect 不触发的问题）。
        // AgenticPanel 浏览器 iframe 据此渲染对应页面（非 browser 类型忽略 url 参数）。
        if (type === 'browser' && url !== undefined) {
          return {
            agenticPanels: newPanels,
            browserUrl: url,
            browserNavSeq: state.browserNavSeq + 1,
            ...followState,
          };
        }
        return { agenticPanels: newPanels, ...followState };
      }),
      closeAgenticPanel: (id) => get().closeAgenticPanels([id]),
      closeAgenticPanels: (ids) => set((state) => {
        if (!ids || ids.length === 0) return {};
        const closingSet = new Set(ids);
        const newPanels = state.agenticPanels.map((p) =>
          closingSet.has(p.id) ? { ...p, isOpen: false } : p
        );
        let newActiveTab = state.activeAgenticTab;
        if (state.activeAgenticTab) {
          const activePanel = state.agenticPanels.find((p) => p.type === state.activeAgenticTab);
          if (activePanel && closingSet.has(activePanel.id)) {
            const remainingOpen = newPanels.filter((p) => p.isOpen);
            newActiveTab = remainingOpen.length > 0 ? remainingOpen[0].type : null;
          }
        }
        return { agenticPanels: newPanels, activeAgenticTab: newActiveTab };
      }),
      setActiveAgenticTab: (tab) => set({ activeAgenticTab: tab }),
      setPanelRatios: (ratios) => set({ panelRatios: ratios }),
      setIsDragging: (index) => set({ isDragging: index }),

      setCurrentProject: (project) => set({ currentProject: project }),
      setRecentProjects: (projects) => set({ recentProjects: projects }),
      setProjectLoading: (loading) => set({ projectLoading: loading }),

      selectOrCreateProject: async (agenticFlowId, folderPath) => {
        set({ projectLoading: true, error: null });
        try {
          const response = await runProjectApi.selectOrCreateProject(agenticFlowId, folderPath);
          if (response.code === 200) {
            set({
              currentProject: {
                id: response.data.project_id,
                name: response.data.project_name,
                folder_path: response.data.folder_path,
              },
              recentProjects: response.data.recent_projects,
              projectLoading: false,
              files: [],
              currentPath: '',
            });
            return response.data;
          }
          set({ projectLoading: false, error: '选择或创建项目失败' });
          return null;
        } catch (error: any) {
          const errorMsg = error.response?.data?.detail || error.message || '选择或创建项目失败';
          set({ projectLoading: false, error: errorMsg });
          return null;
        }
      },

      openNativeFolderDialog: async (agenticFlowId, title = '选择项目文件夹', initialdir = '') => {
        set({ projectLoading: true, error: null });
        try {
          const response = await runProjectApi.openNativeFolderDialog(agenticFlowId, title, initialdir);
          set({ projectLoading: false });
          if (response.code === 200 && response.data) {
            set({
              currentProject: {
                id: response.data.project_id,
                name: response.data.project_name,
                folder_path: response.data.folder_path,
              },
              recentProjects: response.data.recent_projects || [],
              files: [],
              currentPath: '',
            });
            return response.data;
          }
          return null;
        } catch (error: any) {
          const errorMsg = error.response?.data?.detail || error.message || '选择文件夹失败';
          set({ projectLoading: false, error: errorMsg });
          return null;
        }
      },

      setProjectFromSelectOrCreate: (data) => {
        set({
          currentProject: {
            id: data.project_id,
            name: data.project_name,
            folder_path: data.folder_path,
          },
          recentProjects: data.recent_projects,
          currentPath: '',
        });
      },

      loadCurrentProject: async (agenticFlowId) => {
        set({ projectLoading: true, error: null });
        try {
          const response = await runProjectApi.getCurrentProject(agenticFlowId);
          if (response.code === 200 && response.data) {
            set({
              currentProject: response.data,
              projectLoading: false,
            });
          } else {
            set({
              currentProject: null,
              projectLoading: false,
            });
          }
        } catch (error: any) {
          set({ projectLoading: false, error: error.message });
        }
      },

      loadRecentProjects: async (agenticFlowId) => {
        try {
          const response = await runProjectApi.getRecentProjects(agenticFlowId, 10);
          if (response.code === 200) {
            set({ recentProjects: response.data });
            return response.data;
          }
          return [];
        } catch (error: any) {
          const errorMsg = error.response?.data?.detail || error.message || '获取最近项目失败';
          set({ error: errorMsg });
          console.error('Failed to load recent projects:', error);
          return [];
        }
      },

      listFiles: async (path = '', pattern = '*') => {
        set({ projectLoading: true, error: null });
        try {
          const response = await runProjectApi.listFiles(path, pattern, get().agenticFlowId);
          if (response.code === 200) {
            set({
              files: response.data.files,
              currentPath: response.data.relative_path,
              projectLoading: false,
            });
          } else {
            set({ projectLoading: false, error: '获取文件列表失败' });
          }
        } catch (error: any) {
          const errorMsg = error.response?.data?.detail || error.message || '获取文件列表失败';
          set({ projectLoading: false, error: errorMsg });
        }
      },

      setCurrentPath: (path) => set({ currentPath: path }),

      clearProject: () => {
        set({
          currentProject: null,
          files: [],
          currentPath: '',
          error: null,
        });
      },

      clearError: () => set({ error: null }),

      applyIncrementalChanges: (changes) => {
        set((state) => {
          let newTree: any[] = state.files as any;
          for (const change of changes) {
            if (change.operation === 'created') {
              newTree = insertTreeNode(newTree, change.file_path, change.is_directory);
            } else if (change.operation === 'deleted') {
              newTree = removeTreeNode(newTree, change.file_path);
            } else if (change.operation === 'moved' && change.dest_path) {
              newTree = moveTreeNode(newTree, change.file_path, change.dest_path, change.is_directory);
            }
          }
          return { files: newTree as ProjectFileInfo[] };
        });
      },

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
        const newSession: ExtendedRunSession = {
          id: newSessionId,
          status: 'pending',
          name: '新任务',
          createdAt: new Date().toISOString(),
          messages: [],
        };
        set((state) => ({
          currentSessionId: newSessionId,
          sessions: [newSession, ...state.sessions],
          messages: [],
          fileChangesLoaded: false,
          callRecords: [],
        }));
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
              runProjectApi.readFile(editorTab.path, 'utf-8', get().agenticFlowId).then((response) => {
                const newContent = response.data.content;
                set({
                  _contentCache: { ...get()._contentCache, [editorTab.id]: newContent },
                  editorTabs: get().editorTabs.map((t) =>
                    t.id === editorTab.id ? { ...t, content: newContent, isLoading: false } : t
                  ),
                });
              });
            }
          }

          const docTab = state.documentTabs.find(
            (t) => normalizeFilePath(t.path) === normalizedPath
          );
          if (docTab && !docTab.isModified) {
            runProjectApi.readFile(docTab.path, 'utf-8', get().agenticFlowId).then((response) => {
              const newContent = response.data.content;
              set({
                _contentCache: { ...get()._contentCache, [docTab.id]: newContent },
                documentTabs: get().documentTabs.map((t) =>
                  t.id === docTab.id ? { ...t, content: newContent, isLoading: false } : t
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

        const response = await runProjectApi.readFile(tab.path, 'utf-8', get().agenticFlowId);
        const fileContent = response.data.content;
        set({
          _contentCache: { ...get()._contentCache, [tabId]: fileContent },
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

      reset: (mode: 'session' | 'project' | 'full') => {
        const base = {
          messages: [] as Message[],
          streamingData: [] as DataBlock[],
          inputText: '',
          isWaitingReply: false,
          currentMsgId: '',
          // 后端聚合改造（4.2-4）：执行/切换 session 时清空，避免跨 session 残留
          agentUsageMap: {} as Record<string, { tokens: number; totals: TokenTotals; history: any[] }>,
          callRecords: [] as CallRecord[],
          subagentOutputs: [] as SubagentOutput[],
          hoveredMessageId: null as string | null,
          expandedReasoning: [] as string[],
          expandedToolCalls: [] as string[],
          streamingExpandedKeys: [] as string[],
          recallingMessageId: null as string | null,
          recallPreviewFiles: {} as Record<string, any>,
          recallPreviewMessageId: null as string | null,
          fileChangeRefreshKey: 0,
          fileChangesMap: {} as MessageFileChangesMap,
          fileChangesLoaded: false,
          activeChangesMessageId: null as string | null,
          expandedBlockKeys: {} as Record<string, boolean>,
        };

        if (mode === 'session') {
          set(base);
          return;
        }

        set({
          ...base,
          sessions: [] as ExtendedRunSession[],
          currentSessionId: null,
          editorTabs: [] as FileTab[],
          documentTabs: [] as FileTab[],
          activeEditorTabId: null,
          activeDocumentTabId: null,
          _contentCache: {} as Record<string, string>,
          agenticPanels: DEFAULT_PANELS,
          activeAgenticTab: null,
        });

        if (mode === 'full') {
          set({
            currentProject: null,
            recentProjects: [] as RecentProjectInfo[],
            canvasData: null,
            files: [],
            currentPath: '',
          });
        }
      },

      saveContext: (flowId: string, projectId: string) => {
        const state = get();
        const key = `soloengine-session-${flowId}-${projectId}`;
        const data = {
          currentSessionId: state.currentSessionId,
          inputText: state.inputText,
          editorTabs: state.editorTabs.map(t => ({
            id: t.id, name: t.name, path: t.path, type: t.type, isBinary: t.isBinary,
          })),
          documentTabs: state.documentTabs.map(t => ({
            id: t.id, name: t.name, path: t.path, type: t.type, isBinary: t.isBinary,
          })),
          activeEditorTabId: state.activeEditorTabId,
          activeDocumentTabId: state.activeDocumentTabId,
          agenticPanels: state.agenticPanels,
          activeAgenticTab: state.activeAgenticTab,
          panelRatios: state.panelRatios,
        };
        try {
          localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
          console.warn('[runPanelStore] saveContext failed:', e);
        }
      },

      loadContext: (flowId: string, projectId: string) => {
        const key = `soloengine-session-${flowId}-${projectId}`;
        try {
          const raw = localStorage.getItem(key);
          if (!raw) return { currentSessionId: null };
          const data = JSON.parse(raw);
          const editorTabs = (data.editorTabs || []).map((t: any) => ({
            ...t, content: '', isLoading: true, isModified: false, hasExternalChange: false,
          }));
          const documentTabs = (data.documentTabs || []).map((t: any) => ({
            ...t, content: '', isLoading: true, isModified: false, hasExternalChange: false,
          }));
          const loadedPanels = data.agenticPanels || DEFAULT_PANELS;
          set({
            currentSessionId: data.currentSessionId || null,
            inputText: data.inputText || '',
            editorTabs,
            documentTabs,
            activeEditorTabId: data.activeEditorTabId || null,
            activeDocumentTabId: data.activeDocumentTabId || null,
            agenticPanels: loadedPanels,
            activeAgenticTab: data.activeAgenticTab || null,
            panelRatios: data.panelRatios || [1, 4, 4, 1],
          });
          return { currentSessionId: data.currentSessionId || null };
        } catch (e) {
          console.warn('[runPanelStore] loadContext failed:', e);
          return { currentSessionId: null };
        }
      },


    }),
);

type RunPanelStore = ReturnType<typeof _createStore>;

const storeCache = new Map<string, RunPanelStore>();

export function getRunPanelStore(flowId: string): RunPanelStore {
  if (!storeCache.has(flowId)) {
    const store = _createStore();
    store.setState({ agenticFlowId: flowId });
    storeCache.set(flowId, store);
  }
  return storeCache.get(flowId)!;
}

let _currentStore: RunPanelStore | null = null;
export function setCurrentRunPanelStore(store: RunPanelStore) {
  _currentStore = store;
}

export const RunPanelStoreContext = createContext<RunPanelStore>(null!);

export function useRunPanelStore<T>(selector: (state: RunPanelState) => T): T;
export function useRunPanelStore(): RunPanelState;
export function useRunPanelStore(selector?: (state: RunPanelState) => any) {
  const ctxStore = useContext(RunPanelStoreContext);
  const store = ctxStore || _currentStore;
  if (!store) throw new Error('useRunPanelStore: no store');
  return selector ? useStore(store, selector) : useStore(store);
}

useRunPanelStore.getState = () => {
  if (!_currentStore) throw new Error('no active store');
  return _currentStore.getState();
};
useRunPanelStore.subscribe = (listener: (state: RunPanelState, prevState: RunPanelState) => void) => {
  if (!_currentStore) throw new Error('no active store');
  return _currentStore.subscribe(listener);
};
useRunPanelStore.setState = (partial: Partial<RunPanelState>) => {
  if (!_currentStore) throw new Error('no active store');
  _currentStore.setState(partial);
};

export { generateId };
