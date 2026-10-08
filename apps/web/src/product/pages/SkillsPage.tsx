/** 技能页。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button, IconDownloadOutline16, IconPlusOutline16, IconTrashOutline16,
  Input, Modal, Pill, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request, requestBlob } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import { FilePicker } from '../components/FilePicker.tsx'
import type { SkillImportPreview, SkillView } from '../types.ts'
import css from '../styles/common.module.css'

/**
 * 渲染技能页。
 */
export function SkillsPage() {
  useLocale()
  const [skills, setSkills] = useState<SkillView[]>([])
  const [loading, setLoading] = useState(true)
  // 文案状态存「键 + 动态细节」，渲染时才翻译（S5-F9 同一规则）：存已翻译字符串会在
  // 用户切换语言后残留旧语种，而本页侧栏始终带着语言切换入口，该路径可达。
  const [error, setError] = useState<{ key: string; detail: string } | null>(null)
  const [notice, setNotice] = useState<{ key: 'createdNotice' | 'importedNotice'; name: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // FR-SKILL-001：标签过滤 + 我的/公共过滤 + 系统级与自建分组。
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'mine' | 'public'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillView | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await request<{ ok: true; skills: SkillView[] }>('/skills')
      setSkills(result.skills)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorLoad', detail: describeError(failure) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return skills.filter((skill) => {
      // 我的：有归属用户；公共：无归属用户，或其他用户所有但标记为公共。
      if (ownerFilter === 'mine' && skill.user_id === null) return false
      if (ownerFilter === 'public' && skill.user_id !== null && !skill.is_public) return false
      if (tagFilter !== null && !(skill.tags ?? '').split(',').map(tag => tag.trim()).includes(tagFilter)) return false
      if (keyword === '') return true
      return `${skill.name} ${skill.author} ${skill.description ?? ''} ${skill.tags ?? ''}`.toLowerCase().includes(keyword)
    })
  }, [skills, search, tagFilter, ownerFilter])

  const tagOptions = useMemo(() => {
    const values = new Set<string>()
    for (const skill of skills) {
      for (const tag of (skill.tags ?? '').split(',')) {
        const trimmed = tag.trim()
        if (trimmed !== '') values.add(trimmed)
      }
    }
    return [...values].sort()
  }, [skills])

  const groupSystem = useMemo(() => visible.filter(skill => skill.user_id === null), [visible])
  const groupMine = useMemo(() => visible.filter(skill => skill.user_id !== null), [visible])

  const act = (id: string, action: () => Promise<void>, failureKey: string): void => {
    setBusyId(id)
    setError(null)
    // 成功提示只描述上一次动作：任何新动作起手即作废它（O-S10-1 生命周期归持有消息的页面）。
    setNotice(null)
    void (async () => {
      try {
        await action()
      } catch (failure) {
        setError({ key: failureKey, detail: describeError(failure) })
      } finally {
        setBusyId(null)
      }
    })()
  }

  return (
    <div className={css.page}>
      <PageHeader
        title={t('skills', 'title')}
        subtitle={t('skills', 'subtitle')}
        actions={(
          <>
            <Button variant="primary" icon={<IconPlusOutline16 size={14} />} onClick={() => { setCreateOpen(true) }}>
              {t('skills', 'createTemplate')}
            </Button>
            <Button onClick={() => { setImportOpen(true) }}>{t('skills', 'importWizard')}</Button>
            <Button onClick={() => { void load() }}>{t('common', 'actionRefresh')}</Button>
          </>
        )}
      />

      <div className={css.toolbar}>
        <Input
          className={css.toolbarSearch ?? ''}
          value={search}
          placeholder={t('skills', 'searchPlaceholder')}
          aria-label={t('skills', 'searchAria')}
          onChange={(event) => { setSearch(event.currentTarget.value) }}
        />
        <span className={css.fieldHint}>{t('skills', 'ownerFilterLabel')}</span>
        {/* 原生 Pill 只把选中态写成 class，辅助技术读不到（WCAG 4.1.2）；与设置/市场/打包
            各页同一惯例，产品层透传 aria-pressed。 */}
        <Pill active={ownerFilter === 'all'} aria-pressed={ownerFilter === 'all'} onClick={() => { setOwnerFilter('all') }}>{t('skills', 'ownerAll')}</Pill>
        <Pill active={ownerFilter === 'mine'} aria-pressed={ownerFilter === 'mine'} onClick={() => { setOwnerFilter('mine') }}>{t('skills', 'ownerMine')}</Pill>
        <Pill active={ownerFilter === 'public'} aria-pressed={ownerFilter === 'public'} onClick={() => { setOwnerFilter('public') }}>{t('skills', 'ownerPublic')}</Pill>
      </div>

      {tagOptions.length > 0 && (
        <div className={css.toolbar}>
          <span className={css.fieldHint}>{t('skills', 'tagFilterLabel')}</span>
          <Pill active={tagFilter === null} aria-pressed={tagFilter === null} onClick={() => { setTagFilter(null) }}>{t('common', 'labelAll')}</Pill>
          {tagOptions.map(tag => (
            <Pill
              key={tag}
              active={tagFilter === tag}
              aria-pressed={tagFilter === tag}
              onClick={() => { setTagFilter(tagFilter === tag ? null : tag) }}
            >{tag}</Pill>
          ))}
        </div>
      )}

      <NoticeLine
        tone="error"
        text={error === null ? null : `${t('skills', error.key)} — ${error.detail}`}
        action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }}
      />
      <NoticeLine tone="success" text={notice === null ? null : `${t('skills', notice.key)}: ${notice.name}`} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {/* 与画布列表页同一二分（R3/R8）：过滤后为零 ≠ 一个都没有，文案必须说明下一步做什么。 */}
      {!loading && visible.length === 0 && (
        <div className={css.empty}>{t('skills', skills.length === 0 ? 'empty' : 'noMatch')}</div>
      )}

      {!loading && groupSystem.length > 0 && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('skills', 'groupSystem')}</div>
          <div className={css.cardGrid}>
            {groupSystem.map(skill => renderSkillCard(skill))}
          </div>
        </div>
      )}
      {!loading && groupMine.length > 0 && (
        <div className={css.section}>
          <div className={css.sectionTitle}>{t('skills', 'groupMine')}</div>
          <div className={css.cardGrid}>
            {groupMine.map(skill => renderSkillCard(skill))}
          </div>
        </div>
      )}

      <CreateSkillDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false) }}
        onCreated={(skill) => {
          setCreateOpen(false)
          setNotice({ key: 'createdNotice', name: skill.name })
          void load()
        }}
      />

      <ImportSkillDialog
        open={importOpen}
        onClose={() => { setImportOpen(false) }}
        onImported={(skill) => {
          setImportOpen(false)
          setNotice({ key: 'importedNotice', name: skill.name })
          void load()
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
                act(target.id, async () => {
                  await request(`/skills/${target.id}`, { method: 'DELETE' })
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
            {t('skills', 'deleteNote')}
          </p>
        )}
      </Modal>
    </div>
  )

  function renderSkillCard(skill: SkillView) {
    return (
      <article key={skill.id} className={css.card}>
        <div className={css.cardHeader}>
          <span className={css.iconBlock}>{skill.icon === null || skill.icon === '' ? skill.name.slice(0, 1) : skill.icon}</span>
          <div className={css.cardTitleBlock}>
            <h2 className={css.cardTitle}>{skill.name}</h2>
            <span className={css.cardMeta}>
              <span className={css.nowrap}>{t('common', 'labelVersion')} {skill.pkg_version}</span>
              {' · '}
              <span className={css.nowrap}>{t('common', 'labelAuthor')} {skill.author}</span>
            </span>
          </div>
          <Switch
            className={css.switchTarget}
            checked={skill.is_active}
            label={`${skill.name} ${t('skills', 'toggleActive')}`}
            disabled={busyId === skill.id}
            onChange={(next) => {
              act(skill.id, async () => {
                await request(`/skills/${skill.id}/active`, { method: 'POST', body: { active: next } })
                await load()
              }, 'errorActive')
            }}
          />
        </div>
        {/* 描述为空时整行省略：孤行「无」在卡片网格里形似渲染残缺（与 MCP 页同一规则）。 */}
        {skill.description !== null && skill.description !== ''
          ? <div className={css.cardBody}>{skill.description}</div>
          : null}
        <div className={css.chipRow}>
          {skill.is_public && <Tag tone="info" className={css.statusTag}>{t('skills', 'publicBadge')}</Tag>}
          {skill.source === 'template' && <Tag tone="neutral">{t('skills', 'templateBadge')}</Tag>}
          {(skill.tags ?? '').split(',').map(tag => tag.trim()).filter(tag => tag !== '').map(tag => (
            <Tag key={tag} tone="neutral">{tag}</Tag>
          ))}
        </div>
        <div className={css.cardActions}>
          <Button size="sm" onClick={() => { navigate(`/skills/${skill.id}`) }}>{t('skills', 'openFiles')}</Button>
          <Button
            size="sm"
            icon={<IconDownloadOutline16 size={14} />}
            disabled={busyId === skill.id}
            onClick={() => {
              act(skill.id, async () => {
                const blob = await requestBlob(`/skills/${skill.id}/export`)
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = `${skill.name}-${skill.pkg_version}.zip`
                anchor.click()
                URL.revokeObjectURL(url)
              }, 'errorExport')
            }}
          >
            {t('skills', 'exportAction')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<IconTrashOutline16 size={14} />}
            disabled={busyId === skill.id}
            onClick={() => { setDeleteTarget(skill) }}
          >
            {t('common', 'actionDelete')}
          </Button>
        </div>
      </article>
    )
  }
}

/** 创建技能骨架对话框。 */
function CreateSkillDialog({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (skill: SkillView) => void
}) {
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('skills', 'createTitle')}
      closeLabel={t('common', 'actionClose')}
      description={t('skills', 'createDescription')}
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
                  const result = await request<{ ok: true; skill: SkillView }>('/skills', {
                    method: 'POST',
                    body: { name: name.trim(), ...(version.trim() === '' ? {} : { version: version.trim() }) },
                  })
                  setName('')
                  setVersion('')
                  onCreated(result.skill)
                } catch (failure) {
                  // 错误就近呈现在对话框内（带本地化前缀）；不再向页面级重复投递（会被 Modal 遮挡）。
                  // 重名是这条路径唯一会真实发生的已知后端码（`skills.ts` L309），直出英文原句
                  // 即机器码直出（R8），按码给产品文案；其余失败仍给出原因原文。
                  const taken = failure instanceof ApiError && failure.code === 'SKILL_EXISTS'
                  setError(taken
                    ? t('skills', 'errorNameTaken')
                    : `${t('skills', 'errorCreate')} — ${describeError(failure)}`)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? t('skills', 'creating') : t('skills', 'create')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <NoticeLine tone="error" text={error} />
        <Field label={t('common', 'labelName')}>
          <Input value={name} onChange={(event) => { setName(event.currentTarget.value) }} />
        </Field>
        <Field label={t('common', 'labelVersion')}>
          <Input value={version} onChange={(event) => { setVersion(event.currentTarget.value) }} />
        </Field>
      </div>
    </Modal>
  )
}

/** 两阶段导入向导。 */
function ImportSkillDialog({ open, onClose, onImported }: {
  open: boolean
  onClose: () => void
  onImported: (skill: SkillView) => void
}) {
  const [sourcePath, setSourcePath] = useState('')
  const [archiveBase64, setArchiveBase64] = useState<string | null>(null)
  const [archiveName, setArchiveName] = useState('')
  const [preview, setPreview] = useState<SkillImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const payload = (): Record<string, string> | null => {
    if (archiveBase64 !== null) return { archiveBase64 }
    if (sourcePath.trim() !== '') return { sourcePath: sourcePath.trim() }
    return null
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('skills', 'importTitle')}
      closeLabel={t('common', 'actionClose')}
      description={t('skills', 'importDescription')}
      className={css.modalDialog ?? ''}
      contentClassName={css.modalScroll ?? ''}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('common', 'actionCancel')}</Button>
          <Button
            disabled={busy}
            onClick={() => {
              const body = payload()
              if (body === null) {
                setError(t('skills', 'errorSourceRequired'))
                return
              }
              setBusy(true)
              setError(null)
              void (async () => {
                try {
                  const result = await request<{ ok: true; preview: SkillImportPreview }>('/skills/import/preview', {
                    method: 'POST',
                    body,
                  })
                  setPreview(result.preview)
                } catch (failure) {
                  setError(`${t('skills', 'errorPreview')} — ${describeError(failure)}`)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? t('skills', 'previewing') : t('skills', 'preview')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || preview === null}
            onClick={() => {
              const body = payload()
              if (body === null) {
                setError(t('skills', 'errorSourceRequired'))
                return
              }
              setBusy(true)
              setError(null)
              void (async () => {
                try {
                  const result = await request<{ ok: true; skill: SkillView }>('/skills/import/confirm', {
                    method: 'POST',
                    body,
                  })
                  setPreview(null)
                  setSourcePath('')
                  setArchiveBase64(null)
                  setArchiveName('')
                  onImported(result.skill)
                } catch (failure) {
                  setError(`${t('skills', 'errorImport')} — ${describeError(failure)}`)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {busy ? t('skills', 'importing') : t('skills', 'confirmImport')}
          </Button>
        </>
      )}
    >
      <div className={css.form}>
        <NoticeLine tone="error" text={error} />
        <div className={css.sectionTitle}>{t('skills', 'step1')}</div>
        <Field label={t('skills', 'sourcePathLabel')}>
          <Input
            value={sourcePath}
            placeholder={t('skills', 'sourcePathPlaceholder')}
            onChange={(event) => {
              setSourcePath(event.currentTarget.value)
              setArchiveBase64(null)
              setArchiveName('')
              // 与文件分支同一规则（L463）：换了来源就作废旧预览，否则「确认导入」发的是新路径、
              // 界面展示的却是上一个包的名称/版本/文件清单。
              setPreview(null)
            }}
          />
        </Field>
        <Field label={t('skills', 'archiveLabel')} hint={t('skills', 'archiveHint')}>
          <FilePicker
            accept=".zip"
            fileName={archiveName}
            onFile={(file) => {
              const reader = new FileReader()
              reader.onload = () => {
                const text = typeof reader.result === 'string' ? reader.result : ''
                const comma = text.indexOf(',')
                setArchiveBase64(comma < 0 ? text : text.slice(comma + 1))
                setArchiveName(file.name)
                setSourcePath('')
                setPreview(null)
              }
              reader.onerror = () => { setError(`${t('skills', 'errorPreview')} — ${reader.error?.message ?? 'failed'}`) }
              reader.readAsDataURL(file)
            }}
          />
        </Field>
        {preview !== null && (
          <>
            <div className={css.sectionTitle}>{t('skills', 'step2')}</div>
            <div className={css.definition}>
              <span className={css.definitionLabel}>{t('common', 'labelName')}</span>
              <span className={css.definitionValue}>{preview.name}</span>
              <span className={css.definitionLabel}>{t('common', 'labelVersion')}</span>
              <span className={css.definitionValue}>{preview.version}</span>
              <span className={css.definitionLabel}>{t('common', 'labelAuthor')}</span>
              <span className={css.definitionValue}>{preview.author}</span>
              <span className={css.definitionLabel}>{t('common', 'labelDescription')}</span>
              {/* 骨架包的 description 是空串而非 null（`skills.ts` L312/L321），`??` 兜不住：
                  标签悬着无值形似渲染残缺。 */}
              <span className={css.definitionValue}>{preview.description === null || preview.description === '' ? t('common', 'labelNone') : preview.description}</span>
            </div>
            <div className={css.fieldLabel}>{t('skills', 'previewFiles', { count: preview.files.length })}</div>
            <div className={css.tree}>
              {preview.files.map(path => (
                <div key={path} className={css.listRow}>{path}</div>
              ))}
            </div>
            {preview.skippedRejected.length > 0 && (
              <>
                <div className={css.fieldLabel}>{t('skills', 'previewRejected', { count: preview.skippedRejected.length })}</div>
                {/* 被拒清单是只读信息且语义为「失败」：不用 treeItem（可点样式），
                也不用 treeItemActive（那是「当前选中」高亮，拿来表达拒绝是语义错位）。 */}
                <div className={css.tree}>
                  {preview.skippedRejected.map(path => (
                    <div key={path} className={`${css.listRow} ${css.listRowError}`}>{path}</div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
