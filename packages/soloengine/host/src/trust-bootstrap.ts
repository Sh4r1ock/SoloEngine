/**
 * 连接信任门引导（PRD-10 FR-SEC-011 / PRD-07 FR-UI-018 / PRD-11 FR-DEP-002）。
 *
 * 设计事实：harness 的浏览器信任门是**权威绑定**的——进程启动令牌经 `/?token=…` 换取一张
 * 按 `Host:port` 命名的签名 cookie，之后同一 authority 的页面与 `/api` 才被放行。这带来两个
 * 真实可用性问题（本模块只解决它们，不放宽连接面）：
 *
 * 1. **authority 别名**：就绪行打印的是绑定地址（`127.0.0.1:8991`），而部署者与测试流程
 *    使用 `http://localhost:8991`；两者是不同 authority → 同一浏览器在 `localhost` 下永远
 *    拿不到 cookie（表现为 `dsh web authentication required`）。
 * 2. **首访无 cookie**：全新浏览器必须先用带令牌的地址访问一次，否则产品页面（含登录页）
 *    无法呈现——而设计要求「就绪输出可访问地址（浏览器可直接打开）」。
 *
 * 引导规则（本机回环限定）：
 * - 只对**回环远端 + 回环 authority** 的 GET/HEAD 生效；域外/局域网请求原样交给原生门（拒绝）；
 * - 未认证时 303 到**同一 authority** 的令牌 URL（`authenticatedUrl('http://<host>')`），
 *   让浏览器在同一 authority 下换取签名 cookie；令牌只出现在 Location 头，不进响应体、不进日志；
 * - 被引导的原始路径（深链）写入 `soloengine-return` cookie，客户端消费一次即清（`main.ts`）；
 * - 已持 cookie（含令牌无效/非回环）一律交回原生门判定——**连接面（RPC 与事件流）不经过本模块**，
 *   仍由 `ctx.connection` 的信任门检查，故「无有效令牌的连接请求 → 拒绝」不变。
 *
 * @module @soloengine/host/trust-bootstrap
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** 引导回跳 cookie 名（页面侧消费一次即清）。 */
export const RETURN_COOKIE = 'soloengine-return'

/** 回环 authority 的主机名全集（DNS 别名 + IPv4 + IPv6 字面量）。 */
const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']

/** 回环远端地址形态（node 在双栈下给出映射形式）。 */
const LOOPBACK_REMOTES: readonly string[] = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

/**
 * 解析请求 authority（与 harness 的 cookie 命名同法：`new URL('http://' + host).host`）。
 * @param req - 入站请求。
 * @returns 规范 authority，或无法解析时的 `undefined`。
 */
export function requestAuthority(req: IncomingMessage): string | undefined {
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return undefined
  try {
    return new URL(`http://${host}`).host
  } catch {
    return undefined
  }
}

/**
 * 判定 authority 是否回环（主机名为回环别名或回环字面量）。
 * @param authority - 规范 authority。
 * @returns 是否回环。
 */
export function isLoopbackAuthority(authority: string): boolean {
  const host = authority.replace(/:\d+$/u, '')
  return LOOPBACK_HOSTS.includes(host)
}

/**
 * 判定请求是否来自本机（socket 远端为回环；Web Worker 隧道无 socket 时视为非本机）。
 * @param req - 入站请求。
 * @returns 是否本机来源。
 */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const remote = req.socket?.remoteAddress
  if (typeof remote !== 'string') return false
  return LOOPBACK_REMOTES.includes(remote)
}

/**
 * 判定请求是否携带令牌查询参数（携带则一律交原生门做换取，避免自我重定向成环）。
 * @param req - 入站请求。
 * @returns 是否带 `token` 参数。
 */
export function hasTokenParameter(req: IncomingMessage): boolean {
  try {
    return new URL(req.url ?? '/', 'http://dsh.invalid').searchParams.getAll('token').length > 0
  } catch {
    return false
  }
}

/**
 * 写信任门引导响应：303 到同一 authority 的令牌 URL，并把原路径写进回跳 cookie。
 * @param req - 入站请求。
 * @param res - 响应（本函数持有其生命周期）。
 * @param options - authority 与令牌 URL 构造器。
 */
export function writeTrustBootstrap(
  req: IncomingMessage,
  res: ServerResponse,
  options: { authority: string; authenticatedUrl: (baseUrl: string) => string },
): void {
  const url = new URL(req.url ?? '/', 'http://dsh.invalid')
  const target = `${url.pathname}${url.search}`
  const headers: Record<string, string> = {
    location: options.authenticatedUrl(`http://${options.authority}`),
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  }
  if (target !== '/') {
    headers['set-cookie'] = `${RETURN_COOKIE}=${encodeURIComponent(target)}; Max-Age=300; Path=/; SameSite=Strict`
  }
  res.writeHead(303, headers)
  res.end()
}
