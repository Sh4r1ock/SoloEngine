/**
 * SoloEngine 编译产物与运行契约类型（无运行时行为）。
 *
 * 依据《SoloEngine 框架设计》§3.13 与 PRD-02 §6：一次运行 = 一棵确定的委派树。
 *
 * @module @soloengine/types
 */

// 运行上下文事件族与投影键（面板叠加所需；声明合并必须随包加载）。
export type {
  RunContextEventEntry, RunContextProjectionState, RunContextProjectionView, RunContextRecord, RunMode,
} from './run-context.ts'

// 工具呈现意图事件族与投影键（操作区联动所需；声明合并必须随包加载）。
export type {
  FollowCard, FollowEventEntry, FollowIntentRecord, FollowIntentView, FollowLocation,
  FollowProjectionState, FollowProjectionView,
} from './follow-intent.ts'

// 产品页面 URL 契约（宿主注册、面板深链、前端路由三面共用的唯一名单；根路径 `/` = 产品首页）。
export {
  HOME_ROUTE_ROOT, isProductPagePathname, matchProductRouteRoot, productPageRoute,
  PRODUCT_ROUTE_ROOTS, PRODUCT_SURFACE_PATHS, RUN_PANEL_PREFIX, RUN_ROUTE_ROOT,
} from './routes.ts'
export type { ProductPageName, ProductRouteMatch, ProductRouteRoot, ProductSurface } from './routes.ts'

// 画布节点种类与 agent 角色模板（节点只有 agent/note；角色只是预填模板）。
export { BUILTIN_ROLE_PRESETS, rolePresetName } from './presets.ts'
export type { AgentRolePreset, CanvasNodeKind } from './presets.ts'

/** 采样与轮次参数。 */
export interface SamplingParams {
  temperature?: number
  max_tokens?: number
  max_input_tokens?: number
  max_output_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  max_tool_calls?: number
}

/**
 * 一个 agent 作用域的插件行（画布节点级插件）。
 *
 * 节点级插件只作用于该节点对应的 agent 作用域：工具、技能、MCP、提示词之外的
 * 行为（例如自定义工具包、上下文注入、钩子）都经这一行声明。流程级插件
 * （Web 服务、存储、会话日志、检索）不在这里，它们全流程一份。
 */
export interface NodePluginRow {
  /** 节点内唯一行 id。 */
  id: string
  /** 插件包名（可带子路径）。 */
  name: string
  /** 插件配置。 */
  config?: unknown
  /**
   * 插件版本；用于「同一插件只能一个版本」的编译期校验。
   * 省略时不参与版本冲突判定（由装载器按包清单解析）。
   */
  version?: string
}

/** 单个 agent 的编译配置（每画布节点一个）。 */
export interface AgentSpec {
  /** 画布 node_id。 */
  agentId: string
  /** 节点名（模型可见的委派工具名来源）。 */
  name: string
  /** 角色模板 id（只用于呈现；入口由委派树拓扑决定）。 */
  role: string
  /** 模型路由名 `soloengine-<llm_config_id>`。 */
  modelRoute: string
  /** 该 agent 的 persona 文本（注入子会话创建窗口）。 */
  persona?: string
  /** 运行项目目录（沙箱根）。 */
  cwd: string
  /** tool-map 映射后的真实工具名（未映射项在编译期 fail loud）。 */
  tools: string[]
  /** 可见技能集合（编译期写死）。 */
  skills: string[]
  /** 编译期挂进该 agent scope 的 MCP 服务器名。 */
  mcpServers: string[]
  /** 编译期挂进该 agent scope 的插件行（节点级插件；流程级插件不在这里）。 */
  plugins: NodePluginRow[]
  /** 采样与轮次参数。 */
  sampling?: SamplingParams
}

/** 委派边（每条边 = 父节点工具表里的一个 Task 委派工具）。 */
export interface DelegationEdge {
  edgeId: string
  /** 上级节点 agentId。 */
  from: string
  /** 下级节点 agentId。 */
  to: string
  /** 委派工具名（父节点工具表内唯一）。 */
  toolName: string
}

