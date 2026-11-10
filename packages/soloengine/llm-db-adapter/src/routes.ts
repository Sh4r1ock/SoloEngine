/**
 * SoloEngine 模型路由表。
 *
 * 依据 PRD-03 FR-LLM-002/004/005 与 PRD-06 FR-ENG-014/015：
 * - 每条启用中的模型配置暴露为一条 `soloengine-<id>` 模型路由；
 * - 连接事实（地址、模型名、采样上限）在同步时从管理层给出的路由事实派生；
 * - 密钥**每次请求重新解析**：执行时按路由引用向管理层要已解密的密钥
 *   （改 Key 下次请求即新值，不缓存明文、不进日志）；
 * - 行缺失/停用/不可表达一律**直接报错**，不静默回退到其它模型。
 *
 * 本模块不读业务库、不持有主密钥：管理层与 harness 之间的唯一边是
 * 「配置 → 原生模型路由」这一条服务回调（《SoloEngine 框架设计》§四）。
 *
 * @module @soloengine/llm-db-adapter/routes
 */

import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { DeepSeekAdapter as DeepSeekAdapterClass } from '@deepseek-ai/dsh-llm-deepseek'
import type { GenerateOptions, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiAdapterOptions } from '@deepseek-ai/dsh-llm-pi-ai'

/** 一条模型路由的配置事实（管理层给出的只读视图，不含密钥）。 */
export interface ModelRouteFact {
  id: string
  /** 归属用户：路由桶键，同一进程多用户时各桶互不可见。 */
  user_id: string
  name: string
  provider: string
  model_name: string
  base_url: string | null
  is_full_url: number
  temperature: number | null
  max_tokens: number | null
  max_input_tokens: number | null
  max_output_tokens: number | null
  /** OpenAI-compatible sampling fields; null means "not configured". */
  top_p: number | null
  frequency_penalty: number | null
  presence_penalty: number | null
  /** Raw JSON object merged into the provider request body. */
  extra_params: string | null
  /** Agent-side tool-call budget (the model config field); null means unset. */
  max_tool_calls: number | null
  timeout: number | null
  is_active: number
  version: number
  updated_at: string | null
}

/**
 * 管理层提供的模型路由服务（**按用户归属收敛**）。
 *
 * 契约：`listActive(userId)` 只返回该用户启用中的配置事实；`resolveApiKey(userId, id)`
 * 只解密该用户自己的配置（归属不符按不存在处理）；`listActiveOwners()` 只给出「有启用
 * 配置」的用户 id 作为桶清单，不含任何配置事实或密钥；`ownerOfSession(sessionId)` 用
 * `sessions.user_id` 这一份真源回答会话归属，供派发时把调用落到正确的桶。
 */
export interface ModelRouteSource {
  listActiveOwners(): Promise<readonly string[]>
  listActive(userId: string): Promise<readonly ModelRouteFact[]>
  resolveApiKey(userId: string, id: string): Promise<string | null>
  ownerOfSession(sessionId: string): Promise<string | undefined>
}

