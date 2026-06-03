/**
 * SoloEngine : 画布类型定义模块
 *
 * @file canvas.ts
 * @description 画布相关类型定义
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块定义画布相关的类型接口，包括：
 *     - 节点数据类型
 *     - 边数据类型
 *     - 画布数据类型
 *     - 全局设置类型
 *
 * 依赖:
 *     - 无
 *
 * 使用示例:
 *     - import { NodeData, EdgeData, CanvasData } from './canvas'
 *     - const node: NodeData = { id: '1', type: 'agent', position: { x: 0, y: 0 }, data: {} }
 */
import { MarkerType } from 'reactflow';

/**
 * 节点数据接口
 *
 * 属性:
 *     - id: 节点唯一标识
 *     - type: 节点类型（agent/annotation）
 *     - position: 节点位置坐标
 *     - data: 节点数据
 */
export interface NodeData {
  id: string;
  type: 'agent' | 'annotation';
  position: { x: number; y: number };
  data: {
    name?: string;
    desc?: string;
    agentType?: 'orchestrator' | 'planner' | 'executor' | 'custom';
    system_prompt?: string;
    model_config?: {
      llm_config_id?: string;
      temperature: number;
      max_tokens: number;
      frequency_penalty: number;
      presence_penalty: number;
    };
    skills?: string[];
    mcp_tools?: string[];
    mcp_servers?: string[];
    tools?: string[];
    text?: string;
    color?: string;
  };
}

/**
 * 边数据接口
 *
 * 属性:
 *     - id: 边唯一标识
 *     - source: 源节点ID
 *     - target: 目标节点ID
 *     - label: 边标签（可选）
 *     - selected: 是否被选中（可选）
 *     - animated: 是否显示动画（可选）
 */
export interface EdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
  selected?: boolean;
  animated?: boolean;
  markerEnd?: {
    type: MarkerType;
    width?: number;
    height?: number;
    color?: string;
    markerUnits?: string;
    orient?: string;
    strokeWidth?: number;
  };
}

/**
 * 全局设置接口
 *
 * 属性:
 *     - maxContextLength: 最大上下文长度
 *     - maxIterations: 最大迭代次数
 *     - timeout: 超时时间
 */
export interface GlobalSettings {
  maxContextLength: number;
  maxIterations: number;
  timeout: number;
}

/**
 * 画布数据接口
 *
 * 属性:
 *     - nodes: 节点列表
 *     - edges: 边列表
 *     - globalSettings: 全局设置（可选）
 */
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
