/**
 * `@soloengine/business-db-postgres` —— 业务库的 PostgreSQL 形态。
 *
 * 与 `@soloengine/framework` 的 `BusinessDatabase` 端口同签名（本地声明，避免核心包与
 * 可选包形成依赖环）；由框架在 `SOLOENGINE_DATABASE_URL` 存在时按包名动态加载。
 *
 * 方言处理集中在连接层：
 * - `?` 占位符 → `$1..$n`（跳过字符串、标识符与注释）；
 * - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`；
 * - `PRAGMA` 行忽略；
 * - 版本写共享 `schema_versions` 表，不写 `user_version`。
 *
 * @module @soloengine/business-db-postgres
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool as PoolType, PoolClient } from 'pg'

// `pg` 是 CommonJS；在 ESM/tsx 下用 createRequire 取构造函数，避免具名导出探测差异。
const require = createRequire(import.meta.url)
const { Pool } = require('pg') as { Pool: typeof import('pg').Pool }

/** 建库串行化锁（多节点并发首启共享同一键）。 */
const SCHEMA_INIT_LOCK = 781031942017

/** SQL 绑定值。 */
export type SqlValue = string | number | bigint | null | Uint8Array

/** 查询结果行（列名 → 值）。 */
export type SqlRow = Record<string, unknown>

/** 写语句结果。 */
export interface SqlRunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/** 一条预编译语句的异步执行面。 */
export interface BusinessStatement {
  get<T = SqlRow>(...params: SqlValue[]): Promise<T | undefined>
  all<T = SqlRow>(...params: SqlValue[]): Promise<T[]>
  run(...params: SqlValue[]): Promise<SqlRunResult>
}

/** 表名与行数。 */
export interface TableCount {
  name: string
  count: number
}

/** 业务库环境参数。 */
export interface DatabaseEnvironment {
  engine: 'sqlite' | 'postgres'
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

/** 业务库连接。 */
export interface BusinessDatabase {
  readonly engine: 'sqlite' | 'postgres'
  readonly path: string
  prepare(sql: string): BusinessStatement
  exec(sql: string): Promise<void>
  transaction<T>(body: (tx: BusinessDatabase) => Promise<T>): Promise<T>
  environment(): Promise<DatabaseEnvironment>
  tables(): Promise<TableCount[]>
  close(): Promise<void>
}

/** 业务表清单（14 张：会话归属 2 表 + 资产 12 表）。 */
const BUSINESS_TABLES = [
  'sessions', 'events',
  'users', 'user_default_plugins', 'agentic_flows', 'run_projects', 'llm_configs', 'skills_packages',
  'mcp_servers', 'mcp_stdio_configs', 'mcp_http_configs', 'file_content_blobs',
  'file_changes', 'creator_audit',
] as const

/** 连接选项。 */
export interface PgOptions {
  /** 业务表所在 schema；默认 `mgmt`。 */
  schema?: string
  /** 连接池上限；默认 10。 */
  max?: number
}

/** `schema.postgres.sql` 的绝对位置（源码运行与产物运行两种落点都试）。 */
function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [
    join(here, 'schema.postgres.sql'),
    join(here, '..', '..', 'src', 'schema.postgres.sql'),
    join(here, '..', '..', '..', 'src', 'schema.postgres.sql'),
  ]) {
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      continue
    }
  }
  const fallback = join(here, '..', '..', 'src', 'schema.postgres.sql')
  readFileSync(fallback)
  return fallback
}

/** 双引号标识符。 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/gu, '""')}"`
}

/**
 * `?` 占位符 → `$1..$n`，跳过单引号、双引号、行注释与块注释。
 * @param sql - 原始 SQL。
 * @returns PostgreSQL 占位符形式的 SQL。
 */
function toPgPlaceholders(sql: string): string {
  let index = 0
  let out = ''
  let state: 'normal' | 'single' | 'double' | 'line' | 'block' = 'normal'
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] as string
    const next = sql[i + 1]
    if (state === 'normal') {
      if (ch === "'") { state = 'single'; out += ch; continue }
      if (ch === '"') { state = 'double'; out += ch; continue }
      if (ch === '-' && next === '-') { state = 'line'; out += ch + next; i++; continue }
      if (ch === '/' && next === '*') { state = 'block'; out += ch + next; i++; continue }
      if (ch === '?') { index++; out += `$${String(index)}`; continue }
      out += ch
      continue
    }
    if (state === 'single') {
      out += ch
      if (ch === "'") {
        if (next === "'") { out += next; i++ } else state = 'normal'
      }
      continue
    }
    if (state === 'double') {
      out += ch
      if (ch === '"') {
        if (next === '"') { out += next; i++ } else state = 'normal'
      }
      continue
    }
    if (state === 'line') {
      out += ch
      if (ch === '\n') state = 'normal'
      continue
    }
    out += ch
    if (ch === '*' && next === '/') { out += next; i++; state = 'normal' }
  }
  return out
}

/**
 * `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`。
 * @param sql - 原始 SQL。
 * @returns PostgreSQL 可执行的 SQL。
 */
