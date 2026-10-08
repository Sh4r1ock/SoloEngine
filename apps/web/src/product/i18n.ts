/**
 * 双语字典与 `t()`。zh 为键集真源，en 由 `defineDictionary` 约束为同键集。
 * fallback 链：当前语言 → en → key 本身；支持 `{name}` 占位符。
 */
import { useSyncExternalStore } from 'react'
import { dictionaries, type Namespace } from './locales/index.ts'

/** 语言偏好。 */
export type Locale = 'zh' | 'en'

/** 语言默认值。 */
export const LOCALE_DEFAULT: Locale = 'zh'

/**
 * 语言首屏缓存键（与 `theme.ts` 的主题缓存同一模式）。
 *
 * 偏好的唯一真源是服务端设置，但登录页在 `loadPreferences()` 之前渲染，且登出/令牌过期后
 * 根本不会读到偏好——不缓存的话，英文用户回到登录页时看到的永远是默认语言，
 * `locales/login.ts` 的英文字典成为实际不可达的死代码（实测确认：无任何路径能在登录页
 * 渲染前把语言切成 en）。缓存只在模块加载时用于预着色，服务端偏好返回后立即覆盖。
 */
const LOCALE_CACHE_KEY = 'soloengine.localeCache'

let current: Locale = LOCALE_DEFAULT
const listeners = new Set<() => void>()

/** 当前语言。 */
export function getLocale(): Locale {
  return current
}

/** 切换语言（同步 `document.documentElement.lang` 与首屏缓存）。 */
export function setLocale(locale: Locale): void {
  current = locale
  document.documentElement.lang = locale
  try {
    window.localStorage.setItem(LOCALE_CACHE_KEY, locale)
  } catch {
    // localStorage 不可用：只影响下次首屏预着色，真实偏好仍由服务端承担。
  }
  for (const listener of listeners) listener()
}

// 模块加载即恢复语言：在 React 首渲染前落定 `current` 与 `<html lang>`。
try {
  const cached = window.localStorage.getItem(LOCALE_CACHE_KEY)
  if (cached === 'zh' || cached === 'en') current = cached
} catch {
  // 缓存不可读：按默认语言渲染。
}
document.documentElement.lang = current

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
  const dict = dictionaries[namespace] as { zh: Record<string, string>; en: Record<string, string> }
  const primary = current === 'en' ? dict.en[key] : dict.zh[key]
  const fallback = current === 'en' ? undefined : dict.en[key]
  return fill(primary ?? fallback ?? key, params)
}

/** React hook：当前语言（语言切换时触发重渲染）。 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}
