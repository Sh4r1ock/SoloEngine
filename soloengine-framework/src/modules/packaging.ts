/**
 * 打包与部署域：把画布的现场编译产物落成可核对的产物目录，并给出本地部署指引。
 *
 * - 预览复用 `CanvasService.compile`（与运行同一条编译逻辑，不落中间产物）；
 * - `bundles` 真实读取 profile 清单 `data/dsh-home/profiles/soloengine/package.json`
 *   的 `dsh.profile.bundles`；`layers` 真实解析 `packages/soloengine/host/cordis.patch.yml`
 *   的 `insert` 行与顶层 `- id:` 覆盖行；
 * - 落盘只写 `preset.json` / `profile.json` / `MANIFEST.txt` 三件产物，**不写任何密钥**；
 *   产物内出现疑似密钥键名即 fail loud（PACKAGING_SECRET_DETECTED）；
 * - 读回端点重新读取真实产物目录并重算文件数与字节数，不缓存、不兜底。
 *
 * @module @soloengine/framework/modules/packaging
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import yaml from 'js-yaml'
import type { AgentSpec, CompileResult } from '@soloengine/types'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'
import type { McpServerRow } from './mcp.ts'
import { parsePatchDocument } from './plugins.ts'

/** 组合层的一行（供预览与产物核对）。 */
export interface PackagingLayer {
  id: string
  kind: 'insert' | 'patch'
  summary: string
}

/** 打包预览。 */
export interface PackagingPreview {
  bundles: string[]
  layers: PackagingLayer[]
  preset: { mainAgentId: string; agents: unknown[]; edges: unknown[] }
  /** 将进入产物的 profile 概要（每节点一个 agent 预设，入口节点为默认预设）。 */
  profile: { entryPresetId: string; presetIds: string[] }
  canvasHash: string
  revision: number
  containsSecrets: false
}

/** 打包阶段。 */
export interface PackagingStage {
  id: string
  label: string
  status: 'ok'
  output: string
}

/** 一次打包运行。 */
export interface PackagingRun {
  id: string
  status: string
  stages: PackagingStage[]
  artifactPath: string
  /** 产物内 profile 目录（FR-DEP-005「固化为 profile」的落点）。 */
  profilePath: string
  /** 每节点预设 id（按编译产物节点顺序）。 */
  presetIds: string[]
  /** 入口节点的预设 id（roster 默认预设）。 */
  entryPresetId: string
}

/** 部署指引。 */
export interface DeploymentGuide {
  target: 'local' | 'server'
  /** 关键配置摘要（真实运行值：基线组合、端口/主机、信任域、dsh home 与业务库）。 */
  config: {
    baseline: string[]
    host: string
    port: number
    trustDomain: string
    dshHome: string
    database: string
  }
  steps: { id: string; label: string; command: string; note: string }[]
  ready: { url: string; port: number }
}

/** 产物文件名（固定三件）。 */
const PRESET_FILE = 'preset.json'
const PROFILE_FILE = 'profile.json'
const MANIFEST_FILE = 'MANIFEST.txt'

/** 疑似密钥的 JSON 键名（产物内出现即拒绝）。 */
const SECRET_KEY_PATTERN = /"(?:api_key|apiKey|api_secret|apiSecret|password|secret|access_token|accessToken|refresh_token|refreshToken)"\s*:/i

// ── 固化为 profile（PRD-11 FR-DEP-005/007/010）──────────────────────────────
//
// 产物除人可核对的 `preset.json`/`profile.json`/`MANIFEST.txt` 外，另写出一份**真实可装入
// 任意 dsh 运行面的 profile 目录**：组合清单（`package.json` 的 `dsh.profile.bundles`）、
// 配置层（组合层的 `cordis.patch.yml` 逐行照抄 + 入口节点为默认预设的 roster 行）、
// 以及**每个画布节点一个 agent 预设**（`.agent-presets/<节点 id>/agent.cordis.yml`）。
//
// 预设行不重写平台文本：逐行取自**随附 preset 的真实组合文件**（`standard`），按该节点的
// 工具集过滤后落盘——这样产物里的行名、行内取值与平台当前发行保持一致，不会漂移。唯一被
// 替换的行是 `persona`：它的 `prefix` 是该画布节点的系统提示词（编译产物的事实）。

/** 产物内的 profile 目录名。 */
const PROFILE_SUBDIR = 'profile'
/** 产物内 profile 的 agent 预设目录（与平台用户预设根同名，便于整体复制到 `$DSH_HOME/.agent-presets`）。 */
const PRESET_SUBDIR = '.agent-presets'
/** agent 预设 id 的合法形态（平台同一条边界：它成为路径段）。 */
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
/** 随附 preset 的组合文件名（平台 `COMPOSITION_FILE`）。 */
const PRESET_COMPOSITION_FILE = 'agent.cordis.yml'
/** 随附 preset 的显示元数据文件名（平台 `METADATA_FILE`）。 */
const PRESET_METADATA_FILE = 'preset.yml'

/** 一个 agent 预设的组合行。 */
type PresetRow = Record<string, unknown> & { id: string; name: string }

/**
 * 工具名 → 承载它的预设行 id（行名与注册点按各包真实注册：`tool-fs` 注册
 * read/write/edit/read_image，`tool-fs-search` 注册 grep/glob，`tool-jobs` 注册 job_*，
 * `tool-goal` 注册 *_goal，`tool-subagent-control` 注册 send_message/interrupt_agent，
 * 其 `list-agents` 子路径注册 list_agents）。
 *
 * 宿主平面行承载的工具（终端六件套 / 创造模式 / SoloEngine 自研工具，均由组合层插入）
 * 不在本表：它们对所有 agent 可见，不按节点重述（行粒度事实写入产物 MANIFEST）。
 */
