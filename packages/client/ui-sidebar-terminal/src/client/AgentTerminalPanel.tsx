/**
 * The sidebar terminal body: a line-oriented view of the agent terminals this
 * Session owns.
 *
 * The registry (`ctx.terminals`) is the single source of terminal sessions, so
 * the person at the keyboard attaches to the same PTY the terminal tools
 * operate. Ownership is the Session's: every call carries the Session identity
 * over the typed Remote and the registry refuses a terminal that Session does
 * not own. The contract is line-oriented (bounded scrollback pages plus line
 * input); full-screen TUI programs are not supported.
 *
 * The body is keyed by the tab's `{ terminalId }` parameter: opening a tab for
 * an existing (including tool-created) terminal attaches to it, and a tab
 * without one reuses the terminal this tab showed before a reload, else the
 * Session's first terminal, else creates the first one.
 *
 * After a page reload the Sidebar restores this tab without its navigation
 * parameters, so the panel recalls its own `tab → terminal` record. After a
 * Host restart that terminal is gone; the panel then shows the bounded output
 * the Session log persisted through tool results and labels the new terminal as
 * a new generation.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentTerminalInfo } from '@deepseek-ai/dsh-api-terminal-controller/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentTerminalInjected } from './face.ts'
import type {} from './locales.ts'
import { recallTerminal, rememberTerminal } from './recovery.ts'
import css from './AgentTerminalPanel.module.css'

/** Rows requested per scrollback page. */
const PAGE_ROWS = 400

/** Poll interval while the active terminal runs and the tab is visible. */
const POLL_MS = 1500

/** The panel's composed props: the tab it draws, its face, and its copy. */
export type AgentTerminalPanelProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'sidebarTerminal'>
  & InjectFace<AgentTerminalInjected>

/**
 * Say why one terminal call failed.
 * @param failure - the settled Remote failure.
 * @param t - namespace-bound translate.
 * @returns the line to show.
 */
function failureText(failure: RemoteFailure, t: AgentTerminalPanelProps['t']): string {
  switch (failure.code) {
    case 'terminal/unavailable': return t('missingTerminal')
    case 'terminal/limit-reached': return t('terminalLimit')
    case 'gateway/lookup-not-found': return t('missingTerminal')
    default: return t('failed', { message: failure.message })
  }
}

/**
 * Render the line-oriented agent terminal panel.
 * @param props - tab record seat, terminal commands and localized copy.
 * @returns the panel body.
 */
