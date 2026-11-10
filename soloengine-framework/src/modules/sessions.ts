/**
 * 会话归属台账（PRD-12 FR-STO-004/005 与 PRD-06 数据需求）。
 *
 * 会话运行时数据（消息正文 / 用量 / 工具调用流）以 dsh JSONL 事件流为唯一真源，
 * 本模块只承载「归属索引行」：`sessions`（会话与用户/画布/项目/模型配置的归属 +
 * 运行状态的折叠缓存）+ `events`（事件与画布节点/父节点/父消息的归属 + 软删标记）。
 * 两者皆「可重建的本地索引」，序列与 dsh 事件同值。
 *
 * 读取一律经业务库端口（单机 SQLite / 云 PostgreSQL 同签名）；台账不感知引擎，
 * 也不在事务外持有跨语句状态。
 *
 * @module @soloengine/framework/modules/sessions
 */

import { randomUUID } from 'node:crypto'
import type { BusinessDatabase } from '../db/port.ts'

/** 会话归属行的对外视图。 */
export interface SessionLedgerRow {
  id: number
  session_key: string
  user_id: string
  agentic_flow_id: string
  run_project_id: string
  llm_config_id: string | null
  created_at: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  error: string | null
  duration_ms: number | null
  started_at: number | null
  completed_at: number | null
  version: number
}

/** 事件归属行。 */
export interface EventLedgerRow {
  session_id: number
  seq: number
  agent_id: string
  parent_agent_id: string | null
  parent_message_id: number | null
  is_deleted: number
}

/** 会话台账服务：只写归属索引行，不触达任何会话运行时数据。 */
export class SessionLedger {
  private readonly db: BusinessDatabase

  /**
   * @param db - 业务库端口（异步语句面）。
   */
  constructor(db: BusinessDatabase) {
    this.db = db
  }

  /**
   * 建立归属行：幂等（同 session_key 已存在则返回既有行）。
   * @param input - 归属事实。
   * @returns 新插入或既有行。
   */
  async ensure(input: {
    session_key: string
    user_id: string
    agentic_flow_id: string
    run_project_id: string
    llm_config_id: string | null
  }): Promise<SessionLedgerRow> {
    const existing = await this.byKey(input.session_key)
    if (existing !== undefined) return existing
    const now = Date.now()
    await this.db.prepare(
      `INSERT INTO sessions (session_key, user_id, agentic_flow_id, run_project_id, llm_config_id,
         created_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      input.session_key, input.user_id, input.agentic_flow_id, input.run_project_id,
      input.llm_config_id, now,
    )
    const row = await this.byKey(input.session_key)
    if (row === undefined) throw new Error('soloengine: session ledger insert produced no row')
    return row
  }

  /** 按 session_key 取行（dsh SessionId 与 session_key 同值，1:1）。 */
  async byKey(session_key: string): Promise<SessionLedgerRow | undefined> {
    return await this.db.prepare('SELECT * FROM sessions WHERE session_key = ?')
      .get<SessionLedgerRow>(session_key)
  }

  /** 按归属行主键取行。 */
  async byId(id: number): Promise<SessionLedgerRow | undefined> {
    return await this.db.prepare('SELECT * FROM sessions WHERE id = ?').get<SessionLedgerRow>(id)
  }

  /** 列会话（按用户过滤，最新在前）。 */
  async listByUser(userId: string, limit = 50): Promise<SessionLedgerRow[]> {
    return await this.db.prepare(
      'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    ).all<SessionLedgerRow>(userId, limit)
  }

  /** 该用户的会话总数（用量统计窗口的如实标注）。 */
  async countByUser(userId: string): Promise<number> {
    const row = await this.db.prepare(
      'SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?',
    ).get<{ total: number }>(userId)
    return Number(row?.total ?? 0)
  }

  /**
   * 列出全部进行中（`pending` / `running`）的归属行。
   *
   * 供启动对账使用：这些行只可能由仍在推进的循环收敛，进程退出后不会有任何写入者。
   * @returns 进行中的归属行（按主键升序）。
   */
  async inFlight(): Promise<SessionLedgerRow[]> {
    return await this.db.prepare(
      "SELECT * FROM sessions WHERE status IN ('pending', 'running') ORDER BY id ASC",
    ).all<SessionLedgerRow>()
  }

  /**
   * 该用户在一个 agenticflow 内可见的会话键（连接层账号作用域的收窄集合）。
   *
   * 省略 `instance` 时返回该用户的全部会话（管理面视图）；给出时只返回归属该画布的
   * 会话——不同画布的运行面板因此互不可见（需求 §9.5 ⑥）。
   * @param userId - 归属用户。
   * @param instance - agenticflow 标识；省略表示不按画布收窄。
   * @returns 会话键（最新在前）。
   */
  async sessionKeysOf(userId: string, instance?: string): Promise<string[]> {
    const rows = instance === undefined
      ? await this.db.prepare(
        'SELECT session_key FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
      ).all<{ session_key: string }>(userId)
      : await this.db.prepare(
        'SELECT session_key FROM sessions WHERE user_id = ? AND agentic_flow_id = ? ORDER BY created_at DESC',
      ).all<{ session_key: string }>(userId, instance)
    return rows.map(row => row.session_key)
  }

  /** 更新运行状态折叠缓存（失败可见：写 status/error/起止/耗时）。 */
  async setStatus(
    id: number,
    status: SessionLedgerRow['status'],
    patch: { error?: string; startedAt?: number; completedAt?: number } = {},
  ): Promise<SessionLedgerRow> {
    const now = Date.now()
    const row = await this.byId(id)
    if (row === undefined) throw new Error(`soloengine: session ledger row ${id} not found`)
    const error = patch.error === undefined ? row.error : patch.error
    const startedAt = patch.startedAt === undefined ? row.started_at : patch.startedAt
    const completedAt = patch.completedAt === undefined ? row.completed_at : patch.completedAt
    const durationMs = startedAt === null || completedAt === null ? null : completedAt - startedAt
    await this.db.prepare(
      `UPDATE sessions SET status = ?, error = ?, started_at = ?, completed_at = ?, duration_ms = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    ).run(status, error, startedAt, completedAt, durationMs, now, id)
    const updated = await this.byId(id)
    if (updated === undefined) throw new Error(`soloengine: session ledger row ${id} vanished after update`)
    return updated
  }

