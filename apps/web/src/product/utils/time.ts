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
