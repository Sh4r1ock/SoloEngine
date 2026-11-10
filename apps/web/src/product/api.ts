/**
 * 框架层 REST 客户端：统一 `request()`，带 Bearer 访问令牌，失败抛结构化错误。
 * 无回退、无静默降级：任何失败都以 ApiError 抛出，由调用方呈现在界面上。
 */
import { t } from './i18n.ts'

/** 框架层 REST 前缀。 */
const API_PREFIX = '/api/solo'

/** 访问令牌的 localStorage 键。 */
export const ACCESS_TOKEN_KEY = 'soloengine.accessToken'
/** 刷新令牌的 localStorage 键。 */
export const REFRESH_TOKEN_KEY = 'soloengine.refreshToken'

/** 结构化接口错误（携带机器可读 code）。 */
export class ApiError extends Error {
  /** 机器可读错误码。 */
  readonly code: string
  /** HTTP 状态码（网络失败为 0）。 */
  readonly status: number

  /**
   * @param code - 机器可读错误码。
   * @param message - 人类可读原因。
   * @param status - HTTP 状态码。
   */
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** 读取访问令牌。 */
export function readAccessToken(): string | null {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY)
}

/** 读取刷新令牌。 */
export function readRefreshToken(): string | null {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY)
}

/** 写入令牌对。 */
export function storeTokens(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

/** 清空令牌对（登出/失效）。 */
export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
}

/** 支持的 HTTP 方法。 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** 单次请求参数。 */
export interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  /** 与 query 值约定一致：显式接受 undefined（exactOptionalPropertyTypes 下调用方常以可空变量直传）。 */
  signal?: AbortSignal | undefined
}

/** 拼接查询串（undefined 项省略）。 */
function withQuery(path: string, query: RequestOptions['query']): string {
  if (query === undefined) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text === '' ? path : `${path}?${text}`
}

/** 请求头（JSON + 可选 Bearer）。 */
function headers(hasBody: boolean): Headers {
  const result = new Headers()
  if (hasBody) result.set('content-type', 'application/json')
  const token = readAccessToken()
  if (token !== null && token !== '') result.set('authorization', `Bearer ${token}`)
  return result
}

/** 从响应体提取结构化错误；非 JSON 时保留原文片段。 */
async function failure(response: Response): Promise<ApiError> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
    const code = parsed.error?.code ?? `HTTP_${String(response.status)}`
    const message = parsed.error?.message ?? text
    return new ApiError(code, message, response.status)
  } catch {
    return new ApiError(`HTTP_${String(response.status)}`, text === '' ? response.statusText : text, response.status)
  }
}

/** 判定响应体是否为成功信封。 */
function isEnvelope(value: unknown): value is { ok: boolean } {
  return value !== null && typeof value === 'object' && 'ok' in value
}

/** 会话失效广播（刷新失败后由 App 回登录页）。 */
export const SESSION_EXPIRED_EVENT = 'soloengine:session-expired'

/** 业务请求默认超时（毫秒）：服务端挂起时页面不能永远停在加载中。 */
const DEFAULT_TIMEOUT_MS = 30_000

/** 清令牌并广播会话失效（刷新失败或刷新后重试仍 401）。 */
function expireSession(): void {
  clearTokens()
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}

/**
 * 合并默认超时与调用方中止信号。
 * @param caller - 调用方信号（可缺省）。
 * @param timeout - 默认超时信号。
 * @returns 合并后的信号，以及解除监听的回调。
 */
function mergeSignals(caller: AbortSignal | undefined, timeout: AbortSignal): { signal: AbortSignal; release: () => void } {
  if (caller === undefined) return { signal: timeout, release: () => undefined }
  if (typeof AbortSignal.any === 'function') return { signal: AbortSignal.any([caller, timeout]), release: () => undefined }
  // 兼容没有 AbortSignal.any 的浏览器：手动转发两个来源的中止。
  const controller = new AbortController()
  const abort = (): void => { controller.abort() }
  for (const source of [caller, timeout]) {
    if (source.aborted) {
      controller.abort()
      break
    }
    source.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    release: () => {
      caller.removeEventListener('abort', abort)
      timeout.removeEventListener('abort', abort)
    },
  }
}

/**
 * 带默认超时的 fetch：超时抛 `TIMEOUT`，调用方主动中止原样抛出，其余失败抛 `NETWORK`。
 * @param url - 完整请求地址。
 * @param init - 请求初始化参数。
 * @param callerSignal - 调用方传入的中止信号。
 * @returns 原始响应。
 * @throws ApiError —— `TIMEOUT`（默认超时）或 `NETWORK`（其它网络失败）。
 */
async function timedFetch(url: string, init: RequestInit, callerSignal: AbortSignal | undefined): Promise<Response> {
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  const merged = mergeSignals(callerSignal, timeout)
  try {
    return await fetch(url, { ...init, signal: merged.signal })
  } catch (error) {
    // 调用方自己中止：把原始异常交还上层，不伪装成超时或网络故障。
    if (callerSignal?.aborted === true) throw error
    if (timeout.aborted) throw new ApiError('TIMEOUT', 'request timed out', 0)
    throw new ApiError('NETWORK', error instanceof Error ? error.message : String(error), 0)
  } finally {
    merged.release()
  }
}

/** 单飞刷新：并发 401 只触发一次 `/auth/refresh`，其余请求等待同一结果。 */
let refreshInFlight: Promise<boolean> | undefined

