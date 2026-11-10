/** 打包向导页。 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconArchiveOutlineRegular, IconChecklistOutlineRegular,
  IconPlayOutlineRegular, IconRefreshOutlineRegular, Input, Modal, Tag, TerminalBlock, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { isTerminalStage, type PackagingRunStatus, type PackagingStageStatus } from '@soloengine/types'
import { ApiError, describeError, request } from '../api.ts'
import { t } from '../i18n.ts'
import { Drawer } from '../components/Drawer.tsx'
import { openPage } from '../router.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import { Field } from '../components/Field.tsx'
import { PathValue } from '../components/PathValue.tsx'
import { terminalLabels } from '../components/labels.ts'
import type { DeploymentGuide, PackagingPreview, PackagingRun, RunProjectView } from '../types.ts'
import css from '../styles/common.module.css'
import pkgCss from '../styles/packaging.module.css'

/** 向导分节。 */
type Section = 'preview' | 'run' | 'deployment'

/**
 * 状态词表的未知值：穷尽 switch 的兜底分支（新增状态时编译期即报错）。
 * @param status - 未覆盖的状态字面量。
 */
function unhandledStatus(status: never): never {
  throw new Error(`packaging: unhandled status ${String(status)}`)
}

/**
 * 状态点语气（原型 `.dot` 词表）：空闲灰 / 进行中蓝 / 完成墨 / 失败墨。
 * 蓝色只用于「运行中、读取中」这类激活态（设计参考 §2.3）；失败按 docs/03 §3
 * 「墨点 + 文本」，不引入红色。
 */
type DotTone = 'idle' | 'running' | 'done' | 'error'

/**
 * 阶段/运行状态 → 状态点语气（穷尽 switch，状态词表来自 `@soloengine/types`）。
 * @param status - 阶段或运行状态。
 * @returns 状态点语气。
 */
function dotTone(status: PackagingStageStatus | PackagingRunStatus): DotTone {
  switch (status) {
    case 'ok':
    case 'completed': return 'done'
    case 'failed': return 'error'
    case 'pending': return 'idle'
    case 'running': return 'running'
    default: return unhandledStatus(status)
  }
}

/** 标题行状态点（6px，原型 `.status .dot`）。 */
const STATUS_DOT_CLASS: Record<DotTone, string> = {
  idle: pkgCss.statusDot ?? '',
  running: `${pkgCss.statusDot ?? ''} ${pkgCss.statusDotAccent ?? ''}`,
  done: `${pkgCss.statusDot ?? ''} ${pkgCss.statusDotInk ?? ''}`,
  error: `${pkgCss.statusDot ?? ''} ${pkgCss.statusDotInk ?? ''}`,
}

/** 阶段行状态点（5px，原型 `.stage-state .dot`）。 */
const STAGE_DOT_CLASS: Record<DotTone, string> = {
  idle: pkgCss.stageDot ?? '',
  running: `${pkgCss.stageDot ?? ''} ${pkgCss.stageDotAccent ?? ''}`,
  done: `${pkgCss.stageDot ?? ''} ${pkgCss.stageDotInk ?? ''}`,
  error: `${pkgCss.stageDot ?? ''} ${pkgCss.stageDotInk ?? ''}`,
}

/**
 * 阶段/运行状态 → 本地化文案键（同一份穷尽 switch）。
 * @param status - 阶段或运行状态。
 * @returns 文案键。
 */
function stageKey(status: PackagingStageStatus | PackagingRunStatus): string {
  switch (status) {
    case 'ok':
    case 'completed': return 'stageStatusDone'
    case 'failed': return 'stageStatusFailed'
    case 'pending': return 'stageStatusPending'
    case 'running': return 'stageStatusRunning'
    default: return unhandledStatus(status)
  }
}

/**
 * 阶段输出的首个非空行（阶段行明细；完整输出由终端卡片承担）。
 * @param output - 阶段输出。
 * @returns 首个非空行；没有时为空串。
 */
function outputLead(output: string): string {
  const line = output.split('\n').find(item => item.trim() !== '')
  return line === undefined ? '' : line.trim()
}

/**
 * 打包失败按后端错误码本地化；无本地文案时退回「动作名 + 原始错误」。
 * @param failure - 捕获的失败。
 * @param fallbackKey - 动作文案键（`errorPreview` / `errorRun` / `errorDeployment`）。
 * @returns 展示文案。
 */
function packagingFailureText(failure: unknown, fallbackKey: string): string {
  if (failure instanceof ApiError) {
    switch (failure.code) {
      case 'PACKAGING_SECRET_DETECTED': return t('packaging', 'errorSecrets')
      case 'PACKAGING_CONTRACT_REJECTED': return t('packaging', 'errorContract')
      case 'PACKAGING_PROFILE_MISSING': return t('packaging', 'errorProfileMissing')
      case 'DEPLOYMENT_UNBOUND': return t('packaging', 'errorDeploymentUnbound')
      case 'PACKAGING_RUN_NOT_FOUND': return t('packaging', 'errorRunNotFound')
      case 'PACKAGING_DESKTOP_NOT_STAGED': return t('packaging', 'errorDesktopNotStaged')
      case 'PACKAGING_DESKTOP_BUSY': return t('packaging', 'errorDesktopBusy')
      case 'PACKAGING_DESKTOP_HOST_UNSUPPORTED': return t('packaging', 'errorDesktopHost')
      case 'PACKAGING_DESKTOP_MISSING': return t('packaging', 'errorDesktopMissing')
      case 'PACKAGING_DESKTOP_PROFILE_INVALID': return t('packaging', 'errorDesktopProfileInvalid')
      case 'PACKAGING_DESKTOP_APP_ID_INVALID': return t('packaging', 'errorDesktopAppIdInvalid')
      default: break
    }
  }
  return `${t('packaging', fallbackKey)} — ${describeError(failure)}`
}

/** 阶段行：运行结果与开跑前占位共用同一份渲染数据（字段与 `PackagingRun.stages` 同形）。 */
interface StageRow {
  id: string
  label: string
  status: PackagingStageStatus
  output: string
}

/** 桌面形态字段的未通过原因（句子在渲染时按当前语言取）。 */
type DesktopProblem = 'required' | 'invalid'

/** 桌面 profile / 应用 ID 的字符集（与服务端 `DESKTOP_PROFILE_NAME_PATTERN` / `DESKTOP_APP_ID_PATTERN` 同一字母表）。 */
const DESKTOP_FIELD_PATTERN = /^[A-Za-z0-9._-]+$/u

/** 桌面 profile 名的缺省值（与服务端 `DESKTOP_DEFAULT_PROFILE` 一致）。 */
const DESKTOP_DEFAULT_PROFILE = 'desktop'

/** 桌面应用 ID 的缺省值（与服务端 `DESKTOP_DEFAULT_APP_ID` 一致）。 */
const DESKTOP_DEFAULT_APP_ID = 'com.soloengine.desktop'

/**
 * 开跑前的阶段占位：顺序与后端阶段序列一致，桌面形态追加发行封装一行。
 *
 * 运行开始后阶段直接来自 `run.stages`，占位只描述「将要执行哪些阶段」。
 */
const IDLE_STAGES: readonly { id: string; labelKey: string; desktopOnly: boolean }[] = [
  { id: 'compile', labelKey: 'stageCompile', desktopOnly: false },
  { id: 'profile', labelKey: 'stageProfile', desktopOnly: false },
  { id: 'materialize', labelKey: 'stageMaterialize', desktopOnly: false },
  { id: 'verify', labelKey: 'stageVerify', desktopOnly: false },
  { id: 'desktop', labelKey: 'stageDesktop', desktopOnly: true },
]

/**
 * 校验一个桌面形态字段：非空且只含字母、数字、点、下划线、连字符。
 * @param value - 输入原文。
 * @returns 未通过原因；通过为 null。
 */
function desktopProblem(value: string): DesktopProblem | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'required'
  return DESKTOP_FIELD_PATTERN.test(trimmed) ? null : 'invalid'
}

/**
 * 渲染打包向导（画布内抽屉的正文）。
 * @param props.canvasId - 打开抽屉的画布 ID。
 * @param props.canvasName - 画布名称（抽屉顶部只读展示）。
 */
