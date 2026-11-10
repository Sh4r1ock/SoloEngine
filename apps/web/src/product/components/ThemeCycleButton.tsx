/** 主题循环控件：浅色 → 深色 → 跟随系统（公开页与壳层共用同一实现）。 */
import { useSyncExternalStore } from 'react'
import {
  IconDarkOutlineRegular,
  IconFollowsystemOutlineRegular,
  IconLightOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { t } from '../i18n.ts'
import { preferenceFailureText, updateTheme } from '../preferences.ts'
import {
  applyThemePreference,
  currentContentFontSize,
  currentThemePreference,
  subscribeThemePreference,
  type ThemePreference,
} from '../theme.ts'
import css from '../styles/theme-cycle.module.css'

/** 下一个主题档位。 */
function nextPreference(value: ThemePreference): ThemePreference {
  if (value === 'light') return 'dark'
  if (value === 'dark') return 'system'
  return 'light'
}

/**
 * 主题循环按钮。
 * @param props.authenticated - 已登录时写服务端偏好；公开页只落本机首屏缓存。
 * @param props.showLabel - 是否在图标右侧显示当前档位（侧栏主题行）。
 * @param props.onError - 服务端写入失败时的提示文案回调（公开页不传，失败即保留原档）。
 * @param props.className - 附加类名（壳层/登录页的定位差异）。
 */
export function ThemeCycleButton({ authenticated, showLabel = false, onError, className }: {
  authenticated: boolean
  showLabel?: boolean
  onError?: (message: string) => void
  className?: string | undefined
}) {
  const preference = useSyncExternalStore(subscribeThemePreference, currentThemePreference, currentThemePreference)
  const label = t('common', preference === 'light' ? 'themeLight' : preference === 'dark' ? 'themeDark' : 'themeSystem')
  const Icon = preference === 'light'
    ? IconLightOutlineRegular
    : preference === 'dark' ? IconDarkOutlineRegular : IconFollowsystemOutlineRegular
  const cycle = (): void => {
    const next = nextPreference(preference)
    if (!authenticated) {
      applyThemePreference(next, currentContentFontSize())
      return
    }
    try {
      updateTheme({ preference: next })
    } catch (failure) {
      onError?.(`${t('common', 'errorTitle')} — ${preferenceFailureText(failure)}`)
    }
  }
  const text = `${t('common', 'themeCycle')} — ${label}`
  const classes = [css.button, showLabel ? css.withLabel : '', className ?? ''].filter(value => value !== '').join(' ')
  return (
    <button
      type="button"
      className={classes}
      aria-label={text}
      title={text}
      onClick={cycle}
    >
      <Icon size={showLabel ? 15 : 16} />
      {showLabel ? <span className={css.label}>{label}</span> : null}
    </button>
  )
}
