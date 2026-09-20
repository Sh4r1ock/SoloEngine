/**
 * 浏览器入口：`/run/*` 维持 DSH 原生运行面板，其余路径挂产品页面应用。
 *
 * 信任门引导回跳（配合宿主 `trust-bootstrap.ts`）：本机回环的首次未认证访问由宿主 303 到
 * **同一 authority** 的进程令牌 URL 换取签名 cookie，原路径写进 `soloengine-return` cookie。
 * 这里在挂载任何应用之前取用一次即清，把地址栏还原为原深链——所以
 * `http://localhost:8991/run/<sessionKey>` 全新浏览器直开即可落到该运行面板，无需点击。
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

/** 引导回跳 cookie 名（与宿主 `RETURN_COOKIE` 同值）。 */
const RETURN_COOKIE = 'soloengine-return'

/** 读一个 cookie 的原始值（不存在返回 null）。 */
function readCookie(name: string): string | null {
  for (const segment of document.cookie.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return null
}

/** 清除引导回跳 cookie。 */
function clearReturnCookie(): void {
  document.cookie = `${RETURN_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`
}

/**
 * 消费引导回跳目标：只接受站内绝对路径（拒绝协议相对与外部地址），取用后即清。
 * 用 `replaceState` 而非跳转，避免为同一份 dist index 多打一次请求。
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

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')

if (window.location.pathname.startsWith('/run/')) {
  void new AppWebEntry(el).run()
} else {
  void import('./product/main.tsx').then(({ mountProductApp }) => { mountProductApp(el) })
}
