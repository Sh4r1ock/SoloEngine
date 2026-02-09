import { create } from 'zustand';
import { CanvasData, NodeData, EdgeData, ProjectData } from '../types/canvas';
import { projectApi } from '../services/api';

export interface GlobalSettings {
  maxContextLength: number;
  maxIterations: number;
  timeout: number;
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
  
  setCurrentProject: (project: ProjectData | null) => void;
  setNodes: (nodes: NodeData[]) => void;
  setEdges: (edges: EdgeData[]) => void;
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
  saveCanvas: () => Promise<void>;
  loadCanvas: (projectId: string) => Promise<void>;
}

const defaultSettings: GlobalSettings = {
  maxContextLength: 4096,
  maxIterations: 10,
  timeout: 30000,
};

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

  setCurrentProject: (project) => set({ currentProject: project }),

  setNodes: (nodes) => set({ nodes }),

  setEdges: (edges) => set({ edges }),

  addNode: (node) => set((state) => ({ nodes: [...state.nodes, node] })),

  updateNode: (nodeId, data) => set((state) => ({
    nodes: state.nodes.map((node) =>
      node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
    ),
  })),

  deleteNode: (nodeId) => set((state) => ({
    nodes: state.nodes.filter((node) => node.id !== nodeId),
    edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  })),

  addEdge: (edge) => set((state) => ({ edges: [...state.edges, edge] })),

  deleteEdge: (edgeId) => set((state) => ({
    edges: state.edges.filter((edge) => edge.id !== edgeId),
  })),

  setSelectedNode: (node) => set({ selectedNode: node }),

  setGlobalSettings: (settings) => set((state) => ({ 
    globalSettings: { ...state.globalSettings, ...settings } 
  })),

  setPreviewOpen: (open) => set({ isPreviewOpen: open }),

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),

  setPropertyPanelOpen: (open) => set({ isPropertyPanelOpen: open }),

  setSnapToGrid: (snap) => set({ snapToGrid: snap }),

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
