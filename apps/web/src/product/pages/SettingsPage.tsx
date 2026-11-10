/** 设置页：通用 / 外观 / 语言 / 插件。 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconArchiveOutlineRegular,
  IconCordisPluginOutlineRegular,
  IconPlusOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningTriangleOutlineRegular,
  Input,
  Modal,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { PageHeader } from '../components/PageHeader.tsx'
import { formatDateOnly } from '../utils/time.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { preferenceFailureText, updateLocalePreference, updateTheme, usePreferences } from '../preferences.ts'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../theme.ts'
import type {
  ManagedBundleView, PluginChangeView, PluginInspectionView, PluginsView, UserView,
} from '../types.ts'
import css from '../styles/common.module.css'
import settingsCss from '../styles/settings.module.css'

/** 分节。 */
type Section = 'general' | 'appearance' | 'locale' | 'plugins'

/** 横向分区导航的四个锚点（顺序即页面顺序）。 */
const SECTIONS: readonly { id: Section; labelKey: string }[] = [
  { id: 'general', labelKey: 'navGeneral' },
  { id: 'appearance', labelKey: 'navAppearance' },
  { id: 'locale', labelKey: 'navLocale' },
  { id: 'plugins', labelKey: 'navPlugins' },
]

/**
 * 地址 hash → 分区：接受 `#settings-plugins` 与 `#plugins` 两种写法。
 * @param hash - `window.location.hash` 原文。
 * @returns 分区 id；不是已知分区时为 null。
 */
function sectionFromHash(hash: string): Section | null {
  const id = hash.replace(/^#/u, '').replace(/^settings-/u, '')
  return SECTIONS.find(item => item.id === id)?.id ?? null
}

/** 键盘调整滑块后需要落盘的按键（拖动途中的 `onChange` 只更新预览）。 */
const RANGE_COMMIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/**
 * 提示条目：只存文案键与异常本身，句子在渲染时按当前语言取。
 *
 * 存成品串会让提示停在旧语言（实测：中文下保存成功后切到 English，界面上残留「已保存」）。
 * 与技能页/MCP 页既有惯例同一形状（`{ key, detail }` 渲染时 `t()`）。
 */
interface NoticeItem {
  /** `settings` 字典里的句子键。 */
  key: string
  /** 失败异常（渲染时交给 describeError/preferenceFailureText 取当前语言原因）。 */
  failure: unknown
}

/**
 * 最近登录的相对时间（原型 settings.html:70 显示「刚刚」）。
 * @param value - 后端返回的 ISO 时间。
 * @returns 相对时间文案；null/不可解析时为 null，由调用方兜底。
 */
function lastLoginText(value: string | null): string | null {
  if (value === null || value === '') return null
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return t('settings', 'relativeJustNow')
  if (minutes < 60) return t('settings', 'relativeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('settings', 'relativeHours', { count: hours })
  return t('settings', 'relativeDays', { count: Math.floor(hours / 24) })
}

/**
 * 插件操作失败码 → 文案键。
 * @param code - 原生 `ManagementError.code`；成功或未提供时为 undefined。
 * @returns `settings` 字典里的句子键。
 */
function pluginErrorKey(code: string | undefined): string {
  switch (code) {
    case 'invalid-spec': return 'pluginErrorInvalidSpec'
    case 'already-installed': return 'pluginErrorInstalled'
    case 'not-found': return 'pluginErrorNotFound'
    case 'not-a-package':
    case 'not-a-bundle': return 'pluginErrorNotBundle'
    case 'not-removable': return 'pluginErrorNotRemovable'
    case 'bundle-in-use': return 'pluginErrorInUse'
    case 'stop-profile': return 'pluginErrorStopped'
    case 'incompatible-version': return 'pluginErrorIncompatible'
    case 'management-required':
    case 'unaddressable': return 'pluginErrorReadOnly'
    default: return 'pluginErrorGeneric'
  }
}

/** 一条插件管理结果提示（句子在渲染时按当前语言取）。 */
interface ManageNotice {
  /** `settings` 字典里的句子键。 */
  key: string
  /** 语气：成功 / 信息 / 失败。 */
  tone: 'success' | 'info' | 'error'
  /** 原生诊断原文（pnpm 或 Loader 的输出，不改写）。 */
  detail?: string | undefined
}

/**
 * 原生变更结果 → 界面提示（落地状态与失败码分开成句）。
 * @param result - `POST /plugins/*` 返回的结果。
 * @returns 语气与句子键。
 */
function changeNotice(result: PluginChangeView): ManageNotice {
  if (result.application === 'applied') return { key: 'pluginApplied', tone: 'success' }
  if (result.application === 'restart-required') return { key: 'pluginRestartRequired', tone: 'info' }
  if (result.application === 'overridden') return { key: 'pluginOverridden', tone: 'error' }
  if (result.application === 'cancelled') return { key: 'pluginCancelled', tone: 'error' }
  return { key: pluginErrorKey(result.error?.code), tone: 'error', detail: result.error?.diagnostic ?? undefined }
}

/**
 * 插件安装失败的文案键。
 *
 * 只有网络中断、服务端 5xx 与限流/超时这类无法判断落地状态的失败才报「结果未知」；
 * 服务端明确拒绝（带错误码的 4xx）按码给出具体原因与出路，不能伪造成未知或成功。
 * @param failure - 捕获的失败。
 * @returns `settings` 字典里的句子键。
 */
function installFailureKey(failure: unknown): string {
  if (failure instanceof ApiError) {
    switch (failure.code) {
      case 'already-installed': return 'pluginInstallAlreadyInstalled'
      case 'incompatible-version': return 'pluginInstallIncompatible'
      case 'management-required':
      case 'unaddressable': return 'pluginInstallReadOnly'
      case 'invalid-spec': return 'pluginErrorInvalidSpec'
      case 'not-found':
      case 'unknown-plugin': return 'pluginErrorNotFound'
      case 'not-a-package':
      case 'not-a-bundle': return 'pluginErrorNotBundle'
      case 'not-removable': return 'pluginErrorNotRemovable'
      case 'bundle-in-use': return 'pluginErrorInUse'
      case 'stop-profile': return 'pluginErrorStopped'
      case 'PLUGIN_SPEC_REQUIRED': return 'pluginSpecRequired'
      case 'NETWORK': return 'pluginInstallUnknown'
      default: break
    }
    // 4xx 是服务端明确拒绝（安装没有开始）；408/429 与 5xx 无法判断落地状态。
    return failure.status >= 400 && failure.status < 500
      && failure.status !== 408 && failure.status !== 429
      ? 'pluginErrorGeneric'
      : 'pluginInstallUnknown'
  }
  return 'pluginInstallUnknown'
}

/**
 * 渲染设置页。
 */
export function SettingsPage() {
  const locale = useLocale()
  const preferences = usePreferences()
  const [section, setSection] = useState<Section>('general')
  const pageRef = useRef<HTMLDivElement | null>(null)
  const [profile, setProfile] = useState<UserView | null>(null)
  const [plugins, setPlugins] = useState<PluginsView | null>(null)
  const [error, setError] = useState<NoticeItem | null>(null)
  // 两份数据各有各的失败槽：共用一个 `error` 时，先失败的那份会被后成功的那份
  // `setError(null)` 抹掉（实测阻断 /auth/me 后界面只剩「加载中…」，一行错误都没有）。
  const [profileError, setProfileError] = useState<NoticeItem | null>(null)
  const [pluginsError, setPluginsError] = useState<NoticeItem | null>(null)
  // profile 级插件管理：组合包来自原生 pluginManager（仅超管可见/可改）。
  const [bundles, setBundles] = useState<ManagedBundleView[] | null>(null)
  const [bundlesError, setBundlesError] = useState<NoticeItem | null>(null)
  const [bundleBusy, setBundleBusy] = useState<string | null>(null)
  const [manageNotice, setManageNotice] = useState<ManageNotice | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ManagedBundleView | null>(null)
  /** 移除确认框内的失败行：页面级提示会被 Modal 遮住，失败原因必须就地可见。 */
  const [removeFailure, setRemoveFailure] = useState<{ text: string; retry: () => void } | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [installSpec, setInstallSpec] = useState('')
  const [installBusy, setInstallBusy] = useState(false)
  const [installRequestId, setInstallRequestId] = useState<string | null>(null)
  const [installInspection, setInstallInspection] = useState<PluginInspectionView | null>(null)
  const [installResult, setInstallResult] = useState<PluginChangeView | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  // 成功提示必须带出处：`已保存` 不带主语，跨分节留存会让人以为「当前分节已保存」，
  // 且会与随后一次失败写入同屏并存（实测 `偏好读写失败 …` 与 `已保存` 同时出现）。
  // 出处放进页头状态并 1.6s 后回到「偏好已同步」（原型同款），不再单独占一行提示。
  const [notice, setNotice] = useState<{ section: Section; key: string } | null>(null)
  const noticeTimer = useRef<number | null>(null)
  /** 字号滑块的短防抖：滚轮/辅助技术只触发 change，没有 pointerup/keyup 可等。 */
  const fontCommitTimer = useRef<number | null>(null)
  // 字号滑块的拖动草稿：拖动中只更新数值提示与预览，松手才落盘（原型 input 预览 / change 保存）。
  // null 表示跟随已保存值，服务端偏好变化（首次加载、其它窗口保存）会直接反映到滑块上。
  const [fontDraft, setFontDraft] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  // 深链目标在数据加载完成后要再落一次位：资料卡与插件清单是异步渲染的，首次滚动后
  // 上方内容增高会把目标分区顶下去；这段时间内也让滚动监听暂缓改写高亮。
  const hashTarget = useRef<Section | null>(null)
  const spyLockUntil = useRef(0)
  /** 锁期内收到滚动时安排的补判定（同一时刻只排一个）。 */
  const spyTimer = useRef<number | null>(null)

  const loadProfile = useCallback(async (): Promise<void> => {
    try {
      const result = await request<{ ok: true; user: UserView }>('/auth/me')
      setProfile(result.user)
      setProfileError(null)
    } catch (failure) {
      setProfileError({ key: 'errorProfile', failure })
    }
  }, [])

  const loadPlugins = useCallback(async (): Promise<void> => {
    try {
      const result = await request<{ ok: true } & PluginsView>('/plugins')
      setPlugins({ profile: result.profile, rows: result.rows, clientEntries: result.clientEntries, unresolved: result.unresolved })
      setPluginsError(null)
    } catch (failure) {
      setPluginsError({ key: 'errorPlugins', failure })
    }
  }, [])

  const loadBundles = useCallback(async (): Promise<void> => {
    try {
      const result = await request<{ ok: true; bundles: ManagedBundleView[] }>('/plugins/bundles')
      setBundles(result.bundles)
      setBundlesError(null)
    } catch (failure) {
      setBundlesError({ key: 'errorPlugins', failure })
    }
  }, [])

  useEffect(() => { void loadProfile() }, [loadProfile])
  useEffect(() => { void loadPlugins() }, [loadPlugins])
  // 只有超管读组合包管理面：普通用户的管理接口本身就是 403，界面也不展示开关与安装入口。
  const canManagePlugins = profile?.is_superuser === true
  useEffect(() => {
    if (canManagePlugins) void loadBundles()
  }, [canManagePlugins, loadBundles])
  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    if (fontCommitTimer.current !== null) window.clearTimeout(fontCommitTimer.current)
    if (spyTimer.current !== null) window.clearTimeout(spyTimer.current)
  }, [])
  // 深链：`/settings#settings-plugins` 直接激活并滚到该分区。分节由 React 渲染，
  // 浏览器在原生的 hash 定位时机还找不到它们，所以必须在挂载后自己落一次位。
  useEffect(() => {
    const target = sectionFromHash(window.location.hash)
    if (target === null) return
    hashTarget.current = target
    setSection(target)
    // 挂载期就加锁：资料卡插入引发的滚动事件不能把深链目标改回上一分区。
    spyLockUntil.current = Date.now() + 1200
    const scroll = (): void => {
      document.getElementById(`settings-${target}`)?.scrollIntoView({ block: 'start' })
    }
    scroll()
    const frame = window.requestAnimationFrame(scroll)
    return () => { window.cancelAnimationFrame(frame) }
  }, [])
  // 数据就绪后再落位一次，并短暂锁住滚动监听：异步资料卡会改变上方高度，
  // 只靠挂载时的一次滚动会把目标留在判定线下方、让监听把高亮改回上一分区。
  const dataReady = profile !== null && plugins !== null && preferences.loaded
  useEffect(() => {
    const target = hashTarget.current
    if (!dataReady || target === null) return
    hashTarget.current = null
    spyLockUntil.current = Date.now() + 1200
    // 落位的同时重新激活目标：挂载期的滚动事件可能已把高亮改回上一分区。
    setSection(target)
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`settings-${target}`)?.scrollIntoView({ block: 'start' })
    })
    return () => { window.cancelAnimationFrame(frame) }
  }, [dataReady])

  /** 在页头状态里闪现一条保存结果，1.6s 后回到「偏好已同步」（原型同款）。 */
  const flashSaved = (section: Section): void => {
    setNotice({ section, key: 'stateSaved' })
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => { setNotice(null) }, 1600)
  }

  const saveAppearance = (
    patch: { preference?: 'light' | 'dark' | 'system'; fontSize?: number },
    onSettled?: () => void,
  ): void => {
    setBusy(true)
    try {
      updateTheme(patch)
      flashSaved('appearance')
      setError(null)
    } catch (failure) {
      setNotice(null)
      setError({ key: 'errorSettings', failure })
    } finally {
      setBusy(false)
      onSettled?.()
    }
  }

  /** 落盘字号；值未变时只丢弃草稿，避免一次无意义的写入。 */
  const commitFontSize = (next: number): void => {
    // 立即提交（pointerup / keyup / blur）要撤掉待触发的防抖，否则会重复写一次。
    if (fontCommitTimer.current !== null) {
      window.clearTimeout(fontCommitTimer.current)
      fontCommitTimer.current = null
    }
    if (next === preferences.theme.fontSize) {
      setFontDraft(null)
      return
    }
    // 落盘期间继续拖动时保留更新的草稿，避免滑块被旧一次写入的返回值拽回去。
    saveAppearance({ fontSize: next }, () => { setFontDraft(current => current === next ? null : current) })
  }

  /** 拖动/滚轮/辅助技术改变字号：停手 300ms 落盘，不依赖 pointerup/keyup。 */
  const previewFontSize = (next: number): void => {
    setFontDraft(next)
    if (fontCommitTimer.current !== null) window.clearTimeout(fontCommitTimer.current)
    fontCommitTimer.current = window.setTimeout(() => {
      fontCommitTimer.current = null
      commitFontSize(next)
    }, 300)
  }

  const saveLocale = (next: 'zh' | 'en'): void => {
    setBusy(true)
    try {
      updateLocalePreference(next)
      flashSaved('locale')
      setError(null)
    } catch (failure) {
      setNotice(null)
      setError({ key: 'errorSettings', failure })
    } finally {
      setBusy(false)
    }
  }

  /** 组合包开关：成功后刷新组合与清单（行数据随组合变化）。 */
  const toggleBundle = (bundle: ManagedBundleView, enabled: boolean): void => {
    setBundleBusy(bundle.name)
    setManageNotice(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; result: PluginChangeView }>('/plugins/bundles/enabled', {
          method: 'POST',
          body: { name: bundle.name, enabled },
        })
        setManageNotice(changeNotice(result.result))
        await Promise.all([loadBundles(), loadPlugins()])
      } catch (failure) {
        setManageNotice(failure instanceof ApiError && failure.code === 'PLUGIN_BUNDLE_NOT_MANAGED'
          ? { key: 'pluginErrorNotManaged', tone: 'error' }
          : { key: 'pluginErrorGeneric', tone: 'error', detail: describeError(failure) })
      } finally {
        setBundleBusy(null)
      }
    })()
  }

  /** 移除确认对话框里的组合包（原生移除检查与回滚由服务端完成）。 */
  const confirmRemoveBundle = (target: ManagedBundleView | null = removeTarget): void => {
    if (target === null) return
    setBundleBusy(target.name)
    setRemoveFailure(null)
    setManageNotice(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; result: PluginChangeView }>('/plugins/bundles/remove', {
          method: 'POST',
          body: { name: target.name },
        })
        setManageNotice(changeNotice(result.result))
        setRemoveTarget(null)
        await Promise.all([loadBundles(), loadPlugins()])
      } catch (failure) {
        // 失败留在确认框内（带重试）；页面级提示在 Modal 之下，用户看不到。
        setRemoveFailure({
          text: `${t('settings', 'pluginErrorGeneric')} — ${describeError(failure)}`,
          retry: () => { confirmRemoveBundle(target) },
        })
      } finally {
        setBundleBusy(null)
      }
    })()
  }

  /** 打开安装对话框并清空上一轮状态。 */
  const openInstallDialog = (): void => {
    setInstallOpen(true)
    setInstallSpec('')
    setInstallInspection(null)
    setInstallResult(null)
    setInstallError(null)
    setInstallRequestId(null)
  }

  /**
   * 安装：先读取规格，再安装；响应丢失时保留 requestId 供「检查安装状态」恢复。
   * @param approvedBuilds - 用户已批准的依赖脚本包名（「允许并重试」传上一轮的 pendingBuilds）。
   */
  const runInstall = (approvedBuilds: string[]): void => {
    const spec = installSpec.trim()
    if (spec === '') {
      setInstallError('pluginSpecRequired')
      return
    }
    const requestId = installRequestId ?? randomUUID()
    setInstallRequestId(requestId)
    setInstallBusy(true)
    setInstallError(null)
    setInstallResult(null)
    void (async () => {
      try {
        const inspected = await request<{ ok: true; inspection: PluginInspectionView }>('/plugins/inspect', {
          method: 'POST',
          body: { spec },
        })
        setInstallInspection(inspected.inspection)
        if (inspected.inspection.status === 'refused') {
          setInstallError(pluginErrorKey(inspected.inspection.problem))
          return
        }
        const installed = await request<{ ok: true; result: PluginChangeView }>('/plugins/install', {
          method: 'POST',
          body: { spec, requestId, enabled: true, ...(approvedBuilds.length === 0 ? {} : { approvedBuilds }) },
        })
        setInstallResult(installed.result)
        setManageNotice(changeNotice(installed.result))
        await Promise.all([loadBundles(), loadPlugins()])
      } catch (failure) {
        // 明确失败（已安装/不兼容/只读…）按具体原因呈现；只有网络与无法判断落地状态的
        // 失败才报「结果未知」，保留 requestId 供「检查安装状态」向服务端要最终结果。
        const key = installFailureKey(failure)
        setInstallError(key)
        setManageNotice({
          key,
          tone: 'error',
          detail: key === 'pluginInstallUnknown' ? describeError(failure) : undefined,
        })
      } finally {
        setInstallBusy(false)
      }
    })()
  }

  /** 停止正在进行的安装（文件回滚完成后服务端才返回）。 */
  const cancelInstall = (): void => {
    const requestId = installRequestId
    if (requestId === null) return
    void (async () => {
      try {
        const result = await request<{ ok: true; cancellation: 'cancelled' | 'too-late' | 'not-running' }>(
          `/plugins/install/${encodeURIComponent(requestId)}/cancel`,
          { method: 'POST' },
        )
        setInstallError(result.cancellation === 'cancelled'
          ? 'pluginCancelled'
          : result.cancellation === 'too-late' ? 'pluginCancelTooLate' : 'pluginCancelNotRunning')
      } catch (failure) {
        setManageNotice({ key: 'pluginErrorGeneric', tone: 'error', detail: describeError(failure) })
      }
    })()
  }

  /** 恢复一次丢失响应的安装结果。 */
  const recoverInstall = (): void => {
    const requestId = installRequestId
    if (requestId === null) return
    setInstallBusy(true)
    void (async () => {
      try {
        const result = await request<{ ok: true; result: PluginChangeView | null }>(
          `/plugins/install/${encodeURIComponent(requestId)}`,
        )
        if (result.result === null) {
          setInstallError('pluginCancelNotRunning')
          return
        }
        setInstallResult(result.result)
        setManageNotice(changeNotice(result.result))
        await Promise.all([loadBundles(), loadPlugins()])
      } catch (failure) {
        setManageNotice({ key: 'pluginErrorGeneric', tone: 'error', detail: describeError(failure) })
      } finally {
        setInstallBusy(false)
      }
    })()
  }

  const hostRows = plugins?.rows.filter(row => row.kind === 'host') ?? []
  const clientRows = plugins?.rows.filter(row => row.kind === 'client') ?? []
  const recordCount = hostRows.length + clientRows.length
  // 组合包总数以管理面（含安装自带的可选包）为准；未加载或非超管时回落到 profile 声明。
  const bundleTotal = bundles?.length ?? plugins?.profile.bundles.length ?? 0
  const fontSize = fontDraft ?? preferences.theme.fontSize

  /** 跳到某个分区（锚点滚动 + 高亮 + 地址 hash，便于复制成深链）。 */
  const jump = (id: Section): void => {
    setSection(id)
    // replaceState：分区切换不新增历史条目，后退仍是离开设置页而不是逐段回退。
    window.history.replaceState(null, '', `#settings-${id}`)
    // 原型 docs/05 §9：减少动态时不平滑滚动。
    document.getElementById(`settings-${id}`)?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  /** 页面滚动时把高亮跟到最近越过分区标题线的分区（锚点高亮）。 */
  const onScroll = (): void => {
    // 深链落位后的短暂窗口内不改写高亮：此时分区还在为异步内容让位。
    // 但滚动本身不能丢：锁结束时按当时的滚动位置补一次判定，否则用户先滚到底、
    // 锁过期后没有新滚动事件，高亮会停在深链目标上。
    const remaining = spyLockUntil.current - Date.now()
    if (remaining > 0) {
      if (spyTimer.current === null) {
        spyTimer.current = window.setTimeout(() => {
          spyTimer.current = null
          onScroll()
        }, remaining + 16)
      }
      return
    }
    const root = pageRef.current
    if (root === null) return
    // 顶部：首节标题仍在判定线下方（标题与留白占位），按「最近越线」会一个都不命中，
    // 高亮就停在上一次的分区（深链第 3 区 → 滚到顶部仍显示第 3 区）。
    if (root.scrollTop <= 0) {
      setSection(SECTIONS[0]?.id ?? 'general')
      return
    }
    // 与 `.section` 的 scroll-margin-top（顶栏 48 + 导航 56）保持一致。
    const line = root.getBoundingClientRect().top + 104
    let current: Section = 'general'
    for (const item of SECTIONS) {
      const element = document.getElementById(`settings-${item.id}`)
      if (element !== null && element.getBoundingClientRect().top <= line) current = item.id
    }
    setSection(current)
  }

  return (
    <div className={`${css.page} ${settingsCss.settingsPage}`} ref={pageRef} onScroll={onScroll}>
      <PageHeader
        title={t('settings', 'title')}
        subtitle={t('settings', 'subtitle')}
        actions={preferences.loaded && error === null
          ? (
            <span className={settingsCss.savedStatus} role="status" aria-live="polite">
              <span className={settingsCss.savedDot} aria-hidden="true" />
              {notice === null
                ? t('settings', 'savedStatus')
                : `${t('settings', SECTIONS.find(item => item.id === notice.section)?.labelKey ?? 'title')} · ${t('common', notice.key)}`}
            </span>
          )
          : undefined}
      />

      {/* 横向 sticky 分区导航：不占左侧竖栏（需求文档 §12.3 第 11 条）。 */}
      <nav className={settingsCss.nav} aria-label={t('settings', 'navAria')}>
        {SECTIONS.map(item => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? `${settingsCss.navItem} ${settingsCss.navItemActive}` : settingsCss.navItem}
            aria-current={section === item.id ? 'true' : undefined}
            onClick={() => { jump(item.id) }}
          >
            {t('settings', item.labelKey)}
          </button>
        ))}
      </nav>

      <NoticeLine
        tone="error"
        text={error === null ? null : `${t('settings', error.key)} — ${preferenceFailureText(error.failure)}`}
      />
      {/* 两份数据各有各的失败槽（见 state 声明处注释）；句子在渲染时取，切语言不会留下旧语言文案。 */}
      <NoticeLine
        tone="error"
        text={profileError === null ? null : `${t('settings', profileError.key)} — ${describeError(profileError.failure)}`}
        action={{ label: t('common', 'actionRetry'), onClick: () => { void loadProfile() } }}
      />
      <NoticeLine
        tone="error"
        text={pluginsError === null ? null : `${t('settings', pluginsError.key)} — ${describeError(pluginsError.failure)}`}
        action={{ label: t('common', 'actionRetry'), onClick: () => { void loadPlugins() } }}
      />

      <section className={settingsCss.section} id="settings-general">
        <div className={settingsCss.sectionHead}>
          <div className={settingsCss.sectionHeadText}>
            <h2 className={settingsCss.sectionTitle}>{t('settings', 'generalTitle')}</h2>
            <p className={settingsCss.sectionDesc}>{t('settings', 'generalDesc')}</p>
          </div>
          <span className={settingsCss.sectionMeta}>{t('settings', 'metaFramework')}</span>
        </div>
        {profile === null && profileError === null && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
        {profile !== null && (
          <>
            <div className={settingsCss.profileCard}>
              <span className={`${settingsCss.avatar} ${settingsCss.avatarInk}`}>{profile.username.slice(0, 1).toUpperCase()}</span>
              <div className={settingsCss.profileText}>
                <span className={settingsCss.profileName}>
                  {profile.username}
                  {profile.is_superuser && (
                    <Tag tone="info" className={`${settingsCss.badge} ${css.accentTag} ${css.statusTag}`}>
                      <span className={settingsCss.badgeDot} aria-hidden="true" />
                      {t('settings', 'superuserLabel')}
                    </Tag>
                  )}
                </span>
                <span className={settingsCss.profileEmail}>{profile.email ?? t('common', 'labelNone')}</span>
              </div>
              <Tag tone="neutral" className={settingsCss.badge}>{t('settings', 'currentUser')}</Tag>
            </div>
            <dl className={settingsCss.definition}>
              <div className={settingsCss.definitionRow}>
                <dt>{t('settings', 'usernameLabel')}</dt>
                <dd className={settingsCss.monoValue}>{profile.username}</dd>
              </div>
              <div className={settingsCss.definitionRow}>
                <dt>{t('settings', 'emailLabel')}</dt>
                <dd className={settingsCss.monoValue}>{profile.email ?? t('common', 'labelNone')}</dd>
              </div>
              <div className={settingsCss.definitionRow}>
                <dt>{t('settings', 'superuserLabel')}</dt>
                <dd>{profile.is_superuser ? t('common', 'stateYes') : t('common', 'stateNo')}</dd>
              </div>
              <div className={settingsCss.definitionRow}>
                <dt>{t('settings', 'createdAtLabel')}</dt>
                <dd className={settingsCss.monoValue}>
                  {formatDateOnly(profile.created_at) === '' ? t('common', 'labelNone') : formatDateOnly(profile.created_at)}
                </dd>
              </div>
              <div className={settingsCss.definitionRow}>
                <dt>{t('settings', 'lastLoginLabel')}</dt>
                <dd>{lastLoginText(profile.last_login) ?? t('common', 'labelNone')}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section className={settingsCss.section} id="settings-appearance">
        <div className={settingsCss.sectionHead}>
          <div className={settingsCss.sectionHeadText}>
            <h2 className={settingsCss.sectionTitle}>{t('settings', 'appearanceTitle')}</h2>
            <p className={settingsCss.sectionDesc}>{t('settings', 'appearanceDesc')}</p>
          </div>
          <span className={settingsCss.sectionMeta}>{t('settings', 'metaLocal')}</span>
        </div>

        <div className={settingsCss.field}>
          <div className={settingsCss.fieldLabel}>
            <span>{t('settings', 'themeLabel')}</span>
            <span className={settingsCss.fieldHint}>{t('settings', 'themeImmediate')}</span>
          </div>
          <div className={settingsCss.themeCards} role="radiogroup" aria-label={t('settings', 'themeLabel')}>
            {([
              { value: 'light', labelKey: 'themeLight', preview: settingsCss.previewLight },
              { value: 'dark', labelKey: 'themeDark', preview: settingsCss.previewDark },
              { value: 'system', labelKey: 'themeSystem', preview: settingsCss.previewSystem },
            ] as const).map(item => (
              <label
                key={item.value}
                className={preferences.theme.preference === item.value
                  ? `${settingsCss.themeCard} ${settingsCss.themeCardActive}`
                  : settingsCss.themeCard}
              >
                <input
                  type="radio"
                  className={css.srOnly}
                  name="settings-theme"
                  value={item.value}
                  checked={preferences.theme.preference === item.value}
                  disabled={busy}
                  onChange={() => { saveAppearance({ preference: item.value }) }}
                />
                <span className={`${settingsCss.themePreview} ${item.preview}`} aria-hidden="true">
                  <span className={settingsCss.themePreviewSide} />
                  <span className={settingsCss.themePreviewBody}>
                    <span />
                    <span />
                    <span />
                  </span>
                </span>
                <span className={settingsCss.themeChoiceLabel}>{t('common', item.labelKey)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={settingsCss.field}>
          <div className={settingsCss.fieldLabel}>
            <span>{t('settings', 'appearanceFontSize')}</span>
            <span className={settingsCss.fieldHint}>
              {t('settings', 'fontSizeValue', { size: fontSize })}
            </span>
          </div>
          <input
            type="range"
            className={settingsCss.range}
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            aria-label={t('settings', 'appearanceFontSize')}
            aria-valuetext={t('settings', 'fontSizeValue', { size: fontSize })}
            onChange={(event) => { previewFontSize(Number(event.currentTarget.value)) }}
            onPointerUp={(event) => { commitFontSize(Number(event.currentTarget.value)) }}
            onBlur={() => {
              // 失焦时把尚未落盘的草稿提交（键盘 Tab 离开、滚轮后直接走开都走这里）。
              if (fontDraft !== null) commitFontSize(fontDraft)
            }}
            onKeyUp={(event) => {
              if (RANGE_COMMIT_KEYS.has(event.key)) commitFontSize(Number(event.currentTarget.value))
            }}
          />
          <div
            className={settingsCss.fontPreview}
            style={{ fontSize: `${String(fontSize)}px` }}
          >
            <div className={settingsCss.fontPreviewTitle}>{t('settings', 'fontPreviewTitle')}</div>
            <p className={settingsCss.fontPreviewBody}>{t('settings', 'fontPreview')}</p>
          </div>
          <p className={`${settingsCss.fieldHint} ${settingsCss.fieldHintBlock}`}>{t('settings', 'fontPreviewHint')}</p>
        </div>
      </section>

      <section className={settingsCss.section} id="settings-locale">
        <div className={settingsCss.sectionHead}>
          <div className={settingsCss.sectionHeadText}>
            <h2 className={settingsCss.sectionTitle}>{t('settings', 'localeTitle')}</h2>
            <p className={settingsCss.sectionDesc}>{t('settings', 'localeDesc')}</p>
          </div>
          <span className={settingsCss.sectionMeta}>{document.documentElement.lang || locale}</span>
        </div>
        <div className={settingsCss.localeChoices}>
          {([
            { value: 'zh', titleKey: 'localeZhTitle', descKey: 'localeZhDesc' },
            { value: 'en', titleKey: 'localeEnTitle', descKey: 'localeEnDesc' },
          ] as const).map((item) => {
            const selected = locale === item.value
            return (
              <label
                key={item.value}
                className={selected ? `${settingsCss.radioCard} ${settingsCss.radioCardActive}` : settingsCss.radioCard}
              >
                <input
                  type="radio"
                  name="settings-locale"
                  value={item.value}
                  checked={selected}
                  disabled={busy}
                  onChange={() => { saveLocale(item.value) }}
                />
                <span className={settingsCss.radioText}>
                  <span className={settingsCss.radioTitle}>{t('settings', item.titleKey)}</span>
                  <span className={settingsCss.radioDesc}>{t('settings', item.descKey)}</span>
                </span>
              </label>
            )
          })}
        </div>
      </section>

      <section className={settingsCss.section} id="settings-plugins">
        <div className={settingsCss.sectionHead}>
          <div className={settingsCss.sectionHeadText}>
            <h2 className={settingsCss.sectionTitle}>{t('settings', 'pluginsTitle')}</h2>
            <p className={settingsCss.sectionDesc}>{t('settings', 'pluginsDesc')}</p>
          </div>
          <span className={settingsCss.sectionMeta}>
            {t('settings', 'metaBundles', { count: bundleTotal })}
          </span>
        </div>
        {plugins === null && pluginsError === null && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
        {plugins !== null && (
          <>
            <div className={settingsCss.pluginSummary}>
              <div className={settingsCss.pluginStat}>
                <span className={settingsCss.pluginStatValue}>{bundleTotal}</span>
                <span className={settingsCss.pluginStatLabel}>{t('settings', 'pluginsSummaryBundles')}</span>
              </div>
              <div className={settingsCss.pluginStat}>
                <span className={settingsCss.pluginStatValue}>{recordCount}</span>
                <span className={settingsCss.pluginStatLabel}>{t('settings', 'pluginsSummaryRecords')}</span>
              </div>
              <div className={settingsCss.pluginStat}>
                <span className={settingsCss.pluginStatValue}>{plugins.unresolved.length}</span>
                <span className={settingsCss.pluginStatLabel}>{t('settings', 'pluginsSummaryUnresolved')}</span>
              </div>
            </div>

            {canManagePlugins && (
              <div className={settingsCss.pluginManageBar}>
                <span className={settingsCss.pluginManageHint}>{t('settings', 'pluginsManageHint')}</span>
                <Button
                  icon={<IconPlusOutlineRegular size={14} />}
                  variant="outline"
                  onClick={openInstallDialog}
                >
                  {t('settings', 'pluginsInstall')}
                </Button>
              </div>
            )}
            {bundlesError !== null && (
              <NoticeLine
                tone="error"
                text={`${t('settings', bundlesError.key)} — ${describeError(bundlesError.failure)}`}
                action={{ label: t('common', 'actionRetry'), onClick: () => { void loadBundles() } }}
              />
            )}
            {manageNotice !== null && (
              <NoticeLine
                tone={manageNotice.tone}
                text={manageNotice.detail === undefined
                  ? t('settings', manageNotice.key)
                  : `${t('settings', manageNotice.key)} — ${manageNotice.detail}`}
              />
            )}

            <div className={settingsCss.pluginGroups}>
              <PluginGroup title={t('settings', 'pluginsBundles')} count={bundleTotal} full>
                {/* 组合包行：超管拿到管理面（开关 + 移除），普通用户与未加载时沿用只读行。 */}
                {bundles !== null
                  ? bundles.map((bundle) => {
                    const counts = plugins.profile.bundleCounts.find(item => item.name === bundle.name)
                    return (
                      <BundleRow
                        key={bundle.name}
                        bundle={bundle}
                        busy={bundleBusy === bundle.name}
                        editable={canManagePlugins}
                        {...(counts === undefined ? {} : { counts })}
                        onToggle={(enabled) => { toggleBundle(bundle, enabled) }}
                        onRemove={() => { setRemoveFailure(null); setRemoveTarget(bundle) }}
                      />
                    )
                  })
                  : plugins.profile.bundleCounts.map(bundle => (
                    <PluginRow
                      key={bundle.name}
                      glyph={<IconArchiveOutlineRegular size={14} />}
                      name={bundle.name}
                      description={bundle.description ?? t('common', 'labelNone')}
                      meta={(
                        <span className={settingsCss.pluginCount}>
                          {t('settings', 'bundleCounts', { host: bundle.hostCount, client: bundle.clientCount })}
                        </span>
                      )}
                    />
                  ))}
                {bundleTotal === 0 && <PluginEmpty />}
              </PluginGroup>

              <PluginGroup title={t('settings', 'pluginsHost')} count={hostRows.length}>
                {hostRows.map(row => (
                  <PluginRow
                    key={row.id}
                    glyph={<IconCordisPluginOutlineRegular size={14} />}
                    name={row.name}
                    description={row.version === null ? t('common', 'labelNone') : t('settings', 'pluginsVersion', { version: row.version })}
                    status={row.disabled}
                  />
                ))}
                {hostRows.length === 0 && <PluginEmpty />}
              </PluginGroup>

              <PluginGroup title={t('settings', 'pluginsClient')} count={clientRows.length}>
                {clientRows.map(row => (
                  <PluginRow
                    key={row.id}
                    glyph={<IconCordisPluginOutlineRegular size={14} />}
                    name={row.name}
                    description={row.version === null ? t('common', 'labelNone') : t('settings', 'pluginsVersion', { version: row.version })}
                    status={row.disabled}
                  />
                ))}
                {clientRows.length === 0 && <PluginEmpty />}
              </PluginGroup>

              <PluginGroup
                title={t('settings', 'pluginsUnresolved')}
                count={plugins.unresolved.length}
                full
              >
                {plugins.unresolved.map(entry => (
                  <PluginRow
                    key={entry.name}
                    glyph={<IconWarningTriangleOutlineRegular size={14} />}
                    name={entry.name}
                    description={entry.reason}
                    warning
                    meta={(
                      <Tag tone="outline" className={`${settingsCss.badge} ${css.statusTag}`}>
                        {t('settings', 'pluginsUnresolvedTag')}
                      </Tag>
                    )}
                  />
                ))}
                {plugins.unresolved.length === 0 && <PluginEmpty />}
              </PluginGroup>
            </div>
          </>
        )}
        <div className={settingsCss.pluginNotice} role="note">
          <span className={settingsCss.pluginNoticeIcon} aria-hidden="true">
            <IconWarningTriangleOutlineRegular size={16} />
          </span>
          <span>{t('settings', 'pluginsHmr')}</span>
        </div>
      </section>

      <Modal
        open={installOpen}
        onClose={() => { setInstallOpen(false) }}
        title={t('settings', 'pluginsInstallTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('settings', 'pluginsInstallDesc')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setInstallOpen(false) }}>{t('common', 'actionClose')}</Button>
            {installBusy && (
              <Button variant="outline" onClick={cancelInstall}>{t('settings', 'pluginCancelInstall')}</Button>
            )}
            <Button variant="primary" disabled={installBusy} onClick={() => { runInstall([]) }}>
              {installBusy ? t('settings', 'pluginInstalling') : t('common', 'actionInstall')}
            </Button>
          </>
        )}
      >
        <label className={settingsCss.installField}>
          <span className={settingsCss.installLabel}>{t('settings', 'pluginsInstallSpec')}</span>
          <Input
            value={installSpec}
            placeholder={t('settings', 'pluginsInstallPlaceholder')}
            disabled={installBusy}
            onChange={(event) => { setInstallSpec(event.currentTarget.value) }}
          />
        </label>
        {installError !== null && (
          <NoticeLine
            tone="error"
            text={t('settings', installError)}
            {...(installError === 'pluginInstallUnknown' && installRequestId !== null
              ? { action: { label: t('settings', 'pluginCheckInstall'), onClick: recoverInstall } }
              : {})}
          />
        )}
        {installInspection?.status === 'accepted' && installResult === null && (
          <p className={settingsCss.installInfo}>
            {installInspection.name ?? t('common', 'labelNone')}
            {installInspection.version === null ? '' : ` · ${t('settings', 'pluginsVersion', { version: installInspection.version })}`}
            {installInspection.description === null ? '' : ` — ${installInspection.description}`}
          </p>
        )}
        {installResult !== null && (
          <div className={settingsCss.installResult}>
            <NoticeLine tone={changeNotice(installResult).tone} text={t('settings', changeNotice(installResult).key)} />
            {installResult.pendingBuilds.length > 0 && (
              <>
                <p className={settingsCss.installInfo}>
                  {t('settings', 'pluginPendingBuilds', { names: installResult.pendingBuilds.join(', ') })}
                </p>
                <Button variant="outline" onClick={() => { runInstall(installResult.pendingBuilds) }}>
                  {t('settings', 'pluginApproveBuilds')}
                </Button>
              </>
            )}
            {installResult.error?.diagnostic != null && (
              <pre className={settingsCss.installDiagnostic}>{installResult.error.diagnostic}</pre>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={removeTarget !== null}
        onClose={() => { setRemoveTarget(null); setRemoveFailure(null) }}
        title={t('settings', 'pluginsRemoveTitle', { name: removeTarget?.name ?? '' })}
        closeLabel={t('common', 'actionClose')}
        description={t('settings', 'pluginsRemoveDesc')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRemoveTarget(null); setRemoveFailure(null) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="ghost"
              className={css.dangerButton}
              disabled={bundleBusy !== null}
              onClick={() => { confirmRemoveBundle() }}
            >
              {t('common', 'actionRemove')}
            </Button>
          </>
        )}
      >
        {/* 失败原因就地呈现在确认框内：页面级提示会被 Modal 遮住。 */}
        <NoticeLine
          tone="error"
          text={removeFailure === null ? null : removeFailure.text}
          {...(removeFailure === null
            ? {}
            : { action: { label: t('common', 'actionRetry'), onClick: removeFailure.retry } })}
        />
        <p className={css.cardBody}>{removeTarget?.name ?? ''}</p>
      </Modal>
    </div>
  )
}

/**
 * 一个组合包的管理行：启用开关 + 版本/描述 + 坏包原因 + 移除。
 * @param props.bundle - 管理面组合包行。
 * @param props.busy - 该行是否有操作在进行。
 * @param props.editable - 当前账号是否可改写（非超管只读）。
 * @param props.onToggle - 切换启用态。
 * @param props.onRemove - 请求移除（由调用方开确认框）。
 */
function BundleRow({ bundle, busy, editable, counts, onToggle, onRemove }: {
  bundle: ManagedBundleView
  busy: boolean
  editable: boolean
  /** 该组合包的 Host/Client 行计数（与原型的「Host x · Client y」同一口径）。 */
  counts?: { hostCount: number; clientCount: number }
  onToggle: (enabled: boolean) => void
  onRemove: () => void
}) {
  // 坏包不能启用（原生语义）；只读包（管理包/不可寻址）不给开关。
  const locked = bundle.error !== null || bundle.readOnlyReason !== null
  const toggleable = editable && !locked
  return (
    <div className={settingsCss.bundleRow}>
      <span className={settingsCss.pluginGlyph} aria-hidden="true">
        <IconArchiveOutlineRegular size={14} />
      </span>
      <div className={settingsCss.pluginMain}>
        <span className={settingsCss.pluginName}>{bundle.name}</span>
        <span className={settingsCss.pluginDesc}>
          {bundle.version === null ? t('common', 'labelNone') : t('settings', 'pluginsVersion', { version: bundle.version })}
          {bundle.description === null ? '' : ` · ${bundle.description}`}
        </span>
        {bundle.error !== null && (
          <span className={settingsCss.bundleError}>{t('settings', pluginErrorKey(bundle.error.code))}</span>
        )}
        {bundle.readOnlyReason !== null && (
          <span className={settingsCss.pluginDesc}>{bundle.readOnlyReason}</span>
        )}
        {counts !== undefined && (
          <span className={settingsCss.pluginCount}>
            {t('settings', 'bundleCounts', { host: counts.hostCount, client: counts.clientCount })}
          </span>
        )}
      </div>
      {editable && bundle.removable && (
        <button
          type="button"
          className={settingsCss.bundleRemove}
          aria-label={t('settings', 'pluginsRemove', { name: bundle.name })}
          disabled={busy}
          onClick={onRemove}
        >
          <IconTrashOutlineRegular size={14} />
        </button>
      )}
      {toggleable
        ? (
          <Switch
            checked={bundle.enabled}
            disabled={busy}
            label={t('settings', 'pluginsBundleSwitch', { name: bundle.name })}
            onChange={onToggle}
          />
        )
        : (
          <Tag tone="quiet" className={settingsCss.badge}>
            {bundle.error === null ? t('settings', 'pluginsReadOnly') : t('settings', 'pluginsBroken')}
          </Tag>
        )}
    </div>
  )
}

/** 插件分组的统一头与行容器。 */
function PluginGroup({ title, count, full = false, children }: {
  title: string
  count: number
  full?: boolean
  children: ReactNode
}) {
  return (
    <div className={full ? `${settingsCss.pluginGroup} ${settingsCss.pluginGroupFull}` : settingsCss.pluginGroup}>
      <div className={settingsCss.pluginGroupHead}>
        <h3>{title}</h3>
        <span className={settingsCss.sectionMeta}>{count}</span>
      </div>
      <div className={settingsCss.pluginRows}>{children}</div>
    </div>
  )
}

/** 一行插件（字形 + 名称 + 标识 + 状态/行尾附加内容）。 */
function PluginRow({ glyph, name, description, status, meta, warning = false }: {
  glyph: ReactNode
  name: string
  description: string
  status?: boolean
  /** 行尾附加内容（组合包计数、未解析标记）；与 `status` 不并用。 */
  meta?: ReactNode
  warning?: boolean
}) {
  return (
    <div className={warning ? `${settingsCss.pluginRow} ${settingsCss.pluginRowWarning}` : settingsCss.pluginRow}>
      <span className={settingsCss.pluginGlyph} aria-hidden="true">{glyph}</span>
      <div className={settingsCss.pluginMain}>
        <span className={settingsCss.pluginName}>{name}</span>
        <span className={settingsCss.pluginDesc}>{description}</span>
      </div>
      {status !== undefined && (
        <Tag tone={status ? 'quiet' : 'neutral'} className={settingsCss.badge}>
          {status ? t('settings', 'pluginsDisabled') : t('settings', 'pluginsEnabled')}
        </Tag>
      )}
      {meta}
    </div>
  )
}

/** 空分组。 */
function PluginEmpty() {
  return <div className={settingsCss.pluginEmpty}>{t('settings', 'pluginsEmpty')}</div>
}
