/**
 * 编辑型文件树（PRD-08 FR-OPS-010 / FR-OPS-012；PRD-10 FR-SEC-009）。
 *
 * 以同名 kind `files` 的 **extension 档**接管官方只读文件树（官方档位契约：一个 kind 至多
 * 一个 builtin 与一个 extension，extension 生效；卸载即恢复原生只读档）。
 *
 * 读写分治：
 * - **读**复用平台工作区文件能力（`remote.workspaceFiles.list` 懒加载 + `changes` 变更流）；
 * - **人写入**走产品自己的接口（操作区桥 `/soloengine/workspace/*`，沙箱根 realpath + 前缀 +
 *   loopback + 双确认 + mtime 冲突），前端**不拼接路径段**做安全判定。
 *
 * 「当前文件高亮」消费宿主权威投影 `soloengine.followIntent`（工具呈现意图的定位）。
 *
 * @module @soloengine/ui-sidebar-files/FilesTree
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceDirectoryEntry, WorkspaceFileWatchFrame } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor, relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import styles from './FilesTree.module.css'
import type { SoloengineFilesKey } from './locales.ts'

/** 操作区桥前缀（Host 侧）。 */
const BRIDGE = '/soloengine/workspace'

/** 注入面：远程命名空间（懒加载列举 + 变更流）。 */
export interface FilesFace {
  /** 列举一层目录。 */
  list: (path: string, signal: AbortSignal) => Promise<{ path: string; entries: readonly WorkspaceDirectoryEntry[]; truncated: boolean }>
  /** 订阅本会话的工作区写入变更流。 */
  changes: (signal: AbortSignal) => AsyncIterable<WorkspaceFileWatchFrame>
}

/** 面板体 props。 */
export type FilesTreeProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'soloengineFiles'>
  & FilesFace

/** 一次写操作的类型。 */
type WriteAction =
  | { kind: 'create-file'; directory: string; name: string }
  | { kind: 'create-folder'; directory: string; name: string }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'delete'; path: string }

