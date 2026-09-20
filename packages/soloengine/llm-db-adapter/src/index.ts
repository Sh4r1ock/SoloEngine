/**
 * `@soloengine/llm-db-adapter` —— DB 密钥模型适配器（完全自研，Host 面）。
 *
 * 依据 PRD-06 FR-ENG-014/015 与 PRD-03 FR-LLM-002/004：
 * - 把 `llm_configs` 每条启用中的配置暴露为一条 `soloengine-<id>` 模型路由；
 * - 注册是原子的：路由集合变化经 `registration.replace()` 全量替换（3 秒轮询），
 *   重复路由由官方注册表直接拒绝；
 * - 执行时从数据库回表解密该行密钥与地址（每次操作重新解析，改 Key 下次请求即新值）；
 * - 路由被删除后请求得到结构化 `NO_ADAPTER` 错误，**不静默回退**到默认模型；
 * - 线协议与流式翻译复用官方 `@deepseek-ai/dsh-llm-deepseek` 适配器（零改动），
 *   本插件只做「配置来源」这一件事。
 *
 * @module @soloengine/llm-db-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AdapterRegistrationHandle, GenerateOptions, LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { RouteTable, withRowSampling, type RouteEntry, type RouteSnapshot } from './routes.ts'

export const name = 'soloengine-llm-db-adapter'
export const inject = ['llm']

/** 插件配置（全部必填：缺一即加载期报错，无回退默认值）。 */
export interface Config {
  /** 业务库绝对路径。 */
  dbPath: string
  /** 主密钥目录（`master.key` 所在）。 */
  keysDir: string
  /** 轮询周期（毫秒），默认 3000（PRD-03 FR-LLM-004 的 3 秒热同步）。 */
  pollMs?: number
}

/** 默认轮询周期。 */
const DEFAULT_POLL_MS = 3000

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
   * （FR-ENG-014：热更新不串代）。
   */
  override prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): ReturnType<LlmAdapter['prepareCall']> {
    return this.impl(provider).adapter.prepareCall(provider, model, signal)
  }

  /** 流式调用：并入该行的默认采样参数后交给该路由的官方适配器。 */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.impl(options.provider)
    return entry.adapter.stream(withRowSampling(options, {
      temperature: entry.row.temperature,
      maxTokens: entry.row.max_output_tokens ?? entry.row.max_tokens,
    }))
  }
}

/**
 * 注册 DB 模型路由并保持 3 秒热同步。
 * @param ctx - 插件上下文（必须注入 `llm`）。
 * @param config - 业务库路径、主密钥目录与轮询周期。
 */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.dbPath !== 'string' || config.dbPath === '') {
    throw new Error('soloengine-llm-db-adapter: config.dbPath is required')
  }
  if (typeof config.keysDir !== 'string' || config.keysDir === '') {
    throw new Error('soloengine-llm-db-adapter: config.keysDir is required')
  }
  const pollMs = config.pollMs ?? DEFAULT_POLL_MS
  if (!Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error('soloengine-llm-db-adapter: config.pollMs must be a positive finite number')
  }

  const table = new RouteTable({ dbPath: config.dbPath, keysDir: config.keysDir })
  table.setUserIdResolver(() => getOrCreateAnonymousUserId())
  const adapter = new SoloEngineDbAdapter(table)

  let registration: AdapterRegistrationHandle | undefined
  let applied = ''
  let lastError: unknown

  /** 一次同步：行事实变化即原子替换整份路由集合。 */
  const sync = (): void => {
    let snapshot: RouteSnapshot
    try {
      snapshot = table.reload()
      lastError = undefined
    } catch (error: unknown) {
      lastError = error
      ctx.logger.error('soloengine-llm-db-adapter: reading llm_configs failed; keeping the current route set')
      ctx.logger.error(error)
      return
    }
    const routes = snapshot.routes.map(entry => entry.route)
    const skipped = snapshot.skipped.map(entry => `${entry.id}(${entry.name}): ${entry.reason}`).join('; ')
    // 行事实未变即不做任何注册动作（也不重复打印）。
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
      + `${skipped === '' ? '' : ` | rejected: ${skipped}`}`
    // 可取证行走 console：本 profile 未挂 logger-console，logger 输出不进启动日志。
    console.log(`soloengine: ${line}`)
  }

  ctx.effect(() => {
    sync()
    const timer = setInterval(sync, pollMs)
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
      ctx.logger.warn(`soloengine-llm-db-adapter: last sync failed: ${String(lastError)}`)
    }
  })
}
