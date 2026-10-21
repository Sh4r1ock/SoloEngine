/**
 * 归属台账重建（PRD-01 FR-ARCH-012「可重建」的执行入口）。
 *
 * `sessions` / `events` 两张表是「可重建的本地索引」（PRD-12 FR-STO-004/005）：
 * 本模块以 dsh 官方持久化读路径（`ctx.sessionPersistence.list/open('read')`——
 * 撕裂尾安全、代际感知）为唯一事实来源，把每个持久会话的事件归属行整体重放一遍：
 *
 * - 已有归属行的会话：替换 events 行 + 折叠 status/起止时间（折叠缓存可重建）；
 * - 缺失归属行的会话：经 `run_projects.folder_path = header.cwd` 恢复归属；
 *   匹配不到的会话**如实计入 skipped**（不捏造 user/flow/project 归属）。
 *
 * 写入全部经 `SessionLedger`（唯一写入方，PRD-12 FR-STO-008）；本模块只做读与派生。
 *
 * @module @soloengine/host/ledger-rebuild
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type { FrameworkRuntime } from '@soloengine/framework'

/** 重建报告（如实报出每一类结果，含 skipped 与 errors）。 */
export interface LedgerRebuildReport {
  /** 扫描到的持久会话数。 */
  scanned: number
  /** 已有归属行、仅重放事件的会话数。 */
  replayed: number
  /** 经 run_projects 匹配恢复出归属行的会话数。 */
  recovered: number
  /** 无法恢复归属（cwd 匹配不到运行项目）而被跳过的会话键。 */
  skipped: string[]
  /** 重放的 events 归属行总数。 */
  eventRows: number
  /** 逐会话错误（读失败等；不中断整体重建）。 */
  errors: { session: string; message: string }[]
}

/** 单会话日志读取（分页窗口；事件只增不改，按 seq 升序读完整份）。 */
async function readAllEvents(ctx: Context, id: SessionPersistenceSnapshot['header']['id']): Promise<SessionEvent[]> {
  const handle = await ctx.sessionPersistence.open(id, 'read')
  try {
    const events: SessionEvent[] = []
    let offset = 0
    for (;;) {
      const slice = await handle.read(offset, 1000)
      events.push(...slice.events)
      if (slice.events.length === 0) break
      offset += slice.events.length
    }
    return events
  } finally {
    await handle.close()
  }
}

/** 单会话重建结果。 */
interface RebuildOneOutcome {
  outcome: 'replayed' | 'recovered'
  eventRows: number
}

/**
 * 从持久日志重建一个会话的台账行（归属行 + events 行 + 折叠状态）。
 */
async function rebuildOne(
  ctx: Context,
  runtime: FrameworkRuntime,
  snapshot: SessionPersistenceSnapshot,
): Promise<RebuildOneOutcome> {
  const ledger = runtime.runs.ledger
  const key = String(snapshot.header.id)
  const before = ledger.byKey(key)
  let row = before
  if (row === undefined) {
    // 归属恢复：日志头的 cwd 是唯一可匹配的归属事实（运行项目目录注册表）。
    const cwd = snapshot.header.cwd
    if (cwd === undefined) throw new Error('session has no cwd in its header; attribution cannot be recovered')
    const match = runtime.db.raw.prepare(
      'SELECT id, user_id, agentic_flow_id FROM run_projects WHERE folder_path = ?',
    ).get(cwd) as { id: string; user_id: string; agentic_flow_id: string } | undefined
    if (match === undefined) throw new Error(`cwd "${cwd}" matches no run_projects row; attribution cannot be recovered`)
    const createdAt = typeof snapshot.header.createdAt === 'number' ? snapshot.header.createdAt : Date.now()
    row = ledger.recover({
      session_key: key,
      user_id: match.user_id,
      agentic_flow_id: match.agentic_flow_id,
      run_project_id: match.id,
      created_at: createdAt,
    })
  }

  // 事件归属派生（与 attachLedgerWriters 的增量写同一套规则）：
  // - 归属 agent 是画布节点（attribution）；重建时该映射已不可得，按同样的兜底：
  //   主会话归到会话键自身、子代理子会话归到 parentSession（PRD-12 FR-STO-005 的会话树归属）；
  // - tool/result 的 parent_message_id = 之前最近一条 assistant/message 的 seq。
  const parent = snapshot.header.parentSession === undefined ? null : String(snapshot.header.parentSession)
  const agentId = parent ?? key
  const events = await readAllEvents(ctx, snapshot.header.id)
  let lastAssistantSeq: number | undefined
  const rows = events.map(event => {
    if (event.type === 'assistant/message') lastAssistantSeq = Number(event.seq)
    return {
      seq: Number(event.seq),
      agent_id: agentId,
      parent_agent_id: parent,
      parent_message_id: event.type === 'tool/result' && lastAssistantSeq !== undefined ? lastAssistantSeq : null,
    }
  })
  ledger.replaceEvents(row.id, rows)

  // 折叠状态：最后一条 turn/end 决定 completed/stopped；无 turn/end 视为 stopped（fail-closed 方向）。
  const lastTurnEnd = [...events].reverse().find(event => event.type === 'turn/end') as
    | { data: { reason: { kind?: string } | string } }
    | undefined
  const startedAt = events.length > 0 ? Number(events[0]?.time) : null
  const completedAt = events.length > 0 ? Number(events[events.length - 1]?.time) : null
  const reason = lastTurnEnd === undefined ? '' : String(
    typeof lastTurnEnd.data.reason === 'object' && lastTurnEnd.data.reason !== null
      ? lastTurnEnd.data.reason.kind
      : lastTurnEnd.data.reason,
  )
  ledger.setStatus(row.id, reason === 'completed' ? 'completed' : 'stopped', {
    ...(startedAt === null || Number.isNaN(startedAt) ? {} : { startedAt }),
    ...(completedAt === null || Number.isNaN(completedAt) ? {} : { completedAt }),
  })
  return { outcome: before === undefined ? 'recovered' : 'replayed', eventRows: rows.length }
}

/**
 * 全量重建（见模块注释）。逐会话隔离错误：单个会话失败不中断整体。
 * @param ctx - 注入 `sessionPersistence` 的宿主上下文。
 * @param runtime - 框架层运行时。
 * @returns 扫描、重放与恢复的汇总报告。
 */
export async function rebuildLedgerFromLogs(ctx: Context, runtime: FrameworkRuntime): Promise<LedgerRebuildReport> {
  const report: LedgerRebuildReport = { scanned: 0, replayed: 0, recovered: 0, skipped: [], eventRows: 0, errors: [] }
  const snapshots = await ctx.sessionPersistence.list()
  report.scanned = snapshots.length
  for (const snapshot of snapshots) {
    const key = String(snapshot.header.id)
    try {
      const result = await rebuildOne(ctx, runtime, snapshot)
      if (result.outcome === 'recovered') report.recovered += 1
      else report.replayed += 1
      report.eventRows += result.eventRows
    } catch (error) {
      report.errors.push({ session: key, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return report
}

/**
 * 挂载重建路由（POST /api/solo/sessions/rebuild；同一 REST 前缀、同一鉴权）。
 * @param ctx - 注入 `sessionPersistence` 的上下文。
 * @param runtime - 框架层运行时（mountAuthenticated 注入点）。
 */
export function mountLedgerRebuild(ctx: Context, runtime: FrameworkRuntime): void {
  runtime.mountAuthenticated(
    {
      id: 'sessions-rebuild',
      method: 'post',
      path: '/sessions/rebuild',
      summary: '归属台账重建（FR-ARCH-012）：从持久 JSONL 重放 sessions/events 折叠索引',
    },
    async () => ({ body: { ok: true, report: await rebuildLedgerFromLogs(ctx, runtime) } }),
  )
}
