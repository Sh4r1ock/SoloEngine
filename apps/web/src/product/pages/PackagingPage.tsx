/** 打包向导页。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button, CodeBlock, Input, Menu, Modal, Pill, StateDot, Tag, TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import { PathValue } from '../components/PathValue.tsx'
import { codeLabels, terminalLabels } from '../components/labels.ts'
import type { CanvasView, DeploymentGuide, PackagingPreview, PackagingRun, RunProjectView } from '../types.ts'
import css from '../styles/common.module.css'

/** 向导分节。 */
type Section = 'preview' | 'run' | 'deployment'

/** 阶段状态的终止判定。 */
function isTerminal(status: string): boolean {
  return status !== 'pending' && status !== 'running'
}

/**
 * 状态词表真源：`soloengine-framework/src/modules/packaging.ts` —— 阶段状态是字面量联合
 * `'ok'`（L48，四个阶段全部同值），运行状态恒为 `'completed'`（L442/L504）。
 * 此前这两个映射只认 'done'/'succeeded'/'success'，于是**一次成功的打包在界面上被渲染成
 * 灰色「等待」**（实测截图 S11-04：状态行「等待」，而其下终端卡为绿色「完成」并打印
 * "wrote 3 top-level files, 5797 bytes"）——同一行自相矛盾。
 */
function dotState(status: string): StateDotState {
  if (status === 'running') return 'ongoing'
  if (status === 'ok' || status === 'completed' || status === 'done' || status === 'succeeded' || status === 'success') return 'done'
  if (status === 'failed' || status === 'error') return 'error'
  return 'idle'
}

/** 阶段状态文案键。 */
function stageKey(status: string): string {
  if (status === 'running') return 'stageStatusRunning'
  if (status === 'ok' || status === 'completed' || status === 'done' || status === 'succeeded' || status === 'success') return 'stageStatusDone'
  if (status === 'failed' || status === 'error') return 'stageStatusFailed'
  return 'stageStatusPending'
}

/**
 * 渲染打包向导。
 * @param props.canvasId - 查询串带来的画布 ID（可为 null）。
 */
