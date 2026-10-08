/**
 * 极简 history 路由：pushState + popstate，无第三方 router。
 * 路由表：/login、/canvases、/canvas/:id、/models、/skills、/skills/:id、
 * /mcp、/market、/packaging、/settings；未知路径落到 /canvases。
 */
import { useSyncExternalStore } from 'react'

/** 路由名。 */
export type RouteName =
  | 'login' | 'canvases' | 'canvas' | 'models' | 'skills' | 'skill'
  | 'mcp' | 'market' | 'packaging' | 'settings'

/** 一次匹配结果。 */
export interface RouteMatch {
  name: RouteName
  /** 路径参数（:id）。 */
  params: Record<string, string>
  /** 查询串。 */
  query: URLSearchParams
  /** 原始路径。 */
  pathname: string
}

const listeners = new Set<() => void>()
/**
 * 最近一次「已确认落地」的完整地址。
 *
 * popstate 触发时浏览器地址栏**已经**变成目标地址，无法像 pushState 那样事前拦截；
 * 取消离开时用这里记录的地址把地址栏与视图还原（见下方 popstate 监听）。
 * `refresh()` 在每次导航后都会更新它，因此它始终等于当前视图对应的地址。
 */
let landedHref = window.location.href
let snapshot: RouteMatch = matchRoute(window.location.pathname, window.location.search)

/** 去掉尾部斜杠（根路径除外）。 */
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * 匹配路径。
 * @param pathname - 当前路径。
 * @param search - 查询串。
 * @returns 匹配结果；未知路径返回 `/canvases`。
 */
export function matchRoute(pathname: string, search = ''): RouteMatch {
  const path = normalize(pathname)
  const query = new URLSearchParams(search)
  const segments = path.split('/').filter(segment => segment !== '')
  const first = segments[0]
  const second = segments[1]
  if (first === 'login') return { name: 'login', params: {}, query, pathname: path }
  // 画布编辑器是单数 `/canvas/:agenticFlowId`；复数 `/canvases` 是列表页。
  if (first === 'canvas' && second !== undefined) return { name: 'canvas', params: { id: second }, query, pathname: path }
  if (first === 'canvases') return { name: 'canvases', params: {}, query, pathname: path }
  if (first === 'models') return { name: 'models', params: {}, query, pathname: path }
  if (first === 'skills') {
    if (second === undefined) return { name: 'skills', params: {}, query, pathname: path }
    return { name: 'skill', params: { id: second }, query, pathname: path }
  }
  if (first === 'mcp') return { name: 'mcp', params: {}, query, pathname: path }
  if (first === 'market') return { name: 'market', params: {}, query, pathname: path }
  if (first === 'packaging') return { name: 'packaging', params: {}, query, pathname: path }
  if (first === 'settings') return { name: 'settings', params: {}, query, pathname: path }
  return { name: 'canvases', params: {}, query, pathname: path }
}

/** 刷新快照并通知订阅者。 */
function refresh(): void {
  snapshot = matchRoute(window.location.pathname, window.location.search)
  landedHref = window.location.href
  for (const listener of listeners) listener()
}

/** 订阅路由变化。 */
export function subscribeRoute(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 当前路由快照（useSyncExternalStore 的 getSnapshot）。 */
export function routeSnapshot(): RouteMatch {
  return snapshot
}

/** 导航阻塞器：有未保存态的页面（编辑器等）注册；返回提示文案，null=放行。 */
type RouteBlocker = () => string | null
let routeBlocker: RouteBlocker | null = null

/**
 * 注册/清除导航阻塞器（SPA 内 navigate 统一经过；整页跳转由 beforeunload 原生承担）。
 * @param blocker - 阻塞器函数；传 null 清除。
 */
export function setRouteBlocker(blocker: RouteBlocker | null): void {
  routeBlocker = blocker
}

/**
 * 应用内跳转（pushState）。
 * @param to - 目标路径（可带查询串）。
 * @param options - replace: 以 replaceState 跳转（用于规范化修正，不新增历史条目）。
 */
export function navigate(to: string, options?: { replace?: boolean }): void {
  if (`${window.location.pathname}${window.location.search}` === to) {
    refresh()
    return
  }
  if (routeBlocker !== null) {
    const message = routeBlocker()
    if (message !== null && !window.confirm(message)) return
  }
  if (options?.replace === true) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  refresh()
}

/**
 * 整页跳转（离开产品应用，例如进入 DSH 原生运行面板）。
 * @param to - 目标路径。
 */
export function openPage(to: string): void {
  window.location.assign(to)
}

/** popstate 监听（模块加载时挂一次）。 */
window.addEventListener('popstate', () => {
  if (routeBlocker !== null) {
    const message = routeBlocker()
    // 与 navigate() 同一判据（R33/R39）：未保存态下浏览器后退/前进不得静默丢弃改动。
    if (message !== null && !window.confirm(message)) {
      window.history.pushState(null, '', landedHref)
      refresh()
      return
    }
  }
  refresh()
})

/** React hook：当前路由。 */
export function useRoute(): RouteMatch {
  return useSyncExternalStore(subscribeRoute, routeSnapshot, routeSnapshot)
}
