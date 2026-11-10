/**
 * `@soloengine/browser-proxy` —— 浏览器同源代理（完全自研，Host 面；骨架借鉴第三方 dsh-browser 的
 * 「渲染 → 改写 → 同源返回」与 loopback 围栏思路，同源化、持续代理与安全层为自研）。
 *
 * 依据 PRD-08 FR-OPS-008、PRD-10 FR-SEC-009/FR-SEC-010、NFR-SEC-003，
 * 与《SoloEngine 框架设计》§4.6、《SoloEngine Harness插件体系完整介绍》§四 browser-proxy：
 *
 * - **catch-all 持续代理**：面板内页面发出的全部请求（GET/POST/流式）都回到本前缀，因此 iframe
 *   与父页**同源**——地址栏同步、前进/后退与链接点击可用，同时实例不变成任意网络出口；
 * - **SSRF 五条防线**：协议白名单 → 域名先解析 → 逐地址公网校验 → 连接钉住已校验地址（防 DNS 重绑定）
 *   → 重定向逐跳复检；WS 升级走同一条防线；
 * - **hop-by-hop 头剔除**；`Location` 重写为同源代理地址；HTML 注入 `<base>` + 链接重写脚本 +
 *   **等价父页隔离垫片**（代理页面脚本不得读取父 GUI：`parent`/`top`/`frames`/`frameElement`/`opener`
 *   在页面内被遮蔽为自身）；
 * - **代理地址经插件配置注入**（不硬编码）；转发上游时不携带 GUI 自身的信任门 cookie。
 *
 * @module @soloengine/browser-proxy
 */

import type { Context } from '@deepseek-ai/cordis'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as netConnect } from 'node:net'
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { SsrfRejection, validateTarget } from './ssrf.ts'

/** Cordis plugin name. */
export const name = 'soloengine-browser-proxy'
/** 需要 HTTP 服务座（prefix 路由 + upgrade 精确路径）与信任门。 */
export const inject = ['webServer', 'connection']

/** 插件配置（代理地址与上限均由此注入，不在代码里硬编码目标）。 */
export interface Config {
  /** 代理前缀（默认 `/soloengine/proxy`）。 */
  prefix?: string
  /** WebSocket 升级路径（默认 `/soloengine/proxy-ws`；官方 upgrade 只接受精确路径）。 */
  upgradePath?: string
  /** 重定向最大跳数（默认 5）。 */
  maxRedirects?: number
  /** 单次请求超时（毫秒，默认 30000）。 */
  timeoutMs?: number
}

const DEFAULT_PREFIX = '/soloengine/proxy'
const DEFAULT_UPGRADE_PATH = '/soloengine/proxy-ws'
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 30_000

/** 逐跳头（RFC 9110 hop-by-hop；转发前剔除，响应回程同样剔除）。 */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/** GUI 自身的信任门 cookie 前缀（绝不转发给上游）。 */
const GUI_COOKIE_PREFIX = 'dsh-auth-'

/** 需要改写的 HTML 属性（根绝对路径 → 代理地址）。 */
const REWRITE_ATTRS = ['href', 'src', 'action', 'poster', 'data-src', 'srcset'] as const

/** 把 origin 编成 URL 安全的 base64（路径段，无填充）。 */
function encodeOrigin(origin: string): string {
  return Buffer.from(origin, 'utf8').toString('base64url')
}

/**
 * 从路径段解出 origin。
 * @param segment - base64url 段。
 * @returns origin 文本。
 */
function decodeOrigin(segment: string): string {
  return Buffer.from(segment, 'base64url').toString('utf8')
}

/**
 * 过滤请求头：剔除逐跳头、`host`、GUI 信任门 cookie，并把 `accept-encoding` 固定为 identity
 * （使上游返回可改写的明文；代理链路不做压缩透传）。
 * @param headers - 原始请求头。
 * @param target - 目标 URL。
 * @returns 可转发的头。
 */
function outboundHeaders(headers: IncomingMessage['headers'], target: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower)) continue
    if (lower === 'host') continue
    if (lower === 'accept-encoding') continue
    if (lower === 'cookie') {
      const kept = String(value)
        .split(';')
        .map(part => part.trim())
        .filter(part => part !== '' && !part.toLowerCase().startsWith(GUI_COOKIE_PREFIX))
      if (kept.length > 0) out.cookie = kept.join('; ')
      continue
    }
    out[key] = value
  }
  out['accept-encoding'] = 'identity'
  out.host = target.host
  return out
}

