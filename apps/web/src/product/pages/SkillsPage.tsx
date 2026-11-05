/** 技能页。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconDownloadOutlineRegular, IconEllipsisOutlineRegular,
  IconGlobeOutlineRegular, IconPlayOutlineRegular, IconPlusOutlineRegular, IconSearchOutlineRegular,
  IconSkillOutlineRegular, IconStopFillRegular, IconTrashOutlineRegular,
  Input, Menu, Modal, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import { Field } from '../components/Field.tsx'
import { FilePicker } from '../components/FilePicker.tsx'
import { useSearchShortcut } from '../components/useSearchShortcut.ts'
import { submitFormOnEnter } from '../utils/submitOnEnter.ts'
import type { SkillImportPreview, SkillView, UserView } from '../types.ts'
import css from '../styles/common.module.css'
import skillCss from '../styles/skills.module.css'

/** 技能包上限；与服务端 `MAX_ARCHIVE_BYTES` 同值，前端只做前置拒绝，服务端仍为最终权威。 */
const MAX_SKILL_ARCHIVE_BYTES = 64 * 1024 * 1024

/** 名称缩写（列表行 34px 字形）：取前两段的首字母，空名回落到 sk。 */
function skillInitials(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean)
  const letters = parts.slice(0, 2).map(part => part.slice(0, 1)).join('').toLowerCase()
  return letters === '' ? 'sk' : letters
}

/** 字节数 → 预览用大小（1.2 KB / 640 B，与原型同一口径）。 */
function formatFileSize(size: number): string {
  return size < 1024 ? `${String(size)} B` : `${(size / 1024).toFixed(1)} KB`
}

/** 由技能元数据生成 SKILL.md（导出回退：包内没有 SKILL.md 时）。 */
function synthesizeSkillMd(skill: SkillView): string {
  const description = skill.description ?? ''
  return [
    '---',
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(description)}`,
    `version: ${JSON.stringify(skill.pkg_version)}`,
    `author: ${JSON.stringify(skill.author)}`,
    // 原型导出回退带 tags（skills.js:126）；空标签也写成空数组，frontmatter 形状保持完整。
    `tags: [${skill.tags.map(tag => JSON.stringify(tag)).join(', ')}]`,
    '---',
    '',
    `# ${skill.name}`,
    '',
    description,
    '',
  ].join('\n')
}

/**
 * 渲染技能页。
 * @param props.user - 当前用户（判断哪些技能归自己，决定是否可发布/取消发布）。
 */
