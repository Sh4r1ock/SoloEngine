/** Browser-session authentication for the Host Connection carrier. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { PeerId } from '@deepseek-ai/dsh-typert-protocol'
import { API_MUX_PATH, CONNECT_PATH, type ConnectionInteractions } from './connect-protocol.ts'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  ConnectionCookieResponse,
  ConnectionIndexBootstrap,
  ConnectionIndexRequest,
  ConnectionIndexResponse,
  ConnectionTrustRequest,
} from './rpc.ts'

const AUTH_RECORD_KEY = credentialKey('client-connection', 'browser-session')
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SECRET_BYTES = 32
const TOKEN_QUERY = 'token'
const COOKIE_PREFIX = 'dsh-auth-'
const COOKIE_PAYLOAD_VERSION = 1
/** Cookie generation a product login upgrades to; older generations keep their exact meaning. */
const USER_COOKIE_VERSION = 3
const STORED_SECRET_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/
const PROCESS_LAUNCH_TOKENS = new WeakMap<object, string>()

interface StoredSecretPayload {
  readonly version: typeof STORED_SECRET_VERSION
  readonly secret: string
}

interface BrowserCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
}

interface ApiCookiePayload extends Omit<BrowserCookiePayload, 'version'> {
  readonly version: 2
  readonly id: PeerId
}

/** A browser cookie bound to one product account by a successful login. */
interface UserCookiePayload extends Omit<BrowserCookiePayload, 'version'> {
  readonly version: typeof USER_COOKIE_VERSION
  /** Account identity the product login proved for this browser. */
  readonly userId: string
  /** API operator id carried by an upgraded v2 cookie; browser cookies carry none. */
  readonly id?: PeerId
}

type CookiePayload = BrowserCookiePayload | ApiCookiePayload | UserCookiePayload

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

function processLaunchToken(owner: object): string {
  const existing = PROCESS_LAUNCH_TOKENS.get(owner)
  if (existing !== undefined) return existing
  const created = encodeBase64Url(randomBytes(SECRET_BYTES))
  PROCESS_LAUNCH_TOKENS.set(owner, created)
  return created
}

function header(
  headers: ConnectionTrustRequest['headers'],
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Protocol-scoped cookie audience; HTTP retains its existing authority-only spelling. */
function requestAudience(headers: ConnectionTrustRequest['headers'], secure: boolean): string | undefined {
  const host = header(headers, 'host')
  if (host === undefined) return undefined
  try {
    const url = new URL(`${secure ? 'https:' : 'http:'}//${host}`)
    return secure ? url.origin : url.host
  } catch {
    return undefined
  }
}

function canonicalSecret(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  const decoded = decodeBase64Url(value)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) return undefined
  return decoded
}

function storedSecret(record: CredentialRecord | undefined): Buffer | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload)
    || record.payload.version !== STORED_SECRET_VERSION) {
    throw new Error('client-connection: browser-session credential record has an unsupported format')
  }
  const secret = canonicalSecret(record.payload.secret)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record has an invalid secret')
  }
  return secret
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

function cookieName(authority: string): string {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

/** Authority hostnames that mean this machine (DNS aliases plus loopback literals). */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])
/** Socket peer addresses that mean this machine; dual-stack kernels report the mapped IPv4 form. */
const LOOPBACK_PEERS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** Whether an authority names a loopback host, with or without a scheme and port. */
function isLoopbackAuthority(authority: string): boolean {
  const host = authority.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '').replace(/:\d+$/u, '').toLowerCase()
  return LOOPBACK_HOSTS.has(host)
}

/** Whether the socket peer address is loopback; a missing address is never this machine. */
function isLoopbackPeer(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_PEERS.has(remoteAddress)
}

