/**
 * 控制面服务（W10.2~W10.4 的组合面）：注册表、放置、租约。
 *
 * 这是控制面进程内的唯一入口对象；HTTP 层与 CLI 只做协议转换，不复制业务规则。
 * 仓储可以是 SQLite（单机）或 PostgreSQL（多节点共享库），本层不感知差异。
 *
 * @module @soloengine/cloud-control/service
 */

import {
  DEFAULT_LEASE_TTL_MS,
  type LeaseAcquireResult,
  type NodeLoad,
  type NodeState,
  type NodeView,
  type PlacementDecision,
  type PlacementRequest,
  type SessionLease,
  type WorkspaceFileEntry,
} from './contracts.ts'
import { placeSession } from './placement.ts'
import { planScale, type ScaleDecision, type ScalePolicy } from './elasticity.ts'
import { quotaGate, type PlacementQuota, type UsageAggregate, type UsageReport } from './quota.ts'
import type { ControlRepository } from './repository.ts'

/** 控制面依赖注入（时钟与随机源可替换，便于确定性测试）。 */
export interface ControlPlaneOptions {
  /** 当前时间。 */
  now?: () => Date
  /** 放置采样随机源。 */
  random?: () => number
  /** 每个用户的并发硬上限（W10.10）；省略时放置不做用户维度过滤。 */
  quota?: PlacementQuota
}

/** 节点注册入参。 */
export interface RegisterNodeInput {
  /** 节点标识。 */
  nodeId: string
  /** 对外入口。 */
  endpoint: string
  /** 区域。 */
  region: string
  /** 自定义标签。 */
  labels?: Record<string, string>
  /** 并发会话上限。 */
  maxSessions: number
}

/** 一次节点排空的结果。 */
export interface DrainResult {
  /** 被排空的节点。 */
  nodeId: string
  /** 会话迁往的目标节点；空串表示当前没有可用目标。 */
  targetNodeId: string
  /** 已迁出的会话键。 */
  moved: string[]
  /** CAS 失败（已被其他接管抢先）的会话键。 */
  skipped: string[]
  /** 迁移后仍留在该节点的租约数。 */
  remaining: number
  /** 排空结束后的节点状态。 */
  state: NodeState
}

/** 控制面服务。 */
export class ControlPlane {
  private readonly store: ControlRepository
  private readonly now: () => Date
  private readonly random: () => number
  private readonly quota: PlacementQuota | undefined

  /**
   * @param store - 控制面仓储（SQLite 或 PostgreSQL）。
   * @param options - 时钟、随机源与每用户配额策略。
   */
  constructor(store: ControlRepository, options: ControlPlaneOptions = {}) {
    this.store = store
    this.now = options.now ?? (() => new Date())
    this.random = options.random ?? Math.random
    this.quota = options.quota
  }

  /**
   * 注册或刷新节点。
   * @param input - 节点注册信息。
   * @returns 节点视图。
   */
  async register(input: RegisterNodeInput): Promise<NodeView> {
    await this.store.registerNode({
      nodeId: input.nodeId,
      endpoint: input.endpoint,
      region: input.region,
      labels: input.labels ?? {},
      maxSessions: input.maxSessions,
    })
    const node = await this.node(input.nodeId)
    if (node === undefined) throw new Error(`node ${input.nodeId} is missing after registration`)
    return node
  }

  /**
   * 记录心跳与负载。
   * @param nodeId - 节点标识。
   * @param load - 负载。
   * @returns 节点视图；节点未注册时为 undefined。
   */
  async heartbeat(nodeId: string, load: NodeLoad): Promise<NodeView | undefined> {
    return await this.store.heartbeat(nodeId, load, this.now()) ? this.node(nodeId) : undefined
  }

  /**
   * 切换节点状态（draining/down/active）。
   * @param nodeId - 节点标识。
   * @param state - 新状态。
   */
  async setState(nodeId: string, state: NodeState): Promise<void> {
    await this.store.setNodeState(nodeId, state)
  }

