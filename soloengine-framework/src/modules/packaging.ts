/**
 * 打包与部署域：把画布的现场编译产物落成可核对的产物目录，并给出本地部署指引。
 *
 * - 预览复用 `CanvasService.compile`（与运行同一条编译逻辑，不落中间产物）；
 * - `bundles` 真实读取 profile 清单 `data/dsh-home/profiles/soloengine/package.json`
 *   的 `dsh.profile.bundles`；`layers` 按 DSH 装载顺序解析完整层栈
 *   （bundle 各 patch → profile patch → host patch → 形态覆盖），每行带来源；
 * - 落盘在临时目录完成后才 rename 发布（原子）；预览与运行同一条凭据扫描，
 *   命中即 fail loud（PACKAGING_SECRET_DETECTED）；
 * - 读回端点重新读取真实产物目录并重算文件数与字节数，不缓存、不兜底。
 *
 * @module @soloengine/framework/modules/packaging
 */

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep, basename } from 'node:path'
import yaml from 'js-yaml'
import type { AgentSpec, CompileResult, PackagingRunStatus, PackagingStageStatus } from '@soloengine/types'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'
import type { McpServerRow } from './mcp.ts'
import { isJsExpression, jsExpressionType, parsePatchDocument } from '../cordis-patch.ts'
import type { InstanceRow } from './plugins.ts'
import type { InstancePluginDiff } from './canvas.ts'
import { materializeDependencies, measureNodeModules, rootPackageName, workspacePackageIndex, writeClosureManifest, verifyClosureManifest, closureCredentialHits } from './packaging-assets.ts'

// 状态词表的单一真源在 `@soloengine/types`；框架这里原样再导出，产品页从同一个包取。
export { isTerminalStage, type PackagingRunStatus, type PackagingStageStatus } from '@soloengine/types'

/** 异步子进程：打包链路里不能再出现阻塞事件循环的同步调用。 */
const execFileAsync = promisify(execFile)

/** 组合层栈的一层（一个 patch 文件；组合行本身由实例净组合承载）。 */
export interface PackagingLayer {
  /** 该层来自哪一层（`bundle:<name>/<file>` / `profile` / `host` / `override:form-<form>`）。 */
  source: string
  /** 该层所在文件的展示路径（仓库内为根相对路径，仓库外为绝对路径，分隔符统一 `/`）。 */
  path: string
  /** 该层声明的组合行数（insert + patch）。 */
  rows: number
  /** 该层中插入行的数量。 */
  inserts: number
  /** 该层中覆盖行的数量。 */
  patches: number
}

/** 打包预览。 */
export interface PackagingPreview {
  bundles: string[]
  layers: PackagingLayer[]
  preset: { mainAgentId: string; agents: unknown[]; edges: unknown[] }
  /** 入口节点（产物 roster 的默认预设）的名称；取自本次编译产物，不写死。 */
  presetName: string
  /** 将进入产物的 profile 概要（每节点一个 agent 预设，入口节点为默认预设）。 */
  profile: { entryPresetId: string; presetIds: string[] }
  /** 实例组合净结果（profile 基线 + 该画布的插件差异；打包重放它的净结果）。 */
  instance: { rows: InstanceRow[]; diff: InstancePluginDiff }
  /** 随产物携带的非平台插件包与目标机提供的平台包（与运行产物的 closure.json 同一份清单）。 */
  dependencies: {
    packages: { name: string; version: string }[]
    /** 平台包及其清单版本（由目标机 dsh 安装提供，不入产物）。 */
    platformProvided: { name: string; version: string }[]
  }
  /** 桌面形态的收尾发行命令（运行后由 `stageDesktop` 在前面补本次运行的环境变量）。 */
  desktopCommand: string
  canvasHash: string
  revision: number
  /** 产物是否含疑似凭据键；命中会在预览阶段直接报错，故正常返回恒为 false。 */
  containsSecrets: boolean
}

/** 打包阶段。 */
export interface PackagingStage {
  id: string
  label: string
  status: PackagingStageStatus
  output: string
}

/** 产物形态：profile 发行（默认）或桌面应用（发行流水线的暂存形态）。 */
export type PackagingForm = 'profile' | 'desktop'

/** 桌面形态的暂存结果（发行封装本身由发行流水线执行，不在打包请求内跑）。 */
export interface PackagingDesktop {
  /** 桌面壳 profile 目录（`prepare-profile` 的落点）。 */
  profileDir: string
  /** 桌面 profile 名（`profileDir` 的末段；缺省 `desktop`，可由请求指定）。 */
  profileName: string
  /** 桌面应用 id（发行流水线的 `DSH_DESKTOP_APP_ID`）。 */
  appId: string
  /** 发行流水线的前置检查是否通过。 */
  buildReady: boolean
  /** 收尾发行封装的命令（发行流水线执行）。 */
  command: string
  /** `prepare-profile` 与前置检查的真实输出。 */
  output: string
  /** 页面一键触发的发行封装进度（未触发过则缺省）。 */
  build?: PackagingDesktopBuild
}

/** 桌面形态的请求参数（仅在产物形态为 desktop 时生效）。 */
export interface PackagingDesktopOptions {
  /** 桌面 profile 名（`$DSH_HOME/profiles/<name>` 的末段），缺省 `desktop`。 */
  profile?: unknown
  /** 桌面应用 id（反向 DNS），缺省取 `DSH_DESKTOP_APP_ID` 或产品默认值。 */
  appId?: unknown
}

/** 桌面发行封装（`build-windows.mjs`）的真实构建状态。 */
export interface PackagingDesktopBuild {
  status: 'running' | 'completed' | 'failed'
  /** 触发时刻（ISO 8601）。 */
  startedAt: string
  /** 结束时刻（运行中缺省）。 */
  finishedAt?: string
  /** 子进程 pid（用于识别上次进程已消失的运行中状态）。 */
  pid?: number
  /** 真实执行的命令。 */
  command: string
  /** 子进程 stdout/stderr 合并输出的尾部。 */
  output: string
  /** 已产出的安装包与免安装目录绝对路径（失败时为空数组）。 */
  artifacts: string[]
}

/** 一次打包运行。 */
export interface PackagingRun {
  id: string
  status: PackagingRunStatus
  /** 该次运行的产物形态。 */
  form: PackagingForm
  stages: PackagingStage[]
  artifactPath: string
  /** 产物内 profile 目录（FR-DEP-005「固化为 profile」的落点）。 */
  profilePath: string
  /** 每节点预设 id（按编译产物节点顺序）。 */
  presetIds: string[]
  /** 入口节点的预设 id（roster 默认预设）。 */
  entryPresetId: string
  /** 桌面形态的暂存结果（仅 `form === 'desktop'`）。 */
  desktop?: PackagingDesktop
}

