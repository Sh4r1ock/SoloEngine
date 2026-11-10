/** Host registry and HTTP adapter for generic Connection RPC channels. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PeerId, PeerScope, Principal } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionInteractions } from './connect-protocol.ts'
import {
  INSTANCE_HEADER,
  INSTANCE_PARAM,
  RpcId,
  type ClientRequest,
  type RpcId as RpcIdType,
} from './rpc.ts'
import { clientRequestSchema } from './rpc-schema.ts'
import { bridge } from './http-bridge.ts'
import { isRemoteAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import type { BrowserAuth } from './browser-auth.ts'
import { Peer } from './peer.ts'
import type {
  PeerAdmission,
  ConnectionAdmission,
  ConnectionCookieResponse,
  ConnectionIndexBootstrap,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionFetchRoute,
  ConnectionFetchHandler,
  ConnectionAccountScope,
  HostConnectionFetch,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcResult,
  ConnectionRequestRejection,
  ConnectionTrustRequest,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/
/**
 * Named-argument keys that carry the top-level Session identity in native Remote
 * wire arguments. A subagent address names both its durable parent Session and
 * an ephemeral child transcript; only the parent is a ledger row, so the child
 * identity is deliberately not an ownership question of its own.
 */
const SESSION_IDENTITY_KEYS: ReadonlySet<string> = new Set(['sessionId', 'parentSessionId'])
/** Payload nesting bound for identity collection; native arguments nest at most argument → request → address. */
const SESSION_IDENTITY_DEPTH = 6

/**
 * Collect every Session identity a native RPC payload names.
 * @param payload - decoded RPC payload of the form `{ args: {...} }` or a bare arguments object.
 * @returns distinct non-empty Session identities; empty when the call names none.
 */
function sessionIdentitiesOf(payload: unknown): string[] {
  const found = new Set<string>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > SESSION_IDENTITY_DEPTH || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (SESSION_IDENTITY_KEYS.has(key) && typeof item === 'string' && item !== '') {
        found.add(item)
        continue
      }
      visit(item, depth + 1)
    }
  }
  visit(payload, 0)
  return [...found]
}

interface PeerRecord {
  readonly peer: Peer
  ownsSocket: boolean
}

/**
 * Read the product instance one request addresses.
 *
 * A page sets the header; a WebSocket upgrade cannot carry custom headers, so
 * its URL query carries the same value. Connection never interprets the text.
 * @param request - headers and, for upgrades, the request target.
 * @returns the instance text, or undefined when the request names none.
 */
function instanceOf(request: ConnectionTrustRequest): string | undefined {
  const headers = request.headers
  const rawHeader = headers instanceof Headers
    ? headers.get(INSTANCE_HEADER) ?? undefined
    : headers[INSTANCE_HEADER]
  const fromHeader = typeof rawHeader === 'string' ? rawHeader : rawHeader?.[0]
  if (fromHeader !== undefined && fromHeader.trim() !== '') return fromHeader.trim()
  if (request.url === undefined) return undefined
  const value = new URL(request.url, 'http://dsh.invalid').searchParams.get(INSTANCE_PARAM)?.trim()
  return value === undefined || value === '' ? undefined : value
}

/** How the registered account scope treats one admitted Peer. */
type AccountOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'operator' }
  | { readonly kind: 'unbound' }
  | {
    readonly kind: 'account'
    readonly scope: ConnectionAccountScope
    readonly userId: string
    /** Product instance the request named; undefined addresses the whole account. */
    readonly instance: string | undefined
  }

/**
 * Exhaustiveness check for the closed account-outcome union.
 * @param value - value proved unreachable by the union.
 * @returns never.
 */
function assertNever(value: never): never {
  throw new Error(`client-connection: unreachable account outcome ${JSON.stringify(value)}`)
}

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly fetchHandler: ConnectionFetchHandler
}

interface RegisteredFetchRoute {
  readonly methods: ReadonlySet<string>
  readonly requestBody: ConnectionFetchRoute['requestBody']
  readonly fetch: ConnectionFetchRoute['fetch']
}

