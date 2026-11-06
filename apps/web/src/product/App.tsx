/** 产品页面应用：路由分发 + 登录门禁 + 偏好加载。 */
import { useCallback, useEffect, useState } from 'react'
import { isProductPagePathname } from '@soloengine/types'
import { ApiError, SESSION_EXPIRED_EVENT, clearTokens, describeError, readAccessToken, request } from './api.ts'
import { t, useLocale } from './i18n.ts'
import { navigate, runStartFlow, useRoute } from './router.ts'
import { loadPreferences, resetPreferences } from './preferences.ts'
import { AppShell } from './components/AppShell.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { NoticeLine } from './components/NoticeLine.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { StyleguidePage } from './pages/StyleguidePage.tsx'
import { CanvasesPage } from './pages/CanvasesPage.tsx'
import { CanvasEditorPage } from './pages/CanvasEditorPage.tsx'
import { ModelsPage } from './pages/ModelsPage.tsx'
import { SkillsPage } from './pages/SkillsPage.tsx'
import { SkillFilePage } from './pages/SkillFilePage.tsx'
import { McpPage } from './pages/McpPage.tsx'
import { MarketPage } from './pages/MarketPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { UsersPage } from './pages/UsersPage.tsx'
import { RunStartPage } from './pages/RunStartPage.tsx'
import type { UserView } from './types.ts'
import css from './styles/common.module.css'

/**
 * 判定路径是否已知（唯一名单在产品 URL 契约 `@soloengine/types` 的 `isProductPagePathname`）：
 * 产品面（含根路径 `/`）由本 SPA 渲染，面板面（`/run/*`）走 DSH 原生壳、不在此列。
 */
function isKnownPath(pathname: string): boolean {
  return isProductPagePathname(pathname) || runStartFlow(pathname) !== null
}

/**
 * 页面标题：原型逐页给 `<页面名> · SoloEngine`（`index.html:6` 等 13 页）。
 * 运行面板（`/run/*`）不在产品 SPA 内，标题由原生壳维护。
 * @param name - 当前路由名。
 * @returns 文档标题文案。
 */
function documentTitle(name: string): string {
  switch (name) {
    case 'home': return t('shell', 'docTitleHome')
    case 'login': return t('shell', 'docTitleLogin')
    case 'canvas': return t('shell', 'docTitleCanvas')
    case 'skills': return t('shell', 'docTitleSkills')
    case 'skill': return t('shell', 'docTitleSkill')
    case 'mcp': return t('shell', 'docTitleMcp')
    case 'models': return t('shell', 'docTitleModels')
    case 'market': return t('shell', 'docTitleMarket')
    case 'settings': return t('shell', 'docTitleSettings')
    case 'users': return t('shell', 'docTitleUsers')
    case 'styleguide': return t('shell', 'docTitleStyleguide')
    case 'runStart': return t('shell', 'docTitleRun')
    default: return t('shell', 'docTitleCanvases')
  }
}

/** 产品页面根组件。 */
export function ProductApp() {
  const locale = useLocale()
  const route = useRoute()
  const [user, setUser] = useState<UserView | null>(null)
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 进入登录页的原因决定提示语气：令牌失效是「会话过期」的提示（info），其余才是错误。
  const [errorTone, setErrorTone] = useState<'error' | 'info'>('error')

  /**
   * 探测身份：成功即进入产品；只有 401 / UNAUTHENTICATED 才算令牌失效（清令牌回登录页）。
   *
   * 其余失败（服务不可达、离线、5xx）不销毁令牌：这一轮只是「没问到」，清令牌会把一次
   * 网络抖动变成强制重新登录（实测 abort `/auth/me` 后当场落到 /login 且令牌被清空）。
   */
  const probe = useCallback(async (): Promise<void> => {
    if (readAccessToken() === null) {
      setChecked(true)
      return
    }
    try {
      // 探测请求必须有超时：服务端黑洞时不能把用户永久卡在「加载中」（R005/R006）。
      const result = await request<{ ok: true; user: UserView }>('/auth/me', {
        signal: AbortSignal.timeout(10000),
      })
      setUser(result.user)
      setError(null)
      loadPreferences()
    } catch (failure) {
      // 令牌失效（401 / UNAUTHENTICATED）是正常生命周期事件，不是产品故障：
      // 直接抛出机器码 `UNAUTHENTICATED: a valid access token is required` 会让用户
      // 在登录页看到一行原始接口错误（用户实测缺陷），故改用产品文案 + info 语气。
      const expired = failure instanceof ApiError && (failure.status === 401 || failure.code === 'UNAUTHENTICATED')
      // 账号被停用是终态：继续持有令牌只会反复失败，清令牌回登录页并给出明确原因。
      const disabled = failure instanceof ApiError && failure.status === 403 && failure.code === 'USER_DISABLED'
      if (expired || disabled) clearTokens()
      setUser(null)
      if (disabled) {
        setError(t('login', 'errorUserDisabled'))
        setErrorTone('error')
      } else {
        setError(expired ? t('shell', 'sessionExpired') : `${t('shell', 'panelError')} — ${describeError(failure)}`)
        setErrorTone(expired ? 'info' : 'error')
      }
    } finally {
      setChecked(true)
    }
  }, [])

  useEffect(() => { void probe() }, [probe])

  // 标题随路由与语言变化（原型逐页不同；语言切换后同页标题跟着换）。
  useEffect(() => { document.title = documentTitle(route.name) }, [route.name, locale])

  // 未知路径 → 画布列表（replace：规范化修正不应新增历史条目，否则后退会回到非法路径并被再次规范化，形成弹跳循环）。
  useEffect(() => {
    if (!isKnownPath(route.pathname)) navigate('/canvas', { replace: true })
  }, [route.pathname])

  // 未登录且不在登录页/首页 → 重定向登录。令牌还在（只是这一轮没问到服务器）时不重定向，
  // 否则「服务瞬断 → 被赶到登录页」依旧会把用户当成已退出。
  useEffect(() => {
    if (checked && user === null && readAccessToken() === null && route.name !== 'login' && route.name !== 'home'
      && route.name !== 'runStart') navigate('/login')
  }, [checked, user, route.name])

  // 已登录却在登录页 → 回到画布列表。
  useEffect(() => {
    if (user !== null && route.name === 'login') navigate('/canvas')
  }, [user, route.name])

  const onAuthenticated = useCallback((next: UserView) => {
    setUser(next)
    setError(null)
    loadPreferences()
  }, [])

  const logout = useCallback(() => {
    // 本地先清理并离开页面：服务端黑洞不能让用户卡在页面上（R009）。
    clearTokens()
    resetPreferences()
    setUser(null)
    navigate('/login')
    // 服务端登出是 best-effort（令牌自包含、无服务端会话表）；2s 超时后放弃。
    void request('/auth/logout', { method: 'POST', signal: AbortSignal.timeout(2000) }).catch(() => undefined)
  }, [])

  // 刷新失败（401 且刷新令牌不可用）：api 层清令牌并广播，这里回登录页并给出会话过期提示。
  useEffect(() => {
    const onExpired = (): void => {
      setUser(null)
      setError(t('shell', 'sessionExpired'))
      setErrorTone('info')
      navigate('/login')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () =>{  window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired) }
  }, [])

  // 产品首页是公开营销页：不等待身份探测，也不进管理面壳层。
  if (route.name === 'home') {
    return <HomePage authenticated={user !== null} />
  }

  if (!checked) {
    return <div className={css.empty}>{t('common', 'stateLoading')}</div>
  }

  if (route.name === 'login' || (user === null && readAccessToken() === null)) {
    return <LoginPage onAuthenticated={onAuthenticated} initialError={error} initialTone={errorTone} />
  }

  // 令牌仍在、这一轮身份探测没成功：留在当前路由，给出原因与就地重试，
  // 不把人当成已退出（重试沿用各页 `actionRetry` → 重新加载数据的同一惯例）。
  if (user === null) {
    return (
      <div className={css.page}>
        <NoticeLine
          tone="error"
          text={error}
          action={{ label: t('common', 'actionRetry'), onClick: () => { void probe() } }}
        />
      </div>
    )
  }

  const page = (() => {
    switch (route.name) {
      case 'styleguide': return <StyleguidePage />
      case 'canvases': return <CanvasesPage />
      case 'canvas': return <CanvasEditorPage canvasId={route.params.id ?? ''} user={user} />
      case 'models': return <ModelsPage />
      case 'skills': return <SkillsPage user={user} />
      case 'skill': return <SkillFilePage skillId={route.params.id ?? ''} />
      case 'mcp': return <McpPage />
      case 'market': return <MarketPage />
      case 'settings': return <SettingsPage />
      case 'users': return <UsersPage user={user} />
      case 'runStart': return <RunStartPage flowId={route.params.id ?? ''} />
      default: return <CanvasesPage />
    }
  })()

  // 编辑器是独立全屏工作面（原型 editor.html 没有应用壳层）：自带 56px 图标轨与 48px 顶栏。
  if (route.name === 'canvas') {
    return (
      <ErrorBoundary resetKey={`${route.pathname}?${route.query.toString()}`}>{page}</ErrorBoundary>
    )
  }

  return (
    <AppShell
      active={route.name === 'runStart' ? 'canvases' : route.name}
      user={user}
      wide={route.name === 'skill' || route.name === 'styleguide' || route.name === 'mcp'}
      onLogout={logout}
    >
      {/* resetKey 让路由身份变化时重置边界：否则一次渲染失败会把后续页面永久钉在降级态，
          切换路由也无法恢复（R24「单区块失败不拖垮整页」的前提是能从故障里走出来）。 */}
      <ErrorBoundary resetKey={`${route.pathname}?${route.query.toString()}`}>{page}</ErrorBoundary>
    </AppShell>
  )
}
