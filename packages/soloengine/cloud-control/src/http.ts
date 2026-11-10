/**
 * 控制面 HTTP 接口（W10.2~W10.4 的线协议）：节点注册/心跳/状态、放置、租约。
 *
 * 只做协议转换与入参校验；业务规则在 {@link ControlPlane}。网关与节点用同一份契约；
 * 控制面是独立进程（不进 cordis 树），因此这里不依赖平台运行时。
 *
 * @module @soloengine/cloud-control/http
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { NodeLoad, NodeState, WorkspaceFileEntry } from './contracts.ts'
import type { ScalePolicy } from './elasticity.ts'
import { ControlPlane } from './service.ts'

/** 一次请求的 JSON 体（已解析）。 */
type JsonBody = Record<string, unknown>

/** 读取并解析 JSON 请求体（上限 1 MB；畸形 JSON 返回 undefined）。 */
async function readJson(request: IncomingMessage): Promise<JsonBody | undefined> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1024 * 1024) return undefined
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonBody : undefined
  } catch {
    return undefined
  }
}

/** 写 JSON 响应。 */
function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}

/** 取必填字符串。 */
function requiredString(body: JsonBody, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** 取必填数字。 */
function requiredNumber(body: JsonBody, key: string): number | undefined {
  const value = body[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 租约请求的公共字段（acquire 与 adopt 共用）。 */
interface LeaseInput {
  sessionKey: string
  nodeId: string
  holder: string
  ttlMs?: number
  /** 归属用户（acquire 时由节点给出；跨节点配额计数用）。 */
  userId?: string
}

/**
 * 解析租约请求；字段缺失或 ttl 非法时返回 undefined。
 * @param body - 请求体。
 * @returns 解析结果。
 */
function parseLeaseInput(body: JsonBody): LeaseInput | undefined {
  const sessionKey = requiredString(body, 'sessionKey')
  const nodeId = requiredString(body, 'nodeId')
  const holder = requiredString(body, 'holder')
  const ttlMs = body.ttlMs
  const userId = requiredString(body, 'userId')
  if (sessionKey === undefined || nodeId === undefined || holder === undefined
    || (ttlMs !== undefined && (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0))) return undefined
  return {
    sessionKey,
    nodeId,
    holder,
    ...(ttlMs === undefined ? {} : { ttlMs }),
    ...(userId === undefined ? {} : { userId }),
  }
}

/** 解析负载字段（缺省即可选字段）。 */
function parseLoad(body: JsonBody): NodeLoad | undefined {
  const activeSessions = requiredNumber(body, 'activeSessions')
  if (activeSessions === undefined) return undefined
  const load: NodeLoad = { activeSessions }
  for (const key of ['cpuPercent', 'memPercent', 'queueDepth'] as const) {
    const value = body[key]
    if (typeof value === 'number' && Number.isFinite(value)) load[key] = value
  }
  return load
}

/** 判断字符串是否是合法节点状态。 */
function isNodeState(value: unknown): value is NodeState {
  return value === 'active' || value === 'draining' || value === 'down'
}

/**
 * 解析扩容策略（线协议边界）。
 * @param body - 请求体。
 * @returns 合法策略；字段缺失或越界时 undefined。
 */
function parseScalePolicy(body: JsonBody): ScalePolicy | undefined {
  const { minNodes, maxNodes, targetUtilization, scaleInThreshold, maxStep } = body
  if (typeof minNodes !== 'number' || !Number.isSafeInteger(minNodes) || minNodes < 1) return undefined
  if (typeof maxNodes !== 'number' || !Number.isSafeInteger(maxNodes) || maxNodes < minNodes) return undefined
  if (typeof targetUtilization !== 'number' || !Number.isFinite(targetUtilization)
    || targetUtilization <= 0 || targetUtilization > 1) return undefined
  if (typeof scaleInThreshold !== 'number' || !Number.isFinite(scaleInThreshold)
    || scaleInThreshold <= 0 || scaleInThreshold >= targetUtilization) return undefined
  if (typeof maxStep !== 'number' || !Number.isSafeInteger(maxStep) || maxStep < 1) return undefined
  return { minNodes, maxNodes, targetUtilization, scaleInThreshold, maxStep }
}

/**
 * 解析一条工作区清单条目（相对路径、内容摘要、字节数）。
 *
 * 路径必须是 POSIX 相对路径且不含 `..`：清单会被远端节点还原到本地磁盘，
 * 越界路径等于把写入引到工作区之外。
 * @param value - 原始条目。
 * @returns 合法条目；非法时 undefined。
 */
function parseWorkspaceEntry(value: unknown): WorkspaceFileEntry | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entry = value as Record<string, unknown>
  const path = entry.path
  const digest = entry.digest
  const size = entry.size
  if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.includes('\\')
    || path.split('/').includes('..')) return undefined
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/u.test(digest)) return undefined
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return undefined
  return { path, digest, size }
}

