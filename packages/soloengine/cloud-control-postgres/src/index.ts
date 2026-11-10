/**
 * 共享归属库的 PostgreSQL 落地（多节点形态，W10.1）——**可选后端包**。
 *
 * 控制面核心（`@soloengine/cloud-control`）不依赖本包，也不依赖 `pg`：只有部署形态选择
 * PostgreSQL 时，控制面才按包名动态加载本包（未安装即 fail loud 并给出安装指引）。
 *
 * 与 SQLite 版（`ControlStore`）同一份表结构与语义；时间一律存 ISO 8601 文本，
 * 因此到期比较在两种引擎上都是同一套字符串序。租约接管在事务里 `SELECT … FOR UPDATE`
 * 锁住该会话行后做 CAS（epoch+1），并发接管只有一个能赢。
 *
 * @module @soloengine/cloud-control-postgres
 */

import pg from 'pg'
import type { Pool as PgPool, PoolClient } from 'pg'
import {
  HEARTBEAT_TIMEOUT_MS,
  type ControlRepository,
  type NodeLoad,
  type NodeState,
  type NodeView,
  type PlacementDecision,
  type RepositoryLeaseResult,
  type SessionLease,
  type UsageAggregate,
  type UsageReport,
  type WorkspaceFileEntry,
} from '@soloengine/cloud-control'

// `pg` 是 CJS 包：Node 的静态 ESM 分析看不到具名导出，必须走默认导入再取构造器。
const { Pool } = pg

/** 控制面 schema（幂等；与 SQLite 版逐列一致）。 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS cloud_nodes (
  node_id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  region TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  max_sessions INTEGER NOT NULL,
  state TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_node_load (
  node_id TEXT PRIMARY KEY,
  active_sessions INTEGER NOT NULL,
  cpu_percent DOUBLE PRECISION,
  mem_percent DOUBLE PRECISION,
  queue_depth INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_session_leases (
  session_key TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  holder TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  renewed_at TEXT NOT NULL,
  user_id TEXT
);
CREATE TABLE IF NOT EXISTS cloud_session_events (
  seq BIGSERIAL PRIMARY KEY,
  session_key TEXT NOT NULL,
  node_id TEXT,
  epoch INTEGER,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  detail_json TEXT
);
CREATE TABLE IF NOT EXISTS cloud_placement_decisions (
  seq BIGSERIAL PRIMARY KEY,
  session_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  latency_ms DOUBLE PRECISION NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_usage_reports (
  seq BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  source_seq INTEGER,
  tokens INTEGER NOT NULL,
  reported_at TEXT NOT NULL,
  UNIQUE (session_key, source_seq)
);
CREATE TABLE IF NOT EXISTS cloud_workspace_manifests (
  session_key TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

/** 节点行。 */
interface NodeRow {
  node_id: string
  endpoint: string
  region: string
  labels_json: string
  max_sessions: number
  state: string
  registered_at: string
  last_heartbeat_at: string
  active_sessions: number | null
  cpu_percent: number | null
  mem_percent: number | null
  queue_depth: number | null
  updated_at: string | null
}

/** 租约行。 */
interface LeaseRow {
  session_key: string
  node_id: string
  epoch: number
  holder: string
  expires_at: string
  renewed_at: string
  user_id: string | null
}

/**
 * 计算一次租约写的时间戳。
 * @param now - 当前时间。
 * @param ttlMs - 租约时长（毫秒）。
 * @returns 当前时间与到期时间的 ISO 文本。
 */
function leaseTimes(now: Date, ttlMs: number): { nowIso: string; expiresAt: string } {
  return { nowIso: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString() }
}

/** 控制面 PostgreSQL 仓储。 */
export class PgControlStore implements ControlRepository {
  private readonly pool: PgPool

