/**
 * 云网关（W10.6）：无状态入口，按会话租约把请求字节级转发到节点。
 *
 * 路由顺序：租约（带短 TTL 缓存）→ 未命中则触发放置（W5）→ 转发到目标节点。
 * 网关**不解析**节点内的 RPC/事件流：HTTP 请求体与响应体按流管道转发，WebSocket 升级按原始
 * 握手行 + 头部重放后双向 pipe。鉴权由调用方注入的 `authorize` 承担（共享签名密钥在网关侧
 * 校验），控制面进程本身不在此链路上。
 *
 * @module @soloengine/cloud-control/gateway
 */

import {
  createServer, request as httpRequest,
  type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse,
} from 'node:http'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import type { ControlApi } from './api.ts'
import type { PlacementDecision, SessionLease } from './contracts.ts'

/** 租约缓存项。 */
interface CachedRoute {
  /** 节点入口。 */
  endpoint: string
  /** 节点标识。 */
  nodeId: string
  /** 租约 epoch（0 表示放置结果尚未落租约）。 */
  epoch: number
  /** 缓存到期时间（毫秒时间戳）。 */
  expiresAt: number
}

/** 网关向节点转发的用户身份头（由网关独占写入，客户端同名头一律被剥离）。 */
export const GATEWAY_USER_HEADER = 'x-soloengine-user'

/**
 * 网关独占的请求头：客户端自带的同名头一律剔除，只有网关能写入。
 *
 * 只剔网关自己写入的这几个（而不是整个 `x-soloengine-*` 前缀）：`x-soloengine-signature` 与
 * `x-soloengine-timestamp` 由客户端携带、供节点校验会话签名，必须原样转发。
 */
const GATEWAY_OWNED_HEADERS = new Set([GATEWAY_USER_HEADER, 'x-soloengine-placement', 'x-soloengine-node'])

/**
 * 该请求头是否由网关独占写入。
 * @param name - 请求头名称。
 * @returns 是否必须剔除。
 */
function isGatewayOwnedHeader(name: string): boolean {
  return GATEWAY_OWNED_HEADERS.has(name.toLowerCase())
}

/**
 * 会话归属校验（需求 §0.1.4 / 187 的云形态）。
 *
 * 网关本身不持有用户凭据（它只有共享签名密钥），故这两个事实必须由**终止用户凭据的
 * 部署**给出：`userIdOf` 回答「这条请求已经验证过的账号」，`ownerOf` 回答「共享业务台账
 * 里这个会话的归属用户」（真源是 `sessions.user_id`）。未注入时网关不做用户维度判定，
 * 由节点用同一份签名 cookie 与同一份台账拒绝跨用户会话（与单机形态同一判定）。
 */
export interface GatewaySessionOwnership {
  /**
   * 读本请求已验证的账号身份（部署在网关前终止用户凭据时给出）。
   * @param request - 入站请求。
   * @returns 账号 id；请求没有用户凭据时为 undefined（校验开启时按拒绝处理）。
   */
  userIdOf(request: IncomingMessage): string | undefined
  /**
   * 读会话的归属用户（共享业务台账的 `sessions.user_id`）。
   * @param sessionKey - 会话键（`x-soloengine-session` 头或 `session` 查询参数）。
   * @returns 归属用户 id；会话不存在时为 undefined。
   */
  ownerOf(sessionKey: string): Promise<string | undefined>
}

/** 网关选项。 */
export interface CloudGatewayOptions {
  /** 控制面门面（进程内 `localControlApi` 或跨进程 `RemoteControl`）。 */
  control: ControlApi
  /** 租约缓存 TTL（毫秒，默认 2000）。 */
  cacheTtlMs?: number
  /** 未落租约的放置结果缓存 TTL（毫秒，默认 500）。 */
  pendingTtlMs?: number
  /** 当前时间。 */
  now?: () => Date
  /**
   * 鉴权钩子：返回 true 才转发；返回 false 时网关回 401。
   * 默认只放行回环对端（控制面与节点同机时的开发默认）。
   */
  authorize?: (request: IncomingMessage) => boolean
  /**
   * 会话归属校验：给出时，请求呈现的账号必须与会话归属一致（不一致回 403），
   * 且验证过的账号经 {@link GATEWAY_USER_HEADER} 透传给节点。
   */
  sessionOwnership?: GatewaySessionOwnership
}

