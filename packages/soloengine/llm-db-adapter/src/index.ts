/**
 * `@soloengine/llm-db-adapter` —— 管理层模型路由适配器（完全自研，Host 面）。
 *
 * 依据 PRD-06 FR-ENG-014/015 与 PRD-03 FR-LLM-002/004：
 * - 把管理层启用中的每条模型配置暴露为一条 `soloengine-<id>` 模型路由；
 * - 注册是原子的：路由集合变化经 `registration.replace()` 全量替换（秒级轮询），
 *   重复路由由官方注册表直接拒绝；
 * - 执行时向管理层要该配置已解密的密钥与地址（每次操作重新解析，改 Key 下次请求即新值）；
 * - 路由被删除后请求得到结构化 `NO_ADAPTER` 错误，**不静默回退**到默认模型；
 * - 线协议与流式翻译复用官方 `@deepseek-ai/dsh-llm-deepseek` 适配器（零改动），
 *   本插件只做「配置来源」这一件事，不读业务库、不持有主密钥。
 *
 * @module @soloengine/llm-db-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AdapterRegistrationHandle, GenerateOptions, LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { authContextFrom, credentialStoreFrom } from '@deepseek-ai/dsh-llm-pi-ai/src/auth.ts'
import { RouteTable, withRowSampling, type ModelRouteSource, type RouteEntry, type RouteSnapshot } from './routes.ts'

export const name = 'soloengine-llm-db-adapter'
export const inject = ['llm', 'soloengineModelRoutes']

/** 插件配置。 */
export interface Config {
  /** 轮询周期（毫秒）。 */
  pollMs?: number
}

/**
 * 默认轮询周期 = 1000ms。
 *
 * 为什么不是 3000：NFR-PER-008 要求「增删改 3 秒内新路由可用」——这是一个**时延上界**，
 * 而轮询方案的最坏时延是「一个周期 + 重算时间」。把周期设成等于上界，最坏情况必然越界
 * （本机实测 3091ms > 3000ms 而判定失败）。故周期必须显著小于上界 3000ms；取 1000ms 使
 * 最坏时延约为 1 秒量级，留出充足余量，同时仍是 PRD-03 所说的「秒级轮询」。
 */
const DEFAULT_POLL_MS = 1000

/**
 * 失败原因的可读文本。
 * @param error - 同步失败原因。
 * @returns Error 的消息，其余值按字符串化。
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 校验管理层模型路由服务的模块边界（服务由 `@soloengine/host` 提供）。
 * @param value - 注入得到的未知值。
 * @returns 是否为可用的、按用户归属收敛的路由服务。
 */
function isModelRouteSource(value: unknown): value is ModelRouteSource {
  if (typeof value !== 'object' || value === null) return false
  return typeof Reflect.get(value, 'listActiveOwners') === 'function'
    && typeof Reflect.get(value, 'listActive') === 'function'
    && typeof Reflect.get(value, 'resolveApiKey') === 'function'
    && typeof Reflect.get(value, 'ownerOfSession') === 'function'
}

/**
 * 一个实例服务全部 `soloengine-<id>` 路由：按 provider 参数把每个调用委派给
 * 该路由自己的官方适配器实例（每条路由的连接事实互相独立）。
 */
export class SoloEngineDbAdapter extends LlmAdapter {
  /**
   * @param table - 路由表（路由名 → 该路由的连接事实与适配器）。
   */
  constructor(private readonly table: RouteTable) {
    super()
  }

  /** 取一条路由（含该路由的连接事实与官方适配器）；路由不存在即结构化报错（不回退）。 */
  private impl(provider: string): RouteEntry {
    const entry = this.table.get(provider)
    if (entry === undefined) {
      throw new LlmError(
        `no SoloEngine model config is registered for route "${provider}"; the route is unavailable`,
        'NO_ADAPTER',
      )
    }
    return entry
  }

