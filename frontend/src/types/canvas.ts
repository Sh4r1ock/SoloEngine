export interface NodeData {
  id: string;
  type: 'agent';
  position: { x: number; y: number };
  data: {
    name: string;
    desc?: string;
    agentType: 'orchestrator' | 'planner' | 'executor';
    system_prompt: string;
    user_prompt: string;
    assistant_prompt: string;
    model_config: {
      provider: string;
      model: string;
    };
    skills: string[];
  };
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CanvasData {
  nodes: NodeData[];
  edges: EdgeData[];
}

export interface ProjectData {
  id: string;
  name: string;
  canvas: CanvasData;
}

export interface ToolData {
  id: string;
  name: string;
  description: string;
}

export interface WebSocketEvent {
  type: 'agent-update' | 'tool-call' | 'response-streaming' | 'execution-complete' | 'error';
  node_id?: string;
  status?: string;
  message?: string;
  task_id?: string;
  result?: any;
}

export interface AgentType {
  value: 'orchestrator' | 'planner' | 'executor';
  label: string;
  color: string;
  desc: string;
}
