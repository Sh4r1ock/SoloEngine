/** 用户管理页（仅超管）：密集账号表格、启停、设/撤超管、重置口令与受保护规则。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconSearchOutlineRegular,
  IconUsersOutlineRegular,
  IconWarningTriangleOutlineRegular,
  Input,
  Menu,
  Modal,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import { Field } from '../components/Field.tsx'
import { useSearchShortcut } from '../components/useSearchShortcut.ts'
import { formatDateOnly, formatTimestamp } from '../utils/time.ts'
import { submitFormOnEnter } from '../utils/submitOnEnter.ts'
import type { UserAssetCounts, UserView, UserWithAssets } from '../types.ts'
import common from '../styles/common.module.css'
import css from '../styles/users.module.css'

/** 一次操作的忙碌态（按用户 + 动作区分，避免同一用户的多个按钮同时显示进行中）。 */
interface BusyState {
  id: string
  action: 'active' | 'superuser'
}

/**
 * 归属资产摘要（两行：基础资产与运行资产，保持列宽稳定）。
 * @param assets - 各资产表计数。
 * @returns 主行与次行文案。
 */
function assetsText(assets: UserAssetCounts): { main: string; extra: string } {
  return {
    main: t('users', 'assetsSummaryMain', {
      canvases: assets.canvases,
      projects: assets.projects,
      models: assets.models,
    }),
    extra: t('users', 'assetsSummaryExtra', {
      skills: assets.skills,
      mcpServers: assets.mcpServers,
      sessions: assets.sessions,
    }),
  }
}

/**
 * 最近登录的相对时间（原型 users.js:60「刚刚」「2 小时前」）。
 * @param value - 后端返回的 ISO 时间。
 * @returns 相对时间文案；null/不可解析时为 null，由调用方兜底。
 */
function lastLoginText(value: string | null): string | null {
  if (value === null || value === '') return null
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return t('users', 'relativeJustNow')
  if (minutes < 60) return t('users', 'relativeMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  return hours < 24
    ? t('users', 'relativeHours', { count: hours })
    : t('users', 'relativeDays', { count: Math.floor(hours / 24) })
}

/**
 * 把服务端守卫错误码翻成页面文案；其余错误走原始描述（fail loud，不吞原因）。
 * @param failure - 请求失败原因。
 * @returns 页面文案。
 */
function actionErrorText(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.code === 'USER_PROTECTED') return t('users', 'errorProtected')
    if (failure.code === 'LAST_SUPERUSER') return t('users', 'errorLastSuperuser')
    if (failure.code === 'USER_NOT_FOUND') return t('users', 'errorNotFound')
  }
  return `${t('users', 'errorAction')} — ${describeError(failure)}`
}

/**
 * 渲染用户管理页。
 * @param props.user - 当前登录用户（用于识别「自己」与超管可见性）。
 */
