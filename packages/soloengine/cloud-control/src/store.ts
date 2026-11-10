/**
 * 共享归属库的 SQLite 落地（单机形态；PostgreSQL 形态复刻同一 schema 与语句）。
 *
 * 控制面所有状态都在这里：节点注册与负载、会话租约（epoch 写围栏）、事件审计、放置审计。
 * 语句全部参数化；租约的接管用「带条件的 UPDATE + changes 计数」做 CAS，因此同一份库上
 * 多进程/多节点并发接管时只有一条能赢。
 *
 * @module @soloengine/cloud-control/store
 */

import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import {
  HEARTBEAT_TIMEOUT_MS,
  type NodeLoad,
  type NodeRecord,
  type NodeState,
  type NodeView,
  type PlacementDecision,
  type SessionLease,
  type WorkspaceFileEntry,
} from './contracts.ts'
import type { ControlRepository, RepositoryLeaseResult } from './repository.ts'
import type { UsageAggregate, UsageReport } from './quota.ts'

/** 控制面 schema（幂等）。 */
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
  cpu_percent REAL,
  mem_percent REAL,
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
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  node_id TEXT,
  epoch INTEGER,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  detail_json TEXT
);
CREATE TABLE IF NOT EXISTS cloud_placement_decisions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  latency_ms REAL NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_usage_reports (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
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

/** 节点行（SQLite 返回形态）。 */
type NodeRow = {
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
type LeaseRow = {
  session_key: string
  node_id: string
  epoch: number
  holder: string
  expires_at: string
  renewed_at: string
  user_id: string | null
}

/** 计量聚合行。 */
type UsageRow = {
  user_id: string
  session_key: string
  tokens: number
  reports: number
  last_reported_at: string
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

/** 读语句的行形状声明：列由本文件的 schema 固定，调用点给出该查询的行类型。 */
interface RowStatement<Row extends Record<string, SQLOutputValue>> {
  all(...parameters: readonly (string | number | bigint | null)[]): Row[]
  get(...parameters: readonly (string | number | bigint | null)[]): Row | undefined
}

/** 控制面存储：节点、租约、审计（SQLite 落地）。 */
export class ControlStore implements ControlRepository {
  private readonly db: DatabaseSync

  /**
   * @param path - SQLite 文件路径；`:memory:` 用于测试。
   */
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec(SCHEMA)
    // 旧库增量列：租约归属用户（W10.10 跨节点配额计数）。新库已由 SCHEMA 建好。
    const leaseColumns = this.statement<{ name: string }>('PRAGMA table_info(cloud_session_leases)').all()
    if (!leaseColumns.some(column => column.name === 'user_id')) {
      this.db.exec('ALTER TABLE cloud_session_leases ADD COLUMN user_id TEXT')
    }
  }

  /**
   * 取一条读语句，按调用点声明的行形状读取（列由本文件的 schema 固定）。
   * @param sql - 参数化 SQL。
   * @returns 行类型为该查询结果形状的语句。
   */
  private statement<Row extends Record<string, SQLOutputValue>>(sql: string): RowStatement<Row> {
    const statement = this.db.prepare(sql)
    return {
      all: (...parameters) => statement.all(...parameters) as Row[],
      get: (...parameters) => statement.get(...parameters) as Row | undefined,
    }
  }

  /** 关闭数据库句柄。 */
  close(): void {
    this.db.close()
  }

  /**
   * 注册或刷新一个节点的静态信息（重复注册幂等，保留 registeredAt）。
   * @param record - 节点注册信息。
   */
  registerNode(record: Omit<NodeRecord, 'registeredAt' | 'lastHeartbeatAt' | 'state'> & { state?: NodeState }): Promise<void> {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO cloud_nodes (node_id, endpoint, region, labels_json, max_sessions, state, registered_at, last_heartbeat_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        endpoint = excluded.endpoint,
        region = excluded.region,
        labels_json = excluded.labels_json,
        max_sessions = excluded.max_sessions,
        state = excluded.state,
        last_heartbeat_at = excluded.last_heartbeat_at
    `).run(record.nodeId, record.endpoint, record.region, JSON.stringify(record.labels),
      record.maxSessions, record.state ?? 'active', now, now)
    return Promise.resolve()
  }

  /**
   * 记录一次心跳与负载。
   * @param nodeId - 节点标识。
   * @param load - 上报的负载。
   * @param at - 心跳时间。
   * @returns 节点不存在时为 false。
   */
  heartbeat(nodeId: string, load: NodeLoad, at: Date): Promise<boolean> {
    const now = at.toISOString()
    const node = this.db.prepare('UPDATE cloud_nodes SET last_heartbeat_at = ? WHERE node_id = ?').run(now, nodeId)
    if (Number(node.changes) === 0) return Promise.resolve(false)
    this.db.prepare(`
      INSERT INTO cloud_node_load (node_id, active_sessions, cpu_percent, mem_percent, queue_depth, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        active_sessions = excluded.active_sessions,
        cpu_percent = excluded.cpu_percent,
        mem_percent = excluded.mem_percent,
        queue_depth = excluded.queue_depth,
        updated_at = excluded.updated_at
    `).run(nodeId, load.activeSessions, load.cpuPercent ?? null, load.memPercent ?? null, load.queueDepth ?? null, now)
    return Promise.resolve(true)
  }

  /**
   * 切换节点状态（排空/下线）。
   * @param nodeId - 节点标识。
   * @param state - 新状态。
   */
  setNodeState(nodeId: string, state: NodeState): Promise<void> {
    this.db.prepare('UPDATE cloud_nodes SET state = ? WHERE node_id = ?').run(state, nodeId)
    return Promise.resolve()
  }

  /**
   * 全部节点视图（含负载与失联标记）。
   * @param now - 当前时间（判定心跳超时）。
   * @returns 按 nodeId 升序的节点视图。
   */
  listNodes(now: Date): Promise<NodeView[]> {
    const rows = this.statement<NodeRow>(`
      SELECT n.*, l.active_sessions, l.cpu_percent, l.mem_percent, l.queue_depth, l.updated_at
      FROM cloud_nodes n LEFT JOIN cloud_node_load l ON l.node_id = n.node_id
      ORDER BY n.node_id ASC
    `).all()
    const nowMs = now.getTime()
    return Promise.resolve(rows.map((row) => {
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
    }))
  }

  /**
   * 锁内自增节点活跃会话数（放置成功后由节点侧准入确认）。
   * @param nodeId - 节点标识。
   * @param at - 变更时间。
   */
  noteSessionStart(nodeId: string, at: Date): Promise<void> {
    this.db.prepare(`
      UPDATE cloud_node_load SET active_sessions = active_sessions + 1, updated_at = ? WHERE node_id = ?
    `).run(at.toISOString(), nodeId)
    return Promise.resolve()
  }

  /**
   * 会话释放后减少节点活跃会话数（不为负）。
   * @param nodeId - 节点标识。
   * @param at - 变更时间。
   */
  noteSessionEnd(nodeId: string, at: Date): Promise<void> {
    this.db.prepare(`
      UPDATE cloud_node_load SET active_sessions = MAX(active_sessions - 1, 0), updated_at = ? WHERE node_id = ?
    `).run(at.toISOString(), nodeId)
    return Promise.resolve()
  }

  /**
   * 读取会话租约。
   * @param sessionKey - 会话键。
   * @returns 租约或 undefined。
   */
  getLease(sessionKey: string): Promise<SessionLease | undefined> {
    const row = this.statement<LeaseRow>('SELECT * FROM cloud_session_leases WHERE session_key = ?')
      .get(sessionKey)
    return Promise.resolve(row === undefined ? undefined : toLease(row))
  }

  /**
   * 获取（或接管）会话租约。
   *
   * 语义：无租约 → 新建 epoch 1；同持有者 → 视为续约；租约已过期 → CAS 递增 epoch 接管；
   * 租约仍有效 → LEASE_HELD（**不因一次心跳缺失抢占活跃写者**——只有到期才可接管）。
   * @param input - 会话键、节点、持有者、TTL 与可选归属用户。
   * @param now - 当前时间。
   * @returns 结果；`acquired` 表示是否发生了新建/接管（false 表示同持有者续约）。
   */
  async acquireLease(
    input: { sessionKey: string; nodeId: string; holder: string; ttlMs: number; userId?: string },
    now: Date,
  ): Promise<RepositoryLeaseResult> {
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString()
    const nowIso = now.toISOString()
    // 并发首取（两个节点同时冷恢复同一会话）时，双方都可能读到「无租约」再同时插入。
    // 插入用 OR IGNORE：输的一方重读当前租约并按「已被持有」返回，而不是把唯一约束
    // 抛成控制面故障（那会被网关当成上游 500，而不是可重试的 409）。
    // 有界重试：只有「赢家插入后又立刻释放」这一条极窄路径需要重读，不能无限循环。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.getLease(input.sessionKey)
      if (existing === undefined) {
        const inserted = this.db.prepare(`
          INSERT OR IGNORE INTO cloud_session_leases (session_key, node_id, epoch, holder, expires_at, renewed_at, user_id)
          VALUES (?, ?, 1, ?, ?, ?, ?)
        `).run(input.sessionKey, input.nodeId, input.holder, expiresAt, nowIso, input.userId ?? null)
        if (Number(inserted.changes) === 1) {
          this.audit(input.sessionKey, input.nodeId, 1, 'lease-acquired', nowIso, { holder: input.holder })
          return { ok: true, lease: await this.writtenLease(input.sessionKey), acquired: true }
        }
        const raced = await this.getLease(input.sessionKey)
        if (raced === undefined) continue // 赢家插入后立刻释放：重读一次，走正常首取路径。
        return { ok: false, code: 'LEASE_HELD', lease: raced }
      }
      if (existing.holder === input.holder && existing.nodeId === input.nodeId) {
        // 旧租约可能没有归属（跨节点配额上线前取得）：同一持有者续约时补写。
        if (input.userId !== undefined && existing.userId !== input.userId) {
          this.db.prepare('UPDATE cloud_session_leases SET user_id = ? WHERE session_key = ?')
            .run(input.userId, input.sessionKey)
        }
        // 自己名下已过期的租约不能走「续约」（续约要求未到期），否则本节点会永远 LEASE_HELD。
        // 过期但无人接管时重新取得同一代写权：epoch 不变，写围栏语义不受影响。
        if (Date.parse(existing.expiresAt) <= now.getTime()) {
          const refreshed = this.db.prepare(`
            UPDATE cloud_session_leases SET expires_at = ?, renewed_at = ?
            WHERE session_key = ? AND holder = ? AND epoch = ? AND expires_at <= ?
          `).run(expiresAt, nowIso, input.sessionKey, input.holder, existing.epoch, nowIso)
          if (Number(refreshed.changes) !== 1) {
            return { ok: false, code: 'LEASE_HELD', lease: (await this.getLease(input.sessionKey)) ?? existing }
          }
          this.audit(input.sessionKey, input.nodeId, existing.epoch, 'lease-refreshed', nowIso, { holder: input.holder })
          return { ok: true, lease: await this.writtenLease(input.sessionKey), acquired: false }
        }
        const renewed = await this.renewLease(input.sessionKey, input.holder, existing.epoch, input.ttlMs, now)
        if (!renewed) return { ok: false, code: 'LEASE_HELD', lease: existing }
        return { ok: true, lease: await this.writtenLease(input.sessionKey), acquired: false }
      }
      if (Date.parse(existing.expiresAt) > now.getTime()) {
        return { ok: false, code: 'LEASE_HELD', lease: existing }
      }
      const takeover = this.db.prepare(`
        UPDATE cloud_session_leases
        SET node_id = ?, epoch = epoch + 1, holder = ?, expires_at = ?, renewed_at = ?,
            user_id = COALESCE(?, user_id)
        WHERE session_key = ? AND epoch = ? AND expires_at <= ?
      `).run(input.nodeId, input.holder, expiresAt, nowIso, input.userId ?? null, input.sessionKey,
        existing.epoch, nowIso)
      if (Number(takeover.changes) !== 1) {
        return { ok: false, code: 'LEASE_HELD', lease: (await this.getLease(input.sessionKey)) ?? existing }
      }
      const lease = await this.writtenLease(input.sessionKey)
      this.audit(input.sessionKey, input.nodeId, lease.epoch, 'lease-takeover', nowIso,
        { previousHolder: existing.holder, previousEpoch: existing.epoch })
      return { ok: true, lease, acquired: true }
    }
    throw new Error(`soloengine: acquiring the lease for ${input.sessionKey} kept losing to concurrent writers`)
  }

  /**
   * 续约（持有者与 epoch 必须匹配，且租约尚未到期）。
   * @param sessionKey - 会话键。
   * @param holder - 持有者。
   * @param epoch - 写者纪元。
   * @param ttlMs - 新 TTL。
   * @param now - 当前时间。
   * @returns 是否续约成功。
   */
  renewLease(sessionKey: string, holder: string, epoch: number, ttlMs: number, now: Date): Promise<boolean> {
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    const result = this.db.prepare(`
      UPDATE cloud_session_leases SET expires_at = ?, renewed_at = ?
      WHERE session_key = ? AND holder = ? AND epoch = ? AND expires_at > ?
    `).run(expiresAt, now.toISOString(), sessionKey, holder, epoch, now.toISOString())
    return Promise.resolve(Number(result.changes) === 1)
  }

  /**
   * 主动释放租约（持有者与 epoch 必须匹配）。
   * @param sessionKey - 会话键。
   * @param holder - 持有者。
   * @param epoch - 写者纪元。
   * @returns 是否删除。
   */
  releaseLease(sessionKey: string, holder: string, epoch: number): Promise<boolean> {
    const result = this.db.prepare(`
      DELETE FROM cloud_session_leases WHERE session_key = ? AND holder = ? AND epoch = ?
    `).run(sessionKey, holder, epoch)
    if (Number(result.changes) === 1) {
      this.audit(sessionKey, '', epoch, 'lease-released', new Date().toISOString(), { holder })
      return Promise.resolve(true)
    }
    return Promise.resolve(false)
  }

  /**
   * 列出某节点持有的全部租约（故障接管用）。
   * @param nodeId - 节点标识。
   * @returns 租约列表。
   */
  listLeases(nodeId: string): Promise<SessionLease[]> {
    const rows = this.statement<LeaseRow>('SELECT * FROM cloud_session_leases WHERE node_id = ? ORDER BY session_key')
      .all(nodeId)
    return Promise.resolve(rows.map(toLease))
  }

  /**
   * 统计某用户当前持有的未过期租约数（跨节点配额准入的活跃会话口径）。
   * @param userId - 归属用户。
   * @param now - 当前时间（判定过期）。
   * @returns 未过期租约数。
   */
  activeLeaseCount(userId: string, now: Date): Promise<number> {
    const row = this.statement<{ count: number }>(
      'SELECT COUNT(*) AS count FROM cloud_session_leases WHERE user_id = ? AND expires_at > ?',
    ).get(userId, now.toISOString())
    return Promise.resolve(row?.count ?? 0)
  }

  /**
   * 统计当前持有未过期租约的用户数（超卖池公平份额的分母）。
   * @param now - 当前时间（判定过期）。
   * @returns 有活跃租约的用户数。
   */
  activeLeaseUsers(now: Date): Promise<number> {
    const row = this.statement<{ count: number }>(
      'SELECT COUNT(DISTINCT user_id) AS count FROM cloud_session_leases WHERE user_id IS NOT NULL AND expires_at > ?',
    ).get(now.toISOString())
    return Promise.resolve(row?.count ?? 0)
  }

  /**
   * 强制接管一条租约：按期望 epoch 做 CAS，成功则 epoch+1 并改归属。
   * @param input - 会话键、期望 epoch、新节点、新持有者、TTL。
   * @param now - 当前时间。
   * @returns 新租约；CAS 失败时为 undefined。
   */
  async takeoverLease(
    input: { sessionKey: string; expectedEpoch: number; nodeId: string; holder: string; ttlMs: number },
    now: Date,
  ): Promise<SessionLease | undefined> {
    const { nowIso, expiresAt } = leaseTimes(now, input.ttlMs)
    const result = this.db.prepare(`
      UPDATE cloud_session_leases
      SET node_id = ?, epoch = epoch + 1, holder = ?, expires_at = ?, renewed_at = ?
      WHERE session_key = ? AND epoch = ?
    `).run(input.nodeId, input.holder, expiresAt, nowIso, input.sessionKey, input.expectedEpoch)
    return this.settledLease(input.sessionKey, input.nodeId, Number(result.changes), nowIso, 'lease-reclaimed',
      { previousEpoch: input.expectedEpoch, holder: input.holder })
  }

  /**
   * 认领本节点名下的租约（接管后把占位持有者换成真实持有者），不递增 epoch。
   * @param input - 会话键、本节点、新持有者、TTL。
   * @param now - 当前时间。
   * @returns 认领后的租约；租约已归他人或已过期时为 undefined。
   */
  async adoptLease(
    input: { sessionKey: string; nodeId: string; holder: string; ttlMs: number },
    now: Date,
  ): Promise<SessionLease | undefined> {
    const { nowIso, expiresAt } = leaseTimes(now, input.ttlMs)
    const result = this.db.prepare(`
      UPDATE cloud_session_leases SET holder = ?, expires_at = ?, renewed_at = ?
      WHERE session_key = ? AND node_id = ? AND expires_at > ?
    `).run(input.holder, expiresAt, nowIso, input.sessionKey, input.nodeId, nowIso)
    return this.settledLease(input.sessionKey, input.nodeId, Number(result.changes), nowIso, 'lease-adopted',
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
    if (lease !== undefined) this.audit(sessionKey, nodeId, lease.epoch, kind, nowIso, detail)
    return lease
  }

  /**
   * 写围栏：该纪元是否仍是当前写者，且租约未到期。
   * @param sessionKey - 会话键。
   * @param epoch - 待校验的写者纪元。
   * @param now - 当前时间。
   * @returns 通过时为 true；旧写者（被接管/过期）为 false。
   */
  async assertWriter(sessionKey: string, epoch: number, now: Date): Promise<boolean> {
    const lease = await this.getLease(sessionKey)
    return lease !== undefined && lease.epoch === epoch && Date.parse(lease.expiresAt) > now.getTime()
  }

  /**
   * 记录一次放置决策。
   * @param decision - 决策（含候选与耗时）。
   */
  recordPlacement(decision: PlacementDecision): Promise<void> {
    this.db.prepare(`
      INSERT INTO cloud_placement_decisions (session_key, node_id, reason, candidates_json, latency_ms, decided_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(decision.sessionKey, decision.nodeId, decision.reason, JSON.stringify(decision.candidates),
      decision.latencyMs, decision.decidedAt)
    return Promise.resolve()
  }

  /**
   * 记录一次计量上报（`sourceSeq` 存在时按 `(session_key, source_seq)` 去重）。
   * @param report - provider 口径的上报。
   */
  recordUsage(report: UsageReport): Promise<void> {
    this.db.prepare(`
      INSERT INTO cloud_usage_reports (user_id, session_key, source_seq, tokens, reported_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_key, source_seq) DO NOTHING
    `).run(report.userId, report.sessionKey, report.sourceSeq ?? null, report.tokens, report.reportedAt)
    return Promise.resolve()
  }

  /**
   * 读计量聚合（按用户 + 会话折叠）。
   * @param filter - 可选用户过滤。
   * @returns 聚合行。
   */
  usage(filter: { userId?: string } = {}): Promise<UsageAggregate[]> {
    const rows = filter.userId === undefined
      ? this.statement<UsageRow>(`
          SELECT user_id, session_key, SUM(tokens) AS tokens, COUNT(*) AS reports, MAX(reported_at) AS last_reported_at
          FROM cloud_usage_reports GROUP BY user_id, session_key ORDER BY user_id, session_key
        `).all()
      : this.statement<UsageRow>(`
          SELECT user_id, session_key, SUM(tokens) AS tokens, COUNT(*) AS reports, MAX(reported_at) AS last_reported_at
          FROM cloud_usage_reports WHERE user_id = ? GROUP BY user_id, session_key ORDER BY user_id, session_key
        `).all(filter.userId)
    return Promise.resolve(rows.map(row => ({
      userId: row.user_id,
      sessionKey: row.session_key,
      tokens: row.tokens,
      reports: row.reports,
      lastReportedAt: row.last_reported_at,
    })))
  }

  /**
   * 保存会话工作区清单（整份覆盖）。
   * @param sessionKey - 会话键。
   * @param files - 清单条目。
   * @param at - 提交时间。
   */
  putWorkspaceManifest(sessionKey: string, files: readonly WorkspaceFileEntry[], at: Date): Promise<void> {
    this.db.prepare(`
      INSERT INTO cloud_workspace_manifests (session_key, manifest_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        manifest_json = excluded.manifest_json,
        updated_at = excluded.updated_at
    `).run(sessionKey, JSON.stringify(files), at.toISOString())
    return Promise.resolve()
  }

  /**
   * 读会话工作区清单。
   * @param sessionKey - 会话键。
   * @returns 清单条目；从未提交过时为空数组。
   */
  getWorkspaceManifest(sessionKey: string): Promise<WorkspaceFileEntry[]> {
    const row = this.statement<{ manifest_json: string }>('SELECT manifest_json FROM cloud_workspace_manifests WHERE session_key = ?')
      .get(sessionKey)
    if (row === undefined) return Promise.resolve([])
    return Promise.resolve(JSON.parse(row.manifest_json) as WorkspaceFileEntry[])
  }

  /**
   * 读会话审计（事件流）。
   * @param sessionKey - 会话键。
   * @returns 按 seq 升序的事件。
   */
  events(sessionKey: string): Promise<{ kind: string; epoch: number | null; at: string; detail: unknown }[]> {
    const rows = this.statement<{ kind: string; epoch: number | null; at: string; detail_json: string | null }>(`
      SELECT kind, epoch, at, detail_json FROM cloud_session_events WHERE session_key = ? ORDER BY seq ASC
    `).all(sessionKey)
    return Promise.resolve(rows.map((row) => {
      const detail: unknown = row.detail_json === null ? null : JSON.parse(row.detail_json)
      return { kind: row.kind, epoch: row.epoch, at: row.at, detail }
    }))
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

  /** 写一条会话审计事件。 */
  private audit(sessionKey: string, nodeId: string, epoch: number, kind: string, at: string, detail: unknown): void {
    this.db.prepare(`
      INSERT INTO cloud_session_events (session_key, node_id, epoch, kind, at, detail_json) VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionKey, nodeId, epoch, kind, at, JSON.stringify(detail))
  }
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
