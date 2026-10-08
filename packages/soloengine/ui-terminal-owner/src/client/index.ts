/**
 * `@soloengine/ui-terminal-owner` 的浏览器半：终端面板（改造复用官方 `ui-sidebar-terminal` 的契约）。
 *
 * 依据 PRD-08 FR-OPS-003/005 与《SoloEngine Harness插件体系完整介绍》§三 runmode：
 * 以**同名 kind `terminal` 的 `extension` 档**注册（官方档位契约：一个 kind 至多一个 builtin
 * 与一个 extension，extension 生效），保留官方契约（kind、tab 参数 `{terminalId}`、多标签、
 * 行式契约），把传输实现替换为 `ctx.terminals` 的 owner 归属会话桥。
 *
 * 实测边界（2026-09-25，运行面板）：**存活的是 Host 侧的终端进程**，不是右栏的 tab 条——
 * 页面刷新后右栏 tab 条回到空态（官方座位的 tab 记录不落盘），重新打开终端时由 `refreshList`
 * 接回本会话已有的 owner 终端。故此处不再声称「刷新后恢复」。
 *
 * 形态纪律：同一功能只装载一个插件——本包生效时官方 `ui-sidebar-terminal` 的正文不渲染
 * （其 body 注册在它自己的 id 下），组合层同时把该行禁用（见 host/cordis.patch.yml）。
 *
 * @module @soloengine/ui-terminal-owner/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TerminalPanel } from './TerminalPanel.tsx'
import { en, NS, zh, type SoloengineTerminalKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 终端面板文案。 */
    soloengineTerminal: SoloengineTerminalKey
  }
}

/** 需要的服务：槽位、右栏 tab 注册表、本地化。 */
export const inject = ['slots', 'sidebarRightTabs', 'locale']

/** 本实现在 tab 系统中的身份（一个 kind 的 extension 档）。 */
const TERMINAL_ID = '@soloengine/ui-terminal-owner/terminal'

/**
 * 浏览器插件体：以 extension 档接管 `terminal` kind 并注册面板正文与标题。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'soloengine-ui-terminal-owner:dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TERMINAL_ID,
    kind: 'terminal',
    priority: 'extension',
    multiple: true,
    title: () => t('terminal.type'),
    guide: [{
      id: 'terminal',
      order: 20,
      title: () => t('terminal.guide.title'),
      description: () => t('terminal.guide.description'),
    }],
  }), 'soloengine-ui-terminal-owner:type')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TERMINAL_ID,
    locale: NS,
  }, TerminalPanel))
}
