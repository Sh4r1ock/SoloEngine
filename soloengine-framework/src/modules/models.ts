/**
 * 模型配置域（PRD-03 FR-LLM-001~008）。
 *
 * - CRUD：16 个可编辑字段（表 23 列，另含 is_default / is_active / version）+ 乐观锁（version）；
 * - 密钥 AES-256-GCM 加密落库、使用时解密；接口永不回传明文（掩码回显）；
 *   更新时 `api_key` 空串 = 不修改，`clear_api_key: true` = 清除已保存密钥；
 * - 数值字段有区间校验（temperature 0–2、top_p 0–1、惩罚项 -2–2、各类上限 ≥1、timeout 1–600 秒）；
 * - 连通性测试：真发一次最小请求，失败按六类归因（鉴权/地址/超时/网络/响应/未分类）；
 * - 默认配置全用户唯一（设默认即取消同用户其它默认）。
 *
 * harness 侧（`@soloengine/llm-db-adapter`）把每条启用配置暴露为 `soloengine-<id>` 路由。
 *
 * @module @soloengine/framework/modules/models
 */

import type { BusinessDatabase } from '../db/port.ts'
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
  /** 密钥状态：未配置 / 可解密 / 存在但解不开（主密钥更换等，需重新填写）。 */
  key_state: 'absent' | 'ok' | 'unreadable'
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
  /** 新密钥：更新时空串表示不修改。 */
  api_key?: string
  /** 更新时置 true 表示清除已保存的密钥（与 `api_key` 互斥）。 */
  clear_api_key?: boolean
  base_url?: string
  is_full_url?: boolean
  /** 更新时显式 null 表示清除该字段（留空即恢复提供方默认）。 */
  temperature?: number | null
  max_tokens?: number | null
  max_input_tokens?: number | null
  max_output_tokens?: number | null
  top_p?: number | null
  frequency_penalty?: number | null
  presence_penalty?: number | null
  timeout?: number | null
  max_tool_calls?: number | null
  /** 更新时显式 null 表示清除扩展参数。 */
  extra_params?: string | null
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
  // DeepSeek 的 Anthropic 兼容端点在 /anthropic 下（Messages 协议）；OpenAI 兼容端点是 /v1。
  deepseek: { baseUrl: 'https://api.deepseek.com/anthropic', style: 'anthropic' },
  openai: { baseUrl: 'https://api.openai.com/v1', style: 'openai' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', style: 'anthropic' },
  // 本地 Ollama 服务：OpenAI 兼容端点在 /v1（官方文档 OpenAI compatibility）。
  ollama: { baseUrl: 'http://localhost:11434/v1', style: 'openai' },
  'openai-compatible': { baseUrl: '', style: 'openai' },
}

/** 数值字段的允许区间（与各提供方的口径一致；上限缺省表示只要求 ≥ min）。 */
const NUMERIC_LIMITS: Record<string, { min: number; max?: number; integer?: boolean }> = {
  temperature: { min: 0, max: 2 },
  top_p: { min: 0, max: 1 },
  frequency_penalty: { min: -2, max: 2 },
  presence_penalty: { min: -2, max: 2 },
  max_tokens: { min: 1, integer: true },
  max_input_tokens: { min: 1, integer: true },
  max_output_tokens: { min: 1, integer: true },
  max_tool_calls: { min: 1, integer: true },
  timeout: { min: 1, max: 600, integer: true },
}

/** 模型配置域服务。 */
export class LlmConfigService {
  private readonly db: BusinessDatabase
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时。
   */
  constructor(runtime: FrameworkRuntime) {
    this.db = runtime.db
    this.runtime = runtime
  }

  /** 行 → 对外视图（密钥掩码；解不开时给出 `key_state='unreadable'` 而不是只显示星号）。 */
  view(row: LlmConfigRow): LlmConfigView {
    let masked: string | null = null
    let keyState: LlmConfigView['key_state'] = 'absent'
    if (row.api_key !== null && row.api_key !== '') {
      try {
        masked = maskSecret(decryptSecret(this.runtime.masterKey, row.api_key))
        keyState = 'ok'
      } catch {
        // 主密钥更换或密文损坏：密钥「存在但用不了」，必须让用户看见并可重填。
        masked = '********'
        keyState = 'unreadable'
      }
    }
    const { api_key: _apiKey, ...rest } = row
    return {
      ...rest,
      api_key_masked: masked,
      has_api_key: row.api_key !== null && row.api_key !== '',
      key_state: keyState,
      is_full_url: row.is_full_url === 1,
      is_default: row.is_default === 1,
      is_active: row.is_active === 1,
      model_route: `soloengine-${row.id}`,
    }
  }

