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
  // 字号变量写在 `body` 上：平台启动注入（`bootThemeInjections`）与运行期 theme-presenter 都写
  // `document.body`，后代元素继承的是 body 的值；写在 `documentElement` 会被 body 的内联值盖住。
  document.body.style.setProperty('--dsh-content-font-size', `${String(contentFontSize)}px`)
  cachePreference()
}

/**
 * 首屏预着色缓存（R15：深色保存态加载不闪浅色）。
 *
 * 偏好的唯一真源是服务端设置（preferences.ts），但它在 `/auth/me` 之后才返回；
 * 若首屏只能按默认值渲染，深色用户每次加载都会先看到一整屏浅色再翻成深色（FOUC）。
 * 这里把**最后一次成功应用的偏好**缓存进 localStorage，仅用于下次会话的首屏预着色：
 * 服务端偏好返回后 `applyThemePreference()` 会立即覆盖它，缓存永远不参与判定真值。
 */
const THEME_CACHE_KEY = 'soloengine.themeCache'

/** 把当前偏好写入首屏预着色缓存（存储不可用时静默——只影响下次首屏，不影响正确性）。 */
function cachePreference(): void {
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ preference, fontSize: contentFontSize }))
  } catch {
    // localStorage 被禁用/已满：预着色降级为默认值，真实偏好仍由服务端承担。
  }
}

// 模块加载即预着色：在 React 首次渲染前把缓存偏好落进 DOM，深色用户首屏即是深色。
try {
  const cached = JSON.parse(window.localStorage.getItem(THEME_CACHE_KEY) ?? 'null') as {
    preference?: unknown
    fontSize?: unknown
  } | null
  if (cached !== null && typeof cached === 'object') {
    const cachedPreference = cached.preference
    const cachedFontSize = cached.fontSize
    applyThemePreference(
      cachedPreference === 'light' || cachedPreference === 'dark' || cachedPreference === 'system'
        ? cachedPreference
        : 'system',
      typeof cachedFontSize === 'number' && Number.isFinite(cachedFontSize) ? cachedFontSize : undefined,
    )
  }
} catch {
  // 缓存损坏：按默认（跟随系统）渲染，服务端偏好返回后纠正。
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
