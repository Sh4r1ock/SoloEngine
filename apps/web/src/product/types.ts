/**
 * 框架层 REST 的视图类型（以 `soloengine-framework/src/modules/*.ts` 的真实字段为准）。
 */

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
}

/** 登录/刷新响应。 */
export interface AuthResult {
  ok: true
  accessToken: string
  refreshToken: string
  user: UserView
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
  tags: string | null
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
  files: string[]
  skippedRejected: string[]
}

/** 技能包内文件条目（`skills.ts` listFiles）。 */
export interface SkillFileEntry {
  path: string
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
  source: string | null
  created_at: string | null
  updated_at: string | null
  version: number
  is_active: boolean
  is_public: boolean
  stdio: McpStdioConfig | null
  http: McpHttpConfig | null
}

/** MCP 枚举到的工具。 */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

/** MCP 枚举到的资源/提示词。 */
export interface McpResourceInfo {
  uri: string
  name?: string
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
  prompts?: McpResourceInfo[]
}

/** MCP 工具试运行结果。 */
export interface McpCallResult {
  ok: boolean
  result?: unknown
  error?: string
}

/** 画布节点（`canvas.ts` CanvasNode）。 */
export interface CanvasNode {
  node_id: string
  agent_type: 'coordinator' | 'planner' | 'executor' | 'note'
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
  position: { x: number; y: number }
}

/** 画布委派边。 */
export interface CanvasEdge {
  edge_id: string
  from: string
  to: string
}

/** 画布全局设置。 */
export interface CanvasSettings {
  run_mode?: 'ask' | 'allowlist' | 'auto'
  live_follow?: boolean
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
  created_at: string | null
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
  source: string
}

/** 打包预览（契约 3）。 */
export interface PackagingPreview {
  bundles: string[]
  layers: { id: string; kind: string; summary: string }[]
  preset: { mainAgentId: string; agents: unknown[]; edges: unknown[] }
  canvasHash: string
  revision: number
  containsSecrets: false
}

/** 打包运行（契约 3）。 */
export interface PackagingRun {
  id: string
  status: string
  stages: { id: string; label: string; status: string; output: string }[]
  artifactPath: string
}

/** 部署引导（契约 4）。 */
export interface DeploymentGuide {
  target: string
  steps: { id: string; label: string; command: string; note: string }[]
  ready: { url: string; port: number }
}

/** 插件清单（契约 5）：`GET /plugins` 的真实响应体形状（rows/clientEntries 在顶层）。 */
export interface PluginsView {
  profile: { name: string; bundles: string[] }
  rows: { id: string; name: string; kind: 'host' | 'client'; disabled: boolean }[]
  clientEntries: string[]
  unresolved: string[]
}

/** 设置信封（契约 1）。 */
export interface SettingsEnvelope<T> {
  ok: true
  namespace: string
  value: T
  revision: number
}
