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
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'

declare global {
  interface Window {
    /** 宿主为 `/run/:agenticFlowId` 解析出的会话键（地址栏不含它）。 */
    __SOLOENGINE_RUN_SESSION__?: string
    /** 地址栏里的 agenticflow id（报错与日志用）。 */
    __SOLOENGINE_RUN_FLOW__?: string
    /** 该画布还没有运行会话：面板空态由本插件发起一次运行，而不是渲染产品中间页。 */
    __SOLOENGINE_RUN_EMPTY__?: boolean
    /** 同一次页面加载只发起一次运行（避免重复 POST /runs）。 */
    __SOLOENGINE_RUN_STARTING__?: boolean
  }
}

/** 需要的服务：会话控制器（会话列表基线）、工作区导航与工作区状态（面板新增工作区 → 运行项目登记）。 */
export const inject = ['sessions', 'uiWorkspace', 'workspaces']

/** 产品访问令牌的浏览器存储键（与 `apps/web/src/product/api.ts` 同一契约）。 */
const ACCESS_TOKEN_KEY = 'soloengine.accessToken'

/** `POST /runs` 返回的会话行（只取跳转需要的字段）。 */
interface RunSessionRow {
  panel_path: string
}

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
 * 面板级报错卡（FR-UI-019：不静默停在空白页）。DOM 叠加卡，
 * 颜色只消费语义 token（--dsw-*）与 --se-z 阶梯，随三主题自动切换。
 * @param marker - 卡片的数据属性名（同一类错误只挂一张）。
 * @param heading - 标题文案。
 * @param detail - 说明文案。
 */
function showPanelError(marker: string, heading: string, detail: string): void {
  if (document.querySelector(`[${marker}]`) !== null) return
  const card = document.createElement('div')
  card.setAttribute(marker, '')
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
  title.textContent = heading
  const body = document.createElement('p')
  body.style.cssText = 'margin:0;color:var(--dsw-alias-label-secondary, #61666b);overflow-wrap:anywhere'
  body.textContent = detail
  panel.append(title, body)
  card.append(panel)
  document.body.append(card)
}

/**
 * 会话无法打开的界面级报错（FR-UI-019：不静默停在空白页）。
 * @param flowId - 地址栏里的画布 id。
 * @param sessionKey - 宿主解析出的会话键。
 */
export function showSessionNotFoundError(flowId: string, sessionKey: string): void {
  showPanelError(
    'data-se-session-error',
    '会话不存在 · Session not found',
    `画布 "${flowId}" 的会话 "${sessionKey}" 不在宿主会话列表中（可能已被删除或属于其他账号）。`
      + ' The session addressed by this canvas is not in the host session list.',
  )
}

/** 读取产品访问令牌（未登录或浏览器禁用存储时为空串）。 */
function accessToken(): string {
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_KEY) ?? ''
  } catch {
    // 存储不可用时按未登录处理：调用方回到登录页。
    return ''
  }
}


/**
 * 在面板内发起一次运行：宿主用受管工作根（`data/runs/<canvasId>`）登记运行项目并启动，
 * 成功后只重新载入同一 URL——宿主此时已能解析出会话，面板按正常路径选中它。
 *
 * 目录选择不在入口发生：面板里的原生「添加工作区」才是选目录的唯一入口，避免入口页
 * 再出现第二套选择对话框，也避免原生 OS 选择器在无人操作时误返回路径。
 * @param flowId - 地址栏里的画布 id。
 */
function startRun(flowId: string): void {
  if (window.__SOLOENGINE_RUN_STARTING__ === true) return
  window.__SOLOENGINE_RUN_STARTING__ = true
  void (async () => {
    try {
      if (accessToken() === '') {
        window.location.replace('/login')
        return
      }
      const response = await fetch('/soloengine/run-settings/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canvasId: flowId }),
      })
      const text = await response.text()
      let body: { session?: RunSessionRow; error?: { message?: string } } | undefined
      try { body = JSON.parse(text) as typeof body } catch { body = undefined }
      if (!response.ok || body?.session === undefined) {
        throw new Error(body?.error?.message ?? `HTTP ${String(response.status)}`)
      }
      window.location.replace(body.session.panel_path)
    } catch (error) {
      window.__SOLOENGINE_RUN_STARTING__ = false
      showPanelError(
        'data-se-run-error',
        '无法开始运行 · Cannot start the run',
        error instanceof Error ? error.message : String(error),
      )
    }
  })()
}

/**
 * 面板里新增的工作区一旦有了会话，就把「画布 × 目录」登记为运行项目。
 *
 * 需求 §9.5 ⑤：同一个 flow 可以登记无限多个运行项目，每次运行按所选目录登记。目录由面板的
 * 原生「添加工作区」选择（产品不自建选择器）；工作区实体归原生，运行项目台账归产品，因此
 * 这里按原生工作区快照做一次对账：加载时已存在的工作区不登记（它们可能属于别的画布），
 * 只有本次加载后新增、且已经产生会话的工作区才登记。登记后宿主按 cwd 命中运行项目并补登
 * 会话台账行（`resolveSessionOwnership` 的 adopt 分支），画布列表与打包才看得见这次运行。
 * @param ctx - 客户端根上下文。
 * @param flowId - 地址栏里的画布 id。
 */
function registerNewWorkspaceProjects(ctx: ClientContext, flowId: string): void {
  const baseline = new Set<string>()
  const registered = new Set<string>()
  let captured = false
  const register = (path: string): void => {
    const token = accessToken()
    if (token === '') return
    void fetch('/api/solo/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ canvasId: flowId, folderPath: path }),
    }).then((response) => {
      if (response.ok) {
        console.log(`soloengine-client-bootstrap: registered run project ${path} for canvas ${flowId}`)
        return
      }
      console.warn(`soloengine-client-bootstrap: registering run project ${path} failed with HTTP ${String(response.status)}`)
    }, (error: unknown) => {
      console.warn(`soloengine-client-bootstrap: registering run project ${path} failed: ${String(error)}`)
    })
  }
  const scan = (): void => {
    const snapshot = ctx.workspaces.list.getSnapshot()
    if (snapshot.phase !== 'ready') return
    if (!captured) {
      captured = true
      for (const workspace of snapshot.items) baseline.add(workspace.path)
      return
    }
    for (const workspace of snapshot.items) {
      if (baseline.has(workspace.path) || registered.has(workspace.path)) continue
      if (workspace.sessionIds.length === 0) continue
      registered.add(workspace.path)
      register(workspace.path)
    }
  }
  scan()
  ctx.effect(
    () => ctx.workspaces.list.subscribe(scan),
    'soloengine-client-bootstrap: register panel workspaces as run projects',
  )
}

/**
 * 浏览器插件体：等待会话列表就绪并把本画布最近一次运行选为当前。
 *
 * 该 flow 还没有任何运行会话时，面板自己就是入口：`startRun` 用受管工作根在面板内发起一次
 * 运行并重载同一 URL（宿主此时已能解析会话）。
 *
 * 装配期先向工作区导航声明 URL 指向的会话：启动恢复据此只打开它，不再为「最近工作区」
 * 连接草稿（没有空会话时会**新建**一个）。运行面板的会话由 URL 决定，草稿只会让该画布
 * 多出一条空台账行，下一次 `/run/:flow` 便解析到它、打开成空白首屏。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  const flowId = window.__SOLOENGINE_RUN_FLOW__
  if (typeof flowId !== 'string' || flowId === '') return
  registerNewWorkspaceProjects(ctx, flowId)
  const target = runPanelTarget()
  if (target === undefined) {
    if (window.__SOLOENGINE_RUN_EMPTY__ === true) startRun(flowId)
    return
  }
  const { sessionKey } = target
  const opened = sessionKey as SessionId
  ctx.uiWorkspace.claimStartupSession(opened)
  ctx.effect(() => {
    /** 只判定一次：选择会同步触发列表通知，重入必须被挡在 open 之前（否则无限递归）。 */
    let settled = false
    const select = (): boolean => {
      if (settled) return true
      const snapshot = ctx.sessions.list.getSnapshot()
      if (snapshot.phase !== 'ready') return false
      if (!snapshot.ids.includes(opened)) {
        settled = true
        // 会话列表已就绪仍无该键：明确报错（不静默停在空白页、不降级到别的会话）。
        console.error(
          `soloengine-client-bootstrap: session ${sessionKey} of canvas ${flowId} from ${location.pathname} is not in the host session list`,
        )
        showSessionNotFoundError(flowId, sessionKey)
        return true
      }
      // `ids` 就绪早于摘要水合：摘要未到时选择只能落到一个不可渲染的占位。
      if (snapshot.byId[opened] === undefined) return false
      settled = true
      // 启动恢复可能已按装配期的声明打开过它；只补一次真正的选择，避免重复 retain。
      if ((snapshot.byId[opened].retainedBy.mainView ?? 0) === 0) ctx.uiWorkspace.openSession(opened)
      console.log(`soloengine-client-bootstrap: selected session ${sessionKey} of canvas ${flowId} from ${location.pathname}`)
      return true
    }
    if (select()) return () => {}
    const off = ctx.sessions.list.subscribe(() => {
      if (select()) off()
    })
    return off
  }, 'soloengine-client-bootstrap: open the session addressed by the canvas URL')
}