  /** 按 ID 取行（限归属用户）。 */
  async byId(userId: string, id: string): Promise<LlmConfigRow | undefined> {
    return await this.db.prepare('SELECT * FROM llm_configs WHERE id = ? AND user_id = ?').get<LlmConfigRow>(id, userId)
  }

  /**
   * 按 ID 取行（不限归属）。
   *
   * 私有且只服务本模块内部的「已知归属之后」的读取：任何 REST 面与任何跨用户入口都必须
   * 先经 {@link byId}(userId, id) 确立归属。
   * @param id - 配置 ID。
   * @returns 行，或 undefined。
   */
  private async byIdAnyUser(id: string): Promise<LlmConfigRow | undefined> {
    return await this.db.prepare('SELECT * FROM llm_configs WHERE id = ?').get<LlmConfigRow>(id)
  }

  /** 列某用户全部配置（按创建时间）。 */
  async list(userId: string): Promise<LlmConfigRow[]> {
    return await this.db.prepare('SELECT * FROM llm_configs WHERE user_id = ? ORDER BY created_at ASC')
      .all<LlmConfigRow>(userId)
  }

  /**
   * 列某用户全部启用配置（供 harness 侧按用户轮询热同步）。
   * @param userId - 归属用户。
   * @returns 该用户启用中的配置行。
   */
  async listActive(userId: string): Promise<LlmConfigRow[]> {
    return await this.db.prepare(
      'SELECT * FROM llm_configs WHERE user_id = ? AND is_active = 1 ORDER BY created_at ASC',
    ).all<LlmConfigRow>(userId)
  }

  /**
   * 列「有启用配置」的归属用户（路由热同步的桶清单）。
   *
   * 只返回用户 id，不含任何配置事实与密钥：harness 侧据此逐用户调用
   * {@link listActive}(userId)，同一进程多用户时各桶互不可见。
   * @returns 归属用户 id（升序）。
   */
  async listActiveOwners(): Promise<string[]> {
    const rows = await this.db.prepare(
      'SELECT DISTINCT user_id FROM llm_configs WHERE is_active = 1 ORDER BY user_id ASC',
    ).all<{ user_id: string }>()
    return rows.map(row => row.user_id)
  }

  /** 校验 provider 受支持。 */
  private assertProvider(provider: string): void {
    if (PROVIDER_DEFAULTS[provider] === undefined) {
      throw new FrameworkError(400, 'UNSUPPORTED_PROVIDER',
        `provider ${provider} is not supported; expected one of ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`)
    }
  }

  /** 校验扩展参数为合法 JSON 对象（null 表示清除，不做内容校验）。 */
  private assertExtraParams(extra: string | null | undefined): void {
    if (extra === undefined || extra === null || extra === '') return
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
   * 数值字段区间校验（创建与更新同一份规则，拒绝越界/非整数/非有限值）。
   * @param input - 配置入参。
   */
  private assertNumeric(input: LlmConfigInput): void {
    for (const [field, limit] of Object.entries(NUMERIC_LIMITS)) {
      const value = (input as Record<string, unknown>)[field]
      if (value === undefined || value === null) continue
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new FrameworkError(400, 'INVALID_NUMERIC', `${field} must be a finite number`)
      }
      if (limit.integer === true && !Number.isInteger(value)) {
        throw new FrameworkError(400, 'INVALID_NUMERIC', `${field} must be an integer`)
      }
      const range = limit.max === undefined ? `>= ${String(limit.min)}` : `${String(limit.min)}..${String(limit.max)}`
      if (value < limit.min || (limit.max !== undefined && value > limit.max)) {
        throw new FrameworkError(400, 'INVALID_NUMERIC', `${field} must be within ${range}`)
      }
    }
  }

  /**
   * 新建配置。
   * @param userId - 归属用户。
   * @param input - 配置字段。
   * @returns 对外视图。
   */
  async create(userId: string, input: LlmConfigInput): Promise<LlmConfigView> {
    const name = String(input.name ?? '').trim()
    const provider = String(input.provider ?? '').trim()
    const modelName = String(input.model_name ?? '').trim()
    if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'name is required')
    if (provider === '') throw new FrameworkError(400, 'PROVIDER_REQUIRED', 'provider is required')
    if (modelName === '') throw new FrameworkError(400, 'MODEL_REQUIRED', 'model_name is required')
    this.assertProvider(provider)
    this.assertExtraParams(input.extra_params)
    this.assertNumeric(input)

