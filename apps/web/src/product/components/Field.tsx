/** 表单字段容器：标签 + 控件 + 提示。 */
import type { ReactNode } from 'react'
import css from '../styles/common.module.css'

/**
 * 渲染一个表单字段。
 * @param props.label - 字段标签（已本地化）。
 * @param props.meta - 标签后的等宽小字（原型 `.field-label__meta`，如「可选」「用逗号分隔」）。
 * @param props.hint - 字段提示。
 * @param props.error - 字段级校验错误；非空时在控件下方就地显示。
 * @param props.children - 控件。
 */
export function Field({ label, meta, hint, error, children }: {
  label: string
  meta?: string
  hint?: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>
        {label}
        {meta !== undefined && <span className={css.fieldMeta}>{meta}</span>}
      </span>
      {children}
      {hint !== undefined && <span className={css.fieldHint}>{hint}</span>}
      {error !== undefined && error !== null && error !== '' && (
        <span className={css.fieldError} role="alert">{error}</span>
      )}
    </label>
  )
}
