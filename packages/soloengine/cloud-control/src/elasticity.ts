/**
 * 弹性溢出与运维闭环（W10.13，契约层）。
 *
 * 三件事：
 * - **排空**：节点下线前把会话按 QoS 阶梯（先后台后交互、同档最久不活跃优先）迁出；
 * - **滚动升级**：按区域分批，同一批内节点可同时排空，不同批串行，避免整池同时下线；
 * - **溢出筛选**：只有标签覆盖且镜像落在共享镜像集内的节点才接收溢出会话。
 *
 * 本模块只产出计划，不执行迁移/升级（执行由控制面与运维编排完成）。
 *
 * @module @soloengine/cloud-control/elasticity
 */

import type { NodeView } from './contracts.ts'
import type { SessionSnapshot, SessionTier } from './lifecycle.ts'

/** 一次排空计划。 */
export interface DrainPlan {
  /** 被排空的节点。 */
  nodeId: string
  /** 需要迁出的会话（按迁出顺序）。 */
  sessionKeys: string[]
}

/** 一批滚动升级。 */
export interface UpgradeBatch {
  /** 批次序号（0 起）。 */
  index: number
  /** 本批节点。 */
  nodeIds: string[]
  /** 本批覆盖的区域。 */
  regions: string[]
}

/**
 * 生成节点排空计划：只列该节点上的会话，先后台后交互、同档最久不活跃优先。
 * @param nodeId - 待排空节点。
 * @param sessions - 全部会话快照（含归属节点）。
 * @returns 排空计划。
 */
export function planDrain(
  nodeId: string,
  sessions: readonly (SessionSnapshot & { nodeId: string })[],
): DrainPlan {
  const tierRank: Record<SessionTier, number> = { background: 0, interactive: 1 }
  const sessionKeys = sessions
    .filter(session => session.nodeId === nodeId)
    .sort((left, right) => tierRank[left.tier] - tierRank[right.tier]
      || left.lastActiveAtMs - right.lastActiveAtMs)
    .map(session => session.sessionKey)
  return { nodeId, sessionKeys }
}

/**
 * 生成滚动升级批次：同区域节点同批，区域之间串行。
 * @param nodes - 节点视图。
 * @returns 按执行顺序排列的批次。
 */
export function planRollingUpgrade(nodes: readonly NodeView[]): UpgradeBatch[] {
  const byRegion = new Map<string, string[]>()
  for (const node of nodes) {
    const list = byRegion.get(node.region) ?? []
    list.push(node.nodeId)
    byRegion.set(node.region, list)
  }
  return [...byRegion.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([region, nodeIds], index) => ({ index, nodeIds: [...nodeIds].sort(), regions: [region] }))
}

/**
 * 溢出筛选：节点标签必须覆盖全部必需标签，且共享镜像集包含所需镜像。
 * @param node - 候选节点。
 * @param requiredLabels - 必需标签。
 * @param requiredImages - 会话所需镜像。
 * @param sharedImages - 集群共享镜像集（节点可拉取/已缓存）。
 * @returns 是否可接收溢出。
 */
export function overflowEligible(
  node: NodeView,
  requiredLabels: Readonly<Record<string, string>>,
  requiredImages: readonly string[],
  sharedImages: readonly string[],
): boolean {
  if (node.stale || node.state !== 'active') return false
  for (const [key, value] of Object.entries(requiredLabels)) {
    if (node.labels[key] !== value) return false
  }
  return requiredImages.every(image => sharedImages.includes(image))
}

/**
 * 扩容策略（部署可变参数，由调用方显式给出；本模块不设默认值）。
 *
 * `targetUtilization` 是「需求 / 容量」的目标比值：需求按 `activeSessions + queueDepth`
 * 计，容量按各 active 节点的 `maxSessions` 计。`scaleInThreshold` 低于该利用率才考虑
 * 缩容，且只移除没有活跃会话/排队的空节点（有会话的节点必须先走 drain）。
 */
