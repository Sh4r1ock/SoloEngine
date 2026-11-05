/**
 * `@soloengine/client-bootstrap` 的浏览器半：URL 直达会话与启动接线。
 *
 * 依据 PRD-01 §实例隔离（`/run/:agenticFlowId`）与 PRD-07 FR-UI-019：运行面板按 **agenticflow**
 * 区分 URL，**会话键不进地址栏**——它只是面板内部的数据归属。宿主在渲染外壳时把该 flow 最近一次
 * 运行的会话键随页下发（`window.__SOLOENGINE_RUN_SESSION__`），本插件读它并在会话列表基线就绪后
 * 以**主视图来源**持有该会话（`mainView`）——主视图把「持有该来源的会话」视为当前会话，
 * 因此 URL 直达与用户点击列表走同一条选择路径。解析不到即**明确报错**，不静默停在空白页。
 *
 * 不做路由框架、不做第二份状态：只把「这个画布的运行面板」这一 URL 事实翻译为一次原生会话选择。
 *
 * @module @soloengine/client-bootstrap/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

declare global {
  interface Window {
    /** 宿主为 `/run/:agenticFlowId` 解析出的会话键（地址栏不含它）。 */
    __SOLOENGINE_RUN_SESSION__?: string
    /** 地址栏里的 agenticflow id（报错与日志用）。 */
    __SOLOENGINE_RUN_FLOW__?: string
  }
}

/** 需要的服务：会话控制器（会话列表基线与选择）。 */
export const inject = ['sessions']

/**
 * 取本次运行面板要打开的会话键与其归属画布。
 *
 * 「这是不是运行面板」以宿主是否注入 flow 为准：注入只发生在 `/run/:agenticFlowId` 外壳，
 * 客户端不再复写一份路径前缀（路由真源在 `@soloengine/types` 的 `RUN_PANEL_PREFIX`）。
 * @returns `{ sessionKey, flowId }`；非运行面板或该 flow 尚无会话时为 undefined。
 */
export function runPanelTarget(): { sessionKey: string; flowId: string } | undefined {
  const flowId = window.__SOLOENGINE_RUN_FLOW__
  const sessionKey = window.__SOLOENGINE_RUN_SESSION__
  if (typeof flowId !== 'string' || flowId === '') return undefined
  if (typeof sessionKey !== 'string' || sessionKey === '') return undefined
  return { sessionKey, flowId }
}

/**
 * 会话无法打开的界面级报错（FR-UI-019：不静默停在空白页）。DOM 叠加卡，
 * 颜色只消费语义 token（--dsw-*）与 --se-z 阶梯，随三主题自动切换。
 * @param flowId - 地址栏里的画布 id。
 * @param sessionKey - 宿主解析出的会话键。
 */
export function showSessionNotFoundError(flowId: string, sessionKey: string): void {
  if (document.querySelector('[data-se-session-error]') !== null) return
  const card = document.createElement('div')
  card.setAttribute('data-se-session-error', '')
  card.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:var(--se-z-modal, 1000)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.24))',
    'backdrop-filter:var(--dsw-mask-blur, blur(2px))',
  ].join(';')
  const panel = document.createElement('div')
  panel.style.cssText = [
    'max-width:420px', 'padding:var(--se-space-5, 24px)',
    'border-radius:var(--se-radius-xl, 24px)',
    'background:var(--dsw-alias-bg-layer-2, #fff)',
    'box-shadow:var(--dsw-elevation-prominent, none)',
    'font:var(--dsw-font-s-14, 14px/22px sans-serif)',
    'color:var(--dsw-alias-label-primary, #0f1115)',
  ].join(';')
  const title = document.createElement('p')
  title.style.cssText = 'margin:0 0 8px;font-weight:600'
  title.textContent = '会话不存在 · Session not found'
  const body = document.createElement('p')
  body.style.cssText = 'margin:0;color:var(--dsw-alias-label-secondary, #61666b);overflow-wrap:anywhere'
  body.textContent = `画布 "${flowId}" 的会话 "${sessionKey}" 不在宿主会话列表中（可能已被删除或属于其他账号）。` +
    ' The session addressed by this canvas is not in the host session list.'
  panel.append(title, body)
  card.append(panel)
  document.body.append(card)
}

/** 产品页存访问令牌的 localStorage 键（与 `apps/web` 的 `ACCESS_TOKEN_KEY` 同值）。 */
const ACCESS_TOKEN_KEY = 'soloengine.accessToken'

/**
 * 该 flow 还没有运行会话时的开始卡：**不要求先选项目**（需求 §9.5 ⑤）。
 *
 * 目录选择走 dsh 原生目录选择器（`/soloengine/pick-directory` 桥），拿到目录后按
 * 「用户 × 画布 × 目录」登记运行项目并发起一次运行；同一个 flow 可以反复用不同目录。
 * @param flowId - 地址栏里的 agenticflow id。
 */
