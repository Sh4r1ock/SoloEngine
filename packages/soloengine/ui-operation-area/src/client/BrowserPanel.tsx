/**
 * 浏览器面板（PRD-08 FR-OPS-008；PRD-10 FR-SEC-009/010）。
 *
 * 页面经**同源代理**加载：`iframe` 的地址是代理前缀下的 `/__open?url=<目标>`（302 到代理路径），
 * 因此 iframe 与父页同源——地址栏可从 `contentWindow.location` 同步、前进/后退可用。
 * 目标校验、内网拒绝、链接重写、父页隔离垫片全部在 Host 侧代理完成（面板不做安全判定，
 * 也不直连外网）。预览卡片点击经 `openTab('browser', { params: { url } })` 落到**当前标签**。
 *
 * @module @soloengine/ui-operation-area/BrowserPanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './BrowserPanel.module.css'
import type { SoloengineOpsKey } from './locales.ts'

/** 注入面：代理前缀（由 Host 侧插件配置注入，面板不硬编码地址）。 */
export interface BrowserFace {
  /** 同源代理前缀。 */
  proxyPrefix: string
}

/** 面板体 props。 */
export type BrowserPanelProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'soloengineOps'>
  & BrowserFace

/** 面板内的一个页面标签。 */
interface PageTab {
  id: string
  /** 用户可见的目标地址（代理之前的真实地址）。 */
  url: string
  /** 访问历史（含当前项）。 */
  history: string[]
  /** 当前在历史中的下标。 */
  index: number
}

/** 由目标地址构造 iframe 源（走代理打开入口）。 */
function frameSource(proxyPrefix: string, url: string): string {
  return `${proxyPrefix}/__open?url=${encodeURIComponent(url)}`
}

/**
 * 从代理路径还原目标地址（地址栏同步；无法还原即返回 null）。
 * @param proxyPrefix - 代理前缀。
 * @param pathname - iframe 当前路径。
 * @returns 目标地址，或 null。
 */
function targetOf(proxyPrefix: string, pathname: string): string | null {
  if (!pathname.startsWith(`${proxyPrefix}/`)) return null
  const rest = pathname.slice(proxyPrefix.length + 1)
  const slash = rest.indexOf('/')
  const segment = slash === -1 ? rest : rest.slice(0, slash)
  if (segment === '' || segment.startsWith('__')) return null
  try {
    const binary = atob(segment.replace(/-/gu, '+').replace(/_/gu, '/'))
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const origin = new TextDecoder().decode(bytes)
    if (!origin.startsWith('http://') && !origin.startsWith('https://')) return null
    return `${origin}${slash === -1 ? '/' : rest.slice(slash)}`
  } catch {
    return null
  }
}

/** 代理拒绝码 → 本面板文案键（代理返回的是 `{ok:false,error:{code,message}}` 裸 JSON，
 *  机器码与英文诊断不得直接给人看）。 */
const REJECTION_KEYS: Record<string, SoloengineOpsKey> = {
  SCHEME_REJECTED: 'browser.rejectedScheme',
  ADDRESS_REJECTED: 'browser.rejectedAddress',
}

/**
 * 渲染多标签浏览器面板。
 * @param props - tab 记录座位、注入的代理前缀与本地化座位。
 * @returns 面板体。
 */
