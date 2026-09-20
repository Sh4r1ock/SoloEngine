/** 打包向导页。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button, CodeBlock, Input, Menu, Modal, Pill, StateDot, TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import { codeLabels, terminalLabels } from '../components/labels.ts'
import type { CanvasView, DeploymentGuide, PackagingPreview, PackagingRun, RunProjectView } from '../types.ts'
import css from '../styles/common.module.css'

/** 向导分节。 */
type Section = 'preview' | 'run' | 'deployment'

/** 阶段状态的终止判定。 */
function isTerminal(status: string): boolean {
  return status !== 'pending' && status !== 'running'
}

/** 阶段状态 → StateDot 状态。 */
function dotState(status: string): StateDotState {
  if (status === 'running') return 'ongoing'
  if (status === 'done' || status === 'succeeded' || status === 'success') return 'done'
  if (status === 'failed' || status === 'error') return 'error'
  return 'idle'
}

/** 阶段状态文案键。 */
function stageKey(status: string): string {
  if (status === 'running') return 'stageStatusRunning'
  if (status === 'done' || status === 'succeeded' || status === 'success') return 'stageStatusDone'
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

  const loadLists = useCallback(async (): Promise<void> => {
    try {
      const [canvasResult, projectResult, guideResult] = await Promise.all([
        request<{ ok: true; canvases: CanvasView[] }>('/canvases'),
        request<{ ok: true; projects: RunProjectView[] }>('/projects'),
        request<{ ok: true; guide: DeploymentGuide }>('/deployment/guide'),
      ])
      setCanvases(canvasResult.canvases)
      setProjects(projectResult.projects)
      setGuide(guideResult.guide)
      setError(null)
    } catch (failure) {
      setError(describeError(failure))
    }
  }, [])

  useEffect(() => { void loadLists() }, [loadLists])

  const canvasProjects = useMemo(
    () => (selectedCanvas === null ? [] : projects.filter(project => project.agentic_flow_id === selectedCanvas)),
    [projects, selectedCanvas],
  )

  useEffect(() => {
    setSelectedProject(canvasProjects[0]?.id ?? null)
  }, [canvasProjects])

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
          onSelect={id => { setSelectedCanvas(id); setCanvasMenuOpen(false) }}
          onClose={() => { setCanvasMenuOpen(false) }}
          anchor={<Button size="sm" onClick={() => { setCanvasMenuOpen(!canvasMenuOpen) }}>{canvasName}</Button>}
        />
        <span className={css.fieldHint}>{t('packaging', 'projectLabel')}</span>
        <Menu
          open={projectMenuOpen}
          items={canvasProjects.map(project => ({ id: project.id, label: `${project.name} — ${project.folder_path}` }))}
          selectedId={selectedProject ?? undefined}
          onSelect={id => { setSelectedProject(id); setProjectMenuOpen(false) }}
          onClose={() => { setProjectMenuOpen(false) }}
          anchor={<Button size="sm" onClick={() => { setProjectMenuOpen(!projectMenuOpen) }}>{projectName}</Button>}
        />
        <Button size="sm" disabled={loading} onClick={() => { void loadPreview() }}>
          {loading ? t('packaging', 'previewing') : t('packaging', 'preview')}
        </Button>
      </div>

      <div className={css.toolbar}>
        <Pill active={section === 'preview'} onClick={() => { setSection('preview') }}>{t('packaging', 'preview')}</Pill>
        <Pill active={section === 'run'} onClick={() => { setSection('run') }}>{t('packaging', 'run')}</Pill>
        <Pill active={section === 'deployment'} onClick={() => { setSection('deployment') }}>{t('packaging', 'deployment')}</Pill>
      </div>

      <NoticeLine tone="error" text={error} />

      {section === 'preview' && (
        <div className={css.section}>
          {preview === null && <div className={css.empty}>{t('packaging', 'empty')}</div>}
          {preview !== null && (
            <>
              <div className={css.definition}>
                <span className={css.definitionLabel}>{t('packaging', 'canvasHash')}</span>
                <span className={`${css.definitionValue} ${css.mono}`}>{preview.canvasHash}</span>
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
                  : preview.bundles.map(bundle => <span key={bundle} className={css.mono}>{bundle}</span>)}
              </div>
              <div className={css.sectionTitle}>{t('packaging', 'layers')}</div>
              <div className={css.tree}>
                {preview.layers.map(layer => (
                  <div key={layer.id} className={css.treeItem}>
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
                <span className={`${css.definitionValue} ${css.mono}`}>{run.id}</span>
                <span className={css.definitionLabel}>{t('common', 'labelStatus')}</span>
                <span className={css.statusRow}>
                  <StateDot state={dotState(run.status)} />
                  {t('packaging', stageKey(run.status))}
                </span>
                <span className={css.definitionLabel}>{t('packaging', 'artifactPath')}</span>
                <span className={`${css.definitionValue} ${css.mono}`}>{run.artifactPath}</span>
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
          {guide === null && <div className={css.empty}>{t('packaging', 'empty')}</div>}
          {guide !== null && (
            <>
              <div className={css.definition}>
                <span className={css.definitionLabel}>{t('packaging', 'deploymentTarget')}</span>
                <span className={css.definitionValue}>{guide.target}</span>
                <span className={css.definitionLabel}>{t('packaging', 'deploymentReady')}</span>
                <span className={`${css.definitionValue} ${css.mono}`}>{guide.ready.url}:{guide.ready.port}</span>
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