export function PackagingPage({ canvasId }: { canvasId: string | null }) {
  useLocale()
  const [section, setSection] = useState<Section>('preview')
  const [canvases, setCanvases] = useState<CanvasView[]>([])
  const [projects, setProjects] = useState<RunProjectView[]>([])
  const [selectedCanvas, setSelectedCanvas] = useState<string | null>(canvasId)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [preview, setPreview] = useState<PackagingPreview | null>(null)
  const [run, setRun] = useState<PackagingRun | null>(null)
  const [guide, setGuide] = useState<DeploymentGuide | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [canvasMenuOpen, setCanvasMenuOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)

  // 三份数据各自独立成败：此前用 Promise.all + 单一文案，实测阻断 /projects 后界面报
  // 「画布列表加载失败」（而 /canvases 与 /deployment/guide 都返回 200），既归错责任方
  // 又把已取到的两份数据一起丢掉（R8 具体 / R17 可操作出路 / R24 部分失败隔离）。
  const loadLists = useCallback(async (): Promise<void> => {
    const [canvasResult, projectResult, guideResult] = await Promise.allSettled([
      request<{ ok: true; canvases: CanvasView[] }>('/canvases'),
      request<{ ok: true; projects: RunProjectView[] }>('/projects'),
      request<{ ok: true; guide: DeploymentGuide }>('/deployment/guide'),
    ])
    const failed: string[] = []
    let reason: unknown = null
    const settle = <T,>(result: PromiseSettledResult<T>, label: string, apply: (value: T) => void): void => {
      if (result.status === 'fulfilled') apply(result.value)
      else {
        failed.push(label)
        reason ??= result.reason
      }
    }
    settle(canvasResult, t('packaging', 'errorCanvases'), (value) => { setCanvases(value.canvases) })
    settle(projectResult, t('packaging', 'errorProjects'), (value) => { setProjects(value.projects) })
    settle(guideResult, t('packaging', 'errorDeployment'), (value) => { setGuide(value.guide) })
    if (failed.length === 0) {
      setError(null)
      return
    }
    setError(`${failed.join('；')} — ${describeError(reason)}`)
  }, [])

  useEffect(() => { void loadLists() }, [loadLists])

  const canvasProjects = useMemo(
    () => (selectedCanvas === null ? [] : projects.filter(project => project.agentic_flow_id === selectedCanvas)),
    [projects, selectedCanvas],
  )

  useEffect(() => {
    setSelectedProject(canvasProjects[0]?.id ?? null)
  }, [canvasProjects])

  // 预览与运行结果都属于「画布 + 项目」这一对：换掉任一侧就必须作废上一次结果。
  // 实测残留：选中 m3-canvas-muc85fwi 后预览区仍显示上一画布的哈希 dc9b97f48e59c9a4
  // 与 31 行配置层；打包出 b4947ae0 后切画布，运行区仍显示该标识、「状态 完成」与四个
  // 完成阶段——把别的画布的结果当成当前画布的（R26 悬空 UI 状态 / 认知走查 Q4）。
  useEffect(() => {
    setPreview(null)
    setRun(null)
  }, [selectedCanvas, selectedProject])

  const loadPreview = useCallback(async (): Promise<void> => {
    if (selectedCanvas === null || selectedProject === null) {
      setError(t('packaging', 'needCanvas'))
      return
    }
    setLoading(true)
    try {
      const result = await request<{ ok: true; preview: PackagingPreview }>('/packaging/preview', {
        query: { canvasId: selectedCanvas, projectId: selectedProject },
      })
      setPreview(result.preview)
      setError(null)
    } catch (failure) {
      setError(`${t('packaging', 'errorPreview')} — ${describeError(failure)}`)
    } finally {
      setLoading(false)
    }
  }, [selectedCanvas, selectedProject])

  // 打包运行的阶段轮询（终态即停）。
  const runId = run?.id ?? null
  const runStatus = run?.status ?? null
  useEffect(() => {
    if (runId === null || runStatus === null || isTerminal(runStatus)) return
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const result = await request<{ ok: true; run: PackagingRun }>(`/packaging/runs/${runId}`)
          setRun(result.run)
        } catch (failure) {
          setError(`${t('packaging', 'errorRun')} — ${describeError(failure)}`)
          window.clearInterval(timer)
        }
      })()
    }, 1500)
    return () => { window.clearInterval(timer) }
  }, [runId, runStatus])

  const canvasName = canvases.find(canvas => canvas.id === selectedCanvas)?.name ?? t('packaging', 'canvasNone')
  const projectName = canvasProjects.find(project => project.id === selectedProject)?.name ?? t('packaging', 'projectNone')

  return (
    <div className={css.page}>
      <PageHeader
        title={t('packaging', 'title')}
        subtitle={t('packaging', 'subtitle')}
        actions={(
          <>
            <Button onClick={() => { navigate('/canvases') }}>{t('packaging', 'backToCanvases')}</Button>
            <Button onClick={() => { void loadLists() }}>{t('common', 'actionRefresh')}</Button>
          </>
        )}
      />

      <div className={css.toolbar}>
        <span className={css.fieldHint}>{t('packaging', 'canvasLabel')}</span>
        <Menu
          open={canvasMenuOpen}
          items={canvases.map(canvas => ({ id: canvas.id, label: canvas.name }))}
          selectedId={selectedCanvas ?? undefined}
          onSelect={(id) => { setSelectedCanvas(id); setCanvasMenuOpen(false) }}
          onClose={() => { setCanvasMenuOpen(false) }}
          anchor={<Button size="sm" onClick={() => { setCanvasMenuOpen(!canvasMenuOpen) }}>{canvasName}</Button>}
        />
        <span className={css.fieldHint}>{t('packaging', 'projectLabel')}</span>
        <Menu
          open={projectMenuOpen}
          items={canvasProjects.map(project => ({ id: project.id, label: `${project.name} — ${project.folder_path}` }))}
          selectedId={selectedProject ?? undefined}
          onSelect={(id) => { setSelectedProject(id); setProjectMenuOpen(false) }}
          onClose={() => { setProjectMenuOpen(false) }}
          anchor={<Button size="sm" onClick={() => { setProjectMenuOpen(!projectMenuOpen) }}>{projectName}</Button>}
        />
        {/* 前置条件缺失时禁用并就地给出出路（R8 前置校验优先），与下方运行区
            「禁用 + 请选择运行项目」同一惯例；此前按钮始终可点，点击后才在页面顶部
            报一条红字（实测原文「请从画布列表进入打包，或在上方选择画布」）。 */}
        <Button
          size="sm"
          disabled={loading || selectedCanvas === null || selectedProject === null}
          onClick={() => { void loadPreview() }}
        >
          {loading ? t('packaging', 'previewing') : t('packaging', 'preview')}
        </Button>
        {(selectedCanvas === null || selectedProject === null) && (
          <span className={css.fieldHint}>
            {t('packaging', selectedCanvas === null ? 'needCanvas' : 'needProject')}
          </span>
        )}
      </div>

      <div className={css.toolbar}>
        {/* 分节药丸用名词、动作按钮用动词：此前两者同名（药丸「执行打包」紧邻主按钮
            「执行打包」，点药丸并不执行任何事），首次使用者无法预判行为（R7 / 认知走查 Q3）。 */}
        <Pill active={section === 'preview'} aria-pressed={section === 'preview'} onClick={() => { setSection('preview') }}>{t('packaging', 'sectionPreview')}</Pill>
        <Pill active={section === 'run'} aria-pressed={section === 'run'} onClick={() => { setSection('run') }}>{t('packaging', 'sectionRun')}</Pill>
        <Pill active={section === 'deployment'} aria-pressed={section === 'deployment'} onClick={() => { setSection('deployment') }}>{t('packaging', 'deployment')}</Pill>
      </div>

      <NoticeLine tone="error" text={error} />

      {section === 'preview' && (
        <div className={css.section}>
          {preview === null && <div className={css.empty}>{t('packaging', 'empty')}</div>}
          {preview !== null && (
            <>
              <div className={css.definition}>
                <span className={css.definitionLabel}>{t('packaging', 'canvasHash')}</span>
                {/* 路径/长代号值统一走 PathValue（手册 §2.8）：`.mono` 的 anywhere 会把
                    代号从连字符处折断（实测 880 下制品路径断成「…4215-」+「a4d0…」，
                    截图 S11-09），PathValue 只在分隔符后断并给出完整值 title。 */}
                <span className={css.definitionValue}><PathValue value={preview.canvasHash} /></span>
                <span className={css.definitionLabel}>{t('packaging', 'revision')}</span>
                <span className={css.definitionValue}>{preview.revision}</span>
                <span className={css.definitionLabel}>{t('packaging', 'containsSecrets')}</span>
                <span className={css.definitionValue}>
                  {preview.containsSecrets ? t('common', 'stateYes') : t('common', 'stateNo')}
                </span>
              </div>
              <div className={css.sectionTitle}>{t('packaging', 'bundles')}</div>
              <div className={css.chipRow}>
                {preview.bundles.length === 0
                  ? <span className={css.fieldHint}>{t('common', 'labelNone')}</span>
                  /* 同一 chipRow 在其它页（技能/MCP/市场/画布）一律用 Tag：这里曾是裸
                     mono span 串成一行，同类元素跨页不同形（R3 / §二c 同类元素统一）。
                     包名保持等宽，故 Tag + mono 组合而非改字体。 */
                  : preview.bundles.map(bundle => <Tag key={bundle} tone="neutral" className={css.mono}>{bundle}</Tag>)}
              </div>
              <div className={css.sectionTitle}>{t('packaging', 'layers')}</div>
              <div className={css.tree}>
                {preview.layers.map(layer => (
                  <div key={layer.id} className={`${css.listRow} ${css.listRowCols}`}>
                    <span>{layer.id}</span>
                    <span className={css.fieldHint}>{layer.kind}</span>
                    <span>{layer.summary}</span>
                  </div>
                ))}
              </div>
              <div className={css.sectionTitle}>{t('packaging', 'preset')}</div>
              <CodeBlock code={JSON.stringify(preview.preset, null, 2)} lang="json" {...codeLabels()} />
            </>
          )}
        </div>
      )}

      {section === 'run' && (
        <div className={css.section}>
          <div className={css.toolbar}>
            <Button
              variant="primary"
              disabled={busy || selectedCanvas === null || selectedProject === null}
              onClick={() => { setConfirmOpen(true) }}
            >
              {busy ? t('packaging', 'running') : t('packaging', 'run')}
            </Button>
            {selectedProject === null && <span className={css.fieldHint}>{t('packaging', 'needProject')}</span>}
          </div>
          {run !== null && (
            <>
              <div className={css.definition}>
                <span className={css.definitionLabel}>{t('common', 'labelId')}</span>
                <span className={css.definitionValue}><PathValue value={run.id} /></span>
                <span className={css.definitionLabel}>{t('common', 'labelStatus')}</span>
                <span className={css.statusRow}>
                  <StateDot state={dotState(run.status)} />
                  {t('packaging', stageKey(run.status))}
                </span>
                <span className={css.definitionLabel}>{t('packaging', 'artifactPath')}</span>
                <span className={css.definitionValue}><PathValue value={run.artifactPath} /></span>
              </div>
              <div className={css.sectionTitle}>{t('packaging', 'stages')}</div>
              {run.stages.map(stage => (
                <div key={stage.id} className={css.section}>
                  <div className={css.statusRow}>
                    <StateDot state={dotState(stage.status)} />
                    <span>{stage.label}</span>
                    <span className={css.fieldHint}>{t('packaging', stageKey(stage.status))}</span>
                  </div>
                  <TerminalBlock
                    command={stage.label}
                    output={stage.output}
                    exitCode={stage.status === 'failed' ? 1 : 0}
                    labels={terminalLabels()}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {section === 'deployment' && (
        <div className={css.section}>
          {guide === null && <div className={css.empty}>{t('packaging', 'emptyGuide')}</div>}
          {guide !== null && (
            <>
              <div className={css.definition}>
                <span className={css.definitionLabel}>{t('packaging', 'deploymentTarget')}</span>
                <span className={css.definitionValue}>{guide.target}</span>
                <span className={css.definitionLabel}>{t('packaging', 'deploymentReady')}</span>
                {/* 后端 `ready.url` 本身就是 `http://<host>:<port>`（真源 packaging.ts L593），
                    再拼一次 `:{port}` 会渲染出 `http://127.0.0.1:8991:8991`（实测原文）。 */}
                <span className={css.definitionValue}><PathValue value={guide.ready.url} /></span>
              </div>
              {guide.steps.map(step => (
                <div key={step.id} className={css.section}>
                  <div className={css.sectionTitle}>{step.label}</div>
                  <CodeBlock code={step.command} lang="shellscript" {...codeLabels()} />
                  {step.note !== '' && (
                    <div className={css.fieldHint}>{t('packaging', 'deploymentNote')}: {step.note}</div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

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
              onClick={() => {
                if (selectedCanvas === null || selectedProject === null) return
                setBusy(true)
                setError(null)
                void (async () => {
                  try {
                    const result = await request<{ ok: true; run: PackagingRun }>('/packaging/run', {
                      method: 'POST',
                      body: { canvasId: selectedCanvas, projectId: selectedProject, confirm: true },
                    })
                    setRun(result.run)
                    setConfirmOpen(false)
                    setSection('run')
                  } catch (failure) {
                    setError(`${t('packaging', 'errorRun')} — ${describeError(failure)}`)
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
          <Field label={t('packaging', 'canvasLabel')}>
            <Input value={canvasName} readOnly />
          </Field>
          <Field label={t('packaging', 'projectLabel')}>
            <Input value={projectName} readOnly />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
