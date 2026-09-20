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

let current: Locale = LOCALE_DEFAULT
const listeners = new Set<() => void>()

/** 当前语言。 */
export function getLocale(): Locale {
  return current
}

/** 切换语言（同步 `document.documentElement.lang`）。 */
export function setLocale(locale: Locale): void {
  current = locale
  document.documentElement.lang = locale
  for (const listener of listeners) listener()
}

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
