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

/** 对外视图（布尔归一化 + 传输子表）。 */
export interface McpServerView extends Omit<McpServerRow, 'is_active' | 'is_public'> {
  is_active: boolean
  is_public: boolean
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

  /** 行 → 对外视图（布尔归一化 + 传输子表）。 */
  view(row: McpServerRow): McpServerView {
    const { is_active, is_public, ...rest } = row
    return {
      ...rest,
      is_active: is_active === 1,
      is_public: is_public === 1,
      stdio: this.stdio(row.id) ?? null,
      http: this.http(row.id) ?? null,
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

  /** stdio 连接测试：命令存在性 + 可启动判定。 */
  private async testStdio(row: McpServerRow): Promise<McpTestResult> {
    const config = this.stdio(row.id)
    const command = config?.command ?? ''
    if (command.trim() === '') return { ok: false, kind: 'command_missing', message: 'stdio command is empty' }
    const { spawnSync } = await import('node:child_process')
    const args = parseJsonArray(config?.args ?? null)
    const started = Date.now()
    const probe = spawnSync(command, [...args, '--version'], { timeout: 8000, encoding: 'utf8', shell: false })
    const latency = Date.now() - started
    if (probe.error !== undefined) {
      const code = (probe.error as NodeJS.ErrnoException).code ?? ''
      if (code === 'ENOENT') return { ok: false, kind: 'command_missing', message: `command not found: ${command}`, latency_ms: latency }
      if (code === 'ETIMEDOUT') return { ok: false, kind: 'timeout', message: `command timed out: ${command}`, latency_ms: latency }
      return { ok: false, kind: 'spawn_failed', message: String(probe.error), latency_ms: latency }
    }
    // 命令可启动（退出码非零仍算可启动——多数 MCP 服务器不接受 --version）。
    return { ok: true, latency_ms: latency, serverInfo: { name: row.name } }
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
      const code = (error as { cause?: { code?: string } }).cause?.code ?? ''
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(code)) {
        return { ok: false, kind: 'address_unreachable', message: `connection failed (${code})`, latency_ms: latency }
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
      const tools = this.cachedTools(id)
      return { ok: true, tools, resources: [], prompts: [] }
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
      return { ok: false, error: 'single-tool trial for stdio transport runs through the harness connector; use the run panel' }
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