function mountStartPanel(flowId: string): void {
  if (document.querySelector('[data-se-start-panel]') !== null) return
  const overlay = document.createElement('div')
  overlay.setAttribute('data-se-start-panel', '')
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:var(--se-z-modal, 1000)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.24))',
    'backdrop-filter:var(--dsw-mask-blur, blur(2px))',
  ].join(';')
  const panel = document.createElement('div')
  panel.style.cssText = [
    'max-width:460px', 'padding:var(--se-space-5, 24px)',
    'border-radius:var(--se-radius-xl, 24px)',
    'background:var(--dsw-alias-bg-layer-2, #fff)',
    'box-shadow:var(--dsw-elevation-prominent, none)',
    'font:var(--dsw-font-s-14, 14px/22px sans-serif)',
    'color:var(--dsw-alias-label-primary, #0f1115)',
  ].join(';')
  const title = document.createElement('p')
  title.style.cssText = 'margin:0 0 8px;font-weight:600'
  title.textContent = '尚未开始运行 · No run yet'
  const body = document.createElement('p')
  body.style.cssText = 'margin:0;color:var(--dsw-alias-label-secondary, #61666b);overflow-wrap:anywhere'
  body.textContent = '选择一个工作目录开始；这个画布可以使用任意目录，不绑定某一个项目。'
    + ' Pick a workspace folder to start; this canvas can use any folder and is not bound to one project.'
  const error = document.createElement('p')
  error.style.cssText = 'margin:12px 0 0;color:var(--dsw-alias-label-secondary, #61666b);overflow-wrap:anywhere'
  error.hidden = true
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '选择目录并开始 · Pick a folder and start'
  button.style.cssText = [
    'margin-top:16px', 'padding:0 16px', 'height:36px', 'cursor:pointer',
    'border:0', 'border-radius:var(--dsw-radius-sm, 8px)',
    'background:var(--dsw-alias-label-primary, #0f1115)',
    'color:var(--dsw-alias-bg-layer-2, #fff)',
    'font:var(--dsw-font-s-14, 14px/22px sans-serif)',
  ].join(';')
  button.addEventListener('click', () => {
    void startRun(flowId, button, error)
  })
  panel.append(title, body, button, error)
  overlay.append(panel)
  document.body.append(overlay)
}

/**
 * 用原生目录选择器选目录，并以此目录为该画布发起一次运行。
 * @param flowId - 地址栏里的 agenticflow id。
 * @param button - 开始按钮（请求期间禁用）。
 * @param error - 就地错误行。
 */
async function startRun(flowId: string, button: HTMLButtonElement, error: HTMLParagraphElement): Promise<void> {
  const token = window.localStorage.getItem(ACCESS_TOKEN_KEY) ?? ''
  if (token === '') {
    error.hidden = false
    error.textContent = '请先在产品页登录 · Sign in on the product page first'
    return
  }
  button.disabled = true
  try {
    const picked = await fetch('/soloengine/pick-directory', { method: 'POST' })
    const pickBody = await picked.json() as { ok: boolean; path?: string | null; error?: { message?: string } }
    if (!pickBody.ok) throw new Error(pickBody.error?.message ?? 'the directory picker failed')
    if (typeof pickBody.path !== 'string' || pickBody.path === '') {
      button.disabled = false
      return
    }
    const response = await fetch('/api/solo/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ canvasId: flowId, folderPath: pickBody.path }),
    })
    const body = await response.json() as {
      ok: boolean
      session?: { panel_path?: string }
      error?: { message?: string }
    }
    if (!response.ok || !body.ok || typeof body.session?.panel_path !== 'string') {
      throw new Error(body.error?.message ?? `starting the run failed (${String(response.status)})`)
    }
    location.replace(body.session.panel_path)
  } catch (failure) {
    error.hidden = false
    error.textContent = failure instanceof Error ? failure.message : String(failure)
    button.disabled = false
  }
}

/**
 * 浏览器插件体：等待会话列表就绪并把本画布最近一次运行选为当前。
 *
 * 该 flow 还没有任何运行会话时**不要求先选项目**（需求 §9.5 ⑤）：面板照常打开，
 * 由 {@link mountStartPanel} 给出「选择目录并开始」——目录选择走 dsh 原生选择器，
 * 同一个 flow 可以用任意多个目录。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  const flowId = window.__SOLOENGINE_RUN_FLOW__
  if (typeof flowId !== 'string' || flowId === '') return
  const target = runPanelTarget()
  if (target === undefined) {
    mountStartPanel(flowId)
    return
  }
  const { sessionKey } = target
  const opened = sessionKey as SessionId
  ctx.effect(() => {
    /** 只认领一次：选择会同步触发列表通知，重入必须被挡在 open 之前（否则无限递归）。 */
    let settled = false
    /** 本面板持有的会话引用；dispose 时释放（最后一个引用释放即触发本地作用域与历史拆除）。 */
    let retained: { release(): void } | undefined
    const select = (): boolean => {
      if (settled) return true
      const snapshot = ctx.sessions.list.getSnapshot()
      if (snapshot.phase !== 'ready') return false
      settled = true
      if (!snapshot.ids.includes(opened)) {
        // 会话列表已就绪仍无该键：明确报错（不静默停在空白页、不降级到别的会话）。
        console.error(
          `soloengine-client-bootstrap: session ${sessionKey} of canvas ${flowId} from ${location.pathname} is not in the host session list`,
        )
        showSessionNotFoundError(flowId, sessionKey)
        return true
      }
      // URL 直达：以**主视图来源**持有该画布的会话键，主视图因此把它当作当前会话
      // （与用户点击列表同一条选择路径；`runPanel` 这类独立来源只预取历史，不会成为当前）。
      retained = ctx.sessions.retain(opened, { source: 'mainView' })
      console.log(`soloengine-client-bootstrap: selected session ${sessionKey} of canvas ${flowId} from ${location.pathname}`)
      return true
    }
    if (select()) return () => { retained?.release() }
    const off = ctx.sessions.list.subscribe(() => {
      if (select()) off()
    })
    return () => { off(); retained?.release() }
  }, 'soloengine-client-bootstrap: retain the session addressed by the canvas URL')
}