/** 一次路由结果。 */
export type GatewayRoute =
  | { ok: true; nodeId: string; endpoint: string; epoch: number; placed: PlacementDecision | null }
  /** 503：集群无容量。 */
  | { ok: false; code: 'NO_CAPACITY'; decision: PlacementDecision }
  /** 429：用户配额拒绝（W10.10 跨节点闸门）。 */
  | { ok: false; code: 'QUOTA_EXCEEDED'; decision: PlacementDecision }

/** 默认鉴权：只放行回环地址。 */
function loopbackOnly(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** 共享签名密钥鉴权的签名头（网关与调用方共用）。 */
export const GATEWAY_SIGNATURE_HEADER = 'x-soloengine-signature'

/** 共享签名密钥鉴权的时间戳头（毫秒字符串，超出允许偏差即拒绝）。 */
export const GATEWAY_TIMESTAMP_HEADER = 'x-soloengine-timestamp'

/** 共享签名密钥鉴权参数。 */
export interface SharedKeyAuthOptions {
  /** 共享密钥（网关与节点/客户端同一份，来自部署密钥，不落库）。 */
  secret: string
  /** 允许的时钟偏差（毫秒，默认 60_000）。 */
  skewMs?: number
  /** 当前时间（毫秒；测试可注入）。 */
  now?: () => number
}

/**
 * 共享签名密钥的规范串：`method\nurl\ntimestamp\nsession`。
 * @param input - 请求方法、URL、时间戳与会话键。
 * @returns 待签名串。
 */
export function gatewaySignaturePayload(input: {
  method: string
  url: string
  timestamp: string
  session: string
}): string {
  return `${input.method}\n${input.url}\n${input.timestamp}\n${input.session}`
}

/**
 * 为一次网关请求签名（调用方与测试共用同一实现）。
 * @param secret - 共享密钥。
 * @param input - 请求方法、URL、时间戳与会话键。
 * @returns 十六进制 HMAC-SHA256。
 */
export function signGatewayRequest(secret: string, input: {
  method: string
  url: string
  timestamp: string
  session: string
}): string {
  return createHmac('sha256', secret).update(gatewaySignaturePayload(input)).digest('hex')
}

/**
 * 读取单值请求头（重复头取第一个）。
 * @param request - 入站请求。
 * @param name - 头名（小写）。
 * @returns 头值；缺失时为空串。
 */
export function headerValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name]
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

/**
 * 构造共享签名密钥鉴权器。
 *
 * 签名字串覆盖方法、URL、时间戳与会话键；时间戳超出允许偏差即拒绝（防重放）。
 * 请求体按字节转发、不在此处读取，故不参与签名——传输层由 TLS 保护（云形态强制 https 入口）。
 * @param options - 密钥、时钟偏差与时钟。
 * @returns 可直接传给 `CloudGateway` 的 `authorize` 钩子。
 */
export function sharedKeyAuthorizer(options: SharedKeyAuthOptions): (request: IncomingMessage) => boolean {
  const skewMs = options.skewMs ?? 60_000
  const now = options.now ?? Date.now
  return (request) => {
    const timestamp = headerValue(request, GATEWAY_TIMESTAMP_HEADER)
    const signature = headerValue(request, GATEWAY_SIGNATURE_HEADER)
    if (timestamp === '' || signature === '') return false
    const issuedAt = Number(timestamp)
    if (!Number.isFinite(issuedAt) || Math.abs(now() - issuedAt) > skewMs) return false
    const url = request.url ?? '/'
    const session = headerValue(request, 'x-soloengine-session')
      || new URL(url, 'http://gateway.local').searchParams.get('session')
      || ''
    const expected = Buffer.from(signGatewayRequest(options.secret, {
      method: request.method ?? 'GET',
      url,
      timestamp,
      session,
    }), 'hex')
    const given = Buffer.from(signature, 'hex')
    return given.length === expected.length && timingSafeEqual(given, expected)
  }
}

/** 静态对象读取面：不可变内容（前端首帧资源等），键即内容摘要或稳定路径。 */
export interface StaticObjectSource {
  /**
   * 读取一个对象。
   * @param key - 对象键（网关已拒绝 `..`、绝对路径与反斜杠）。
   * @returns 内容与 content-type；不存在时 undefined。
   */
  read(key: string): Promise<{ body: Buffer; contentType: string } | undefined>
}

/** 对象键的字面量约束（内容寻址的十六进制摘要或正常相对路径）。 */
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/u

/** 云网关。 */
export class CloudGateway {
  private readonly control: ControlApi
  private readonly cacheTtlMs: number
  private readonly pendingTtlMs: number
  private readonly now: () => Date
  private readonly authorize: (request: IncomingMessage) => boolean
  private readonly sessionOwnership: GatewaySessionOwnership | undefined
  private readonly cache = new Map<string, CachedRoute>()

  /**
   * @param options - 控制面、缓存 TTL、时钟、鉴权钩子与会话归属校验。
   */
  constructor(options: CloudGatewayOptions) {
    this.control = options.control
    this.cacheTtlMs = options.cacheTtlMs ?? 2_000
    this.pendingTtlMs = options.pendingTtlMs ?? 500
    this.now = options.now ?? (() => new Date())
    this.authorize = options.authorize ?? loopbackOnly
    this.sessionOwnership = options.sessionOwnership
  }

  /**
   * 校验一次请求的会话归属，并给出要透传给节点的账号身份。
   *
   * 未注入归属校验时：一律放行，且剥离客户端自带的用户身份头（身份头只由网关写）。
   * 注入时：请求没有已验证账号、或会话归属与账号不一致，都按拒绝处理（fail closed）。
   * @param request - 入站请求。
   * @param sessionKey - 请求命中的会话键。
   * @returns 允许转发时的账号身份（可为 undefined），或拒绝。
   */
  private async ownershipOf(
    request: IncomingMessage,
    sessionKey: string,
  ): Promise<{ ok: true; userId: string | undefined } | { ok: false }> {
    const ownership = this.sessionOwnership
    if (ownership === undefined) return { ok: true, userId: undefined }
    const userId = ownership.userIdOf(request)
    if (userId === undefined) return { ok: false }
    const owner = await ownership.ownerOf(sessionKey)
    if (owner === undefined || owner !== userId) return { ok: false }
    return { ok: true, userId }
  }

  /**
   * 解析会话的目标节点。
   * @param sessionKey - 会话键。
   * @param userId - 已验证的归属用户（会话归属校验开启时给出；配额闸门据此统计）。
   * @returns 路由结果（无容量或超配额时 `ok: false`）。
   */
  async route(sessionKey: string, userId?: string): Promise<GatewayRoute> {
    const nowMs = this.now().getTime()
    const cached = this.cache.get(sessionKey)
    if (cached !== undefined && cached.expiresAt > nowMs) {
      return { ok: true, nodeId: cached.nodeId, endpoint: cached.endpoint, epoch: cached.epoch, placed: null }
    }
    const lease: SessionLease | undefined = await this.control.lease(sessionKey)
    if (lease !== undefined && Date.parse(lease.expiresAt) > nowMs) {
      const node = await this.control.node(lease.nodeId)
      if (node !== undefined) {
        this.cache.set(sessionKey, {
          endpoint: node.endpoint, nodeId: node.nodeId, epoch: lease.epoch, expiresAt: nowMs + this.cacheTtlMs,
        })
        return { ok: true, nodeId: node.nodeId, endpoint: node.endpoint, epoch: lease.epoch, placed: null }
      }
    }
    const decision = await this.control.place({
      sessionKey,
      ...(userId === undefined ? {} : { userId }),
    })
    if (decision.reason === 'quota-exceeded') return { ok: false, code: 'QUOTA_EXCEEDED', decision }
    if (decision.reason === 'no-capacity') return { ok: false, code: 'NO_CAPACITY', decision }
    const node = await this.control.node(decision.nodeId)
    if (node === undefined) return { ok: false, code: 'NO_CAPACITY', decision }
    this.cache.set(sessionKey, {
      endpoint: node.endpoint, nodeId: node.nodeId, epoch: 0, expiresAt: nowMs + this.pendingTtlMs,
    })
    return { ok: true, nodeId: node.nodeId, endpoint: node.endpoint, epoch: 0, placed: decision }
  }

  /**
   * 让某会话的缓存立即失效（可选运维钩子：已知租约被接管时可提前改道）。
   *
   * 正确性不依赖它：缓存只存活一个 TTL，且旧节点上的写入会被租约 epoch 围栏拒绝。
   * @param sessionKey - 会话键。
   */
  invalidate(sessionKey: string): void {
    this.cache.delete(sessionKey)
  }

  /**
   * 转发一次 HTTP 请求（流式，不解析协议体）。
   * @param request - 入站请求。
   * @param response - 出站响应。
   * @param sessionKey - 会话键。
   */
  async forwardHttp(request: IncomingMessage, response: ServerResponse, sessionKey: string): Promise<void> {
    if (!this.authorize(request)) {
      response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: false, code: 'UNAUTHORIZED', message: 'gateway rejected the request' }))
      return
    }
    const ownership = await this.ownershipOf(request, sessionKey)
    if (!ownership.ok) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({
        ok: false, code: 'SESSION_FORBIDDEN', message: 'the presented account does not own this session',
      }))
      return
    }
    const route = await this.route(sessionKey, ownership.userId)
    if (!route.ok) {
      const quota = route.code === 'QUOTA_EXCEEDED'
      response.writeHead(quota ? 429 : 503, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(quota
        ? { ok: false, code: 'QUOTA_EXCEEDED', message: 'the account has reached its concurrent-session quota' }
        : { ok: false, code: 'NO_CAPACITY', message: 'no node can take this session' }))
      return
    }
    const target = new URL(route.endpoint)
    // 逐项复制并跳过客户端自带的身份头：只有网关写入的已验证账号能到达节点。
    const headers: IncomingHttpHeaders = {}
    for (const [name, value] of Object.entries(request.headers)) {
      if (!isGatewayOwnedHeader(name) && value !== undefined) headers[name] = value
    }
    headers.host = target.host
    if (route.placed !== null) headers['x-soloengine-placement'] = route.nodeId
    if (ownership.userId !== undefined) headers[GATEWAY_USER_HEADER] = ownership.userId
    const upstream = httpRequest({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: request.method,
      path: request.url,
      headers,
    }, (upstreamResponse) => {
      // 应答标明服务节点：节点 id 是部署拓扑标识（非敏感），排障与多节点取证都靠它判断改道结果。
      response.writeHead(upstreamResponse.statusCode ?? 502, { ...upstreamResponse.headers, 'x-soloengine-node': route.nodeId })
      upstreamResponse.pipe(response)
    })
    upstream.on('error', (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ ok: false, code: 'NODE_UNREACHABLE', message: error.message }))
      } else {
        response.destroy(error)
      }
    })
    request.pipe(upstream)
  }

  /**
   * 转发 WebSocket 升级（原始握手行 + 头部重放，随后双向 pipe）。
   * @param request - 入站升级请求。
   * @param clientSocket - 客户端套接字。
   * @param head - 已读的头部字节。
   * @param sessionKey - 会话键。
   */
  forwardUpgrade(request: IncomingMessage, clientSocket: Duplex, head: Buffer, sessionKey: string): void {
    if (!this.authorize(request)) {
      clientSocket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
      return
    }
    void this.ownershipOf(request, sessionKey).then((ownership) => {
      if (!ownership.ok) {
        clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
      }
      void this.route(sessionKey, ownership.userId).then((route) => {
        if (!route.ok) {
          clientSocket.end(route.code === 'QUOTA_EXCEEDED'
            ? 'HTTP/1.1 429 Too Many Requests\r\n\r\n'
            : 'HTTP/1.1 503 Service Unavailable\r\n\r\n')
          return
        }
        this.pipeUpgrade(request, clientSocket, head, route, ownership.userId)
      }, () => { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') })
    }, () => { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') })
  }

  /** 建立到目标节点的原始 TCP 连接并重放握手（用户身份头由网关独占写入）。 */
  private pipeUpgrade(
    request: IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
    route: Extract<GatewayRoute, { ok: true }>,
    userId: string | undefined,
  ): void {
    const target = new URL(route.endpoint)
    const upstream = connect(Number(target.port || (target.protocol === 'https:' ? 443 : 80)), target.hostname, () => {
      const headers = Object.entries(request.headers)
        .filter(([name]) => !isGatewayOwnedHeader(name))
        .flatMap(([name, value]) => value === undefined ? [] : `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
      if (userId !== undefined) headers.push(`${GATEWAY_USER_HEADER}: ${userId}`)
      const handshake = `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`
      upstream.write(handshake)
      if (head.length > 0) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', () => { clientSocket.destroy() })
    clientSocket.on('error', () => { upstream.destroy() })
  }
}

/**
 * 构造网关 HTTP 服务：`/health` 与 `/objects/*`（不可变静态对象）本地应答，其余路径按
 * `x-soloengine-session` 头或 `session` 查询参数路由；带 upgrade 的连接走
 * {@link CloudGateway.forwardUpgrade}。
 *
 * `/objects/*` 不参与会话签名：内容是内容寻址的不可变首帧资源，浏览器在拿到会话前就要取它们；
 * 会话路由本身仍由 `authorize` 把关。
 * @param gateway - 云网关。
 * @param options - 兜底会话键、静态对象面（省略时 `/objects/*` 按未配置返回 404）。
 * @returns Node HTTP 服务。
 */
export function createGatewayServer(gateway: CloudGateway, options: {
  requireSession?: boolean
  objects?: StaticObjectSource
} = {}): Server {
  const requireSession = options.requireSession ?? true
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://gateway.local')
        if (url.pathname === '/health') {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ ok: true }))
          return
        }
        if (url.pathname.startsWith('/objects/')) {
          await serveObject(options.objects, request, response, url.pathname.slice('/objects/'.length))
          return
        }
        const header = request.headers['x-soloengine-session']
        const sessionKey = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get('session') ?? ''
        if (sessionKey === '' && requireSession) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ ok: false, code: 'SESSION_REQUIRED', message: 'x-soloengine-session header or session query is required' }))
          return
        }
        await gateway.forwardHttp(request, response, sessionKey)
      } catch (error) {
        // 控制面不可达/内部错误不能把网关进程带走：按上游错误应答（客户端可重试）。
        const message = error instanceof Error ? error.message : String(error)
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ ok: false, code: 'CONTROL_UNAVAILABLE', message }))
        } else {
          response.destroy(error instanceof Error ? error : undefined)
        }
      }
    })()
  })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://gateway.local')
    const header = request.headers['x-soloengine-session']
    const sessionKey = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get('session') ?? ''
    gateway.forwardUpgrade(request, socket, head, sessionKey)
  })
  return server
}

