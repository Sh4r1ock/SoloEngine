/**
 * 主题应用：把偏好写进 DOM（colorScheme / data-ds-dark-theme / --dsh-content-font-size）。
 * 偏好值本身经 REST 读写（见 `preferences.ts`），此处只负责落到 DOM。
 */

/** 主题三模式。 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 内容字号下限。 */
export const FONT_SIZE_MIN = 12
/** 内容字号上限。 */
export const FONT_SIZE_MAX = 17
/** 内容字号默认值。 */
export const FONT_SIZE_DEFAULT = 14

let preference: ThemePreference = 'system'
let contentFontSize = FONT_SIZE_DEFAULT
let media: MediaQueryList | null = null
const listeners = new Set<() => void>()

/** 系统深色查询（首次使用时创建）。 */
function systemDark(): MediaQueryList {
  media ??= window.matchMedia('(prefers-color-scheme: dark)')
  return media
}

/** 把当前偏好与字号写进 DOM。 */
function paint(): void {
  const dark = preference === 'dark' || (preference === 'system' && systemDark().matches)
  document.documentElement.style.colorScheme = preference === 'system' ? 'light dark' : preference
  if (dark) document.body.setAttribute('data-ds-dark-theme', '')
  else document.body.removeAttribute('data-ds-dark-theme')
  document.documentElement.style.setProperty('--dsh-content-font-size', `${String(contentFontSize)}px`)
}

/**
 * 应用主题偏好。
 * @param value - 浅色 / 深色 / 跟随系统。
 * @param fontSize - 内容字号（12~17），省略则沿用当前值。
 */
export function applyThemePreference(value: ThemePreference, fontSize?: number): void {
  preference = value
  if (fontSize !== undefined) contentFontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(fontSize)))
  paint()
}

/** 当前主题偏好。 */
export function currentThemePreference(): ThemePreference {
  return preference
}

/** 当前内容字号。 */
export function currentContentFontSize(): number {
  return contentFontSize
}

/** 订阅系统主题变化（仅在「跟随系统」下触发重绘与通知）。 */
export function subscribeSystemTheme(listener: () => void): () => void {
  listeners.add(listener)
  const query = systemDark()
  const onChange = (): void => {
    if (preference !== 'system') return
    paint()
    for (const item of listeners) item()
  }
  query.addEventListener('change', onChange)
  return () => {
    listeners.delete(listener)
    query.removeEventListener('change', onChange)
  }
}
