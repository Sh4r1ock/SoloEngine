/**
 * 模型配置域（PRD-03 FR-LLM-001~008）。
 *
 * - CRUD 12 字段 + 乐观锁（version）；
 * - 密钥 AES-256-GCM 加密落库、使用时解密；接口永不回传明文（掩码回显）；
 * - 连通性测试：真发一次最小请求，失败按六类归因（鉴权/地址/超时/网络/响应/未分类）；
 * - 默认配置全用户唯一（设默认即取消同用户其它默认）。
 *
 * harness 侧（`@soloengine/llm-db-adapter`）把每条启用配置暴露为 `soloengine-<id>` 路由。
 *
 * @module @soloengine/framework/modules/models
 */

import type { DatabaseSync } from 'node:sqlite'
import { decryptSecret, encryptSecret, maskSecret } from '../crypto/index.ts'
import { newId } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'

/** llm_configs 行。 */
export interface LlmConfigRow {
  id: string
  user_id: string
  name: string
  provider: string
  model_name: string
  api_key: string | null
  base_url: string | null
  is_full_url: number
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
  is_default: number
  is_active: number
  created_at: string | null
  updated_at: string | null
  version: number
}

/** 对外视图：`api_key` 只以掩码出现。 */
export interface LlmConfigView extends Omit<LlmConfigRow, 'api_key' | 'is_full_url' | 'is_default' | 'is_active'> {
  api_key_masked: string | null
  has_api_key: boolean
  is_full_url: boolean
  is_default: boolean
  is_active: boolean
  /** 该行在 harness 侧暴露的模型路由名。 */
  model_route: string
}

/** 新建/更新入参。 */
export interface LlmConfigInput {
  name?: string
  provider?: string
  model_name?: string
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
  /** 乐观锁：更新时必填，不匹配即拒绝。 */
  version?: number
}

/** 连通性测试的失败归因类别（六类）。 */
export type ConnectivityFailureKind =
  | 'auth' | 'address' | 'timeout' | 'network' | 'response' | 'unknown'

/** 连通性测试结果。 */
export interface ConnectivityResult {
  ok: boolean
  /** 成功时的提供方回包标识（模型名或响应 id）。 */
  provider?: string
  latency_ms?: number
  kind?: ConnectivityFailureKind
  message?: string
  status?: number
}

/** 提供方 → 默认接入地址与协议形态。 */
const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; style: 'openai' | 'anthropic' }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', style: 'openai' },
  openai: { baseUrl: 'https://api.openai.com/v1', style: 'openai' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', style: 'anthropic' },
  'openai-compatible': { baseUrl: '', style: 'openai' },
}