  /**
   * 校验发起本次模型调用的会话是否归属于该路由所在的桶。
   *
   * 路由名仍是 `soloengine-<id>`，但只有「该会话归属用户」的桶里可解析：别的用户即使拿到
   * 路由名（或把别人的 modelRef 写进自己的画布），也不会用到那一条配置及其密钥。
   *
   * 归属行缺失的会话（headless 一次性作业、打包产物的独立运行、面板原生会话）不做跨用户
   * 比对——它们不属任何产品用户，本实例的路由表即其可见面；这保证了「产物可被任意 dsh
   * 运行面加载」不被租户判定挡住。
   * @param entry - 本次要派发的路由条目。
   * @param sessionId - 会话身份（循环为每次请求盖上）；缺省时只能按唯一路由名解析。
   * @throws LlmError `NO_ADAPTER`：会话不属于该路由的归属用户（与路由不存在同一语义）。
   */
  private async assertOwnership(entry: RouteEntry, sessionId: string | undefined): Promise<void> {
    if (sessionId === undefined) return
    const owner = await this.table.ownerOfSession(sessionId)
    // 无归属行 = 该会话不是产品运行（headless 一次性作业、产物独立运行、面板原生会话）：
    // 本实例的路由表就是它的全部可见面，没有第二个租户可比对。
    if (owner === undefined) return
    // 桶里的存在性就是判据：别人的会话解析不到这条路由，与「路由不存在」同一语义。
    if (this.table.owns(entry.route, owner)) return
    throw new LlmError(
      `route "${entry.route}" does not belong to the user of session "${sessionId}"; the route is unavailable`,
      'NO_ADAPTER',
    )
  }

  /** 路由的展示元数据（id 必须等于 provider，否则注册表拒绝）。 */
  override providerInfo(provider: string): LlmProviderInfo {
    const entry = this.impl(provider)
    return { id: provider, name: `SoloEngine · ${entry.row.name}` }
  }

  /** 该路由的提供方重试策略（随路由注册被捕获）。 */
  override providerRetryPolicy(provider: string): ReturnType<LlmAdapter['providerRetryPolicy']> {
    return this.impl(provider).adapter.providerRetryPolicy(provider)
  }

  /** 该路由的可发现模型（advisory）。 */
  override listModels(provider: string): ReturnType<LlmAdapter['listModels']> {
    return this.impl(provider).adapter.listModels(provider)
  }

  /** 该路由的精确模型元数据。 */
  override resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): ReturnType<LlmAdapter['resolveModel']> {
    return this.impl(provider).adapter.resolveModel(provider, model, signal)
  }

  /** 该路由的请求图片定价。 */
  override imageRequestPricing(provider: string, model: string): ReturnType<LlmAdapter['imageRequestPricing']> {
    return this.impl(provider).adapter.imageRequestPricing(provider, model)
  }

  /**
   * 把「模型元数据解析」与「请求派发」绑到同一条路由的同一代适配器上
   * （FR-ENG-014：热更新不串代）；行级默认采样在派发处并入（与 {@link stream} 同一规则），
   * 否则走 prepareCall 的调用会绕过该行的 temperature/maxTokens。
   * 派发前按会话归属校验路由桶（归属不符即结构化拒绝）。
   */
  override async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): ReturnType<LlmAdapter['prepareCall']> {
    const entry = this.impl(provider)
    const prepared = await entry.adapter.prepareCall(provider, model, signal)
    return {
      model: prepared.model,
      stream: (options: GenerateOptions) => this.dispatchPrepared(entry, prepared, options),
    }
  }

  /** prepareCall 的派发面：先核归属，再把本次请求交给该路由同代的适配器。 */
  private async *dispatchPrepared(
    entry: RouteEntry,
    prepared: Awaited<ReturnType<LlmAdapter['prepareCall']>>,
    options: GenerateOptions,
  ): AsyncGenerator<StreamChunk> {
    await this.assertOwnership(entry, options.sessionId === undefined ? undefined : String(options.sessionId))
    yield* prepared.stream(withRowSampling(options, {
      temperature: entry.row.temperature,
      maxTokens: entry.row.max_output_tokens ?? entry.row.max_tokens,
      ...(entry.samplingParams === undefined ? {} : { samplingParams: entry.samplingParams }),
    }))
  }

  /** 流式调用：并入该行的默认采样参数后交给该路由的官方适配器（先按会话归属校验路由桶）。 */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.dispatchStream(options)
  }

  /** {@link stream} 的实际派发（异步入口才能在派发前读取会话归属）。 */
  private async *dispatchStream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const entry = this.impl(options.provider)
    await this.assertOwnership(entry, options.sessionId === undefined ? undefined : String(options.sessionId))
    yield* entry.adapter.stream(withRowSampling(options, {
      temperature: entry.row.temperature,
      maxTokens: entry.row.max_output_tokens ?? entry.row.max_tokens,
      ...(entry.samplingParams === undefined ? {} : { samplingParams: entry.samplingParams }),
    }))
  }
}

/**
 * 注册模型路由并保持秒级热同步（周期必须显著小于 NFR-PER-008 的 3 秒时延上界）。
 * @param ctx - 插件上下文（必须注入 `llm` 与 `soloengineModelRoutes`）。
 * @param config - 轮询周期。
 */
