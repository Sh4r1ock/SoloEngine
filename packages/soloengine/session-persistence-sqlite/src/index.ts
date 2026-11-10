/**
 * `@soloengine/session-persistence-sqlite` —— `ctx.sessionPersistence` 的 SQLite 后端（单机形态）。
 *
 * 改造复用：与 `@deepseek-ai/dsh-session-persistence-jsonl`（原版）及
 * `@soloengine/session-persistence-postgres`（云形态）同契约——事件日志按
 * `(session_id, seq)` 追加写、永不改写；头信息单独一行；`SessionHandle` 提供
 * `read/append/flush/close`。差别只在介质：单机写进业务库 `SOLOENGINE_DB` 的
 * `session_logs` / `session_log_events` 两表（SQLite 无 schema 分区，故用与业务
 * `sessions`/`events` 区分的正常表名），版本记入共享 `schema_versions`
 * （component `session-log`），不写 `PRAGMA user_version`。
 *
 * 持久化屏障：SQLite 事务提交即崩溃持久；`append` 解析即已提交，`flush` 只做
 * 「会话仍存在」确认。实时事件按 `session/event` 入队、25ms 合批，`session/flush`
 * 是屏障，与 JSONL/PG 后端一致。
 *
 * @module @soloengine/session-persistence-sqlite
 */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SessionPersistence, {
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
  SessionPersistenceCreateOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'

/** Cordis 插件名。 */
export const name = 'soloengine-session-persistence-sqlite'

/** 插件配置。 */
export interface Config {
  /** 业务库文件路径（单机形态即 `SOLOENGINE_DB`）。 */
  path: string
  /** SQLite 忙等待上限（毫秒）；默认 5000。 */
  busyTimeoutMs?: number
}

/** Loader 校验。 */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  busyTimeoutMs: z.natural().default(5000),
})

/** 共享 `schema_versions` 里的组件名。 */
export const SESSION_LOG_COMPONENT = 'session-log'

/** 会话日志表的 schema 版本。 */
export const SESSION_LOG_SCHEMA_VERSION = 1

/** 实时事件合批窗口（毫秒）：到期或 `session/flush` 屏障时提交。 */
export const LIVE_WRITE_BATCH_MAX_DELAY_MS = 25

/** `session_logs` 行。 */
interface SessionRow {
  id: string
  version: number
  created_at: number
  cwd: string | null
  parent_session: string | null
  is_seeded: number
  seed_length: number | null
  delegation_depth: number | null
  agent_preset: string | null
  origin: string | null
  event_count: number
  updated_at: number
}

/** 把 SQLite 原始行收窄为本模块的列类型（schema 由本模块所有）。 */
function toSessionRow(row: Record<string, unknown>): SessionRow {
  // oxlint-disable-next-line typescript/no-base-to-string -- TEXT 列由本模块 schema 所有，只可能是 string | number | bigint | null。
  const text = (value: unknown): string | null => (value === null ? null : String(value))
  return {
    id: String(row.id),
    version: Number(row.version),
    created_at: Number(row.created_at),
    cwd: text(row.cwd),
    parent_session: text(row.parent_session),
    is_seeded: Number(row.is_seeded),
    seed_length: row.seed_length === null ? null : Number(row.seed_length),
    delegation_depth: row.delegation_depth === null ? null : Number(row.delegation_depth),
    agent_preset: text(row.agent_preset),
    origin: text(row.origin),
    event_count: Number(row.event_count),
    updated_at: Number(row.updated_at),
  }
}

/** 把一行还原成可校验的头。 */
function rowHeader(row: SessionRow): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: row.id as SessionId,
    createdAt: row.created_at,
    ...row.cwd === null ? {} : { cwd: row.cwd },
    ...row.parent_session === null ? {} : { parentSession: row.parent_session as SessionId },
    isSeeded: row.is_seeded !== 0,
    ...row.origin === null ? {} : { origin: row.origin as 'subagent' },
    ...row.delegation_depth === null ? {} : { delegationDepth: row.delegation_depth },
    ...row.agent_preset === null ? {} : { agentPreset: row.agent_preset },
  }
}

