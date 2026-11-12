/**
 * 云端节点运行时（W10.2/W10.4）：节点注册、心跳与负载上报、会话写租约。
 *
 * 控制面是独立进程；节点只经控制面 HTTP 交互（{@link RemoteControl}），不读控制面库、
 * 不进 cordis 插件树。租约按会话持有，心跳周期续约；续约失败即认为本节点已被围栏，
 * 该会话的后续请求被拒绝（写入侧另有 PG 后端的租约围栏兜底）。
 *
 * @module @soloengine/host/cloud-node
 */

import { randomUUID } from 'node:crypto'
import { cpus, freemem, loadavg, totalmem } from 'node:os'
import {
  AdmissionController,
  decideLifecycle,
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_LIFECYCLE_POLICY,
  HEARTBEAT_INTERVAL_MS,
  planEvictions,
  RemoteControl,
  type AdmissionResult,
  type LifecyclePolicy,
  type NodeControlApi,
  type NodeLoad,
  type QuotaPolicy,
  type SessionSnapshot,
  type SessionTier,
  type WorkspaceFileEntry,
} from '@soloengine/cloud-control'

/** 一次主机负载采样的输入（可注入，便于确定性测试）。 */
export interface HostLoadSample {
  /** 逻辑 CPU 数。 */
  cpuCount: number
  /** 1 分钟平均负载（Windows 恒为 0）。 */
  loadAverage: number
  /** 物理内存总量（字节）。 */
  totalMem: number
  /** 空闲内存（字节）。 */
  freeMem: number
}

/**
 * 把一次主机采样折算成控制面口径的负载百分比。
 *
 * 平均负载在 Windows 上恒为 0（系统不提供 load average）：此时**不报** `cpuPercent`，
 * 而不是报 0 假装空闲——放置器对缺失值按未知处理，比一个假的空闲值更接近事实。
 * @param sample - 主机采样。
 * @returns 可上报的百分比（无法计算的字段省略）。
 */
export function hostLoadSnapshot(sample: HostLoadSample): { cpuPercent?: number; memPercent?: number } {
  const { cpuCount, loadAverage, totalMem, freeMem } = sample
  const cpuPercent = cpuCount > 0 && loadAverage > 0
    ? Math.min(100, Math.round((loadAverage / cpuCount) * 100))
    : undefined
  const memPercent = totalMem > 0
    ? Math.min(100, Math.max(0, Math.round((1 - freeMem / totalMem) * 100)))
    : undefined
  return {
    ...cpuPercent === undefined ? {} : { cpuPercent },
    ...memPercent === undefined ? {} : { memPercent },
  }
}

/** 节点运行参数。 */
export interface CloudNodeOptions {
  /** 控制面地址。 */
  controlUrl: string
  /** 本节点标识（全局唯一）。 */
  nodeId: string
  /** 本节点对外入口（网关转发目标）。 */
  endpoint: string
  /** 区域/可用区。 */
  region: string
  /** 并发会话上限。 */
  maxSessions: number
  /** 自定义标签。 */
  labels: Record<string, string>
  /** 节点本地每用户配额（硬上限 + 突发桶 + 公平份额）；省略时只做容量准入。 */
  quota?: QuotaPolicy
  /** 空闲暂停阈值（毫秒）；省略时按部署策略（W10.11 默认 15 分钟）。 */
  idlePauseMs?: number
  /** 空闲驱逐阈值（毫秒）；省略或 0 表示不驱逐（W10.11 默认 30 分钟由调用方给出）。 */
  idleEvictMs?: number
  /** 会话 TTL（毫秒）；省略时按部署策略（W10.11 默认 7 天）。 */
  sessionTtlMs?: number
  /**
   * 会话档位判定（QoS 阶梯，由平台策略决定、用户不可自选）。
   * 省略时全部按交互型处理——后台型会话最后才被驱逐。
   */
  tierOf?: (sessionKey: string) => SessionTier
  /** 当前活跃会话数（心跳上报）。 */
  liveSessions: () => number
  /** 主机负载采样（默认读 `node:os`；确定性测试可注入）。 */
  loadMetrics?: () => { cpuPercent?: number; memPercent?: number }
  /** 毫秒时钟（默认 `Date.now`；确定性测试可注入）。 */
  now?: () => number
  /** 诊断输出。 */
  log: (message: string) => void
}