  /**
   * @param connectionString - PostgreSQL 连接串（例如 `postgres://user:pass@host:5432/soloengine`）。
   */
  private constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 16 })
  }

  /**
   * 建立连接池并确保 schema 就位。
   * @param connectionString - PostgreSQL 连接串。
   * @returns 已迁移的仓储。
   */
  static async open(connectionString: string): Promise<PgControlStore> {
    const store = new PgControlStore(connectionString)
    await store.pool.query(SCHEMA)
    // 旧库增量列：租约归属用户（W10.10 跨节点配额计数）。
    await store.pool.query('ALTER TABLE cloud_session_leases ADD COLUMN IF NOT EXISTS user_id TEXT')
    return store
  }

  /** 关闭连接池。 */
  async close(): Promise<void> {
    await this.pool.end()
  }

  async registerNode(record: {
    nodeId: string
    endpoint: string
    region: string
    labels: Record<string, string>
    maxSessions: number
    state?: NodeState
  }): Promise<void> {
    const now = new Date().toISOString()
    await this.pool.query(`
      INSERT INTO cloud_nodes (node_id, endpoint, region, labels_json, max_sessions, state, registered_at, last_heartbeat_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT(node_id) DO UPDATE SET
        endpoint = EXCLUDED.endpoint,
        region = EXCLUDED.region,
        labels_json = EXCLUDED.labels_json,
        max_sessions = EXCLUDED.max_sessions,
        state = EXCLUDED.state,
        last_heartbeat_at = EXCLUDED.last_heartbeat_at
    `, [record.nodeId, record.endpoint, record.region, JSON.stringify(record.labels),
      record.maxSessions, record.state ?? 'active', now, now])
  }

  async heartbeat(nodeId: string, load: NodeLoad, at: Date): Promise<boolean> {
    const now = at.toISOString()
    const updated = await this.pool.query('UPDATE cloud_nodes SET last_heartbeat_at = $1 WHERE node_id = $2', [now, nodeId])
    if ((updated.rowCount ?? 0) === 0) return false
    await this.pool.query(`
      INSERT INTO cloud_node_load (node_id, active_sessions, cpu_percent, mem_percent, queue_depth, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT(node_id) DO UPDATE SET
        active_sessions = EXCLUDED.active_sessions,
        cpu_percent = EXCLUDED.cpu_percent,
        mem_percent = EXCLUDED.mem_percent,
        queue_depth = EXCLUDED.queue_depth,
        updated_at = EXCLUDED.updated_at
    `, [nodeId, load.activeSessions, load.cpuPercent ?? null, load.memPercent ?? null, load.queueDepth ?? null, now])
    return true
  }

  async setNodeState(nodeId: string, state: NodeState): Promise<void> {
    await this.pool.query('UPDATE cloud_nodes SET state = $1 WHERE node_id = $2', [state, nodeId])
  }

  async listNodes(now: Date): Promise<NodeView[]> {
    const result = await this.pool.query(`
      SELECT n.*, l.active_sessions, l.cpu_percent, l.mem_percent, l.queue_depth, l.updated_at
      FROM cloud_nodes n LEFT JOIN cloud_node_load l ON l.node_id = n.node_id
      ORDER BY n.node_id ASC
    `)
    const nowMs = now.getTime()
    return (result.rows as NodeRow[]).map((row) => {
      const lastBeat = Date.parse(row.last_heartbeat_at)
      return {
        nodeId: row.node_id,
        endpoint: row.endpoint,
        region: row.region,
        labels: JSON.parse(row.labels_json) as Record<string, string>,
        maxSessions: row.max_sessions,
        state: row.state as NodeState,
        registeredAt: row.registered_at,
        lastHeartbeatAt: row.last_heartbeat_at,
        load: {
          activeSessions: row.active_sessions ?? 0,
          ...(row.cpu_percent === null ? {} : { cpuPercent: row.cpu_percent }),
          ...(row.mem_percent === null ? {} : { memPercent: row.mem_percent }),
          ...(row.queue_depth === null ? {} : { queueDepth: row.queue_depth }),
        },
        loadUpdatedAt: row.updated_at ?? row.last_heartbeat_at,
        stale: !Number.isFinite(lastBeat) || nowMs - lastBeat > HEARTBEAT_TIMEOUT_MS,
      }
    })
  }

  async noteSessionStart(nodeId: string, at: Date): Promise<void> {
    await this.pool.query(
      'UPDATE cloud_node_load SET active_sessions = active_sessions + 1, updated_at = $1 WHERE node_id = $2',
      [at.toISOString(), nodeId])
  }

  async noteSessionEnd(nodeId: string, at: Date): Promise<void> {
    await this.pool.query(
      'UPDATE cloud_node_load SET active_sessions = GREATEST(active_sessions - 1, 0), updated_at = $1 WHERE node_id = $2',
      [at.toISOString(), nodeId])
  }

  async getLease(sessionKey: string): Promise<SessionLease | undefined> {
    const result = await this.pool.query('SELECT * FROM cloud_session_leases WHERE session_key = $1', [sessionKey])
    const row = result.rows[0] as LeaseRow | undefined
    return row === undefined ? undefined : toLease(row)
  }

  async listLeases(nodeId: string): Promise<SessionLease[]> {
    const result = await this.pool.query('SELECT * FROM cloud_session_leases WHERE node_id = $1 ORDER BY session_key', [nodeId])
    return result.rows.map(row => toLease(row as LeaseRow))
  }

  async activeLeaseCount(userId: string, now: Date): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM cloud_session_leases WHERE user_id = $1 AND expires_at > $2',
      [userId, now.toISOString()])
    return Number(result.rows[0]?.count ?? 0)
  }

  async activeLeaseUsers(now: Date): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(DISTINCT user_id)::text AS count FROM cloud_session_leases WHERE user_id IS NOT NULL AND expires_at > $1',
      [now.toISOString()])
    return Number(result.rows[0]?.count ?? 0)
  }

  async takeoverLease(
    input: { sessionKey: string; expectedEpoch: number; nodeId: string; holder: string; ttlMs: number },
    now: Date,
  ): Promise<SessionLease | undefined> {
    const { nowIso, expiresAt } = leaseTimes(now, input.ttlMs)
    const result = await this.pool.query(`
      UPDATE cloud_session_leases
      SET node_id = $1, epoch = epoch + 1, holder = $2, expires_at = $3, renewed_at = $4
      WHERE session_key = $5 AND epoch = $6
    `, [input.nodeId, input.holder, expiresAt, nowIso, input.sessionKey, input.expectedEpoch])
    return this.settledLease(input.sessionKey, input.nodeId, result.rowCount ?? 0, nowIso, 'lease-reclaimed',
      { previousEpoch: input.expectedEpoch, holder: input.holder })
  }

  async acquireLease(
    input: { sessionKey: string; nodeId: string; holder: string; ttlMs: number; userId?: string },
    now: Date,
  ): Promise<RepositoryLeaseResult> {
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString()
    const nowIso = now.toISOString()
    const client: PoolClient = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const selected = await client.query('SELECT * FROM cloud_session_leases WHERE session_key = $1 FOR UPDATE', [input.sessionKey])
      const existing = selected.rows[0] as LeaseRow | undefined
      if (existing === undefined) {
        await client.query(`
          INSERT INTO cloud_session_leases (session_key, node_id, epoch, holder, expires_at, renewed_at, user_id)
          VALUES ($1, $2, 1, $3, $4, $5, $6)
        `, [input.sessionKey, input.nodeId, input.holder, expiresAt, nowIso, input.userId ?? null])
        await audit(client, input.sessionKey, input.nodeId, 1, 'lease-acquired', nowIso, { holder: input.holder })
        await client.query('COMMIT')
        return { ok: true, lease: await this.writtenLease(input.sessionKey), acquired: true }
      }
      if (existing.holder === input.holder && existing.node_id === input.nodeId) {
        // 自己名下已过期的租约不能走「续约」（续约要求未到期），否则本节点会永远 LEASE_HELD。
        // 过期但无人接管时重新取得同一代写权：epoch 不变，写围栏语义不受影响。
        if (Date.parse(existing.expires_at) <= now.getTime()) {
          const refreshed = await client.query(`
            UPDATE cloud_session_leases
            SET expires_at = $1, renewed_at = $2, user_id = COALESCE($6, user_id)
            WHERE session_key = $3 AND holder = $4 AND epoch = $5 AND expires_at <= $2
          `, [expiresAt, nowIso, input.sessionKey, input.holder, existing.epoch, input.userId ?? null])
          if ((refreshed.rowCount ?? 0) !== 1) {
            await client.query('ROLLBACK')
            return { ok: false, code: 'LEASE_HELD', lease: (await this.getLease(input.sessionKey)) ?? toLease(existing) }
          }
          await audit(client, input.sessionKey, input.nodeId, existing.epoch, 'lease-refreshed', nowIso, { holder: input.holder })
          await client.query('COMMIT')
          return { ok: true, lease: await this.writtenLease(input.sessionKey), acquired: false }
        }
        // 续约必须走同一事务连接：事务已对该行加 FOR UPDATE 行锁，换一条连接更新同一行
        // 会等锁自死锁（原实现走 this.pool，pg 默认无语句超时，会永久挂起）。
        const renewed = await client.query(`
          UPDATE cloud_session_leases
          SET expires_at = $1, renewed_at = $2, user_id = COALESCE($6, user_id)
          WHERE session_key = $3 AND holder = $4 AND epoch = $5 AND expires_at > $2
        `, [expiresAt, nowIso, input.sessionKey, input.holder, existing.epoch, input.userId ?? null])
        await client.query('COMMIT')
        return (renewed.rowCount ?? 0) === 1
          ? { ok: true, lease: await this.writtenLease(input.sessionKey), acquired: false }
          : { ok: false, code: 'LEASE_HELD', lease: toLease(existing) }
      }
      if (Date.parse(existing.expires_at) > now.getTime()) {
        await client.query('ROLLBACK')
        return { ok: false, code: 'LEASE_HELD', lease: toLease(existing) }
      }
      const takeover = await client.query(`
        UPDATE cloud_session_leases
        SET node_id = $1, epoch = epoch + 1, holder = $2, expires_at = $3, renewed_at = $4,
            user_id = COALESCE($7, user_id)
        WHERE session_key = $5 AND epoch = $6 AND expires_at <= $4
      `, [input.nodeId, input.holder, expiresAt, nowIso, input.sessionKey, existing.epoch, input.userId ?? null])
      if ((takeover.rowCount ?? 0) !== 1) {
        await client.query('ROLLBACK')
        return { ok: false, code: 'LEASE_HELD', lease: (await this.getLease(input.sessionKey)) ?? toLease(existing) }
      }
      await audit(client, input.sessionKey, input.nodeId, existing.epoch + 1, 'lease-takeover', nowIso,
        { previousHolder: existing.holder, previousEpoch: existing.epoch })
      await client.query('COMMIT')
      return { ok: true, lease: await this.writtenLease(input.sessionKey), acquired: true }
    } catch (error) {
      try { await client.query('ROLLBACK') } catch { /* 连接已断开 */ }
      throw error
    } finally {
      client.release()
    }
  }

  async renewLease(sessionKey: string, holder: string, epoch: number, ttlMs: number, now: Date): Promise<boolean> {
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    const result = await this.pool.query(`
      UPDATE cloud_session_leases SET expires_at = $1, renewed_at = $2
      WHERE session_key = $3 AND holder = $4 AND epoch = $5 AND expires_at > $2
    `, [expiresAt, now.toISOString(), sessionKey, holder, epoch])
    return (result.rowCount ?? 0) === 1
  }

  async releaseLease(sessionKey: string, holder: string, epoch: number): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM cloud_session_leases WHERE session_key = $1 AND holder = $2 AND epoch = $3',
      [sessionKey, holder, epoch])
    if ((result.rowCount ?? 0) === 1) {
      await this.pool.query(
        'INSERT INTO cloud_session_events (session_key, node_id, epoch, kind, at, detail_json) VALUES ($1, $2, $3, $4, $5, $6)',
        [sessionKey, '', epoch, 'lease-released', new Date().toISOString(), JSON.stringify({ holder })])
      return true
    }
    return false
  }

  async adoptLease(
    input: { sessionKey: string; nodeId: string; holder: string; ttlMs: number },
    now: Date,
  ): Promise<SessionLease | undefined> {
    const { nowIso, expiresAt } = leaseTimes(now, input.ttlMs)
    const result = await this.pool.query(`
      UPDATE cloud_session_leases SET holder = $1, expires_at = $2, renewed_at = $3
      WHERE session_key = $4 AND node_id = $5 AND expires_at > $3
    `, [input.holder, expiresAt, nowIso, input.sessionKey, input.nodeId])
    return this.settledLease(input.sessionKey, input.nodeId, result.rowCount ?? 0, nowIso, 'lease-adopted',
      { holder: input.holder })
  }

  /**
   * 读回 CAS 更新后的租约并记一条审计。
   * @param sessionKey - 会话键。
   * @param nodeId - 节点标识。
   * @param changes - UPDATE 影响行数。
   * @param nowIso - 当前时间。
   * @param kind - 审计事件名。
   * @param detail - 审计细节。
   * @returns 更新后的租约；CAS 未命中时为 undefined。
   */
  private async settledLease(
    sessionKey: string,
    nodeId: string,
    changes: number,
    nowIso: string,
    kind: string,
    detail: unknown,
  ): Promise<SessionLease | undefined> {
    if (changes !== 1) return undefined
    const lease = await this.getLease(sessionKey)
    if (lease !== undefined) {
      await this.pool.query(
        'INSERT INTO cloud_session_events (session_key, node_id, epoch, kind, at, detail_json) VALUES ($1, $2, $3, $4, $5, $6)',
        [sessionKey, nodeId, lease.epoch, kind, nowIso, JSON.stringify(detail)])
    }
    return lease
  }

  async assertWriter(sessionKey: string, epoch: number, now: Date): Promise<boolean> {
    const lease = await this.getLease(sessionKey)
    return lease !== undefined && lease.epoch === epoch && Date.parse(lease.expiresAt) > now.getTime()
  }

  async recordPlacement(decision: PlacementDecision): Promise<void> {
    await this.pool.query(`
      INSERT INTO cloud_placement_decisions (session_key, node_id, reason, candidates_json, latency_ms, decided_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [decision.sessionKey, decision.nodeId, decision.reason, JSON.stringify(decision.candidates),
      decision.latencyMs, decision.decidedAt])
  }

  async recordUsage(report: UsageReport): Promise<void> {
    await this.pool.query(`
      INSERT INTO cloud_usage_reports (user_id, session_key, source_seq, tokens, reported_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (session_key, source_seq) DO NOTHING
    `, [report.userId, report.sessionKey, report.sourceSeq ?? null, report.tokens, report.reportedAt])
  }

  async usage(filter: { userId?: string } = {}): Promise<UsageAggregate[]> {
    const result = filter.userId === undefined
      ? await this.pool.query(`
          SELECT user_id, session_key, SUM(tokens) AS tokens, COUNT(*) AS reports, MAX(reported_at) AS last_reported_at
          FROM cloud_usage_reports GROUP BY user_id, session_key ORDER BY user_id, session_key
        `)
      : await this.pool.query(`
          SELECT user_id, session_key, SUM(tokens) AS tokens, COUNT(*) AS reports, MAX(reported_at) AS last_reported_at
          FROM cloud_usage_reports WHERE user_id = $1 GROUP BY user_id, session_key ORDER BY user_id, session_key
        `, [filter.userId])
    return (result.rows as {
      user_id: string
      session_key: string
      tokens: string | number
      reports: string | number
      last_reported_at: string
    }[]).map(row => ({
      userId: row.user_id,
      sessionKey: row.session_key,
      tokens: Number(row.tokens),
      reports: Number(row.reports),
      lastReportedAt: row.last_reported_at,
    }))
  }

  async putWorkspaceManifest(sessionKey: string, files: readonly WorkspaceFileEntry[], at: Date): Promise<void> {
    await this.pool.query(`
      INSERT INTO cloud_workspace_manifests (session_key, manifest_json, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (session_key) DO UPDATE SET
        manifest_json = EXCLUDED.manifest_json,
        updated_at = EXCLUDED.updated_at
    `, [sessionKey, JSON.stringify(files), at.toISOString()])
  }

  async getWorkspaceManifest(sessionKey: string): Promise<WorkspaceFileEntry[]> {
    const result = await this.pool.query(
      'SELECT manifest_json FROM cloud_workspace_manifests WHERE session_key = $1', [sessionKey])
    const row = result.rows[0] as { manifest_json: string } | undefined
    return row === undefined ? [] : JSON.parse(row.manifest_json) as WorkspaceFileEntry[]
  }

  async events(sessionKey: string): Promise<{ kind: string; epoch: number | null; at: string; detail: unknown }[]> {
    const result = await this.pool.query(
      'SELECT kind, epoch, at, detail_json FROM cloud_session_events WHERE session_key = $1 ORDER BY seq ASC',
      [sessionKey])
    return (result.rows as { kind: string; epoch: number | null; at: string; detail_json: string | null }[]).map((row) => {
      const detail: unknown = row.detail_json === null ? null : JSON.parse(row.detail_json)
      return { kind: row.kind, epoch: row.epoch, at: row.at, detail }
    })
  }

  /**
   * 读回刚写入的租约（写入成功后行必须存在）。
   * @param sessionKey - 会话键。
   * @returns 租约。
   * @throws 写入成功但行缺失时（不变量被破坏）。
   */
  private async writtenLease(sessionKey: string): Promise<SessionLease> {
    const lease = await this.getLease(sessionKey)
    if (lease === undefined) throw new Error(`lease ${sessionKey} is missing after a successful write`)
    return lease
  }
}

/** 在同一事务里写一条会话审计事件。 */
async function audit(
  client: PoolClient,
  sessionKey: string,
  nodeId: string,
  epoch: number,
  kind: string,
  at: string,
  detail: unknown,
): Promise<void> {
  await client.query(
    'INSERT INTO cloud_session_events (session_key, node_id, epoch, kind, at, detail_json) VALUES ($1, $2, $3, $4, $5, $6)',
    [sessionKey, nodeId, epoch, kind, at, JSON.stringify(detail)])
}

/** 行 → 租约。 */
function toLease(row: LeaseRow): SessionLease {
  return {
    sessionKey: row.session_key,
    nodeId: row.node_id,
    epoch: row.epoch,
    holder: row.holder,
    expiresAt: row.expires_at,
    renewedAt: row.renewed_at,
    ...(row.user_id === null ? {} : { userId: row.user_id }),
  }
}
