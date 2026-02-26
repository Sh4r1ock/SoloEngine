/**
 * @file localStorage.ts
 * @description 本地存储服务 - 项目数据本地存储模块
 * @author SoloEngine Team
 * @date 2026-02-19
 * 
 * 功能描述：
 * - 提供项目数据的本地存储和读取功能
 * - 保存项目、加载项目、获取项目列表、删除项目
 * 
 * 使用场景：
 * - 项目数据的持久化存储
 * - 项目导入导出功能
 * 
 * 注意事项：
 * - 支持localStorage和服务器端存储两种方式
 * - 导出功能生成JSON格式文件
 */
import { NodeData, EdgeData } from '../types/canvas';
import { api } from './api';

/**
 * 保存的节点接口
 * 
 * @property node_id - 节点ID
 * @property node_name - 节点名称
 * @property node_intro - 节点简介
 * @property agent_type - 智能体类型
 * @property position - 节点位置
 * @property system_prompt - 系统提示词
 * @property user_prompt - 用户提示词
 * @property assistant_prompt - 助手提示词
 * @property model_config - 模型配置
 * @property skills - Skills列表
 * @property mcps - MCP列表
 * @property source_node_id - 源节点ID
 * @property target_node_id - 目标节点ID
 */
export interface SavedNode {
  node_id: string;
  node_name: string;
  node_intro?: string;
  agent_type: 'orchestrator' | 'planner' | 'executor';
  position: { x: number; y: number };
  system_prompt: string;
  user_prompt: string;
  assistant_prompt: string;
  model_config: {
    provider: string;
    model: string;
  };
  skills: string[];
  mcps: string[];
  source_node_id?: string;
  target_node_id?: string;
}

/**
 * 保存的工作流接口
 * 
 * @property project_name - 项目名称
 * @property nodes - 节点列表
 * @property saved_at - 保存时间
 */
export interface SavedFlow {
  project_name: string;
  nodes: SavedNode[];
  saved_at: string;
}

/**
 * 本地存储服务类
 * 
 * @description 提供项目数据的本地存储和读取功能
 */
class LocalStorageService {
  private readonly STORAGE_KEY = 'agentic_flows';

  saveFlow(projectName: string, nodes: NodeData[], edges: EdgeData[]): void {
    const savedNodes: SavedNode[] = nodes.map(node => {
      const incomingEdges = edges.filter(e => e.target === node.id);
      const outgoingEdges = edges.filter(e => e.source === node.id);

      return {
        node_id: node.id,
        node_name: node.data.name || '',
        node_intro: node.data.desc,
        agent_type: node.data.agentType || 'executor',
        position: node.position,
        system_prompt: node.data.system_prompt || '',
        user_prompt: node.data.user_prompt || '',
        assistant_prompt: node.data.assistant_prompt || '',
        model_config: node.data.model_config || { provider: 'openai', model: 'gpt-4' },
        skills: node.data.skills || [],
        mcps: [],
        source_node_id: incomingEdges.length > 0 ? incomingEdges[0].source : undefined,
        target_node_id: outgoingEdges.length > 0 ? outgoingEdges[0].target : undefined,
      };
    });

    const savedFlow: SavedFlow = {
      project_name: projectName,
      nodes: savedNodes,
      saved_at: new Date().toISOString(),
    };

    const savedFlows = this.getAllFlows();
    const existingIndex = savedFlows.findIndex(f => f.project_name === projectName);

    if (existingIndex >= 0) {
      savedFlows[existingIndex] = savedFlow;
    } else {
      savedFlows.push(savedFlow);
    }

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(savedFlows));
  }

  getAllFlows(): SavedFlow[] {
    const data = localStorage.getItem(this.STORAGE_KEY);
    if (!data) return [];
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  loadFlow(projectName: string): SavedFlow | null {
    const savedFlows = this.getAllFlows();
    return savedFlows.find(f => f.project_name === projectName) || null;
  }

  deleteFlow(projectName: string): void {
    const savedFlows = this.getAllFlows();
    const filteredFlows = savedFlows.filter(f => f.project_name !== projectName);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filteredFlows));
  }

  exportFlow(projectName: string): string {
    const flow = this.loadFlow(projectName);
    if (!flow) {
      throw new Error(`Flow "${projectName}" not found`);
    }
    return JSON.stringify(flow, null, 2);
  }

  downloadFlow(projectName: string): void {
    const flow = this.loadFlow(projectName);
    if (!flow) {
      throw new Error(`Flow "${projectName}" not found`);
    }

    const jsonStr = JSON.stringify(flow, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saved_flows_${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async saveFlowToFile(projectName: string, nodes: NodeData[], edges: EdgeData[]): Promise<void> {
    try {
      await api.post('/save-flow', {
        project_name: projectName,
        nodes: nodes,
        edges: edges,
      });
    } catch (error) {
      console.error('Failed to save flow to file:', error);
      throw error;
    }
  }

  async loadFlowFromFile(projectName: string): Promise<{ nodes: NodeData[]; edges: EdgeData[] } | null> {
    try {
      const response = await api.get(`/flows/${projectName}`);
      return response.data;
    } catch (error) {
      console.error('Failed to load flow from file:', error);
      return null;
    }
  }

  async listFlows(): Promise<any[]> {
    try {
      const response = await api.get('/flows');
      return response.data || [];
    } catch (error) {
      console.error('Failed to list flows:', error);
      return [];
    }
  }

  async deleteFlowFromServer(projectName: string): Promise<void> {
    try {
      await api.delete(`/flows/${projectName}`);
    } catch (error) {
      console.error('Failed to delete flow from server:', error);
      throw error;
    }
  }
}

export const localStorageService = new LocalStorageService();