/** 模型配置域服务。 */
export class LlmConfigService {
  private readonly raw: DatabaseSync
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.raw = runtime.db.raw
    this.runtime = runtime
  }

  /** 行 → 对外视图（密钥掩码）。 */
  view(row: LlmConfigRow): LlmConfigView {
    let masked: string | null = null
    if (row.api_key !== null && row.api_key !== '') {
      try {
        masked = maskSecret(decryptSecret(this.runtime.masterKey, row.api_key))
      } catch {
        masked = '********'
      }
    }
    const { api_key: _apiKey, ...rest } = row
    return {
      ...rest,
      api_key_masked: masked,
      has_api_key: row.api_key !== null && row.api_key !== '',
      is_full_url: row.is_full_url === 1,
      is_default: row.is_default === 1,
      is_active: row.is_active === 1,
      model_route: `soloengine-${row.id}`,
    }
  }

  /** 按 ID 取行（限归属用户）。 */
  byId(userId: string, id: string): LlmConfigRow | undefined {
    return this.raw.prepare('SELECT * FROM llm_configs WHERE id = ? AND user_id = ?').get(id, userId) as LlmConfigRow | undefined
  }

  /** 按 ID 取行（不限归属，供 harness 侧路由解析）。 */
  byIdUnscoped(id: string): LlmConfigRow | undefined {
    return this.raw.prepare('SELECT * FROM llm_configs WHERE id = ?').get(id) as LlmConfigRow | undefined
  }

  /** 列某用户全部配置（按创建时间）。 */
  list(userId: string): LlmConfigRow[] {
    return this.raw.prepare('SELECT * FROM llm_configs WHERE user_id = ? ORDER BY created_at ASC')
      .all(userId) as unknown as LlmConfigRow[]
  }

  /** 列全部启用配置（供 harness 侧 3 秒轮询热同步）。 */
  listActive(): LlmConfigRow[] {
    return this.raw.prepare('SELECT * FROM llm_configs WHERE is_active = 1 ORDER BY created_at ASC')
      .all() as unknown as LlmConfigRow[]
  }

  /** 校验 provider 受支持。 */
  private assertProvider(provider: string): void {
    if (PROVIDER_DEFAULTS[provider] === undefined) {
      throw new FrameworkError(400, 'UNSUPPORTED_PROVIDER',
        `provider ${provider} is not supported; expected one of ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`)
    }
  }

  /** 校验扩展参数为合法 JSON 对象。 */
  private assertExtraParams(extra: string | undefined): void {
    if (extra === undefined || extra === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(extra)
    } catch (error) {
      throw new FrameworkError(400, 'INVALID_EXTRA_PARAMS', `extra_params is not valid JSON: ${String(error)}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FrameworkError(400, 'INVALID_EXTRA_PARAMS', 'extra_params must be a JSON object')
    }
  }

  /**
   * 新建配置。
   * @param userId - 归属用户。
   * @param input - 配置字段。
   * @returns 对外视图。
   */
  create(userId: string, input: LlmConfigInput): LlmConfigView {
    const name = String(input.name ?? '').trim()
    const provider = String(input.provider ?? '').trim()
    const modelName = String(input.model_name ?? '').trim()
    if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'name is required')
    if (provider === '') throw new FrameworkError(400, 'PROVIDER_REQUIRED', 'provider is required')
    if (modelName === '') throw new FrameworkError(400, 'MODEL_REQUIRED', 'model_name is required')
    this.assertProvider(provider)
    this.assertExtraParams(input.extra_params)

    const now = new Date().toISOString()
    const id = newId()
    const encrypted = input.api_key === undefined || input.api_key === '' ? null : encryptSecret(this.runtime.masterKey, input.api_key)
    this.raw.prepare(
      `INSERT INTO llm_configs (
         id, user_id, name, provider, model_name, api_key, base_url, is_full_url,
         temperature, max_tokens, max_input_tokens, max_output_tokens, top_p,
         frequency_penalty, presence_penalty, timeout, max_tool_calls, extra_params,
         is_default, is_active, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      id, userId, name, provider, modelName, encrypted,
      input.base_url ?? PROVIDER_DEFAULTS[provider]?.baseUrl ?? null,
      input.is_full_url === true ? 1 : 0,
      input.temperature ?? null, input.max_tokens ?? null, input.max_input_tokens ?? null,
      input.max_output_tokens ?? null, input.top_p ?? null, input.frequency_penalty ?? null,
      input.presence_penalty ?? null, input.timeout ?? null, input.max_tool_calls ?? null,
      input.extra_params ?? null,
      input.is_default === true ? 1 : 0,
      input.is_active === false ? 0 : 1,
      now, now,
    )
    if (input.is_default === true) this.makeExclusiveDefault(userId, id)
    return this.view(this.byId(userId, id) as LlmConfigRow)
  }

  /**
   * 更新配置（乐观锁：version 必须匹配）。
   * @param userId - 归属用户。
   * @param id - 配置 ID。
   * @param patch - 待更新字段。
   * @returns 对外视图。
   */
  update(userId: string, id: string, patch: LlmConfigInput): LlmConfigView {
    const row = this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    if (patch.version === undefined) throw new FrameworkError(400, 'VERSION_REQUIRED', 'version is required for update')
    if (Number(patch.version) !== Number(row.version)) {
      throw new FrameworkError(409, 'VERSION_CONFLICT',
        `model config ${id} was modified (expected version ${String(row.version)}, got ${String(patch.version)}); refresh and retry`)
    }
    if (patch.provider !== undefined) this.assertProvider(patch.provider)
    this.assertExtraParams(patch.extra_params)

    const now = new Date().toISOString()
    const assignments: string[] = []
    const values: (string | number | null)[] = []
    const set = (column: string, value: string | number | null): void => {
      assignments.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.name !== undefined) set('name', patch.name)
    if (patch.provider !== undefined) set('provider', patch.provider)
    if (patch.model_name !== undefined) set('model_name', patch.model_name)
    if (patch.api_key !== undefined && patch.api_key !== '') {
      set('api_key', encryptSecret(this.runtime.masterKey, patch.api_key))
    }
    if (patch.base_url !== undefined) set('base_url', patch.base_url)
    if (patch.is_full_url !== undefined) set('is_full_url', patch.is_full_url ? 1 : 0)
    if (patch.temperature !== undefined) set('temperature', patch.temperature)
    if (patch.max_tokens !== undefined) set('max_tokens', patch.max_tokens)
    if (patch.max_input_tokens !== undefined) set('max_input_tokens', patch.max_input_tokens)
    if (patch.max_output_tokens !== undefined) set('max_output_tokens', patch.max_output_tokens)
    if (patch.top_p !== undefined) set('top_p', patch.top_p)
    if (patch.frequency_penalty !== undefined) set('frequency_penalty', patch.frequency_penalty)
    if (patch.presence_penalty !== undefined) set('presence_penalty', patch.presence_penalty)
    if (patch.timeout !== undefined) set('timeout', patch.timeout)
    if (patch.max_tool_calls !== undefined) set('max_tool_calls', patch.max_tool_calls)
    if (patch.extra_params !== undefined) set('extra_params', patch.extra_params)
    if (patch.is_active !== undefined) set('is_active', patch.is_active ? 1 : 0)
    // 默认标记本身必须写入：只清同用户其它默认而不置位自己会留下「无默认」的空档。
    if (patch.is_default !== undefined) set('is_default', patch.is_default ? 1 : 0)
    set('updated_at', now)
    assignments.push('version = version + 1')
    values.push(id, userId)
    this.raw.prepare(`UPDATE llm_configs SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)
    if (patch.is_default === true) this.makeExclusiveDefault(userId, id)
    return this.view(this.byId(userId, id) as LlmConfigRow)
  }

  /** 删除配置（删除后路由即时注销）。 */
  remove(userId: string, id: string): void {
    const row = this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    // 会话归属行的 llm_config_id 可空（PRD-12 FR-STO-004）：配置被删除时先断开引用，
    // 历史会话仍在（归属链保留），而该路由随即从注册表消失——后续请求得到结构化
    // 「路由不存在」，不静默回退（PRD-06 FR-ENG-015）。
    this.raw.prepare('UPDATE sessions SET llm_config_id = NULL WHERE llm_config_id = ?').run(id)
    this.raw.prepare('DELETE FROM llm_configs WHERE id = ? AND user_id = ?').run(id, userId)
  }

  /** 启用/停用（停用即路由不注册）。 */
  setActive(userId: string, id: string, active: boolean): LlmConfigView {
    return this.update(userId, id, { is_active: active, version: Number((this.byId(userId, id) as LlmConfigRow).version) })
  }

  /** 设为默认（全用户唯一：取消同用户其它默认）。 */
  setDefault(userId: string, id: string): LlmConfigView {
    const row = this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    return this.update(userId, id, { is_default: true, version: Number(row.version) })
  }

  /** 默认互斥：同一用户的其它配置取消默认。 */
  private makeExclusiveDefault(userId: string, keepId: string): void {
    this.raw.prepare('UPDATE llm_configs SET is_default = 0 WHERE user_id = ? AND id != ?').run(userId, keepId)
  }

  /**
   * 解密并返回明文密钥（仅供 harness 侧执行时取用；不经任何 REST 面输出）。
   * @param id - 配置 ID。
   * @returns 明文密钥或 null。
   */
  resolveApiKey(id: string): string | null {
    const row = this.byIdUnscoped(id)
    if (row === undefined || row.api_key === null || row.api_key === '') return null
    return decryptSecret(this.runtime.masterKey, row.api_key)
  }

  /** 解析生效的接入地址（空则取提供方默认）。 */
  resolveBaseUrl(row: LlmConfigRow): string {
    if (row.base_url !== null && row.base_url !== '') return row.base_url
    return PROVIDER_DEFAULTS[row.provider]?.baseUrl ?? ''
  }

  /**
   * 连通性测试：真发一次最小请求并归类失败原因。
   * @param userId - 归属用户。
   * @param id - 配置 ID。
   * @returns 测试结果（成功含提供方回包标识与耗时）。
   */
  async testConnectivity(userId: string, id: string): Promise<ConnectivityResult> {
    const row = this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    const apiKey = this.resolveApiKey(id)
    if (apiKey === null) {
      return { ok: false, kind: 'auth', message: 'api_key is not configured for this model config' }
    }
    const baseUrl = this.resolveBaseUrl(row)
    if (baseUrl === '') {
      return { ok: false, kind: 'address', message: 'base_url is empty and the provider has no default endpoint' }
    }
    const style = PROVIDER_DEFAULTS[row.provider]?.style ?? 'openai'
    const url = row.is_full_url === 1 ? baseUrl : `${baseUrl.replace(/\/$/, '')}${style === 'anthropic' ? '/messages' : '/chat/completions'}`
    const timeoutMs = Math.max(1000, Number(row.timeout ?? 30) * 1000)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, timeoutMs)
    const started = Date.now()
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (style === 'anthropic') {
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers.authorization = `Bearer ${apiKey}`
      }
      const body = style === 'anthropic'
        ? { model: row.model_name, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
        : { model: row.model_name, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
      const text = await response.text()
      const latency = Date.now() - started
      if (response.ok) {
        let providerId: string | undefined
        try {
          const parsed = JSON.parse(text) as { model?: string; id?: string }
          providerId = parsed.model ?? parsed.id
        } catch {
          providerId = undefined
        }
        return { ok: true, provider: providerId ?? row.model_name, latency_ms: latency, status: response.status }
      }
      return { ok: false, kind: classifyHttpFailure(response.status), message: text.slice(0, 400), latency_ms: latency, status: response.status }
    } catch (error) {
      const latency = Date.now() - started
      // 实测（test/soloengine/fetch-error-probe.mjs）：不可达主机的传输超时由 undici 抛
      // `TimeoutError`（code 23，"aborted due to timeout"），并非我们自己的 `AbortError`。
      // 只认 AbortError 会把这类真实超时错判成「未分类」。
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        // 如实报出触发方与限额：AbortError=我们的 signal 到点；TimeoutError=undici 自身传输超时。
        const trigger = error.name === 'AbortError' ? 'request timed out' : `transport timed out (${error.message})`
        return { ok: false, kind: 'timeout', message: `${trigger} · limit ${String(row.timeout ?? 30)}s`, latency_ms: latency }
      }
      // 失败归因必须看整条错误链：undici 的 `TypeError: fetch failed` 把真正的原因放在 `cause`，
      // 双栈主机名还会包一层 AggregateError（逐地址原因在 `errors[]`）；只看一层会全部落到 unknown。
      const chain = failureChain(error)
      // 传输层超时通常以 `TypeError: fetch failed` 为外壳，真正原因埋在 cause 链里
      // （undici `TimeoutError`：code 23 / "The operation was aborted due to timeout"）。
      // 实测（test/soloengine/fetch-error-probe.mjs）：只测最外层 name 会把它错判成 unknown。
      // undici 自己的连接超时是 `ConnectTimeoutError`（code UND_ERR_CONNECT_TIMEOUT，
      // message "Connect Timeout Error"）——与 AbortSignal 的写法都不同，三种都要认。
      if (/aborted due to timeout|TimeoutError|ConnectTimeoutError|Connect Timeout Error|UND_ERR_CONNECT_TIMEOUT/i.test(chain.text)) {
        return { ok: false, kind: 'timeout', message: `transport timed out (${chain.text.slice(0, 200)})`, latency_ms: latency }
      }
      if (/ENOTFOUND|EAI_AGAIN|EAI_FAIL|ERR_INVALID_URL|bad port/i.test(chain.text)) {
        return { ok: false, kind: 'address', message: `endpoint not usable (${chain.text.slice(0, 200)})`, latency_ms: latency }
      }
      if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|EPIPE/i.test(chain.text)) {
        return { ok: false, kind: 'network', message: `connection failed (${chain.text.slice(0, 200)})`, latency_ms: latency }
      }
      return { ok: false, kind: 'unknown', message: String(error), latency_ms: latency }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * 折叠一条错误链的全部可归因信息（各层的 `code`、AggregateError 的逐地址原因与文案）。
 * @param error - fetch 抛出的错误。
 * @returns 拼接后的归因文本。
 */
function failureChain(error: unknown): { text: string } {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    const node = current as { code?: unknown; message?: unknown; errors?: unknown; cause?: unknown }
    if (typeof node.code === 'string') parts.push(node.code)
    if (typeof node.code === 'number') parts.push(String(node.code))
    if (typeof node.message === 'string') parts.push(node.message)
    if (Array.isArray(node.errors)) {
      for (const inner of node.errors) {
        const entry = inner as { code?: unknown; message?: unknown }
        if (typeof entry?.code === 'string') parts.push(entry.code)
        if (typeof entry?.message === 'string') parts.push(entry.message)
      }
    }
    current = node.cause
  }
  return { text: parts.join(' | ') }
}

/** HTTP 状态码 → 失败归因。 */
export function classifyHttpFailure(status: number): ConnectivityFailureKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'address'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'response'
  if (status >= 400) return 'response'
  return 'unknown'
}
