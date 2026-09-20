/**
 * SoloEngine DB 模型路由表。
 *
 * 依据 PRD-03 FR-LLM-002/004/005 与 PRD-06 FR-ENG-014/015：
 * - 每条启用中的 `llm_configs` 行暴露为一条 `soloengine-<id>` 模型路由；
 * - 连接事实（地址、模型名、采样上限）在同步时从该行派生；
 * - 密钥**每次请求重新解析**：执行时按路由引用回表读取密文并用主密钥解密
 *   （改 Key 下次请求即新值，不缓存明文、不进日志）；
 * - 行缺失/停用/不可表达一律**直接报错**，不静默回退到其它模型。
 *
 * 本模块只用 `node:sqlite` + `node:crypto` 读取业务库，不 import 框架层代码：
 * 框架层与 harness 之间的唯一边是「配置 → 原生模型路由」这一条数据回调
 * （《SoloEngine 框架设计》§2.0.1）。
 *
 * @module @soloengine/llm-db-adapter/routes
 */

import { createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekAdapter, DeepSeekConnectionOptions, DeepSeekProtocol } from '@deepseek-ai/dsh-llm-deepseek'
import { DeepSeekAdapter as DeepSeekAdapterClass } from '@deepseek-ai/dsh-llm-deepseek'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** `llm_configs` 行（本适配器消费的全部列）。 */
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
  timeout: number | null
  is_active: number
  version: number
  updated_at: string | null
}

/** 一条已注册的模型路由。 */
export interface RouteEntry {
  /** 路由名 `soloengine-<llm_config_id>`。 */
  readonly route: string
  /** 派生该路由的配置行。 */
  readonly row: LlmConfigRow
  /** 同步时冻结的连接事实。 */
  readonly connection: DeepSeekConnectionOptions
  /** 该路由自己的官方适配器实例（provider 感知：一实例服务一条路由）。 */
  readonly adapter: DeepSeekAdapter
}

/** 一行无法成为路由时的结构化记录（fail loud，不静默跳过）。 */
export interface RouteSkip {
  readonly id: string
  readonly name: string
  readonly reason: string
}

/** 一次同步的快照。 */
export interface RouteSnapshot {
  readonly routes: readonly RouteEntry[]
  readonly skipped: readonly RouteSkip[]
  /** 决定路由集合的行事实签名（含 version/updated_at，任一变化即换路由）。 */
  readonly signature: string
}

/** 主密钥字节长度。 */
const MASTER_KEY_BYTES = 32
/** 路由引用前缀：官方 `credentialRef` 只接受 `[A-Za-z_][A-Za-z0-9_]*`，故 UUID 的短横线转下划线。 */
const REF_PREFIX = 'SOLOENGINE_LLM_CONFIG_'

/** 配置行 id → 凭据引用（UUID 只含短横线，转换无损）。 */
export function credentialRefForConfig(id: string): string {
  return `${REF_PREFIX}${id.replace(/-/gu, '_')}`
}

/** 凭据引用 → 配置行 id。 */
export function configIdFromCredentialRef(ref: string): string {
  if (!ref.startsWith(REF_PREFIX)) {
    throw new LlmError(`credential reference "${ref}" is not a SoloEngine model-config reference`, 'MISSING_CREDENTIAL')
  }
  return ref.slice(REF_PREFIX.length).replace(/_/gu, '-')
}
/** chat-completions 的端点后缀（官方适配器自行追加）。 */
const CHAT_SUFFIX = '/chat/completions'
/** Messages 协议的端点后缀（官方适配器自行追加 `/v1/messages`）。 */
const MESSAGES_SUFFIX = '/v1/messages'

/** 提供方 → 线协议（PRD-03 FR-LLM-005 首期清单）。 */
const PROVIDER_PROTOCOL: Record<string, DeepSeekProtocol> = {
  deepseek: 'chat-completions',
  openai: 'chat-completions',
  'openai-compatible': 'chat-completions',
  anthropic: 'messages',
}

/** 提供方 → 默认接入地址（与框架层 `PROVIDER_DEFAULTS` 同源事实）。 */
const PROVIDER_BASE_URL: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  'openai-compatible': '',
}

/** 路由表参数。 */
export interface RouteTableOptions {
  /** 业务库绝对路径。 */
  dbPath: string
  /** 主密钥目录（`master.key` 所在）。 */
  keysDir: string
}

/**
 * 解析一行的接入地址根：官方适配器自行追加协议端点，故这里必须给出根。
 * @param row - 配置行。
 * @param protocol - 该行选定的线协议。
 * @returns 协议根地址。
 * @throws 当地址缺失或与「完整 URL」声明不符（fail loud，不猜测）。
 */
