/**
 * `@soloengine/session-persistence-postgres` —— `ctx.sessionPersistence` 的 PostgreSQL 后端。
 *
 * 与 `@deepseek-ai/dsh-session-persistence-jsonl` 同契约：事件日志按 `(session_id, seq)`
 * 追加写、永不改写；头信息单独存一行；`SessionHandle` 提供 `read/append/flush/close`。
 * 差别只在介质——PG 事务本身就是持久化屏障，因此 `append` 解析即持久，`flush` 只做
 * 「已物化」确认（空会话在 `create` 时就已落行，可被 `list` 看到）。
 *
 * 表放在独立 schema（默认 `log`），与 `kv`（键值）、`mgmt`（管理层业务表）、`search`
 * （检索索引）同库不同 schema，满足「整个 SoloEngine 一个库」。
 *
 * @module @soloengine/session-persistence-postgres
 */

import { createRequire } from 'node:module'
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
import type { Pool as PoolType, PoolClient } from 'pg'

const require = createRequire(import.meta.url)
const { Pool } = require('pg') as { Pool: typeof import('pg').Pool }

/** 建库串行化锁（多节点并发首启共享同一键）。 */
const SCHEMA_INIT_LOCK = 781031942017

/** Cordis 插件名。 */
export const name = 'soloengine-session-persistence-postgres'

/** 插件配置。 */
export interface Config {
  /** PostgreSQL 连接串。 */
  url: string
  /** 会话表所在 schema；默认 `log`。 */
  schema?: string
  /** 连接池上限；默认 10。 */
  maxConnections?: number
  /** 控制面地址；与 `nodeId` 同时给出时启用写入侧租约围栏（W10.4）。 */
  controlUrl?: string
  /** 本节点 id（与控制面注册一致）；与 `controlUrl` 成对出现。 */
  nodeId?: string
}

/** Loader 校验。 */
export const Config: z<Config> = z.object({
  url: z.string().required(),
  schema: z.string().default('log'),
  maxConnections: z.natural().min(1).default(10),
  controlUrl: z.string(),
  nodeId: z.string(),
})

/** 实时事件合批窗口（毫秒）：到期或 `session/flush` 屏障时提交。 */
export const LIVE_WRITE_BATCH_MAX_DELAY_MS = 25

/** 写入侧租约校验的超时；控制面不可达即拒绝写入（fail closed）。 */
export const LEASE_CHECK_TIMEOUT_MS = 3_000

/** 写入被租约围栏拒绝：该会话的写租约已归其他节点或已不存在（旧写者自降级）。 */
export class SessionWriteFencedError extends Error {
  /**
   * @param sessionId - 会话标识。
   * @param leaseOwner - 当前持有写租约的节点；空串表示没有存活的租约。
   * @param epochs - 同一节点但写者纪元已前进时的对照值。
   */
  constructor(
    readonly sessionId: string,
    readonly leaseOwner: string,
    readonly epochs?: { held: number; expected: number },
  ) {
    super(leaseOwner === ''
      ? `session "${sessionId}": no live write lease belongs to this node; this node has been fenced out`
      : epochs === undefined
        ? `session "${sessionId}": write lease is held by node "${leaseOwner}"; this node has been fenced out`
        : `session "${sessionId}": write lease epoch moved to ${String(epochs.held)} while this writer holds ${
          String(epochs.expected)
        }; this node has been fenced out`)
    this.name = 'SessionWriteFencedError'
  }
}

/** 控制面答复的写租约视图（`/v1/leases/get`）。 */
export interface WriteLeaseView {
  /** 当前持有写租约的节点。 */
  nodeId: string
  /** 写者纪元：接管时由控制面 CAS 递增，续约保持不变。 */
  epoch: number
}

/** 围栏拒绝原因（`null` 之外的三类）。 */
export type WriteFenceReason =
  | { kind: 'no-lease' }
  | { kind: 'other-node'; owner: string }
  | { kind: 'epoch-moved'; owner: string; heldEpoch: number }

