/**
 * 文件变更面板（PRD-08 FR-OPS-009；PRD-09 FR-FC-004/005/007/011）。
 *
 * 呈现当前会话的变更台账（按回合分组、按文件的行级差异、逐 hunk 展开），并承载本册的两种**写操作**：
 * 审阅（整轮 / 逐文件 / 逐 hunk 保留或丢弃——只标记、不动磁盘）与按轮次撤回（执行前确认清单：
 * 列出将恢复的文件与将跳过的文件）。
 *
 * **事实源唯一**：台账表 `file_changes`（宿主权威）——本面板与消息区变更汇总条、编辑器行装饰读同一份
 * 数据（三处同源）；面板不自算差异、不落第二副本，任何写操作完成后重新读取台账。
 *
 * 数据经操作区桥 `/soloengine/changes*`（信任门鉴权 + 归属取自运行台账）。
 *
 * @module @soloengine/ui-operation-area/ChangesPanel
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './ChangesPanel.module.css'
import type { SoloengineOpsKey } from './locales.ts'

/** 一条台账记录（与框架层视图同形）。 */
interface ChangeRow {
  id: string
  filePath: string
  /** 与框架层 `ChangeOperation` 同集；写成联合而非 string，动态键才由编译器保证覆盖完整。 */
  operation: 'created' | 'modified' | 'deleted'
  origin: 'agent' | 'revert' | 'user'
  status: 'pending' | 'accepted' | 'rejected' | 'reverted'
  /** 归属回合（撤回与审阅都按它分组；`null` 表示人写入或撤回记录）。 */
  messageId: number | null
  linesAdded: number | null
  linesRemoved: number | null
  hunks: { id?: string; header?: string; lines?: string[]; status?: 'accepted' | 'rejected' | null }[] | null
}

/** 台账响应。 */
interface ChangesResponse {
  ok: boolean
  changes?: ChangeRow[]
  summary?: { total: number; linesAdded: number; linesRemoved: number }
  error?: { code: string; message: string }
}

/** 撤回计划中的还原项。 */
interface PlanRestore {
  changeIds: string[]
  filePath: string
  delete: boolean
  targetContent: string
}

/** 撤回计划中的跳过项。 */
interface PlanSkip {
  changeId: string
  filePath: string
  code: string
  reason: string
}

/** 撤回计划。 */
interface RevertPlan {
  sessionKey: string
  turn: number | null
  restores: PlanRestore[]
  skipped: PlanSkip[]
}

/** 面板体 props。 */
export type ChangesPanelProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'soloengineOps'>

/** 桥错误码 → 本面板文案键（服务端 message 是面向开发者的英文诊断句，不进可见层）。 */
const REASON_KEYS: Record<string, SoloengineOpsKey> = {
  SESSION_KEY_REQUIRED: 'changes.errorOwner',
  SESSION_NOT_IN_LEDGER: 'changes.errorOwner',
  PROJECT_MISSING: 'changes.errorOwner',
  UNTRUSTED: 'changes.errorUntrusted',
  TURN_REQUIRED: 'changes.errorTurn',
  REVIEW_STATUS_INVALID: 'changes.errorUnknown',
  CONFIRMATION_REQUIRED: 'changes.errorUnknown',
  BRIDGE_ROUTE_NOT_FOUND: 'changes.errorUnknown',
  BRIDGE_INTERNAL: 'changes.errorUnknown',
}

/** 撤回计划的跳过码 → 本地化句子（服务端 `reason` 是面向开发者的诊断句，与 `code` 一样不进可见层）。 */
const SKIP_KEYS: Record<string, SoloengineOpsKey> = {
  DRIFTED: 'changes.skipDrifted',
  REJECTED: 'changes.skipRejected',
  LARGE_FILE: 'changes.skipLargeFile',
  BLOB_MISSING: 'changes.skipBlobMissing',
  NO_NET_CHANGE: 'changes.skipNoNetChange',
}

/** 失败句子：已知码给本地化原因，未知码回落服务端诊断，诊断也空则通用句。 */
function failureText(failure: unknown, t: ChangesPanelProps['t']): string {
  if (failure instanceof TypeError) return t('changes.errorNetwork')
  if (failure instanceof BridgeFailure) {
    const key = REASON_KEYS[failure.code]
    if (key !== undefined) return t(key)
    return failure.message === '' ? t('changes.errorUnknown') : failure.message
  }
  if (failure instanceof Error && failure.message !== '') return failure.message
  return t('changes.errorUnknown')
}

/** 跳过句子：与失败句子同法——已知码本地化，未知码回落服务端诊断，空则通用句。 */
function skipText(skip: PlanSkip, t: ChangesPanelProps['t']): string {
  const key = SKIP_KEYS[skip.code]
  if (key !== undefined) return t(key)
  return skip.reason === '' ? t('changes.skipUnknown') : skip.reason
}

/** 桥侧结构化失败：机器码留在 `code` 供本地化分支。 */
class BridgeFailure extends Error {
  /** 机器可读错误码。 */
  readonly code: string

