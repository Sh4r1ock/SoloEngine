/**
 * 右侧抽屉：460px、0.5px 边框、低对比阴影、底部固定操作（模型编辑 / 工具试运行共用）。
 *
 * 与原生 `Modal` 共享模态层语义（Escape 归属、背景遮罩、焦点返回）；形态差异只是
 * 面板贴在右侧而不是居中。
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutlineRegular, useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import css from '../styles/drawer.module.css'

/**
 * 渲染右侧抽屉。
 * @param props.open - 是否打开。
 * @param props.onClose - 关闭回调（遮罩点击、Escape、关闭按钮）。
 * @param props.title - 标题（同时作为无障碍名）。
 * @param props.description - 可选说明句。
 * @param props.closeLabel - 关闭按钮的无障碍名。
 * @param props.footer - 底部固定操作区。
 * @param props.className - 面板附加类（页面按原型覆盖头部/正文留白与底部按钮尺寸）。
 * @param props.children - 抽屉正文。
 */
export function Drawer({ open, onClose, title, description, closeLabel, footer, className, children }: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  closeLabel: string
  footer?: ReactNode
  className?: string | undefined
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  useModalLayer(panel, open, onClose)

  // 打开时聚焦首个可编辑字段（原型 app.js:515-518 同一规则）；没有可编辑控件时退回面板本身。
  useEffect(() => {
    if (!open) return
    const element = panel.current
    if (element === null) return
    const initial = element.querySelector<HTMLElement>('[data-modal-autofocus]')
      ?? element.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')
      ?? element
    initial.focus()
  }, [open])

  if (!open) return null

  return createPortal((
    <div className={css.root} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={className === undefined ? css.panel : `${css.panel} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className={css.header}>
          <div className={css.headerText}>
            <h2 className={css.title}>{title}</h2>
            {description !== undefined && description !== '' && <p className={css.description}>{description}</p>}
          </div>
          <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>
            <IconCloseOutlineRegular size={14} />
          </button>
        </header>
        <div className={css.body}>{children}</div>
        {footer !== undefined && <footer className={css.footer}>{footer}</footer>}
      </div>
    </div>
  ), document.body)
}