/** 一行还原成快照。 */
function rowSnapshot(row: SessionRow): SessionPersistenceSnapshot {
  return {
    header: rowHeader(row),
    formatStatus: 'current',
    revision: SessionPersistenceRevision(`${String(row.event_count)}:${String(row.updated_at)}`),
    eventCount: row.event_count,
  }
}

/** 一个打开的会话句柄。 */
class SqliteSessionHandle implements SessionHandle {
  private cursor: number
  private closed = false
  /** 关闭已开始：排空仍可经本句柄写入，但并发的 flush 必须被拒绝。 */
  private closing = false
  private closePromise: Promise<void> | undefined

  constructor(
    private readonly owner: SqliteSessionPersistence,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    readonly inheritedEventCount: SessionLogOffset,
    nextSeq: number,
  ) {
    this.cursor = nextSeq
  }

  /** 读取连续日志切片。 */
  // oxlint-disable-next-line typescript/require-await -- 无 await，但校验失败必须保持 promise rejection 语义。
  async read(
    offset = 0,
    length?: number,
    options?: SessionHandleReadOptions,
  ): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    options?.signal?.throwIfAborted()
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError(`session "${this.id}": read offset must be a non-negative safe integer`)
    }
    if (length !== undefined && (!Number.isSafeInteger(length) || length < 0)) {
      throw new TypeError(`session "${this.id}": read length must be a non-negative safe integer`)
    }
    const events = this.owner.readEvents(this.id, offset, length)
    options?.signal?.throwIfAborted()
    validateStoredEvents(this.header, events)
    return { eventState: 'detached', events }
  }

  /** 追加一批连续事件；SQLite 事务提交即持久。 */
  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertOpen('append')
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'append')
    options?.signal?.throwIfAborted()
    if (events.length === 0) return
    try {
      const batch = materializeAppendBatch(events)
      assertContiguous(this.id, batch, this.cursor)
      this.owner.assertOwned(this.id, this)
      await this.owner.persistBatch(this.header, batch, this.cursor)
      this.cursor += batch.length
    } catch (error: unknown) {
      console.error(`session-persistence-sqlite: append failed for ${this.id} at ${String(this.cursor)}:`, error)
      throw error
    }
  }

  /** 持久化屏障：物化尚未落库的空会话，并确认会话仍在。 */
  // oxlint-disable-next-line typescript/require-await -- 无 await，但校验失败必须保持 promise rejection 语义。
  async flush(options?: SessionHandleFlushOptions): Promise<void> {
    this.assertOpen('flush')
    if (this.closing) throw new SessionHandleClosedError(this.id, 'flush')
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'flush')
    options?.signal?.throwIfAborted()
    this.owner.materializeIfPending(this.id)
    this.owner.assertPresent(this.id)
  }

  /** 先排空该会话的实时缓冲再释放写归属；排空失败照实抛出，归属仍被释放。 */
  async close(): Promise<void> {
    this.closePromise ??= this.doClose()
    return this.closePromise
  }

  private async doClose(): Promise<void> {
    this.closing = true
    let failure: Error | undefined
    try {
      // `closed` 尚未置位：排空批次仍通过本句柄的 append 写入。
      await this.owner.drainLive(this.id, true)
    } catch (error: unknown) {
      failure = error instanceof Error ? error : new Error(String(error))
    }
    this.closed = true
    if (this.access === 'write') this.owner.releaseOwnership(this.id, this)
    // 关闭后仍未落库的缓冲不属于任何后续句柄：丢弃并解除暂停。
    this.owner.discardLive(this.id)
    // 从未物化的会话在关闭即不存在（与 JSONL 后端的惰性语义一致）。
    this.owner.discardPending(this.id)
    if (failure !== undefined) throw failure
  }

  /** `Symbol.asyncDispose` 委托给 `close`。 */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }

  private assertOpen(operation: string): void {
    if (this.closed) throw new SessionHandleClosedError(this.id, operation)
  }
}