/** 一条已注册的模型路由。 */
export interface RouteEntry {
  /** 路由名 `soloengine-<llm_config_id>`。 */
  readonly route: string
  /** 归属用户（该条目所在的路由桶）。 */
  readonly userId: string
  /** 派生该路由的配置事实。 */
  readonly row: ModelRouteFact
  /** 该行的线协议：Messages（DeepSeek 适配器）或 OpenAI 兼容（pi-ai 适配器）。 */
  readonly style: 'anthropic' | 'openai'
  /** 同步时冻结的连接事实（仅 Messages 路由；OpenAI 兼容路由由 pi-ai 描述）。 */
  readonly connection: DeepSeekConnectionOptions | null
  /** 该路由自己的适配器实例（provider 感知：一实例服务一条路由）。 */
  readonly adapter: LlmAdapter
  /** OpenAI 兼容路由的行级采样字段（Messages 协议走请求扩展，不在此处）。 */
  readonly samplingParams?: Record<string, unknown>
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

/**
 * 决定一条路由的行事实元组（列序即签名的语义）。
 * @param row - 行事实。
 * @returns 元组；单例签名与全表签名都由它派生，二者不可能漂移。
 */
function rowTuple(row: ModelRouteFact): unknown[] {
  return [
    row.id, row.user_id, row.provider, row.model_name, row.base_url, row.is_full_url, row.is_active,
    row.max_tokens, row.max_input_tokens, row.max_output_tokens, row.temperature, row.timeout,
    row.top_p, row.frequency_penalty, row.presence_penalty, row.extra_params, row.max_tool_calls,
    row.version, row.updated_at,
  ]
}

/**
 * 由行事实派生签名（纯函数：`reload()` 与轻量探测必须算出同一个值）。
 * @param rows - 行事实；按 id 有序。
 * @returns 该事实集合的稳定签名。
 */
function factSignatureOf(rows: readonly ModelRouteFact[]): string {
  return JSON.stringify(rows.map(rowTuple))
}

/**
 * 单行的行事实签名：判断**该行**是否需要重新派生。
 * @param row - 行事实。
 * @returns 该行的事实签名。
 */
function rowSignature(row: ModelRouteFact): string {
  return JSON.stringify(rowTuple(row))
}

/** 路由引用前缀：官方 `credentialRef` 只接受 `[A-Za-z_][A-Za-z0-9_]*`，故 UUID 的短横线转下划线。 */
const REF_PREFIX = 'SOLOENGINE_LLM_CONFIG_'

/**
 * 配置行 id → 凭据引用（UUID 只含短横线，转换无损）。
 * @param id - 模型配置行 id。
 * @returns 官方适配器可接受的凭据引用。
 */
export function credentialRefForConfig(id: string): string {
  return `${REF_PREFIX}${id.replace(/-/gu, '_')}`
}

/**
 * 凭据引用 → 配置行 id。
 * @param ref - 凭据引用。
 * @returns 模型配置行 id。
 */
export function configIdFromCredentialRef(ref: string): string {
  if (!ref.startsWith(REF_PREFIX)) {
    throw new LlmError(`credential reference "${ref}" is not a SoloEngine model-config reference`, 'MISSING_CREDENTIAL')
  }
  return ref.slice(REF_PREFIX.length).replace(/_/gu, '-')
}
/** Messages 协议的端点后缀（官方适配器自行追加 `/v1/messages`）。 */
const MESSAGES_SUFFIX = '/v1/messages'

/** 提供方 → 默认接入地址（与框架层 `PROVIDER_DEFAULTS` 同源事实）。 */
const PROVIDER_BASE_URL: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/anthropic',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  ollama: 'http://localhost:11434/v1',
  'openai-compatible': '',
}

/** 提供方 → 线协议（与框架层同一张表：Messages 走 DeepSeek 适配器，OpenAI 兼容走 pi-ai）。 */
const PROVIDER_STYLE: Record<string, 'anthropic' | 'openai'> = {
  deepseek: 'anthropic',
  anthropic: 'anthropic',
  openai: 'openai',
  ollama: 'openai',
  'openai-compatible': 'openai',
}

/**
 * 解析一行的线协议。
 * @param provider - 提供方。
 * @returns 线协议（未知提供方按 OpenAI 兼容处理，派生时仍会因缺地址报错）。
 */
export function protocolOf(provider: string): 'anthropic' | 'openai' {
  return PROVIDER_STYLE[provider] ?? 'openai'
}

/**
 * 解析配置行的接入地址：缺省取 provider 默认值，并去掉尾部斜杠。
 * @param row - 配置行。
 * @returns 去尾斜杠后的地址。
 * @throws 当地址缺失时（fail loud，不猜测）。
 */
function resolveEndpoint(row: ModelRouteFact): string {
  const raw = (row.base_url ?? '').trim()
  const fallback = PROVIDER_BASE_URL[row.provider] ?? ''
  const value = raw === '' ? fallback : raw
  if (value === '') {
    throw new Error(
      `model config ${row.id} ("${row.name}") has no base_url and provider "${row.provider}" has no default endpoint`,
    )
  }
  return value.replace(/\/+$/u, '')
}

/**
 * 解析 OpenAI 兼容行的接入地址根（pi-ai 的 OpenAI 客户端自行追加 `/chat/completions`）。
 * @param row - 配置行。
 * @returns 协议根地址（保留 `/v1` 等路径前缀）。
 * @throws 当地址缺失或与「完整 URL」声明不符（fail loud，不猜测）。
 */
export function deriveOpenAiRoot(row: ModelRouteFact): string {
  const trimmed = resolveEndpoint(row)
  if (row.is_full_url === 1) {
    if (trimmed.endsWith('/chat/completions')) return trimmed.slice(0, -'/chat/completions'.length)
    throw new Error(
      `model config ${row.id} ("${row.name}") is marked as a full URL but does not end with "/chat/completions"`,
    )
  }
  return trimmed
}

/**
 * 解析一行的接入地址根：官方适配器（Messages-only）自行追加 `/v1/messages`，故这里必须给出根。
 * @param row - 配置行。
 * @returns 协议根地址。
 * @throws 当地址缺失或与「完整 URL」声明不符（fail loud，不猜测）。
 */
