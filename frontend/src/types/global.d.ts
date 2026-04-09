/**
 * SoloEngine : 全局类型声明模块
 *
 * @file global.d.ts
 * @description 全局类型声明
 * @author Sh4rlock
 * @date 2026-04-09
 *
 * 功能描述：
 * 本模块定义全局类型声明，包括：
 *     - Agent类型预设全局变量
 *
 * 依赖:
 *     - ../services/toolsApi: 工具API服务
 *
 * 使用示例:
 *     - const presets = __AGENT_TYPE_PRESETS__
 */

import { AgentPreset } from '../services/toolsApi'

declare global {
  /**
   * Agent类型预设全局变量
   */
  const __AGENT_TYPE_PRESETS__: AgentPreset[]
}

export {}
