/**
 * SoloEngine 多 harness 实例装配层（PRD-01 §实例隔离；Plan W2）。
 *
 * 一个 `agenticflow` 对应一份派生实例：实例拥有独立的作用域键与一棵可装卸的
 * 插件树，插件在该作用域内注册的工具、技能、系统提示词、MCP 资源等按
 * `ScopedLayers` 分层——最近作用域影子化全局，因此实例之间互不影响，基线
 * 全局注册保持原样。实例的装载与卸载都是 Cordis 的 effect/fiber 级联：
 * `dispose()` 撤销该实例造成的全部注册，不触碰基线。
 *
 * 复用边界：作用域（`createScope`/`bindScopeParent`）、运行时插件树
 * （`EntryTree` + `prepareProfileEntries`）与行审计（`auditRows`）来自 DSH
 * 原件；本包只做「按 flow 持有、引用计数、生命周期编排」这一层薄装配，
 * 不复制平台机制。
 *
 * 装配层的所有者上下文必须注入 `loader`（与 `AgentPresetRegistry` 的契约
 * 相同）：DSH 的条目树经 `ctx.loader` 导入模块，未注入的上下文会让条目
 * 静默落空。
 *
 * @module @soloengine/instance-runtime
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import { EntryTree, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { prepareProfileEntries } from '@deepseek-ai/dsh-app-boot'
import { auditRows } from '@deepseek-ai/dsh-agent-preset-registry'
import { bindScopeParent, createScope, scopeOf, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'

/**
 * 内存插件树：条目来自内存声明，不写回 profile 配置。
 *
 * 不复用 `agent-preset-registry` 的同形类：那是包内私有实现，发布版没有该导出；
 * 产物必须能在任意 rc.2 运行器上装载，不能依赖我们新增的上游导出。
 */
class InstanceEntryTree extends EntryTree {
  /**
   * @param ctx - 实例作用域上下文。
   */
  constructor(ctx: Context) {
    const owner = ctx.fiber.entry
    const subtree = owner?.subtree
    const subgroup = owner?.subgroup
    super(ctx)
    if (owner !== undefined) {
      if (subtree === undefined) delete owner.subtree
      else owner.subtree = subtree
      if (subgroup === undefined) delete owner.subgroup
      else owner.subgroup = subgroup
    }
  }

  /** 内存树不持久化任何配置。 */
  override write(): void {}
}

/** 一份 flow 实例的可见表面。 */
export interface FlowInstance {
  /** 所属 agenticflow 标识。 */
  readonly flowId: string
  /** 作用域键；agent 作用域绑定到它之后继承本实例的分层注册。 */
  readonly key: ScopeKey
  /** 实例作用域上下文；程序化插件从这里装载。 */
  readonly ctx: Context
  /** 已装载的插件树（未装载时为 undefined）。 */
  readonly tree: EntryTree | undefined
  /**
   * 让本实例替换一组基线服务：每个名字在实例内解析到本 flow 独立的 label，
   * 实例内 `provide` 不再与基线或其他实例撞名，未列出的服务照旧继承基线。
   *
   * 必须在任何插件装载到 {@link ctx} 之前调用（宿主在建 agent 之前统一调用）；
   * 装载后再隔离会让已激活的插件仍读基线实现，故按顺序错误 fail loud。
   * @param names - 本实例要替换的服务名。
   */
  isolate(names: readonly string[]): void
  /**
   * 以标准 Cordis 插件装载一份实例内插件；生命周期归实例作用域。
   * @param plugin - Cordis 插件。
   * @param config - 插件配置。
   * @returns 激活完成的插件 fiber。
   */
  mount(plugin: Parameters<Context['plugin']>[0], config?: unknown): Promise<Fiber>
  /**
   * 按 Loader 条目声明装载实例插件树（W3 的画布差异经此进入）。
   * @param entries - Cordis Loader 条目列表。
   * @returns 装载完成后的树。
   */
  mountEntries(entries: readonly EntryOptions[]): Promise<EntryTree>
  /**
   * 按 Loader 条目声明把节点级插件装进一个 agent 作用域。
   *
   * 节点级插件只作用于该 agent：工具、技能、MCP、提示词之外的行为按节点选，
   * 与流程级插件（全流程一份）分层共存；随 agent 作用域撤销。
   * @param agentCtx - agent setup 回调收到的作用域上下文。
   * @param entries - 该节点的插件行。
   * @returns 装载完成后的树。
   */
  mountAgentEntries(agentCtx: Context, entries: readonly EntryOptions[]): Promise<EntryTree>
  /**
   * 把 agent 作用域挂到本实例作用域之下；agent 由此继承实例分层。
   * @param agentCtx - agent setup 回调收到的作用域上下文。
   */
  bind(agentCtx: Context): void
  /** 卸载实例：停止插件树并撤销作用域内全部注册。 */
  dispose(): Promise<void>
}