function toPgUpsert(sql: string): string {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/iu.test(sql)) return sql
  const replaced = sql.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b/iu, '$1INSERT INTO')
  return `${replaced.replace(/;\s*$/u, '')} ON CONFLICT DO NOTHING`
}

/**
 * 去掉 `PRAGMA` 行（PostgreSQL 无等价语句）。
 * @param sql - 原始 SQL。
 * @returns 去掉 PRAGMA 行后的 SQL。
 */
function stripPragmas(sql: string): string {
  return sql.split('\n').filter(line => !/^\s*PRAGMA\b/iu.test(line)).join('\n')
}

/** 绑定值转 PostgreSQL 驱动可接受的值。 */
function toPgValue(value: SqlValue): string | number | null | Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'bigint') return value.toString()
  return value
}

/** 脱敏的部署标识。 */
function displayPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port === '' ? '5432' : parsed.port}/${parsed.pathname.replace(/^\//u, '')}`
  } catch {
    return 'postgres'
  }
}

/** 业务库的 PostgreSQL 实现。 */
export class PgBusinessDatabase implements BusinessDatabase {
  /** 引擎标识。 */
  readonly engine = 'postgres' as const
  /** 脱敏部署标识。 */
  readonly path: string
  private readonly pool: PoolType
  private readonly schema: string
  private readonly ready: Promise<void>
  private readonly transactionScope = new AsyncLocalStorage<true>()

  /**
   * @param url - PostgreSQL 连接串。
   * @param schema - 业务表 schema（默认 `mgmt`）。
   * @param max - 连接池上限。
   */
  constructor(url: string, schema = 'mgmt', max = 10) {
    this.path = displayPath(url)
    this.schema = schema
    this.pool = new Pool({
      connectionString: url,
      max,
      options: `-c search_path=${schema},public`,
    })
    this.ready = this.initialize()
  }

  /**
   * 打开并完成建库（schema + 14 表 + 版本行）。
   * @param url - PostgreSQL 连接串。
   * @param options - schema 与连接池上限。
   * @returns 已就绪的连接。
   */
  static async open(url: string, options: PgOptions = {}): Promise<PgBusinessDatabase> {
    const db = new PgBusinessDatabase(url, options.schema ?? 'mgmt', options.max ?? 10)
    await db.ready
    return db
  }

  /** 建 schema、应用 14 表 DDL、写入版本行。 */
  private async initialize(): Promise<void> {
    // 多节点并发首启会同时建 schema/表：IF NOT EXISTS 不是并发安全的（并发 CREATE TABLE
    // 会撞 pg_type_typname_nsp_index），建库段用事务级 advisory lock 串行化；后续 ALTER
    // 取表级锁，可安全并发。
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [SCHEMA_INIT_LOCK])
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(this.schema)}`)
      await client.query(readFileSync(schemaPath(), 'utf8'))
      await client.query('COMMIT')
    } catch (error) {
      // 回滚失败只可能是连接已断开；保留原始建库错误作为报告。
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
    // 旧库升级：毫秒时间戳列曾是 INTEGER（PG 32 位），Date.now() 写入即越界。
    // ALTER 到 BIGINT 幂等；对新库是无操作。
    for (const column of ['created_at', 'duration_ms', 'started_at', 'completed_at', 'updated_at']) {
      await this.pool.query(`ALTER TABLE sessions ALTER COLUMN ${column} TYPE BIGINT`)
    }
    // 旧库升级：能力枚举缓存列与 `tools` 同形态（PRD-05 FR-MCP-003）。
    for (const column of ['resources', 'prompts']) {
      await this.pool.query(`ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS ${column} TEXT`)
    }
    // 旧库升级：最近一次连接测试结论（PRD-05 FR-MCP-002）。
    await this.pool.query('ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS last_test_ok INTEGER')
    for (const column of ['last_test_kind', 'last_tested_at']) {
      await this.pool.query(`ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS ${column} TEXT`)
    }
    // 旧库升级：最近一次连接测试耗时（毫秒，与 SQLite 的增量列同一份语义）。
    await this.pool.query('ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS last_test_ms INTEGER')
    // 旧库升级：令牌版本列（W11.1 / R007，与 SQLite 的增量列同一份语义）。
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0')
    // 旧库升级：stdio 传输超时列（与 SQLite 的增量列同一份语义）。
    await this.pool.query('ALTER TABLE mcp_stdio_configs ADD COLUMN IF NOT EXISTS timeout INTEGER')
    // 旧库升级：传输子表随服务器行级联删除（外键缺失或非 CASCADE 时重建约束）。
    for (const table of ['mcp_stdio_configs', 'mcp_http_configs']) {
      const { rows } = await this.pool.query<{ name: string; delete_rule: string }>(
        `SELECT c.conname AS name, c.confdeltype AS delete_rule
           FROM pg_constraint c
          WHERE c.conrelid = $1::regclass AND c.contype = 'f'`,
        [table],
      )
      const foreign = rows.find(row => row.delete_rule !== 'c')
      if (foreign === undefined) continue
      await this.pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdent(foreign.name)}`)
      await this.pool.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${quoteIdent(foreign.name)}
           FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE`,
      )
    }
    await this.pool.query(
      `INSERT INTO schema_versions (component, version) VALUES ('business', 1)
       ON CONFLICT (component) DO NOTHING`,
    )
  }

  /** 事务体内禁止走外层连接。 */
  private assertNotInTransaction(): void {
    if (this.transactionScope.getStore() === true) {
      throw new Error(
        'soloengine: a statement used the outer connection inside a transaction; use the transaction callback\'s tx handle',
      )
    }
  }

  /**
   * 构造一条语句的执行面。
   * @param sql - SQL 文本（占位符 `?`）。
   * @param client - 事务客户端；省略时走连接池。
   * @returns 异步执行面。
   */
  private statement(sql: string, client?: PoolClient): BusinessStatement {
    const text = toPgUpsert(toPgPlaceholders(sql))
    const run = async <T>(body: (target: PoolType | PoolClient) => Promise<T>): Promise<T> => {
      await this.ready
      if (client === undefined) this.assertNotInTransaction()
      return body(client ?? this.pool)
    }
    return {
      get: <T>(...params: SqlValue[]) => run(async (target) => {
        const result = await target.query(text, params.map(toPgValue))
        return result.rows[0] as T | undefined
      }),
      all: <T>(...params: SqlValue[]) => run(async (target) => {
        const result = await target.query(text, params.map(toPgValue))
        return result.rows as T[]
      }),
      run: (...params: SqlValue[]) => run(async (target) => {
        const result = await target.query(text, params.map(toPgValue))
        return { changes: result.rowCount ?? 0, lastInsertRowid: 0 }
      }),
    }
  }

  /**
   * 编译一条语句。
   * @param sql - SQL 文本（占位符 `?`）。
   * @returns 异步执行面。
   */
  prepare(sql: string): BusinessStatement {
    return this.statement(sql)
  }

  /**
   * 执行一段无结果 SQL（多语句 DDL；PRAGMA 行忽略）。
   * @param sql - SQL 文本。
   */
  async exec(sql: string): Promise<void> {
    await this.ready
    this.assertNotInTransaction()
    const cleaned = stripPragmas(sql)
    if (cleaned.trim() === '') return
    await this.pool.query(cleaned)
  }

  /**
   * 事务体内的事务句柄：使用同一连接，不再经过连接池。
   * @param client - 事务客户端。
   * @returns 事务句柄。
   */
  private txHandle(client: PoolClient): BusinessDatabase {
    return {
      engine: this.engine,
      path: this.path,
      prepare: sql => this.statement(sql, client),
      exec: async (sql) => {
        const cleaned = stripPragmas(sql)
        if (cleaned.trim() !== '') await client.query(cleaned)
      },
      transaction: () => Promise.reject(new Error('soloengine: nested transactions are not supported')),
      environment: () => Promise.reject(new Error('soloengine: environment() is not available inside a transaction')),
      tables: () => Promise.reject(new Error('soloengine: tables() is not available inside a transaction')),
      close: () => Promise.reject(new Error('soloengine: close() is not available inside a transaction')),
    }
  }

  /**
   * 在单一连接上执行短事务（禁止跨连接长事务）。
   * @param body - 事务体，抛错即回滚；语句必须经 `tx` 执行。
   * @returns 事务体返回值。
   */
  async transaction<T>(body: (tx: BusinessDatabase) => Promise<T>): Promise<T> {
    await this.ready
    this.assertNotInTransaction()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await this.transactionScope.run(true, () => body(this.txHandle(client)))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  /** 读取真实环境参数（健康检查与测试取证用）。 */
  async environment(): Promise<DatabaseEnvironment> {
    await this.ready
    this.assertNotInTransaction()
    const version = await this.pool.query<{ version: number }>(
      "SELECT version FROM schema_versions WHERE component = 'business'",
    )
    const present = new Set(
      (await this.pool.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        [this.schema],
      )).rows.map((row: { table_name?: unknown }) => String(row.table_name)),
    )
    return {
      engine: this.engine,
      path: this.path,
      journalMode: 'n/a',
      synchronous: 0,
      busyTimeout: 0,
      tempStore: 0,
      userVersion: version.rows[0]?.version ?? 0,
      foreignKeys: 0,
      businessTables: BUSINESS_TABLES.filter(table => present.has(table)).length,
      missingTables: BUSINESS_TABLES.filter(table => !present.has(table)),
    }
  }

  /** 列出 schema 内全部表与行数。 */
  async tables(): Promise<TableCount[]> {
    await this.ready
    this.assertNotInTransaction()
    const rows = await this.pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [this.schema],
    )
    const counts: TableCount[] = []
    for (const row of rows.rows as { table_name?: unknown }[]) {
      const name = String(row.table_name)
      const count = await this.pool.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM ${quoteIdent(this.schema)}.${quoteIdent(name)}`,
      )
      counts.push({ name, count: count.rows[0]?.c ?? 0 })
    }
    return counts
  }

  /** 关闭连接池。 */
  async close(): Promise<void> {
    await this.pool.end()
  }
}
