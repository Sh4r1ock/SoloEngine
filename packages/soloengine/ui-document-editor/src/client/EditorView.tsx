/**
 * 编辑器（PRD-08 FR-OPS-006 / FR-OPS-007）。
 *
 * **查看**仍归官方 `ui-sidebar-documentpreview`（文本 / Office / Excel 各按官方渲染器）；
 * 本包只补「编辑」这一个原生没有的新增能力，并以**独立的 tab 类型**（kind
 * `soloengine-editor`，不认领任何地址模式）经官方文档动作座位显式打开——
 * 普通打开文件仍落到官方只读预览，编辑不会被自动接管。
 *
 * 正文经原生 `workspaceFiles.read` 分页读全，保存经 `workspaceFiles.write` 整文件写回
 * （工作区限定 + 版本乐观锁），前端不拼路径、不做磁盘判定。
 *
 * 变更装饰：与变更面板、消息区汇总条**同一事实源**——台账表 `file_changes`（经操作区桥
 * `/soloengine/changes` 读取）。行级标记由台账记录的 hunk 区间派生；`soloengine.followIntent`
 * 只作为「刚发生过一次工具调用」的重读信号，不作为装饰数据源。本视图不自算差异。
 *
 * @module @soloengine/ui-document-editor/EditorView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import styles from './EditorView.module.css'
import type { SoloengineEditorKey } from './locales.ts'
import type { EditorWorkspace } from './workspace.ts'

/** 编辑器 props（tab 记录座位 + 本地化 + 原生读写面）。 */
export type EditorViewProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'soloengineEditor'>
  & EditorWorkspace

/** 最多读多少页：再长就按「未读全」处理，保存禁用而不是静默截断。 */
const MAX_PAGES = 10

/** 写回失败码 → 本面板文案键（只列编辑器在这块面板上真能触达的码）。 */
const REASON_KEYS: Record<string, SoloengineEditorKey> = {
  'workspace-file/already-exists': 'editor.errorExists',
  'workspace-file/stale-version': 'editor.conflict',
  'workspace-file/not-found': 'editor.errorNotFound',
  'workspace-file/parent-missing': 'editor.errorParentMissing',
  'workspace-file/too-large': 'editor.errorTooLarge',
  'workspace-file/denied': 'editor.errorForbidden',
  'workspace-file/outside-workspace': 'editor.errorForbidden',
  'workspace-file/symlink-refused': 'editor.errorForbidden',
  'workspace-file/not-text': 'editor.errorNotText',
  'gateway/lookup-not-found': 'editor.errorNoProject',
}

/**
 * 失败句子：已知码给本地化原因，未知码回落服务端诊断，诊断也空则通用句。
 * 机器码与服务端英文诊断都不进用户可见层。
 */
function failureMessage(failure: RemoteFailure, t: EditorViewProps['t']): string {
  const key = REASON_KEYS[failure.code]
  if (key !== undefined) return t(key)
  return failure.message === '' ? t('editor.errorUnknown') : failure.message
}

/** 一次读全的结果。 */
type Loaded =
  | { readonly kind: 'ready'; readonly text: string; readonly version: string; readonly complete: boolean }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }

/**
 * 分页读全一个文本文件。
 * @param read - 原生行窗口读取。
 * @param sessionId - 所属会话。
 * @param path - 会话工作区内的路径。
 * @returns 全文与版本；超过页上限时 `complete` 为 false。
 */
async function readAll(
  read: EditorWorkspace['read'],
  sessionId: EditorViewProps['sessionId'],
  path: string,
): Promise<Loaded> {
  const parts: string[] = []
  let offset = 1
  let version = ''
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await read(sessionId, path, offset)
    if (!result.ok) return { kind: 'failed', failure: result.error }
    version = result.value.version
    if (result.value.lines > 0) parts.push(result.value.text)
    if (result.value.eof) return { kind: 'ready', text: parts.join('\n'), version, complete: true }
    offset += result.value.lines
  }
  return { kind: 'ready', text: parts.join('\n'), version, complete: false }
}

