/**
 * @file mcpStore.ts
 * @description MCP状态管理 - MCP服务器状态管理模块
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 管理MCP服务器列表、连接状态、工具列表等
 * - 管理服务器列表、管理连接状态、缓存工具列表
 * 
 * 使用场景：
 * - MCP服务器管理界面
 * - MCP工具和资源的访问
 * 
 * 注意事项：
 * - 服务器状态实时更新
 * - 支持工具调用和连接测试
 */
import { create } from 'zustand';
import { mcpApi, MCPServer, MCPTool, MCPResource, MCPPrompt } from '../services/mcpApi';

export type { MCPServer, MCPTool, MCPResource, MCPPrompt };

interface MCPState {
  servers: MCPServer[];
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  loading: boolean;
  error: string | null;
  selectedServer: MCPServer | null;

  loadServers: () => Promise<void>;
  addServer: (config: any) => Promise<boolean>;
  updateServer: (serverId: string, config: any) => Promise<boolean>;
  deleteServer: (serverId: string) => Promise<boolean>;
  testConnection: (serverId: string) => Promise<boolean>;
  callTool: (serverId: string, toolName: string, args: Record<string, any>) => Promise<any>;
  selectServer: (server: MCPServer | null) => void;
  loadAllTools: () => Promise<void>;
  getAllTools: () => MCPTool[];
}

export const useMCPStore = create<MCPState>((set, get) => ({
  servers: [],
  tools: [],
  resources: [],
  prompts: [],
  loading: false,
  error: null,
  selectedServer: null,

  loadServers: async () => {
    set({ loading: true, error: null });
    try {
      const response = await mcpApi.getServers();
      if (response.code === 200) {
        const servers = response.data;
        set({ servers, loading: false });
        
        const allTools: MCPTool[] = [];
        const allResources: MCPResource[] = [];
        const allPrompts: MCPPrompt[] = [];
        
        for (const server of servers) {
          if (server.tools) {
            server.tools.forEach((tool: MCPTool) => {
              allTools.push({ ...tool, server_id: server.id });
            });
          }
          if (server.resources) {
            server.resources.forEach((resource: MCPResource) => {
              allResources.push({ ...resource, server_id: server.id });
            });
          }
          if (server.prompts) {
            server.prompts.forEach((prompt: MCPPrompt) => {
              allPrompts.push({ ...prompt, server_id: server.id });
            });
          }
        }
        
        set({ tools: allTools, resources: allResources, prompts: allPrompts });
      } else {
        set({ error: response.message, loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  addServer: async (config: any) => {
    set({ loading: true, error: null });
    try {
      const response = await mcpApi.addServer(config);
      if (response.code === 200) {
        await get().loadServers();
        return true;
      } else {
        set({ error: response.message, loading: false });
        return false;
      }
    } catch (error) {
      set({ error: String(error), loading: false });
      return false;
    }
  },

  updateServer: async (serverId: string, config: any) => {
    set({ loading: true, error: null });
    try {
      const response = await mcpApi.updateServer(serverId, config);
      if (response.code === 200) {
        await get().loadServers();
        return true;
      } else {
        set({ error: response.message, loading: false });
        return false;
      }
    } catch (error) {
      set({ error: String(error), loading: false });
      return false;
    }
  },

  deleteServer: async (serverId: string) => {
    set({ loading: true, error: null });
    try {
      const response = await mcpApi.deleteServer(serverId);
      if (response.code === 200) {
        await get().loadServers();
        return true;
      } else {
        set({ error: response.message, loading: false });
        return false;
      }
    } catch (error) {
      set({ error: String(error), loading: false });
      return false;
    }
  },

  testConnection: async (serverId: string) => {
    try {
      const response = await mcpApi.testConnection(serverId);
      return response.code === 200;
    } catch (error) {
      return false;
    }
  },

  callTool: async (serverId: string, toolName: string, args: Record<string, any>) => {
    try {
      const response = await mcpApi.callTool(serverId, toolName, args);
      if (response.code === 200) {
        return response.data;
      }
      return null;
    } catch (error) {
      return null;
    }
  },

  selectServer: (server: MCPServer | null) => {
    set({ selectedServer: server });
  },

  loadAllTools: async () => {
    await get().loadServers();
  },

  getAllTools: () => {
    return get().tools;
  },
}));
