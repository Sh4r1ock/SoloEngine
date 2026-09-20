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

/**
 * 渲染多标签浏览器面板。
 * @param props - tab 记录座位、注入的代理前缀与本地化座位。
 * @returns 面板体。
 */
export function BrowserPanel({ useTabInfo, proxyPrefix, t }: BrowserPanelProps) {
  const { tab } = useTabInfo()
  const params = tab.navigation.params as { url?: string } | undefined
  const requested = params?.url
  const [tabs, setTabs] = useState<PageTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const frameRef = useRef<HTMLIFrameElement>(null)

  /** 打开一个新标签（或复用空面板的第一个标签）。 */
  const openTab = useCallback((url: string): void => {
    setTabs(current => {
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
  useEffect(() => {
    if (requested === undefined || requested === '') return
    setTabs(current => {
      if (current.length === 0) {
        const entry: PageTab = { id: 'page-0', url: requested, history: [requested], index: 0 }
        setActiveId(entry.id)
        return [entry]
      }
      const index = current.findIndex(candidate => candidate.id === activeId)
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
  }, [requested, tab.navigation.revision, activeId])

  const active = tabs.find(candidate => candidate.id === activeId) ?? null

  // 地址栏同步：iframe 加载完成后读取其（同源的）真实路径还原目标地址。
  useEffect(() => {
    if (active === null) { setAddress(''); return }
    setAddress(active.url)
  }, [active])

  const onFrameLoad = useCallback((): void => {
    const frame = frameRef.current
    if (frame === null || frame.contentWindow === null) return
    let pathname: string
    try {
      pathname = frame.contentWindow.location.pathname
    } catch {
      // 跨源（理论上不发生：代理保证同源）——保持地址栏为已知目标，不伪造。
      return
    }
    const target = targetOf(proxyPrefix, pathname)
    if (target === null) return
    setAddress(target)
    setTabs(current => current.map(candidate => candidate.id === activeId ? { ...candidate, url: target } : candidate))
  }, [proxyPrefix, activeId])

  const navigate = useCallback((url: string, mode: 'push' | 'replace'): void => {
    setTabs(current => current.map(candidate => {
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
    setTabs(current => current.map(candidate => {
      if (candidate.id !== activeId) return candidate
      const next = candidate.index + delta
      if (next < 0 || next >= candidate.history.length) return candidate
      return { ...candidate, index: next, url: candidate.history[next] ?? candidate.url }
    }))
  }, [activeId])

  const closeTab = useCallback((id: string): void => {
    setTabs(current => {
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
        <button type="button" className={styles.add} aria-label={t('browser.new')} onClick={() => { openTab('https://example.com/') }}>
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
        <button type="button" className={styles.control} aria-label={t('browser.back')} disabled={active === null || active.index === 0} onClick={() => { step(-1) }}>
          ‹
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label={t('browser.forward')}
          disabled={active === null || active.index >= active.history.length - 1}
          onClick={() => { step(1) }}
        >
          ›
        </button>
        <button
          type="button"
          className={styles.control}
          aria-label={t('browser.reload')}
          disabled={active === null}
          onClick={() => { if (active !== null) navigate(active.url, 'replace') }}
        >
          ⟳
        </button>
        <input
          className={styles.address}
          aria-label={t('browser.address.label')}
          placeholder={t('browser.address.placeholder')}
          value={address}
          onChange={(event) => { setAddress(event.target.value) }}
        />
        <button type="submit" className={styles.control}>{t('browser.go')}</button>
      </form>
      {active === null
        ? <div className={styles.empty}>{t('browser.empty')}</div>
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