const TOOL_ROW: Record<string, string> = {
  read: 'tool-fs',
  write: 'tool-fs',
  edit: 'tool-fs',
  read_image: 'tool-fs',
  grep: 'tool-fs-search',
  glob: 'tool-fs-search',
  todo_write: 'tool-todo',
  ask_user_question: 'tool-ask-user',
  exit_plan_mode: 'plan-mode',
  web_search: 'tool-web',
  web_fetch: 'tool-web',
  skill: 'tool-skill',
  bash: 'tool-bash',
  pwsh: 'tool-pwsh',
  job_list: 'tool-jobs',
  job_output: 'tool-jobs',
  job_kill: 'tool-jobs',
  get_goal: 'tool-goal',
  create_goal: 'tool-goal',
  update_goal: 'tool-goal',
  workflow: 'tool-workflow',
  lsp: 'tool-lsp',
  send_message: 'tool-subagent-control',
  interrupt_agent: 'tool-subagent-control',
  list_agents: 'tool-subagent-list-agents',
}

/** 宿主平面（组合层已插入）承载的工具：产物不再按节点重述。 */
const HOST_PLANE_TOOLS: readonly string[] = [
  'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list',
  'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
  'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
  'get_diagnostics', 'open_preview',
]

/** 随附组合里没有行、但平台确有该包的行（取值来自仓库内组合快照 `snapshots/session/lsp-definition/cordis.yml`）。 */
const EXTRA_ROWS: Record<string, PresetRow> = {
  'tool-lsp': { id: 'tool-lsp', name: '@deepseek-ai/dsh-tool-lsp', config: { maxLocations: 1 } },
}

/** `!!js` 表达式节点（平台 `entryListSchema` 的同一判定；本模块不解释它，只拒绝静默丢弃）。 */
interface JsExpression {
  __jsExpr: string
}

/** 平台方言：`!!js` 标量解析为表达式节点（与 `@deepseek-ai/cordis-plugin-include` 同形）。 */
const jsExpressionType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data: unknown) => typeof data === 'string',
  construct: (data: string): JsExpression => ({ __jsExpr: data }),
})

/** 判定一个值是否是 `!!js` 表达式节点。 */
function isJsExpression(value: unknown): value is JsExpression {
  return typeof value === 'object' && value !== null && typeof (value as JsExpression).__jsExpr === 'string'
}

/** 平台方言 schema（`!!js` 可解析），与随附 preset 的读取同一条。 */
const presetRowSchema = yaml.JSON_SCHEMA.extend(jsExpressionType)

/**
 * 行 id → 该行注册的工具名（与 {@link TOOL_ROW} 同源；随附 preset 里存在但画布工具表
 * 触达不到的行也在此列，用于把它们按覆盖规则排除——例如 `subagent`/`ralph`）。
 */
const ROW_TOOLS: Record<string, readonly string[]> = {
  'tool-bash': ['bash'],
  'tool-pwsh': ['pwsh'],
  'tool-fs': ['read', 'write', 'edit', 'read_image'],
  'tool-fs-search': ['grep', 'glob'],
  'tool-jobs': ['job_list', 'job_output', 'job_kill'],
  'tool-skill': ['skill'],
  'tool-goal': ['get_goal', 'create_goal', 'update_goal'],
  'tool-subagent-control': ['send_message', 'interrupt_agent'],
  'tool-subagent-list-agents': ['list_agents'],
  'tool-subagent': ['subagent'],
  'tool-subagent-fork': ['subagent_fork'],
  'tool-subagent-codex': ['subagent_codex'],
  'tool-subagent-claude-code': ['subagent_claude_code'],
  'tool-workflow': ['workflow'],
  'tool-ralph': ['ralph'],
  'tool-ask-user': ['ask_user_question'],
  'tool-todo': ['todo_write'],
  'tool-web': ['web_search', 'web_fetch'],
  present: ['present'],
  'plan-mode': ['exit_plan_mode'],
  'tool-lsp': ['lsp'],
}

/** 解析一个 JSON 数组列（非法即 fail loud：产物不猜不吞）。 */
function parseJsonArray(text: string): unknown[] {
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) {
    throw new FrameworkError(500, 'PACKAGING_COLUMN_INVALID', `expected a JSON array column, got ${JSON.stringify(parsed)}`)
  }
  return parsed
}

/** 解析一个 JSON 对象列（非法即 fail loud）。 */
function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new FrameworkError(500, 'PACKAGING_COLUMN_INVALID', `expected a JSON object column, got ${JSON.stringify(parsed)}`)
  }
  return parsed as Record<string, unknown>
}

/**
 * 从某个锚点向上逐级找 `node_modules/<包>/package.json`，返回包目录
 * （Node 自己的查找顺序；平台 `packageInstalled` 用同一条 walk）。
 * @param name - 包名（可带子路径，按包名部分判定）。
 * @param anchor - 起始目录。
 * @returns 包目录，或 undefined。
 */
function packageDirFrom(name: string, anchor: string): string | undefined {
  const pkg = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')
  let dir = anchor
  for (;;) {
    const candidate = join(dir, 'node_modules', pkg)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** 一个目录里的普通文件（按名排序；目录本身不计入）。 */
function listRegularFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name).sort()
}

/** 一棵目录树里的全部文件（相对给定根的路径，按名排序；用于读回校验与密钥扫描）。 */
function listFilesRecursive(root: string, prefix = ''): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : join(prefix, entry.name)
    if (entry.isDirectory()) found.push(...listFilesRecursive(root, relative))
    else found.push(relative)
  }
  return found.sort()
}

/** 产物 profile 的固化结果。 */
export interface MaterializedProfile {
  /** profile 目录绝对路径。 */
  dir: string
  /** 每节点预设的 id（按编译产物节点顺序）。 */
  presetIds: string[]
  /** 入口节点的预设 id（roster 的默认预设）。 */
  entryPresetId: string
  /** 写出的文件相对 profile 目录的路径清单。 */
  files: string[]
}

