/**
 * SoloEngine : 本地存储服务模块
 *
 * @file localStorage.ts
 * @description 本地存储服务 - 项目数据服务器端存储模块
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块提供以下核心功能：
 *     - 项目数据的服务器端存储和读取
 *     - 保存项目
 *     - 加载项目
 *     - 获取项目列表
 *     - 删除项目
 *
 * 依赖:
 *     - ./api: API基础服务
 *
 * 使用示例:
 *     - import { localStorageService } from './localStorage'
 *     - await localStorageService.saveFlowToFile(projectName, nodes, edges)
 *
 * 使用场景：
 *     - 项目数据的持久化存储
 */
import { NodeData, EdgeData } from '../types/canvas';
import { api } from './api';

class LocalStorageService {
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
