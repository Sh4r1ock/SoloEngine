/**
 * 会话导出域：把一次会话的**真实**日志正文与归属行导出为清单或 ZIP。
 *
 * - 日志正文真源：`ctx.sessionPersistence`（SQLite/PG 形态把事件写在业务库；
 *   由 host 在挂载时绑定为 `runtime.sessionLogSource`）。只有未绑定来源时才退回
 *   `data/dsh-home/sessions/<workspace>/<key>/session.v*.jsonl.zstd` 目录扫描；
 * - 归属行真源：业务库 `sessions` 表（该会话一行）与 `events` 表（该会话全部事件行，
 *   按 `(session_id, seq)` 顺序）——只读，不复制运行时会话数据；
 * - ZIP 复用仓库既有 zip 写入实现（`fflate.zipSync`，与技能导出同一条路径），内含
 *   会话日志 JSONL 字节 + `sessions.json` + `events.json`；
 * - 会话不属于当前用户一律 `SESSION_NOT_FOUND`（不泄漏存在性）。
 *
 * @module @soloengine/framework/modules/export
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'
import type { BusinessDatabase } from '../db/port.ts'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'
import type { EventLedgerRow } from './sessions.ts'

/** 持久化日志在清单/ZIP 里的文件名。 */
const PERSISTED_LOG_NAME = 'session.jsonl'

/** 单次 `read` 的页大小（事件条数）。 */
const READ_PAGE_SIZE = 500

/** 会话导出清单。 */
export interface SessionExportManifest {
  sessionKey: string
  files: string[]
  bytes: number
  /** 归属行的真实行数（sessions 恒为 1，events 为该会话全部事件行数）。 */
  ledger: { sessions: number; events: number }
}

/** 会话日志文件的真实位置。 */
interface SessionLogFile {
  absolute: string
  relative: string
}

/** 持久化会话日志的只读句柄（由 `ctx.sessionPersistence` 绑定，结构最小面）。 */
export interface SessionLogReadHandle {
  read(offset: number, limit: number): Promise<{ events: readonly unknown[] }>
  close(): Promise<void>
}

/** 持久化会话日志的只读来源（结构最小面，框架层不直接依赖原生包）。 */
export interface SessionLogSource {
  /** 会话快照；该身份没有持久化日志时返回 `undefined`（导出据此退回目录扫描）。 */
  stat(id: string): Promise<{ eventCount?: number } | undefined>
  open(id: string, access: 'read'): Promise<SessionLogReadHandle>
}

/** 会话导出服务。 */
export class SessionExportService {
  private readonly runtime: FrameworkRuntime
  private readonly db: BusinessDatabase

  /**
   * @param runtime - 框架层运行时（会话台账与数据根）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
    this.db = runtime.db
  }

  /** 会话日志根（dsh session-persistence-jsonl 的落点）。 */
  private sessionsRoot(): string {
    return join(this.runtime.dataDir, 'dsh-home', 'sessions')
  }

  /** 归属校验（越权即 SESSION_NOT_FOUND）。 */
  private async requireOwned(userId: string, sessionKey: string): Promise<void> {
    // 会话键会被拼进日志路径：只拒绝路径分隔符与 `.`/`..` 这两个整段名；
    // 键内部出现 `..`（如 `my..session`）是合法身份，不应误拒。
    if (sessionKey.includes('/') || sessionKey.includes('\\') || sessionKey === '.' || sessionKey === '..') {
      throw new FrameworkError(404, 'SESSION_NOT_FOUND', `session ${sessionKey} not found`)
    }
    await this.runtime.runs.session(userId, sessionKey)
  }

  /** 按 workspace 扫描该会话的真实日志文件。 */
  private logFiles(sessionKey: string): SessionLogFile[] {
    const root = this.sessionsRoot()
    if (!existsSync(root)) return []
    const out: SessionLogFile[] = []
    for (const workspace of readdirSync(root)) {
      const workspaceDir = join(root, workspace)
      if (!statSync(workspaceDir).isDirectory()) continue
      const sessionDir = join(workspaceDir, sessionKey)
      if (!existsSync(sessionDir) || !statSync(sessionDir).isDirectory()) continue
      for (const name of readdirSync(sessionDir)) {
        const absolute = join(sessionDir, name)
        if (!statSync(absolute).isFile()) continue
        out.push({ absolute, relative: relative(root, absolute).replace(/\\/g, '/') })
      }
    }
    return out.sort((left, right) => left.relative.localeCompare(right.relative))
  }

