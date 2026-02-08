import axios from 'axios';
import { ProjectData, CanvasData, ToolData } from '../types/canvas';

const API_BASE_URL = '/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const projectApi = {
  getProjects: async (): Promise<ProjectData[]> => {
    const response = await api.get('/projects');
    return response.data.data;
  },

  createProject: async (name: string): Promise<ProjectData> => {
    const response = await api.post('/projects', null, { params: { name } });
    return response.data.data;
  },

  getCanvas: async (projectId: string): Promise<CanvasData> => {
    const response = await api.get(`/projects/${projectId}/canvas`);
    return response.data.data.canvas;
  },

  updateCanvas: async (projectId: string, canvasData: CanvasData): Promise<CanvasData> => {
    const response = await api.put(`/projects/${projectId}/canvas`, canvasData);
    return response.data.data.canvas;
  },

  runProject: async (projectId: string, input: string): Promise<{ task_id: string }> => {
    const response = await api.post(`/projects/${projectId}/run`, { input });
    return response.data.data;
  },
};

export const toolApi = {
  getTools: async (): Promise<ToolData[]> => {
    const response = await api.get('/tools');
    return response.data.data;
  },

  registerTool: async (name: string, toolType: string, config: any): Promise<ToolData> => {
    const response = await api.post('/tools', null, { params: { name, tool_type: toolType }, data: config });
    return response.data.data;
  },

  deleteTool: async (toolId: string): Promise<void> => {
    await api.delete(`/tools/${toolId}`);
  },
};
