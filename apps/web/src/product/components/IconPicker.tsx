/**
 * 画布图标选择器（对照 v0.4.0 的 IconSelector 功能：点击图标 → 网格选择 → 写回）。
 *
 * 值就是字形本身，与画布 `icon` 字段同源；选择器内置可搜索的图标集，
 * 不让用户自己去别处找图标再粘贴。
 *
 * @module product/components/IconPicker
 */
import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n.ts'
import { DEFAULT_CANVAS_ICON, filterIcons } from '../utils/iconLibrary.ts'
import css from '../styles/iconPicker.module.css'

/**
 * 渲染图标选择器。
 * @param props.value - 当前图标（空串表示未选择）。
 * @param props.onChange - 选中回调（传字形）。
 * @param props.disabled - 是否禁用（模板只读等）。
 */
export function IconPicker({ value, onChange, disabled = false }: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // 打开时聚焦搜索框；点击外部或 Esc 关闭（与产品其它浮层一致）。
  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const options = filterIcons(query)

  return (
    <div className={css.root} ref={rootRef}>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('canvases', 'iconPickerTrigger')}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => { setOpen(previous => !previous); setQuery('') }}
      >
        {value.trim() === '' ? DEFAULT_CANVAS_ICON : value.trim()}
      </button>
      {open && (
        <div className={css.panel} role="dialog" aria-label={t('canvases', 'iconPickerTitle')}>
          <div className={css.head}>{t('canvases', 'iconPickerTitle')}</div>
          <input
            ref={searchRef}
            className={css.search}
            type="search"
            value={query}
            placeholder={t('canvases', 'iconPickerSearch')}
            aria-label={t('canvases', 'iconPickerSearch')}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
          {options.length === 0
            ? <p className={css.empty}>{t('canvases', 'iconPickerEmpty')}</p>
            : (
              <div className={css.grid}>
                {options.map(option => (
                  <button
                    key={option.glyph}
                    type="button"
                    className={option.glyph === value.trim() ? `${css.cell} ${css.cellActive}` : css.cell}
                    title={option.keywords}
                    aria-label={option.keywords}
                    onClick={() => {
                      onChange(option.glyph)
                      setOpen(false)
                    }}
                  >
                    {option.glyph}
                  </button>
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  )
}
