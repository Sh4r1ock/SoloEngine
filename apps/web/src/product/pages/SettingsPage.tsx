/** 设置页：通用 / 外观 / 语言 / 插件。 */
import { useCallback, useEffect, useState } from 'react'
import { Pill, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { formatTimestamp } from '../utils/time.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { NumberStepper } from '../components/NumberStepper.tsx'
import { loadPreferences, preferenceFailureText, updateLocalePreference, updateTheme, usePreferences, type PreferencesError } from '../preferences.ts'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../theme.ts'
import type { PluginsView, UserView } from '../types.ts'
import css from '../styles/common.module.css'

/** 分节。 */
type Section = 'general' | 'appearance' | 'locale' | 'plugins'

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

/** 偏好存储错误 → 当前语言句子（值非法走文案键，读写异常走 describeError）。 */
function preferencesErrorText(error: PreferencesError): string {
  const reason = error.failure === undefined
    ? error.invalidKeys.map(key => t('common', key)).join(' ')
    : describeError(error.failure)
  return `${t('settings', 'errorSettings')} — ${reason}`
}

/**
 * 渲染设置页。
 */
export function SettingsPage() {
  const locale = useLocale()
  const preferences = usePreferences()
  const [section, setSection] = useState<Section>('general')
  const [profile, setProfile] = useState<UserView | null>(null)
  const [plugins, setPlugins] = useState<PluginsView | null>(null)
  const [error, setError] = useState<NoticeItem | null>(null)
  // 两份数据各有各的失败槽：共用一个 `error` 时，先失败的那份会被后成功的那份
  // `setError(null)` 抹掉（实测阻断 /auth/me 后界面只剩「加载中…」，一行错误都没有）。
  const [profileError, setProfileError] = useState<NoticeItem | null>(null)
  const [pluginsError, setPluginsError] = useState<NoticeItem | null>(null)
  // 成功提示必须带出处：`已保存` 不带主语，跨分节留存会让人以为「当前分节已保存」，
  // 且会与随后一次失败写入同屏并存（实测 `偏好读写失败 …` 与 `已保存` 同时出现）。
  const [notice, setNotice] = useState<{ section: Section; key: string } | null>(null)
  const [busy, setBusy] = useState(false)

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

  useEffect(() => { void loadProfile() }, [loadProfile])
  useEffect(() => { void loadPlugins() }, [loadPlugins])

  const saveAppearance = (patch: { preference?: 'light' | 'dark' | 'system'; fontSize?: number }): void => {
    setBusy(true)
    void (async () => {
      try {
        await updateTheme(patch)
        setNotice({ section: 'appearance', key: 'stateSaved' })
        setError(null)
      } catch (failure) {
        setNotice(null)
        setError({ key: 'errorSettings', failure })
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
        setNotice({ section: 'locale', key: 'stateSaved' })
        setError(null)
      } catch (failure) {
        setNotice(null)
        setError({ key: 'errorSettings', failure })
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
        {/* 原生 Pill 只把选中态写成 class，辅助技术读不到（WCAG 4.1.2）；与语言/市场/打包
            各页同一惯例，产品层透传 aria-pressed。 */}
        <Pill active={section === 'general'} aria-pressed={section === 'general'} onClick={() => { setSection('general') }}>{t('settings', 'navGeneral')}</Pill>
        <Pill active={section === 'appearance'} aria-pressed={section === 'appearance'} onClick={() => { setSection('appearance') }}>{t('settings', 'navAppearance')}</Pill>
        <Pill active={section === 'locale'} aria-pressed={section === 'locale'} onClick={() => { setSection('locale') }}>{t('settings', 'navLocale')}</Pill>
        <Pill active={section === 'plugins'} aria-pressed={section === 'plugins'} onClick={() => { setSection('plugins') }}>{t('settings', 'navPlugins')}</Pill>
      </div>

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
      <NoticeLine
        tone="error"
        text={preferences.error === null ? null : preferencesErrorText(preferences.error)}
        action={{ label: t('common', 'actionRetry'), onClick: () => { void loadPreferences() } }}
      />
      <NoticeLine tone="success" text={notice !== null && notice.section === section ? t('common', notice.key) : null} />

      {section === 'general' && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('settings', 'generalProfile')}</div>
          {profile === null && profileError === null && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
          {profile !== null && (
            <div className={css.definition}>
              <span className={css.definitionLabel}>{t('settings', 'usernameLabel')}</span>
              <span className={css.definitionValue}>{profile.username}</span>
              <span className={css.definitionLabel}>{t('settings', 'emailLabel')}</span>
              <span className={css.definitionValue}>{profile.email ?? t('common', 'labelNone')}</span>
              <span className={css.definitionLabel}>{t('settings', 'superuserLabel')}</span>
              <span className={css.definitionValue}>{profile.is_superuser ? t('common', 'stateYes') : t('common', 'stateNo')}</span>
              <span className={css.definitionLabel}>{t('settings', 'createdAtLabel')}</span>
              <span className={css.definitionValue}>
                {formatTimestamp(profile.created_at) === '' ? t('common', 'labelNone') : formatTimestamp(profile.created_at)}
              </span>
              <span className={css.definitionLabel}>{t('settings', 'lastLoginLabel')}</span>
              <span className={css.definitionValue}>
                {formatTimestamp(profile.last_login) === '' ? t('common', 'labelNone') : formatTimestamp(profile.last_login)}
              </span>
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
              aria-pressed={preferences.theme.preference === 'light'}
              disabled={busy}
              onClick={() => { saveAppearance({ preference: 'light' }) }}
            >
              {t('common', 'themeLight')}
            </Pill>
            <Pill
              active={preferences.theme.preference === 'dark'}
              aria-pressed={preferences.theme.preference === 'dark'}
              disabled={busy}
              onClick={() => { saveAppearance({ preference: 'dark' }) }}
            >
              {t('common', 'themeDark')}
            </Pill>
            <Pill
              active={preferences.theme.preference === 'system'}
              aria-pressed={preferences.theme.preference === 'system'}
              disabled={busy}
              onClick={() => { saveAppearance({ preference: 'system' }) }}
            >
              {t('common', 'themeSystem')}
            </Pill>
          </div>
          <div className={css.sectionTitle}>{t('settings', 'appearanceFontSize')}</div>
          <div className={css.fieldHint}>{t('settings', 'appearanceFontSizeHint')}</div>
          <div className={css.toolbar}>
            {/* 值只显示一次：步进器内已有当前值，右侧再放一枚 `14px` 是同一事实的两种写法
                （实测同行文本 `14` + `14px`）；单位由标签「内容字号」与提示「12 ~ 17」承担，
                与画布编辑器节点面板的采样步进器（温度/max_tokens 只显示裸值）同形。 */}
            <NumberStepper
              label={t('settings', 'appearanceFontSize')}
              value={preferences.theme.fontSize}
              step={1}
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              placeholder={String(FONT_SIZE_MIN)}
              clearableAtMin={false}
              disabled={busy}
              onChange={(next) => { if (next !== null) saveAppearance({ fontSize: next }) }}
            />
          </div>
        </div>
      )}

      {section === 'locale' && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('settings', 'localeLanguage')}</div>
          <div className={css.fieldHint}>{t('settings', 'localeLanguageHint')}</div>
          <div className={css.toolbar}>
            <Pill active={locale === 'zh'} aria-pressed={locale === 'zh'} disabled={busy} onClick={() => { saveLocale('zh') }}>{t('common', 'languageZh')}</Pill>
            <Pill active={locale === 'en'} aria-pressed={locale === 'en'} disabled={busy} onClick={() => { saveLocale('en') }}>{t('common', 'languageEn')}</Pill>
          </div>
        </div>
      )}

      {section === 'plugins' && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('settings', 'pluginsTitle')}</div>
          {plugins === null && pluginsError === null && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
          {plugins !== null && (
            <>
              <div className={css.definition}>
                <span className={css.definitionLabel}>{t('settings', 'pluginsBundles')}</span>
                <span className={css.definitionValue}>{plugins.profile.name}</span>
                <span className={css.definitionLabel}>{t('settings', 'pluginsBundlesList')}</span>
                <span className={css.definitionValue}>{plugins.profile.bundles.join(' / ')}</span>
              </div>
              {/* 声明了却解析不出条目的插件必须露出来：`unresolved` 此前被读取、被存进 state，
                  但界面上没有任何呈现——解析失败在页面上完全不可见。放在两张清单之前，
                  因为它是「这份清单不完整」的说明。语气色 Tag 沿用 statusTag 的文字补偿。 */}
              {plugins.unresolved.length > 0 && (
                <>
                  <div className={css.sectionTitle}>{t('settings', 'pluginsUnresolved')}</div>
                  <div className={css.chipRow}>
                    {plugins.unresolved.map(name => (
                      <Tag key={name} tone="warning" className={`${css.mono} ${css.statusTag}`}>{name}</Tag>
                    ))}
                  </div>
                </>
              )}
              <div className={css.sectionTitle}>{t('settings', 'pluginsHost')}</div>
              <PluginTable rows={hostRows} label={t('settings', 'pluginsHost')} />
              <div className={css.sectionTitle}>{t('settings', 'pluginsClient')}</div>
              <PluginTable rows={clientRows} label={t('settings', 'pluginsClient')} />
              <div className={css.sectionTitle}>{t('settings', 'pluginsClientEntries')}</div>
              <div className={css.chipRow}>
                {plugins.clientEntries.length === 0
                  ? <span className={css.fieldHint}>{t('common', 'labelNone')}</span>
                  /* chipRow 的同类元素全站一律 Tag（技能/MCP/市场/打包）；此前是裸 mono span
                     串成一行，实测 6 项无分隔视觉粘连（R3 / §二c）。入口名保持等宽。 */
                  : plugins.clientEntries.map(entry => <Tag key={entry} tone="neutral" className={css.mono}>{entry}</Tag>)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** 插件只读清单表。 */
function PluginTable({ rows, label }: { rows: PluginsView['rows']; label: string }) {
  if (rows.length === 0) return <div className={css.empty}>{t('settings', 'pluginsEmpty')}</div>
  return (
    // 横向滚动容器必须同时是「有名字的 region」（与模型页 tableWrap 同一惯例）：
    // 实测 880 下 scrollWidth 820 > clientWidth 598，键盘方向键可滚（scrollLeft 0→80），
    // 但区域此前 `role`/`aria-label` 全空，读屏器进入滚动区时听不出这是哪张表。
    //
    // 列只有 名称/标识/状态：`kind` 不占列——两张表各只装一种 kind，实测 180 行的该列
    // 值与其所属分节标题（Host 侧 / Client 侧）逐字相同，删掉它既去掉零信息列，
    // 也去掉一列未译的服务端枚举。
    <div className={css.tableWrap} tabIndex={0} role="region" aria-label={label}>
      <table className={`${css.table} ${css.tableFit}`}>
        <thead>
          <tr>
            <th>{t('common', 'labelName')}</th>
            <th>{t('common', 'labelId')}</th>
            <th>{t('common', 'labelStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td className={css.mono}>{row.id}</td>
              <td>
                {/* 语气色 Tag 的文字对比度补偿（F22 同规则）：原生 tone 下实测
                    「启用」2.09、「已停用」1.96（需 4.5），本页 180 个文本节点不达标。 */}
                <Tag tone={row.disabled ? 'warning' : 'success'} className={css.statusTag}>
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
