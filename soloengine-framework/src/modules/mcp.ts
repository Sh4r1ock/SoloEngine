/**
 * MCP 服务器域（PRD-05 FR-MCP-001~010）。
 *
 * - `mcp_servers` 主表 + `mcp_stdio_configs` / `mcp_http_configs` 两张传输子表（一对一）；
 * - 名称约束 `[A-Za-z0-9_-]{1,32}`（决定模型可见工具名前缀 `mcp__<name>__<tool>`）；
 * - 连接测试失败六类归因；能力枚举（工具/资源/资源模板/提示词，逐页拉全）；单工具试运行；
 * - 管理面协议复用官方 `@modelcontextprotocol/client`（与 dsh `mcp-client` 同源：
 *   版本协商、`Mcp-Session-Id`、SSE、分页、请求取消、stdio 环境清洗都由 SDK 承担）；
 * - 启用中的服务器由 `@soloengine/host` 翻译为 dsh `mcp-client` 原生配置行（热挂载）。
 *
 * 本模块只做「配置源 + 管理面探针」；运行期的连接、工具发现、断线重连由 dsh 原生连接器承担。
 *
 * @module @soloengine/framework/modules/mcp
 */

import type { BusinessDatabase } from '../db/port.ts'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative as relativePath, resolve, sep } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { assertSupportedJsonSchema, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { looksTextual } from '../util/text.ts'
import { FrameworkError } from './accounts.ts'

/** 服务名约束（与 dsh `serverName` 一致）。 */
export const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** 上传包条目数上限（zip bomb 防护）。 */
const MAX_UPLOAD_ENTRIES = 2000

/** 上传包单条目解压上限。 */
const MAX_UPLOAD_ENTRY_BYTES = 16 * 1024 * 1024

/** 上传包解压总量上限。 */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024

/** JSON-RPC 请求默认超时（秒）：两类传输子表的默认值一致。 */
const DEFAULT_TIMEOUT_SECONDS = 30

/** 管理面会话的关闭上限（毫秒）：坏传输不能让两次探针重叠子进程。 */
const MANAGEMENT_CLOSE_TIMEOUT_MS = 5000

/** 单个列表最多翻页数（服务端游标死循环防护）。 */
const MAX_LIST_PAGES = 100

/** 在线编辑的单个文件上限（超出即拒绝，避免把整份大文件塞进请求体）。 */
const MAX_EDIT_BYTES = 2 * 1024 * 1024

/** 文本/二进制判定采样字节数。 */
const TEXT_SAMPLE_BYTES = 4096

/** 只读清单的条目上限（工作目录可能是整棵仓库，列表请求不能无界遍历）。 */
const MAX_READONLY_FILES = 500

/** 读取 package.json 的尺寸上限（版本解析只需要头部字段）。 */
const MAX_MANIFEST_BYTES = 64 * 1024

/** 上传包声明依赖时的安装上限（毫秒）：超时即失败并回滚，不等 npm 的默认重试退避。 */
const DEPENDENCY_INSTALL_TIMEOUT_MS = 180_000

/** 安装失败时回给用户的 stderr 尾部长度（够定位缺包/网络问题，又不淹没错误行）。 */
const INSTALL_STDERR_TAIL = 1500

/** mcp_servers 行。 */
export interface McpServerRow {
  id: string
  user_id: string | null
  name: string
  transport_type: string
  source_type: string | null
  description: string | null
  icon: string | null
  is_active: number
  is_public: number
  author: string | null
  tags: string | null
  tools: string | null
  /** 能力枚举缓存（JSON 数组文本；与 tools 同形态，PRD-05 FR-MCP-003）。 */
  resources: string | null
  prompts: string | null
  /** 单工具停用清单（JSON 数组文本；PRD-05 FR-MCP-008）。 */
  disabled_tools: string | null
  source: string | null
  created_at: string | null
  updated_at: string | null
  version: number
  /** 最近一次连接测试结果（NULL = 从未测试）。 */
  last_test_ok: number | null
  /** 最近一次失败归因类别。 */
  last_test_kind: string | null
  /** 最近一次测试时间（ISO）。 */
  last_tested_at: string | null
  /** 最近一次测试耗时（毫秒；NULL = 未记录）。 */
  last_test_ms: number | null
}

/** stdio 传输子表行。 */
export interface McpStdioRow {
  mcp_server_id: string
  command: string | null
  args: string | null
  env: string | null
  folder_path: string | null
  working_dir: string | null
  /** 连接/单次请求超时（秒；NULL 按默认 30 秒）。 */
  timeout: number | null
}

/** HTTP 传输子表行。 */
export interface McpHttpRow {
  mcp_server_id: string
  url: string | null
  headers: string | null
  timeout: number | null
  session_id: string | null
}

/** 对外视图（布尔归一化 + 传输子表 + 停用工具清单）。 */
export interface McpServerView extends Omit<McpServerRow, 'is_active' | 'is_public' | 'last_test_ok'> {
  is_active: boolean
  is_public: boolean
  /** 最近一次连接测试结果（null = 从未测试）。 */
  last_test_ok: boolean | null
  /** 已停用的工具名（空数组即全部启用）。 */
  disabledTools: string[]
  /** 可解析出的包版本（上传包的 package.json、或 npx/uvx 命令规格）；无法解析时为 null。 */
  package_version: string | null
  stdio: McpStdioRow | null
  http: McpHttpRow | null
}

/** 服务器文件清单的呈现方式。 */
export type McpFilesMode = 'editable' | 'readonly' | 'none'

/** 文件清单为空或只读的原因（码值由前端本地化）。 */
export type McpFilesReason = 'http_transport' | 'directory_missing'

/** 服务器文件条目。 */
export interface McpServerFileEntry {
  /** 相对清单根的路径（`/` 分隔）。 */
  path: string
  /** 文件字节数。 */
  bytes: number
  /** 是否可当文本读取。 */
  text: boolean
}

/** 服务器文件清单视图。 */
export interface McpServerFilesView {
  /** editable = 上传隔离目录（可在页内编辑）；readonly = 本机工作目录（只读列出）；none = 无本地文件。 */
  mode: McpFilesMode
  /** 为空或只读的原因；editable / readonly 时为 null。 */
  reason: McpFilesReason | null
  /** 列出的目录绝对路径；none 时为 null。 */
  directory: string | null
  /** 只读清单超过条目上限（不静默截断）。 */
  truncated: boolean
  files: McpServerFileEntry[]
}

/** 新建/更新入参。 */
export interface McpServerInput {
  name?: string
  transport_type?: 'stdio' | 'http'
  description?: string
  icon?: string
  author?: string
  tags?: string
  source_type?: string
  is_active?: boolean
  is_public?: boolean
  /** stdio 参数。 */
  command?: string
  args?: string
  env?: string
  /** 工作目录；`null` 表示清除（回落到上传隔离目录）。 */
  working_dir?: string | null
  /** HTTP 参数。 */
  url?: string
  headers?: string
  /** 连接/请求超时（秒，1–600；两类传输共用，创建时缺省 30）。 */
  timeout?: number
  version?: number
}

/** 枚举到的工具。 */
export interface McpToolInfo {
  name: string
  description?: string | undefined
  inputSchema?: unknown
}

/** 枚举到的资源。 */
export interface McpResourceInfo {
  uri: string
  name?: string | undefined
  description?: string | undefined
  mimeType?: string | undefined
}

/** 枚举到的资源模板（`uriTemplate` 为必填）。 */
export interface McpResourceTemplateInfo {
  uriTemplate: string
  name?: string | undefined
  description?: string | undefined
  mimeType?: string | undefined
}

/** 枚举到的提示词。 */
export interface McpPromptInfo {
  name: string
  description?: string | undefined
}

/** 连接测试失败归因（六类）。 */
export type McpFailureKind =
  | 'command_missing' | 'spawn_failed' | 'handshake_failed'
  | 'address_unreachable' | 'auth_failed' | 'timeout' | 'unknown'

/** 连接测试结果。 */
export interface McpTestResult {
  ok: boolean
  kind?: McpFailureKind
  message?: string
  latency_ms?: number
  serverInfo?: { name?: string; version?: string }
  tools?: McpToolInfo[]
  resources?: McpResourceInfo[]
  resourceTemplates?: McpResourceTemplateInfo[]
  prompts?: McpPromptInfo[]
}

/** 试运行入参校验违规（按字段路径与类别给出，文案由前端本地化）。 */
export interface McpArgumentViolation {
  /** 字段路径（顶层字段名；嵌套项为 `field.sub` / `field[0]`）。 */
  path: string
  kind: 'required' | 'type' | 'other'
}

/** 单工具试运行结果。 */
export interface McpCallResult {
  ok: boolean
  /** 成功时的 MCP `CallToolResult`（保留 `content[]` 与 `structuredContent`）。 */
  result?: unknown
  error?: string
  /** 入参在发出请求前被本地 schema 校验拦下。 */
  errorCode?: 'INVALID_ARGUMENTS' | 'TOOLS_NOT_ENUMERATED'
  violations?: McpArgumentViolation[]
}

/** MCP 服务器域服务。 */
export class McpService {
  private readonly db: BusinessDatabase
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.db = runtime.db
    this.runtime = runtime
  }

  /** 列某用户服务器（含公共）。 */
  async list(userId: string): Promise<McpServerRow[]> {
    return await this.db.prepare(
      'SELECT * FROM mcp_servers WHERE user_id = ? OR user_id IS NULL ORDER BY created_at ASC',
    ).all<McpServerRow>(userId)
  }

  /** 行 → 对外视图（布尔归一化 + 传输子表 + 停用工具清单 + 可解析的包版本）。 */
  async view(row: McpServerRow): Promise<McpServerView> {
    const { is_active, is_public, last_test_ok, ...rest } = row
    const stdio = await this.stdio(row.id) ?? null
    return {
      ...rest,
      is_active: is_active === 1,
      is_public: is_public === 1,
      last_test_ok: last_test_ok === null ? null : last_test_ok === 1,
      disabledTools: parseJsonArray(row.disabled_tools),
      package_version: packageVersion(row, stdio),
      stdio,
      http: await this.http(row.id) ?? null,
    }
  }

  /**
   * 按名取（归属或公共）。
   *
   * 编译产物只携带**服务器名**（画布节点引用的是名字），运行期挂载时要用名字解析回配置行，
   * 故必须有这条按名查询——且归属判据与按 ID 一致（自己的，或公共的），不跨越用户。
   * @param userId - 归属用户。
   * @param name - 服务器名。
   * @returns 行或 undefined。
   */
  async byNameScoped(userId: string, name: string): Promise<McpServerRow | undefined> {
    return await this.db.prepare('SELECT * FROM mcp_servers WHERE name = ? AND (user_id = ? OR user_id IS NULL)')
      .get<McpServerRow>(name, userId)
  }

  /** 某服务器的停用工具名（空表即全部启用）。 */
  async disabledTools(id: string): Promise<string[]> {
    const row = await this.db.prepare('SELECT disabled_tools FROM mcp_servers WHERE id = ?').get<{ disabled_tools: string | null }>(id)
    return parseJsonArray(row?.disabled_tools ?? null)
  }

  /**
   * 单工具启停（PRD-05 FR-MCP-008）。
   *
   * 只改停用清单；工具本身的存在与执行不受影响，收紧发生在**挂载进 agent 作用域时**
   * （见 `@soloengine/host` 的 MCP 挂载层），故这里不做任何「假装卸载」的动作。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @param toolName - 工具名（服务器侧的原始名，不带 `mcp__<server>__` 前缀）。
   * @param active - true 即启用（从停用清单移除）。
   * @returns 更新后的服务器行。
   */
  async setToolActive(userId: string, id: string, toolName: string, active: boolean, actor: { isSuperuser?: boolean } = {}): Promise<McpServerRow> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    if (toolName.trim() === '') throw new FrameworkError(400, 'TOOL_REQUIRED', 'tool name is required')
    // 只接受**该服务器枚举出来的**工具名：凭空写一个不存在的名字会让停用清单变成噪声。
    // 注意缓存列的形态是 `McpToolInfo[]`（对象数组），故取名字而不是把整条记录当字符串。
    const known = parseToolNames(row.tools)
    if (known.length === 0) {
      throw new FrameworkError(409, 'TOOLS_NOT_ENUMERATED',
        `server ${row.name} has no cached tool list; enumerate the server before enabling or disabling a single tool`)
    }
    if (!known.includes(toolName)) {
      throw new FrameworkError(404, 'TOOL_NOT_ENUMERATED',
        `tool ${toolName} is not in the enumerated tool list of ${row.name} (known: ${known.join(', ')})`)
    }
    const current = new Set(parseJsonArray(row.disabled_tools))
    if (active) current.delete(toolName)
    else current.add(toolName)
    const next = [...current].sort()
    const now = new Date().toISOString()
    // 版本栅栏：并发开关不会「最后写静默胜出」，落败的一方拿到 409 并重读。
    const result = await this.db.prepare(
      'UPDATE mcp_servers SET disabled_tools = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?',
    ).run(JSON.stringify(next), now, id, row.version)
    if (result.changes === 0) {
      throw new FrameworkError(409, 'VERSION_CONFLICT', `mcp server ${id} changed while toggling tool ${toolName}; refresh and retry`)
    }
    return await this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get<McpServerRow>(id) as McpServerRow
  }

  /**
   * 上传建服务（PRD-05 FR-MCP-007）：把上传的代码/包落进**用户隔离目录**并物化为可运行
   * 的 stdio 服务器。
   *
   * 落盘位 = `data/home/users/<username>/mcp/<name>/`（tenancy 第 2 层用户目录隔离）；
   * 代码上传写 `index.mjs` + `package.json`；包上传解压（逐条防路径穿越，与技能导入同一规则）；
   * 两者都物化为 `command = runtime（缺省当前 Node 可执行文件）、args = [入口绝对路径]、
   * working_dir = 服务器目录` 的 stdio 配置行——即「上传即可被连接器拉起、可枚举、可试运行」。
   * @param userId - 归属用户。
   * @param username - 登录名（用户目录分配键）。
   * @param input - 上传内容（code 或 archiveBase64 二选一）与可选的启动命令 runtime。
   * @returns 服务器行。
   */
  async createUploaded(
    userId: string,
    username: string,
    input: {
      name?: string | undefined
      kind?: string | undefined
      code?: string | undefined
      archiveBase64?: string | undefined
      description?: string | undefined
      /** 启动上传服务器的命令；缺省当前 Node 可执行文件。 */
      runtime?: string | undefined
      /** 单次调用超时（秒）；与手动创建的校验同一区间。 */
      timeout?: number | undefined
    },
  ): Promise<McpServerRow> {
    const name = String(input.name ?? '').trim()
    const kind = input.kind === 'package' ? 'package' : 'code'
    if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'name is required')
    if (input.timeout !== undefined) this.assertTimeout(input.timeout)
    await this.assertName(name)
    const runtime = input.runtime === undefined ? process.execPath : assertUploadRuntime(input.runtime)
    const dir = resolve(this.runtime.userDirs.sub(username, 'mcp'), name)
    if (existsSync(dir)) {
      throw new FrameworkError(409, 'MCP_UPLOAD_EXISTS', `uploaded server directory "${name}" already exists`)
    }
    mkdirSync(dir, { recursive: true })
    try {
      const created = await this.materializeUpload(userId, name, kind, dir, { ...input, runtime })
      return created
    } catch (error) {
      // 落盘与登记不是同一事务：任一步失败都清掉刚建立的目录，同名重试不会被 409 卡死。
      rmSync(dir, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * 把上传内容物化成 stdio 服务器（在上传目录已建立之后调用）。
   * @param userId - 归属用户。
   * @param name - 服务器名。
   * @param kind - 上传形态（code / package）。
   * @param dir - 已建立的上传目录。
   * @param input - 上传内容与已校验的启动命令。
   * @returns 服务器行（含 `folder_path`）。
   */
  private async materializeUpload(
    userId: string,
    name: string,
    kind: 'code' | 'package',
    dir: string,
    input: { code?: string | undefined; archiveBase64?: string | undefined; description?: string | undefined; runtime: string; timeout?: number | undefined },
  ): Promise<McpServerRow> {
    let entryRelative = 'index.mjs'
    if (kind === 'package') {
      if (typeof input.archiveBase64 !== 'string' || input.archiveBase64 === '') {
        throw new FrameworkError(400, 'ARCHIVE_REQUIRED', 'package upload requires archiveBase64')
      }
      let files: Record<string, Uint8Array>
      try {
        files = unzipSync(new Uint8Array(Buffer.from(input.archiveBase64, 'base64')))
      } catch (error) {
        // 解压器的原始报错只有 "invalid zip data"：换成可处置的稳定错误码（前端按码本地化）。
        throw new FrameworkError(422, 'ARCHIVE_INVALID',
          `the uploaded package is not a valid ZIP archive: ${error instanceof Error ? error.message : String(error)}`)
      }
      const entries = Object.entries(files)
      if (entries.length > MAX_UPLOAD_ENTRIES) {
        throw new FrameworkError(422, 'ARCHIVE_TOO_LARGE', `archive has ${String(entries.length)} entries; the limit is ${String(MAX_UPLOAD_ENTRIES)}`)
      }
      let total = 0
      // 防穿越：拒绝绝对路径（含 Windows 盘符相对路径）与 `..` 段（与技能导入同一规则）。
      for (const [path, bytes] of entries) {
        const normalized = normalize(path)
        if (isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.split(/[\\/]/u).includes('..') || normalized.split(/[\\/]/u).some(part => part.includes(':'))) {
          throw new FrameworkError(422, 'ARCHIVE_PATH_REJECTED', `archive entry escapes the server directory: ${path}`)
        }
        total += bytes.byteLength
        if (bytes.byteLength > MAX_UPLOAD_ENTRY_BYTES || total > MAX_UPLOAD_BYTES) {
          throw new FrameworkError(422, 'ARCHIVE_TOO_LARGE', `archive expands beyond the upload limits at ${path}`)
        }
      }
      for (const [path, bytes] of entries) {
        if (path.endsWith('/')) continue
        const target = resolve(dir, normalize(path))
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, bytes)
      }
      let main = 'index.mjs'
      const manifest = files['package.json']
      if (manifest !== undefined) {
        try {
          main = String((JSON.parse(strFromU8(manifest)) as { main?: unknown }).main ?? 'index.mjs')
        } catch {
          main = 'index.mjs'
        }
      }
      entryRelative = normalize(main)
      if (isAbsolute(entryRelative) || /^[A-Za-z]:/.test(entryRelative) || entryRelative.split(/[\\/]/u).includes('..')) {
        throw new FrameworkError(422, 'ARCHIVE_ENTRY_REJECTED', `package main must be a relative path inside the archive: ${main}`)
      }
    } else {
      if (typeof input.code !== 'string' || input.code.trim() === '') {
        throw new FrameworkError(400, 'CODE_REQUIRED', 'code upload requires non-empty code')
      }
      writeFileSync(join(dir, 'index.mjs'), input.code, { encoding: 'utf8' })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, private: true, type: 'module', main: 'index.mjs' }, undefined, 2))
    }
    const entryAbsolute = resolve(dir, entryRelative)
    if (!existsSync(entryAbsolute)) {
      throw new FrameworkError(422, 'ENTRY_NOT_FOUND', `uploaded server has no entry file "${entryRelative}"`)
    }
    // 包上传：按 package.json 安装运行期依赖（否则带依赖的包「上传成功、启动即缺模块」）。
    if (kind === 'package') await this.installDependencies(name, dir)
    const row = await this.create(userId, {
      name,
      transport_type: 'stdio',
      source_type: kind,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
      command: input.runtime,
      args: JSON.stringify([entryAbsolute]),
      working_dir: dir,
    })
    const updated = await this.db.prepare('UPDATE mcp_stdio_configs SET folder_path = ? WHERE mcp_server_id = ?').run(dir, row.id)
    if (updated.changes === 0) {
      // 登记行已写入但没有传输行可回写目录：删掉这条不可用记录与刚落盘的目录，避免孤儿。
      await this.db.transaction(async tx => {
        await tx.prepare('DELETE FROM mcp_stdio_configs WHERE mcp_server_id = ?').run(row.id)
        await tx.prepare('DELETE FROM mcp_servers WHERE id = ?').run(row.id)
      })
      rmSync(dir, { recursive: true, force: true })
      throw new FrameworkError(500, 'MCP_CONFIG_MISSING', `uploaded server ${name} has no stdio row to record its directory`)
    }
    return await this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get<McpServerRow>(row.id) as McpServerRow
  }

  /**
   * 按上传包的 package.json 安装运行期依赖（PRD-05 FR-MCP-007「上传即可被连接器拉起」）。
   *
   * 只安装 `dependencies` / `optionalDependencies`，且不执行生命周期脚本：上传包本身是用户代码，
   * 安装阶段不再额外执行第二份任意脚本。失败带 npm stderr 尾部并交给调用方回滚目录。
   * @param name - 服务器名（错误信息用）。
   * @param dir - 已解压的上传目录。
   */
  private async installDependencies(name: string, dir: string): Promise<void> {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) return
    let manifest: { dependencies?: Record<string, unknown>; optionalDependencies?: Record<string, unknown> }
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest
    } catch {
      return // 清单损坏由启动/连接阶段暴露，安装阶段不另判一份
    }
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]
    if (declared.length === 0) return
    await new Promise<void>((resolveInstall, rejectInstall) => {
      let settled = false
      const finish = (error?: FrameworkError): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error === undefined) resolveInstall()
        else rejectInstall(error)
      }
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const child = spawn(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'], {
        cwd: dir,
        windowsHide: true,
        // Windows 上 npm 是 .cmd，必须经 shell 解析；POSIX 直接 exec。
        shell: process.platform === 'win32',
        env: { ...process.env, npm_config_update_notifier: 'false' },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        finish(new FrameworkError(504, 'MCP_INSTALL_TIMEOUT',
          `installing dependencies for "${name}" exceeded ${String(DEPENDENCY_INSTALL_TIMEOUT_MS / 1000)}s`))
      }, DEPENDENCY_INSTALL_TIMEOUT_MS)
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-INSTALL_STDERR_TAIL * 2)
      })
      child.on('error', (error: unknown) => {
        finish(new FrameworkError(500, 'MCP_INSTALL_FAILED',
          `could not start npm to install dependencies for "${name}": ${String(error)}`))
      })
      child.on('close', (code: number | null) => {
        if (code === 0) {
          console.log(`soloengine: installed ${String(declared.length)} declared dependenc${declared.length === 1 ? 'y' : 'ies'} for uploaded MCP server "${name}"`)
          finish()
          return
        }
        finish(new FrameworkError(422, 'MCP_INSTALL_FAILED',
          `installing dependencies (${declared.join(', ')}) for "${name}" failed (npm exit ${String(code)}): `
          + stderr.trim().slice(-INSTALL_STDERR_TAIL)))
      })
    })
  }

  /** 上传服务器的落盘目录（仅 code/package 来源有；归属与越界都在这里校验）。 */
  private async uploadedDir(userId: string, username: string, id: string): Promise<{ row: McpServerRow; dir: string }> {
    const row = await this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    if (row.source_type !== 'code' && row.source_type !== 'package') {
      throw new FrameworkError(409, 'NOT_UPLOADED', `server ${row.name} was not created by upload; it has no managed files`)
    }
    const declared = (await this.stdio(id))?.folder_path ?? ''
    if (declared === '') throw new FrameworkError(409, 'SERVER_DIR_MISSING', `uploaded server ${row.name} has no directory`)
    let dir: string
    try {
      dir = this.runtime.userDirs.within(username, 'mcp', declared)
    } catch (error) {
      throw new FrameworkError(400, 'PATH_ESCAPED', `uploaded server directory escaped the user mcp root: ${String(error)}`)
    }
    return { row, dir }
  }

  /**
   * 列服务器的文件。
   *
   * - 代码/包上传：用户隔离目录，可在页内编辑（`editable`）；
   * - 其他 stdio：`working_dir` 或绝对 `command` 指向的真实目录，只读列出（`readonly`）；
   * - HTTP：没有本地文件（`none` + `http_transport`）；stdio 没有可用目录时 `none` + `directory_missing`。
   *
   * 符号链接不列出：它指向的内容可能不在该目录内，列出来等于把越界文件放进清单。
   * @param userId - 归属用户。
   * @param username - 登录名。
   * @param id - 服务器 ID。
   * @returns 文件清单视图（mode 决定前端是编辑、只读展示还是无文件说明）。
   */
  async serverFiles(userId: string, username: string, id: string): Promise<McpServerFilesView> {
    const row = await this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    if (row.transport_type === 'http') {
      return { mode: 'none', reason: 'http_transport', directory: null, truncated: false, files: [] }
    }
    if (row.source_type === 'code' || row.source_type === 'package') {
      const { dir } = await this.uploadedDir(userId, username, id)
      return { mode: 'editable', reason: null, directory: dir, truncated: false, files: walkTree(dir, null).files }
    }
    const dir = localDirectory(await this.stdio(id))
    if (dir === null) {
      return { mode: 'none', reason: 'directory_missing', directory: null, truncated: false, files: [] }
    }
    const walked = walkTree(dir, MAX_READONLY_FILES)
    return { mode: 'readonly', reason: null, directory: dir, truncated: walked.truncated, files: walked.files }
  }

  /**
   * 读上传服务器的单个文件（越界/链接/二进制一律拒绝）。
   * @param userId - 归属用户。
   * @param username - 登录名。
   * @param id - 服务器 ID。
   * @param relative - 服务器目录内的相对路径。
   * @returns 路径与文本内容。
   */
  async readServerFile(userId: string, username: string, id: string, relative: string): Promise<{ path: string; content: string }> {
    const { dir } = await this.uploadedDir(userId, username, id)
    const target = this.safeServerPath(username, dir, relative)
    if (!existsSync(target)) {
      throw new FrameworkError(404, 'FILE_NOT_FOUND', `no such file in the uploaded server: ${relative}`)
    }
    const stat = lstatSync(target)
    if (stat.isSymbolicLink()) {
      throw new FrameworkError(409, 'SYMLINK_REFUSED', `refusing to follow the link ${relative} out of the uploaded server`)
    }
    if (stat.isDirectory()) throw new FrameworkError(404, 'FILE_NOT_FOUND', `no such file in the uploaded server: ${relative}`)
    if (stat.size > MAX_EDIT_BYTES) {
      throw new FrameworkError(413, 'FILE_TOO_LARGE',
        `${relative} is ${String(stat.size)} bytes; files larger than ${String(MAX_EDIT_BYTES)} bytes cannot be opened here`)
    }
    // 正文会整份解码再写回：合法性按整份文件判定（采样子集合法但尾部非法的文件同样拒绝）。
    const data = readFileSync(target)
    if (!looksTextual(data)) {
      throw new FrameworkError(415, 'BINARY_FILE', `${relative} is not a text file and cannot be edited here`)
    }
    return { path: relativePath(dir, target).replace(/\\/gu, '/'), content: data.toString('utf8') }
  }

  /**
   * 写上传服务器的单个文件（在线编辑落盘；越界/链接/覆盖二进制/超大一律拒绝）。
   * @param userId - 归属用户。
   * @param username - 登录名。
   * @param id - 服务器 ID。
   * @param relative - 服务器目录内的相对路径。
   * @param content - 新的文本内容。
   * @param actor - 操作者（系统行需要超管）。
   * @returns 写入的路径。
   */
  async writeServerFile(userId: string, username: string, id: string, relative: string, content: string, actor: { isSuperuser?: boolean } = {}): Promise<{ path: string }> {
    await this.mutableRow(userId, id, actor.isSuperuser === true)
    const { row, dir } = await this.uploadedDir(userId, username, id)
    const target = this.safeServerPath(username, dir, relative)
    if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) {
      throw new FrameworkError(413, 'FILE_TOO_LARGE', `edits larger than ${String(MAX_EDIT_BYTES)} bytes are refused`)
    }
    if (existsSync(target)) {
      const stat = lstatSync(target)
      if (stat.isSymbolicLink()) {
        throw new FrameworkError(409, 'SYMLINK_REFUSED', `refusing to write through the link ${relative}`)
      }
      // 目录不能被 writeFileSync 覆盖（EISDIR → 裸 500）：明确拒绝并指明冲突类型。
      if (stat.isDirectory()) {
        throw new FrameworkError(409, 'TARGET_IS_DIRECTORY',
          `${relative} is a directory; the editor only writes files`)
      }
      if (!looksTextual(readHead(target, TEXT_SAMPLE_BYTES), { sample: true })) {
        throw new FrameworkError(415, 'BINARY_FILE', `${relative} is not a text file and cannot be overwritten here`)
      }
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, { encoding: 'utf8' })
    const now = new Date().toISOString()
    await this.db.prepare('UPDATE mcp_servers SET updated_at = ?, version = version + 1 WHERE id = ?').run(now, row.id)
    return { path: relativePath(dir, target).replace(/\\/gu, '/') }
  }

  /**
   * 解析上传服务器内的相对路径：越出用户 mcp 根一律 400（防穿越的执行点）。
   *
   * 词法归一挡不住符号链接：目标存在时按真实路径复核，不存在时按父目录真实路径复核。
   * @param username - 登录名。
   * @param dir - 服务器目录绝对路径。
   * @param relative - 请求里的相对路径。
   * @returns 服务器目录内的绝对路径。
   */
  private safeServerPath(username: string, dir: string, relative: string): string {
    let target: string
    try {
      target = this.runtime.userDirs.within(username, 'mcp', resolve(dir, relative))
    } catch (error) {
      throw new FrameworkError(400, 'PATH_ESCAPED', `file path escapes the uploaded server: ${relative} (${String(error)})`)
    }
    const root = this.runtime.userDirs.within(username, 'mcp', dir)
    // 目标不存在时按最近的存在祖先复核：中间目录若是指向根外的链接，真实路径会露出来。
    let probe = target
    while (!existsSync(probe)) {
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }
    let realRoot: string
    let realProbe: string
    try {
      realRoot = realpathSync(root)
      realProbe = realpathSync(probe)
    } catch (error) {
      throw new FrameworkError(400, 'PATH_ESCAPED', `cannot resolve ${relative} inside the uploaded server (${String(error)})`)
    }
    const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`
    if (realProbe !== realRoot && !realProbe.startsWith(prefix)) {
      throw new FrameworkError(400, 'PATH_ESCAPED', `file path resolves outside the uploaded server: ${relative}`)
    }
    return target
  }

  /** 列全部启用服务器（供 host 侧热挂载翻译）。 */
  async listActive(): Promise<McpServerRow[]> {
    return await this.db.prepare('SELECT * FROM mcp_servers WHERE is_active = 1 ORDER BY created_at ASC')
      .all<McpServerRow>()
  }

  /** 按 ID 取（归属或公共）。 */
  async byIdScoped(userId: string, id: string): Promise<McpServerRow | undefined> {
    return await this.db.prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
      .get<McpServerRow>(id, userId)
  }

  /**
   * 取一条**可写**的服务器行。
   *
   * 系统行（`user_id IS NULL`）是出厂共享资产：普通用户只能读，改写/删除需要超管。
   * @param userId - 当前用户。
   * @param id - 服务器 ID。
   * @param isSuperuser - 当前用户是否超管。
   * @returns 服务器行。
   */
  private async mutableRow(userId: string, id: string, isSuperuser: boolean): Promise<McpServerRow> {
    const row = await this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    if (row.user_id === null && !isSuperuser) {
      throw new FrameworkError(403, 'MCP_SYSTEM_READONLY', `mcp server ${row.name} is a system server; only a superuser can modify it`)
    }
    return row
  }

  /**
   * 按 ID 取**原始行**（不做归属过滤）。
   *
   * 仅供「归属已在上游校验过」的内部路径使用（例如 host 侧挂载：服务器名已按该用户解析过，
   * 这里只是拿它的传输子表）；对外接口一律走 `byIdScoped`。
   * @param id - 服务器 ID。
   * @returns 行（不存在即抛错，不返回 undefined 让调用方猜）。
   */
  async byIdRaw(id: string): Promise<McpServerRow> {
    const row = await this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get<McpServerRow>(id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    return row
  }

  /** stdio 子表。 */
  async stdio(id: string): Promise<McpStdioRow | undefined> {
    return await this.db.prepare('SELECT * FROM mcp_stdio_configs WHERE mcp_server_id = ?').get<McpStdioRow>(id)
  }

  /** HTTP 子表。 */
  async http(id: string): Promise<McpHttpRow | undefined> {
    return await this.db.prepare('SELECT * FROM mcp_http_configs WHERE mcp_server_id = ?').get<McpHttpRow>(id)
  }

  /** 校验名称约束与跨实例唯一。 */
  private async assertName(name: string, excludeId?: string): Promise<void> {
    if (!MCP_NAME_PATTERN.test(name)) {
      throw new FrameworkError(400, 'INVALID_MCP_NAME',
        `server name ${JSON.stringify(name)} violates [A-Za-z0-9_-]{1,32} (it becomes the model-visible tool name prefix)`)
    }
    const existing = await this.db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get<{ id: string }>(name)
    if (existing !== undefined && existing.id !== excludeId) {
      throw new FrameworkError(409, 'MCP_NAME_TAKEN', `server name ${name} already exists (must be unique across the instance)`)
    }
  }

  /**
   * 校验超时（秒，两类传输共用的 1–600 整数区间）。
   * @param timeout - 待写入的超时值。
   */
  private assertTimeout(timeout: number): void {
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600) {
      throw new FrameworkError(400, 'INVALID_TIMEOUT', `timeout ${String(timeout)} must be an integer between 1 and 600 seconds`)
    }
  }

  /** 校验 JSON 文本字段。 */
  private assertJson(label: string, value: string | undefined, expect: 'array' | 'object'): void {
    if (value === undefined || value === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      throw new FrameworkError(400, 'INVALID_JSON', `${label} is not valid JSON: ${String(error)}`)
    }
    if (expect === 'array' && !Array.isArray(parsed)) throw new FrameworkError(400, 'INVALID_JSON', `${label} must be a JSON array`)
    if (expect === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new FrameworkError(400, 'INVALID_JSON', `${label} must be a JSON object`)
    }
  }

  /**
   * 注册服务器（含传输子表）。
   * @param userId - 归属用户。
   * @param input - 服务器与传输参数。
   * @returns 服务器行。
   */
  async create(userId: string, input: McpServerInput): Promise<McpServerRow> {
    const name = String(input.name ?? '').trim()
    const transport = input.transport_type === 'http' ? 'http' : 'stdio'
    if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'name is required')
    await this.assertName(name)
    if (transport === 'stdio') {
      if (String(input.command ?? '').trim() === '') {
        throw new FrameworkError(400, 'COMMAND_REQUIRED', 'stdio transport requires a command')
      }
      this.assertJson('args', input.args, 'array')
      this.assertJson('env', input.env, 'object')
    } else {
      if (String(input.url ?? '').trim() === '') {
        throw new FrameworkError(400, 'URL_REQUIRED', 'http transport requires a non-empty url')
      }
      this.assertJson('headers', input.headers, 'object')
    }
    if (input.timeout !== undefined) this.assertTimeout(input.timeout)
    const now = new Date().toISOString()
    const id = newId()
    try {
      return await this.runtime.db.transaction(async tx => {
        await tx.prepare(
          `INSERT INTO mcp_servers
            (id, user_id, name, transport_type, source_type, description, icon, is_active, is_public,
             author, tags, tools, source, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)`,
        ).run(id, userId, name, transport, input.source_type ?? 'manual', input.description ?? null, input.icon ?? null,
          input.is_active === false ? 0 : 1, input.is_public === true ? 1 : 0,
          input.author ?? null, input.tags ?? null, input.source_type ?? 'manual', now, now)
        if (transport === 'stdio') {
          await tx.prepare(
            'INSERT INTO mcp_stdio_configs (mcp_server_id, command, args, env, folder_path, working_dir, timeout) VALUES (?, ?, ?, ?, NULL, ?, ?)',
          ).run(
            id, String(input.command ?? ''), input.args ?? null, input.env ?? null,
            input.working_dir ?? null, input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
          )
        } else {
          await tx.prepare(
            'INSERT INTO mcp_http_configs (mcp_server_id, url, headers, timeout, session_id) VALUES (?, ?, ?, ?, NULL)',
          ).run(id, String(input.url ?? ''), input.headers ?? null, input.timeout ?? DEFAULT_TIMEOUT_SECONDS)
        }
        return await tx.prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
          .get<McpServerRow>(id, userId) as McpServerRow
      })
    } catch (error) {
      // 并发建同名行时由数据库唯一索引裁决（应用层 SELECT 只是预检）。
      if (isUniqueViolation(error)) {
        throw new FrameworkError(409, 'MCP_NAME_TAKEN', `server name ${name} already exists (must be unique across the instance)`)
      }
      throw error
    }
  }

  /**
   * 更新服务器（乐观锁）。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @param patch - 待更新字段。
   * @returns 服务器行。
   */
  async update(userId: string, id: string, patch: McpServerInput, actor: { isSuperuser?: boolean } = {}): Promise<McpServerRow> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    if (patch.version === undefined) throw new FrameworkError(400, 'VERSION_REQUIRED', 'version is required for update')
    if (Number(patch.version) !== Number(row.version)) {
      throw new FrameworkError(409, 'VERSION_CONFLICT',
        `mcp server ${id} was modified (expected ${String(row.version)}, got ${String(patch.version)}); refresh and retry`)
    }
    if (patch.name !== undefined) await this.assertName(patch.name, id)
    this.assertJson('args', patch.args, 'array')
    this.assertJson('env', patch.env, 'object')
    this.assertJson('headers', patch.headers, 'object')
    if (patch.timeout !== undefined) this.assertTimeout(patch.timeout)

    const now = new Date().toISOString()
    try {
      return await this.runtime.db.transaction(async tx => {
        const assignments: string[] = []
        const values: (string | number | null)[] = []
        const set = (column: string, value: string | number | null): void => {
          assignments.push(`${column} = ?`)
          values.push(value)
        }
        if (patch.name !== undefined) set('name', patch.name)
        if (patch.description !== undefined) set('description', patch.description)
        if (patch.icon !== undefined) set('icon', patch.icon)
        if (patch.author !== undefined) set('author', patch.author)
        if (patch.tags !== undefined) set('tags', patch.tags)
        if (patch.is_active !== undefined) set('is_active', patch.is_active ? 1 : 0)
        if (patch.is_public !== undefined) set('is_public', patch.is_public ? 1 : 0)
        set('updated_at', now)
        assignments.push('version = version + 1')
        values.push(id, userId, Number(patch.version))
        // 版本条件必须进 UPDATE：预检与写入之间可能有并发提交（先查后写会双双通过）。
        const updated = await tx.prepare(
          `UPDATE mcp_servers SET ${assignments.join(', ')} WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND version = ?`,
        ).run(...values)
        if (updated.changes !== 1) {
          throw new FrameworkError(409, 'VERSION_CONFLICT',
            `mcp server ${id} was modified concurrently; refresh and retry`)
        }
        if (row.transport_type === 'stdio') {
          const assignments2: string[] = []
          const values2: (string | number | null)[] = []
          const set2 = (column: string, value: string | number | null): void => {
            assignments2.push(`${column} = ?`)
            values2.push(value)
          }
          if (patch.command !== undefined) set2('command', patch.command)
          if (patch.args !== undefined) set2('args', patch.args)
          if (patch.env !== undefined) set2('env', patch.env)
          if (patch.working_dir !== undefined) set2('working_dir', patch.working_dir)
          if (patch.timeout !== undefined) set2('timeout', patch.timeout)
          if (assignments2.length > 0) {
            values2.push(id)
            const updated = await tx.prepare(`UPDATE mcp_stdio_configs SET ${assignments2.join(', ')} WHERE mcp_server_id = ?`).run(...values2)
            if (updated.changes === 0) throw new FrameworkError(404, 'MCP_CONFIG_MISSING', `mcp server ${id} has no stdio config row`)
          }
        } else {
          const assignments2: string[] = []
          const values2: (string | number | null)[] = []
          const set2 = (column: string, value: string | number | null): void => {
            assignments2.push(`${column} = ?`)
            values2.push(value)
          }
          if (patch.url !== undefined) set2('url', patch.url)
          if (patch.headers !== undefined) set2('headers', patch.headers)
          if (patch.timeout !== undefined) set2('timeout', patch.timeout)
          if (assignments2.length > 0) {
            values2.push(id)
            const updated = await tx.prepare(`UPDATE mcp_http_configs SET ${assignments2.join(', ')} WHERE mcp_server_id = ?`).run(...values2)
            if (updated.changes === 0) throw new FrameworkError(404, 'MCP_CONFIG_MISSING', `mcp server ${id} has no http config row`)
          }
        }
        return await tx.prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
          .get<McpServerRow>(id, userId) as McpServerRow
      })
    } catch (error) {
      if (patch.name !== undefined && isUniqueViolation(error)) {
        throw new FrameworkError(409, 'MCP_NAME_TAKEN', `server name ${patch.name} already exists (must be unique across the instance)`)
      }
      throw error
    }
  }

  /** 启用/停用（停用即从 host 侧热挂载清单移除 → 工具世代回滚）。 */
  async setActive(userId: string, id: string, active: boolean, actor: { isSuperuser?: boolean } = {}): Promise<McpServerRow> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    return await this.update(userId, id, { is_active: active, version: row.version }, actor)
  }

  /**
   * 删除服务器（级联删除传输子表与上传目录）。
   * @param userId - 归属用户。
   * @param username - 登录名（上传目录必须落在该用户的 mcp 根内才允许清理）。
   * @param id - 服务器 ID。
   * @param actor - 请求级身份（系统行仅超管可删）。
   */
  async remove(userId: string, username: string, id: string, actor: { isSuperuser?: boolean } = {}): Promise<void> {
    const row = await this.mutableRow(userId, id, actor.isSuperuser === true)
    const folder = (await this.stdio(id))?.folder_path ?? null
    await this.runtime.db.transaction(async tx => {
      await tx.prepare('DELETE FROM mcp_stdio_configs WHERE mcp_server_id = ?').run(id)
      await tx.prepare('DELETE FROM mcp_http_configs WHERE mcp_server_id = ?').run(id)
      await tx.prepare('DELETE FROM mcp_servers WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(id, userId)
    })
    if (folder !== null && folder.trim() !== '' && (row.source_type === 'code' || row.source_type === 'package')) {
      try {
        // 目录来自库列，可能被改写成任意路径：清理前按归属重算一次，只删用户 mcp 根内的目录。
        rmSync(this.runtime.userDirs.within(username, 'mcp', folder), { recursive: true, force: true })
      } catch (error) {
        // 记录已删：目录删不掉或越界只留磁盘残留，不制造「删了但报错」的歧义。
        console.log(`soloengine: removing the upload directory of mcp server ${id} failed: ${String(error)}`)
      }
    }
  }

  /**
   * 缓存一次枚举结果（工具/资源/提示词单条 UPDATE 原子写，三列同一代）。
   * @param id - 服务器 ID。
   * @param capabilities - 本次枚举到的三类能力。
   */
  async cacheCapabilities(id: string, capabilities: {
    tools: McpToolInfo[]
    resources: McpResourceInfo[]
    prompts: McpPromptInfo[]
  }): Promise<void> {
    await this.db.prepare(
      'UPDATE mcp_servers SET tools = ?, resources = ?, prompts = ?, updated_at = ? WHERE id = ?',
    ).run(
      JSON.stringify(capabilities.tools),
      JSON.stringify(capabilities.resources),
      JSON.stringify(capabilities.prompts),
      new Date().toISOString(),
      id,
    )
  }

  /** 读取缓存工具清单。 */
  async cachedTools(id: string): Promise<McpToolInfo[]> {
    const row = await this.db.prepare('SELECT tools FROM mcp_servers WHERE id = ?').get<{ tools: string | null }>(id)
    if (row?.tools === null || row?.tools === undefined || row.tools === '') return []
    try { return JSON.parse(row.tools) as McpToolInfo[] } catch { return [] }
  }

  /**
   * 连接测试：真实 `initialize` 握手（HTTP 走 Streamable HTTP + 版本协商；stdio 走子进程）。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @returns 测试结果（六类归因；stdio 成功时回传真实 serverInfo）。
   */
  async testConnectivity(userId: string, id: string): Promise<McpTestResult> {
    const row = await this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    const result = await this.probe(row)
    await this.recordTest(id, result)
    return result
  }

  /** 执行一次连接探针（不落库；由 {@link testConnectivity} 记录结论）。 */
  private async probe(row: McpServerRow): Promise<McpTestResult> {
    // 计时从解析连接规格开始：配置缺失也是一次真实的测试尝试，耗时照实记录。
    const started = Date.now()
    const resolved = await this.managementTarget(row)
    if (resolved.target === null) {
      return { ok: false, kind: resolved.kind, message: resolved.message, latency_ms: Date.now() - started }
    }
    try {
      const info = await withClient(resolved.target, async client => describeServer(client))
      return {
        ok: true,
        latency_ms: Date.now() - started,
        serverInfo: info.name === '' ? { name: row.name } : info,
      }
    } catch (error) {
      return { ok: false, ...classifyManagementError(error, row.transport_type), latency_ms: Date.now() - started }
    }
  }

  /**
   * 记录最近一次测试结论（诊断列，刷新后仍可见）。
   * @param id - 服务器 ID。
   * @param result - 本次测试结果（含耗时毫秒）。
   */
  private async recordTest(id: string, result: McpTestResult): Promise<void> {
    try {
      await this.db.prepare(
        'UPDATE mcp_servers SET last_test_ok = ?, last_test_kind = ?, last_test_ms = ?, last_tested_at = ? WHERE id = ?',
      ).run(result.ok ? 1 : 0, result.kind ?? null, result.latency_ms ?? null, new Date().toISOString(), id)
    } catch (error) {
      // 结论本身必须返回：诊断列写失败只打行，不把「连通」判成失败。
      console.log(`soloengine: recording the mcp test result of ${id} failed: ${String(error)}`)
    }
  }

  /**
   * 解析一行服务器的管理面连接规格（空配置按六类归因返回，不发起连接）。
   * @param row - 服务器行。
   * @returns 连接规格，或直接可返回的失败归因。
   */
  private async managementTarget(row: McpServerRow): Promise<
    { target: ManagementTarget } | { target: null; kind: McpFailureKind; message: string }
  > {
    if (row.transport_type === 'stdio') {
      const config = await this.stdio(row.id)
      const command = config?.command ?? ''
      if (command.trim() === '') return { target: null, kind: 'command_missing', message: 'stdio command is empty' }
      const target = stdioTarget(command, config)
      // 命令解析前置：SDK 在 Windows 经 shell 启动时，不存在的命令只会以「连接关闭」告终，
      // 没有 ENOENT 可读——在 spawn 前按 PATH/PATHEXT 判一次，归因不靠英文 message。
      if (!commandExists(command, target.env, target.cwd)) {
        return { target: null, kind: 'command_missing', message: `command not found: ${command}` }
      }
      return { target }
    }
    const config = await this.http(row.id)
    const url = config?.url ?? ''
    if (url.trim() === '') return { target: null, kind: 'address_unreachable', message: 'http url is empty' }
    return { target: httpTarget(url, config) }
  }

  /**
   * 能力枚举（工具 / 资源 / 资源模板 / 提示词），逐页拉全并写回记录。
   *
   * 未实现某类列表的服务端按空集处理（JSON-RPC `-32601`）；其余错误原样归因。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @returns 四类能力清单（成功时同时回传真实 serverInfo）。
   */
  async enumerate(userId: string, id: string): Promise<McpTestResult> {
    const row = await this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    const resolved = await this.managementTarget(row)
    if (resolved.target === null) return { ok: false, kind: resolved.kind, message: resolved.message }
    const timeout = resolved.target.timeoutMs
    try {
      const discovered = await withClient(resolved.target, async (client) => {
        const tools = await listCapability(async (cursor) => {
          const page = await client.listTools(cursor === undefined ? undefined : { cursor }, { timeout })
          return { items: page.tools, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
        })
        const resources = await listCapability(async (cursor) => {
          const page = await client.listResources(cursor === undefined ? undefined : { cursor }, { timeout })
          return { items: page.resources, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
        })
        const resourceTemplates = await listCapability(async (cursor) => {
          const page = await client.listResourceTemplates(cursor === undefined ? undefined : { cursor }, { timeout })
          return { items: page.resourceTemplates, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
        })
        const prompts = await listCapability(async (cursor) => {
          const page = await client.listPrompts(cursor === undefined ? undefined : { cursor }, { timeout })
          return { items: page.prompts, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
        })
        return { tools, resources, resourceTemplates, prompts, serverInfo: describeServer(client) }
      })
      await this.cacheCapabilities(id, discovered)
      return {
        ok: true,
        tools: discovered.tools,
        resources: discovered.resources,
        resourceTemplates: discovered.resourceTemplates,
        prompts: discovered.prompts,
        serverInfo: discovered.serverInfo,
      }
    } catch (error) {
      return { ok: false, ...classifyManagementError(error, row.transport_type) }
    }
  }

  /**
   * 单工具试运行（按 schema 生成表单由前端负责；此处先本地校验再执行真实调用）。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @param toolName - 工具名。
   * @param args - 参数对象。
   * @returns 真实结果（保留 `content[]` 与 `structuredContent`）或结构化错误。
   */
  async callTool(userId: string, id: string, toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const row = await this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    // 已枚举到的工具按它的 inputSchema 先校验：必填/类型/enum/嵌套在发请求前就拦住。
    const tool = (await this.cachedTools(id)).find(item => item.name === toolName)
    if (tool !== undefined) {
      const violations = validateToolArguments(tool.inputSchema, args)
      if (violations.length > 0) return { ok: false, errorCode: 'INVALID_ARGUMENTS', violations }
    }
    const resolved = await this.managementTarget(row)
    if (resolved.target === null) return { ok: false, error: resolved.message }
    try {
      const called = await withClient(resolved.target, async (client) => {
        // 服务端明确声明不支持 tools：试运行没有意义，按能力缺席报出（不是「调用失败」）。
        const declared = client.getServerCapabilities()
        if (declared !== undefined && declared.tools === undefined) return null
        return await client.callTool({ name: toolName, arguments: args }, { timeout: resolved.target.timeoutMs })
      })
      if (called === null) {
        return { ok: false, errorCode: 'TOOLS_NOT_ENUMERATED', error: `server ${row.name} does not advertise the tools capability` }
      }
      if (called.isError === true) return { ok: false, error: callResultText(called) }
      return { ok: true, result: called }
    } catch (error) {
      return { ok: false, error: failureText(error).slice(0, 800) }
    }
  }
}

/**
 * 从缓存的枚举结果里取出工具名。
 *
 * 缓存列存的是 `McpToolInfo[]`（`{name, description, inputSchema}` 对象数组），不是字符串数组；
 * 把它当字符串数组解析会得到一串 `[object Object]`，于是「明明枚举到的工具」被判成未知。
 * @param text - `mcp_servers.tools` 列文本。
 * @returns 工具名数组（形态异常即空数组）。
 */
/**
 * 把一条错误的整条链（含 `cause` 与 AggregateError 的 `errors[]`）拼成可判定的文本。
 * 传输层超时一般以 `TypeError: fetch failed` 为外壳、真正原因埋在 cause 链里，
 * 只看最外层会错判成 unknown。
 */
function failureText(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    const node = current as { code?: unknown; message?: unknown; name?: unknown; errors?: unknown; cause?: unknown }
    if (typeof node.name === 'string') parts.push(node.name)
    if (typeof node.code === 'string') parts.push(node.code)
    if (typeof node.code === 'number') parts.push(String(node.code))
    if (typeof node.message === 'string') parts.push(node.message)
    if (Array.isArray(node.errors)) {
      for (const inner of node.errors) {
        const entry = inner as { code?: unknown; message?: unknown; name?: unknown }
        if (typeof entry?.name === 'string') parts.push(entry.name)
        if (typeof entry?.code === 'string') parts.push(entry.code)
        if (typeof entry?.message === 'string') parts.push(entry.message)
      }
    }
    current = node.cause
  }
  return parts.join(' | ')
}

/**
 * 读文件头部若干字节（不把整份文件读进内存）。
 * @param path - 文件绝对路径。
 * @param length - 采样字节数。
 * @returns 实际读到的字节（文件更短时更少）。
 */
function readHead(path: string, length: number): Uint8Array {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const read = readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/** 判断一个数据库错误是否为唯一约束冲突（SQLite 报 UNIQUE，PostgreSQL 报 duplicate key）。 */
function isUniqueViolation(error: unknown): boolean {
  const text = failureText(error)
  return /UNIQUE constraint failed|duplicate key value|SQLITE_CONSTRAINT/i.test(text)
}

function parseToolNames(text: string | null): string[] {
  if (text === null || text.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry: unknown) => {
        if (typeof entry === 'string') return entry
        if (entry !== null && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
          return String((entry as { name: string }).name)
        }
        return ''
      })
      .filter(name => name !== '')
  } catch {
    return []
  }
}

/** 解析 JSON 数组文本（失败返回空数组）。 */
function parseJsonArray(text: string | null): string[] {
  if (text === null || text === '') return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : []
  } catch {
    return []
  }
}

/** 解析字符串字典（失败/非对象返回空对象）。 */
function parseStringRecord(text: string | null): Record<string, string> {
  if (text === null || text === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') record[key] = value
    }
    return record
  } catch {
    return {}
  }
}

/**
 * 递归列出目录下的文件（符号链接跳过）。
 *
 * `limit` 为 null 时不设上限（上传隔离目录）；有上限时超出的条目被截断并用 `truncated` 标出，
 * 不静默当成「就这么多」。
 * @param root - 清单根目录。
 * @param limit - 条目上限；null 表示不限。
 * @returns 文件条目（按路径排序）与是否被截断。
 */
function walkTree(root: string, limit: number | null): { files: McpServerFileEntry[]; truncated: boolean } {
  const files: McpServerFileEntry[] = []
  let truncated = false
  const read = (path: string): Dirent[] => {
    try {
      return readdirSync(path, { withFileTypes: true })
    } catch (error) {
      throw new FrameworkError(409, 'DIRECTORY_UNREADABLE', `cannot list ${path}: ${String(error)}`)
    }
  }
  const entryOf = (child: string): McpServerFileEntry | null => {
    try {
      return {
        path: relativePath(root, child).replace(/\\/gu, '/'),
        bytes: lstatSync(child).size,
        text: looksTextual(readHead(child, TEXT_SAMPLE_BYTES), { sample: true }),
      }
    } catch {
      // 遍历期间文件被删除或不可读：跳过这一条，不制造不存在的条目。
      return null
    }
  }
  const walk = (current: string): void => {
    for (const entry of read(current)) {
      if (truncated) return
      const child = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (limit !== null && files.length >= limit) {
        truncated = true
        return
      }
      const file = entryOf(child)
      if (file !== null) files.push(file)
    }
  }
  walk(root)
  return { files: files.sort((left, right) => left.path.localeCompare(right.path)), truncated }
}

/**
 * stdio 服务器可列出的本机目录。
 *
 * 只认真实存在的目录：显式 `working_dir`、行上记录的 `folder_path`（与运行期 cwd 的
 * `working_dir ?? folder_path` 同一顺序），或绝对路径 `command` 所在目录
 * （命令本身是目录时取它自己）。相对命令名（`npx`、`node`）不是目录引用，不参与推导。
 * @param config - stdio 传输子表行。
 * @returns 目录绝对路径；没有可用目录时为 null。
 */
function localDirectory(config: McpStdioRow | undefined): string | null {
  const declared = [String(config?.working_dir ?? '').trim(), String(config?.folder_path ?? '').trim()]
  const command = String(config?.command ?? '').trim()
  let fromCommand = ''
  if (command !== '' && isAbsolute(command) && existsSync(command)) {
    try {
      fromCommand = lstatSync(command).isDirectory() ? command : dirname(command)
    } catch {
      // 命令路径在探测期间消失：没有可推导的目录，继续走下一个候选。
      fromCommand = ''
    }
  }
  for (const candidate of [...declared, fromCommand]) {
    if (candidate === '') continue
    try {
      const resolved = resolve(candidate)
      if (existsSync(resolved) && lstatSync(resolved).isDirectory()) return resolved
    } catch {
      // 候选不可读/不可解析：不把它当成目录，继续下一个。
    }
  }
  return null
}

/**
 * 解析服务器可展示的包版本。
 *
 * 只认能证明来源的两处：上传包目录里的 `package.json.version`，或 npx/uvx 命令规格里的
 * `pkg@1.2.3` / `pkg==1.2.3`。解析不出来就返回 null——绝不用乐观锁 revision 冒充产品版本。
 * @param row - 服务器行。
 * @param config - stdio 传输子表行。
 * @returns 版本字符串或 null。
 */
function packageVersion(row: McpServerRow, config: McpStdioRow | null): string | null {
  const folder = String(config?.folder_path ?? '').trim()
  if ((row.source_type === 'code' || row.source_type === 'package') && folder !== '') {
    const fromManifest = manifestVersion(join(folder, 'package.json'))
    if (fromManifest !== null) return fromManifest
  }
  if (config === null) return null
  return versionFromCommandSpec(String(config.command ?? ''), parseJsonArray(config.args))
}

/** 读 package.json 的 version（非普通文件/超限/不可解析一律 null）。 */
function manifestVersion(path: string): string | null {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'string' && version.trim() !== '' ? version.trim() : null
  } catch {
    // 清单不存在或不是合法 JSON：版本不可解析，交给命令行规格兜底。
    return null
  }
}

/**
 * 从 npx/uvx 命令规格里取版本（`@scope/pkg@0.6.2`、`pkg==1.2.3`）。
 * @param command - 启动命令（取 basename，忽略 `.cmd`/`.exe`）。
 * @param args - 启动参数。
 * @returns 版本字符串；规格未固定版本或不是包运行器时 null。
 */
function versionFromCommandSpec(command: string, args: string[]): string | null {
  const runner = command.trim().replace(/^.*[\\/]/u, '').replace(/\.(?:cmd|exe|bat)$/iu, '').toLowerCase()
  if (runner !== 'npx' && runner !== 'uvx') return null
  const spec = args.find(argument => !argument.startsWith('-')) ?? ''
  if (spec === '' || spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:/u.test(spec)) return null
  const pinned = spec.includes('==')
  const index = spec.lastIndexOf(pinned ? '==' : '@')
  // `@scope/name` 的 `@` 在首位：那是作用域分隔符，不是版本分隔符。
  if (index <= 0) return null
  const version = spec.slice(index + (pinned ? 2 : 1)).trim()
  return /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/u.test(version) ? version : null
}

/** 管理面连接规格（由 mcp_servers 行 + 传输子表解析；不进 harness 插件树）。 */
interface ManagementTarget {
  transport: 'stdio' | 'http'
  /** stdio：命令与参数。 */
  command: string
  args: string[]
  /** stdio：行上显式声明的环境变量（与清洗后的父环境合并）。 */
  env: Record<string, string>
  cwd?: string
  /** http：地址与附加头。 */
  url: string
  headers: Record<string, string>
  /** 单次请求超时（毫秒）。 */
  timeoutMs: number
}

/**
 * stdio 传输规格（cwd 语义与 harness 挂载侧一致：`working_dir ?? folder_path`）。
 * 超时取行上的秒数（范围已在写路径上校验），缺省 30 秒——与 HTTP 传输同一口径。
 * @param command - 可执行命令。
 * @param config - stdio 传输子表行。
 * @returns 管理面连接规格。
 */
function stdioTarget(command: string, config: McpStdioRow | undefined): ManagementTarget {
  const dir = config?.working_dir ?? config?.folder_path
  const seconds = Number(config?.timeout ?? DEFAULT_TIMEOUT_SECONDS)
  return {
    transport: 'stdio',
    command,
    args: parseJsonArray(config?.args ?? null),
    env: parseStringRecord(config?.env ?? null),
    ...(dir !== null && dir !== undefined && String(dir).trim() !== '' ? { cwd: String(dir) } : {}),
    url: '',
    headers: {},
    timeoutMs: Math.max(1000, (Number.isFinite(seconds) ? seconds : DEFAULT_TIMEOUT_SECONDS) * 1000),
  }
}

/**
 * HTTP 传输规格（超时取行上的秒数；范围已在写路径上校验）。
 * @param url - Streamable HTTP 端点。
 * @param config - HTTP 传输子表行。
 * @returns 管理面连接规格。
 */
function httpTarget(url: string, config: McpHttpRow | undefined): ManagementTarget {
  const seconds = Number(config?.timeout ?? DEFAULT_TIMEOUT_SECONDS)
  return {
    transport: 'http',
    command: '',
    args: [],
    env: {},
    url,
    headers: parseStringRecord(config?.headers ?? null),
    timeoutMs: Math.max(1000, (Number.isFinite(seconds) ? seconds : DEFAULT_TIMEOUT_SECONDS) * 1000),
  }
}

/**
 * 校验上传服务器的启动命令（runtime）。
 *
 * 该值会成为 stdio 子进程的 `command`：拒绝空串、`..` 路径段与 shell 元字符
 * （`& | ; ` $ < > ^ %`、引号、换行与 NUL）——命令只按 argv 直接拉起，不经过 shell 解释。
 * @param raw - 请求里的 runtime。
 * @returns 通过校验的命令文本。
 * @throws FrameworkError 400 `RUNTIME_REQUIRED` / `INVALID_RUNTIME`。
 */
function assertUploadRuntime(raw: string): string {
  const command = String(raw ?? '').trim()
  if (command === '') {
    throw new FrameworkError(400, 'RUNTIME_REQUIRED', 'runtime must be a non-empty launch command')
  }
  if (command.split(/[\\/]/u).includes('..')) {
    throw new FrameworkError(400, 'INVALID_RUNTIME', `runtime ${JSON.stringify(command)} must not contain ".." path segments`)
  }
  if (/[&|;`$<>^%"'\r\n\0]/u.test(command)) {
    throw new FrameworkError(400, 'INVALID_RUNTIME',
      `runtime ${JSON.stringify(command)} must not contain shell metacharacters or quotes`)
  }
  return command
}

/**
 * 判定 stdio 命令能否解析（绝对/相对路径按存在性，裸名按 PATH + PATHEXT）。
 *
 * 子进程实际环境 = 清洗后的父环境 + 行上声明的 env，故这里也按同一份 PATH 判定。
 * 带分隔符的相对命令由子进程在自身工作目录下解析，故按行上的 cwd 判定而不是本进程 cwd。
 * @param command - 行上配置的命令。
 * @param extraEnv - 行上声明的环境变量。
 * @param cwd - 子进程工作目录（`working_dir ?? folder_path`）；缺省时按本进程 cwd。
 * @returns 能否解析到可执行文件。
 */
function commandExists(command: string, extraEnv: Record<string, string>, cwd?: string): boolean {
  return resolveExecutable(command, extraEnv, cwd) !== undefined
}

/**
 * 把命令解析成宿主可执行文件的绝对路径（裸名按 PATH + PATHEXT）。
 * @param command - 行上配置的命令。
 * @param extraEnv - 行上声明的环境变量。
 * @param cwd - 子进程工作目录。
 * @returns 绝对路径；解析不到时 undefined。
 */
function resolveExecutable(command: string, extraEnv: Record<string, string>, cwd?: string): string | undefined {
  const trimmed = command.trim()
  if (trimmed === '') return undefined
  if (isAbsolute(trimmed)) return existsSync(trimmed) ? trimmed : undefined
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    const candidate = resolve(cwd !== undefined && cwd.trim() !== '' ? cwd : process.cwd(), trimmed)
    return existsSync(candidate) ? candidate : undefined
  }
  const env = { ...scrubbedParentEnv(), ...extraEnv }
  const pathValue = env.PATH ?? env.Path ?? ''
  const windows = process.platform === 'win32'
  const extensions = windows
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(extension => extension !== '')
    : ['']
  for (const dir of pathValue.split(windows ? ';' : ':')) {
    if (dir.trim() === '') continue
    for (const extension of extensions) {
      const candidate = join(dir, `${trimmed}${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * 解析 stdio 的实际启动命令行。
 *
 * 官方 SDK 的 `StdioClientTransport` 固定 `shell: false`；Windows 上 `npx`/`pnpm`/`uvx` 都是
 * `.cmd` 垫片，Node 18+ 不允许无 shell 直接拉起（ENOENT/EINVAL）。这里把 `.cmd`/`.bat`
 * 解析成 `cmd.exe /d /s /c "<行>"`，其余命令直接以解析到的绝对路径启动。
 *
 * 该命令本来就由已登录用户配置（stdio MCP 的语义就是启动用户指定的进程），经 cmd 解释
 * 不扩大权限面；每个参数加双引号并按 cmd 规则翻倍内嵌引号，避免空格被拆开。
 * @param command - 行上配置的命令。
 * @param args - 行上配置的参数。
 * @param extraEnv - 行上声明的环境变量。
 * @param cwd - 子进程工作目录。
 * @returns 可直接交给 `StdioClientTransport` 的命令与参数。
 */
function resolveStdioLaunch(
  command: string,
  args: readonly string[],
  extraEnv: Record<string, string>,
  cwd?: string,
): { command: string; args: string[] } {
  const passthrough = { command, args: [...args] }
  if (process.platform !== 'win32') return passthrough
  const resolved = resolveExecutable(command, extraEnv, cwd)
  if (resolved === undefined) return passthrough
  const lower = resolved.toLowerCase()
  if (!lower.endsWith('.cmd') && !lower.endsWith('.bat')) return { command: resolved, args: [...args] }
  const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe'
  const line = [resolved, ...args].map(arg => `"${arg.replace(/"/gu, '""')}"`).join(' ')
  return { command: comspec, args: ['/d', '/s', '/c', line] }
}

/**
 * 开一次管理面会话并执行回调；结束时关闭。
 *
 * 协议细节（版本协商、`Mcp-Session-Id`、SSE、分页、取消）由官方 SDK 承担——与
 * dsh `mcp-client` 同源，避免管理面与运行期出现两套协议实现。
 * @param target - 连接规格。
 * @param run - 已连接客户端上的操作。
 * @returns 回调结果。
 */
async function withClient<T>(target: ManagementTarget, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(
    { name: 'soloengine-framework', version: '0.1.0' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } },
  )
  const transport = target.transport === 'stdio'
    ? new StdioClientTransport({
      ...resolveStdioLaunch(target.command, target.args, target.env, target.cwd),
      env: { ...scrubbedParentEnv(), ...target.env },
      ...(target.cwd === undefined ? {} : { cwd: target.cwd }),
    })
    : new StreamableHTTPClientTransport(new URL(target.url), {
      requestInit: {
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...target.headers,
        },
      },
    })
  try {
    await client.connect(transport, { timeout: target.timeoutMs })
    return await run(client)
  } finally {
    await closeWithCap(client)
  }
}

/** 关闭有上限：坏传输不能把管理面请求永久挂住（也不让两次探针重叠子进程）。 */
async function closeWithCap(client: Client): Promise<void> {
  await Promise.race([
    client.close().catch(() => {
      // 探针结果优先：关闭失败不覆盖真正的成功/失败结论。
    }),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, MANAGEMENT_CLOSE_TIMEOUT_MS)
      timer.unref()
    }),
  ])
}

