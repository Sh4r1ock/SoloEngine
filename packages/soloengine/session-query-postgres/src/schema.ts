/**
 * `search` schema 的可丢弃派生索引结构。
 *
 * 索引可整库重建：版本不符时直接重建表，不做迁移。
 *
 * @module @soloengine/session-query-postgres/schema
 */

import type { Pool } from 'pg'

/** 派生索引结构版本；不一致即重建。 */
export const SESSION_QUERY_POSTGRES_SCHEMA_VERSION = 1

/** 建库串行化锁（多节点并发首启共享同一键）。 */
const SCHEMA_INIT_LOCK = 781031942017

/** 双引号标识符。 */
function quoteIdent(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`
}

/**
 * 建 schema 与表；结构版本不一致时先清空重建。
 * @param pool - 连接池（search_path 已指向目标 schema）。
 * @param schema - schema 名。
 */
export async function openSearchSchema(pool: Pool, schema: string): Promise<void> {
  // 多节点并发首启会同时建 schema/表：IF NOT EXISTS 不是并发安全的（并发 CREATE TABLE
  // 会撞 pg_type_typname_nsp_index），用事务级 advisory lock 串行化整段建库。
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [SCHEMA_INIT_LOCK])
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`)
    await client.query(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      component TEXT PRIMARY KEY,
      version   INTEGER NOT NULL
    )
  `)
    const version = await client.query<{ version: number }>(
      'SELECT version FROM schema_versions WHERE component = $1',
      ['session-query'],
    )
    const stored = version.rows.length === 0 ? undefined : version.rows[0]?.version
    if (stored !== undefined && stored !== SESSION_QUERY_POSTGRES_SCHEMA_VERSION) {
      await client.query('DROP TABLE IF EXISTS docs')
      await client.query('DROP TABLE IF EXISTS sessions')
      await client.query('DROP TABLE IF EXISTS search_state')
      await client.query('DELETE FROM schema_versions WHERE component = $1', ['session-query'])
    }
    await client.query(`
    CREATE TABLE IF NOT EXISTS search_state (
      singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
      global_generation BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id               TEXT PRIMARY KEY,
      version          INTEGER NOT NULL,
      created_at       BIGINT NOT NULL,
      cwd              TEXT,
      parent_session   TEXT,
      seed_length      INTEGER,
      delegation_depth INTEGER,
      agent_preset     TEXT,
      revision         TEXT,
      fingerprint      TEXT,
      live             BOOLEAN NOT NULL,
      persisted        BOOLEAN NOT NULL,
      generation       BIGINT NOT NULL,
      owner            TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS docs (
      session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq              INTEGER NOT NULL,
      type             TEXT NOT NULL,
      time             BIGINT NOT NULL,
      surface          TEXT NOT NULL,
      text             TEXT NOT NULL,
      codepoint_length INTEGER NOT NULL,
      PRIMARY KEY (session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS docs_fts ON docs USING GIN ((to_tsvector('simple', text)));
    INSERT INTO search_state (singleton, global_generation) VALUES (1, 0)
      ON CONFLICT (singleton) DO NOTHING;
  `)
    await client.query(
      `INSERT INTO schema_versions (component, version) VALUES ($1, $2)
     ON CONFLICT (component) DO UPDATE SET version = EXCLUDED.version`,
      ['session-query', SESSION_QUERY_POSTGRES_SCHEMA_VERSION],
    )
    await client.query('COMMIT')
  } catch (error) {
    // 回滚失败只可能是连接已断开；保留原始建库错误作为报告。
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
