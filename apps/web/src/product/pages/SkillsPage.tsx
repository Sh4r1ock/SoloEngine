/** 技能页。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconDownloadOutline16, IconPlusOutline16, IconTrashOutline16,
  Input, Modal, Switch, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request, requestBlob } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import type { SkillImportPreview, SkillView } from '../types.ts'
import css from '../styles/common.module.css'

/**
 * 渲染技能页。
 */
export function SkillsPage() {
  useLocale()
  const [skills, setSkills] = useState<SkillView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
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
      setError(describeError(failure))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (keyword === '') return skills
    return skills.filter(skill => `${skill.name} ${skill.author} ${skill.description ?? ''}`.toLowerCase().includes(keyword))
  }, [skills, search])

  const act = (id: string, action: () => Promise<void>, failureKey: string): void => {
    setBusyId(id)
    setError(null)
    void (async () => {
      try {
        await action()
      } catch (failure) {
        setError(`${t('skills', failureKey)} — ${describeError(failure)}`)
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
          value={search}
          placeholder={t('skills', 'searchPlaceholder')}
          onChange={event => { setSearch(event.currentTarget.value) }}
        />
      </div>

      <NoticeLine tone="error" text={error} action={{ label: t('common', 'actionRetry'), onClick: () => { void load() } }} />
      <NoticeLine tone="success" text={notice} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}
      {!loading && visible.length === 0 && <div className={css.empty}>{t('skills', 'empty')}</div>}

      <div className={css.cardGrid}>
        {visible.map(skill => (
          <article key={skill.id} className={css.card}>
            <div className={css.cardHeader}>
              <span className={css.iconBlock}>{skill.icon === null || skill.icon === '' ? skill.name.slice(0, 1) : skill.icon}</span>
              <div className={css.cardTitleBlock}>
                <h2 className={css.cardTitle}>{skill.name}</h2>
                <span className={css.cardMeta}>
                  {t('common', 'labelVersion')} {skill.pkg_version}
                  {' · '}
                  {t('common', 'labelAuthor')} {skill.author}
                </span>
              </div>
              <Switch
                checked={skill.is_active}
                label={`${skill.name} ${t('skills', 'toggleActive')}`}
                disabled={busyId === skill.id}
                onChange={next => {
                  act(skill.id, async () => {
                    await request(`/skills/${skill.id}/active`, { method: 'POST', body: { active: next } })
                    await load()
                  }, 'errorActive')
                }}
              />
            </div>
            <div className={css.cardBody}>{skill.description ?? t('common', 'labelNone')}</div>
            <div className={css.chipRow}>
              {skill.is_public && <Tag tone="info">{t('skills', 'publicBadge')}</Tag>}
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
        ))}
      </div>

      <CreateSkillDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false) }}
        onCreated={skill => {
          setCreateOpen(false)
          setNotice(`${t('skills', 'create')}: ${skill.name}`)
          void load()
        }}
        onError={message => { setError(message) }}
      />

      <ImportSkillDialog
        open={importOpen}
        onClose={() => { setImportOpen(false) }}
        onImported={skill => {
          setImportOpen(false)
          setNotice(`${t('skills', 'confirmImport')}: ${skill.name}`)
          void load()
        }}
        onError={message => { setError(message) }}
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
}

/** 创建技能骨架对话框。 */
function CreateSkillDialog({ open, onClose, onCreated, onError }: {
  open: boolean
  onClose: () => void
  onCreated: (skill: SkillView) => void
  onError: (message: string) => void
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
                  setError(describeError(failure))
                  onError(`${t('skills', 'errorCreate')} — ${describeError(failure)}`)
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
          <Input value={name} onChange={event => { setName(event.currentTarget.value) }} />
        </Field>
        <Field label={t('common', 'labelVersion')}>
          <Input value={version} onChange={event => { setVersion(event.currentTarget.value) }} />
        </Field>
      </div>
    </Modal>
  )
}

/** 两阶段导入向导。 */
function ImportSkillDialog({ open, onClose, onImported, onError }: {
  open: boolean
  onClose: () => void
  onImported: (skill: SkillView) => void
  onError: (message: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
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
      contentClassName={css.scrollArea ?? ''}
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
                  setError(describeError(failure))
                  onError(`${t('skills', 'errorPreview')} — ${describeError(failure)}`)
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
                  setError(describeError(failure))
                  onError(`${t('skills', 'errorImport')} — ${describeError(failure)}`)
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
            onChange={event => {
              setSourcePath(event.currentTarget.value)
              setArchiveBase64(null)
              setArchiveName('')
            }}
          />
        </Field>
        <Field label={t('skills', 'archiveLabel')} hint={t('skills', 'archiveHint')}>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              if (file === undefined) return
              const reader = new FileReader()
              reader.onload = () => {
                const text = typeof reader.result === 'string' ? reader.result : ''
                const comma = text.indexOf(',')
                setArchiveBase64(comma < 0 ? text : text.slice(comma + 1))
                setArchiveName(file.name)
                setSourcePath('')
                setPreview(null)
              }
              reader.onerror = () => { setError(`FileReader: ${String(reader.error?.message ?? 'failed')}`) }
              reader.readAsDataURL(file)
            }}
          />
        </Field>
        {archiveName !== '' && <div className={css.fieldHint}>{archiveName}</div>}
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
              <span className={css.definitionValue}>{preview.description ?? t('common', 'labelNone')}</span>
            </div>
            <div className={css.fieldLabel}>{t('skills', 'previewFiles', { count: preview.files.length })}</div>
            <div className={css.tree}>
              {preview.files.map(path => (
                <div key={path} className={css.treeItem}>{path}</div>
              ))}
            </div>
            {preview.skippedRejected.length > 0 && (
              <>
                <div className={css.fieldLabel}>{t('skills', 'previewRejected', { count: preview.skippedRejected.length })}</div>
                <div className={css.tree}>
                  {preview.skippedRejected.map(path => (
                    <div key={path} className={`${css.treeItem} ${css.treeItemActive}`}>{path}</div>
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
