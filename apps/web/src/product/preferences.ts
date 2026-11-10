/**
 * 偏好读写：唯一存储是浏览器 `localStorage`（键见 `browser-preferences.ts`）。
 *
 * 主题 / 内容字号 / 语言都是**浏览器级**偏好：同一实例的多个账号共用进程与库，
 * 写到服务端设置命名空间会让一个人的外观改动影响所有终端用户；浏览器本地存储让
 * 「整站生效」与「用户/浏览器隔离」同时成立（原型同样用 `localStorage['dsh.*']`）。
 */
import { useSyncExternalStore } from 'react'
import { describeError } from './api.ts'
import { applyThemePreference, FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN, type ThemePreference } from './theme.ts'
import { getLocale, LOCALE_DEFAULT, setLocale, type Locale, type LocaleId } from './i18n.ts'
import { readBrowserPreferences, writeBrowserPreferences } from './browser-preferences.ts'

/** ui-theme 命名空间的值。 */
export interface UiThemeValue {
  preference: ThemePreference
  fontSize: number
}

/** locale 命名空间的值。 */
export interface LocaleValue {
  preference: Locale
}

/** 偏好状态。 */
export interface PreferencesState {
  theme: UiThemeValue
  locale: LocaleValue
  /** 是否已从浏览器存储读取过。 */
  loaded: boolean
}

let state: PreferencesState = {
  theme: { preference: 'system', fontSize: FONT_SIZE_DEFAULT },
  locale: { preference: LOCALE_DEFAULT },
  loaded: false,
}

const listeners = new Set<() => void>()

/** 发布状态变更。 */
function publish(next: PreferencesState): void {
  state = next
  for (const listener of listeners) listener()
}

/** 订阅偏好状态。 */
export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 当前偏好状态。 */
export function preferencesSnapshot(): PreferencesState {
  return state
}

/** React hook：偏好状态。 */
export function usePreferences(): PreferencesState {
  return useSyncExternalStore(subscribePreferences, preferencesSnapshot, preferencesSnapshot)
}

/**
 * 偏好写入失败的展示文案（设置页与侧栏共用，避免同一映射两份副本）。
 * @param failure - `updateTheme` / `updateLocalePreference` 抛出的异常。
 * @returns 当前语言的句子。
 */
export function preferenceFailureText(failure: unknown): string {
  return describeError(failure)
}

/** 把字号收窄到产品暴露区间（12~20）。 */
function clampFontSize(value: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

/** 把当前偏好落到 DOM 与 i18n。 */
function applyAll(): void {
  applyThemePreference(state.theme.preference, state.theme.fontSize)
  setLocale(state.locale.preference)
}

/**
 * 从浏览器存储读取偏好并应用。
 * 键缺失或损坏时沿用默认值（不静默报错：默认值就是「跟随系统 / 中文 / 14px」）。
 */
export function loadPreferences(): void {
  const stored = readBrowserPreferences()
  if (stored === null) {
    publish({ ...state, loaded: true })
    applyAll()
    return
  }
  const preference = stored.theme.preference
  const locale: Locale = stored.locale === 'en' ? 'en' : 'zh'
  publish({
    theme: { preference, fontSize: clampFontSize(stored.theme.fontSize) },
    locale: { preference: locale },
    loaded: true,
  })
  applyAll()
}

/**
 * 登出后重新读取浏览器偏好（偏好属于浏览器，不随账号清除）。
 * 登录页沿用同一份语言/主题，避免英文用户回到登录页时被重置为中文浅色。
 */
export function resetPreferences(): void {
  loadPreferences()
}

/**
 * 更新外观偏好（主题 + 字号）。
 * @param patch - 待更新字段。
 * @throws 浏览器存储不可用（配额/隐私模式）时抛出，调用方负责展示。
 */
export function updateTheme(patch: Partial<UiThemeValue>): void {
  const next: UiThemeValue = {
    preference: patch.preference ?? state.theme.preference,
    fontSize: clampFontSize(patch.fontSize ?? state.theme.fontSize),
  }
  writeBrowserPreferences({
    theme: next,
    locale: state.locale.preference,
  })
  publish({ ...state, theme: next })
  applyAll()
}

/**
 * 更新语言偏好。
 * @param preference - zh / en。
 * @throws 浏览器存储不可用（配额/隐私模式）时抛出。
 */
export function updateLocalePreference(preference: Locale): void {
  writeBrowserPreferences({
    theme: state.theme,
    locale: preference,
  })
  publish({ ...state, locale: { preference } })
  applyAll()
}

/** 当前生效语言（与 i18n 保持一致；可能是注册表里新增的非内置语言）。 */
export function effectiveLocale(): LocaleId {
  return getLocale()
}
