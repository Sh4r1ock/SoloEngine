/**
 * 产品首页（`/`）：营销页，公开访问，不套管理面壳层。
 *
 * 结构依据需求文档 §12.3 第 1 条：sticky 导航、Hero（文案 + 安装命令 + 产品示意）、
 * 架构三角色、运行段、能力三列、打包四步管线 + 开发者预览提示、最终 CTA 与页脚。
 * 所有文案走 `home` 字典；颜色/间距只用语义 token 与 `--se-*`。
 */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { BrandGlyph } from '@deepseek-ai/dsh-client-ui-brand-official/src/static.ts'
import { request } from '../api.ts'
import { navigate } from '../router.ts'
import { t } from '../i18n.ts'
import { ThemeCycleButton } from '../components/ThemeCycleButton.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import type { CanvasView } from '../types.ts'
import css from '../styles/home.module.css'

/** 产品示意中的运行日志行（tone 决定行首状态色，agentKey 为原型里的加粗 Agent 名）。 */
const HERO_LOG: readonly { key: string; agentKey?: string; tone: 'run' | 'ok' }[] = [
  { key: 'heroLog1', agentKey: 'heroLog1Agent', tone: 'run' },
  { key: 'heroLog2', tone: 'ok' },
  { key: 'heroLog3', tone: 'ok' },
  { key: 'heroLog4', agentKey: 'heroLog4Agent', tone: 'run' },
  { key: 'heroLog5', tone: 'ok' },
  { key: 'heroLog6', agentKey: 'heroLog6Agent', tone: 'run' },
  { key: 'heroLog7', tone: 'ok' },
  { key: 'heroLog8', tone: 'ok' },
]

/** 运行段终端行（tone 决定颜色与行首 ›/✓ 前缀，agentKey 为原型里的加粗 Agent 名）。 */
const TERMINAL_LINES: readonly { key: string; agentKey?: string; tone: 'run' | 'ok' | 'dim' }[] = [
  { key: 'termLine1', agentKey: 'termAgentCoordinator', tone: 'run' },
  { key: 'termLine2', agentKey: 'termAgentCoordinator', tone: 'run' },
  { key: 'termLine3', agentKey: 'termAgentPlanner', tone: 'run' },
  { key: 'termLine4', agentKey: 'termAgentExecutor', tone: 'run' },
  { key: 'termLine5', tone: 'dim' },
  { key: 'termLine6', agentKey: 'termAgentExecutor', tone: 'run' },
  { key: 'termLine7', tone: 'ok' },
  { key: 'termLine8', agentKey: 'termAgentPlanner', tone: 'run' },
  { key: 'termLine9', agentKey: 'termAgentExecutor', tone: 'run' },
  { key: 'termLine10', tone: 'ok' },
  { key: 'termLine11', agentKey: 'termAgentCoordinator', tone: 'ok' },
  { key: 'termLine12', tone: 'dim' },
]

/** 运行段终端行的时刻（原型 09:41:02–09:41:22，逐行固定展示）。 */
const TERMINAL_TIMES: readonly string[] = [
  '09:41:02', '09:41:03', '09:41:04', '09:41:06', '09:41:07', '09:41:09',
  '09:41:14', '09:41:16', '09:41:18', '09:41:21', '09:41:22', '09:41:22',
]

