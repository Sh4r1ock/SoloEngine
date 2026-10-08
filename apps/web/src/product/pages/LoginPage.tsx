/** 登录 / 注册页。 */
import { useState } from 'react'
import { Button, FishLogo, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, request, storeTokens, describeError } from '../api.ts'
import { t } from '../i18n.ts'
import { navigate } from '../router.ts'
import { NoticeLine, type NoticeTone } from '../components/NoticeLine.tsx'
import type { AuthResult, UserView } from '../types.ts'
import css from '../styles/login.module.css'

/**
 * 渲染登录页。
 * @param props.onAuthenticated - 登录成功回调（拿到用户视图）。
 * @param props.initialError - 进入登录页前的失败原因（令牌失效等）。
 */
export function LoginPage({ onAuthenticated, initialError = null, initialTone = 'error' }: {
  onAuthenticated: (user: UserView) => void
  initialError?: string | null
  initialTone?: NoticeTone
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  // 进入页面的原因（会话过期=info）与提交失败（error）共用一个文案位，各自带语气。
  const [tone, setTone] = useState<NoticeTone>(initialTone)

  // 认证失败的产品文案映射（NN/G 表单错误准则：错误必须具体、可操作、邻近语境）。
  // 直接吐机器码（如 `INVALID_CREDENTIALS: username or password is incorrect`）对用户
  // 毫无可操作性——已知码给明确指引，未知码才回落「概述 — 原始错误」。
  const authMessage = (failure: unknown): string => {
    if (failure instanceof ApiError) {
      if (failure.code === 'INVALID_CREDENTIALS') return t('login', 'errorInvalidCredentials')
      if (failure.code === 'USER_DISABLED') return t('login', 'errorUserDisabled')
      if (failure.code === 'PASSWORD_TOO_SHORT') return t('login', 'errorPasswordShort')
      if (failure.code === 'USERNAME_TAKEN') return t('login', 'errorUsernameTaken')
    }
    return `${t('login', 'errorLogin')} — ${describeError(failure)}`
  }

  const submit = (): void => {
    if (busy) return // Enter 路径绕过按钮 disabled（R23）：in-flight 时禁止重复提交。
    if (username.trim() === '' || password === '') {
      setError(t('login', 'errorMissingFields'))
      setTone('error')
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
        setError(authMessage(failure))
        setTone('error')
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
        <NoticeLine tone={tone} text={error} />
        <div className={css.form}>
          <label className={css.field}>
            <span className={css.label}>{t('login', 'usernameLabel')}</span>
            <Input
              value={username}
              placeholder={t('login', 'usernamePlaceholder')}
              autoComplete="username"
              onChange={(event) => { setUsername(event.currentTarget.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
            />
          </label>
          <label className={css.field}>
            <span className={css.label}>{t('login', 'passwordLabel')}</span>
            <Input
              type="password"
              value={password}
              placeholder={t('login', 'passwordPlaceholder')}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              onChange={(event) => { setPassword(event.currentTarget.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
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
                if (busy) return // 与 submit() 同一门闩：在途请求的模式闭包不能被切换改写。
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