/** 实例运行时选项。 */
export interface FlowRuntimeOptions {
  /** 插件条目解析基准；默认沿用所有者上下文的 baseUrl。 */
  readonly baseUrl?: string
}

interface Record {
  readonly instance: FlowInstance
  readonly signature: string
  users: number
  disposing?: Promise<void>
}

/**
 * 按 flow 持有实例的装配层。
 *
 * 引用计数让同一 flow 的并发运行共享一份实例；最后一个持有者释放时卸载，
 * 从而保证「进入装载、切出卸载恢复」。实例创建失败不留下半棵树。
 */
export class FlowInstanceRuntime {
  private readonly records = new Map<string, Record>()
  private disposed = false

  /**
   * @param owner - 装配层挂载的上下文；实例作用域从这里派生。
   * @param options - 条目解析基准。
   */
  constructor(
    private readonly owner: Context,
    private readonly options: FlowRuntimeOptions = {},
  ) {
    owner.effect(() => async () => { await this.dispose() }, 'soloengine.flow-runtime')
  }

  /**
   * 获取或创建一份 flow 实例，并增加一个持有者。
   * @param flowId - agenticflow 标识。
   * @param signature - 组合签名；同一 flow 的并发持有者必须给出相同签名。
   * @returns 共享的实例。
   */
  acquire(flowId: string, signature = ''): FlowInstance {
    if (this.disposed) throw new Error('soloengine: flow instance runtime is disposed')
    const existing = this.records.get(flowId)
    if (existing !== undefined) {
      if (existing.signature !== signature) {
        throw new Error(`soloengine: flow ${flowId} is already mounted with a different composition`)
      }
      existing.users += 1
      return existing.instance
    }
    const scope = createScope(this.owner, { flowId })
    const instance = new Instance(flowId, scope, this.options.baseUrl ?? this.owner.baseUrl)
    const record: Record = { instance, signature, users: 1 }
    this.records.set(flowId, record)
    return instance
  }

  /**
   * 释放一个持有者；最后一个持有者释放时卸载实例。
   * @param flowId - agenticflow 标识。
   * @returns 卸载完成（仍有其他持有者时立即返回）。
   */
  async release(flowId: string): Promise<void> {
    const record = this.records.get(flowId)
    if (record === undefined) return
    record.users -= 1
    if (record.users > 0) return
    this.records.delete(flowId)
    record.disposing ??= record.instance.dispose()
    await record.disposing
  }

  /**
   * 读取当前存活的实例（诊断用）。
   * @param flowId - agenticflow 标识。
   * @returns 实例，或未装载时的 undefined。
   */
  get(flowId: string): FlowInstance | undefined {
    return this.records.get(flowId)?.instance
  }

  /**
   * 卸载全部实例；装配层自身卸载时调用。
   * @returns 全部卸载完成。
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const records = [...this.records.values()]
    this.records.clear()
    await Promise.all(records.map(async (record) => {
      record.disposing ??= record.instance.dispose()
      await record.disposing
    }))
  }
}

/** 单份实例的实现；只由 {@link FlowInstanceRuntime.acquire} 创建。 */
class Instance implements FlowInstance {
  readonly key: ScopeKey
  private current: Context
  /** 本实例的隔离 label；同一实例的多个服务名共用它，不同实例互不相同。 */
  private readonly isolateLabel: symbol
  private readonly isolated = new Set<string>()
  private readonly bound = new WeakSet<ScopeKey>()
  private mountedTree: InstanceEntryTree | undefined
  private touched = false
  private disposed = false

