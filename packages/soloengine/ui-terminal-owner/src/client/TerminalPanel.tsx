/**
 * 终端面板（PRD-08 FR-OPS-003 / FR-OPS-005；PRD-06 FR-ENG-028；PRD-10 FR-SEC-007）。
 *
 * 以同名 kind `terminal` 的 **extension 档**接管官方终端面板：官方面板的 PTY 来自
 * `api-terminal-controller`（`ctx.subprocess.spawnTerminal` 自建注册表），与本册
 * 「终端事实源唯一为 `ctx.terminals`（owner 精确归属）」不相容——故保留官方契约
 * （kind、tab 参数 `{terminalId}`、多标签、刷新恢复、行式契约）而替换传输实现。
 *
 * 数据经 `@soloengine/terminal-bridge`（Host 侧 `/soloengine/terminal/*`，信任门鉴权；
 * owner 由会话键在 Host 侧解析，**不接受前端上报的 owner**）。
 *
 * @module @soloengine/ui-terminal-owner/TerminalPanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TerminalPanel.module.css'
import type { SoloengineTerminalKey } from './locales.ts'

/** 终端桥前缀（Host 侧插件挂载点）。 */
const BRIDGE = '/soloengine/terminal'

/** 一条终端会话（与桥的视图同形）。 */
interface TerminalView {
  sessionId: string
  name: string | null
  type: string
  pid: number | null
  state: 'running' | 'exited' | 'failed'
  exitCode: number | null
}

/** 回放条目（跨重启的已持久输出）。 */
interface ReplayEntry {
  callId: string
  toolName: string
  seq: number
  text: string
}

/** 面板体 props。 */
export type TerminalPanelProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'soloengineTerminal'>

