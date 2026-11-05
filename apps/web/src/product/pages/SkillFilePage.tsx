/** 技能文件编辑器。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  IconCopyOutlineRegular,
  IconEllipsisOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconPlusOutlineRegular,
  Input,
  Menu,
  Modal,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ApiError, describeError, request } from '../api.ts'
import { t, useLocale } from '../i18n.ts'
import { navigate, setRouteBlocker } from '../router.ts'
import { NoticeLine } from '../components/NoticeLine.tsx'
import { Glyph } from '../components/Glyph.tsx'
import { useToastHost } from '../components/Toaster.tsx'
import { Field } from '../components/Field.tsx'
import { PathValue } from '../components/PathValue.tsx'
import { submitFormOnEnter } from '../utils/submitOnEnter.ts'
import type { SkillFileEntry, SkillView } from '../types.ts'
import css from '../styles/common.module.css'
import skillCss from '../styles/skill-file.module.css'

/** 编辑态（含内存撤销栈）。 */
interface EditState {
  text: string
  saved: string
  history: string[]
  index: number
}

const EMPTY_EDIT: EditState = { text: '', saved: '', history: [], index: -1 }
const HISTORY_LIMIT = 80
/** 连续输入的合并窗口：500ms 内的改动并作一步撤销（原型 skill-file.js 的 flushGroup）。 */
const EDIT_GROUP_WINDOW_MS = 500
/** 目录树层级缩进（原型 skill-file.js：`8 + depth × 14`，运行时几何样式）。 */
const TREE_INDENT_BASE = 8
const TREE_INDENT_STEP = 14

/** 文本的 UTF-8 字节数（文件信息栏的「字节」口径）。 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 文本文件的种类文案键：按扩展名区分 Markdown / Python / JSON / 文本（原型 skill-file.js:81-87）。 */
function fileKindKey(path: string): 'fileInfoMarkdown' | 'fileInfoPython' | 'fileInfoJson' | 'fileInfoText' {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md')) return 'fileInfoMarkdown'
  if (lower.endsWith('.py')) return 'fileInfoPython'
  if (lower.endsWith('.json')) return 'fileInfoJson'
  return 'fileInfoText'
}

/** 目录树的一行：文件夹行（可展开/收起）或文件行。 */
type TreeRow =
  | { kind: 'folder'; path: string; name: string; depth: number }
  | { kind: 'file'; path: string; name: string; depth: number; entry: SkillFileEntry }

/**
 * 渲染技能文件编辑器。
 * @param props.skillId - 技能 ID。
 */