/** 租约失败：会话由其他节点持有、本节点已失去写租约，或用户并发配额已满。 */
export class CloudLeaseError extends Error {
  /**
   * @param sessionKey - 会话键。
   * @param code - 稳定错误码（`QUOTA_EXCEEDED` 映射 429）。
   * @param message - 可读原因。
   */
  constructor(readonly sessionKey: string, readonly code: 'LEASE_HELD' | 'QUOTA_EXCEEDED', message: string) {
    super(message)
    this.name = 'CloudLeaseError'
  }
}

/** 一个云节点的控制面参与面：注册、心跳、租约。 */
export class CloudNodeRuntime {
  /** 本节点标识（与控制面注册一致）。 */
  readonly nodeId: string

  private readonly control: NodeControlApi
  private readonly holder: string
  private readonly leases = new Map<string, number>()
  /** 会话 → 归属用户（准入计数的释放依据）。 */
  private readonly sessionUsers = new Map<string, string>()
  /** 会话 → 最近活跃时间（毫秒；空闲暂停/驱逐依据）。 */
  private readonly activity = new Map<string, number>()
  /** 会话 → 创建时间（毫秒；TTL 依据）。 */
  private readonly createdAt = new Map<string, number>()
  /** 已暂停的会话：agent 已断开、租约仍保留；下一条提示在同一节点冷恢复。 */
  private readonly paused = new Set<string>()
  private readonly admission = new AdmissionController()
  private readonly now: () => number
  private evictor: ((sessionKey: string) => Promise<boolean>) | undefined
  private pauser: ((sessionKey: string) => Promise<boolean>) | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private registered = false

  /**
   * @param options - 节点参数。
   * @param control - 控制面客户端（测试可注入进程内实现）。
   */
  constructor(
    private readonly options: CloudNodeOptions,
    control?: NodeControlApi,
  ) {
    this.nodeId = options.nodeId
    this.control = control ?? new RemoteControl(options.controlUrl)
    this.holder = `${options.nodeId}/${randomUUID()}`
    this.now = options.now ?? Date.now
    // 节点本地准入的容量口径 = 本节点声明的并发会话上限（W10.3 节点最终裁决）。
    this.admission.setClusterCapacity(options.maxSessions)
  }

  /** 注册节点并开启心跳；注册失败只记录，下一次心跳重试。 */
  async start(): Promise<void> {
    await this.register()
    this.timer = setInterval(() => { void this.beat() }, HEARTBEAT_INTERVAL_MS)
    this.timer.unref()
    const policy = this.lifecyclePolicy()
    if (Number.isFinite(policy.pauseAfterIdleMs) || Number.isFinite(policy.evictAfterIdleMs)
      || Number.isFinite(policy.ttlMs)) {
      const shortest = Math.min(policy.pauseAfterIdleMs, policy.evictAfterIdleMs, policy.ttlMs)
      const period = Math.max(1_000, Math.min(60_000, Math.floor(shortest / 4)))
      this.sweepTimer = setInterval(() => { void this.sweep() }, period)
      this.sweepTimer.unref()
    }
  }

  /**
   * 节点本地准入（W10.3/W10.10）：容量满或用户配额超限即拒绝，429/503 可区分。
   * @param sessionKey - 会话键。
   * @param userId - 归属用户。
   * @returns 准入结果。
   */
  admit(sessionKey: string, userId: string): AdmissionResult {
    if (this.leases.has(sessionKey)) {
      this.sessionUsers.set(sessionKey, userId)
      return { ok: true, remainingBurst: 0 }
    }
    const quota = this.options.quota
    if (quota === undefined) {
      // 无配额时仍登记归属与活跃时间：计量与空闲驱逐都不依赖配额是否开启。
      this.sessionUsers.set(sessionKey, userId)
      this.activity.set(sessionKey, this.now())
      this.createdAt.set(sessionKey, this.now())
      return { ok: true, remainingBurst: 0 }
    }
    this.admission.configure(userId, quota)
    const result = this.admission.admit(userId)
    if (result.ok) {
      this.sessionUsers.set(sessionKey, userId)
      this.activity.set(sessionKey, this.now())
      this.createdAt.set(sessionKey, this.now())
    }
    return result
  }

  /**
   * 上报一次 provider 口径的计量（W10.10）：token 数只取 provider 上报值，不自行估算。
   *
   * 会话尚未登记归属时返回 false（不猜用户）；控制面不可达时记录并返回 false，
   * 不阻塞回合。
   * @param sessionKey - 会话键。
   * @param tokens - provider 上报的 token 数。
   * @param sourceSeq - 产生该用量的会话事件序号（控制面按它去重）。
   * @returns 是否已交给控制面。
   */
  async reportUsage(sessionKey: string, tokens: number, sourceSeq?: number): Promise<boolean> {
    const userId = this.sessionUsers.get(sessionKey)
    if (userId === undefined) return false
    const report = {
      userId,
      sessionKey,
      tokens,
      reportedAt: new Date(this.now()).toISOString(),
      ...sourceSeq === undefined ? {} : { sourceSeq },
    }
    this.admission.reportUsage(report)
    try {
      await this.control.reportUsage(report)
      return true
    } catch (error: unknown) {
      this.options.log(`soloengine: reporting usage for session ${sessionKey} failed: ${String(error)}`)
      return false
    }
  }