/** 统一请求（信任门 cookie 随源发送）。 */
async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${BRIDGE}${path}`, { credentials: 'same-origin', ...init })
  const body = await response.json() as Record<string, unknown>
  if (!response.ok || body.ok !== true) {
    const error = body.error as { code?: string; message?: string } | undefined
    throw new Error(`${error?.code ?? `HTTP ${String(response.status)}`}: ${error?.message ?? 'unknown failure'}`)
  }
  return body
}

/**
 * 渲染 owner 终端面板：本次进程代的实时终端 + 跨重启的持久回放。
 * @param props - tab 记录座位、session 作用域标准座位与本地化座位。
 * @returns 面板体。
 */
export function TerminalPanel({ useTabInfo, sessionId, t }: TerminalPanelProps) {
  const { tab } = useTabInfo()
  const params = tab.navigation.params as { terminalId?: string } | undefined
  const [terminals, setTerminals] = useState<TerminalView[]>([])
  const [activeId, setActiveId] = useState<string | null>(params?.terminalId ?? null)
  const [scrollback, setScrollback] = useState('')
  const [replay, setReplay] = useState<ReplayEntry[]>([])
  const [generation, setGeneration] = useState<string>('live-and-persisted')
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const spawned = useRef(false)

  const key = encodeURIComponent(sessionId)

  /** 读取终端列表；`terminalId` 参数指定的会话优先成为当前会话。 */
  const refreshList = useCallback(async (): Promise<TerminalView[]> => {
    const body = await call(`/sessions?sessionKey=${key}`)
    const list = (body.terminals ?? []) as TerminalView[]
    setTerminals(list)
    return list
  }, [key])

  /** 读取当前终端的行窗口。 */
  const refreshScrollback = useCallback(async (id: string): Promise<void> => {
    const body = await call(`/sessions/${encodeURIComponent(id)}?sessionKey=${key}&offset=0&count=400`)
    const page = body.scrollback as { text?: string } | undefined
    setScrollback(page?.text ?? '')
  }, [key])

  /** 读取跨重启回放（已持久工具结果）。 */
  const refreshReplay = useCallback(async (): Promise<void> => {
    const body = await call(`/replay?sessionKey=${key}`)
    setReplay((body.entries ?? []) as ReplayEntry[])
    setGeneration(String(body.generation ?? 'live-and-persisted'))
  }, [key])

  // 打开即创建（属于当前会话的 owner 作用域）；指定 terminalId 时直接 attach 已存在会话。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setBusy(true)
        const list = await refreshList()
        if (cancelled) return
        if (params?.terminalId !== undefined && params.terminalId !== '') {
          setActiveId(params.terminalId)
        } else if (list.length > 0) {
          setActiveId(list[0]?.sessionId ?? null)
        } else if (!spawned.current) {
          spawned.current = true
          const created = await call('/sessions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionKey: sessionId }),
          })
          const terminal = created.terminal as TerminalView | undefined
          if (cancelled) return
          if (terminal !== undefined) {
            setActiveId(terminal.sessionId)
            setTerminals([terminal])
          }
        }
        await refreshReplay()
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [sessionId, params?.terminalId, refreshList, refreshReplay])

  // 轮询行窗口（行式契约：有界 scrollback 分页读取）。
  useEffect(() => {
    if (activeId === null) return undefined
    const timer = setInterval(() => {
      void refreshScrollback(activeId).catch(() => { /* 轮询失败不覆盖已有输出；错误由下一次显式操作呈现。 */ })
    }, 1500)
    void refreshScrollback(activeId).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { clearInterval(timer) }
  }, [activeId, refreshScrollback])

  const active = terminals.find(candidate => candidate.sessionId === activeId) ?? null

  /** 发送一行（行式契约：text + submit）。 */
  const send = useCallback(async (text: string): Promise<void> => {
    if (activeId === null || text === '') return
    setBusy(true)
    try {
      await call(`/sessions/${encodeURIComponent(activeId)}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionKey: sessionId, text, submit: true }),
      })
      setInput('')
      await refreshScrollback(activeId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [activeId, sessionId, refreshScrollback])

  /** 中断当前前台命令。 */
  const interrupt = useCallback(async (): Promise<void> => {
    if (activeId === null) return
    try {
      await call(`/sessions/${encodeURIComponent(activeId)}/signal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionKey: sessionId, signal: 'SIGINT' }),
      })
      await refreshScrollback(activeId)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [activeId, sessionId, refreshScrollback])

  return (
    <div className={styles.root}>
      <div className={styles.strip}>
        {terminals.map(candidate => (
          <button
            key={candidate.sessionId}
            type="button"
            className={candidate.sessionId === activeId ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            onClick={() => { setActiveId(candidate.sessionId) }}
          >
            {candidate.name ?? `${t('terminal.type')} · ${candidate.sessionId.slice(0, 8)}`}
          </button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            spawned.current = true
            void (async () => {
              try {
                const created = await call('/sessions', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ sessionKey: sessionId }),
                })
                const terminal = created.terminal as TerminalView | undefined
                if (terminal !== undefined) {
                  setTerminals(current => [...current, terminal])
                  setActiveId(terminal.sessionId)
                }
              } catch (failure) {
                setError(failure instanceof Error ? failure.message : String(failure))
              }
            })()
          }}
        >
          {t('terminal.new')}
        </Button>
      </div>

      <div className={styles.meta}>
        <span>{`${t('terminal.owner')} · ${active?.sessionId.slice(0, 8) ?? '—'}`}</span>
        {active?.state === 'exited' ? <span>{t('terminal.exited').replace('{code}', String(active.exitCode ?? 0))}</span> : null}
        <span>{t('terminal.generation.live')}</span>
      </div>

      {error !== null ? <div className={styles.error} role="alert">{`${t('terminal.error')}: ${error}`}</div> : null}

      {terminals.length === 0 && !busy
        ? <div className={styles.state}>{t('terminal.empty')}</div>
        : (
          <pre className={styles.screen} aria-label={t('terminal.type')}>
            {scrollback === '' ? (busy ? t('terminal.creating') : t('terminal.loading')) : scrollback}
          </pre>
        )}

      <form
        className={styles.inputRow}
        onSubmit={(event) => {
          event.preventDefault()
          void send(input)
        }}
      >
        <Input
          value={input}
          placeholder={t('terminal.input.placeholder')}
          onChange={(event) => { setInput(event.target.value) }}
        />
        <Button size="sm" variant="outline" type="submit" disabled={activeId === null || busy}>{t('terminal.send')}</Button>
        <Button size="sm" variant="ghost" type="button" disabled={activeId === null} onClick={() => { void interrupt() }}>
          {t('terminal.interrupt')}
        </Button>
      </form>

      <div className={styles.note}>{t('terminal.lineContract')}</div>

      <div className={styles.replay}>
        <div className={styles.replayHead}>
          <span>{t('terminal.replay.title')}</span>
          <span>{generation === 'persisted-only' ? t('terminal.generation.persisted') : t('terminal.generation.live')}</span>
        </div>
        {replay.length === 0
          ? <div className={styles.state}>{t('terminal.replay.empty')}</div>
          : replay.map(entry => (
            <div key={entry.callId} className={styles.replayEntry}>
              <div className={styles.replayMeta}>{`${entry.toolName} · seq ${String(entry.seq)}`}</div>
              <pre className={styles.replayBody}>{entry.text}</pre>
            </div>
          ))}
      </div>
    </div>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineTerminalKey }
