export interface NodeData {
  id: string;
  type: 'agent' | 'annotation';
  position: { x: number; y: number };
  data: {
    name?: string;
    desc?: string;
    agentType?: 'orchestrator' | 'planner' | 'executor' | 'custom';
    system_prompt?: string;
    user_prompt?: string;
    assistant_prompt?: string;
    llm_config_id?: string;
    model_config?: {
      config_id?: string;
      config_name?: string;
      provider: string;
      model: string;
      temperature?: number;
      max_tokens?: number;
      frequency_penalty?: number;
      presence_penalty?: number;
    };
    skills?: string[];
    mcp_tools?: string[];
    tools?: string[];
    memory?: boolean;
    text?: string;
    color?: string;
  };
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface GlobalSettings {
  maxContextLength: number;
  maxIterations: number;
  timeout: number;
}

export interface CanvasData {
  nodes: NodeData[];
  edges: EdgeData[];
  globalSettings?: GlobalSettings;
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
  session_id?: string;
  result?: any;
}

export interface AgentType {
  value: 'orchestrator' | 'planner' | 'executor';
  label: string;
  color: string;
  desc: string;
}