/**
 * 用刷新令牌换一对新令牌（单飞）。
 * @returns 是否换到新令牌。
 */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight !== undefined) return refreshInFlight
  // 没有刷新令牌属于确定的「不能刷新」：在单飞槽位之外直接返回，否则提前 return 会跳过
  // finally，`refreshInFlight` 永远停在 undefined 之外的旧 Promise 上，本页后续请求再也不会刷新。
  const refreshToken = readRefreshToken()
  if (refreshToken === null || refreshToken === '') return false
  refreshInFlight = (async () => {
    try {
      // 刷新端点同样要有超时：它挂起时所有等待刷新的业务请求都会一起永久等待。
      const response = await timedFetch(`${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }, undefined)
      if (!response.ok) return false
      const parsed = JSON.parse(await response.text()) as {
        ok?: boolean
        accessToken?: unknown
        refreshToken?: unknown
      }
      if (parsed.ok !== true || typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') {
        return false
      }
      storeTokens(parsed.accessToken, parsed.refreshToken)
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = undefined
    }
  })()
  return refreshInFlight
}

/** 认证入口自身的 401 是凭据错误，不做刷新重试。 */
function isAuthEntry(path: string): boolean {
  return path === '/auth/login' || path === '/auth/register' || path === '/auth/refresh' || path === '/auth/logout'
}

async function send<T>(path: string, options: RequestOptions, allowRefresh: boolean): Promise<T> {
  const method = options.method ?? 'GET'
  const response = await timedFetch(
    `${API_PREFIX}${withQuery(path, options.query)}`,
    {
      method,
      headers: headers(options.body !== undefined),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    },
    options.signal,
  )
  if (response.status === 401 && allowRefresh && !isAuthEntry(path)) {
    // 401 先单飞刷新并重试一次；刷新失败或重试仍 401 都清令牌并广播会话失效。
    if (!(await refreshAccessToken())) {
      expireSession()
      throw await failure(response)
    }
    try {
      return await send<T>(path, options, false)
    } catch (retryFailure) {
      if (retryFailure instanceof ApiError && retryFailure.status === 401) expireSession()
      throw retryFailure
    }
  }
  if (!response.ok) throw await failure(response)
  const text = await response.text()
  if (text === '') throw new ApiError('EMPTY_RESPONSE', `${method} ${path} returned an empty body`, response.status)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ApiError('BAD_RESPONSE', `${method} ${path} is not JSON: ${String(error)}`, response.status)
  }
  if (!isEnvelope(parsed)) throw new ApiError('BAD_ENVELOPE', `${method} ${path} has no ok flag`, response.status)
  if (!parsed.ok) throw await failure(new Response(text, { status: response.status }))
  return parsed as T
}

/**
 * 发起一次框架层 REST 调用。
 * @param path - `/api/solo` 之后的短路径。
 * @param options - 方法 / body / 查询 / 中止信号。
 * @returns 成功信封（`ok: true` 的 JSON 对象）。
 * @throws ApiError —— 网络失败或 `ok: false`。
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return await send<T>(path, options, true)
}

/**
 * 取二进制响应（技能包导出）。
 * @param path - `/api/solo` 之后的短路径。
 * @returns 响应 Blob。
 * @throws ApiError —— 失败时把 JSON 错误体解析成结构化错误。
 */
export async function requestBlob(path: string): Promise<Blob> {
  const attempt = async (allowRefresh: boolean): Promise<Blob> => {
    const response = await timedFetch(`${API_PREFIX}${path}`, { headers: headers(false) }, undefined)
    if (response.status === 401 && allowRefresh && !isAuthEntry(path)) {
      // 二进制导出与普通请求同一套 401 处理：先刷新并重试一次，否则令牌过期后必然失败。
      if (!(await refreshAccessToken())) {
        expireSession()
        throw await failure(response)
      }
      try {
        return await attempt(false)
      } catch (retryFailure) {
        if (retryFailure instanceof ApiError && retryFailure.status === 401) expireSession()
        throw retryFailure
      }
    }
    if (!response.ok) throw await failure(response)
    return await response.blob()
  }
  return await attempt(true)
}

/**
 * 是否为「请求根本没到达服务端」这一类失败（离线、DNS、连接被中止）。
 *
 * 界面必须把它与业务错误分开：`message` 是引擎原文（实测中文界面直出 "Failed to fetch"），
 * 读不懂也给不出路（R8 机器串禁止直出 / R17 可操作出路 / R31 离线区分）。
 * 分类只在这里做一次，`describeError` 据此给出成品句子，调用方无需各写一份。
 * @param error - 任意异常。
 * @returns 是否为网络层失败。
 */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NETWORK'
}

/**
 * 把任意异常转成可展示文案。
 *
 * `ApiError.code` 是机器可读标识（供调用方按码分支），**禁止直出到界面**（R8：机器码直出）；
 * 界面句子的前缀（哪一份数据没拿到）由调用方负责，这里只提供人类可读的原因。
 * 仅当 message 为空时才回落 code，保证错误始终有可读内容。
 *
 * 网络层失败的原因串本身就是引擎原文，任何调用方都译不出用户读得懂的话；实测全站几十个
 * `产品文案 — describeError(…)` 位点都会把它原样打到界面上，所以分类在这一处完成并直接
 * 给出成品句子（离线 / 无法连接服务端，R31），而不是要求每个位点各自判断一遍。
 */
export function describeError(error: unknown): string {
  if (isNetworkFailure(error)) {
    return navigator.onLine ? t('common', 'errorServerUnreachable') : t('common', 'errorOffline')
  }
  if (error instanceof ApiError) {
    if (error.code === 'TIMEOUT') return t('common', 'errorTimeout')
    return error.message === '' ? t('common', 'unknownError') : error.message
  }
  // 浏览器原生的中止/超时异常（AbortSignal.timeout 等）的 message 是英文原文，不得直出。
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return t('common', 'errorTimeout')
    return error.message
  }
  return String(error)
}
