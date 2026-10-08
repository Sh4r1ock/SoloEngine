/**
 * 路径/长代号值的统一渲染（手册 §2.8「路径/长代号值」）。
 *
 * 实测缺陷两类：
 * 1. 纯 `overflow-wrap: anywhere` → `market\skills\code-review` 在任意字符处断成 `…code` + `-review`；
 * 2. 仅插 `<wbr/>` → 浏览器仍会优先在连字符处断，`@modelcontextprotocol/server-filesystem`
 *    被拆成 `…server-` + `filesystem`（包名从中间断开）。
 *
 * 因此把每个「分隔符片段」渲染成原子行内盒（`display: inline-block`，见 `.pathSegment`）：
 * 行内盒内部**不可断行**（连字符、下划线一律不让位），断行只可能发生在片段边界，
 * 即 `\` 与 `/` 之后——既保住包名完整，又让长路径自然折行。
 *
 * 边界条件：片段本身长过可用列宽时（窄视口下的表格、280px 卡片），原子盒会撑破容器——
 * 故 `.pathSegment` 带 `max-width: 100%` + `overflow-wrap: anywhere`：**只有装不下时才**
 * 回落到片段内部断行，装得下时仍保持片段完整（手册 §2.8 的「优先分隔符断行」）。
 *
 * @module product/components/PathValue
 */
import { Fragment, type ReactNode } from 'react'
import css from '../styles/common.module.css'

/**
 * 把路径/代号切成「到分隔符为止的原子片段」。
 * @param text - 原始值（可能含 `\` 或 `/`）。
 * @returns 片段数组；无分隔符时返回单元素数组。
 */
export function pathSegments(text: string): string[] {
  return text.split(/(?<=[\\/])/u)
}

/**
 * 渲染路径/代号值。
 * @param text - 原始值。
 * @returns 原子片段序列（含 `<Fragment>` 包装，调用方可直接内联）。
 */
export function renderPath(text: string): ReactNode {
  const parts = pathSegments(text)
  if (parts.length === 1) return text
  return parts.map((part, index) => (
    <Fragment key={`${String(index)}:${part}`}>
      <span className={css.pathSegment ?? ''}>{part}</span>
    </Fragment>
  ))
}

/** 路径值的统一容器（`.mono` 等宽 + hover 呈现完整值）。 */
export function PathValue({ value, className }: { value: string; className?: string }) {
  return (
    <span className={`${css.mono ?? ''} ${className ?? ''}`} title={value}>
      {renderPath(value)}
    </span>
  )
}