/** 打包与部署服务。 */
export class PackagingService {
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时（画布服务与数据根）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
  }

  /** profile 清单绝对路径。 */
  private profilePath(): string {
    return join(this.runtime.dataDir, 'dsh-home', 'profiles', 'soloengine', 'package.json')
  }

  /** 组合层文件绝对路径。 */
  private hostPatchPath(): string {
    return join(this.runtime.root, 'packages', 'soloengine', 'host', 'cordis.patch.yml')
  }

  /** 读取 profile 的 bundle 层清单（缺失/缺键即报错）。 */
  private readBundles(): string[] {
    const path = this.profilePath()
    if (!existsSync(path)) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING', `dsh profile manifest ${path} does not exist`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING', `dsh profile manifest ${path} is not valid JSON: ${String(error)}`)
    }
    const bundles = (parsed as { dsh?: { profile?: { bundles?: unknown } } } | null)?.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || bundles.length === 0) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING', `dsh profile manifest ${path} declares no dsh.profile.bundles`)
    }
    return bundles.map(item => {
      if (typeof item !== 'string') {
        throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING', `dsh profile manifest ${path} has a non-string bundle entry`)
      }
      return item
    })
  }

  /** 解析 host 组合层为行摘要（insert 行 + 顶层覆盖行）。 */
  private readLayers(): PackagingLayer[] {
    const path = this.hostPatchPath()
    if (!existsSync(path)) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING', `cordis patch layer ${path} does not exist`)
    }
    return parsePatchDocument(readFileSync(path, 'utf8'), path).map(row => ({
      id: row.id,
      kind: row.inserted ? 'insert' : 'patch',
      summary: row.inserted ? (row.name ?? row.id) : `override ${row.keys.join(',')}`,
    }))
  }

  /**
   * 打包预览：现场编译 + 真实读取 bundle 层与组合层。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param projectId - 运行项目 ID。
   * @returns 预览。
   */
  async preview(userId: string, canvasId: string, projectId: string): Promise<PackagingPreview> {
    const compiled = await this.runtime.canvas.compile(userId, canvasId, projectId)
    return {
      bundles: this.readBundles(),
      layers: this.readLayers(),
      preset: { mainAgentId: compiled.mainAgentId, agents: compiled.agents, edges: compiled.edges },
      profile: { entryPresetId: compiled.mainAgentId, presetIds: compiled.agents.map(agent => agent.agentId) },
      canvasHash: compiled.canvasHash,
      revision: compiled.revision,
      containsSecrets: false,
    }
  }

  /**
   * 真实执行一次打包：编译 → 落盘产物 → 读回校验。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param projectId - 运行项目 ID。
   * @param confirm - 必须为 true（显式确认）。
   * @returns 运行结果（含三段真实输出）。
   */
  async run(userId: string, canvasId: string, projectId: string, confirm: unknown): Promise<PackagingRun> {
    if (confirm !== true) {
      throw new FrameworkError(400, 'PACKAGING_CONFIRM_REQUIRED', 'packaging run requires body { confirm: true }')
    }
    const compiled = await this.runtime.canvas.compile(userId, canvasId, projectId)
    const bundles = this.readBundles()
    const layers = this.readLayers()
    const id = newId()
    const artifactPath = join(this.runtime.dataDir, 'packaging', id)

    const compileStage: PackagingStage = {
      id: 'compile',
      label: '现场编译画布',
      status: 'ok',
      output: `compiled canvas ${canvasId} (project ${projectId}) → agents=${String(compiled.agents.length)} edges=${String(compiled.edges.length)} hash=${compiled.canvasHash} revision=${String(compiled.revision)}`,
    }

    mkdirSync(artifactPath, { recursive: true })
    const presetText = `${JSON.stringify(compiled, undefined, 2)}\n`
    const profileText = `${JSON.stringify({
      bundles,
      layers,
      // 配置层里「引用框架层配置」的行：模型路由与技能/MCP 以引用形式入产物，凭据一律不进。
      modelRoutes: [...new Set(compiled.agents.map(agent => agent.modelRoute))].sort(),
      skills: [...new Set(compiled.agents.flatMap(agent => agent.skills))].sort(),
      mcpServers: [...new Set(compiled.agents.flatMap(agent => agent.mcpServers))].sort(),
      granularity: 'agent presets compose plugin ROWS: an included row contributes all of its tools; '
        + 'tool-level narrowing is the runtime tools.restrict step with no declarative equivalent',
    }, undefined, 2)}\n`
    const presetPath = join(artifactPath, PRESET_FILE)
    const profilePath = join(artifactPath, PROFILE_FILE)
    writeFileSync(presetPath, presetText, 'utf8')
    writeFileSync(profilePath, profileText, 'utf8')

    // 固化为 profile（FR-DEP-005）：组合清单 + 配置层 + 每节点一个 agent 预设。
    const materialized = this.materializeProfile(artifactPath, compiled, userId)
    const profileStage: PackagingStage = {
      id: 'profile',
      label: '固化为 profile',
      status: 'ok',
      output: `wrote profile ${materialized.dir} → bundles=${String(bundles.length)} presets=${String(materialized.presetIds.length)}`
        + ` (default=${materialized.entryPresetId}, presets=${materialized.presetIds.join(', ')});`
        + ` files=${materialized.files.join(', ')}`,
    }

    const presetBytes = statSync(presetPath).size
    const profileBytes = statSync(profilePath).size
    const manifestText = [
      `soloengine packaging run ${id}`,
      `canvas=${canvasId} project=${projectId} hash=${compiled.canvasHash} revision=${String(compiled.revision)}`,
      `bundles=${bundles.join(', ')}`,
      `layers=${String(layers.length)} (insert=${String(layers.filter(layer => layer.kind === 'insert').length)}, override=${String(layers.filter(layer => layer.kind === 'patch').length)})`,
      `profile=${PROFILE_SUBDIR}/ (entry preset ${materialized.entryPresetId}; node presets ${materialized.presetIds.join(', ')})`,
      `model-routes=${[...new Set(compiled.agents.map(agent => agent.modelRoute))].sort().join(', ')}`,
      `skills=${[...new Set(compiled.agents.flatMap(agent => agent.skills))].sort().join(', ') || 'none'}`,
      `mcp-servers=${[...new Set(compiled.agents.flatMap(agent => agent.mcpServers))].sort().join(', ') || 'none'}`,
      `delegation-edges=${compiled.edges.map(edge => `${edge.from}->${edge.to}:${edge.toolName}`).join(', ') || 'none'}`,
      'granularity=agent presets compose plugin rows; host-plane rows stay visible to every agent (PRD-11 FR-DEP-005)',
      `${PRESET_FILE} ${String(presetBytes)} bytes`,
      `${PROFILE_FILE} ${String(profileBytes)} bytes`,
      `${MANIFEST_FILE} (this file)`,
      'secrets=none',
      '',
    ].join('\n')
    writeFileSync(join(artifactPath, MANIFEST_FILE), manifestText, 'utf8')

    const written = listRegularFiles(artifactPath)
    const writtenBytes = written.reduce((sum, file) => sum + statSync(join(artifactPath, file)).size, 0)
    const materializeStage: PackagingStage = {
      id: 'materialize',
      label: '落盘产物',
      status: 'ok',
      output: `wrote ${String(written.length)} top-level files, ${String(writtenBytes)} bytes to ${artifactPath} (${written.join(', ')})`,
    }

    const verifyStage = this.verifyArtifact(id, artifactPath)
    return {
      id,
      status: 'completed',
      stages: [compileStage, profileStage, materializeStage, verifyStage],
      artifactPath,
      profilePath: materialized.dir,
      presetIds: materialized.presetIds,
      entryPresetId: materialized.entryPresetId,
    }
  }

  /**
   * 读回一次打包产物（重新读取真实目录并重算文件数与字节数）。
   * @param id - 运行 ID。
   * @returns 同形运行结果。
   */
  readRun(id: string): PackagingRun {
    if (!/^[A-Za-z0-9-]+$/.test(id)) {
      throw new FrameworkError(404, 'PACKAGING_RUN_NOT_FOUND', `packaging run ${id} not found`)
    }
    const artifactPath = join(this.runtime.dataDir, 'packaging', id)
    if (!existsSync(artifactPath) || !statSync(artifactPath).isDirectory()) {
      throw new FrameworkError(404, 'PACKAGING_RUN_NOT_FOUND', `packaging run ${id} not found at ${artifactPath}`)
    }
    const presetPath = join(artifactPath, PRESET_FILE)
    const profilePath = join(artifactPath, PROFILE_FILE)
    if (!existsSync(presetPath) || !existsSync(profilePath)) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} is missing ${existsSync(presetPath) ? PROFILE_FILE : PRESET_FILE} in ${artifactPath}`)
    }
    let compiled: unknown
    try {
      compiled = JSON.parse(readFileSync(presetPath, 'utf8'))
    } catch (error) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT', `packaging run ${id} ${PRESET_FILE} is not valid JSON: ${String(error)}`)
    }
    const preset = compiled as { mainAgentId?: unknown; agents?: unknown[]; edges?: unknown[]; canvasHash?: unknown; revision?: unknown }
    if (typeof preset.mainAgentId !== 'string' || !Array.isArray(preset.agents) || !Array.isArray(preset.edges)) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT', `packaging run ${id} ${PRESET_FILE} lacks mainAgentId/agents/edges`)
    }
    const files = listRegularFiles(artifactPath)
    const bytes = files.reduce((sum, file) => sum + statSync(join(artifactPath, file)).size, 0)
    const profile = this.readMaterializedProfile(id, artifactPath)
    const compileStage: PackagingStage = {
      id: 'compile',
      label: '现场编译画布',
      status: 'ok',
      output: `artifact ${PRESET_FILE}: agents=${String(preset.agents.length)} edges=${String(preset.edges.length)} hash=${String(preset.canvasHash)} revision=${String(preset.revision)} mainAgent=${preset.mainAgentId}`,
    }
    const profileStage: PackagingStage = {
      id: 'profile',
      label: '固化为 profile',
      status: 'ok',
      output: `re-read profile ${profile.dir} → presets=${String(profile.presetIds.length)}`
        + ` (default=${profile.entryPresetId}, presets=${profile.presetIds.join(', ')})`,
    }
    const materializeStage: PackagingStage = {
      id: 'materialize',
      label: '落盘产物',
      status: 'ok',
      output: `re-read ${String(files.length)} top-level files, ${String(bytes)} bytes from ${artifactPath} (${files.join(', ')})`,
    }
    return {
      id,
      status: 'completed',
      stages: [compileStage, profileStage, materializeStage, this.verifyArtifact(id, artifactPath)],
      artifactPath,
      profilePath: profile.dir,
      presetIds: profile.presetIds,
      entryPresetId: profile.entryPresetId,
    }
  }

  /**
   * 读回校验：重新读取产物（含 profile 子树）、核对可解析性并在**整棵产物树**上扫描疑似密钥。
   * 扫描范围覆盖 profile 的每一份组合与配置层——凭据不进产物是 PRD-11 的产物安全约束。
   */
  private verifyArtifact(id: string, artifactPath: string): PackagingStage {
    const tree = listFilesRecursive(artifactPath)
    let bytes = 0
    let scanned = ''
    for (const relative of tree) {
      const path = join(artifactPath, relative)
      bytes += statSync(path).size
      if (/\.(?:json|yml|yaml|md|txt)$/u.test(relative)) scanned += readFileSync(path, 'utf8')
    }
    if (SECRET_KEY_PATTERN.test(scanned)) {
      throw new FrameworkError(500, 'PACKAGING_SECRET_DETECTED',
        `packaging run ${id} artifacts at ${artifactPath} contain a secret-looking key; refusing to publish them`)
    }
    let agents = 0
    let edges = 0
    const presetPath = join(artifactPath, PRESET_FILE)
    if (existsSync(presetPath)) {
      const parsed = JSON.parse(readFileSync(presetPath, 'utf8')) as { agents?: unknown[]; edges?: unknown[] }
      agents = Array.isArray(parsed.agents) ? parsed.agents.length : 0
      edges = Array.isArray(parsed.edges) ? parsed.edges.length : 0
    }
    const profileFiles = tree.filter(relative => relative.startsWith(`${PROFILE_SUBDIR}${sep}`)).length
    return {
      id: 'verify',
      label: '读回校验',
      status: 'ok',
      output: `re-read ${String(tree.length)} files (${String(profileFiles)} inside ${PROFILE_SUBDIR}/), ${String(bytes)} bytes;`
        + ` ${PRESET_FILE} parses (agents=${String(agents)}, edges=${String(edges)}); no secrets found`,
    }
  }

  /**
   * 本地/服务器部署指引：配置项（基线组合、端口/主机、信任域）取自真实运行值，
   * 不猜默认值；启动检查与就绪地址来自真实启动器约定。
   * @returns 指引。
   */
  guide(): DeploymentGuide {
    const deployment = this.runtime.deployment
    if (deployment === undefined) {
      throw new FrameworkError(500, 'DEPLOYMENT_UNBOUND',
        'the deployment address is unbound; the host plugin must mount before the deployment guide is served')
    }
    const bundles = this.readBundles()
    return {
      target: deployment.host === '0.0.0.0' ? 'server' : 'local',
      config: {
        baseline: bundles,
        host: deployment.host,
        port: deployment.port,
        trustDomain: deployment.host === '0.0.0.0'
          ? 'all interfaces: non-loopback authorities must be declared in the connection trust domain, otherwise域外访问 403'
          : 'loopback only (127.0.0.1 / localhost / ::1)',
        dshHome: join(this.runtime.dataDir, 'dsh-home'),
        database: this.runtime.databasePath,
      },
      steps: [
        {
          id: 'doctor',
          label: '启动前自检',
          command: 'node soloengine-launch/bin.mjs doctor',
          note: '检查端口占用、数据目录可写、业务库可创建、信任域合法、变更账本状态与第三方插件层；出现 FAIL 行必须先修复再启动。',
        },
        {
          id: 'start',
          label: '以唯一端口启动',
          command: 'node soloengine-launch/bin.mjs start',
          note: '端口 8991 被占用时杀掉占用进程并以同端口重启（严禁换端口）。',
        },
        {
          id: 'status',
          label: '核对实例状态',
          command: 'node soloengine-launch/bin.mjs status',
          note: '报告端口持有者、dsh home、profile、业务库、组合清单与日志里的可访问地址。',
        },
      ],
      ready: {
        url: `http://${deployment.host === '0.0.0.0' ? '127.0.0.1' : deployment.host}:${String(deployment.port)}`,
        port: deployment.port,
      },
    }
  }

  // ── 固化为 profile（FR-DEP-005）/ profile 发行（FR-DEP-007）───────────────

  /** 随附 preset（平台发行）的候选安装锚：dsh 安装锚、实例 profile、仓库根。 */
  private presetTemplateAnchors(): string[] {
    return [
      join(this.runtime.root, 'apps', 'cli'),
      join(this.runtime.dataDir, 'dsh-home', 'profiles', 'soloengine'),
      this.runtime.root,
    ]
  }

  /** 随附 `standard` preset 的组合文件（缺即 fail loud——产物组合以平台发行为基线）。 */
  private presetTemplatePath(): string {
    const looked: string[] = []
    for (const anchor of this.presetTemplateAnchors()) {
      const packageDir = packageDirFrom('@deepseek-ai/dsh-agent-preset-registry', anchor)
      if (packageDir === undefined) {
        looked.push(`from ${anchor}`)
        continue
      }
      const path = join(packageDir, 'presets', 'standard', PRESET_COMPOSITION_FILE)
      if (existsSync(path)) return path
      looked.push(path)
    }
    throw new FrameworkError(500, 'PACKAGING_PRESET_TEMPLATE_MISSING',
      `the shipped agent preset composition is not installed; looked ${looked.join(', ')}`)
  }

  /** 解析随附 preset 的组合行（`!!js` 表达式解析为标记节点，本模块不执行它）。 */
  private presetTemplateRows(): PresetRow[] {
    const path = this.presetTemplatePath()
    const parsed: unknown = yaml.load(readFileSync(path, 'utf8'), { schema: presetRowSchema })
    if (!Array.isArray(parsed)) {
      throw new FrameworkError(500, 'PACKAGING_PRESET_TEMPLATE_INVALID', `${path} is not a top-level list of plugin rows`)
    }
    return parsed as PresetRow[]
  }

  /**
   * 该节点工具集覆盖到的行 id（行粒度：行内工具一并纳入——平台预设以「插件行」为组合单位，
   * 精细到工具级的收紧是运行期 `tools.restrict` 步骤，无声明式等价物）。
   * @param tools - 编译产物里该节点的真实工具名。
   * @param delegationTools - 委派边工具名（由运行时按 `edges` 表注册，不是任何插件行注册的）。
   * @returns 覆盖到的行 id。
   */
  private coveredRowIds(tools: readonly string[], delegationTools: ReadonlySet<string>): Set<string> {
    const ids = new Set<string>()
    const uncovered: string[] = []
    for (const tool of tools) {
      if (HOST_PLANE_TOOLS.includes(tool) || delegationTools.has(tool)) continue
      const rowId = TOOL_ROW[tool]
      if (rowId === undefined) uncovered.push(tool)
      else ids.add(rowId)
    }
    if (uncovered.length > 0) {
      throw new FrameworkError(500, 'PACKAGING_TOOL_UNCOVERED',
        `the packaged product references tools with no agent-plane row: ${uncovered.join(', ')}`)
    }
    return ids
  }

  /** 按覆盖集合过滤随附行：工具行按覆盖取，非工具行（身份/指令/压缩/技能发现）随 agent 带走。 */
  private filterPresetRows(rows: readonly PresetRow[], covered: ReadonlySet<string>): PresetRow[] {
    const kept: PresetRow[] = []
    for (const row of rows) {
      if (row.group === true && Array.isArray(row.config)) {
        const inner = this.filterPresetRows(row.config as PresetRow[], covered)
        if (inner.length === 0) continue
        kept.push({ ...row, config: inner })
        continue
      }
      const tools = ROW_TOOLS[row.id]
      if (tools === undefined) {
        if (row.disabled === true) continue
        if (isJsExpression(row.disabled)) {
          throw new FrameworkError(500, 'PACKAGING_PRESET_EXPRESSION_UNSUPPORTED',
            `shipped preset row ${row.id} gates itself with a !!js expression this packager does not evaluate`)
        }
        kept.push(row)
        continue
      }
      if (row.disabled === true) continue
      if (isJsExpression(row.disabled)) {
        // 平台门（bash / pwsh 二选一）：编译期已按平台把该节点的 shell 解析成唯一的工具名，
        // 故覆盖到哪一行就留哪一行，并把门表达式去掉（产物不再依赖装载方平台）。
        if (!covered.has(row.id)) continue
        const { disabled, ...rest } = row
        kept.push(rest)
        continue
      }
      if (!covered.has(row.id)) continue
      kept.push(row)
    }
    return kept
  }

  /** 节点预设的 persona 行：平台 persona 行 + 该节点的系统提示词（编译产物的事实）。 */
  private personaRowFor(spec: AgentSpec, templateRows: readonly PresetRow[]): PresetRow {
    const template = templateRows.find(row => row.id === 'persona')
    const templateConfig = (template?.config ?? {}) as { prefix?: unknown; suffix?: unknown }
    const platformPrefix = typeof templateConfig.prefix === 'string' ? templateConfig.prefix : undefined
    const nodePrompt = spec.persona !== undefined && spec.persona.trim() !== '' ? spec.persona.trim() : undefined
    const prefix = [platformPrefix, nodePrompt].filter((part): part is string => part !== undefined).join('\n\n')
    return {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: {
        ...(prefix === '' ? {} : { prefix }),
        ...(typeof templateConfig.suffix === 'string' ? { suffix: templateConfig.suffix } : {}),
      },
    }
  }

  /**
   * 该节点引用的 MCP 服务器对应的原生连接行（`@deepseek-ai/dsh-mcp-client`）。
   * 凭据不进产物：连接配置里带 `env` 或 `headers`（可能承载密钥）的行以 `disabled: true` 落盘，
   * 并在产物说明里点明使用方需要补齐的项。
   * @param spec - 该节点。
   * @param servers - 活跃 MCP 服务器（按名字）。
   * @returns 行与说明。
   */
  private mcpRowsFor(
    spec: AgentSpec,
    servers: ReadonlyMap<string, McpServerRow>,
  ): { rows: PresetRow[]; notes: string[]; missing: string[] } {
    const rows: PresetRow[] = []
    const notes: string[] = []
    const missing: string[] = []
    for (const name of spec.mcpServers) {
      const server = servers.get(name)
      if (server === undefined) {
        missing.push(name)
        continue
      }
      const rowId = `mcp-${name.toLowerCase().replace(/[^a-z0-9-]/gu, '-')}`
      if (server.transport_type === 'stdio') {
        const stdio = this.runtime.mcp.stdio(server.id)
        const args = stdio?.args === null || stdio?.args === undefined ? undefined : parseJsonArray(stdio.args)
        const env = stdio?.env === null || stdio?.env === undefined ? undefined : parseJsonObject(stdio.env)
        const carriesSecrets = env !== undefined && Object.keys(env).length > 0
        rows.push({
          id: rowId,
          name: '@deepseek-ai/dsh-mcp-client',
          ...(carriesSecrets ? { disabled: true } : {}),
          config: {
            serverName: name,
            transport: 'stdio',
            command: stdio?.command ?? '',
            ...(args === undefined ? {} : { args }),
            ...(stdio?.working_dir === null || stdio?.working_dir === undefined ? {} : { cwd: stdio.working_dir }),
          },
        })
        if (carriesSecrets) {
          notes.push(`mcp ${name}: env keys (${Object.keys(env).join(', ')}) stay out of the artifact; the row ships disabled until the recipient supplies them`)
        }
        continue
      }
      const http = this.runtime.mcp.http(server.id)
      const headers = http?.headers === null || http?.headers === undefined ? undefined : parseJsonObject(http.headers)
      const carriesSecrets = headers !== undefined && Object.keys(headers).length > 0
      rows.push({
        id: rowId,
        name: '@deepseek-ai/dsh-mcp-client',
        ...(carriesSecrets ? { disabled: true } : {}),
        config: {
          serverName: name,
          transport: 'http',
          url: http?.url ?? '',
          ...(http?.timeout === null || http?.timeout === undefined ? {} : { toolCallTimeoutMs: http.timeout * 1000 }),
        },
      })
      if (carriesSecrets) {
        notes.push(`mcp ${name}: headers (${Object.keys(headers).join(', ')}) stay out of the artifact; the row ships disabled until the recipient supplies them`)
      }
    }
    return { rows, notes, missing }
  }

  /**
   * 写出一份可装入任意 dsh 运行面的 profile（组合清单 + 配置层 + 每节点一个 agent 预设）。
   * @param artifactPath - 产物目录。
   * @param compiled - 现场编译产物。
   * @param userId - 归属用户（技能与 MCP 引用的可见范围）。
   * @returns 固化结果。
   */
  private materializeProfile(artifactPath: string, compiled: CompileResult, userId: string): MaterializedProfile {
    const dir = join(artifactPath, PROFILE_SUBDIR)
    const presetRoot = join(dir, PRESET_SUBDIR)
    const bundles = this.readBundles()
    const hostPatch = this.hostPatchPath()
    const templateRows = this.presetTemplateRows()
    const files: string[] = []

    const presetIds: string[] = []
    for (const spec of compiled.agents) {
      if (!PRESET_ID_PATTERN.test(spec.agentId)) {
        throw new FrameworkError(500, 'PACKAGING_PRESET_ID_INVALID',
          `node id ${JSON.stringify(spec.agentId)} is not a legal agent-preset id (${String(PRESET_ID_PATTERN)})`)
      }
      presetIds.push(spec.agentId)
    }
    if (new Set(presetIds).size !== presetIds.length) {
      throw new FrameworkError(500, 'PACKAGING_PRESET_ID_INVALID', 'two canvas nodes share one preset id')
    }
    const entryPresetId = compiled.mainAgentId
    if (!presetIds.includes(entryPresetId)) {
      throw new FrameworkError(500, 'PACKAGING_PRESET_ID_INVALID',
        `the entry node ${entryPresetId} is not among the compiled agents`)
    }

    // 契约校验（fail loud）：节点引用的技能与 MCP 必须在实例里存在且启用。
    const skillsByName = new Map(this.runtime.skills.list(userId).map(row => [row.name, row]))
    const serversByName = new Map(this.runtime.mcp.listActive().map(row => [row.name, row]))
    const missingRefs: string[] = []
    for (const spec of compiled.agents) {
      for (const skill of spec.skills) {
        const row = skillsByName.get(skill)
        if (row === undefined || row.is_active !== 1 || row.folder_path === null) {
          missingRefs.push(`skill ${skill} (node ${spec.agentId})`)
        }
      }
    }
    if (missingRefs.length > 0) {
      throw new FrameworkError(400, 'PACKAGING_CONTRACT_REJECTED',
        `packaging refused: the canvas references assets that are missing or disabled: ${missingRefs.join(', ')}`)
    }

    const notes: string[] = []
    const delegationTools = new Set(compiled.edges.map(edge => edge.toolName))
    for (const spec of compiled.agents) {
      const covered = this.coveredRowIds(spec.tools, delegationTools)
      const rows = this.filterPresetRows(templateRows, covered)
      // 随附组合里没有行、但平台确有该包的行（当前只有 tool-lsp）。
      for (const rowId of covered) {
        if (!rows.some(row => row.id === rowId || (row.group === true
          && (row.config as PresetRow[]).some(inner => inner.id === rowId)))) {
          const extra = EXTRA_ROWS[rowId]
          if (extra !== undefined) rows.push(extra)
        }
      }
      const mcp = this.mcpRowsFor(spec, serversByName)
      if (mcp.missing.length > 0) {
        throw new FrameworkError(400, 'PACKAGING_CONTRACT_REJECTED',
          `packaging refused: node ${spec.agentId} references MCP servers that are missing or disabled: ${mcp.missing.join(', ')}`)
      }
      notes.push(...mcp.notes)
      const composition: PresetRow[] = [
        this.personaRowFor(spec, templateRows),
        ...rows,
        ...mcp.rows,
      ]
      const presetDir = join(presetRoot, spec.agentId)
      mkdirSync(presetDir, { recursive: true })
      const header = [
        `# 画布节点 ${spec.agentId}（${spec.agentType}）的 agent 预设 —— 由 SoloEngine 打包固化。`,
        `# 组合行取自平台随附 standard preset（按该节点的工具集过滤），persona 为该节点的系统提示词。`,
        `# 该节点的真实工具集合：${spec.tools.join(', ') || '（无）'}`,
        `# 该节点的委派工具（运行时按编译产物的 edges 注册）：${spec.tools.filter(tool => delegationTools.has(tool)).join(', ') || '（无）'}`,
        `# 该节点的技能引用：${spec.skills.join(', ') || '（无）'}`,
        `# 该节点引用的 MCP 服务器：${spec.mcpServers.join(', ') || '（无）'}`,
        '',
      ].join('\n')
      const compositionPath = join(presetDir, PRESET_COMPOSITION_FILE)
      writeFileSync(compositionPath, `${header}${yaml.dump(composition, { lineWidth: -1, noRefs: true })}`, 'utf8')
      files.push(join(PRESET_SUBDIR, spec.agentId, PRESET_COMPOSITION_FILE))
      const metadata = [
        `name: ${spec.name}`,
        `description: 画布节点 ${spec.agentId}（${spec.agentType}）的组合；工具 ${spec.tools.length} 项、委派边按入口节点展开。`,
      ].join('\n')
      writeFileSync(join(presetDir, PRESET_METADATA_FILE), `${metadata}\n`, 'utf8')
      files.push(join(PRESET_SUBDIR, spec.agentId, PRESET_METADATA_FILE))
    }

    // 组合清单：profile 的 bundle 层（与预览同一份读取）。
    const manifest = {
      name: `dsh-profile-soloengine-${compiled.canvasHash}`,
      private: true,
      dsh: { profile: { bundles, patchReload: 'live' } },
    }
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
    files.push('package.json')

    // 配置层：组合层逐行照抄 + 入口节点为默认预设的 roster 行（其余键沿用平台 schema 默认）。
    const patchText = [
      '# SoloEngine 产物配置层（PRD-11 FR-DEP-005）：与云实例同一条组合层，逐行照抄。',
      readFileSync(hostPatch, 'utf8').trimEnd(),
      '',
      '# 产物 roster：入口节点为该 profile 的默认 agent 预设（每节点一个组合，见 .agent-presets/）。',
      '- id: agent-presets',
      '  config:',
      `    default: ${entryPresetId}`,
      '',
    ].join('\n')
    writeFileSync(join(dir, 'cordis.patch.yml'), patchText, 'utf8')
    files.push('cordis.patch.yml')

    writeFileSync(join(dir, 'README.md'), this.artifactProfileReadme(compiled, notes), 'utf8')
    files.push('README.md')

    const resolved = this.assertProfileRowsResolve(dir, files)
    if (resolved.length > 0) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_UNRESOLVED',
        `the packaged profile names rows that do not resolve on this installation:\n- ${resolved.join('\n- ')}`)
    }
    return { dir, presetIds, entryPresetId, files }
  }

  /** 读回产物内的 profile（重新读盘：预设目录、默认预设与文件清单，缺项即报错）。 */
  private readMaterializedProfile(id: string, artifactPath: string): MaterializedProfile {
    const dir = join(artifactPath, PROFILE_SUBDIR)
    const patchPath = join(dir, 'cordis.patch.yml')
    const presetRoot = join(dir, PRESET_SUBDIR)
    if (!existsSync(patchPath) || !existsSync(presetRoot)) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} is missing the profile composition layer or its presets under ${dir}`)
    }
    const presetIds = readdirSync(presetRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && PRESET_ID_PATTERN.test(entry.name))
      .map(entry => entry.name)
      .sort()
    if (presetIds.length === 0) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT', `packaging run ${id} profile ${dir} carries no agent preset`)
    }
    for (const presetId of presetIds) {
      const composition = join(presetRoot, presetId, PRESET_COMPOSITION_FILE)
      if (!existsSync(composition)) {
        throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
          `packaging run ${id} preset ${presetId} is missing ${PRESET_COMPOSITION_FILE}`)
      }
    }
    const entry = /-\s*id:\s*agent-presets[\s\S]{0,400}?default:\s*([a-z0-9][a-z0-9-]*)/u.exec(readFileSync(patchPath, 'utf8'))
    if (entry === null) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} profile ${patchPath} declares no agent-presets default`)
    }
    const entryPresetId = entry[1] as string
    if (!presetIds.includes(entryPresetId)) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} names ${entryPresetId} as the default preset, which has no directory`)
    }
    return { dir, presetIds, entryPresetId, files: listFilesRecursive(dir) }
  }

  /** 产物 profile 的说明文档（前置条件与三种原生加载方式，PRD-11 FR-DEP-007）。 */
  private artifactProfileReadme(compiled: CompileResult, notes: readonly string[]): string {
    return [
      `# SoloEngine 打包产物 · profile 发行（画布 ${compiled.canvasHash} · 代际 ${String(compiled.revision)}）`,
      '',
      '本目录是一份可直接装入任意 dsh 运行面的 profile：组合清单（`package.json` 的',
      '`dsh.profile.bundles`）、配置层（`cordis.patch.yml`）、以及每个画布节点一个 agent 预设',
      '（`.agent-presets/<节点 id>/agent.cordis.yml`，入口节点为该 profile 的默认预设）。',
      '',
      '## 前置条件',
      '',
      '- 目标机器装有平台运行器（`dsh`），并已安装产物组合清单里的全部 bundle 与 `@soloengine/*` 包；',
      '- 组合层引用的环境变量必须就位（缺一个即加载期报错，无回退默认值）：',
      '  `SOLOENGINE_ROOT`、`SOLOENGINE_DB`、`SOLOENGINE_KEYS_DIR`、`SOLOENGINE_SKILLS_DIR`；',
      '- 产物不含任何密钥：`llm_configs` 行在打包时不含凭据，模型路由由使用方实例自己的配置提供；',
      '  产物引用的模型路由与技能/MCP 清单见 `../profile.json` 与 `../MANIFEST.txt`。',
      '',
      '## 加载方式（平台原生命令）',
      '',
      '1. 把本目录放到 `$DSH_HOME/profiles/<名字>/`，把 `.agent-presets/` 里的预设复制到',
      '   `$DSH_HOME/.agent-presets/`（平台原生的用户预设根，任何实例都认）；',
      '2. 按 profile 启动：`dsh --profile <名字>`；',
      '3. 起 Web 运行面板：`dsh --profile <名字> --port 8991`；',
      '4. headless 一次性作业：`dsh --profile headless --patch <本目录>/cordis.patch.yml "任务"`。',
      '',
      '## 组合粒度（如实记录，不隐藏差异）',
      '',
      '- 平台预设以「插件行」为组合单位：行内的全部工具随行纳入，精细到工具级的收紧是运行期',
      '  `tools.restrict` 步骤（无声明式等价物），故产物按行覆盖该节点的工具集；',
      '- 组合层插入的宿主平面行（终端六件套、创造模式、SoloEngine 自研工具）对所有 agent 可见；',
      '- 委派边（Task 委派工具）由运行时按编译产物的 `edges` 表注册，与云面同一实现。',
      '',
      ...notes.length === 0 ? [] : ['## 需要使用方补齐的项', '', ...notes.map(note => `- ${note}`), ''],
      '',
    ].join('\n')
  }

  /**
   * 产物 profile 的行解析体检：每一行（组行递归）的包名必须能在本安装内解析
   * （与平台 `packageInstalled` 同一判据：向上逐级找 `node_modules/<包>/package.json`）。
   * @param profileDir - 产物 profile 目录。
   * @param files - profile 内相对文件清单。
   * @returns 无法解析的行说明（空数组即全部可解析）。
   */
  private assertProfileRowsResolve(profileDir: string, files: readonly string[]): string[] {
    const anchors = this.presetTemplateAnchors()
    const unresolved: string[] = []
    for (const relative of files.filter(file => file.endsWith(PRESET_COMPOSITION_FILE))) {
      const rows = (yaml.load(readFileSync(join(profileDir, relative), 'utf8'), { schema: presetRowSchema }) ?? []) as PresetRow[]
      const visit = (list: readonly PresetRow[]): void => {
        for (const row of list) {
          if (row.group === true && Array.isArray(row.config)) {
            visit(row.config as PresetRow[])
            continue
          }
          if (row.disabled === true) continue
          const name = String(row.name)
          if (name.startsWith('cordis:') || name.startsWith('.') || name.startsWith('file:')) continue
          if (!anchors.some(anchor => packageDirFrom(name, anchor) !== undefined)) {
            unresolved.push(`${relative}: row ${row.id} names ${name}, which resolves on no installation anchor`)
          }
        }
      }
      visit(rows)
    }
    return unresolved
  }
}

/** 供类型层引用的编译产物形状（与 agent-compiler 的 CompileResult 同源）。 */
export type PackagingPreset = CompileResult
