/**
 * SoloEngine : 工具预设类型模块
 *
 * @file toolsApi.ts
 * @description 仅保留画布工具预设类型 AgentPreset（被 Canvas/registry、presetsStore 引用）；
 *             原 toolsApi.getTools 调用的后端 /api/v1/tools 玩具工具端点已删除（R3/M12），
 *             无调用方的工具列表接口一并剪除。
 * @author Sh4rlock
 * @date 2026-04-09
 */

export interface AgentPreset {
  id: string;
  name: string;
  name_en: string;
  description: string;
  icon: string;
  color: string;
  tools: string[];
  skills: string[];
  mcp_tools: string[];
  mcp_servers?: string[];
  system_prompt: string;
}