/** SQLite 会话日志后端。 */
export class SqliteSessionPersistence extends SessionPersistence {
  /** 诊断用后端标签。 */
  override readonly name = 'session-persistence-sqlite'

  /** 业务库连接；句柄读写共用。 */
  private readonly db: DatabaseSync

  private readonly owners = new Map<SessionId, SqliteSessionHandle>()
  private readonly active = new Set<SqliteSessionHandle>()
  /** 已创建但尚未物化的会话：本进程可见，进程退出即不存在（与 JSONL 后端同一惰性语义）。 */
  private readonly pending = new Map<SessionId, { header: SessionHeader; inheritedEventCount: SessionLogOffset }>()
  private readonly live = new Map<SessionId, SessionEvent[]>()
  private readonly liveTimers = new Map<SessionId, ReturnType<typeof setTimeout>>()
  private readonly liveChains = new Map<SessionId, Promise<void>>()
  /** 后台排空失败后暂停自动定时器；下一次屏障排空才恢复。 */
  private readonly paused = new Set<SessionId>()
  private closing: Promise<void> | undefined

  /**
   * @param ctx - 插件上下文。
   * @param config - 业务库路径与忙等待上限。
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    const path = resolve(config.path)
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA busy_timeout = ${String(Math.trunc(config.busyTimeoutMs ?? 5000))}`)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.initialize()
    // 实时路由：把已发布会话的事件按 id 送进当前写句柄（与 JSONL/PG 后端同一契约）。
    ctx.effect(() => {
      const offEvent = ctx.on('session/event', (session: Session, event: SessionEvent) => {
        this.enqueueLive(session.id, event)
      })
      const offFlush = ctx.on('session/flush', (session: Session) => this.drainLive(session.id, true))
      const offDisposed = ctx.on('session/disposed', (session: Session) => {
        const handle = this.owners.get(session.id)
        if (handle === undefined) return
        void (async () => {
          try {
            await this.drainLive(session.id, true)
            await handle.close()
          } catch (error: unknown) {
            this.ctx.logger.warn(
              `session-persistence-sqlite: final drain for session "${session.id}" failed: ${String(error)}`,
            )
          }
        })()
      })
      return async () => {
        offEvent()
        offFlush()
        offDisposed()
        await this.drainAllLive()
      }
    }, 'soloengine-session-persistence-sqlite.live-routing')
    ctx.effect(() => async () => this.close(), 'soloengine-session-persistence-sqlite.close')
  }

  /** 建表并把本组件的版本写进共享 `schema_versions`。 */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        component TEXT PRIMARY KEY,
        version   INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_logs (
        id               TEXT PRIMARY KEY,
        version          INTEGER NOT NULL,
        created_at       INTEGER NOT NULL,
        cwd              TEXT,
        parent_session   TEXT,
        is_seeded        INTEGER NOT NULL,
        seed_length      INTEGER,
        delegation_depth INTEGER,
        agent_preset     TEXT,
        origin           TEXT,
        event_count      INTEGER NOT NULL DEFAULT 0,
        updated_at       INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_log_events (
        session_id TEXT NOT NULL REFERENCES session_logs(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        event      TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
    `)
    const row = this.db.prepare('SELECT version FROM schema_versions WHERE component = ?')
      .get(SESSION_LOG_COMPONENT) as { version: number } | undefined
    if (row === undefined) {
      this.db.prepare('INSERT INTO schema_versions (component, version) VALUES (?, ?)')
        .run(SESSION_LOG_COMPONENT, SESSION_LOG_SCHEMA_VERSION)
      return
    }
    if (row.version !== SESSION_LOG_SCHEMA_VERSION) {
      throw new Error(
        `soloengine-session-persistence-sqlite: schema_versions records ${SESSION_LOG_COMPONENT} v${String(row.version)},`
        + ` but this build implements v${String(SESSION_LOG_SCHEMA_VERSION)}`,
      )
    }
  }

  /** 建会话并取得写归属（头信息在首次写入或 flush 时才物化）。 */
  // oxlint-disable-next-line typescript/require-await -- 无 await，但校验失败必须保持 promise rejection 语义。
  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    const inheritedEventCount = (options?.inheritedEventCount ?? 0) as SessionLogOffset
    if (snapshot.isSeeded !== (inheritedEventCount > 0)) {
      throw new Error(
        `session "${snapshot.id}": isSeeded=${String(snapshot.isSeeded)} requires inheritedEventCount ${
          snapshot.isSeeded ? '> 0' : '0'
        }, got ${String(inheritedEventCount)}`,
      )
    }
    if (this.owners.has(snapshot.id) || this.pending.has(snapshot.id) || this.selectRow(snapshot.id) !== undefined) {
      throw new SessionAlreadyExistsError(snapshot.id)
    }
    this.pending.set(snapshot.id, { header: snapshot, inheritedEventCount })
    const handle = new SqliteSessionHandle(this, snapshot.id, snapshot, 'write', inheritedEventCount, 0)
    this.owners.set(snapshot.id, handle)
    this.active.add(handle)
    return handle
  }

  /** 打开已存会话。 */
  // oxlint-disable-next-line typescript/require-await -- 无 await，但校验失败必须保持 promise rejection 语义。
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const source = this.openSource(id)
    const header = source.header
    assertStoredId(id, header)
    assertVersion(header)
    // 打开即校验已存词汇：未知事件类型按 fail-closed 拒绝，且拒绝前不取得写归属。
    if (source.stored) validateStoredEvents(header, this.readEvents(id, 0))
    if (access === 'read') {
      return new SqliteSessionHandle(this, id, header, 'read', source.inheritedEventCount, source.nextSeq)
    }
    if (this.owners.has(id)) throw new SessionAlreadyOwnedError(id)
    const handle = new SqliteSessionHandle(this, id, header, 'write', source.inheritedEventCount, source.nextSeq)
    this.owners.set(id, handle)
    this.active.add(handle)
    return handle
  }

  /** 服务级屏障：先排空实时缓冲，再逐个确认活跃会话。 */
  async flush(): Promise<void> {
    const failures: unknown[] = []
    for (const id of [...this.live.keys()]) {
      let pending = true
      while (pending) {
        try {
          await this.drainLive(id, true)
          pending = this.live.has(id)
        } catch (error: unknown) {
          failures.push(error)
          pending = false
        }
      }
    }
    for (const handle of [...this.active]) {
      try {
        await handle.flush()
      } catch (error: unknown) {
        // 关闭中的句柄拒绝 flush，但 close 自己已排空，计为已刷盘。
        if (error instanceof SessionHandleClosedError) continue
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'session-persistence-sqlite: one or more session flushes failed')
    }
  }

  /**
   * 删除一组会话的持久日志（业务库级联删除画布时使用；不属于原生会话契约）。
   *
   * 只删除 `session_logs` / `session_log_events` 两表；调用方必须先停掉活会话。
   * @param keys - 会话键。
   */
  async deleteSessions(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return
    // 先等在途实时写入落定：删行与 drain 并发会让已发出的批次撞外键（调用方已停会话）。
    for (const key of keys) {
      const id = key as SessionId
      const timer = this.liveTimers.get(id)
      if (timer !== undefined) {
        clearTimeout(timer)
        this.liveTimers.delete(id)
      }
      const chain = this.liveChains.get(id)
      if (chain !== undefined) await chain.catch(() => undefined)
    }
    const placeholders = keys.map(() => '?').join(', ')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`DELETE FROM session_log_events WHERE session_id IN (${placeholders})`).run(...keys)
      this.db.prepare(`DELETE FROM session_logs WHERE id IN (${placeholders})`).run(...keys)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    for (const key of keys) {
      const id = key as SessionId
      this.pending.delete(id)
      this.live.delete(id)
      const timer = this.liveTimers.get(id)
      if (timer !== undefined) clearTimeout(timer)
      this.liveTimers.delete(id)
      this.liveChains.delete(id)
      this.paused.delete(id)
    }
  }

  /** 观察一个会话（含本进程内尚未物化的创建）。 */
  // oxlint-disable-next-line typescript/require-await -- 无 await，但取消失败必须保持 promise rejection 语义。
  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    const row = this.selectRow(id)
    if (row !== undefined) return rowSnapshot(row)
    const pending = this.pending.get(id)
    return pending === undefined
      ? undefined
      : {
        header: pending.header,
        formatStatus: 'current',
        revision: SessionPersistenceRevision('0:0'),
        eventCount: 0,
      }
  }

  /** 列出全部会话（含本进程内尚未物化的创建）。 */
  // oxlint-disable-next-line typescript/require-await -- 无 await，但取消失败必须保持 promise rejection 语义。
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    options?.signal?.throwIfAborted()
    const rows = this.db.prepare(
      `SELECT id, version, created_at, cwd, parent_session, is_seeded, seed_length,
              delegation_depth, agent_preset, origin, event_count, updated_at
       FROM session_logs`,
    ).all().map(toSessionRow)
    const snapshots = rows.map(rowSnapshot)
    for (const pending of this.pending.values()) {
      snapshots.push({
        header: pending.header,
        formatStatus: 'current',
        revision: SessionPersistenceRevision('0:0'),
        eventCount: 0,
      })
    }
    options?.signal?.throwIfAborted()
    return snapshots
  }

  /** 关闭连接（幂等）。 */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    for (const [id, timer] of [...this.liveTimers]) {
      clearTimeout(timer)
      this.liveTimers.delete(id)
    }
    await this.drainAllLive()
    for (const handle of [...this.active]) {
      try {
        await handle.close()
      } catch (error: unknown) {
        // 单个句柄排空失败不阻断服务析构：连接必须释放，失败如实告警。
        this.ctx.logger.warn(`session-persistence-sqlite: closing session "${handle.id}" failed: ${String(error)}`)
      }
    }
    this.active.clear()
    this.owners.clear()
    this.pending.clear()
    this.db.close()
  }

  /**
   * 读取连续日志切片（句柄内部使用）。
   * @param id - 会话标识。
   * @param offset - 起始序号（含）。
   * @param length - 最多返回的事件条数（省略表示读到末尾）。
   * @returns 按 seq 升序的事件数组。
   */
  readEvents(id: SessionId, offset: number, length?: number): SessionEvent[] {
    const sql = length === undefined
      ? 'SELECT event FROM session_log_events WHERE session_id = ? AND seq >= ? ORDER BY seq ASC'
      : 'SELECT event FROM session_log_events WHERE session_id = ? AND seq >= ? ORDER BY seq ASC LIMIT ?'
    const statement = this.db.prepare(sql)
    const rows = (length === undefined
      ? statement.all(id, offset)
      : statement.all(id, offset, length)) as { event: string }[]
    return rows.map(row => JSON.parse(row.event) as SessionEvent)
  }

  /** 实时事件入队：只路由给当前写句柄持有的会话，按固定窗口合批。 */
  private enqueueLive(id: SessionId, event: SessionEvent): void {
    if (!this.owners.has(id)) return
    const buffered = this.live.get(id)
    if (buffered === undefined) this.live.set(id, [event])
    else buffered.push(event)
    // 后台排空失败后自动路径暂停：新事件继续入队，但不排新的定时器。
    if (this.paused.has(id) || this.liveTimers.has(id)) return
    const timer = setTimeout(() => {
      this.liveTimers.delete(id)
      void this.drainLive(id, false)
    }, LIVE_WRITE_BATCH_MAX_DELAY_MS)
    timer.unref()
    this.liveTimers.set(id, timer)
  }

  /**
   * 排空某会话的实时缓冲；同一会话的批次按链式保序，`append` 的 seq 连续。
   * @param id - 会话标识。
   * @param barrier - `true` 把写入失败抛给调用方（持久化屏障）；`false` 保留批次、暂停自动路径并告警。
   */
  drainLive(id: SessionId, barrier: boolean): Promise<void> {
    if (barrier) this.paused.delete(id)
    else if (this.paused.has(id)) return Promise.resolve()
    const timer = this.liveTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.liveTimers.delete(id)
    }
    const previous = this.liveChains.get(id) ?? Promise.resolve()
    const step = previous.catch(() => undefined).then(async () => {
      const buffered = this.live.get(id)
      const handle = this.owners.get(id)
      if (buffered === undefined || buffered.length === 0 || handle === undefined) return
      this.live.delete(id)
      try {
        await handle.append(buffered)
        this.paused.delete(id)
      } catch (error: unknown) {
        // 失败批次保留在队首，下一次 flush / close 重试；后台失败不抛出。
        const retained = this.live.get(id)
        this.live.set(id, retained === undefined ? [...buffered] : [...buffered, ...retained])
        if (!barrier) {
          this.paused.add(id)
          this.ctx.logger.warn(
            `session-persistence-sqlite: background write for session "${id}" failed (buffered events retained): ${
              String(error)
            }`,
          )
          return
        }
        throw error
      }
    })
    const settled = step.catch(() => undefined)
    this.liveChains.set(id, settled)
    void settled.then(() => {
      if (this.liveChains.get(id) === settled) this.liveChains.delete(id)
    })
    return step
  }

  /** 排空全部实时缓冲；析构路径只告警不抛出。 */
  private async drainAllLive(): Promise<void> {
    for (const id of [...this.live.keys()]) {
      try {
        await this.drainLive(id, true)
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `session-persistence-sqlite: final drain for session "${id}" failed: ${String(error)}`,
        )
      }
    }
  }

  /**
   * 句柄写入入口：首次写入时在同一事务里物化头信息，随后追加事件并推进 `event_count`。
   * @param header - 会话头（提供会话标识）。
   * @param events - 已验证的连续批次。
   * @param cursor - 本批首个事件的序号。
   */
  // oxlint-disable-next-line typescript/require-await -- 无 await，但事务失败必须保持 promise rejection 语义。
  async persistBatch(header: SessionHeader, events: readonly SessionEvent[], cursor: number): Promise<void> {
    const pending = this.pending.get(header.id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (pending !== undefined) this.insertHeader(header, pending.inheritedEventCount)
      const insert = this.db.prepare('INSERT INTO session_log_events (session_id, seq, event) VALUES (?, ?, ?)')
      for (const [index, event] of events.entries()) {
        insert.run(header.id, cursor + index, JSON.stringify(event))
      }
      const updated = this.db.prepare(
        'UPDATE session_logs SET event_count = event_count + ?, updated_at = ? WHERE id = ?',
      ).run(events.length, Date.now(), header.id)
      if (Number(updated.changes) === 0) throw new SessionPersistenceNotFoundError(header.id)
      this.db.exec('COMMIT')
      if (pending !== undefined) this.pending.delete(header.id)
    } catch (error: unknown) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // 原始失败仍是可执行原因。
      }
      throw error
    }
  }

  /**
   * 物化一个已创建但尚未落库的空会话（`flush` 的持久化语义）。
   * @param id - 会话标识。
   */
  materializeIfPending(id: SessionId): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.insertHeader(pending.header, pending.inheritedEventCount)
      this.db.exec('COMMIT')
      this.pending.delete(id)
    } catch (error: unknown) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // 原始失败仍是可执行原因。
      }
      throw error
    }
  }

  /**
   * 丢弃一个从未物化的会话（关闭即不存在）。
   * @param id - 会话标识。
   */
  discardPending(id: SessionId): void {
    this.pending.delete(id)
  }

  /**
   * 丢弃某会话尚未落库的实时缓冲与暂停标记（句柄关闭后它们不属于任何后续句柄）。
   * @param id - 会话标识。
   */
  discardLive(id: SessionId): void {
    const timer = this.liveTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.liveTimers.delete(id)
    }
    this.live.delete(id)
    this.paused.delete(id)
  }

  /** 插入头信息行（调用方保证事务与「行不存在」）。 */
  private insertHeader(header: SessionHeader, inheritedEventCount: SessionLogOffset): void {
    const inserted = this.db.prepare(
      `INSERT INTO session_logs
         (id, version, created_at, cwd, parent_session, is_seeded, seed_length,
          delegation_depth, agent_preset, origin, event_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      header.id,
      header.version,
      header.createdAt,
      header.cwd ?? null,
      header.parentSession ?? null,
      header.isSeeded ? 1 : 0,
      header.isSeeded ? inheritedEventCount : null,
      header.delegationDepth ?? null,
      header.agentPreset ?? null,
      header.origin ?? null,
      Date.now(),
    )
    if (Number(inserted.changes) === 0) throw new SessionAlreadyExistsError(header.id)
  }

  /**
   * 校验写归属仍属于该句柄。
   * @param id - 会话标识。
   * @param handle - 调用方持有的写句柄。
   */
  assertOwned(id: SessionId, handle: SqliteSessionHandle): void {
    if (this.owners.get(id) !== handle) throw new SessionAlreadyOwnedError(id)
  }

  /**
   * 释放写归属。
   * @param id - 会话标识。
   * @param handle - 调用方持有的写句柄。
   */
  releaseOwnership(id: SessionId, handle: SqliteSessionHandle): void {
    if (this.owners.get(id) === handle) this.owners.delete(id)
    this.active.delete(handle)
  }

  /**
   * 确认会话仍存在（含本进程内尚未物化的创建）。
   * @param id - 会话标识。
   */
  assertPresent(id: SessionId): void {
    if (this.selectRow(id) === undefined && !this.pending.has(id)) throw new SessionPersistenceNotFoundError(id)
  }

  /**
   * 打开会话的数据源：已物化行优先，否则取本进程内尚未物化的创建。
   * @param id - 会话标识。
   * @returns 头信息、继承事件数、下一个序号，以及来源是否为已物化行。
   */
  private openSource(id: SessionId): {
    header: SessionHeader
    inheritedEventCount: SessionLogOffset
    nextSeq: number
    stored: boolean
  } {
    const row = this.selectRow(id)
    if (row !== undefined) {
      return {
        header: rowHeader(row),
        inheritedEventCount: (row.seed_length ?? 0) as SessionLogOffset,
        nextSeq: row.event_count,
        stored: true,
      }
    }
    const pending = this.pending.get(id)
    if (pending === undefined) throw new SessionPersistenceNotFoundError(id)
    return { header: pending.header, inheritedEventCount: pending.inheritedEventCount, nextSeq: 0, stored: false }
  }

  /** 读一行头信息。 */
  private selectRow(id: SessionId): SessionRow | undefined {
    const row = this.db.prepare(
      `SELECT id, version, created_at, cwd, parent_session, is_seeded, seed_length,
              delegation_depth, agent_preset, origin, event_count, updated_at
       FROM session_logs WHERE id = ?`,
    ).get(id)
    return row === undefined ? undefined : toSessionRow(row)
  }
}

export default SqliteSessionPersistence
