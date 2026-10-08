/**
 * 终端面板（PRD-08 FR-OPS-003 / FR-OPS-005；PRD-06 FR-ENG-028；PRD-10 FR-SEC-007）。
 *
 * 以同名 kind `terminal` 的 **extension 档**接管官方终端面板：官方面板的 PTY 来自
 * `api-terminal-controller`（`ctx.subprocess.spawnTerminal` 自建注册表），与本册
 * 「终端事实源唯一为 `ctx.terminals`（owner 精确归属）」不相容——故保留官方契约
 * （kind、tab 参数 `{terminalId}`、多标签、行式契约）而替换传输实现。
 *
 * 页面刷新后右栏 tab 条不恢复（官方 tab 记录不落盘），存活的是 Host 侧的终端进程：
 * 重新打开时由 `refreshList` 接回本会话已有的 owner 终端。
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
    throw new BridgeError(
      error?.code ?? `HTTP_${String(response.status)}`,
      error?.message ?? '',
    )
  }
  return body
}

/**
 * 桥失败：机器码留在 `code`（供本地化分支），`message` 是服务端诊断原文（英文）。
 *
 * 此前把 `code` 拼进 message 再直出（实测界面出现「终端操作失败: HTTP_500: …」），
 * 与产品层的「机器码禁止直出」相违；而服务端原文是面向开发者的英文诊断句，也不能直接给人看。
 */
class BridgeError extends Error {
  /** 机器可读错误码。 */
  readonly code: string

  /**
   * @param code - 机器可读码。
   * @param message - 服务端诊断原文（可为空）。
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
  }
}

/** 错误码 → 本面板文案键（只列用户在这块面板上真能触达的码）。 */
const REASON_KEYS: Record<string, SoloengineTerminalKey> = {
  SESSION_KEY_REQUIRED: 'terminal.errorOwner',
  OWNER_NOT_LIVE: 'terminal.errorOwner',
  SESSION_NOT_FOUND: 'terminal.errorSessionGone',
  UNTRUSTED: 'terminal.errorUntrusted',
  NO_BACKEND: 'terminal.errorNoBackend',
}

/**
 * 失败原因句子：网络层失败（`fetch` 抛 `TypeError`）给本地化句子，已知码给本地化原因，
 * 未知码回落服务端诊断，诊断为空再回落通用句；任何一支都不直出机器码。
 * @param failure - 任意异常。
 * @param t - 本命名空间的翻译函数。
 * @returns 当前语言的原因文本。
 */
function failureText(failure: unknown, t: TerminalPanelProps['t']): string {
  if (failure instanceof TypeError) return t('terminal.errorNetwork')
  if (failure instanceof BridgeError) {
    const key = REASON_KEYS[failure.code]
    if (key !== undefined) return t(key)
    return failure.message === '' ? t('terminal.errorUnknown') : failure.message
  }
  if (failure instanceof Error && failure.message !== '') return failure.message
  return t('terminal.errorUnknown')
}

/** 进程代标签：头区与回放区共用同一取词（同一事实不写两处）。 */
function generationLabel(generation: string, t: TerminalPanelProps['t']): string {
  return generation === 'persisted-only' ? t('terminal.generation.persisted') : t('terminal.generation.live')
}

/**
 * 渲染 owner 终端面板：本次进程代的实时终端 + 跨重启的持久回放。
 * @param props - tab 记录座位、session 作用域标准座位与本地化座位。
 * @returns 面板体。
 */
export function TerminalPanel({ useTabInfo, sessionId, t }: TerminalPanelProps) {
  const { tab } = useTabInfo()
  const visible = tab.visible
  /**
   * 右栏导航参数在平台侧「JSON-shaped by convention，不做运行期校验」，`terminal` kind 的
   * 形状由官方包声明为 `{ terminalId } | { shellPath }` 两支；本座位不整体断言（那会把
   * `{ shellPath }` 一支也当成有 `terminalId`），只按形状判据取那一支。
   */
  const navigation: unknown = tab.navigation.params
  const terminalId = typeof navigation === 'object' && navigation !== null && 'terminalId' in navigation
    ? String(navigation.terminalId)
    : ''
  const [terminals, setTerminals] = useState<TerminalView[]>([])
  const [activeId, setActiveId] = useState<string | null>(terminalId === '' ? null : terminalId)
  const [scrollback, setScrollback] = useState('')
  const [replay, setReplay] = useState<ReplayEntry[]>([])
  const [generation, setGeneration] = useState<string>('live-and-persisted')
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  /**
   * 读取链路的失败单独占一格：轮询失败要可见（否则屏幕停在旧输出上装作没事），
   * 而轮询一旦恢复就该自动收回——不能借用「操作失败」那一格，那格要留到用户下次动作。
   */
  const [readError, setReadError] = useState<string | null>(null)
  /** 当前终端的行窗口是否真读到过一次（空终端与「还没读到」不是一回事）。 */
  const [screenLoaded, setScreenLoaded] = useState(false)
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

  /**
   * 读取当前终端的行窗口，并顺带把该终端的实时状态并回来。
   *
   * 桥在这一页的响应里就带着 `terminal` 快照（running/exited + 退出码），此前被丢弃，
   * 于是列表里的状态永远停在打开那一刻——进程结束了面板还说它在跑。
   */
  const refreshScrollback = useCallback(async (id: string): Promise<void> => {
    try {
      const body = await call(`/sessions/${encodeURIComponent(id)}?sessionKey=${key}&offset=0&count=400`)
      const page = body.scrollback as { text?: string } | undefined
      const snapshot = body.terminal as TerminalView | null | undefined
      setScrollback(page?.text ?? '')
      setScreenLoaded(true)
      setReadError(null)
      if (snapshot !== undefined && snapshot !== null) {
        setTerminals(current => current.map(item => item.sessionId === snapshot.sessionId ? snapshot : item))
      }
    } catch (failure) {
      setReadError(failureText(failure, t))
      throw failure
    }
  }, [key, t])

  /** 新建一条属于当前会话 owner 的终端（首屏自动创建与「新建终端」按钮共用同一条路径）。 */
  const spawnTerminal = useCallback(async (): Promise<TerminalView | undefined> => {
    const created = await call('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey: sessionId }),
    })
    return created.terminal as TerminalView | undefined
  }, [sessionId])