/** 统一请求。 */
async function call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${BRIDGE}${path}`, { credentials: 'same-origin', ...init })
  const body = await response.json() as Record<string, unknown>
  if (!response.ok || body.ok !== true) {
    const error = body.error as { code?: string; message?: string } | undefined
    throw new Error(`${error?.code ?? `HTTP ${String(response.status)}`}: ${error?.message ?? 'unknown failure'}`)
  }
  return body
}

/**
 * 渲染编辑型文件树。
 * @param props - tab 记录座位、session 作用域标准座位、注入面与本地化座位。
 * @returns 面板体。
 */
export function FilesTree({ useTabInfo, sessionId, useSessions, useProjection, list, changes, t }: FilesTreeProps) {
  const { tab } = useTabInfo()
  const cwd = useSessions(snapshot => snapshot.byId[sessionId]?.cwd)
  const intent = useProjection('soloengine.followIntent')
  const [children, setChildren] = useState<Map<string, readonly WorkspaceDirectoryEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ name: string; path: string; kind: 'file' | 'directory' }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<WriteAction | null>(null)
  const revision = useRef(0)

  const key = encodeURIComponent(sessionId)
  /** 工作区根的**绝对路径**（平台工作区文件能力以绝对路径为层级键，与官方树同法）。 */
  const root = cwd === undefined ? '' : cwd.replace(/\\/gu, '/').replace(/\/+$/u, '')

  /** 读取一层目录并写入缓存（键与渲染入口同为**绝对路径**；根即工作区根）。 */
  const loadDirectory = useCallback(async (path: string): Promise<void> => {
    if (root === '') {
      setError(t('files.noRoot'))
      setLoading(false)
      return
    }
    const absolute = path === '' ? root : path
    const controller = new AbortController()
    try {
      const listing = await list(absolute, controller.signal)
      setChildren(current => {
        const next = new Map(current)
        next.set(absolute, listing.entries)
        return next
      })
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [list, root, t])

  // 首屏：加载工作区根（懒加载起点，不整树拉取）。键与渲染入口同为工作区根的绝对路径。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      await loadDirectory(root === '' ? '' : root)
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [loadDirectory, root])

  // 变更联动刷新：订阅平台工作区写入变更流，任一变更即刷新已加载目录（防抖）。
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      try {
        for await (const frame of changes(controller.signal)) {
          if (frame.kind !== 'change') continue
          if (timer !== undefined) clearTimeout(timer)
          timer = setTimeout(() => {
            const loaded = [...children.keys()]
            for (const path of loaded) void loadDirectory(path)
          }, 250)
        }
      } catch {
        // 流结束（会话关闭或 Host 关闭）：树保留最后已知内容，不伪造状态。
      }
    })()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      controller.abort()
    }
  }, [changes, children, loadDirectory])

  const currentPath = useMemo(() => {
    if (intent === undefined || intent === null) return null
    const location = intent.locations[0]
    return location === undefined ? null : location.path.replace(/\\/gu, '/')
  }, [intent])

  /** 节点是否agent 最近定位到（当前文件高亮：绝对路径后缀匹配相对定位）。 */
  const isCurrent = useCallback((absolute: string): boolean => {
    if (currentPath === null) return false
    const normalized = absolute.replace(/\\/gu, '/')
    return normalized === currentPath || normalized.endsWith(`/${currentPath}`)
  }, [currentPath])

  const toggle = useCallback((absolute: string): void => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(absolute)) next.delete(absolute)
      else {
        next.add(absolute)
        if (!children.has(absolute)) void loadDirectory(absolute)
      }
      return next
    })
  }, [children, loadDirectory])

  const openFile = useCallback((absolute: string): void => {
    tab.actions.openResource(fileAddressFor(sessionId, cwd, absolute))
  }, [tab, sessionId, cwd])

  /** 搜索（Host 侧递归，跳过 .git/node_modules）。 */
  const runSearch = useCallback(async (value: string): Promise<void> => {
    if (value.trim() === '') { setResults(null); return }
    try {
      const body = await call(`/search?sessionKey=${key}&q=${encodeURIComponent(value)}`)
      setResults((body.entries ?? []) as { name: string; path: string; kind: 'file' | 'directory' }[])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [key])

  /** 执行一次写操作（双确认 + mtime 冲突检测全部在 Host 侧判定）。 */
  const runWrite = useCallback(async (action: WriteAction): Promise<void> => {
    try {
      if (action.kind === 'create-file' || action.kind === 'create-folder') {
        const target = action.directory === '' ? action.name : `${action.directory}/${action.name}`
        if (action.kind === 'create-file') {
          await call('/file', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionKey: sessionId, path: target, text: '' }),
          })
        } else {
          await call('/directory', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionKey: sessionId, path: target, confirm: true }),
          })
        }
      } else if (action.kind === 'rename') {
        await call('/rename', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionKey: sessionId, from: action.from, to: action.to, confirm: true }),
        })
      } else {
        await call('/entry', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionKey: sessionId, path: action.path, confirm: true }),
        })
      }
      setError(null)
      revision.current += 1
      const loaded = [...children.keys()]
      for (const path of loaded) await loadDirectory(path)
      if (query.trim() !== '') await runSearch(query)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPending(null)
    }
  }, [sessionId, children, loadDirectory, query, runSearch])

  const renderLevel = useCallback((path: string, depth: number): ReactNode => {
    const entries = children.get(path)
    if (entries === undefined) return <div className={styles.state}>{t('files.loading')}</div>
    if (entries.length === 0) return <div className={styles.state}>{t('files.empty')}</div>
    return entries.map(entry => {
      const childPath = path === '' ? entry.name : `${path}/${entry.name}`
      const isDirectory = entry.type === 'directory'
      const current = isCurrent(childPath)
      const label = relativizeToCwd(childPath, root)
      return (
        <div key={childPath}>
          <div className={current ? `${styles.row} ${styles.rowCurrent}` : styles.row} style={{ paddingLeft: `${String(depth * 12 + 4)}px` }}>
            <button
              type="button"
              className={styles.disclosure}
              aria-label={expanded.has(childPath) ? t('files.collapse') : t('files.expand')}
              disabled={!isDirectory}
              onClick={() => { toggle(childPath) }}
            >
              {isDirectory ? (expanded.has(childPath) ? '▾' : '▸') : '·'}
            </button>
            <button
              type="button"
              className={styles.label}
              title={label}
              aria-current={current ? 'true' : undefined}
              onClick={() => { if (isDirectory) toggle(childPath); else openFile(childPath) }}
            >
              {entry.name}
            </button>
            <button
              type="button"
              className={styles.action}
              aria-label={t('files.rename')}
              onClick={() => { setPending({ kind: 'rename', from: label, to: label }) }}
            >
              ✎
            </button>
            <button
              type="button"
              className={styles.action}
              aria-label={t('files.delete')}
              onClick={() => { setPending({ kind: 'delete', path: label }) }}
            >
              ✕
            </button>
          </div>
          {isDirectory && expanded.has(childPath) ? renderLevel(childPath, depth + 1) : null}
        </div>
      )
    })
  }, [children, cwd, isCurrent, expanded, openFile, root, t, toggle])

  return (
    <div className={styles.root}>
      <div className={styles.searchRow}>
        <Input
          value={query}
          placeholder={t('files.search.placeholder')}
          onChange={(event) => {
            setQuery(event.target.value)
            void runSearch(event.target.value)
          }}
        />
        {query === '' ? null : (
          <Button size="sm" variant="ghost" onClick={() => { setQuery(''); setResults(null) }}>{t('files.search.clear')}</Button>
        )}
      </div>
      <div className={styles.actions}>
        <Button size="sm" variant="ghost" onClick={() => { setPending({ kind: 'create-file', directory: '', name: '' }) }}>{t('files.new.file')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setPending({ kind: 'create-folder', directory: '', name: '' }) }}>{t('files.new.folder')}</Button>
      </div>
      {error !== null ? <div className={styles.error} role="alert">{`${t('files.error')}: ${error}`}</div> : null}
      {pending !== null ? (
        <WriteConfirm
          action={pending}
          t={t}
          onCancel={() => { setPending(null) }}
          onConfirm={(resolved) => { void runWrite(resolved) }}
        />
      ) : null}
      <div className={styles.tree}>
        {loading
          ? <div className={styles.state}>{t('files.loading')}</div>
          : results !== null
            ? (results.length === 0
                ? <div className={styles.state}>{t('files.search.empty')}</div>
                : results.map(entry => (
                  <div key={entry.path} className={styles.row}>
                    <span className={styles.disclosure}>{entry.kind === 'directory' ? '▸' : '·'}</span>
                    <button type="button" className={styles.label} title={entry.path} onClick={() => { if (entry.kind === 'file') openFile(entry.path) }}>
                      {entry.path}
                    </button>
                  </div>
                )))
            : renderLevel(root, 0)}
      </div>
    </div>
  )
}

/** 写操作的双确认条（删除/重命名/新建一律先确认）。 */
function WriteConfirm({ action, t, onCancel, onConfirm }: {
  action: WriteAction
  t: (key: SoloengineFilesKey, params?: Record<string, string>) => string
  onCancel: () => void
  onConfirm: (action: WriteAction) => void
}): ReactNode {
  const [name, setName] = useState(action.kind === 'rename' ? action.from.split('/').pop() ?? '' : '')
  const isCreate = action.kind === 'create-file' || action.kind === 'create-folder'
  const message = action.kind === 'delete'
    ? t('files.confirm.delete').replace('{path}', action.path)
    : action.kind === 'rename'
      ? t('files.confirm.rename').replace('{from}', action.from).replace('{to}', action.to)
      : t('files.confirm.create').replace('{path}', action.directory === '' ? name : `${action.directory}/${name}`)
  return (
    <div className={styles.confirm} role="dialog" aria-label={message}>
      <div className={styles.confirmText}>{message}</div>
      {isCreate || action.kind === 'rename' ? (
        <Input
          value={name}
          placeholder={t('files.name.prompt')}
          onChange={(event) => { setName(event.target.value) }}
        />
      ) : null}
      <div className={styles.confirmActions}>
        <Button size="sm" variant="ghost" onClick={onCancel}>✕</Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (action.kind === 'delete') { onConfirm(action); return }
            if (action.kind === 'rename') {
              const parent = action.from.includes('/') ? action.from.slice(0, action.from.lastIndexOf('/')) : ''
              onConfirm({ kind: 'rename', from: action.from, to: parent === '' ? name : `${parent}/${name}` })
              return
            }
            onConfirm({ ...action, name })
          }}
        >
          ✓
        </Button>
      </div>
    </div>
  )
}

/** 本组件使用的字典键（供类型收窄）。 */
export type { SoloengineFilesKey }
