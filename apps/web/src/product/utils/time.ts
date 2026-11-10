/**
 * 时间戳显示的统一口径（样式手册 §三.1「标签值成对」的配套规则）。
 *
 * 实测：画布卡片与设置页把后端返回的 ISO 原文直接显示（`2026-09-22T08:01:33.411Z`），
 * 与运行面板的「9小时」式相对时间并存，同一产品里出现两套时间观感。
 * 这里统一为**本地时区的 `YYYY-MM-DD HH:mm`**：信息量足够（到分钟），无 T/Z 噪音；
 * 秒/毫秒对使用者无意义（审计级精度在会话导出与日志里取）。
 *
 * @param value - 后端时间的 ISO 字符串（null/空/非法一律返回空串，由调用方决定兜底文案）。
 * @returns 本地时间文本；不可解析时返回空串。
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const pad = (input: number): string => String(input).padStart(2, '0')
  return `${String(parsed.getFullYear())}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/**
 * 纪元毫秒时间戳的同一显示口径（运行会话的 `created_at` 是数字，不是 ISO 串）。
 * @param value - 后端返回的 epoch 毫秒（null/非有限值一律返回空串）。
 * @returns 本地时间文本；不可解析时返回空串。
 */
export function formatEpochTimestamp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return formatTimestamp(new Date(value).toISOString())
}

/** 本地日期（`YYYY-MM-DD`，相对时间超过一周后的回退形态）。 */
function formatDate(parsed: Date): string {
  const pad = (input: number): string => String(input).padStart(2, '0')
  return `${String(parsed.getFullYear())}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

/**
 * 只显示本地日期（`YYYY-MM-DD`；原型创建时间列的口径）。
 * @param value - 后端时间的 ISO 字符串（null/空/非法一律返回空串）。
 * @returns 本地日期文本；不可解析时返回空串。
 */
export function formatDateOnly(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatDate(parsed)
}

/** 相对时间的单位；文案由调用方按当前语言词典呈现。 */
export type RelativeTimeUnit = 'justNow' | 'minutes' | 'hours' | 'days' | 'date'

/** 相对时间：单位 + 计数（`date` 时给本地日期）。 */
export interface RelativeTime {
  unit: RelativeTimeUnit
  /** minutes / hours / days 的计数；`justNow` 与 `date` 时为 null。 */
  count: number | null
  /** `date` 时的本地日期（`YYYY-MM-DD`）。 */
  date: string | null
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 画布列表「更新于」的相对时间（原型 canvases.js:66「更新于 12 分钟前」）。
 *
 * 只负责切分单位，不拼文案——语言归 `locales/` 所有。未来时间（时钟偏差）按日期呈现，
 * 不用「刚刚」掩盖不可解释的取值。
 *
 * @param value - 后端时间的 ISO 字符串（null/空/非法一律返回 null）。
 * @param now - 参照时刻（毫秒，便于按固定时刻验证）。
 * @returns 相对时间；不可解析时返回 null。
 */
export function relativeTime(value: string | null | undefined, now: number = Date.now()): RelativeTime | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const elapsed = now - parsed.getTime()
  if (elapsed < 0) return { unit: 'date', count: null, date: formatDate(parsed) }
  if (elapsed < MINUTE_MS) return { unit: 'justNow', count: null, date: null }
  if (elapsed < HOUR_MS) return { unit: 'minutes', count: Math.floor(elapsed / MINUTE_MS), date: null }
  if (elapsed < DAY_MS) return { unit: 'hours', count: Math.floor(elapsed / HOUR_MS), date: null }
  return { unit: 'days', count: Math.floor(elapsed / DAY_MS), date: null }
}
