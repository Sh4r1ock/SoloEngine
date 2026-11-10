import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckCircleOutlineRegular, IconWarningOutlineRegular } from './icons/index.tsx'
import css from './Toast.module.css'

/** Full-opacity hold before the fade starts, when the owner names none (prototype §5.4: 3.2s). */
const HOLD_MS = 3200
/** Fade duration. Must agree with the stylesheet's toast-fade duration (prototype: 150ms). */
const FADE_MS = 150

/**
 * Transient bottom-center banner: rises in, holds at full opacity, fades out,
 * then reports done so the owner can unmount it. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 * With unchanged holdMs, parent rerenders do not extend the lifetime.
 * Completion calls the latest onDone handler; fully faded actions receive no input.
 * Announced through a polite status region, never an assertive alert.
 *
 * The hold is the owner's to set, because how long a banner has to stay
 * depends on how much there is to read: a one-line limit lands in the default
 * window, while a failure that names what broke does not. One value drives
 * both the unmount timer and the stylesheet's fade delay — the stylesheet
 * reads it as a custom property — so the two can no longer disagree and leave
 * the banner unmounting mid-fade.
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon); ignored
 * under a declared tone, which brings its own glyph.
 * @param props.tone - 'success' renders the circled check; 'error' renders the
 * warning glyph. Both glyphs inherit the banner's ink (prototype §5.4 colors
 * the error toast's `!` like its text, never red). Omitted, the icon seat
 * inherits the banner ink.
 * @param props.actions - optional inline actions continuing the sentence:
 * each renders its plain-text `prefix` (a connective like 或) followed by its
 * localized `label` as blue clickable text, flowing after `text` as one
 * sentence. Each press is the owner's to handle (e.g. undo the reported
 * change, then unmount the toast). The banner surface stays click-through —
 * only the action text takes the pointer.
 * @param props.holdMs - full-opacity hold before the fade; defaults to 3200.
 * @param props.anchor - optional element whose horizontal center the banner
 * follows (e.g. the composer card, so the banner centers over the chat column
 * rather than the whole window); omitted, it centers on the viewport.
 * @param props.role - announcement role: 'alert' (default) keeps the harness's
 * assertive failure announcements; 'status' renders a polite status region for
 * hosts whose design reference requires it (SoloEngine product pages, §5.4).
 * @param props.stacked - render as a static row for a host-owned stacking
 * region instead of a body portal fixed at the viewport (prototype
 * `.toast-region`); the host owns the region's placement and gap.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @returns the floating banner.
 */
export function Toast({ text, icon, tone, anchor, holdMs = HOLD_MS, actions, role = 'alert', stacked = false, onDone }: {
  text: string
  icon?: ReactNode
  tone?: 'success' | 'error'
  anchor?: HTMLElement | null
  holdMs?: number
  actions?: readonly { label: string; prefix?: string; onClick: () => void }[]
  role?: 'alert' | 'status'
  stacked?: boolean
  onDone: () => void
}) {
  const latestOnDone = useRef(onDone)
  useLayoutEffect(() => { latestOnDone.current = onDone }, [onDone])
  useEffect(() => {
    const timer = setTimeout(() => { latestOnDone.current() }, holdMs + FADE_MS)
    return () => { clearTimeout(timer) }
  }, [holdMs])
  // Anchor-centered placement re-measures on window resizes; the banner lives
  // four seconds, so sub-window layout drift within that span stays out of
  // scope.
  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (anchor == null) return
    const measure = (): void => {
      const rect = anchor.getBoundingClientRect()
      setLeft(rect.left + rect.width / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [anchor])
  const banner = (
    <div
      className={stacked ? `${css.toast} ${css.stacked}` : css.toast}
      role={role}
      {...role === 'status' ? { 'aria-live': 'polite' as const } : {}}
      style={{
        ...left === null ? {} : { left },
        '--dsh-toast-hold': `${String(holdMs)}ms`,
      } as CSSProperties}
    >
      {tone === 'success'
        ? <span className={`${css.icon} ${css.success}`} aria-hidden><IconCheckCircleOutlineRegular /></span>
        : tone === 'error'
          ? <span className={`${css.icon} ${css.error}`} aria-hidden><IconWarningOutlineRegular /></span>
          : icon !== undefined && <span className={css.icon} aria-hidden>{icon}</span>}
      <span className={css.text}>
        {text}
        {actions?.map(action => (
          <Fragment key={action.label}>
            {action.prefix}
            <button type="button" className={css.action} onClick={action.onClick}>
              {action.label}
            </button>
          </Fragment>
        ))}
      </span>
    </div>
  )
  return stacked ? banner : createPortal(banner, document.body)
}
