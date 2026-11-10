/**
 * 产品页面 URL 契约（唯一名单）。
 *
 * 同一条知识原本散在四处：宿主注册前缀的数组、宿主解析 `/run/:agenticFlowId` 的字面量、
 * 产品应用的已知前缀数组、以及 `router.ts` 的逐条 `if`。四处各自写法正是「改了两处漏第三处」
 * 的来源。本模块是它们的唯一真源：
 * - 宿主：注册 [`PRODUCT_SURFACE_PATHS`] 全部前缀（根路径另以 exact 注册），并用
 *   [`RUN_PANEL_PREFIX`] 解析面板深链；
 * - 产品应用：用 [`isProductPagePathname`] 判已知路径，用 [`productPageRoute`] 驱动路由表；
 * - 面板深链包：用 [`RUN_PANEL_PREFIX`] 认自己的前缀。
 *
 * 两个消费面不同是事实，因此显式建模为 `surface`：`panel` 根由 DSH 原生壳渲染（进入某 id
 * 面板时装载该实例的客户端插件树，切出即卸载），不在产品 SPA 的路由表里。
 *
 * 根路径 `/` 即产品首页（营销页）：由产品 SPA 渲染，不是面板；控制台画布列表在 `/canvas`。
 *
 * 命名规范：**产品页面 URL 用单数名词**（`/canvas`、`/model`、`/skill`、`/user`），
 * 列表与详情共用同一根（详情取第二段）；REST 接口路径仍用资源复数（`/api/solo/canvases`），
 * 两者是不同层次，不互相推断。
 *
 * 本模块**零依赖**：宿主与浏览器两侧都直接 import 同一份常量与纯函数。
 *
 * @module @soloengine/types/routes
 */

/** 产品应用内的页面路由名（`router.ts` 的 `RouteName` 即本联合）。 */
export type ProductPageName =
  | 'home' | 'login' | 'styleguide' | 'canvases' | 'canvas' | 'models' | 'skills' | 'skill'
  | 'mcp' | 'market' | 'settings' | 'users'

/** 一条 URL 根归属的界面。 */
export type ProductSurface =
  /** 产品应用（SPA）渲染的页面。 */
  | 'product'
  /** DSH 原生运行面板：URL 按画布区分，会话选择由 `client-bootstrap` 完成。 */
  | 'panel'

/** 产品 URL 的一条根。 */
export interface ProductRouteRoot {
  /** URL 首段（不带斜杠），如 `canvases`；空串表示根路径 `/`。 */
  readonly segment: string
  /** 归属界面。 */
  readonly surface: ProductSurface
  /** 只带首段时的页面名；缺省表示该根不带参数的形态不成立。 */
  readonly listName?: ProductPageName
  /** 带一段路径参数时的页面名；缺省表示该根不接受参数段。 */
  readonly detailName?: ProductPageName
}

/**
 * 运行面板的 URL 根（`/run/:agenticFlowId`）。
 *
 * 这是产品里**唯一**的 Harness 面：缺 id（`/run`、`/run/`）或带多余段时宿主 404，
 * 不渲染面板；其余页面全部由产品应用（管理层）渲染。进入面板只允许来自画布动作，
 * 不存在第二个 Harness 入口（例如 `/plugin-manager`）。
 */
export const RUN_ROUTE_ROOT: ProductRouteRoot = { segment: 'run', surface: 'panel' }

/** 产品首页的 URL 根（根路径 `/` → 营销首页）。 */
export const HOME_ROUTE_ROOT: ProductRouteRoot = { segment: '', surface: 'product', listName: 'home' }

/** 产品 URL 的全部根（宿主注册它们，SPA 只渲染 `surface === 'product'` 的那些）。 */
export const PRODUCT_ROUTE_ROOTS: readonly ProductRouteRoot[] = [
  HOME_ROUTE_ROOT,
  RUN_ROUTE_ROOT,
  { segment: 'login', surface: 'product', listName: 'login' },
  // 设计系统对照页（W17.1）：应用壳层内的开发参考页，不是导航项。
  { segment: 'styleguide', surface: 'product', listName: 'styleguide' },
  { segment: 'canvas', surface: 'product', listName: 'canvases', detailName: 'canvas' },
  { segment: 'model', surface: 'product', listName: 'models' },
  { segment: 'skill', surface: 'product', listName: 'skills', detailName: 'skill' },
  { segment: 'mcp', surface: 'product', listName: 'mcp' },
  { segment: 'market', surface: 'product', listName: 'market' },
  { segment: 'settings', surface: 'product', listName: 'settings' },
  // 用户管理（W11.1）：仅超管可达；页面本身对非超管返回 403，侧栏项也只对超管渲染。
  { segment: 'user', surface: 'product', listName: 'users' },
]

/** 宿主向 `ctx.webServer` 注册的全部前缀路径（含运行面板；根路径以 exact 另行注册）。 */
export const PRODUCT_SURFACE_PATHS: readonly string[] = PRODUCT_ROUTE_ROOTS
  .filter(root => root.segment !== '')
  .map(root => `/${root.segment}`)

/** 运行面板深链前缀（`/run/`）；宿主解析与面板包认前缀都读这一个值。 */
export const RUN_PANEL_PREFIX: string = `/${RUN_ROUTE_ROOT.segment}/`

/** 一条路径与 URL 根的匹配结果。 */
export interface ProductRouteMatch {
  readonly root: ProductRouteRoot
  /** 第二段（已解码）；该路径只带首段时缺省。 */
  readonly param?: string
}

/**
 * 按首段匹配一条 URL 根；根路径匹配 [`HOME_ROUTE_ROOT`]。
 * @param pathname - 以 `/` 开头的路径（尾部斜杠与多余段不影响匹配）。
 * @returns 匹配结果；首段不是任何产品根即 undefined。
 */
export function matchProductRouteRoot(pathname: string): ProductRouteMatch | undefined {
  const segments = pathname.split('/').filter(segment => segment !== '')
  const first = segments[0]
  if (first === undefined) return { root: HOME_ROUTE_ROOT }
  const root = PRODUCT_ROUTE_ROOTS.find(candidate => candidate.segment === first)
  if (root === undefined) return undefined
  const second = segments[1]
  if (second === undefined) return { root }
  try {
    return { root, param: decodeURIComponent(second) }
  } catch {
    // 非法百分号编码（如 `/canvas/%E0%A4%A`）不能把路由解析抛成 URIError 让 SPA 白屏：
    // 按「不是已知产品路径」处理，由调用方回落到默认页。
    return undefined
  }
}

/**
 * 该路径是否由产品应用渲染（运行面板归 DSH 原生壳，不在此列）。
 * @param pathname - 当前路径。
 * @returns 路径是否由产品应用渲染。
 */
export function isProductPagePathname(pathname: string): boolean {
  return matchProductRouteRoot(pathname)?.root.surface === 'product'
}

/**
 * 该路径对应的产品页面与路径参数。
 * @param pathname - 当前路径（已去尾部斜杠）。
 * @returns 页面名与可选参数；未知路径或非产品界面即 undefined（调用方回落默认页）。
 */
export function productPageRoute(pathname: string): { name: ProductPageName; param?: string } | undefined {
  const matched = matchProductRouteRoot(pathname)
  if (matched === undefined || matched.root.surface !== 'product') return undefined
  const name = matched.param === undefined ? matched.root.listName : matched.root.detailName ?? matched.root.listName
  if (name === undefined) return undefined
  return matched.param === undefined ? { name } : { name, param: matched.param }
}
