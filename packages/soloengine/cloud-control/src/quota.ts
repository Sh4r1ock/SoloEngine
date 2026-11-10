/**
 * 配额、计量与准入（W10.10）。
 *
 * 三条硬规则（Plan W10.10）：
 * - **硬上限**：每个用户同时活跃会话数不得超过 `maxActiveSessions`；
 * - **突发桶**：新会话创建受令牌桶约束（容量 + 每秒补充），超限返回 429；
 * - **超卖池加权公平份额**：集群进入超卖（活跃会话超过声明容量）时，超过公平份额的用户
 *   在准入处被拒（429），集群整体无容量时返回 503（两者可区分）。
 *
 * 计费口径 = provider 上报：本模块只记录 provider 上报的 token 数，不自行估算。
 * 状态归控制面单进程所有（W10.2 控制面是独立进程）；`onUsage` 是持久化缝，控制面把
 * 上报记录写入共享库，多副本网关读同一份计量视图。
 *
 * @module @soloengine/cloud-control/quota
 */

/** 一个用户的配额策略。 */
export interface QuotaPolicy {
  /** 硬上限：同时活跃会话数。 */
  maxActiveSessions: number
  /** 突发桶容量（窗口内允许的新会话创建数）。 */
  burstCapacity: number
  /** 突发桶补充速率（每秒令牌数）。 */
  refillPerSecond: number
}

/** 一次计量上报（provider 口径）。 */
export interface UsageReport {
  /** 用户标识。 */
  userId: string
  /** 会话键。 */
  sessionKey: string
  /** provider 上报的 token 数。 */
  tokens: number
  /** 上报时间（ISO 8601）。 */
  reportedAt: string
  /**
   * 产生该用量的会话事件序号（去重键）。
   *
   * 供应商的一次回复对应一条 `assistant/message`；同一序号重复上报（重连、重试重放）
   * 由控制面按 `(session_key, source_seq)` 去重，不重复计费。
   */
  sourceSeq?: number
}

/** 计量聚合（按用户 + 会话折叠；管理面查询口径）。 */
export interface UsageAggregate {
  /** 用户标识。 */
  userId: string
  /** 会话键。 */
  sessionKey: string
  /** provider 上报的 token 总数。 */
  tokens: number
  /** 上报条数。 */
  reports: number
  /** 最近一条上报时间（ISO 8601）。 */
  lastReportedAt: string
}

/** 准入结果。 */
export type AdmissionResult =
  | { ok: true; remainingBurst: number }
  /** 429：用户配额或突发桶超限。 */
  | { ok: false; code: 'QUOTA_EXCEEDED'; reason: 'HARD_LIMIT' | 'BURST' | 'FAIR_SHARE'; retryAfterSeconds: number }
  /** 503：集群整体无容量。 */
  | { ok: false; code: 'OVERLOADED'; retryAfterSeconds: number }

/** 用户级配额闸门的判定结果（硬上限与超卖池公平份额）。 */
export type QuotaGate = 'ok' | 'HARD_LIMIT' | 'FAIR_SHARE'

/** 放置闸门消费的配额面：跨节点只需要并发硬上限（突发桶只在节点本地生效）。 */
export type PlacementQuota = Pick<QuotaPolicy, 'maxActiveSessions'>

/**
 * 用户级配额闸门：先判硬上限，再判超卖池加权公平份额。
 *
 * 节点本地准入与控制面放置闸门共用这一份判定（W10.10 双闸门），避免两层各写一套阈值。
 * 突发桶不在此处：它只在节点本地对「新建会话速率」生效。
 * @param input - 策略、该用户活跃会话数、集群容量与活跃会话数、有活跃会话的用户数。
 * @returns `ok` 可继续准入；`HARD_LIMIT` 触达并发硬上限；`FAIR_SHARE` 超卖池里超出公平份额。
 */
export function quotaGate(input: {
  policy: PlacementQuota
  active: number
  clusterCapacity: number
  clusterActive: number
  activeUsers: number
}): QuotaGate {
  if (input.active >= input.policy.maxActiveSessions) return 'HARD_LIMIT'
  if (input.clusterCapacity > 0 && input.clusterActive >= input.clusterCapacity * 0.9) {
    const share = Math.max(1, Math.floor(input.clusterCapacity / Math.max(1, input.activeUsers)))
    if (input.active >= share) return 'FAIR_SHARE'
  }
  return 'ok'
}

/** 一个用户的运行态。 */
interface UserState {
  policy: QuotaPolicy
  active: number
  tokens: number
  updatedAtMs: number
  usage: number
}

/** 准入控制器（控制面单进程持有；时钟可注入以便确定性测试）。 */
export class AdmissionController {
  private readonly users = new Map<string, UserState>()
  private readonly now: () => number
  private readonly onUsage: (report: UsageReport) => void
  private clusterCapacity = 0
  private clusterActive = 0

