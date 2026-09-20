/** 表单字段容器：标签 + 控件 + 提示。 */
import type { ReactNode } from 'react'
import css from '../styles/common.module.css'

/**
 * 渲染一个表单字段。
 * @param props.label - 字段标签（已本地化）。
 * @param props.hint - 字段提示。
 * @param props.children - 控件。
 */
export function Field({ label, hint, children }: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{label}</span>
      {children}
      {hint !== undefined && <span className={css.fieldHint}>{hint}</span>}
    </label>
  )
}
