/** 应用外壳：四组侧栏导航 + 48px 顶栏 + 三档内容列 + 底部主题/用户。 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  IconBranchOutlineRegular,
  IconBrowseOutlineRegular,
  IconDataOutlineRegular,
  IconDatabaseOutlineRegular,
  IconSettingsOutlineRegular,
  IconSkillOutlineRegular,
  IconUsersOutlineRegular,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { BrandGlyph } from '@deepseek-ai/dsh-client-ui-brand-official/src/static.ts'
import { navigate, type RouteName } from '../router.ts'
import { t, useLocale } from '../i18n.ts'
import { usePreferences } from '../preferences.ts'
import { ThemeCycleButton } from './ThemeCycleButton.tsx'
import { useToastHost } from './Toaster.tsx'
import type { UserView } from '../types.ts'
import css from '../styles/shell.module.css'

/** 侧栏折叠状态的本机键（设计规范：状态写入本机）。 */
const COLLAPSE_KEY = 'soloengine.sidebarCollapsed'

/** 应用侧栏转为抽屉的断点（设计参考 `docs/02-layout-and-navigation.md` §3：960px）。 */
const NARROW_QUERY = '(max-width: 960px)'

/** 视口是否处于窄屏（侧栏抽屉态）。 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => window.matchMedia(NARROW_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    const onChange = (): void => { setNarrow(query.matches) }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [])
  return narrow
}

/** 一条导航项。 */
interface NavEntry {
  /** 命中的路由名（编辑页与列表页共用一项）。 */
  routes: RouteName[]
  path: string
  labelKey: string
  icon: ReactNode
  /** 仅超管可见（用户管理；非超管既看不到入口，接口也会 403）。 */
  superuserOnly?: boolean
}

/** 一组导航（组间 24px + 0.5px 分隔线）。 */
interface NavGroup {
  /** 组标题（折叠轨隐藏）。 */
  labelKey: string
  entries: NavEntry[]
}

/** 四组导航：工作区 → 构建 → 交付 → 实例。 */
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'groupWorkspace',
    entries: [
      { routes: ['canvases', 'canvas'], path: '/canvas', labelKey: 'navCanvases', icon: <IconBranchOutlineRegular size={16} /> },
      { routes: ['market'], path: '/market', labelKey: 'navMarket', icon: <IconBrowseOutlineRegular size={16} /> },
    ],
  },
  {
    labelKey: 'groupBuild',
    entries: [
      { routes: ['models'], path: '/model', labelKey: 'navModels', icon: <IconDataOutlineRegular size={16} /> },
      { routes: ['skills', 'skill'], path: '/skill', labelKey: 'navSkills', icon: <IconSkillOutlineRegular size={16} /> },
      { routes: ['mcp'], path: '/mcp', labelKey: 'navMcp', icon: <IconDatabaseOutlineRegular size={16} /> },
    ],
  },
  {
    labelKey: 'groupInstance',
    entries: [
      { routes: ['settings'], path: '/settings', labelKey: 'navSettings', icon: <IconSettingsOutlineRegular size={16} /> },
      { routes: ['users'], path: '/user', labelKey: 'navUsers', icon: <IconUsersOutlineRegular size={16} />, superuserOnly: true },
    ],
  },
]

/** 非导航页在面包屑里的标题键。 */
const EXTRA_LABELS: Partial<Record<RouteName, string>> = {
  styleguide: 'navStyleguide',
  home: 'navCanvases',
}

/** 当前路由对应的导航项（编辑页与列表页共用一项）。 */
function activeEntry(active: RouteName): NavEntry | undefined {
  for (const group of NAV_GROUPS) {
    const found = group.entries.find(entry => entry.routes.includes(active))
    if (found !== undefined) return found
  }
  return undefined
}

/** 用户头像：首字母圆标（无头像资产，尺寸 28px），点击进入账户设置。 */
function Avatar({ user }: { user: UserView | null }) {
  const name = user?.username ?? ''
  const initial = name.slice(0, 1).toLowerCase() || '?'
  return (
    <button
      type="button"
      className={`${css.avatar} ${css.avatarButton}`}
      title={t('shell', 'avatarLabel', { name })}
      aria-label={t('shell', 'avatarLabel', { name })}
      onClick={() => { navigate('/settings') }}
    >
      {initial}
    </button>
  )
}

/**
 * 渲染外壳。
 * @param props.active - 当前路由名（用于高亮）。
 * @param props.user - 当前用户（可为空）。
 * @param props.bleed - 内容区是否全出血（编辑器）。
 * @param props.wide - 内容列是否使用 1240 工作台宽度（否则 1120）。
 * @param props.onLogout - 登出回调。
 * @param props.children - 页面内容。
 */
