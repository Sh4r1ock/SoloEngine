/**
 * The terminal guide entry: one card that opens the agent terminal panel.
 *
 * There is no shell menu any more: the panel attaches to the Session's own
 * platform terminals, whose backend the composition decides, and a new one is
 * created by the panel itself.
 */
import type { ReactNode } from 'react'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import { Button, PluginArtworkTerminal, ShortcutKeys } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './locales.ts'
import css from './TerminalGuide.module.css'

/** Provider-owned shortcut catalog the card displays. */
export interface TerminalGuideInjected {
  readonly hooks: { readonly shortcuts: HostObservable<readonly ShortcutCatalogEntry[]> }
}

/** Session guide owner props, framework hooks and terminal copy. */
export type TerminalGuideProps =
  PropsRuntime<'sidebar.right.tab.guide.entry'>
  & PropsLocale<'sidebarTerminal'>
  & InjectFace<TerminalGuideInjected>

/**
 * Render the guide card that opens one terminal panel.
 * @param props - guide copy, enclosing tab actions and the shortcut catalog.
 * @returns the card with its effective shortcut.
 */
export function TerminalGuide({
  title, description, kind, useTabInfo, useShortcuts,
}: TerminalGuideProps): ReactNode {
  const shortcut = useShortcuts(entries => entries.find(entry => entry.id === 'terminal.new'))
  const { tab } = useTabInfo()
  return <div className={css.entry} data-sidebar-right-guide-entry={kind}>
    <Button variant="ghost" className={css.main} aria-label={description === undefined ? title : `${title} ${description}`} aria-keyshortcuts={shortcut?.aria}
      onClick={() => { tab.actions.openTab('terminal', { replaceTab: true }) }} />
    <span className={css.icon} aria-hidden="true"><PluginArtworkTerminal size={description === undefined ? 22 : 26} /></span>
    <span className={css.text}>
      <span className={css.titleRow}>
        <span className={css.title} aria-hidden="true">{title}</span>
      </span>
      {description !== undefined && <span className={css.description} aria-hidden="true">{description}</span>}
    </span>
    {shortcut !== undefined && shortcut.keys.length > 0 && <ShortcutKeys keys={shortcut.keys} className={css.shortcut} />}
  </div>
}
