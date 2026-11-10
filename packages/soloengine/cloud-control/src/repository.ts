/**
 * 控制面仓储契约（W10.1 共享归属库）：节点、租约、审计、放置。
 *
 * 两种落地实现同一份语义：
 * - {@link ControlStore}（SQLite，单机与测试）；
 * - {@link PgControlStore}（PostgreSQL，多节点共享库）。
 *
 * 全部方法异步：PostgreSQL 的 I/O 天然异步，SQLite 实现只是把同步调用包成 Promise，
 * 保证 `ControlPlane` 只有一条调用路径（不出现「单机同步、云上异步」两套逻辑）。
 *
 * @module @soloengine/cloud-control/repository
 */

import type {
  NodeLoad,
  NodeState,
  NodeView,
  PlacementDecision,
  SessionLease,
  WorkspaceFileEntry,
} from './contracts.ts'
import type { UsageAggregate, UsageReport } from './quota.ts'

/** 租约获取结果。 */
export type RepositoryLeaseResult =
  | { ok: true; lease: SessionLease; acquired: boolean }
  | { ok: false; code: 'LEASE_HELD'; lease: SessionLease }

/** 控制面仓储。 */
export interface ControlRepository {
  /**
   * 注册或刷新节点（幂等）。
   * @param record - 节点静态信息。
   */
  registerNode(record: {
    nodeId: string
    endpoint: string
    region: string
    labels: Record<string, string>
    maxSessions: number
    state?: NodeState
  }): Promise<void>
  /**
   * 记录心跳与负载。
   * @param nodeId - 节点标识。
   * @param load - 负载。
   * @param at - 心跳时间。
   * @returns 节点不存在时 false。
   */
  heartbeat(nodeId: string, load: NodeLoad, at: Date): Promise<boolean>
  /**
   * 切换节点状态。
   * @param nodeId - 节点标识。
   * @param state - 新状态。
   */
  setNodeState(nodeId: string, state: NodeState): Promise<void>
  /**
   * 全部节点视图。
   * @param now - 判定心跳超时的当前时间。
   * @returns 节点视图。
   */
  listNodes(now: Date): Promise<NodeView[]>
  /**
   * 会话开始（节点准入通过后回报）。
   * @param nodeId - 节点标识。
   * @param at - 变更时间。
   */
  noteSessionStart(nodeId: string, at: Date): Promise<void>
  /**
   * 会话结束（节点回报）。
   * @param nodeId - 节点标识。
   * @param at - 变更时间。
   */
  noteSessionEnd(nodeId: string, at: Date): Promise<void>
  /**
   * 读会话租约。
   * @param sessionKey - 会话键。
   * @returns 租约或 undefined。
   */
  getLease(sessionKey: string): Promise<SessionLease | undefined>
  /**
   * 获取（或接管）会话租约。
   * @param input - 会话键、节点、持有者、TTL 与可选归属用户。
   * @param now - 当前时间。
   * @returns 租约结果。
   */
  acquireLease(
    input: { sessionKey: string; nodeId: string; holder: string; ttlMs: number; userId?: string },
    now: Date,
  ): Promise<RepositoryLeaseResult>
  /**
   * 续约。
   * @param sessionKey - 会话键。
   * @param holder - 持有者。
   * @param epoch - 写者纪元。
   * @param ttlMs - 新 TTL。
   * @param now - 当前时间。
   * @returns 是否成功。
   */
  renewLease(sessionKey: string, holder: string, epoch: number, ttlMs: number, now: Date): Promise<boolean>
  /**
   * 释放租约。
   * @param sessionKey - 会话键。
   * @param holder - 持有者。
   * @param epoch - 写者纪元。
   * @returns 是否删除。
   */
  releaseLease(sessionKey: string, holder: string, epoch: number): Promise<boolean>
  /**
   * 列出某节点持有的全部租约（故障接管用）。
   * @param nodeId - 节点标识。
   * @returns 租约列表。
   */
  listLeases(nodeId: string): Promise<SessionLease[]>
  /**
   * 统计某用户当前持有的未过期租约数（跨节点配额准入的活跃会话口径）。
   * @param userId - 归属用户。
   * @param now - 当前时间（判定过期）。
   * @returns 未过期租约数。
   */
  activeLeaseCount(userId: string, now: Date): Promise<number>
  /**
   * 统计当前持有未过期租约的用户数（超卖池公平份额的分母）。
   * @param now - 当前时间（判定过期）。
   * @returns 有活跃租约的用户数。
   */
  activeLeaseUsers(now: Date): Promise<number>
  /**
   * 强制接管一条租约（节点失联时由控制面调用）：按 `expectedEpoch` 做 CAS，
   * 成功则 epoch+1 并改归属；旧写者随之下次写入被围栏拒绝。
   * @param input - 会话键、期望 epoch、新节点、新持有者、TTL。
   * @param now - 当前时间。
   * @returns 新租约；CAS 失败（已被他人接管）时为 undefined。
   */
  takeoverLease(
    input: { sessionKey: string; expectedEpoch: number; nodeId: string; holder: string; ttlMs: number },
    now: Date,
  ): Promise<SessionLease | undefined>
  /**
   * 认领本节点名下已被接管的租约（目标节点把占位持有者换成自己的真实持有者）。
   *
   * 只更新同节点租约的持有者与到期时间，不递增 epoch；租约已归他人或已过期时返回 undefined。
   * @param input - 会话键、本节点、新持有者、TTL。
   * @param now - 当前时间。
   * @returns 认领后的租约；不可认领时为 undefined。
   */
  adoptLease(
    input: { sessionKey: string; nodeId: string; holder: string; ttlMs: number },
    now: Date,
  ): Promise<SessionLease | undefined>
  /**
   * 写围栏校验。
   * @param sessionKey - 会话键。
   * @param epoch - 写者纪元。
   * @param now - 当前时间。
   * @returns 仍是当前写者时为 true。
   */
  assertWriter(sessionKey: string, epoch: number, now: Date): Promise<boolean>
  /**
   * 记录放置决策。
   * @param decision - 决策。
   */
  recordPlacement(decision: PlacementDecision): Promise<void>
  /**
   * 记录一条 provider 口径的计量上报（`sourceSeq` 存在时按会话事件序号去重）。
   * @param report - 上报记录。
   */
  recordUsage(report: UsageReport): Promise<void>
  /**
   * 读计量聚合（按用户 + 会话折叠）。
   * @param filter - 可选用户过滤。
   * @returns 聚合行，按用户与会话排序。
   */
  usage(filter?: { userId?: string }): Promise<UsageAggregate[]>
  /**
   * 保存会话工作区清单（对象存储权威副本的索引；整份覆盖）。
   * @param sessionKey - 会话键。
   * @param files - 清单条目。
   * @param at - 提交时间。
   */
  putWorkspaceManifest(sessionKey: string, files: readonly WorkspaceFileEntry[], at: Date): Promise<void>
  /**
   * 读会话工作区清单。
   * @param sessionKey - 会话键。
   * @returns 清单条目；从未提交过时为空数组。
   */
  getWorkspaceManifest(sessionKey: string): Promise<WorkspaceFileEntry[]>
  /**
   * 读会话审计事件。
   * @param sessionKey - 会话键。
   * @returns 事件列表。
   */
  events(sessionKey: string): Promise<{ kind: string; epoch: number | null; at: string; detail: unknown }[]>
}
