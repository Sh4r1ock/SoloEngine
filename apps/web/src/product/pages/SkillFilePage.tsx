/** 技能文件编辑器。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconPlusOutlineRegular, IconTrashOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate, setRouteBlocker } from '../router.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Field } from '../components/Field.tsx'
import { PathValue } from '../components/PathValue.tsx'
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
  // 页面级文案存「键 + 动态细节」，渲染时翻译（S5-F9 / S7-F29 同一规则）：本页在 AppShell 内，
  // 语言 Pill 始终可达，存已翻译字符串会在切换语言后残留旧语种。
  const [error, setError] = useState<{ key: string; detail: string } | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [renamePath, setRenamePath] = useState('')
  // 弹窗内失败的就近文案：页面级 NoticeLine 会被 Modal 遮罩挡住（实测遮罩命中错误行），
  // 用户在弹窗里看不到任何反馈——与模型页/技能页「错误就近呈现」同一规则。
  const [dialogError, setDialogError] = useState<string | null>(null)
  const skipHistory = useRef(false)

  const loadTree = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [skillResult, fileResult, noteResult] = await Promise.all([
        request<{ ok: true; skills: SkillView[] }>('/skills'),
        request<{ ok: true; files: SkillFileEntry[] }>(`/skills/${skillId}/files`),
        // FR-SKILL-006：备注存台账（skills_packages.notes），刷新后仍在。
        request<{ ok: true; notes: Record<string, string> }>(`/skills/${skillId}/notes`),
      ])
      setSkill(skillResult.skills.find(item => item.id === skillId) ?? null)
      setFiles(fileResult.files)
      setNotes(noteResult.notes)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorLoad', detail: describeError(failure) })
    } finally {
      setLoading(false)
    }
  }, [skillId])

  useEffect(() => { void loadTree() }, [loadTree])

  const readSeq = useRef(0)
  const openFile = useCallback(async (path: string): Promise<void> => {
    // 二进制条目不发起读取：后端 `readFile` 无条件按 UTF-8 解码字节（skills.ts L433+），
    // 乱码会写进编辑区，而「重命名」又把这串乱码写回文件——实测 97,844 字节的 PNG
    // 重命名后变成 175,003 字节的坏文件（不可逆损坏）。清单里已有 text===null 的事实，
    // 在唯一的读取入口处拦住，比在每个写路径上补判断更靠根因。
    const entry = files.find(item => item.path === path)
    if (entry !== undefined && entry.text === null) {
      readSeq.current += 1 // 同步作废在途的文本读取，避免过期响应把二进制条目又填成文本
      setSelected(path)
      setEdit(EMPTY_EDIT)
      setError(null)
      return
    }
    const seq = readSeq.current + 1
    readSeq.current = seq
    try {
      const result = await request<{ ok: true; path: string; text: string }>(
        `/skills/${skillId}/file`,
        { query: { path } },
      )
      if (seq !== readSeq.current) return // R23：连点两个文件时后发请求胜出，过期响应整份丢弃
      setSelected(path)
      setEdit({ text: result.text, saved: result.text, history: [result.text], index: 0 })
      setError(null)
    } catch (failure) {
      if (seq !== readSeq.current) return
      setError({ key: 'errorRead', detail: describeError(failure) })
    }
  }, [skillId, files])

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
      setSavedNotice(true)
      setError(null)
    } catch (failure) {
      setError({ key: 'errorSave', detail: describeError(failure) })
    } finally {
      setSaving(false)
    }
  }, [selected, skillId])

  const dirty = selected !== null && edit.text !== edit.saved

  // FR-SKILL-006：备注改动 800ms 防抖落台账（skills_packages.notes，不改包）。
  const notesTimer = useRef<number | null>(null)
  const notesPending = useRef<Record<string, string> | null>(null)
  const writeNotes = useCallback((next: Record<string, string>): void => {
    void (async () => {
      try {
        await request(`/skills/${skillId}/notes`, { method: 'PUT', body: { notes: next } })
      } catch (failure) {
        setError({ key: 'errorSave', detail: describeError(failure) })
      }
    })()
  }, [skillId])
  const saveNotes = useCallback((next: Record<string, string>): void => {
    if (notesTimer.current !== null) window.clearTimeout(notesTimer.current)
    notesPending.current = next
    notesTimer.current = window.setTimeout(() => {
      notesTimer.current = null
      notesPending.current = null
      writeNotes(next)
    }, 800)
  }, [writeNotes])
  // 在途备注必须落盘，不能只清定时器：失焦（含点侧栏离开本页）与卸载都即时补写，
  // 否则「打完字就走」的备注会静默丢失（R26 不静默 / R33 未保存拦截的同一条底线）。
  const flushNotes = useCallback((): void => {
    if (notesTimer.current === null || notesPending.current === null) return
    const next = notesPending.current
    window.clearTimeout(notesTimer.current)
    notesTimer.current = null
    notesPending.current = null
    writeNotes(next)
  }, [writeNotes])

  useEffect(() => flushNotes, [flushNotes])

  // 自动保存：改动 2 秒防抖（失焦另有即时保存）。
  useEffect(() => {
    if (!dirty || saving) return
    const timer = window.setTimeout(() => { void save(edit.text) }, 2000)
    return () => { window.clearTimeout(timer) }
  }, [dirty, saving, edit.text, save])

  // R33：SPA 内导航拦截——复用 router 阻塞注册表（与画布编辑器同一机制）。
  useEffect(() => {
    setRouteBlocker(() => (dirty ? t('skillFile', 'dirtyLeave') : null))
    return () => { setRouteBlocker(null) }
  }, [dirty])

  // R39：dirty 时刷新/关闭警告。
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => { window.removeEventListener('beforeunload', handler) }
  }, [dirty])

  const applyEdit = (next: string): void => {
    setEdit((previous) => {
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
    setEdit((previous) => {
      if (previous.index <= 0) return previous
      const index = previous.index - 1
      skipHistory.current = true
      return { ...previous, index, text: previous.history[index] ?? previous.text }
    })
  }

  const redo = (): void => {
    setEdit((previous) => {
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

      <NoticeLine tone="error" text={error === null ? null : `${t('skillFile', error.key)} — ${error.detail}`} />
      <NoticeLine tone="success" text={savedNotice ? t('skillFile', 'saved') : null} />

      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}

      {!loading && (
        <div className={css.splitPane}>
          <div className={css.section}>
            <div className={css.sectionTitle}>{t('skillFile', 'tree')}</div>
            {/* 单复数与画布/模型页同一规则（en 侧「1 files」实测缺陷 F41）。 */}
            <div className={css.fieldHint}>{files.length === 1 ? t('skillFile', 'fileCountOne') : t('skillFile', 'fileCount', { count: files.length })}</div>
            <div className={css.toolbar}>
              <Button size="sm" icon={<IconPlusOutlineRegular size={12} />} onClick={() => { setNewPath(''); setDialogError(null); setCreateOpen(true) }}>
                {t('skillFile', 'newFile')}
              </Button>
              {/* 二进制条目禁止重命名：重命名走「用编辑区内容新建 + 删原文件」，二进制没有可搬运的
                  文本内容，实测会把原文件写坏（asset.png 97,844B → 175,003B 坏文件）。 */}
              <Button
                size="sm"
                disabled={selected === null || (selectedEntry !== null && selectedEntry.text === null)}
                onClick={() => { setRenamePath(selected ?? ''); setDialogError(null); setRenameOpen(true) }}
              >
                {t('common', 'actionRename')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<IconTrashOutlineRegular size={12} />}
                disabled={selected === null}
                onClick={() => { setDialogError(null); setDeleteOpen(true) }}
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
                  {/* 手册 §三.8：长路径统一走 PathValue（等宽 + 分隔符原子片段），
                      裸 `.mono` 在窄列里会把路径整块撑破或在连字符处乱断。 */}
                  <PathValue value={selected} />
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
                  className={`${css.textarea} ${css.textareaMono} ${css.editorArea}`}
                  aria-label={t('skillFile', 'editorAria', { path: selected })}
                  value={edit.text}
                  disabled={selectedEntry !== null && selectedEntry.text === null}
                  onBlur={() => { if (dirty) void save(edit.text) }}
                  onChange={(event) => { applyEdit(event.currentTarget.value) }}
                />
                {selectedEntry !== null && selectedEntry.text === null && (
                  <NoticeLine tone="info" text={`${t('skillFile', 'binaryFile')} · ${t('skillFile', 'binaryRenameHint')}`} />
                )}
                <Field label={t('skillFile', 'note')} hint={t('skillFile', 'noteHint')}>
                  <Input
                    value={notes[selected] ?? ''}
                    placeholder={t('skillFile', 'notePlaceholder')}
                    onBlur={() => { flushNotes() }}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setNotes((previous) => {
                        const next = { ...previous, [selected]: value }
                        saveNotes(next)
                        return next
                      })
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
                    setDialogError(`${t('skillFile', 'errorCreate')} — ${describeError(failure)}`)
                  }
                })()
              }}
            >
              {t('skillFile', 'createFile')}
            </Button>
          </>
        )}
      >
        <NoticeLine tone="error" text={dialogError} />
        <Field label={t('skillFile', 'pathLabel')}>
          <Input
            value={newPath}
            placeholder={t('skillFile', 'pathPlaceholder')}
            onChange={(event) => { setNewPath(event.currentTarget.value) }}
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
                    setDialogError(`${t('skillFile', 'errorRename')} — ${describeError(failure)}`)
                  }
                })()
              }}
            >
              {t('common', 'actionRename')}
            </Button>
          </>
        )}
      >
        <NoticeLine tone="error" text={dialogError} />
        <Field label={t('skillFile', 'newPathLabel')}>
          <Input
            value={renamePath}
            onChange={(event) => { setRenamePath(event.currentTarget.value) }}
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
              variant="ghost"
              className={css.dangerButton}
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
                    setDialogError(`${t('skillFile', 'errorDelete')} — ${describeError(failure)}`)
                  }
                })()
              }}
            >
              {t('common', 'actionDelete')}
            </Button>
          </>
        )}
      >
        <NoticeLine tone="error" text={dialogError} />
        <p className={css.cardBody}>{selected ?? ''}</p>
      </Modal>
    </div>
  )
}
