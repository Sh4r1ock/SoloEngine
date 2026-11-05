/** 登录 / 注册页（结构对照原型 `login.html`：左墨色品牌面板 + 右 360 表单）。 */
import { useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { BrandGlyph } from '@deepseek-ai/dsh-client-ui-brand-official/src/static.ts'
import { ApiError, request, storeTokens, describeError } from '../api.ts'
import { t } from '../i18n.ts'
import { navigate } from '../router.ts'
import type { NoticeTone } from '../components/NoticeLine.tsx'
import { ThemeCycleButton } from '../components/ThemeCycleButton.tsx'
import { submitFormOnEnter } from '../utils/submitOnEnter.ts'
import type { AuthResult, UserView } from '../types.ts'
import css from '../styles/login.module.css'

/**
 * 渲染登录页。
 * @param props.onAuthenticated - 登录成功回调（拿到用户视图）。
 * @param props.initialError - 进入登录页前的失败原因（令牌失效等）。
 * @param props.initialTone - 上述原因的提示语气。
 */
export function LoginPage({ onAuthenticated, initialError = null, initialTone = 'error' }: {
  onAuthenticated: (user: UserView) => void
  initialError?: string | null
  initialTone?: NoticeTone
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  // 在途门闩用 ref 同步判定：Enter key-repeat 与点击可能落在同一 tick，state 更新来不及。
  const busyRef = useRef(false)
  // 字段引用用于把焦点送回出错/待填的控件（错误必须邻近可操作对象）。
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
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

  /**
   * 把焦点放到提交失败的对应字段（账号类错误指用户名，凭据类错误指口令）。
   * @param failure - 提交失败原因。
   */
  const focusOffending = (failure: unknown): void => {
    const code = failure instanceof ApiError ? failure.code : null
    if (code === 'USERNAME_TAKEN') {
      usernameRef.current?.focus()
      return
    }
    if (code === 'INVALID_CREDENTIALS' || code === 'PASSWORD_TOO_SHORT') passwordRef.current?.focus()
  }

  const submit = (): void => {
    if (busyRef.current) return // Enter 路径绕过按钮 disabled（R23）：in-flight 时禁止重复提交。
    if (username.trim() === '' || password === '') {
      setError(t('login', 'errorMissingFields'))
      setTone('error')
      if (username.trim() === '') usernameRef.current?.focus()
      else passwordRef.current?.focus()
      return
    }
    busyRef.current = true
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
        navigate('/canvas')
      } catch (failure) {
        setError(authMessage(failure))
        setTone('error')
        focusOffending(failure)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    })()
  }

  return (
    <div className={css.root}>
      <a className={css.skip} href="#login-form">{t('login', 'skipToForm')}</a>
      <div className={css.themeSlot}>
        <ThemeCycleButton authenticated={false} />
      </div>

      {/* 左 52%：墨色品牌面板（白鱼标 + 字标 + FRAMEWORK LAYER、展示标题、终端、版本脚注）。 */}
      <aside className={css.brandPanel} aria-label={t('login', 'brandPanelLabel')}>
        <div className={css.brandPanelTop}>
          <a
            className={css.brandLink}
            href="/"
            aria-label={t('shell', 'brandHome')}
            onClick={(event) => { event.preventDefault(); navigate('/') }}
          >
            <BrandGlyph size={26} />
            <span className={css.brandWordmark}>{t('shell', 'brand')}</span>
          </a>
          <span className={css.brandTag}>{t('login', 'panelTag')}</span>
        </div>
        <div className={css.brandCopy}>
          <p className={css.brandKicker}>{t('login', 'panelKicker')}</p>
          <h1 className={css.brandTitle}>
            {t('login', 'panelTitleLead')}
            <br />
            {t('login', 'panelTitleTail')}
          </h1>
          <p className={css.brandDesc}>{t('login', 'panelDesc')}</p>
        </div>
        <div className={css.brandTerminal} aria-hidden="true">
          <div className={css.brandTerminalHead}>
            <span className={css.brandDot} />
            <span>{t('login', 'terminalHead')}</span>
            <span className={css.brandTerminalState}>{t('login', 'terminalReady')}</span>
          </div>
          <pre className={css.brandTerminalBody}>
            <span className={css.termCmd}>{t('login', 'terminalCmd1')}</span>{'\n'}
            <span className={css.termOk}>{t('login', 'terminalOk1')}</span>{'\n'}
            <span className={css.termCmd}>{t('login', 'terminalCmd2')}</span>{'\n'}
            <span className={css.termOk}>{t('login', 'terminalOk2')}</span>{'\n'}
            <span className={css.termDim}>{t('login', 'terminalStats')}</span>
          </pre>
        </div>
        <div className={css.brandFoot}>
          <span>{t('login', 'panelFootLeft')}</span>
          <span>{t('login', 'panelFootRight')}</span>
        </div>
      </aside>

      {/* 右 48%：360px 表单。 */}
      <main className={css.formPane}>
        <div className={css.card}>
          <div>
            <div className={css.eyebrow}>{t('login', 'brandTagline')}</div>
            <h2 className={css.title}>{t('login', mode === 'login' ? 'title' : 'registerTitle')}</h2>
            <p className={css.subtitle}>{t('login', mode === 'login' ? 'subtitle' : 'registerSubtitle')}</p>
          </div>
          <form
            id="login-form"
            tabIndex={-1}
            className={css.form}
            onKeyDown={submitFormOnEnter}
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className={css.field}>
              <label className={css.label} htmlFor="login-username">{t('login', 'usernameLabel')}</label>
              <Input
                ref={usernameRef}
                id="login-username"
                name="username"
                className={css.input ?? ''}
                value={username}
                maxLength={64}
                autoFocus
                placeholder={t('login', 'usernamePlaceholder')}
                autoComplete="username"
                aria-invalid={error !== null}
                aria-describedby={error !== null ? 'login-error' : undefined}
                onChange={(event) => {
                  setUsername(event.currentTarget.value)
                  if (error !== null) setError(null)
                }}
              />
            </div>
            <div className={css.field}>
              <div className={css.labelRow}>
                <label className={css.label} htmlFor="login-password">{t('login', 'passwordLabel')}</label>
                <button
                  type="button"
                  className={css.reveal}
                  aria-label={t('login', showPassword ? 'passwordHide' : 'passwordShow')}
                  aria-pressed={showPassword}
                  onClick={() => { setShowPassword(!showPassword) }}
                >
                  <svg className={css.revealIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" />
                    <circle cx="10" cy="10" r="2.5" />
                  </svg>
                </button>
              </div>
              <Input
                ref={passwordRef}
                id="login-password"
                name="password"
                className={css.input ?? ''}
                type={showPassword ? 'text' : 'password'}
                value={password}
                maxLength={256}
                placeholder={t('login', 'passwordPlaceholder')}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                aria-invalid={error !== null}
                aria-describedby={error !== null ? 'login-error' : undefined}
                onChange={(event) => {
                  setPassword(event.currentTarget.value)
                  if (error !== null) setError(null)
                }}
              />
            </div>
            {error !== null ? (
              <div
                id="login-error"
                className={css.error}
                role={tone === 'error' ? 'alert' : 'status'}
                aria-live={tone === 'error' ? 'assertive' : 'polite'}
              >
                {error}
              </div>
            ) : null}
            <Button type="submit" variant="primary" disabled={busy} aria-busy={busy} className={css.submitBlock}>
              {busy ? (
                <>
                  <span className={css.spinner} aria-hidden="true" />
                  {t('login', mode === 'register' ? 'registerSubmitting' : 'submitting')}
                </>
              ) : t('login', mode === 'register' ? 'registerSubmit' : 'submit')}
            </Button>
            {mode === 'login' && (
              <div className={css.demoHint}>
                <span>{t('login', 'demoHintPrefix')}</span>
                <code className={css.demoCode}>{t('login', 'demoUser')}</code>
                <span aria-hidden="true">/</span>
                <code className={css.demoCode}>{t('login', 'demoPassword')}</code>
                <button
                  type="button"
                  className={`${css.linkButton} ${css.demoFill}`}
                  onClick={() => {
                    setUsername(t('login', 'demoUser'))
                    setPassword(t('login', 'demoPassword'))
                    setMode('login')
                    setError(null)
                    passwordRef.current?.focus()
                  }}
                >
                  {t('login', 'demoFill')}
                </button>
              </div>
            )}
            <div className={css.switchRow}>
              <span>{t('login', mode === 'login' ? 'switchPromptLogin' : 'switchPromptRegister')}</span>
              <button
                type="button"
                className={css.linkButton}
                onClick={() => {
                  if (busyRef.current) return // 与 submit() 同一门闩：在途请求的模式闭包不能被切换改写。
                  setMode(mode === 'login' ? 'register' : 'login')
                  setError(null)
                  usernameRef.current?.focus()
                }}
              >
                {t('login', mode === 'login' ? 'switchActionRegister' : 'switchActionLogin')}
              </button>
            </div>
            {mode === 'register' && <p className={css.hint}>{t('login', 'registerHint')}</p>}
          </form>
          <div className={css.panelFoot}>
            <button
              type="button"
              className={css.footLink}
              onClick={() => { navigate('/') }}
            >
              {t('login', 'backHome')}
            </button>
            <span>{t('login', 'devPreviewShort')}</span>
          </div>
        </div>
      </main>
    </div>
  )
}
