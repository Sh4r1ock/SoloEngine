/**
 * 网关对控制面的最小依赖面（W10.6）：租约查询、节点视图、放置。
 *
 * 方法一律异步：本地实现（{@link localControlApi} 包一层 `ControlPlane`）与跨进程实现
 * （{@link RemoteControl} 走控制面 HTTP）因此可以互换，网关不需要知道控制面在不在本进程。
 *
 * @module @soloengine/cloud-control/api
 */

import type {
  LeaseAcquireResult,
  NodeLoad,
  NodeRecord,
  NodeView,
  PlacementDecision,
  PlacementRequest,
  SessionLease,
  WorkspaceFileEntry,
} from './contracts.ts'
import type { ControlPlane, RegisterNodeInput } from './service.ts'
import type { UsageReport } from './quota.ts'

/** 网关需要的控制面只读/放置面。 */
export interface ControlApi {
  /**
   * 读会话租约。
   * @param sessionKey - 会话键。
   * @returns 租约或 undefined。
   */
  lease(sessionKey: string): Promise<SessionLease | undefined>
  /**
   * 读节点视图。
   * @param nodeId - 节点标识。
   * @returns 节点视图或 undefined。
   */
  node(nodeId: string): Promise<NodeView | undefined>
  /**
   * 放置一个会话。
   * @param request - 放置请求。
   * @returns 放置决策。
   */
  place(request: PlacementRequest): Promise<PlacementDecision>
}

/**
 * 节点运行时需要的控制面写面（W10.2/W10.4）：注册、心跳、租约取得与续约。
 *
 * 与 {@link ControlApi} 分开：网关只读/放置，节点才有注册与租约写。
 */
export interface NodeControlApi {
  /**
   * 注册或刷新本节点。
   * @param input - 节点静态信息。
   * @returns 节点视图。
   */
  register(input: RegisterNodeInput): Promise<NodeRecord | NodeView>
  /**
   * 上报心跳与负载。
   * @param nodeId - 节点标识。
   * @param load - 负载。
   * @returns 节点视图；未注册时为 undefined。
   */
  heartbeat(nodeId: string, load: NodeLoad): Promise<NodeView | undefined>
  /**
   * 获取（或接管）会话租约。
   * @param input - 会话键、节点、持有者、可选 TTL 与归属用户。
   * @returns 租约结果。
   */
  acquireLease(input: {
    sessionKey: string
    nodeId: string
    holder: string
    ttlMs?: number
    userId?: string
  }): Promise<LeaseAcquireResult>
  /**
   * 认领本节点名下已被接管的租约。
   * @param input - 会话键、节点、持有者与可选 TTL。
   * @returns 认领后的租约；不可认领时为 undefined。
   */
  adoptLease(input: { sessionKey: string; nodeId: string; holder: string; ttlMs?: number }): Promise<SessionLease | undefined>
  /**
   * 续约。
   * @param input - 会话键、持有者、epoch 与可选 TTL。
   * @returns 是否续约成功。
   */
  renewLease(input: { sessionKey: string; holder: string; epoch: number; ttlMs?: number }): Promise<boolean>
  /**
   * 释放租约。
   * @param input - 会话键、持有者、epoch。
   * @returns 是否释放成功。
   */
  releaseLease(input: { sessionKey: string; holder: string; epoch: number }): Promise<boolean>
  /**
   * 上报一次 provider 口径的计量（W10.10）。
   * @param report - 用户、会话、provider 上报的 token 与会话事件序号。
   */
  reportUsage(report: UsageReport): Promise<void>
  /**
   * 保存会话工作区清单（W10.12）。
   * @param sessionKey - 会话键。
   * @param files - 清单条目。
   */
  putWorkspaceManifest(sessionKey: string, files: readonly WorkspaceFileEntry[]): Promise<void>
  /**
   * 读会话工作区清单。
   * @param sessionKey - 会话键。
   * @returns 清单条目；从未提交过时为空数组。
   */
  getWorkspaceManifest(sessionKey: string): Promise<WorkspaceFileEntry[]>
}

/**
 * 把进程内控制面适配成 {@link ControlApi}（网关与控制面同进程时的默认形态）。
 * @param control - 控制面服务。
 * @returns 异步门面。
 */
export function localControlApi(control: ControlPlane): ControlApi {
  return {
    lease: async sessionKey => control.lease(sessionKey),
    node: async nodeId => control.node(nodeId),
    place: async request => control.place(request),
  }
}
