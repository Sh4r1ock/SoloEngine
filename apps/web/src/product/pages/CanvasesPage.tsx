/** 画布列表页。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button, IconPlayOutline16, IconPlusOutline16, IconTrashOutline16,
  Input, Menu, Modal, Pill, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate, openPage } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { formatTimestamp } from '../utils/time.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import type { CanvasView, RunProjectView, RunSessionView, UserView } from '../types.ts'
import css from '../styles/common.module.css'

/**
 * 渲染画布列表。
 * @param props.user - 当前用户（用于区分公共模板）。
 */
export function CanvasesPage({ user }: { user: UserView | null }) {
  useLocale()
  const [canvases, setCanvases] = useState<CanvasView[]>([])
  const [projects, setProjects] = useState<RunProjectView[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CanvasView | null>(null)
  const [runTarget, setRunTarget] = useState<CanvasView | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [canvasResult, projectResult] = await Promise.all([
        request<{ ok: true; canvases: CanvasView[] }>('/canvases'),
        request<{ ok: true; projects: RunProjectView[] }>('/projects'),
      ])
      setCanvases(canvasResult.canvases)
      setProjects(projectResult.projects)
      setError(null)
    } catch (failure) {
      setError(`${t('canvases', 'errorLoad')} — ${describeError(failure)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const canvas of canvases) for (const tag of canvas.tags) tags.add(tag)
    return [...tags].sort()
  }, [canvases])

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return canvases.filter((canvas) => {
      if (tagFilter !== null && !canvas.tags.includes(tagFilter)) return false
      if (keyword === '') return true
      const haystack = `${canvas.name} ${canvas.description ?? ''}`.toLowerCase()
      return haystack.includes(keyword)
    })
  }, [canvases, search, tagFilter])

  const runAction = (id: string, action: () => Promise<void>, failureKey: string): void => {
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        await action()
      } catch (failure) {
        setError(`${t('canvases', failureKey)} — ${describeError(failure)}`)
      } finally {
        setBusyId(null)
      }
    })()
  }

  const isForeignTemplate = (canvas: CanvasView): boolean => canvas.is_template && user !== null && canvas.user_id !== user.id

  return (
    <div className={css.page}>
      <PageHeader
        title={t('canvases', 'title')}
        subtitle={t('canvases', 'subtitle')}
        actions={(
          <>
            <Button
              icon={<IconPlusOutline16 size={14} />}
              variant="primary"
              onClick={() => { setCreateOpen(true) }}
            >
              {t('canvases', 'newCanvas')}
            </Button>
            <Button onClick={() => { void load() }}>{t('common', 'actionRefresh')}</Button>
          </>
        )}
      />

      <div className={css.toolbar}>
        <Input
          className={css.toolbarSearch ?? ''}
          value={search}
          placeholder={t('canvases', 'searchPlaceholder')}
          aria-label={t('canvases', 'searchAria')}
          onChange={(event) => { setSearch(event.currentTarget.value) }}
        />
        <span className={css.fieldHint}>{t('canvases', 'tagFilterLabel')}</span>
        {/* 原生 Pill 只把选中态写成 class，辅助技术读不到（WCAG 4.1.2）；与市场/技能/MCP
            各页同一惯例，产品层透传 aria-pressed。 */}
        <Pill active={tagFilter === null} aria-pressed={tagFilter === null} onClick={() => { setTagFilter(null) }}>{t('common', 'labelAll')}</Pill>
        {allTags.map(tag => (
          <Pill key={tag} active={tagFilter === tag} aria-pressed={tagFilter === tag} onClick={() => { setTagFilter(tag) }}>{tag}</Pill>
        ))}
      </div>

      <NoticeLine tone="error" text={error} action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {!loading && visible.length === 0 && (
        <div className={css.empty}>
          {/* 区分「全空」与「过滤无匹配」：两者给同一条空态文案会误导（画布明明存在）。 */}
          {canvases.length === 0 ? t('canvases', 'empty') : t('canvases', 'noMatch')}
        </div>
      )}

      <div className={css.cardGrid}>
        {visible.map(canvas => (
          <article key={canvas.id} className={css.card}>
            <div className={css.cardHeader}>
              <span className={css.iconBlock}>{canvas.icon === null || canvas.icon === '' ? canvas.name.slice(0, 1) : canvas.icon}</span>
              <div className={css.cardTitleBlock}>
                <h2 className={css.cardTitle}>{canvas.name}</h2>
                <span className={css.cardMeta}>
                  {canvas.canvas.nodes.length === 1 ? t('canvases', 'nodesCountOne') : t('canvases', 'nodesCount', { count: canvas.canvas.nodes.length })}
                  {' · '}
                  {canvas.canvas.edges.length === 1 ? t('canvases', 'edgesCountOne') : t('canvases', 'edgesCount', { count: canvas.canvas.edges.length })}
                </span>
                {formatTimestamp(canvas.updated_at) !== '' && (
                  <span className={css.cardMeta}>
                    {t('canvases', 'updatedAt', { time: formatTimestamp(canvas.updated_at) })}
                  </span>
                )}
              </div>
            </div>
            {/* 描述为空时整行省略：孤行「无」在卡片网格里形似渲染残缺（与 MCP/技能/市场页同一规则）。 */}
            {canvas.description !== null && canvas.description !== ''
              ? <div className={css.cardBody}>{canvas.description}</div>
              : null}
            <div className={css.chipRow}>
              {canvas.is_template && <Tag tone="solid">{t('canvases', 'templateBadge')}</Tag>}
              {canvas.tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
            </div>
            <div className={css.cardActions}>
              <Button size="sm" onClick={() => { navigate(`/canvas/${canvas.id}`) }}>{t('common', 'actionOpen')}</Button>
              <Button
                size="sm"
                icon={<IconPlayOutline16 size={14} />}
                disabled={busyId === canvas.id}
                onClick={() => { setRunTarget(canvas) }}
              >
                {t('canvases', 'run')}
              </Button>
              <Button
                size="sm"
                disabled={busyId === canvas.id}
                onClick={() => {
                  runAction(canvas.id, async () => {
                    await request(`/canvases/${canvas.id}/duplicate`, { method: 'POST' })
                    await load()
                  }, 'errorDuplicate')
                }}
              >
                {t('canvases', 'duplicate')}
              </Button>
              <Button
                size="sm"
                onClick={() => { navigate(`/packaging?canvasId=${canvas.id}`) }}
              >
                {t('canvases', 'packagingAction')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<IconTrashOutline16 size={14} />}
                disabled={isForeignTemplate(canvas) || busyId === canvas.id}
                title={isForeignTemplate(canvas) ? t('canvases', 'publicTemplate') : undefined}
                onClick={() => { setDeleteTarget(canvas) }}
              >
                {t('common', 'actionDelete')}
              </Button>
            </div>
          </article>
        ))}
      </div>

      <CreateCanvasDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false) }}
        onCreated={(created) => {
          setCreateOpen(false)
          void load().then(() => { navigate(`/canvas/${created.id}`) })
        }}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null) }}
        title={t('common', 'confirmDeleteTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('common', 'confirmDeleteDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDeleteTarget(null) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="ghost"
              className={css.dangerButton}
              disabled={deleteTarget === null || busyId === deleteTarget.id}
              onClick={() => {
                const target = deleteTarget
                if (target === null) return
                runAction(target.id, async () => {
                  await request(`/canvases/${target.id}`, { method: 'DELETE' })
                  setDeleteTarget(null)
                  await load()
                }, 'errorDelete')
              }}
            >
              {t('common', 'actionDelete')}
            </Button>
          </>
        )}
      >
        {deleteTarget !== null && (
          <p className={css.cardBody}>
            {deleteTarget.name}
            {(() => {
              // 没有运行项目时不写级联句：实测「删除画布会同时删除 0 个运行项目及其会话记录」
              // 是对不存在的级联作断言（R17 只说事实），分隔符也随之收掉。
              const count = projects.filter(project => project.agentic_flow_id === deleteTarget.id).length
              if (count === 0) return null
              return (
                <>
                  {' — '}
                  {/* en 单复数：count=1 走单数键（避免 "1 run projects"）。 */}
                  {count === 1
                    ? t('canvases', 'deleteOwnProjectsOne')
                    : t('canvases', 'deleteOwnProjects', { count })}
                </>
              )
            })()}
          </p>
        )}
      </Modal>

      <RunCanvasDialog
        canvas={runTarget}
        projects={projects}
        onClose={() => { setRunTarget(null) }}
        onRan={() => { setRunTarget(null) }}
      />
    </div>
  )
}

/** 新建画布对话框。 */
function CreateCanvasDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (canvas: CanvasView) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('canvases', 'newCanvasTitle')}
      closeLabel={t('common', 'actionClose')}
      description={t('canvases', 'newCanvasDescription')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            variant="primary"
            disabled={busy || name.trim() === ''}
            onClick={() => {
              setBusy(true)
              setError(null)
              void (async () => {
                try {
                  const parsedTags = tags.split(',').map(item => item.trim()).filter(item => item !== '')
                  const result = await request<{ ok: true; canvas: CanvasView }>('/canvases', {
                    method: 'POST',
                    body: {
                      name: name.trim(),
                      ...(description.trim() === '' ? {} : { description: description.trim() }),
                      ...(icon.trim() === '' ? {} : { icon: icon.trim() }),
                      ...(parsedTags.length === 0 ? {} : { tags: parsedTags }),
                    },
                  })
                  setName('')
                  setDescription('')
                  setIcon('')
                  setTags('')
                  onCreated(result.canvas)
                } catch (failure) {
                  setError(`${t('canvases', 'errorCreate')} — ${describeError(failure)}`)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? t('canvases', 'creating') : t('canvases', 'create')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <NoticeLine tone="error" text={error} />
        <Field label={t('common', 'labelName')}>
          <Input value={name} onChange={(event) => { setName(event.currentTarget.value) }} />
        </Field>
        <Field label={t('common', 'labelDescription')}>
          <textarea
            className={css.textarea}
            value={description}
            onChange={(event) => { setDescription(event.currentTarget.value) }}
          />
        </Field>
        <div className={css.formGrid}>
          <Field label={t('canvases', 'iconLabel')}>
            <Input
              value={icon}
              placeholder={t('canvases', 'iconPlaceholder')}
              onChange={(event) => { setIcon(event.currentTarget.value) }}
            />
          </Field>
          <Field label={t('common', 'labelTags')}>
            <Input
              value={tags}
              placeholder={t('canvases', 'tagsPlaceholder')}
              onChange={(event) => { setTags(event.currentTarget.value) }}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

/** 运行画布对话框：选择/新建运行项目后发起一次运行。 */
function RunCanvasDialog({ canvas, projects, onClose, onRan }: {
  canvas: CanvasView | null
  projects: RunProjectView[]
  onClose: () => void
  onRan: () => void
}) {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // 错误就近呈现在对话框内（与 CreateCanvasDialog 同模式）：委托到页面级会被 Modal 遮挡。
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(
    () => (canvas === null ? [] : projects.filter(project => project.agentic_flow_id === canvas.id)),
    [canvas, projects],
  )

  useEffect(() => {
    setProjectId(candidates[0]?.id ?? null)
    setFolder('')
    setName('')
    setError(null)
  }, [canvas, candidates])

  const selected = candidates.find(project => project.id === projectId) ?? null

  return (
    <Modal
      open={canvas !== null}
      onClose={onClose}
      title={t('canvases', 'runTitle')}
      closeLabel={t('common', 'actionClose')}
      description={t('canvases', 'runDescription')}
      className={css.modalDialog ?? ''}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (canvas === null) return
              // 新建项目路径前置校验：folder 是沙箱根必填（FR-CANVAS-040/041），
              // 空值发给后端只会拿到 FOLDER_REQUIRED 机器码（NN/G：错误应在提交前就近拦截）。
              if (projectId === null && folder.trim() === '') {
                setError(t('canvases', 'projectFolderRequired'))
                return
              }
              setBusy(true)
              void (async () => {
                try {
                  let targetId = projectId
                  if (targetId === null) {
                    const created = await request<{ ok: true; project: RunProjectView }>('/projects', {
                      method: 'POST',
                      body: {
                        canvasId: canvas.id,
                        folderPath: folder.trim(),
                        ...(name.trim() === '' ? {} : { name: name.trim() }),
                      },
                    })
                    targetId = created.project.id
                  }
                  const session = await request<{ ok: true; session: RunSessionView }>('/runs', {
                    method: 'POST',
                    body: { canvasId: canvas.id, projectId: targetId },
                  })
                  onRan()
                  openPage(session.session.panel_path)
                } catch (failure) {
                  setError(`${t('canvases', 'errorRun')} — ${describeError(failure)}`)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? t('canvases', 'runStarting') : t('canvases', 'runConfirm')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <NoticeLine tone="error" text={error} />
        <div className={css.field}>
          <span className={css.fieldLabel}>{t('canvases', 'projectLabel')}</span>
          <div className={css.fieldControl}>
            <Menu
              open={menuOpen}
              autoFocus
              align="start"
              items={candidates.map(project => ({
                id: project.id,
                label: `${project.name} — ${project.folder_path}`,
              }))}
              selectedId={projectId ?? undefined}
              onSelect={(id) => { setProjectId(id); setMenuOpen(false) }}
              onClose={() => { setMenuOpen(false) }}
              anchor={(
                <Button size="sm" disabled={candidates.length === 0} onClick={() => { setMenuOpen(!menuOpen) }}>
                  {selected === null ? t('common', 'actionSelect') : selected.name}
                </Button>
              )}
            />
            {candidates.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { setProjectId(null) }}>
                {t('common', 'actionCreate')}
              </Button>
            )}
          </div>
          {candidates.length === 0 && <span className={css.fieldHint}>{t('canvases', 'projectEmpty')}</span>}
        </div>
        {projectId === null && (
          <>
            <Field label={t('canvases', 'projectFolderLabel')} hint={t('canvases', 'projectFolderHint')}>
              <Input
                value={folder}
                placeholder={t('canvases', 'projectFolderPlaceholder')}
                onChange={(event) => { setFolder(event.currentTarget.value) }}
              />
            </Field>
            <Field label={t('canvases', 'projectNameLabel')}>
              <Input
                value={name}
                placeholder={t('canvases', 'projectNamePlaceholder')}
                onChange={(event) => { setName(event.currentTarget.value) }}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}
