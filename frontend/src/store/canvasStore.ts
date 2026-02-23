/**
 * @file canvasStore.ts
 * @description 画布状态管理 - 工作流画布状态管理模块
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 使用Zustand实现状态管理
 * - 管理画布节点、边、选中状态等
 * - 管理节点数据、管理边数据、管理选中状态、撤销/重做状态
 * 
 * 使用场景：
 * - 画布编辑器的核心状态管理
 * - 节点和边的增删改查操作
 * 
 * 注意事项：
 * - 支持自动保存功能
 * - 支持撤销/重做历史记录（最多30条）
 */
import { create } from 'zustand';
import { CanvasData, NodeData, EdgeData, ProjectData } from '../types/canvas';
import { projectApi } from '../services/api';
import { localStorageService } from '../services/localStorage';

const MAX_HISTORY_SIZE = 30;
const DEBOUNCE_DELAY = 500;

const debounce = <T extends (...args: any[]) => any>(func: T, wait: number): T => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
};

export interface GlobalSettings {
  maxContextLength: number;
  maxIterations: number;
  timeout: number;
}

interface HistoryState {
  nodes: NodeData[];
  edges: EdgeData[];
}

interface CanvasStore {
  currentProject: ProjectData | null;
  nodes: NodeData[];
  edges: EdgeData[];
  selectedNode: NodeData | null;
  globalSettings: GlobalSettings;
  isPreviewOpen: boolean;
  isSettingsOpen: boolean;
  isPropertyPanelOpen: boolean;
  snapToGrid: boolean;
  autoSave: () => void;
  history: HistoryState[];
  historyIndex: number;
  isDragging: boolean;
  
  setCurrentProject: (project: ProjectData | null) => void;
  setNodes: (nodes: NodeData[], skipHistory?: boolean) => void;
  setEdges: (edges: EdgeData[], skipHistory?: boolean) => void;
  addNode: (node: NodeData) => void;
  updateNode: (nodeId: string, data: Partial<NodeData['data']>) => void;
  deleteNode: (nodeId: string) => void;
  addEdge: (edge: EdgeData) => void;
  deleteEdge: (edgeId: string) => void;
  setSelectedNode: (node: NodeData | null) => void;
  setGlobalSettings: (settings: Partial<GlobalSettings>) => void;
  setPreviewOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPropertyPanelOpen: (open: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  setIsDragging: (dragging: boolean) => void;
  saveCanvas: () => Promise<void>;
  loadCanvas: (projectId: string) => Promise<void>;
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
}

const defaultSettings: GlobalSettings = {
  maxContextLength: 4096,
  maxIterations: 10,
  timeout: 30000,
};

let debouncedPushHistory: (() => void) | null = null;

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  currentProject: null,
  nodes: [],
  edges: [],
  selectedNode: null,
  globalSettings: defaultSettings,
  isPreviewOpen: false,
  isSettingsOpen: false,
  isPropertyPanelOpen: false,
  snapToGrid: true,
  history: [{ nodes: [], edges: [] }],
  historyIndex: 0,
  isDragging: false,

  autoSave: debounce(() => {
    const { nodes, edges, isDragging } = get();
    if (isDragging) return;
    const defaultProjectName = 'default_flow';
    localStorageService.saveFlow(defaultProjectName, nodes, edges);
  }, DEBOUNCE_DELAY),

  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    const newHistoryState: HistoryState = {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
    };
    
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newHistoryState);
    
    if (newHistory.length > MAX_HISTORY_SIZE) {
      newHistory.shift();
    }
    
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const { nodes, edges } = history[newIndex];
      set({ nodes, edges, historyIndex: newIndex });
      get().autoSave();
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const { nodes, edges } = history[newIndex];
      set({ nodes, edges, historyIndex: newIndex });
      get().autoSave();
    }
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  setNodes: (nodes, skipHistory = false) => {
    set({ nodes });
    get().autoSave();
    if (!skipHistory) {
      const { isDragging } = get();
      if (isDragging) {
        if (!debouncedPushHistory) {
          debouncedPushHistory = debounce(() => {
            get().pushHistory();
          }, 500);
        }
        debouncedPushHistory();
      } else {
        get().pushHistory();
      }
    }
  },

  setEdges: (edges, skipHistory = false) => {
    set({ edges });
    get().autoSave();
    if (!skipHistory) {
      const { isDragging } = get();
      if (isDragging) {
        if (!debouncedPushHistory) {
          debouncedPushHistory = debounce(() => {
            get().pushHistory();
          }, 500);
        }
        debouncedPushHistory();
      } else {
        get().pushHistory();
      }
    }
  },

  addNode: (node) => set((state) => {
    const newNodes = [...state.nodes, node];
    get().autoSave();
    get().pushHistory();
    return { nodes: newNodes };
  }),

  updateNode: (nodeId, data) => set((state) => {
    const newNodes = state.nodes.map((node) =>
      node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
    );
    get().autoSave();
    get().pushHistory();
    return { nodes: newNodes };
  }),

  deleteNode: (nodeId) => set((state) => {
    const newNodes = state.nodes.filter((node) => node.id !== nodeId);
    const newEdges = state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    get().autoSave();
    get().pushHistory();
    return { nodes: newNodes, edges: newEdges };
  }),

  addEdge: (edge) => set((state) => {
    const newEdges = [...state.edges, edge];
    get().autoSave();
    get().pushHistory();
    return { edges: newEdges };
  }),

  deleteEdge: (edgeId) => set((state) => {
    const newEdges = state.edges.filter((edge) => edge.id !== edgeId);
    get().autoSave();
    get().pushHistory();
    return { edges: newEdges };
  }),

  setSelectedNode: (node) => set({ selectedNode: node }),

  setGlobalSettings: (settings) => set((state) => ({ 
    globalSettings: { ...state.globalSettings, ...settings } 
  })),

  setPreviewOpen: (open) => set({ isPreviewOpen: open }),

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),

  setPropertyPanelOpen: (open) => set({ isPropertyPanelOpen: open }),

  setSnapToGrid: (snap) => set({ snapToGrid: snap }),

  setIsDragging: (dragging) => set({ isDragging: dragging }),

  saveCanvas: async () => {
    const { currentProject, nodes, edges } = get();
    if (!currentProject) return;

    const canvasData: CanvasData = { nodes, edges };
    await projectApi.updateCanvas(currentProject.id, canvasData);
  },

  loadCanvas: async (projectId: string) => {
    const canvasData = await projectApi.getCanvas(projectId);
    set({
      nodes: canvasData.nodes,
      edges: canvasData.edges,
    });
  },
}));