  /**
   * 保存会话工作区清单（W10.12）：清单进控制面共享库，对象数据进对象存储。
   * @param sessionKey - 根会话键。
   * @param files - 清单条目。
   */
  async saveWorkspaceManifest(sessionKey: string, files: readonly WorkspaceFileEntry[]): Promise<void> {
    await this.control.putWorkspaceManifest(sessionKey, files)
  }

  /**
   * 读会话工作区清单。
   * @param sessionKey - 根会话键。
   * @returns 清单条目；从未提交过时为空数组。
   */
  async workspaceManifest(sessionKey: string): Promise<WorkspaceFileEntry[]> {
    return await this.control.getWorkspaceManifest(sessionKey)
  }

  /**
   * 记录会话最近活跃时间（`session/event` 到达时调用）。
   * @param sessionKey - 会话键。
   * @param at - 事件时间（毫秒）。
   */
  noteActivity(sessionKey: string, at: number): void {
    if (this.activity.has(sessionKey)) {
      this.activity.set(sessionKey, at)
      // 新事件意味着会话已经冷恢复：暂停标记失效，下一次空闲可再次暂停。
      this.paused.delete(sessionKey)
    }
  }

  /**
   * 设置暂停回调（断开 agent 句柄但**保留租约**；容器由宿主暂停）。
   * @param pauser - 返回是否真的断开了一个活会话。
   */
  setPauser(pauser: (sessionKey: string) => Promise<boolean>): void {
    this.pauser = pauser
  }

  /**
   * 该会话是否处于「已暂停、租约仍保留」状态（宿主据此跳过租约释放）。
   * @param sessionKey - 会话键。
   * @returns 已暂停时为 true。
   */
  isPaused(sessionKey: string): boolean {
    return this.paused.has(sessionKey)
  }

  /**
   * 设置驱逐回调（宿主断开 agent 句柄）；未设置时不做空闲驱逐。
   * @param evictor - 返回是否真的驱逐了一个活会话。
   */
  setEvictor(evictor: (sessionKey: string) => Promise<boolean>): void {
    this.evictor = evictor
  }

  /**
   * 取得（或认领）会话写租约。
   * @param sessionKey - 会话键。
   * @returns 本节点持有的写者纪元。
   */
  async acquire(sessionKey: string): Promise<number> {
    const held = this.leases.get(sessionKey)
    if (held !== undefined) return held
    // 归属用户随租约落到共享库：控制面的跨节点配额闸门按未过期租约统计活跃会话（W10.10）。
    const userId = this.sessionUsers.get(sessionKey)
    const result = await this.control.acquireLease({
      sessionKey,
      nodeId: this.options.nodeId,
      holder: this.holder,
      ttlMs: DEFAULT_LEASE_TTL_MS,
      ...(userId === undefined ? {} : { userId }),
    })
    if (result.ok) {
      this.leases.set(sessionKey, result.lease.epoch)
      this.options.log(
        `soloengine: session ${sessionKey} leased to node ${this.options.nodeId} (epoch ${String(result.lease.epoch)})`,
      )
      return result.lease.epoch
    }
    if (result.code === 'QUOTA_EXCEEDED') {
      // 跨节点配额在租约获取处拒绝：调用方（运行启动）把它映射成 429，不占节点准入计数。
      throw new CloudLeaseError(
        sessionKey,
        'QUOTA_EXCEEDED',
        `user ${userId ?? 'unknown'} is at the concurrent session quota; node ${this.options.nodeId} refused the lease`,
      )
    }
    if (result.lease.nodeId === this.options.nodeId) {
      // 故障接管把租约记在本节点名下；认领为真实持有者，epoch 不变。
      const adopted = await this.control.adoptLease({
        sessionKey,
        nodeId: this.options.nodeId,
        holder: this.holder,
        ttlMs: DEFAULT_LEASE_TTL_MS,
      })
      if (adopted !== undefined) {
        this.leases.set(sessionKey, adopted.epoch)
        this.options.log(
          `soloengine: adopted reclaimed lease for session ${sessionKey} (epoch ${String(adopted.epoch)})`,
        )
        return adopted.epoch
      }
    }
    throw new CloudLeaseError(
      sessionKey,
      'LEASE_HELD',
      `session ${sessionKey} is leased by node ${result.lease.nodeId}; this node cannot write it`,
    )
  }