/**
 * 把上游 `set-cookie` 改写成 GUI 源下的 host-only cookie（去掉 Domain / Path 收敛到代理前缀），
 * 使浏览器愿意保存并在后续代理请求里带回（Cookie/会话贯通）。
 * @param values - 上游 set-cookie 头（可能多条）。
 * @param prefix - 代理前缀。
 * @returns 改写后的 set-cookie 列表。
 */
function rewriteSetCookie(values: string[], prefix: string): string[] {
  return values.map(value => value
    .split(';')
    .filter((part) => {
      const lower = part.trim().toLowerCase()
      return !lower.startsWith('domain=') && !lower.startsWith('path=')
    })
    .concat(`Path=${prefix}`)
    .join('; '))
}

/**
 * 改写 HTML：注入 `<base>` + 隔离垫片，并把根绝对路径的属性指向代理前缀。
 * @param html - 上游 HTML 文本。
 * @param prefix - 代理前缀（含 origin 段）。
 * @param origin - 目标 origin（同源绝对地址改写用）。
 * @param upgradePath - WebSocket upgrade 的注册路径（垫片必须指向它）。
 * @returns 改写后的 HTML。
 */
function rewriteHtml(html: string, prefix: string, origin: string, upgradePath: string): string {
  const base = `${prefix}/`
  const shim = `<script>${isolationShim(prefix, origin, upgradePath)}</script>`
  const head = `<base href="${base}">${shim}`
  let out = html
  for (const attr of REWRITE_ATTRS) {
    const pattern = new RegExp(`(\\s${attr}\\s*=\\s*)(["'])([^"']*)\\2`, 'giu')
    out = out.replace(pattern, (whole, lead: string, quote: string, value: string) => {
      const rewritten = rewriteUrl(value, prefix, origin)
      return rewritten === value ? whole : `${lead}${quote}${rewritten}${quote}`
    })
  }
  if (/<head(?:\s[^>]*)?>/iu.test(out)) {
    out = out.replace(/<head(?:\s[^>]*)?>/iu, open => `${open}${head}`)
  } else {
    out = `${head}${out}`
  }
  return out
}

/**
 * 改写单个 URL：同源绝对地址与根绝对路径一律指向代理前缀；外站绝对地址保持原样。
 * @param value - 原值。
 * @param prefix - 代理前缀（含 origin 段）。
 * @param origin - 目标 origin。
 * @returns 改写后的值。
 */
function rewriteUrl(value: string, prefix: string, origin: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return value
  if (trimmed.startsWith('#')) return value
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('mailto:') || trimmed.startsWith('javascript:')) return value
  if (trimmed.startsWith('/')) return `${prefix}${trimmed}`
  if (trimmed.startsWith(origin)) return `${prefix}${trimmed.slice(origin.length)}`
  return value
}

/**
 * 等价父页隔离垫片：代理页面脚本不得读取父 GUI。
 *
 * 同源化使 iframe 与父页同源，浏览器不会阻止 `parent.document` 访问——故在文档最早的脚本里
 * 把遍历属性遮蔽为自身（`parent`/`top`/`frames` 指向自己，`frameElement`/`opener` 为 null），
 * 并改写 `WebSocket`/`fetch`/`XMLHttpRequest`/`history` 的目标，使页面自身仍能正常工作。
 * @param prefix - 代理前缀（含 origin 段）。
 * @param origin - 目标 origin。
 * @param upgradePath - WebSocket upgrade 的注册路径。
 * @returns 内联脚本正文。
 */