interface ConnectionServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcIdType
  readonly result: ConnectionRpcResult<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  /** The Peer every authenticated browser connection shares. */
  readonly browserPeer: PeerScope
  private readonly peers = new Map<PeerId, PeerRecord>()
  /** One browser Peer per account and product instance; unbound cookies share {@link browserPeer}. */
  private readonly browserPeers = new Map<string, Peer>()
  /** Product account of each account-bound browser Peer. */
  private readonly userOfPeer = new Map<PeerId, string>()
  /** Product instance of each instance-scoped browser Peer. */
  private readonly instanceOfPeer = new Map<PeerId, string>()
  private accountScope: ConnectionAccountScope | undefined
  private readonly owner: Context
  private disposed = false
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()
  private readonly fetchRoutes = new Map<string, RegisteredFetchRoute>()

  readonly allowsRemoteAuthorities: boolean

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by the Host/Origin fence.
   * @param browserAuth - process token and persistent browser-session owner.
   */
  constructor(
    ctx: Context,
    private readonly trustedHosts: readonly string[],
    private readonly browserAuth: BrowserAuth,
  ) {
    super(ctx, 'connection')
    this.owner = ctx
    this.browserPeer = new Peer(ctx, { principal: { kind: 'owner' } })
    ctx.effect(() => async () => {
      this.disposed = true
      const peers = [
        this.browserPeer,
        ...Array.from(this.browserPeers.values()),
        ...Array.from(this.peers.values(), record => record.peer),
      ]
      this.browserPeers.clear()
      this.userOfPeer.clear()
      this.instanceOfPeer.clear()
      this.peers.clear()
      await Promise.all(peers.map(peer => peer.dispose()))
    }, 'client-connection: Peer scopes')
    this.allowsRemoteAuthorities = trustedHosts.some(isRemoteAuthority)
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc {
    const owner = this.ctx
    return {
      handle: (channel, handler) => this.register(owner, channel, handler),
      intercept: (channel, matches, handler) =>
        this.registerInterceptor(owner, channel, matches, handler),
    }
  }

  /** Exact Fetch-route registry scoped to the Context reading this service. */
  get fetch(): HostConnectionFetch {
    const owner = this.ctx
    return {
      register: route => this.registerFetchRoute(owner, route),
    }
  }

  /** Apply the Host/Origin fence and require an authenticated live Peer. */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection {
    const admission = this.admit(request)
    return 'rejection' in admission ? admission.rejection : undefined
  }

  /** Browser requests share an owner Peer; a login-bound cookie speaks for its own account Peer. */
  admit(request: ConnectionTrustRequest): PeerAdmission {
    if (!this.isTrusted(request)) return { rejection: 403 }
    if (this.disposed) return { rejection: 401 }
    const secure = this.owner.get('webServer')?.protocol === 'https:'
    if (this.browserAuth.isAuthenticated(request, secure)) {
      const userId = this.browserAuth.browserUserId(request, secure)
      return {
        peer: userId === undefined
          ? this.browserPeer
          : this.browserPeerFor(userId, instanceOf(request)),
      }
    }
    const id = this.browserAuth.authenticateApi(request, secure)
    const record = id === undefined ? undefined : this.peers.get(id)
    return record === undefined ? { rejection: 401 } : { peer: record.peer }
  }

  /**
   * Bind this browser's cookie to the product account a successful login proved.
   * @param request - the login request; only a trusted authority may be bound.
   * @param response - response receiving the renewed cookie.
   * @param userId - account identity the login proved.
   * @returns whether a cookie was written.
   */
  bindBrowserUser(
    request: ConnectionTrustRequest,
    response: ConnectionCookieResponse,
    userId: string,
  ): boolean {
    if (!this.isTrusted(request) || this.disposed) return false
    return this.browserAuth.bindUser(
      request, response, userId, this.owner.get('webServer')?.protocol === 'https:',
    )
  }

  /** Replace the account scope of the mounted product; native-only compositions keep none. */
  setAccountScope(scope: ConnectionAccountScope | undefined): () => void {
    const previous = this.accountScope
    this.accountScope = scope
    return () => {
      if (this.accountScope === scope) this.accountScope = previous
    }
  }

  /**
   * Answer whether a Peer may access every Session identity its payload names.
   *
   * Without a registered scope every call proceeds (native-only deployments).
   * With one, an account-bound browser Peer asks the scope; a browser Peer
   * without a bound account (an older cookie generation, or a launch-token
   * exchange never followed by a product login) is refused, while an API
   * operator Peer created from the process token keeps the deployment
   * operator's access.
   */
  async authorizeSessions(peer: PeerScope, payload: unknown): Promise<boolean> {
    const sessionIds = sessionIdentitiesOf(payload)
    if (sessionIds.length === 0) return true
    return (await this.authorizeSessionIds(peer, sessionIds)) !== false
  }

  /** Answer whether the Peer may access these Session identities. */
  async authorizeSessionIds(peer: PeerScope, sessionIds: readonly string[]): Promise<boolean | undefined> {
    const outcome = this.accountOutcome(peer)
    switch (outcome.kind) {
      case 'none':
      case 'operator':
        return undefined
      case 'unbound':
        return false
      case 'account':
        return await outcome.scope.authorize({
          userId: outcome.userId,
          sessionIds,
          ...outcome.instance === undefined ? {} : { instance: outcome.instance },
        })
      /* v8 ignore next -- closed union. */
      default:
        return assertNever(outcome)
    }
  }

  /** List every Session identity bound to this Peer's account. */
  async ownedSessionIdsOf(peer: PeerScope): Promise<readonly string[] | undefined> {
    const outcome = this.accountOutcome(peer)
    switch (outcome.kind) {
      case 'none':
      case 'operator':
        return undefined
      case 'unbound':
        return []
      case 'account':
        return await outcome.scope.ownedSessions(outcome.userId, outcome.instance)
      /* v8 ignore next -- closed union. */
      default:
        return assertNever(outcome)
    }
  }

  /** List the model route names bound to this Peer's account. */
  async ownedModelRouteNamesOf(peer: PeerScope): Promise<readonly string[] | undefined> {
    const outcome = this.accountOutcome(peer)
    switch (outcome.kind) {
      case 'none':
      case 'operator':
        return undefined
      case 'unbound':
        return []
      case 'account':
        return await outcome.scope.ownedModelRoutes(outcome.userId)
      /* v8 ignore next -- closed union. */
      default:
        return assertNever(outcome)
    }
  }

  /** The product account bound to a Peer's browser connection, when one is bound. */
  accountIdOf(peer: PeerScope): string | undefined {
    return this.userOfPeer.get(peer.id)
  }

  /** How the registered account scope treats one Peer. */
  private accountOutcome(peer: PeerScope): AccountOutcome {
    const scope = this.accountScope
    if (scope === undefined) return { kind: 'none' }
    const userId = this.userOfPeer.get(peer.id)
    if (userId !== undefined) {
      return { kind: 'account', scope, userId, instance: this.instanceOfPeer.get(peer.id) }
    }
    return peer.id === this.browserPeer.id ? { kind: 'unbound' } : { kind: 'operator' }
  }

  /** The browser Peer speaking for one product account and instance, created on first use. */
  private browserPeerFor(userId: string, instance: string | undefined): Peer {
    const key = instance === undefined ? userId : `${userId}\u0000${instance}`
    const existing = this.browserPeers.get(key)
    if (existing !== undefined) return existing
    const peer = new Peer(this.owner, { principal: { kind: 'owner' } })
    this.browserPeers.set(key, peer)
    this.userOfPeer.set(peer.id, userId)
    if (instance !== undefined) this.instanceOfPeer.set(peer.id, instance)
    return peer
  }

  /** Create one in-process Peer owned by the Context that read this service. */
  createPeer(options: { readonly principal: Principal; readonly interactions?: ConnectionInteractions }): PeerScope {
    return new Peer(this.ctx, options)
  }

  /** Claim API socket ownership synchronously; callers release on termination or failed upgrade. */
  admitConnection(request: ConnectionTrustRequest): ConnectionAdmission {
    const admission = this.admit(request)
    if ('rejection' in admission) return admission
    const record = this.peers.get(admission.peer.id)
    if (record === undefined) return { ...admission, release: () => Promise.resolve() }
    if (record.ownsSocket) return { rejection: 409 }
    record.ownsSocket = true
    let released: Promise<void> | undefined
    return {
      peer: record.peer,
      release: () => {
        if (released !== undefined) return released
        this.peers.delete(record.peer.id)
        released = record.peer.dispose()
        return released
      },
    }
  }

  private isTrusted(request: ConnectionTrustRequest): boolean {
    const carrier = this.owner.get('webServer')
    return isTrustedApiRequest(request, this.trustedHosts, carrier?.host, carrier?.protocol ?? 'http:')
  }

  private publishPeer(interactions: ConnectionInteractions): PeerId {
    const peer = new Peer(this.owner, { principal: { kind: 'owner' }, interactions })
    this.peers.set(peer.id, { peer, ownsSocket: false })
    return peer.id
  }

  /**
   * Authenticate and publish a credential before sending the connect redirect.
   * @param request - launch-token request on /connect.
   * @param response - response owned to completion.
   */
  authorizeConnect(request: ConnectionIndexRequest, response: ConnectionIndexResponse): void {
    if (!this.isTrusted(request) || this.disposed) {
      response.writeHead(this.disposed ? 401 : 403)
      response.end(this.disposed ? 'unauthorized' : 'forbidden')
      return
    }
    this.browserAuth.authorizeConnect(request, response,
      this.owner.get('webServer')?.protocol === 'https:', interactions => this.publishPeer(interactions))
  }

  /**
   * Authenticate an index request; native TLS listeners mint Secure cookies.
   */
  authorizeIndex(
    request: ConnectionIndexRequest,
    response: ConnectionIndexResponse,
    bootstrap?: ConnectionIndexBootstrap,
  ): boolean {
    return this.browserAuth.authorizeIndex(
      request, response, this.ctx.get('webServer')?.protocol === 'https:', bootstrap,
    )
  }

  /** Add this process's launch token to the clean application URL. */
  authenticatedUrl(baseUrl: string): string {
    return this.browserAuth.authenticatedUrl(baseUrl)
  }

  /**
   * Compose one shared-channel Fetch handler from exact routes and its interceptor.
   * @param channel - shared channel mounted by Connection.
   * @returns Fetch handler that selects one owner or returns 404.
   */
  createSharedFetchHandler(
    channel: '/api',
  ): ConnectionFetchHandler {
    return {
      requestBodyMode: ({ method, url }) => {
        const route = this.fetchRoutes.get(url.pathname)
        return route?.methods.has(method) === true ? route.requestBody : 'buffered'
      },
      fetch: (request, peer) => {
        const pathname = new URL(request.url).pathname
        const route = this.fetchRoutes.get(pathname)
        if (route?.methods.has(request.method) === true) {
          // Exact routes bypass Gateway access checks, so only the owner reaches them.
          // oxlint-disable-next-line typescript/no-unnecessary-condition -- other packages merge non-owner kinds into PrincipalMap.
          if (peer.principal.kind !== 'owner') return Promise.resolve(new Response('forbidden', { status: 403 }))
          return route.fetch(request)
        }
        const endpoint = endpointFromPath(channel, pathname)
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return Promise.resolve(new Response('not found', { status: 404 }))
        }
        return interceptor.fetchHandler.fetch(request, peer)
      },
    }
  }

  private registerFetchRoute(
    owner: Context,
    route: ConnectionFetchRoute,
  ): () => Promise<void> {
    assertFetchRoute(route)
    const registered: RegisteredFetchRoute = {
      methods: new Set(route.methods),
      requestBody: route.requestBody,
      fetch: route.fetch,
    }
    return owner.effect(() => {
      if (this.fetchRoutes.has(route.path)) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
      }
      this.fetchRoutes.set(route.path, registered)
      return () => { this.fetchRoutes.delete(route.path) }
    }, `client-connection: ${route.path} Fetch route`)
  }

  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    assertChannel(channel)
    const fetchHandler = rpcFetchHandler(channel, handler,
      (peer, payload) => this.authorizeSessions(peer, payload))
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      handler: async (req, res) => {
        const admission = this.admit(req)
        if ('rejection' in admission) {
          res.writeHead(admission.rejection)
          res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
        await bridge(req, res, fetchHandler, admission.peer)
      },
    }
    return owner.effect(
      () => owner.webServer.register(route),
      `client-connection: ${channel} rpc channel`,
    )
  }

  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = {
      matches,
      fetchHandler: rpcFetchHandler(channel, handler,
        (peer, payload) => this.authorizeSessions(peer, payload)),
    }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => {
        this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
  authorize: (peer: PeerScope, payload: unknown) => Promise<boolean>,
): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request: Request, peer: PeerScope): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'gateway/bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        if (!(await authorize(peer, message.payload))) {
          return new Response('forbidden', { status: 403 })
        }
        const result = await handler(endpoint, message.payload, request.signal, peer)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

function invalidEnvelopeResponse(body: unknown, issues: readonly object[]): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'gateway/bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: ConnectionRpcFailure): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: Awaited<ReturnType<ConnectionRpcHandler>>): Response {
  if (!result.ok) {
    const body: ConnectionServerResponse = { type: 'server-response', rpcId, result }
    return Response.json(body)
  }
  const { attachments, ...success } = result
  const body: ConnectionServerResponse = { type: 'server-response', rpcId, result: success }
  if (attachments === undefined || attachments.length === 0) return Response.json(body)
  const parts = new FormData()
  const attachmentMetadata = attachments.map((attachment, index) => {
    const part = `bytes-${index}`
    // FileSystem bytes may have SharedArrayBuffer backing, which BlobPart excludes.
    parts.set(part, new Blob([new Uint8Array(attachment.bytes)]))
    return { path: [...attachment.path], codec: 'bytes' as const, part }
  })
  parts.set('metadata', JSON.stringify({ ...body, attachments: attachmentMetadata }))
  return new Response(parts)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}

function assertFetchRoute(route: ConnectionFetchRoute): void {
  if (endpointFromPath(API_PATH, route.path) === undefined) {
    throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`)
  }
  if (route.methods.length === 0) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`)
  }
  const methods = new Set(route.methods)
  if (methods.size !== route.methods.length) {
    throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`)
  }
}
