/**
 * `@soloengine/ui-theme` 的浏览器半：把 SoloEngine 设计语言阶梯（`--se-*`）注入运行面板文档，
 * 并经原生覆盖通道注册三处 token 对比度校正。
 *
 * 阶梯数值的唯一真源是同包内的 `src/styles/tokens.css`（框架层产品页面导入同一文件）；
 * 对比度校正的唯一真源是 `../static.ts`（产品页的 ThemePresenter 快照读同一份）。
 *
 * 运行面板的主题与内容字号跟随**浏览器**偏好（`localStorage['soloengine.preferences']`）。
 * 原生设置对话框里的外观/字号控件编辑的是同一份偏好：对话框打开时先把浏览器偏好播种到
 * 原生主题运行时（让对话框显示真实生效值），随后把对话框里的修改写回浏览器偏好并继续
 * 以浏览器偏好为准——管理面与面板在任一浏览器里保持一致。
 *
 * @module @soloengine/ui-theme/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// `ctx.theme` 的声明合并来自原生主题插件。
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// 插件自有样式：由 client 构建预设编译并注入 <style data-plugin="…">（卸载即撤销）。
import '../styles/tokens.css'
import { CONTRAST_TOKEN_OVERRIDES } from '../static.ts'

/** 需要的服务：原生主题注册表（token 覆盖层）。 */
export const inject = ['theme']

/** 与框架层产品页面共用的浏览器偏好键。 */
const PREFERENCES_KEY = 'soloengine.preferences'

/** 产品区间的字号上下限（D22）：浏览器偏好与原生设置都收敛到这一区间。 */
const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 20

/** 浏览器偏好里的主题部分。 */
interface BrowserTheme {
  preference: 'light' | 'dark' | 'system'
  fontSize: number | null
}

/**
 * 读取浏览器偏好里的主题与字号。
 * @returns 偏好；键缺失或损坏时为 null。
 */
function readBrowserTheme(): BrowserTheme | null {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { theme?: { preference?: unknown; fontSize?: unknown } } | null
    const theme = parsed?.theme
    if (theme === undefined) return null
    const preference = theme.preference
    if (preference !== 'light' && preference !== 'dark' && preference !== 'system') return null
    return {
      preference,
      fontSize: typeof theme.fontSize === 'number' && Number.isFinite(theme.fontSize) ? theme.fontSize : null,
    }
  } catch {
    // 存储不可用或 JSON 损坏：保持原生运行时的值。
    return null
  }
}

/**
 * 把产品区间收敛到合法整数。
 * @param px - 任意字号输入。
 * @returns 12~20 的整数。
 */
function clampFontSize(px: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(px)))
}

/**
 * 把原生主题快照里的偏好写回浏览器偏好（保留 locale 等其它字段）。
 * @param snapshot - 原生主题运行时的当前快照。
 */
function writeBrowserTheme(snapshot: ThemeSnapshot): void {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY)
    const parsed = raw === null ? {} : JSON.parse(raw) as { theme?: Record<string, unknown>; [key: string]: unknown }
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
      ...parsed,
      theme: {
        ...parsed.theme,
        preference: snapshot.preference,
        fontSize: clampFontSize(snapshot.fontSizes.text),
      },
    }))
  } catch {
    // 存储不可用：原生运行时已经应用了这次修改，面板保持与浏览器一致的降级路径。
  }
}

/**
 * 运行面板设置对话框是否打开。通用设置项只存在于该对话框，用结构判断避免依赖界面文案。
 * @returns 对话框打开时为 true。
 */
function settingsDialogOpen(): boolean {
  return document.querySelector('[role="dialog"] [data-slot="settings.general.item"]') !== null
}

