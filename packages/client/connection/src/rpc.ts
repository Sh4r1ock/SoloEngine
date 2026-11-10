/** Generic unary RPC contracts shared by the Host and Client Connection halves. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PeerScope, Principal } from '@deepseek-ai/dsh-typert-protocol'

/** Correlation id minted by a caller and echoed by the Connection response. */
export type RpcId = Branded<'rpc-id'>

/**
 * Brand one validated string as a Connection correlation id.
 * @param id - validated wire identity.
 * @returns the same string with the correlation-id brand.
 */
export function RpcId(id: string): RpcId {
  return id as RpcId
}

/** Carrier-neutral failure returned by one logical RPC endpoint. */
export interface ConnectionRpcFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

/** Carrier-neutral result returned by one logical RPC endpoint. */
export type ConnectionRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ConnectionRpcFailure }

/** One binary value separated from a successful RPC result before transport framing. */
export interface ConnectionRpcAttachment {
  /** Result-relative path occupied by the attachment's `null` placeholder. */
  readonly path: readonly (string | number)[]
  /** Byte view carried outside the JSON response metadata. */
  readonly bytes: Uint8Array
}

/** Successful or failed handler result ready for Connection transport framing. */
export type ConnectionRpcHandlerResult =
  | {
    readonly ok: true
    readonly value: unknown
    /** Binary fields already projected by the handler that owns the result protocol. */
    readonly attachments?: readonly ConnectionRpcAttachment[]
  }
  | { readonly ok: false; readonly error: ConnectionRpcFailure }

/** Historical short name for a generic Connection result. */
export type RpcResult<T> = ConnectionRpcResult<T>

/**
 * Convert a rejected transport operation into a generic failure result.
 * @param error - rejected transport value.
 * @returns an `internal` failure preserving the available message.
 */
export function transportError<T>(error: unknown): RpcResult<T> {
  return {
    ok: false,
    error: {
      code: 'gateway/internal',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  }
}

/** Narrow request form used by direct fixture adapters. */
export interface RpcRequest<P> {
  readonly rpcId: RpcId
  readonly payload: P
}

/** Narrow response form used by direct fixture adapters. */
export interface RpcResponse<T> {
  readonly rpcId: RpcId
  readonly result: RpcResult<T>
}

/** Full request envelope carried by Connection RPC transports. */
export interface ClientRequest {
  readonly type: 'client-request'
  readonly rpcId: RpcId
  readonly method: string
  readonly payload: unknown
}

/** Full response envelope carried by Connection RPC transports. */
export interface ServerResponse {
  readonly type: 'server-response'
  readonly rpcId: RpcId
  readonly result: ConnectionRpcResult<unknown>
}

/** Complete Connection RPC envelope union. */
export type RpcMessage = ClientRequest | ServerResponse

/**
 * Request header a product page sets to address one product instance.
 *
 * Connection treats the value as opaque: it only partitions the browser Peer
 * per account and instance, and forwards it to the registered account scope.
 * A composition that registers no account scope keeps the native behavior.
 */
export const INSTANCE_HEADER = 'x-dsh-instance'

/** Upgrade query parameter carrying the same instance when a browser cannot set headers. */
export const INSTANCE_PARAM = 'dsh-instance'

/** HTTP request facts consumed by browser trust and authentication. */
export interface ConnectionTrustRequest {
  /** Request headers supplied by either the Fetch or node:http representation. */
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>
  /** Request target; a WebSocket upgrade carries {@link INSTANCE_PARAM} here. */
  readonly url?: string | undefined
}

/** HTTP status returned before dispatch, or undefined when the request may proceed. */
export type ConnectionRequestRejection = 401 | 403 | undefined

/** Root/index request facts used by the browser-token exchange. */
export interface ConnectionIndexRequest extends ConnectionTrustRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
  readonly socket?: {
    readonly remoteAddress?: string | undefined
  } | undefined
}

/** Root/index response operations owned by the browser-token exchange. */
export interface ConnectionIndexResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

