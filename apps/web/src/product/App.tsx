/** 产品页面应用：路由分发 + 登录门禁 + 偏好加载。 */
import { useCallback, useEffect, useState } from 'react'
import { clearTokens, describeError, readAccessToken, request } from './api.ts'
import { t, useLocale } from './i18n.ts'
import { navigate, useRoute } from './router.ts'
import { loadPreferences, resetPreferences } from './preferences.ts'
import { AppShell } from './components/AppShell.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { CanvasesPage } from './pages/CanvasesPage.tsx'
import { CanvasEditorPage } from './pages/CanvasEditorPage.tsx'
import { ModelsPage } from './pages/ModelsPage.tsx'
import { SkillsPage } from './pages/SkillsPage.tsx'
import { SkillFilePage } from './pages/SkillFilePage.tsx'
import { McpPage } from './pages/McpPage.tsx'
import { MarketPage } from './pages/MarketPage.tsx'
import { PackagingPage } from './pages/PackagingPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import type { UserView } from './types.ts'
import css from './styles/common.module.css'

/** 已知路径前缀（未知路径落到画布列表）。 */
const KNOWN_PREFIXES: readonly string[] = [
  '/login', '/canvases', '/models', '/skills', '/mcp', '/market', '/packaging', '/settings',
]

/** 判定路径是否已知。 */
function isKnownPath(pathname: string): boolean {
  return KNOWN_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/** 产品页面根组件。 */
export function ProductApp() {
  useLocale()
  const route = useRoute()
  const [user, setUser] = useState<UserView | null>(null)
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 已有令牌时校验身份；失败即清令牌回到登录页。
  useEffect(() => {
    const token = readAccessToken()
    if (token === null) {
      setChecked(true)
      return
    }
    void (async () => {
      try {
        const result = await request<{ ok: true; user: UserView }>('/auth/me')
        setUser(result.user)
        await loadPreferences()
      } catch (failure) {
        clearTokens()
        setUser(null)
        setError(`${t('shell', 'panelError')} — ${describeError(failure)}`)
      } finally {
        setChecked(true)
      }
    })()
  }, [])

  // 未知路径 → 画布列表。
  useEffect(() => {
    if (!isKnownPath(route.pathname)) navigate('/canvases')
  }, [route.pathname])

  // 未登录且不在登录页 → 重定向登录。
  useEffect(() => {
    if (checked && user === null && route.name !== 'login') navigate('/login')
  }, [checked, user, route.name])

  // 已登录却在登录页 → 回到画布列表。
  useEffect(() => {
    if (user !== null && route.name === 'login') navigate('/canvases')
  }, [user, route.name])

  const onAuthenticated = useCallback((next: UserView) => {
    setUser(next)
    setError(null)
    void loadPreferences()
  }, [])

  const logout = useCallback(() => {
    void (async () => {
      try {
        await request('/auth/logout', { method: 'POST' })
      } catch (failure) {
        setError(`${t('shell', 'panelError')} — ${describeError(failure)}`)
      } finally {
        clearTokens()
        resetPreferences()
        setUser(null)
        navigate('/login')
      }
    })()
  }, [])

  if (!checked) {
    return <div className={css.empty}>{t('common', 'stateLoading')}</div>
  }

  if (route.name === 'login' || user === null) {
    return <LoginPage onAuthenticated={onAuthenticated} initialError={error} />
  }

  const page = (() => {
    switch (route.name) {
      case 'canvases': return <CanvasesPage user={user} />
      case 'canvas': return <CanvasEditorPage canvasId={route.params.id ?? ''} />
      case 'models': return <ModelsPage />
      case 'skills': return <SkillsPage />
      case 'skill': return <SkillFilePage skillId={route.params.id ?? ''} />
      case 'mcp': return <McpPage />
      case 'market': return <MarketPage />
      case 'packaging': return <PackagingPage canvasId={route.query.get('canvasId')} />
      case 'settings': return <SettingsPage />
      default: return <CanvasesPage user={user} />
    }
  })()

  return (
    <AppShell
      active={route.name}
      user={user}
      bleed={route.name === 'canvas'}
      onLogout={logout}
    >
      {page}
    </AppShell>
  )
}