  /**
   * 全部节点视图。
   * @returns 节点视图列表。
   */
  async nodes(): Promise<NodeView[]> {
    return await this.store.listNodes(this.now())
  }

  /**
   * 读取单个节点视图。
   * @param nodeId - 节点标识。
   * @returns 节点视图或 undefined。
   */
  async node(nodeId: string): Promise<NodeView | undefined> {
    return (await this.nodes()).find(node => node.nodeId === nodeId)
  }

  /**
   * 放置一个会话并落审计（W10.10：带归属用户时先过跨节点配额闸门）。
   * @param request - 放置请求。
   * @returns 放置决策；配额拒绝时 `reason` 为 `quota-exceeded` 且 `nodeId` 为空串。
   */
  async place(request: PlacementRequest): Promise<PlacementDecision> {
    const nodes = await this.nodes()
    const decision = request.userId === undefined || this.quota === undefined
      ? placeSession(nodes, request, { now: this.now, random: this.random })
      : await this.admitPlacement(nodes, request, request.userId, this.quota)
    await this.store.recordPlacement(decision)
    return decision
  }

  /**
   * 跨节点配额闸门（W10.10 双闸门的第一道）：按共享租约统计该用户的活跃会话。
   *
   * 活跃口径 = 未过期租约：它跨节点、与节点本地准入同源，不读各节点进程内计数；
   * 节点本地准入仍是最终裁决（容量、镜像、沙箱只有节点自己知道）。
   * @param nodes - 节点视图。
   * @param request - 放置请求。
   * @param userId - 归属用户。
   * @param policy - 配额策略。
   * @returns 放置决策（配额不足时为 `quota-exceeded`）。
   */
  private async admitPlacement(
    nodes: NodeView[],
    request: PlacementRequest,
    userId: string,
    policy: PlacementQuota,
  ): Promise<PlacementDecision> {
    const startedAt = performance.now()
    const now = this.now()
    const active = await this.store.activeLeaseCount(userId, now)
    const activeUsers = await this.store.activeLeaseUsers(now)
    const clusterCapacity = nodes.filter(node => node.state === 'active')
      .reduce((sum, node) => sum + node.maxSessions, 0)
    const clusterActive = nodes.reduce((sum, node) => sum + node.load.activeSessions, 0)
    const gate = quotaGate({ policy, active, clusterCapacity, clusterActive, activeUsers })
    if (gate === 'ok') return placeSession(nodes, request, { now: this.now, random: this.random })
    return {
      sessionKey: request.sessionKey,
      nodeId: '',
      reason: 'quota-exceeded',
      candidates: [],
      latencyMs: performance.now() - startedAt,
      decidedAt: now.toISOString(),
    }
  }

  /**
   * 获取（或接管）会话租约。
   *
   * 带归属用户时先过跨节点配额闸门：会话创建无论从网关放置还是节点直连 `/runs`
   * 进入，都在取得写租约这一刻受同一份每用户并发上限约束；该会话已有未过期租约
   * （续约、或由其他节点持有）时不重复占名额，由仓储返回续约/LEASE_HELD 结论。
   * @param input - 会话键、节点、持有者、可选 TTL 与归属用户。
   * @returns 租约结果；配额不足时为 `QUOTA_EXCEEDED`（429）。
   */
  async acquireLease(input: {
    sessionKey: string
    nodeId: string
    holder: string
    ttlMs?: number
    userId?: string
  }): Promise<LeaseAcquireResult> {
    if (input.userId !== undefined && this.quota !== undefined) {
      const now = this.now()
      const existing = await this.lease(input.sessionKey)
      const activeLease = existing !== undefined && Date.parse(existing.expiresAt) > now.getTime()
      if (!activeLease) {
        const active = await this.store.activeLeaseCount(input.userId, now)
        // 集群容量与公平份额只在放置闸门判定；租约闸门只守每用户并发硬上限。
        const gate = quotaGate({
          policy: this.quota,
          active,
          clusterCapacity: 0,
          clusterActive: 0,
          activeUsers: 1,
        })
        if (gate !== 'ok') return { ok: false, code: 'QUOTA_EXCEEDED', lease: null }
      }
    }
    return await this.store.acquireLease({
      sessionKey: input.sessionKey,
      nodeId: input.nodeId,
      holder: input.holder,
      ttlMs: input.ttlMs ?? DEFAULT_LEASE_TTL_MS,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
    }, this.now())
  }

