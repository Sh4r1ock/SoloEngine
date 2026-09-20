/**
 * 编辑器（PRD-08 FR-OPS-006 / FR-OPS-007）。
 *
 * 文本 / 代码 / Markdown 走本编辑器：查看 + **编辑**（官方 documentpreview 是只读预览，
 * 「预览而非编辑」是官方明示限制，编辑能力是本插件补的增量）；保存写回项目目录，
 * 经操作区桥 `/soloengine/workspace/file`（沙箱根 realpath + 前缀 + loopback + mtime 冲突）。
 *
 * 变更装饰：与变更面板、消息区汇总条**同一事实源**（台账投影 `soloengine.followIntent`
 * 的定位 + 台账行），本视图只按投影给出行级标记，不自算差异。
 *
 * @module @soloengine/ui-document-editor/EditorView
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
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

/**
 * 渲染可编辑文本视图。
 * @param props - 文档 owner 座位、session 作用域标准座位与本地化座位。
 * @returns 编辑器。
 */
export function EditorView({ resourceAddress, content, sessionId, useProjection, t }: EditorViewProps) {
  const address = parseFileAddress(resourceAddress)
  const path = address?.scope === 'session' ? address.path : undefined
  const loaded = content.kind === 'text' ? content.text : ''
  const [text, setText] = useState(loaded)
  const [mtimeMs, setMtimeMs] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const intent = useProjection('soloengine.followIntent')

  useEffect(() => { setText(loaded) }, [loaded])

  // 取当前 mtime 作为乐观锁版本（保存时回传，冲突由 Host 判定）。
  useEffect(() => {
    if (path === undefined) return
    void (async () => {
      try {
        const response = await fetch(`${BRIDGE}/stat?sessionKey=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, { credentials: 'same-origin' })
        const body = await response.json() as { ok?: boolean; stat?: { mtimeMs?: number | null } }
        if (body.ok === true) setMtimeMs(body.stat?.mtimeMs ?? null)
      } catch {
        // stat 失败不阻断编辑：保存时以缺省 mtime 走（Host 仍会做沙箱根与存在性校验）。
      }
    })()
  }, [path, sessionId])

  /** agent 改过的行（变更装饰的同一事实源：台账定位）。 */
  const decoratedLines = useMemo(() => {
    if (intent === undefined || intent === null) return new Set<number>()
    const location = intent.locations.find(candidate => path !== undefined && candidate.path.replace(/\\/gu, '/').endsWith(path))
    return new Set(location?.line === undefined ? [] : [location.line])
  }, [intent, path])

  const save = useCallback(async (): Promise<void> => {
    if (path === undefined) return
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
      if (response.status === 409) { setStatus('conflict'); setMessage(t('editor.conflict')); return }
      if (body.ok !== true) { setStatus('error'); setMessage(body.error?.message ?? `HTTP ${String(response.status)}`); return }
      setMtimeMs(body.result?.mtimeMs ?? null)
      setStatus('saved')
      setMessage(null)
    } catch (failure) {
      setStatus('error')
      setMessage(failure instanceof Error ? failure.message : String(failure))
    }
  }, [path, sessionId, text, mtimeMs, t])

  const lines = text.split('\n')
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.path}>{path ?? resourceAddress}</span>
        {text !== loaded ? <span className={styles.dirty}>{t('editor.dirty')}</span> : null}
        <Button size="sm" variant="outline" disabled={status === 'saving' || path === undefined} onClick={() => { void save() }}>
          {status === 'saving' ? t('editor.saving') : t('editor.save')}
        </Button>
      </div>
      {status === 'saved' ? <div className={styles.ok}>{t('editor.saved')}</div> : null}
      {message !== null ? <div className={styles.error} role="alert">{`${t('editor.error')}: ${message}`}</div> : null}
      <div className={styles.split}>
        <div className={styles.gutter} aria-hidden="true">
          {lines.map((_line, index) => (
            <div key={index} className={decoratedLines.has(index + 1) ? `${styles.gutterLine} ${styles.gutterChanged}` : styles.gutterLine}>
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          className={styles.editor}
          aria-label={t('editor.title')}
          value={text}
          spellCheck={false}
          onChange={(event) => { setText(event.target.value); setStatus('idle') }}
        />
      </div>
      {decoratedLines.size === 0 ? null : <div className={styles.decorationNote}>{t('editor.decoration')}</div>}
    </div>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineEditorKey }
