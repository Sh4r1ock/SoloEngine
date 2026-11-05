/**
 * 画布节点与 agent 角色模板（唯一真源）。
 *
 * 节点只有两种：`agent` 与 `note`（注释）。协调者 / 规划者 / 执行者不是节点类型，
 * 而是**预填模板**：选中模板只预填名称、简介、提示词与工具，节点本身仍是 agent。
 * 模板可在画布内无限新增（`CanvasSettings.rolePresets`），入口由委派树拓扑决定，
 * 与模板无关。
 *
 * @module @soloengine/types/presets
 */

/** 节点种类：agent 节点与注释节点。 */
export type CanvasNodeKind = 'agent' | 'note'

/** 一个 agent 角色模板（只预填配置，不改变节点种类）。 */
export interface AgentRolePreset {
  /** 模板 id（画布内唯一；内置模板用固定 id）。 */
  id: string
  /** 中文名称。 */
  name: string
  /** 英文名称。 */
  nameEn: string
  /** 一句话说明（预填到节点简介）。 */
  description: string
  /** 预填的系统提示词。 */
  systemPrompt: string
  /** 预填的工具清单。 */
  tools: string[]
  /** 内置模板不可删除；画布内新增的模板为 false。 */
  builtin: boolean
}

/** 内置角色模板：协调者 / 规划者 / 执行者 / 自定义（空白）。 */
export const BUILTIN_ROLE_PRESETS: readonly AgentRolePreset[] = [
  {
    id: 'coordinator',
    name: '协调者',
    nameEn: 'Coordinator',
    description: '理解目标、拆分任务、委派给下级 agent 并汇总结果',
    systemPrompt: 'You coordinate the team. Break the goal into delegated tasks and summarize results.',
    tools: ['read', 'glob', 'grep', 'todo_write'],
    builtin: true,
  },
  {
    id: 'planner',
    name: '规划者',
    nameEn: 'Planner',
    description: '勘察现状并产出可执行计划，交由下级执行',
    systemPrompt: 'You plan before acting. Inspect the workspace and produce an actionable plan.',
    tools: ['read', 'glob', 'grep', 'todo_write'],
    builtin: true,
  },
  {
    id: 'executor',
    name: '执行者',
    nameEn: 'Executor',
    description: '按收到的任务执行具体动作并回报结果',
    systemPrompt: 'You execute the assigned task and report the concrete result.',
    tools: ['read', 'write', 'edit', 'glob', 'grep', 'pwsh'],
    builtin: true,
  },
  {
    id: 'custom',
    name: '自定义',
    nameEn: 'Custom',
    description: '空白模板，自行填写名称、提示词与工具',
    systemPrompt: '',
    tools: [],
    builtin: true,
  },
]

/**
 * 取模板显示名（内置模板按语言取，自定义模板用用户填写的名称）。
 * @param preset - 模板。
 * @param locale - 当前语言。
 * @returns 显示名。
 */
export function rolePresetName(preset: AgentRolePreset, locale: 'zh' | 'en'): string {
  return locale === 'en' ? preset.nameEn : preset.name
}