  /**
   * 认领本节点名下已被接管的租约（故障接管后的目标节点把自己设为真实写者）。
   * @param input - 会话键、本节点、新持有者与可选 TTL。
   * @returns 新租约；租约已归他人或已过期时为 undefined。
   */
  async adoptLease(input: {
    sessionKey: string
    nodeId: string
    holder: string
    ttlMs?: number
  }): Promise<SessionLease | undefined> {
    return await this.store.adoptLease({
      sessionKey: input.sessionKey,
      nodeId: input.nodeId,
      holder: input.holder,
      ttlMs: input.ttlMs ?? DEFAULT_LEASE_TTL_MS,
    }, this.now())
  }

  /**
   * 续约。
   * @param input - 会话键、持有者、epoch 与可选 TTL。
   * @returns 是否续约成功。
   */
  async renewLease(input: { sessionKey: string; holder: string; epoch: number; ttlMs?: number }): Promise<boolean> {
    return await this.store.renewLease(input.sessionKey, input.holder, input.epoch,
      input.ttlMs ?? DEFAULT_LEASE_TTL_MS, this.now())
  }

  /**
   * 释放租约。
   * @param input - 会话键、持有者、epoch。
   * @returns 是否释放成功。
   */
  async releaseLease(input: { sessionKey: string; holder: string; epoch: number }): Promise<boolean> {
    return await this.store.releaseLease(input.sessionKey, input.holder, input.epoch)
  }

  /**
   * 写围栏校验。
   * @param sessionKey - 会话键。
   * @param epoch - 写者纪元。
   * @returns 仍是当前写者时为 true。
   */
  async assertWriter(sessionKey: string, epoch: number): Promise<boolean> {
    return await this.store.assertWriter(sessionKey, epoch, this.now())
  }

  /**
   * 节点失联后的故障接管（W7）：把该节点持有的租约强制迁到目标节点。
   *
   * 每条租约按 epoch 做 CAS；并发接管同一会话时只有一个能赢，另一个进 `skipped`。
   * 旧写者不会收到通知，其下一次写入由 `assertWriter` 围栏拒绝（自降级）。
   *
   * @param nodeId - 失联节点。
   * @param targetNodeId - 接管节点。
   * @returns 已迁移与 CAS 失败（已被他人接管）的会话键。
   */
  async reclaim(nodeId: string, targetNodeId: string): Promise<{ moved: string[]; skipped: string[] }> {
    const leases = await this.store.listLeases(nodeId)
    const moved: string[] = []
    const skipped: string[] = []
    for (const lease of leases) {
      const next = await this.store.takeoverLease({
        sessionKey: lease.sessionKey,
        expectedEpoch: lease.epoch,
        nodeId: targetNodeId,
        holder: `${targetNodeId}/reclaim`,
        ttlMs: DEFAULT_LEASE_TTL_MS,
      }, this.now())
      if (next === undefined) skipped.push(lease.sessionKey)
      else moved.push(lease.sessionKey)
    }
    return { moved, skipped }
  }

