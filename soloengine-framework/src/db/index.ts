/**
 * SoloEngine 业务库连接（单机形态）：单一物理库 data/database/soloengine.db。
 *
 * 依据《SoloEngine 持久化存储完整设计》§2.3 与 PRD-12 FR-STO-002：
 * - `journal_mode=WAL`、`synchronous=NORMAL`、`temp_store=MEMORY`；
 * - `busy_timeout` 协调同库多连接（dsh storage-sqlite / session-query-sqlite 与业务层）；
 * - 禁止跨连接长事务：本模块只暴露短事务（`transaction` 内的语句全部落在同一连接）。
 *
 * 本类是 {@link BusinessDatabase} 的单机实现；云形态由独立可选包
 * `@soloengine/business-db-postgres` 提供同签名实现。语句全部经同一连接串行执行：
 * `node:sqlite` 的调用本身同步，但端口签名异步，因此事务期间用互斥锁把整段
 * BEGIN…COMMIT 串起来，并用 AsyncLocalStorage 拒绝「事务体内走外层连接」的误用
 * （那会在共享关系库下丢失原子性，在单机形态下自锁）。
 *
 * @module @soloengine/framework/db
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BusinessDatabase,
  BusinessStatement,
  DatabaseEnvironment,
  SqlRunResult,
  SqlValue,
  TableCount,
} from './port.ts'

export type {
  BusinessDatabase,
  BusinessStatement,
  DatabaseEnvironment,
  SqlRunResult,
  SqlRow,
  SqlValue,
  TableCount,
} from './port.ts'
export { isUniqueViolation } from './port.ts'

/** 业务表清单（14 张：会话归属 2 表 + 资产 12 表）。 */
export const BUSINESS_TABLES = [
  'sessions', 'events',
  'users', 'user_default_plugins', 'agentic_flows', 'run_projects', 'llm_configs', 'skills_packages',
  'mcp_servers', 'mcp_stdio_configs', 'mcp_http_configs', 'file_content_blobs',
  'file_changes', 'creator_audit',
] as const

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
export class SoloDatabase implements BusinessDatabase {
  /** 引擎标识。 */
  readonly engine = 'sqlite' as const
  /** 库文件绝对路径。 */
  readonly path: string
  /** 代际（PRAGMA user_version）。 */
  readonly schemaVersion: number
  /** 底层 node:sqlite 连接（本模块独占）。 */
  private readonly raw: DatabaseSync
  /** 串行化队列：SQLite 单连接，语句与事务不得交错。 */
  private tail: Promise<void> = Promise.resolve()
  /** 事务作用域标记：事务体内禁止使用外层连接。 */
  private readonly transactionScope = new AsyncLocalStorage<true>()

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
    this.applyIncrementalIndexes()
    this.applyChildCascades()
    // 版本写共享 schema_versions 表（不再写 PRAGMA user_version，避免与同库的
    // storage-sqlite 争用同一个 pragma）。
    this.raw.exec("INSERT OR IGNORE INTO schema_versions (component, version) VALUES ('business', 1)")
    this.schemaVersion = Number(
      (this.raw.prepare("SELECT version FROM schema_versions WHERE component = 'business'").get() as { version: number }).version,
    )
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
      // PRD-05 FR-MCP-003：能力枚举缓存（resources / prompts 与 tools 同形态）。
      { table: 'mcp_servers', column: 'resources', ddl: 'resources TEXT' },
      { table: 'mcp_servers', column: 'prompts', ddl: 'prompts TEXT' },
      // PRD-05 FR-MCP-002：最近一次连接测试结论（刷新后仍可见）。
      { table: 'mcp_servers', column: 'last_test_ok', ddl: 'last_test_ok INTEGER' },
      { table: 'mcp_servers', column: 'last_test_kind', ddl: 'last_test_kind TEXT' },
      { table: 'mcp_servers', column: 'last_tested_at', ddl: 'last_tested_at TEXT' },
      // PRD-05 FR-MCP-002：最近一次连接测试耗时（毫秒），列表与详情按「相对时间 · N ms」展示。
      { table: 'mcp_servers', column: 'last_test_ms', ddl: 'last_test_ms INTEGER' },
      // PRD-04 FR-SKILL-006：文件备注（JSON map：path → note），存台账不改包。
      { table: 'skills_packages', column: 'notes', ddl: 'notes TEXT' },
      // W11.1 / R007：超管重置口令后的令牌撤销位（旧库补列，新建库由 schema.sql 建）。
      { table: 'users', column: 'token_version', ddl: 'token_version INTEGER NOT NULL DEFAULT 0' },
      // MCP stdio 传输的连接/请求超时（秒）：与 http 子表同口径，老库补列。
      { table: 'mcp_stdio_configs', column: 'timeout', ddl: 'timeout INTEGER' },
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
   * 增量索引（幂等）。
   *
   * 唯一约束必须在库里、而不只在应用层的 SELECT→INSERT 之间：并发建同名行时
   * 只有数据库能裁决。老库若已有重名行，唯一索引建不起来——这里显式报出并要求人工清理，
   * 但**不阻断启动**（应用层校验仍生效，重名不会继续产生）。
   */
  private applyIncrementalIndexes(): void {
    const indexes: { name: string; ddl: string }[] = [
      // MCP 服务名是模型可见工具前缀，全实例唯一（PRD-05 FR-MCP-002）。
      { name: 'uq_mcp_servers_name', ddl: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_servers_name ON mcp_servers(name)' },
      // 同一用户下技能名唯一：技能目录以技能名分配，重名会让并发导入共用目录。
      { name: 'uq_skills_packages_user_name', ddl: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_packages_user_name ON skills_packages(user_id, name)' },
    ]
    for (const index of indexes) {
      try {
        this.raw.exec(index.ddl)
      } catch (error) {
        console.log(`soloengine: cannot create unique index ${index.name} (duplicate rows present?): ${String(error)}; resolve the duplicates and restart to enforce it`)
      }
    }
  }

  /**
   * 旧库升级：传输子表的外键补 `ON DELETE CASCADE`（SQLite 不能改外键，只能重建表）。
   *
   * 新库由 schema.sql 直接建带级联的子表；这里只处理老库。重建在单个事务里完成，
   * 中断只会回滚。失败不阻断启动：应用层删除仍在同一事务里先删子表，只是少了 DB 兜底。
   */
  private applyChildCascades(): void {
    const tables = [
      {
        name: 'mcp_stdio_configs',
        ddl: `CREATE TABLE mcp_stdio_configs (
  mcp_server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  command       TEXT,
  args          TEXT,
  env           TEXT,
  folder_path   TEXT,
  working_dir   TEXT,
  timeout       INTEGER
)`,
      },
      {
        name: 'mcp_http_configs',
        ddl: `CREATE TABLE mcp_http_configs (
  mcp_server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  url           TEXT,
  headers       TEXT,
  timeout       INTEGER,
  session_id    TEXT
)`,
      },
    ]
    for (const table of tables) {
      const row = this.raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table.name) as { sql?: string } | undefined
      if (row?.sql === undefined || /ON DELETE CASCADE/iu.test(row.sql)) continue
      const legacy = `${table.name}_legacy_cascade`
      this.raw.exec('BEGIN IMMEDIATE')
      try {
        this.raw.exec(`DROP TABLE IF EXISTS ${legacy}`)
        this.raw.exec(table.ddl.replace(`CREATE TABLE ${table.name}`, `CREATE TABLE ${legacy}`))
        this.raw.exec(`INSERT INTO ${legacy} SELECT * FROM ${table.name}`)
        this.raw.exec(`DROP TABLE ${table.name}`)
        this.raw.exec(`ALTER TABLE ${legacy} RENAME TO ${table.name}`)
        this.raw.exec('COMMIT')
        console.log(`soloengine: rebuilt ${table.name} with ON DELETE CASCADE`)
      } catch (error) {
        this.raw.exec('ROLLBACK')
        console.log(`soloengine: rebuilding ${table.name} with ON DELETE CASCADE failed: ${String(error)}`)
      }
    }
  }

  /**
   * 串行执行一段操作（SQLite 单连接，语句之间不得交错）。
   * @param body - 操作体。
   * @returns 操作体返回值。
   */
  private exclusive<T>(body: () => T | Promise<T>): Promise<T> {
    if (this.transactionScope.getStore() === true) {
      return Promise.reject(new Error(
        'soloengine: a statement used the outer connection inside a transaction; use the transaction callback\'s tx handle',
      ))
    }
    const run = this.tail.then(body)
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * 构造一条语句的执行面。
   * @param sql - SQL 文本。
   * @param locked - 是否经过串行化队列（事务体内部传 false）。
   * @returns 异步执行面。
   */
  private statement(sql: string, locked: boolean): BusinessStatement {
    const invoke = <T>(body: (statement: StatementSync) => T): Promise<T> => locked
      ? this.exclusive(() => body(this.raw.prepare(sql)))
      : Promise.resolve().then(() => body(this.raw.prepare(sql)))
    return {
      get: <T>(...params: SqlValue[]) => invoke(statement =>
        statement.get(...params) as T | undefined),
      all: <T>(...params: SqlValue[]) => invoke(statement =>
        statement.all(...params) as T[]),
      run: (...params: SqlValue[]) => invoke(statement =>
        statement.run(...params) as SqlRunResult),
    }
  }

  /**
   * 编译一条语句（经串行化队列）。
   * @param sql - SQL 文本（占位符 `?`）。
   * @returns 异步执行面。
   */
  prepare(sql: string): BusinessStatement {
    return this.statement(sql, true)
  }

  /**
   * 执行一段无结果 SQL。
   * @param sql - SQL 文本。
   */
  async exec(sql: string): Promise<void> {
    await this.exclusive(() => { this.raw.exec(sql) })
  }

  /**
   * 事务体内的事务句柄：不经过串行化队列（队列已被本事务持有）。
   * @returns 无锁连接面。
   */
  private get direct(): BusinessDatabase {
    return {
      engine: this.engine,
      path: this.path,
      prepare: sql => this.statement(sql, false),
      exec: async sql => { this.raw.exec(sql) },
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
  transaction<T>(body: (tx: BusinessDatabase) => Promise<T>): Promise<T> {
    return this.exclusive(() => this.transactionScope.run(true, async () => {
      this.raw.exec('BEGIN IMMEDIATE')
      try {
        const result = await body(this.direct)
        this.raw.exec('COMMIT')
        return result
      } catch (error) {
        // 回滚自身也可能失败（COMMIT 已失败时事务可能已不在）——不能让它的异常盖住原始错误，
        // 否则调用方只看到 "no transaction is active"，真正的失败原因丢失。
        try {
          this.raw.exec('ROLLBACK')
        } catch (rollbackError) {
          throw new Error(
            `soloengine: transaction failed (${error instanceof Error ? error.message : String(error)})`
            + ` and rollback also failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`,
          )
        }
        throw error
      }
    }))
  }

  /** 读取真实环境参数（健康检查与测试取证用）。 */
  environment(): Promise<DatabaseEnvironment> {
    return this.exclusive(() => {
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
        engine: this.engine,
        path: this.path,
        journalMode: text('journal_mode'),
        synchronous: pragma('synchronous'),
        busyTimeout: pragma('busy_timeout'),
        tempStore: pragma('temp_store'),
        userVersion: Number(
          (this.raw.prepare("SELECT version FROM schema_versions WHERE component = 'business'").get() as { version: number }).version,
        ),
        foreignKeys: pragma('foreign_keys'),
        businessTables: BUSINESS_TABLES.filter(table => present.has(table)).length,
        missingTables: BUSINESS_TABLES.filter(table => !present.has(table)),
      }
    })
  }

  /** 列出全部表与行数（含同库的 dsh 机制表，与改造前 `/db/tables` 口径一致）。 */
  tables(): Promise<TableCount[]> {
    return this.exclusive(() => {
      const rows = this.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
      return rows
        .filter(row => !row.name.startsWith('sqlite_'))
        .map(row => ({
          name: row.name,
          count: Number((this.raw.prepare(`SELECT COUNT(*) AS c FROM "${row.name}"`).get() as { c: number }).c),
        }))
    })
  }

  /** 关闭连接。 */
  async close(): Promise<void> {
    await this.exclusive(() => { this.raw.close() })
  }
}

/** 数据库形态：单机 SQLite / 云 PostgreSQL；二选一，不做运行时切换。 */
export type DatabaseForm = 'single' | 'cloud'

/**
 * 解析数据库形态：显式 `SOLOENGINE_DB_FORM`，缺省为单机。
 * @param value - 形态取值；省略时读环境变量。
 * @returns 合法形态。
 * @throws {Error} 取值不是 `single` 或 `cloud`。
 */
export function resolveDatabaseForm(value?: string): DatabaseForm {
  const form = (value ?? process.env.SOLOENGINE_DB_FORM ?? 'single').trim()
  if (form === 'single' || form === 'cloud') return form
  throw new Error(`SOLOENGINE_DB_FORM must be "single" or "cloud", got "${form}"`)
}

/** 业务库选择：形态决定引擎，连接串与路径二选一。 */
export interface BusinessDatabaseOptions extends DatabaseOptions {
  /** 数据库形态；省略时读 `SOLOENGINE_DB_FORM`（缺省 single）。 */
  form?: DatabaseForm
  /** PostgreSQL 连接串；云形态省略时读 `SOLOENGINE_DATABASE_URL`。 */
  url?: string
}

/**
 * 可选 PostgreSQL 后端包的最小契约（在模块边界校验，避免核心包编译期依赖它）。
 */
interface PgBusinessBackend {
  PgBusinessDatabase: { open(url: string): Promise<BusinessDatabase> }
}

/**
 * 校验可选 PostgreSQL 后端包的导出形状。
 * @param value - 动态 import 的未知值。
 * @returns 是否为可用的后端包。
 */
function isPgBusinessBackend(value: unknown): value is PgBusinessBackend {
  if (typeof value !== 'object' || value === null) return false
  const factory: unknown = Reflect.get(value, 'PgBusinessDatabase')
  if (typeof factory !== 'function') return false
  return typeof Reflect.get(factory, 'open') === 'function'
}

/**
 * 打开业务库：形态为 `cloud` 时按包名动态加载可选 PostgreSQL 后端，`single` 时使用单机 SQLite。
 *
 * 核心包不依赖 `pg`；未安装可选包时 fail loud 并给出安装指引（不静默回退 SQLite，
 * 否则云形态会把数据写进节点本地文件）。
 *
 * @param options - SQLite 路径、形态与可选的 PostgreSQL 连接串。
 * @returns 已就绪的业务库连接。
 * @throws {Error} 云形态缺连接串，或单机形态误配了连接串。
 */
export async function openBusinessDatabase(options: BusinessDatabaseOptions): Promise<BusinessDatabase> {
  const form = options.form ?? resolveDatabaseForm()
  const url = options.url ?? process.env.SOLOENGINE_DATABASE_URL
  if (form === 'single') {
    if (url !== undefined && url !== '') {
      throw new Error(
        'SOLOENGINE_DB_FORM is "single" but SOLOENGINE_DATABASE_URL is set; '
        + 'set SOLOENGINE_DB_FORM=cloud for PostgreSQL or unset the connection string',
      )
    }
    return new SoloDatabase({
      path: options.path,
      ...(options.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
    })
  }
  if (url === undefined || url === '') {
    throw new Error('SOLOENGINE_DB_FORM is "cloud" but SOLOENGINE_DATABASE_URL is not set')
  }
  const specifier = '@soloengine/business-db-postgres'
  let loaded: unknown
  try {
    loaded = await import(specifier)
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
    if (code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        'SOLOENGINE_DB_FORM is "cloud" but @soloengine/business-db-postgres is not installed; '
        + 'install that optional package (it owns the `pg` dependency) to use PostgreSQL',
        { cause: error },
      )
    }
    throw error
  }
  if (!isPgBusinessBackend(loaded)) {
    throw new Error(`${specifier} does not export PgBusinessDatabase.open`)
  }
  return loaded.PgBusinessDatabase.open(url)
}