  /**
   * @param options.now - 毫秒时钟（默认 Date.now）。
   * @param options.onUsage - 计量持久化缝（控制面写共享库）。
   */
  constructor(options: { now?: () => number; onUsage?: (report: UsageReport) => void } = {}) {
    this.now = options.now ?? Date.now
    this.onUsage = options.onUsage ?? (() => {})
  }

  /**
   * 设置/更新用户配额；已存在的用户保留活跃数与令牌。
   * @param userId - 用户标识。
   * @param policy - 配额策略。
   */
  configure(userId: string, policy: QuotaPolicy): void {
    if (!Number.isSafeInteger(policy.maxActiveSessions) || policy.maxActiveSessions < 1) {
      throw new Error('quota: maxActiveSessions must be a positive integer')
    }
    if (policy.burstCapacity < 1 || policy.refillPerSecond <= 0) {
      throw new Error('quota: burstCapacity and refillPerSecond must be positive')
    }
    const existing = this.users.get(userId)
    const nowMs = this.now()
    if (existing === undefined) {
      this.users.set(userId, { policy, active: 0, tokens: policy.burstCapacity, updatedAtMs: nowMs, usage: 0 })
      return
    }
    existing.policy = policy
    existing.tokens = Math.min(existing.tokens, policy.burstCapacity)
  }

  /**
   * 设置集群声明容量（所有节点 maxSessions 之和）。
   * @param capacity - 声明容量。
   */
  setClusterCapacity(capacity: number): void {
    this.clusterCapacity = Math.max(0, capacity)
  }

  /**
   * 尝试准入一个新会话。
   * @param userId - 用户标识。
   * @returns 准入结果（429/503 可区分）。
   */
  admit(userId: string): AdmissionResult {
    const state = this.users.get(userId)
    if (state === undefined) throw new Error(`quota: user ${userId} has no policy`)
    const nowMs = this.now()
    this.refill(state, nowMs)

    if (this.clusterCapacity > 0 && this.clusterActive >= this.clusterCapacity) {
      return { ok: false, code: 'OVERLOADED', retryAfterSeconds: 1 }
    }
    // 超卖池：集群活跃接近声明容量时按用户公平份额裁决（与控制面放置闸门同一份判定）。
    // 分母是「有活跃会话的用户数」，不是配置过策略的用户数：节点上历史用户会不断累积，
    // 用配置数会让份额被摊薄到 1，只剩一个活跃用户时也会被误判为超出份额。
    const gate = quotaGate({
      policy: state.policy,
      active: state.active,
      clusterCapacity: this.clusterCapacity,
      clusterActive: this.clusterActive,
      activeUsers: this.activeUserCount() + (state.active === 0 ? 1 : 0),
    })
    if (gate !== 'ok') {
      return { ok: false, code: 'QUOTA_EXCEEDED', reason: gate, retryAfterSeconds: 1 }
    }
    if (state.tokens < 1) {
      return { ok: false, code: 'QUOTA_EXCEEDED', reason: 'BURST', retryAfterSeconds: Math.max(1, Math.ceil(1 / state.policy.refillPerSecond)) }
    }
    state.tokens -= 1
    state.active += 1
    this.clusterActive += 1
    return { ok: true, remainingBurst: Math.floor(state.tokens) }
  }

  /**
   * 会话结束：释放活跃计数（不返还突发令牌）。
   * @param userId - 用户标识。
   */
  release(userId: string): void {
    const state = this.users.get(userId)
    if (state === undefined || state.active <= 0) return
    state.active -= 1
    this.clusterActive = Math.max(0, this.clusterActive - 1)
  }

  /**
   * 记录 provider 上报的 token 用量（计费口径唯一来源）。
   * @param report - 上报记录。
   */
  reportUsage(report: UsageReport): void {
    const state = this.users.get(report.userId)
    if (state !== undefined) state.usage += report.tokens
    this.onUsage(report)
  }

  /**
   * 读用户当前视图。
   * @param userId - 用户标识。
   * @returns 活跃会话数、突发令牌与累计用量。
   */
  view(userId: string): { active: number; tokens: number; usage: number } | undefined {
    const state = this.users.get(userId)
    if (state === undefined) return undefined
    this.refill(state, this.now())
    return { active: state.active, tokens: state.tokens, usage: state.usage }
  }

  /** 按经过时间补充令牌桶。 */
  private refill(state: UserState, nowMs: number): void {
    const elapsed = Math.max(0, nowMs - state.updatedAtMs) / 1000
    if (elapsed > 0) {
      state.tokens = Math.min(state.policy.burstCapacity, state.tokens + elapsed * state.policy.refillPerSecond)
      state.updatedAtMs = nowMs
    }
  }

  /** 当前有活跃会话的用户数（超卖池公平份额的分母）。 */
  private activeUserCount(): number {
    let count = 0
    for (const state of this.users.values()) {
      if (state.active > 0) count += 1
    }
    return count
  }
}