  /**
   * 本节点是否仍持有该会话的写租约。
   * @param sessionKey - 会话键。
   * @returns 持有（且心跳续约未失败）时为 true。
   */
  holds(sessionKey: string): boolean {
    return this.leases.has(sessionKey)
  }

  /**
   * 该会话当前是否由**任一**节点持有未过期的租约（启动对账用）。
   *
   * 云形态的台账由多节点共享：一个节点重启时，本进程的 `live()` 看不到另一节点上仍在跑的
   * 会话。对账必须问控制面的租约真相，否则会把别人的运行改写成失败。
   * @param sessionKey - 会话键。
   * @returns 存在未过期租约时为 true。
   */
  async leaseLive(sessionKey: string): Promise<boolean> {
    const lease = await this.control.getLease(sessionKey)
    if (lease === undefined) return false
    return Date.parse(lease.expiresAt) > Date.now()
  }

  /**
   * 主动释放会话写租约，并归还准入计数（会话结束/被驱逐时调用）。
   * @param sessionKey - 会话键。
   */
  async release(sessionKey: string): Promise<void> {
    const userId = this.sessionUsers.get(sessionKey)
    if (userId !== undefined) {
      this.sessionUsers.delete(sessionKey)
      this.admission.release(userId)
    }
    this.activity.delete(sessionKey)
    this.createdAt.delete(sessionKey)
    this.paused.delete(sessionKey)
    const epoch = this.leases.get(sessionKey)
    if (epoch === undefined) return
    this.leases.delete(sessionKey)
    try {
      await this.control.releaseLease({ sessionKey, holder: this.holder, epoch })
    } catch (error: unknown) {
      this.options.log(`soloengine: releasing lease for session ${sessionKey} failed: ${String(error)}`)
    }
  }

  /**
   * 生命周期策略（W10.11）：未配置任何阈值时全部关闭（本地/未启用驱逐的节点不动作）；
   * 配置了任一阈值时，其余阈值取 Plan 的默认值（暂停 15 分钟、驱逐 30 分钟、TTL 7 天）。
   * @returns 生命周期策略。
   */
  private lifecyclePolicy(): LifecyclePolicy {
    const { idlePauseMs, idleEvictMs, sessionTtlMs } = this.options
    if (idlePauseMs === undefined && idleEvictMs === undefined && sessionTtlMs === undefined) {
      return {
        pauseAfterIdleMs: Number.POSITIVE_INFINITY,
        evictAfterIdleMs: Number.POSITIVE_INFINITY,
        ttlMs: Number.POSITIVE_INFINITY,
      }
    }
    return {
      pauseAfterIdleMs: idlePauseMs ?? DEFAULT_LIFECYCLE_POLICY.pauseAfterIdleMs,
      evictAfterIdleMs: idleEvictMs ?? DEFAULT_LIFECYCLE_POLICY.evictAfterIdleMs,
      ttlMs: sessionTtlMs ?? DEFAULT_LIFECYCLE_POLICY.ttlMs,
    }
  }

