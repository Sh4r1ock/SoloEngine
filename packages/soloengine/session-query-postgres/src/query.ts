/**
 * 请求规范化、参数化谓词与结果呈现（PostgreSQL 方言）。
 *
 * 语义与 `@deepseek-ai/dsh-session-query-sqlite` 的 SQLite 实现一致：
 * 查询文本作为**一个字面短语**匹配、过滤器 AND 组合、游标绑定请求指纹与索引代次。
 * 差别只有占位符（`$n`）与全文检索表达式（`phraseto_tsquery`）。
 *
 * @module @soloengine/session-query-postgres/query
 */

import {
  SessionQueryError,
  materializeSessionEventResultFilters,
  materializeSessionResultFilters,
} from '@deepseek-ai/dsh-session-query'
import type {
  SessionAvailability,
  SessionEventMetadataFilter,
  SessionEventResultFilter,
  SessionEventSearchRequest,
  SessionResultFilter,
  SessionSearchCursor,
  SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'

/** 高亮起始标记（与 SQLite 实现同一对非字符，避免与正文冲突）。 */
export const FTS_HIGHLIGHT_START = '\uFDD0'
/** 高亮结束标记。 */
export const FTS_HIGHLIGHT_END = '\uFDD1'

/** 默认页大小。 */
export const SESSION_QUERY_POSTGRES_DEFAULT_LIMIT = 20
/** 最大页大小。 */
export const SESSION_QUERY_POSTGRES_MAX_LIMIT = 100
/** 默认片段长度（Unicode 码点）。 */
export const SESSION_QUERY_POSTGRES_SNIPPET_CHARS = 240

/** 页大小配置。 */
export interface QueryLimits {
  /** 请求未给 limit 时的页大小。 */
  defaultLimit: number
  /** 允许的最大页大小。 */
  maxLimit: number
}

/** 规范化后的跨会话请求。 */
export interface NormalizedSessionRequest {
  query: string
  sessionFilters: readonly SessionResultFilter[]
  eventFilters: readonly SessionEventMetadataFilter[]
  limit: number
  cursor?: SessionSearchCursor
}

/** 规范化后的会话内请求。 */
export interface NormalizedEventRequest {
  sessionId: SessionEventSearchRequest['sessionId']
  query: string
  filters: readonly SessionEventMetadataFilter[]
  limit: number
  cursor?: SessionSearchCursor
}

/** 顺序分配 `$n` 占位符。 */
export class Params {
  /** 已绑定值，顺序即占位符顺序。 */
  readonly values: unknown[] = []

  /**
   * 追加一个绑定值。
   * @param value - 要绑定的值。
   * @returns 该值对应的占位符。
   */
  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

/**
 * 校验并规范化跨会话请求。
 * @param request - 调用方请求。
 * @param limits - 页大小配置。
 * @returns 显式数组与 limit 的规范化请求。
 */
export function normalizeSessionRequest(
  request: SessionSearchRequest,
  limits: QueryLimits,
): NormalizedSessionRequest {
  const sessionFilters = materializeSessionResultFilters(request.sessionFilters ?? [])
  const eventFilters = materializeMetadataFilters(request.eventFilters ?? [])
  const cursor = materializeCursor(request.cursor)
  return {
    query: normalizeQuery(request.query),
    sessionFilters,
    eventFilters,
    limit: normalizeLimit(request.limit, limits),
    ...cursor === undefined ? {} : { cursor },
  }
}

/**
 * 校验并规范化会话内请求。
 * @param request - 调用方请求。
 * @param limits - 页大小配置。
 * @returns 显式过滤器数组与 limit 的规范化请求。
 */
export function normalizeEventRequest(
  request: SessionEventSearchRequest,
  limits: QueryLimits,
): NormalizedEventRequest {
  if (typeof request.sessionId !== 'string') {
    throw new SessionQueryError('session-search session id must be text', 'SESSION_QUERY_INVALID_FILTER')
  }
  const filters = materializeMetadataFilters(request.filters ?? [])
  const cursor = materializeCursor(request.cursor)
  return {
    sessionId: request.sessionId,
    query: normalizeQuery(request.query),
    filters,
    limit: normalizeLimit(request.limit, limits),
    ...cursor === undefined ? {} : { cursor },
  }
}

/**
 * 编译会话元数据谓词（列名取自 `sessions` 别名 `s`）。
 * @param filters - 已校验的 AND 子句。
 * @param params - 占位符分配器。
 * @returns 不含前导 `WHERE` 的 SQL 片段。
 */
export function buildSessionWhere(filters: readonly SessionResultFilter[], params: Params): string {
  const clauses: string[] = []
  for (const filter of filters) {
    switch (filter.kind) {
      case 'id':
        addList(clauses, params, 's.id', filter.values)
        break
      case 'cwd':
        addNullableList(clauses, params, 's.cwd', filter.values)
        break
      case 'created-at':
        addRange(clauses, params, 's.created_at', filter)
        break
      case 'parent':
        addNullableList(clauses, params, 's.parent_session', filter.values)
        break
      case 'availability': {
        const availability = [...new Set(filter.values)]
        if (availability.length === 0) clauses.push('FALSE')
        else if (availability.length === 1) {
          const value = availability[0] as SessionAvailability
          switch (value) {
            case 'live':
              clauses.push('s.live')
              break
            case 'persisted':
              clauses.push('s.persisted')
              break
            default:
              unknownAvailability(value)
          }
        }
        break
      }
      default:
        unknownFilter(filter)
    }
  }
  return clauses.join(' AND ')
}

/**
 * 编译事件元数据谓词（列名取自 `docs` 别名 `d`）。
 * @param filters - 已校验的 AND 子句。
 * @param params - 占位符分配器。
 * @returns 不含前导 `WHERE` 的 SQL 片段。
 */
export function buildEventWhere(filters: readonly SessionEventMetadataFilter[], params: Params): string {
  const clauses: string[] = []
  for (const filter of filters) {
    switch (filter.kind) {
      case 'seq':
        addRange(clauses, params, 'd.seq', filter)
        break
      case 'time':
        addRange(clauses, params, 'd.time', filter)
        break
      case 'type':
        addList(clauses, params, 'd.type', filter.values)
        break
      case 'surface':
        addList(clauses, params, 'd.surface', filter.values)
        break
      default:
        unknownFilter(filter)
    }
  }
  return clauses.join(' AND ')
}

/**
 * 计算某文档里查询短语的非重叠出现次数。
 * @param text - 文档正文。
 * @param query - 已规范化查询。
 * @returns 出现次数；查询为空时为 0。
 */
export function countOccurrences(text: string, query: string): number {
  if (query.length === 0) return 0
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * 用非字符标记标出全部命中位置，供 {@link makeSnippet} 定位。
 * @param text - 文档正文。
 * @param query - 已规范化查询。
 * @returns 带高亮标记的正文。
 */
export function markOccurrences(text: string, query: string): string {
  if (query.length === 0) return text
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const pieces: string[] = []
  let cursor = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    pieces.push(text.slice(cursor, index))
    pieces.push(FTS_HIGHLIGHT_START)
    pieces.push(text.slice(index, index + needle.length))
    pieces.push(FTS_HIGHLIGHT_END)
    cursor = index + needle.length
    index = haystack.indexOf(needle, cursor)
  }
  pieces.push(text.slice(cursor))
  return pieces.join('')
}

/**
 * 生成不超过 `maxChars` 的空白归一化片段。
 * @param markedText - 带高亮标记的正文。
 * @param maxChars - 最大 Unicode 码点数。
 * @returns 有界纯文本片段。
 */
export function makeSnippet(markedText: string, maxChars: number): string {
  const { text: clean, matchStart } = normalizeMarkedText(markedText)
  const characters = Array.from(clean)
  if (characters.length <= maxChars) return clean
  if (maxChars === 1) return '…'
  const matchedIndex = Math.min(matchStart, characters.length - 1)
  let start = Math.max(0, matchedIndex - Math.floor(maxChars / 3))
  const prefix = start > 0 ? '…' : ''
  let suffix = '…'
  let contentLength = maxChars - prefix.length - suffix.length
  if (contentLength < 1) {
    start = matchedIndex
    suffix = ''
    contentLength = maxChars - prefix.length - suffix.length
  } else if (matchedIndex >= start + contentLength) {
    start = matchedIndex - contentLength + 1
  }
  let end = Math.min(characters.length, start + contentLength)
  if (end === characters.length) {
    suffix = ''
    contentLength = maxChars - prefix.length
    start = Math.max(0, end - contentLength)
  }
  end = Math.min(characters.length, start + contentLength)
  return `${prefix}${characters.slice(start, end).join('')}${suffix}`
}

/**
 * 构建游标绑定的稳定请求指纹。
 * @param request - 规范化请求。
 * @returns 确定性 JSON 字符串。
 */
export function requestFingerprint(request: NormalizedSessionRequest | NormalizedEventRequest): string {
  if ('sessionId' in request) {
    return JSON.stringify({
      scope: 'events',
      sessionId: request.sessionId,
      query: request.query,
      filters: canonicalFilters(request.filters),
      limit: request.limit,
    })
  }
  return JSON.stringify({
    scope: 'sessions',
    query: request.query,
    sessionFilters: canonicalFilters(request.sessionFilters),
    eventFilters: canonicalFilters(request.eventFilters),
    limit: request.limit,
  })
}

function normalizeMarkedText(markedText: string): { text: string; matchStart: number } {
  const characters: string[] = []
  let matchStart: number | undefined
  for (const character of markedText) {
    if (character === FTS_HIGHLIGHT_START) {
      matchStart ??= characters.length
      continue
    }
    if (character === FTS_HIGHLIGHT_END) continue
    if (/\s/u.test(character)) {
      if (characters.length > 0 && characters.at(-1) !== ' ') characters.push(' ')
    } else {
      characters.push(character)
    }
  }
  if (characters.at(-1) === ' ') characters.pop()
  return {
    text: characters.join(''),
    matchStart: matchStart ?? 0,
  }
}

function normalizeQuery(value: string): string {
  if (typeof value !== 'string') {
    throw new SessionQueryError('session-search query must be text', 'SESSION_QUERY_INVALID_QUERY')
  }
  const query = value.trim().replace(/\s+/gu, ' ')
  if (query.length === 0) {
    throw new SessionQueryError(
      'session-search query must contain non-whitespace text',
      'SESSION_QUERY_INVALID_QUERY',
    )
  }
  if (query.includes('\0')) {
    throw new SessionQueryError(
      'session-search query must not contain NUL',
      'SESSION_QUERY_INVALID_QUERY',
    )
  }
  return query
}

function materializeCursor(cursor: SessionSearchCursor | undefined): SessionSearchCursor | undefined {
  if (cursor === undefined) return undefined
  if (typeof cursor !== 'string') {
    throw new SessionQueryError('session-search cursor must be text', 'SESSION_QUERY_INVALID_CURSOR')
  }
  return cursor
}

function materializeMetadataFilters(
  filters: readonly SessionEventMetadataFilter[],
): SessionEventMetadataFilter[] {
  const candidates: readonly SessionEventResultFilter[] = filters
  for (const filter of candidates) {
    switch (filter.kind) {
      case 'seq':
      case 'time':
      case 'type':
      case 'surface':
        break
      case 'text':
        throw new SessionQueryError(
          'session-search metadata filters do not accept text clauses',
          'SESSION_QUERY_INVALID_FILTER',
        )
      default:
        unknownFilter(filter)
    }
  }
  return materializeSessionEventResultFilters(filters) as SessionEventMetadataFilter[]
}

function normalizeLimit(value: number | undefined, limits: QueryLimits): number {
  const limit = value ?? limits.defaultLimit
  const maxLimit = Math.min(limits.maxLimit, Number.MAX_SAFE_INTEGER - 1)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new SessionQueryError(
      `session-search limit must be an integer between 1 and ${maxLimit}`,
      'SESSION_QUERY_INVALID_LIMIT',
    )
  }
  return limit
}

function addList(
  clauses: string[],
  params: Params,
  column: string,
  values: readonly (string | number)[],
): void {
  if (values.length === 0) {
    clauses.push('FALSE')
    return
  }
  clauses.push(`${column} IN (${values.map(value => params.add(value)).join(', ')})`)
}

function addNullableList(
  clauses: string[],
  params: Params,
  column: string,
  values: readonly (string | null)[],
): void {
  if (values.length === 0) {
    clauses.push('FALSE')
    return
  }
  const concrete = values.filter((value): value is string => value !== null)
  const parts: string[] = []
  if (concrete.length > 0) {
    parts.push(`${column} IN (${concrete.map(value => params.add(value)).join(', ')})`)
  }
  if (values.includes(null)) parts.push(`${column} IS NULL`)
  clauses.push(`(${parts.join(' OR ')})`)
}

function addRange(
  clauses: string[],
  params: Params,
  column: string,
  range: { from?: number; to?: number },
): void {
  if (range.from !== undefined) clauses.push(`${column} >= ${params.add(range.from)}`)
  if (range.to !== undefined) clauses.push(`${column} <= ${params.add(range.to)}`)
}

function canonicalFilters(
  filters: readonly (SessionResultFilter | SessionEventMetadataFilter)[],
): unknown[] {
  return filters.map((filter) => {
    if ('values' in filter) {
      return { ...filter, values: [...filter.values].sort(compareNullable) }
    }
    return {
      kind: filter.kind,
      from: filter.from ?? null,
      to: filter.to ?? null,
    }
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

function compareNullable(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a.localeCompare(b)
}

function unknownAvailability(value: never): never {
  throw new SessionQueryError(
    `session availability filter contains unknown value "${String(value)}"`,
    'SESSION_QUERY_INVALID_FILTER',
  )
}

function unknownFilter(filter: never): never {
  const kind = (filter as { kind?: unknown }).kind
  throw new SessionQueryError(
    `session filter contains unknown kind ${typeof kind === 'string' ? `"${kind}"` : '(missing)'}`,
    'SESSION_QUERY_INVALID_FILTER',
  )
}