export function AgentTerminalPanel({
  sessionId, useTabInfo, list, spawn, read, send, interrupt, persisted, t,
}: AgentTerminalPanelProps): ReactNode {
  const { tab } = useTabInfo()
  const visible = tab.visible
  /**
   * The tab record's lifetime, held in a ref: the record object is rebuilt on
   * every render, so depending on `tab.signal` directly would restart the open
   * effect (and its list) once per render.
   */
  const lifetime = useRef(tab.signal)
  lifetime.current = tab.signal
  /** The tab's `{ terminalId }` parameter selects an existing terminal to attach to. */
  const navigation: unknown = tab.navigation.params
  const attachId = typeof navigation === 'object' && navigation !== null && 'terminalId' in navigation
    ? String(navigation.terminalId)
    : ''
  /** Stable content identity of this tab, the key of its own recovery record. */
  const contentId = tab.contentId
  const [terminals, setTerminals] = useState<readonly AgentTerminalInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(attachId === '' ? null : attachId)
  const [screen, setScreen] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Read failures occupy their own line so a recovered poll clears it without hiding an action failure. */
  const [readError, setReadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** A terminal this tab showed before a reload, now absent from the live registry. */
  const [recoveredId, setRecoveredId] = useState<string | null>(null)
  /** Bounded output the Session log persisted for {@link recoveredId} through tool results. */
  const [replay, setReplay] = useState('')
  const spawned = useRef(false)

  /** Read the Session's terminals. */
  const refreshList = useCallback(async (): Promise<readonly AgentTerminalInfo[]> => {
    const result = await list(lifetime.current)
    if (!result.ok) throw new Failure(result.error)
    setTerminals(result.value)
    return result.value
  }, [list])

  /** Remember which terminal this tab shows so a reload restores the same one. */
  const remember = useCallback((terminalId: string): void => {
    rememberTerminal(sessionId, contentId, terminalId)
  }, [sessionId, contentId])

  /** Read the active terminal's page and fold its current state back into the list. */
  const refreshScreen = useCallback(async (terminalId: string): Promise<void> => {
    const result = await read(terminalId, PAGE_ROWS, lifetime.current)
    if (!result.ok) {
      setReadError(failureText(result.error, t))
    } else {
      setScreen(result.value.text)
      setLoaded(true)
      setReadError(null)
    }
    if (recoveredId !== null) {
      const text = persisted(recoveredId)
      if (text !== '') setReplay(text)
    }
  }, [read, t, recoveredId, persisted])

  // Open semantics: attach to the named terminal, else the one this tab showed
  // before a reload, else the first live one, else create the first one.
  useEffect(() => {
    const cancelled = { current: false }
    void (async () => {
      setBusy(true)
      try {
        const current = await refreshList()
        if (cancelled.current) return
        const remembered = recallTerminal(sessionId, contentId)
        const requested = attachId === '' ? remembered : attachId
        const requestedLive = requested !== undefined
          && current.some(candidate => candidate.terminalId === requested)
        if (requested !== undefined && !requestedLive) setRecoveredId(requested)
        if (requested !== undefined && requestedLive) {
          setActiveId(requested)
          remember(requested)
        } else if (current.length > 0) {
          const first = current[0]
          if (first !== undefined) {
            setActiveId(first.terminalId)
            remember(first.terminalId)
          }
        } else if (!spawned.current) {
          spawned.current = true
          const created = await spawn({ type: '' }, lifetime.current)
          // cleanup 在下方闭包里置位 cancelled，流分析看不到这次写入。
          // oxlint-disable-next-line typescript/no-unnecessary-condition
          if (cancelled.current) return
          if (!created.ok) throw new Failure(created.error)
          setTerminals([created.value.terminal])
          setActiveId(created.value.terminal.terminalId)
          remember(created.value.terminal.terminalId)
        }
      } catch (failure) {
        if (!cancelled.current) setError(errorText(failure, t))
      } finally {
        if (!cancelled.current) setBusy(false)
      }
    })()
    return () => { cancelled.current = true }
  }, [attachId, contentId, refreshList, remember, spawn, t, sessionId])

  // History can still be opening when the recovered tab mounts, so the replay
  // is re-read whenever the recovery identity changes and on each screen poll.
  useEffect(() => {
    if (recoveredId === null) return
    const text = persisted(recoveredId)
    if (text !== '') setReplay(text)
  }, [recoveredId, persisted])

  const active = terminals.find(candidate => candidate.terminalId === activeId) ?? null
  const activeState = active?.state ?? null

  // Poll while visible and running; a hidden tab or an exited process reads nothing.
  useEffect(() => {
    if (activeId === null || !visible) return undefined
    void refreshScreen(activeId)
    if (activeState !== null && activeState !== 'running') return undefined
    const timer = setInterval(() => { void refreshScreen(activeId) }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [activeId, activeState, visible, refreshScreen])

  /** Send one line; `sending` prevents a double submit from Enter plus a button click. */
  const sending = useRef(false)
  const submit = useCallback(async (text: string): Promise<void> => {
    if (activeId === null || text === '' || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await send(activeId, text, lifetime.current)
      if (!result.ok) {
        setError(failureText(result.error, t))
        return
      }
      setInput('')
      await refreshScreen(activeId)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }, [activeId, send, refreshScreen, t])

  /** Deliver SIGINT to the foreground command (the send lock is the same mutex). */
  const stop = useCallback(async (): Promise<void> => {
    if (activeId === null || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await interrupt(activeId, lifetime.current)
      if (!result.ok) {
        setError(failureText(result.error, t))
        return
      }
      await refreshScreen(activeId)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }, [activeId, interrupt, refreshScreen, t])

  /** Open one more terminal owned by this Session. */
  const create = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await spawn({ type: '' }, lifetime.current)
      if (!created.ok) {
        setError(failureText(created.error, t))
        return
      }
      setTerminals(current => [...current, created.value.terminal])
      setActiveId(created.value.terminal.terminalId)
      remember(created.value.terminal.terminalId)
      setScreen('')
      setLoaded(false)
    } finally {
      setBusy(false)
    }
  }, [busy, remember, spawn, t])

  return (
    <div className={css.root} data-agent-terminal-state={activeId === null ? 'none' : 'attached'}>
      <div className={css.strip}>
        {terminals.map(candidate => (
          <button
            key={candidate.terminalId}
            type="button"
            className={candidate.terminalId === activeId ? `${css.chip} ${css.chipActive}` : css.chip}
            aria-current={candidate.terminalId === activeId ? 'true' : undefined}
            data-agent-terminal={candidate.terminalId}
            onClick={() => {
              // Clear before switching so the new chip never shows the previous terminal's output.
              setScreen('')
              setLoaded(false)
              setReadError(null)
              // An explicit switch ends the recovered-generation view.
              setRecoveredId(null)
              setReplay('')
              setActiveId(candidate.terminalId)
              remember(candidate.terminalId)
            }}
          >
            {candidate.name ?? `${t('title')} · ${candidate.terminalId.slice(0, 8)}`}
          </button>
        ))}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void create() }}>{t('new')}</Button>
      </div>

      <div className={css.meta}>
        <span>{`${t('owner')} · ${active?.terminalId.slice(0, 8) ?? '—'}`}</span>
        {active?.state === 'exited'
          ? <span>{active.exitCode === null ? t('exitedUnknown') : t('exited', { code: String(active.exitCode) })}</span>
          : null}
      </div>

      {recoveredId !== null
        ? <div className={css.recovered} role="status">{t('recovered', { id: recoveredId.slice(0, 8) })}</div>
        : null}
      {replay !== ''
        ? (
          <section className={css.replay}>
            <div className={css.replayLabel}>{t('replayLabel')}</div>
            <pre className={css.replayScreen} aria-label={t('replayAria')}>{replay}</pre>
          </section>
        )
        : recoveredId !== null && !busy ? <div className={css.note}>{t('replayEmpty')}</div> : null}

      {error !== null ? <div className={css.error} role="alert">{`${t('lineError')} — ${error}`}</div> : null}
      {readError !== null ? <div className={css.error} role="alert">{`${t('lineReadError')} — ${readError}`}</div> : null}

      {terminals.length === 0 && !busy
        ? <div className={css.state}>{t('lineEmpty')}</div>
        : (
          <pre className={css.screen} aria-label={t('lineScreenAria')}>
            {screen === '' ? (loaded ? t('lineScreenEmpty') : busy ? t('creating') : t('loading')) : screen}
          </pre>
        )}

      <form
        className={css.inputRow}
        onSubmit={(event) => { event.preventDefault(); void submit(input) }}
      >
        <Input
          value={input}
          placeholder={t('lineInputPlaceholder')}
          disabled={activeId === null || busy}
          onChange={(event) => { setInput(event.target.value) }}
        />
        <Button size="sm" variant="outline" type="submit" disabled={activeId === null || busy}>{t('lineSend')}</Button>
        <Button size="sm" variant="ghost" type="button" disabled={activeId === null || busy} onClick={() => { void stop() }}>
          {t('lineInterrupt')}
        </Button>
      </form>

      <div className={css.note}>{t('lineContract')}</div>
    </div>
  )
}

/** A settled Remote failure raised into the panel's error handling. */
class Failure extends Error {
  /**
   * @param failure - the settled Remote failure.
   */
  constructor(readonly failure: RemoteFailure) {
    super(failure.message)
    this.name = 'Failure'
  }
}

/**
 * Turn an unexpected throw into the panel's error line.
 * @param error - the caught value.
 * @param t - namespace-bound translate.
 * @returns the text to show.
 */
function errorText(error: unknown, t: AgentTerminalPanelProps['t']): string {
  if (error instanceof Failure) return failureText(error.failure, t)
  if (error instanceof Error && error.message !== '') return error.message
  return t('lineError')
}