/** Loopback first-visit redirect configuration for {@link HostConnectionHandle.authorizeIndex}. */
export interface ConnectionIndexBootstrap {
  /** Cookie carrying the requested path back to the Web entry after the token exchange. */
  readonly returnCookie: string
}

/** Response operation a login uses to renew the signed browser cookie. */
export interface ConnectionCookieResponse {
  setHeader(name: string, value: string): unknown
}

/**
 * Product account scope registered over Connection.
 *
 * Session readers (list, search, live control) and the model catalog narrow to
 * the browser account bound to the calling connection. A request that names an
 * instance passes that value through unchanged; the mounted product decides
 * what it means (SoloEngine maps it to one agenticflow).
 */
export interface ConnectionAccountScope {
  /**
   * Answer whether the account may access every named Session.
   * @param request - the bound account, the opaque instance the request named, and the Session identities it names.
   * @returns whether every Session belongs to the account (and, when given, to that instance).
   */
  authorize(request: {
    readonly userId: string
    readonly instance?: string
    readonly sessionIds: readonly string[]
  }): Promise<boolean>
  /**
   * List the Session identities the account owns.
   * @param userId - the bound product account.
   * @param instance - the opaque instance the request named, when it named one.
   * @returns Session identities visible in that account (and instance).
   */
  ownedSessions(userId: string, instance?: string): Promise<readonly string[]>
  /**
   * List the model route names the account may use.
   * @param userId - the bound product account.
   * @returns model route names visible to that account.
   */
  ownedModelRoutes(userId: string): Promise<readonly string[]>
}

/** Outcome of admitting one request: the Peer it speaks for, or the status refusing it. */
export type PeerAdmission =
  | { readonly peer: PeerScope }
  | { readonly rejection: 401 | 403 }

/** Socket admission claims API ownership until its carrier calls release, including failed upgrades. */
export type ConnectionAdmission =
  | {
    readonly peer: PeerScope
    /** Remove and dispose an API Peer; browser releases leave the (instance-scoped) browser Peer intact. */
    readonly release: () => Promise<void>
  }
  | { readonly rejection: 401 | 403 | 409 }

/**
 * Handler invoked after Connection has decoded the transport envelope.
 * `peer` is the Peer the carrier admitted or the in-process caller supplied.
 */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  peer: PeerScope,
) => Promise<ConnectionRpcHandlerResult>

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean

/** HTTP methods supported by exact Fetch routes on the shared API channel. */
export type ConnectionFetchMethod = 'GET' | 'HEAD' | 'POST'

/** How the node:http bridge presents one request body to its Fetch route. */
export type ConnectionRequestBodyMode = 'buffered' | 'streaming'

/** One exact, transport-independent Fetch route owned by a Host feature. */
export interface ConnectionFetchRoute {
  /** Absolute path below `/api`; query parameters remain available on the request URL. */
  readonly path: string
  /** Methods this route owns. Other methods continue through normal shared-channel dispatch. */
  readonly methods: readonly ConnectionFetchMethod[]
  /** Buffered requests obey the configured JSON cap; streaming requests arrive with backpressure and no aggregate cap. */
  readonly requestBody: ConnectionRequestBodyMode
  /**
   * Handle one request after the physical carrier has applied its trust and
   * authentication policy. Only owner Peers reach an exact route; the shared
   * handler answers 403 for every other principal.
   */
  readonly fetch: (request: Request) => Promise<Response>
}

/** Host registry for exact Fetch routes that cannot use JSON Remote invocation. */
export interface HostConnectionFetch {
  /**
   * Register one exact route on the shared API channel.
   * @param route - path, methods, and Fetch-shaped implementation.
   * @returns asynchronous disposer removing this exact contribution.
   */
  register(route: ConnectionFetchRoute): () => Promise<void>
}

