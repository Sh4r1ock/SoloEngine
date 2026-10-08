/**
 * 偏好读写：唯一存储是框架层设置接口（契约 1）。
 * 命名空间 `ui-theme`（{preference, fontSize}）与 `locale`（{preference}）。
 * 版本不匹配（HTTP 409 / SETTINGS_CONFLICT）按错误呈现在界面上，不做静默覆盖。
 */
import { useSyncExternalStore } from 'react'
import { ApiError, request } from './api.ts'
import { describeError } from './api.ts'
import { applyThemePreference, FONT_SIZE_DEFAULT, type ThemePreference } from './theme.ts'
import { getLocale, LOCALE_DEFAULT, setLocale, t, type Locale } from './i18n.ts'
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

/**
 * 偏好读写错误：只存文案键与异常本身，句子由界面在渲染时按当前语言取。
 *
 * 存成品串会让提示停在旧语言（实测：中文下保存后切到 English，界面残留「已保存」），
 * 与技能页/MCP 页 `{ key, … }` 渲染时 `t()` 的既有惯例同一形状。
 */
export interface PreferencesError {
  /** 服务端值非法时对应的 `common` 文案键。 */
  invalidKeys: string[]
  /** 读写异常本身（省略表示只是值非法，没有异常）。 */
  failure?: unknown
}

/** 偏好状态。 */
export interface PreferencesState {
  theme: UiThemeValue
  locale: LocaleValue
  themeRevision: number
  localeRevision: number
  /** 最近一次读写失败（null 表示没有错误）。 */
  error: PreferencesError | null
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

/**
 * 偏好写入失败的展示文案（设置页与侧栏共用，避免同一映射两份副本）。
 *
 * 409 `SETTINGS_CONFLICT`（乐观锁版本不匹配）有专用句子：直出 `describeError` 会把框架层
 * 英文开发者串（"settings namespace … changed since it was read (expected revision 65, now 66)"）
 * 连同版本号一起丢给用户，既读不懂也不给出路（R8 机器串禁止直出 / R17 可操作出路）。
 * @param failure - `updateTheme` / `updateLocalePreference` 抛出的异常。
 * @returns 当前语言的句子。
 */
export function preferenceFailureText(failure: unknown): string {
  return failure instanceof ApiError && failure.code === 'SETTINGS_CONFLICT'
    ? t('settings', 'errorConflict')
    : describeError(failure)
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
 * 同一命名空间的写必须串行。
 *
 * `revision` 是「读-改-写」的乐观版本号：两条并发写会带上同一个 revision，后一条必然
 * 409 SETTINGS_CONFLICT。实测在侧栏连点「深色 → 跟随系统」（两条 PUT 相差 224ms 同时
 * 在场），结果是先点的那条生效、后一次改动静默失败，界面上只剩一条「已保存」——用户
 * 的最后一次操作被丢弃。串行后每条写都用前一条落定的 revision，自撞从根上消失；
 * 真正的跨窗口冲突仍会 409，由各调用方按 `errorConflict` 呈现。
 */
const writeTails = new Map<string, Promise<unknown>>()

/** 把一个命名空间的写排到该命名空间的队尾。 */
function serializeWrite<T>(namespace: string, run: () => Promise<T>): Promise<T> {
  const tail = writeTails.get(namespace) ?? Promise.resolve()
  const queued = tail.then(run, run)
  // 队列尾不能被失败打断：失败也要放行后一条（它带的是上一次成功落定的 revision）。
  writeTails.set(namespace, queued.catch(() => undefined))
  return queued
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
      error: null,
      loaded: true,
    })
    applyAll()
    // 非法服务端值不静默：只登记文案键，句子由界面按当前语言取（不再依赖 applyAll 的先后）。
    const invalidKeys = [
      themeEnvelope !== null && theme === null ? 'errorThemeValueInvalid' : '',
      localeEnvelope !== null && locale === null ? 'errorLocaleValueInvalid' : '',
    ].filter(Boolean)
    if (invalidKeys.length > 0) publish({ ...state, error: { invalidKeys } })
  } catch (error) {
    publish({ ...state, error: { invalidKeys: [], failure: error }, loaded: true })
    applyAll()
  }
}

/**
 * 重置偏好（登出：服务端账目归零，呈现值不回默认、不重刷 DOM）。
 * 登出后界面只剩登录页，其语言/主题由 i18n.ts 与 theme.ts 的首屏缓存承担（服务端偏好才是真源，
 * 下次 `loadPreferences()` 读取后立即覆盖）；在这里 `applyAll()` 会把默认值写回缓存，
 * 使英文用户的登录页永远退回中文。
 */
export function resetPreferences(): void {
  publish({
    theme: { preference: 'system', fontSize: FONT_SIZE_DEFAULT },
    locale: { preference: LOCALE_DEFAULT },
    themeRevision: 0,
    localeRevision: 0,
    error: null,
    loaded: false,
  })
}

/**
 * 更新外观偏好（主题 + 字号）。
 * @param patch - 待更新字段。
 * @throws ApiError —— 写失败（含 409 冲突）时抛出，调用方负责展示。
 */
export async function updateTheme(patch: Partial<UiThemeValue>): Promise<void> {
  await serializeWrite(UI_THEME_NAMESPACE, async () => {
    const next: UiThemeValue = { ...state.theme, ...patch }
    const envelope = await writeNamespace<UiThemeValue>(UI_THEME_NAMESPACE, next, state.themeRevision)
    const value = normalizeTheme(envelope.value) ?? next
    publish({ ...state, theme: value, themeRevision: envelope.revision, error: null })
    applyAll()
  })
}

/**
 * 更新语言偏好。
 * @param preference - zh / en。
 * @throws ApiError —— 写失败（含 409 冲突）时抛出。
 */
export async function updateLocalePreference(preference: Locale): Promise<void> {
  await serializeWrite(LOCALE_NAMESPACE, async () => {
    const envelope = await writeNamespace<LocaleValue>(LOCALE_NAMESPACE, { preference }, state.localeRevision)
    const value = normalizeLocale(envelope.value) ?? { preference }
    publish({ ...state, locale: value, localeRevision: envelope.revision, error: null })
    applyAll()
  })
}

/** 当前生效语言（与 i18n 保持一致）。 */
export function effectiveLocale(): Locale {
  return getLocale()
}
