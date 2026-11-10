/**
 * 控制面 HTTP 客户端（网关进程用）：实现 {@link ControlApi}。
 *
 * 只做协议转换与信封解包；失败即抛（fail loud），不缓存（网关自己的租约缓存仍在
 * {@link CloudGateway} 内）。
 *
 * @module @soloengine/cloud-control/client
 */

import type { ControlApi, NodeControlApi } from './api.ts'
import {
  CloudControlError,
  type LeaseAcquireResult,
  type NodeLoad,
  type NodeView,
  type PlacementDecision,
  type PlacementRequest,
  type SessionLease,
  type WorkspaceFileEntry,
} from './contracts.ts'
import type { RegisterNodeInput } from './service.ts'
import type { UsageReport } from './quota.ts'

/** 控制面 HTTP 客户端（网关与节点共用）。 */
export class RemoteControl implements ControlApi, NodeControlApi {
  private readonly base: string

  /**
   * @param base - 控制面地址（例如 `http://127.0.0.1:8993`）。
   */
  constructor(base: string) {
    this.base = base.replace(/\/$/u, '')
  }

  /**
   * 发一次 POST 并解包 `{ok,...}` 信封。
   *
   * 可预期的非 2xx（例如放置的 503 + 决策载荷）由调用方显式接受，避免把业务语义
   * 降级成「控制面不可用」；带 `{ok:false, code}` 的错误信封按原错误码抛出。
   * @param path - 控制面路径。
   * @param body - 请求体。
   * @param acceptStatus - 允许的非 2xx 状态码。
   * @returns 响应体。
   */
  private async post(path: string, body: unknown, acceptStatus: readonly number[] = []): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
    } catch (error) {
      throw new CloudControlError('CONTROL_UNAVAILABLE',
        `control plane ${path} is unreachable: ${error instanceof Error ? error.message : String(error)}`)
    }
    // 先解包再判状态：控制面把「租约被占 / 节点未知」这类**业务结论**放在 409/404 的
    // `{ok:false,...}` 信封里。直接按状态码抛 CONTROL_UNAVAILABLE 会让接管、失锁降级、
    // 重新注册这些恢复分支永远不可达。
    let parsed: unknown
    try {
      parsed = await response.json()
    } catch (error) {
      throw new CloudControlError('CONTROL_UNAVAILABLE',
        `control plane ${path} answered ${String(response.status)} with a non-JSON body: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CloudControlError('CONTROL_UNAVAILABLE', `control plane ${path} returned a non-object envelope`)
    }
    const envelope = parsed as Record<string, unknown>
    const acceptable = response.status < 300 || acceptStatus.includes(response.status)
    if (!acceptable) {
      if (envelope.ok === false && typeof envelope.code === 'string') {
        throw new CloudControlError(envelope.code,
          typeof envelope.message === 'string' ? envelope.message : envelope.code)
      }
      throw new CloudControlError('CONTROL_UNAVAILABLE', `control plane ${path} answered ${String(response.status)}`)
    }
    return envelope
  }

  /**
   * 读会话租约。
   * @param sessionKey - 会话键。
   * @returns 租约或 undefined。
   */
  async lease(sessionKey: string): Promise<SessionLease | undefined> {
    const body = await this.post('/v1/leases/get', { sessionKey })
    return (body.lease ?? undefined) as SessionLease | undefined
  }

  /**
   * 读节点视图。
   * @param nodeId - 节点标识。
   * @returns 节点视图或 undefined。
   */
  async node(nodeId: string): Promise<NodeView | undefined> {
    const body = await this.post('/v1/nodes/get', { nodeId })
    return (body.node ?? undefined) as NodeView | undefined
  }

  /**
   * 放置一个会话。
   * @param request - 放置请求。
   * @returns 放置决策。
   */
  async place(request: PlacementRequest): Promise<PlacementDecision> {
    // 无容量/超配额是放置的**结论**而不是控制面故障：503/429 信封里带着决策（候选与理由）。
    const body = await this.post('/v1/place', request, [429, 503])
    return body.decision as PlacementDecision
  }

  /**
   * 注册或刷新本节点。
   * @param input - 节点静态信息。
   * @returns 节点视图。
   */
  async register(input: RegisterNodeInput): Promise<NodeView> {
    const body = await this.post('/v1/nodes/register', input)
    return body.node as NodeView
  }

  /**
   * 上报心跳与负载。
   * @param nodeId - 节点标识。
   * @param load - 负载。
   * @returns 节点视图；未注册时为 undefined。
   */
  async heartbeat(nodeId: string, load: NodeLoad): Promise<NodeView | undefined> {
    // 404 + NODE_UNKNOWN 是「控制面数据丢失，需要重新注册」的信号，不是不可用。
    const body = await this.post('/v1/nodes/heartbeat', { nodeId, ...load }, [404])
    return body.ok === true ? body.node as NodeView : undefined
  }

  /**
   * 获取（或接管）会话租约。
   * @param input - 会话键、节点、持有者、可选 TTL 与归属用户。
   * @returns 租约结果。
   */
  async acquireLease(input: {
    sessionKey: string
    nodeId: string
    holder: string
    ttlMs?: number
    userId?: string
  }): Promise<LeaseAcquireResult> {
    const body = await this.post('/v1/leases/acquire', input, [409, 429])
    if (body.ok === true) {
      return { ok: true, lease: body.lease as SessionLease, acquired: body.acquired === true }
    }
    if (body.code === 'QUOTA_EXCEEDED') return { ok: false, code: 'QUOTA_EXCEEDED', lease: null }
    const lease = body.lease as SessionLease | undefined
    if (lease === undefined) throw new CloudControlError('LEASE_HELD', `lease for ${input.sessionKey} was refused`)
    return { ok: false, code: 'LEASE_HELD', lease }
  }

  /**
   * 认领本节点名下已被接管的租约。
   * @param input - 会话键、节点、持有者与可选 TTL。
   * @returns 认领后的租约；不可认领时为 undefined。
   */
  async adoptLease(input: {
    sessionKey: string
    nodeId: string
    holder: string
    ttlMs?: number
  }): Promise<SessionLease | undefined> {
    const body = await this.post('/v1/leases/adopt', input, [409])
    return body.ok === true ? body.lease as SessionLease : undefined
  }

  /**
   * 续约。
   * @param input - 会话键、持有者、epoch 与可选 TTL。
   * @returns 是否续约成功。
   */
  async renewLease(input: { sessionKey: string; holder: string; epoch: number; ttlMs?: number }): Promise<boolean> {
    const body = await this.post('/v1/leases/renew', input, [409])
    return body.ok === true
  }

  /**
   * 释放租约。
   * @param input - 会话键、持有者、epoch。
   * @returns 是否释放成功。
   */
  async releaseLease(input: { sessionKey: string; holder: string; epoch: number }): Promise<boolean> {
    const body = await this.post('/v1/leases/release', input)
    return body.ok === true
  }

  /**
   * 上报一次 provider 口径的计量（W10.10）。
   * @param report - 用户、会话、provider 上报的 token 与会话事件序号。
   */
  async reportUsage(report: UsageReport): Promise<void> {
    const body = await this.post('/v1/usage', report)
    if (body.ok !== true) {
      throw new CloudControlError('USAGE_REJECTED', `control plane refused the usage report for ${report.sessionKey}`)
    }
  }

  /**
   * 保存会话工作区清单（W10.12）。
   * @param sessionKey - 会话键。
   * @param files - 清单条目。
   */
  async putWorkspaceManifest(sessionKey: string, files: readonly WorkspaceFileEntry[]): Promise<void> {
    const body = await this.post('/v1/workspaces/put', { sessionKey, files })
    if (body.ok !== true) {
      throw new CloudControlError('WORKSPACE_REJECTED', `control plane refused the workspace manifest for ${sessionKey}`)
    }
  }

  /**
   * 读会话工作区清单。
   * @param sessionKey - 会话键。
   * @returns 清单条目；从未提交过时为空数组。
   */
  async getWorkspaceManifest(sessionKey: string): Promise<WorkspaceFileEntry[]> {
    const body = await this.post('/v1/workspaces/get', { sessionKey })
    return (body.files ?? []) as WorkspaceFileEntry[]
  }
}