/**
 * 写入侧围栏判定（Plan W3 要点 2：段提交与索引更新校验 `(sessionId, epoch)`）。
 *
 * 只比较节点 id 不够：同一节点在接管后重新取得租约时纪元会更高，旧句柄的在途写入仍会
 * 看到自己的节点名而误判为可写；纪元不一致即证明该句柄已被接管过。
 * @param lease - 控制面答复的租约（`null` = 没有存活租约）。
 * @param nodeId - 本节点 id。
 * @param expectedEpoch - 写句柄打开时记下的写者纪元；`undefined` 表示打开时没有可记的租约。
 * @returns `null` 表示可写；否则为围栏拒绝原因。
 */
export function fenceDecision(
  lease: WriteLeaseView | null,
  nodeId: string,
  expectedEpoch: number | undefined,
): WriteFenceReason | null {
  if (lease === null) return { kind: 'no-lease' }
  if (lease.nodeId !== nodeId) return { kind: 'other-node', owner: lease.nodeId }
  if (expectedEpoch !== undefined && lease.epoch !== expectedEpoch) {
    return { kind: 'epoch-moved', owner: lease.nodeId, heldEpoch: lease.epoch }
  }
  return null
}

/** 双引号标识符。 */
function quoteIdent(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`
}

/** `sessions` 行。 */
interface SessionRow {
  id: string
  version: number
  created_at: string | number
  cwd: string | null
  parent_session: string | null
  is_seeded: boolean
  seed_length: number | null
  delegation_depth: number | null
  agent_preset: string | null
  origin: string | null
  event_count: number
  updated_at: string | number
}

/** 把一行还原成可校验的头。 */
function rowHeader(row: SessionRow): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: row.id as SessionId,
    createdAt: Number(row.created_at),
    ...row.cwd === null ? {} : { cwd: row.cwd },
    ...row.parent_session === null ? {} : { parentSession: row.parent_session as SessionId },
    isSeeded: row.is_seeded,
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
class PostgresSessionHandle implements SessionHandle {
  private cursor: number
  private closed = false
  private closePromise: Promise<void> | undefined

  constructor(
    private readonly owner: PostgresSessionPersistence,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    readonly inheritedEventCount: SessionLogOffset,
    /** 打开写句柄时的写者纪元（围栏对照值；读句柄与未配置围栏时为 undefined）。 */
    readonly fenceEpoch: number | undefined,
    nextSeq: number,
  ) {
    this.cursor = nextSeq
  }

  /** 读取连续日志切片。 */
  async read(
    offset = 0,
    length?: number,
    options?: SessionHandleReadOptions,
  ): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    options?.signal?.throwIfAborted()
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`session "${this.id}": read offset must be a non-negative integer`)
    }
    if (length !== undefined && (!Number.isInteger(length) || length < 0)) {
      throw new Error(`session "${this.id}": read length must be a non-negative integer`)
    }
    const params: Array<string | number> = [this.id, offset]
    let sql = 'SELECT event FROM session_events WHERE session_id = $1 AND seq >= $2 ORDER BY seq ASC'
    if (length !== undefined) {
      sql += ' LIMIT $3'
      params.push(length)
    }
    const rows = await this.owner.pool.query(sql, params)
    options?.signal?.throwIfAborted()
    const events = (rows.rows as { event: string }[]).map(row => JSON.parse(row.event) as SessionEvent)
    validateStoredEvents(this.header, events)
    return { eventState: 'detached', events }
  }

  /** 追加一批连续事件；PG 事务提交即持久。 */
  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertOpen('append')
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'append')
    options?.signal?.throwIfAborted()
    if (events.length === 0) return
    try {
      const batch = materializeAppendBatch(events)
      assertContiguous(this.id, batch, this.cursor)
      this.owner.assertOwned(this.id, this)
      await this.owner.appendBatch(this.header, this.cursor, batch, this.fenceEpoch, options?.signal)
      this.cursor += batch.length
    } catch (error: unknown) {
      console.error(`session-persistence-postgres: append failed for ${this.id} at ${String(this.cursor)}:`, error)
      throw error
    }
  }

  /** 持久化屏障：`append` 已提交，空会话在 `create` 时已落行，故无需额外动作。 */
  async flush(options?: SessionHandleFlushOptions): Promise<void> {
    this.assertOpen('flush')
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'flush')
    options?.signal?.throwIfAborted()
    await this.owner.assertPresent(this.id, options?.signal)
  }

  /** 先排空该会话的实时缓冲再释放写归属；排空失败照实抛出，归属仍被释放。 */
  async close(): Promise<void> {
    this.closePromise ??= this.doClose()
    return this.closePromise
  }

  private async doClose(): Promise<void> {
    let failure: Error | undefined
    try {
      // `closed` 尚未置位：排空批次仍通过本句柄的 append 写入。
      await this.owner.drainLive(this.id, true)
    } catch (error: unknown) {
      failure = error instanceof Error ? error : new Error(String(error))
    }
    this.closed = true
    if (this.access === 'write') this.owner.releaseOwnership(this.id, this)
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

/** PostgreSQL 会话日志后端。 */
export class PostgresSessionPersistence extends SessionPersistence {
  /** 诊断用后端标签。 */
  override readonly name = 'session-persistence-postgres'

  /** 连接池；句柄读写共用。 */
  readonly pool: PoolType

  /** 会话日志 schema（删除级联时使用；与初始化同一份）。 */
  private readonly schemaName: string
  private readonly ready: Promise<void>
  private readonly owners = new Map<SessionId, PostgresSessionHandle>()
  private readonly active = new Set<PostgresSessionHandle>()
  private readonly live = new Map<SessionId, SessionEvent[]>()
  private readonly liveTimers = new Map<SessionId, ReturnType<typeof setTimeout>>()
  private readonly liveChains = new Map<SessionId, Promise<void>>()
  /** 写入侧租约围栏（控制面地址 + 本节点 id）；未配置时不校验。 */
  private readonly fence: { controlUrl: string; nodeId: string } | undefined
  private closing: Promise<void> | undefined

  /**
   * @param ctx - 插件上下文。
   * @param config - 连接串与 schema。
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    const schema = config.schema ?? 'log'
    this.schemaName = schema
    if ((config.controlUrl === undefined) !== (config.nodeId === undefined)) {
      throw new Error('soloengine-session-persistence-postgres: controlUrl and nodeId must be given together')
    }
    this.fence = config.controlUrl === undefined || config.nodeId === undefined
      ? undefined
      : { controlUrl: config.controlUrl.replace(/\/$/u, ''), nodeId: config.nodeId }
    this.pool = new Pool({
      connectionString: config.url,
      max: config.maxConnections ?? 10,
      options: `-c search_path=${schema},public`,
    })
    this.ready = this.initialize(schema)
    this.ready.catch(() => undefined)
    // 实时路由：把已发布会话的事件按 id 送进当前写句柄（与 JSONL 后端同一契约：
    // `session/event` 入队 + 25ms 合批，`session/flush` 是持久化屏障）。
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
              `session-persistence-postgres: final drain for session "${session.id}" failed: ${String(error)}`,
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
    }, 'soloengine-session-persistence-postgres.live-routing')
    ctx.effect(() => async () => this.close(), 'soloengine-session-persistence-postgres.close')
  }

  private async initialize(schema: string): Promise<void> {
    // 多节点并发首启会同时建 schema/表：IF NOT EXISTS 不是并发安全的（并发 CREATE TABLE
    // 会撞 pg_type_typname_nsp_index），用事务级 advisory lock 串行化整段建库。
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [SCHEMA_INIT_LOCK])
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`)
      await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id               TEXT PRIMARY KEY,
        version          INTEGER NOT NULL,
        created_at       BIGINT NOT NULL,
        cwd              TEXT,
        parent_session   TEXT,
        is_seeded        BOOLEAN NOT NULL,
        seed_length      INTEGER,
        delegation_depth INTEGER,
        agent_preset     TEXT,
        origin           TEXT,
        event_count      INTEGER NOT NULL DEFAULT 0,
        updated_at       BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_events (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        event      TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
    `)
      await client.query('COMMIT')
    } catch (error) {
      // 回滚失败只可能是连接已断开；保留原始建库错误作为报告。
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  /** 建会话并取得写归属。 */
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
    await this.ready
    options?.signal?.throwIfAborted()
    const fenceEpoch = await this.captureFenceEpoch(snapshot.id, options?.signal)
    const inserted = await this.pool.query(
      `INSERT INTO sessions
         (id, version, created_at, cwd, parent_session, is_seeded, seed_length,
          delegation_depth, agent_preset, origin, event_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11)
       ON CONFLICT (id) DO NOTHING`,
      [
        snapshot.id,
        snapshot.version,
        snapshot.createdAt,
        snapshot.cwd ?? null,
        snapshot.parentSession ?? null,
        snapshot.isSeeded,
        snapshot.isSeeded ? inheritedEventCount : null,
        snapshot.delegationDepth ?? null,
        snapshot.agentPreset ?? null,
        snapshot.origin ?? null,
        Date.now(),
      ],
    )
    if (inserted.rowCount === 0) throw new SessionAlreadyExistsError(snapshot.id)
    const handle = new PostgresSessionHandle(this, snapshot.id, snapshot, 'write', inheritedEventCount, fenceEpoch, 0)
    this.owners.set(snapshot.id, handle)
    this.active.add(handle)
    return handle
  }

  /** 打开已存会话。 */
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    await this.ready
    const row = await this.selectRow(id, options?.signal)
    if (row === undefined) throw new SessionPersistenceNotFoundError(id)
    const header = rowHeader(row)
    assertStoredId(id, header)
    assertVersion(header)
    const inheritedEventCount = (row.seed_length ?? 0) as SessionLogOffset
    if (access === 'read') {
      return new PostgresSessionHandle(this, id, header, 'read', inheritedEventCount, undefined, row.event_count)
    }
    if (this.owners.has(id)) throw new SessionAlreadyOwnedError(id)
    const fenceEpoch = await this.captureFenceEpoch(id, options?.signal)
    const handle = new PostgresSessionHandle(this, id, header, 'write', inheritedEventCount, fenceEpoch, row.event_count)
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
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'session-persistence-postgres: one or more session flushes failed')
    }
  }

  /**
   * 删除一组会话的持久日志（业务库级联删除画布时使用；不属于原生会话契约）。
   *
   * `session_events` 对 `sessions` 有 ON DELETE CASCADE，删头行即删事件。调用方必须先停活会话。
   * @param keys - 会话键。
   */
  async deleteSessions(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return
    await this.ready
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
    await this.pool.query(
      `DELETE FROM ${quoteIdent(this.schemaName)}.sessions WHERE id = ANY($1::text[])`,
      [keys],
    )
    for (const key of keys) {
      const id = key as SessionId
      this.live.delete(id)
      const timer = this.liveTimers.get(id)
      if (timer !== undefined) clearTimeout(timer)
      this.liveTimers.delete(id)
      this.liveChains.delete(id)
    }
  }

  /** 观察一个会话。 */
  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    await this.ready
    const row = await this.selectRow(id, options?.signal)
    return row === undefined ? undefined : rowSnapshot(row)
  }

  /** 列出全部会话。 */
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    options?.signal?.throwIfAborted()
    await this.ready
    const rows = await this.pool.query(
      `SELECT id, version, created_at, cwd, parent_session, is_seeded, seed_length,
              delegation_depth, agent_preset, origin, event_count, updated_at
       FROM sessions`,
    )
    options?.signal?.throwIfAborted()
    return (rows.rows as SessionRow[]).map(rowSnapshot)
  }

  /** 关闭连接池（幂等）。 */
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
    for (const handle of [...this.active]) await handle.close()
    this.active.clear()
    this.owners.clear()
    await this.pool.end()
  }

  /** 实时事件入队：只路由给当前写句柄持有的会话，按固定窗口合批。 */
  private enqueueLive(id: SessionId, event: SessionEvent): void {
    if (!this.owners.has(id)) return
    const buffered = this.live.get(id)
    if (buffered === undefined) this.live.set(id, [event])
    else buffered.push(event)
    if (this.liveTimers.has(id)) return
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
   * @param barrier - `true` 把写入失败抛给调用方（持久化屏障）；`false` 保留批次并告警。
   */
  drainLive(id: SessionId, barrier: boolean): Promise<void> {
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
      } catch (error: unknown) {
        // 失败批次保留在队首，下一次 flush / close 重试；后台失败不抛出。
        const retained = this.live.get(id)
        this.live.set(id, retained === undefined ? [...buffered] : [...buffered, ...retained])
        if (!barrier) {
          this.ctx.logger.warn(
            `session-persistence-postgres: background write for session "${id}" failed (buffered events retained): ${
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
          `session-persistence-postgres: final drain for session "${id}" failed: ${String(error)}`,
        )
      }
    }
  }

  /**
   * 句柄写入入口。
   * @param header - 会话头（提供会话标识）。
   * @param cursor - 本批首个事件的序号。
   * @param batch - 待写入事件。
   * @param fenceEpoch - 写句柄打开时记下的写者纪元。
   * @param signal - 调用方取消信号。
   */
  async appendBatch(
    header: SessionHeader,
    cursor: number,
    batch: readonly SessionEvent[],
    fenceEpoch: number | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.ready
    signal?.throwIfAborted()
    await this.assertWriteLease(header.id, fenceEpoch, signal)
    const client: PoolClient = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const [index, event] of batch.entries()) {
        await client.query(
          'INSERT INTO session_events (session_id, seq, event) VALUES ($1, $2, $3)',
          [header.id, cursor + index, JSON.stringify(event)],
        )
      }
      const updated = await client.query(
        'UPDATE sessions SET event_count = event_count + $2, updated_at = $3 WHERE id = $1',
        [header.id, batch.length, Date.now()],
      )
      if (updated.rowCount === 0) throw new SessionPersistenceNotFoundError(header.id)
      await client.query('COMMIT')
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // 原始失败仍是可执行原因。
      }
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * 校验写归属仍属于该句柄。
   * @param id - 会话标识。
   * @param handle - 调用方持有的写句柄。
   */
  assertOwned(id: SessionId, handle: PostgresSessionHandle): void {
    if (this.owners.get(id) !== handle) throw new SessionAlreadyOwnedError(id)
  }

  /**
   * 打开写句柄时记下写者纪元（围栏对照值）。
   *
   * 没有存活租约时不在这里拒绝：子代理等进程内会话由归属根会话的节点直接写，控制面
   * 并不为每个子会话建租约；那类写入的可用性仍由 `appendBatch` 的既有判定决定。
   * 租约已在其他节点名下则立即拒绝，不把冲突拖到第一次写入。
   * @param id - 会话标识。
   * @param signal - 调用方取消信号。
   * @returns 写者纪元；未配置围栏或没有租约时为 undefined。
   */
  private async captureFenceEpoch(id: SessionId, signal?: AbortSignal): Promise<number | undefined> {
    const lease = await this.fetchLease(id, signal)
    const fence = this.fence
    if (fence === undefined || lease === undefined || lease === null) return undefined
    if (lease.nodeId !== fence.nodeId) throw new SessionWriteFencedError(id, lease.nodeId)
    return lease.epoch
  }

  /**
   * 读取控制面答复的写租约。
   *
   * 未配置围栏时返回 `undefined`；控制面不可达或答复异常一律报错（fail closed）——
   * 不能把「无法确认」当成「仍可写」。
   * @param id - 会话标识。
   * @param signal - 调用方取消信号。
   * @returns 租约；没有存活租约时为 null；未配置围栏时为 undefined。
   */
  private async fetchLease(id: SessionId, signal?: AbortSignal): Promise<WriteLeaseView | null | undefined> {
    const fence = this.fence
    if (fence === undefined) return undefined
    let response: Response
    try {
      response = await fetch(`${fence.controlUrl}/v1/leases/get`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionKey: id }),
        signal: AbortSignal.any([
          ...signal === undefined ? [] : [signal],
          AbortSignal.timeout(LEASE_CHECK_TIMEOUT_MS),
        ]),
      })
    } catch (error: unknown) {
      throw new Error(`session-persistence-postgres: write lease check for "${id}" failed: ${String(error)}`)
    }
    if (!response.ok) {
      throw new Error(
        `session-persistence-postgres: write lease check for "${id}" answered ${String(response.status)}`,
      )
    }
    const body = await response.json() as { lease?: { nodeId?: unknown; epoch?: unknown } | null }
    // 没有租约 = 该会话已被释放或尚未放置：本节点不是写者，一律围栏（不能把「查不到」当成「仍可写」）。
    if (body.lease === null || body.lease === undefined) return null
    const owner = body.lease.nodeId
    if (typeof owner !== 'string' || owner === '') {
      throw new Error(`session-persistence-postgres: write lease check for "${id}" returned a lease without a nodeId`)
    }
    const epoch = body.lease.epoch
    if (typeof epoch !== 'number' || !Number.isInteger(epoch)) {
      throw new Error(`session-persistence-postgres: write lease check for "${id}" returned a lease without an epoch`)
    }
    return { nodeId: owner, epoch }
  }

  /**
   * 写入侧租约围栏：确认该会话的写租约仍归本节点，且写者纪元未前进。
   *
   * 未配置围栏时不校验；控制面不可达或答复异常一律拒绝写入（fail closed）。
   * @param id - 会话标识。
   * @param expectedEpoch - 写句柄打开时记下的写者纪元。
   * @param signal - 调用方取消信号。
   */
  private async assertWriteLease(id: SessionId, expectedEpoch: number | undefined, signal?: AbortSignal): Promise<void> {
    const fence = this.fence
    if (fence === undefined) return
    const lease = await this.fetchLease(id, signal)
    const reason = fenceDecision(lease ?? null, fence.nodeId, expectedEpoch)
    if (reason === null) return
    if (reason.kind === 'epoch-moved') {
      throw new SessionWriteFencedError(id, reason.owner, { held: reason.heldEpoch, expected: expectedEpoch ?? reason.heldEpoch })
    }
    throw new SessionWriteFencedError(id, reason.kind === 'no-lease' ? '' : reason.owner)
  }

  /**
   * 确认会话仍存在。
   * @param id - 会话标识。
   * @param signal - 调用方取消信号。
   */
  async assertPresent(id: SessionId, signal?: AbortSignal): Promise<void> {
    const row = await this.selectRow(id, signal)
    if (row === undefined) throw new SessionPersistenceNotFoundError(id)
  }

  /**
   * 释放写归属。
   * @param id - 会话标识。
   * @param handle - 调用方持有的写句柄。
   */
  releaseOwnership(id: SessionId, handle: PostgresSessionHandle): void {
    this.active.delete(handle)
    if (this.owners.get(id) === handle) this.owners.delete(id)
  }

  private async selectRow(id: SessionId, signal?: AbortSignal): Promise<SessionRow | undefined> {
    await this.ready
    signal?.throwIfAborted()
    const rows = await this.pool.query(
      `SELECT id, version, created_at, cwd, parent_session, is_seeded, seed_length,
              delegation_depth, agent_preset, origin, event_count, updated_at
       FROM sessions WHERE id = $1`,
      [id],
    )
    return (rows.rows as SessionRow[])[0]
  }
}

/**
 * 挂载 PostgreSQL 会话日志后端。
 * @param ctx - 插件上下文。
 * @param config - 连接串与 schema。
 */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.url !== 'string' || config.url === '') {
    throw new Error('soloengine-session-persistence-postgres: config.url is required')
  }
  new PostgresSessionPersistence(ctx, config)
}

export default PostgresSessionPersistence