  /** 该会话的事件归属行（按 (session_id, seq) 顺序，全部行）。 */
  private async eventRows(sessionId: number): Promise<EventLedgerRow[]> {
    return await this.db.prepare(
      'SELECT session_id, seq, agent_id, parent_agent_id, parent_message_id, is_deleted FROM events WHERE session_id = ? ORDER BY session_id ASC, seq ASC',
    ).all<EventLedgerRow>(sessionId)
  }

  /**
   * 从持久化来源读取该会话的全部事件正文。
   * @param sessionKey - 会话键（持久化身份即会话键）。
   * @returns 事件数组；未绑定来源或该身份没有持久化日志时返回 `undefined`。
   */
  private async persistedEvents(sessionKey: string): Promise<readonly unknown[] | undefined> {
    const source = this.runtime.sessionLogSource
    if (source === undefined) return undefined
    const snapshot = await source.stat(sessionKey)
    if (snapshot === undefined) return undefined
    const handle = await source.open(sessionKey, 'read')
    try {
      const events: unknown[] = []
      for (;;) {
        const page = await handle.read(events.length, READ_PAGE_SIZE)
        events.push(...page.events)
        if (page.events.length < READ_PAGE_SIZE) break
      }
      return events
    } finally {
      await handle.close()
    }
  }

  /** 把事件数组序列化为 JSONL 字节（一行一条事件）。 */
  private toJsonl(events: readonly unknown[]): Uint8Array {
    return new TextEncoder().encode(events.map(event => `${JSON.stringify(event)}\n`).join(''))
  }

  /**
   * 导出清单：真实列举日志正文与归属行行数。
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @returns 清单。
   */
  async describe(userId: string, sessionKey: string): Promise<SessionExportManifest> {
    await this.requireOwned(userId, sessionKey)
    const row = await this.runtime.runs.ledger.byKey(sessionKey)
    if (row === undefined) {
      throw new FrameworkError(404, 'SESSION_NOT_FOUND', `session ${sessionKey} not found`)
    }
    const events = await this.eventRows(row.id)
    const persisted = await this.persistedEvents(sessionKey)
    if (persisted !== undefined) {
      return {
        sessionKey,
        files: [PERSISTED_LOG_NAME],
        bytes: this.toJsonl(persisted).byteLength,
        ledger: { sessions: 1, events: events.length },
      }
    }
    const files = this.logFiles(sessionKey)
    const bytes = files.reduce((sum, file) => sum + statSync(file.absolute).size, 0)
    return {
      sessionKey,
      files: files.map(file => file.relative),
      bytes,
      ledger: { sessions: 1, events: events.length },
    }
  }

  /**
   * 真实打包该会话：日志正文 + `sessions.json` + `events.json`。
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @returns ZIP 字节。
   */
  async archive(userId: string, sessionKey: string): Promise<Uint8Array> {
    await this.requireOwned(userId, sessionKey)
    const row = await this.runtime.runs.ledger.byKey(sessionKey)
    if (row === undefined) {
      throw new FrameworkError(404, 'SESSION_NOT_FOUND', `session ${sessionKey} not found`)
    }
    const encoder = new TextEncoder()
    const tree: Record<string, Uint8Array> = {}
    const persisted = await this.persistedEvents(sessionKey)
    if (persisted !== undefined) {
      tree[`logs/${PERSISTED_LOG_NAME}`] = this.toJsonl(persisted)
    } else {
      for (const file of this.logFiles(sessionKey)) {
        tree[`logs/${file.relative}`] = new Uint8Array(readFileSync(file.absolute))
      }
    }
    tree['sessions.json'] = encoder.encode(`${JSON.stringify(row, undefined, 2)}\n`)
    tree['events.json'] = encoder.encode(`${JSON.stringify(await this.eventRows(row.id), undefined, 2)}\n`)
    return zipSync(tree, { level: 6 })
  }
}