export function deriveBaseRoot(row: ModelRouteFact): string {
  const trimmed = resolveEndpoint(row)
  if (row.is_full_url === 1) {
    if (trimmed.endsWith(MESSAGES_SUFFIX)) return trimmed.slice(0, -MESSAGES_SUFFIX.length)
    if (trimmed.endsWith('/messages')) return trimmed.slice(0, -'/messages'.length)
    throw new Error(
      `model config ${row.id} ("${row.name}") is marked as a full URL but does not end with "${MESSAGES_SUFFIX}"`,
    )
  }
  // Messages 协议由适配器追加 `/v1/messages`，故存储里的 `/v1` 尾缀要剥掉。
  if (trimmed.endsWith('/v1')) return trimmed.slice(0, -'/v1'.length)
  return trimmed
}

/** 路由表：持有管理层服务与当前路由集合（按归属用户分桶）。 */
export class RouteTable {
  /** 全表扁平视图：路由名 → 条目（路由名含配置 UUID，跨桶不重名）。 */
  private routes = new Map<string, RouteEntry>()
  /** 归属用户 → 该用户自己的路由桶（同一进程多用户时互不可见）。 */
  private buckets = new Map<string, Map<string, RouteEntry>>()
  /**
   * 行 id → 已派生的路由与其派生时的事实。
   *
   * 用途：热同步只重新派生**事实变了的行**，其余行沿用既有适配器实例。每次全表重建会让任何
   * 一处改动都触发 N 条路由重建（N 随配置数增长），把同步耗时绑在资产总量上——而 NFR-PER-008
   * 是有硬预算的时延上界。沿用未变行者也符合 FR-ENG-015 的「不串代」：每条路由的代际只在
   * 自己的事实变化时才推进，元数据解析与请求派发始终取自同一个适配器实例。
   */
  private readonly derived = new Map<string, { entry: RouteEntry; facts: string; userId: string }>()
  private skipped: RouteSkip[] = []
  private signature = ''

  /**
   * @param source - 管理层提供的模型路由服务（按用户归属收敛）。
   * @param auth - pi-ai 需要的凭据存储与宿主环境注入（OpenAI 兼容路由的适配器集合）。
   */
  constructor(
    private readonly source: ModelRouteSource,
    private readonly auth: PiAiAdapterOptions['auth'],
  ) {}

  /** 关闭（无本地资源；保留方法供生命周期调用）。 */
  close(): void {}

  /** 当前路由集合（全部用户的桶的并集；派发时仍按会话归属校验）。 */
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

  /**
   * 按路由名取条目（不存在返回 undefined）。
   * @param route - 路由名。
   * @returns 路由条目；未注册时为 undefined。
   */
  get(route: string): RouteEntry | undefined {
    return this.routes.get(route)
  }

  /**
   * 某条路由是否属于给定用户的路由桶（派发时的归属判据）。
   * @param route - 路由名。
   * @param userId - 会话的归属用户。
   * @returns 只有该用户自己的桶里有这条路由时为 true。
   */
  owns(route: string, userId: string): boolean {
    return this.buckets.get(userId)?.has(route) === true
  }

  /**
   * 会话归属用户（`sessions.user_id` 单一真源，经管理层读取）。
   * @param sessionId - 会话键。
   * @returns 归属用户 id，或 undefined。
   */
  async ownerOfSession(sessionId: string): Promise<string | undefined> {
    return await this.source.ownerOfSession(sessionId)
  }

  /** 当前签名。 */
  get currentSignature(): string {
    return this.signature
  }

  /**
   * 按路由引用解析明文密钥：**每次请求重新向管理层要**（FR-LLM-002），且只在该条目
   * 所属用户的桶里解析——归属不符按「无密钥」拒绝。
   * @param userId - 条目所属用户。
   * @param ref - 形如 `SOLOENGINE_LLM_CONFIG_<id>` 的引用。
   * @returns 明文密钥。
   * @throws 行不存在/停用/未配置密钥（结构化错误，不回退）。
   */
  async resolveApiKey(userId: string, ref: string): Promise<string> {
    const id = configIdFromCredentialRef(ref)
    const apiKey = await this.source.resolveApiKey(userId, id)
    if (apiKey === null || apiKey === '') {
      throw new LlmError(`model config ${id} has no api_key configured; the route is unavailable`, 'MISSING_CREDENTIAL')
    }
    return apiKey
  }

