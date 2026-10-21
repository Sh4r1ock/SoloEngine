/** 应用外壳：左侧栏导航 + 底部主题/语言切换 + 内容区。 */
import type { ReactNode } from 'react'
import {
  Button,
  FishLogo,
  IconArchiveOutlineMedium,
  IconBranchOutlineRegular,
  IconBrowseOutlineRegular,
  IconDarkOutlineRegular,
  IconDataOutlineRegular,
  IconDatabaseOutlineRegular,
  IconFollowsystemOutlineRegular,
  IconLightOutlineRegular,
  IconSettingsOutlineRegular,
  IconSkillOutlineRegular,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { navigate, type RouteName } from '../router.ts'
import { t, useLocale } from '../i18n.ts'
import { preferenceFailureText, updateLocalePreference, updateTheme, usePreferences } from '../preferences.ts'
import { useToastHost } from './Toaster.tsx'
import type { UserView } from '../types.ts'
import css from '../styles/shell.module.css'

/** 一条导航项。 */
interface NavEntry {
  /** 命中的路由名（编辑页与列表页共用一项）。 */
  routes: RouteName[]
  path: string
  labelKey: string
  icon: ReactNode
}

const NAV: NavEntry[] = [
  { routes: ['canvases', 'canvas'], path: '/canvases', labelKey: 'navCanvases', icon: <IconBranchOutlineRegular size={16} /> },
  { routes: ['models'], path: '/models', labelKey: 'navModels', icon: <IconDataOutlineRegular size={16} /> },
  { routes: ['skills', 'skill'], path: '/skills', labelKey: 'navSkills', icon: <IconSkillOutlineRegular size={16} /> },
  { routes: ['mcp'], path: '/mcp', labelKey: 'navMcp', icon: <IconDatabaseOutlineRegular size={16} /> },
  { routes: ['market'], path: '/market', labelKey: 'navMarket', icon: <IconBrowseOutlineRegular size={16} /> },
  { routes: ['packaging'], path: '/packaging', labelKey: 'navPackaging', icon: <IconArchiveOutlineMedium size={16} /> },
  { routes: ['settings'], path: '/settings', labelKey: 'navSettings', icon: <IconSettingsOutlineRegular size={16} /> },
]

/**
 * 渲染外壳。
 * @param props.active - 当前路由名（用于高亮）。
 * @param props.user - 当前用户（可为空）。
 * @param props.bleed - 内容区是否全出血（编辑器）。
 * @param props.onLogout - 登出回调。
 * @param props.children - 页面内容。
 */
export function AppShell({ active, user, bleed = false, onLogout, children }: {
  active: RouteName
  user: UserView | null
  bleed?: boolean
  onLogout: () => void
  children: ReactNode
}) {
  const locale = useLocale()
  const preferences = usePreferences()
  const toast = useToastHost()

  const runPreference = (action: () => Promise<void>): void => {
    action().catch((failure: unknown) => {
      toast.show(`${t('common', 'errorTitle')} — ${preferenceFailureText(failure)}`)
    })
  }

  return (
    <div className={css.shell}>
      <aside className={css.sidebar}>
        <div className={css.brand}>
          <FishLogo size={22} />
          <span className={css.brandText}>{t('shell', 'brand')}</span>
        </div>
        <nav className={css.nav}>
          {NAV.map(entry => (
            <button
              key={entry.labelKey}
              type="button"
              className={entry.routes.includes(active) ? `${css.navItem} ${css.navItemActive}` : css.navItem}
              aria-current={entry.routes.includes(active) ? 'page' : undefined}
              onClick={() => { navigate(entry.path) }}
            >
              {entry.icon}
              <span>{t('shell', entry.labelKey)}</span>
            </button>
          ))}
        </nav>
        <div className={css.footer}>
          <div className={css.footerGroup}>
            <span className={css.footerLabel}>{t('common', 'themeLabel')}</span>
            <div className={css.footerRow}>
              {/* 原生 Pill 只把选中态写成 class，辅助技术读不到（实测 aria-pressed 全为 null，
                  WCAG 4.1.2）；与设置页/市场/打包各页同一惯例，产品层透传 aria-pressed。
                  图标按钮的名字由 aria-label 承担。 */}
              <Pill
                active={preferences.theme.preference === 'light'}
                aria-pressed={preferences.theme.preference === 'light'}
                aria-label={t('common', 'themeLight')}
                onClick={() => { runPreference(() => updateTheme({ preference: 'light' })) }}
              >
                <IconLightOutlineRegular size={14} />
              </Pill>
              <Pill
                active={preferences.theme.preference === 'dark'}
                aria-pressed={preferences.theme.preference === 'dark'}
                aria-label={t('common', 'themeDark')}
                onClick={() => { runPreference(() => updateTheme({ preference: 'dark' })) }}
              >
                <IconDarkOutlineRegular size={14} />
              </Pill>
              <Pill
                active={preferences.theme.preference === 'system'}
                aria-pressed={preferences.theme.preference === 'system'}
                aria-label={t('common', 'themeSystem')}
                onClick={() => { runPreference(() => updateTheme({ preference: 'system' })) }}
              >
                <IconFollowsystemOutlineRegular size={14} />
              </Pill>
            </div>
          </div>
          <div className={css.footerGroup}>
            <span className={css.footerLabel}>{t('common', 'languageLabel')}</span>
            <div className={css.footerRow}>
              <Pill
                active={locale === 'zh'}
                aria-pressed={locale === 'zh'}
                onClick={() => { runPreference(() => updateLocalePreference('zh')) }}
              >
                {t('common', 'languageZh')}
              </Pill>
              <Pill
                active={locale === 'en'}
                aria-pressed={locale === 'en'}
                onClick={() => { runPreference(() => updateLocalePreference('en')) }}
              >
                {t('common', 'languageEn')}
              </Pill>
            </div>
          </div>
          <div className={css.userRow}>
            <span className={css.userName}>
              {user === null ? t('shell', 'sidebarUser') : `${t('shell', 'sidebarUser')}: ${user.username}`}
            </span>
            <Button size="sm" variant="ghost" onClick={onLogout}>{t('shell', 'sidebarLogout')}</Button>
          </div>
        </div>
      </aside>
      <main className={css.main}>
        <div className={bleed ? css.mainBleed : css.mainScroll}>{children}</div>
        {toast.node}
      </main>
    </div>
  )
}
