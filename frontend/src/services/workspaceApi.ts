import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8990';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface WorkspaceRoot {
  name: string;
  path: string;
}

export interface BrowseItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface BrowseResult {
  current_path: string;
  parent_path: string;
  items: BrowseItem[];
}

export const workspaceApi = {
  getWorkspaceRoots: async () => {
    const response = await api.get('/api/v1/run-project/workspace-roots');
    return response.data;
  },

  browseDirectory: async (path: string = ''): Promise<{
    code: number;
    message: string;
    data: BrowseResult | { roots: WorkspaceRoot[]; system: string };
  }> => {
    const response = await api.get('/api/v1/run-project/browse', {
      params: { path },
    });
    return response.data;
  },

  selectWorkspace: async (folderPath: string) => {
    const response = await api.post('/api/v1/run-project/select-folder', {
      folder_path: folderPath,
    });
    return response.data;
  },
};

export default workspaceApi;
