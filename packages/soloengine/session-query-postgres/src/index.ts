/**
 * `@soloengine/session-query-postgres` —— `ctx.sessionQuery` 的 PostgreSQL 后端。
 *
 * 与 `@deepseek-ai/dsh-session-query-sqlite` 同契约：维护一份**可丢弃派生索引**，
 * 把「进程内活会话 + 持久化会话」投影成检索文档，用全文检索回答 `searchSessions`
 * 与 `searchEvents`；精确读取、过滤器、谱系追踪由基类在真实日志上完成，不经过索引。
 *
 * 差别只在介质与分区：索引落在同一个 PG 库的 `search` schema（`sessions` + `docs`
 * 两张表 + GIN 表达式索引），随库共享、可整库重建。
 *
 * @module @soloengine/session-query-postgres
 */

import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SESSION_FORMAT_VERSION, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import SessionQueryEngine, {
  SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
  SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  SESSION_QUERY_READ_WINDOW_MAX,
  SessionQueryError,
  SessionSearchCursor,
  assertSessionHeadersCompatible,
  buildSessionEventSearchDocuments,
  readColdSessionLog,
} from '@deepseek-ai/dsh-session-query'
import type {
  Config as SessionQueryConfig,
  SessionEventSearchDocument,
  SessionEventSearchHit,
  SessionEventSearchPage,
  SessionEventSearchRequest,
  SessionSearchExecContext,
  SessionSearchHit,
  SessionSearchCursor as SessionSearchCursorValue,
  SessionSearchPage,
  SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'
import type { Pool as PoolType, PoolClient } from 'pg'
import {
  SESSION_QUERY_POSTGRES_DEFAULT_LIMIT,
  SESSION_QUERY_POSTGRES_MAX_LIMIT,
  SESSION_QUERY_POSTGRES_SNIPPET_CHARS,
  Params,
  buildEventWhere,
  buildSessionWhere,
  makeSnippet,
  markOccurrences,
  normalizeEventRequest,
  normalizeSessionRequest,
  requestFingerprint,
  type NormalizedEventRequest,
  type NormalizedSessionRequest,
} from './query.ts'
import { openSearchSchema } from './schema.ts'

const require = createRequire(import.meta.url)
const { Pool } = require('pg') as { Pool: typeof import('pg').Pool }

export { SESSION_QUERY_POSTGRES_SCHEMA_VERSION } from './schema.ts'

/** Cordis 插件名。 */
export const name = 'soloengine-session-query-postgres'

/** 索引打开时机；`never` 关闭全文检索（精确读取仍可用）。 */
export type OpenAt = 'startup' | 'first-search' | 'never'

/** 插件配置。 */
export interface Config extends SessionQueryConfig {
  /** PostgreSQL 连接串。 */
  url: string
  /** 索引所在 schema；默认 `search`。 */
  schema?: string
  /** 连接池上限；默认 5。 */
  maxConnections?: number
  /** 打开时机；默认 `startup`。 */
  openAt?: OpenAt
  /** 请求未给 limit 时的页大小；默认 20。 */
  defaultLimit?: number
  /** 最大页大小；默认 100。 */
  maxLimit?: number
  /** 片段最大码点数；默认 240。 */
  snippetChars?: number
}

/** Loader 校验。 */
export const Config: z<Config> = z.object({
  url: z.string().required(),
  schema: z.string().default('search'),
  maxConnections: z.natural().min(1).default(5),
  openAt: z.union(['startup', 'first-search', 'never'] as const).default('startup'),
  defaultLimit: z.natural().min(1).default(SESSION_QUERY_POSTGRES_DEFAULT_LIMIT),
  maxLimit: z.natural().min(1).default(SESSION_QUERY_POSTGRES_MAX_LIMIT),
  snippetChars: z.natural().min(1).default(SESSION_QUERY_POSTGRES_SNIPPET_CHARS),
  readWindowMax: z.natural().default(SESSION_QUERY_READ_WINDOW_MAX),
  persistedReadConcurrency: z.natural().min(1).default(SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY),
  preparedSessionCacheSize: z.natural().min(1).default(SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE),
})

interface ResolvedConfig {
  url: string
  schema: string
  maxConnections: number
  openAt: OpenAt
  defaultLimit: number
  maxLimit: number
  snippetChars: number
  readWindowMax: number
  persistedReadConcurrency: number
  preparedSessionCacheSize: number
}

interface ObservedSession {
  header: SessionHeader
  inheritedEventCount: SessionLogOffset
  documents: SessionEventSearchDocument[]
  fingerprint: string
  live: boolean
  persisted: boolean
  revision?: string
}

interface ExistingRow {
  id: string
  revision: string | null
  fingerprint: string | null
  live: boolean
  persisted: boolean
  owner: string
}

interface SearchRow {
  session_id: string
  version: number
  created_at: string | number
  cwd: string | null
  parent_session: string | null
  seed_length: number | null
  delegation_depth: number | null
  agent_preset: string | null
  live: boolean
  persisted: boolean
  seq: number
  type: string
  time: string | number
  surface: string
  text: string
  codepoint_length: number
  match_count: string | number
}

interface CursorPayload {
  version: 1
  instance: string
  scope: 'sessions' | 'events'
  fingerprint: string
  generation: string
  offset: number
}

// 一次瞬时源变更重试一次；持续抖动直接失败，不垄断队列。
const STABLE_OBSERVATION_ATTEMPTS = 2
// 单条 INSERT 的文档批大小，远低于 PG 参数上限。
const DOCUMENT_BATCH_SIZE = 500

/** PostgreSQL 会话检索后端。 */
export class PostgresSessionQueryEngine extends SessionQueryEngine {
  static override inject = ['sessions']

  /** 已解析配置。 */
  readonly config: ResolvedConfig

  private readonly _instance = randomUUID()
  private readonly _pool: PoolType
  private _ready: Promise<void> | undefined
  private _persistence: SessionPersistence | undefined
  private _lastPersistenceIdentity: symbol | undefined
  private _persistenceEpoch = 0
  private _generation = 0
  private _tail: Promise<void> = Promise.resolve()
  private _closed = false
  private _closePromise: Promise<void> | undefined
  private readonly _optionalPersistenceFiber: Fiber

  constructor(ctx: Context, config: Config) {
    super(ctx, config = resolveConfig(config))
    this.config = config as ResolvedConfig
    this._pool = new Pool({
      connectionString: this.config.url,
      max: this.config.maxConnections,
      options: `-c search_path=${this.config.schema},public`,
    })
    this._optionalPersistenceFiber = ctx.inject(['sessionPersistence'], (childCtx: Context) => {
      const service = childCtx.sessionPersistence
      this._persistence = service
      childCtx.effect(() => () => {
        if (this._persistence !== service) return
        this._persistence = undefined
      }, 'soloengineSessionQueryPostgres.persistenceBinding')
    })
    ctx.effect(() => () => this._optionalPersistenceFiber.dispose(), 'soloengineSessionQueryPostgres.optionalPersistence')
    ctx.effect(() => async () => this.close(), 'soloengineSessionQueryPostgres.close')
  }

  /** 启动期按配置打开索引。 */
  protected async [Service.init](): Promise<void> {
    if (this.config.openAt === 'startup') await this._ensureReady(undefined)
  }

  /** 跨会话检索。 */
  override async searchSessions(
    request: SessionSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionSearchPage<SessionSearchHit>> {
    this._assertSearchEnabled()
    const normalized = normalizeSessionRequest(request, this.config)
    const signal = exec?.signal
    return this._serialized(signal, async () => {
      await this._ensureReady(signal)
      await this._reconcile(signal)
      assertNotAborted(signal)
      const generation = String(this._generation)
      const fingerprint = requestFingerprint(normalized)
      const offset = normalized.cursor === undefined
        ? 0
        : decodeCursor(normalized.cursor, this._instance, 'sessions', fingerprint, generation)
      const rows = await this._querySessions(normalized, offset)
      return page(rows, normalized.limit, row => this._sessionHit(row, normalized.query), cursorOffset => encodeCursor({
        version: 1,
        instance: this._instance,
        scope: 'sessions',
        fingerprint,
        generation,
        offset: cursorOffset,
      }), offset)
    })
  }

  /** 会话内检索。 */
  override async searchEvents(
    request: SessionEventSearchRequest,
    exec?: SessionSearchExecContext,
  ): Promise<SessionEventSearchPage> {
    this._assertSearchEnabled()
    const normalized = normalizeEventRequest(request, this.config)
    const signal = exec?.signal
    return this._serialized(signal, async () => {
      await this._ensureReady(signal)
      await this._reconcile(signal)
      assertNotAborted(signal)
      const target = await this._targetObservation(normalized.sessionId)
      const fingerprint = requestFingerprint(normalized)
      const offset = normalized.cursor === undefined
        ? 0
        : decodeCursor(normalized.cursor, this._instance, 'events', fingerprint, target.generation)
      const rows = await this._queryEvents(normalized, offset)
      return {
        session: target.header,
        ...page(rows, normalized.limit, row => this._eventHit(row, normalized.query), cursorOffset => encodeCursor({
          version: 1,
          instance: this._instance,
          scope: 'events',
          fingerprint,
          generation: target.generation,
          offset: cursorOffset,
        }), offset),
      }
    })
  }

  /** 关闭连接池（幂等）。 */
  close(): Promise<void> {
    this._closePromise ??= this._close()
    return this._closePromise
  }

  private async _close(): Promise<void> {
    this._closed = true
    await this._tail
    if (this._ready !== undefined) {
      try {
        await this._ready
      } catch {
        // 打开失败已自行清理；关闭只等待。
      }
    }
    await this._pool.end()
  }

  private _assertSearchEnabled(): void {
    if (this.config.openAt !== 'never') return
    throw new SessionQueryError(
      'session search is disabled: this deployment configures the session-query index with openAt "never"',
      'SESSION_QUERY_SEARCH_DISABLED',
    )
  }

  private async _ensureReady(signal: AbortSignal | undefined): Promise<void> {
    this._ready ??= openSearchSchema(this._pool, this.config.schema).then(async () => {
      const state = await this._pool.query<{ global_generation: string | number }>(
        'SELECT global_generation FROM search_state WHERE singleton = 1',
      )
      this._generation = Number(state.rows[0]?.global_generation ?? 0)
    })
    try {
      await waitWithAbort(this._ready, signal)
    } catch (error: unknown) {
      if (isAbort(error)) throw error
      throw new SessionQueryError(
        `session-search PostgreSQL index failed to open: ${errorMessage(error)}`,
        'SESSION_QUERY_INDEX_FAILED',
        { cause: error },
      )
    }
  }

  private async _serialized<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (this._closed) throw indexClosed()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const prior = this._tail
    this._tail = prior.then(() => gate)
    try {
      await waitWithAbort(prior, signal)
    } catch (error: unknown) {
      release()
      throw error
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- close() 在别的方法里置位，本函数的流分析看不到。
    if (this._closed) {
      release()
      throw indexClosed()
    }
    try {
      assertNotAborted(signal)
      return await operation()
    } finally {
      release()
    }
  }

  /**
   * 把「活会话 + 持久化会话」同步进索引，并推进代次。
   * 只删除本进程写下的行：其他进程的活会话行保留，避免多实例互删。
   */
  private async _reconcile(signal: AbortSignal | undefined): Promise<void> {
    assertNotAborted(signal)
    const observation = await this._observeStable(signal)
    assertNotAborted(signal)
    const client = await this._pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query(
        'SELECT id, revision, fingerprint, live, persisted, owner FROM sessions',
      )
      const existingById = new Map<string, ExistingRow>(
        (existing.rows as ExistingRow[]).map(row => [row.id, row]),
      )
      const observedIds = new Set<string>(observation.map(entry => entry.header.id))
      const changed = observation.filter((entry) => {
        const row = existingById.get(entry.header.id)
        if (row === undefined) return true
        if (entry.live) {
          return !row.live || row.fingerprint !== entry.fingerprint || row.persisted !== entry.persisted
        }
        return row.live || row.revision !== entry.revision
      })
      const deleted = [...existingById.values()].filter(
        row => row.owner === this._instance && !observedIds.has(row.id),
      )
      const pointerChanged = this._lastPersistenceIdentity !== undefined
        && this._lastPersistenceIdentity !== this._persistenceIdentity()
      if (changed.length > 0 || deleted.length > 0) {
        let next = this._generation
        for (const row of deleted) {
          await client.query('DELETE FROM docs WHERE session_id = $1', [row.id])
          await client.query('DELETE FROM sessions WHERE id = $1', [row.id])
        }
        for (const entry of changed) {
          next += 1
          await this._replaceSession(client, entry, next)
        }
        await client.query(
          'UPDATE search_state SET global_generation = GREATEST(global_generation, $1) WHERE singleton = 1',
          [next],
        )
        this._generation = next
      }
      await client.query('COMMIT')
      if (pointerChanged) this._persistenceEpoch += 1
      this._lastPersistenceIdentity = this._persistenceIdentity()
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // 原始失败仍是可执行原因。
      }
      throw new SessionQueryError(
        `session-search reconciliation failed: ${errorMessage(error)}`,
        'SESSION_QUERY_INDEX_FAILED',
        { cause: error },
      )
    } finally {
      client.release()
    }
  }

  private _persistenceIdentity(): symbol | undefined {
    return this._persistence?.identity
  }

  private async _observeStable(signal: AbortSignal | undefined): Promise<ObservedSession[]> {
    for (let attempt = 0; attempt < STABLE_OBSERVATION_ATTEMPTS; attempt += 1) {
      assertNotAborted(signal)
      const persistence = this._persistence
      const initiallyLive = new Set(this.ctx.sessions.list().map(session => session.id))
      let persisted = new Map<SessionId, { header: SessionHeader; revision: SessionPersistenceRevision }>()
      if (persistence !== undefined) {
        try {
          const listOptions = signal === undefined ? undefined : { signal }
          persisted = materializePersistenceSnapshots(await persistence.list(listOptions))
          assertNotAborted(signal)
          const after = materializePersistenceSnapshots(await persistence.list(listOptions))
          assertNotAborted(signal)
          if (!samePersistenceSnapshots(persisted, after)) continue
        } catch (error: unknown) {
          if (isAbort(error) || signal?.aborted) {
            throw new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED', { cause: error })
          }
          if (error instanceof SessionQueryError) throw error
          throw new SessionQueryError(
            `session-search persistence observation failed: ${errorMessage(error)}`,
            'SESSION_QUERY_PERSISTENCE_FAILED',
            { cause: error },
          )
        }
      }
      const live = new Map<SessionId, ObservedSession>()
      for (const session of this.ctx.sessions.list()) {
        const observed = observeLive(session)
        observed.persisted = persisted.has(session.id)
        live.set(session.id, observed)
      }
      const result: ObservedSession[] = [...live.values()]
      for (const [id, entry] of persisted) {
        if (live.has(id)) continue
        assertNotAborted(signal)
        const loaded = await this._loadPersisted(persistence, id, entry.header, entry.revision, signal)
        if (loaded !== undefined) result.push(loaded)
      }
      const afterIds = new Set(this.ctx.sessions.list().map(session => session.id))
      if (!sameSessionIds(initiallyLive, afterIds)) continue
      return result
    }
    throw new SessionQueryError(
      'session-search persistence observation did not stabilize after one retry',
      'SESSION_QUERY_PERSISTENCE_FAILED',
    )
  }

  /**
   * 载入一个持久化会话的检索文档；索引已是最新版本时返回**空文档的占位条目**。
   *
   * 占位条目必须留在观察结果里：`_reconcile` 用观察到的 id 集合判断删除，
   * 直接返回 `undefined` 会被当成「会话已消失」而误删索引行。
   * 占位条目的 `revision` 与现有行相同，`changed` 过滤因此不会重写文档。
   */
  private async _loadPersisted(
    persistence: SessionPersistence | undefined,
    id: SessionId,
    header: SessionHeader,
    revision: SessionPersistenceRevision,
    signal: AbortSignal | undefined,
  ): Promise<ObservedSession | undefined> {
    if (persistence === undefined) return undefined
    const indexed = await this._pool.query(
      'SELECT revision, live FROM sessions WHERE id = $1',
      [id],
    )
    const row = indexed.rows[0] as { revision: string | null; live: boolean } | undefined
    if (row !== undefined && !row.live && row.revision === revision) {
      return {
        header,
        inheritedEventCount: 0 as SessionLogOffset,
        documents: [],
        fingerprint: '',
        live: false,
        persisted: true,
        revision,
      }
    }
    const loaded = await readColdSessionLog(persistence, id, signal)
    assertNotAborted(signal)
    assertSessionHeadersCompatible(header, loaded.header)
    const observed = observeSession(loaded.header, loaded.inheritedEventCount, loaded.events)
    observed.persisted = true
    observed.revision = revision
    return observed
  }

  private async _replaceSession(
    client: PoolClient,
    entry: ObservedSession,
    generation: number,
  ): Promise<void> {
    await client.query('DELETE FROM docs WHERE session_id = $1', [entry.header.id])
    await client.query(
      `INSERT INTO sessions
         (id, version, created_at, cwd, parent_session, seed_length, delegation_depth,
          agent_preset, revision, fingerprint, live, persisted, generation, owner)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET
         version = EXCLUDED.version,
         created_at = EXCLUDED.created_at,
         cwd = EXCLUDED.cwd,
         parent_session = EXCLUDED.parent_session,
         seed_length = EXCLUDED.seed_length,
         delegation_depth = EXCLUDED.delegation_depth,
         agent_preset = EXCLUDED.agent_preset,
         revision = EXCLUDED.revision,
         fingerprint = EXCLUDED.fingerprint,
         live = EXCLUDED.live,
         persisted = EXCLUDED.persisted,
         generation = EXCLUDED.generation,
         owner = EXCLUDED.owner`,
      [
        entry.header.id,
        entry.header.version,
        entry.header.createdAt,
        entry.header.cwd ?? null,
        entry.header.parentSession ?? null,
        entry.header.isSeeded ? entry.inheritedEventCount : null,
        entry.header.delegationDepth ?? null,
        entry.header.agentPreset ?? null,
        entry.revision ?? null,
        entry.fingerprint,
        entry.live,
        entry.persisted,
        generation,
        this._instance,
      ],
    )
    for (let start = 0; start < entry.documents.length; start += DOCUMENT_BATCH_SIZE) {
      const batch = entry.documents.slice(start, start + DOCUMENT_BATCH_SIZE)
      await client.query(
        `INSERT INTO docs (session_id, seq, type, time, surface, text, codepoint_length)
         SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::bigint[], $5::text[], $6::text[], $7::int[])`,
        [
          batch.map(document => document.sessionId),
          batch.map(document => document.seq),
          batch.map(document => document.type),
          batch.map(document => document.time),
          batch.map(document => document.surface),
          batch.map(document => document.text),
          batch.map(document => Array.from(document.text).length),
        ],
      )
    }
  }

  private async _querySessions(request: NormalizedSessionRequest, offset: number): Promise<SearchRow[]> {
    const params = new Params()
    const queryParam = params.add(request.query)
    const sessionWhere = buildSessionWhere(request.sessionFilters, params)
    const eventWhere = buildEventWhere(request.eventFilters, params)
    const where = [ftsClause(queryParam), sessionWhere, eventWhere].filter(Boolean).join(' AND ')
    const limitParam = params.add(request.limit + 1)
    const offsetParam = params.add(offset)
    const result = await this._pool.query(
      `WITH matched AS (
         SELECT
           s.id AS session_id,
           s.version AS version,
           s.created_at AS created_at,
           s.cwd AS cwd,
           s.parent_session AS parent_session,
           s.seed_length AS seed_length,
           s.delegation_depth AS delegation_depth,
           s.agent_preset AS agent_preset,
           s.live AS live,
           s.persisted AS persisted,
           d.seq AS seq,
           d.type AS type,
           d.time AS time,
           d.surface AS surface,
           d.text AS text,
           d.codepoint_length AS codepoint_length,
           (length(lower(d.text)) - length(replace(lower(d.text), lower(${queryParam}), '')))
             / length(${queryParam}) AS match_count
         FROM docs AS d
         JOIN sessions AS s ON s.id = d.session_id
         WHERE ${where}
       ), ranked AS (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY session_id
           ORDER BY match_count DESC, codepoint_length ASC, time DESC, seq DESC
         ) AS event_rank
         FROM matched
       )
       SELECT * FROM ranked
       WHERE event_rank = 1
       ORDER BY match_count DESC, codepoint_length ASC, time DESC, session_id ASC, seq DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params.values,
    )
    return result.rows as SearchRow[]
  }

  private async _queryEvents(request: NormalizedEventRequest, offset: number): Promise<SearchRow[]> {
    const params = new Params()
    const queryParam = params.add(request.query)
    const sessionParam = params.add(request.sessionId)
    const eventWhere = buildEventWhere(request.filters, params)
    const where = [ftsClause(queryParam), `d.session_id = ${sessionParam}`, eventWhere]
      .filter(Boolean)
      .join(' AND ')
    const limitParam = params.add(request.limit + 1)
    const offsetParam = params.add(offset)
    const result = await this._pool.query(
      `SELECT
         s.id AS session_id,
         s.version AS version,
         s.created_at AS created_at,
         s.cwd AS cwd,
         s.parent_session AS parent_session,
         s.seed_length AS seed_length,
         s.delegation_depth AS delegation_depth,
         s.agent_preset AS agent_preset,
         s.live AS live,
         s.persisted AS persisted,
         d.seq AS seq,
         d.type AS type,
         d.time AS time,
         d.surface AS surface,
         d.text AS text,
         d.codepoint_length AS codepoint_length,
         (length(lower(d.text)) - length(replace(lower(d.text), lower(${queryParam}), '')))
           / length(${queryParam}) AS match_count
       FROM docs AS d
       JOIN sessions AS s ON s.id = d.session_id
       WHERE ${where}
       ORDER BY match_count DESC, codepoint_length ASC, time DESC, seq DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params.values,
    )
    return result.rows as SearchRow[]
  }

  private async _targetObservation(
    sessionId: SessionId,
  ): Promise<{ header: SessionHeader; generation: string }> {
    const result = await this._pool.query(
      `SELECT id AS session_id, version, created_at, cwd, parent_session, seed_length,
              delegation_depth, agent_preset, live, persisted, generation
       FROM sessions WHERE id = $1`,
      [sessionId],
    )
    const row = result.rows[0] as (SearchRow & { generation: string | number }) | undefined
    if (row === undefined) {
      throw new SessionQueryError(
        `session "${sessionId}" not found`,
        'SESSION_QUERY_SESSION_NOT_FOUND',
      )
    }
    return {
      header: rowHeader(row),
      generation: row.live
        ? `live:${String(row.generation)}`
        : `persisted:${String(this._persistenceEpoch)}:${String(row.generation)}`,
    }
  }

  private _sessionHit(row: SearchRow, query: string): SessionSearchHit {
    return {
      header: rowHeader(row),
      live: row.live,
      persisted: row.persisted,
      bestMatch: this._eventHit(row, query),
    }
  }

  private _eventHit(row: SearchRow, query: string): SessionEventSearchHit {
    return {
      sessionId: row.session_id as SessionId,
      seq: SessionSeq(row.seq),
      type: row.type as SessionEventSearchHit['type'],
      time: Number(row.time),
      surface: row.surface as SessionEventSearchHit['surface'],
      snippet: makeSnippet(markOccurrences(row.text, query), this.config.snippetChars),
    }
  }
}