export function UsersPage({ user }: { user: UserView }) {
  useLocale()
  const [rows, setRows] = useState<UserWithAssets[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ text: string; retry: () => void } | null>(null)
  // 成功反馈走 Toast（原型 users.js:116/147/159/162 的 App.toast）。
  const toast = useToastHost()
  const [busy, setBusy] = useState<BusyState | null>(null)
  const [resetTarget, setResetTarget] = useState<UserView | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetFieldError, setResetFieldError] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  /** 重置口令输入框：口令过短时把焦点送回，避免用户再找输入位置（原型 users.js 同行为）。 */
  const resetPasswordRef = useRef<HTMLInputElement | null>(null)
  /** 提交门闩：Enter 连按时 state 尚未重渲染，必须在事件入口就挡住第二次 POST。 */
  const resetInFlight = useRef(false)

  // Ctrl/Cmd+K 聚焦搜索（原型 app.js:650-659 的全局快捷键）。
  useSearchShortcut(searchRef)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await request<{ ok: true; users: UserWithAssets[] }>('/users')
      setRows(result.users)
      setError(null)
    } catch (failure) {
      setError({ text: `${t('users', 'errorLoad')} — ${describeError(failure)}`, retry: () => { void load() } })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (keyword === '') return rows
    return rows.filter(row => `${row.username} ${row.email ?? ''}`.toLowerCase().includes(keyword))
  }, [rows, search])

  const act = (
    id: string,
    action: BusyState['action'],
    body: Record<string, unknown>,
    path: string,
    successText: string,
  ): void => {
    setBusy({ id, action })
    setError(null)
    void (async () => {
      try {
        await request(path, { method: 'POST', body })
        toast.show(successText, 'success')
        await load()
      } catch (failure) {
        setError({ text: actionErrorText(failure), retry: () => { act(id, action, body, path, successText) } })
      } finally {
        setBusy(null)
      }
    })()
  }

  const submitReset = (): void => {
    if (resetInFlight.current) return
    if (resetTarget === null) return
    if (resetPassword.length < 4) {
      setResetFieldError(t('users', 'passwordTooShort'))
      resetPasswordRef.current?.focus()
      return
    }
    resetInFlight.current = true
    setResetBusy(true)
    setResetError(null)
    setResetFieldError(null)
    void (async () => {
      try {
        await request(`/users/${resetTarget.id}/password`, { method: 'POST', body: { password: resetPassword } })
        toast.show(t('users', 'toastReset', { name: resetTarget.username }), 'success')
        setResetTarget(null)
        setResetPassword('')
        await load()
      } catch (failure) {
        setResetError(actionErrorText(failure))
      } finally {
        resetInFlight.current = false
        setResetBusy(false)
      }
    })()
  }

  if (!user.is_superuser) {
    return (
      <div className={common.page}>
        <PageHeader title={t('users', 'title')} subtitle={t('users', 'subtitle')} />
        <div className={common.empty}>{t('users', 'superuserOnly')}</div>
      </div>
    )
  }

  return (
    <div className={common.page}>
      <PageHeader
        title={t('users', 'title')}
        subtitle={t('users', 'subtitle')}
        actions={<Tag tone="neutral" className={css.badge}>{t('users', 'superuserView')}</Tag>}
      />

      <NoticeLine
        tone="error"
        text={error === null ? null : error.text}
        {...(error === null ? {} : { action: { label: t('common', 'actionRetry'), onClick: error.retry } })}
      />

      <div className={css.filterBar}>
        <Input
          ref={searchRef}
          className={css.searchInput ?? ''}
          icon={<IconSearchOutlineRegular size={16} />}
          type="search"
          value={search}
          placeholder={t('users', 'searchPlaceholder')}
          aria-label={t('users', 'searchAria')}
          onChange={(event) => { setSearch(event.currentTarget.value) }}
        />
        <span className={css.spacer} />
        <span className={css.currentAccount}>
          <span className={css.statusDotActive} aria-hidden="true" />
          {t('users', 'currentAccount', { username: user.username })}
        </span>
        <span className={css.count}>{t('users', 'countAccounts', { count: visible.length })}</span>
      </div>

      {loading && <div className={common.empty}>{t('common', 'stateLoading')}</div>}

      {(!loading || visible.length > 0) && (
        <div className={css.tableWrap} role="region" aria-label={t('users', 'title')} tabIndex={0}>
          <table className={css.table}>
            <thead>
              <tr>
                <th scope="col">{t('users', 'tableUser')}</th>
                <th scope="col">{t('users', 'tableStatus')}</th>
                <th scope="col">{t('users', 'tableAssets')}</th>
                <th scope="col">{t('users', 'tableCreated')}</th>
                <th scope="col">{t('users', 'tableLastLogin')}</th>
                <th scope="col">{t('users', 'tableManage')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const assets = assetsText(row.assets)
                const isSelf = row.id === user.id
                // 受保护判据来自后端（`protected` = 实例内置账号），页面不再硬编码账号名。
                const protectedAccount = isSelf || row.protected
                const resetBlocked = row.protected && !isSelf
                const busyHere = busy !== null && busy.id === row.id
                return (
                  <tr key={row.id}>
                    <td>
                      <div className={css.userCell}>
                        <span className={isSelf ? `${css.avatar} ${css.avatarInk}` : css.avatar}>
                          {row.username.slice(0, 1).toLowerCase()}
                        </span>
                        <div className={css.userText}>
                          <span className={css.userNameLine}>
                            <span className={css.userName}>{row.username}</span>
                            {row.is_superuser && (
                              <Tag tone="info" className={`${css.badge} ${common.accentTag} ${common.statusTag}`}>
                                <span className={css.badgeDot} aria-hidden="true" />
                                {t('users', 'badgeSuperuser')}
                              </Tag>
                            )}
                            {isSelf && <Tag tone="neutral" className={css.badge}>{t('users', 'badgeSelf')}</Tag>}
                            {!row.is_active && <Tag tone="quiet" className={css.badge}>{t('users', 'badgeDisabled')}</Tag>}
                            {row.protected && <Tag className={css.badge}>{t('users', 'badgeProtected')}</Tag>}
                          </span>
                          <span className={css.userEmail}>{row.email ?? t('common', 'labelNone')}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={css.statusCell}>
                        <span className={row.is_active ? css.statusDotActive : css.statusDot} aria-hidden="true" />
                        {row.is_active ? t('users', 'statusActive') : t('users', 'badgeDisabled')}
                      </span>
                    </td>
                    <td>
                      <span className={css.assets} title={`${assets.main} ${assets.extra}`}>
                        <span>{assets.main}</span>
                        <span>{assets.extra}</span>
                      </span>
                    </td>
                    <td className={css.timeMono}>{formatDateOnly(row.created_at) || t('common', 'labelNone')}</td>
                    <td className={css.time}>
                      {row.last_login === null
                        ? t('users', 'neverLoggedIn')
                        : lastLoginText(row.last_login) ?? formatTimestamp(row.last_login)}
                    </td>
                    <td className={css.actionCell}>
                      <Menu
                        open={menuId === row.id}
                        align="end"
                        portal
                        items={[
                          {
                            id: 'active',
                            label: row.is_active ? t('users', 'actionDisable') : t('users', 'actionEnable'),
                            disabled: busyHere || protectedAccount,
                          },
                          {
                            id: 'superuser',
                            label: row.is_superuser ? t('users', 'actionRevoke') : t('users', 'actionGrant'),
                            disabled: busyHere || protectedAccount,
                          },
                          { type: 'separator', id: 'separator' },
                          { id: 'reset', label: t('users', 'actionReset'), disabled: busyHere || resetBlocked },
                        ]}
                        onSelect={(id) => {
                          setMenuId(null)
                          if (id === 'active') {
                            act(row.id, 'active', { active: !row.is_active }, `/users/${row.id}/active`,
                              t('users', row.is_active ? 'toastDisabled' : 'toastEnabled', { name: row.username }))
                          }
                          if (id === 'superuser') {
                            act(row.id, 'superuser', { superuser: !row.is_superuser }, `/users/${row.id}/superuser`,
                              t('users', row.is_superuser ? 'toastSuperRevoked' : 'toastSuperGranted', { name: row.username }))
                          }
                          if (id === 'reset') {
                            setResetTarget(row)
                            setResetPassword('')
                            setResetError(null)
                            setResetFieldError(null)
                          }
                        }}
                        onClose={() => { setMenuId(null) }}
                        anchor={(
                          <Button size="sm" variant="outline" className={css.manageButton} disabled={busyHere} onClick={() => { setMenuId(menuId === row.id ? null : row.id) }}>
                            {t('users', 'manage')}
                          </Button>
                        )}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && error === null && visible.length === 0 && (
        <div className={css.empty}>
          <span className={css.emptyIcon} aria-hidden="true"><IconUsersOutlineRegular size={20} /></span>
          {/* 一个账号都没有 ≠ 过滤后无匹配：后者才该让人去改搜索关键词。 */}
          <p className={css.emptyTitle}>{t('users', rows.length === 0 ? 'empty' : 'noMatch')}</p>
          <p className={css.emptyDesc}>{t('users', rows.length === 0 ? 'emptyDesc' : 'noMatchDesc')}</p>
        </div>
      )}

      <div className={css.rules} role="note">
        <span className={css.rulesIcon} aria-hidden="true"><IconWarningTriangleOutlineRegular size={16} /></span>
        <span>{t('users', 'rulesNote')}</span>
      </div>

      <Modal
        open={resetTarget !== null}
        onClose={() => { setResetTarget(null) }}
        title={t('users', 'resetTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('users', 'resetDescription')}
        className={css.resetDialog ?? ''}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setResetTarget(null) }}>{t('common', 'actionCancel')}</Button>
            <Button
              type="submit"
              form="reset-password-form"
              variant="primary"
              disabled={resetBusy}
            >
              {t('users', 'resetConfirm')}
            </Button>
          </>
        )}
      >
        <form
          id="reset-password-form"
          className={common.form}
          onSubmit={(event) => { event.preventDefault(); submitReset() }}
          onKeyDown={submitFormOnEnter}
        >
          <NoticeLine tone="error" text={resetError} />
          <Field
            label={t('users', 'resetPasswordLabel')}
            hint={t('users', 'resetPasswordHint')}
            error={resetFieldError}
          >
            <Input
              ref={resetPasswordRef}
              data-modal-autofocus
              type="password"
              value={resetPassword}
              autoComplete="new-password"
              aria-invalid={resetFieldError === null ? undefined : true}
              onChange={(event) => {
                setResetPassword(event.currentTarget.value)
                setResetFieldError(null)
                setResetError(null)
              }}
            />
          </Field>
        </form>
      </Modal>
    </div>
  )
}