/** Read the exact generated cookie without implementing general Cookie decoding. */
function cookieValue(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/** Serialize the fixed browser-session attributes; generated names and values are cookie-safe base64url. */
function sessionCookie(
  name: string,
  value: string,
  expiresAt: number,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const attributes = `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
  return secure ? `${attributes}; Secure` : attributes
}

function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

function encodeCookie(payload: CookiePayload, secret: Buffer): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `v${payload.version}.${body}.${encodeBase64Url(signature(secret, body))}`
}

function decodeCookie(value: string, secret: Buffer): CookiePayload | undefined {
  const parts = value.split('.')
  const [version, body, encodedSignature] = parts
  if (parts.length !== 3 || (version !== 'v1' && version !== 'v2' && version !== 'v3')
    || body === undefined || encodedSignature === undefined) {
    return undefined
  }
  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return undefined
  const expectedSignature = signature(secret, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) return undefined
  let decoded: unknown
  try {
    const bodyBytes = decodeBase64Url(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(decoded)
    || (decoded.version !== COOKIE_PAYLOAD_VERSION && decoded.version !== 2 && decoded.version !== USER_COOKIE_VERSION)
    || version !== `v${String(decoded.version)}`
    || typeof decoded.authority !== 'string'
    || typeof decoded.issuedAt !== 'number' || !Number.isSafeInteger(decoded.issuedAt)
    || typeof decoded.expiresAt !== 'number' || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  const payload = { authority: decoded.authority, issuedAt: decoded.issuedAt, expiresAt: decoded.expiresAt }
  if (decoded.version === COOKIE_PAYLOAD_VERSION) return { version: COOKIE_PAYLOAD_VERSION, ...payload }
  const id = decoded.id
  if (decoded.version === 2) {
    if (typeof id !== 'string' || id.length === 0) return undefined
    return { version: 2, ...payload, id: id as PeerId }
  }
  if (typeof decoded.userId !== 'string' || decoded.userId.length === 0) return undefined
  return {
    version: USER_COOKIE_VERSION,
    ...payload,
    userId: decoded.userId,
    ...(typeof id === 'string' && id.length > 0 ? { id: id as PeerId } : {}),
  }
}

async function initializeSecret(credentials: CredentialProvider): Promise<Buffer> {
  const generated: StoredSecretPayload = {
    version: STORED_SECRET_VERSION,
    secret: encodeBase64Url(randomBytes(SECRET_BYTES)),
  }
  const record = await credentials.modifyRecord(AUTH_RECORD_KEY, (current) => {
    if (current !== undefined) {
      storedSecret(current)
      return Promise.resolve(undefined)
    }
    return Promise.resolve({ kind: 'grant', payload: generated })
  })
  const secret = storedSecret(record)
  if (secret === undefined) {
    throw new Error('client-connection: browser-session credential record was not created')
  }
  return secret
}

/**
 * Process launch-token exchange and persistent signed-cookie verification.
 * Connection loads the credential provider's signing secret during activation
 * and retains it for synchronous request authentication.
 */
export class BrowserAuth {
  private readonly launchToken: string
  private readonly maxAgeMilliseconds: number

  private constructor(
    processOwner: object,
    private readonly secret: Buffer,
    maxAgeDays: number,
  ) {
    this.launchToken = processLaunchToken(processOwner)
    this.maxAgeMilliseconds = maxAgeDays * DAY_MILLISECONDS
    if (!Number.isSafeInteger(this.maxAgeMilliseconds)
      || !Number.isSafeInteger(Date.now() + this.maxAgeMilliseconds)) {
      throw new Error('client-connection: cookieMaxAgeDays exceeds the safe timestamp range')
    }
  }

  /**
   * Initialize browser authentication and create its durable signing secret
   * when this Harness home has none.
   * @param processOwner - root application context retaining one token across Connection reloads.
   * @param credentials - persistent credential provider for the Web profile.
   * @param maxAgeDays - positive absolute browser-cookie lifetime in days.
   * @returns initialized authentication owner with the process owner's launch token.
   */
  static async create(
    processOwner: object,
    credentials: CredentialProvider,
    maxAgeDays: number,
  ): Promise<BrowserAuth> {
    return new BrowserAuth(processOwner, await initializeSecret(credentials), maxAgeDays)
  }

  /**
   * Add this process's launch token to the caller's application URL.
   * @param baseUrl - clean browser URL whose authority and mount are preserved.
   * @returns the same URL carrying the process token as its sole authentication input.
   */
  authenticatedUrl(baseUrl: string): string {
    const url = new URL(baseUrl)
    url.searchParams.set(TOKEN_QUERY, this.launchToken)
    return url.href
  }

  /**
   * Authenticate an index request. A valid root query token mints the cookie
   * and redirects to the directory-relative clean `./`; a valid cookie lets
   * the caller serve the index; every other request receives the same minimal
   * 401 response.
   * With `bootstrap`, a cookieless loopback browser is first sent through the
   * token exchange on its own authority so a first visit needs no pasted URL.
   * @param req - incoming root or configured-index request.
   * @param res - response owned when this method returns false.
   * @param secure - whether the listener receiving this request serves TLS; the
   * minted cookie carries `Secure` when it does. Only that listener's own
   * protocol decides, never a `publicUrl` announcement or a forwarded header:
   * those describe a hop this process does not terminate.
   * @param bootstrap - optional loopback first-visit redirect carrying the return cookie name.
   * @returns true only when the caller may serve index.html.
   */
  authorizeIndex(
    req: ConnectionIndexRequest,
    res: ConnectionIndexResponse,
    secure = false,
    bootstrap?: ConnectionIndexBootstrap,
  ): boolean {
    /* v8 ignore next -- node:http always supplies url on server requests. */
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const tokens = url.searchParams.getAll(TOKEN_QUERY)
    if (tokens.length > 0) {
      const authority = requestAudience(req.headers, secure)
      if (req.method === 'GET' && url.pathname === '/' && tokens.length === 1
        && authority !== undefined && tokenMatches(tokens.join(''), this.launchToken)) {
        const issuedAt = Date.now()
        const expiresAt = issuedAt + this.maxAgeMilliseconds
        const value = encodeCookie({
          version: COOKIE_PAYLOAD_VERSION,
          authority,
          issuedAt,
          expiresAt,
        }, this.secret)
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': './',
          'referrer-policy': 'no-referrer',
          'set-cookie': sessionCookie(
            cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000), secure,
          ),
        })
        res.end()
        return false
      }
      if (req.method === 'GET' && url.pathname === '/' && this.isAuthenticated(req, secure)) {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': './',
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      this.writeUnauthorized(req, res)
      return false
    }
    if (this.isAuthenticated(req, secure)) return true
    if (bootstrap !== undefined && this.writeLoopbackBootstrap(req, res, secure, bootstrap.returnCookie, url)) return false
    this.writeUnauthorized(req, res)
    return false
  }

  /**
   * Send a cookieless loopback browser to the token URL on its own authority,
   * keeping the requested path in the return cookie for the Web entry.
   * @returns whether a redirect was written; false leaves the caller's 401 in charge.
   */
  private writeLoopbackBootstrap(
    req: ConnectionIndexRequest,
    res: ConnectionIndexResponse,
    secure: boolean,
    returnCookie: string,
    url: URL,
  ): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    const authority = requestAudience(req.headers, secure)
    if (authority === undefined || !isLoopbackAuthority(authority) || !isLoopbackPeer(req.socket?.remoteAddress)) {
      return false
    }
    const headers: Record<string, string> = {
      'cache-control': 'no-store',
      'location': this.authenticatedUrl(secure ? authority : `http://${authority}`),
      'referrer-policy': 'no-referrer',
    }
    const target = `${url.pathname}${url.search}`
    if (target !== '/') {
      headers['set-cookie'] = `${returnCookie}=${encodeURIComponent(target)}; Max-Age=300; Path=/; SameSite=Strict`
    }
    res.writeHead(303, headers)
    res.end()
    return true
  }

  /**
   * Exchange the launch token for an independent API operator; omitted interactions default to none.
   * @param req - trusted GET request on /connect with at most one interactions declaration.
   * @param res - response owned to completion, redirecting to the API mux on success.
   * @param secure - whether the receiving listener serves TLS.
   * @param publish - synchronously create the operator before exposing its signed credential.
   */
  authorizeConnect(
    req: ConnectionIndexRequest,
    res: ConnectionIndexResponse,
    secure: boolean,
    publish: (interactions: ConnectionInteractions) => PeerId,
  ): void {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const declarations = url.searchParams.getAll('interactions')
    const interactions = declarations[0] ?? 'none'
    if (declarations.length > 1 || (interactions !== 'answer' && interactions !== 'none')) {
      res.writeHead(400, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      res.end('interactions must be declared once as answer or none\n')
      return
    }
    const tokens = url.searchParams.getAll(TOKEN_QUERY)
    const authority = requestAudience(req.headers, secure)
    if (req.method !== 'GET' || url.pathname !== CONNECT_PATH || tokens.length !== 1
      || authority === undefined || !tokenMatches(tokens.join(''), this.launchToken)) {
      this.writeUnauthorized(req, res)
      return
    }
    const issuedAt = Date.now()
    const expiresAt = issuedAt + this.maxAgeMilliseconds
    const id = publish(interactions)
    const value = encodeCookie({ version: 2, authority, id, issuedAt, expiresAt }, this.secret)
    res.writeHead(302, {
      'cache-control': 'no-store',
      'location': `.${API_MUX_PATH}`,
      'referrer-policy': 'no-referrer',
      'set-cookie': sessionCookie(
        cookieName(authority), value, expiresAt, Math.floor(this.maxAgeMilliseconds / 1000), secure,
      ),
    })
    res.end()
  }

  /**
   * Verify the authority-bound browser cookie on a Host request.
   * @param request - request headers carrying Host and Cookie.
   * @param secure - whether the receiving listener uses TLS, including its default port.
   * @returns true only for an unexpired browser cookie signed by this activation's loaded secret.
   */
  isAuthenticated(request: ConnectionTrustRequest, secure = false): boolean {
    const version = this.authenticate(request, secure)?.version
    return version === COOKIE_PAYLOAD_VERSION || version === USER_COOKIE_VERSION
  }

  /**
   * Verify an API credential without creating or reviving its operator.
   * @param request - request headers carrying Host and Cookie.
   * @param secure - whether the receiving listener uses TLS.
   * @returns the signed operator id, or undefined for invalid, expired, or browser cookies.
   */
  authenticateApi(request: ConnectionTrustRequest, secure = false): PeerId | undefined {
    const payload = this.authenticate(request, secure)
    return payload?.version === 2 ? payload.id : undefined
  }

  /**
   * Read the product account bound to this browser cookie.
   * @param request - request headers carrying Host and Cookie.
   * @param secure - whether the receiving listener uses TLS.
   * @returns the bound account id; undefined for unbound, expired, or invalid cookies.
   */
  browserUserId(request: ConnectionTrustRequest, secure = false): string | undefined {
    const payload = this.authenticate(request, secure)
    return payload?.version === USER_COOKIE_VERSION ? payload.userId : undefined
  }

  /**
   * Renew this browser cookie bound to one product account.
   * @param request - request headers carrying Host and Cookie.
   * @param response - response that receives the renewed cookie.
   * @param userId - account identity a successful login proved.
   * @param secure - whether the receiving listener uses TLS.
   * @returns whether a cookie was written; false for a missing authority or empty account id.
   */
  bindUser(
    request: ConnectionTrustRequest,
    response: ConnectionCookieResponse,
    userId: string,
    secure = false,
  ): boolean {
    const authority = requestAudience(request.headers, secure)
    if (authority === undefined || userId === '') return false
    const issuedAt = Date.now()
    const expiresAt = issuedAt + this.maxAgeMilliseconds
    const current = this.authenticate(request, secure)
    const payload: UserCookiePayload = {
      version: USER_COOKIE_VERSION,
      authority,
      userId,
      issuedAt,
      expiresAt,
      ...(current?.version === 2 ? { id: current.id } : {}),
    }
    response.setHeader('set-cookie', sessionCookie(
      cookieName(authority),
      encodeCookie(payload, this.secret),
      expiresAt,
      Math.floor(this.maxAgeMilliseconds / 1000),
      secure,
    ))
    return true
  }

  private authenticate(request: ConnectionTrustRequest, secure: boolean): CookiePayload | undefined {
    const authority = requestAudience(request.headers, secure)
    const rawCookie = header(request.headers, 'cookie')
    if (authority === undefined || rawCookie === undefined) return undefined
    const value = cookieValue(rawCookie, cookieName(authority))
    if (value === undefined) return undefined
    const payload = decodeCookie(value, this.secret)
    if (payload === undefined || payload.authority !== authority) return undefined
    const now = Date.now()
    if (payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt
      || payload.expiresAt - payload.issuedAt > this.maxAgeMilliseconds) return undefined
    return payload
  }

  private writeUnauthorized(req: ConnectionIndexRequest, res: ConnectionIndexResponse): void {
    res.writeHead(401, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    })
    res.end(req.method === 'HEAD'
      ? undefined
      : 'dsh web authentication required; reopen the URL printed by dsh web.\n')
  }
}