/** 部署指引。 */
export interface DeploymentGuide {
  target: 'local' | 'server'
  /** 关键配置摘要（真实运行值：基线组合、端口/主机、信任域、dsh home 与业务库）。 */
  config: {
    baseline: string[]
    host: string
    port: number
    /** 连接层信任域声明的非回环权威（`--trusted-host`）；空数组表示只信回环与监听地址。 */
    trustedHosts: string[]
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
/** 产物归属文件（不属于三件产物，只供 API 归属校验）。 */
const OWNER_FILE = 'owner.json'

/**
 * 桌面发行封装的进度文件目录（`data/packaging/.desktop-builds/<run>.json`）。
 *
 * 放在产物目录之外：封装日志不属于打包产物，也不参与产物的凭据扫描与文件计数。
 */
const DESKTOP_BUILD_DIR = '.desktop-builds'

/** 发行封装子进程输出保留的尾部字节数（页面展示用，不落全量日志）。 */
const DESKTOP_BUILD_OUTPUT_LIMIT = 64 * 1024

/** 桌面形态的私有 home 目录（`data/packaging/.desktop/<run>`，其下 `profiles/<profileName>` 默认 `desktop`）。 */
const DESKTOP_STAGE_DIR = '.desktop'

/**
 * 桌面发行物的产品身份（反向 DNS app id）。
 *
 * 这是产品身份而不是按机器变化的部署参数：页面一键封装无需先配环境变量；换品牌时用
 * `DSH_DESKTOP_APP_ID` 覆盖（与 `apps/desktop/.env.windows` 同一取值）。
 */
const DESKTOP_DEFAULT_APP_ID = 'com.soloengine.desktop'

/** 桌面 profile 名的默认值（`$DSH_HOME/profiles/<name>` 的末段）。 */
const DESKTOP_DEFAULT_PROFILE = 'desktop'

/** 桌面 profile 名：单个安全路径段（进入 `profiles/` 之下，不接受分隔符与 `..`）。 */
const DESKTOP_PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/** 桌面 app id：反向 DNS 字母表（发行流水线把它写进安装包身份）。 */
const DESKTOP_APP_ID_PATTERN = /^[A-Za-z0-9._-]+$/u

/** 桌面发行收尾脚本（仓库根相对路径）：预览的「收尾命令」与真实封装共用这一份。 */
const DESKTOP_RELEASE_SCRIPT = 'packaging/desktop/build-windows.mjs'

/** 收尾发行封装的手工命令（运行后由 `stageDesktop` 在前面补本次运行的环境变量）。 */
const DESKTOP_RELEASE_COMMAND = `node ${DESKTOP_RELEASE_SCRIPT} --unsigned`

/**
 * 疑似凭据的键名（JSON/YAML 共用；覆盖 token / auth / private_key / bearer 族）。
 *
 * 只判定键名：值侧由 {@link scanSecretKeys} 排除空值与布尔开关，
 * 避免 `auth: false` 这类普通配置被误报成凭据。
 */
const SECRET_KEY_PATTERN = /^(?:api[_-]?key|api[_-]?secret|client[_-]?secret|secret|password|passwd|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|token|bearer|authorization|auth|private[_-]?key|credentials?)$/iu

/**
 * 扫描一段 JSON/YAML 文本里「键名像凭据且值非空」的行。
 *
 * 组合层与产物清单都是逐行 `key: value`（js-yaml 的 block 风格与 JSON.stringify 的缩进风格），
 * 按行判定即可；整行注释、空值（含 `null`/`~`）与布尔开关不算命中。
 * @param text - JSON 或 YAML 全文。
 * @returns 命中的键名（去重，保持出现顺序）。
 */
function scanSecretKeys(text: string): string[] {
  const found = new Set<string>()
  /**
   * 当前是否位于 YAML 块标量（`|` / `>`）内：值为父键缩进，`-1` 表示不在块内。
   * 块标量内容是**提示词等自由文本**，其中的 `password: ...` 不是配置键，不能算凭据命中。
   */
  let blockIndent = -1
  for (const rawLine of text.split(/\r?\n/u)) {
    if (rawLine.trim() === '') continue
    const indent = rawLine.length - rawLine.trimStart().length
    if (blockIndent >= 0) {
      if (indent > blockIndent) continue
      blockIndent = -1
    }
    const line = rawLine.trim().replace(/^-\s+/u, '')
    if (line === '' || line.startsWith('#')) continue
    const match = /^(?:"|')?([A-Za-z0-9_.-]+)(?:"|')?\s*:\s*(.*)$/u.exec(line)
    if (match === null) continue
    // 块标量起始行：本行不是可判定的值，后续缩进内容一律按文本跳过。
    if (/^[|>][+-]?\d*$/u.test((match[2] ?? '').trim())) {
      blockIndent = indent
      continue
    }
    const key = match[1]
    if (key === undefined || !SECRET_KEY_PATTERN.test(key)) continue
    const value = (match[2] ?? '').trim()
    if (value === '' || value === '~' || value === 'null' || value === "''" || value === '""') continue
    if (/^(?:true|false|yes|no|on|off)$/iu.test(value)) continue
    found.add(key)
  }
  return [...found]
}

/**
 * 把实例差异展开为产物配置层末尾的 patch 行（Plan W5：打包重放净结果）。
 *
 * 关闭行取画布原始 `disable`（校验时只允许客户端行）；替换/新增取实例净组合行
 * （`configure` 已并入其 config），保证产物与运行时看到同一份净结果。
 * @param instance - 实例组合净结果（差异 + 净行）。
 * @returns YAML 文本；无差异时为空串。
 */
function instancePatchLayer(instance: { rows: InstanceRow[]; diff: InstancePluginDiff }): string {
  const rows: Record<string, unknown>[] = []
  for (const id of instance.diff.disable ?? []) rows.push({ id, disabled: true })
  for (const row of instance.rows) {
    if (row.origin !== 'replace') continue
    rows.push({ id: row.id, name: row.name, ...(row.config === undefined ? {} : { config: row.config }) })
  }
  const added = instance.rows.filter(row => row.origin === 'add')
  if (added.length > 0) {
    rows.push({
      insert: added.map(row => ({
        id: row.id,
        name: row.name,
        ...(row.config === undefined ? {} : { config: row.config }),
      })),
    })
  }
  if (rows.length === 0) return ''
  return [
    '# 实例差异（画布定制 → 当前 flow 的净组合）：关闭/替换/新增逐行重放。',
    yaml.dump(rows, { lineWidth: -1, noRefs: true }),
  ].join('\n')
}

// ── 固化为 profile（PRD-11 FR-DEP-005/007/010）──────────────────────────────
//
// 产物除人可核对的 `preset.json`/`profile.json`/`MANIFEST.txt` 外，另写出一份**真实可装入
// 任意 dsh 运行面的 profile 目录**：组合清单（`package.json` 的 `dsh.profile.bundles`）、
// 配置层（组合层的 `cordis.patch.yml` 逐行照抄 + 每节点一条平台 agent 预设行 + 注册表默认预设覆盖）。
//
// 预设行不重写平台文本：逐行取自**随附 preset 的真实组合文件**（`standard`），按该节点的
// 工具集过滤后落盘——这样产物里的行名、行内取值与平台当前发行保持一致，不会漂移。唯一被
// 替换的行是 `persona`：它的 `prefix` 是该画布节点的系统提示词（编译产物的事实）。

/** 产物内的 profile 目录名。 */
const PROFILE_SUBDIR = 'profile'

/** web-app bundle 里 `standard` agent 预设的组合文件（patch 文档：行在 `insert[].config.plugins`）。 */
const STANDARD_PRESET_FILE = 'standard.patch.yml'
/** agent 预设 id 的合法形态（平台 registry 的 id：空串被拒，且成为行 id 的一段）。 */
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
/** 平台声明 agent 预设的插件包（`@deepseek-ai/dsh-agent-preset`：一行 = 一个预设）。 */
const AGENT_PRESET_PACKAGE = '@deepseek-ai/dsh-agent-preset'
/** 平台预设注册表行 id（web-app 层插入；产物以覆盖行改其 `default`）。 */
const AGENT_PRESET_REGISTRY_ID = 'agent-preset-registry'

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

/** 平台方言 schema（`!!js` 可解析），与随附 preset 的读取同一条（标签语义见 `../cordis-patch.ts`）。 */
const presetRowSchema = yaml.JSON_SCHEMA.extend(jsExpressionType)

/**
 * 行 id → 该行注册的工具名（由 {@link TOOL_ROW} 反演 + 平台额外行组成）。
 *
 * 随附 preset 里存在但画布工具表触达不到的行也在此列，用于把它们按覆盖规则排除
 * ——例如 `subagent`/`ralph`。工具到行的映射只有 {@link TOOL_ROW} 一份真源。
 */
const EXTRA_ROW_TOOLS: Record<string, readonly string[]> = {
  'tool-subagent': ['subagent'],
  'tool-subagent-fork': ['subagent_fork'],
  'tool-ralph': ['ralph'],
  present: ['present'],
}

/** 工具 → 行 反演为 行 → 工具（同一份 {@link TOOL_ROW}，不手写第二张表）。 */
function invertToolRows(table: Readonly<Record<string, string>>): Record<string, readonly string[]> {
  const inverted: Record<string, string[]> = {}
  for (const [tool, row] of Object.entries(table)) (inverted[row] ??= []).push(tool)
  return inverted
}

const ROW_TOOLS: Record<string, readonly string[]> = {
  ...invertToolRows(TOOL_ROW),
  ...EXTRA_ROW_TOOLS,
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

/**
 * 进程是否仍存在（用于识别上次留下「运行中」状态的封装子进程）。
 * @param pid - 进程号。
 * @returns 该进程仍可被信号探测时为 true。
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM 表示进程存在但无权限发信号；其余错误码表示进程已不存在。
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 从 web-app bundle 的 `standard.patch.yml` 中取出随附 preset 的插件行。
 *
 * 文件是 patch 文档（`- insert: [...]`），`standard` 的组合行在其
 * `config.plugins`；没有该声明时返回 undefined（由调用方 fail loud）。
 * @param parsed - `yaml.load` 的结果。
 * @returns 插件行；文件里没有 standard 声明时 undefined。
 */
function standardPresetRows(parsed: unknown): PresetRow[] | undefined {
  if (!Array.isArray(parsed)) return undefined
  for (const row of parsed as Array<Record<string, unknown>>) {
    if (!Array.isArray(row.insert)) continue
    for (const inserted of row.insert as Array<Record<string, unknown>>) {
      if (inserted.name !== '@deepseek-ai/dsh-agent-preset') continue
      const config = inserted.config as { id?: unknown; plugins?: unknown } | undefined
      if (config?.id !== 'standard' || !Array.isArray(config.plugins)) continue
      return config.plugins as PresetRow[]
    }
  }
  return undefined
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
   * 读回校验的阶段缓存：运行 ID →（产物目录签名, 已算出的阶段）。
   *
   * 页面在桌面封装期间每 1.5s 轮询一次读回接口；每次重扫整棵产物树（含闭包摘要与密钥
   * 扫描）会与封装子进程抢磁盘并拖慢整个服务。缓存只在**同一目录内容签名**下复用：
   * 目录被重新发布（顶层 mtime 变化）后重新校验，校验结论不属于跨发布的安全承诺。
   */
  private readonly verifyCache = new Map<string, { key: string; stage: PackagingStage }>()

  /**
   * @param runtime - 框架层运行时（画布服务与数据根）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
  }

  /** profile 清单绝对路径。 */
  private profilePath(): string {
    return join(this.runtime.profileDir, 'package.json')
  }

  /** 组合层文件绝对路径。 */
  private hostPatchPath(): string {
    return join(this.runtime.root, 'packages', 'soloengine', 'host', 'cordis.patch.yml')
  }

  /**
   * 数据库形态覆盖文件绝对路径。
   *
   * 形态覆盖把三个流程级插件（键值后端 / 会话日志 / 会话检索）整组选成同一介质；
   * 产物恒取 `single`（SQLite），因为产物在目标机上不保证有 PostgreSQL。
   * @param form - 形态。
   * @returns 覆盖文件绝对路径。
   */
  private hostFormPatchPath(form: 'single' | 'cloud'): string {
    return join(this.runtime.root, 'packages', 'soloengine', 'host', `cordis.form-${form}.patch.yml`)
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

  /** profile 自己的 patch 层（profile 目录内的 `cordis.patch.yml`）。 */
  private profilePatchPath(): string {
    return join(dirname(this.profilePath()), 'cordis.patch.yml')
  }

  /**
   * 解析 bundle 包目录（从装好的运行面与工作区两处派生，不写死路径）。
   * @param name - bundle 包名。
   * @returns 包目录，解析不到时 undefined。
   */
  private bundlePackageDir(name: string): string | undefined {
    for (const anchor of this.presetTemplateAnchors()) {
      const dir = this.resolvePackageDir(name, anchor)
      if (dir !== undefined) return dir
    }
    const bare = name.replace(/^@[^/]+\//u, '')
    const workspace = [
      join(this.runtime.root, 'packages', 'soloengine', bare),
      join(this.runtime.root, 'packages', 'bundle', bare.replace(/^dsh-/u, '')),
    ]
    for (const dir of workspace) {
      if (existsSync(join(dir, 'package.json'))) return dir
    }
    return undefined
  }

  /**
   * 读取 bundle 声明的 patch 文件（`dsh.bundle.patch`，按声明顺序）。
   * @param bundle - bundle 包名。
   * @returns patch 文件绝对路径。
   */
  private bundlePatchFiles(bundle: string): string[] {
    const dir = this.bundlePackageDir(bundle)
    if (dir === undefined) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING',
        `bundle ${bundle} declared by the profile cannot be resolved on this installation`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch (error) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING',
        `bundle ${bundle} package.json is unreadable: ${String(error)}`)
    }
    const patches = (parsed as { dsh?: { bundle?: { patch?: unknown } } } | null)?.dsh?.bundle?.patch
    // 与 DSH 的 `bundlePatchFiles` 同一读取：单文件写字符串，多文件写数组。
    const declared = typeof patches === 'string' ? [patches] : patches
    if (!Array.isArray(declared) || declared.length === 0) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING',
        `bundle ${bundle} declares no dsh.bundle.patch files`)
    }
    return declared.map(item => {
      if (typeof item !== 'string' || item === '') {
        throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING', `bundle ${bundle} has a non-string dsh.bundle.patch entry`)
      }
      const file = resolve(dir, item)
      if (!existsSync(file)) {
        throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING', `bundle ${bundle} patch file ${file} does not exist`)
      }
      return file
    })
  }

  /**
   * 组合层的文件清单（DSH 装载顺序：bundle 各 patch → profile patch → host patch → 形态覆盖）。
   * @returns 文件路径与来源标签。
   */
  private layerFiles(): { path: string; source: string }[] {
    const files: { path: string; source: string }[] = []
    const seen = new Set<string>()
    const add = (path: string, source: string): void => {
      const key = resolve(path)
      if (seen.has(key)) return
      seen.add(key)
      files.push({ path, source })
    }
    for (const bundle of this.readBundles()) {
      const dir = this.bundlePackageDir(bundle)
      for (const file of this.bundlePatchFiles(bundle)) {
        const relativePath = dir === undefined ? file : relative(dir, file).split(sep).join('/')
        add(file, `bundle:${bundle}/${relativePath}`)
      }
    }
    // profile 自己的 patch 层可以不存在（没有用户覆盖时 DSH 允许空层）。
    const profilePatch = this.profilePatchPath()
    if (existsSync(profilePatch)) add(profilePatch, 'profile')
    // 产品宿主 patch：profile 已把它当 bundle 装载时按同一条路径去重，不重复计入层栈。
    if (existsSync(this.hostPatchPath())) add(this.hostPatchPath(), 'host')
    add(this.hostFormPatchPath('single'), 'override:form-single')
    return files
  }

  /** 解析层栈为逐层摘要（装载顺序；同一层文件只出现一次）。 */
  private readLayers(): PackagingLayer[] {
    return this.layerFiles().map(({ path, source }) => {
      if (!existsSync(path)) {
        throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING', `cordis patch layer ${path} does not exist`)
      }
      const rows = parsePatchDocument(readFileSync(path, 'utf8'), path)
      const inserts = rows.filter(row => row.inserted).length
      return {
        source,
        path: this.layerDisplayPath(path),
        rows: rows.length,
        inserts,
        patches: rows.length - inserts,
      }
    })
  }

  /**
   * 层文件的展示路径：仓库内取根相对路径，仓库外（换盘符/被安装到别处）取绝对路径；
   * 分隔符统一为 `/`，与产物里配置层路径的写法一致。
   * @param path - 层文件绝对路径。
   * @returns 展示路径。
   */
  private layerDisplayPath(path: string): string {
    const inside = relative(this.runtime.root, path)
    if (inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)) return inside.split(sep).join('/')
    return path.split(sep).join('/')
  }

  /**
   * 在整棵候选产物树上找疑似凭据键（预览与运行共用同一扫描）。
   *
   * 只扫**本产物自己写出的**配置与说明（JSON/YAML/Markdown/文本），并排除
   * `profile/node_modules/**`：依赖闭包里是第三方源码，天然含有 `access_token`、`password`
   * 这类接口标识符，扫它们只会误报；依赖闭包的完整性由 `closure.json` 单独对账。
   * @param root - 候选产物根目录。
   * @returns 命中的 `相对路径: 键名` 说明。
   */
  private secretHits(root: string): string[] {
    const hits: string[] = []
    const dependencyPrefix = `${PROFILE_SUBDIR}/node_modules/`
    for (const relativePath of listFilesRecursive(root)) {
      const normalized = relativePath.split(sep).join('/')
      if (normalized.startsWith(dependencyPrefix)) continue
      if (!/\.(?:json|yml|yaml|md|txt)$/u.test(normalized)) continue
      for (const key of scanSecretKeys(readFileSync(join(root, relativePath), 'utf8'))) {
        hits.push(`${normalized}: ${key}`)
      }
    }
    return hits
  }

  /**
   * 命中疑似凭据即 fail loud（预览与运行同一口径）。
   * @param label - 预览或运行标识（错误定位）。
   * @param hits - 命中说明。
   */
  private assertNoSecrets(label: string, hits: readonly string[]): void {
    if (hits.length === 0) return
    throw new FrameworkError(500, 'PACKAGING_SECRET_DETECTED',
      `${label} would carry credential-looking keys (${hits.join('; ')}); refusing to publish the artifact`)
  }

  /**
   * 产物里的两份清单文本（预览与运行共用同一份渲染：预览只扫描不落盘）。
   * @param compiled - 现场编译产物。
   * @param bundles - bundle 层。
   * @param layers - 组合层。
   * @param instance - 实例净结果。
   * @returns `preset.json` 与 `profile.json` 的文本。
   */
  private artifactDocuments(
    compiled: CompileResult,
    bundles: readonly string[],
    layers: readonly PackagingLayer[],
    instance: { rows: InstanceRow[]; diff: InstancePluginDiff },
  ): { presetText: string; profileText: string } {
    const presetText = `${JSON.stringify(compiled, undefined, 2)}\n`
    const profileText = `${JSON.stringify({
      bundles,
      layers,
      // 实例组合净结果：打包按它重放（禁用/替换/新增的净结果），产物配置层逐行携带。
      instance: {
        diff: instance.diff,
        rows: instance.rows.map(row => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          disabled: row.disabled,
          version: row.version,
          origin: row.origin,
          ...(row.config === undefined ? {} : { config: row.config }),
        })),
      },
      // 配置层里「引用框架层配置」的行：模型路由与技能/MCP 以引用形式入产物，凭据一律不进。
      modelRoutes: [...new Set(compiled.agents.map(agent => agent.modelRoute))].sort(),
      skills: [...new Set(compiled.agents.flatMap(agent => agent.skills))].sort(),
      mcpServers: [...new Set(compiled.agents.flatMap(agent => agent.mcpServers))].sort(),
      granularity: 'agent presets compose plugin ROWS: an included row contributes all of its tools; '
        + 'tool-level narrowing is the runtime tools.restrict step with no declarative equivalent',
    }, undefined, 2)}\n`
    return { presetText, profileText }
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
    // 入口节点就是产物 roster 的默认预设：预览的「预设」行显示它在编译产物里的名字。
    const entryAgent = compiled.agents.find(agent => agent.agentId === compiled.mainAgentId)
    if (entryAgent === undefined) {
      throw new FrameworkError(500, 'PACKAGING_PRESET_ID_INVALID',
        `canvas ${canvasId} compiled without its entry node ${compiled.mainAgentId}; the preview cannot name the default preset`)
    }
    const instance = await this.runtime.plugins.instanceComposition(userId, canvasId)
    const bundles = this.readBundles()
    const layers = this.readLayers()
    // 预览即产物清单：与打包运行同一份闭包解析，不落盘。
    const planned = materializeDependencies({
      root: this.runtime.root,
      sourceProfileDir: dirname(this.profilePath()),
      targetProfileDir: join(this.runtime.dataDir, 'packaging', 'preview'),
      bundles,
      rowPackages: instance.rows.map(row => row.name),
      mode: 'plan',
    })
    // 与运行同一口径的凭据扫描：两份清单 + 会被逐行照抄的组合层文件。
    const documents = this.artifactDocuments(compiled, bundles, layers, instance)
    const hits = [
      ...scanSecretKeys(documents.presetText).map(key => `${PRESET_FILE}: ${key}`),
      ...scanSecretKeys(documents.profileText).map(key => `${PROFILE_FILE}: ${key}`),
      ...this.layerFiles().flatMap(({ path, source }) =>
        scanSecretKeys(readFileSync(path, 'utf8')).map(key => `${source}: ${key}`)),
    ]
    this.assertNoSecrets(`packaging preview of canvas ${canvasId}`, hits)
    return {
      bundles,
      layers,
      preset: { mainAgentId: compiled.mainAgentId, agents: compiled.agents, edges: compiled.edges },
      presetName: entryAgent.name,
      profile: { entryPresetId: compiled.mainAgentId, presetIds: compiled.agents.map(agent => agent.agentId) },
      instance,
      dependencies: {
        packages: planned.packages.map(entry => ({ name: entry.name, version: entry.version })),
        platformProvided: planned.platform.map(entry => ({ name: entry.name, version: entry.version })),
      },
      desktopCommand: DESKTOP_RELEASE_COMMAND,
      canvasHash: compiled.canvasHash,
      revision: compiled.revision,
      containsSecrets: false,
    }
  }

  /**
   * 真实执行一次打包：编译 → 落盘产物 → 读回校验（桌面形态再追加发行流水线暂存）。
   * @param userId - 归属用户。
   * @param canvasId - 画布 ID。
   * @param projectId - 运行项目 ID。
   * @param confirm - 必须为 true（显式确认）。
   * @param requestedForm - 产物形态（缺省 `profile`；`desktop` 只做暂存，不跑发行封装）。
   * @param desktopOptions - 桌面形态可选的 profile 名与 app id（仅在 `form === 'desktop'` 时校验与使用）。
   * @returns 运行结果（含各阶段真实输出）。
   */
  async run(
    userId: string,
    canvasId: string,
    projectId: string,
    confirm: unknown,
    requestedForm?: unknown,
    desktopOptions: PackagingDesktopOptions = {},
  ): Promise<PackagingRun> {
    if (confirm !== true) {
      throw new FrameworkError(400, 'PACKAGING_CONFIRM_REQUIRED', 'packaging run requires body { confirm: true }')
    }
    if (requestedForm !== undefined && requestedForm !== 'profile' && requestedForm !== 'desktop') {
      throw new FrameworkError(400, 'PACKAGING_FORM_INVALID',
        `packaging form must be "profile" or "desktop", got ${JSON.stringify(requestedForm)}`)
    }
    const form: PackagingForm = requestedForm === 'desktop' ? 'desktop' : 'profile'
    const desktopRequest = form === 'desktop' ? this.resolveDesktopOptions(desktopOptions) : undefined
    const compiled = await this.runtime.canvas.compile(userId, canvasId, projectId)
    const bundles = this.readBundles()
    const layers = this.readLayers()
    // 实例组合（Plan W5）：打包 = 该画布定制后的完整体系；先校验净组合，错误即拒绝打包。
    const instance = await this.runtime.plugins.instanceComposition(userId, canvasId)
    const id = newId()
    const artifactPath = join(this.runtime.dataDir, 'packaging', id)

    const compileStage: PackagingStage = {
      id: 'compile',
      label: '现场编译画布',
      status: 'ok',
      output: `compiled canvas ${canvasId} (project ${projectId}) → agents=${String(compiled.agents.length)} edges=${String(compiled.edges.length)} hash=${compiled.canvasHash} revision=${String(compiled.revision)}`,
    }

    // 临时目录 + rename：发布前完成落盘、凭据扫描与读回；任何一步失败都不在真源目录留半成品。
    const stagingPath = join(this.runtime.dataDir, 'packaging', `.staging-${id}`)
    mkdirSync(stagingPath, { recursive: true })
    try {
      const documents = this.artifactDocuments(compiled, bundles, layers, instance)
      const presetPath = join(stagingPath, PRESET_FILE)
      const profilePath = join(stagingPath, PROFILE_FILE)
      writeFileSync(presetPath, documents.presetText, 'utf8')
      writeFileSync(profilePath, documents.profileText, 'utf8')

      // 固化为 profile（FR-DEP-005）：组合清单 + 配置层 + 每节点一个 agent 预设 + 该实例的差异层。
      const materialized = await this.materializeProfile(stagingPath, compiled, userId, instance)
      // 凭据扫描前置到发布前：命中即整份丢弃临时目录，产物目录不会出现。
      this.assertNoSecrets(`packaging run ${id}`, this.secretHits(stagingPath))

      const presetBytes = statSync(presetPath).size
      const profileBytes = statSync(profilePath).size
      const manifestText = [
        `soloengine packaging run ${id}`,
        `canvas=${canvasId} project=${projectId} hash=${compiled.canvasHash} revision=${String(compiled.revision)}`,
        `form=${form}`,
        `bundles=${bundles.join(', ')}`,
        `layers=${String(layers.length)} (insert=${String(layers.reduce((total, layer) => total + layer.inserts, 0))}, override=${String(layers.reduce((total, layer) => total + layer.patches, 0))})`,
        `instance-plugins=disable:${(instance.diff.disable ?? []).join(',') || 'none'}`
          + ` replace:${instance.rows.filter(row => row.origin === 'replace').map(row => row.id).join(',') || 'none'}`
          + ` add:${instance.rows.filter(row => row.origin === 'add').map(row => row.id).join(',') || 'none'}`,
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
      writeFileSync(join(stagingPath, MANIFEST_FILE), manifestText, 'utf8')
      // 归属事实：产物目录按 run id 共享，API 读回/触发封装必须能判定调用者是否为所有者。
      writeFileSync(join(stagingPath, OWNER_FILE), `${JSON.stringify({ userId }, undefined, 2)}\n`, 'utf8')
    } catch (error) {
      rmSync(stagingPath, { recursive: true, force: true })
      throw error
    }
    try {
      await this.publishDirectory(stagingPath, artifactPath)
    } catch (error) {
      // rename 重试耗尽时暂存目录还在：留着它只会占磁盘，且调用方拿不到 id 去清理。
      rmSync(stagingPath, { recursive: true, force: true })
      throw error
    }

    try {
      // 读回已发布的产物：profile 路径与预设清单从这里重取（临时目录的路径已不存在）。
      const published = this.readMaterializedProfile(id, artifactPath)
      const profileStage: PackagingStage = {
        id: 'profile',
        label: '固化为 profile',
        status: 'ok',
        output: `wrote profile ${published.dir} → bundles=${String(bundles.length)} presets=${String(published.presetIds.length)}`
          + ` (default=${published.entryPresetId}, presets=${published.presetIds.join(', ')});`
          + ` files=${published.files.join(', ')}`,
      }

      const verifyStage = this.verifyArtifact(id, artifactPath, { requireClosure: true })
      // 桌面形态：发行流水线的前置检查 + `prepare-profile` 暂存（PRD-11 FR-DEP-006）。
      // 发行封装本身（打包 exe/安装包）由发行流水线执行，本请求只做到暂存。
      const desktop = desktopRequest === undefined ? undefined : await this.stageDesktop(published.dir, artifactPath, desktopRequest)
      const desktopStage: PackagingStage | undefined = desktop === undefined ? undefined : {
        id: 'desktop',
        label: '桌面发行暂存',
        status: 'ok',
        output: desktop.output,
      }

      const written = listRegularFiles(artifactPath)
      const writtenBytes = written.reduce((sum, file) => sum + statSync(join(artifactPath, file)).size, 0)
      const materializeStage: PackagingStage = {
        id: 'materialize',
        label: '落盘产物',
        status: 'ok',
        output: `wrote ${String(written.length)} top-level files, ${String(writtenBytes)} bytes to ${artifactPath} (${written.join(', ')})`,
      }

      return {
        id,
        status: 'completed',
        form,
        stages: [compileStage, profileStage, materializeStage, verifyStage, ...desktopStage === undefined ? [] : [desktopStage]],
        artifactPath,
        profilePath: published.dir,
        presetIds: published.presetIds,
        entryPresetId: published.entryPresetId,
        ...desktop === undefined ? {} : { desktop },
      }
    } catch (error) {
      // 发布之后的读回校验/桌面暂存失败：产物目录已经存在但调用方拿不到 id，
      // 留着会变成不可见的孤儿（含完整 node_modules）。
      rmSync(artifactPath, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * 解析桌面形态请求参数：profile 名与 app id 各自回落到环境/产品默认值。
   *
   * 只做形状校验（非空、路径安全、app id 字符集）：它们进入目录路径与发行流水线的环境变量。
   * @param options - 请求里的可选桌面参数。
   * @returns 校验后的 profile 名与 app id。
   */
  private resolveDesktopOptions(options: PackagingDesktopOptions): { profileName: string; appId: string } {
    const rawProfile = options.profile
    let profileName = DESKTOP_DEFAULT_PROFILE
    if (rawProfile !== undefined && rawProfile !== null) {
      profileName = String(rawProfile).trim()
      if (profileName === '' || !DESKTOP_PROFILE_NAME_PATTERN.test(profileName) || profileName.includes('..')) {
        throw new FrameworkError(400, 'PACKAGING_DESKTOP_PROFILE_INVALID',
          `desktopProfile ${JSON.stringify(String(rawProfile))} must be a non-empty single path segment matching ${String(DESKTOP_PROFILE_NAME_PATTERN)}`)
      }
    }
    const rawAppId = options.appId
    let appId = (process.env.DSH_DESKTOP_APP_ID ?? '').trim() || DESKTOP_DEFAULT_APP_ID
    if (rawAppId !== undefined && rawAppId !== null) {
      appId = String(rawAppId).trim()
      if (appId === '' || !DESKTOP_APP_ID_PATTERN.test(appId)) {
        throw new FrameworkError(400, 'PACKAGING_DESKTOP_APP_ID_INVALID',
          `appId ${JSON.stringify(String(rawAppId))} must be non-empty and match ${String(DESKTOP_APP_ID_PATTERN)}`)
      }
    }
    return { profileName, appId }
  }

  /**
   * 桌面形态的发行侧暂存（PRD-11 FR-DEP-006）：调用 `packaging/desktop/prepare-profile.mjs`
   * 把产物合并进桌面壳 profile，并用发行流水线自己的前置检查报告「能否立刻收尾发行封装」。
   *
   * 暂存与发行封装是两步（PRD-11 §3）：打包请求只做暂存，发行流水线的前置条件不满足时
   * 不改写产物、不中止暂存——把缺项逐条写进输出，由页面如实呈现（发行脚本被调用时仍 fail loud）。
   * @param profileDir - 产物内的 profile 目录。
   * @param artifactPath - 产物目录（暂存结果写在 `desktop.json`）。
   * @param options - 已校验的 profile 名与 app id。
   * @returns 暂存结果。
   */
  private async stageDesktop(
    profileDir: string,
    artifactPath: string,
    options: { profileName: string; appId: string },
  ): Promise<PackagingDesktop> {
    const desktopDir = join(this.runtime.root, 'packaging', 'desktop')
    const prepare = join(desktopDir, 'prepare-profile.mjs')
    const build = join(this.runtime.root, DESKTOP_RELEASE_SCRIPT)
    if (!existsSync(prepare) || !existsSync(build)) {
      throw new FrameworkError(500, 'PACKAGING_DESKTOP_MISSING',
        `the desktop release orchestration is missing under ${desktopDir} (prepare-profile.mjs/build-windows.mjs)`)
    }
    const appId = options.appId
    // 子进程用异步 execFile：spawnSync 会阻塞整个实例的事件循环（最长 240 秒），
    // 期间所有用户的所有请求都停摆。
    let checkedStdout = ''
    let blockers: string[] = []
    try {
      const checked = await execFileAsync(process.execPath, [build, '--check'], {
        cwd: this.runtime.root,
        env: { ...process.env, DSH_DESKTOP_APP_ID: appId },
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      })
      checkedStdout = String(checked.stdout ?? '')
    } catch (error) {
      const failure = error as { stdout?: unknown; stderr?: unknown }
      blockers = [String(failure.stderr ?? '').trim() || String(failure.stdout ?? '').trim() || String(error)]
    }
    // 每个运行一份私有 home：桌面 profile 只由本次产物的组合层与依赖生成，不串用上一次运行
    // （`$DSH_HOME/profiles/desktop` 是发行流水线的默认落点，多个画布共用会互相覆盖）。
    const home = this.desktopHome(artifactPath)
    let stagedStdout = ''
    try {
      const staged = await execFileAsync(process.execPath, [prepare, '--from', profileDir, '--home', home,
        '--profile', options.profileName,
        '--runtime', join(this.runtime.dataDir, 'dsh-home', 'runtime')], {
        cwd: this.runtime.root,
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
      })
      stagedStdout = String(staged.stdout ?? '')
    } catch (error) {
      const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown; killed?: unknown }
      const detail = String(failure.stderr ?? '').trim() || String(failure.stdout ?? '').trim() || String(error)
      const exit = failure.killed === true ? 'timeout' : String(failure.code ?? 'unknown')
      throw new FrameworkError(500, 'PACKAGING_DESKTOP_STAGE_FAILED',
        `prepare-profile refused the artifact (exit ${exit}):\n${detail}`)
    }
    const desktopProfileDir = join(home, 'profiles', options.profileName)
    const desktop: PackagingDesktop = {
      profileDir: desktopProfileDir,
      profileName: options.profileName,
      appId,
      buildReady: blockers.length === 0,
      // 手工收尾与页面一键走同一条命令：app id、本次运行的首启载荷与产物落点都显式给出，
      // 不依赖环境残留。
      command: [
        `$env:DSH_DESKTOP_APP_ID='${appId === '' ? '<reverse-DNS app id>' : appId}'`,
        `$env:DSH_DESKTOP_PROFILE_SEED='${desktopProfileDir}'`,
        `$env:DSH_DESKTOP_ARTIFACT_ROOT='${home}'`,
        DESKTOP_RELEASE_COMMAND,
      ].join('; '),
      output: [
        stagedStdout.trimEnd(),
        ...blockers.length === 0
          ? [`release pipeline preflight: ready (${checkedStdout.trim()})`]
          : ['release pipeline preflight: not ready', ...blockers.map(blocker => `  - ${blocker}`)],
      ].filter(Boolean).join('\n'),
    }
    writeFileSync(join(artifactPath, 'desktop.json'), `${JSON.stringify(desktop, undefined, 2)}\n`, 'utf8')
    return desktop
  }

  /**
   * 页面一键触发桌面发行封装（PRD-11 FR-DEP-006）：把已暂存的桌面 profile 交给
   * `packaging/desktop/build-windows.mjs` 真实产出安装包与免安装目录。
   *
   * 封装是本机发行能力（需要 Electron 与 Windows 打包链），因此异步执行、进度写入产物之外的
   * `data/packaging/.desktop-builds/<id>.json`，由 `readRun` 读回；前置缺失由脚本逐项报出，
   * 失败原样可见，再次触发即重试。
   * @param id - 打包运行 ID。
   * @returns 该运行的最新读回结果（含封装进度）。
   */
  async startDesktopBuild(
    id: string,
    requester?: { userId: string; isSuperuser: boolean },
  ): Promise<PackagingRun> {
    if (!/^[A-Za-z0-9-]+$/u.test(id)) {
      throw new FrameworkError(404, 'PACKAGING_RUN_NOT_FOUND', `packaging run ${id} not found`)
    }
    const artifactPath = join(this.runtime.dataDir, 'packaging', id)
    if (!existsSync(artifactPath) || !statSync(artifactPath).isDirectory()) {
      throw new FrameworkError(404, 'PACKAGING_RUN_NOT_FOUND', `packaging run ${id} not found at ${artifactPath}`)
    }
    this.assertOwner(artifactPath, id, requester)
    const desktop = this.readDesktopStage(id, artifactPath)
    if (process.platform !== 'win32') {
      throw new FrameworkError(400, 'PACKAGING_DESKTOP_HOST_UNSUPPORTED',
        `desktop packaging produces Windows artifacts and must run on win32 (this host is ${process.platform})`)
    }
    const previous = this.readDesktopBuild(id)
    if (previous?.status === 'running' && previous.pid !== undefined && processAlive(previous.pid)) {
      throw new FrameworkError(409, 'PACKAGING_DESKTOP_BUSY',
        `desktop build of run ${id} is already running (pid ${String(previous.pid)})`)
    }
    const build = join(this.runtime.root, DESKTOP_RELEASE_SCRIPT)
    if (!existsSync(build)) {
      throw new FrameworkError(500, 'PACKAGING_DESKTOP_MISSING', `the desktop release orchestration is missing: ${build}`)
    }
    const chunks: string[] = []
    const state: PackagingDesktopBuild = {
      status: 'running',
      startedAt: new Date().toISOString(),
      command: desktop.command,
      output: '',
      artifacts: [],
    }
    // 长任务（首次封装要装运行时与取 NSIS，数分钟）：输出按窗节流落盘，页面轮询即可看到进度。
    let flushedAt = 0
    const flush = (): void => {
      const now = Date.now()
      if (now - flushedAt < 2000) return
      flushedAt = now
      state.output = chunks.join('')
      try {
        this.writeDesktopBuild(id, state)
      } catch (error) {
        // 数据目录在构建期间被清理时进度无处可写；封装本身仍在跑，最终状态同样会尝试落盘。
        process.stderr.write(`packaging: could not persist the desktop build progress of run ${id}: ${String(error)}\n`)
      }
    }
    const append = (chunk: Buffer): void => {
      chunks.push(chunk.toString('utf8'))
      const joined = chunks.join('')
      if (joined.length > DESKTOP_BUILD_OUTPUT_LIMIT) {
        chunks.length = 0
        chunks.push(joined.slice(joined.length - DESKTOP_BUILD_OUTPUT_LIMIT))
      }
      flush()
    }
    const child = spawn(process.execPath, [build, '--unsigned'], {
      cwd: this.runtime.root,
      env: {
        ...process.env,
        DSH_DESKTOP_APP_ID: desktop.appId,
        DSH_DESKTOP_PROFILE_SEED: desktop.profileDir,
        // 发行脚本把首启载荷暂存到 `$DSH_HOME/profiles/desktop-seed`（先删后拷）：默认的
        // data/dsh-home 是全实例共用的，两个运行并发封装会互相删掉对方的载荷。指到本次
        // 运行的私有 home，载荷与产物都按运行隔离。
        DSH_HOME: this.desktopHome(artifactPath),
        // 产物落进本次运行的私有 home：重复封装不覆盖上一次的免安装目录（那台机器上可能正
        // 开着它——Windows 会拒绝替换被占用的文件），页面也按真实路径回报。
        DSH_DESKTOP_ARTIFACT_ROOT: this.desktopHome(artifactPath),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (child.pid !== undefined) state.pid = child.pid
    // 先挂监听再落进度：首次落盘失败时若管道还没有读者，子进程会写满缓冲后卡死，
    // 而 pid 也没持久化，重试会在同一目录再起一份构建。
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => {
      append(Buffer.from(`\nspawn failed: ${String(error)}\n`))
    })
    child.on('close', (code) => {
      const finished: PackagingDesktopBuild = {
        ...state,
        status: code === 0 ? 'completed' : 'failed',
        finishedAt: new Date().toISOString(),
        output: chunks.join(''),
        artifacts: code === 0 ? this.desktopArtifacts(this.desktopHome(artifactPath)) : [],
      }
      try {
        this.writeDesktopBuild(id, finished)
      } catch (error) {
        // 数据目录在构建期间被清理时进度无处可写；构建子进程已经结束，这里没有可报告的消费者。
        process.stderr.write(`packaging: could not persist the desktop build state of run ${id}: ${String(error)}\n`)
      }
    })
    try {
      this.writeDesktopBuild(id, state)
    } catch (error) {
      // 进度无法落盘就没有可恢复的 pid：结束已拉起的子进程，避免留下无主的并发构建。
      child.kill('SIGKILL')
      throw error
    }
    return this.readRun(id, requester)
  }

  /**
   * 该运行的桌面私有 home：首启 profile 与发行产物都落在这里，运行之间不共享目录。
   * @param artifactPath - 该运行的产物目录（`data/packaging/<id>`）。
   * @returns 私有 home 绝对路径。
   */
  private desktopHome(artifactPath: string): string {
    return join(this.runtime.dataDir, 'packaging', DESKTOP_STAGE_DIR, basename(artifactPath))
  }

  /**
   * 读回运行的桌面暂存结果（`desktop.json`），缺失即说明该运行不是桌面形态。
   * @param id - 运行 ID。
   * @param artifactPath - 产物目录。
   * @returns 暂存结果。
   */
  private readDesktopStage(id: string, artifactPath: string): PackagingDesktop {
    const path = join(artifactPath, 'desktop.json')
    if (!existsSync(path)) {
      throw new FrameworkError(400, 'PACKAGING_DESKTOP_NOT_STAGED',
        `packaging run ${id} has no staged desktop profile; run it with form "desktop" first`)
    }
    try {
      return PackagingService.withDesktopDefaults(JSON.parse(readFileSync(path, 'utf8')) as PackagingDesktop)
    } catch (error) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT', `packaging run ${id} desktop.json is not valid JSON: ${String(error)}`)
    }
  }

  /**
   * 归一化 desktop.json：旧运行没有 `profileName`，从 `profileDir` 的末段派生。
   * @param desktop - 读取到的暂存结果。
   * @returns 补齐 `profileName` 的暂存结果。
   */
  private static withDesktopDefaults(desktop: PackagingDesktop): PackagingDesktop {
    return {
      ...desktop,
      profileName: typeof desktop.profileName === 'string' && desktop.profileName !== ''
        ? desktop.profileName
        : basename(desktop.profileDir),
    }
  }

  /**
   * 读回桌面发行封装的进度文件。
   * @param id - 运行 ID。
   * @returns 进度状态；从未触发过则缺省。
   */
  private readDesktopBuild(id: string): PackagingDesktopBuild | undefined {
    const path = join(this.runtime.dataDir, 'packaging', DESKTOP_BUILD_DIR, `${id}.json`)
    if (!existsSync(path)) return undefined
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as PackagingDesktopBuild
    } catch (error) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} desktop build state is not valid JSON: ${String(error)}`)
    }
  }

  /**
   * 写入桌面发行封装的进度文件（原子：先写临时文件再 rename）。
   * @param id - 运行 ID。
   * @param state - 最新状态。
   */
  private writeDesktopBuild(id: string, state: PackagingDesktopBuild): void {
    const dir = join(this.runtime.dataDir, 'packaging', DESKTOP_BUILD_DIR)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${id}.json`)
    const staging = `${path}.staging`
    writeFileSync(staging, `${JSON.stringify(state, undefined, 2)}\n`, 'utf8')
    renameSync(staging, path)
  }

  /**
   * 发行流水线产出的 Windows 工件（免安装目录与同目录下的安装包）。
   * @param home - 该运行的桌面私有 home（产物在它下面的 `unsigned-artifacts/`）。
   * @returns 真实存在的工件绝对路径；没有产出则为空数组。
   */
  private desktopArtifacts(home: string): string[] {
    const root = join(home, 'unsigned-artifacts')
    if (!existsSync(root)) return []
    const found = readdirSync(root)
      .filter(name => name.toLowerCase().endsWith('.exe'))
      .sort()
      .map(name => join(root, name))
    const unpacked = join(root, 'win-unpacked')
    if (existsSync(unpacked)) found.push(unpacked)
    return found
  }

  /**
   * 校验产物归属；未登记归属的旧产物只对超管可见（不泄漏给任意登录用户）。
   * @param artifactPath - 产物目录。
   * @param id - 运行 ID（错误信息用）。
   * @param requester - 请求者；缺省表示内部调用（测试/后台），不做用户过滤。
   */
  private assertOwner(
    artifactPath: string,
    id: string,
    requester?: { userId: string; isSuperuser: boolean },
  ): void {
    if (requester === undefined) return
    const ownerPath = join(artifactPath, OWNER_FILE)
    let ownerId: string | null = null
    if (existsSync(ownerPath)) {
      try {
        const parsed = JSON.parse(readFileSync(ownerPath, 'utf8')) as { userId?: unknown }
        ownerId = typeof parsed.userId === 'string' ? parsed.userId : null
      } catch (error) {
        throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
          `packaging run ${id} ${OWNER_FILE} is not valid JSON: ${String(error)}`)
      }
    }
    if (requester.isSuperuser || ownerId === requester.userId) return
    throw new FrameworkError(404, 'PACKAGING_RUN_NOT_FOUND', `packaging run ${id} not found`)
  }

  /**
   * 读回一次打包产物（重新读取真实目录并重算文件数与字节数）。
   * @param id - 运行 ID。
   * @param requester - 请求者（API 必须传入；缺省为内部调用）。
   * @returns 同形运行结果。
   */
  readRun(id: string, requester?: { userId: string; isSuperuser: boolean }): PackagingRun {
    if (!/^[A-Za-z0-9-]+$/.test(id)) {
      throw new FrameworkError(404, 'PACKAGING_RUN_NOT_FOUND', `packaging run ${id} not found`)
    }
    const artifactPath = join(this.runtime.dataDir, 'packaging', id)
    if (!existsSync(artifactPath) || !statSync(artifactPath).isDirectory()) {
      throw new FrameworkError(404, 'PACKAGING_RUN_NOT_FOUND', `packaging run ${id} not found at ${artifactPath}`)
    }
    this.assertOwner(artifactPath, id, requester)
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
    const desktopPath = join(artifactPath, 'desktop.json')
    let desktop: PackagingDesktop | undefined
    if (existsSync(desktopPath)) {
      try {
        desktop = PackagingService.withDesktopDefaults(JSON.parse(readFileSync(desktopPath, 'utf8')) as PackagingDesktop)
      } catch (error) {
        throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
          `packaging run ${id} desktop.json is not valid JSON: ${String(error)}`)
      }
    }
    const build = desktop === undefined ? undefined : this.readDesktopBuild(id)
    // 进程崩溃/重启会留下 `running` 状态文件，而 close 回调永远不会再执行：
    // 按 pid 存活判定成失败，避免页面永久轮询一个不存在的构建。
    const stale = build !== undefined && build.status === 'running'
      && (build.pid === undefined || !processAlive(build.pid))
    const buildStatus = build === undefined ? undefined : stale ? 'failed' : build.status
    const buildOutput = build === undefined
      ? ''
      : stale
        ? `${build.output}\nbuild process ${String(build.pid ?? '(unknown pid)')} is no longer running; the persisted status was left at "running"`
        : build.output
    const desktopStage: PackagingStage | undefined = desktop === undefined ? undefined : {
      id: 'desktop',
      label: '桌面发行封装',
      // 尚未触发封装时不能显示「完成」：没有任何安装包产物，阶段仍是未开始。
      status: buildStatus === undefined ? 'pending' : buildStatus === 'completed' ? 'ok' : buildStatus,
      output: buildStatus === undefined
        ? 'desktop packaging has not been started yet'
        : [desktop.output, buildOutput].filter(output => output !== '').join('\n'),
    }
    // 运行状态覆盖封装进度：封装失败即整次运行的失败（安装包没有产出），运行中则继续轮询。
    const status: PackagingRunStatus = buildStatus === undefined || buildStatus === 'completed'
      ? 'completed'
      : buildStatus === 'failed' ? 'failed' : 'running'
    return {
      id,
      status,
      form: desktop === undefined ? 'profile' : 'desktop',
      stages: [compileStage, profileStage, materializeStage,
        buildStatus === 'running' ? this.verifyArtifactCached(id, artifactPath) : this.verifyArtifact(id, artifactPath),
        ...desktopStage === undefined ? [] : [desktopStage]],
      artifactPath,
      profilePath: profile.dir,
      presetIds: profile.presetIds,
      entryPresetId: profile.entryPresetId,
      ...desktop === undefined ? {} : {
        desktop: {
          ...desktop,
          ...build === undefined ? {} : { build: { ...build, status: stale ? 'failed' : build.status, output: buildOutput } },
        },
      },
    }
  }

  /**
   * 轮询期的读回校验：同一产物目录（目录签名未变）只算一次。
   *
   * 只在桌面封装进行时使用——那是唯一持续轮询的长窗口；普通读回仍每次重扫，
   * 读回的安全承诺不因缓存放宽。
   * @param id - 打包运行 ID。
   * @param artifactPath - 产物目录。
   * @returns 校验阶段（同一目录可复用上次结论）。
   */
  private verifyArtifactCached(id: string, artifactPath: string): PackagingStage {
    const key = `${artifactPath}:${statSync(artifactPath).mtimeMs}`
    const hit = this.verifyCache.get(id)
    if (hit !== undefined && hit.key === key) return hit.stage
    const stage = this.verifyArtifact(id, artifactPath)
    if (this.verifyCache.size >= 32) {
      const oldest = this.verifyCache.keys().next().value
      if (oldest !== undefined) this.verifyCache.delete(oldest)
    }
    this.verifyCache.set(id, { key, stage })
    return stage
  }

  /**
   * 读回校验：重新读取产物（含 profile 子树）、核对闭包完整性并在**整棵产物树**上扫描疑似密钥。
   * 扫描范围覆盖 profile 的每一份组合与配置层——凭据不进产物是 PRD-11 的产物安全约束。
   * 闭包（`profile/node_modules`）另行核对清单摘要与凭据载体：自包含不能只靠打包时声明。
   * @param id - 打包运行 ID。
   * @param artifactPath - 产物目录。
   * @param options - `requireClosure` 为真时缺少闭包清单即拒绝（发布路径）；读回旧产物时放宽。
   * @returns 校验阶段。
   */
  private verifyArtifact(id: string, artifactPath: string, options?: { requireClosure?: boolean }): PackagingStage {
    const tree = listFilesRecursive(artifactPath)
    let bytes = 0
    for (const relativePath of tree) bytes += statSync(join(artifactPath, relativePath)).size
    // 发布前已扫过一次；读回再扫一次，产物在发布后被外部改写同样拦下。
    this.assertNoSecrets(`packaging run ${id}`, this.secretHits(artifactPath))
    let agents = 0
    let edges = 0
    const presetPath = join(artifactPath, PRESET_FILE)
    if (existsSync(presetPath)) {
      const parsed = JSON.parse(readFileSync(presetPath, 'utf8')) as { agents?: unknown[]; edges?: unknown[] }
      agents = Array.isArray(parsed.agents) ? parsed.agents.length : 0
      edges = Array.isArray(parsed.edges) ? parsed.edges.length : 0
    }
    const profileFiles = tree.filter(relative => relative.startsWith(`${PROFILE_SUBDIR}${sep}`)).length
    const bundled = measureNodeModules(join(artifactPath, PROFILE_SUBDIR, 'node_modules'))
    const profileDir = join(artifactPath, PROFILE_SUBDIR)
    const closure = verifyClosureManifest(profileDir, { required: options?.requireClosure === true })
    const credentialHits = closureCredentialHits(profileDir)
    if (credentialHits.length > 0) {
      throw new FrameworkError(500, 'PACKAGING_CLOSURE_CREDENTIALS',
        `packaging run ${id} carries package-manager credentials inside its closure:\n- ${credentialHits.slice(0, 12).join('\n- ')}`)
    }
    return {
      id: 'verify',
      label: '读回校验',
      status: 'ok',
      output: `re-read ${String(tree.length)} files (${String(profileFiles)} inside ${PROFILE_SUBDIR}/), ${String(bytes)} bytes;`
        + ` bundled dependencies ${String(bundled.files)} files/${String(bundled.bytes)} bytes;`
        + (closure.verified
          ? ` closure ${String(closure.packages)} packages/${String(closure.files)} files/${String(closure.bytes)} bytes`
            + ` (sha256 ${closure.sha256.slice(0, 16)});`
          : ' closure manifest absent (legacy artifact, not verified);')
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
    // 启动器命令给绝对路径：指南在任何 cwd 下都可直接执行（启动器按自身位置解析仓库根）。
    const launcher = `node "${join(this.runtime.root, 'soloengine-launch', 'bin.mjs')}"`
    return {
      target: deployment.host === '0.0.0.0' ? 'server' : 'local',
      config: {
        baseline: bundles,
        host: deployment.host,
        port: deployment.port,
        // 真实值：连接层信任域里声明的非回环权威（`--trusted-host`）；回环与监听地址本身始终接受。
        trustedHosts: [...deployment.trustedHosts],
        dshHome: join(this.runtime.dataDir, 'dsh-home'),
        database: this.runtime.databasePath,
      },
      steps: [
        {
          id: 'doctor',
          label: '启动前自检',
          command: `${launcher} doctor`,
          note: '检查端口占用、数据目录可写、业务库可创建、信任域合法、变更账本状态与第三方插件层；出现 FAIL 行必须先修复再启动。',
        },
        {
          id: 'start',
          label: '以唯一端口启动',
          command: `${launcher} start`,
          note: `端口 ${String(deployment.port)} 被占用时杀掉占用进程并以同端口重启（严禁换端口）。`,
        },
        {
          id: 'status',
          label: '核对实例状态',
          command: `${launcher} status`,
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

  /** 随附 preset（平台发行）的候选安装锚：dsh 安装锚、实例 profile、产品宿主、仓库根。 */
  private presetTemplateAnchors(): string[] {
    return [
      join(this.runtime.root, 'apps', 'cli'),
      this.runtime.profileDir,
      // 产品宿主是声明 `@deepseek-ai/dsh-agent-preset-registry` 依赖的包；
      // 仓库根与 dsh 安装锚都不一定链接到它（pnpm 严格布局下只有依赖方可见）。
      join(this.runtime.root, 'packages', 'soloengine', 'host'),
      this.runtime.root,
    ]
  }

  /** 随附 `standard` preset 的组合文件（缺即 fail loud——产物组合以平台发行为基线）。 */
  private presetTemplatePath(): string {
    const looked: string[] = []
    for (const anchor of this.presetTemplateAnchors()) {
      // 组合层就是原生 `dsh-web-app` bundle（产品层只禁用三条官方行，不复制它的 patch 与预设）。
      const packageDir = this.resolvePackageDir('@deepseek-ai/dsh-web-app', anchor)
      if (packageDir === undefined) {
        looked.push(`@deepseek-ai/dsh-web-app from ${anchor}`)
        continue
      }
      const path = join(packageDir, 'presets', STANDARD_PRESET_FILE)
      if (existsSync(path)) return path
      looked.push(path)
    }
    // 工作区位置：未链接到任何锚点时仍可直接读取（打包装配就发生在本仓库）。
    const workspace = join(this.runtime.root, 'packages', 'bundle', 'web-app', 'presets', STANDARD_PRESET_FILE)
    if (existsSync(workspace)) return workspace
    looked.push(workspace)
    throw new FrameworkError(500, 'PACKAGING_PRESET_TEMPLATE_MISSING',
      `the shipped agent preset composition is not installed; looked ${looked.join(', ')}`)
  }

  /**
   * 从一个锚点解析包目录：Node 解析优先，退回逐级 `node_modules` 上溯。
   * @param name - 包名。
   * @param anchor - 安装锚目录。
   * @returns 包目录，解析不到时 undefined。
   */
  private resolvePackageDir(name: string, anchor: string): string | undefined {
    try {
      const require = createRequire(join(anchor, 'package.json'))
      return dirname(require.resolve(`${name}/package.json`))
    } catch {
      return packageDirFrom(name, anchor)
    }
  }

  /** 解析随附 preset 的组合行（`!!js` 表达式解析为标记节点，本模块不执行它）。 */
  private presetTemplateRows(): PresetRow[] {
    const path = this.presetTemplatePath()
    const parsed: unknown = yaml.load(readFileSync(path, 'utf8'), { schema: presetRowSchema })
    const rows = standardPresetRows(parsed)
    if (rows === undefined) {
      throw new FrameworkError(500, 'PACKAGING_PRESET_TEMPLATE_INVALID',
        `${path} does not declare the standard agent preset composition (insert row @deepseek-ai/dsh-agent-preset id=standard config.plugins)`)
    }
    return rows
  }

  /**
   * 该节点工具集覆盖到的行 id（行粒度：行内工具一并纳入——平台预设以「插件行」为组合单位，
   * 精细到工具级的收紧是运行期 `tools.restrict` 步骤，无声明式等价物）。
   * @param tools - 编译产物里该节点的真实工具名。
   * @param delegationTools - 委派边工具名（由运行时按 `edges` 表注册，不是任何插件行注册的）。
   * @param knownTools - harness 实时注册的工具名（画布可选集合的同一份数据源）。
   * @returns 覆盖到的行 id。
   */
  private coveredRowIds(
    tools: readonly string[],
    delegationTools: ReadonlySet<string>,
    knownTools: ReadonlySet<string>,
  ): Set<string> {
    const ids = new Set<string>()
    const uncovered: string[] = []
    for (const tool of tools) {
      if (HOST_PLANE_TOOLS.includes(tool) || delegationTools.has(tool)) continue
      const rowId = TOOL_ROW[tool]
      if (rowId === undefined) {
        // 实时注册里的工具由产物组合层（bundle / 实例行）全局挂载，不按节点重述；
        // 连实时注册都没有的名字才是编制错误。
        if (!knownTools.has(tool)) uncovered.push(tool)
        continue
      }
      ids.add(rowId)
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
  private async mcpRowsFor(
    spec: AgentSpec,
    servers: ReadonlyMap<string, McpServerRow>,
  ): Promise<{ rows: PresetRow[]; notes: string[]; missing: string[] }> {
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
      const disabledTools = server.disabled_tools === null || server.disabled_tools === undefined || server.disabled_tools === ''
        ? []
        : parseJsonArray(server.disabled_tools).filter((item): item is string => typeof item === 'string')
      if (server.transport_type === 'stdio') {
        const stdio = await this.runtime.mcp.stdio(server.id)
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
            // 与宿主挂载同一换算：秒级存储值 → 毫秒，下限 1 秒；缺省沿用连接器默认。
            ...(stdio?.timeout === null || stdio?.timeout === undefined
              ? {}
              : { toolCallTimeoutMs: Math.max(1000, stdio.timeout * 1000) }),
            ...(disabledTools.length === 0 ? {} : { disabledTools }),
          },
        })
        if (carriesSecrets) {
          notes.push(`mcp ${name}: env keys (${Object.keys(env).join(', ')}) stay out of the artifact; the row ships disabled until the recipient supplies them`)
        }
        continue
      }
      const http = await this.runtime.mcp.http(server.id)
      const headers = http?.headers === null || http?.headers === undefined ? undefined : parseJsonObject(http.headers)
      const carriesSecrets = headers !== undefined && Object.keys(headers).length > 0
      rows.push({
        id: rowId,
        name: '@deepseek-ai/dsh-mcp-client',
        ...(carriesSecrets ? { disabled: true } : {}),
        config: {
          serverName: name,
          // 平台的连接器只接受 `streamable-http`（与宿主挂载同一枚举）；写 `http` 会让
          // 产物在目标机加载期配置校验失败，整份 profile 起不来。
          transport: 'streamable-http',
          url: http?.url ?? '',
          ...(http?.timeout === null || http?.timeout === undefined
            ? {}
            : { toolCallTimeoutMs: Math.max(1000, http.timeout * 1000) }),
          ...(disabledTools.length === 0 ? {} : { disabledTools }),
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
   * @param instance - 该画布的实例组合净结果（Plan W5：差异层写入产物配置层）。
   * @returns 固化结果。
   */
  private async materializeProfile(
    artifactPath: string,
    compiled: CompileResult,
    userId: string,
    instance: { rows: InstanceRow[]; diff: InstancePluginDiff },
  ): Promise<MaterializedProfile> {
    const dir = join(artifactPath, PROFILE_SUBDIR)
    mkdirSync(dir, { recursive: true })
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
    // 技能与挂载同源：只有本人与系统技能会被链接进运行项目，他人的公共技能按缺失拒绝。
    const skillsByName = new Map((await this.runtime.skills.listMountable(userId)).map(row => [row.name, row]))
    // 与挂载同源：`byNameScoped`（自己的 + 系统行）；启用的才可能被挂上，停用的按缺失拒绝。
    const serversByName = new Map((await this.runtime.mcp.list(userId))
      .filter(row => row.is_active === 1)
      .map(row => [row.name, row]))
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
    // 实时注册的工具（画布可选集合）在产物组合层已全局挂载，不算「无行可归」。
    const knownTools = new Set(this.runtime.toolVocabulary?.() ?? [])
    /** 每节点一条平台预设行（`@deepseek-ai/dsh-agent-preset` 的 config 即该节点的组合行）。 */
    const presetInserts: Record<string, unknown>[] = []
    for (const spec of compiled.agents) {
      const covered = this.coveredRowIds(spec.tools, delegationTools, knownTools)
      // persona 行由 `personaRowFor` 按节点重建（含随附前缀 + 该节点提示词），随附那行不再重复带走。
      const rows = this.filterPresetRows(templateRows.filter(row => row.id !== 'persona'), covered)
      // 随附组合里没有行、但平台确有该包的行（当前只有 tool-lsp）。
      for (const rowId of covered) {
        if (!rows.some(row => row.id === rowId || (row.group === true
          && (row.config as PresetRow[]).some(inner => inner.id === rowId)))) {
          const extra = EXTRA_ROWS[rowId]
          if (extra !== undefined) rows.push(extra)
        }
      }
      const mcp = await this.mcpRowsFor(spec, serversByName)
      if (mcp.missing.length > 0) {
        throw new FrameworkError(400, 'PACKAGING_CONTRACT_REJECTED',
          `packaging refused: node ${spec.agentId} references MCP servers that are missing or disabled: ${mcp.missing.join(', ')}`)
      }
      notes.push(...mcp.notes)
      presetInserts.push({
        id: `agent-preset-${spec.agentId}`,
        name: AGENT_PRESET_PACKAGE,
        config: {
          id: spec.agentId,
          name: spec.name,
          description: `画布节点 ${spec.agentId}（${spec.role}）的组合；工具 ${String(spec.tools.length)} 项`
            + `（${spec.tools.join(', ') || '无'}），委派工具按入口节点展开。`,
          plugins: [
            this.personaRowFor(spec, templateRows),
            ...rows,
            ...mcp.rows,
            // 节点级插件：该 agent 作用域自己的插件行，随预设一起进产物。
            ...spec.plugins.map(row => ({
              id: row.id,
              name: row.name,
              ...(row.config === undefined ? {} : { config: row.config }),
            })),
          ],
        },
      })
    }

    // 组合清单：profile 的 bundle 层（与预览同一份读取）。
    const manifest = {
      name: `dsh-profile-soloengine-${compiled.canvasHash}`,
      private: true,
      dsh: { profile: { bundles, patchReload: 'live' } },
    }
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
    files.push('package.json')

    // 配置层：组合层逐行照抄 + 该实例的差异净结果 + 每节点一条平台 agent 预设行
    // + 预设注册表的默认预设覆盖（入口节点）。
    //
    // 预设的载体必须是平台原生的一行 `@deepseek-ai/dsh-agent-preset`（`config.plugins` 即该
    // agent 的组合）：cordis 组合行是平台唯一的预设声明面，目录形态的文件没有任何装载方。
    const instanceLayer = instancePatchLayer(instance)
    const presetLayer = yaml.dump([
      { insert: presetInserts },
      { id: AGENT_PRESET_REGISTRY_ID, config: { default: entryPresetId } },
    ], { lineWidth: -1, noRefs: true })
    const formPatch = this.hostFormPatchPath('single')
    if (!existsSync(formPatch)) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_MISSING',
        `database form layer ${formPatch} does not exist; the packaged profile needs the SQLite plugin group`)
    }
    const patchText = [
      '# SoloEngine 产物配置层（PRD-11 FR-DEP-005）：与云实例同一条组合层，逐行照抄。',
      readFileSync(hostPatch, 'utf8').trimEnd(),
      '',
      '# 数据库形态：产物恒为单机（SQLite）。云实例的形态覆盖不随产物走——三个 PostgreSQL',
      '# 流程级插件（键值后端 / 会话日志 / 会话检索）在这里被整组替换为对应的三个 SQLite 插件。',
      readFileSync(formPatch, 'utf8').trimEnd(),
      ...instanceLayer === '' ? [] : ['', instanceLayer.trimEnd()],
      '',
      '# 产物 roster：每个画布节点一条平台 agent 预设行（.agent-presets 不是平台契约，'
        + '预设只经组合行声明）；默认预设覆盖为入口节点。',
      presetLayer.trimEnd(),
      '',
    ].join('\n')
    writeFileSync(join(dir, 'cordis.patch.yml'), patchText, 'utf8')
    files.push('cordis.patch.yml')

    // 自包含（Plan W5）：把非平台插件包及其依赖闭包复制进 profile/node_modules，
    // 目标机无需安装 @soloengine/*；平台包由目标机的 dsh 安装提供并在清单中列明。
    const dependencies = materializeDependencies({
      root: this.runtime.root,
      sourceProfileDir: dirname(this.profilePath()),
      targetProfileDir: dir,
      bundles,
      rowPackages: instance.rows.map(row => row.name),
    })
    writeClosureManifest(dir, dependencies)
    files.push('closure.json')

    writeFileSync(join(dir, 'README.md'), this.artifactProfileReadme(compiled, notes), 'utf8')
    files.push('README.md')

    const resolved = this.assertProfileRowsResolve(dir)
    if (resolved.length > 0) {
      throw new FrameworkError(500, 'PACKAGING_PROFILE_UNRESOLVED',
        `the packaged profile names rows that do not resolve on this installation:\n- ${resolved.join('\n- ')}`)
    }
    return { dir, presetIds, entryPresetId, files }
  }

  /**
   * 把暂存目录发布为最终产物目录。
   *
   * Windows 上杀毒/索引器可能在复制完最后一个文件后仍短暂持有句柄，目录重命名会报
   * `EPERM`/`EBUSY`/`EACCES`；这类失败是瞬时的，短退避重试后仍失败才如实抛出
   * （产物目录因此要么完整出现，要么完全不存在）。
   * @param from - 暂存目录。
   * @param to - 最终目录。
   */
  private async publishDirectory(from: string, to: string): Promise<void> {
    const retryable = new Set(['EPERM', 'EBUSY', 'EACCES'])
    for (let attempt = 1; ; attempt += 1) {
      try {
        renameSync(from, to)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? ''
        if (!retryable.has(code) || attempt >= 5) throw error
        await new Promise(done => setTimeout(done, 100 * attempt))
      }
    }
  }

  /** 读回产物内的 profile（重新读盘：组合行里的预设声明、默认预设与文件清单，缺项即报错）。 */
  private readMaterializedProfile(id: string, artifactPath: string): MaterializedProfile {
    const dir = join(artifactPath, PROFILE_SUBDIR)
    const patchPath = join(dir, 'cordis.patch.yml')
    if (!existsSync(patchPath)) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} is missing the profile composition layer under ${dir}`)
    }
    const entries = this.patchEntries(patchPath)
    const presetIds = entries
      .filter(row => row.name === AGENT_PRESET_PACKAGE)
      .map(row => (row.config as { id?: unknown } | undefined)?.id)
      .filter((value): value is string => typeof value === 'string' && PRESET_ID_PATTERN.test(value))
      .sort()
    if (presetIds.length === 0) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} profile ${dir} declares no ${AGENT_PRESET_PACKAGE} row`)
    }
    const registry = entries.find(row => row.id === AGENT_PRESET_REGISTRY_ID)
    const entryPresetId = (registry?.config as { default?: unknown } | undefined)?.default
    if (typeof entryPresetId !== 'string') {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} profile ${patchPath} declares no ${AGENT_PRESET_REGISTRY_ID} default`)
    }
    if (!presetIds.includes(entryPresetId)) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT',
        `packaging run ${id} names ${entryPresetId} as the default preset, which no preset row declares`)
    }
    return { dir, presetIds, entryPresetId, files: listFilesRecursive(dir) }
  }

  /**
   * 解析一份产物组合层为「顶层行」清单：`insert` 数组逐行展开，覆盖行按自身计入。
   * @param patchPath - 组合层文件绝对路径。
   * @returns 行清单（保持文件内顺序）。
   */
  private patchEntries(patchPath: string): Record<string, unknown>[] {
    const parsed: unknown = yaml.load(readFileSync(patchPath, 'utf8'), { schema: presetRowSchema })
    if (parsed === null) return []
    if (!Array.isArray(parsed)) {
      throw new FrameworkError(500, 'PACKAGING_RUN_CORRUPT', `${patchPath} is not a YAML array of patch entries`)
    }
    const rows: Record<string, unknown>[] = []
    for (const entry of parsed) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      if (Array.isArray(record.insert)) {
        for (const item of record.insert) {
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) rows.push(item as Record<string, unknown>)
        }
        continue
      }
      rows.push(record)
    }
    return rows
  }

  /** 产物 profile 的说明文档（前置条件与三种原生加载方式，PRD-11 FR-DEP-007）。 */
  private artifactProfileReadme(compiled: CompileResult, notes: readonly string[]): string {
    return [
      `# SoloEngine 打包产物 · profile 发行（画布 ${compiled.canvasHash} · 代际 ${String(compiled.revision)}）`,
      '',
      '本目录是一份可直接装入任意 dsh 运行面的 profile：组合清单（`package.json` 的',
      '`dsh.profile.bundles`）与配置层（`cordis.patch.yml`）。每个画布节点在配置层里是一条',
      `平台原生的 agent 预设行（\`${AGENT_PRESET_PACKAGE}\`，\`config.id\` 为节点 id，`,
      '`config.plugins` 为该节点的组合）；`agent-preset-registry` 的 `default` 是入口节点。',
      '',
      '## 前置条件',
      '',
      '- 目标机器装有平台运行器（`dsh`）及其基线包（`packages/` 下的 `@deepseek-ai/*` 与 `vendor/` 的 cordis 族）；',
      '- 本产物已携带其余插件包本体：`profile/node_modules/`（包集合、逐包文件数/字节数/摘要与',
      '  平台提供清单都在 `profile/closure.json` —— 产物自包含的唯一清单），目标机**不需要**安装 `@soloengine/*`；',
      '  产物可在断网、空 `DSH_HOME` 的目标机上直接启动（`closure.json` 的 `platformProvided` 由该机的 `dsh` 安装提供）；',
      '- 组合层引用的环境变量必须就位（缺一个即加载期报错，无回退默认值）：',
      '  `SOLOENGINE_ROOT`、`SOLOENGINE_DB`、`SOLOENGINE_KEYS_DIR`、`SOLOENGINE_SKILLS_DIR`；',
      '- 产物不含任何密钥：`llm_configs` 行在打包时不含凭据，模型路由由使用方实例自己的配置提供；',
      '  产物引用的模型路由与技能/MCP 清单见 `../profile.json` 与 `../MANIFEST.txt`。',
      '',
      '## 加载方式（平台原生命令）',
      '',
      '1. 把本目录放到 `$DSH_HOME/profiles/<名字>/`（预设已在配置层，无需额外复制）；',
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
   * 产物 profile 的行解析体检：组合层的每一行、以及每条 agent 预设的 `config.plugins`
   * （组行递归）的包名必须能在本安装内解析
   * （与平台 `packageInstalled` 同一判据：向上逐级找 `node_modules/<包>/package.json`）。
   * @param profileDir - 产物 profile 目录。
   * @returns 无法解析的行说明（空数组即全部可解析）。
   */
  private assertProfileRowsResolve(profileDir: string): string[] {
    // 产物自带的 node_modules 是第一锚点（Plan W5 自包含）；其后才是平台安装的预设模板锚点。
    // 平台包在 pnpm 严格布局下只链接在直接依赖方，故最后用工作区索引兜底（目标机 dsh 安装
    // 自带这些包；索引只用于判定「它是平台包」，不进入产物）。
    const anchors = [join(profileDir, 'package.json'), ...this.presetTemplateAnchors()]
    const index = workspacePackageIndex(this.runtime.root)
    const unresolved: string[] = []
    const visit = (source: string, list: readonly Record<string, unknown>[]): void => {
      for (const row of list) {
        if (row.group === true && Array.isArray(row.config)) {
          visit(source, row.config as Record<string, unknown>[])
          continue
        }
        if (row.disabled === true) continue
        const name = String(row.name)
        if (name.startsWith('cordis:') || name.startsWith('.') || name.startsWith('file:')) continue
        if (!anchors.some(anchor => packageDirFrom(name, anchor) !== undefined) && !index.has(rootPackageName(name))) {
          unresolved.push(`${source}: row ${row.id} names ${name}, which resolves on no installation anchor`)
        }
      }
    }
    for (const row of this.patchEntries(join(profileDir, 'cordis.patch.yml'))) {
      if (row.group === true && Array.isArray(row.config)) {
        visit('cordis.patch.yml', row.config as Record<string, unknown>[])
        continue
      }
      if (typeof row.name === 'string') visit('cordis.patch.yml', [row])
      if (row.name === AGENT_PRESET_PACKAGE) {
        const config = row.config as { id?: unknown; plugins?: unknown } | undefined
        if (typeof config?.id !== 'string' || !PRESET_ID_PATTERN.test(config.id)) {
          unresolved.push(`cordis.patch.yml: row ${row.id} declares an illegal agent-preset id ${JSON.stringify(config?.id)}`)
        }
        if (!Array.isArray(config?.plugins)) {
          unresolved.push(`cordis.patch.yml: row ${row.id} declares no agent-preset plugins list`)
          continue
        }
        visit(`cordis.patch.yml (preset ${typeof config.id === 'string' ? config.id : row.id})`, config.plugins as PresetRow[])
      }
    }
    return unresolved
  }
}

/** 供类型层引用的编译产物形状（与 agent-compiler 的 CompileResult 同源）。 */
export type PackagingPreset = CompileResult