/** Host registry for logical RPC channels carried by the current transport. */
export interface HostConnectionRpc {
  /**
   * Register one authenticated absolute channel prefix.
   * @param channel - absolute logical channel such as `/rpc`.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @returns asynchronous disposer removing the channel and its physical route.
   */
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
  ): () => Promise<void>

  /**
   * Intercept owned endpoints on the shared `/api` channel before its fallback.
   * @param channel - reserved shared channel; currently `/api`.
   * @param matches - synchronous endpoint ownership test.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @returns asynchronous disposer removing the interceptor.
   */
  intercept(
    channel: '/api',
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
  ): () => Promise<void>
}

/** Host `ctx.connection` members consumed by transport-independent adapters. */
export interface HostConnectionHandle {
  /** Generic RPC channel registry. */
  readonly rpc: HostConnectionRpc
  /** Exact Fetch routes for streaming or browser-native responses. */
  readonly fetch: HostConnectionFetch
  /** The owner Peer every authenticated browser connection shares. */
  readonly browserPeer: PeerScope

  /**
   * Whether this deployment accepts authorities beyond loopback: true only
   * when a validated `trustedHosts` entry names a non-loopback hostname.
   */
  readonly allowsRemoteAuthorities: boolean

  /**
   * Compose exact Fetch routes and the shared-channel RPC interceptor.
   * @param channel - shared channel mounted by Connection.
   * @returns Fetch handler for trusted, authenticated requests.
   */
  createSharedFetchHandler(channel: '/api'): ConnectionFetchHandler

  /**
   * Apply Connection's Host/Origin checks and browser authentication to
   * another Web route.
   * @param request - request headers from the HTTP or upgrade request.
   * @returns rejection status, or undefined when the route may accept the request.
   */
  requestRejection(request: ConnectionTrustRequest): ConnectionRequestRejection

  /**
   * Admit an HTTP request against its signed browser or API credential and live Peer.
   * @param request - request headers from the HTTP or upgrade request.
   * @returns the credential's Peer, or the rejection status.
   */
  admit(request: ConnectionTrustRequest): PeerAdmission

  /**
   * Create an independent in-process Peer, disposed with the Context that read `ctx.connection`.
   * @param options - fixed principal and optional interaction participation (default `answer`).
   * @returns a new Peer distinct from every other Peer.
   */
  createPeer(options: { readonly principal: Principal; readonly interactions?: 'answer' | 'none' }): PeerScope

  /**
   * Claim a physical socket for an API Peer; browser sockets share their owner Peer.
   * @param request - authenticated upgrade request headers.
   * @returns the Peer and idempotent release, or 409 for duplicate API ownership.
   * The carrier releases on socket termination or failed upgrade; release removes
   * API admission synchronously without cancelling independent HTTP calls.
   */
  admitConnection(request: ConnectionTrustRequest): ConnectionAdmission

  /**
   * Authenticate one frontend index request, owning a token redirect or 401.
   * The cookie this mints is `Secure` when the mounted Web carrier serves TLS,
   * which only that listener's protocol decides.
   * @param request - root or configured-index HTTP request.
   * @param response - response owned when the result is false.
   * @param bootstrap - optional loopback first-visit redirect; omitted keeps the plain 401.
   * @returns true only when the frontend may serve index.html.
   */
  authorizeIndex(
    request: ConnectionIndexRequest,
    response: ConnectionIndexResponse,
    bootstrap?: ConnectionIndexBootstrap,
  ): boolean

  /**
   * Bind this browser's signed cookie to one product account after that
   * account's login succeeded on the same request. The minted cookie keeps the
   * requesting authority and lifetime; an older cookie generation is replaced.
   * Untrusted requests are refused and set no cookie.
   * @param request - the login request whose Host/Origin and cookie are examined.
   * @param response - response that carries the renewed cookie.
   * @param userId - account identity the login proved.
   * @returns whether a cookie was written.
   */
  bindBrowserUser(
    request: ConnectionTrustRequest,
    response: ConnectionCookieResponse,
    userId: string,
  ): boolean

  /**
   * Register the account scope of the mounted product, replacing the previous
   * scope. Without a scope every authenticated request keeps the native
   * behavior; with one, reads of Sessions and of model routes narrow to the
   * browser account bound to the connection.
   * @param scope - scope to install, or undefined to remove it.
   * @returns disposer that removes this scope unless another replaced it.
   */
  setAccountScope(scope: ConnectionAccountScope | undefined): () => void

