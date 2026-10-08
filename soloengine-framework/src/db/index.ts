/**
 * SoloEngine 业务库连接：单一物理库 data/database/soloengine.db。
 *
 * 依据《SoloEngine 持久化存储完整设计》§2.3 与 PRD-12 FR-STO-002：
 * - `journal_mode=WAL`、`synchronous=NORMAL`、`temp_store=MEMORY`；
 * - `busy_timeout` 协调同库多连接（dsh storage-sqlite / session-query-sqlite 与业务层）；
 * - 禁止跨连接长事务：本模块只暴露短事务（`transaction` 内的语句全部落在同一连接）。
 *
 * @module @soloengine/framework/db
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 业务表清单（13 张：会话归属 2 表 + 资产 11 表）。 */
export const BUSINESS_TABLES = [
  'sessions', 'events',
  'users', 'agentic_flows', 'run_projects', 'llm_configs', 'skills_packages',
  'mcp_servers', 'mcp_stdio_configs', 'mcp_http_configs', 'file_content_blobs',
  'file_changes', 'creator_audit',
] as const

/** 业务库环境参数（读取自真实连接，供健康检查与测试取证）。 */
export interface DatabaseEnvironment {
  path: string
  journalMode: string
  synchronous: number
  busyTimeout: number
  tempStore: number
  userVersion: number
  foreignKeys: number
  businessTables: number
  missingTables: string[]
}

/** 连接参数。 */
export interface DatabaseOptions {
  /** 数据库文件绝对路径。 */
  path: string
  /** 锁等待毫秒（同库多连接协调）。 */
  busyTimeoutMs?: number
}

/** schema.sql 的绝对位置（与 src/db 同级，构建后位于 lib 旁）。 */
function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // 源码运行（src/db/index.ts）与产物运行（lib/db/index.js）两种落点都试。
  for (const candidate of [
    join(here, 'schema.sql'),
    join(here, '..', '..', '..', 'src', 'db', 'schema.sql'),
    join(here, '..', '..', '..', '..', 'src', 'db', 'schema.sql'),
  ]) {
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      continue
    }
  }
  // 兜底：从框架包源码根解析（产物 lib/db/ → ../../../src/db）。
  const fallback = join(here, '..', '..', 'src', 'db', 'schema.sql')
  readFileSync(fallback)
  return fallback
}

/** 业务库句柄包装：单连接、短事务、显式 PRAGMA。 */
export class SoloDatabase {
  /** 底层 node:sqlite 连接（框架层唯一业务连接）。 */
  readonly raw: DatabaseSync
  /** 库文件绝对路径。 */
  readonly path: string
  /** 代际（PRAGMA user_version）。 */
  readonly schemaVersion: number

  /**
   * 打开（或创建）业务库并应用 schema。
   * @param options - 库文件路径与锁等待。
   */
  constructor(options: DatabaseOptions) {
    this.path = options.path
    mkdirSync(dirname(this.path), { recursive: true })
    this.raw = new DatabaseSync(this.path)
    // 环境参数：先设锁等待，再切 WAL（避免并发切换时立即失败）。
    this.raw.exec(`PRAGMA busy_timeout = ${String(options.busyTimeoutMs ?? 5000)}`)
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA synchronous = NORMAL')
    this.raw.exec('PRAGMA temp_store = MEMORY')
    this.raw.exec('PRAGMA foreign_keys = ON')
    this.raw.exec(readFileSync(schemaPath(), 'utf8'))
    this.applyIncrementalColumns()
    this.raw.exec('PRAGMA user_version = 1')
    this.schemaVersion = 1
  }

  /**
   * 增量列迁移（幂等）。
   *
   * `CREATE TABLE IF NOT EXISTS` 不会给**已存在**的表补列，故新增列必须在这里显式补一次，
   * 否则老库升上来会缺列（症状是运行期才炸的 `no such column`）。补列一律 `ADD COLUMN`，
   * 不改已有列、不搬数据（SQLite 的 ADD COLUMN 是元数据操作，不重写表）。
   */
  private applyIncrementalColumns(): void {
    const additions: { table: string; column: string; ddl: string }[] = [
      // PRD-05 FR-MCP-008：单工具启停的停用清单。
      { table: 'mcp_servers', column: 'disabled_tools', ddl: 'disabled_tools TEXT' },
      // PRD-04 FR-SKILL-006：文件备注（JSON map：path → note），存台账不改包。
      { table: 'skills_packages', column: 'notes', ddl: 'notes TEXT' },
    ]
    for (const { table, column, ddl } of additions) {
      const columns = (this.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
        .map(row => row.name)
      if (columns.length === 0) continue // 表还不存在：schema.sql 已按新列建过。
      if (columns.includes(column)) continue
      this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
      console.log(`soloengine: migrated ${table}.${column} (added)`)
    }
  }

  /**
   * 在单一连接上执行短事务（禁止跨连接长事务）。
   * @param body - 事务体，抛错即回滚。
   * @returns 事务体返回值。
   */
  transaction<T>(body: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      const result = body()
      this.raw.exec('COMMIT')
      return result
    } catch (error) {
      this.raw.exec('ROLLBACK')
      throw error
    }
  }

  /** 读取真实环境参数（健康检查与测试取证用）。 */
  environment(): DatabaseEnvironment {
    const pragma = (name: string): number => {
      const row = this.raw.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined
      return Number(row === undefined ? 0 : Object.values(row)[0])
    }
    const text = (name: string): string => {
      const row = this.raw.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined
      return String(row === undefined ? '' : Object.values(row)[0])
    }
    const present = new Set(
      (this.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
        .map(row => row.name),
    )
    return {
      path: this.path,
      journalMode: text('journal_mode'),
      synchronous: pragma('synchronous'),
      busyTimeout: pragma('busy_timeout'),
      tempStore: pragma('temp_store'),
      userVersion: pragma('user_version'),
      foreignKeys: pragma('foreign_keys'),
      businessTables: BUSINESS_TABLES.filter(table => present.has(table)).length,
      missingTables: BUSINESS_TABLES.filter(table => !present.has(table)),
    }
  }

  /** 关闭连接。 */
  close(): void {
    this.raw.close()
  }
}