function isolationShim(prefix: string, origin: string, upgradePath: string): string {
  return `(function(){
var SELF=window,PREFIX=${JSON.stringify(prefix)},ORIGIN=${JSON.stringify(origin)},UPGRADE=${JSON.stringify(upgradePath)};
function hide(name,value){try{Object.defineProperty(SELF,name,{get:function(){return value},configurable:false})}catch(e){}}
hide('parent',SELF);hide('top',SELF);hide('frames',SELF);hide('frameElement',null);hide('opener',null);
function abs(u){try{return new URL(String(u),ORIGIN).href}catch(e){return null}}
function proxy(u){var a=abs(u);if(!a)return u;if(a.indexOf(ORIGIN)===0)return PREFIX+a.slice(ORIGIN.length);return u}
var WS=SELF.WebSocket;
if(WS){var Wrapped=function(url,protocols){
  var a=abs(url);if(a&&(a.indexOf('http://')===0||a.indexOf('https://')===0)){
    var wsUrl=a.replace(/^http/,'ws');
    var target=UPGRADE+'?target='+encodeURIComponent(wsUrl);
    return protocols===undefined?new WS(target):new WS(target,protocols);
  }
  return protocols===undefined?new WS(url):new WS(url,protocols);
};
Wrapped.prototype=WS.prototype;Wrapped.CONNECTING=0;Wrapped.OPEN=1;Wrapped.CLOSING=2;Wrapped.CLOSED=3;
try{SELF.WebSocket=Wrapped}catch(e){}
}
var origFetch=SELF.fetch;
if(origFetch){SELF.fetch=function(input,init){
  if(typeof input==='string')return origFetch(proxy(input),init);
  if(input&&input.url)return origFetch(new Request(proxy(input.url),input),init);
  return origFetch(input,init);
};}
var origOpen=SELF.XMLHttpRequest&&SELF.XMLHttpRequest.prototype.open;
if(origOpen){SELF.XMLHttpRequest.prototype.open=function(method,url){
  var args=[].slice.call(arguments);args[1]=proxy(url);return origOpen.apply(this,args);
};}
function rewriteHistory(name){var orig=SELF.history[name];if(typeof orig!=='function')return;
  SELF.history[name]=function(state,title,url){var args=[].slice.call(arguments);
    if(url!==undefined&&url!==null)args[2]=proxy(url);
    try{return orig.apply(SELF.history,args)}catch(e){return orig.call(SELF.history,state,title)}};}
rewriteHistory('pushState');rewriteHistory('replaceState');
})();`
}

/**
 * 建立一次上游请求（连接钉住已校验地址：`lookup` 只返回已校验地址，防 DNS 重绑定）。
 * @param target - 目标 URL。
 * @param addresses - 已校验地址集合。
 * @param options - 方法、头、超时。
 * @returns 上游请求对象。
 */
function upstreamRequest(
  target: URL,
  addresses: { address: string; family: 4 | 6 }[],
  options: { method: string; headers: Record<string, string | string[]>; timeoutMs: number },
): ClientRequest {
  const send = target.protocol === 'https:' ? httpsRequest : httpRequest
  return send({
    protocol: target.protocol,
    hostname: target.hostname.replace(/^\[|\]$/gu, ''),
    port: target.port === '' ? (target.protocol === 'https:' ? 443 : 80) : Number(target.port),
    path: `${target.pathname}${target.search}`,
    method: options.method,
    headers: options.headers,
    timeout: options.timeoutMs,
    lookup: (_hostname, lookupOptions, callback) => {
      const wanted = lookupOptions.family === 6 ? addresses.find(entry => entry.family === 6) : addresses.find(entry => entry.family === 4)
      const chosen = wanted ?? addresses[0]
      if (chosen === undefined) {
        callback(new Error('no validated address available'), '', 4)
        return
      }
      // 全部地址已通过公网校验：这里只把已校验地址交回给连接层。
      if (lookupOptions.all === true) callback(null, addresses.map(entry => ({ address: entry.address, family: entry.family })))
      else callback(null, chosen.address, chosen.family)
    },
  })
}

/**
 * 注册同源代理。
 * @param ctx - 插件上下文（须注入 `webServer`/`connection`）。
 * @param config - 插件配置。
 */
