/**
 * 偏好读写：唯一存储是框架层设置接口（契约 1）。
 * 命名空间 `ui-theme`（{preference, fontSize}）与 `locale`（{preference}）。
 * 版本不匹配（HTTP 409 / SETTINGS_CONFLICT）按错误呈现在界面上，不做静默覆盖。
 */
import { useSyncExternalStore } from 'react'
import { ApiError, request } from './api.ts'
import { describeError } from './api.ts'
import { applyThemePreference, FONT_SIZE_DEFAULT, type ThemePreference } from './theme.ts'
import { getLocale, LOCALE_DEFAULT, setLocale, type Locale } from './i18n.ts'
import type { SettingsEnvelope } from './types.ts'

/** ui-theme 命名空间的值。 */
export interface UiThemeValue {
  preference: ThemePreference
  fontSize: number
}

/** locale 命名空间的值。 */
export interface LocaleValue {
  preference: Locale
}

/** 命名空间名。 */
export const UI_THEME_NAMESPACE = 'ui-theme'
/** 语言命名空间名。 */
export const LOCALE_NAMESPACE = 'locale'

/** 偏好状态。 */
export interface PreferencesState {
  theme: UiThemeValue
  locale: LocaleValue
  themeRevision: number
  localeRevision: number
  /** 最近一次读写失败（null 表示没有错误）。 */
  error: string | null
  /** 是否已从服务端读取过。 */
  loaded: boolean
}

let state: PreferencesState = {
  theme: { preference: 'system', fontSize: FONT_SIZE_DEFAULT },
  locale: { preference: LOCALE_DEFAULT },
  themeRevision: 0,
  localeRevision: 0,
  error: null,
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

/** 读一个命名空间；404（未初始化）返回 null，其它失败抛出。 */
async function readNamespace<T>(namespace: string): Promise<SettingsEnvelope<T> | null> {
  try {
    return await request<SettingsEnvelope<T>>(`/settings/${namespace}`)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/** 写一个命名空间。 */
async function writeNamespace<T>(namespace: string, value: T, revision: number): Promise<SettingsEnvelope<T>> {
  return await request<SettingsEnvelope<T>>(`/settings/${namespace}`, {
    method: 'PUT',
    body: { value, revision },
  })
}

/** 判定偏好值是否为合法 ui-theme 值。 */
function normalizeTheme(value: unknown): UiThemeValue | null {
  if (value === null || typeof value !== 'object') return null
  const raw = value as { preference?: unknown; fontSize?: unknown }
  const preference = raw.preference
  if (preference !== 'light' && preference !== 'dark' && preference !== 'system') return null
  const fontSize = typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize) ? raw.fontSize : FONT_SIZE_DEFAULT
  return { preference, fontSize }
}

/** 判定偏好值是否为合法 locale 值。 */
function normalizeLocale(value: unknown): LocaleValue | null {
  if (value === null || typeof value !== 'object') return null
  const raw = value as { preference?: unknown }
  if (raw.preference !== 'zh' && raw.preference !== 'en') return null
  return { preference: raw.preference }
}

/** 把当前偏好落到 DOM 与 i18n。 */
function applyAll(): void {
  applyThemePreference(state.theme.preference, state.theme.fontSize)
  setLocale(state.locale.preference)
}

/**
 * 从服务端读取偏好并应用。
 * 读取失败不静默：错误写进 state.error 供界面展示。
 */
export async function loadPreferences(): Promise<void> {
  try {
    const [themeEnvelope, localeEnvelope] = await Promise.all([
      readNamespace<UiThemeValue>(UI_THEME_NAMESPACE),
      readNamespace<LocaleValue>(LOCALE_NAMESPACE),
    ])
    const theme = themeEnvelope === null ? state.theme : normalizeTheme(themeEnvelope.value)
    const locale = localeEnvelope === null ? state.locale : normalizeLocale(localeEnvelope.value)
    publish({
      theme: theme ?? state.theme,
      locale: locale ?? state.locale,
      themeRevision: themeEnvelope?.revision ?? state.themeRevision,
      localeRevision: localeEnvelope?.revision ?? state.localeRevision,
      error: themeEnvelope !== null && theme === null ? 'ui-theme settings value is not a valid {preference, fontSize}' : null,
      loaded: true,
    })
    applyAll()
  } catch (error) {
    publish({ ...state, error: describeError(error), loaded: true })
    applyAll()
  }
}

/** 重置偏好（登出时回到默认并清错误）。 */
export function resetPreferences(): void {
  publish({
    theme: { preference: 'system', fontSize: FONT_SIZE_DEFAULT },
    locale: { preference: LOCALE_DEFAULT },
    themeRevision: 0,
    localeRevision: 0,
    error: null,
    loaded: false,
  })
  applyAll()
}

/**
 * 更新外观偏好（主题 + 字号）。
 * @param patch - 待更新字段。
 * @throws ApiError —— 写失败（含 409 冲突）时抛出，调用方负责展示。
 */
export async function updateTheme(patch: Partial<UiThemeValue>): Promise<void> {
  const next: UiThemeValue = { ...state.theme, ...patch }
  const envelope = await writeNamespace<UiThemeValue>(UI_THEME_NAMESPACE, next, state.themeRevision)
  const value = normalizeTheme(envelope.value) ?? next
  publish({ ...state, theme: value, themeRevision: envelope.revision, error: null })
  applyAll()
}

/**
 * 更新语言偏好。
 * @param preference - zh / en。
 * @throws ApiError —— 写失败（含 409 冲突）时抛出。
 */
export async function updateLocalePreference(preference: Locale): Promise<void> {
  const envelope = await writeNamespace<LocaleValue>(LOCALE_NAMESPACE, { preference }, state.localeRevision)
  const value = normalizeLocale(envelope.value) ?? { preference }
  publish({ ...state, locale: value, localeRevision: envelope.revision, error: null })
  applyAll()
}

/** 当前生效语言（与 i18n 保持一致）。 */
export function effectiveLocale(): Locale {
  return getLocale()
}