export function SkillsPage({ user }: { user: UserView }) {
  const locale = useLocale()
  const [skills, setSkills] = useState<SkillView[]>([])
  const [loading, setLoading] = useState(true)
  // 文案状态存「键 + 动态细节」，渲染时才翻译（S5-F9 同一规则）：存已翻译字符串会在
  // 用户切换语言后残留旧语种，而本页侧栏始终带着语言切换入口，该路径可达。
  const [error, setError] = useState<{ key: string; detail: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // FR-SKILL-001：标签过滤 + 我的/公共过滤 + 系统级与自建分组。
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'mine' | 'public'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillView | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // 成功反馈走 Toast（原型 skills.js:200/312/334/342/350/367 的 App.toast）。
  const toast = useToastHost()

  // Ctrl/Cmd+K 聚焦搜索（原型 app.js:650-659 的全局快捷键）。
  useSearchShortcut(searchRef)

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
      // 我的：归属当前用户；公共：任何账号发布的公共技能（含自己的）；系统级：无归属。
      // 不能用「有归属」判断「我的」——他人发布的公共技能会被误归入我的技能（原型 skills.js:54）。
      const owned = skill.user_id === user.id
      if (ownerFilter === 'mine' && !owned) return false
      if (ownerFilter === 'public' && !skill.is_public) return false
      if (tagFilter !== null && !skill.tags.includes(tagFilter)) return false
      if (keyword === '') return true
      return `${skill.name} ${skill.author} ${skill.description ?? ''}`.toLowerCase().includes(keyword)
    })
  }, [skills, search, tagFilter, ownerFilter, user.id])

  const tagOptions = useMemo(() => {
    const values = new Set<string>()
    for (const skill of skills) {
      for (const tag of skill.tags) {
        const trimmed = tag.trim()
        if (trimmed !== '') values.add(trimmed)
      }
    }
    return [...values].sort()
  }, [skills])

  // 两组互斥：公共与系统级（系统出厂 + 他人发布的公共），我的技能（归属当前用户）。
  const groupSystem = useMemo(
    () => visible.filter(skill => skill.user_id === null || (skill.is_public && skill.user_id !== user.id)),
    [visible, user.id],
  )
  const groupMine = useMemo(() => visible.filter(skill => skill.user_id === user.id), [visible, user.id])

  const act = (id: string, action: () => Promise<void>, failureKey: string, successText?: string): void => {
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        await action()
        if (successText !== undefined) toast.show(successText, 'success')
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
            <Button icon={<IconDownloadOutlineRegular size={14} />} onClick={() => { setImportOpen(true) }}>
              {t('skills', 'importWizard')}
            </Button>
            <Button variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={() => { setCreateOpen(true) }}>
              {t('skills', 'createTemplate')}
            </Button>
          </>
        )}
      />

      <div className={skillCss.filterBar}>
        <Input
          ref={searchRef}
          className={skillCss.search ?? ''}
          type="search"
          icon={<IconSearchOutlineRegular size={16} />}
          value={search}
          placeholder={t('skills', 'searchPlaceholder')}
          aria-label={t('skills', 'searchAria')}
          onChange={(event) => { setSearch(event.currentTarget.value) }}
        />
        {/* 原型 .segmented：36px 外壳 + 30px 分段。选中态同时写 aria-pressed，
            辅助技术读得到（WCAG 4.1.2），不只靠底色。 */}
        <div className={skillCss.segmented} role="group" aria-label={t('skills', 'ownerFilterLabel')}>
          <button
            type="button"
            className={ownerFilter === 'all' ? `${skillCss.segmentItem} ${skillCss.segmentActive}` : skillCss.segmentItem}
            aria-pressed={ownerFilter === 'all'}
            onClick={() => { setOwnerFilter('all') }}
          >
            {t('skills', 'ownerAll')}
          </button>
          <button
            type="button"
            className={ownerFilter === 'mine' ? `${skillCss.segmentItem} ${skillCss.segmentActive}` : skillCss.segmentItem}
            aria-pressed={ownerFilter === 'mine'}
            onClick={() => { setOwnerFilter('mine') }}
          >
            {t('skills', 'ownerMine')}
          </button>
          <button
            type="button"
            className={ownerFilter === 'public' ? `${skillCss.segmentItem} ${skillCss.segmentActive}` : skillCss.segmentItem}
            aria-pressed={ownerFilter === 'public'}
            onClick={() => { setOwnerFilter('public') }}
          >
            {t('skills', 'ownerPublic')}
          </button>
        </div>
        <select
          className={skillCss.select}
          value={tagFilter ?? 'all'}
          aria-label={t('skills', 'tagFilterLabel')}
          onChange={(event) => {
            const value = event.currentTarget.value
            setTagFilter(value === 'all' ? null : value)
          }}
        >
          <option value="all">{t('skills', 'tagAll')}</option>
          {tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <span className={skillCss.spacer} />
        <span className={skillCss.count}>
          {visible.length === 1
            ? t('skills', 'countOne')
            : t('skills', 'count', { count: visible.length.toLocaleString(locale) })}
        </span>
      </div>

      <NoticeLine
        tone="error"
        text={error === null ? null : `${t('skills', error.key)} — ${error.detail}`}
        action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }}
      />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {/* 与画布列表页同一二分（R3/R8）：过滤后为零 ≠ 一个都没有，文案必须说明下一步做什么。 */}
      {!loading && visible.length === 0 && (
        <div className={skillCss.emptyState}>
          <span className={skillCss.emptyIcon} aria-hidden="true"><IconSkillOutlineRegular size={20} /></span>
          <p className={skillCss.emptyTitle}>{t('skills', skills.length === 0 ? 'empty' : 'noMatch')}</p>
          <p className={skillCss.emptyDesc}>{t('skills', skills.length === 0 ? 'emptyHint' : 'noMatchHint')}</p>
          {skills.length === 0
            ? (
              <Button size="sm" variant="primary" icon={<IconPlusOutlineRegular size={14} />} onClick={() => { setCreateOpen(true) }}>
                {t('skills', 'createTemplate')}
              </Button>
            )
            : (
              <Button
                size="sm"
                onClick={() => {
                  setSearch('')
                  setTagFilter(null)
                  setOwnerFilter('all')
                  // 原型 skills.js:384-393：重置后把焦点交回搜索框。
                  searchRef.current?.focus()
                }}
              >
                {t('skills', 'clearFilters')}
              </Button>
            )}
        </div>
      )}

      {/* 原型 `.skill-groups`：两组之间 32px，页面级 24px 只留在过滤条与首组之间。 */}
      {!loading && (groupSystem.length > 0 || groupMine.length > 0) && (
        <div className={skillCss.groups}>
          {groupSystem.length > 0 && (
            <section className={skillCss.group}>
              <div className={skillCss.groupHead}>
                <h2 className={skillCss.groupTitle}>{t('skills', 'groupSystem')}</h2>
                <span className={skillCss.count}>{groupSystem.length.toLocaleString(locale)}</span>
              </div>
              <div className={skillCss.rows}>
                {groupSystem.map(skill => renderSkillRow(skill))}
              </div>
            </section>
          )}
          {groupMine.length > 0 && (
            <section className={skillCss.group}>
              <div className={skillCss.groupHead}>
                <h2 className={skillCss.groupTitle}>{t('skills', 'groupMine')}</h2>
                <span className={skillCss.count}>{groupMine.length.toLocaleString(locale)}</span>
              </div>
              <div className={skillCss.rows}>
                {groupMine.map(skill => renderSkillRow(skill))}
              </div>
            </section>
          )}
        </div>
      )}

      <CreateSkillDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false) }}
        onCreated={(skill) => {
          setCreateOpen(false)
          toast.show(t('skills', 'createdNotice', { name: skill.name }), 'success')
          void load()
        }}
      />

      <ImportSkillDialog
        open={importOpen}
        onClose={() => { setImportOpen(false) }}
        onImported={(skill) => {
          setImportOpen(false)
          toast.show(t('skills', 'importedNotice', { name: skill.name }), 'success')
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
                }, 'errorDelete', t('skills', 'toastDeleted'))
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

  function renderSkillRow(skill: SkillView) {
    return (
      <div
        key={skill.id}
        className={skill.is_active ? skillCss.row : `${skillCss.row} ${skillCss.rowInactive}`}
      >
        <span className={skillCss.glyph} aria-hidden="true">{skillInitials(skill.name)}</span>
        <div className={skillCss.rowMain}>
          <div className={skillCss.rowTitleLine}>
            <h3 className={skillCss.rowName} title={skill.name}>{skill.name}</h3>
            {skill.is_public && <Tag tone="neutral">{t('skills', 'publicBadge')}</Tag>}
            {skill.source === 'factory' && <Tag tone="outline">{t('skills', 'templateBadge')}</Tag>}
            {!skill.is_active && <Tag tone="quiet">{t('skills', 'badgeDisabled')}</Tag>}
          </div>
          {skill.description !== null && skill.description !== '' && (
            <p className={skillCss.rowDesc}>{skill.description}</p>
          )}
          <div className={skillCss.rowMeta}>
            <span>{t('skills', 'versionPrefix', { version: skill.pkg_version })}</span>
            <span>{skill.author}</span>
            <span>{skill.file_count === 1 ? t('skills', 'fileCountOne') : t('skills', 'fileCount', { count: skill.file_count.toLocaleString(locale) })}</span>
            {skill.tags.length > 0 && (
              <span className={skillCss.tagList}>
                {skill.tags.map(tag => <span key={tag} className={skillCss.tag}>{tag}</span>)}
              </span>
            )}
          </div>
        </div>
        <div className={skillCss.rowActions}>
          <Button size="sm" variant="ghost" onClick={() => { navigate(`/skill/${skill.id}`) }}>{t('skills', 'openFiles')}</Button>
          <Menu
            open={menuId === skill.id}
            align="end"
            items={[
              { id: 'export', label: t('skills', 'exportAction'), icon: <IconDownloadOutlineRegular size={14} />, disabled: busyId === skill.id },
              {
                id: 'toggle',
                label: skill.is_active ? t('common', 'stateInactive') : t('common', 'stateActive'),
                icon: skill.is_active ? <IconStopFillRegular size={14} /> : <IconPlayOutlineRegular size={14} />,
                disabled: busyId === skill.id,
              },
              ...(skill.user_id === user.id
                ? [{
                  id: 'public',
                  label: skill.is_public ? t('skills', 'unpublishAction') : t('skills', 'publishAction'),
                  icon: <IconGlobeOutlineRegular size={14} />,
                  disabled: busyId === skill.id,
                }]
                : []),
              { type: 'separator', id: 'separator' },
              {
                id: 'delete',
                label: t('skills', 'deleteSkill'),
                icon: <IconTrashOutlineRegular size={14} />,
                danger: true,
                disabled: busyId === skill.id,
              },
            ]}
            onSelect={(id) => {
              setMenuId(null)
              if (id === 'export') exportSkillMd(skill)
              if (id === 'toggle') {
                act(skill.id, async () => {
                  await request(`/skills/${skill.id}/active`, { method: 'POST', body: { active: !skill.is_active } })
                  await load()
                }, 'errorActive', skill.is_active
                  ? t('skills', 'toastDisabled', { name: skill.name })
                  : t('skills', 'toastEnabled', { name: skill.name }))
              }
              if (id === 'public') {
                act(skill.id, async () => {
                  await request(`/skills/${skill.id}/public`, { method: 'POST', body: { public: !skill.is_public } })
                  await load()
                }, 'errorPublic', skill.is_public ? t('skills', 'toastPrivate') : t('skills', 'toastPublic'))
              }
              if (id === 'delete') setDeleteTarget(skill)
            }}
            onClose={() => { setMenuId(null) }}
            anchor={(
              <Button
                size="sm"
                variant="ghost"
                icon={<IconEllipsisOutlineRegular size={14} />}
                aria-label={t('skills', 'moreActions')}
                disabled={busyId === skill.id}
                onClick={() => { setMenuId(menuId === skill.id ? null : skill.id) }}
              />
            )}
          />
        </div>
      </div>
    )
  }

  /** 导出 SKILL.md（单一文件；包内缺 SKILL.md 时按台账元数据生成一份）。 */
  function exportSkillMd(skill: SkillView): void {
    act(skill.id, async () => {
      let text: string
      try {
        const result = await request<{ ok: true; text: string }>(`/skills/${skill.id}/file?path=SKILL.md`)
        text = result.text
      } catch (failure) {
        // 仅入口文件缺失走生成回退；其余失败（网络、越权等）照常上报。
        if (!(failure instanceof ApiError && failure.status === 404)) throw failure
        text = synthesizeSkillMd(skill)
      }
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${skill.name}-SKILL.md`
      anchor.click()
      // 立即 revoke 会在下载真正取流前撤掉 URL（部分浏览器直接得到空文件）；与用量导出同一处理。
      window.setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
    }, 'errorExport', t('skills', 'toastExported', { name: skill.name }))
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
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  // 每次重新打开都从干净状态开始：上一次的字段错误不能残留到新一次创建。
  useEffect(() => {
    if (!open) return
    setError(null)
    setNameError(null)
  }, [open])

  const submit = (): void => {
    if (busy) return
    if (name.trim() === '') {
      setNameError(t('skills', 'errorNameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    setNameError(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; skill: SkillView }>('/skills', {
          method: 'POST',
          body: {
            name: name.trim(),
            ...(version.trim() === '' ? {} : { version: version.trim() }),
            ...(description.trim() === '' ? {} : { description: description.trim() }),
            ...(tags.trim() === '' ? {} : { tags: tags.trim() }),
          },
        })
        setName('')
        setVersion('')
        setDescription('')
        setTags('')
        onCreated(result.skill)
      } catch (failure) {
        // 错误就近呈现在对话框内（带本地化前缀）；不再向页面级重复投递（会被 Modal 遮挡）。
        // 重名是这条路径唯一会真实发生的已知后端码（`skills.ts` L309），直出英文原句
        // 即机器码直出（R8），按码给产品文案；其余失败仍给出原因原文。
        const taken = failure instanceof ApiError && failure.code === 'SKILL_EXISTS'
        if (taken) setNameError(t('skills', 'errorNameTaken'))
        else setError(`${t('skills', 'errorCreate')} — ${describeError(failure)}`)
      } finally {
        setBusy(false)
      }
    })()
  }

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
            type="submit"
            form="create-skill-form"
            variant="primary"
            disabled={busy}
          >
            {busy ? t('skills', 'creating') : t('skills', 'create')}
          </Button>
        </>
      )}
    >
      <form
        id="create-skill-form"
        className={css.form}
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
        <Field label={t('common', 'labelVersion')}>
          <Input value={version} onChange={(event) => { setVersion(event.currentTarget.value) }} />
        </Field>
        <Field label={t('skills', 'fieldDescription')}>
          <textarea
            className={css.textarea}
            value={description}
            placeholder={t('skills', 'fieldDescriptionPlaceholder')}
            onChange={(event) => { setDescription(event.currentTarget.value) }}
          />
        </Field>
        <Field label={t('skills', 'fieldTags')} hint={t('skills', 'fieldTagsHint')}>
          <Input value={tags} onChange={(event) => { setTags(event.currentTarget.value) }} />
        </Field>
      </form>
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

  /**
   * 来源路径的用户输入错误转产品文案。
   * @param failure - 预览/确认的失败原因。
   * @returns 产品文案；不是来源类错误时返回 null，由调用方走通用前缀。
   */
  const sourceErrorText = (failure: unknown): string | null => {
    if (!(failure instanceof ApiError)) return null
    if (failure.code === 'SKILL_SOURCE_OUTSIDE') return t('skills', 'errorSourceOutside')
    if (failure.code === 'SKILL_SOURCE_NOT_FOUND') return t('skills', 'errorSourceMissing')
    return null
  }

  // 关闭即回第一步：预览只对「这一次来源」有效，留着会让下次打开直接落在第二步、
  // 而底部按钮又发不出与预览同一个来源的请求。
  const close = (): void => {
    setPreview(null)
    setError(null)
    onClose()
  }

  /** 第一阶段：解析来源，得到元数据与目录树预览。 */
  const runPreview = (): void => {
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
        setError(sourceErrorText(failure) ?? `${t('skills', 'errorPreview')} — ${describeError(failure)}`)
      } finally {
        setBusy(false)
      }
    })()
  }

  /** 第二阶段：带预览指纹落盘；源在预览后被改动时后端拒绝。 */
  const runConfirm = (): void => {
    if (preview === null) return
    const body = payload()
    if (body === null) {
      setError(t('skills', 'errorSourceRequired'))
      return
    }
    const fingerprint = preview.fingerprint
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const result = await request<{ ok: true; skill: SkillView }>('/skills/import/confirm', {
          method: 'POST',
          body: { ...body, fingerprint },
        })
        setPreview(null)
        setSourcePath('')
        setArchiveBase64(null)
        setArchiveName('')
        onImported(result.skill)
      } catch (failure) {
        setError(sourceErrorText(failure) ?? (failure instanceof ApiError && failure.code === 'SKILL_DIRECTORY_ORPHANED'
          ? t('skills', 'errorDirectoryOrphaned', { name: preview.name })
          : `${t('skills', 'errorImport')} — ${describeError(failure)}`))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('skills', 'importTitle')}
      closeLabel={t('common', 'actionClose')}
      description={t('skills', 'importDescription')}
      className={`${css.modalDialog ?? ''} ${skillCss.importDialog ?? ''}`}
      contentClassName={css.modalScroll ?? ''}
      footer={preview === null
        ? (
          <>
            <Button variant="outline" onClick={close}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="primary"
              disabled={busy}
              aria-busy={busy}
              icon={busy ? <span className={css.spinner} aria-hidden="true" /> : undefined}
              onClick={runPreview}
            >
              {busy ? t('skills', 'previewing') : t('skills', 'preview')}
            </Button>
          </>
        )
        : (
          <>
            <Button variant="outline" onClick={() => { setPreview(null); setError(null) }}>
              {t('skills', 'importBack')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              aria-busy={busy}
              icon={busy ? <span className={css.spinner} aria-hidden="true" /> : undefined}
              onClick={runConfirm}
            >
              {busy ? t('skills', 'importing') : t('skills', 'confirmImport')}
            </Button>
          </>
        )}
    >
      <div className={css.form}>
        <NoticeLine tone="error" text={error} />
        <div className={skillCss.importSteps}>
          <span
            className={preview === null ? `${skillCss.importStep} ${skillCss.importStepActive}` : skillCss.importStep}
            aria-current={preview === null ? 'step' : undefined}
          >
            {t('skills', 'step1')}
          </span>
          <span
            className={preview === null ? skillCss.importStep : `${skillCss.importStep} ${skillCss.importStepActive}`}
            aria-current={preview === null ? undefined : 'step'}
          >
            {t('skills', 'step2')}
          </span>
        </div>
        {preview === null && (
          <>
            <Field label={t('skills', 'sourcePathLabel')} hint={t('skills', 'sourcePathHint')}>
              <Input
                data-modal-autofocus
                value={sourcePath}
                placeholder={t('skills', 'sourcePathPlaceholder')}
                onChange={(event) => {
                  setSourcePath(event.currentTarget.value)
                  setArchiveBase64(null)
                  setArchiveName('')
                  // 与文件分支同一规则：换了来源就作废旧预览，否则「确认导入」发的是新路径、
                  // 界面展示的却是上一个包的名称/版本/文件清单。
                  setPreview(null)
                }}
              />
            </Field>
            <Field label={t('skills', 'archiveLabel')} hint={t('skills', 'archiveHint')}>
              <FilePicker
                accept=".zip"
                maxBytes={MAX_SKILL_ARCHIVE_BYTES}
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
          </>
        )}
        {preview !== null && (
          <div className={skillCss.importPreview}>
            <dl className={skillCss.importMeta}>
              <div className={skillCss.metaRow}>
                <dt className={skillCss.metaLabel}>{t('common', 'labelName')}</dt>
                <dd className={`${skillCss.metaValue} ${skillCss.metaValueMono}`}>{preview.name}</dd>
              </div>
              <div className={skillCss.metaRow}>
                <dt className={skillCss.metaLabel}>{t('common', 'labelVersion')}</dt>
                <dd className={`${skillCss.metaValue} ${skillCss.metaValueMono}`}>{preview.version}</dd>
              </div>
              <div className={skillCss.metaRow}>
                <dt className={skillCss.metaLabel}>{t('common', 'labelAuthor')}</dt>
                <dd className={`${skillCss.metaValue} ${skillCss.metaValueMono}`}>{preview.author}</dd>
              </div>
              <div className={skillCss.metaRow}>
                <dt className={skillCss.metaLabel}>{t('common', 'labelDescription')}</dt>
                {/* 骨架包的 description 是空串而非 null（`skills.ts` L312/L321），`??` 兜不住：
                    标签悬着无值形似渲染残缺。 */}
                <dd className={skillCss.metaValue}>{preview.description === null || preview.description === '' ? t('common', 'labelNone') : preview.description}</dd>
              </div>
            </dl>
            <div className={skillCss.importTree}>
              <div className={skillCss.importTreeHead}>{t('skills', 'previewFiles', { count: preview.files.length })}</div>
              <ul className={skillCss.importTreeList}>
                {/* 预览协议给出相对路径与字节数（`skills.ts` 的 SkillImportPreview.files）。 */}
                {preview.files.map(file => (
                  <li key={file.path} className={skillCss.importTreeRow}>
                    <span className={skillCss.importTreePath}>{file.path}</span>
                    <span className={skillCss.importTreeSize}>{formatFileSize(file.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {preview.skippedRejected.length > 0 && (
              <div className={skillCss.importRejected}>
                <div className={skillCss.importTreeHead}>{t('skills', 'previewRejected', { count: preview.skippedRejected.length })}</div>
                <ul className={skillCss.importTreeList}>
                  {/* 后端只跳过宿主元数据（`isArchiveJunk`：.DS_Store / Thumbs.db / __MACOSX），
                      所以「系统文件，已跳过」是这条清单的完整原因，不是推测。 */}
                  {preview.skippedRejected.map(path => (
                    <li key={path} className={skillCss.importTreeRow}>
                      <span className={skillCss.importTreePath}>{path}</span>
                      <span className={skillCss.importRejectedNote}>{t('skills', 'previewRejectedNote')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