/** 画布更新时间戳（缺失或无法解析按 0 处理，用于挑选最近更新的画布）。 */
function updatedAt(canvas: CanvasView): number {
  if (canvas.updated_at === null) return 0
  const parsed = Date.parse(canvas.updated_at)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * 最近更新的画布。
 * @param canvases - 画布列表。
 * @returns 更新时间最大的画布；列表为空时 undefined。
 */
function latestCanvas(canvases: readonly CanvasView[]): CanvasView | undefined {
  let latest: CanvasView | undefined
  for (const canvas of canvases) {
    if (latest === undefined || updatedAt(canvas) > updatedAt(latest)) latest = canvas
  }
  return latest
}

/**
 * Clipboard API 不可用时的复制回退（非安全上下文或权限拒绝）。
 * @param text - 待复制文本。
 * @returns 浏览器是否报告复制成功。
 */
function copyWithExecCommand(text: string): boolean {
  const helper = document.createElement('textarea')
  helper.value = text
  helper.setAttribute('readonly', '')
  helper.style.position = 'fixed'
  helper.style.top = '0'
  helper.style.left = '-9999px'
  document.body.appendChild(helper)
  helper.select()
  let copied = false
  try {
    // oxlint-disable-next-line typescript/no-deprecated -- Clipboard API 不可用时没有同步复制替代接口。
    copied = document.execCommand('copy')
  } catch {
    // 部分浏览器禁用剪贴板时 execCommand 直接抛错：按复制失败处理，由调用方提示。
    copied = false
  }
  document.body.removeChild(helper)
  return copied
}

/** 跳转按钮（保持原生按钮语义与键盘可达）。 */
function NavButton({ label, to, variant, size, className }: {
  label: string
  to: string
  variant?: 'primary' | 'outline' | 'ghost'
  size?: 'md' | 'sm'
  className?: string | undefined
}) {
  return (
    <Button variant={variant ?? 'outline'} size={size ?? 'md'} className={className} onClick={() => { navigate(to) }}>
      {label}
    </Button>
  )
}

/** 行尾箭头（原型 `M4 10h12M11 5l5 5-5 5`）。 */
function ArrowRight() {
  return (
    <svg className={css.btnArrow} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  )
}

/**
 * 渲染产品首页。
 * @param props.authenticated - 是否已登录（决定主题控件与服务端偏好是否联动）。
 */
export function HomePage({ authenticated }: { authenticated: boolean }) {
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  // 在途门闩用 ref 同步判定：连续点击可能落在同一 tick，state 更新来不及。
  const openingRef = useRef(false)
  const toast = useToastHost()

  // 原型 home.js：视口回到 900px 以上时收起移动导航，避免菜单状态残留。
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)')
    const onChange = (): void => {
      if (!query.matches) setMenuOpen(false)
    }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [])

  /**
   * 打开编辑器：有画布时进入最近更新的一张，没有画布或列表不可达时退回画布列表。
   * 列表请求失败不留在原地（首页没有任何就地重试入口，停留即是死路）。
   */
  const openEditor = (): void => {
    if (openingRef.current) return
    // 未登录时没有可读列表：交给列表页的门禁把用户带到登录页。
    if (!authenticated) {
      navigate('/canvas')
      return
    }
    openingRef.current = true
    setOpening(true)
    void (async () => {
      try {
        const result = await request<{ ok: true; canvases: CanvasView[] }>('/canvases', {
          signal: AbortSignal.timeout(10000),
        })
        const target = latestCanvas(result.canvases)
        navigate(target === undefined ? '/canvas' : `/canvas/${target.id}`)
      } catch {
        // 列表不可达（离线/会话失效）：退回画布列表，由列表页呈现原因并提供重试。
        navigate('/canvas')
      } finally {
        openingRef.current = false
        setOpening(false)
      }
    })()
  }

  const copyInstall = (): void => {
    const command = t('home', 'installCommand')
    const markCopied = (): void => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1600)
    }
    const fallback = (): void => {
      if (copyWithExecCommand(command)) {
        markCopied()
        return
      }
      toast.show(t('home', 'installCopyFailed'), 'error')
    }
    try {
      void navigator.clipboard.writeText(command).then(markCopied, fallback)
    } catch {
      // 非安全上下文没有 clipboard 对象，访问 writeText 即抛 TypeError：直接走回退。
      fallback()
    }
  }

  return (
    <div className={css.root}>
      <a className={css.skip} href="#main">{t('home', 'skipToMain')}</a>
      <header className={css.header}>
        <div className={css.headerInner}>
          <a className={css.brand} href="/" aria-label={t('home', 'brandHome')} onClick={(event) => {
            event.preventDefault()
            navigate('/')
          }}>
            <BrandGlyph size={24} />
            <span>{t('shell', 'brand')}</span>
          </a>
          <nav className={css.nav} aria-label={t('home', 'navLabel')}>
            <a href="#architecture">{t('home', 'navArchitecture')}</a>
            <a href="#run">{t('home', 'navRun')}</a>
            <a href="#capabilities">{t('home', 'navCapabilities')}</a>
            <a href="#package">{t('home', 'navPackage')}</a>
            <a href="/styleguide" onClick={(event) => { event.preventDefault(); navigate('/styleguide') }}>{t('home', 'navStyleguide')}</a>
          </nav>
          <div className={css.headerActions}>
            <a className={css.github} href="https://github.com/Sh4r1ock/SoloEngine" target="_blank" rel="noopener noreferrer">
              <svg className={css.iconSm} viewBox="0 0 20 20" aria-hidden="true"><path d="M6 14 14 6M7 6h7v7" /></svg>
              {t('home', 'navGithub')}
            </a>
            <ThemeCycleButton authenticated={authenticated} className={css.themeAction} />
            <NavButton label={t('home', 'navLogin')} to="/login" variant="ghost" size="sm" className={css.loginAction} />
            <NavButton label={t('home', 'navConsole')} to="/canvas" variant="primary" size="sm" className={css.navCta} />
            <button
              type="button"
              className={css.menuButton}
              aria-label={t('home', 'openNav')}
              aria-expanded={menuOpen}
              onClick={() => { setMenuOpen(!menuOpen) }}
            >
              <svg className={css.icon} viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
            </button>
          </div>
        </div>
        {menuOpen ? (
          <div className={css.mobileNav}>
            <a href="#architecture" onClick={() => { setMenuOpen(false) }}>{t('home', 'navArchitecture')}</a>
            <a href="#run" onClick={() => { setMenuOpen(false) }}>{t('home', 'navRun')}</a>
            <a href="#capabilities" onClick={() => { setMenuOpen(false) }}>{t('home', 'navCapabilities')}</a>
            <a href="#package" onClick={() => { setMenuOpen(false) }}>{t('home', 'navPackage')}</a>
            <a href="/styleguide" onClick={(event) => { event.preventDefault(); setMenuOpen(false); navigate('/styleguide') }}>{t('home', 'navStyleguide')}</a>
            <a href="/login" onClick={(event) => { event.preventDefault(); setMenuOpen(false); navigate('/login') }}>{t('home', 'navLogin')}</a>
          </div>
        ) : null}
      </header>

      <main id="main" tabIndex={-1}>
        <section className={css.hero}>
          <div className={css.container}>
            <div className={css.heroGrid}>
              <div className={css.heroCopy}>
                <div className={css.kicker}>{t('home', 'heroKicker')}</div>
                <h1 className={css.heroTitle}>
                  {t('home', 'heroTitleLead')}
                  {t('home', 'heroTitleKeep')} <em>{t('home', 'heroTitleAccent')}</em>{t('home', 'heroTitleTail')}
                </h1>
                <p className={css.heroLede}>{t('home', 'heroLede')}</p>
                <div className={css.heroActions}>
                  <Button variant="primary" className={css.lgButton} onClick={() => { navigate('/canvas') }}>
                    {t('home', 'heroPrimary')}
                    <ArrowRight />
                  </Button>
                  <a className={css.lgSecondary} href="#architecture">
                    {t('home', 'heroSecondary')}
                    <svg className={css.btnArrow} viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M5 11l5 5 5-5" /></svg>
                  </a>
                </div>
                <div className={css.heroMeta}>
                  <span>{t('home', 'metaPython')}</span>
                  <span>{t('home', 'metaFastapi')}</span>
                  <span>{t('home', 'metaReact')}</span>
                  <span>{t('home', 'metaLicense')}</span>
                </div>
                <div className={css.install}>
                  <div className={css.installHead}>
                    <span className={css.installLabel}><span className={css.dotAccent} />{t('home', 'installLabel')}</span>
                    <button type="button" className={css.copyButton} onClick={copyInstall}>
                      <svg className={css.iconSm} viewBox="0 0 20 20" aria-hidden="true">
                        <rect x="7" y="7" width="9" height="9" rx="1.5" />
                        <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-6A1.5 1.5 0 0 0 4 4.5v6A1.5 1.5 0 0 0 5.5 12H7" />
                      </svg>
                      {copied ? t('home', 'installCopied') : t('home', 'installCopy')}
                    </button>
                  </div>
                  <pre className={css.installCode}>
                    {t('home', 'installCommand').split('\n').map((line, index, lines) => (
                      <span key={index} className={line.startsWith('#') ? css.installComment : undefined}>
                        {line}{index < lines.length - 1 ? '\n' : ''}
                      </span>
                    ))}
                  </pre>
                </div>
              </div>

              <div className={css.heroVisual}>
                <div className={css.product}>
                  <div className={css.productBar}>
                    <span className={css.productFile}>
                      <svg className={css.iconSm} viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3h6l4 4v10H5V3Z" /><path d="M11 3v4h4" /></svg>
                      {t('home', 'productFile')}
                    </span>
                    <span className={css.productStatus}><span className={css.dot} />{t('home', 'productSaved')}</span>
                    <span className={css.productRun}>
                      <svg className={css.icon} viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.5 15 10l-9 5.5v-11Z" /></svg>
                      {t('home', 'productRun')}
                    </span>
                  </div>
                  <div className={css.productBody}>
                    <div className={css.productCanvas}>
                      <svg viewBox="0 0 420 330" width="100%" height="100%" role="img" aria-label={t('home', 'productCaption')}>
                        <defs>
                          <marker id="home-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                            <path d="M0 0 10 5 0 10z" fill="var(--dsw-alias-border-l3)" />
                          </marker>
                        </defs>
                        <path d="M168 71 C 205 71, 212 124, 246 124" fill="none" stroke="var(--dsw-alias-border-l3)" strokeWidth="1" markerEnd="url(#home-arrow)" />
                        <path d="M326 158 C 326 184, 160 182, 160 206" fill="none" stroke="var(--dsw-alias-border-l3)" strokeWidth="1" markerEnd="url(#home-arrow)" />
                        <g>
                          <rect x="20" y="38" width="148" height="66" rx="8" fill="var(--dsw-alias-bg-layer-1)" stroke="var(--dsw-static-deepseek-500)" strokeWidth="1" />
                          <rect x="30" y="48" width="18" height="18" rx="4" fill="var(--dsw-alias-bg-module-platform)" stroke="var(--se-hairline)" />
                          <circle cx="36" cy="54" r="2.2" fill="none" stroke="var(--dsw-alias-label-secondary)" />
                          <path d="M36 56.5v3M33 60h6" stroke="var(--dsw-alias-label-secondary)" fill="none" />
                          <text x="56" y="55" fontSize="12" fontWeight="600" fill="var(--dsw-alias-label-primary)">{t('home', 'heroNodeCoordinator')}</text>
                          <text x="56" y="69" fontSize="11" fill="var(--dsw-alias-label-tertiary)">{t('home', 'heroNodeCoordinatorRole')}</text>
                          <text x="30" y="86" fontSize="11" fill="var(--dsw-alias-label-secondary)">{t('home', 'heroNodeCoordinatorDesc')}</text>
                          <circle cx="33" cy="95" r="2" fill="var(--dsw-static-deepseek-500)" />
                          <text x="39" y="99" fontSize="11" fill="var(--dsw-alias-label-tertiary)">{t('home', 'heroNodeCoordinatorModel')}</text>
                        </g>
                        <g>
                          <rect x="252" y="96" width="148" height="66" rx="8" fill="var(--dsw-alias-bg-layer-1)" stroke="var(--se-hairline)" strokeWidth="1" />
                          <rect x="262" y="106" width="18" height="18" rx="4" fill="var(--dsw-alias-bg-module-platform)" stroke="var(--se-hairline)" />
                          <path d="M267 111h8M267 114h8M267 117h5" stroke="var(--dsw-alias-label-secondary)" fill="none" />
                          <text x="288" y="113" fontSize="12" fontWeight="600" fill="var(--dsw-alias-label-primary)">{t('home', 'heroNodePlanner')}</text>
                          <text x="288" y="127" fontSize="11" fill="var(--dsw-alias-label-tertiary)">{t('home', 'heroNodePlannerRole')}</text>
                          <text x="262" y="144" fontSize="11" fill="var(--dsw-alias-label-secondary)">{t('home', 'heroNodePlannerDesc')}</text>
                          <circle cx="265" cy="153" r="2" fill="var(--dsw-alias-border-l3)" />
                          <text x="271" y="157" fontSize="11" fill="var(--dsw-alias-label-tertiary)">{t('home', 'heroNodePlannerMeta')}</text>
                        </g>
                        <g>
                          <rect x="86" y="206" width="148" height="66" rx="8" fill="var(--dsw-alias-bg-layer-1)" stroke="var(--se-hairline)" strokeWidth="1" />
                          <rect x="96" y="216" width="18" height="18" rx="4" fill="var(--dsw-alias-bg-module-platform)" stroke="var(--se-hairline)" />
                          <path d="M100 222l2.5 2-2.5 2M104.5 226h4" stroke="var(--dsw-alias-label-secondary)" fill="none" />
                          <text x="122" y="223" fontSize="12" fontWeight="600" fill="var(--dsw-alias-label-primary)">{t('home', 'heroNodeExecutor')}</text>
                          <text x="122" y="237" fontSize="11" fill="var(--dsw-alias-label-tertiary)">{t('home', 'heroNodeExecutorRole')}</text>
                          <text x="96" y="254" fontSize="11" fill="var(--dsw-alias-label-secondary)">{t('home', 'heroNodeExecutorDesc')}</text>
                          <circle cx="99" cy="263" r="2" fill="var(--dsw-alias-border-l3)" />
                          <text x="105" y="267" fontSize="11" fill="var(--dsw-alias-label-tertiary)">{t('home', 'heroNodeExecutorMeta')}</text>
                        </g>
                        <text x="20" y="306" fontSize="11" fill="var(--dsw-alias-label-tertiary)">{t('home', 'heroNodeCount')}</text>
                      </svg>
                    </div>
                    <div className={css.productPanel}>
                      <div className={css.productPanelHead}>
                        <span>{t('home', 'productPanelHead')}</span>
                        <span>{t('home', 'productPanelLive')}</span>
                      </div>
                      <div className={css.productLog}>
                        {HERO_LOG.map(line => (
                          <div key={line.key} className={line.tone === 'ok' ? css.logOk : css.logRun}>
                            {line.agentKey === undefined ? null : (<><b>{t('home', line.agentKey)}</b>{' '}</>)}
                            {t('home', line.key)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className={css.productCaption}>
                  <span>{t('home', 'productCaption')}</span>
                  <a href="/canvas" className={css.captionLink} aria-busy={opening} onClick={(event) => { event.preventDefault(); openEditor() }}>
                    {t('home', 'productCaptionLink')}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={css.section} id="architecture">
          <div className={css.container}>
            <div className={css.sectionHead}>
              <div>
                <div className={css.eyebrow}>{t('home', 'architectureEyebrow')}</div>
                <h2 className={css.h2}>{t('home', 'architectureTitle')}</h2>
              </div>
              <div className={css.sectionLede}>
                <p>{t('home', 'architectureLede1')}</p>
                <p>{t('home', 'architectureLede2')}</p>
              </div>
            </div>
            <div className={css.roles}>
              <article className={css.role}>
                <div className={css.roleTop}>
                  <span className={css.roleGlyph} aria-hidden="true">
                    <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" /><path d="m12.8 7.2-1.6 4-4 1.6 1.6-4 4-1.6Z" /></svg>
                  </span>
                  <span className={css.roleCode}>{t('home', 'role1Code')}</span>
                </div>
                <h3 className={css.h3}>{t('home', 'role1Title')}</h3>
                <p>{t('home', 'role1Desc')}</p>
                <div className={css.roleMeta}>{t('home', 'role1Meta')}</div>
              </article>
              <div className={css.rolesLink} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 10h12M11 5l5 5-5 5" /></svg></div>
              <article className={css.role}>
                <div className={css.roleTop}>
                  <span className={css.roleGlyph} aria-hidden="true">
                    <svg viewBox="0 0 20 20"><circle cx="5" cy="5" r="2" /><circle cx="15" cy="15" r="2" /><path d="M7 5h3.5A2.5 2.5 0 0 1 13 7.5v5a2.5 2.5 0 0 0 2.5 2.5" /></svg>
                  </span>
                  <span className={css.roleCode}>{t('home', 'role2Code')}</span>
                </div>
                <h3 className={css.h3}>{t('home', 'role2Title')}</h3>
                <p>{t('home', 'role2Desc')}</p>
                <div className={css.roleMeta}>{t('home', 'role2Meta')}</div>
              </article>
              <div className={css.rolesLink} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M4 10h12M11 5l5 5-5 5" /></svg></div>
              <article className={css.role}>
                <div className={css.roleTop}>
                  <span className={css.roleGlyph} aria-hidden="true">
                    <svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="1.5" /><path d="m6 8 2.5 2L6 12M10.5 12H14" /></svg>
                  </span>
                  <span className={css.roleCode}>{t('home', 'role3Code')}</span>
                </div>
                <h3 className={css.h3}>{t('home', 'role3Title')}</h3>
                <p>{t('home', 'role3Desc')}</p>
                <div className={css.roleMeta}>{t('home', 'role3Meta')}</div>
              </article>
            </div>
          </div>
        </section>

        <section className={css.section} id="run">
          <div className={css.container}>
            <div className={css.runGrid}>
              <div className={css.runCopy}>
                <div className={css.eyebrow}>{t('home', 'runEyebrow')}</div>
                <h2 className={css.h2}>{t('home', 'runTitle')}</h2>
                <p>{t('home', 'runLede')}</p>
                <ul className={css.runList}>
                  <li><span><b>{t('home', 'runList1Title')}</b>{t('home', 'runList1Desc')}</span></li>
                  <li><span><b>{t('home', 'runList2Title')}</b>{t('home', 'runList2Desc')}</span></li>
                  <li><span><b>{t('home', 'runList3Title')}</b>{t('home', 'runList3Desc')}</span></li>
                </ul>
                <Button variant="outline" disabled={opening} aria-busy={opening} onClick={openEditor}>
                  {t('home', 'runCta')}
                  <ArrowRight />
                </Button>
              </div>
              <div className={css.terminal}>
                <div className={css.terminalHead}>
                  <span className={css.terminalTitle}><span className={css.dotAccent} />{t('home', 'terminalTitle')}</span>
                  <span className={css.terminalMuted}>{t('home', 'terminalLive')}</span>
                </div>
                <pre className={css.terminalBody}>
                  {TERMINAL_LINES.map((line, index) => (
                    <span key={line.key} className={css.termLine}>
                      <span className={css.termTime}>{TERMINAL_TIMES[index]}</span>
                      <span className={line.tone === 'ok' ? css.termOk : line.tone === 'dim' ? css.termDim : css.termRun}>
                        {line.agentKey === undefined ? null : (<><b>{t('home', line.agentKey)}</b>{' '}</>)}
                        {t('home', line.key)}
                      </span>
                    </span>
                  ))}
                </pre>
              </div>
            </div>
          </div>
        </section>

        <section className={css.section} id="capabilities">
          <div className={css.container}>
            <div className={css.sectionHead}>
              <div>
                <div className={css.eyebrow}>{t('home', 'capabilitiesEyebrow')}</div>
                <h2 className={css.h2}>{t('home', 'capabilitiesTitle')}</h2>
              </div>
              <div className={css.sectionLede}>
                <p>{t('home', 'capabilitiesLede')}</p>
              </div>
            </div>
            <div className={css.capGrid}>
              {([
                { num: 'cap1Num', titleKey: 'cap1Title', desc: 'cap1Desc', bullets: ['cap1Bullet1', 'cap1Bullet2', 'cap1Bullet3'], link: 'cap1Link', to: '/canvas', opensEditor: true },
                { num: 'cap2Num', titleKey: 'cap2Title', desc: 'cap2Desc', bullets: ['cap2Bullet1', 'cap2Bullet2', 'cap2Bullet3'], link: 'cap2Link', to: '/skill', opensEditor: false },
                { num: 'cap3Num', titleKey: 'cap3Title', desc: 'cap3Desc', bullets: ['cap3Bullet1', 'cap3Bullet2', 'cap3Bullet3'], link: 'cap3Link', to: '/mcp', opensEditor: false },
              ] as const).map(cap => (
                <article key={cap.num} className={css.cap}>
                  <span className={css.capNum}>{t('home', cap.num)}</span>
                  <h3 className={css.h3}>{t('home', cap.titleKey)}</h3>
                  <p>{t('home', cap.desc)}</p>
                  <ul>
                    {cap.bullets.map(key => <li key={key}>{t('home', key)}</li>)}
                  </ul>
                  <a
                    className={css.capLink}
                    href={cap.to}
                    aria-busy={cap.opensEditor ? opening : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      if (cap.opensEditor) openEditor()
                      else navigate(cap.to)
                    }}
                  >
                    {t('home', cap.link)}
                    <svg className={css.iconSm} viewBox="0 0 20 20" aria-hidden="true"><path d="M6 14 14 6M7 6h7v7" /></svg>
                  </a>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={css.section} id="package">
          <div className={css.container}>
            <div className={css.sectionHead}>
              <div>
                <div className={css.eyebrow}>{t('home', 'packageEyebrow')}</div>
                <h2 className={css.h2}>{t('home', 'packageTitle')}</h2>
              </div>
              <div className={css.sectionLede}>
                <p>{t('home', 'packageLede')}</p>
              </div>
            </div>
            <div className={css.pipeline}>
              {([
                { titleKey: 'pipe1Title', desc: 'pipe1Desc' },
                { titleKey: 'pipe2Title', desc: 'pipe2Desc' },
                { titleKey: 'pipe3Title', desc: 'pipe3Desc' },
                { titleKey: 'pipe4Title', desc: 'pipe4Desc' },
              ] as const).map((pipe, index) => (
                <article key={pipe.titleKey} className={css.pipe}>
                  <span className={css.pipeStep}>{String(index + 1).padStart(2, '0')}</span>
                  <h3 className={css.h3}>{t('home', pipe.titleKey)}</h3>
                  <p>{t('home', pipe.desc)}</p>
                  {index < 3 ? (
                    <span className={css.pipeArrow} aria-hidden="true">
                      <svg viewBox="0 0 20 20"><path d="M4 10h12M11 5l5 5-5 5" /></svg>
                    </span>
                  ) : null}
                </article>
              ))}
            </div>
            <div className={css.previewNote}>
              <div>
                <div className={css.previewTitle}><span className={css.dotAccent} />{t('home', 'previewTitle')}</div>
                <p>{t('home', 'previewDesc')}</p>
              </div>
              <Button variant="outline" onClick={() => { navigate('/canvas') }}>
                {t('home', 'previewCta')}
                <ArrowRight />
              </Button>
            </div>
          </div>
        </section>

        <section className={css.ctaSection}>
          <div className={css.container}>
            <div className={css.ctaBand}>
              <div>
                <h2>{t('home', 'ctaTitle')}</h2>
                <p>{t('home', 'ctaDesc')}</p>
              </div>
              <div className={css.ctaActions}>
                <NavButton label={t('home', 'ctaPrimary')} to="/canvas" variant="primary" />
                <NavButton label={t('home', 'ctaSecondary')} to="/market" variant="outline" />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={css.footer}>
        <div className={css.container}>
          <div className={css.footerGrid}>
            <div>
              <div className={css.footerBrand}><BrandGlyph size={20} /><span>{t('shell', 'brand')}</span></div>
              <p>{t('home', 'footerBrandDesc')}</p>
            </div>
            <div>
              <h3>{t('home', 'footerProduct')}</h3>
              <ul>
                <li><a href="/canvas" onClick={(event) => { event.preventDefault(); navigate('/canvas') }}>{t('home', 'footerCanvas')}</a></li>
                <li><a href="/market" onClick={(event) => { event.preventDefault(); navigate('/market') }}>{t('home', 'footerMarket')}</a></li>
                <li><a href="/canvas" onClick={(event) => { event.preventDefault(); navigate('/canvas') }}>{t('home', 'footerPackaging')}</a></li>
                <li><a href="/styleguide" onClick={(event) => { event.preventDefault(); navigate('/styleguide') }}>{t('home', 'footerStyleguide')}</a></li>
              </ul>
            </div>
            <div>
              <h3>{t('home', 'footerBuild')}</h3>
              <ul>
                <li><a href="/model" onClick={(event) => { event.preventDefault(); navigate('/model') }}>{t('home', 'footerModels')}</a></li>
                <li><a href="/skill" onClick={(event) => { event.preventDefault(); navigate('/skill') }}>{t('home', 'footerSkills')}</a></li>
                <li><a href="/mcp" onClick={(event) => { event.preventDefault(); navigate('/mcp') }}>{t('home', 'footerMcp')}</a></li>
                <li><a href="/user" onClick={(event) => { event.preventDefault(); navigate('/user') }}>{t('home', 'footerUsers')}</a></li>
              </ul>
            </div>
            <div>
              <h3>{t('home', 'footerDocs')}</h3>
              <ul>
                <li><span>{t('home', 'footerSpec')}</span></li>
                <li><span>{t('home', 'footerFoundations')}</span></li>
                <li><span>{t('home', 'footerPages')}</span></li>
                <li><span>{t('home', 'footerImplementation')}</span></li>
              </ul>
            </div>
          </div>
          <div className={css.footerBottom}>
            <span>{t('home', 'footerBottomLeft')}</span>
            <span>{t('home', 'footerBottomRight')}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