  /**
   * 轻量「行事实」探测：**不派生任何适配器**，只取启用中的事实。
   *
   * 存在的理由：热同步有 ≤3 秒的时延上界（NFR-PER-008），轮询周期必须显著小于该上界，
   * 而每个周期都派生一遍全部路由（每条路由一个官方适配器实例）是纯浪费。故把「有没有变」
   * 与「变了就重算」拆开——前者每个周期都跑一次廉价查询，后者只在事实真的变了才发生。
   *
   * 桶清单按用户升序、桶内按创建时间，签名与 `reload()` 同值。
   *
   * @returns 当前全表行事实签名；与 `reload()` 返回的签名同一个值域。
   */
  async factSignature(): Promise<string> {
    return factSignatureOf(await this.readFacts())
  }

  /** 逐用户读取启用中的行事实（桶清单升序，桶内按创建时间）。 */
  private async readFacts(): Promise<ModelRouteFact[]> {
    const owners = [...await this.source.listActiveOwners()].sort()
    const facts: ModelRouteFact[] = []
    for (const owner of owners) facts.push(...await this.source.listActive(owner))
    return facts
  }

  /**
   * 重新取管理层事实并派生路由集合（按归属用户分桶）。
   *
   * 签名取启用中行事实（含归属用户），与轻量探测同值——否则二者不一致会让每个周期都
   * 判定为「变了」，重算就失去意义。
   *
   * @returns 本次快照（含签名与逐行拒绝原因）。
   */
  async reload(): Promise<RouteSnapshot> {
    const owners = [...await this.source.listActiveOwners()].sort()
    const routes = new Map<string, RouteEntry>()
    const buckets = new Map<string, Map<string, RouteEntry>>()
    const skipped: RouteSkip[] = []
    const facts: ModelRouteFact[] = []
    const live = new Set<string>()
    for (const owner of owners) {
      const rows = await this.source.listActive(owner)
      const bucket = new Map<string, RouteEntry>()
      for (const row of rows) {
        facts.push(row)
        const route = `soloengine-${row.id}`
        live.add(row.id)
        const rowFacts = rowSignature(row)
        const cached = this.derived.get(row.id)
        // 事实未变：沿用既有适配器（不重建 = 不换代，也不把 N 条路由的重算压进时延预算）。
        if (cached !== undefined && cached.facts === rowFacts && cached.userId === owner) {
          bucket.set(route, cached.entry)
          routes.set(route, cached.entry)
          continue
        }
        try {
          const entry = this.derive(owner, row)
          this.derived.set(row.id, { entry, facts: rowFacts, userId: owner })
          bucket.set(route, entry)
          routes.set(route, entry)
        } catch (error) {
          // 派生失败不缓存：下一周期天然重试（今天的失败不是明天的结论）。
          skipped.push({
            id: row.id,
            name: row.name,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
      buckets.set(owner, bucket)
    }
    // 被删除或停用的行：其派生缓存一并回收（路由注销后不该在内存里留存）。
    for (const id of [...this.derived.keys()]) {
      if (!live.has(id)) this.derived.delete(id)
    }
    this.routes = routes
    this.buckets = buckets
    this.skipped = skipped
    this.signature = factSignatureOf(facts)
    return { routes: this.entries, skipped, signature: this.signature }
  }

  /** 由一行派生一条路由（含该路由自己的适配器实例，协议按提供方分流）。 */
  private derive(userId: string, row: ModelRouteFact): RouteEntry {
    const route = `soloengine-${row.id}`
    const reference = credentialRefForConfig(row.id)
    const style = protocolOf(row.provider)
    const modelMaxTokens = row.max_output_tokens ?? row.max_tokens
    const streamIdleTimeoutMs = row.timeout === null || row.timeout <= 0
      ? DEFAULT_STREAM_IDLE_TIMEOUT_MS
      : row.timeout * 1000
    if (style === 'openai') {
      // OpenAI 兼容提供方走 pi-ai 的 `openai-completions`（复用官方多协议适配器，不自研第二套协议实现）。
      const profiles = resolveProfiles({
        [route]: {
          displayName: row.name,
          api: 'openai-completions',
          baseURL: deriveOpenAiRoot(row),
          ...modelMaxTokens === null ? {} : { defaultMaxTokens: modelMaxTokens },
          models: [{
            id: row.model_name,
            ...row.max_input_tokens === null ? {} : { contextWindow: row.max_input_tokens },
            ...modelMaxTokens === null ? {} : { maxTokens: modelMaxTokens },
          }],
          streamIdleTimeoutMs,
        },
      }, 'deferred')
      const adapter = new PiAiAdapter({
        profiles: () => profiles,
        // 密钥每次请求按本行所属用户的桶向管理层现要（不缓存明文、不进连接事实）。
        resolveApiKey: async () => await this.resolveApiKey(userId, reference),
        auth: this.auth,
      })
      const samplingParams = samplingParamsOf(row)
      return {
        route, userId, row, style, connection: null, adapter,
        ...(samplingParams === undefined ? {} : { samplingParams }),
      }
    }
    const connection = resolveAdapterOptions({
      baseURL: deriveBaseRoot(row),
      maxTokens: modelMaxTokens ?? DEFAULT_MAX_TOKENS,
      defaultContextWindow: row.max_input_tokens ?? DEFAULT_CONTEXT_WINDOW,
      models: [{
        id: row.model_name,
        name: row.model_name,
        ...row.max_input_tokens === null ? {} : { contextWindow: row.max_input_tokens },
        ...modelMaxTokens === null ? {} : { maxTokens: modelMaxTokens },
        inputModalities: ['text'],
      }],
      streamIdleTimeoutMs,
    })
    const adapter = new DeepSeekAdapterClass({
      options: () => connection,
      // 密钥每次请求按本行所属用户的桶向管理层现要（不缓存明文、不进连接事实）。
      resolveAuth: async () => ({ headers: { 'x-api-key': await this.resolveApiKey(userId, reference) } }),
      resolveUserId: () => this.resolveUserId(),
      // Messages 协议没有 OpenAI 的采样字段：top_p 与 extra_params 作为请求扩展并入请求体。
      prepareExtensions: () => Promise.resolve({ fields: extensionFieldsOf(row), accept: () => Promise.resolve() }),
    })
    return { route, userId, row, style, connection, adapter }
  }

  /** 匿名用户标识（官方适配器要求；由 harness 侧的匿名身份提供方解析）。 */
  private resolveUserIdImpl: (() => AnonymousUserId) | undefined

  /**
   * 注入匿名用户标识解析器（由插件在 `apply` 时提供）。
   * @param resolve - 返回当前匿名用户标识的解析器。
   */
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
  /** OpenAI 兼容线协议的附加采样字段；Messages 协议通过请求扩展注入。 */
  samplingParams?: Record<string, unknown>
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
  const samplingParams = options.samplingParams === undefined && defaults.samplingParams !== undefined
    ? { samplingParams: defaults.samplingParams }
    : {}
  if (Object.keys(temperature).length === 0 && Object.keys(maxTokens).length === 0
    && Object.keys(samplingParams).length === 0) return options
  return { ...options, ...temperature, ...maxTokens, ...samplingParams }
}

/** 请求体里由适配器/组合拥有的键：行级扩展参数不得覆盖它们。 */
const RESERVED_REQUEST_KEYS = new Set([
  'model', 'messages', 'stream', 'system', 'tools', 'tool_choice', 'max_tokens', 'temperature',
  'stop', 'stop_sequences', 'sessionId', 'provider',
])

/**
 * 解析行级扩展参数（JSON 对象）；损坏或覆盖保留键即报错，不静默丢弃。
 * @param raw - `llm_configs.extra_params` 原文。
 * @returns 可并入请求体的字段。
 */
export function parseExtraParams(raw: string | null): Record<string, unknown> {
  if (raw === null || raw.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`model config extra_params is not valid JSON: ${String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('model config extra_params must be a JSON object')
  }
  const fields = parsed as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (RESERVED_REQUEST_KEYS.has(key)) {
      throw new Error(`model config extra_params cannot set the reserved request field "${key}"`)
    }
  }
  return fields
}

/**
 * 行级采样字段（OpenAI 兼容线协议）：显式列优先于 extra_params。
 * @param row - 模型配置行。
 * @returns 要并入 samplingParams 的字段；没有时 undefined。
 */
export function samplingParamsOf(row: ModelRouteFact): Record<string, unknown> | undefined {
  if (protocolOf(row.provider) !== 'openai') return undefined
  const fields: Record<string, unknown> = { ...parseExtraParams(row.extra_params) }
  if (row.top_p !== null) fields.top_p = row.top_p
  if (row.frequency_penalty !== null) fields.frequency_penalty = row.frequency_penalty
  if (row.presence_penalty !== null) fields.presence_penalty = row.presence_penalty
  return Object.keys(fields).length === 0 ? undefined : fields
}

/**
 * Messages 协议的请求扩展字段：`top_p` 与 `extra_params` 由适配器并入请求体。
 * @param row - 模型配置行。
 * @returns 扩展字段；没有时为空对象。
 */
export function extensionFieldsOf(row: ModelRouteFact): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...parseExtraParams(row.extra_params) }
  if (row.top_p !== null) fields.top_p = row.top_p
  return fields
}