export function apply(ctx: Context, config: Config): void {
  const pollMs = config.pollMs ?? DEFAULT_POLL_MS
  if (!Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error('soloengine-llm-db-adapter: config.pollMs must be a positive finite number')
  }

  const source: unknown = ctx.get('soloengineModelRoutes')
  if (!isModelRouteSource(source)) {
    throw new Error('soloengine-llm-db-adapter: the soloengineModelRoutes service is not available')
  }

  const table = new RouteTable(source, {
    credentials: credentialStoreFrom(ctx),
    authContext: authContextFrom(ctx),
  })
  table.setUserIdResolver(() => getOrCreateAnonymousUserId())
  const adapter = new SoloEngineDbAdapter(table)

  let registration: AdapterRegistrationHandle | undefined
  let applied = ''
  let lastError: unknown
  let inFlight: Promise<void> | undefined

  /**
   * 一次同步。
   *
   * 分两段：先用廉价的事实探测判断有没有变化，没变就什么都不做（不重算、不注册、不打印）；
   * 变了才重算路由集合并原子替换。这样轮询周期可以短到足以满足时延上界，而不必每个周期
   * 都为几百条路由重建一遍官方适配器实例。
   */
  const doSync = async (): Promise<void> => {
    try {
      let facts: string
      try {
        facts = await table.factSignature()
        lastError = undefined
      } catch (error: unknown) {
        lastError = error
        ctx.logger.error('soloengine-llm-db-adapter: probing model routes failed; keeping the current route set')
        ctx.logger.error(error)
        return
      }
      // 行事实未变即不做任何后续动作（也不重复打印）。
      if (facts === applied) return
      let snapshot: RouteSnapshot
      try {
        snapshot = await table.reload()
        lastError = undefined
      } catch (error: unknown) {
        lastError = error
        ctx.logger.error('soloengine-llm-db-adapter: reading model routes failed; keeping the current route set')
        ctx.logger.error(error)
        return
      }
      const routes = snapshot.routes.map(entry => entry.route)
      const skipped = snapshot.skipped.map(entry => `${entry.id}(${entry.name}): ${entry.reason}`).join('; ')
      if (snapshot.signature === applied) return
      if (registration === undefined) {
        if (routes.length === 0) {
          console.log(
            `soloengine: soloengine-llm-db-adapter: no route registered${skipped === '' ? '' : ` | rejected: ${skipped}`}`,
          )
          applied = snapshot.signature
          return
        }
        registration = ctx.llm.registerAdapter(routes, adapter)
      } else {
        registration.replace(routes)
      }
      applied = snapshot.signature
      const line = `soloengine-llm-db-adapter: ${routes.length} route(s) synced: ${routes.join(', ')}`
        + (skipped === '' ? '' : ` | rejected: ${skipped}`)
      // 可取证行走 console：本 profile 未挂 logger-console，logger 输出不进启动日志。
      console.log(`soloengine: ${line}`)
    } catch (error: unknown) {
      // 同步失败保留当前路由集合，不因一次探测/读取失败清空可用模型。
      lastError = error
      ctx.logger.error('soloengine-llm-db-adapter: syncing model routes failed; keeping the current route set')
      ctx.logger.error(error)
    }
  }

  /**
   * 合并并发同步：已有同步在跑时复用同一个 Promise（轮询与按需触发共用）。
   * @returns 本轮同步完成的 Promise。
   */
  const sync = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight
    const run = doSync().finally(() => { inFlight = undefined })
    inFlight = run
    return run
  }

  /**
   * 按需同步（宿主在创建会话前调用）：先等正在进行的同步结束，再补一次探测，
   * 保证「刚创建的模型」在第一次模型调用前已注册，不落在 1 秒轮询的空窗里。
   * @returns 两次同步都完成。
   */
  const syncNow = async (): Promise<void> => {
    await sync()
    await sync()
  }

  ctx.provide('soloengineModelSync', { syncNow })

  ctx.effect(() => {
    void sync()
    const timer = setInterval(() => { void sync() }, pollMs)
    return () => {
      clearInterval(timer)
      registration?.()
      registration = undefined
      table.close()
    }
  }, 'soloengine-llm-db-adapter.sync()')

  /** 供自检读取的同步状态（失败可见，不吞错）。 */
  ctx.on('llm/adapters-updated', () => {
    if (lastError !== undefined) {
      ctx.logger.warn(`soloengine-llm-db-adapter: last sync failed: ${errorText(lastError)}`)
    }
  })
}
