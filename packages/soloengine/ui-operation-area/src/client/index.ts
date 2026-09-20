/**
 * `@soloengine/ui-operation-area` 的浏览器半：工具跟随联动层 + 浏览器面板 + 变更面板。
 *
 * 依据 PRD-08 FR-OPS-004/008/009/011 与《SoloEngine 框架设计》§4.6：
 * - **联动层**（自研核心）：消费 `soloengine.followIntent` 呈现意图 → `ctx.sidebarRight.openResource`
 *   / `openTab` 自动打开或聚焦面板并定位；不以前端硬编码工具名→面板映射表重建。
 * - **浏览器面板**：`browser` 页面类型，多标签，页面经同源代理加载（地址栏与前进/后退）。
 * - **变更面板**：`changes` 页面类型，读台账（与消息区汇总条、编辑器装饰同源）。
 *
 * 注册全部走官方两段式（`ctx.sidebarRightTabs.register` 声明类型 + 键控
 * `sidebar.right.pane.tab` / `.title` 注册正文与标题），不自建平行面板机制。
 *
 * @module @soloengine/ui-operation-area/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// 资源视图类型（kind `text`）的导航参数声明合并：`params: { line }` 由文档面板声明。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// 呈现意图与运行上下文的投影键声明合并（宿主权威、客户端只读）。
import type {} from '@soloengine/types'
import { BrowserPanel } from './BrowserPanel.tsx'
import { ChangesPanel } from './ChangesPanel.tsx'
import { FollowWatcher, type FollowFace } from './FollowWatcher.tsx'
import { en, NS, zh, type SoloengineOpsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 操作区面板与联动层文案。 */
    soloengineOps: SoloengineOpsKey
  }
}

/** 需要的服务：槽位、右栏 tab 注册表、右栏导航控制器、本地化。 */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'locale']

/** 浏览器面板的页面类型 id（kind 开放字符串域；本包自有的操作区面板类型）。 */
const BROWSER_ID = '@soloengine/ui-operation-area/browser'
/** 变更面板的页面类型 id。 */
const CHANGES_ID = '@soloengine/ui-operation-area/changes'
/** 浏览器页面类型 kind。 */
const BROWSER_KIND = 'soloengine-browser'
/** 变更页面类型 kind。 */
const CHANGES_KIND = 'soloengine-changes'
/** 同源代理前缀（与 @soloengine/browser-proxy 的默认挂载点一致，可经该插件配置改写）。 */
const PROXY_PREFIX = '/soloengine/proxy'

/**
 * 浏览器插件体：注册联动层座位与两个操作区页面类型。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'soloengine-ui-operation-area:dictionaries')
  const t = ctx.locale.bind(NS)

  // 联动层：会话头工具座位上的空节点，按呈现意图分派（关闭时只打开不抢焦点）。
  const followFace = (): FollowFace => ({
    openFile: (address, line, focus) => {
      ctx.sidebarRight.openResource(address, {
        revealIfOpened: focus,
        ...line === undefined ? {} : { params: { line } },
      })
    },
    openTerminal: (focus) => {
      ctx.sidebarRight.openTab('terminal', { revealIfOpened: focus })
    },
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'soloengine.follow',
    locale: NS,
    inject: followFace,
  }, FollowWatcher))

  // 浏览器面板：页面类型（多标签在面板内自成一条标签带，故 dock tab 保持一格一占）。
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: BROWSER_ID,
    kind: BROWSER_KIND,
    priority: 'extension',
    title: () => t('browser.type'),
    guide: [{
      id: 'browser',
      order: 30,
      title: () => t('browser.guide.title'),
      description: () => t('browser.guide.description'),
    }],
  }), 'soloengine-ui-operation-area:browserType')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: BROWSER_ID,
    locale: NS,
    inject: (): { proxyPrefix: string } => ({ proxyPrefix: PROXY_PREFIX }),
  }, BrowserPanel))

  // 变更面板：页面类型。
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: CHANGES_ID,
    kind: CHANGES_KIND,
    priority: 'extension',
    title: () => t('changes.type'),
    guide: [{
      id: 'changes',
      order: 40,
      title: () => t('changes.guide.title'),
      description: () => t('changes.guide.description'),
    }],
  }), 'soloengine-ui-operation-area:changesType')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CHANGES_ID,
    locale: NS,
  }, ChangesPanel))

  console.log('soloengine-ui-operation-area: follow layer + browser panel + changes panel registered')
}