  /**
   * 追加一条事件归属行。
   * @param sessionId - 归属行主键。
   * @param seq - 事件序列号（与 dsh 事件同值）。
   * @param input - 节点归属。
   */
  async appendEvent(sessionId: number, seq: number, input: {
    agent_id: string
    parent_agent_id?: string
    parent_message_id?: number
  }): Promise<EventLedgerRow> {
    await this.db.prepare(
      `INSERT INTO events (session_id, seq, agent_id, parent_agent_id, parent_message_id, is_deleted)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(
      sessionId, seq, input.agent_id,
      input.parent_agent_id ?? null,
      input.parent_message_id ?? null,
    )
    return {
      session_id: sessionId,
      seq,
      agent_id: input.agent_id,
      parent_agent_id: input.parent_agent_id ?? null,
      parent_message_id: input.parent_message_id ?? null,
      is_deleted: 0,
    }
  }

  /** 列一个会话的事件归属（按 seq 升序）。 */
  async events(sessionId: number, limit = 200): Promise<EventLedgerRow[]> {
    return await this.db.prepare(
      'SELECT * FROM events WHERE session_id = ? ORDER BY seq ASC LIMIT ?',
    ).all<EventLedgerRow>(sessionId, limit)
  }

  /** 生成一条仅本会话可用的归属键（dsh session_key）。 */
  static newKey(): string {
    return `solo-${randomUUID()}`
  }

  /**
   * 重建入口（FR-ARCH-012）：从 JSONL 日志头恢复一条缺失的归属行。
   * 归属事实（user/flow/project）只能经 `run_projects.folder_path = cwd` 匹配恢复；
   * 匹配不到的会话由调用方如实计入 skipped，**不捏造归属**。
   * @param input - 会话键与恢复出的归属事实（created_at 取日志头 createdAt）。
   */
  async recover(input: {
    session_key: string
    user_id: string
    agentic_flow_id: string
    run_project_id: string
    created_at: number
  }): Promise<SessionLedgerRow> {
    const existing = await this.byKey(input.session_key)
    if (existing !== undefined) return existing
    await this.db.prepare(
      `INSERT INTO sessions (session_key, user_id, agentic_flow_id, run_project_id, llm_config_id,
         created_at, status)
       VALUES (?, ?, ?, ?, NULL, ?, 'stopped')`,
    ).run(input.session_key, input.user_id, input.agentic_flow_id, input.run_project_id, input.created_at)
    const row = await this.byKey(input.session_key)
    if (row === undefined) throw new Error('soloengine: session ledger recover produced no row')
    return row
  }

  /**
   * 重建入口（FR-ARCH-012）：用一个会话的**全部持久事件**整体替换其 events 归属行。
   * 与 appendEvent（增量）共用唯一写入方地位；重建是显式管理动作，整批一个短事务。
   * @param sessionId - 归属行主键。
   * @param rows - 由日志事件派生的归属行（seq 与 dsh 事件同值）。
   * @returns 写入的归属行数。
   */
  async replaceEvents(
    sessionId: number,
    rows: { seq: number; agent_id: string; parent_agent_id: string | null; parent_message_id: number | null }[],
  ): Promise<number> {
    await this.db.transaction(async tx => {
      await tx.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId)
      const insert = tx.prepare(
        `INSERT INTO events (session_id, seq, agent_id, parent_agent_id, parent_message_id, is_deleted)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      for (const row of rows) {
        await insert.run(sessionId, row.seq, row.agent_id, row.parent_agent_id, row.parent_message_id)
      }
    })
    return rows.length
  }
}
