/**
 * 框架层 REST 的视图类型（以 `soloengine-framework/src/modules/*.ts` 的真实字段为准）。
 */
import type { AgentRolePreset, PackagingRunStatus, PackagingStageStatus } from '@soloengine/types'

export type { PackagingRunStatus, PackagingStageStatus } from '@soloengine/types'

/** 用户视图（`accounts.ts` UserView）。 */
export interface UserView {
  id: string
  username: string
  email: string | null
  is_active: boolean
  is_superuser: boolean
  created_at: string | null
  updated_at: string | null
  last_login: string | null
  version: number
  /** 实例内置账号（当前规则：`system`），不可停用/降级；当前登录账号另行按 id 判定。 */
  protected: boolean
}

/** 登录/刷新响应。 */
export interface AuthResult {
  ok: true
  accessToken: string
  refreshToken: string
  user: UserView
}

/** 归属资产计数（超管用户列表）。 */
export interface UserAssetCounts {
  canvases: number
  projects: number
  models: number
  skills: number
  mcpServers: number
  sessions: number
}

/** 用户行 + 归属资产计数（`GET /users`：扁平用户视图 + `assets`）。 */
export interface UserWithAssets extends UserView {
  assets: UserAssetCounts
}

/** 模型配置视图（`models.ts` LlmConfigView）。 */
export interface ModelView {
  id: string
  user_id: string
  name: string
  provider: string
  model_name: string
  base_url: string | null
  temperature: number | null
  max_tokens: number | null
  max_input_tokens: number | null
  max_output_tokens: number | null
  top_p: number | null
  frequency_penalty: number | null
  presence_penalty: number | null
  timeout: number | null
  max_tool_calls: number | null
  extra_params: string | null
  created_at: string | null
  updated_at: string | null
  version: number
  api_key_masked: string | null
  has_api_key: boolean
  /** 密钥状态：未配置 / 可解密 / 存在但解不开（需重填）。 */
  key_state: 'absent' | 'ok' | 'unreadable'
  is_full_url: boolean
  is_default: boolean
  is_active: boolean
  model_route: string
}

/** 模型连通性测试结果（`models.ts` ConnectivityResult）。 */
export interface ModelTestResult {
  ok: boolean
  provider?: string
  latency_ms?: number
  kind?: 'auth' | 'address' | 'timeout' | 'network' | 'response' | 'unknown'
  message?: string
  status?: number
}

/** 模型配置可写字段。 */
export interface ModelInput {
  name: string
  provider: string
  model_name: string
  api_key?: string
  base_url?: string
  is_full_url?: boolean
  temperature?: number
  max_tokens?: number
  max_input_tokens?: number
  max_output_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  timeout?: number
  max_tool_calls?: number
  extra_params?: string
  is_default?: boolean
  is_active?: boolean
  version?: number
}

/** 技能包视图（`skills.ts` SkillPackageView）。 */
export interface SkillView {
  id: string
  user_id: string | null
  name: string
  pkg_version: string
  description: string | null
  icon: string | null
  author: string
  /** 标签数组：后端把库里的 JSON 数组文本解析后返回（旧逗号串同样兼容）。 */
  tags: string[]
  /** 包内文件数（技能列表行展示）。 */
  file_count: number
  folder_path: string | null
  source: string | null
  created_at: string | null
  updated_at: string | null
  version: number
  is_active: boolean
  is_public: boolean
}

/** 技能导入预览（`skills.ts` SkillImportPreview）。 */
export interface SkillImportPreview {
  name: string
  version: string
  description: string | null
  author: string
  /** 预览文件条目：相对路径 + 字节数。 */
  files: { path: string; size: number }[]
  skippedRejected: string[]
  /** 预览内容指纹：确认阶段回传，源在预览后改动即被拒绝。 */
  fingerprint: string
}

/** 画布引用的资产可用性（`canvas.ts` availability）。 */
export interface CanvasAvailabilityNode {
  node_id: string
  node_name: string
  skills: { ref: string; name: string | null; state: 'ok' | 'missing' | 'disabled' }[]
  mcp_servers: { ref: string; state: 'ok' | 'missing' | 'disabled' }[]
}

/** 画布逐节点的引用可用性。 */
export interface CanvasAvailability {
  nodes: CanvasAvailabilityNode[]
}

/** 技能包内文件条目（`skills.ts` listFiles）。 */
export interface SkillFileEntry {
  path: string
  /** 文件字节数。 */
  size: number
  text: string | null
}

/** MCP 传输子表（stdio）。 */
export interface McpStdioConfig {
  mcp_server_id: string
  command: string | null
  args: string | null
  env: string | null
  folder_path: string | null
  working_dir: string | null
  /** 连接/单次请求超时（秒；NULL 按默认 30 秒）。 */
  timeout: number | null
}

/** MCP 传输子表（http）。 */
export interface McpHttpConfig {
  mcp_server_id: string
  url: string | null
  headers: string | null
  timeout: number | null
  session_id: string | null
}

/** MCP 服务器视图（`mcp.ts` McpServerView）。 */
export interface McpServerView {
  id: string
  user_id: string | null
  name: string
  transport_type: string
  source_type: string | null
  description: string | null
  icon: string | null
  author: string | null
  tags: string | null
  tools: string | null
  /** 已停用的工具名（PRD-05 FR-MCP-008 单工具启停）。 */
  disabledTools?: string[]
  /** 上次枚举缓存的能力列（JSON 数组文本；从未枚举时为 null）。 */
  resources: string | null
  prompts: string | null
  source: string | null
  created_at: string | null
  updated_at: string | null
  version: number
  /** 最近一次连接测试结果（null = 从未测试）。 */
  last_test_ok: boolean | null
  /** 最近一次失败归因类别。 */
  last_test_kind: string | null
  /** 最近一次测试时间（ISO）。 */
  last_tested_at: string | null
  /** 最近一次测试耗时（毫秒；null = 未记录）。 */
  last_test_ms: number | null
  /** 可解析的包版本（上传包 package.json / npx、uvx 命令规格）；解析不出时为 null。 */
  package_version: string | null
  is_active: boolean
  is_public: boolean
  stdio: McpStdioConfig | null
  http: McpHttpConfig | null
}

/** 服务器文件清单的呈现方式。 */
export type McpFilesMode = 'editable' | 'readonly' | 'none'

/** 文件清单为空或只读的原因（码值由页面本地化）。 */
export type McpFilesReason = 'http_transport' | 'directory_missing'

/** 服务器文件条目。 */
export interface McpServerFileEntry {
  path: string
  bytes: number
  text: boolean
}

/** 服务器文件清单视图（`GET /mcp/:id/files` 的 `listing`）。 */
export interface McpServerFilesView {
  mode: McpFilesMode
  reason: McpFilesReason | null
  /** 列出的目录绝对路径；none 时为 null。 */
  directory: string | null
  /** 只读清单超过条目上限。 */
  truncated: boolean
  files: McpServerFileEntry[]
}

/** MCP 枚举到的工具。 */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

/** MCP 枚举到的资源。 */
export interface McpResourceInfo {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

/** MCP 枚举到的资源模板。 */
export interface McpResourceTemplateInfo {
  uriTemplate: string
  name?: string
  description?: string
  mimeType?: string
}

/** MCP 枚举到的提示词。 */
export interface McpPromptInfo {
  name: string
  description?: string
}

/** MCP 测试/枚举结果（`mcp.ts` McpTestResult）。 */
export interface McpTestResult {
  ok: boolean
  kind?: 'command_missing' | 'spawn_failed' | 'handshake_failed' | 'address_unreachable' | 'auth_failed' | 'timeout' | 'unknown'
  message?: string
  latency_ms?: number
  serverInfo?: { name?: string; version?: string }
  tools?: McpToolInfo[]
  resources?: McpResourceInfo[]
  resourceTemplates?: McpResourceTemplateInfo[]
  prompts?: McpPromptInfo[]
}

/** 试运行入参的字段级违规（文案由前端本地化）。 */
export interface McpArgumentViolation {
  path: string
  kind: 'required' | 'type' | 'other'
}

/** MCP 工具试运行结果。 */
export interface McpCallResult {
  ok: boolean
  result?: unknown
  error?: string
  errorCode?: 'INVALID_ARGUMENTS' | 'TOOLS_NOT_ENUMERATED'
  violations?: McpArgumentViolation[]
}

/** 画布节点（`canvas.ts` CanvasNode）：只有 agent 与注释两种，角色是模板引用。 */
export interface CanvasNode {
  node_id: string
  kind: 'agent' | 'note'
  /** 角色模板 id（agent 节点必有；注释节点没有）。 */
  role?: string
  name: string
  summary?: string
  model_ref?: string
  system_prompt?: string
  tools?: string[]
  skills?: string[]
  mcp_servers?: string[]
  sampling?: {
    temperature?: number
    max_tokens?: number
    max_input_tokens?: number
    max_output_tokens?: number
    frequency_penalty?: number
    presence_penalty?: number
    max_tool_calls?: number
  }
  /** 节点级插件行：只挂进该 agent 作用域（流程级插件不在这里）。 */
  plugins?: NodePluginRowView[]
  position: { x: number; y: number }
}

/** 节点级插件行（与编译器 `NodePluginRow` 同形）。 */
export interface NodePluginRowView {
  /** 行 id；缺省时由编译器按节点与包名生成。 */
  id?: string
  /** 插件包名（必须能被组合层解析）。 */
  name: string
  /** 该行的插件配置。 */
  config?: unknown
}

/** 画布委派边。 */
export interface CanvasEdge {
  edge_id: string
  from: string
  to: string
}

/** 实例插件差异（画布定制 → 当前 flow 的插件集合；宿主侧只接受客户端行的 disable）。 */
export interface InstancePluginDiff {
  disable?: string[]
  replace?: { id: string; name: string; config?: unknown }[]
  add?: { id: string; name: string; config?: unknown; isolate?: string[] }[]
  configure?: { id: string; config: unknown }[]
}

/** 画布全局设置。 */
export interface CanvasSettings {
  /** 运行档位 = 原生权限预设名（工作区可写 / 白名单自动 / 完全访问）。 */
  run_mode?: 'workspace-write' | 'approve-for-me' | 'danger-full-access'
  live_follow?: boolean
  /** 画布内自定义角色模板（内置模板在 `@soloengine/types`，这里只存用户新增的）。 */
  role_presets?: AgentRolePreset[]
  /** 实例插件差异（Plan W3/W4：运行面板只装载该画布启用的客户端插件）。 */
  plugins?: InstancePluginDiff
}

/** 组合与插件清单行（`GET /plugins`）。 */
export interface PluginRow {
  id: string
  name: string
  kind: 'host' | 'client'
  disabled: boolean
}

/** 画布数据。 */
export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  settings?: CanvasSettings
}

/** 画布视图（`canvas.ts` CanvasView）。 */
export interface CanvasView {
  id: string
  user_id: string
  name: string
  description: string | null
  icon: string | null
  tags: string[]
  folder_path: string | null
  is_template: boolean
  is_active: boolean
  created_at: string | null
  updated_at: string | null
  version: number
  canvas: CanvasData
}

/** 运行项目行（`canvas.ts` RunProjectRow）。 */
export interface RunProjectView {
  id: string
  user_id: string
  agentic_flow_id: string
  name: string
  folder_path: string
  description: string | null
  is_active: number
  last_accessed_at: string | null
  created_at: string | null
  updated_at: string | null
  version: number
}

/** 运行会话视图（`runs.ts` RunSessionView）。 */
export interface RunSessionView {
  session_key: string
  user_id: string
  agentic_flow_id: string
  run_project_id: string
  llm_config_id: string | null
  status: string
  error: string | null
  /** 后端为 epoch 毫秒数（runs.ts SessionLedgerRow 直通），非 ISO 字符串。 */
  created_at: number
  duration_ms: number | null
  live: boolean
  main_agent_id: string | null
  panel_path: string
}

/** 用量聚合（`runs.ts` usage.byModel）。 */
export interface ModelUsageRow {
  llm_config_id: string
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** 请求耗时合计（毫秒，`step/start` → `assistant/message`；0 表示尚无计时数据）。 */
  durationMs: number
  /** 平均请求耗时（毫秒）。 */
  avgMs: number
  /** 请求耗时中位数（毫秒）。 */
  p50Ms: number
  /** 请求耗时 p95（毫秒）。 */
  p95Ms: number
}

/** 用量统计窗口（最近 N 个会话 / 该用户会话总数）。 */
export interface ModelUsageWindow {
  limit: number
  total: number
}

/** 市场条目（契约 2）。 */
export interface MarketEntry {
  id: string
  kind: 'skill' | 'mcp'
  name: string
  version: string
  author: string
  description: string
  tags: string[]
  categories: string[]
  featured: boolean
  installs: number
  /** 当前用户本地清单里是否已有同名资产（后端按落库名判定）。 */
  installed: boolean
  source: string
}

/** 打包预览（契约 3）。 */
export interface PackagingPreview {
  bundles: string[]
  layers: { id: string; kind: string; summary: string; source: string; path: string }[]
  preset: { mainAgentId: string; agents: unknown[]; edges: unknown[] }
  /** 入口节点（产物默认预设）的名称；来自服务端编译产物。 */
  presetName: string
  /** 实例净组合（profile 基线 + 画布插件差异）。 */
  instance: {
    rows: { id: string; name: string; kind: string; disabled: boolean; origin: string }[]
    diff: { disable?: string[]; replace?: unknown[]; add?: unknown[]; configure?: unknown[] }
  }
  /** 随产物携带的非平台插件包与目标机提供的平台包（同一份闭包清单）。 */
  dependencies: {
    packages: { name: string; version: string }[]
    /** 平台包及其清单版本（由目标机 dsh 安装提供）。 */
    platformProvided: { name: string; version: string }[]
  }
  /** 桌面形态的收尾发行命令（运行后服务端补本次运行的环境变量）。 */
  desktopCommand: string
  canvasHash: string
  revision: number
  /** 打包预览保证不含密钥；保留 boolean 形状以匹配线上字段语义。 */
  containsSecrets: boolean
}

/** 打包运行（契约 3）。 */
export interface PackagingRun {
  id: string
  /** 与框架共用 `@soloengine/types` 的状态词表。 */
  status: PackagingRunStatus
  /** 产物形态：profile 发行 / 桌面应用（发行流水线暂存）。 */
  form: 'profile' | 'desktop'
  stages: { id: string; label: string; status: PackagingStageStatus; output: string }[]
  artifactPath: string
  /** 桌面形态的暂存结果（仅 form === 'desktop'）。 */
  desktop?: {
    profileDir: string
    /** 桌面 profile 名（`profileDir` 的末段）。 */
    profileName: string
    appId: string
    buildReady: boolean
    command: string
    output: string
    /** 页面一键触发的发行封装进度（未触发过则缺省）。 */
    build?: {
      status: 'running' | 'completed' | 'failed'
      startedAt: string
      finishedAt?: string
      command: string
      output: string
      /** 真实存在的安装包与免安装目录绝对路径。 */
      artifacts: string[]
    }
  }
}

/** 部署引导（契约 4）。 */
export interface DeploymentGuide {
  target: string
  /** 真实运行值（基线组合、主机/端口、信任域声明主机、dsh home 与业务库）。 */
  config: {
    baseline: string[]
    host: string
    port: number
    trustedHosts: string[]
    dshHome: string
    database: string
  }
  steps: { id: string; label: string; command: string; note: string }[]
  ready: { url: string; port: number }
}

/** 插件清单（契约 5）：`GET /plugins` 的真实响应体形状（rows/clientEntries 在顶层）。 */
export interface PluginsView {
  profile: {
    name: string
    bundles: string[]
    /** 每个 bundle 的组合行计数（与 `bundles` 同序同名）。 */
    bundleCounts: { name: string; description: string | null; hostCount: number; clientCount: number }[]
  }
  rows: { id: string; name: string; kind: 'host' | 'client'; disabled: boolean; version: string | null }[]
  clientEntries: string[]
  /** 未解析条目：包名 + 具体原因。 */
  unresolved: { name: string; reason: string }[]
}

/** 一条 profile 组合包（`GET /plugins/bundles`）。 */
export interface ManagedBundleView {
  name: string
  version: string | null
  description: string | null
  enabled: boolean
  installed: boolean
  removable: boolean
  official: boolean
  optional: boolean
  readOnlyReason: string | null
  error: { code: string; diagnostic: string | null } | null
  rowCount: number
}

/** 一次插件管理操作的结果（`POST /plugins/*`）。 */
export interface PluginChangeView {
  changed: boolean
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  restartReason: string | null
  stage: 'install' | 'enable' | 'remove'
  target: string
  enabled: boolean | null
  error: { code: string; diagnostic: string | null; incompatible: { name: string; version: string; runtimeVersion: string }[] } | null
  warnings: string[]
  bundle: string | null
  version: string | null
  pendingBuilds: string[]
  registries: (string | null)[]
  failedAt: 'registry' | 'spec-host' | null
}

/** 安装规格检查结果（`POST /plugins/inspect`）。 */
export type PluginInspectionView =
  | {
    status: 'accepted'
    kind: 'registry' | 'path' | 'git' | 'tarball'
    name: string | null
    version: string | null
    description: string | null
    bundle: boolean | null
    registry: string | null
  }
  | {
    status: 'refused'
    problem: 'invalid-spec' | 'already-installed' | 'not-found' | 'not-a-package' | 'not-a-bundle' | 'network' | 'unknown'
    reason: string
    registries: (string | null)[]
  }

/** 设置信封（契约 1）。 */
export interface SettingsEnvelope<T> {
  ok: true
  namespace: string
  value: T
  revision: number
}
