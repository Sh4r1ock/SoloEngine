/**
 * MCP 服务器域（PRD-05 FR-MCP-001~010）。
 *
 * - `mcp_servers` 主表 + `mcp_stdio_configs` / `mcp_http_configs` 两张传输子表（一对一）；
 * - 名称约束 `[A-Za-z0-9_-]{1,32}`（决定模型可见工具名前缀 `mcp__<name>__<tool>`）；
 * - 连接测试失败六类归因；能力枚举（工具/资源/提示词）；单工具试运行；
 * - 启用中的服务器由 `@soloengine/host` 翻译为 dsh `mcp-client` 原生配置行（热挂载）。
 *
 * 本模块只做「配置源」；连接、工具发现、断线重连由 dsh 原生连接器承担。
 *
 * @module @soloengine/framework/modules/mcp
 */

import type { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'

/** 服务名约束（与 dsh `serverName` 一致）。 */
export const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

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
  /** 单工具停用清单（JSON 数组文本；PRD-05 FR-MCP-008）。 */
  disabled_tools: string | null
  source: string | null
  created_at: string | null
  updated_at: string | null
  version: number
}

/** stdio 传输子表行。 */
export interface McpStdioRow {
  mcp_server_id: string
  command: string | null
  args: string | null
  env: string | null
  folder_path: string | null
  working_dir: string | null
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
export interface McpServerView extends Omit<McpServerRow, 'is_active' | 'is_public'> {
  is_active: boolean
  is_public: boolean
  /** 已停用的工具名（空数组即全部启用）。 */
  disabledTools: string[]
  stdio: McpStdioRow | null
  http: McpHttpRow | null
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
  working_dir?: string
  /** HTTP 参数。 */
  url?: string
  headers?: string
  timeout?: number
  version?: number
}

/** 枚举到的工具。 */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

/** 枚举到的资源/提示词。 */
export interface McpResourceInfo {
  uri: string
  name?: string
  description?: string
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
  prompts?: McpResourceInfo[]
}

/** MCP 服务器域服务。 */
export class McpService {
  private readonly raw: DatabaseSync
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.raw = runtime.db.raw
    this.runtime = runtime
  }

  /** 列某用户服务器（含公共）。 */
  list(userId: string): McpServerRow[] {
    return this.raw.prepare(
      'SELECT * FROM mcp_servers WHERE user_id = ? OR user_id IS NULL ORDER BY created_at ASC',
    ).all(userId) as unknown as McpServerRow[]
  }

  /** 行 → 对外视图（布尔归一化 + 传输子表 + 停用工具清单）。 */
  view(row: McpServerRow): McpServerView {
    const { is_active, is_public, ...rest } = row
    return {
      ...rest,
      is_active: is_active === 1,
      is_public: is_public === 1,
      disabledTools: parseJsonArray(row.disabled_tools),
      stdio: this.stdio(row.id) ?? null,
      http: this.http(row.id) ?? null,
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
  byNameScoped(userId: string, name: string): McpServerRow | undefined {
    return this.raw.prepare('SELECT * FROM mcp_servers WHERE name = ? AND (user_id = ? OR user_id IS NULL)')
      .get(name, userId) as McpServerRow | undefined
  }

  /** 某服务器的停用工具名（空表即全部启用）。 */
  disabledTools(id: string): string[] {
    const row = this.raw.prepare('SELECT disabled_tools FROM mcp_servers WHERE id = ?').get(id) as { disabled_tools: string | null } | undefined
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
  setToolActive(userId: string, id: string, toolName: string, active: boolean): McpServerRow {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
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
    this.raw.prepare('UPDATE mcp_servers SET disabled_tools = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(JSON.stringify(next), now, id)
    return this.raw.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as unknown as McpServerRow
  }

  /**
   * 上传建服务（PRD-05 FR-MCP-007）：把上传的代码/包落进**用户隔离目录**并物化为可运行
   * 的 stdio 服务器。
   *
   * 落盘位 = `data/home/users/<username>/mcp/<name>/`（tenancy 第 2 层用户目录隔离）；
   * 代码上传写 `index.mjs` + `package.json`；包上传解压（逐条防路径穿越，与技能导入同一规则）；
   * 两者都物化为 `command = 当前 Node 可执行文件、args = [入口绝对路径]、working_dir = 服务器目录`
   * 的 stdio 配置行——即「上传即可被连接器拉起、可枚举、可试运行」。
   * @param userId - 归属用户。
   * @param username - 登录名（用户目录分配键）。
   * @param input - 上传内容（code 或 archiveBase64 二选一）。
   * @returns 服务器行。
   */
  createUploaded(
    userId: string,
    username: string,
    input: {
      name?: string | undefined
      kind?: string | undefined
      code?: string | undefined
      archiveBase64?: string | undefined
      description?: string | undefined
    },
  ): McpServerRow {
    const name = String(input.name ?? '').trim()
    const kind = input.kind === 'package' ? 'package' : 'code'
    if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'name is required')
    this.assertName(name)
    const dir = resolve(this.runtime.userDirs.sub(username, 'mcp'), name)
    if (existsSync(dir)) {
      throw new FrameworkError(409, 'MCP_UPLOAD_EXISTS', `uploaded server directory "${name}" already exists`)
    }
    mkdirSync(dir, { recursive: true })
    let entryRelative = 'index.mjs'
    if (kind === 'package') {
      if (typeof input.archiveBase64 !== 'string' || input.archiveBase64 === '') {
        throw new FrameworkError(400, 'ARCHIVE_REQUIRED', 'package upload requires archiveBase64')
      }
      const files = unzipSync(new Uint8Array(Buffer.from(input.archiveBase64, 'base64')))
      // 防穿越：拒绝绝对路径与 `..` 段（与技能导入同一规则）。
      for (const path of Object.keys(files)) {
        const normalized = normalize(path)
        if (isAbsolute(normalized) || normalized.split(/[\\/]/u).includes('..')) {
          throw new FrameworkError(422, 'ARCHIVE_PATH_REJECTED', `archive entry escapes the server directory: ${path}`)
        }
      }
      for (const [path, bytes] of Object.entries(files)) {
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
      if (isAbsolute(entryRelative) || entryRelative.split(/[\\/]/u).includes('..')) {
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
    const row = this.create(userId, {
      name,
      transport_type: 'stdio',
      source_type: kind,
      ...(input.description === undefined ? {} : { description: input.description }),
      command: process.execPath,
      args: JSON.stringify([entryAbsolute]),
      working_dir: dir,
    })
    this.raw.prepare('UPDATE mcp_stdio_configs SET folder_path = ? WHERE mcp_server_id = ?').run(dir, row.id)
    return this.raw.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(row.id) as unknown as McpServerRow
  }

  /** 上传服务器的落盘目录（仅 code/package 来源有；归属与越界都在这里校验）。 */
  private uploadedDir(userId: string, username: string, id: string): { row: McpServerRow; dir: string } {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    if (row.source_type !== 'code' && row.source_type !== 'package') {
      throw new FrameworkError(409, 'NOT_UPLOADED', `server ${row.name} was not created by upload; it has no managed files`)
    }
    const declared = this.stdio(id)?.folder_path ?? ''
    if (declared === '') throw new FrameworkError(409, 'SERVER_DIR_MISSING', `uploaded server ${row.name} has no directory`)
    let dir: string
    try {
      dir = this.runtime.userDirs.within(username, 'mcp', declared)
    } catch (error) {
      throw new FrameworkError(400, 'PATH_ESCAPED', `uploaded server directory escaped the user mcp root: ${String(error)}`)
    }
    return { row, dir }
  }

  /** 列上传服务器的文件（相对路径 + 字节数）。 */
  listServerFiles(userId: string, username: string, id: string): { path: string; bytes: number }[] {
    const { dir } = this.uploadedDir(userId, username, id)
    const files: { path: string; bytes: number }[] = []
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const child = join(current, entry.name)
        if (entry.isDirectory()) walk(child)
        else {
          const relative = normalize(child).slice(normalize(dir).length + 1).replace(/\\/gu, '/')
          files.push({ path: relative, bytes: statSync(child).size })
        }
      }
    }
    walk(dir)
    return files.sort((left, right) => left.path.localeCompare(right.path))
  }

  /** 读上传服务器的单个文件（越界拒绝）。 */
  readServerFile(userId: string, username: string, id: string, relative: string): { path: string; content: string } {
    const { dir } = this.uploadedDir(userId, username, id)
    const target = this.safeServerPath(username, dir, relative)
    if (!existsSync(target) || statSync(target).isDirectory()) {
      throw new FrameworkError(404, 'FILE_NOT_FOUND', `no such file in the uploaded server: ${relative}`)
    }
    return { path: normalize(relative).replace(/\\/gu, '/'), content: readFileSync(target, 'utf8') }
  }

  /** 写上传服务器的单个文件（在线编辑落盘；越界拒绝）。 */
  writeServerFile(userId: string, username: string, id: string, relative: string, content: string): { path: string } {
    const { row, dir } = this.uploadedDir(userId, username, id)
    const target = this.safeServerPath(username, dir, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, { encoding: 'utf8' })
    const now = new Date().toISOString()
    this.raw.prepare('UPDATE mcp_servers SET updated_at = ?, version = version + 1 WHERE id = ?').run(now, row.id)
    return { path: normalize(relative).replace(/\\/gu, '/') }
  }

  /** 解析上传服务器内的相对路径：越出用户 mcp 根一律 400（防穿越的执行点）。 */
  private safeServerPath(username: string, dir: string, relative: string): string {
    try {
      return this.runtime.userDirs.within(username, 'mcp', resolve(dir, relative))
    } catch (error) {
      throw new FrameworkError(400, 'PATH_ESCAPED', `file path escapes the uploaded server: ${relative} (${String(error)})`)
    }
  }

  /** 列全部启用服务器（供 host 侧热挂载翻译）。 */
  listActive(): McpServerRow[] {
    return this.raw.prepare('SELECT * FROM mcp_servers WHERE is_active = 1 ORDER BY created_at ASC')
      .all() as unknown as McpServerRow[]
  }

  /** 按 ID 取（归属或公共）。 */
  byIdScoped(userId: string, id: string): McpServerRow | undefined {
    return this.raw.prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
      .get(id, userId) as McpServerRow | undefined
  }

  /**
   * 按 ID 取**原始行**（不做归属过滤）。
   *
   * 仅供「归属已在上游校验过」的内部路径使用（例如 host 侧挂载：服务器名已按该用户解析过，
   * 这里只是拿它的传输子表）；对外接口一律走 `byIdScoped`。
   * @param id - 服务器 ID。
   * @returns 行（不存在即抛错，不返回 undefined 让调用方猜）。
   */
  byIdRaw(id: string): McpServerRow {
    const row = this.raw.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow | undefined
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    return row
  }

  /** stdio 子表。 */
  stdio(id: string): McpStdioRow | undefined {
    return this.raw.prepare('SELECT * FROM mcp_stdio_configs WHERE mcp_server_id = ?').get(id) as McpStdioRow | undefined
  }

  /** HTTP 子表。 */
  http(id: string): McpHttpRow | undefined {
    return this.raw.prepare('SELECT * FROM mcp_http_configs WHERE mcp_server_id = ?').get(id) as McpHttpRow | undefined
  }

  /** 校验名称约束与跨实例唯一。 */
  private assertName(name: string, excludeId?: string): void {
    if (!MCP_NAME_PATTERN.test(name)) {
      throw new FrameworkError(400, 'INVALID_MCP_NAME',
        `server name ${JSON.stringify(name)} violates [A-Za-z0-9_-]{1,32} (it becomes the model-visible tool name prefix)`)
    }
    const existing = this.raw.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(name) as { id: string } | undefined
    if (existing !== undefined && existing.id !== excludeId) {
      throw new FrameworkError(409, 'MCP_NAME_TAKEN', `server name ${name} already exists (must be unique across the instance)`)
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
  create(userId: string, input: McpServerInput): McpServerRow {
    const name = String(input.name ?? '').trim()
    const transport = input.transport_type === 'http' ? 'http' : 'stdio'
    if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'name is required')
    this.assertName(name)
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
    const now = new Date().toISOString()
    const id = newId()
    return this.runtime.db.transaction(() => {
      this.raw.prepare(
        `INSERT INTO mcp_servers
          (id, user_id, name, transport_type, source_type, description, icon, is_active, is_public,
           author, tags, tools, source, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)`,
      ).run(id, userId, name, transport, input.source_type ?? 'manual', input.description ?? null, input.icon ?? null,
        input.is_active === false ? 0 : 1, input.is_public === true ? 1 : 0,
        input.author ?? null, input.tags ?? null, input.source_type ?? 'manual', now, now)
      if (transport === 'stdio') {
        this.raw.prepare(
          'INSERT INTO mcp_stdio_configs (mcp_server_id, command, args, env, folder_path, working_dir) VALUES (?, ?, ?, ?, NULL, ?)',
        ).run(id, String(input.command ?? ''), input.args ?? null, input.env ?? null, input.working_dir ?? null)
      } else {
        this.raw.prepare(
          'INSERT INTO mcp_http_configs (mcp_server_id, url, headers, timeout, session_id) VALUES (?, ?, ?, ?, NULL)',
        ).run(id, String(input.url ?? ''), input.headers ?? null, input.timeout ?? 30)
      }
      return this.byIdScoped(userId, id) as McpServerRow
    })
  }

  /**
   * 更新服务器（乐观锁）。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @param patch - 待更新字段。
   * @returns 服务器行。
   */
  update(userId: string, id: string, patch: McpServerInput): McpServerRow {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    if (patch.version === undefined) throw new FrameworkError(400, 'VERSION_REQUIRED', 'version is required for update')
    if (Number(patch.version) !== Number(row.version)) {
      throw new FrameworkError(409, 'VERSION_CONFLICT',
        `mcp server ${id} was modified (expected ${String(row.version)}, got ${String(patch.version)}); refresh and retry`)
    }
    if (patch.name !== undefined) this.assertName(patch.name, id)
    this.assertJson('args', patch.args, 'array')
    this.assertJson('env', patch.env, 'object')
    this.assertJson('headers', patch.headers, 'object')

    const now = new Date().toISOString()
    return this.runtime.db.transaction(() => {
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
      values.push(id, userId)
      this.raw.prepare(`UPDATE mcp_servers SET ${assignments.join(', ')} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
        .run(...values)
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
        if (assignments2.length > 0) {
          values2.push(id)
          this.raw.prepare(`UPDATE mcp_stdio_configs SET ${assignments2.join(', ')} WHERE mcp_server_id = ?`).run(...values2)
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
          this.raw.prepare(`UPDATE mcp_http_configs SET ${assignments2.join(', ')} WHERE mcp_server_id = ?`).run(...values2)
        }
      }
      return this.byIdScoped(userId, id) as McpServerRow
    })
  }

  /** 启用/停用（停用即从 host 侧热挂载清单移除 → 工具世代回滚）。 */
  setActive(userId: string, id: string, active: boolean): McpServerRow {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    return this.update(userId, id, { is_active: active, version: row.version })
  }

  /** 删除服务器（级联删除传输子表）。 */
  remove(userId: string, id: string): void {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    this.runtime.db.transaction(() => {
      this.raw.prepare('DELETE FROM mcp_stdio_configs WHERE mcp_server_id = ?').run(id)
      this.raw.prepare('DELETE FROM mcp_http_configs WHERE mcp_server_id = ?').run(id)
      this.raw.prepare('DELETE FROM mcp_servers WHERE id = ? AND (user_id = ? OR user_id IS NULL)').run(id, userId)
    })
  }

  /** 缓存工具清单（枚举结果缓存于记录）。 */
  cacheTools(id: string, tools: McpToolInfo[]): void {
    this.raw.prepare('UPDATE mcp_servers SET tools = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(tools), new Date().toISOString(), id)
  }

  /** 读取缓存工具清单。 */
  cachedTools(id: string): McpToolInfo[] {
    const row = this.raw.prepare('SELECT tools FROM mcp_servers WHERE id = ?').get(id) as { tools: string | null } | undefined
    if (row?.tools === null || row?.tools === undefined || row.tools === '') return []
    try { return JSON.parse(row.tools) as McpToolInfo[] } catch { return [] }
  }

  /**
   * 连接测试（HTTP 传输走 JSON-RPC initialize；stdio 走命令存在性 + 启动判定）。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @returns 测试结果（六类归因）。
   */
  async testConnectivity(userId: string, id: string): Promise<McpTestResult> {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    if (row.transport_type === 'stdio') return this.testStdio(row)
    return this.testHttp(row)
  }

  /** stdio 连接测试：真实 initialize 握手（命令存在性 / 启动 / 握手 / 超时六类归因）。 */
  private async testStdio(row: McpServerRow): Promise<McpTestResult> {
    const config = this.stdio(row.id)
    const command = config?.command ?? ''
    if (command.trim() === '') return { ok: false, kind: 'command_missing', message: 'stdio command is empty' }
    const started = Date.now()
    let session: StdioSession | undefined
    try {
      session = await openStdioSessionInitialized({
        command,
        args: parseJsonArray(config?.args ?? null),
        env: parseJsonObject(config?.env ?? null) as Record<string, string>,
        ...(config?.working_dir !== null && config?.working_dir !== undefined && config.working_dir !== ''
          ? { cwd: config.working_dir }
          : {}),
        timeoutMs: 10000,
      })
      const latency = Date.now() - started
      return { ok: true, latency_ms: latency, serverInfo: { name: row.name } }
    } catch (error) {
      const latency = Date.now() - started
      if (error instanceof StdioRpcError) {
        return { ok: false, kind: error.kind === 'spawn_failed' && error.message.includes('command not found') ? 'command_missing' : error.kind, message: error.message, latency_ms: latency }
      }
      return { ok: false, kind: 'unknown', message: String(error), latency_ms: latency }
    } finally {
      session?.close()
    }
  }

  /** HTTP 连接测试：JSON-RPC initialize 握手。 */
  private async testHttp(row: McpServerRow): Promise<McpTestResult> {
    const config = this.http(row.id)
    const url = config?.url ?? ''
    if (url.trim() === '') return { ok: false, kind: 'address_unreachable', message: 'http url is empty' }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(parseJsonObject(config?.headers ?? null) as Record<string, string>),
    }
    const timeoutMs = Math.max(1000, Number(config?.timeout ?? 30) * 1000)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)
    const started = Date.now()
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'soloengine', version: '0.1.0' } },
        }),
      })
      const latency = Date.now() - started
      if (response.status === 401 || response.status === 403) {
        return { ok: false, kind: 'auth_failed', message: `authentication rejected (${String(response.status)})`, latency_ms: latency }
      }
      if (!response.ok) {
        return { ok: false, kind: 'handshake_failed', message: `initialize returned ${String(response.status)}`, latency_ms: latency }
      }
      const text = await response.text()
      const payload = extractJsonRpc(text)
      if (payload?.result === undefined) {
        return { ok: false, kind: 'handshake_failed', message: text.slice(0, 300), latency_ms: latency }
      }
      const info = (payload.result as { serverInfo?: { name?: string; version?: string } }).serverInfo
      return { ok: true, latency_ms: latency, serverInfo: info ?? { name: row.name } }
    } catch (error) {
      const latency = Date.now() - started
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, kind: 'timeout', message: `initialize exceeded ${String(config?.timeout ?? 30)}s`, latency_ms: latency }
      }
      const chain = failureText(error)
      // 传输超时（undici TimeoutError，code 23 / "aborted due to timeout"）埋在 cause 链里。
      if (/aborted due to timeout|TimeoutError|ConnectTimeoutError|Connect Timeout Error|UND_ERR_CONNECT_TIMEOUT/i.test(chain)) {
        return { ok: false, kind: 'timeout', message: `transport timed out (${chain.slice(0, 200)})`, latency_ms: latency }
      }
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(chain)) {
        return { ok: false, kind: 'address_unreachable', message: `connection failed (${chain.slice(0, 200)})`, latency_ms: latency }
      }
      return { ok: false, kind: 'unknown', message: String(error), latency_ms: latency }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 能力枚举（工具/资源/提示词），结果缓存于记录。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @returns 工具与资源/提示词清单。
   */
  async enumerate(userId: string, id: string): Promise<McpTestResult> {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    if (row.transport_type === 'stdio') {
      // stdio 真实枚举（FR-MCP-003）：spawn + initialize + 三类 list，结果缓存于记录。
      const config = this.stdio(row.id)
      const command = config?.command ?? ''
      if (command.trim() === '') return { ok: false, kind: 'command_missing', message: 'stdio command is empty' }
      let session: StdioSession | undefined
      try {
        session = await openStdioSessionInitialized({
          command,
          args: parseJsonArray(config?.args ?? null),
          env: parseJsonObject(config?.env ?? null) as Record<string, string>,
          // cwd 语义与 harness 挂载侧一致：working_dir ?? folder_path（上传建服务物化目录）。
          ...(() => {
            const dir = config?.working_dir ?? config?.folder_path
            return dir !== null && dir !== undefined && String(dir).trim() !== '' ? { cwd: String(dir) } : {}
          })(),
          timeoutMs: 15000,
        })
        const toolsResult = await session.request('tools/list', {}) as { result?: { tools?: McpToolInfo[] }; error?: unknown }
        const resourcesResult = await session.request('resources/list', {}) as { result?: { resources?: McpResourceInfo[] }; error?: unknown }
        const promptsResult = await session.request('prompts/list', {}) as { result?: { prompts?: McpResourceInfo[] }; error?: unknown }
        const tools = toolsResult.result?.tools ?? []
        this.cacheTools(id, tools)
        return { ok: true, tools, resources: resourcesResult.result?.resources ?? [], prompts: promptsResult.result?.prompts ?? [] }
      } catch (error) {
        if (error instanceof StdioRpcError) return { ok: false, kind: error.kind, message: error.message }
        return { ok: false, kind: 'unknown', message: String(error) }
      } finally {
        session?.close()
      }
    }
    const config = this.http(row.id)
    const url = config?.url ?? ''
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(parseJsonObject(config?.headers ?? null) as Record<string, string>),
    }
    const call = async (method: string, params: unknown): Promise<unknown> => {
      const response = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      const text = await response.text()
      const payload = extractJsonRpc(text)
      return payload?.result
    }
    try {
      await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'soloengine', version: '0.1.0' } })
      const toolsResult = await call('tools/list', {}) as { tools?: McpToolInfo[] } | undefined
      const resourcesResult = await call('resources/list', {}) as { resources?: McpResourceInfo[] } | undefined
      const promptsResult = await call('prompts/list', {}) as { prompts?: McpResourceInfo[] } | undefined
      const tools = toolsResult?.tools ?? []
      this.cacheTools(id, tools)
      return { ok: true, tools, resources: resourcesResult?.resources ?? [], prompts: promptsResult?.prompts ?? [] }
    } catch (error) {
      return { ok: false, kind: 'unknown', message: String(error) }
    }
  }

  /**
   * 单工具试运行（按 schema 生成表单由前端负责；此处执行真实调用）。
   * @param userId - 归属用户。
   * @param id - 服务器 ID。
   * @param toolName - 工具名。
   * @param args - 参数对象。
   * @returns 真实结果或结构化错误。
   */
  async callTool(userId: string, id: string, toolName: string, args: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const row = this.byIdScoped(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'MCP_NOT_FOUND', `mcp server ${id} not found`)
    if (row.transport_type === 'stdio') {
      // stdio 真实试运行（FR-MCP-004）：spawn + initialize + tools/call，真实结果或结构化错误。
      const config = this.stdio(row.id)
      const command = config?.command ?? ''
      if (command.trim() === '') return { ok: false, error: 'stdio command is empty' }
      let session: StdioSession | undefined
      try {
        session = await openStdioSessionInitialized({
          command,
          args: parseJsonArray(config?.args ?? null),
          env: parseJsonObject(config?.env ?? null) as Record<string, string>,
          // cwd 语义与 harness 挂载侧一致：working_dir ?? folder_path（上传建服务物化目录）。
          ...(() => {
            const dir = config?.working_dir ?? config?.folder_path
            return dir !== null && dir !== undefined && String(dir).trim() !== '' ? { cwd: String(dir) } : {}
          })(),
          timeoutMs: 30000,
        })
        const payload = await session.request('tools/call', { name: toolName, arguments: args })
        if (payload.error !== undefined) return { ok: false, error: JSON.stringify(payload.error) }
        return { ok: true, result: payload.result }
      } catch (error) {
        return { ok: false, error: String(error) }
      } finally {
        session?.close()
      }
    }
    const config = this.http(row.id)
    const url = config?.url ?? ''
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(parseJsonObject(config?.headers ?? null) as Record<string, string>),
    }
    try {
      await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'soloengine', version: '0.1.0' } } }),
      })
      const response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } }),
      })
      const text = await response.text()
      const payload = extractJsonRpc(text)
      if (payload?.error !== undefined) return { ok: false, error: JSON.stringify(payload.error) }
      return { ok: true, result: payload?.result }
    } catch (error) {
      return { ok: false, error: String(error) }
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

/** 解析 JSON 对象文本（失败返回空对象）。 */
function parseJsonObject(text: string | null): Record<string, unknown> {
  if (text === null || text === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** 从响应文本中提取 JSON-RPC 载荷（兼容 SSE 形态）。 */
function extractJsonRpc(text: string): { result?: unknown; error?: unknown } | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) as { result?: unknown; error?: unknown } } catch { return undefined }
  }
  // SSE：逐行找 data: 行
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^data:\s*(.*)$/)
    if (match?.[1] !== undefined && match[1].trim().startsWith('{')) {
      try { return JSON.parse(match[1]) as { result?: unknown; error?: unknown } } catch { continue }
    }
  }
  return undefined
}

// ── stdio 传输的 JSON-RPC 客户端（PRD-05 FR-MCP-002/003/004 的真实 stdio 支路）──────

/** stdio 会话参数（来自 mcp_stdio_configs 行）。 */
interface StdioLaunchSpec {
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  timeoutMs: number
}

/** stdio JSON-RPC 会话：newline-delimited JSON-RPC（MCP stdio 传输协议）。 */
interface StdioSession {
  request(method: string, params: unknown): Promise<{ result?: unknown; error?: unknown }>
  notify(method: string, params: unknown): void
  close(): void
}

/** stdio 请求失败（供六类归因）。 */
class StdioRpcError extends Error {
  readonly kind: 'spawn_failed' | 'handshake_failed' | 'timeout'
  constructor(kind: StdioRpcError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * 打开一个 stdio MCP 会话（spawn + 逐行 JSON-RPC）。
 * 调用方负责 `close()`；进程随会话关闭被终止，不残留。
 */
async function openStdioSession(spec: StdioLaunchSpec): Promise<StdioSession> {
  const { spawn } = await import('node:child_process')
  const { createInterface } = await import('node:readline')
  let child: import('node:child_process').ChildProcessWithoutNullStreams
  try {
    child = spawn(spec.command, spec.args, {
      cwd: spec.cwd === undefined || spec.cwd === '' ? undefined : spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })
  } catch (error) {
    throw new StdioRpcError('spawn_failed', `spawn ${spec.command} failed: ${String(error)}`)
  }
  const pending = new Map<number, { resolve: (value: { result?: unknown; error?: unknown }) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  let nextId = 1
  let stderrTail = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000)
  })
  const readline = createInterface({ input: child.stdout })
  readline.on('line', line => {
    const trimmed = line.trim()
    if (trimmed === '' || !trimmed.startsWith('{')) return
    let payload: { id?: unknown; result?: unknown; error?: unknown }
    try { payload = JSON.parse(trimmed) } catch { return }
    if (payload.id === undefined) return // 通知/请求：试运行客户端只消费响应
    const entry = pending.get(Number(payload.id))
    if (entry === undefined) return
    clearTimeout(entry.timer)
    pending.delete(Number(payload.id))
    entry.resolve({ result: payload.result, error: payload.error })
  })
  const spawnFailure = new Promise<never>((_resolve, reject) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(new StdioRpcError(error.code === 'ENOENT' ? 'spawn_failed' : 'spawn_failed',
        error.code === 'ENOENT' ? `command not found: ${spec.command}` : `spawn failed: ${String(error)}`))
    })
    child.once('exit', (code, signal) => {
      if (pending.size > 0) {
        reject(new StdioRpcError('handshake_failed',
          `server exited early (code=${String(code)} signal=${String(signal)})${stderrTail === '' ? '' : `: ${stderrTail.slice(-400)}`}`))
      }
    })
  })
  const session: StdioSession = {
    async request(method, params) {
      const id = nextId++
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      const response = new Promise<{ result?: unknown; error?: unknown }>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new StdioRpcError('timeout', `${method} timed out after ${String(spec.timeoutMs)}ms`))
        }, spec.timeoutMs)
        pending.set(id, { resolve, reject, timer })
      })
      child.stdin?.write(`${body}\n`)
      return await Promise.race([response, spawnFailure])
    },
    notify(method, params) {
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    },
    close() {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer)
        entry.reject(new StdioRpcError('handshake_failed', 'session closed before the response arrived'))
      }
      pending.clear()
      readline.close()
      child.kill()
    },
  }
  return session
}

/** 完成 stdio initialize 握手并返回会话（失败带六类归因信息）。 */
async function openStdioSessionInitialized(spec: StdioLaunchSpec): Promise<StdioSession> {
  const session = await openStdioSession(spec)
  try {
    const init = await session.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'soloengine', version: '0.1.0' },
    })
    if (init.error !== undefined) {
      throw new StdioRpcError('handshake_failed', `initialize rejected: ${JSON.stringify(init.error)}`)
    }
    session.notify('notifications/initialized', {})
    return session
  } catch (error) {
    session.close()
    throw error
  }
}