/**
 * 全文谓词：查询文本作为**一个字面短语**，`simple` 配置不做词干化。
 * @param queryParam - 查询文本占位符。
 * @returns SQL 谓词。
 */
function ftsClause(queryParam: string): string {
  return `to_tsvector('simple', d.text) @@ phraseto_tsquery('simple', ${queryParam})`
}

function observeLive(session: Session): ObservedSession {
  // oxlint-disable-next-line typescript/no-deprecated -- 既有会话历史读取；迁移另行安排。
  const observed = observeSession(session.header, session.inheritedEventCount, session.snapshotEvents())
  observed.live = true
  return observed
}

function observeSession(
  header: SessionHeader,
  inheritedEventCount: SessionLogOffset,
  events: readonly SessionEvent[],
): ObservedSession {
  const detachedHeader = structuredClone(header)
  const detachedEvents = events.map(event => structuredClone(event))
  return {
    header: detachedHeader,
    inheritedEventCount,
    documents: buildSessionEventSearchDocuments(detachedHeader.id, detachedEvents),
    fingerprint: createHash('sha256')
      .update(JSON.stringify({ header: detachedHeader, inheritedEventCount, events: detachedEvents }))
      .digest('base64url'),
    live: false,
    persisted: false,
  }
}

function materializePersistenceSnapshots(
  snapshots: readonly { header: SessionHeader; revision: SessionPersistenceRevision }[],
): Map<SessionId, { header: SessionHeader; revision: SessionPersistenceRevision }> {
  const result = new Map<SessionId, { header: SessionHeader; revision: SessionPersistenceRevision }>()
  for (const snapshot of snapshots) {
    const header = structuredClone(snapshot.header)
    if (result.has(header.id)) throw new Error(`persistence listed duplicate session "${header.id}"`)
    result.set(header.id, { header, revision: snapshot.revision })
  }
  return result
}

