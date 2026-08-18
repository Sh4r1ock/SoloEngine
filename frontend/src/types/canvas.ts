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
      max_output_tokens: number;
      max_input_tokens: number;
      frequency_penalty: number;
      presence_penalty: number;
      /** 工具调用轮次：一次 react_core 循环中 agent 允许调用 LLM API 的次数上限（默认值来自 llm_config，写入画布） */
      max_tool_calls?: number;
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
 * 全局设置接口（agenticflow 画布设置）
 *
 * 说明：maxContextLength / maxIterations / timeout 等 agent 级参数
 * 已迁移至 LLM 配置（llm_config 默认值 → 画布节点 model_config → canvas_data），
 * 此处仅保留画布级运行行为设置。
 */
export interface GlobalSettings {
  /**
   * 命令运行模式（agenticflow 画布设置）：
   * - 'auto'：自动运行，命令直接执行（等价 Claude Code bypassPermissions / Cursor Run Everything）
   * - 'ask'：每次询问，所有命令执行前请求用户批准（等价 Claude Code default / Cursor Ask）
   * - 'allowlist'：白名单模式，白名单内命令自动执行，白名单外请求用户批准（等价 Cursor Allowlist）
   */
  runMode?: 'auto' | 'ask' | 'allowlist';
  /** 命令白名单（命令前缀列表，用户可自行添加；仅 allowlist 模式生效） */
  commandAllowlist?: string[];
  /**
   * 实时跟随（agentic 操作区联动）：
   * - true（默认）：工具调用时 agentic 操作区自动跳转到对应标签页（终端/编辑器/文档/浏览器）
   * - false：只打开对应页面与文件，不强制跳转（保留用户当前查看的标签页）
   */
  followMode?: boolean;
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

export interface AgentType {
  value: 'orchestrator' | 'planner' | 'executor';
  label: string;
  color: string;
  desc: string;
}
