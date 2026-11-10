/**
 * 云控制面契约（W10.2 节点注册表 / W10.3 放置 / W10.4 会话租约）。
 *
 * 这些类型是控制面与节点、网关之间的**共享词汇**：节点注册与心跳、放置候选与决策、
 * 租约与 epoch 写围栏。控制面是独立进程（不进 cordis 树），本包不依赖平台运行时。
 *
 * @module @soloengine/cloud-control/contracts
 */

/** 节点标识（由节点自重声明，全局唯一）。 */
export type NodeId = string

/** 节点生命周期状态。 */
export type NodeState = 'active' | 'draining' | 'down'

/** 心跳超时（毫秒）：超过即视为失联，不再参与放置（W10.2）。 */
export const HEARTBEAT_TIMEOUT_MS = 15_000

/** 心跳周期（毫秒）：节点应在此周期内上报负载（W10.4）。 */
export const HEARTBEAT_INTERVAL_MS = 5_000

/** 默认会话租约时长（毫秒）。 */
export const DEFAULT_LEASE_TTL_MS = 15_000

/** 一个节点的静态注册信息。 */
export interface NodeRecord {
  /** 节点标识。 */
  nodeId: NodeId
  /** 节点对外入口（网关转发目标，例如 `http://10.0.0.12:8991`）。 */
  endpoint: string
  /** 区域/可用区标签（放置过滤用）。 */
  region: string
  /** 自定义标签（镜像集、执行后端档位等）。 */
  labels: Record<string, string>
  /** 并发会话上限。 */
  maxSessions: number
  /** 节点状态。 */
  state: NodeState
  /** 注册时间（ISO 8601）。 */
  registeredAt: string
  /** 最近一次心跳时间（ISO 8601）。 */
  lastHeartbeatAt: string
}

/** 节点上报的负载。 */
export interface NodeLoad {
  /** 当前活跃会话数。 */
  activeSessions: number
  /** CPU 使用率（0~100，未知时省略）。 */
  cpuPercent?: number
  /** 内存使用率（0~100，未知时省略）。 */
  memPercent?: number
  /** 排队中的准入请求数。 */
  queueDepth?: number
}

/** 注册表视图：静态信息 + 当前负载 + 是否失联。 */
export interface NodeView extends NodeRecord {
  /** 最近一次上报的负载。 */
  load: NodeLoad
  /** 负载上报时间（ISO 8601）。 */
  loadUpdatedAt: string
  /** 是否已超过心跳超时。 */
  stale: boolean
}

/** 放置请求。 */
export interface PlacementRequest {
  /** 会话键（画布运行实例的稳定标识）。 */
  sessionKey: string
  /** 必需的节点标签（空对象表示不限制）。 */
  requiredLabels?: Record<string, string>
  /**
   * 归属用户（W10.10 跨节点配额准入的唯一依据）。
   *
   * 网关在会话归属校验通过后给出；省略时不做用户维度过滤（排空等系统动作）。
   */
  userId?: string
}

/** 一名候选节点的评分明细。 */
export interface PlacementCandidate {
  /** 节点标识。 */
  nodeId: NodeId
  /** 加权得分（0~1，越大越空闲）。 */
  score: number
  /** 当前活跃会话数。 */
  activeSessions: number
  /** 会话上限。 */
  maxSessions: number
}

/** 放置决策（落审计表）。 */
export interface PlacementDecision {
  /** 会话键。 */
  sessionKey: string
  /** 选中节点。 */
  nodeId: NodeId
  /** 决策理由（`p2c` / `only-eligible` / `no-capacity` / `quota-exceeded`）。 */
  reason: 'p2c' | 'only-eligible' | 'no-capacity' | 'quota-exceeded'
  /** 参与评分的候选（p2c 采样后）。 */
  candidates: PlacementCandidate[]
  /** 决策耗时（毫秒）。 */
  latencyMs: number
  /** 决策时间（ISO 8601）。 */
  decidedAt: string
}

/** 会话租约：写者围栏的唯一真源。 */
export interface SessionLease {
  /** 会话键。 */
  sessionKey: string
  /** 持有租约的节点。 */
  nodeId: NodeId
  /** 写者纪元；每次接管/重新获取递增，旧 epoch 的写入必须被拒绝。 */
  epoch: number
  /** 租约持有者标识（节点内会话写者，例如 `node-1/session:abc`）。 */
  holder: string
  /** 到期时间（ISO 8601）。 */
  expiresAt: string
  /** 最近续约时间（ISO 8601）。 */
  renewedAt: string
  /** 归属用户（租约获取时由节点给出；跨节点配额计数用）。 */
  userId?: string
}

/** 租约获取结果。 */
export type LeaseAcquireResult =
  | { ok: true; lease: SessionLease; acquired: boolean }
  | { ok: false; code: 'LEASE_HELD'; lease: SessionLease }
  /** 429：该用户的并发会话已达硬上限（跨节点配额闸门，未分配租约）。 */
  | { ok: false; code: 'QUOTA_EXCEEDED'; lease: null }

/** 工作区清单的一项：相对工作区根的文件路径 + 内容摘要（对象存储里的对象键）。 */
export interface WorkspaceFileEntry {
  /** 相对工作区根的 POSIX 路径（不含 `..` 或绝对路径）。 */
  path: string
  /** 内容的 sha256 摘要（对象存储对象键）。 */
  digest: string
  /** 字节数。 */
  size: number
}

/** 租约错误。 */
export class CloudControlError extends Error {
  /**
   * @param code - 稳定错误码（HTTP 层直出）。
   * @param message - 可读原因。
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CloudControlError'
  }
}
