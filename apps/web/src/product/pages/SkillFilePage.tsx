/** 技能文件编辑器。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconPlusOutline16, IconTrashOutline16, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import type { SkillFileEntry, SkillView } from '../types.ts'
import css from '../styles/common.module.css'

/** 编辑态（含内存撤销栈）。 */
interface EditState {
  text: string
  saved: string
  history: string[]
  index: number
}

const EMPTY_EDIT: EditState = { text: '', saved: '', history: [], index: -1 }
const HISTORY_LIMIT = 200

/**
 * 渲染技能文件编辑器。
 * @param props.skillId - 技能 ID。
 */
export function SkillFilePage({ skillId }: { skillId: string }) {
  useLocale()
  const [skill, setSkill] = useState<SkillView | null>(null)
  const [files, setFiles] = useState<SkillFileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [renamePath, setRenamePath] = useState('')
  const skipHistory = useRef(false)

  const loadTree = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [skillResult, fileResult] = await Promise.all([
        request<{ ok: true; skills: SkillView[] }>('/skills'),
        request<{ ok: true; files: SkillFileEntry[] }>(`/skills/${skillId}/files`),
      ])
      setSkill(skillResult.skills.find(item => item.id === skillId) ?? null)
      setFiles(fileResult.files)
      setError(null)
    } catch (failure) {
      setError(`${t('skillFile', 'errorLoad')} — ${describeError(failure)}`)
    } finally {
      setLoading(false)
    }
  }, [skillId])

  useEffect(() => { void loadTree() }, [loadTree])

  const openFile = useCallback(async (path: string): Promise<void> => {
    try {
      const result = await request<{ ok: true; path: string; text: string }>(
        `/skills/${skillId}/file`,
        { query: { path } },
      )
      setSelected(path)
      setEdit({ text: result.text, saved: result.text, history: [result.text], index: 0 })
      setError(null)
    } catch (failure) {
      setError(`${t('skillFile', 'errorRead')} — ${describeError(failure)}`)
    }
  }, [skillId])

  useEffect(() => {
    const first = files.find(entry => entry.text !== null)
    if (selected === null && first !== undefined) void openFile(first.path)
  }, [files, selected, openFile])

  const save = useCallback(async (text: string): Promise<void> => {
    if (selected === null) return
    setSaving(true)
    try {
      await request(`/skills/${skillId}/file`, { method: 'PUT', body: { path: selected, text } })
      setEdit(previous => ({ ...previous, saved: text }))
      setNotice(t('skillFile', 'saved'))
      setError(null)
    } catch (failure) {
      setError(`${t('skillFile', 'errorSave')} — ${describeError(failure)}`)
    } finally {
      setSaving(false)
    }
  }, [selected, skillId])

  const dirty = selected !== null && edit.text !== edit.saved

  // 自动保存：改动 2 秒防抖（失焦另有即时保存）。
  useEffect(() => {
    if (!dirty || saving) return
    const timer = window.setTimeout(() => { void save(edit.text) }, 2000)
    return () => { window.clearTimeout(timer) }
  }, [dirty, saving, edit.text, save])

  const applyEdit = (next: string): void => {
    setEdit(previous => {
      if (skipHistory.current) {
        skipHistory.current = false
        return { ...previous, text: next }
      }
      const kept = previous.history.slice(0, previous.index + 1)
      const history = [...kept, next].slice(-HISTORY_LIMIT)
      return { ...previous, text: next, history, index: history.length - 1 }
    })
  }

  const undo = (): void => {
    setEdit(previous => {
      if (previous.index <= 0) return previous
      const index = previous.index - 1
      skipHistory.current = true
      return { ...previous, index, text: previous.history[index] ?? previous.text }
    })
  }

  const redo = (): void => {
    setEdit(previous => {
      if (previous.index >= previous.history.length - 1) return previous
      const index = previous.index + 1
      skipHistory.current = true
      return { ...previous, index, text: previous.history[index] ?? previous.text }
    })
  }

  const grouped = useMemo(() => files.map(entry => ({
    entry,
    depth: entry.path.split('/').length - 1,
  })), [files])

  const selectedEntry = files.find(entry => entry.path === selected) ?? null

  return (
    <div className={css.page}>
      <PageHeader
        title={skill === null ? t('skillFile', 'title') : `${t('skillFile', 'title')} · ${skill.name}`}
        subtitle={t('skillFile', 'subtitle')}
        actions={(
          <>
            <Button onClick={() => { navigate('/skills') }}>{t('common', 'actionBack')}</Button>
            <Button onClick={() => { void loadTree() }}>{t('common', 'actionRefresh')}</Button>
            <Button variant="primary" disabled={!dirty || saving} onClick={() => { void save(edit.text) }}>
              {saving ? t('skillFile', 'saving') : t('skillFile', 'save')}
            </Button>
          </>
        )}
      />

      <NoticeLine tone="error" text={error} />
      <NoticeLine tone="success" text={notice} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}

      {!loading && (
        <div className={css.splitPane}>
          <div className={css.section}>
            <div className={css.sectionTitle}>{t('skillFile', 'tree')}</div>
            <div className={css.fieldHint}>{t('skillFile', 'fileCount', { count: files.length })}</div>
            <div className={css.toolbar}>
              <Button size="sm" icon={<IconPlusOutline16 size={12} />} onClick={() => { setNewPath(''); setCreateOpen(true) }}>
                {t('skillFile', 'newFile')}
              </Button>
              <Button size="sm" disabled={selected === null} onClick={() => { setRenamePath(selected ?? ''); setRenameOpen(true) }}>
                {t('common', 'actionRename')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<IconTrashOutline16 size={12} />}
                disabled={selected === null}
                onClick={() => { setDeleteOpen(true) }}
              >
                {t('common', 'actionDelete')}
              </Button>
            </div>
            <div className={css.tree}>
              {grouped.length === 0 && <div className={css.fieldHint}>{t('skillFile', 'emptyTree')}</div>}
              {grouped.map(item => (
                <button
                  key={item.entry.path}
                  type="button"
                  className={[
                    css.treeItem,
                    item.entry.path === selected ? css.treeItemActive : '',
                    item.depth === 1 ? css.treeItemIndent : item.depth > 1 ? css.treeItemIndent2 : '',
                  ].filter(part => part !== '').join(' ')}
                  onClick={() => { void openFile(item.entry.path) }}
                >
                  {item.entry.path}
                  {item.entry.text === null && <span className={css.fieldHint}>{t('skillFile', 'binaryFile')}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className={css.section}>
            <div className={css.sectionTitle}>{t('skillFile', 'editorTitle')}</div>
            {selected === null && <div className={css.empty}>{t('skillFile', 'emptyFile')}</div>}
            {selected !== null && (
              <>
                <div className={css.toolbar}>
                  <span className={css.mono}>{selected}</span>
                  <span className={css.toolbarSpacer} />
                  <Button size="sm" disabled={edit.index <= 0} onClick={undo}>{t('skillFile', 'undo')}</Button>
                  <Button
                    size="sm"
                    disabled={edit.index >= edit.history.length - 1}
                    onClick={redo}
                  >
                    {t('skillFile', 'redo')}
                  </Button>
                  <span className={css.fieldHint}>
                    {dirty ? t('common', 'stateUnsaved') : t('common', 'stateSaved')}
                    {' · '}
                    {t('skillFile', 'autosaveHint')}
                  </span>
                </div>
                <textarea
                  className={`${css.textarea} ${css.textareaMono}`}
                  value={edit.text}
                  onBlur={() => { if (dirty) void save(edit.text) }}
                  onChange={event => { applyEdit(event.currentTarget.value) }}
                />
                <Field label={t('skillFile', 'note')} hint={t('skillFile', 'noteHint')}>
                  <Input
                    value={notes[selected] ?? ''}
                    placeholder={t('skillFile', 'notePlaceholder')}
                    onChange={event => {
                      const value = event.currentTarget.value
                      setNotes(previous => ({ ...previous, [selected]: value }))
                    }}
                  />
                </Field>
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false) }}
        title={t('skillFile', 'newFileTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('skillFile', 'newFileDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setCreateOpen(false) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="primary"
              disabled={newPath.trim() === ''}
              onClick={() => {
                const path = newPath.trim()
                void (async () => {
                  try {
                    await request(`/skills/${skillId}/file`, { method: 'POST', body: { path, text: '' } })
                    setCreateOpen(false)
                    setNewPath('')
                    await loadTree()
                    await openFile(path)
                  } catch (failure) {
                    setError(`${t('skillFile', 'errorCreate')} — ${describeError(failure)}`)
                  }
                })()
              }}
            >
              {t('skillFile', 'createFile')}
            </Button>
          </>
        )}
      >
        <Field label={t('skillFile', 'pathLabel')}>
          <Input
            value={newPath}
            placeholder={t('skillFile', 'pathPlaceholder')}
            onChange={event => { setNewPath(event.currentTarget.value) }}
          />
        </Field>
      </Modal>

      <Modal
        open={renameOpen}
        onClose={() => { setRenameOpen(false) }}
        title={t('skillFile', 'renameTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('skillFile', 'renameDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRenameOpen(false) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="primary"
              disabled={renamePath.trim() === '' || selected === null}
              onClick={() => {
                const from = selected
                const to = renamePath.trim()
                if (from === null || to === '' || to === from) {
                  setRenameOpen(false)
                  return
                }
                void (async () => {
                  try {
                    await request(`/skills/${skillId}/file`, { method: 'POST', body: { path: to, text: edit.text } })
                    await request(`/skills/${skillId}/file`, { method: 'DELETE', body: { path: from } })
                    setRenameOpen(false)
                    await loadTree()
                    await openFile(to)
                  } catch (failure) {
                    setError(`${t('skillFile', 'errorRename')} — ${describeError(failure)}`)
                  }
                })()
              }}
            >
              {t('common', 'actionRename')}
            </Button>
          </>
        )}
      >
        <Field label={t('skillFile', 'newPathLabel')}>
          <Input
            value={renamePath}
            onChange={event => { setRenamePath(event.currentTarget.value) }}
          />
        </Field>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false) }}
        title={t('common', 'confirmDeleteTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('common', 'confirmDeleteDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDeleteOpen(false) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="primary"
              disabled={selected === null}
              onClick={() => {
                const path = selected
                if (path === null) return
                void (async () => {
                  try {
                    await request(`/skills/${skillId}/file`, { method: 'DELETE', body: { path } })
                    setDeleteOpen(false)
                    setSelected(null)
                    setEdit(EMPTY_EDIT)
                    await loadTree()
                  } catch (failure) {
                    setError(`${t('skillFile', 'errorDelete')} — ${describeError(failure)}`)
                  }
                })()
              }}
            >
              {t('common', 'actionDelete')}
            </Button>
          </>
        )}
      >
        <p className={css.cardBody}>{selected ?? ''}</p>
      </Modal>

      {selectedEntry !== null && selectedEntry.text === null && (
        <NoticeLine tone="info" text={t('skillFile', 'binaryFile')} />
      )}
    </div>
  )
}
