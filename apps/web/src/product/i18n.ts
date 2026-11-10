/**
 * 多语言字典与 `t()`。zh 为键集真源，en 由 `defineDictionary` 约束为同键集。
 * fallback 链：当前语言 → en → key 本身；支持 `{name}` 占位符。
 *
 * 语言标识是开放集合 `LocaleId`（内置 zh/en，`Locale` 是持久化偏好用的闭集）：
 * 产品字典注册表与运行面板的 `ctx.locale.register(ns, dicts)` 同一契约——按命名空间
 * 注册、缺键回落 en、可新增语言（`addLanguage`）。无偏好时按 `navigator.languages`
 * 推导；`html lang` 的 zh 映射为 `zh-CN`（与首屏标记一致）。
 */
import { useSyncExternalStore } from 'react'
import { dictionaries, type Namespace } from './locales/index.ts'
import { readBrowserPreferences, writeBrowserPreferences } from './browser-preferences.ts'

/** 语言标识（开放集合；渲染与字典注册都用它）。 */
export type LocaleId = string

/** 内置语言（产品字典与偏好存储的闭集）。 */
export const BUILTIN_LOCALES = ['zh', 'en'] as const

/** 内置语言之一。 */
export type Locale = typeof BUILTIN_LOCALES[number]

/** 语言默认值。 */
export const LOCALE_DEFAULT: Locale = 'zh'

/** 一个命名空间的语言 → 字典表。 */
type DictionaryTable = Record<LocaleId, Record<string, string>>

/** 运行期字典注册表：静态字典是种子，`register` / `addLanguage` 在其上叠加。 */
const registry = new Map<Namespace, DictionaryTable>(
  (Object.entries(dictionaries) as [Namespace, Record<Locale, Record<string, string>>][])
    .map(([namespace, table]) => [namespace, { ...table }]),
)

/**
 * 注册或合并一个命名空间的字典（与运行面板 `ctx.locale.register(ns, dicts)` 同一契约）。
 * @param namespace - 命名空间（页面名）。
 * @param dicts - 语言 → 字典；同语言下按 key 合并，未覆盖的键保留原值。
 */
export function register(namespace: Namespace, dicts: Partial<DictionaryTable>): void {
  const table = registry.get(namespace) ?? {}
  for (const [locale, dict] of Object.entries(dicts)) {
    table[locale] = { ...table[locale], ...dict }
  }
  registry.set(namespace, table)
}

/**
 * 新增一门语言：对列出的命名空间逐条合并字典。
 * @param locale - 新语言标识（如 `ja`）。
 * @param dicts - 命名空间 → 该语言的字典。
 */
export function addLanguage(locale: LocaleId, dicts: Partial<Record<Namespace, Record<string, string>>>): void {
  for (const [namespace, dict] of Object.entries(dicts)) {
    register(namespace as Namespace, { [locale]: dict })
  }
}

/**
 * 语言与主题共用同一份浏览器偏好存储（`browser-preferences.ts`）。
 *
 * 登录页在 `loadPreferences()` 之前渲染，且登出/令牌过期后不会重新读偏好——不存的话，
 * 英文用户回到登录页时看到的永远是默认语言。存储只在模块加载时用于首屏，
 * `loadPreferences()` 读到同一份值后立即对齐。
 */
let current: LocaleId = LOCALE_DEFAULT
const listeners = new Set<() => void>()

/**
 * 浏览器首选语言里第一门内置语言。
 * @returns 命中的内置语言；都不命中时为 null。
 */
function browserLocale(): Locale | null {
  const languages = typeof navigator === 'undefined'
    ? []
    : navigator.languages.length > 0 ? [...navigator.languages] : [navigator.language]
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]
    const builtin = BUILTIN_LOCALES.find(locale => locale === base)
    if (builtin !== undefined) return builtin
  }
  return null
}

/**
 * `html lang` 的取值：zh 映射为 zh-CN（产品首屏标记与之一致），其余原样。
 * @param locale - 当前语言。
 * @returns 写进 `<html lang>` 的 BCP 47 标记。
 */
function htmlLang(locale: LocaleId): string {
  return locale === 'zh' ? 'zh-CN' : locale
}

/** 当前语言。 */
export function getLocale(): LocaleId {
  return current
}

/** 切换语言（同步 `document.documentElement.lang` 与浏览器偏好存储）。 */
export function setLocale(locale: LocaleId): void {
  current = locale
  document.documentElement.lang = htmlLang(locale)
  try {
    const stored = readBrowserPreferences()
    writeBrowserPreferences({
      theme: stored?.theme ?? { preference: 'system', fontSize: 14 },
      locale,
    })
  } catch {
    // localStorage 不可用：本次切换仍作用于当前页面，只是下次首屏回到默认语言。
  }
  for (const listener of listeners) listener()
}

// 模块加载即恢复语言：在 React 首渲染前落定 `current` 与 `<html lang>`。
// 存储 > 浏览器首选 > 默认。
const storedLocale = readBrowserPreferences()?.locale
current = storedLocale === 'zh' || storedLocale === 'en' ? storedLocale : browserLocale() ?? LOCALE_DEFAULT
document.documentElement.lang = htmlLang(current)

/** 订阅语言变化。 */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 占位符替换：`{name}` → params.name。 */
function fill(text: string, params?: Record<string, string | number>): string {
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * 取一条文案。
 * @param namespace - 字典命名空间（页面名）。
 * @param key - 键。
 * @param params - 占位符参数。
 * @returns 当前语言文案，缺失时回落 en，再回落 key 本身。
 */
export function t(namespace: Namespace, key: string, params?: Record<string, string | number>): string {
  const table = registry.get(namespace)
  const primary = table?.[current]?.[key]
  const fallback = table?.en?.[key]
  return fill(primary ?? fallback ?? key, params)
}

/** React hook：当前语言（语言切换时触发重渲染）。 */
export function useLocale(): LocaleId {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}
