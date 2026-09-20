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
      setError(describeError(failure))
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
    return canvases.filter(canvas => {
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
          value={search}
          placeholder={t('canvases', 'searchPlaceholder')}
          onChange={event => { setSearch(event.currentTarget.value) }}
        />
        <span className={css.fieldHint}>{t('canvases', 'tagFilterLabel')}</span>
        <Pill active={tagFilter === null} onClick={() => { setTagFilter(null) }}>{t('common', 'labelAll')}</Pill>
        {allTags.map(tag => (
          <Pill key={tag} active={tagFilter === tag} onClick={() => { setTagFilter(tag) }}>{tag}</Pill>
        ))}
      </div>

      <NoticeLine tone="error" text={error} action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {!loading && visible.length === 0 && <div className={css.empty}>{t('canvases', 'empty')}</div>}

      <div className={css.cardGrid}>
        {visible.map(canvas => (
          <article key={canvas.id} className={css.card}>
            <div className={css.cardHeader}>
              <span className={css.iconBlock}>{canvas.icon === null || canvas.icon === '' ? canvas.name.slice(0, 1) : canvas.icon}</span>
              <div className={css.cardTitleBlock}>
                <h2 className={css.cardTitle}>{canvas.name}</h2>
                <span className={css.cardMeta}>
                  {t('canvases', 'nodesCount', { count: canvas.canvas.nodes.length })}
                  {' · '}
                  {t('canvases', 'edgesCount', { count: canvas.canvas.edges.length })}
                </span>
                {canvas.updated_at !== null && (
                  <span className={css.cardMeta}>{t('canvases', 'updatedAt', { time: canvas.updated_at })}</span>
                )}
              </div>
            </div>
            <div className={css.cardBody}>{canvas.description ?? t('common', 'labelNone')}</div>
            <div className={css.chipRow}>
              {canvas.is_template && <Tag tone="solid">{t('canvases', 'templateBadge')}</Tag>}
              {canvas.tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
            </div>
            <div className={css.cardActions}>
              <Button size="sm" onClick={() => { navigate(`/canvases/${canvas.id}`) }}>{t('common', 'actionOpen')}</Button>
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
        onCreated={created => {
          setCreateOpen(false)
          void load().then(() => { navigate(`/canvases/${created.id}`) })
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
              variant="primary"
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
            {' — '}
            {t('canvases', 'deleteOwnProjects', {
              count: projects.filter(project => project.agentic_flow_id === deleteTarget.id).length,
            })}
          </p>
        )}
      </Modal>

      <RunCanvasDialog
        canvas={runTarget}
        projects={projects}
        onClose={() => { setRunTarget(null) }}
        onError={message => { setError(message) }}
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
                  setError(describeError(failure))
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
          <Input value={name} onChange={event => { setName(event.currentTarget.value) }} />
        </Field>
        <Field label={t('common', 'labelDescription')}>
          <textarea
            className={css.textarea}
            value={description}
            onChange={event => { setDescription(event.currentTarget.value) }}
          />
        </Field>
        <div className={css.formGrid}>
          <Field label={t('canvases', 'iconLabel')}>
            <Input
              value={icon}
              placeholder={t('canvases', 'iconPlaceholder')}
              onChange={event => { setIcon(event.currentTarget.value) }}
            />
          </Field>
          <Field label={t('common', 'labelTags')}>
            <Input
              value={tags}
              placeholder={t('canvases', 'tagsPlaceholder')}
              onChange={event => { setTags(event.currentTarget.value) }}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

/** 运行画布对话框：选择/新建运行项目后发起一次运行。 */
function RunCanvasDialog({ canvas, projects, onClose, onError, onRan }: {
  canvas: CanvasView | null
  projects: RunProjectView[]
  onClose: () => void
  onError: (message: string) => void
  onRan: () => void
}) {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(
    () => (canvas === null ? [] : projects.filter(project => project.agentic_flow_id === canvas.id)),
    [canvas, projects],
  )

  useEffect(() => {
    setProjectId(candidates[0]?.id ?? null)
    setFolder('')
    setName('')
  }, [canvas, candidates])

  const selected = candidates.find(project => project.id === projectId) ?? null

  return (
    <Modal
      open={canvas !== null}
      onClose={onClose}
      title={t('canvases', 'runTitle')}
      closeLabel={t('common', 'actionClose')}
      description={t('canvases', 'runDescription')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (canvas === null) return
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
                  onError(`${t('canvases', 'errorRun')} — ${describeError(failure)}`)
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
              onSelect={id => { setProjectId(id); setMenuOpen(false) }}
              onClose={() => { setMenuOpen(false) }}
              anchor={(
                <Button size="sm" onClick={() => { setMenuOpen(!menuOpen) }}>
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
                onChange={event => { setFolder(event.currentTarget.value) }}
              />
            </Field>
            <Field label={t('canvases', 'projectNameLabel')}>
              <Input
                value={name}
                placeholder={t('canvases', 'projectNamePlaceholder')}
                onChange={event => { setName(event.currentTarget.value) }}
              />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}