export function SkillFilePage({ skillId }: { skillId: string }) {
  const locale = useLocale()
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
  // 保存等成功反馈走 Toast（原型 skill-file.js:103/376/432/457 的 App.toast）。
  const toast = useToastHost()
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [newPath, setNewPath] = useState('')
  const [newPathError, setNewPathError] = useState<string | null>(null)
  const [renamePath, setRenamePath] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  // 切换文件确认：目标路径非空即打开弹窗（有未保存改动时由 requestOpenFile 置位）。
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  // 选中文件的 UTF-8 字节数：打开时取条目 size，编辑后按当前文本更新。
  const [fileSize, setFileSize] = useState(0)
  // 备注状态：编辑中 / 最近一次写入成功 / 无待写改动（沿用台账被动文案）。
  const [notesState, setNotesState] = useState<'idle' | 'dirty' | 'saved'>('idle')
  // 弹窗内失败的就近文案：页面级 NoticeLine 会被 Modal 遮罩挡住（实测遮罩命中错误行），
  // 用户在弹窗里看不到任何反馈——与模型页/技能页「错误就近呈现」同一规则。
  const [dialogError, setDialogError] = useState<string | null>(null)
  // 保存响应按路径栅栏：保存期间切到别的文件时，旧响应不得改写新文件的已保存基线。
  const selectedRef = useRef<string | null>(null)
  // 撤销分组：上一次输入时间与「当前历史步是否可被后续输入替换」。
  const mergeHistory = useRef(false)
  const lastEditAt = useRef(0)
  // 备注写入带版本栅栏：每次成功保存后服务端版本 +1，这里同步跟上，下一次写入才不会被判过期。
  const versionRef = useRef(0)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLPreElement | null>(null)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })

  const loadTree = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [skillResult, fileResult, noteResult] = await Promise.all([
        request<{ ok: true; skills: SkillView[] }>('/skills'),
        request<{ ok: true; files: SkillFileEntry[] }>(`/skills/${skillId}/files`),
        // FR-SKILL-006：备注存台账（skills_packages.notes），刷新后仍在。
        request<{ ok: true; notes: Record<string, string> }>(`/skills/${skillId}/notes`),
      ])
      const found = skillResult.skills.find(item => item.id === skillId) ?? null
      setSkill(found)
      versionRef.current = found === null ? 0 : found.version
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

  // 原型 skill-file.js:63：页面标题是「<技能名> · 技能文件 · SoloEngine」。
  // 路由层先给出通用标题，技能加载完成后补上名称；离开页面由路由层重新覆盖。
  useEffect(() => {
    if (skill === null) return
    document.title = `${skill.name} · ${t('shell', 'docTitleSkill')}`
  }, [skill, locale])

  const readSeq = useRef(0)
  const openFile = useCallback(async (path: string): Promise<void> => {
    // 二进制条目不发起读取：后端 `readFile` 无条件按 UTF-8 解码字节（skills.ts L433+），
    // 乱码会写进编辑区，而「重命名」又把这串乱码写回文件——实测 97,844 字节的 PNG
    // 重命名后变成 175,003 字节的坏文件（不可逆损坏）。清单里已有 text===null 的事实，
    // 在唯一的读取入口处拦住，比在每个写路径上补判断更靠根因。
    const entry = files.find(item => item.path === path)
    if (entry !== undefined && entry.text === null) {
      readSeq.current += 1 // 同步作废在途的文本读取，避免过期响应把二进制条目又填成文本
      selectedRef.current = path
      setSelected(path)
      setEdit(EMPTY_EDIT)
      setFileSize(entry.size)
      setNotesState('idle')
      mergeHistory.current = false
      lastEditAt.current = 0
      // 打开新文件即回到行 1 列 1（原型 skill-file.js:230 切文件后刷新光标）。
      setCursor({ line: 1, column: 1 })
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
      selectedRef.current = path
      setSelected(path)
      setEdit({ text: result.text, saved: result.text, history: [result.text], index: 0 })
      // 条目 size 是服务端字节数；清单里还没有该条目时按读回文本的 UTF-8 字节数落值。
      setFileSize(entry?.size ?? byteLength(result.text))
      setNotesState('idle')
      mergeHistory.current = false
      lastEditAt.current = 0
      // 打开新文件即回到行 1 列 1（原型 skill-file.js:230 切文件后刷新光标）。
      setCursor({ line: 1, column: 1 })
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

  /**
   * 保存当前文件。
   * @param text - 编辑区文本。
   * @param silent - 自动保存传 true：原型只在手动保存时弹提示。
   */
  const save = useCallback(async (text: string, silent = false): Promise<void> => {
    const target = selected
    if (target === null) return
    setSaving(true)
    try {
      await request(`/skills/${skillId}/file`, { method: 'PUT', body: { path: target, text } })
      // 保存期间已切到别的文件：旧响应整份丢弃，不能把旧文本写进新文件的已保存基线。
      if (selectedRef.current !== target) return
      setEdit(previous => ({ ...previous, saved: text }))
      // 原型 skill-file.js:103/110：自动保存静默落盘，手动保存才提示。
      if (!silent) toast.show(t('skillFile', 'toastSaved'), 'success')
      setError(null)
    } catch (failure) {
      if (selectedRef.current !== target) return
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
        const result = await request<{ ok: true; notes: Record<string, string>; version: number }>(
          `/skills/${skillId}/notes`,
          { method: 'PUT', body: { notes: next, version: versionRef.current } },
        )
        versionRef.current = result.version
        setSkill(previous => previous === null ? previous : { ...previous, version: result.version })
        setNotesState('saved')
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === 'VERSION_CONFLICT') {
          // 别处已经改过备注：本地整包覆盖会丢掉对方的内容，改为重载最新台账再提示。
          await loadTree()
          setNotesState('idle')
          setError({ key: 'errorNotesStale', detail: '' })
          return
        }
        setNotesState('idle')
        setError({ key: 'errorSave', detail: describeError(failure) })
      }
    })()
  }, [skillId, loadTree])
  const saveNotes = useCallback((next: Record<string, string>): void => {
    if (notesTimer.current !== null) window.clearTimeout(notesTimer.current)
    notesPending.current = next
    notesTimer.current = window.setTimeout(() => {
      notesTimer.current = null
      notesPending.current = null
      writeNotes(next)
    }, 700)
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

  // 自动保存：改动 1600ms 防抖（失焦另有即时保存；需求文档 §12.3 第 7 条）。
  useEffect(() => {
    if (!dirty || saving) return
    const timer = window.setTimeout(() => { void save(edit.text, true) }, 1600)
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
    setFileSize(byteLength(next))
    const now = Date.now()
    // 500ms 内的连续输入合并成一步：替换当前历史步，而不是每个键各记一步（原型 flushGroup）。
    const merge = mergeHistory.current && now - lastEditAt.current <= EDIT_GROUP_WINDOW_MS
    mergeHistory.current = true
    lastEditAt.current = now
    setEdit((previous) => {
      const kept = previous.history.slice(0, previous.index + 1)
      if (merge && kept.length > 0) {
        const history = [...kept]
        history[history.length - 1] = next
        return { ...previous, text: next, history, index: history.length - 1 }
      }
      const history = [...kept, next].slice(-HISTORY_LIMIT)
      return { ...previous, text: next, history, index: history.length - 1 }
    })
  }

  const undo = (): void => {
    if (edit.index <= 0) return
    const index = edit.index - 1
    const text = edit.history[index] ?? edit.text
    mergeHistory.current = false
    lastEditAt.current = 0
    setEdit({ ...edit, index, text })
    setFileSize(byteLength(text))
  }

  const redo = (): void => {
    if (edit.index >= edit.history.length - 1) return
    const index = edit.index + 1
    const text = edit.history[index] ?? edit.text
    mergeHistory.current = false
    lastEditAt.current = 0
    setEdit({ ...edit, index, text })
    setFileSize(byteLength(text))
  }

  // 目录树：按 `/` 分层，文件夹在前、同级按名称排序（原型 skill-file.js 的 walk）。
  const treeRows = useMemo<TreeRow[]>(() => {
    interface DirNode {
      dirs: Map<string, DirNode>
      files: SkillFileEntry[]
    }
    const root: DirNode = { dirs: new Map(), files: [] }
    for (const entry of files) {
      const parts = entry.path.split('/')
      let node = root
      for (const part of parts.slice(0, -1)) {
        const existing = node.dirs.get(part)
        if (existing !== undefined) {
          node = existing
          continue
        }
        const created: DirNode = { dirs: new Map(), files: [] }
        node.dirs.set(part, created)
        node = created
      }
      node.files.push(entry)
    }
    const rows: TreeRow[] = []
    const walk = (node: DirNode, depth: number, prefix: string): void => {
      for (const name of [...node.dirs.keys()].sort((left, right) => left.localeCompare(right))) {
        const path = prefix === '' ? name : `${prefix}/${name}`
        rows.push({ kind: 'folder', path, name, depth })
        const child = node.dirs.get(name)
        if (child !== undefined) walk(child, depth + 1, path)
      }
      for (const entry of [...node.files].sort((left, right) => left.path.localeCompare(right.path))) {
        const name = entry.path.split('/').pop() ?? entry.path
        rows.push({ kind: 'file', path: entry.path, name: name === '' ? entry.path : name, depth, entry })
      }
    }
    walk(root, 0, '')
    return rows
  }, [files])

  const selectedEntry = files.find(entry => entry.path === selected) ?? null
  const binarySelected = selectedEntry !== null && selectedEntry.text === null
  const lineCount = Math.max(1, edit.text.split('\n').length)
  const lineNumbers = Array.from({ length: lineCount }, (_item, index) => String(index + 1)).join('\n')
  const fileInfoBase = selected === null
    ? null
    : binarySelected
      ? t('skillFile', 'fileInfoBinary')
      : t('skillFile', fileKindKey(selected))
  // 字节数取选中条目的 size（打开时落值），编辑后随当前文本更新。
  const fileInfo = fileInfoBase === null
    ? ''
    : `${fileInfoBase} · ${t('skillFile', 'fileInfoBytes', { count: fileSize.toLocaleString(locale) })}`

  /** 切换文件：有未保存改动时先确认，取消则保留当前文件与文本。 */
  const requestOpenFile = (path: string): void => {
    if (selected !== null && path !== selected && dirty) {
      setSwitchTarget(path)
      return
    }
    void openFile(path)
  }

  /** 新建文件路径的客户端校验（后端仍做最终越界与存在性检查）。 */
  const validateNewPath = (path: string): string | null => {
    if (path === '') return 'errorPathRequired'
    if (path.startsWith('/')) return 'errorPathLeadingSlash'
    if (path.split('/').includes('..')) return 'errorPathDotDot'
    if (files.some(entry => entry.path === path)) return 'errorPathExists'
    return null
  }

  /** 重命名路径校验：与新建同一规则，但原路径本身不算「已存在」。 */
  const validateRenamePath = (path: string, from: string): string | null => {
    if (path === '') return 'errorPathRequired'
    if (path.startsWith('/')) return 'errorPathLeadingSlash'
    if (path.split('/').includes('..')) return 'errorPathDotDot'
    if (path !== from && files.some(entry => entry.path === path)) return 'errorPathExists'
    return null
  }

  /** 新建空文件（表单提交入口：Enter 与底部按钮共用）。 */
  const submitNewFile = (): void => {
    const path = newPath.trim()
    const invalid = validateNewPath(path)
    if (invalid !== null) {
      setNewPathError(t('skillFile', invalid))
      return
    }
    setNewPathError(null)
    void (async () => {
      try {
        await request(`/skills/${skillId}/file`, { method: 'POST', body: { path, text: '' } })
        setCreateOpen(false)
        setNewPath('')
        toast.show(t('skillFile', 'toastCreated', { name: path }), 'success')
        await loadTree()
        await openFile(path)
      } catch (failure) {
        // 后端校验仍是最终守卫（越界、并发创建同名文件等）。
        setDialogError(`${t('skillFile', 'errorCreate')} — ${describeError(failure)}`)
      }
    })()
  }

  /** 重命名当前文件（表单提交入口：Enter 与底部按钮共用）。 */
  const submitRename = (): void => {
    const from = selected
    if (from === null) return
    const to = renamePath.trim()
    const invalid = validateRenamePath(to, from)
    if (invalid !== null) {
      setRenameError(t('skillFile', invalid))
      return
    }
    if (to === from) {
      setRenameOpen(false)
      return
    }
    void (async () => {
      try {
        await request(`/skills/${skillId}/file/rename`, { method: 'POST', body: { from, to } })
      } catch (failure) {
        setDialogError(`${t('skillFile', 'errorRename')} — ${describeError(failure)}`)
        return
      }
      // 先刷新（拿到新版本号与最新备注），再迁移备注并落库：
      // 反过来会让刷新回来的旧备注覆盖掉迁移结果。
      await loadTree()
      // 备注跟随文件重命名迁移；旧键不保留，避免同名重建时「复活」旧备注。
      const note = notes[from]
      if (note !== undefined) {
        const nextNotes: Record<string, string> = {}
        for (const [path, value] of Object.entries(notes)) {
          if (path !== from) nextNotes[path] = value
        }
        nextNotes[to] = note
        setNotes(nextNotes)
        writeNotes(nextNotes)
      }
      setRenameOpen(false)
      toast.show(t('skillFile', 'toastRenamed', { name: to }), 'success')
      await openFile(to)
    })()
  }

  /** 同步光标所在行列（工具栏状态行）。 */
  const syncCursor = (element: HTMLTextAreaElement): void => {
    const before = element.value.slice(0, element.selectionStart)
    const lines = before.split('\n')
    setCursor({ line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 })
  }

  return (
    <div className={`${css.page} ${skillCss.pageShell}`}>
      <header className={skillCss.header}>
        <div className={skillCss.headerText}>
          <div className={skillCss.breadcrumb}>
            <button type="button" className={skillCss.breadcrumbLink} onClick={() => { navigate('/skill') }}>
              {t('skills', 'title')}
            </button>
            <span aria-hidden="true">/</span>
            <span className={skillCss.breadcrumbCurrent}>{skill?.name ?? '—'}</span>
          </div>
          <h1 className={skillCss.title}>{t('skillFile', 'title')}</h1>
          <p className={skillCss.subtitle}>{t('skillFile', 'subtitle')}</p>
        </div>
        <div className={skillCss.headerActions}>
          {/* 单复数与画布/模型页同一规则（en 侧「1 files」实测缺陷 F41）。 */}
          <span className={skillCss.count}>
            {files.length === 1 ? t('skillFile', 'fileCountOne') : t('skillFile', 'fileCount', { count: files.length.toLocaleString(locale) })}
          </span>
          <Button
            icon={<IconPlusOutlineRegular size={14} />}
            onClick={() => { setNewPath(''); setNewPathError(null); setDialogError(null); setCreateOpen(true) }}
          >
            {t('skillFile', 'newFile')}
          </Button>
          <Button
            variant="primary"
            icon={<Glyph><path d="M4 4h9l3 3v9H4V4Z" /><path d="M7 4v4h6V4M7 16v-4h6v4" /></Glyph>}
            disabled={saving}
            onClick={() => { void save(edit.text) }}
          >
            {saving ? t('skillFile', 'saving') : t('skillFile', 'save')}
          </Button>
          <Menu
            open={menuOpen}
            align="end"
            items={[
              {
                id: 'rename',
                // 二进制条目禁止重命名：二进制没有可编辑的文本内容，编辑器里也没有它的字节；
                // 重命名是文件系统内的移动，必须由后端按字节搬运（`renameFile`）。
                label: t('skillFile', 'renameCurrent'),
                disabled: selected === null,
              },
              { type: 'separator', id: 'separator' },
              // 二进制重命名与「至少保留一个文件」按原型用提示说明原因（skill-file.js:386/442），
              // 而不是留下一个没有任何解释的禁用项。
              { id: 'delete', label: t('skillFile', 'deleteCurrent'), danger: true, disabled: selected === null },
            ]}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') {
                if (binarySelected) {
                  toast.show(t('skillFile', 'binaryRenameBlocked'), 'error')
                  return
                }
                setRenamePath(selected ?? '')
                setRenameError(null)
                setDialogError(null)
                setRenameOpen(true)
              }
              if (id === 'delete') {
                if (files.length <= 1) {
                  toast.show(t('skillFile', 'keepOneFile'), 'error')
                  return
                }
                setDialogError(null)
                setDeleteOpen(true)
              }
            }}
            onClose={() => { setMenuOpen(false) }}
            anchor={(
              <Button
                icon={<IconEllipsisOutlineRegular size={14} />}
                className={skillCss.iconButton}
                aria-label={t('skillFile', 'moreActions')}
                onClick={() => { setMenuOpen(!menuOpen) }}
              />
            )}
          />
        </div>
      </header>

      <NoticeLine
        tone="error"
        text={error === null
          ? null
          : error.detail === '' ? t('skillFile', error.key) : `${t('skillFile', error.key)} — ${error.detail}`}
      />
      {loading && <div className={css.empty}>{t('common', 'stateLoading')}</div>}

      {!loading && (
        <div className={skillCss.layout}>
          <aside className={skillCss.treePane} aria-label={t('skillFile', 'tree')}>
            <div className={skillCss.panelHead}>
              <h2 className={skillCss.panelTitle}>{t('skillFile', 'tree')}</h2>
              <span className={skillCss.count}>{files.length.toLocaleString(locale)}</span>
            </div>
            <div className={skillCss.tree}>
              {treeRows.length === 0 && <div className={skillCss.treeEmpty}>{t('skillFile', 'emptyTree')}</div>}
              {treeRows.map((row) => {
                const indent = `${String(TREE_INDENT_BASE + row.depth * TREE_INDENT_STEP)}px`
                if (row.kind === 'folder') {
                  // 原型 skill-file.js:166：文件夹行是静态行，全部展开、不可折叠。
                  return (
                    <div
                      key={`folder:${row.path}`}
                      className={skillCss.treeFolder}
                      style={{ paddingLeft: indent }}
                    >
                      <span className={skillCss.treeIcon} aria-hidden="true">
                        <IconFolderOpenOutlineRegular size={12} />
                      </span>
                      <span className={skillCss.treeFolderName}>{row.name}</span>
                    </div>
                  )
                }
                return (
                  <button
                    key={`file:${row.path}`}
                    type="button"
                    title={row.path}
                    className={row.path === selected ? `${skillCss.treeItem} ${skillCss.treeItemActive}` : skillCss.treeItem}
                    style={{ paddingLeft: indent }}
                    onClick={() => { requestOpenFile(row.path) }}
                  >
                    <span className={skillCss.treeIcon} aria-hidden="true">
                      {/* 原型目录树的文件图形（文档 + 折角）；原语无同名图形。 */}
                      <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 3h6l4 4v10H5V3Z" />
                        <path d="M11 3v4h4" />
                      </svg>
                    </span>
                    <span className={skillCss.treePath}>{row.name}</span>
                    {row.entry.text === null && (
                      <Tag tone="neutral" className={skillCss.treeTag}>{t('skillFile', 'binaryBadge')}</Tag>
                    )}
                  </button>
                )
              })}
            </div>
          </aside>

          <section className={skillCss.editorPane} aria-label={t('skillFile', 'editorPanelLabel')}>
            <div className={skillCss.editorToolbar}>
              {/* 手册 §三.8：长路径统一走 PathValue（等宽 + 分隔符原子片段），
                  裸 `.mono` 在窄列里会把路径整块撑破或在连字符处乱断。 */}
              {selected === null
                ? <span className={skillCss.pathPlaceholder}>{t('skillFile', 'emptyFile')}</span>
                : <PathValue value={selected} className={skillCss.pathValue} />}
              {selected !== null && (
                <span className={skillCss.saveState}>
                  <span
                    className={dirty && !binarySelected ? skillCss.saveDotDirty : skillCss.saveDot}
                    aria-hidden="true"
                  />
                  {binarySelected
                    ? t('skillFile', 'readOnly')
                    : dirty ? t('common', 'stateUnsaved') : t('common', 'stateSaved')}
                </span>
              )}
              <span className={skillCss.toolbarActions}>
                <Button
                  size="sm"
                  variant="ghost"
                  className={skillCss.iconAction}
                  icon={<Glyph><path d="M8 5 4 9l4 4" /><path d="M4 9h7a4 4 0 0 1 0 8h-2" /></Glyph>}
                  aria-label={t('skillFile', 'undo')}
                  title={t('skillFile', 'undo')}
                  disabled={edit.index <= 0}
                  onClick={undo}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className={skillCss.iconAction}
                  icon={<Glyph><path d="m12 5 4 4-4 4" /><path d="M16 9H9a4 4 0 0 0 0 8h2" /></Glyph>}
                  aria-label={t('skillFile', 'redo')}
                  title={t('skillFile', 'redo')}
                  disabled={edit.index >= edit.history.length - 1}
                  onClick={redo}
                />
              </span>
            </div>

            {selected === null && <div className={skillCss.editorEmpty}>{t('skillFile', 'emptyFile')}</div>}

            {selected !== null && binarySelected && (
              <div className={skillCss.binaryState}>
                <span className={skillCss.binaryIcon} aria-hidden="true"><IconCopyOutlineRegular size={20} /></span>
                <p className={skillCss.binaryTitle}>{t('skillFile', 'binaryFile')}</p>
                <p className={skillCss.binaryDesc}>{t('skillFile', 'binaryRenameHint')}</p>
              </div>
            )}

            {selected !== null && !binarySelected && (
              <div className={skillCss.editorBox}>
                <pre ref={gutterRef} className={skillCss.gutter} aria-hidden="true">{lineNumbers}</pre>
                <textarea
                  ref={areaRef}
                  className={skillCss.editorArea}
                  aria-label={t('skillFile', 'editorAria', { path: selected })}
                  spellCheck={false}
                  wrap="off"
                  value={edit.text}
                  onBlur={() => { if (dirty) void save(edit.text) }}
                  onChange={(event) => { applyEdit(event.currentTarget.value) }}
                  onSelect={(event) => { syncCursor(event.currentTarget) }}
                  onClick={(event) => { syncCursor(event.currentTarget) }}
                  onKeyUp={(event) => { syncCursor(event.currentTarget) }}
                  onScroll={(event) => {
                    if (gutterRef.current !== null) gutterRef.current.scrollTop = event.currentTarget.scrollTop
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab') {
                      event.preventDefault()
                      const element = event.currentTarget
                      const start = element.selectionStart
                      const end = element.selectionEnd
                      applyEdit(`${element.value.slice(0, start)}  ${element.value.slice(end)}`)
                      requestAnimationFrame(() => {
                        element.selectionStart = start + 2
                        element.selectionEnd = start + 2
                        syncCursor(element)
                      })
                      return
                    }
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                      event.preventDefault()
                      void save(edit.text)
                      return
                    }
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                      event.preventDefault()
                      if (event.shiftKey) redo()
                      else undo()
                      return
                    }
                    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
                      event.preventDefault()
                      redo()
                    }
                  }}
                />
              </div>
            )}

            <div className={skillCss.editorFoot}>
              <span>{fileInfo}</span>
              <span className={skillCss.spacer} />
              {selected !== null && (
                <span>
                  {binarySelected
                    ? '—'
                    : t('skillFile', 'cursorInfo', { line: cursor.line, column: cursor.column })}
                </span>
              )}
              {!binarySelected && <span className={skillCss.footHint}>{t('skillFile', 'autosaveHint')}</span>}
            </div>
          </section>

          <aside className={skillCss.notePane} aria-label={t('skillFile', 'note')}>
            <div className={skillCss.panelHead}>
              <h2 className={skillCss.panelTitle}>{t('skillFile', 'note')}</h2>
              <span className={skillCss.count}>
                {notesState === 'dirty'
                  ? t('common', 'stateUnsaved')
                  : notesState === 'saved' ? t('common', 'stateSaved') : t('skillFile', 'noteState')}
              </span>
            </div>
            {selected === null
              ? <div className={skillCss.noteEmpty}>{t('skillFile', 'emptyFile')}</div>
              : (
                <textarea
                  className={skillCss.noteArea}
                  aria-label={t('skillFile', 'note')}
                  value={notes[selected] ?? ''}
                  placeholder={t('skillFile', 'notePlaceholder')}
                  onBlur={() => { flushNotes() }}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setNotesState('dirty')
                    setNotes((previous) => {
                      const next = { ...previous, [selected]: value }
                      saveNotes(next)
                      return next
                    })
                  }}
                />
              )}
            <p className={skillCss.noteHint}>{t('skillFile', 'noteHint')}</p>
          </aside>
        </div>
      )}

      <Modal
        open={switchTarget !== null}
        onClose={() => { setSwitchTarget(null) }}
        title={t('skillFile', 'switchTitle')}
        closeLabel={t('common', 'actionClose')}
        description={t('skillFile', 'switchDescription')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setSwitchTarget(null) }}>{t('common', 'actionCancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const path = switchTarget
                setSwitchTarget(null)
                if (path !== null) void openFile(path)
              }}
            >
              {t('skillFile', 'switchDiscard')}
            </Button>
          </>
        )}
      >
        {switchTarget !== null && <PathValue value={switchTarget} className={css.mono} />}
      </Modal>

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
              type="submit"
              form="new-file-form"
              variant="primary"
            >
              {t('skillFile', 'createFile')}
            </Button>
          </>
        )}
      >
        <form
          id="new-file-form"
          className={css.form}
          onSubmit={(event) => { event.preventDefault(); submitNewFile() }}
          onKeyDown={submitFormOnEnter}
        >
          <NoticeLine tone="error" text={dialogError} />
          <Field label={t('skillFile', 'pathLabel')} error={newPathError}>
            <Input
              data-modal-autofocus
              aria-invalid={newPathError === null ? undefined : true}
              value={newPath}
              placeholder={t('skillFile', 'pathPlaceholder')}
              onChange={(event) => {
                setNewPath(event.currentTarget.value)
                setNewPathError(null)
              }}
            />
          </Field>
        </form>
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
              type="submit"
              form="rename-form"
              variant="primary"
              disabled={selected === null}
            >
              {t('common', 'actionRename')}
            </Button>
          </>
        )}
      >
        <form
          id="rename-form"
          className={css.form}
          onSubmit={(event) => { event.preventDefault(); submitRename() }}
          onKeyDown={submitFormOnEnter}
        >
          <NoticeLine tone="error" text={dialogError} />
          <Field label={t('skillFile', 'newPathLabel')} error={renameError}>
            <Input
              data-modal-autofocus
              aria-invalid={renameError === null ? undefined : true}
              value={renamePath}
              onChange={(event) => { setRenamePath(event.currentTarget.value); setRenameError(null) }}
            />
          </Field>
        </form>
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
              disabled={selected === null || files.length <= 1}
              onClick={() => {
                const path = selected
                if (path === null) return
                void (async () => {
                  try {
                    await request(`/skills/${skillId}/file`, { method: 'DELETE', body: { path } })
                    setDeleteOpen(false)
                    selectedRef.current = null
                    setSelected(null)
                    setEdit(EMPTY_EDIT)
                    setFileSize(0)
                    setNotesState('idle')
                    toast.show(t('skillFile', 'toastDeleted'), 'success')
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
