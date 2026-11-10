/**
 * SoloEngine 双方言 DDL 对照门禁（Plan R211）。
 *
 * 单机与云形态共用一份业务模型，但 DDL 分别是 `soloengine-framework/src/db/schema.sql`（SQLite）
 * 与 `packages/soloengine/business-db-postgres/src/schema.postgres.sql`（PostgreSQL）。两份文件
 * 一旦漂移，症状是「单机能跑、云形态某列缺失」——`users.token_version` 就是这样丢掉过一次。
 *
 * 本门禁解析两份 DDL，按表比较列集合、主键与索引列；方言相关的类型/默认值差异不参与比较。
 * 任一不一致即非零退出并逐项列出。
 *
 * 用法：`pnpm run verify-soloengine-ddl`
 *
 * @module scripts/verify-soloengine-ddl
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 解析出的表结构。 */
interface TableShape {
  columns: Set<string>
  primaryKey: string[]
}

/** 解析结果。 */
interface SchemaShape {
  tables: Map<string, TableShape>
  /** 索引名 → 列集合（按列名排序后比较）。 */
  indexes: Map<string, string[]>
}

const SQLITE_PATH = resolve('soloengine-framework/src/db/schema.sql')
const POSTGRES_PATH = resolve('packages/soloengine/business-db-postgres/src/schema.postgres.sql')

/** 去掉 `--` 行注释。 */
function stripComments(source: string): string {
  return source.split(/\r?\n/u).map(line => line.replace(/--.*$/u, '')).join('\n')
}

/** 按顶层逗号切分（括号/引号内的逗号不切）。 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let quote: string | undefined
  for (const char of body) {
    if (quote !== undefined) {
      current += char
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

/** 解析一份 DDL。 */
function parseSchema(source: string, label: string): SchemaShape {
  const shape: SchemaShape = { tables: new Map(), indexes: new Map() }
  const text = stripComments(source)
  for (const match of text.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][\w.]*)\s*\(([\s\S]*?)\)\s*;/gu)) {
    const name = (match[1] as string).split('.').pop() as string
    const columns = new Set<string>()
    const primaryKey: string[] = []
    for (const raw of splitTopLevel(match[2] as string)) {
      const line = raw.trim()
      if (line === '') continue
      const first = /^([A-Za-z_]\w*)/u.exec(line)?.[1] ?? ''
      const upper = line.toUpperCase()
      if (['PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'CONSTRAINT', 'EXCLUDE'].some(word => upper.startsWith(word))) {
        const pk = /PRIMARY\s+KEY\s*\(([^)]*)\)/iu.exec(line)
        if (pk !== null) primaryKey.push(...(pk[1] as string).split(',').map(item => item.trim().split(/\s+/u)[0] as string))
        continue
      }
      if (first === '') continue
      columns.add(first)
      if (/\bPRIMARY\s+KEY\b/iu.test(line)) primaryKey.push(first)
    }
    shape.tables.set(name, { columns, primaryKey: [...new Set(primaryKey)].sort() })
  }
  for (const match of text.matchAll(
    /CREATE(?:\s+UNIQUE)?\s+INDEX(?:\s+IF NOT EXISTS)?\s+([A-Za-z_][\w]*)\s+ON\s+([A-Za-z_][\w.]*)\s*\(([^)]*)\)/gu,
  )) {
    const indexName = match[1] as string
    const columns = (match[3] as string).split(',').map(item => item.trim().split(/\s+/u)[0] as string).sort()
    shape.indexes.set(indexName, columns)
  }
  if (shape.tables.size === 0) throw new Error(`${label}: no CREATE TABLE parsed (schema layout changed?)`)
  return shape
}

/**
 * 比较两份 schema。
 * @param sqlite - SQLite 结构。
 * @param postgres - PostgreSQL 结构。
 * @returns 差异描述（空数组即一致）。
 */
function compare(sqlite: SchemaShape, postgres: SchemaShape): string[] {
  const problems: string[] = []
  for (const [table, shape] of sqlite.tables) {
    const other = postgres.tables.get(table)
    if (other === undefined) {
      problems.push(`table ${table}: present in SQLite, missing in PostgreSQL`)
      continue
    }
    for (const column of shape.columns) {
      if (!other.columns.has(column)) problems.push(`table ${table}.${column}: present in SQLite, missing in PostgreSQL`)
    }
    for (const column of other.columns) {
      if (!shape.columns.has(column)) problems.push(`table ${table}.${column}: present in PostgreSQL, missing in SQLite`)
    }
    const left = shape.primaryKey.join(',')
    const right = other.primaryKey.join(',')
    if (left !== right) problems.push(`table ${table}: primary key [${left}] (SQLite) != [${right}] (PostgreSQL)`)
  }
  for (const table of postgres.tables.keys()) {
    if (!sqlite.tables.has(table)) problems.push(`table ${table}: present in PostgreSQL, missing in SQLite`)
  }
  for (const [name, columns] of sqlite.indexes) {
    const other = postgres.indexes.get(name)
    if (other === undefined) {
      problems.push(`index ${name}: present in SQLite, missing in PostgreSQL`)
      continue
    }
    if (other.join(',') !== columns.join(',')) {
      problems.push(`index ${name}: columns [${columns.join(',')}] (SQLite) != [${other.join(',')}] (PostgreSQL)`)
    }
  }
  for (const name of postgres.indexes.keys()) {
    if (!sqlite.indexes.has(name)) problems.push(`index ${name}: present in PostgreSQL, missing in SQLite`)
  }
  return problems
}

const sqlite = parseSchema(readFileSync(SQLITE_PATH, 'utf8'), SQLITE_PATH)
const postgres = parseSchema(readFileSync(POSTGRES_PATH, 'utf8'), POSTGRES_PATH)
const problems = compare(sqlite, postgres)
if (problems.length > 0) {
  process.stderr.write(`SoloEngine DDL drift between SQLite and PostgreSQL (${String(problems.length)} item(s)):\n`)
  for (const problem of problems) process.stderr.write(`- ${problem}\n`)
  process.exit(1)
}
process.stdout.write(
  `SoloEngine DDL parity: ${String(sqlite.tables.size)} tables / ${String(sqlite.indexes.size)} indexes match across SQLite and PostgreSQL\n`,
)