export function deriveBaseRoot(row: LlmConfigRow, protocol: DeepSeekProtocol): string {
  const raw = (row.base_url ?? '').trim()
  const fallback = PROVIDER_BASE_URL[row.provider] ?? ''
  const value = raw === '' ? fallback : raw
  if (value === '') {
    throw new Error(
      `model config ${row.id} ("${row.name}") has no base_url and provider "${row.provider}" has no default endpoint`,
    )
  }
  const trimmed = value.replace(/\/+$/u, '')
  if (row.is_full_url === 1) {
    if (protocol === 'messages') {
      if (trimmed.endsWith(MESSAGES_SUFFIX)) return trimmed.slice(0, -MESSAGES_SUFFIX.length)
      if (trimmed.endsWith('/messages')) return trimmed.slice(0, -'/messages'.length)
      throw new Error(
        `model config ${row.id} ("${row.name}") is marked as a full URL but does not end with "${MESSAGES_SUFFIX}"`,
      )
    }
    if (!trimmed.endsWith(CHAT_SUFFIX)) {
      throw new Error(
        `model config ${row.id} ("${row.name}") is marked as a full URL but does not end with "${CHAT_SUFFIX}"`,
      )
    }
    return trimmed.slice(0, -CHAT_SUFFIX.length)
  }
  // Messages 协议由适配器追加 `/v1/messages`，故存储里的 `/v1` 尾缀要剥掉。
  if (protocol === 'messages' && trimmed.endsWith('/v1')) return trimmed.slice(0, -'/v1'.length)
  return trimmed
}

/** 主密钥：读取并校验（缺失/非法/长度错一律抛错，不回退）。 */
export function readMasterKey(path: string): Buffer {
  const raw = readFileSync(path, 'utf8').trim()
  if (!/^[0-9a-fA-F]+$/u.test(raw)) throw new Error(`master key at ${path} is not hexadecimal`)
  if (raw.length !== MASTER_KEY_BYTES * 2) {
    throw new Error(`master key at ${path} is ${String(raw.length / 2)} bytes, expected ${String(MASTER_KEY_BYTES)}`)
  }
  return Buffer.from(raw, 'hex')
}

