/**
 * Register the agent terminal tab: one line-oriented panel over the Session's
 * platform terminals (`ctx.terminals`), reached from the guide and the sidebar
 * shortcut.
 *
 * The panel attaches to the same PTY sessions the terminal tools operate, so
 * the person at the keyboard continues what the agent started. Ownership is
 * the Session's — every Remote call carries it, and the Host resolves the live
 * owner; the panel never names one.
 */
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { PluginArtworkTerminal } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentTerminalPanel } from './AgentTerminalPanel.tsx'
import type { AgentTerminalInjected } from './face.ts'
import { forgetTerminal } from './recovery.ts'
import { persistedOutput } from './replay.ts'
import { TerminalGuide } from './TerminalGuide.tsx'
import { TerminalTitle } from './TerminalTitle.tsx'
import { en, zh } from './locales.ts'

/** Services needed by the terminal's sidebar seats. */
export const inject = [
  'slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'shortcuts',
  'remote', 'remote.terminal', 'sessions',
]

/**
 * Register the terminal type, its guide entry, body and title.
 * @param ctx - Client root Context with sidebar, Remote and copy services.
 */
export function apply(ctx: Context): void {
  const namespace = 'sidebarTerminal'
  const id = '@deepseek-ai/dsh-client-ui-sidebar-terminal'
  const t = ctx.locale.bind(namespace)
  ctx.effect(() => ctx.shortcuts.register({
    id: 'terminal.new' as ShortcutCommandId, label: () => t('new'), aliases: ['new terminal', 'shell'],
    defaults: {
      'desktop:macos': { code: 'Backquote', modifiers: ['control'] },
      'desktop:windows': { code: 'Backquote', modifiers: ['control'] },
      'desktop:linux': { code: 'Backquote', modifiers: ['control'] },
      'web:macos': { code: 'Backquote', modifiers: ['control'] },
      'web:windows': { code: 'Backquote', modifiers: ['control'] },
    },
    regions: ['page', 'editable', 'terminal'], modals: [],
    resolve: ({ target: element }) => {
      const target = ctx.sidebarRight.commandTarget(element)
      if (target === undefined) return { status: 'blocked', reason: t('shortcut.noSession') }
      return { status: 'handled', run: () => { ctx.sidebarRight.openTabFromTarget('terminal', target) } }
    },
  }), 'ui-sidebar-terminal: shortcut')
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'ui-sidebar-terminal.copy')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id, kind: 'terminal', multiple: true, priority: 'builtin', title: () => t('title'),
    guide: [{ id: 'new', order: 20, title: () => t('new'), description: () => t('description'), icon: PluginArtworkTerminal }],
  }), 'ui-sidebar-terminal.type')

  /** Bind the panel's commands to one Session: ownership travels with every call. */
  const face = (sessionId: SessionId): AgentTerminalInjected => ({
    list: signal => ctx.remote.terminal.agentTerminals(sessionId, signal),
    spawn: (request, signal) => ctx.remote.terminal.agentSpawn(sessionId, { type: request.type }, signal),
    read: (terminalId, count, signal) => ctx.remote.terminal.agentRead(sessionId, terminalId, { offset: 0, count }, signal),
    send: (terminalId, text, signal) => ctx.remote.terminal.agentSend(sessionId, terminalId, { text, submit: true }, signal),
    interrupt: (terminalId, signal) => ctx.remote.terminal.agentSignal(sessionId, terminalId, 'SIGINT', signal),
    persisted: terminalId => persistedOutput(
      ctx.sessions.binding(sessionId)?.eventSource.getSnapshot().entries ?? [],
      terminalId,
    ),
  })

  // Closing a terminal tab keeps its process: only the tab's recovery record is
  // dropped, so a reopened tab starts a new attach instead of a dead identity.
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler('terminal', (sessionId, tab) => {
    forgetTerminal(sessionId, tab.contentId)
  }), 'ui-sidebar-terminal.recovery')

  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({
    name: 'sidebar.right.tab.guide.entry', key: id, locale: namespace,
    inject: () => ({ hooks: { shortcuts: ctx.shortcuts.catalog } }),
  }, TerminalGuide)), 'ui-sidebar-terminal.guide')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: id, locale: namespace, inject: face },
    AgentTerminalPanel,
  )), 'ui-sidebar-terminal.body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: id, locale: namespace },
    TerminalTitle,
  )), 'ui-sidebar-terminal.title')
}