  /**
   * 运行一次生命周期扫描（空闲暂停/驱逐 + TTL）。定时器与测试共用这一个入口。
   */
  async sweep(): Promise<void> {
    const policy = this.lifecyclePolicy()
    const now = this.now()
    const snapshots: SessionSnapshot[] = [...this.activity].map(([sessionKey, lastActiveAtMs]) => ({
      sessionKey,
      tier: this.options.tierOf?.(sessionKey) ?? 'interactive',
      state: 'running',
      lastActiveAtMs,
      createdAtMs: this.createdAt.get(sessionKey) ?? lastActiveAtMs,
      backend: 'container',
    }))

    // 暂停：仍在驱逐/TTL 阈值内的空闲会话先断开 agent，租约保留 → 下一条提示同节点冷恢复。
    const pauser = this.pauser
    if (pauser !== undefined) {
      for (const snapshot of snapshots) {
        if (this.paused.has(snapshot.sessionKey)) continue
        if (decideLifecycle(snapshot, now, policy).kind !== 'pause') continue
        try {
          // 先标记再断开：`session/disposed` 监听据此跳过租约释放。
          this.paused.add(snapshot.sessionKey)
          const paused = await pauser(snapshot.sessionKey)
          this.options.log(paused
            ? `soloengine: paused idle session ${snapshot.sessionKey} after ${String(now - snapshot.lastActiveAtMs)} ms (W10.11)`
            : `soloengine: idle session ${snapshot.sessionKey} had no live agent to pause`)
        } catch (error: unknown) {
          this.paused.delete(snapshot.sessionKey)
          this.options.log(`soloengine: pausing idle session ${snapshot.sessionKey} failed: ${String(error)}`)
        }
      }
    }

    // 驱逐：先后台、后交互（同档最久不活跃优先）；释放租约与准入计数。
    const evictor = this.evictor
    if (evictor === undefined) return
    for (const { sessionKey, reason } of planEvictions(snapshots, now, policy)) {
      try {
        // 已暂停的会话没有活句柄，`evictor` 会返回 false。**不能**因此跳过释放：
        // 租约、准入计数与配额都还挂在这个会话上，跳过会让它们永久泄漏（后续运行 429/503）。
        const hadLiveAgent = await evictor(sessionKey)
        this.options.log(hadLiveAgent
          ? `soloengine: evicted idle session ${sessionKey} after ${String(now - (this.activity.get(sessionKey) ?? now))} ms (W10.11, ${reason})`
          : `soloengine: evicted paused session ${sessionKey} (no live agent) after ${String(now - (this.activity.get(sessionKey) ?? now))} ms (W10.11, ${reason}); releasing its lease`)
        await this.release(sessionKey)
      } catch (error: unknown) {
        this.options.log(`soloengine: evicting idle session ${sessionKey} failed: ${String(error)}`)
      }
    }
  }

  /** 停止心跳、空闲清扫并释放全部租约。 */
  async stop(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = undefined
    }
    for (const sessionKey of [...this.leases.keys()]) await this.release(sessionKey)
  }

  private async register(): Promise<void> {
    try {
      await this.control.register({
        nodeId: this.options.nodeId,
        endpoint: this.options.endpoint,
        region: this.options.region,
        maxSessions: this.options.maxSessions,
        labels: this.options.labels,
      })
      this.registered = true
      this.options.log(
        `soloengine: cloud node ${this.options.nodeId} registered (${this.options.endpoint}, region=${this.options.region},`
        + ` maxSessions=${String(this.options.maxSessions)})`,
      )
    } catch (error: unknown) {
      this.options.log(
        `soloengine: cloud node ${this.options.nodeId} registration failed: ${String(error)}; retrying on heartbeat`,
      )
    }
  }

  /**
   * 当前活跃会话数：优先取宿主提供的实时值。
   *
   * 节点启动早期 harness 侧的 `agents` 服务可能尚未就位（profile 仍在装载），此时
   * 读取会抛错。心跳与租约续期不能被这一个读数拖垮——退化为本节点持有的租约数，
   * 它同样是「本节点活跃会话」的准确口径。
   * @returns 活跃会话数。
   */
  private activeSessions(): number {
    try {
      return this.options.liveSessions()
    } catch (_agentsNotMountedYet) {
      return this.leases.size
    }
  }

  /**
   * 立即上报一次心跳（运维探针与测试用；生产路径由 `start()` 的定时器调用）。
   * @returns 本次心跳完成后兑现的 Promise。
   */
  async beatNow(): Promise<void> {
    await this.beat()
  }

  /** 本节点当前负载：活跃会话数 + 主机 CPU/内存百分比（无法计算的字段不报）。 */
  private loadOf(): NodeLoad {
    const metrics = this.options.loadMetrics?.() ?? hostLoadSnapshot({
      cpuCount: cpus().length,
      loadAverage: loadavg()[0] ?? 0,
      totalMem: totalmem(),
      freeMem: freemem(),
    })
    return { activeSessions: this.activeSessions(), ...metrics }
  }

  private async beat(): Promise<void> {
    if (!this.registered) await this.register()
    try {
      const node = await this.control.heartbeat(this.options.nodeId, this.loadOf())
      if (node === undefined) {
        this.registered = false
        await this.register()
      }
    } catch (error: unknown) {
      this.options.log(`soloengine: heartbeat for node ${this.options.nodeId} failed: ${String(error)}`)
    }
    for (const [sessionKey, epoch] of [...this.leases]) {
      try {
        if (await this.control.renewLease({ sessionKey, holder: this.holder, epoch })) continue
        this.leases.delete(sessionKey)
        this.options.log(
          `soloengine: write lease for session ${sessionKey} (epoch ${String(epoch)}) is no longer held;`
          + ' this node refuses further prompts for it',
        )
      } catch (error: unknown) {
        this.options.log(`soloengine: renewing lease for session ${sessionKey} failed: ${String(error)}`)
      }
    }
  }
}
