/**
 * 主题应用：把偏好写进 DOM（colorScheme / data-ds-dark-theme / 字号变量 / theme-color）。
 * 偏好值本身存浏览器 localStorage（见 `preferences.ts` / `browser-preferences.ts`），此处只负责落到 DOM。
 *
 * DOM 写入不复用自写实现，而是复用平台的两个官方通道：
 * - 首屏画布着色：`bootThemeInjections`（ui-theme 的宿主启动注入）产出的 `<style>` 行，
 *   以 `head.prepend` 落盘——先于应用样式表，应用样式一旦加载即接管；
 * - 运行期投影：`ThemePresenter`（ui-layout 的客户端呈现器），由 `apply(snapshot)` 统一写
 *   `html[data-ds-theme-source]`、`body[data-ds-dark-theme]`、三档字号与 `meta[theme-color]`。
 */

import {
  bootThemeInjections,
  DEFAULT_FONT_SIZES,
  FONT_SIZE_MAX as PLATFORM_FONT_SIZE_MAX,
  FONT_SIZE_MIN as PLATFORM_FONT_SIZE_MIN,
} from '@deepseek-ai/dsh-client-ui-theme/src/static.ts'
import { ThemePresenter } from '@deepseek-ai/dsh-client-ui-layout/src/static.ts'
import { CONTRAST_TOKEN_OVERRIDES } from '@soloengine/ui-theme/static'
import { readBrowserPreferences, writeBrowserPreferences } from './browser-preferences.ts'

/** 主题三模式。 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 产品暴露的内容字号下限（需求文档 §12.1 D22：产品只暴露 12~20）。
 * 平台机制上下限（10~22）仍由原生常量承担，这里只做产品范围内的收窄。
 */
export const FONT_SIZE_MIN = Math.max(12, PLATFORM_FONT_SIZE_MIN)
/** 产品暴露的内容字号上限（同上：取原生上限与产品上限的较小者）。 */
export const FONT_SIZE_MAX = Math.min(20, PLATFORM_FONT_SIZE_MAX)
/** 内容字号默认值。 */
export const FONT_SIZE_DEFAULT = 14

/** 平台主题快照（`ThemePresenter.apply` 的入参契约）。 */
type ThemeSnapshot = Parameters<ThemePresenter['apply']>[0]

/** 按配色取对比度校正值（校验真源与运行面板同一份 `CONTRAST_TOKEN_OVERRIDES`）。 */
function contrastTokens(scheme: 'light' | 'dark'): Record<string, string> {
  return Object.fromEntries(
    Object.entries(CONTRAST_TOKEN_OVERRIDES).map(([name, modes]) => [name, modes[scheme]]),
  )
}

/** 产品页可选的两种内置主题（token 只含与运行面板同源的对比度校正）。 */
const THEMES = {
  light: { id: 'light', colorScheme: 'light', tokens: contrastTokens('light') },
  dark: { id: 'dark', colorScheme: 'dark', tokens: contrastTokens('dark') },
} as const

let preference: ThemePreference = 'system'
let contentFontSize = FONT_SIZE_DEFAULT
let revision = 0
let presenter: ThemePresenter | null = null
let bootStyle = false
let media: MediaQueryList | null = null
const listeners = new Set<() => void>()

/** 系统深色查询（首次使用时创建）。 */
function systemDark(): MediaQueryList {
  media ??= window.matchMedia('(prefers-color-scheme: dark)')
  return media
}

/** 偏好解析出的实际配色。 */
function resolvedScheme(): 'light' | 'dark' {
  if (preference === 'system') return systemDark().matches ? 'dark' : 'light'
  return preference
}

/** 组装平台主题快照：只有内容字号可调，代码/终端字号取平台默认。 */
function snapshot(): ThemeSnapshot {
  const scheme = resolvedScheme()
  revision += 1
  return {
    preference,
    fontSizes: { ...DEFAULT_FONT_SIZES, text: contentFontSize },
    fontFamilies: { text: '', code: '', terminal: '' },
    active: THEMES[scheme],
    themes: [THEMES.light, THEMES.dark],
    revision,
  }
}

/**
 * 首屏画布着色：取官方启动注入的 `<style>` 行并前置到 head。
 *
 * 前置而非追加：官方语义是"应用样式加载前的画布底色"，产品样式表一旦生效就由
 * token 接管；追加会把 `body{background-color}` 压在产品样式之后，切主题时底色不再跟随。
 */
function installBootStyle(): void {
  if (bootStyle) return
  bootStyle = true
  const style = bootThemeInjections(preference).find(row => row.kind === 'style')
  if (style?.kind !== 'style') return
  const element = document.createElement('style')
  element.dataset.soloengineBootTheme = ''
  element.textContent = style.text
  document.head.prepend(element)
}

/** 把当前偏好与字号投影到 DOM。 */
function present(): void {
  presenter ??= new ThemePresenter()
  presenter.apply(snapshot())
  cachePreference()
}

/** 把当前偏好写入浏览器偏好存储（存储不可用时静默——只影响下次首屏，不影响正确性）。 */
function cachePreference(): void {
  try {
    const stored = readBrowserPreferences()
    writeBrowserPreferences({
      theme: { preference, fontSize: contentFontSize },
      locale: stored?.locale ?? 'zh',
    })
  } catch {
    // localStorage 被禁用/已满：本次偏好仍作用于当前页面，只是下次首屏回到默认值。
  }
}

// 模块加载即预着色：在 React 首次渲染前把存储偏好落进 DOM，深色用户首屏即是深色。
const storedPreferences = readBrowserPreferences()
if (storedPreferences !== null) {
  applyThemePreference(storedPreferences.theme.preference, storedPreferences.theme.fontSize)
} else {
  installBootStyle()
  present()
}

/**
 * 应用主题偏好。
 * @param value - 浅色 / 深色 / 跟随系统。
 * @param fontSize - 内容字号（12~20），省略则沿用当前值。
 */
export function applyThemePreference(value: ThemePreference, fontSize?: number): void {
  const changed = preference !== value
  preference = value
  if (fontSize !== undefined) contentFontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(fontSize)))
  installBootStyle()
  present()
  if (changed) for (const item of listeners) item()
}

/** 当前主题偏好。 */
export function currentThemePreference(): ThemePreference {
  return preference
}

/**
 * 订阅偏好变化：手动切换（含公开页只落本机）与「跟随系统」下的配色变化都会通知。
 * 多个主题控件共用这一份模块状态，避免各自持有 `useState` 导致按钮标签不同步。
 * @param listener - 偏好变化时调用。
 * @returns 取消订阅函数。
 */
export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 当前内容字号。 */
export function currentContentFontSize(): number {
  return contentFontSize
}

/**
 * 跟随系统：OS 配色变化时重新投影并通知订阅者（原型 `app.js` 的
 * `prefers-color-scheme` 监听）。偏好不是 `system` 时不响应。
 */
systemDark().addEventListener('change', () => {
  if (preference !== 'system') return
  present()
  for (const item of listeners) item()
})