/** 编译产物（内存中即时生成，不落中间产物文件）。 */
export interface CompileResult {
  /** 语义哈希（布局不参与）。 */
  canvasHash: string
  /** 不可变代际。 */
  revision: number
  /** 唯一入口节点。 */
  mainAgentId: string
  /** 每节点一个。 */
  agents: AgentSpec[]
  /** 委派边表。 */
  edges: DelegationEdge[]
  /** 编译期提示（如多协调者取最后创建的节点）。 */
  notices: string[]
}

/** 编译失败（fail loud）的机器可读错误码。 */
export type CompileFailureCode =
  | 'NO_ENTRY' | 'MULTIPLE_ENTRY_AMBIGUOUS' | 'MISSING_MODEL' | 'MISSING_REQUIRED'
  | 'UNKNOWN_TOOL' | 'CYCLIC_DELEGATION' | 'DUPLICATE_NODE' | 'EMPTY_CANVAS'
  | 'NODE_NAME_REQUIRED' | 'NODE_PLUGIN_INVALID' | 'CONFLICTING_PLUGIN_VERSION'

/** 编译失败的结构化错误。 */
export interface CompileFailure {
  code: CompileFailureCode
  /** 指明节点（若有）。 */
  nodeId?: string
  message: string
  /** 缺失项清单。 */
  missing?: string[]
}

/** 打包阶段的状态词表（框架、REST 与产品页共用同一份枚举）。 */
export type PackagingStageStatus = 'ok' | 'failed' | 'pending' | 'running'

/** 打包运行的状态词表（同上）。 */
export type PackagingRunStatus = 'completed' | 'failed' | 'pending' | 'running'

/**
 * 阶段/运行是否已到终态（只有 `pending` / `running` 还在途中）。
 *
 * 产品页的轮询停止条件与状态点渲染都经这一个判定，新增中间态时两端同时生效。
 * @param status - 阶段或运行状态。
 * @returns 是否终态。
 */
export function isTerminalStage(status: PackagingStageStatus | PackagingRunStatus): boolean {
  return status !== 'pending' && status !== 'running'
}

/** 工具名映射（画布工具名 → dsh 真实工具名）。 */
export const TOOL_MAP: Record<string, string> = {
  read_file: 'read',
  write_file: 'write',
  search_replace: 'edit',
  grep: 'grep',
  glob: 'glob',
  todo_write: 'todo_write',
  ask_user_question: 'ask_user_question',
  exit_plan_mode: 'exit_plan_mode',
  web_search: 'web_search',
  web_fetch: 'web_fetch',
  skill: 'skill',
  read: 'read',
  write: 'write',
  edit: 'edit',
  pwsh: 'pwsh',
  bash: 'bash',
  job_list: 'job_list',
  job_output: 'job_output',
  job_kill: 'job_kill',
  get_goal: 'get_goal',
  create_goal: 'create_goal',
  update_goal: 'update_goal',
  workflow: 'workflow',
  read_image: 'read_image',
  // SoloEngine 特有工具（自研，Host 面）：画布工具名与真实工具名同值。
  get_diagnostics: 'get_diagnostics',
  open_preview: 'open_preview',
  // 终端六件套（dsh 原生）：画布可选，模型显式操作指定终端会话。
  terminal_open: 'terminal_open',
  terminal_send: 'terminal_send',
  terminal_read: 'terminal_read',
  terminal_signal: 'terminal_signal',
  terminal_close: 'terminal_close',
  terminal_list: 'terminal_list',
  // 子代理控制（dsh 原生）：持续型子代理的续接与中断。
  send_message: 'send_message',
  interrupt_agent: 'interrupt_agent',
  list_agents: 'list_agents',
  // 创造模式（官方 dsh-tool-cordis）：**只读**运行时内省。定义/运行/撤销插件没有模型工具，
  // 由客户端创造面板经 `dynamicCordisRunner` 承担（插件持久化归插件管理器）。
  cordis_inspect_list: 'cordis_inspect_list',
  cordis_inspect_query: 'cordis_inspect_query',
}

/**
 * Windows 平台把 `run_command` 映射为 pwsh（非 Windows 映射 bash）。
 * @param platform - Node 报告的宿主平台。
 * @returns 该平台使用的命令工具名。
 */
export function mapRunCommand(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'pwsh' : 'bash'
}