  /** 读取跨重启回放（已持久工具结果）。 */
  const refreshReplay = useCallback(async (): Promise<void> => {
    const body = await call(`/replay?sessionKey=${key}`)
    setReplay((body.entries ?? []) as ReplayEntry[])
    const generation = body.generation
    setGeneration(typeof generation === 'string' && generation !== '' ? generation : 'live-and-persisted')
  }, [key])

  // 打开即创建（属于当前会话的 owner 作用域）；指定 terminalId 时直接 attach 已存在会话。
  useEffect(() => {
    const cancelledRef: { current: boolean } = { current: false }
    const isCancelled = (): boolean => cancelledRef.current
    void (async () => {
      try {
        setBusy(true)
        const list = await refreshList()
        if (isCancelled()) return
        if (terminalId !== '') {
          setActiveId(terminalId)
        } else if (list.length > 0) {
          setActiveId(list[0]?.sessionId ?? null)
        } else if (!spawned.current) {
          spawned.current = true
          const terminal = await spawnTerminal()
          if (isCancelled()) return
          if (terminal !== undefined) {
            setActiveId(terminal.sessionId)
            setTerminals([terminal])
          }
        }
        await refreshReplay()
      } catch (failure) {
        if (!isCancelled()) setError(failureText(failure, t))
      } finally {
        if (!isCancelled()) setBusy(false)
      }
    })()
    return () => { cancelledRef.current = true }
  }, [sessionId, terminalId, refreshList, refreshReplay, spawnTerminal])

  const active = terminals.find(candidate => candidate.sessionId === activeId) ?? null
  // 轮询的闸门只看**状态原语**：`active` 是每次读取都会被新快照对象替换的引用，
  // 拿它当依赖会让「读→换对象→effect 重跑→立刻再读」自旋成无间歇连打。
  const activeState = active?.state ?? null

  // 轮询行窗口（行式契约：有界 scrollback 分页读取）。
  // 隐藏时不轮询（`tab.visible` 是官方座位给的可见性事实），进程已结束也不轮询——
  // 此前两者都会继续每 1.5 秒打一次桥。重新可见时本 effect 重跑，顺手补一次读取。
  useEffect(() => {
    if (activeId === null || !visible) return undefined
    void refreshScrollback(activeId).catch(() => { /* 读取失败已在 readError 格里呈现 */ })
    if (activeState !== null && activeState !== 'running') return undefined
    const timer = setInterval(() => {
      void refreshScrollback(activeId).catch(() => { /* 读取失败已在 readError 格里呈现 */ })
    }, 1500)
    return () => { clearInterval(timer) }
  }, [activeId, activeState, visible, refreshScrollback])