/** 服务端身份（`getServerVersion()` 缺失时给空名，由调用方回退到配置名）。 */
function describeServer(client: Client): { name: string; version?: string } {
  const info = client.getServerVersion()
  if (info === undefined) return { name: '' }
  return {
    name: typeof info.name === 'string' ? info.name : '',
    ...(typeof info.version === 'string' && info.version !== '' ? { version: info.version } : {}),
  }
}

/**
 * 逐页拉全一个列表（`nextCursor` 直到耗尽）。
 * @param fetchPage - 按游标取一页。
 * @returns 全部条目（按页顺序拼接）。
 */
async function listAllPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const { items: batch, nextCursor } = await fetchPage(cursor)
    items.push(...batch)
    if (nextCursor === undefined || nextCursor === '') break
    cursor = nextCursor
  }
  return items
}

/** 一类能力列表：服务端未实现（`-32601`）按空集处理，其余错误上抛。 */
async function listCapability<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<T[]> {
  try {
    return await listAllPages(fetchPage)
  } catch (error) {
    if (isMethodNotFound(error)) return []
    throw error
  }
}

/** JSON-RPC `-32601 Method not found`：能力缺席，不是故障。 */
function isMethodNotFound(error: unknown): boolean {
  return /-32601|Method not found|METHOD_NOT_FOUND/i.test(failureText(error))
}

/**
 * 六类归因：读结构化 `code`/`status`（spawn 失败不再靠英文 message 子串判定）。
 * @param error - SDK 抛出的错误。
 * @param transport - 传输类型（决定「命令不存在」是否可归因）。
 * @returns 失败类别与诊断文本。
 */
function classifyManagementError(error: unknown, transport: string): { kind: McpFailureKind; message: string } {
  const chain = failureText(error)
  const node = error as { code?: unknown; status?: unknown; name?: unknown }
  const message = error instanceof Error ? error.message : String(error)
  if (transport === 'stdio' && (node.code === 'ENOENT' || /\bENOENT\b/u.test(chain))) {
    return { kind: 'command_missing', message: `command not found (${message})` }
  }
  if (node.code === -32001
    || /RequestTimeout|AbortError|TimeoutError|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|aborted due to timeout/i.test(chain)) {
    return { kind: 'timeout', message: `request timed out (${message})` }
  }
  if (node.status === 401 || node.status === 403) {
    return { kind: 'auth_failed', message: `authentication rejected (${message})` }
  }
  if (/ENOTFOUND|EAI_AGAIN|EAI_FAIL|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE/i.test(chain)) {
    return { kind: 'address_unreachable', message: `endpoint not usable (${message})` }
  }
  if (transport === 'stdio' && /spawn/i.test(`${String(node.name ?? '')} ${message}`)) {
    return { kind: 'spawn_failed', message }
  }
  return { kind: 'handshake_failed', message }
}

/**
 * 按 MCP 工具 inputSchema 校验试运行参数。
 *
 * schema 含未支持词汇时跳过（前端已降级为 JSON 文本域）；支持的 schema 覆盖
 * required/类型/enum/嵌套/items，违规按字段路径与类别返回，文案由前端本地化。
 * @param schema - 工具的 `inputSchema`。
 * @param args - 组装好的参数对象。
 * @returns 字段级违规（空数组 = 通过）。
 */
function validateToolArguments(schema: unknown, args: Record<string, unknown>): McpArgumentViolation[] {
  const checked = supportedSchema(schema)
  if (checked === null) return []
  return validateJsonSchemaValue(checked, args, 'value').map((text) => {
    const quoted = /"([^"]+)"/u.exec(text)?.[1] ?? 'value'
    const path = quoted.startsWith('value.')
      ? quoted.slice('value.'.length)
      : quoted === 'value' ? '' : quoted
    const kind: McpArgumentViolation['kind'] = text.startsWith('missing required property')
      ? 'required'
      : / must be /u.test(text) ? 'type' : 'other'
    return { path, kind }
  })
}

/** 校验并返回受支持的 schema（不支持返回 null）。 */
function supportedSchema(schema: unknown): JsonSchemaNode | null {
  try {
    assertSupportedJsonSchema(schema)
    return schema
  } catch {
    return null
  }
}

/** 工具返回的文本内容（`isError` 时作为错误文案）。 */
function callResultText(result: { content?: readonly { type?: string; text?: string }[] }): string {
  const parts = (result.content ?? []).flatMap(block =>
    block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
  return parts.join('\n').slice(0, 800)
}