/**
 * 构造控制面 HTTP 服务（未监听）。
 * @param control - 控制面服务。
 * @returns Node HTTP 服务。
 */
export function createControlServer(control: ControlPlane): Server {
  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://control.local')
      const path = url.pathname
      const method = request.method ?? 'GET'
      const body = method === 'POST' ? await readJson(request) : {}
      if (body === undefined) {
        writeJson(response, 400, { ok: false, code: 'MALFORMED_JSON', message: 'request body must be a JSON object' })
        return
      }
      try {
        if (method === 'GET' && path === '/health') {
          writeJson(response, 200, { ok: true, nodes: (await control.nodes()).length })
          return
        }
        if (method === 'GET' && path === '/v1/nodes') {
          writeJson(response, 200, { ok: true, nodes: await control.nodes() })
          return
        }
        if (method === 'POST' && path === '/v1/nodes/register') {
          const nodeId = requiredString(body, 'nodeId')
          const endpoint = requiredString(body, 'endpoint')
          const region = requiredString(body, 'region')
          const maxSessions = requiredNumber(body, 'maxSessions')
          const labels = body.labels
          if (nodeId === undefined || endpoint === undefined || region === undefined || maxSessions === undefined
            || (labels !== undefined && (labels === null || typeof labels !== 'object' || Array.isArray(labels)))) {
            writeJson(response, 400, { ok: false, code: 'INVALID_REGISTER', message: 'nodeId, endpoint, region, maxSessions are required' })
            return
          }
          writeJson(response, 201, {
            ok: true,
            node: await control.register({ nodeId, endpoint, region, maxSessions, labels: (labels ?? {}) as Record<string, string> }),
          })
          return
        }
        if (method === 'POST' && path === '/v1/nodes/heartbeat') {
          const nodeId = requiredString(body, 'nodeId')
          const load = parseLoad(body)
          if (nodeId === undefined || load === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_HEARTBEAT', message: 'nodeId and activeSessions are required' })
            return
          }
          const node = await control.heartbeat(nodeId, load)
          writeJson(response, node === undefined ? 404 : 200, node === undefined
            ? { ok: false, code: 'NODE_UNKNOWN', message: `node ${nodeId} is not registered` }
            : { ok: true, node })
          return
        }
        if (method === 'POST' && path === '/v1/nodes/state') {
          const nodeId = requiredString(body, 'nodeId')
          const state = body.state
          if (nodeId === undefined || !isNodeState(state)) {
            writeJson(response, 400, { ok: false, code: 'INVALID_STATE', message: 'nodeId and state (active|draining|down) are required' })
            return
          }
          await control.setState(nodeId, state)
          writeJson(response, 200, { ok: true, node: await control.node(nodeId) })
          return
        }
        if (method === 'POST' && path === '/v1/nodes/drain') {
          const nodeId = requiredString(body, 'nodeId')
          const targetNodeId = requiredString(body, 'targetNodeId')
          if (nodeId === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_DRAIN', message: 'nodeId is required' })
            return
          }
          if (await control.node(nodeId) === undefined) {
            writeJson(response, 404, { ok: false, code: 'NODE_UNKNOWN', message: `node ${nodeId} is not registered` })
            return
          }
          if (targetNodeId !== undefined) {
            const target = await control.node(targetNodeId)
            if (target === undefined || target.nodeId === nodeId || target.stale || target.state !== 'active') {
              writeJson(response, 409, {
                ok: false,
                code: 'DRAIN_TARGET_INELIGIBLE',
                message: `target node ${targetNodeId} must be a live active node other than ${nodeId}`,
              })
              return
            }
          }
          const result = await control.drain(nodeId, targetNodeId)
          writeJson(response, result.targetNodeId === '' ? 409 : 200, {
            ok: result.targetNodeId !== '',
            ...result,
            ...result.targetNodeId === ''
              ? { code: 'DRAIN_NO_TARGET', message: `no active node can take sessions from ${nodeId}` }
              : {},
          })
          return
        }
        if (method === 'POST' && path === '/v1/nodes/scale-plan') {
          const policy = parseScalePolicy(body)
          if (policy === undefined) {
            writeJson(response, 400, {
              ok: false,
              code: 'INVALID_SCALE_POLICY',
              message: 'minNodes>=1, maxNodes>=minNodes, 0<scaleInThreshold<targetUtilization<=1, maxStep>=1 are required',
            })
            return
          }
          writeJson(response, 200, { ok: true, decision: await control.scalePlan(policy) })
          return
        }
        if (method === 'POST' && path === '/v1/place') {
          const sessionKey = requiredString(body, 'sessionKey')
          const requiredLabels = body.requiredLabels
          const userId = body.userId
          if (sessionKey === undefined
            || (userId !== undefined && (typeof userId !== 'string' || userId === ''))
            || (requiredLabels !== undefined && (requiredLabels === null || typeof requiredLabels !== 'object' || Array.isArray(requiredLabels)))) {
            writeJson(response, 400, { ok: false, code: 'INVALID_PLACEMENT', message: 'sessionKey is required' })
            return
          }
          const decision = await control.place({
            sessionKey,
            requiredLabels: (requiredLabels ?? {}) as Record<string, string>,
            ...(typeof userId === 'string' ? { userId } : {}),
          })
          // 429 与 503 可区分（W10.10）：用户配额拒绝 → 429；集群无容量 → 503。
          const status = decision.reason === 'no-capacity' ? 503 : decision.reason === 'quota-exceeded' ? 429 : 200
          writeJson(response, status, { ok: decision.reason !== 'no-capacity' && decision.reason !== 'quota-exceeded', decision })
          return
        }
        if (method === 'POST' && path === '/v1/leases/get') {
          const sessionKey = requiredString(body, 'sessionKey')
          if (sessionKey === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_LEASE', message: 'sessionKey is required' })
            return
          }
          writeJson(response, 200, { ok: true, lease: await control.lease(sessionKey) ?? null })
          return
        }
        if (method === 'POST' && path === '/v1/nodes/get') {
          const nodeId = requiredString(body, 'nodeId')
          if (nodeId === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_NODE', message: 'nodeId is required' })
            return
          }
          writeJson(response, 200, { ok: true, node: await control.node(nodeId) ?? null })
          return
        }
        if (method === 'POST' && path === '/v1/leases/acquire') {
          const input = parseLeaseInput(body)
          if (input === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_LEASE', message: 'sessionKey, nodeId, holder are required' })
            return
          }
          const result = await control.acquireLease(input)
          // 429 与 409 可区分（W10.10）：用户并发配额 → 429；会话已被其他写者持有 → 409。
          writeJson(response, result.ok ? 200 : result.code === 'QUOTA_EXCEEDED' ? 429 : 409, result)
          return
        }
        if (method === 'POST' && path === '/v1/leases/adopt') {
          const input = parseLeaseInput(body)
          if (input === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_LEASE', message: 'sessionKey, nodeId, holder are required' })
            return
          }
          const lease = await control.adoptLease(input)
          writeJson(response, lease === undefined ? 409 : 200, { ok: lease !== undefined, lease: lease ?? null })
          return
        }
        if (method === 'POST' && path === '/v1/leases/renew') {
          const sessionKey = requiredString(body, 'sessionKey')
          const holder = requiredString(body, 'holder')
          const epoch = requiredNumber(body, 'epoch')
          const ttlMs = body.ttlMs
          if (sessionKey === undefined || holder === undefined || epoch === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_LEASE', message: 'sessionKey, holder, epoch are required' })
            return
          }
          const renewed = await control.renewLease({ sessionKey, holder, epoch, ...(typeof ttlMs === 'number' ? { ttlMs } : {}) })
          writeJson(response, renewed ? 200 : 409, { ok: renewed })
          return
        }
        if (method === 'POST' && path === '/v1/leases/release') {
          const sessionKey = requiredString(body, 'sessionKey')
          const holder = requiredString(body, 'holder')
          const epoch = requiredNumber(body, 'epoch')
          if (sessionKey === undefined || holder === undefined || epoch === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_LEASE', message: 'sessionKey, holder, epoch are required' })
            return
          }
          writeJson(response, 200, { ok: await control.releaseLease({ sessionKey, holder, epoch }) })
          return
        }
        if (method === 'POST' && path === '/v1/leases/check') {
          const sessionKey = requiredString(body, 'sessionKey')
          const epoch = requiredNumber(body, 'epoch')
          if (sessionKey === undefined || epoch === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_LEASE', message: 'sessionKey and epoch are required' })
            return
          }
          writeJson(response, 200, {
            ok: true,
            writer: await control.assertWriter(sessionKey, epoch),
            lease: await control.lease(sessionKey) ?? null,
          })
          return
        }
        if (method === 'POST' && path === '/v1/usage') {
          const userId = requiredString(body, 'userId')
          const sessionKey = requiredString(body, 'sessionKey')
          const tokens = requiredNumber(body, 'tokens')
          const reportedAt = body.reportedAt
          const sourceSeq = body.sourceSeq
          if (userId === undefined || sessionKey === undefined || tokens === undefined || tokens < 0
            || !Number.isSafeInteger(tokens)
            || (reportedAt !== undefined && (typeof reportedAt !== 'string' || !Number.isFinite(Date.parse(reportedAt))))
            || (sourceSeq !== undefined && (typeof sourceSeq !== 'number' || !Number.isSafeInteger(sourceSeq) || sourceSeq < 0))) {
            writeJson(response, 400, {
              ok: false,
              code: 'INVALID_USAGE',
              message: 'userId, sessionKey and a non-negative integer tokens are required',
            })
            return
          }
          await control.recordUsage({
            userId,
            sessionKey,
            tokens,
            reportedAt: reportedAt ?? new Date().toISOString(),
            ...sourceSeq === undefined ? {} : { sourceSeq },
          })
          writeJson(response, 201, { ok: true })
          return
        }
        if (method === 'GET' && path === '/v1/usage') {
          const userId = url.searchParams.get('userId')
          writeJson(response, 200, {
            ok: true,
            usage: await control.usage(userId === null || userId === '' ? {} : { userId }),
          })
          return
        }
        if (method === 'POST' && path === '/v1/workspaces/put') {
          const sessionKey = requiredString(body, 'sessionKey')
          const rawFiles = body.files
          const files: WorkspaceFileEntry[] = []
          let valid = true
          if (Array.isArray(rawFiles)) {
            for (const raw of rawFiles) {
              const entry = parseWorkspaceEntry(raw)
              if (entry === undefined) {
                valid = false
                break
              }
              files.push(entry)
            }
          } else {
            valid = false
          }
          if (sessionKey === undefined || !valid) {
            writeJson(response, 400, {
              ok: false,
              code: 'INVALID_WORKSPACE',
              message: 'sessionKey and files[{ path (relative, no ".."), digest (64 hex), size }] are required',
            })
            return
          }
          await control.saveWorkspace(sessionKey, files)
          writeJson(response, 201, { ok: true, files: files.length })
          return
        }
        if (method === 'POST' && path === '/v1/workspaces/get') {
          const sessionKey = requiredString(body, 'sessionKey')
          if (sessionKey === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_WORKSPACE', message: 'sessionKey is required' })
            return
          }
          writeJson(response, 200, { ok: true, files: await control.workspace(sessionKey) })
          return
        }
        if (method === 'POST' && path === '/v1/sessions/events') {
          const sessionKey = requiredString(body, 'sessionKey')
          if (sessionKey === undefined) {
            writeJson(response, 400, { ok: false, code: 'INVALID_EVENT_QUERY', message: 'sessionKey is required' })
            return
          }
          writeJson(response, 200, { ok: true, events: await control.events(sessionKey) })
          return
        }
        writeJson(response, 404, { ok: false, code: 'NOT_FOUND', message: `${method} ${path} is not a control-plane route` })
      } catch (error) {
        writeJson(response, 500, {
          ok: false,
          code: 'CONTROL_FAILURE',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  })
}
