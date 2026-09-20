/** 设置页：通用 / 外观 / 语言 / 插件。 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { NumberStepper } from '../components/NumberStepper.tsx'
import { updateLocalePreference, updateTheme, usePreferences } from '../preferences.ts'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../theme.ts'
import type { PluginsView, UserView } from '../types.ts'
import css from '../styles/common.module.css'

/** 分节。 */
type Section = 'general' | 'appearance' | 'locale' | 'plugins'

/**
 * 渲染设置页。
 */
export function SettingsPage() {
  const locale = useLocale()
  const preferences = usePreferences()
  const [section, setSection] = useState<Section>('general')
  const [profile, setProfile] = useState<UserView | null>(null)
  const [plugins, setPlugins] = useState<PluginsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadProfile = useCallback(async (): Promise<void> => {
    try {
      const result = await request<{ ok: true; user: UserView }>('/auth/me')
      setProfile(result.user)
      setError(null)
    } catch (failure) {
      setError(`${t('settings', 'errorProfile')} — ${describeError(failure)}`)
    }
  }, [])

  const loadPlugins = useCallback(async (): Promise<void> => {
    try {
      const result = await request<{ ok: true } & PluginsView>('/plugins')
      setPlugins({ profile: result.profile, rows: result.rows, clientEntries: result.clientEntries, unresolved: result.unresolved })
      setError(null)
    } catch (failure) {
      setError(`${t('settings', 'errorPlugins')} — ${describeError(failure)}`)
    }
  }, [])

  useEffect(() => { void loadProfile() }, [loadProfile])
  useEffect(() => { void loadPlugins() }, [loadPlugins])

  const saveAppearance = (patch: { preference?: 'light' | 'dark' | 'system'; fontSize?: number }): void => {
    setBusy(true)
    void (async () => {
      try {
        await updateTheme(patch)
        setNotice(t('common', 'stateSaved'))
        setError(null)
      } catch (failure) {
        setError(`${t('settings', 'errorSettings')} — ${describeError(failure)}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  const saveLocale = (next: 'zh' | 'en'): void => {
    setBusy(true)
    void (async () => {
      try {
        await updateLocalePreference(next)
        setNotice(t('common', 'stateSaved'))
        setError(null)
      } catch (failure) {
        setError(`${t('settings', 'errorSettings')} — ${describeError(failure)}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  const hostRows = plugins?.rows.filter(row => row.kind === 'host') ?? []
  const clientRows = plugins?.rows.filter(row => row.kind === 'client') ?? []

  return (
    <div className={css.page}>
      <PageHeader title={t('settings', 'title')} subtitle={t('settings', 'subtitle')} />

      <div className={css.toolbar}>
        <Pill active={section === 'general'} onClick={() => { setSection('general') }}>{t('settings', 'navGeneral')}</Pill>
        <Pill active={section === 'appearance'} onClick={() => { setSection('appearance') }}>{t('settings', 'navAppearance')}</Pill>
        <Pill active={section === 'locale'} onClick={() => { setSection('locale') }}>{t('settings', 'navLocale')}</Pill>
        <Pill active={section === 'plugins'} onClick={() => { setSection('plugins') }}>{t('settings', 'navPlugins')}</Pill>
      </div>

      <NoticeLine tone="error" text={error} />
      <NoticeLine tone="error" text={preferences.error} />
      <NoticeLine tone="success" text={notice} />

      {section === 'general' && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('settings', 'generalProfile')}</div>
          {profile === null && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
          {profile !== null && (
            <div className={css.definition}>
              <span className={css.definitionLabel}>{t('settings', 'usernameLabel')}</span>
              <span className={css.definitionValue}>{profile.username}</span>
              <span className={css.definitionLabel}>{t('settings', 'emailLabel')}</span>
              <span className={css.definitionValue}>{profile.email ?? t('common', 'labelNone')}</span>
              <span className={css.definitionLabel}>{t('settings', 'superuserLabel')}</span>
              <span className={css.definitionValue}>{profile.is_superuser ? t('common', 'stateYes') : t('common', 'stateNo')}</span>
              <span className={css.definitionLabel}>{t('settings', 'createdAtLabel')}</span>
              <span className={css.definitionValue}>{profile.created_at ?? t('common', 'labelNone')}</span>
              <span className={css.definitionLabel}>{t('settings', 'lastLoginLabel')}</span>
              <span className={css.definitionValue}>{profile.last_login ?? t('common', 'labelNone')}</span>
            </div>
          )}
        </div>
      )}

      {section === 'appearance' && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('settings', 'appearanceTheme')}</div>
          <div className={css.fieldHint}>{t('settings', 'appearanceThemeHint')}</div>
          <div className={css.toolbar}>
            <Pill
              active={preferences.theme.preference === 'light'}
              onClick={() => { saveAppearance({ preference: 'light' }) }}
            >
              {t('common', 'themeLight')}
            </Pill>
            <Pill
              active={preferences.theme.preference === 'dark'}
              onClick={() => { saveAppearance({ preference: 'dark' }) }}
            >
              {t('common', 'themeDark')}
            </Pill>
            <Pill
              active={preferences.theme.preference === 'system'}
              onClick={() => { saveAppearance({ preference: 'system' }) }}
            >
              {t('common', 'themeSystem')}
            </Pill>
          </div>
          <div className={css.sectionTitle}>{t('settings', 'appearanceFontSize')}</div>
          <div className={css.fieldHint}>{t('settings', 'appearanceFontSizeHint')}</div>
          <div className={css.toolbar}>
            <NumberStepper
              label={t('settings', 'appearanceFontSize')}
              value={preferences.theme.fontSize}
              step={1}
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              placeholder={String(FONT_SIZE_MIN)}
              onChange={next => { if (next !== null) saveAppearance({ fontSize: next }) }}
            />
            <span className={css.stepperValue}>
              {t('common', 'fontSizeValue', { size: preferences.theme.fontSize })}
            </span>
            <Button size="sm" disabled={busy} onClick={() => { saveAppearance({ fontSize: preferences.theme.fontSize }) }}>
              {t('common', 'actionSave')}
            </Button>
          </div>
          <div className={css.fieldHint}>
            {t('settings', 'appearanceTheme')} · {preferences.theme.preference} · {preferences.themeRevision}
          </div>
        </div>
      )}

      {section === 'locale' && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('settings', 'localeLanguage')}</div>
          <div className={css.fieldHint}>{t('settings', 'localeLanguageHint')}</div>
          <div className={css.toolbar}>
            <Pill active={locale === 'zh'} onClick={() => { saveLocale('zh') }}>{t('common', 'languageZh')}</Pill>
            <Pill active={locale === 'en'} onClick={() => { saveLocale('en') }}>{t('common', 'languageEn')}</Pill>
            <span className={css.fieldHint}>{preferences.localeRevision}</span>
          </div>
        </div>
      )}

      {section === 'plugins' && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('settings', 'pluginsTitle')}</div>
          {plugins === null && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
          {plugins !== null && (
            <>
              <div className={css.definition}>
                <span className={css.definitionLabel}>{t('settings', 'pluginsProfile', { name: plugins.profile.name })}</span>
                <span className={css.definitionValue}>{plugins.profile.bundles.join(' / ')}</span>
              </div>
              <div className={css.sectionTitle}>{t('settings', 'pluginsHost')}</div>
              <PluginTable rows={hostRows} />
              <div className={css.sectionTitle}>{t('settings', 'pluginsClient')}</div>
              <PluginTable rows={clientRows} />
              <div className={css.sectionTitle}>{t('settings', 'pluginsClientEntries')}</div>
              <div className={css.chipRow}>
                {plugins.clientEntries.length === 0
                  ? <span className={css.fieldHint}>{t('common', 'labelNone')}</span>
                  : plugins.clientEntries.map(entry => <span key={entry} className={css.mono}>{entry}</span>)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 插件只读清单表。 */
function PluginTable({ rows }: { rows: PluginsView['rows'] }) {
  if (rows.length === 0) return <div className={css.empty}>{t('settings', 'pluginsEmpty')}</div>
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('common', 'labelName')}</th>
            <th>{t('common', 'labelId')}</th>
            <th>{t('common', 'labelType')}</th>
            <th>{t('common', 'labelStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td className={css.mono}>{row.id}</td>
              <td>{row.kind}</td>
              <td>
                <Tag tone={row.disabled ? 'warning' : 'success'}>
                  {row.disabled ? t('settings', 'pluginsDisabled') : t('common', 'stateActive')}
                </Tag>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