export function apply(ctx: Context, config: Config = {}): void {
  const prefix = config.prefix ?? DEFAULT_PREFIX
  const upgradePath = config.upgradePath ?? DEFAULT_UPGRADE_PATH
  const maxRedirects = config.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /** 结构化拒绝：原因直接呈现给用户（不超时假死）。 */
  const reject = (res: ServerResponse, status: number, code: string, message: string): void => {
    const body = JSON.stringify({ ok: false, error: { code, message } })
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body)
  }

  /**
   * 解析代理路径。
   * @param pathname - 请求路径。
   * @returns 目标 URL 文本与代理前缀（含 origin 段），或 undefined（不是一条代理目标请求）。
   */
  const resolveTarget = (pathname: string): { raw: string; prefix: string } | undefined => {
    if (!pathname.startsWith(`${prefix}/`)) return undefined
    const rest = pathname.slice(prefix.length + 1)
    const slash = rest.indexOf('/')
    const segment = slash === -1 ? rest : rest.slice(0, slash)
    if (segment === '' || segment.startsWith('__')) return undefined
    let origin: string
    try {
      origin = decodeOrigin(segment)
    } catch {
      return undefined
    }
    if (!origin.startsWith('http://') && !origin.startsWith('https://')) return undefined
    const tail = slash === -1 ? '/' : rest.slice(slash)
    return { raw: `${origin}${tail}`, prefix: `${prefix}/${segment}` }
  }

  /**
   * 转发一次请求（含重定向逐跳复检）。
   * @param req - 浏览器请求。
   * @param res - 浏览器响应。
   * @param initial - 初始目标与代理前缀。
   * @param body - 请求体（无体为 undefined）。
   */
  const forward = async (
    req: IncomingMessage,
    res: ServerResponse,
    initial: { raw: string; prefix: string },
    body: Buffer | undefined,
  ): Promise<void> => {
    let current = initial.raw
    let currentPrefix = initial.prefix
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const validated = await validateTarget(current)
      const target = validated.url
      const headers = outboundHeaders(req.headers, target)
      const upstream = upstreamRequest(target, validated.addresses, {
        method: req.method ?? 'GET',
        headers,
        timeoutMs,
      })
      const response = await new Promise<IncomingMessage>((resolve, rejectPromise) => {
        upstream.on('response', resolve)
        upstream.on('timeout', () => { upstream.destroy(new Error(`upstream ${target.href} timed out after ${String(timeoutMs)}ms`)) })
        upstream.on('error', rejectPromise)
        if (body !== undefined) upstream.end(body)
        else upstream.end()
      })
      const status = response.statusCode ?? 502
      const location = response.headers.location
      if (status >= 300 && status < 400 && typeof location === 'string') {
        // 重定向逐跳复检（FR-SEC-010）：下一跳重新走协议 + 解析 + 逐地址校验。
        const next = new URL(location, target).href
        response.resume()
        current = next
        const nextOrigin = new URL(next).origin
        currentPrefix = `${prefix}/${encodeOrigin(nextOrigin)}`
        continue
      }
      const contentType = response.headers['content-type'] ?? ''
      const isHtml = contentType.toLowerCase().includes('text/html')
      const outHeaders: Record<string, string | string[]> = {}
      for (const [key, value] of Object.entries(response.headers)) {
        if (value === undefined) continue
        const lower = key.toLowerCase()
        if (HOP_BY_HOP.has(lower)) continue
        if (lower === 'content-security-policy' || lower === 'content-security-policy-report-only') continue
        if (lower === 'x-frame-options') continue
        if (lower === 'location') { outHeaders.location = rewriteUrl(String(value), currentPrefix, target.origin); continue }
        if (lower === 'set-cookie') { outHeaders['set-cookie'] = rewriteSetCookie(Array.isArray(value) ? value : [value], prefix); continue }
        if (isHtml && (lower === 'content-length' || lower === 'content-encoding')) continue
        outHeaders[key] = value
      }
      if (isHtml) {
        const chunks: Buffer[] = []
        for await (const chunk of response) chunks.push(chunk as Buffer)
        const html = rewriteHtml(Buffer.concat(chunks).toString('utf8'), currentPrefix, target.origin, upgradePath)
        outHeaders['content-type'] = 'text/html; charset=utf-8'
        res.writeHead(status, outHeaders)
        res.end(html)
        return
      }
      res.writeHead(status, outHeaders)
      response.pipe(res)
      return
    }
    reject(res, 508, 'TOO_MANY_REDIRECTS', `the target redirected more than ${String(maxRedirects)} times`)
  }

  ctx.effect(() => {
    const disposeHttp = ctx.webServer.register({
      kind: 'prefix',
      path: prefix,
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          reject(res, rejection, 'UNTRUSTED', `browser proxy rejected the request (${String(rejection)})`)
          return
        }
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
        // 打开入口：/__open?url=<绝对地址> → 302 到该地址的代理路径（面板地址栏与预览卡使用）。
        if (url.pathname === `${prefix}/__open`) {
          const raw = url.searchParams.get('url') ?? ''
          let origin: string
          try {
            origin = new URL(raw).origin
          } catch {
            reject(res, 400, 'TARGET_INVALID', `url "${raw}" is not an absolute URL`)
            return
          }
          const rest = new URL(raw).pathname + new URL(raw).search
          res.writeHead(302, { location: `${prefix}/${encodeOrigin(origin)}${rest === '' ? '/' : rest}` })
          res.end()
          return
        }
        const resolved = resolveTarget(url.pathname)
        if (resolved === undefined) {
          reject(res, 400, 'TARGET_INVALID', `not a proxy target path: ${url.pathname}`)
          return
        }
        const chunks: Buffer[] = []
        req.on('data', chunk => chunks.push(chunk as Buffer))
        req.on('end', () => {
          const body = chunks.length === 0 ? undefined : Buffer.concat(chunks)
          void forward(req, res, resolved, body).catch((error: unknown) => {
            if (error instanceof SsrfRejection) {
              // SSRF 拒绝：明确呈现拒绝原因（不超时假死）。
              reject(res, 403, error.code, error.message)
              return
            }
            if (res.headersSent) { res.destroy(); return }
            reject(res, 502, 'UPSTREAM_FAILED', String(error))
          })
        })
        req.on('error', () => { /* 浏览器提前断开：转发自然结束。 */ })
      },
    })
    // WebSocket upgrade：官方 upgrade 只接受精确路径，故以查询参数承载目标（面板垫片自动改写）。
    const disposeUpgrade = ctx.webServer.registerUpgrade({
      path: upgradePath,
      handler: (req, socket, head) => {
        // 升级路径与 HTTP 前缀路由同一道信任门：upgrade 不经过前缀 handler，必须在这里单独判定，
        // 否则任何能连到端口的客户端都能把本实例当成出站 WebSocket 中继。
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) {
          socket.write(
            `HTTP/1.1 ${String(rejection)} Untrusted\r\ncontent-type: text/plain; charset=utf-8\r\n\r\n`
            + 'browser proxy rejected the upgrade (the trust cookie is missing or invalid)',
          )
          socket.destroy()
          return
        }
        void (async () => {
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
          const raw = url.searchParams.get('target') ?? ''
          const validated = await validateTarget(raw.replace(/^ws/iu, 'http'))
          const target = validated.url
          const upstream = netConnect({
            host: target.hostname.replace(/^\[|\]$/gu, ''),
            port: target.port === '' ? (target.protocol === 'https:' ? 443 : 80) : Number(target.port),
            // 连接钉住已校验地址（防 DNS 重绑定）：逐跳复检已在 validateTarget 完成。
            lookup: (_hostname, _options, callback) => {
              const chosen = validated.addresses[0]
              if (chosen === undefined) { callback(new Error('no validated address available'), '', 4); return }
              callback(null, chosen.address, chosen.family)
            },
          })
          upstream.on('connect', () => {
            const headers = { ...req.headers, host: target.host } as Record<string, string | undefined>
            delete headers.connection
            delete headers.upgrade
            const lines = [`GET ${target.pathname}${target.search} HTTP/1.1`]
            for (const [key, value] of Object.entries(headers)) {
              if (value === undefined) continue
              lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
            }
            lines.push('Connection: Upgrade', 'Upgrade: websocket', '', '')
            upstream.write(lines.join('\r\n'))
            if (head.length > 0) upstream.write(head)
            socket.pipe(upstream)
            upstream.pipe(socket)
          })
          upstream.on('error', (error) => {
            socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
            socket.destroy(error instanceof Error ? error : undefined)
          })
          socket.on('error', () => { upstream.destroy() })
        })().catch((error: unknown) => {
          const reason = error instanceof SsrfRejection ? error.message : String(error)
          socket.write(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain; charset=utf-8\r\n\r\n${reason}`)
          socket.destroy()
        })
      },
    })
    console.log(`soloengine: browser proxy mounted (${prefix} catch-all, upgrade=${upgradePath}, ssrf=resolve+per-address+pinned-connect+per-hop-recheck)`)
    return () => { disposeHttp(); disposeUpgrade() }
  }, 'soloengine-browser-proxy.mount')
}
