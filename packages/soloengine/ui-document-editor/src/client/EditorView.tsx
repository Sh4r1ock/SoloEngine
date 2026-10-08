/**
 * 编辑器（PRD-08 FR-OPS-006 / FR-OPS-007）。
 *
 * 文本 / 代码 / Markdown 走本编辑器：查看 + **编辑**（官方 documentpreview 是只读预览，
 * 「预览而非编辑」是官方明示限制，编辑能力是本插件补的增量）；保存写回项目目录，
 * 经操作区桥 `/soloengine/workspace/file`（沙箱根 realpath + 前缀 + loopback + mtime 冲突）。
 *
 * 变更装饰：与变更面板、消息区汇总条**同一事实源**——台账表 `file_changes`（经操作区桥
 * `/soloengine/changes` 读取）。行级标记由台账记录的 hunk 区间派生；`soloengine.followIntent`
 * 只作为「刚发生过一次工具调用」的重读信号，不作为装饰数据源。本视图不自算差异。
 *
 * @module @soloengine/ui-document-editor/EditorView
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import styles from './EditorView.module.css'
import type { SoloengineEditorKey } from './locales.ts'

/** 操作区桥前缀。 */
const BRIDGE = '/soloengine/workspace'

/** 编辑器 props（文档面板 owner + session 作用域标准座位 + 本地化）。 */
export type EditorViewProps =
  PropsRuntime<'sidebar.right.tab.document'>
  & PropsLocale<'soloengineEditor'>

/** 桥错误码 → 本面板文案键（只列编辑器和解译器在这块面板上真能触达的码）。 */
const REASON_KEYS: Record<string, SoloengineEditorKey> = {
  PATH_EXISTS: 'editor.errorExists',
  FILE_NOT_FOUND: 'editor.errorNotFound',
  PARENT_MISSING: 'editor.errorParentMissing',
  WRITE_TOO_LARGE: 'editor.errorTooLarge',
  OUT_OF_SANDBOX_ROOT: 'editor.errorForbidden',
  LOOPBACK_ONLY: 'editor.errorForbidden',
  UNTRUSTED: 'editor.errorForbidden',
  PROJECT_MISSING: 'editor.errorNoProject',
  SANDBOX_ROOT_MISSING: 'editor.errorNoProject',
  SANDBOX_ROOT_REQUIRED: 'editor.errorNoProject',
}

/**
 * 保存/读取失败句子：已知码给本地化原因，未知码回落服务端诊断，诊断也空则通用句。
 * 机器码（`HTTP_409`、`WRITE_TOO_LARGE`）与面向开发者的英文诊断句都不进用户可见层。
 */
function failureMessage(code: string, message: string, status: number, t: EditorViewProps['t']): string {
  if (status === 409) return t('editor.conflict')
  const key = REASON_KEYS[code]
  if (key !== undefined) return t(key)
  return message === '' ? t('editor.errorUnknown') : message
}

/**
 * 渲染可编辑文本视图。
 * @param props - 文档 owner 座位、session 作用域标准座位与本地化座位。
 * @returns 编辑器。
 */
export function EditorView({ resourceAddress, content, wrap, sessionId, useProjection, t }: EditorViewProps) {
  const address = parseFileAddress(resourceAddress)
  const path = address?.scope === 'session' ? address.path : undefined
  const loaded = content.kind === 'text' ? content.text : ''
  /**
   * 平台给文档渲染器的 `text` 是**截至当前的分页前缀**（`eof` 才表示读全）。
   * 保存是整文件写回（`PUT /file` 覆盖全文），前缀未读全时保存会把文件截断——
   * 故未 `eof` 一律禁保存并说明原因，而不是让用户以为存了。
   */
  const complete = content.kind !== 'text' || content.eof
  const [text, setText] = useState(loaded)
  /**
   * 「已保存基线」：初始是平台读到的内容，保存成功后是当前缓冲。
   * 只用 `loaded` 比对的错误在于保存后平台并不会重读资源，`loaded` 仍是旧内容——
   * 于是刚写盘成功的一刻界面还挂着「有未保存的改动」，而成功提示永远不出现。
   */
  const [savedText, setSavedText] = useState(loaded)
  const [mtimeMs, setMtimeMs] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const intent = useProjection('soloengine.followIntent')

  useEffect(() => { setText(loaded); setSavedText(loaded) }, [loaded])

  // 取当前 mtime 作为乐观锁版本（保存时回传，冲突由 Host 判定）。cancelledRef 防文件切换后旧响应覆盖。
  useEffect(() => {
    if (path === undefined) return
    const cancelledRef = { current: false }
    void (async () => {
      try {
        const response = await fetch(`${BRIDGE}/stat?sessionKey=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
        const body = await response.json() as { ok?: boolean; stat?: { mtimeMs?: number | null } }
        if (!cancelledRef.current && body.ok === true) setMtimeMs(body.stat?.mtimeMs ?? null)
      } catch {
        // stat 失败不阻断编辑：保存时以缺省 mtime 走（Host 仍会做沙箱根与存在性校验）。
      }
    })()
    return () => { cancelledRef.current = true }
  }, [path, sessionId])

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
      const response = await fetch(`${BRIDGE}/file`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: sessionId,
          path,
          text,
          ...mtimeMs === null ? {} : { expectedMtimeMs: mtimeMs },
        }),
        credentials: 'same-origin',
      })
      const body = await response.json() as { ok?: boolean; result?: { mtimeMs?: number }; error?: { code?: string; message?: string } }
      if (response.status === 409 || body.ok !== true) {
        setStatus(response.status === 409 ? 'conflict' : 'error')
        setMessage(failureMessage(body.error?.code ?? '', body.error?.message ?? '', response.status, t))
        return
      }
      setMtimeMs(body.result?.mtimeMs ?? null)
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
  }, [path, complete, sessionId, text, mtimeMs, t])

  const lines = text.split('\n')
  const gutterRef = useRef<HTMLDivElement>(null)
  /** 行号沟与 textarea 滚动同步（gutter 自身 overflow:hidden，scrollTop 可编程设置）。 */
  const syncGutter = useCallback((event: React.UIEvent<HTMLTextAreaElement>): void => {
    const gutter = gutterRef.current
    if (gutter !== null) gutter.scrollTop = event.currentTarget.scrollTop
  }, [])
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.path}>{path ?? resourceAddress}</span>
        {text !== savedText ? <span className={styles.dirty}>{t('editor.dirty')}</span> : null}
        <Button
          size="sm"
          variant="outline"
          disabled={status === 'saving' || path === undefined || !complete}
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
        {wrap ? null : (
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
          data-wrap={String(wrap)}
          aria-label={path === undefined ? t('editor.textAriaReadonly') : t('editor.textAria', { path })}
          readOnly={path === undefined}
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
