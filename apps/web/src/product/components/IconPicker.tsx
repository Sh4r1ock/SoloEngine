/**
 * 画布图标选择器（对照 v0.4.0 的 IconSelector 功能：点击图标 → 网格选择 → 写回）。
 *
 * 值就是字形本身，与画布 `icon` 字段同源；选择器内置可搜索的图标集，
 * 不让用户自己去别处找图标再粘贴。
 *
 * 面板经 portal 挂到 `body` 并按触发块位置固定定位：弹窗内的滚动容器会把
 * 行内绝对定位的面板裁掉（「图标显示不全」），portal 让网格始终完整可见，
 * 空间不足时翻到触发块上方，否则按可用高度内部滚动。
 *
 * @module product/components/IconPicker
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n.ts'
import { DEFAULT_CANVAS_ICON, filterIcons } from '../utils/iconLibrary.ts'
import css from '../styles/iconPicker.module.css'

/** 面板期望宽度（与样式表同值；窄视口按视口收窄）。 */
const PANEL_WIDTH = 320
/** 面板与触发块/视口边缘的间距。 */
const PANEL_GAP = 8
/** 面板自身的最小可用高度；低于它时优先换到另一侧。 */
const PANEL_MIN_HEIGHT = 220
/** 面板的最大高度（宽屏下的舒适上限）。 */
const PANEL_MAX_HEIGHT = 420

/** 面板的固定定位结果：`top` 与 `bottom` 互斥。 */
interface PanelPlacement {
  left: number
  width: number
  maxHeight: number
  top?: number
  bottom?: number
}

/**
 * 按触发块位置计算面板落点：优先下方，空间不足且上方更宽裕时翻到上方。
 * @param rect - 触发块的视口矩形。
 * @returns 固定定位所需的坐标与高度上限。
 */
function placePanel(rect: DOMRect): PanelPlacement {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(PANEL_WIDTH, viewportWidth - PANEL_GAP * 2)
  const left = Math.min(
    Math.max(rect.left, PANEL_GAP),
    Math.max(PANEL_GAP, viewportWidth - width - PANEL_GAP),
  )
  const below = viewportHeight - rect.bottom - PANEL_GAP * 2
  const above = rect.top - PANEL_GAP * 2
  const clamp = (available: number): number => Math.min(Math.max(available, PANEL_MIN_HEIGHT), PANEL_MAX_HEIGHT)
  if (below >= PANEL_MIN_HEIGHT || below >= above) {
    return { left, width, top: rect.bottom + PANEL_GAP, maxHeight: clamp(below) }
  }
  return { left, width, bottom: viewportHeight - rect.top + PANEL_GAP, maxHeight: clamp(above) }
}

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
  const [placement, setPlacement] = useState<PanelPlacement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  /**
   * 面板挂载即聚焦搜索框。打开瞬间 `placement` 还是 null（面板尚未渲染），
   * 只依赖 `open` 的 effect 在挂载前就跑了，焦点落不到搜索框。
   */
  const focusSearch = useCallback((node: HTMLInputElement | null): void => {
    node?.focus()
  }, [])

  /** 重新按触发块位置摆放面板（打开、滚动、视口变化都走同一处）。 */
  const reposition = useCallback((): void => {
    const trigger = triggerRef.current
    if (trigger === null) return
    setPlacement(placePanel(trigger.getBoundingClientRect()))
  }, [])

  // 打开时摆位；点击面板与触发块之外或按 Esc 关闭。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) === true) return
      if (panelRef.current?.contains(target) === true) return
      setOpen(false)
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

  // 面板是固定定位：弹窗滚动与视口变化都要重新贴住触发块，否则会脱离位置。
  useLayoutEffect(() => {
    if (!open) return
    reposition()
    const onScroll = (): void => { reposition() }
    window.addEventListener('resize', onScroll)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open, reposition])

  const options = filterIcons(query)

  const panel = placement === null ? null : (
    <div
      ref={panelRef}
      className={css.panel}
      role="dialog"
      aria-label={t('canvases', 'iconPickerTitle')}
      style={{
        left: `${String(placement.left)}px`,
        width: `${String(placement.width)}px`,
        maxHeight: `${String(placement.maxHeight)}px`,
        ...(placement.top === undefined ? {} : { top: `${String(placement.top)}px` }),
        ...(placement.bottom === undefined ? {} : { bottom: `${String(placement.bottom)}px` }),
      }}
    >
      <div className={css.head}>{t('canvases', 'iconPickerTitle')}</div>
      <input
        ref={focusSearch}
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
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={t('canvases', 'iconPickerTrigger')}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          setPlacement(null)
          setQuery('')
          setOpen(previous => !previous)
        }}
      >
        {value.trim() === '' ? DEFAULT_CANVAS_ICON : value.trim()}
      </button>
      {open && panel !== null && createPortal(panel, document.body)}
    </>
  )
}
