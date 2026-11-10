/**
 * 会话暂停 / 驱逐与 QoS 阶梯（W10.11）。
 *
 * 纯策略求值：给定会话快照与时钟，输出「保持 / 暂停 / 驱逐」及暂停方式。执行后端按
 * 结果落地（B 档停容器、C 档快照），本模块不碰进程。驱逐阶梯固定为**先后台、后交互**，
 * 同档内按最久不活跃优先，保证交互会话最后被牺牲。
 *
 * 阈值（Plan W10.11）：空闲 30 分钟驱逐、TTL 7 天；暂停阈值取空闲 15 分钟（可配）。
 *
 * @module @soloengine/cloud-control/lifecycle
 */

/** 会话档位（QoS 阶梯的唯一排序输入）。 */
export type SessionTier = 'interactive' | 'background'

/** 会话当前执行状态。 */
export type SessionRunState = 'running' | 'paused'

/** 暂停方式（档位差异）：B 档停容器，C 档快照。 */
export type PauseMode = 'stop-container' | 'snapshot'

/** 生命周期策略。 */
export interface LifecyclePolicy {
  /** 空闲多久后暂停（毫秒）。 */
  pauseAfterIdleMs: number
  /** 空闲多久后驱逐（毫秒）。 */
  evictAfterIdleMs: number
  /** 会话最长存活时间（毫秒）。 */
  ttlMs: number
}

/** 默认策略：暂停 15 分钟、驱逐 30 分钟、TTL 7 天。 */
export const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicy = {
  pauseAfterIdleMs: 15 * 60 * 1000,
  evictAfterIdleMs: 30 * 60 * 1000,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
}

/** 一个会话的生命周期快照。 */
export interface SessionSnapshot {
  /** 会话键。 */
  sessionKey: string
  /** 档位。 */
  tier: SessionTier
  /** 当前状态。 */
  state: SessionRunState
  /** 最近活跃时间（毫秒时间戳）。 */
  lastActiveAtMs: number
  /** 创建时间（毫秒时间戳）。 */
  createdAtMs: number
  /** 执行后端档位（决定暂停方式）。 */
  backend: 'container' | 'microvm'
}

/** 一次生命周期动作。 */
export type LifecycleAction =
  | { kind: 'keep' }
  | { kind: 'pause'; mode: PauseMode; reason: 'idle' }
  | { kind: 'evict'; reason: 'idle' | 'ttl' }

/**
 * 求值单个会话的生命周期动作。
 * @param session - 会话快照。
 * @param nowMs - 当前时间（毫秒）。
 * @param policy - 生命周期策略。
 * @returns 动作。
 */
export function decideLifecycle(
  session: SessionSnapshot,
  nowMs: number,
  policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
): LifecycleAction {
  if (nowMs - session.createdAtMs >= policy.ttlMs) return { kind: 'evict', reason: 'ttl' }
  const idle = nowMs - session.lastActiveAtMs
  if (idle >= policy.evictAfterIdleMs) return { kind: 'evict', reason: 'idle' }
  if (session.state === 'running' && idle >= policy.pauseAfterIdleMs) {
    return { kind: 'pause', mode: session.backend === 'microvm' ? 'snapshot' : 'stop-container', reason: 'idle' }
  }
  return { kind: 'keep' }
}

/**
 * 对一批会话生成驱逐顺序（先后台、后交互；同档最久不活跃优先）。
 * 只返回需要驱逐的会话；暂停动作不在本函数内（由 {@link decideLifecycle} 逐会话给出）。
 *
 * @param sessions - 会话快照。
 * @param nowMs - 当前时间（毫秒）。
 * @param policy - 生命周期策略。
 * @returns 按执行顺序排列的驱逐动作。
 */
export function planEvictions(
  sessions: readonly SessionSnapshot[],
  nowMs: number,
  policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
): { sessionKey: string; reason: 'idle' | 'ttl' }[] {
  const tierRank: Record<SessionTier, number> = { background: 0, interactive: 1 }
  return sessions
    .map(session => ({ session, action: decideLifecycle(session, nowMs, policy) }))
    .filter((entry): entry is { session: SessionSnapshot; action: { kind: 'evict'; reason: 'idle' | 'ttl' } } => entry.action.kind === 'evict')
    .sort((left, right) => tierRank[left.session.tier] - tierRank[right.session.tier]
      || left.session.lastActiveAtMs - right.session.lastActiveAtMs)
    .map(entry => ({ sessionKey: entry.session.sessionKey, reason: entry.action.reason }))
}
