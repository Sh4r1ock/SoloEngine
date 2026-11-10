/**
 * The terminal chip title: the terminal glyph before the tab's title.
 *
 * The panel attaches to an agent terminal whose name is captured when the tab
 * opens; the chip shows that captured title rather than subscribing to the
 * registry a second time.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TerminalIcon } from './TerminalIcon.tsx'
import css from './TerminalTitle.module.css'

/**
 * Render the terminal title as the chip and a floating panel's header show it.
 * @param props - the tab information hook.
 * @returns the terminal glyph followed by the tab's title text.
 */
export function TerminalTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  const { tab } = useTabInfo()
  return <>
    <TerminalIcon />
    <span className={css.title}>{tab.title}</span>
  </>
}