/**
 * 渲染可编辑文本视图。
 * @param props - tab 记录座位、本地化座位与原生读写面。
 * @returns 编辑器。
 */
export function EditorView({ useTabInfo, sessionId, useProjection, stat, read, readBytes, write, t }: EditorViewProps) {
  const { tab } = useTabInfo()
  const address = parseFileAddress(tab.navigation.address)
  const path = address?.scope === 'session' ? address.path : undefined
  const [text, setText] = useState('')
  /** 「已保存基线」：读到的内容，保存成功后是当前缓冲。 */
  const [savedText, setSavedText] = useState('')
  /** 读到内容时的原生化版本（保存时作为乐观锁回传，冲突由 Host 判定）。 */
  const [version, setVersion] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  /** 分页是否读全；未读全时整文件写回会把文件截断，故禁用保存。 */
  const [complete, setComplete] = useState(true)
  /** 原文件以换行结尾：行窗口契约不携带该事实，保存时补回（否则「未修改也产生 diff」）。 */
  const [trailingNewline, setTrailingNewline] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const intent = useProjection('soloengine.followIntent')
  const generation = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    if (path === undefined) return
    const current = generation.current + 1
    generation.current = current
    setStatus('idle')
    setMessage(null)
    try {
      const result = await readAll(read, sessionId, path)
      if (current !== generation.current) return
      if (result.kind === 'failed') {
        setLoaded(false)
        setMessage(failureMessage(result.failure, t))
        return
      }
      setText(result.text)
      setSavedText(result.text)
      setVersion(result.version)
      setComplete(result.complete)
      // 行窗口把末尾换行当作「终止最后一行的终止符」丢掉；用最后一个字节补回这一事实。
      let endsWithNewline = false
      if (result.complete) {
        const info = await stat(sessionId, path)
        const bytes = info.ok ? info.value.bytes ?? 0 : 0
        if (bytes > 0) {
          const last = await readBytes(sessionId, path, bytes - 1, 1)
          if (last.ok && last.value.data.length > 0) endsWithNewline = last.value.data[0] === 0x0a
        }
      }
      if (current !== generation.current) return
      setTrailingNewline(endsWithNewline)
      setLoaded(true)
    } catch (failure) {
      if (current !== generation.current) return
      setLoaded(false)
      setMessage(failure instanceof TypeError
        ? t('editor.errorNetwork')
        : failure instanceof Error && failure.message !== '' ? failure.message : t('editor.errorUnknown'))
    }
  }, [path, read, readBytes, sessionId, stat, t])

  useEffect(() => { void load() }, [load])

  /** agent 改过的行（变更装饰的同一事实源：台账 `file_changes` 的 hunk 区间）。 */
  const [decoratedLines, setDecoratedLines] = useState<ReadonlySet<number>>(new Set<number>())

  useEffect(() => {
    if (path === undefined) return undefined
    const cancelledRef = { current: false }
    void (async () => {
      try {
        const response = await fetch(`/soloengine/changes?sessionKey=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' })
        const body = await response.json() as {
          ok?: boolean
          changes?: { filePath: string; operation: string; hunks: { header?: string }[] | null }[]
        }
        if (!body.ok) return
        const lines = new Set<number>()
        for (const row of body.changes ?? []) {
          if (row.operation === 'deleted') continue
          const absolute = row.filePath.replace(/\\/gu, '/')
          const relative = path.replace(/\\/gu, '/')
          // 台账记的是绝对路径，本页是会话相对路径：必须带分隔符边界比，否则
          // `my-src/app.tsx` 会被 `src/app.tsx` 的 endsWith 误命中，把别的文件的行号标到本文件上。
          if (absolute !== relative && !absolute.endsWith(`/${relative}`)) continue
          for (const hunk of row.hunks ?? []) {
            const match = (hunk.header ?? '').match(/\+(\d+)(?:,(\d+))?/u)
            if (match?.[1] === undefined) continue
            const start = Number(match[1])
            const count = match[2] === undefined ? 1 : Number(match[2])
            for (let offset = 0; offset < Math.max(1, count); offset += 1) lines.add(start + offset)
          }
        }
        if (!cancelledRef.current) setDecoratedLines(lines)
      } catch {
        // 读取失败保留既有装饰（台账是唯一事实源，失败时变更面板会呈现完整错误）。
      }
    })()
    return () => { cancelledRef.current = true }
  }, [path, sessionId, intent])

  const savingRef = useRef(false)
  const save = useCallback(async (): Promise<void> => {
    if (path === undefined || !complete || savingRef.current) return
    savingRef.current = true
    setStatus('saving')
    try {
      const content = trailingNewline ? `${text}\n` : text
      const result = await write(sessionId, path, content, version ?? undefined)
      if (!result.ok) {
        setStatus(result.error.code === 'workspace-file/stale-version' ? 'conflict' : 'error')
        setMessage(failureMessage(result.error, t))
        return
      }
      setVersion(result.value.version)
      setSavedText(text)
      setStatus('saved')
      setMessage(null)
    } catch (failure) {
      setStatus('error')
      setMessage(failure instanceof TypeError
        ? t('editor.errorNetwork')
        : failure instanceof Error && failure.message !== '' ? failure.message : t('editor.errorUnknown'))
    } finally {
      savingRef.current = false
    }
  }, [path, complete, sessionId, text, trailingNewline, version, write, t])

  const lines = text.split('\n')
  const gutterRef = useRef<HTMLDivElement>(null)
  /** 行号沟与 textarea 滚动同步（gutter 自身 overflow:hidden，scrollTop 可编程设置）。 */
  const syncGutter = useCallback((event: React.UIEvent<HTMLTextAreaElement>): void => {
    const gutter = gutterRef.current
    if (gutter !== null) gutter.scrollTop = event.currentTarget.scrollTop
  }, [])
  const readonly = path === undefined || !loaded
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.path}>{path ?? tab.navigation.address}</span>
        {text !== savedText ? <span className={styles.dirty}>{t('editor.dirty')}</span> : null}
        <Button size="sm" variant="ghost" onClick={() => { void load() }} disabled={readonly}>
          {t('editor.reload')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={status === 'saving' || readonly || !complete}
          title={path === undefined ? t('editor.outsideWorkspace') : complete ? undefined : t('editor.incomplete')}
          onClick={() => { void save() }}
        >
          {status === 'saving' ? t('editor.saving') : t('editor.save')}
        </Button>
      </div>
      {path === undefined ? <div className={styles.note}>{t('editor.outsideWorkspace')}</div> : null}
      {path !== undefined && !complete ? <div className={styles.note}>{t('editor.incomplete')}</div> : null}
      {status === 'saved' && text === savedText ? <div className={styles.ok}>{t('editor.saved')}</div> : null}
      {message !== null ? <div className={styles.error} role="alert">{`${t('editor.error')} — ${message}`}</div> : null}
      <div className={styles.split}>
        {/* 行号沟只在**不换行**时给出：`.gutterLine` 的高度由行号本身决定（一行高），而软换行会把
           一条逻辑行撑成多个视觉行，实测两侧 top 完全不动（沟 116/137/158/179 恒定），行号与
           「本行被改过」标记会一起指错行。错号比无号更坏，故换行档直接收起本列（它是 aria-hidden
           的装饰列，改动信息在变更面板里仍是权威来源）。 */}
        {readonly ? null : (
          <div ref={gutterRef} className={styles.gutter} aria-hidden="true">
            {lines.map((_line, index) => (
              <div key={index} className={decoratedLines.has(index + 1) ? `${styles.gutterLine} ${styles.gutterChanged}` : styles.gutterLine}>
                {index + 1}
              </div>
            ))}
          </div>
        )}
        <textarea
          className={styles.editor}
          data-wrap="false"
          aria-label={path === undefined ? t('editor.textAriaReadonly') : t('editor.textAria', { path })}
          readOnly={readonly}
          value={text}
          spellCheck={false}
          onChange={(event) => { setText(event.target.value); setStatus('idle') }}
          onScroll={syncGutter}
        />
      </div>
      {decoratedLines.size === 0 ? null : <div className={styles.decorationNote}>{t('editor.decoration')}</div>}
    </div>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineEditorKey }
