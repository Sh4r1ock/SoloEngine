/** 画布列表页：约 800px 密集列表 + 300px 最近会话栏。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconArchiveOutlineMedium, IconBrowseOutlineRegular,
  IconCopyOutlineRegular, IconEditOutlineRegular, IconEllipsisOutlineRegular, IconPinOutlineRegular,
  IconPlayOutlineRegular, IconPlusOutlineRegular,
  IconSearchOutlineRegular, IconTrashOutlineRegular,
  Input, Menu, Modal, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate, openPage } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { formatEpochTimestamp, relativeTime, type RelativeTime } from '../utils/time.ts'
import { submitFormOnEnter } from '../utils/submitOnEnter.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import { IconPicker } from '../components/IconPicker.tsx'
import { useSearchShortcut } from '../components/useSearchShortcut.ts'
import { useToastHost } from '../components/Toaster.tsx'
import { PackagingDrawer } from './PackagingPage.tsx'
import type { CanvasView, RunProjectView, RunSessionView, UserView } from '../types.ts'
import common from '../styles/common.module.css'
import css from '../styles/canvases.module.css'

/** 会话状态 → 文案键（含台账的 pending / stopped，未知值才回落「未知」）。 */
function sessionStatusKey(status: string): string {
  if (status === 'pending') return 'sessionPending'
  if (status === 'running') return 'sessionRunning'
  if (status === 'completed') return 'sessionCompleted'
  if (status === 'failed') return 'sessionFailed'
  if (status === 'cancelled') return 'sessionCancelled'
  if (status === 'stopped') return 'sessionStopped'
  return 'sessionUnknown'
}

/** 会话状态点：运行中脉冲、失败用墨色（原型 `.dot--live` / `.dot--ink`），其余中性。 */
function sessionDotClass(status: string): string {
  if (status === 'running') return css.sessionDotActive ?? ''
  if (status === 'failed') return css.sessionDotFailed ?? ''
  return css.sessionDot ?? ''
}

/**
 * 画布列表的「更新于」相对时间文案（原型 canvases.js:66）。
 * @param value - 相对时间单位与计数。
 * @returns 当前语言的相对时间文本。
 */
function relativeLabel(value: RelativeTime): string {
  if (value.unit === 'justNow') return t('canvases', 'relativeJustNow')
  if (value.unit === 'date') return value.date ?? ''
  const count = value.count ?? 0
  if (value.unit === 'minutes') return t('canvases', 'relativeMinutes', { count })
  if (value.unit === 'hours') return t('canvases', 'relativeHours', { count })
  return t('canvases', 'relativeDays', { count })
}

/**
 * 单字徽标（原型 `canvas.monogram`，data.js:11）：有图标取图标首字，否则取名称首字。
 * @param canvas - 画布行。
 * @returns 单个字符；名称与图标都为空时为空串。
 */
function monogram(canvas: CanvasView): string {
  const icon = canvas.icon?.trim() ?? ''
  const source = icon === '' ? canvas.name.trim() : icon
  return Array.from(source)[0] ?? ''
}

/**
 * 渲染画布列表。
 * @param props.user - 当前用户（决定他人模板是否只读）。
 */