  constructor(
    readonly flowId: string,
    private readonly scope: Scope,
    private readonly baseUrl: string | undefined,
  ) {
    this.key = scopeOf(scope.ctx) as ScopeKey
    this.current = scope.ctx
    this.isolateLabel = Symbol(`soloengine.flow:${flowId}`)
  }

  get ctx(): Context {
    return this.current
  }

  get tree(): InstanceEntryTree | undefined {
    return this.mountedTree
  }

  isolate(names: readonly string[]): void {
    if (this.disposed) throw new Error(`soloengine: flow ${this.flowId} is disposed`)
    if (this.touched) {
      throw new Error(`soloengine: flow ${this.flowId} must isolate services before mounting any plugin`)
    }
    for (const name of names) {
      if (name.trim() === '') throw new Error('soloengine: isolate service names must be non-empty')
      if (this.isolated.has(name)) continue
      this.current = this.current.isolate(name, this.isolateLabel)
      this.isolated.add(name)
    }
  }

  async mount(plugin: Parameters<Context['plugin']>[0], config?: unknown): Promise<Fiber> {
    if (this.disposed) throw new Error(`soloengine: flow ${this.flowId} is disposed`)
    this.touched = true
    const fiber = this.current.plugin(plugin, config)
    await fiber.await()
    return fiber
  }

  async mountEntries(entries: readonly EntryOptions[]): Promise<EntryTree> {
    if (this.disposed) throw new Error(`soloengine: flow ${this.flowId} is disposed`)
    this.touched = true
    if (this.mountedTree !== undefined) throw new Error(`soloengine: flow ${this.flowId} already mounted an entry tree`)
    await this.current.fiber.await()
    const tree = new InstanceEntryTree(this.current)
    this.current.effect(() => () => { tree.root.stop() }, 'soloengine.flow-tree')
    try {
      await tree.root.update(prepareProfileEntries(this.current, entries, this.baseUrl))
      const audit = await auditRows(tree)
      if (audit.failed.length > 0) {
        throw new Error(`soloengine: flow ${this.flowId} failed to mount:\n${audit.failed.join('\n')}`)
      }
    } catch (error) {
      tree.root.stop()
      throw error
    }
    this.mountedTree = tree
    return tree
  }

  async mountAgentEntries(agentCtx: Context, entries: readonly EntryOptions[]): Promise<EntryTree> {
    if (this.disposed) throw new Error(`soloengine: flow ${this.flowId} is disposed`)
    this.touched = true
    if (entries.length === 0) throw new Error('soloengine: mountAgentEntries needs at least one entry')
    await agentCtx.fiber.await()
    const tree = new InstanceEntryTree(agentCtx)
    agentCtx.effect(() => () => { tree.root.stop() }, 'soloengine.agent-tree')
    try {
      await tree.root.update(prepareProfileEntries(agentCtx, entries, this.baseUrl))
      const audit = await auditRows(tree)
      if (audit.failed.length > 0) {
        throw new Error(`soloengine: flow ${this.flowId} failed to mount node plugins:\n${audit.failed.join('\n')}`)
      }
    } catch (error) {
      tree.root.stop()
      throw error
    }
    return tree
  }

  bind(agentCtx: Context): void {
    if (this.disposed) throw new Error(`soloengine: flow ${this.flowId} is disposed`)
    const key = scopeOf(agentCtx)
    if (key === undefined) throw new Error('soloengine: agent context carries no scope key')
    if (this.bound.has(key)) return
    bindScopeParent(key, this.key)
    this.bound.add(key)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.mountedTree?.root.stop()
    await this.scope.dispose()
  }
}