export function BrowserPanel({ useTabInfo, proxyPrefix, t }: BrowserPanelProps) {
  const { tab } = useTabInfo()
  // 参数由 ui-conversation 的预览卡片按约定发出（`browser: { url }`）；跨包看不到那份类型增广，
  // 故按形状判据读取，不把整个 params 断言成某一支。
  const navigation: unknown = tab.navigation.params
  const requested = typeof navigation === 'object' && navigation !== null && 'url' in navigation
    ? String(navigation.url)
    : ''
  const [tabs, setTabs] = useState<PageTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  /** 代理拒绝原因（本地化句子）；非空时不渲染那页裸 JSON。 */
  const [rejection, setRejection] = useState<string | null>(null)
  /** 当前标签正在加载：iframe 在 onLoad 前是一片与「空白页」无法区分的白，需给出可见进度。 */
  const [loading, setLoading] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)

  /** 打开一个新标签（或复用空面板的第一个标签）。 */
  const openTab = useCallback((url: string): void => {
    setTabs((current) => {
      const entry: PageTab = { id: `page-${String(Date.now())}-${String(current.length)}`, url, history: [url], index: 0 }
      if (current.length === 0) {
        setActiveId(entry.id)
        return [entry]
      }
      setActiveId(entry.id)
      return [...current, entry]
    })
  }, [])

  // 预览卡片 / 联动层的参数到达即导航**当前标签**（无标签则新建）。
  // 同一 revision 只应用一次：activeId 单独变化不得以旧参数重复导航；activeId 经 ref 取最新值避免 stale 闭包。
  const appliedRevision = useRef<number | undefined>(undefined)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
  useEffect(() => {
    if (requested === '') return
    if (appliedRevision.current === tab.navigation.revision) return
    appliedRevision.current = tab.navigation.revision
    setTabs((current) => {
      if (current.length === 0) {
        const entry: PageTab = { id: 'page-0', url: requested, history: [requested], index: 0 }
        setActiveId(entry.id)
        return [entry]
      }
      const index = current.findIndex(candidate => candidate.id === activeIdRef.current)
      const target = index === -1 ? 0 : index
      return current.map((candidate, position) => position === target
        ? {
          ...candidate,
          url: requested,
          history: [...candidate.history.slice(0, candidate.index + 1), requested],
          index: candidate.index + 1,
        }
        : candidate)
    })
  }, [requested, tab.navigation.revision])

  const active = tabs.find(candidate => candidate.id === activeId) ?? null

  // 地址栏同步：只在**当前标签的目标真的换了**时覆写。
  // 依赖若是 `active` 对象本身，任何一次 setTabs（例如别的标签解出内容）都会换新引用，
  // 用户正在地址栏里敲的半截文本会被无声吞掉。
  useEffect(() => {
    if (active === null) { setAddress(''); return }
    setAddress(active.url)
  }, [active?.url ?? null])

  // 换标签或改地址都会重建 iframe（`key={active.id}`）；onLoad 之前那段时间要与「页面本身就是空的」
  // 可区分，否则用户看到的只是一片白，分不清在加载、失败还是没内容。
  useEffect(() => {
    setLoading(active !== null && active.url !== '')
  }, [active?.id ?? null, active?.url ?? null])

  const onFrameLoad = useCallback((): void => {
    setLoading(false)
    const frame = frameRef.current
    if (frame === null || frame.contentWindow === null) return
    let pathname: string
    try {
      pathname = frame.contentWindow.location.pathname
    } catch {
      // 跨源（理论上不发生：代理保证同源）——保持地址栏为已知目标，不伪造。
      return
    }
    // 代理拒绝目标时返回的是 `{ok:false,error:{…}}` 裸 JSON（同源可读）。这里把它换成本地化
    // 句子并收起那页 JSON：机器码与英文诊断不进用户可见层，但拒绝这一事实如实呈现。
    let bodyText = ''
    try {
      bodyText = frame.contentDocument?.body.textContent ?? ''
    } catch {
      bodyText = ''
    }
    if (bodyText.startsWith('{"ok":false')) {
      let code = ''
      try {
        code = (JSON.parse(bodyText) as { error?: { code?: string } }).error?.code ?? ''
      } catch {
        code = ''
      }
      const key = REJECTION_KEYS[code] ?? 'browser.rejectedProxy'
      setRejection(t(key))
      return
    }
    setRejection(null)
    const target = targetOf(proxyPrefix, pathname)
    if (target === null) return
    setAddress(target)
    setTabs(current => current.map(candidate => candidate.id === activeId ? { ...candidate, url: target } : candidate))
  }, [proxyPrefix, activeId])

  const navigate = useCallback((url: string, mode: 'push' | 'replace'): void => {
    setTabs(current => current.map((candidate) => {
      if (candidate.id !== activeId) return candidate
      if (mode === 'replace') {
        const history = [...candidate.history]
        history[candidate.index] = url
        return { ...candidate, url, history }
      }
      return { ...candidate, url, history: [...candidate.history.slice(0, candidate.index + 1), url], index: candidate.index + 1 }
    }))
  }, [activeId])

  const step = useCallback((delta: number): void => {
    setTabs(current => current.map((candidate) => {
      if (candidate.id !== activeId) return candidate
      const next = candidate.index + delta
      if (next < 0 || next >= candidate.history.length) return candidate
      return { ...candidate, index: next, url: candidate.history[next] ?? candidate.url }
    }))
  }, [activeId])

  const closeTab = useCallback((id: string): void => {
    setTabs((current) => {
      const next = current.filter(candidate => candidate.id !== id)
      if (id === activeId) setActiveId(next.length === 0 ? null : next[0]?.id ?? null)
      return next
    })
  }, [activeId])

  return (
    <div className={styles.root}>
      <div className={styles.strip}>
        {tabs.map(candidate => (
          <span key={candidate.id} className={candidate.id === activeId ? `${styles.chip} ${styles.chipActive}` : styles.chip}>
            <button type="button" className={styles.chipLabel} onClick={() => { setActiveId(candidate.id) }}>
              {candidate.url}
            </button>
            <button type="button" className={styles.chipClose} aria-label={t('browser.close')} onClick={() => { closeTab(candidate.id) }}>
              ×
            </button>
          </span>
        ))}
        <button type="button" className={styles.add} aria-label={t('browser.new')} onClick={() => { openTab('') }}>
          +
        </button>
      </div>
      <form
        className={styles.bar}
        onSubmit={(event) => {
          event.preventDefault()
          const value = address.trim()
          if (value === '') return
          const normalized = /^https?:\/\//u.test(value) ? value : `https://${value}`
          if (active === null) openTab(normalized)
          else navigate(normalized, 'push')
        }}
      >
        <Button size="sm" variant="ghost" aria-label={t('browser.back')} disabled={active === null || active.index === 0} onClick={() => { step(-1) }}>
          ‹
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('browser.forward')}
          disabled={active === null || active.index >= active.history.length - 1}
          onClick={() => { step(1) }}
        >
          ›
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('browser.reload')}
          disabled={active === null}
          onClick={() => { if (active !== null) navigate(active.url, 'replace') }}
        >
          ⟳
        </Button>
        <span className={styles.addressField}>
          <Input
            type="text"
            inputMode="url"
            autoComplete="off"
            aria-label={t('browser.address.label')}
            placeholder={t('browser.address.placeholder')}
            value={address}
            onChange={(event) => { setAddress(event.target.value) }}
          />
        </span>
        <Button size="sm" variant="outline" type="submit">{t('browser.go')}</Button>
      </form>
      {rejection !== null
        ? <div className={styles.state} role="alert">{rejection}</div>
        : null}
      {loading && rejection === null
        ? <div className={styles.loading} role="status">{t('browser.loading')}</div>
        : null}
      {active === null || active.url === '' || rejection !== null
        ? (active === null || active.url === '' ? <div className={styles.empty}>{t('browser.empty')}</div> : null)
        : (
          <iframe
            ref={frameRef}
            key={active.id}
            className={styles.frame}
            title={t('browser.type')}
            src={frameSource(proxyPrefix, active.url)}
            onLoad={onFrameLoad}
          />
        )}
    </div>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineOpsKey }
