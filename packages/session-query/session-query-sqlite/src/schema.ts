/** SQLite schema for the disposable session full-text read model. */

import type { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Current derived-index schema version. Incompatible versions reset in place. */
export const SESSION_QUERY_SQLITE_SCHEMA_VERSION = 8

/** SQLite application id protecting unrelated databases from derived resets. */
export const SESSION_QUERY_SQLITE_APPLICATION_ID = 0x44534851

/** 共享 `schema_versions` 里检索组件占用的行（colocated 模式）。 */
export const SESSION_QUERY_SQLITE_COMPONENT = 'session-search'

/** 本组件拥有的派生表（colocated 版本不符时只删这些）。 */
const COLOCATED_DERIVED_TABLES = ['search_state', 'persisted_sessions', 'persisted_docs'] as const

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

const DERIVED_USER_TABLES = new Set([
  'search_state',
  'persisted_sessions',
  'persisted_docs',
  'persisted_docs_data',
  'persisted_docs_idx',
  'persisted_docs_content',
  'persisted_docs_docsize',
  'persisted_docs_config',
])

/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files retain their modes, and errors other than `EEXIST` propagate.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Resolve the index path, create its parent and owner-only file, and open the database.
 * @param path - dedicated derived-index path or `:memory:`.
 * @returns the resolved path and its opened database handle.
 */
async function openDatabaseFile(path: string): Promise<{ actual: string; db: DatabaseSync }> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const { DatabaseSync } = await import('node:sqlite')
  return { actual, db: new DatabaseSync(actual) }
}

/**
 * Open, validate, and initialize persistent and connection-local schemas.
 * @param path - dedicated derived-index path or `:memory:`; missing filesystem paths are created owner-only.
 * @param journalMode - validated SQLite journal mode.
 * @returns initialized database handle owned by the search service.
 */
export async function openSearchDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  const { actual, db } = await openDatabaseFile(path)
  try {
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const userTables = listUserTables(db)
    if (applicationId !== 0 && applicationId !== SESSION_QUERY_SQLITE_APPLICATION_ID) {
      throw new Error(`session-search database at "${actual}" belongs to another application`)
    }
    if (applicationId === 0 && userTables.length > 0) {
      throw new Error(`session-search database at "${actual}" is not an empty or recognized derived index`)
    }
    if (applicationId === SESSION_QUERY_SQLITE_APPLICATION_ID) {
      assertDerivedUserTables(actual, userTables)
      if (version !== SESSION_QUERY_SQLITE_SCHEMA_VERSION) resetDerivedSchema(db, userTables)
    }
    // Apply mutating pragmas only after refusing foreign or canonical files.
    // journalMode is a validated closed union, not caller-controlled SQL.
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    ensurePersistentSchema(db)
    ensureTemporarySchema(db)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

/**
 * Open the derived index **inside a shared business database** (colocated mode).
 *
 * The shared file already owns business tables, so this mode does not write
 * `PRAGMA application_id` / `user_version`; the index version is recorded in a
 * shared `schema_versions` table under {@link SESSION_QUERY_SQLITE_COMPONENT}.
 * A version mismatch drops only this component's derived tables.
 * @param path - shared database file path.
 * @param journalMode - validated SQLite journal mode.
 * @returns initialized database handle owned by the search service.
 */
export async function openColocatedSearchDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  const { db } = await openDatabaseFile(path)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        component TEXT PRIMARY KEY,
        version   INTEGER NOT NULL
      ) STRICT
    `)
    const recorded = db.prepare('SELECT version FROM schema_versions WHERE component = ?')
      .get(SESSION_QUERY_SQLITE_COMPONENT) as { version: number } | undefined
    if (recorded !== undefined && recorded.version !== SESSION_QUERY_SQLITE_SCHEMA_VERSION) {
      for (const name of COLOCATED_DERIVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`)
    }
    ensurePersistentSchema(db, false)
    ensureTemporarySchema(db)
    db.prepare(
      `INSERT INTO schema_versions (component, version) VALUES (?, ?)
       ON CONFLICT (component) DO UPDATE SET version = excluded.version`,
    ).run(SESSION_QUERY_SQLITE_COMPONENT, SESSION_QUERY_SQLITE_SCHEMA_VERSION)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function listUserTables(db: DatabaseSync): string[] {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
  ).all() as Array<{ name: string }>
  return rows.map(row => row.name)
}

function assertDerivedUserTables(path: string, userTables: readonly string[]): void {
  const unknownTables = userTables.filter(name => !DERIVED_USER_TABLES.has(name))
  if (unknownTables.length > 0) {
    throw new Error(
      `session-search database at "${path}" has unrecognized user tables: ${unknownTables.join(', ')}`,
    )
  }
}

function resetDerivedSchema(db: DatabaseSync, userTables: readonly string[]): void {
  for (const name of userTables) {
    db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(name)}`)
  }
  db.exec('PRAGMA user_version = 0')
}

function ensurePersistentSchema(db: DatabaseSync, sign: boolean = true): void {
  if (sign) db.exec(`PRAGMA application_id = ${SESSION_QUERY_SQLITE_APPLICATION_ID}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_state (
      singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
      global_generation INTEGER NOT NULL
    ) STRICT
  `)
  db.exec('INSERT OR IGNORE INTO search_state (singleton, global_generation) VALUES (1, 0)')
  db.exec(`
    CREATE TABLE IF NOT EXISTS persisted_sessions (
      id             TEXT PRIMARY KEY,
      version        INTEGER NOT NULL,
      created_at     INTEGER NOT NULL,
      cwd            TEXT,
      parent_session TEXT,
      seed_length    INTEGER,
      delegation_depth INTEGER,
      agent_preset  TEXT,
      revision       TEXT NOT NULL,
      generation     INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS persisted_docs USING fts5(
      text,
      session_id UNINDEXED,
      seq UNINDEXED,
      type UNINDEXED,
      time UNINDEXED,
      surface UNINDEXED,
      codepoint_length UNINDEXED,
      tokenize = 'unicode61'
    )
  `)
  if (sign) db.exec(`PRAGMA user_version = ${SESSION_QUERY_SQLITE_SCHEMA_VERSION}`)
}

function ensureTemporarySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS live_sessions (
      id             TEXT PRIMARY KEY,
      version        INTEGER NOT NULL,
      created_at     INTEGER NOT NULL,
      cwd            TEXT,
      parent_session TEXT,
      seed_length    INTEGER,
      delegation_depth INTEGER,
      agent_preset  TEXT,
      fingerprint    TEXT NOT NULL,
      persisted      INTEGER NOT NULL CHECK (persisted IN (0, 1)),
      generation     INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS temp.live_docs USING fts5(
      text,
      session_id UNINDEXED,
      seq UNINDEXED,
      type UNINDEXED,
      time UNINDEXED,
      surface UNINDEXED,
      codepoint_length UNINDEXED,
      tokenize = 'unicode61'
    )
  `)
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
