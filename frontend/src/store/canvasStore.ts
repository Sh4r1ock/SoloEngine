/**
 * SoloEngine : 画布状态管理模块
 *
 * @file canvasStore.ts
 * @description 画布状态管理 - 工作流画布状态管理模块
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 使用Zustand实现状态管理
 *     - 管理画布节点、边、选中状态等
 *     - 管理节点数据、管理边数据、管理选中状态
 *     - 撤销/重做状态管理
 *     - 自动保存功能
 *     - 历史记录管理（最多30条）
 *
 * 依赖:
 *     - zustand: 状态管理库
 *     - ../types/canvas: 画布类型定义
 *     - ../services/localStorage: 本地存储服务
 *     - ../services/agenticFlowApi: AgenticFlow API服务
 *     - ../services/llmApi: LLM API服务
 *
 * 使用示例:
 *     - import { useCanvasStore } from './store/canvasStore'
 *     - const { nodes, edges, addNode, addEdge } = useCanvasStore()
 *
 * 注意事项：
 *     - 支持自动保存功能
 *     - 支持撤销/重做历史记录（最多30条）
 */
import { create } from 'zustand';
import { CanvasData, NodeData, EdgeData, ProjectData, GlobalSettings } from '../types/canvas';
import { APP_CONFIG } from '../config/index';

import { MarkerType } from 'reactflow';
import { message } from 'antd';
import { agenticFlowApi } from '../services/agenticFlowApi';
import { llmApi, LLMConfig } from '../services/llmApi';

const MAX_HISTORY_SIZE = 30;
const DEBOUNCE_DELAY = 500;
const AUTO_SAVE_DELAY = 1000;

const debounce = <T extends (...args: any[]) => any>(func: T, wait: number): T => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  }) as T;
};



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
  configMap: Map<string, LLMConfig>;
  autoSave: () => void;
  history: HistoryState[];
  historyIndex: number;
  isDragging: boolean;
  
  setCurrentProject: (project: ProjectData | null) => void;
  setNodes: (nodes: NodeData[], skipHistory?: boolean) => void;
  setEdges: (edges: EdgeData[], skipHistory?: boolean) => void;
  addNode: (node: NodeData) => void;
  addNodeWithDefaultConfig: (node: NodeData) => Promise<void>;
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
  loadLLMConfigs: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;
}

const defaultSettings: GlobalSettings = {
  // 运行模式默认"每次询问"（最安全，与主流 AI IDE 默认一致）；
  // 白名单默认取 .env 配置的综合安全命令列表（用户可自行增删，保存后覆盖画布值）
  runMode: 'ask',
  commandAllowlist: [...APP_CONFIG.DEFAULT_COMMAND_ALLOWLIST],
  // 实时跟随默认开启：工具调用时 agentic 操作区自动跳转对应标签页
  followMode: true,
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
  configMap: new Map(),
  history: [{ nodes: [], edges: [] }],
  historyIndex: 0,
  isDragging: false,

  autoSave: debounce(async () => {
    const { nodes, edges, currentProject, isDragging, globalSettings } = get();
    if (isDragging) return;

    const agenticFlowId = currentProject?.id;
    if (!agenticFlowId) return;

    try {
      await agenticFlowApi.saveCanvas(agenticFlowId, { nodes, edges, globalSettings });
    } catch (error) {
      console.error('Auto save failed:', error);
    }
  }, AUTO_SAVE_DELAY),

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
      set({ nodes: structuredClone(nodes), edges: structuredClone(edges), historyIndex: newIndex });
      // 延迟触发自动保存，确保状态已更新
      setTimeout(() => get().autoSave(), 0);
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const { nodes, edges } = history[newIndex];
      set({ nodes: structuredClone(nodes), edges: structuredClone(edges), historyIndex: newIndex });
      // 延迟触发自动保存，确保状态已更新
      setTimeout(() => get().autoSave(), 0);
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
    const edgesWithMarker = edges.map(edge => {
      const { label, ...rest } = edge;
      if (!rest.markerEnd) {
        return {
          ...rest,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
            color: '#b1b1b7',
          },
        };
      }
      return rest;
    });
    set({ edges: edgesWithMarker as EdgeData[] });
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

  addNodeWithDefaultConfig: async (node: NodeData) => {
    try {
      const defaultConfig = await llmApi.getDefaultConfig();
      if (defaultConfig) {
        // canvas 从 llm_config 获取默认值并写入 canvas；llm_config 缺必填字段必须直接报错，禁止静默降级
        if (defaultConfig.max_input_tokens == null) {
          message.error(`LLM 配置「${defaultConfig.name}」缺少 max_input_tokens，无法应用到节点，请在模型管理中修复`);
          return;
        }
        node.data.model_config = {
          llm_config_id: defaultConfig.id,
          temperature: defaultConfig.temperature,
          max_output_tokens: defaultConfig.max_output_tokens ?? defaultConfig.max_tokens,
          max_input_tokens: defaultConfig.max_input_tokens,
          frequency_penalty: defaultConfig.frequency_penalty,
          presence_penalty: defaultConfig.presence_penalty,
        };
        get().configMap.set(defaultConfig.id, defaultConfig);
      }
    } catch (error) {
      console.warn('Failed to load default LLM config:', error);
    }
    
    set((state) => {
      const newNodes = [...state.nodes, node];
      return { nodes: newNodes };
    });
    get().autoSave();
    get().pushHistory();
  },

  updateNode: (nodeId, data) => set((state) => {
    const newNodes = state.nodes.map((node) =>
      node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
    );
    
    let newSelectedNode = state.selectedNode;
    if (state.selectedNode && state.selectedNode.id === nodeId) {
      const updatedNode = newNodes.find(n => n.id === nodeId);
      if (updatedNode) {
        newSelectedNode = updatedNode;
      }
    }
    
    get().autoSave();
    get().pushHistory();
    return { nodes: newNodes, selectedNode: newSelectedNode };
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

  setGlobalSettings: (settings) => {
    set((state) => ({
      globalSettings: { ...state.globalSettings, ...settings },
    }));
    // 画布设置变更立即持久化（autoSave 含 globalSettings）
    get().autoSave();
  },

  setPreviewOpen: (open) => set({ isPreviewOpen: open }),

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),

  setPropertyPanelOpen: (open) => set({ isPropertyPanelOpen: open }),

  setSnapToGrid: (snap) => set({ snapToGrid: snap }),

  setIsDragging: (dragging) => set({ isDragging: dragging }),

  saveCanvas: async () => {
    const { currentProject, nodes, edges, globalSettings } = get();
    if (!currentProject) return;

    const canvasData: CanvasData = { nodes, edges };
    await agenticFlowApi.saveCanvas(currentProject.id, { ...canvasData, globalSettings });
  },

  loadCanvas: async (projectId: string) => {
    const canvasData = await agenticFlowApi.getCanvas(projectId);
    set({
      nodes: canvasData.nodes,
      edges: canvasData.edges,
      // 加载画布时同步加载已保存的全局设置（运行模式/白名单）；缺失用默认值
      globalSettings: canvasData.globalSettings
        ? { ...defaultSettings, ...canvasData.globalSettings }
        : defaultSettings,
    });
  },

  loadLLMConfigs: async () => {
    const configs = await llmApi.getConfigs();
    const map = new Map<string, LLMConfig>();
    for (const config of configs) {
      map.set(config.id, config);
    }
    set({ configMap: map });
  },
}));