  /**
   * 排空节点（W14）：停止新放置 → 把租约迁到目标节点 → 无剩余租约时下线。
   *
   * 迁移沿用 W7 的 epoch CAS（并发接管只有一个赢家）；目标省略时由放置器在其余
   * active 节点中挑选，节点本地准入仍是最终裁决。会话数据在控制面共享存储中，
   * 因此这里不搬文件，只搬租约归属。
   * @param nodeId - 待排空节点。
   * @param targetNodeId - 迁移目标；省略时自动选择。
   * @returns 排空结果；没有可用目标时 `targetNodeId` 为空串，节点保持 draining。
   */
  async drain(nodeId: string, targetNodeId?: string): Promise<DrainResult> {
    await this.setState(nodeId, 'draining')
    let target = targetNodeId
    if (target === undefined) {
      const decision = await this.place({ sessionKey: `drain:${nodeId}`, requiredLabels: {} })
      target = decision.nodeId === '' ? undefined : decision.nodeId
    }
    if (target === undefined) {
      return {
        nodeId,
        targetNodeId: '',
        moved: [],
        skipped: [],
        remaining: (await this.store.listLeases(nodeId)).length,
        state: 'draining',
      }
    }
    const { moved, skipped } = await this.reclaim(nodeId, target)
    const remaining = (await this.store.listLeases(nodeId)).length
    const state: NodeState = remaining === 0 ? 'down' : 'draining'
    await this.setState(nodeId, state)
    return { nodeId, targetNodeId: target, moved, skipped, remaining, state }
  }

  /**
   * 计算节点池扩容决策（只读；节点创建/回收由部署层执行）。
   * @param policy - 扩容策略。
   * @returns 扩容决策。
   */
  async scalePlan(policy: ScalePolicy): Promise<ScaleDecision> {
    return planScale(await this.nodes(), policy)
  }

  /**
   * 读会话租约。
   * @param sessionKey - 会话键。
   * @returns 租约或 undefined。
   */
  async lease(sessionKey: string): Promise<SessionLease | undefined> {
    return await this.store.getLease(sessionKey)
  }

  /**
   * 读会话审计事件。
   * @param sessionKey - 会话键。
   * @returns 事件列表。
   */
  async events(sessionKey: string): Promise<Awaited<ReturnType<ControlRepository['events']>>> {
    return await this.store.events(sessionKey)
  }

  /**
   * 记录一条 provider 口径的计量上报（W10.10）。
   *
   * 控制面只落库与聚合，不自行估算 token；`sourceSeq` 存在时按会话事件序号去重，
   * 重连或重放不会重复计费。
   * @param report - 上报记录。
   */
  async recordUsage(report: UsageReport): Promise<void> {
    await this.store.recordUsage(report)
  }

  /**
   * 读计量聚合（按用户 + 会话折叠）。
   * @param filter - 可选用户过滤。
   * @returns 聚合行。
   */
  async usage(filter: { userId?: string } = {}): Promise<UsageAggregate[]> {
    return await this.store.usage(filter)
  }

  /**
   * 保存会话工作区清单（W10.12：对象存储权威副本的索引）。
   * @param sessionKey - 会话键。
   * @param files - 清单条目。
   */
  async saveWorkspace(sessionKey: string, files: readonly WorkspaceFileEntry[]): Promise<void> {
    await this.store.putWorkspaceManifest(sessionKey, files, this.now())
  }

  /**
   * 读会话工作区清单。
   * @param sessionKey - 会话键。
   * @returns 清单条目；从未提交过时为空数组。
   */
  async workspace(sessionKey: string): Promise<WorkspaceFileEntry[]> {
    return await this.store.getWorkspaceManifest(sessionKey)
  }

  /**
   * 会话在节点上开始（节点本地准入通过后回报）。
   * @param nodeId - 节点标识。
   */
  async sessionStarted(nodeId: string): Promise<void> {
    await this.store.noteSessionStart(nodeId, this.now())
  }

  /**
   * 会话结束（节点回报）。
   * @param nodeId - 节点标识。
   */
  async sessionEnded(nodeId: string): Promise<void> {
    await this.store.noteSessionEnd(nodeId, this.now())
  }
}