export function CanvasesPage({ user }: { user: UserView }) {
  useLocale()
  const toast = useToastHost()
  const [canvases, setCanvases] = useState<CanvasView[]>([])
  const [projects, setProjects] = useState<RunProjectView[]>([])
  const [sessions, setSessions] = useState<RunSessionView[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  /** 运行项目列表失败：只在项目相关区域呈现，不阻断画布列表。 */
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<{ text: string; retry: () => void } | null>(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  /** 正在编辑元信息的画布（null = 对话框关闭）。 */
  const [editTarget, setEditTarget] = useState<CanvasView | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CanvasView | null>(null)
  /** 删除失败原因：必须显示在确认弹窗内，页面层的错误会被遮罩挡住。 */
  const [deleteError, setDeleteError] = useState<string | null>(null)
  /** 打包抽屉的来源画布（null = 关闭）；打包不是页面，只在画布上下文里打开。 */
  const [packageTarget, setPackageTarget] = useState<CanvasView | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Ctrl/Cmd+K 聚焦搜索（原型搜索框右端的键位提示必须真的可用）。
  useSearchShortcut(searchRef)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    // 画布列表与运行项目彼此独立：项目失败不能把画布列表一起判失败（allSettled）。
    const [canvasResult, projectResult] = await Promise.allSettled([
      request<{ ok: true; canvases: CanvasView[] }>('/canvases'),
      request<{ ok: true; projects: RunProjectView[] }>('/projects'),
    ])
    if (canvasResult.status === 'fulfilled') {
      setCanvases(canvasResult.value.canvases)
      setError(null)
    } else {
      // 重试必须重跑失败的那个动作：列表加载失败时重试 load，删除/复制失败时重试原动作。
      setError({ text: `${t('canvases', 'errorLoad')} — ${describeError(canvasResult.reason)}`, retry: () => { void load() } })
    }
    if (projectResult.status === 'fulfilled') {
      setProjects(projectResult.value.projects)
      setProjectsError(null)
    } else {
      setProjectsError(`${t('canvases', 'errorLoadProjects')} — ${describeError(projectResult.reason)}`)
    }
    setLoading(false)
  }, [])

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      const result = await request<{ ok: true; sessions: RunSessionView[] }>('/sessions?limit=10')
      setSessions(result.sessions)
      setSessionsError(null)
    } catch (failure) {
      setSessionsError(`${t('canvases', 'errorLoad')} — ${describeError(failure)}`)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadSessions() }, [loadSessions])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const canvas of canvases) for (const tag of canvas.tags) tags.add(tag)
    // 正在生效的过滤值必须留在选项里，否则下拉会显示成「无过滤」而列表仍被过滤。
    if (tagFilter !== null && !tags.has(tagFilter)) tags.add(tagFilter)
    return [...tags].sort()
  }, [canvases, tagFilter])

  const templates = useMemo(() => canvases.filter(canvas => canvas.is_template), [canvases])

  // 原型 canvases.js:167 将新建/复制画布 unshift 到列表顶部；服务端按 created_at ASC 返回，
  // 页面按创建时间倒序呈现，新建后回到列表即可在最上面看到（最新在前）。
  const ordered = useMemo(() => {
    return [...canvases].sort((left, right) => (right.created_at ?? '').localeCompare(left.created_at ?? ''))
  }, [canvases])

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return ordered.filter((canvas) => {
      if (tagFilter !== null && !canvas.tags.includes(tagFilter)) return false
      if (keyword === '') return true
      const haystack = `${canvas.name} ${canvas.description ?? ''}`.toLowerCase()
      return haystack.includes(keyword)
    })
  }, [ordered, search, tagFilter])

  const canvasName = useMemo(() => {
    const names = new Map<string, string>()
    for (const canvas of canvases) names.set(canvas.id, canvas.name)
    return names
  }, [canvases])

  const projectName = useMemo(() => {
    const names = new Map<string, string>()
    for (const project of projects) names.set(project.id, project.name)
    return names
  }, [projects])

  // 级联事实只按台账计数陈述；项目列表不可用时不能断言「没有运行项目」，改为提示无法确认。
  const deleteProjectCount = deleteTarget === null
    ? 0
    : projects.filter(project => project.agentic_flow_id === deleteTarget.id).length
  let deleteDetail = t('canvases', 'deleteNoProjects')
  if (projectsError !== null) deleteDetail = t('canvases', 'deleteProjectsUnknown')
  else if (deleteProjectCount === 1) deleteDetail = t('canvases', 'deleteOwnProjectsOne')
  else if (deleteProjectCount > 1) deleteDetail = t('canvases', 'deleteOwnProjects', { count: deleteProjectCount })
  const deleteDescription = deleteTarget === null
    ? undefined
    : t('canvases', 'deleteDescription', { detail: deleteDetail })

  const runAction = (id: string, action: () => Promise<void>, failureKey: string, successText?: string): void => {
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        await action()
        if (successText !== undefined) toast.show(successText, 'success')
      } catch (failure) {
        setError({
          text: `${t('canvases', failureKey)} — ${describeError(failure)}`,
          retry: () => { runAction(id, action, failureKey, successText) },
        })
      } finally {
        setBusyId(null)
      }
    })()
  }

  const duplicate = (canvas: CanvasView, openAfter: boolean): void => {
    runAction(canvas.id, async () => {
      const result = await request<{ ok: true; canvas: CanvasView }>(`/canvases/${canvas.id}/duplicate`, { method: 'POST' })
      await load()
      if (openAfter) navigate(`/canvas/${result.canvas.id}`)
      else toast.show(t('canvases', 'duplicateDone', { name: result.canvas.name }), 'success')
    }, 'errorDuplicate')
  }

  /** 设为/取消模板：模板是「从模板开始」的数据源，必须由用户真实写入（不再是恒空的选择器）。 */
  const setTemplate = (canvas: CanvasView, next: boolean): void => {
    runAction(canvas.id, async () => {
      const result = await request<{ ok: true; canvas: CanvasView }>(`/canvases/${canvas.id}`, {
        method: 'PATCH',
        body: { is_template: next, version: canvas.version },
      })
      setCanvases(previous => previous.map(item => item.id === result.canvas.id ? result.canvas : item))
    }, 'errorUpdate', t('canvases', next ? 'toastTemplateSet' : 'toastTemplateUnset'))
  }

  return (
    <div className={common.page}>
      <PageHeader
        title={t('canvases', 'title')}
        subtitle={t('canvases', 'subtitle')}
        actions={(
          <>
            <Button icon={<IconBrowseOutlineRegular size={14} />} onClick={() => { navigate('/market') }}>
              {t('canvases', 'browseMarket')}
            </Button>
            <Button onClick={() => { setTemplateOpen(true) }}>{t('canvases', 'fromTemplate')}</Button>
            <Button
              icon={<IconPlusOutlineRegular size={14} />}
              variant="primary"
              onClick={() => { setCreateOpen(true) }}
            >
              {t('canvases', 'newCanvas')}
            </Button>
          </>
        )}
      />

      <div className={css.layout}>
        <section className={css.listColumn} aria-labelledby="canvases-list-title">
          <h2 id="canvases-list-title" className={common.srOnly}>{t('canvases', 'listTitle')}</h2>
          <div className={css.filterBar}>
            <span className={css.searchWrap}>
              <Input
                ref={searchRef}
                icon={<IconSearchOutlineRegular size={16} />}
                className={`${common.toolbarSearch ?? ''} ${css.searchInput ?? ''}`}
                value={search}
                placeholder={t('canvases', 'searchPlaceholder')}
                aria-label={t('canvases', 'searchAria')}
                onChange={(event) => { setSearch(event.currentTarget.value) }}
              />
              <span className={css.searchKbd} aria-hidden="true">{t('canvases', 'searchKbd')}</span>
            </span>
            <select
              className={`${css.select} ${css.filterSelect}`}
              value={tagFilter ?? 'all'}
              aria-label={t('canvases', 'tagFilterLabel')}
              onChange={(event) => {
                const value = event.currentTarget.value
                setTagFilter(value === 'all' ? null : value)
              }}
            >
              <option value="all">{t('canvases', 'allTags')}</option>
              {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <span className={css.spacer} />
            <span className={css.count}>{t('canvases', 'countCanvases', { count: visible.length })}</span>
          </div>

          <NoticeLine
            tone="error"
            text={error === null ? null : error.text}
            {...(error === null ? {} : { action: { label: t('common', 'actionRetry'), onClick: error.retry } })}
          />

          {loading && <div className={common.empty}>{t('common', 'stateLoading')}</div>}

          {!loading && error === null && canvases.length === 0 && (
            <div className={css.emptyState}>
              <span className={css.emptyIcon} aria-hidden="true">
                <svg viewBox="0 0 20 20"><rect x="3" y="3" width="5.5" height="5.5" rx="1" /><rect x="11.5" y="3" width="5.5" height="5.5" rx="1" /><rect x="3" y="11.5" width="5.5" height="5.5" rx="1" /><path d="M11.5 14.25h5.5M14.25 11.5v5.5" /></svg>
              </span>
              <p className={css.emptyTitle}>{t('canvases', 'emptyTitle')}</p>
              <p className={css.emptyDesc}>{t('canvases', 'emptyDesc')}</p>
              <Button variant="primary" size="sm" onClick={() => { setCreateOpen(true) }}>{t('canvases', 'newCanvas')}</Button>
            </div>
          )}

          {!loading && error === null && canvases.length > 0 && visible.length === 0 && (
            <div className={css.emptyState}>
              <span className={css.emptyIcon} aria-hidden="true">
                <svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="4.5" /><path d="m12 12 4 4" /></svg>
              </span>
              <p className={css.emptyTitle}>{t('canvases', 'noMatchTitle')}</p>
              <p className={css.emptyDesc}>{t('canvases', 'noMatchDesc')}</p>
              <Button size="sm" onClick={() => { setSearch(''); setTagFilter(null); searchRef.current?.focus() }}>
                {t('canvases', 'clearFilters')}
              </Button>
            </div>
          )}

          {visible.length > 0 && (
            <div className={css.rows}>
              {visible.map((canvas) => {
                const updated = relativeTime(canvas.updated_at)
                // 他人模板只读：编辑信息会 PATCH 到 403，菜单项必须先禁用并标明原因。
                const readOnlyTemplate = canvas.is_template && canvas.user_id !== user.id
                return (
                  <div
                    key={canvas.id}
                    className={css.row}
                    onClick={() => { navigate(`/canvas/${canvas.id}`) }}
                  >
                    <span className={css.glyph} aria-hidden="true">{monogram(canvas)}</span>
                    <div className={css.rowMain}>
                      <div className={css.rowTitleLine}>
                        <button
                          type="button"
                          className={css.rowName}
                          onClick={(event) => { event.stopPropagation(); navigate(`/canvas/${canvas.id}`) }}
                        >
                          {canvas.name}
                        </button>
                        {canvas.is_template && <Tag tone="outline">{t('canvases', 'templateBadge')}</Tag>}
                        {readOnlyTemplate && <Tag tone="quiet">{t('canvases', 'publicTemplate')}</Tag>}
                        {canvas.canvas_error !== undefined && <Tag tone="danger">{t('canvases', 'brokenBadge')}</Tag>}
                      </div>
                      <p className={css.rowDesc}>
                        {canvas.description !== null && canvas.description !== ''
                          ? canvas.description
                          : t('canvases', 'emptyDescription')}
                      </p>
                      <div className={css.rowMeta}>
                        <span>
                          {canvas.canvas.nodes.length === 1 ? t('canvases', 'nodesCountOne') : t('canvases', 'nodesCount', { count: canvas.canvas.nodes.length })}
                        </span>
                        <span>
                          {canvas.canvas.edges.length === 1 ? t('canvases', 'edgesCountOne') : t('canvases', 'edgesCount', { count: canvas.canvas.edges.length })}
                        </span>
                        {updated !== null && (
                          <span>{t('canvases', 'updatedAt', { time: relativeLabel(updated) })}</span>
                        )}
                        {canvas.tags.length > 0 && (
                          <span className={css.tagList}>
                            {canvas.tags.map(tag => <Tag key={tag} tone="neutral" className={css.rowTag}>{tag}</Tag>)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={css.rowActions} onClick={(event) => { event.stopPropagation() }}>
                      <Button size="sm" variant="ghost" onClick={() => { navigate(`/canvas/${canvas.id}`) }}>{t('common', 'actionOpen')}</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={css.iconAction}
                        icon={<IconPlayOutlineRegular size={14} />}
                        aria-label={t('canvases', 'runAria', { name: canvas.name })}
                        title={t('canvases', 'run')}
                        disabled={busyId === canvas.id || canvas.canvas_error !== undefined}
                        onClick={() => { openPage(`/run/${canvas.id}`) }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className={css.iconAction}
                        icon={<IconArchiveOutlineMedium size={14} />}
                        aria-label={t('canvases', 'packageAria', { name: canvas.name })}
                        title={t('canvases', 'packagingAction')}
                        disabled={busyId === canvas.id || canvas.canvas_error !== undefined}
                        onClick={() => { setPackageTarget(canvas) }}
                      />
                      <Menu
                        open={menuId === canvas.id}
                        align="end"
                        items={[
                          {
                            id: 'open',
                            label: t('canvases', 'menuOpenEditor'),
                            icon: <IconBrowseOutlineRegular size={14} />,
                          },
                          {
                            id: 'edit',
                            label: t('canvases', 'menuEdit'),
                            icon: <IconEditOutlineRegular size={14} />,
                            disabled: busyId === canvas.id || readOnlyTemplate,
                          },
                          {
                            id: 'duplicate',
                            label: canvas.is_template ? t('canvases', 'copyAsMine') : t('canvases', 'duplicate'),
                            icon: <IconCopyOutlineRegular size={14} />,
                            disabled: busyId === canvas.id || canvas.canvas_error !== undefined,
                          },
                          {
                            id: 'run',
                            label: t('canvases', 'menuRun'),
                            icon: <IconPlayOutlineRegular size={14} />,
                            disabled: busyId === canvas.id || canvas.canvas_error !== undefined,
                          },
                          {
                            id: 'package',
                            label: t('canvases', 'packagingAction'),
                            icon: <IconArchiveOutlineMedium size={14} />,
                            disabled: busyId === canvas.id || canvas.canvas_error !== undefined,
                          },
                          {
                            id: 'template',
                            label: canvas.is_template ? t('canvases', 'menuUnsetTemplate') : t('canvases', 'menuSetTemplate'),
                            icon: <IconPinOutlineRegular size={14} />,
                            disabled: busyId === canvas.id || readOnlyTemplate,
                          },
                          { type: 'separator', id: 'separator' },
                          {
                            id: 'delete',
                            label: t('canvases', 'menuDelete'),
                            icon: <IconTrashOutlineRegular size={14} />,
                            danger: true,
                            disabled: canvas.is_template || busyId === canvas.id,
                          },
                        ]}
                        onSelect={(id) => {
                          setMenuId(null)
                          if (id === 'open') navigate(`/canvas/${canvas.id}`)
                          if (id === 'edit') setEditTarget(canvas)
                          if (id === 'duplicate') duplicate(canvas, false)
                          if (id === 'run') openPage(`/run/${canvas.id}`)
                          if (id === 'package') setPackageTarget(canvas)
                          if (id === 'template') setTemplate(canvas, !canvas.is_template)
                          if (id === 'delete') { setDeleteError(null); setDeleteTarget(canvas) }
                        }}
                        onClose={() => { setMenuId(null) }}
                        anchor={(
                          <Button
                            size="sm"
                            variant="ghost"
                            className={css.iconAction}
                            icon={<IconEllipsisOutlineRegular size={14} />}
                            aria-label={t('canvases', 'more')}
                            title={t('canvases', 'more')}
                            onClick={() => { setMenuId(menuId === canvas.id ? null : canvas.id) }}
                          />
                        )}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* R1：列表加载完成前不显示右栏/下栏，避免列表从「加载中」长成多行时把最近会话整体推走（CLS 0.23-0.27）。 */}
        <aside className={css.recent} aria-label={t('canvases', 'recentTitle')} data-loading={loading ? '' : undefined}>
          <section className={css.panel}>
            <div className={css.recentHead}>
              <h2 className={css.recentTitle}>{t('canvases', 'recentTitle')}</h2>
              <span className={css.count}>{sessions.length}</span>
            </div>
            {/* 运行项目失败只影响本栏的项目名与删除级联提示，列表照常可用。 */}
            {projectsError !== null && (
              <div className={css.panelNotice}>
                <NoticeLine tone="error" text={projectsError} action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }} />
              </div>
            )}
            {sessionsError !== null && (
              <div className={css.panelNotice}>
                <NoticeLine tone="error" text={sessionsError} action={{ label: t('common', 'actionRetry'), onClick: () => { void loadSessions() } }} />
              </div>
            )}
            {sessions.length === 0 && sessionsError === null && <p className={css.recentEmpty}>{t('canvases', 'recentEmpty')}</p>}
            {sessions.length > 0 && (
              <ul className={css.sessionList}>
                {sessions.map(session => (
                  <li key={session.session_key}>
                    <button type="button" className={css.sessionRow} onClick={() => { openPage(session.panel_path) }}>
                      <span className={css.sessionTop}>
                        <span className={sessionDotClass(session.status)} />
                        <span className={css.sessionName}>{canvasName.get(session.agentic_flow_id) ?? session.agentic_flow_id}</span>
                        <span className={css.sessionStatus}>{t('canvases', sessionStatusKey(session.status))}</span>
                      </span>
                      <span className={css.sessionProject}>
                        {projectName.get(session.run_project_id) ?? session.run_project_id}
                      </span>
                      <span className={css.sessionMeta}>
                        {formatEpochTimestamp(session.created_at)}
                        {session.duration_ms !== null && ` · ${t('canvases', 'durationSeconds', { seconds: (session.duration_ms / 1000).toFixed(1) })}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className={css.railNote}>
            <div className={css.railNoteTitle}>{t('canvases', 'railNoteTitle')}</div>
            <p>{t('canvases', 'railNoteDesc')}</p>
            <button type="button" className={css.railNoteLink} onClick={() => { navigate('/settings') }}>
              {t('canvases', 'railNoteLink')}
            </button>
          </div>
        </aside>
      </div>

      {createOpen && (
        <CanvasMetaDialog
          open
          canvas={null}
          onClose={() => { setCreateOpen(false) }}
          onSaved={(created) => {
            setCreateOpen(false)
            void load().then(() => { navigate(`/canvas/${created.id}`) })
          }}
        />
      )}

      {/* 列表行的元信息编辑（功能清单序号 181）：与编辑器同一份数据，保存后就地刷新该行。 */}
      {editTarget !== null && (
        <CanvasMetaDialog
          open
          canvas={editTarget}
          onClose={() => { setEditTarget(null) }}
          onSaved={(updated) => {
            setEditTarget(null)
            setCanvases(previous => previous.map(item => item.id === updated.id ? updated : item))
            toast.show(t('canvases', 'toastUpdated'), 'success')
          }}
        />
      )}

      <Modal
        open={templateOpen}
        onClose={() => { setTemplateOpen(false) }}
        title={t('canvases', 'templatePickerTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('canvases', 'templatePickerDescription')}
        footer={<Button variant="outline" onClick={() => { setTemplateOpen(false) }}>{t('common', 'actionClose')}</Button>}
      >
        {error !== null && canvases.length === 0
          ? (
            <NoticeLine
              tone="error"
              text={error.text}
              action={{ label: t('common', 'actionRetry'), onClick: error.retry }}
            />
          )
          : templates.length === 0
            ? <p className={common.empty}>{t('canvases', 'templateEmpty')}</p>
            : (
              <div className={css.templateList}>
                {templates.map(template => (
                  <div key={template.id} className={css.templateRow}>
                    <div className={css.rowMain}>
                      <div className={css.rowTitleLine}>
                        <span className={css.rowName}>{template.name}</span>
                        <Tag tone="outline">{t('canvases', 'templateBadge')}</Tag>
                        {template.canvas_error !== undefined && <Tag tone="danger">{t('canvases', 'brokenBadge')}</Tag>}
                      </div>
                      {template.description !== null && template.description !== '' && (
                        <p className={css.rowDesc}>{template.description}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyId === template.id || template.canvas_error !== undefined}
                      onClick={() => { setTemplateOpen(false); duplicate(template, true) }}
                    >
                      {t('canvases', 'templateUse')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null); setDeleteError(null) }}
        title={deleteTarget === null ? '' : t('canvases', 'deleteTitle', { name: deleteTarget.name })}
        closeLabel={t('common', 'actionClose')}
        description={deleteDescription ?? ''}
        {...((deleteError === null && projectsError === null) ? {} : {
          children: (
            <>
              <NoticeLine tone="error" text={deleteError} />
              <NoticeLine
                tone="error"
                text={projectsError}
                action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }}
              />
            </>
          ),
        })}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteError(null) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="ghost"
              className={common.dangerButton}
              disabled={deleteTarget === null || busyId === deleteTarget.id}
              onClick={() => {
                const target = deleteTarget
                if (target === null) return
                setBusyId(target.id)
                setDeleteError(null)
                void (async () => {
                  try {
                    await request(`/canvases/${target.id}`, { method: 'DELETE' })
                    // 只有删除成功才关闭弹窗；失败时弹窗保持打开并在下方就地说明原因。
                    setDeleteTarget(null)
                    // 删除级联清掉项目与会话；右栏与计数必须跟着刷新，否则还指着已删的画布。
                    await Promise.all([load(), loadSessions()])
                    toast.show(t('canvases', 'toastDeleted'), 'success')
                  } catch (failure) {
                    setDeleteError(`${t('canvases', 'errorDelete')} — ${describeError(failure)}`)
                  } finally {
                    setBusyId(null)
                  }
                })()
              }}
            >
              {t('common', 'actionDelete')}
            </Button>
          </>
        )}
      />

      <PackagingDrawer
        canvas={packageTarget}
        open={packageTarget !== null}
        onClose={() => { setPackageTarget(null) }}
      />

    </div>
  )
}

/**
 * 画布元信息对话框：新建与编辑共用同一组字段与校验（功能清单序号 181）。
 *
 * `canvas === null` 为新建（POST；成功后由调用方决定去留），否则为编辑（PATCH 带 version，
 * 冲突给出可处置文案）。名称必填；标签用逗号分隔。
 */
function CanvasMetaDialog({ open, canvas, onClose, onSaved }: {
  open: boolean
  canvas: CanvasView | null
  onClose: () => void
  onSaved: (canvas: CanvasView) => void
}) {
  const editing = canvas !== null
  // 初始值直接取自本次打开的画布：对话框按 open 条件挂载，首帧就有正确值，
  // 不会先渲染空字段再由 effect 回填（那会让「编辑信息」短暂显示空名称甚至读到空值）。
  const [name, setName] = useState(canvas?.name ?? '')
  const [description, setDescription] = useState(canvas?.description ?? '')
  const [icon, setIcon] = useState(canvas?.icon ?? '')
  const [tags, setTags] = useState((canvas?.tags ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  const submit = (): void => {
    if (busy) return
    if (name.trim() === '') {
      setNameError(t('canvases', 'errorNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    setNameError(null)
    void (async () => {
      try {
        const target = canvas
        const parsedTags = tags.split(/[,，]/).map(item => item.trim()).filter(item => item !== '')
        const result = target === null
          ? await request<{ ok: true; canvas: CanvasView }>('/canvases', {
            method: 'POST',
            body: {
              name: name.trim(),
              ...(description.trim() === '' ? {} : { description: description.trim() }),
              ...(icon.trim() === '' ? {} : { icon: icon.trim() }),
              ...(parsedTags.length === 0 ? {} : { tags: parsedTags }),
            },
          })
          // 编辑提交完整四项：空描述/空图标/空标签表示清空，服务端按原值写回。
          : await request<{ ok: true; canvas: CanvasView }>(`/canvases/${target.id}`, {
            method: 'PATCH',
            body: {
              name: name.trim(),
              description: description.trim(),
              icon: icon.trim(),
              tags: parsedTags,
              version: target.version,
            },
          })
        if (target === null) {
          setName('')
          setDescription('')
          setIcon('')
          setTags('')
        }
        onSaved(result.canvas)
      } catch (failure) {
        const detail = failure instanceof ApiError && failure.code === 'VERSION_CONFLICT'
          ? t('canvases', 'errorVersionConflict')
          : describeError(failure)
        setError(`${t('canvases', editing ? 'errorUpdate' : 'errorCreate')} — ${detail}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('canvases', editing ? 'editTitle' : 'newCanvasTitle')}
      closeLabel={t('common', 'actionClose')}
      description={t('canvases', editing ? 'editDescription' : 'newCanvasDescription')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            type="submit"
            form={editing ? 'edit-canvas-form' : 'create-canvas-form'}
            variant="primary"
            disabled={busy}
          >
            {busy
              ? t('common', 'stateSaving')
              : editing ? t('common', 'actionSave') : t('canvases', 'create')}
          </Button>
        </>
      )}
    >
      <form
        id={editing ? 'edit-canvas-form' : 'create-canvas-form'}
        className={common.form}
        onSubmit={(event) => { event.preventDefault(); submit() }}
        onKeyDown={submitFormOnEnter}
      >
        <NoticeLine tone="error" text={error} />
        <Field label={t('common', 'labelName')} error={nameError}>
          <Input
            data-modal-autofocus
            aria-invalid={nameError === null ? undefined : true}
            value={name}
            onChange={(event) => { setName(event.currentTarget.value); setNameError(null) }}
          />
        </Field>
        <Field label={t('common', 'labelDescription')} meta={t('common', 'labelOptional')}>
          <textarea
            className={common.textarea}
            value={description}
            onChange={(event) => { setDescription(event.currentTarget.value) }}
          />
        </Field>
        <div className={common.formGrid}>
          <Field label={t('canvases', 'iconLabel')}>
            <IconPicker value={icon} onChange={setIcon} />
          </Field>
          <Field label={t('common', 'labelTags')} meta={t('canvases', 'metaCommaSeparated')}>
            <Input
              value={tags}
              placeholder={t('canvases', 'tagsPlaceholder')}
              onChange={(event) => { setTags(event.currentTarget.value) }}
            />
          </Field>
        </div>
      </form>
    </Modal>
  )
}
