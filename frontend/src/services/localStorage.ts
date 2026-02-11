import { NodeData, EdgeData } from '../types/canvas';
import axios from 'axios';

const SAVE_API_BASE_URL = 'http://localhost:8901/api/v1';

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

export interface SavedFlow {
  project_name: string;
  nodes: SavedNode[];
  saved_at: string;
}

class LocalStorageService {
  private readonly STORAGE_KEY = 'agentic_flows';

  saveFlow(projectName: string, nodes: NodeData[], edges: EdgeData[]): void {
    const savedNodes: SavedNode[] = nodes.map(node => {
      const incomingEdges = edges.filter(e => e.target === node.id);
      const outgoingEdges = edges.filter(e => e.source === node.id);

      return {
        node_id: node.id,
        node_name: node.data.name,
        node_intro: node.data.desc,
        agent_type: node.data.agentType,
        position: node.position,
        system_prompt: node.data.system_prompt,
        user_prompt: node.data.user_prompt,
        assistant_prompt: node.data.assistant_prompt,
        model_config: node.data.model_config,
        skills: node.data.skills,
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
      const response = await axios.post(`${SAVE_API_BASE_URL}/save-flow`, {
        project_name: projectName,
        nodes: nodes,
        edges: edges,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to save flow to file:', error);
      throw error;
    }
  }
}

export const localStorageService = new LocalStorageService();