    const now = new Date().toISOString()
    const id = newId()
    const encrypted = input.api_key === undefined || input.api_key === '' ? null : encryptSecret(this.runtime.masterKey, input.api_key)
    await this.db.transaction(async tx => {
      await tx.prepare(
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
      if (input.is_default === true) await this.makeExclusiveDefault(tx, userId, id)
      // 有配置就必须有默认路由（原型 models.js:230-233）：首个配置未勾默认时，
      // 取最早的启用项；没有启用项就取当前行。
      const hasDefault = await tx.prepare(
        'SELECT 1 AS ok FROM llm_configs WHERE user_id = ? AND is_default = 1 LIMIT 1',
      ).get(userId)
      if (hasDefault === undefined) {
        const candidate = await tx.prepare(
          'SELECT id FROM llm_configs WHERE user_id = ? AND is_active = 1 ORDER BY created_at ASC, id ASC LIMIT 1',
        ).get(userId)
        const fallbackId = (candidate as { id?: string } | undefined)?.id ?? id
        await tx.prepare('UPDATE llm_configs SET is_default = 1 WHERE id = ?').run(fallbackId)
      }
    })
    return this.view(await this.byId(userId, id) as LlmConfigRow)
  }

  /**
   * 更新配置（乐观锁：version 必须匹配）。
   * @param userId - 归属用户。
   * @param id - 配置 ID。
   * @param patch - 待更新字段。
   * @returns 对外视图。
   */
  async update(userId: string, id: string, patch: LlmConfigInput): Promise<LlmConfigView> {
    const row = await this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    if (patch.version === undefined) throw new FrameworkError(400, 'VERSION_REQUIRED', 'version is required for update')
    if (Number(patch.version) !== Number(row.version)) {
      throw new FrameworkError(409, 'VERSION_CONFLICT',
        `model config ${id} was modified (expected version ${String(row.version)}, got ${String(patch.version)}); refresh and retry`)
    }
    if (patch.provider !== undefined) this.assertProvider(patch.provider)
    this.assertExtraParams(patch.extra_params)
    this.assertNumeric(patch)
    if (patch.clear_api_key === true && patch.api_key !== undefined && patch.api_key !== '') {
      throw new FrameworkError(400, 'CONFLICTING_API_KEY',
        'clear_api_key and a non-empty api_key cannot be provided together')
    }

    const now = new Date().toISOString()
    const assignments: string[] = []
    const values: (string | number | null)[] = []
    const set = (column: string, value: string | number | null): void => {
      assignments.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (name === '') throw new FrameworkError(400, 'NAME_REQUIRED', 'name must not be empty')
      set('name', name)
    }
    if (patch.provider !== undefined) set('provider', patch.provider)
    if (patch.model_name !== undefined) {
      const modelName = patch.model_name.trim()
      if (modelName === '') throw new FrameworkError(400, 'MODEL_REQUIRED', 'model_name must not be empty')
      set('model_name', modelName)
    }
    // 密钥三态：新值（非空）→ 加密覆盖；clear_api_key → 清空；空串 → 不修改。
    if (patch.clear_api_key === true) {
      set('api_key', null)
    } else if (patch.api_key !== undefined && patch.api_key !== '') {
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
    if (patch.is_default === true && (patch.is_active === false || (patch.is_active === undefined && row.is_active !== 1))) {
      throw new FrameworkError(400, 'DEFAULT_REQUIRES_ACTIVE', 'an inactive model cannot be the default')
    }
    set('updated_at', now)
    assignments.push('version = version + 1')
    values.push(id, userId)
    await this.db.transaction(async tx => {
      await tx.prepare(`UPDATE llm_configs SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`).run(...values)
      if (patch.is_default === true) await this.makeExclusiveDefault(tx, userId, id)
      // 经 PATCH 停用默认项与 `/active` 同一语义：默认必须顺延，不能留在已停用的行上。
      else if (patch.is_active === false && row.is_default === 1) await this.promoteNextDefault(tx, userId, id)
    })
    return this.view(await this.byId(userId, id) as LlmConfigRow)
  }

  /**
   * 删除配置（删除后路由即时注销）。
   *
   * 删除的是默认项时，同一事务里把下一条启用配置顺延为默认（最旧创建者优先）；
   * 没有剩余启用项即不留下默认。
   */
  async remove(userId: string, id: string): Promise<void> {
    const row = await this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    // 会话归属行的 llm_config_id 可空（PRD-12 FR-STO-004）：配置被删除时先断开引用，
    // 历史会话仍在（归属链保留），而该路由随即从注册表消失——后续请求得到结构化
    // 「路由不存在」，不静默回退（PRD-06 FR-ENG-015）。
    await this.db.transaction(async tx => {
      await tx.prepare('UPDATE sessions SET llm_config_id = NULL WHERE llm_config_id = ?').run(id)
      await tx.prepare('DELETE FROM llm_configs WHERE id = ? AND user_id = ?').run(id, userId)
      if (row.is_default === 1) await this.promoteNextDefault(tx, userId, id)
    })
  }

  /**
   * 启用/停用（停用即路由不注册）。
   *
   * 停用默认项时同一事务里把下一条启用配置顺延为默认（最旧创建者优先，与原型一致）；
   * 没有剩余启用项即不留下默认。
   */
  async setActive(userId: string, id: string, active: boolean): Promise<LlmConfigView> {
    const row = await this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    const now = new Date().toISOString()
    await this.db.transaction(async tx => {
      await tx.prepare(
        'UPDATE llm_configs SET is_active = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ?',
      ).run(active ? 1 : 0, now, id, userId)
      if (!active && row.is_default === 1) await this.promoteNextDefault(tx, userId, id)
    })
    return this.view(await this.byId(userId, id) as LlmConfigRow)
  }

  /**
   * 把默认顺延给同用户下一条启用配置（最旧创建者优先；ID 作为同毫秒的确定性次序）。
   *
   * 必须与调用方的写操作同一事务：否则「停用默认项」与「顺延」之间会留下无默认的空档。
   * @param tx - 当前事务连接。
   * @param userId - 归属用户。
   * @param excludeId - 正在停用/删除的配置（不会再次成为默认）。
   */
  private async promoteNextDefault(tx: BusinessDatabase, userId: string, excludeId: string): Promise<void> {
    const now = new Date().toISOString()
    const next = await tx.prepare(
      'SELECT id FROM llm_configs WHERE user_id = ? AND is_active = 1 AND id != ? ORDER BY created_at ASC, id ASC LIMIT 1',
    ).get<{ id: string }>(userId, excludeId)
    if (next === undefined) {
      // 没有可顺延的启用项：连旧默认标记一起清掉，视图里不残留「已停用的默认」。
      await tx.prepare(
        'UPDATE llm_configs SET is_default = 0, updated_at = ?, version = version + 1 WHERE user_id = ? AND is_default = 1',
      ).run(now, userId)
      return
    }
    await tx.prepare(
      'UPDATE llm_configs SET is_default = 1, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ?',
    ).run(now, next.id, userId)
    await this.makeExclusiveDefault(tx, userId, next.id)
  }

  /** 设为默认（全用户唯一：取消同用户其它默认）。 */
  async setDefault(userId: string, id: string): Promise<LlmConfigView> {
    const row = await this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    return await this.update(userId, id, { is_default: true, version: Number(row.version) })
  }

  /** 默认互斥：同一用户的其它配置取消默认（必须与置位同一事务）。 */
  private async makeExclusiveDefault(tx: BusinessDatabase, userId: string, keepId: string): Promise<void> {
    // 被清掉默认的行也要推进版本与更新时间：否则别的编辑器看不到这次变更（乐观锁形同虚设）。
    await tx.prepare(
      'UPDATE llm_configs SET is_default = 0, updated_at = ?, version = version + 1 WHERE user_id = ? AND id != ? AND is_default = 1',
    ).run(new Date().toISOString(), userId, keepId)
  }

  /**
   * 解密并返回明文密钥（**宿主内部执行面**）。
   *
   * 路由名由「该用户自己的启用配置」派生，故这里必须同时核对归属：`user_id` 不匹配即视同
   * 行不存在（不泄漏存在性、不返回他人密钥）。任何新增的 REST 消费点都必须先经
   * `byId(userId, id)` 确立归属；本方法自身永不经 REST 面输出明文。
   * @param userId - 归属用户（路由桶的归属，不是请求体字段）。
   * @param id - 配置 ID。
   * @returns 明文密钥，或 null（未配置/已清除/不属于该用户）。
   */
  async resolveApiKey(userId: string, id: string): Promise<string | null> {
    const row = await this.byIdAnyUser(id)
    if (row === undefined || row.user_id !== userId || row.api_key === null || row.api_key === '') return null
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
    const row = await this.byId(userId, id)
    if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${id} not found`)
    const apiKey = await this.resolveApiKey(userId, id)
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
        let json: boolean
        try {
          const parsed = JSON.parse(text) as { model?: string; id?: string }
          providerId = parsed.model ?? parsed.id
          json = true
        } catch {
          providerId = undefined
          json = false
        }
        // 200 + HTML（门户页/反代登录页）不是可用的模型端点：不能报「连通成功」。
        if (!json) {
          return {
            ok: false,
            kind: 'response',
            message: `endpoint answered 200 with a non-JSON body: ${text.slice(0, 200)}`,
            latency_ms: latency,
            status: response.status,
          }
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