/** 把浏览器偏好落到运行面板文档（与产品页同一判据）。 */
function applyBrowserTheme(): void {
  const stored = readBrowserTheme()
  if (stored === null) return
  const scheme = stored.preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : stored.preference
  const source = stored.preference === 'system' ? 'system' : scheme
  const dark = scheme === 'dark'
  if (document.documentElement.getAttribute('data-ds-theme-source') !== source) {
    document.documentElement.setAttribute('data-ds-theme-source', source)
  }
  if (document.documentElement.style.colorScheme !== scheme) document.documentElement.style.colorScheme = scheme
  if (dark !== document.body.hasAttribute('data-ds-dark-theme')) {
    if (dark) document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
  }
  if (stored.fontSize !== null) {
    // 产品区间 12~20（D22）；存储可被用户/旧版本写入越界值，面板不能原样落到 DOM。
    const size = `${String(clampFontSize(stored.fontSize))}px`
    if (document.body.style.getPropertyValue('--dsh-content-font-size') !== size) {
      document.body.style.setProperty('--dsh-content-font-size', size)
    }
  }
  // 原生 presenter 把覆盖层 token 按**服务端**主题取 light/dark 值后内联写在 body 上；
  // 强制浏览器主题后必须把同一份校正也切到当前 scheme，否则深色面板上仍是浅色的对比度值。
  for (const [name, modes] of Object.entries(CONTRAST_TOKEN_OVERRIDES)) {
    const value = modes[scheme]
    if (document.body.style.getPropertyValue(name) !== value) document.body.style.setProperty(name, value)
  }
}

/**
 * 浏览器插件体：阶梯样式由 CSS 导入在包加载时注入；对比度校正经原生覆盖层注册，
 * 卸载时随 effect 撤回（不改原生 token 表、不产生第二权威）。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.theme.overrideTokens('soloengine-contrast', CONTRAST_TOKEN_OVERRIDES),
    'soloengine-ui-theme:contrast',
  )
  ctx.effect(() => {
    /** 本次对话框打开期间是否已把浏览器偏好播种到原生运行时。 */
    let seededForDialog = false
    /** 把浏览器偏好播种到原生主题运行时，让设置对话框显示真实生效值。 */
    const seedNativeTheme = (): void => {
      const stored = readBrowserTheme()
      if (stored === null) return
      const snapshot = ctx.theme.getTheme()
      if (snapshot.preference !== stored.preference) ctx.theme.setTheme(stored.preference)
      if (stored.fontSize !== null) {
        const size = clampFontSize(stored.fontSize)
        if (ctx.theme.getTheme().fontSizes.text !== size) ctx.theme.setFontSize('text', size)
      }
    }
    applyBrowserTheme()
    // 原生运行时在首帧与设置同步后都会写主题属性；这里在每次变更与每次 DOM 改写后重申
    // 浏览器偏好（值相同即不写，无回环）。
    const off = ctx.on('theme/change', (snapshot) => {
      // 对话框打开时，原生控件是浏览器偏好的编辑器：把这次修改写回偏好。
      if (settingsDialogOpen()) {
        writeBrowserTheme(snapshot)
        const clamped = clampFontSize(snapshot.fontSizes.text)
        if (clamped !== snapshot.fontSizes.text) ctx.theme.setFontSize('text', clamped)
      }
      applyBrowserTheme()
    })
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== PREFERENCES_KEY) return
      seedNativeTheme()
      applyBrowserTheme()
    }
    window.addEventListener('storage', onStorage)
    const observer = new MutationObserver(() => {
      const open = settingsDialogOpen()
      if (open && !seededForDialog) {
        seededForDialog = true
        seedNativeTheme()
      } else if (!open) {
        seededForDialog = false
      }
      applyBrowserTheme()
    })
    const options: MutationObserverInit = { attributes: true, attributeFilter: ['data-ds-theme-source', 'data-ds-dark-theme', 'style'] }
    observer.observe(document.documentElement, options)
    observer.observe(document.body, options)
    // 对话框是子树新增，属性观察器看不到；另开一个子观察器负责播种。
    const dialogObserver = new MutationObserver(() => {
      if (!settingsDialogOpen()) {
        seededForDialog = false
        return
      }
      if (seededForDialog) return
      seededForDialog = true
      seedNativeTheme()
    })
    dialogObserver.observe(document.body, { childList: true, subtree: true })
    return () => {
      off()
      window.removeEventListener('storage', onStorage)
      observer.disconnect()
      dialogObserver.disconnect()
    }
  }, 'soloengine-ui-theme:browser-preference')
}
