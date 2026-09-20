/**
 * 画布可用工具清单。
 *
 * 与 `@soloengine/types` 的 TOOL_MAP（画布工具名 → dsh 真实工具名）同值同集；
 * 前端不引用该包，故在此以数据常量复刻，改动该表时需同步。
 */
export const TOOL_OPTIONS: readonly string[] = [
  'read', 'write', 'edit', 'grep', 'glob', 'todo_write', 'ask_user_question', 'exit_plan_mode',
  'web_search', 'web_fetch', 'skill', 'run_command', 'pwsh', 'bash',
  'job_list', 'job_output', 'job_kill',
  'get_goal', 'create_goal', 'update_goal', 'workflow', 'lsp', 'read_image',
  'get_diagnostics', 'open_preview',
  'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list',
  'send_message', 'interrupt_agent', 'list_agents',
  'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
  'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
]

/** 三类 Agent 预设 + 注释。 */
export const AGENT_TYPES: readonly ('coordinator' | 'planner' | 'executor' | 'note')[] = [
  'coordinator', 'planner', 'executor', 'note',
]

/** 网格吸附步长（px）。 */
export const GRID_SIZE = 16

/** 节点外框宽度（与 editor.module.css 的 .node 宽度一致）。 */
export const NODE_WIDTH = 184

/** 吸附到网格。 */
export function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}