  /**
   * @param code - 机器可读码。
   * @param message - 服务端诊断原文。
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'BridgeFailure'
    this.code = code
  }
}

/** 取路径的最后一段（呈现用；台账里的路径是沙箱内的绝对路径）。 */
function baseName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}

/**
 * 渲染变更清单（按回合分组 + 逐文件 + 逐 hunk）与撤回确认。
 * @param props - tab 记录座位、session 作用域标准座位与本地化座位。
 * @returns 面板体。
 */
export function ChangesPanel({ sessionId, useProjection, t }: ChangesPanelProps) {
  const [rows, setRows] = useState<ChangeRow[]>([])
  const [summary, setSummary] = useState<{ total: number; linesAdded: number; linesRemoved: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<RevertPlan | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/soloengine/changes?sessionKey=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' })
      const body = await response.json() as ChangesResponse
      if (!response.ok || !body.ok) {
        throw new BridgeFailure(body.error?.code ?? `HTTP_${String(response.status)}`, body.error?.message ?? '')
      }
      setRows(body.changes ?? [])
      setSummary(body.summary ?? null)
    } catch (failure) {
      setError(failureText(failure, t))
    } finally {
      setLoading(false)
    }
  }, [sessionId, t])

  // 台账是宿主权威、会被 agent 持续写入：只在挂载时读一次就会一直显示旧账。
  // 与消息区汇总条、编辑器行装饰同一信号源（followIntent 的每次呈现意图都意味着可能有过写入）。
  const intent = useProjection('soloengine.followIntent')
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (intent !== undefined && intent !== null) void load() }, [intent, load])

  /** 一次审阅写操作（整轮 / 逐文件 / 逐 hunk）：只标记，不动磁盘；完成后重读台账。 */
  const review = useCallback(async (payload: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/soloengine/changes/review', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionKey: sessionId, ...payload }),
      })
      const body = await response.json() as { ok: boolean; error?: { code?: string; message?: string } }
      if (!response.ok || !body.ok) throw new BridgeFailure(body.error?.code ?? `HTTP_${String(response.status)}`, body.error?.message ?? '')
      await load()
    } catch (failure) {
      setError(`${t('changes.review.failed')} — ${failureText(failure, t)}`)
    } finally {
      setBusy(false)
    }
  }, [load, sessionId, t])

  /** 打开某一回合的撤回确认清单（执行前必须由人确认）。 */
  const openPlan = useCallback(async (turn: number): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch(
        `/soloengine/changes/revert/plan?sessionKey=${encodeURIComponent(sessionId)}&turn=${String(turn)}`,
        { credentials: 'same-origin' },
      )
      const body = await response.json() as { ok: boolean; plan?: RevertPlan; error?: { code?: string; message?: string } }
      if (!response.ok || !body.ok || body.plan === undefined) {
        throw new BridgeFailure(body.error?.code ?? `HTTP_${String(response.status)}`, body.error?.message ?? '')
      }
      setPlan(body.plan)
    } catch (failure) {
      setError(`${t('changes.revert.failed')} — ${failureText(failure, t)}`)
    } finally {
      setBusy(false)
    }
  }, [sessionId, t])

  /** 执行已确认的撤回（最小还原 + 漂移跳过 + 逐文件提交）。 */
  const runRevert = useCallback(async (): Promise<void> => {
    if (plan?.turn === null || plan === null) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/soloengine/changes/revert', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionKey: sessionId, turn: plan.turn, confirm: true }),
      })
      const body = await response.json() as {
        ok: boolean
        restored?: string[]
        failures?: { filePath: string; reason: string }[]
        plan?: RevertPlan
        error?: { code?: string; message?: string }
      }
      if (!response.ok || !body.ok) throw new BridgeFailure(body.error?.code ?? `HTTP_${String(response.status)}`, body.error?.message ?? '')
      setNotice(t('changes.revert.done', {
        restored: body.restored?.length ?? 0,
        skipped: body.plan?.skipped.length ?? 0,
        failed: body.failures?.length ?? 0,
      }))
      setPlan(null)
      await load()
    } catch (failure) {
      setError(`${t('changes.revert.failed')} — ${failureText(failure, t)}`)
    } finally {
      setBusy(false)
    }
  }, [load, plan, sessionId, t])

  if (loading) return <div className={styles.state}>{t('changes.loading')}</div>
  if (error !== null && rows.length === 0) {
    return (
      <div className={styles.state} role="alert">
        {`${t('changes.error')} — ${error}`}
      </div>
    )
  }
  if (rows.length === 0) return <div className={styles.state}>{t('changes.empty')}</div>

  // 按回合分组（`messageId` 为归属回合；`null` = 人写入或撤回记录，不参与按轮次撤回）。
  const turns = new Map<number | null, ChangeRow[]>()
  for (const row of rows) {
    const bucket = turns.get(row.messageId)
    if (bucket === undefined) turns.set(row.messageId, [row])
    else bucket.push(row)
  }
  const orderedTurns = [...turns.keys()].sort((left, right) => {
    if (left === null) return 1
    if (right === null) return -1
    return left - right
  })

  // 汇总数与分组同一份行集，不重复取数。
  const total = summary?.total ?? rows.length

  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        {total === 1
          ? t('changes.summaryOne', { count: total, added: summary?.linesAdded ?? 0, removed: summary?.linesRemoved ?? 0 })
          : t('changes.summary', { count: total, added: summary?.linesAdded ?? 0, removed: summary?.linesRemoved ?? 0 })}
      </div>
      {notice === null ? null : <div className={styles.notice}>{notice}</div>}
      {error === null ? null : (
        <div className={styles.noticeError} role="alert">
          {error}
        </div>
      )}
      {plan === null ? null : (
        <div className={styles.plan}>
          <div className={styles.planTitle}>{t('changes.revert.planTitle', { turn: plan.turn ?? '' })}</div>
          <div className={styles.planSection}>{t('changes.revert.restores', { count: plan.restores.length })}</div>
          <ul className={styles.planList}>
            {plan.restores.map(item => (
              <li key={item.filePath} className={styles.planItem}>
                {item.delete ? `${baseName(item.filePath)} (${t('changes.operation.deleted')})` : baseName(item.filePath)}
              </li>
            ))}
          </ul>
          <div className={styles.planSection}>{t('changes.revert.skipped', { count: plan.skipped.length })}</div>
          <ul className={styles.planList}>
            {plan.skipped.map(item => (
              <li key={item.changeId} className={styles.planItem}>
                {`${baseName(item.filePath)} · ${skipText(item, t)}`}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.action} disabled={busy} onClick={() => { void runRevert() }}>
              {t('changes.revert.confirm')}
            </button>
            <button type="button" className={styles.action} disabled={busy} onClick={() => { setPlan(null) }}>
              {t('changes.revert.cancel')}
            </button>
          </div>
        </div>
      )}
      <div className={styles.turns}>
        {orderedTurns.map(turn => (
          <section key={turn === null ? 'unassigned' : String(turn)} className={styles.turn}>
            <div className={styles.turnHead}>
              <span className={styles.turnLabel}>
                {turn === null ? t('changes.turn.unknown') : t('changes.turn', { turn })}
              </span>
              {turn === null ? null : (
                <button type="button" className={styles.action} disabled={busy} onClick={() => { void openPlan(turn) }}>
                  {t('changes.revert.action')}
                </button>
              )}
            </div>
            <ul className={styles.list}>
              {(turns.get(turn) ?? []).map(row => (
                <li key={row.id} className={styles.item}>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.head}
                      aria-expanded={expanded === row.id}
                      onClick={() => { setExpanded(current => current === row.id ? null : row.id) }}
                    >
                      <span className={styles.path}>{baseName(row.filePath)}</span>
                      <span className={styles.meta}>{`${t(`changes.operation.${row.operation}`)} · ${t(`changes.status.${row.status}`)} · ${t(`changes.origin.${row.origin}`)}`}</span>
                      <span className={styles.lines}>{`+${String(row.linesAdded ?? 0)} / -${String(row.linesRemoved ?? 0)}`}</span>
                    </button>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.action}
                        disabled={busy}
                        onClick={() => { void review({ changeId: row.id, status: 'accepted' }) }}
                      >
                        {t('changes.review.accept')}
                      </button>
                      <button
                        type="button"
                        className={styles.actionDanger}
                        disabled={busy}
                        onClick={() => { void review({ changeId: row.id, status: 'rejected' }) }}
                      >
                        {t('changes.review.reject')}
                      </button>
                    </div>
                  </div>
                  {expanded === row.id ? (
                    <div className={styles.hunks}>
                      {(row.hunks ?? []).length === 0
                        ? <div className={styles.state}>{t('changes.noHunks')}</div>
                        : (row.hunks ?? []).map((hunk, index) => (
                          <div key={`${row.id}-${String(index)}`} className={styles.hunk}>
                            <div className={styles.hunkHead}>
                              <span className={styles.hunkHeader}>{`${hunk.header ?? ''}${hunk.status === undefined || hunk.status === null ? '' : ` · ${t(`changes.status.${hunk.status}`)}`}`}</span>
                              {hunk.id === undefined ? null : (
                                <div className={styles.actions}>
                                  <button
                                    type="button"
                                    className={styles.action}
                                    disabled={busy}
                                    onClick={() => { void review({ changeId: row.id, status: 'accepted', hunkIds: [hunk.id] }) }}
                                  >
                                    {t('changes.review.hunkAccept')}
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.actionDanger}
                                    disabled={busy}
                                    onClick={() => { void review({ changeId: row.id, status: 'rejected', hunkIds: [hunk.id] }) }}
                                  >
                                    {t('changes.review.hunkReject')}
                                  </button>
                                </div>
                              )}
                            </div>
                            <pre className={styles.hunkBody}>{(hunk.lines ?? []).join('\n')}</pre>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineOpsKey }
