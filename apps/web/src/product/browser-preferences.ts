/**
 * 浏览器本地偏好（主题 / 内容字号 / 语言）。
 *
 * 唯一存储是 `localStorage`：偏好跟随**浏览器**，不写服务端设置命名空间——
 * 同一实例的多个账号共用一个进程时，服务端命名空间会让一个人的外观改动影响所有终端用户
 * （用户要求：整站生效，但按用户与浏览器隔离）。原型同样用 `localStorage['dsh.*']` 存偏好。
 */

/** 唯一存储键。 */
export const PREFERENCES_KEY = 'soloengine.preferences'

/** 主题三模式。 */
export type StoredThemePreference = 'light' | 'dark' | 'system'

/** 存储值。 */
export interface StoredPreferences {
  theme: {
    preference: StoredThemePreference
    fontSize: number
  }
  locale: string
}

/**
 * 读取浏览器偏好。
 * @returns 解析后的偏好；键缺失、损坏或存储不可用时返回 null。
 */
export function readBrowserPreferences(): StoredPreferences | null {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<StoredPreferences> | null
    if (parsed === null || typeof parsed !== 'object') return null
    const theme = parsed.theme
    const preference = theme?.preference
    if (preference !== 'light' && preference !== 'dark' && preference !== 'system') return null
    const fontSize = typeof theme?.fontSize === 'number' && Number.isFinite(theme.fontSize) ? theme.fontSize : 14
    const locale = typeof parsed.locale === 'string' ? parsed.locale : 'zh'
    return { theme: { preference, fontSize }, locale }
  } catch {
    // 存储不可用或 JSON 损坏：按默认偏好渲染，下次写入会重建键。
    return null
  }
}

/**
 * 写入浏览器偏好（整份覆盖，字段由调用方合并）。
 * @param value - 待写入的完整偏好。
 * @throws 存储不可用（配额/隐私模式）时抛出，由调用方呈现。
 */
export function writeBrowserPreferences(value: StoredPreferences): void {
  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value))
}
