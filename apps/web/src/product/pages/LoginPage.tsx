/** 登录 / 注册页。 */
import { useState } from 'react'
import { Button, FishLogo, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { request, storeTokens, describeError } from '../api.ts'
import { t } from '../i18n.ts'
import { navigate } from '../router.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import type { AuthResult, UserView } from '../types.ts'
import css from '../styles/login.module.css'

/**
 * 渲染登录页。
 * @param props.onAuthenticated - 登录成功回调（拿到用户视图）。
 * @param props.initialError - 进入登录页前的失败原因（令牌失效等）。
 */
export function LoginPage({ onAuthenticated, initialError = null }: {
  onAuthenticated: (user: UserView) => void
  initialError?: string | null
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)

  const submit = (): void => {
    if (username.trim() === '' || password === '') {
      setError(t('login', 'errorMissingFields'))
      return
    }
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        if (mode === 'register') {
          await request<{ ok: true; user: UserView }>('/auth/register', {
            method: 'POST',
            body: { username: username.trim(), password },
          })
        }
        const result = await request<AuthResult>('/auth/login', {
          method: 'POST',
          body: { username: username.trim(), password },
        })
        storeTokens(result.accessToken, result.refreshToken)
        onAuthenticated(result.user)
        navigate('/canvases')
      } catch (failure) {
        setError(describeError(failure))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className={css.root}>
      <section className={css.card}>
        <div className={css.brand}>
          <FishLogo size={26} />
          <div className={css.brandText}>
            <span className={css.brandTitle}>{t('shell', 'brand')}</span>
            <span className={css.brandTagline}>{t('login', 'brandTagline')}</span>
          </div>
        </div>
        <div>
          <h1 className={css.title}>{t('login', 'title')}</h1>
          <p className={css.subtitle}>{t('login', 'subtitle')}</p>
        </div>
        <NoticeLine tone="error" text={error} />
        <div className={css.form}>
          <label className={css.field}>
            <span className={css.label}>{t('login', 'usernameLabel')}</span>
            <Input
              value={username}
              placeholder={t('login', 'usernamePlaceholder')}
              autoComplete="username"
              onChange={event => { setUsername(event.currentTarget.value) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>{t('login', 'passwordLabel')}</span>
            <Input
              type="password"
              value={password}
              placeholder={t('login', 'passwordPlaceholder')}
              autoComplete="current-password"
              onChange={event => { setPassword(event.currentTarget.value) }}
              onKeyDown={event => { if (event.key === 'Enter') submit() }}
            />
          </label>
          <div className={css.actions}>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {busy
                ? t('login', mode === 'register' ? 'registerSubmitting' : 'submitting')
                : t('login', mode === 'register' ? 'registerSubmit' : 'submit')}
            </Button>
            <button
              type="button"
              className={css.linkButton}
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
            >
              {t('login', mode === 'login' ? 'registerToggle' : 'backToLogin')}
            </button>
          </div>
          {mode === 'register' && <p className={css.hint}>{t('login', 'registerHint')}</p>}
        </div>
      </section>
    </div>
  )
}
