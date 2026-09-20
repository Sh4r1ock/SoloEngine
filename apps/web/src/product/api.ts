/**
 * 框架层 REST 客户端：统一 `request()`，带 Bearer 访问令牌，失败抛结构化错误。
 * 无回退、无静默降级：任何失败都以 ApiError 抛出，由调用方呈现在界面上。
 */

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
  signal?: AbortSignal
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

/**
 * 发起一次框架层 REST 调用。
 * @param path - `/api/solo` 之后的短路径。
 * @param options - 方法 / body / 查询 / 中止信号。
 * @returns 成功信封（`ok: true` 的 JSON 对象）。
 * @throws ApiError —— 网络失败或 `ok: false`。
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  let response: Response
  try {
    response = await fetch(`${API_PREFIX}${withQuery(path, options.query)}`, {
      method,
      headers: headers(options.body !== undefined),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    throw new ApiError('NETWORK', error instanceof Error ? error.message : String(error), 0)
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
  if (parsed.ok !== true) throw await failure(new Response(text, { status: response.status }))
  return parsed as T
}

/**
 * 取二进制响应（技能包导出）。
 * @param path - `/api/solo` 之后的短路径。
 * @returns 响应 Blob。
 * @throws ApiError —— 失败时把 JSON 错误体解析成结构化错误。
 */
export async function requestBlob(path: string): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(`${API_PREFIX}${path}`, { headers: headers(false) })
  } catch (error) {
    throw new ApiError('NETWORK', error instanceof Error ? error.message : String(error), 0)
  }
  if (!response.ok) throw await failure(response)
  return await response.blob()
}

/** 把任意异常转成可展示文案（ApiError 带 code，其余用 message）。 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
