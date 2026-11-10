/**
 * 业务库连接端口：14 张归属表的唯一访问面（部署形态可切换）。
 *
 * 依据 `plans/dsec-cloud-agent/04-实施计划.md` W1：
 * - 单机形态由 `SoloDatabase`（`node:sqlite`）实现，行为与改造前一致；
 * - 云形态由独立可选包 `@soloengine/business-db-postgres` 实现（与
 *   `@soloengine/cloud-control-postgres` 同一分层：框架核心零 `pg` 依赖）。
 *
 * 全部方法异步：共享关系库的驱动只有异步 API，连接层把同步 SQLite 也投影到同一签名，
 * 业务模块因此只依赖本端口、不感知引擎。
 *
 * 事务纪律（PRD-12 / 04 W1「禁止跨连接长事务」）：`transaction` 内的语句必须使用回调
 * 传入的 `tx` 句柄，不得使用外层连接——SQLite 以单连接互斥保证隔离，PostgreSQL 以
 * 连接级事务保证隔离。SQLite 适配器在事务体内对外层连接的使用直接抛错（不静默死锁）。
 *
 * @module @soloengine/framework/db/port
 */

/** SQL 绑定值。 */
export type SqlValue = string | number | bigint | null | Uint8Array

/** 查询结果行（列名 → 值）。 */
export type SqlRow = Record<string, unknown>

/** 写语句结果。 */
export interface SqlRunResult {
  /** 受影响行数。 */
  changes: number
  /** 自增主键；无自增列或引擎不回报时为 0。 */
  lastInsertRowid: number | bigint
}

/** 一条预编译语句的异步执行面。 */
export interface BusinessStatement {
  /** 取首行（无行返回 undefined）。 */
  get<T = SqlRow>(...params: SqlValue[]): Promise<T | undefined>
  /** 取全部行。 */
  all<T = SqlRow>(...params: SqlValue[]): Promise<T[]>
  /** 执行写语句。 */
  run(...params: SqlValue[]): Promise<SqlRunResult>
}

/** 表名与行数（`/api/solo/db/tables` 的取证口径）。 */
export interface TableCount {
  name: string
  count: number
}

/**
 * 业务库环境参数（健康检查与测试取证）。
 *
 * SQLite 专属参数（journalMode/synchronous/busyTimeout/tempStore/foreignKeys）在共享
 * 关系库下如实报 `'n/a'` / 0，不伪造等价物。
 */
export interface DatabaseEnvironment {
  /** 引擎标识。 */
  engine: 'sqlite' | 'postgres'
  /** 部署标识：SQLite 为库文件绝对路径；PostgreSQL 为脱敏的 `host:port/database`。 */
  path: string
  /** 日志模式（SQLite 专属）。 */
  journalMode: string
  /** 同步级别（SQLite 专属）。 */
  synchronous: number
  /** 锁等待毫秒（SQLite 专属）。 */
  busyTimeout: number
  /** 临时表位置（SQLite 专属）。 */
  tempStore: number
  /** schema 代际。 */
  userVersion: number
  /** 外键开关（SQLite 专属）。 */
  foreignKeys: number
  /** 已存在的业务表数（应为 14）。 */
  businessTables: number
  /** 缺失的业务表。 */
  missingTables: string[]
}

/**
 * 判定一次写入失败是否为唯一约束冲突（SQLite `UNIQUE constraint failed` / PostgreSQL `23505`）。
 *
 * 事务改为异步后，「先查后插」不再原子；显式会话键的并发创建必须在服务边界把冲突
 * 收敛为 409（04 W1 实施要点 3），而不是以 500 冒泡。
 * @param error - 连接层抛出的错误。
 * @returns 是否为唯一约束冲突。
 */
export function isUniqueViolation(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
  if (code === '23505') return true
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed/i.test(message)
    || /duplicate key value violates unique constraint/i.test(message)
}

/** 业务库连接。 */
export interface BusinessDatabase {
  /** 引擎标识。 */
  readonly engine: 'sqlite' | 'postgres'
  /** 部署标识（与 {@link DatabaseEnvironment.path} 同值）。 */
  readonly path: string
  /**
   * 编译一条语句。
   * @param sql - SQL 文本（占位符一律 `?`，由连接层翻译为引擎方言）。
   * @returns 异步执行面。
   */
  prepare(sql: string): BusinessStatement
  /**
   * 执行一段无结果 SQL（DDL / PRAGMA / 多语句）。
   * @param sql - SQL 文本。
   */
  exec(sql: string): Promise<void>
  /**
   * 在单一连接上执行短事务（抛错即回滚）。
   * @param body - 事务体；语句必须经 `tx` 执行。
   * @returns 事务体返回值。
   */
  transaction<T>(body: (tx: BusinessDatabase) => Promise<T>): Promise<T>
  /** 读取真实环境参数。 */
  environment(): Promise<DatabaseEnvironment>
  /** 列出全部业务表与行数。 */
  tables(): Promise<TableCount[]>
  /** 关闭连接。 */
  close(): Promise<void>
}
