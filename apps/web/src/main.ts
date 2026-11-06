/**
 * Browser entry for the Web document: one dist, two faces.
 *
 * The product URL contract (`@soloengine/types`) decides which face renders:
 * product pages (`surface === 'product'`, including the root `/`) mount the
 * product application, everything else — the tool root and the run-panel deep
 * links (`/run/:agenticFlowId`) — boots the DSH shell.
 *
 * Trust-bootstrap return hop (pairs with the host's `trust-bootstrap.ts`): a loopback first
 * visit without a cookie is 303'd to the process-token URL with the original path parked in
 * the `soloengine-return` cookie. This entry consumes that cookie once, before mounting, and
 * restores the address bar — so `http://127.0.0.1:8991/run/<flow>` lands on the panel directly.
 */
import { AppWebEntry, applyIndexInjections } from '@deepseek-ai/dsh-client-web'
import { isProductPagePathname } from '@soloengine/types'

/** Return-hop cookie name (the host's `RETURN_COOKIE` carries the same value). */
const RETURN_COOKIE = 'soloengine-return'

/** Read one cookie's raw value (null when absent). */
function readCookie(name: string): string | null {
  for (const segment of document.cookie.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return null
}

/** Expire the consumed return-hop cookie. */
function clearReturnCookie(): void {
  document.cookie = `${RETURN_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`
}

/**
 * Apply the return-hop target once: site-absolute paths only (protocol-relative and external
 * addresses are refused), consumed before any application mounts.
 */
function consumeReturnTarget(): void {
  const raw = readCookie(RETURN_COOKIE)
  if (raw === null) return
  clearReturnCookie()
  const target = decodeURIComponent(raw)
  if (!target.startsWith('/') || target.startsWith('//')) return
  window.history.replaceState(null, '', target)
}

consumeReturnTarget()

interface DesktopBootGlobal {
  dshDesktopBoot?: {
    failed(message: string): Promise<void>
    ready(): Promise<{ injections: Parameters<typeof applyIndexInjections>[0]; streamBaseUrl: string }>
  }
}
const desktop = (globalThis as DesktopBootGlobal).dshDesktopBoot
const reportFailure = (reason: unknown): void => {
  if (desktop === undefined) throw reason
  void desktop.failed(reason instanceof Error ? reason.message : String(reason)).catch(console.error)
}

try {
  const el = document.getElementById('root')
  if (el === null) throw new Error('web app: missing #root')
  // `/run/:flow` 还没有运行会话时宿主注入空态标记：这一屏属于管理层（选目录并发起运行），
  // 由产品应用渲染起始页；有会话时同一条 URL 不带该标记，仍装载原生面板。
  const emptyRunPanel = (globalThis as { __SOLOENGINE_RUN_EMPTY__?: boolean }).__SOLOENGINE_RUN_EMPTY__ === true
  if (isProductPagePathname(window.location.pathname) || emptyRunPanel) {
    void import('./product/main.tsx').then(
      ({ mountProductApp }) => { mountProductApp(el) },
      (reason: unknown) => { console.error('web app: product page module failed to load', reason) },
    )
  } else {
    const entry = new AppWebEntry(el)
    if (desktop !== undefined) {
      const gate = (globalThis as { __DSH_BOOT_READY__?: PromiseWithResolvers<void> }).__DSH_BOOT_READY__
      if (gate === undefined) throw new Error('desktop web: boot readiness is missing')
      void desktop.ready().then(async ({ injections, streamBaseUrl }) => {
        const transport = globalThis as { __DSH_TRANSPORT__?: { ownsHost: boolean; streamBaseUrl: string } }
        transport.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl }
        await applyIndexInjections(injections, src => new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = src
          script.onload = () => { resolve() }
          script.onerror = () => { reject(new Error(`desktop web: failed to load ${src}`)) }
          document.head.append(script)
        }))
        gate.resolve()
      }).catch((error: unknown) => { gate.reject(error) })
    }
    void entry.run(desktop === undefined ? undefined : reportFailure)
  }
} catch (reason) {
  reportFailure(reason)
}
