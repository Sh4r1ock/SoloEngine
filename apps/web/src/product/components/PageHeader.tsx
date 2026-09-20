/** 页面标题行。 */
import type { ReactNode } from 'react'
import css from '../styles/common.module.css'

/**
 * 渲染页面标题与操作区。
 * @param props.title - 页面标题（已本地化）。
 * @param props.subtitle - 副标题。
 * @param props.actions - 右侧操作节点。
 */
export function PageHeader({ title, subtitle, actions }: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className={css.header}>
      <div className={css.headerText}>
        <h1 className={css.title}>{title}</h1>
        {subtitle !== undefined && <p className={css.subtitle}>{subtitle}</p>}
      </div>
      {actions !== undefined && <div className={css.headerActions}>{actions}</div>}
    </header>
  )
}
