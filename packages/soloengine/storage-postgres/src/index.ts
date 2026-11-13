/**
 * `@soloengine/storage-postgres` —— storage hub 的 PostgreSQL 键值后端。
 *
 * 与 `dsh-storage-sqlite` 同契约：一个后端拥有一个介质（本包是 PG 的 `kv` schema），
 * 注册为 backend `postgres`；单元表/记录表与 SQLite 后端同语义（整单元快照 + 逐记录
 * 持久写），可被 `storage-domain` 按 backend 名选路。
 *
 * @module @soloengine/storage-postgres
 */

import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import type { Pool as PoolType } from 'pg'

const require = createRequire(import.meta.url)
const { Pool } = require('pg') as { Pool: typeof import('pg').Pool }

/** 建库串行化锁（多节点并发首启共享同一键）。 */
const SCHEMA_INIT_LOCK = 781031942017

/** Cordis 插件名。 */
export const name = 'soloengine-storage-postgres'
/** 后端注册在 storage hub 上。 */
export const inject = ['storage']

/** 插件配置。 */
export interface Config {
  /** PostgreSQL 连接串。 */
  url: string
  /** 单元表所在 schema；默认 `kv`。 */
  schema?: string
}

/** 双引号标识符。 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/gu, '""')}"`
}

/** 一个已打开的单元。 */
class PostgresKvUnit implements KvUnit {
  private closed = false

  constructor(
    private readonly pool: PoolType,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {}

  /** 读取整单元快照。 */
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    if (this.closed) throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
    const rows = await this.pool.query(
      'SELECT table_name, key, value FROM records WHERE unit = $1 ORDER BY table_name, key',
      [this.descriptor.name],
    )
    const tables: Record<string, Record<string, unknown>> = {}
    for (const table of this.descriptor.tables) tables[table] = {}
    for (const row of rows.rows as { table_name: string; key: string; value: unknown }[]) {
      const bucket = tables[row.table_name] ?? (tables[row.table_name] = {})
      bucket[row.key] = row.value
    }
    const global = await this.pool.query<{ value: unknown }>('SELECT value FROM unit_globals WHERE unit = $1', [this.descriptor.name])
    return { tables, global: global.rows[0]?.value ?? null }
  }

  /** 逐记录 upsert。 */
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    this.assertTable(table)
    await this.pool.query(
      `INSERT INTO records (unit, table_name, key, value) VALUES ($1, $2, $3, $4)
       ON CONFLICT (unit, table_name, key) DO UPDATE SET value = EXCLUDED.value`,
      [this.descriptor.name, table, key, value],
    )
  }

  /** 逐记录删除。 */
  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    this.assertTable(table)
    await this.pool.query(
      'DELETE FROM records WHERE unit = $1 AND table_name = $2 AND key = $3',
      [this.descriptor.name, table, key],
    )
  }

  /** 批量删除（一次往返）；语义与 {@link deleteRecord} 相同。 */
  async deleteRecords(table: string, keys: readonly string[]): Promise<void> {
    this.assertOpen()
    this.assertTable(table)
    if (keys.length === 0) return
    await this.pool.query(
      'DELETE FROM records WHERE unit = $1 AND table_name = $2 AND key = ANY($3::text[])',
      [this.descriptor.name, table, [...keys]],
    )
  }

  /** 把记录移出可读集合、保留字节供取证。 */
  async backupRecord(table: string, key: string): Promise<string> {
    this.assertOpen()
    this.assertTable(table)
    await this.pool.query(
      `WITH moved AS (
         DELETE FROM records WHERE unit = $1 AND table_name = $2 AND key = $3
         RETURNING unit, table_name, key, value
       )
       INSERT INTO records_backup (unit, table_name, key, value)
       SELECT unit, table_name, key, value FROM moved`,
      [this.descriptor.name, table, key],
    )
    return `postgres:${this.descriptor.name}/${table}/${key}`
  }

  /** 写全局单例。 */
  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) {
      throw new StorageError('malformed-medium', `unit '${this.descriptor.name}' does not declare a global slot`)
    }
    await this.pool.query(
      `INSERT INTO unit_globals (unit, value) VALUES ($1, $2)
       ON CONFLICT (unit) DO UPDATE SET value = EXCLUDED.value`,
      [this.descriptor.name, value],
    )
  }

  /** 关闭单元（幂等）。 */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.closed = true
    this.onClose()
    return Promise.resolve()
  }

  private assertOpen(): void {
    if (this.closed) throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
  }

  private assertTable(table: string): void {
    if (!this.descriptor.tables.includes(table)) {
      throw new StorageError('malformed-medium', `table '${table}' is not declared by unit '${this.descriptor.name}'`)
    }
  }
}

/** PostgreSQL 键值后端。 */
export class PostgresStorageBackend implements StorageBackend {
  /** 唯一 facet：键值。 */
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }

  private readonly pool: PoolType
  private readonly ready: Promise<void>
  private readonly units = new Map<string, Promise<PostgresKvUnit>>()
  private closing: Promise<void> | undefined

  /**
   * @param config - 连接串与 schema。
   */
  constructor(config: Config) {
    const schema = config.schema ?? 'kv'
    this.pool = new Pool({
      connectionString: config.url,
      max: 10,
      options: `-c search_path=${schema},public`,
    })
    this.ready = this.initialize(schema)
    this.ready.catch(() => undefined)
  }

  private async initialize(schema: string): Promise<void> {
    // 多节点并发首启会同时建 schema/表：PostgreSQL 的 IF NOT EXISTS 不是并发安全的
    // （并发 CREATE TABLE 会撞 pg_type_typname_nsp_index），用事务级 advisory lock 串行化。
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [SCHEMA_INIT_LOCK])
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`)
      await client.query(`
      CREATE TABLE IF NOT EXISTS units (
        name       TEXT PRIMARY KEY,
        version    INTEGER NOT NULL,
        tables     JSONB NOT NULL,
        has_global BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE IF NOT EXISTS unit_globals (
        unit  TEXT PRIMARY KEY REFERENCES units(name) ON DELETE CASCADE,
        value JSONB
      );
      CREATE TABLE IF NOT EXISTS records (
        unit       TEXT NOT NULL REFERENCES units(name) ON DELETE CASCADE,
        table_name TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      JSONB NOT NULL,
        PRIMARY KEY (unit, table_name, key)
      );
      CREATE TABLE IF NOT EXISTS records_backup (
        unit       TEXT NOT NULL,
        table_name TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      JSONB NOT NULL,
        moved_at   TIMESTAMPTZ NOT NULL DEFAULT now()
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

  private async openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) {
      throw new StorageError('closed', 'postgres storage backend is closed')
    }
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      throw new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`)
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) throw new Error(`kv table name '${table}' violates ${UNIT_NAME_RE}`)
    }
    if (this.units.has(descriptor.name)) {
      throw new Error(`kv unit '${descriptor.name}' is already open`)
    }
    const opening = (async (): Promise<PostgresKvUnit> => {
      await this.ready
      const existing = await this.pool.query<{ version: number }>('SELECT version FROM units WHERE name = $1', [descriptor.name])
      if (existing.rows.length > 0) {
        const version = Number(existing.rows[0]?.version)
        if (version !== descriptor.version) {
          throw new StorageError(
            'version-mismatch',
            `kv unit '${descriptor.name}' is stamped version ${String(version)}, expected ${String(descriptor.version)}`,
          )
        }
      } else {
        await this.pool.query(
          `INSERT INTO units (name, version, tables, has_global) VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (name) DO NOTHING`,
          [descriptor.name, descriptor.version, JSON.stringify(descriptor.tables), descriptor.hasGlobal],
        )
        const stamped = await this.pool.query<{ version: number }>('SELECT version FROM units WHERE name = $1', [descriptor.name])
        const version = Number(stamped.rows[0]?.version)
        if (version !== descriptor.version) {
          throw new StorageError(
            'version-mismatch',
            `kv unit '${descriptor.name}' is stamped version ${String(version)}, expected ${String(descriptor.version)}`,
          )
        }
      }
      return new PostgresKvUnit(this.pool, descriptor, () => { this.units.delete(descriptor.name) })
    })()
    this.units.set(descriptor.name, opening)
    try {
      return await opening
    } catch (error) {
      this.units.delete(descriptor.name)
      throw error
    }
  }

  /** 关闭全部单元与连接池。 */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
    await this.pool.end()
  }
}

/**
 * 注册 PostgreSQL 后端为 `postgres`。disposer 先注销名字，再关闭介质。
 * @param ctx - 插件上下文（必须注入 `storage`）。
 * @param config - 连接串与 schema。
 */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.url !== 'string' || config.url === '') {
    throw new Error('soloengine-storage-postgres: config.url is required')
  }
  const backend = new PostgresStorageBackend(config)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register('postgres', backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'soloengine-storage-postgres.registerBackend')
  ctx.provide(storageBackendServiceKey('postgres'), backend)
}