export interface ScalePolicy {
  /** 节点池下限（含空闲期）。 */
  minNodes: number
  /** 节点池上限。 */
  maxNodes: number
  /** 目标利用率（0 < u <= 1）。 */
  targetUtilization: number
  /** 缩容阈值（0 < r < targetUtilization）。 */
  scaleInThreshold: number
  /** 单次决策最多增减的节点数（>= 1）。 */
  maxStep: number
}

/** 一次扩容决策。 */
export interface ScaleDecision {
  /** 动作：扩、缩、保持。 */
  action: 'scale-out' | 'scale-in' | 'hold'
  /** 节点增减数（hold 为 0）。 */
  delta: number
  /** 决策依据。 */
  reason: 'demand' | 'surplus' | 'balanced' | 'no-nodes'
  /** 当前 active 且未失联的节点数。 */
  activeNodes: number
  /** 目标节点数（已按 min/max 夹取）。 */
  targetNodes: number
  /** 当前需求（activeSessions + queueDepth 之和）。 */
  demand: number
  /** 当前容量（各 active 节点 maxSessions 之和）。 */
  capacity: number
  /** 当前利用率（capacity 为 0 时为 0）。 */
  utilization: number
}

/**
 * 计算扩容决策：只产出计划，节点创建/回收由部署层（IaC/运维脚本）执行。
 *
 * 需求为 0 时收敛到 `minNodes`；需求高于目标利用率时按容量扩节点；缩容只移除
 * `activeSessions` 与 `queueDepth` 都为 0 的空节点，有会话的节点必须先排空。
 * 调度周期（冷却期）由调用方掌握，本函数无隐藏状态。
 * @param nodes - 节点视图（含负载）。
 * @param policy - 扩容策略。
 * @returns 扩容决策。
 */
export function planScale(nodes: readonly NodeView[], policy: ScalePolicy): ScaleDecision {
  const active = nodes.filter(node => !node.stale && node.state === 'active')
  const activeNodes = active.length
  const capacity = active.reduce((sum, node) => sum + Math.max(0, node.maxSessions), 0)
  const demand = active.reduce(
    (sum, node) => sum + Math.max(0, node.load.activeSessions) + Math.max(0, node.load.queueDepth ?? 0),
    0,
  )
  const utilization = capacity === 0 ? 0 : demand / capacity
  const averageCapacity = activeNodes === 0 ? 0 : capacity / activeNodes
  const required = demand === 0
    ? policy.minNodes
    : Math.max(
      policy.minNodes,
      Math.ceil(demand / policy.targetUtilization / Math.max(1, averageCapacity)),
    )
  const targetNodes = Math.min(policy.maxNodes, Math.max(policy.minNodes, required))
  let delta = targetNodes - activeNodes
  if (delta > policy.maxStep) delta = policy.maxStep
  if (delta < -policy.maxStep) delta = -policy.maxStep

  if (activeNodes === 0) {
    return {
      action: 'scale-out',
      delta: Math.max(0, delta),
      reason: 'no-nodes',
      activeNodes,
      targetNodes,
      demand,
      capacity,
      utilization,
    }
  }

  if (delta < 0) {
    // 缩容只回收空节点：有会话的节点要通过 drain 迁移后才能下线。
    if (utilization >= policy.scaleInThreshold) {
      return { action: 'hold', delta: 0, reason: 'balanced', activeNodes, targetNodes, demand, capacity, utilization }
    }
    const idle = active.filter(node => node.load.activeSessions === 0 && (node.load.queueDepth ?? 0) === 0).length
    const removable = Math.min(-delta, idle)
    if (removable === 0) {
      return { action: 'hold', delta: 0, reason: 'balanced', activeNodes, targetNodes, demand, capacity, utilization }
    }
    return { action: 'scale-in', delta: -removable, reason: 'surplus', activeNodes, targetNodes, demand, capacity, utilization }
  }

  if (delta > 0) {
    return { action: 'scale-out', delta, reason: 'demand', activeNodes, targetNodes, demand, capacity, utilization }
  }

  return { action: 'hold', delta: 0, reason: 'balanced', activeNodes, targetNodes, demand, capacity, utilization }
}