/**
 * 应答一个不可变静态对象（GET/HEAD + ETag 条件请求）。
 * @param source - 对象读取面；未配置时一律 404。
 * @param request - 入站请求。
 * @param response - 出站响应。
 * @param rawKey - URL 路径里的对象键（尚未解码）。
 */
async function serveObject(
  source: StaticObjectSource | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  rawKey: string,
): Promise<void> {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'static objects are read-only' }))
    return
  }
  let key: string
  try {
    key = decodeURIComponent(rawKey)
  } catch {
    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: false, code: 'OBJECT_KEY_INVALID', message: 'object key is not valid percent-encoding' }))
    return
  }
  if (source === undefined || !OBJECT_KEY_PATTERN.test(key) || key.split('/').includes('..')) {
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: false, code: 'OBJECT_NOT_FOUND', message: `no static object ${key}` }))
    return
  }
  const object = await source.read(key)
  if (object === undefined) {
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: false, code: 'OBJECT_NOT_FOUND', message: `no static object ${key}` }))
    return
  }
  const etag = `"sha256-${createHash('sha256').update(object.body).digest('hex')}"`
  const headers = {
    'content-type': object.contentType,
    'content-length': String(object.body.length),
    'cache-control': 'public, max-age=31536000, immutable',
    etag,
  }
  if (headerValue(request, 'if-none-match') === etag) {
    response.writeHead(304, headers)
    response.end()
    return
  }
  response.writeHead(200, headers)
  response.end(method === 'HEAD' ? undefined : object.body)
}