  /** 发送一行（行式契约：text + submit）。sendingRef 防双投递（Enter 连击/按钮双击）。 */
  const sendingRef = useRef(false)
  const send = useCallback(async (text: string): Promise<void> => {
    if (activeId === null || text === '' || sendingRef.current) return
    sendingRef.current = true
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
      setError(failureText(failure, t))
    } finally {
      sendingRef.current = false
      setBusy(false)
    }
  }, [activeId, sessionId, refreshScrollback, t])

  /** 中断当前前台命令（与 send 同一 busy 互斥域）。 */
  const interrupt = useCallback(async (): Promise<void> => {
    if (activeId === null || sendingRef.current) return
    sendingRef.current = true
    setBusy(true)
    try {
      await call(`/sessions/${encodeURIComponent(activeId)}/signal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionKey: sessionId, signal: 'SIGINT' }),
      })
      await refreshScrollback(activeId)
    } catch (failure) {
      setError(failureText(failure, t))
    } finally {
      sendingRef.current = false
      setBusy(false)
    }
  }, [activeId, sessionId, refreshScrollback, t])

  return (
    <div className={styles.root}>
      <div className={styles.strip}>
        {terminals.map(candidate => (
          <button
            key={candidate.sessionId}
            type="button"
            className={candidate.sessionId === activeId ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            aria-current={candidate.sessionId === activeId ? 'true' : undefined}
            onClick={() => {
              // 换终端时先清屏：否则新 chip 的名字下面还挂着上一条终端的输出（读回来之前是错的内容）。
              setScrollback('')
              setScreenLoaded(false)
              setReadError(null)
              setActiveId(candidate.sessionId)
            }}
          >
            {candidate.name ?? `${t('terminal.type')} · ${candidate.sessionId.slice(0, 8)}`}
          </button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            spawned.current = true
            setBusy(true)
            void (async () => {
              try {
                const terminal = await spawnTerminal()
                if (terminal !== undefined) {
                  setTerminals(current => [...current, terminal])
                  setActiveId(terminal.sessionId)
                  setScrollback('')
                  setScreenLoaded(false)
                  setError(null)
                }
              } catch (failure) {
                setError(failureText(failure, t))
              } finally {
                setBusy(false)
              }
            })()
          }}
        >
          {t('terminal.new')}
        </Button>
      </div>

      <div className={styles.meta}>
        <span>{`${t('terminal.owner')} · ${active?.sessionId.slice(0, 8) ?? '—'}`}</span>
        {/* 退出码未上报时不拿 0 冒充「正常结束」：桥侧 `exitCode` 可为 null（如被信号终止）。 */}
        {active?.state === 'exited' ? <span>{active.exitCode === null ? t('terminal.exitedUnknown') : t('terminal.exited', { code: active.exitCode })}</span> : null}
        {active?.state === 'failed' ? <span className={styles.errorInline}>{active.exitCode === null ? t('terminal.failedUnknown') : t('terminal.failed', { code: active.exitCode })}</span> : null}
        {/* 进程代事实只有一份：此前这里恒定写「本次进程代」，与回放区按 `generation` 取词
            自相矛盾（持久回放代时上面仍谎称本次进程代）。两处共用同一取词。 */}
        <span>{generationLabel(generation, t)}</span>
      </div>

      {error !== null ? <div className={styles.error} role="alert">{`${t('terminal.error')} — ${error}`}</div> : null}
      {readError !== null ? <div className={styles.error} role="alert">{`${t('terminal.errorRead')} — ${readError}`}</div> : null}

      {terminals.length === 0 && !busy
        ? <div className={styles.state}>{t('terminal.empty')}</div>
        : (
          <pre className={styles.screen} aria-label={t('terminal.screen.aria')}>
            {scrollback === '' ? (screenLoaded ? t('terminal.screenEmpty') : busy ? t('terminal.creating') : t('terminal.loading')) : scrollback}
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
        <Button size="sm" variant="ghost" type="button" disabled={activeId === null || busy} onClick={() => { void interrupt() }}>
          {t('terminal.interrupt')}
        </Button>
      </form>

      <div className={styles.note}>{t('terminal.lineContract')}</div>

      <div className={styles.replay}>
        <div className={styles.replayHead}>
          <span>{t('terminal.replay.title')}</span>
          <span>{generationLabel(generation, t)}</span>
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