export function AppShell({ active, user, bleed = false, wide = false, onLogout, children }: {
  active: RouteName
  user: UserView | null
  bleed?: boolean
  wide?: boolean
  onLogout: () => void
  children: ReactNode
}) {
  useLocale()
  usePreferences()
  const toast = useToastHost()
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  /** 收起/展开侧栏；状态只写本机（设计规范：折叠状态写入本机）。 */
  const toggleCollapsed = (): void => {
    setCollapsed((value) => {
      const next = !value
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        // 存储不可用时布局仍按内存值切换，只丢失下次进入的偏好。
      }
      return next
    })
  }
  const labelKey = activeEntry(active)?.labelKey ?? EXTRA_LABELS[active] ?? 'navCanvases'
  const narrow = useNarrow()
  /**
   * 窄屏抽屉始终按展开档渲染：折叠只是桌面偏好，进入抽屉后仍要能读到完整导航、
   * 用户信息与登出。`collapsed` 本身不被改写，窗口变宽后原偏好照旧生效。
   */
  const effectiveCollapsed = collapsed && !narrow
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  useEffect(() => {
    if (!narrow) setDrawerOpen(false)
  }, [narrow])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [drawerOpen])

  return (
    <div className={css.shell} data-collapsed={effectiveCollapsed ? '' : undefined} data-narrow={narrow ? '' : undefined}>
      <a className={css.skip} href="#main-content">{t('shell', 'skipToMain')}</a>
      {narrow && drawerOpen ? (
        <button
          type="button"
          className={css.scrim}
          aria-label={t('shell', 'closeMenu')}
          onClick={() => { setDrawerOpen(false) }}
        />
      ) : null}
      <aside className={css.sidebar} aria-label={t('shell', 'mainNav')} data-open={drawerOpen ? '' : undefined}>
        <button type="button" className={css.brand} aria-label={t('shell', 'brandHome')} onClick={() => { navigate('/') }}>
          <BrandGlyph size={22} />
          <span className={css.brandWords}>
            <span className={css.brandText}>{t('shell', 'brand')}</span>
            <span className={css.brandTag}>{t('shell', 'devPreview')}</span>
          </span>
        </button>
        <nav className={css.nav}>
          {NAV_GROUPS.map((group, index) => {
            const entries = group.entries.filter(entry => entry.superuserOnly !== true || user?.is_superuser === true)
            if (entries.length === 0) return null
            return (
              <div key={group.labelKey} className={index === 0 ? css.navGroup : `${css.navGroup} ${css.navGroupDivided}`}>
                <span className={css.groupLabel}>{t('shell', group.labelKey)}</span>
                {entries.map((entry) => {
                  const current = entry.routes.includes(active)
                  return (
                    <button
                      key={entry.labelKey}
                      type="button"
                      className={current ? `${css.navItem} ${css.navItemActive}` : css.navItem}
                      aria-current={current ? 'page' : undefined}
                      title={effectiveCollapsed ? t('shell', entry.labelKey) : undefined}
                      onClick={() => { setDrawerOpen(false); navigate(entry.path) }}
                    >
                      <span className={css.navIcon}>{entry.icon}</span>
                      <span className={css.navLabel}>{t('shell', entry.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
        <div className={css.footer}>
          <ThemeCycleButton
            showLabel={!effectiveCollapsed}
            authenticated
            className={css.footerTheme}
            onError={(message) => { toast.show(message, 'error') }}
          />
          <div className={css.userRow}>
            <button type="button" className={css.userIdentity} onClick={() => { navigate('/settings') }}>
              <span className={`${css.avatar} ${css.avatarInk}`} aria-hidden="true">
                {(user?.username ?? '?').slice(0, 1).toLowerCase()}
              </span>
              <span className={css.userMeta}>
                <span className={css.userName}>{user?.username ?? t('shell', 'sidebarUser')}</span>
                <span className={css.userRole}>
                  {user?.is_superuser === true ? t('shell', 'roleSuperuser') : t('shell', 'roleMember')}
                  {' · '}
                  {t('shell', 'devPreview')}
                </span>
              </span>
            </button>
            <button type="button" className={css.logout} aria-label={t('shell', 'sidebarLogout')} title={t('shell', 'sidebarLogout')} onClick={() => { setLogoutOpen(true) }}>
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M8 4H5v12h3M12 7l3 3-3 3M15 10H8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
      <main className={css.main}>
        <header className={css.topbar}>
          <button
            type="button"
            className={css.collapse}
            aria-label={t('shell', narrow ? (drawerOpen ? 'closeMenu' : 'openMenu') : (collapsed ? 'expandSidebar' : 'collapseSidebar'))}
            aria-expanded={narrow ? drawerOpen : !collapsed}
            onClick={narrow ? () => { setDrawerOpen(value => !value) } : toggleCollapsed}
          >
            {narrow ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d={collapsed ? 'M6 3l5 5-5 5' : 'M10 3L5 8l5 5'}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <nav className={css.breadcrumb} aria-label={t('shell', 'breadcrumbNav')}>
            <span className={css.breadcrumbRoot}>{t('shell', 'breadcrumbRoot')}</span>
            <span className={css.breadcrumbSep} aria-hidden="true">/</span>
            <span className={css.breadcrumbCurrent}>{t('shell', labelKey)}</span>
          </nav>
          <div className={css.topbarActions}>
            <span className={css.previewBadge}><span className={css.previewDot} />{t('shell', 'devPreview')}</span>
            <button type="button" className={css.topbarLink} onClick={() => { navigate('/styleguide') }}>
              <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
                <path d="m10 2 7 4-7 4-7-4 7-4Zm7 8-7 4-7-4m14 4-7 4-7-4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              {t('shell', 'navStyleguide')}
            </button>
            <ThemeCycleButton
              authenticated
              onError={(message) => { toast.show(message, 'error') }}
            />
            <Avatar user={user} />
          </div>
        </header>
        <div id="main-content" tabIndex={-1} className={bleed ? css.mainBleed : css.mainScroll}>
          {bleed ? children : <div className={css.content} data-width={wide ? 'wide' : 'default'}>{children}</div>}
        </div>
      </main>
      <Modal
        open={logoutOpen}
        onClose={() => { setLogoutOpen(false) }}
        title={t('shell', 'logoutConfirmTitle')}
        description={t('shell', 'logoutConfirmDescription')}
        closeLabel={t('common', 'actionClose')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setLogoutOpen(false) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setLogoutOpen(false)
                onLogout()
              }}
            >
              {t('shell', 'logoutConfirm')}
            </Button>
          </>
        )}
      />
    </div>
  )
}