/** 解密 `v1.<iv>.<tag>.<ciphertext>` 封包（认证失败即抛错，不回退明文）。 */
export function decryptSecret(key: Buffer, envelope: string): string {
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('soloengine: encrypted secret is not a v1 envelope')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1] as string, 'hex'))
  decipher.setAuthTag(Buffer.from(parts[2] as string, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(parts[3] as string, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

/** 路由表：持有业务库连接、主密钥与当前路由集合。 */
export class RouteTable {
  private readonly dbPath: string
  private readonly masterKeyPath: string
  private readonly masterKey: Buffer
  private routes = new Map<string, RouteEntry>()
  private skipped: RouteSkip[] = []
  private signature = ''
  private database: DatabaseSync | undefined

  /**
   * @param options - 业务库路径与主密钥目录。
   */
  constructor(options: RouteTableOptions) {
    this.dbPath = options.dbPath
    this.masterKeyPath = join(options.keysDir, 'master.key')
    this.masterKey = readMasterKey(this.masterKeyPath)
  }

  /** 打开（或复用）只读业务库连接。 */
  private open(): DatabaseSync {
    if (this.database === undefined) {
      this.database = new DatabaseSync(this.dbPath, { readOnly: true })
      this.database.exec('PRAGMA busy_timeout = 5000')
    }
    return this.database
  }

  /** 关闭业务库连接。 */
  close(): void {
    this.database?.close()
    this.database = undefined
  }

  /** 当前路由集合。 */
  get entries(): readonly RouteEntry[] {
    return [...this.routes.values()]
  }

  /** 当前被拒绝的行（供取证与日志）。 */
  get rejected(): readonly RouteSkip[] {
    return this.skipped
  }

  /** 当前路由名清单。 */
  get routeNames(): string[] {
    return [...this.routes.keys()]
  }

  /** 按路由名取条目（不存在返回 undefined）。 */
  get(route: string): RouteEntry | undefined {
    return this.routes.get(route)
  }

  /** 当前签名。 */
  get currentSignature(): string {
    return this.signature
  }

  /** 读取一行（按 id，含停用行；密钥解析用）。 */
  private rowById(id: string): LlmConfigRow | undefined {
    return this.open().prepare(
      `SELECT id, user_id, name, provider, model_name, api_key, base_url, is_full_url,
              temperature, max_tokens, max_input_tokens, max_output_tokens, timeout,
              is_active, version, updated_at
         FROM llm_configs WHERE id = ?`,
    ).get(id) as unknown as LlmConfigRow | undefined
  }

  /**
   * 按路由引用解析明文密钥：**每次请求重新回表并解密**（FR-LLM-002）。
   * @param ref - 形如 `soloengine/llm-config/<id>` 的引用。
   * @returns 明文密钥。
   * @throws 行不存在/停用/未配置密钥/解密失败（结构化错误，不回退）。
   */
  resolveApiKey(ref: string): string {
    const id = configIdFromCredentialRef(ref)
    const row = this.rowById(id)
    if (row === undefined) {
      throw new LlmError(`model config ${id} no longer exists; the route is unavailable`, 'NO_ADAPTER')
    }
    if (row.is_active !== 1) {
      throw new LlmError(`model config ${id} is disabled; the route is unavailable`, 'NO_ADAPTER')
    }
    if (row.api_key === null || row.api_key === '') {
      throw new LlmError(`model config ${id} ("${row.name}") has no api_key configured`, 'MISSING_CREDENTIAL')
    }
    return decryptSecret(this.masterKey, row.api_key)
  }

  /**
   * 重新读取业务库并派生路由集合。
   * @returns 本次快照（含签名与逐行拒绝原因）。
   */
  reload(): RouteSnapshot {
    const rows = this.open().prepare(
      `SELECT id, user_id, name, provider, model_name, api_key, base_url, is_full_url,
              temperature, max_tokens, max_input_tokens, max_output_tokens, timeout,
              is_active, version, updated_at
         FROM llm_configs WHERE is_active = 1 ORDER BY id`,
    ).all() as unknown as LlmConfigRow[]

    const routes = new Map<string, RouteEntry>()
    const skipped: RouteSkip[] = []
    for (const row of rows) {
      try {
        routes.set(`soloengine-${row.id}`, this.derive(row))
      } catch (error) {
        skipped.push({
          id: row.id,
          name: row.name,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    this.routes = routes
    this.skipped = skipped
    this.signature = JSON.stringify(rows.map(row => [
      row.id, row.provider, row.model_name, row.base_url, row.is_full_url, row.is_active,
      row.max_tokens, row.max_input_tokens, row.max_output_tokens, row.temperature, row.timeout,
      row.version, row.updated_at,
    ]))
    return { routes: this.entries, skipped, signature: this.signature }
  }

  /** 由一行派生一条路由（含该路由自己的官方适配器实例）。 */
  private derive(row: LlmConfigRow): RouteEntry {
    const protocol = PROVIDER_PROTOCOL[row.provider] ?? 'chat-completions'
    const baseURL = deriveBaseRoot(row, protocol)
    const reference = credentialRefForConfig(row.id)
    const modelMaxTokens = row.max_output_tokens ?? row.max_tokens
    const connection = resolveAdapterOptions({
      protocol,
      baseURL,
      apiKeyEnv: reference,
      maxTokens: modelMaxTokens ?? DEFAULT_MAX_TOKENS,
      defaultContextWindow: row.max_input_tokens ?? DEFAULT_CONTEXT_WINDOW,
      models: [{
        id: row.model_name,
        name: row.model_name,
        ...row.max_input_tokens === null ? {} : { contextWindow: row.max_input_tokens },
        ...modelMaxTokens === null ? {} : { maxTokens: modelMaxTokens },
        inputModalities: ['text'],
      }],
      streamIdleTimeoutMs: row.timeout === null || row.timeout <= 0
        ? DEFAULT_STREAM_IDLE_TIMEOUT_MS
        : row.timeout * 1000,
    })
    const adapter = new DeepSeekAdapterClass({
      options: () => connection,
      resolveApiKey: (snapshot) => Promise.resolve(this.resolveApiKey(String(snapshot.apiKeyEnv))),
      resolveUserId: () => this.resolveUserId(),
      prepareExtensions: () => Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
    })
    return {
      route: `soloengine-${row.id}`,
      row,
      // 连接事实里 `apiKeyEnv` 就是本行的引用：密钥永远只从该行解析。
      connection: { ...connection, apiKeyEnv: credentialRef(reference) },
      adapter,
    }
  }

  /** 匿名用户标识（官方适配器要求；由 harness 侧的匿名身份提供方解析）。 */
  private resolveUserIdImpl: (() => AnonymousUserId) | undefined

  /** 注入匿名用户标识解析器（由插件在 `apply` 时提供）。 */
  setUserIdResolver(resolve: () => AnonymousUserId): void {
    this.resolveUserIdImpl = resolve
  }

  /** 解析匿名用户标识。 */
  private resolveUserId(): AnonymousUserId {
    if (this.resolveUserIdImpl === undefined) {
      throw new LlmError('soloengine-llm-db-adapter: anonymous user id resolver is not wired', 'INVALID_REQUEST')
    }
    return this.resolveUserIdImpl()
  }
}

/** 适配器行默认采样参数（行配置作为「该模型的默认请求参数」）。 */
export interface RowSamplingDefaults {
  temperature: number | null
  maxTokens: number | null
}

/**
 * 把行级默认采样并入一次请求（请求显式给出的值优先）。
 * @param options - 本次请求。
 * @param defaults - 行级默认。
 * @returns 合并后的请求（不修改入参，入参可能是深冻结的）。
 */
export function withRowSampling(options: GenerateOptions, defaults: RowSamplingDefaults): GenerateOptions {
  const temperature = options.temperature === undefined && defaults.temperature !== null
    ? { temperature: defaults.temperature }
    : {}
  const maxTokens = options.maxTokens === undefined && defaults.maxTokens !== null
    ? { maxTokens: defaults.maxTokens }
    : {}
  if (Object.keys(temperature).length === 0 && Object.keys(maxTokens).length === 0) return options
  return { ...options, ...temperature, ...maxTokens }
}