export function PackagingPage({ canvasId, canvasName }: { canvasId: string | null; canvasName: string }) {
  const [section, setSection] = useState<Section>('preview')
  const [projects, setProjects] = useState<RunProjectView[]>([])
  const [selectedCanvas] = useState<string | null>(canvasId)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [preview, setPreview] = useState<PackagingPreview | null>(null)
  const [run, setRun] = useState<PackagingRun | null>(null)
  const [guide, setGuide] = useState<DeploymentGuide | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [desktopBusy, setDesktopBusy] = useState(false)
  const [form, setForm] = useState<'profile' | 'desktop'>('profile')
  // 桌面形态的两个字段（原型 `#desktop-fields`）：值来自请求，服务端仍按同一规则校验。
  const [desktopProfile, setDesktopProfile] = useState(DESKTOP_DEFAULT_PROFILE)
  const [desktopAppId, setDesktopAppId] = useState(DESKTOP_DEFAULT_APP_ID)
  const [desktopProblems, setDesktopProblems] = useState<{ profile: DesktopProblem | null; appId: DesktopProblem | null }>({
    profile: null,
    appId: null,
  })
  const [error, setError] = useState<string | null>(null)
  /** 列表数据（项目 / 部署指引）的加载与失败态：首屏必须有加载态，失败后可原地重试。 */
  const [listsLoading, setListsLoading] = useState(true)
  const [listsFailed, setListsFailed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // 两份数据各自独立成败：此前用 Promise.all + 单一文案，实测阻断 /projects 后界面报
  // 「画布列表加载失败」（而 /deployment/guide 仍返回 200），既归错责任方又把已取到的
  // 数据一起丢掉（R8 具体 / R17 可操作出路 / R24 部分失败隔离）。画布来自抽屉上下文，
  // 不再由打包自己拉取。
  const loadLists = useCallback(async (): Promise<void> => {
    setListsLoading(true)
    const [projectResult, guideResult] = await Promise.allSettled([
      request<{ ok: true; projects: RunProjectView[] }>('/projects'),
      request<{ ok: true; guide: DeploymentGuide }>('/deployment/guide'),
    ])
    setListsLoading(false)
    const failed: string[] = []
    let reason: unknown = null
    const settle = <T,>(result: PromiseSettledResult<T>, label: string, apply: (value: T) => void): void => {
      if (result.status === 'fulfilled') apply(result.value)
      else {
        failed.push(label)
        reason ??= result.reason
      }
    }
    settle(projectResult, t('packaging', 'errorProjects'), (value) => { setProjects(value.projects) })
    settle(guideResult, t('packaging', 'errorDeployment'), (value) => { setGuide(value.guide) })
    setListsFailed(failed.length > 0)
    if (failed.length === 0) {
      setError(null)
      return
    }
    // 只有部署指引失败时按错误码给出本地文案（DEPLOYMENT_UNBOUND 等）；多方失败保留归因。
    setError(failed.length === 1 && guideResult.status === 'rejected'
      ? packagingFailureText(guideResult.reason, 'errorDeployment')
      : `${failed.join('；')} — ${describeError(reason)}`)
  }, [])

  useEffect(() => { void loadLists() }, [loadLists])

  const canvasProjects = useMemo(
    () => (selectedCanvas === null ? [] : projects.filter(project => project.agentic_flow_id === selectedCanvas)),
    [projects, selectedCanvas],
  )

  useEffect(() => {
    // 保留仍然存在的选择；只有当前项目消失（换画布/删项目）才回落到第一项。
    setSelectedProject((previous) => {
      if (previous !== null && canvasProjects.some(project => project.id === previous)) return previous
      return canvasProjects[0]?.id ?? null
    })
  }, [canvasProjects])

  // 预览请求的在途控制：换画布/项目、重试或卸载时中止上一轮，避免旧响应覆盖新选择。
  // 复制就绪地址的成败走 Toast（原型 packaging.js:288 的 App.toast）。
  const toast = useToastHost()
  const previewController = useRef<AbortController | null>(null)

  // 预览与运行结果都属于「画布 + 项目」这一对：换掉任一侧就必须作废上一次结果。
  // 实测残留：选中 m3-canvas-muc85fwi 后预览区仍显示上一画布的哈希 dc9b97f48e59c9a4
  // 与 31 行配置层；打包出 b4947ae0 后切画布，运行区仍显示该标识、「状态 完成」与四个
  // 完成阶段——把别的画布的结果当成当前画布的（R26 悬空 UI 状态 / 认知走查 Q4）。
  // 在途预览同时中止：只清结果不作废请求时，旧响应会在新选择上落一份别人的预览。
  useEffect(() => {
    previewController.current?.abort()
    previewController.current = null
    setPreview(null)
    setRun(null)
    setCopyState('idle')
    setLoading(false)
  }, [selectedCanvas, selectedProject])

  const loadPreview = useCallback(async (silent = true): Promise<void> => {
    if (selectedCanvas === null || selectedProject === null) {
      setError(t('packaging', 'needCanvas'))
      return
    }
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    setLoading(true)
    try {
      const result = await request<{ ok: true; preview: PackagingPreview }>('/packaging/preview', {
        query: { canvasId: selectedCanvas, projectId: selectedProject },
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setPreview(result.preview)
      setError(null)
      // 原型 packaging.js:244-257：手动「读取预览」在完成后弹 Toast；进入页面/切换画布
      // 的自动读取保持静默，否则每次进页都先弹一条。
      if (!silent) toast.show(t('packaging', 'toastPreviewLoaded'), 'success')
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(packagingFailureText(failure, 'errorPreview'))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [selectedCanvas, selectedProject, toast.show])

  useEffect(() => () => { previewController.current?.abort() }, [])

  // 原型 packaging.js:232-238/291-296：进入页面与切换画布后自动读取预览，
  // 不必先点一次「读取预览」。画布/项目未就绪、或项目仍属于上一个画布时不发请求。
  useEffect(() => {
    if (selectedCanvas === null || selectedProject === null) return
    if (!canvasProjects.some(project => project.id === selectedProject)) return
    void loadPreview()
  }, [selectedCanvas, selectedProject, canvasProjects, loadPreview])

  // 打包运行的阶段轮询（终态即停）。桌面封装是打包完成后的第二条流水线：整次运行
  // 已是 completed 时它仍在跑，因此轮询还要由封装状态接续，否则 POST 返回后立即停止，
  // 页面会一直停在「封装进行中」而不读回真实进度、产物与结果。
  const runId = run?.id ?? null
  const runStatus = run?.status ?? null
  const desktopBuildRunning = run?.desktop?.build?.status === 'running'
  useEffect(() => {
    if (runId === null || runStatus === null) return
    if (isTerminalStage(runStatus) && !desktopBuildRunning) return
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const result = await request<{ ok: true; run: PackagingRun }>(`/packaging/runs/${runId}`)
          setRun(result.run)
        } catch (failure) {
          setError(packagingFailureText(failure, 'errorRun'))
          window.clearInterval(timer)
        }
      })()
    }, 1500)
    return () => { window.clearInterval(timer) }
  }, [runId, runStatus, desktopBuildRunning])

  // 原型 packaging.js:18-23/53：运行项目以路径式标识呈现（不是项目名）。
  const projectName = canvasProjects.find(project => project.id === selectedProject)?.folder_path ?? t('packaging', 'projectNone')
  const formLabel = form === 'desktop' ? t('packaging', 'formDesktop') : t('packaging', 'formProfile')
  const previewStatus = loading
    ? t('packaging', 'previewing')
    : preview === null ? t('packaging', 'previewNever') : t('packaging', 'previewLoaded')
  // 原型 packaging.html:59 固定「刚刚」；但「从未预览」旁边不能再贴一个时间——那会自相矛盾。
  const previewTime = preview === null ? '' : t('packaging', 'relativeJustNow')
  // 原型 packaging.html:64：步骤 1 的状态恒为「就绪」（步骤条表达可用性，不表达是否已读取）。
  const previewStepState = t('packaging', 'stepReady')
  const runStepState = run === null ? t('packaging', 'stageStatusPending') : t('packaging', stageKey(run.status))
  const deployStepState = run?.status === 'completed'
    ? t('packaging', 'stepDeployReady')
    : t('packaging', 'stepNeedArtifact')
  const stageDone = run === null ? 0 : run.stages.filter(stage => stage.status === 'ok').length
  const progressPercent = run === null || run.stages.length === 0
    ? 0
    : Math.round((stageDone / run.stages.length) * 100)
  const terminalOutput = run === null
    ? ''
    : run.stages.map(stage => stage.output.trim()).filter(text => text !== '').join('\n')
  // 开跑前先给出阶段清单（全部等待态）：原型在首帧就渲染这组行，运行时再换成真实进度。
  const displayStages: StageRow[] = run === null
    ? IDLE_STAGES
      .filter(stage => !stage.desktopOnly || form === 'desktop')
      .map(stage => ({ id: stage.id, label: t('packaging', stage.labelKey), status: 'pending', output: '' }))
    : run.stages
  const summaryStatus = run === null
    ? (preview === null ? t('packaging', 'summaryEmpty') : t('packaging', 'stepReady'))
    : t('packaging', stageKey(run.status))
  const deployNoticeText = run === null
    ? t('packaging', 'deployNoticeWaiting')
    : run.status === 'completed'
      ? t('packaging', 'deployNoticeReady')
      : run.status === 'failed'
        ? t('packaging', 'deployNoticeFailed')
        : t('packaging', 'deployNoticeRunning')

  /** 复制就绪地址：按钮回显复制态，成败另以 Toast 说明（原型 packaging.js:288 同一反馈）。 */
  const copyReady = (): void => {
    if (guide === null) return
    void (async () => {
      const copied = await writeClipboard(guide.ready.url)
      setCopyState(copied ? 'copied' : 'failed')
      toast.show(t('packaging', copied ? 'copiedReady' : 'copyFailed'), copied ? 'success' : 'error')
    })()
  }

  /**
   * 打开确认弹窗：先拦下当前不能发布的状态，再清掉上一次的弹窗内错误。
   *
   * - 预览含疑似凭据：原型在确认前就拒绝，服务端的 `PACKAGING_SECRET_DETECTED` 仍是最终守卫；
   * - 桌面字段不合法：就地给出本地化错误，不把明显会被拒的请求发出去。
   */
  const openConfirm = (): void => {
    if (preview?.containsSecrets === true) {
      setError(t('packaging', 'errorSecrets'))
      return
    }
    if (form === 'desktop') {
      const problems = { profile: desktopProblem(desktopProfile), appId: desktopProblem(desktopAppId) }
      setDesktopProblems(problems)
      if (problems.profile !== null || problems.appId !== null) return
    }
    setConfirmError(null)
    setConfirmOpen(true)
  }

  return (
    <div className={pkgCss.drawerPage}>
      <div className={pkgCss.toolbarPanel}>
        <div className={pkgCss.toolbarField}>
          <span className={css.fieldLabel}>{t('packaging', 'canvasLabel')}</span>
          <span className={pkgCss.canvasName}>{canvasName}</span>
        </div>
        <div className={pkgCss.toolbarField}>
          <span className={css.fieldLabel}>{t('packaging', 'projectLabel')}</span>
          <select
            className={pkgCss.select}
            value={selectedProject ?? ''}
            aria-label={t('packaging', 'projectLabel')}
            onChange={(event) => { setSelectedProject(event.currentTarget.value === '' ? null : event.currentTarget.value) }}
          >
            <option value="">{t('packaging', 'projectNone')}</option>
            {canvasProjects.map(project => (
              <option key={project.id} value={project.id}>{`${project.name} — ${project.folder_path}`}</option>
            ))}
          </select>
        </div>
        {/* 前置条件缺失时禁用并就地给出出路（R8 前置校验优先），与下方运行区
            「禁用 + 请选择运行项目」同一惯例；此前按钮始终可点，点击后才在页面顶部
            报一条红字（实测原文「请从画布列表进入打包，或在上方选择画布」）。 */}
        <Button
          variant="outline"
          icon={<IconRefreshOutlineRegular size={16} />}
          disabled={loading || selectedCanvas === null || selectedProject === null}
          aria-busy={loading}
          onClick={() => { void loadPreview(false) }}
        >
          {loading ? t('packaging', 'previewing') : t('packaging', 'preview')}
        </Button>
        <Button
          variant="primary"
          icon={busy ? <span className={css.spinner} aria-hidden="true" /> : <IconArchiveOutlineRegular size={16} />}
          disabled={busy || selectedCanvas === null || selectedProject === null}
          aria-busy={busy}
          onClick={openConfirm}
        >
          {busy ? t('packaging', 'running') : t('packaging', 'run')}
        </Button>
        <div className={pkgCss.toolbarMeta}>
          <span className={pkgCss.status}>
            <span
              className={STATUS_DOT_CLASS[loading ? 'running' : preview === null ? 'idle' : 'done']}
              aria-hidden="true"
            />
            {previewStatus}
          </span>
          <span className={pkgCss.count}>{previewTime}</span>
        </div>
        {/* R1：提示行始终占位（空态只清文本），否则数据就绪后整行消失会把下方布局上推。 */}
        <span
          className={`${css.fieldHint} ${pkgCss.toolbarHint}`}
          aria-hidden={selectedCanvas !== null && selectedProject !== null}
        >
          {selectedCanvas === null || selectedProject === null
            ? t('packaging', selectedCanvas === null ? 'needCanvas' : 'needProject')
            : ''}
        </span>
      </div>

      {/* 三步条：预览 → 打包运行 → 部署引导（编号 + 状态 + 连接线）。 */}
      <nav className={pkgCss.stepper} aria-label={t('packaging', 'sectionLabel')}>
        {([
          { id: 'preview', label: t('packaging', 'sectionPreview'), state: previewStepState },
          { id: 'run', label: t('packaging', 'sectionRun'), state: runStepState },
          { id: 'deployment', label: t('packaging', 'deployment'), state: deployStepState },
        ] as const).map((step, index) => (
          <Fragment key={step.id}>
            <button
              type="button"
              className={section === step.id ? `${pkgCss.step} ${pkgCss.stepActive}` : pkgCss.step}
              aria-current={section === step.id ? 'step' : undefined}
              onClick={() => {
                setSection(step.id)
                // 三段同页：步骤条是锚点导航，不再互斥切换（原型 packaging.html:71-211）。
                document.getElementById(`pkg-${step.id}`)?.scrollIntoView({
                  block: 'start',
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                })
              }}
            >
              <span className={pkgCss.stepNum}>{index + 1}</span>
              <span>{step.label}</span>
              <span className={pkgCss.stepState}>{step.state}</span>
            </button>
            {index < 2 && <span className={pkgCss.stepLine} aria-hidden="true" />}
          </Fragment>
        ))}
      </nav>

      {listsLoading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      <NoticeLine
        tone="error"
        text={error}
        {...(listsFailed ? { action: { label: t('common', 'actionRetry'), onClick: () => { void loadLists() } } } : {})}
      />

      <div className={pkgCss.layout}>
        <div className={pkgCss.main}>
          <section className={pkgCss.section} aria-labelledby="pkg-preview-title" id="pkg-preview">
            <div className={pkgCss.sectionHead}>
              <div className={pkgCss.sectionHeadText}>
                <h2 className={pkgCss.sectionTitle} id="pkg-preview-title">{t('packaging', 'sectionPreviewTitle')}</h2>
                <p className={pkgCss.sectionMeta}>{t('packaging', 'previewMeta')}</p>
              </div>
              <span className={pkgCss.count}>{canvasName}</span>
            </div>
            {preview === null ? (
              <div className={css.emptyState}>
                <span className={css.emptyIcon} aria-hidden="true"><IconArchiveOutlineRegular size={22} /></span>
                <p className={css.emptyTitle}>{t('packaging', 'empty')}</p>
                <p className={css.emptyDesc}>{t('packaging', 'previewEmptyHint')}</p>
              </div>
            ) : (
              <>
                <div className={pkgCss.previewGrid}>
                  <article className={pkgCss.card}>
                    <div className={pkgCss.cardHead}>
                      <h3>{t('packaging', 'bundles')}</h3>
                      <span className={pkgCss.count}>{preview.bundles.length}</span>
                    </div>
                    {preview.bundles.length === 0
                      ? <p className={pkgCss.hint}>{t('common', 'labelNone')}</p>
                      : (
                        <ul className={pkgCss.list}>
                          {preview.bundles.map(bundle => (
                            <li key={bundle}>
                              <span className={pkgCss.mono}>{bundle}</span>
                              <Tag tone="neutral" className={pkgCss.rowTag}>{t('packaging', 'bundleBadge')}</Tag>
                            </li>
                          ))}
                        </ul>
                      )}
                  </article>
                  <article className={pkgCss.card}>
                    <div className={pkgCss.cardHead}>
                      <h3>{t('packaging', 'layers')}</h3>
                      <span className={pkgCss.count}>{preview.layers.length}</span>
                    </div>
                    <ul className={pkgCss.list}>
                      {preview.layers.map(layer => (
                        <li key={layer.source} title={layer.source}>
                          {/* 配置层是层栈：每个层文件一行（同一文件不重复），行尾是该层声明的组合行数。 */}
                          <PathValue value={layer.path} className={pkgCss.layerPath} />
                          <span className={pkgCss.layerKind}>
                            {t('packaging', 'layerRows', { count: layer.rows })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </article>
                  <article className={pkgCss.card}>
                    <div className={pkgCss.cardHead}>
                      <h3>{t('packaging', 'instancePlugins')}</h3>
                    </div>
                    <div className={pkgCss.netGrid}>
                      <div className={pkgCss.netCell}>
                        <span className={pkgCss.netValue}>{preview.instance.diff.disable?.length ?? 0}</span>
                        <span className={pkgCss.netLabel}>{t('packaging', 'instanceDisabledLabel')}</span>
                      </div>
                      <div className={pkgCss.netCell}>
                        <span className={pkgCss.netValue}>{preview.instance.diff.replace?.length ?? 0}</span>
                        <span className={pkgCss.netLabel}>{t('packaging', 'instanceReplacedLabel')}</span>
                      </div>
                      <div className={pkgCss.netCell}>
                        <span className={pkgCss.netValue}>{preview.instance.diff.add?.length ?? 0}</span>
                        <span className={pkgCss.netLabel}>{t('packaging', 'instanceAddedLabel')}</span>
                      </div>
                    </div>
                    <p className={pkgCss.hint}>{t('packaging', 'instanceHint')}</p>
                  </article>
                  <article className={pkgCss.card}>
                    <div className={pkgCss.cardHead}>
                      <h3>{t('packaging', 'preset')}</h3>
                    </div>
                    <dl className={pkgCss.metaList}>
                      {/* 原型「预设」行：入口节点（产物默认预设）的名字，取自编译产物而非写死。 */}
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'presetName')}</dt>
                        <dd className={pkgCss.mono}>{preview.presetName}</dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'presetMainAgent')}</dt>
                        <dd className={pkgCss.mono}>{preview.preset.mainAgentId}</dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'canvasHash')}</dt>
                        <dd><PathValue value={preview.canvasHash} /></dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'revision')}</dt>
                        <dd className={pkgCss.mono}>{t('packaging', 'revisionValue', { revision: preview.revision })}</dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'containsSecrets')}</dt>
                        <dd>
                          {/* 原型 `#secrets-badge`：命中时 `badge--accent`（蓝点），否则中性徽标。 */}
                          <Tag
                            tone={preview.containsSecrets ? 'info' : 'neutral'}
                            className={preview.containsSecrets ? `${css.accentTag} ${css.statusTag}` : undefined}
                          >
                            {preview.containsSecrets && <span className={pkgCss.badgeDot} aria-hidden="true" />}
                            {preview.containsSecrets ? t('common', 'stateYes') : t('common', 'stateNo')}
                          </Tag>
                        </dd>
                      </div>
                    </dl>
                  </article>
                </div>
                <article className={`${pkgCss.card} ${pkgCss.cardWide}`}>
                  <div className={pkgCss.cardHead}>
                    <h3>{t('packaging', 'dependencies')}</h3>
                    <span className={pkgCss.count}>
                      {preview.dependencies.packages.length + preview.dependencies.platformProvided.length}
                    </span>
                  </div>
                  {preview.dependencies.packages.length === 0 && preview.dependencies.platformProvided.length === 0
                    ? <p className={pkgCss.hint}>{t('packaging', 'dependenciesEmpty')}</p>
                    : (
                      <ul className={pkgCss.depList}>
                        {preview.dependencies.packages.map(entry => (
                          <li key={entry.name}>
                            <span className={pkgCss.mono}>{entry.name}</span>
                            <span className={pkgCss.monoMuted}>{t('packaging', 'versionShort', { version: entry.version })}</span>
                            <Tag tone="outline" className={pkgCss.rowTag}>{t('packaging', 'depShipped')}</Tag>
                          </li>
                        ))}
                        {preview.dependencies.platformProvided.map(entry => (
                          <li key={`platform:${entry.name}`}>
                            <span className={pkgCss.mono}>{entry.name}</span>
                            <span className={pkgCss.monoMuted}>{t('packaging', 'versionShort', { version: entry.version })}</span>
                            <Tag tone="neutral" className={pkgCss.rowTag}>{t('packaging', 'depPlatform')}</Tag>
                          </li>
                        ))}
                      </ul>
                    )}
                  <p className={pkgCss.hint}>
                    {t('packaging', 'dependenciesHint', {
                      count: preview.dependencies.packages.length,
                      platform: preview.dependencies.platformProvided.length,
                    })}
                  </p>
                </article>
              </>
            )}
          </section>

          <section className={pkgCss.section} aria-labelledby="pkg-run-title" id="pkg-run">
            <div className={pkgCss.sectionHead}>
              <div className={pkgCss.sectionHeadText}>
                <h2 className={pkgCss.sectionTitle} id="pkg-run-title">{t('packaging', 'sectionRunTitle')}</h2>
                <p className={pkgCss.sectionMeta}>{t('packaging', 'runMeta')}</p>
              </div>
              <span className={pkgCss.status}>
                <span
                  className={STATUS_DOT_CLASS[run === null ? 'idle' : dotTone(run.status)]}
                  aria-hidden="true"
                />
                {run === null ? t('packaging', 'stageStatusPending') : t('packaging', stageKey(run.status))}
              </span>
            </div>
            <form
              className={pkgCss.runForm}
              onSubmit={(event) => {
                event.preventDefault()
                if (selectedCanvas === null || selectedProject === null || busy) return
                openConfirm()
              }}
            >
              <div className={css.field}>
                <span className={css.fieldLabel}>{t('packaging', 'formLabel')}</span>
                <div className={pkgCss.artifactForms}>
                  <label className={form === 'profile' ? `${pkgCss.radioCard} ${pkgCss.radioCardActive}` : pkgCss.radioCard}>
                    <input
                      type="radio"
                      name="packaging-form"
                      value="profile"
                      checked={form === 'profile'}
                      className={pkgCss.radioInput}
                      onChange={() => { setForm('profile') }}
                    />
                    <span className={pkgCss.radioText}>
                      <span className={pkgCss.radioTitle}>{t('packaging', 'formProfile')}</span>
                      <span className={pkgCss.radioDesc}>{t('packaging', 'formProfileDesc')}</span>
                    </span>
                  </label>
                  <label className={form === 'desktop' ? `${pkgCss.radioCard} ${pkgCss.radioCardActive}` : pkgCss.radioCard}>
                    <input
                      type="radio"
                      name="packaging-form"
                      value="desktop"
                      checked={form === 'desktop'}
                      className={pkgCss.radioInput}
                      onChange={() => { setForm('desktop') }}
                    />
                    <span className={pkgCss.radioText}>
                      <span className={pkgCss.radioTitle}>{t('packaging', 'formDesktop')}</span>
                      <span className={pkgCss.radioDesc}>{t('packaging', 'formDesktopDesc')}</span>
                    </span>
                  </label>
                </div>
                {/* 原型 `#desktop-fields`：只在桌面形态出现；值随请求提交（`desktopProfile` / `appId`）。 */}
                {form === 'desktop' && (
                  <div className={`${css.formGrid} ${pkgCss.desktopFields}`}>
                    <label className={css.field}>
                      <span className={css.fieldLabel}>{t('packaging', 'desktopProfile')}</span>
                      <Input
                        id="pkg-desktop-profile"
                        value={desktopProfile}
                        aria-invalid={desktopProblems.profile !== null}
                        aria-describedby={desktopProblems.profile === null ? undefined : 'pkg-desktop-profile-error'}
                        onChange={(event) => {
                          setDesktopProfile(event.currentTarget.value)
                          if (desktopProblems.profile !== null) {
                            setDesktopProblems(current => ({ ...current, profile: null }))
                          }
                        }}
                      />
                      {desktopProblems.profile !== null && (
                        <span className={css.fieldError} id="pkg-desktop-profile-error">
                          {t('packaging', desktopProblems.profile === 'required' ? 'desktopProfileRequired' : 'desktopProfileInvalid')}
                        </span>
                      )}
                    </label>
                    <label className={css.field}>
                      <span className={css.fieldLabel}>{t('packaging', 'desktopAppId')}</span>
                      <Input
                        id="pkg-desktop-appid"
                        value={desktopAppId}
                        aria-invalid={desktopProblems.appId !== null}
                        aria-describedby={desktopProblems.appId === null ? undefined : 'pkg-desktop-appid-error'}
                        onChange={(event) => {
                          setDesktopAppId(event.currentTarget.value)
                          if (desktopProblems.appId !== null) {
                            setDesktopProblems(current => ({ ...current, appId: null }))
                          }
                        }}
                      />
                      {desktopProblems.appId !== null && (
                        <span className={css.fieldError} id="pkg-desktop-appid-error">
                          {t('packaging', desktopProblems.appId === 'required' ? 'desktopAppIdRequired' : 'desktopAppIdInvalid')}
                        </span>
                      )}
                    </label>
                    {/* 原型 `#desktop-command`：收尾命令在开跑前就可见（只读），与运行后执行的是同一条。 */}
                    <label className={`${css.field} ${pkgCss.fieldFull}`}>
                      <span className={css.fieldLabel}>{t('packaging', 'desktopCommand')}</span>
                      <Input
                        id="pkg-desktop-command"
                        value={preview?.desktopCommand ?? ''}
                        readOnly
                        placeholder={t('packaging', 'desktopCommandPending')}
                      />
                    </label>
                    <p className={pkgCss.hint}>{t('packaging', 'desktopElectronHint')}</p>
                  </div>
                )}
              </div>
              <p className={pkgCss.hint}>{t('packaging', 'formHint')}</p>
              <div className={pkgCss.runActions}>
                <Button
                  variant="primary"
                  type="submit"
                  icon={busy ? <span className={css.spinner} aria-hidden="true" /> : <IconPlayOutlineRegular size={16} />}
                  disabled={busy || selectedCanvas === null || selectedProject === null}
                  aria-busy={busy}
                >
                  {busy ? t('packaging', 'running') : t('packaging', 'run')}
                </Button>
                <span className={css.fieldHint}>{t('packaging', 'runHint')}</span>
                {selectedProject === null && <span className={css.fieldHint}>{t('packaging', 'needProject')}</span>}
                {selectedCanvas !== null && canvasProjects.length === 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { openPage(`/run/${selectedCanvas}`) }}
                  >
                    {t('packaging', 'createProject')}
                  </Button>
                )}
              </div>
            </form>
            {/* 原型在开跑前就渲染阶段清单与终端：阶段全部「等待」，终端给出空占位与复制入口。 */}
            <div className={pkgCss.stageList}>
              {/* 原型 `.stage-progress`：进度条有独立容器（12px 16px + 底部分隔线 + 浅底）。 */}
              <div className={pkgCss.stageProgress}>
                <div className={pkgCss.progress}>
                  <span className={pkgCss.progressBar} style={{ width: `${String(progressPercent)}%` }} />
                </div>
              </div>
              {displayStages.map((stage, index) => (
                <div
                  key={stage.id}
                  className={stage.status === 'running' ? `${pkgCss.stageRow} ${pkgCss.stageRowRunning}` : pkgCss.stageRow}
                >
                  <span className={pkgCss.stageIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={pkgCss.stageMain}>
                    <span className={pkgCss.stageName}>{stage.label}</span>
                    {outputLead(stage.output) !== '' && (
                      <span className={pkgCss.stageDetail} title={stage.output}>{outputLead(stage.output)}</span>
                    )}
                  </span>
                  <span className={pkgCss.stageState}>
                    <span className={STAGE_DOT_CLASS[dotTone(stage.status)]} aria-hidden="true" />
                    {t('packaging', stageKey(stage.status))}
                  </span>
                </div>
              ))}
            </div>
            {/* copyText 让复制控件在还没有输出时也在位（原语契约）；开跑前用占位句替代「无输出」。 */}
            <TerminalBlock
              command={t('packaging', 'terminalCommand', { form: formLabel })}
              output={terminalOutput}
              copyText={terminalOutput}
              running={run?.status === 'running'}
              exitCode={run === null ? undefined : run.status === 'failed' ? 1 : run.status === 'completed' ? 0 : undefined}
              runStateDot={run !== null}
              labels={{
                ...terminalLabels(),
                copy: t('packaging', 'terminalCopy'),
                ...(run === null ? { noOutput: t('packaging', 'terminalWaiting') } : {}),
              }}
              className={`${css.terminal} ${pkgCss.terminal}`}
            />
            {run !== null && (
              <>
                <div className={pkgCss.artifactRow}>
                  <span className={css.fieldLabel}>{t('packaging', 'artifactPath')}</span>
                  <span className={pkgCss.mono}><PathValue value={run.artifactPath} /></span>
                </div>
                {run.desktop !== undefined && (
                  <div className={`${pkgCss.card} ${pkgCss.cardWide}`}>
                    <div className={pkgCss.cardHead}>
                      <h3>{t('packaging', 'formDesktop')}</h3>
                    </div>
                    <div className={css.definition}>
                      <span className={css.definitionLabel}>{t('packaging', 'desktopProfile')}</span>
                      <span className={css.definitionValue}><PathValue value={run.desktop.profileDir} /></span>
                      <span className={css.definitionLabel}>{t('packaging', 'desktopAppId')}</span>
                      <span className={css.definitionValue}><PathValue value={run.desktop.appId} /></span>
                      <span className={css.definitionLabel}>{t('packaging', 'desktopReady')}</span>
                      <span className={css.definitionValue}>
                        {run.desktop.buildReady ? t('common', 'stateYes') : t('common', 'stateNo')}
                      </span>
                    </div>
                    {/* 一键产出：同一份暂存结果交给发行脚本，页面只等进度；失败原样可见，再次点击即重试。 */}
                    <div className={css.toolbar}>
                      <Button
                        variant="primary"
                        disabled={desktopBusy || run.desktop.build?.status === 'running'}
                        onClick={() => {
                          const id = run.id
                          setDesktopBusy(true)
                          setError(null)
                          void (async () => {
                            try {
                              const result = await request<{ ok: true; run: PackagingRun }>(
                                `/packaging/runs/${id}/desktop-build`,
                                { method: 'POST' },
                              )
                              setRun(result.run)
                            } catch (failure) {
                              setError(packagingFailureText(failure, 'errorDesktopBuild'))
                            } finally {
                              setDesktopBusy(false)
                            }
                          })()
                        }}
                      >
                        {run.desktop.build?.status === 'running'
                          ? t('packaging', 'desktopBuilding')
                          : run.desktop.build === undefined ? t('packaging', 'desktopBuild') : t('packaging', 'desktopBuildRetry')}
                      </Button>
                      {run.desktop.build?.status !== 'running' && <span className={css.fieldHint}>{t('packaging', 'desktopBuildHint')}</span>}
                    </div>
                    {run.desktop.build !== undefined && (
                      <>
                        <div className={css.fieldLabel}>{t('packaging', 'desktopBuildTitle')}</div>
                        <div className={css.statusRow}>
                          <span
                            className={STATUS_DOT_CLASS[dotTone(run.desktop.build.status === 'completed' ? 'ok' : run.desktop.build.status)]}
                            aria-hidden="true"
                          />
                          <span>
                            {t('packaging', run.desktop.build.status === 'completed'
                              ? 'desktopBuildDone'
                              : run.desktop.build.status === 'failed' ? 'desktopBuildFailed' : 'desktopBuildRunning')}
                          </span>
                        </div>
                        {/* 封装未结束时不能报 exit 0：那会把「封装进行中」渲染成已完成。 */}
                        <TerminalBlock
                          command={run.desktop.build.command}
                          output={run.desktop.build.output}
                          running={run.desktop.build.status === 'running'}
                          exitCode={run.desktop.build.status === 'running'
                            ? undefined
                            : run.desktop.build.status === 'failed' ? 1 : 0}
                          labels={terminalLabels()}
                        />
                        <div className={css.fieldLabel}>{t('packaging', 'desktopArtifacts')}</div>
                        {run.desktop.build.artifacts.length === 0
                          ? <div className={css.fieldHint}>{t('packaging', 'desktopArtifactsEmpty')}</div>
                          : (
                            <div className={css.tree}>
                              {run.desktop.build.artifacts.map(artifact => (
                                <div key={artifact} className={css.listRow}><PathValue value={artifact} /></div>
                              ))}
                            </div>
                          )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className={pkgCss.section} aria-labelledby="pkg-deploy-title" id="pkg-deployment">
            <div className={pkgCss.sectionHead}>
              <div className={pkgCss.sectionHeadText}>
                <h2 className={pkgCss.sectionTitle} id="pkg-deploy-title">{t('packaging', 'sectionDeployTitle')}</h2>
                <p className={pkgCss.sectionMeta}>{t('packaging', 'deployMeta')}</p>
              </div>
              <span className={pkgCss.status}>
                <span
                  className={STATUS_DOT_CLASS[run?.status === 'completed' ? 'done' : 'idle']}
                  aria-hidden="true"
                />
                {deployStepState}
              </span>
            </div>
            {guide === null ? (
              <div className={css.emptyState}>
                <span className={css.emptyIcon} aria-hidden="true"><IconChecklistOutlineRegular size={22} /></span>
                <p className={css.emptyTitle}>{t('packaging', 'emptyGuide')}</p>
                <p className={css.emptyDesc}>{t('packaging', 'deployEmptyHint')}</p>
              </div>
            ) : (
              <>
                <div className={pkgCss.deployGrid}>
                  <div className={pkgCss.deployMeta}>
                    <dl className={pkgCss.metaList}>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'deploymentTarget')}</dt>
                        <dd>{guide.target}</dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'deploymentReady')}</dt>
                        {/* 后端 `ready.url` 本身就是 `http://<host>:<port>`（真源 packaging.ts），
                          再拼一次 `:{port}` 会渲染出 `http://127.0.0.1:8991:8991`（实测原文）。 */}
                        <dd className={pkgCss.mono}><PathValue value={guide.ready.url} /></dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'deploymentBaseline')}</dt>
                        <dd className={pkgCss.mono}>
                          {guide.config.baseline.length === 0
                            ? t('common', 'labelNone')
                            : guide.config.baseline.join(' / ')}
                        </dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'deploymentHost')}</dt>
                        <dd className={pkgCss.mono}>{guide.config.host}</dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'deploymentPort')}</dt>
                        <dd className={pkgCss.mono}>{guide.config.port}</dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'deploymentTrustedHosts')}</dt>
                        <dd>
                          {guide.config.trustedHosts.length === 0
                            ? t('packaging', 'deploymentTrustLoopbackOnly')
                            : guide.config.trustedHosts.map(host => (
                              <Tag key={host} tone="neutral" className={pkgCss.rowTag}>{host}</Tag>
                            ))}
                        </dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'deploymentDshHome')}</dt>
                        <dd className={pkgCss.mono}><PathValue value={guide.config.dshHome} /></dd>
                      </div>
                      <div className={pkgCss.metaRow}>
                        <dt>{t('packaging', 'deploymentDatabase')}</dt>
                        <dd className={pkgCss.mono}><PathValue value={guide.config.database} /></dd>
                      </div>
                    </dl>
                  </div>
                  <aside className={pkgCss.deployNote}>
                    <div className={pkgCss.deployNoteTitle}>{t('packaging', 'deploymentLoadCheck')}</div>
                    <ul className={pkgCss.checkList}>
                      {guide.steps.length === 0
                        ? <li><span className={pkgCss.checkText}>{t('common', 'labelNone')}</span></li>
                        : guide.steps.map(step => (
                          <li key={step.id} title={step.note}>
                            <span className={pkgCss.checkText}>
                              <span>{step.label}</span>
                              <span className={pkgCss.checkCommand}>{step.command}</span>
                            </span>
                          </li>
                        ))}
                    </ul>
                    <Button
                      size="sm"
                      variant="outline"
                      className={pkgCss.blockButton}
                      onClick={copyReady}
                    >
                      {copyState === 'copied' ? t('packaging', 'copiedReady') : t('packaging', 'copyReady')}
                    </Button>
                  </aside>
                </div>
                {/* 原型 `#deploy-notice { margin-top: var(--s-4) }`：提示行自成一段，不随分节标题挤在一起。 */}
                <div className={pkgCss.deployNotice}>
                  <NoticeLine
                    tone={run?.status === 'completed' ? 'success' : run?.status === 'failed' ? 'error' : 'info'}
                    text={deployNoticeText}
                  />
                </div>
              </>
            )}
          </section>

        </div>
        <aside className={pkgCss.summary} aria-label={t('packaging', 'summaryTitle')}>
          <div className={pkgCss.summaryPanel}>
            <div className={pkgCss.summaryHead}>
              <h2 className={pkgCss.summaryTitle}>{t('packaging', 'summaryHeading')}</h2>
              <Tag
                tone={run === null || run.status === 'completed'
                  ? 'neutral'
                  : run.status === 'failed' ? 'outline' : 'info'}
                className={run !== null && run.status !== 'completed' && run.status !== 'failed'
                  ? `${css.accentTag} ${css.statusTag}`
                  : undefined}
              >
                {summaryStatus}
              </Tag>
            </div>
            {/* 原型 `.panel__body`：摘要内容统一 16px 内边距，与 12px 16px 的标题行分隔。 */}
            <div className={pkgCss.summaryBody}>
              <dl className={pkgCss.summaryList}>
                <div className={pkgCss.summaryRow}>
                  <dt>{t('packaging', 'canvasLabel')}</dt>
                  <dd>{canvasName}</dd>
                </div>
                <div className={pkgCss.summaryRow}>
                  <dt>{t('packaging', 'projectLabel')}</dt>
                  <dd className={pkgCss.mono}>{projectName}</dd>
                </div>
                <div className={pkgCss.summaryRow}>
                  <dt>{t('packaging', 'summaryArtifact')}</dt>
                  <dd className={pkgCss.mono}>
                    {run === null ? t('packaging', 'summaryEmpty') : <PathValue value={run.artifactPath} />}
                  </dd>
                </div>
                <div className={pkgCss.summaryRow}>
                  <dt>{t('packaging', 'summaryNodes')}</dt>
                  <dd className={pkgCss.mono}>
                    {preview === null ? t('packaging', 'summaryEmpty') : preview.preset.agents.length}
                  </dd>
                </div>
                <div className={pkgCss.summaryRow}>
                  <dt>{t('packaging', 'summaryEdges')}</dt>
                  <dd className={pkgCss.mono}>
                    {preview === null ? t('packaging', 'summaryEmpty') : preview.preset.edges.length}
                  </dd>
                </div>
                <div className={pkgCss.summaryRow}>
                  <dt>{t('packaging', 'containsSecrets')}</dt>
                  <dd>
                    {preview === null
                      ? t('packaging', 'summaryEmpty')
                      : (
                        <Tag
                          tone={preview.containsSecrets ? 'info' : 'neutral'}
                          className={preview.containsSecrets ? `${css.accentTag} ${css.statusTag}` : undefined}
                        >
                          {preview.containsSecrets && <span className={pkgCss.badgeDot} aria-hidden="true" />}
                          {preview.containsSecrets ? t('common', 'stateYes') : t('common', 'stateNo')}
                        </Tag>
                      )}
                  </dd>
                </div>
              </dl>
              <div className={pkgCss.divider} />
              <div className={pkgCss.summaryActions}>
                <Button
                  variant="primary"
                  className={pkgCss.blockButton}
                  disabled={busy || selectedCanvas === null || selectedProject === null}
                  aria-busy={busy}
                  icon={busy ? <span className={css.spinner} aria-hidden="true" /> : undefined}
                  onClick={openConfirm}
                >
                  {busy ? t('packaging', 'running') : t('packaging', 'run')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={pkgCss.blockButton}
                  onClick={() => {
                    setSection('deployment')
                    document.getElementById('pkg-deployment')?.scrollIntoView({
                      block: 'start',
                      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                    })
                  }}
                >
                  {t('packaging', 'viewDeploy')}
                </Button>
              </div>
            </div>
          </div>
          <div className={pkgCss.railNote}>
            <div className={pkgCss.railNoteTitle}>{t('packaging', 'devPreviewTitle')}</div>
            <p className={pkgCss.railNoteBody}>{t('packaging', 'devPreviewNote')}</p>
          </div>
        </aside>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false) }}
        title={t('packaging', 'runConfirmTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('packaging', 'runConfirmDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setConfirmOpen(false) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="primary"
              disabled={busy || selectedCanvas === null || selectedProject === null}
              aria-busy={busy}
              icon={busy ? <span className={css.spinner} aria-hidden="true" /> : undefined}
              onClick={() => {
                if (selectedCanvas === null || selectedProject === null) return
                setBusy(true)
                setError(null)
                void (async () => {
                  try {
                    const result = await request<{ ok: true; run: PackagingRun }>('/packaging/run', {
                      method: 'POST',
                      body: {
                        canvasId: selectedCanvas,
                        projectId: selectedProject,
                        confirm: true,
                        form,
                        // 桌面形态把两个字段显式带给后端；profile 形态不带（服务端只在桌面形态读它们）。
                        ...(form === 'desktop'
                          ? { desktopProfile: desktopProfile.trim(), appId: desktopAppId.trim() }
                          : {}),
                      },
                    })
                    setRun(result.run)
                    setConfirmError(null)
                    setConfirmOpen(false)
                    setSection('run')
                  } catch (failure) {
                    const message = packagingFailureText(failure, 'errorRun')
                    // 失败留在弹窗内可见：页面顶部错误行会被模态遮住，用户会以为点击无效。
                    setConfirmError(message)
                    setError(message)
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              {busy ? t('packaging', 'running') : t('packaging', 'runConfirm')}
            </Button>
          </>
        )}
      >
        <div className={css.form}>
          <NoticeLine tone="error" text={confirmError} />
          <NoticeLine tone="info" text={t('packaging', 'runConfirmNotice')} />
          <Field label={t('packaging', 'canvasLabel')}>
            <Input value={canvasName} readOnly />
          </Field>
          <Field label={t('packaging', 'projectLabel')}>
            <Input value={projectName} readOnly />
          </Field>
          <Field label={t('packaging', 'formLabel')}>
            <Input value={formLabel} readOnly />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

/**
 * 打包抽屉：画布列表与画布编辑器共用同一个入口，画布由打开来源固定。
 * @param props.canvas - 打开的画布（id + 名称）；null 表示不打开。
 * @param props.open - 是否打开。
 * @param props.onClose - 关闭回调。
 */
export function PackagingDrawer({ canvas, open, onClose }: {
  canvas: { id: string; name: string } | null
  open: boolean
  onClose: () => void
}) {
  return (
    <Drawer
      open={open && canvas !== null}
      onClose={onClose}
      title={t('packaging', 'title')}
      description={t('packaging', 'subtitle')}
      closeLabel={t('common', 'actionClose')}
      className={pkgCss.drawerPanel}
    >
      {canvas === null ? null : <PackagingPage canvasId={canvas.id} canvasName={canvas.name} />}
    </Drawer>
  )
}