function samePersistenceSnapshots(
  before: ReadonlyMap<SessionId, { header: SessionHeader; revision: SessionPersistenceRevision }>,
  after: ReadonlyMap<SessionId, { header: SessionHeader; revision: SessionPersistenceRevision }>,
): boolean {
  if (before.size !== after.size) return false
  for (const [id, first] of before) {
    const second = after.get(id)
    if (second === undefined || first.revision !== second.revision) return false
  }
  return true
}

function sameSessionIds(before: ReadonlySet<SessionId>, after: ReadonlySet<SessionId>): boolean {
  if (before.size !== after.size) return false
  for (const id of before) if (!after.has(id)) return false
  return true
}

function rowHeader(row: SearchRow): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: row.session_id as SessionId,
    createdAt: Number(row.created_at),
    ...row.cwd === null ? {} : { cwd: row.cwd },
    ...row.parent_session === null ? {} : { parentSession: row.parent_session as SessionId },
    isSeeded: row.seed_length !== null,
    ...row.delegation_depth === null ? {} : { delegationDepth: row.delegation_depth },
    ...row.agent_preset === null ? {} : { agentPreset: row.agent_preset },
  }
}

function page<Row, Item>(
  rows: readonly Row[],
  limit: number,
  convert: (row: Row) => Item,
  nextCursor: (offset: number) => SessionSearchCursorValue,
  offset: number,
): SessionSearchPage<Item> {
  const hasMore = rows.length > limit
  return {
    items: rows.slice(0, limit).map(convert),
    ...hasMore ? { nextCursor: nextCursor(offset + limit) } : {},
  }
}

