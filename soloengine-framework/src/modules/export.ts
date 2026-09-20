/**
 * 会话导出域：把一次会话的**真实**日志文件与归属行导出为清单或 ZIP。
 *
 * - 日志文件真源：`data/dsh-home/sessions/<workspace>/<key>/session.v*.jsonl.zstd`（按 workspace 扫描）；
 * - 归属行真源：业务库 `sessions` 表（该会话一行）与 `events` 表（该会话全部事件行，
 *   按 `(session_id, seq)` 顺序）——只读，不复制运行时会话数据；
 * - ZIP 复用仓库既有 zip 写入实现（`fflate.zipSync`，与技能导出同一条路径），内含日志文件
 *   原始字节 + `sessions.json` + `events.json`；
 * - 会话不属于当前用户一律 `SESSION_NOT_FOUND`（不泄漏存在性）。
 *
 * @module @soloengine/framework/modules/export
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'
import type { FrameworkRuntime } from '../runtime.ts'
import { FrameworkError } from './accounts.ts'
import type { EventLedgerRow } from './sessions.ts'

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

/** 会话导出服务。 */
export class SessionExportService {
  private readonly runtime: FrameworkRuntime

  /**
   * @param runtime - 框架层运行时（会话台账与数据根）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.runtime = runtime
  }

  /** 会话日志根（dsh session-persistence-jsonl 的落点）。 */
  private sessionsRoot(): string {
    return join(this.runtime.dataDir, 'dsh-home', 'sessions')
  }

  /** 归属校验（越权即 SESSION_NOT_FOUND）。 */
  private requireOwned(userId: string, sessionKey: string): void {
    if (sessionKey.includes('/') || sessionKey.includes('\\') || sessionKey.includes('..')) {
      throw new FrameworkError(404, 'SESSION_NOT_FOUND', `session ${sessionKey} not found`)
    }
    this.runtime.runs.session(userId, sessionKey)
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
  private eventRows(sessionId: number): EventLedgerRow[] {
    return this.runtime.db.raw.prepare(
      'SELECT session_id, seq, agent_id, parent_agent_id, parent_message_id, is_deleted FROM events WHERE session_id = ? ORDER BY session_id ASC, seq ASC',
    ).all(sessionId) as unknown as EventLedgerRow[]
  }

  /**
   * 导出清单：真实列举日志文件与归属行行数。
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @returns 清单。
   */
  describe(userId: string, sessionKey: string): SessionExportManifest {
    this.requireOwned(userId, sessionKey)
    const row = this.runtime.runs.ledger.byKey(sessionKey)
    if (row === undefined) {
      throw new FrameworkError(404, 'SESSION_NOT_FOUND', `session ${sessionKey} not found`)
    }
    const files = this.logFiles(sessionKey)
    const bytes = files.reduce((sum, file) => sum + statSync(file.absolute).size, 0)
    const events = this.eventRows(row.id)
    return {
      sessionKey,
      files: files.map(file => file.relative),
      bytes,
      ledger: { sessions: 1, events: events.length },
    }
  }

  /**
   * 真实打包该会话：日志文件原始字节 + `sessions.json` + `events.json`。
   * @param userId - 请求级用户。
   * @param sessionKey - 会话键。
   * @returns ZIP 字节。
   */
  archive(userId: string, sessionKey: string): Uint8Array {
    this.requireOwned(userId, sessionKey)
    const row = this.runtime.runs.ledger.byKey(sessionKey)
    if (row === undefined) {
      throw new FrameworkError(404, 'SESSION_NOT_FOUND', `session ${sessionKey} not found`)
    }
    const encoder = new TextEncoder()
    const tree: Record<string, Uint8Array> = {}
    for (const file of this.logFiles(sessionKey)) {
      tree[`logs/${file.relative}`] = new Uint8Array(readFileSync(file.absolute))
    }
    tree['sessions.json'] = encoder.encode(`${JSON.stringify(row, undefined, 2)}\n`)
    tree['events.json'] = encoder.encode(`${JSON.stringify(this.eventRows(row.id), undefined, 2)}\n`)
    return zipSync(tree, { level: 6 })
  }
}