  /**
   * Read the product account bound to a Peer's browser connection.
   *
   * Products that scope non-Session reads (canvases, instance composition) to
   * the signed-in account need the account identity of the admitted request.
   * @param peer - Peer the request speaks for.
   * @returns the bound account id; undefined without an account scope, for an
   * API operator Peer, or before the browser signs in.
   */
  accountIdOf(peer: PeerScope): string | undefined

  /**
   * Answer whether the Peer may access every Session identity named by an RPC
   * payload. Payload argument objects are searched for Session identities; a
   * payload naming none is always allowed. Without an account scope every call
   * is allowed.
   * @param peer - Peer the call speaks for.
   * @param payload - decoded RPC payload (`{ args }`) of the call or stream.
   * @returns whether the call may proceed.
   */
  authorizeSessions(peer: PeerScope, payload: unknown): Promise<boolean>

  /**
   * Answer whether the Peer may access these Session identities. An API
   * operator Peer keeps the deployment operator's access; a browser Peer with
   * no bound account owns none; without an account scope this returns
   * undefined so callers keep the native behavior.
   * @param peer - Peer the call speaks for.
   * @param sessionIds - Session identities the call names.
   * @returns the decision, or undefined when no account scope is installed.
   */
  authorizeSessionIds(peer: PeerScope, sessionIds: readonly string[]): Promise<boolean | undefined>

  /**
   * List every Session identity bound to this Peer's account. Undefined means
   * no account scope is installed (native behavior); an empty list means the
   * browser carries no bound account.
   * @param peer - Peer the call speaks for.
   * @returns the account's Session identities, or undefined without a scope.
   */
  ownedSessionIdsOf(peer: PeerScope): Promise<readonly string[] | undefined>

  /**
   * List the model route names bound to this Peer's account. Undefined means no
   * account scope is installed; an empty list means no bound account.
   * @param peer - Peer the call speaks for.
   * @returns the account's model route names, or undefined without a scope.
   */
  ownedModelRouteNamesOf(peer: PeerScope): Promise<readonly string[] | undefined>

  /**
   * Add the fresh process token to an ordinary Web application URL.
   * @param baseUrl - clean application URL whose authority and mount are preserved.
   * @returns tokenized URL for initial login; a mount proxy strips its prefix before {@link authorizeIndex}.
   */
  authenticatedUrl(baseUrl: string): string
}

/** Transport-independent Fetch handler used by HTTP and worker carriers. */
export interface ConnectionFetchHandler {
  /**
   * Resolve body handling before the bridge reads any request bytes.
   * @param request - request method and URL available from node:http headers.
   * @returns the registered route's body handling mode.
   */
  requestBodyMode(request: { readonly method: string; readonly url: URL }): ConnectionRequestBodyMode

  /**
   * Dispatch one already-authenticated request.
   * @param request - Fetch request below the shared channel.
   * @param peer - Peer to dispatch as; required, never defaulted.
   * @returns the registered response, a 403 response for an exact route and a non-owner Peer, or a 404 response.
   */
  fetch(request: Request, peer: PeerScope): Promise<Response>
}

/** Client caller for logical RPC channels carried by the current transport. */
export interface ClientConnectionRpc {
  /**
   * Call one endpoint through an already registered logical channel.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `goals/create`.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the endpoint-owned success/error result; correlation stays inside Connection.
   */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<ConnectionRpcResult<unknown>>

  /**
   * Open an in-process logical stream when the selected carrier supplies one.
   * Browser transports omit this method; API Gateway owns their WebSocket mux.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `session/follow`.
   * @param payload - channel-owned request payload.
   * @param signal - caller cancellation for this logical stream.
   * @param uplink - Client uplink items the Host method reads through `invocation.uplink()`.
   * @returns decoded stream values from the in-process carrier.
   */
  readonly open?: (
    channel: string,
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
    uplink?: AsyncIterable<unknown>,
  ) => AsyncIterable<unknown>
}