function encodeCursor(payload: CursorPayload): SessionSearchCursorValue {
  return SessionSearchCursor(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'))
}

function decodeCursor(
  cursor: SessionSearchCursorValue,
  instance: string,
  scope: CursorPayload['scope'],
  fingerprint: string,
  generation: string,
): number {
  let decoded: Partial<CursorPayload>
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPayload>
  } catch (error: unknown) {
    throw invalidCursor(error)
  }
  if (
    decoded.version !== 1
    || decoded.instance !== instance
    || decoded.scope !== scope
    || decoded.fingerprint !== fingerprint
    || !Number.isSafeInteger(decoded.offset)
    || decoded.offset === undefined
    || decoded.offset < 0
  ) {
    throw invalidCursor(new Error('cursor does not belong to this normalized request'))
  }
  if (decoded.generation !== generation) {
    throw new SessionQueryError(
      'session-search cursor is stale because its relevant corpus changed',
      'SESSION_QUERY_STALE_CURSOR',
    )
  }
  return decoded.offset
}

function invalidCursor(cause: unknown): SessionQueryError {
  return new SessionQueryError('session-search cursor is invalid', 'SESSION_QUERY_INVALID_CURSOR', { cause })
}

function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    url: config.url,
    schema: config.schema ?? 'search',
    maxConnections: config.maxConnections ?? 5,
    openAt: config.openAt ?? 'startup',
    defaultLimit: config.defaultLimit ?? SESSION_QUERY_POSTGRES_DEFAULT_LIMIT,
    maxLimit: config.maxLimit ?? SESSION_QUERY_POSTGRES_MAX_LIMIT,
    snippetChars: config.snippetChars ?? SESSION_QUERY_POSTGRES_SNIPPET_CHARS,
    readWindowMax: config.readWindowMax ?? SESSION_QUERY_READ_WINDOW_MAX,
    persistedReadConcurrency: config.persistedReadConcurrency
      ?? SESSION_QUERY_DEFAULT_PERSISTED_INSPECT_CONCURRENCY,
    preparedSessionCacheSize: config.preparedSessionCacheSize
      ?? SESSION_QUERY_DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  }
  if (typeof resolved.url !== 'string' || resolved.url.trim().length === 0) {
    throw invalidConfig('url must not be blank')
  }
  if (typeof resolved.schema !== 'string' || resolved.schema.trim().length === 0) {
    throw invalidConfig('schema must not be blank')
  }
  const openPhases: readonly string[] = ['startup', 'first-search', 'never']
  if (!openPhases.includes(resolved.openAt)) throw invalidConfig('openAt is not supported')
  if (!Number.isSafeInteger(resolved.defaultLimit) || resolved.defaultLimit < 1) {
    throw invalidConfig('defaultLimit must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxLimit) || resolved.maxLimit < 1) {
    throw invalidConfig('maxLimit must be a positive safe integer')
  }
  if (resolved.defaultLimit > resolved.maxLimit) {
    throw invalidConfig('defaultLimit must be less than or equal to maxLimit')
  }
  if (!Number.isSafeInteger(resolved.snippetChars) || resolved.snippetChars < 1) {
    throw invalidConfig('snippetChars must be a positive safe integer')
  }
  return resolved
}

function invalidConfig(detail: string): SessionQueryError {
  return new SessionQueryError(
    `session-search PostgreSQL config: ${detail}`,
    'SESSION_QUERY_INVALID_CONFIG',
  )
}

function indexClosed(): SessionQueryError {
  return new SessionQueryError('session-search PostgreSQL index is closed', 'SESSION_QUERY_INDEX_FAILED')
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED')
  }
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new SessionQueryError('session-search aborted', 'SESSION_QUERY_ABORTED'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error('session-search dependency rejected', { cause: error }))
      },
    )
  })
}

function isAbort(error: unknown): boolean {
  return error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

/**
 * 挂载 PostgreSQL 会话检索后端。
 * @param ctx - 插件上下文。
 * @param config - 连接串与索引配置。
 */
export function apply(ctx: Context, config: Config): void {
  new PostgresSessionQueryEngine(ctx, config)
}

export default PostgresSessionQueryEngine
