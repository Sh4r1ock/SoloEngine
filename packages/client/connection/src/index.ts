/** Host HTTP bridge for browser-client RPC. */
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
// Activates the webServer Context merge used below.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-credentials'
import { API_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority } from './api-request-trust.ts'
import type { ConnectionTrustRequest } from './rpc.ts'
import { HostConnectionService } from './rpc-host.ts'
import { ConnectionAuthentication } from './authentication.ts'
import { BrowserAuth } from './browser-auth.ts'
import { API_MUX_PATH, CONNECT_PATH } from './connect-protocol.ts'
import { ConnectionRecoveryConfigSchema, resolveConnectionConfig, type ConnectionRecoveryConfig } from './recovery-config.ts'

export type {
  AuthenticationProvider,
  PeerAdmission,
  ConnectionAccountScope,
  ConnectionAdmission,
  ConnectionCookieResponse,
  ConnectionFetchMethod,
  ConnectionFetchHandler,
  ConnectionFetchRoute,
  ConnectionIndexBootstrap,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcAttachment,
  ConnectionRpcFailure,
  ConnectionRpcHandler,
  ConnectionRpcHandlerResult,
  ConnectionRpcResult,
  ConnectionRequestBodyMode,
  ConnectionRequestRejection,
  ConnectionTrustRequest,
  ClientRequest,
  HostConnectionHandle,
  HostConnectionFetch,
  HostConnectionRpc,
  RpcMessage,
  ServerResponse,
} from './rpc.ts'
export type { PeerId, PeerScope, Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
export { INSTANCE_HEADER, INSTANCE_PARAM, RpcId, transportError } from './rpc.ts'
export { Peer } from './peer.ts'
export type { PeerOptions } from './peer.ts'
export { API_MUX_PATH, CONNECT_PATH, type ConnectionInteractions } from './connect-protocol.ts'
export {
  clientRequestSchema,
  rpcErrorSchema,
  rpcIdSchema,
  rpcMessageSchema,
  rpcResultSchema,
  serverResponseSchema,
} from './rpc-schema.ts'
export { HostConnectionService } from './rpc-host.ts'
export { ConnectionAuthentication } from './authentication.ts'

export { API_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Admit or wrap an authenticated shared API request, including body transfer.
     * Existing requests continue when a listener refuses subsequent requests.
     * @param request - Authenticated incoming HTTP request.
     * @param response - Response owned until the delegated bridge settles.
     * @param next - Delegate to the next listener or the shared API bridge.
     * @mode waterfall
     */
    'connection/request'(request: IncomingMessage, response: ServerResponse, next: () => Promise<void>): Promise<void>
  }
}

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection. */
export const inject = ['credentials']

/** Browser authentication, request limits, and connection recovery configuration. */
export interface ConnectionConfig {
  /** Browser recovery timing, injected into each served page. */
  recovery?: ConnectionRecoveryConfig
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The fence accepts loopback and the
   * listener's own bind IP independently; other remote authorities require
   * an entry here. A non-canonical or non-bare authority fails plugin load.
   */
  trustedHosts?: string[]
  /** Absolute browser and API cookie lifetime in days. Default: 30. */
  cookieMaxAgeDays?: number
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  recovery: ConnectionRecoveryConfigSchema.default({}),
  trustedHosts: z.array(String).default([]),
  cookieMaxAgeDays: z.natural().min(1).default(30),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Provides carrier-neutral RPC and Fetch registries. When `webServer` is
 * present, the plugin applies Host/Origin checks and registered authentication
 * to WebServer routes and mounts the `/api` browser transport.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config?: ConnectionConfig): Promise<void> {
  const recovery = resolveConnectionConfig(config?.recovery)
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const cookieMaxAgeDays = config?.cookieMaxAgeDays ?? 30
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const browserAuth = await BrowserAuth.create(ctx[Context.root], ctx.credentials, cookieMaxAgeDays)
  // The launcher prints this signed entry URL; Connection owns the process token.
  ctx.on('webserver/entry-url', (baseUrl, entries) => {
    entries.push({ label: 'dsh web', url: browserAuth.authenticatedUrl(baseUrl), open: true })
  })
  new ConnectionAuthentication(ctx)
  ctx.inject(['connection.authentication'], (connectionCtx) => {
    const connection = new HostConnectionService(connectionCtx, trustedHosts, browserAuth)
    connectionCtx.inject(['webServer'], (webCtx) => {
      assertImageBodyCapacity(webCtx, maxRequestBodyBytes)
      webCtx.on('webserver/index-inject', (table) => {
        table.push({ kind: 'global', name: '__DSH_CONNECTION_RECOVERY__', value: recovery })
      })
      const fetchHandler = connection.createSharedFetchHandler(API_PATH)
      // No response is written for a request whose carrier is already gone.
      const abandoned = (request: ConnectionTrustRequest, response: { readonly destroyed: boolean }): boolean =>
        request.signal?.aborted === true || request.socket?.destroyed === true || response.destroyed
      // The process launch token exchanges for a signed browser cookie only at the
      // application root; every other request keeps the route's own admission.
      webCtx.on('webserver/request', async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://dsh.invalid')
        if (url.pathname !== '/' || !url.searchParams.has('token')) {
          await next()
          return
        }
        if (abandoned(request, response)) return
        connection.authorizeIndex(request, response)
      })
      const route: WebRoute = {
        kind: 'prefix',
        path: API_PATH,
        auth: 'required',
        handler: async (req, res, peer) => {
          if (peer === undefined || res.destroyed) return
          await webCtx.waterfall('connection/request', req, res, () => bridge(req, res, fetchHandler, peer, maxRequestBodyBytes))
        },
      }
      webCtx.effect(() => webCtx.webServer.register(route), 'client-connection: /api route')
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path: CONNECT_PATH,
        auth: 'anonymous',
        handler: (req, res) => {
          if (abandoned(req, res)) return
          connection.authorizeConnect(req, res)
        },
      }), 'client-connection: /connect route')
      // One API socket per `connect` caller. The route admitted the Peer before this
      // waterfall; browser and in-process Peers delegate so tabs may share them.
      const apiSockets = new Map<string, () => Promise<void>>()
      webCtx.effect(() => async () => {
        await Promise.all([...apiSockets.values()].map(release => release()))
      }, 'client-connection: API sockets')
      webCtx.on('webserver/upgrade', async (request, socket, _head, admittedPeer, next) => {
        if (admittedPeer === undefined || !connection.ownsApiPeer(admittedPeer)) {
          await next()
          return
        }
        if (admittedPeer.signal.aborted) {
          socket.destroy()
          return
        }
        if (new URL(request.url ?? '/', 'http://dsh.invalid').pathname !== API_MUX_PATH) {
          await next()
          return
        }
        if (apiSockets.has(admittedPeer.id)) {
          socket.end([
            'HTTP/1.1 409 Conflict',
            'Connection: close',
            'Content-Type: text/plain; charset=utf-8',
            'Content-Length: 8',
            '',
            'conflict',
          ].join('\r\n'))
          return
        }
        const closed = Promise.withResolvers<undefined>()
        let released: Promise<void> | undefined
        const release = (): Promise<void> => {
          if (released !== undefined) return released
          socket.destroy()
          released = Promise.all([
            closed.promise,
            // Revocation precedes asynchronous Peer disposal.
            connection.releaseApiPeer(admittedPeer).catch((error: unknown) => {
              console.error('[client-connection] Peer release failed:', error)
            }),
          ]).then(() => { apiSockets.delete(admittedPeer.id) })
          return released
        }
        const failed = (): void => { void release() }
        const finish = (): void => {
          socket.removeListener('error', failed)
          socket.removeListener('close', finish)
          closed.resolve(undefined)
          void release()
        }
        apiSockets.set(admittedPeer.id, release)
        socket.on('error', failed)
        socket.once('close', finish)
        if (socket.closed) finish()
        if (socket.destroyed) {
          await release()
          return
        }
        try {
          await next()
        } catch (error) {
          await release()
          throw error
        }
      })
    })
  })
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
}
