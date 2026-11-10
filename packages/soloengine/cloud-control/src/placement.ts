/**
 * 会话放置器（W10.3）：过滤 + power-of-k-choices（k=2）。
 *
 * 放置只产出**候选决策**：节点本地的准入仍是最终裁决（容量、沙箱、镜像就绪与否只有节点自己知道）。
 * 过滤条件全部来自节点注册表视图：心跳未超时、状态 active、未达会话上限、必需标签齐全。
 *
 * @module @soloengine/cloud-control/placement
 */

import type { NodeView, PlacementCandidate, PlacementDecision, PlacementRequest } from './contracts.ts'

/** p2c 采样的候选数。 */
const SAMPLE_SIZE = 2

/** 吞吐权重（空闲率）。 */
const FREE_CAPACITY_WEIGHT = 0.7

/** CPU 权重。 */
const CPU_WEIGHT = 0.3

/** CPU 未知时按中位数参与评分。 */
const UNKNOWN_CPU_PERCENT = 50

/**
 * 判断一个节点能否承载该请求。
 * @param node - 节点视图。
 * @param request - 放置请求。
 * @returns 可放置时为 true。
 */
function eligible(node: NodeView, request: PlacementRequest): boolean {
  if (node.stale || node.state !== 'active') return false
  if (node.load.activeSessions >= node.maxSessions) return false
  for (const [key, value] of Object.entries(request.requiredLabels ?? {})) {
    if (node.labels[key] !== value) return false
  }
  return true
}

/**
 * 节点空闲度评分（0~1，越大越空闲）。
 * @param node - 节点视图。
 * @returns 加权得分。
 */
function score(node: NodeView): number {
  const free = node.maxSessions <= 0 ? 0 : 1 - node.load.activeSessions / node.maxSessions
  const cpu = 1 - (node.load.cpuPercent ?? UNKNOWN_CPU_PERCENT) / 100
  return FREE_CAPACITY_WEIGHT * Math.max(0, Math.min(1, free)) + CPU_WEIGHT * Math.max(0, Math.min(1, cpu))
}

/**
 * 在候选集里做 p2c 采样并选出得分最高者。
 * @param eligibleNodes - 已通过过滤的节点。
 * @param random - 随机源（测试注入）。
 * @returns 采样后的候选评分与选中节点。
 */
function sample(nodes: NodeView[], random: () => number): { chosen: NodeView | undefined; candidates: PlacementCandidate[] } {
  const pool = [...nodes]
  const picked: NodeView[] = []
  for (let index = 0; index < SAMPLE_SIZE && pool.length > 0; index += 1) {
    const position = Math.min(pool.length - 1, Math.floor(random() * pool.length))
    const [next] = pool.splice(position, 1)
    if (next !== undefined) picked.push(next)
  }
  const candidates = picked.map(node => ({
    nodeId: node.nodeId,
    score: score(node),
    activeSessions: node.load.activeSessions,
    maxSessions: node.maxSessions,
  }))
  const chosen = picked.reduce<NodeView | undefined>((best, node) => {
    if (best === undefined) return node
    const delta = score(node) - score(best)
    // 平票保留先采样到的节点：采样顺序本身由随机源决定；按 nodeId 破平会让
    // 两节点等负载时所有请求固定落到同一台（集中热点，违反 W5 的均匀放置验收）。
    return delta > 1e-9 ? node : best
  }, undefined)
  return { chosen, candidates }
}

/**
 * 放置一个会话。
 * @param nodes - 注册表视图。
 * @param request - 放置请求。
 * @param options - 时钟与随机源（测试注入）。
 * @returns 放置决策（无容量时 `reason` 为 `no-capacity` 且 `nodeId` 为空串）。
 */
export function placeSession(
  nodes: NodeView[],
  request: PlacementRequest,
  options: { now?: () => Date; random?: () => number } = {},
): PlacementDecision {
  const now = options.now ?? (() => new Date())
  const random = options.random ?? Math.random
  const startedAt = performance.now()
  const candidates = nodes.filter(node => eligible(node, request))
  if (candidates.length === 0) {
    return {
      sessionKey: request.sessionKey,
      nodeId: '',
      reason: 'no-capacity',
      candidates: [],
      latencyMs: performance.now() - startedAt,
      decidedAt: now().toISOString(),
    }
  }
  if (candidates.length === 1) {
    const [only] = candidates
    if (only !== undefined) {
      return {
        sessionKey: request.sessionKey,
        nodeId: only.nodeId,
        reason: 'only-eligible',
        candidates: [{
          nodeId: only.nodeId,
          score: score(only),
          activeSessions: only.load.activeSessions,
          maxSessions: only.maxSessions,
        }],
        latencyMs: performance.now() - startedAt,
        decidedAt: now().toISOString(),
      }
    }
  }
  const { chosen, candidates: sampled } = sample(candidates, random)
  return {
    sessionKey: request.sessionKey,
    nodeId: chosen?.nodeId ?? '',
    reason: chosen === undefined ? 'no-capacity' : 'p2c',
    candidates: sampled,
    latencyMs: performance.now() - startedAt,
    decidedAt: now().toISOString(),
  }
}
