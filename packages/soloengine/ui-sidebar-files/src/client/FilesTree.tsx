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
    throw new PanelFailure(error?.code ?? `HTTP_${String(response.status)}`, error?.message ?? '')
  }
  return body
}

/**
 * 面板侧的结构化失败（操作区桥与平台远程读共用）：机器码留在 `code` 供本地化分支，
 * `message` 是服务端诊断原文（英文，仅在无本地化映射时兜底）。
 *
 * 此前两侧都把码拼进 message 直出（「文件操作失败: HTTP_409: …」），违 R8。
 */
export class PanelFailure extends Error {
  /** 机器可读错误码。 */
  readonly code: string

  /**
   * @param code - 机器可读码。
   * @param message - 服务端诊断原文（可为空）。
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PanelFailure'
    this.code = code
  }
}

/** 错误码 → 本面板文案键（只列用户在文件树里真能触达的码：桥侧 + 平台远程读侧）。 */
const REASON_KEYS: Record<string, SoloengineFilesKey> = {
  MTIME_CONFLICT: 'files.errorConflict',
  PATH_EXISTS: 'files.errorExists',
  PARENT_MISSING: 'files.errorParentMissing',
  FILE_NOT_FOUND: 'files.errorNotFound',
  NOT_A_DIRECTORY: 'files.errorNotDirectory',
  IS_A_DIRECTORY: 'files.errorNotDirectory',
  OUT_OF_SANDBOX_ROOT: 'files.errorForbidden',
  LOOPBACK_ONLY: 'files.errorForbidden',
  UNTRUSTED: 'files.errorForbidden',
  WRITE_TOO_LARGE: 'files.errorTooLarge',
  'workspace-file/not-found': 'files.errorNotFound',
  'workspace-file/not-directory': 'files.errorNotDirectory',
  'workspace-file/not-regular-file': 'files.errorNotDirectory',
  'workspace-file/outside-workspace': 'files.errorForbidden',
  'workspace-file/too-large': 'files.errorTooLarge',
  SESSION_KEY_REQUIRED: 'files.noRoot',
  SESSION_NOT_IN_LEDGER: 'files.noRoot',
  PROJECT_REQUIRED: 'files.noRoot',
  PROJECT_NOT_FOUND: 'files.noRoot',
  PROJECT_MISSING: 'files.noRoot',
  SANDBOX_ROOT_REQUIRED: 'files.noRoot',
  SANDBOX_ROOT_MISSING: 'files.noRoot',
}

/** 失败原因句子：网络层失败给本地化句子，已知码给本地化原因，未知码回落服务端诊断。 */
function failureText(failure: unknown, t: FilesTreeProps['t']): string {
  if (failure instanceof TypeError) return t('files.errorNetwork')
  if (failure instanceof PanelFailure) {
    const key = REASON_KEYS[failure.code]
    if (key !== undefined) return t(key)
    return failure.message === '' ? t('files.errorUnknown') : failure.message
  }
  if (failure instanceof Error && failure.message !== '') return failure.message
  return t('files.errorUnknown')
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
  /** 每层目录的条目与「是否被上限截断」（截断必须可见，不能静默少列）。 */
  const [children, setChildren] = useState<Map<string, { entries: readonly WorkspaceDirectoryEntry[]; truncated: boolean }>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ items: { name: string; path: string; kind: 'file' | 'directory' }[]; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<WriteAction | null>(null)
  /** 已加载目录的键集：变更流按它刷新。用 ref 而非 state——缓存内容变化不该重建订阅。 */
  const loadedKeys = useRef<Set<string>>(new Set())

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
      loadedKeys.current.add(absolute)
      setChildren((current) => {
        const next = new Map(current)
        next.set(absolute, { entries: listing.entries, truncated: listing.truncated })
        return next
      })
      setError(null)
    } catch (failure) {
      setError(failureText(failure, t))
    }
  }, [list, root, t])

  // 首屏：加载工作区根（懒加载起点，不整树拉取）。键与渲染入口同为工作区根的绝对路径。
  // 换了根（会话改绑工作目录）必须先清空上一层根的缓存，否则变更流会去刷新新沙箱根外的路径。
  useEffect(() => {
    const cancelledRef = { current: false }
    setLoading(true)
    setChildren(new Map())
    loadedKeys.current = new Set()
    void (async () => {
      await loadDirectory(root === '' ? '' : root)
      if (!cancelledRef.current) setLoading(false)
    })()
    return () => { cancelledRef.current = true }
  }, [loadDirectory, root])

  // 变更联动刷新：订阅平台工作区写入变更流，任一变更即刷新已加载目录（防抖）。
  // 订阅只随 `changes`/`loadDirectory` 变化重建；已加载键集走 ref，避免每次加载都换一条流。
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      try {
        for await (const frame of changes(controller.signal)) {
          if (frame.kind !== 'change') continue
          if (timer !== undefined) clearTimeout(timer)
          timer = setTimeout(() => {
            for (const path of loadedKeys.current) void loadDirectory(path)
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
  }, [changes, loadDirectory])

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
    setExpanded((current) => {
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

  /**
   * 定位到搜索结果里的目录：退出搜索、逐级展开祖先，并补上尚未缓存的层级。
   * 搜索侧的条目路径是**相对沙箱根**的（Host 的 search 即此词表），先换算成树的绝对键。
   */
  const revealDirectory = useCallback(async (relativePath: string): Promise<void> => {
    const absolute = root === '' ? relativePath : `${root}/${relativePath}`
    const ancestors: string[] = []
    let cursor = absolute
    while (cursor !== root && cursor.includes('/')) {
      ancestors.unshift(cursor)
      cursor = cursor.slice(0, cursor.lastIndexOf('/'))
    }
    setQuery('')
    setResults(null)
    setExpanded((current) => {
      const next = new Set(current)
      for (const path of ancestors) next.add(path)
      return next
    })
    for (const path of ancestors) {
      if (!children.has(path)) await loadDirectory(path)
    }
  }, [children, loadDirectory, root])

  /** 搜索（Host 侧递归，跳过 .git/node_modules）。水位线保证最新查询胜出：逐字符输入时旧响应一律丢弃。 */
  const searchSeq = useRef(0)
  const runSearch = useCallback(async (value: string): Promise<void> => {
    const seq = searchSeq.current + 1
    searchSeq.current = seq
    if (value.trim() === '') { setResults(null); return }
    try {
      const body = await call(`/search?sessionKey=${key}&q=${encodeURIComponent(value)}`)
      if (seq !== searchSeq.current) return
      setResults({
        items: (body.entries ?? []) as { name: string; path: string; kind: 'file' | 'directory' }[],
        truncated: body.truncated === true,
      })
      // 成功即收回上一次的失败提示：否则「无法连接本地服务」会挂在已经出结果的搜索下方。
      setError(null)
    } catch (failure) {
      if (seq !== searchSeq.current) return
      setError(failureText(failure, t))
    }
  }, [key, t])

  /** 执行一次写操作（双确认 + mtime 冲突检测全部在 Host 侧判定）。 */
  const runWrite = useCallback(async (action: WriteAction): Promise<void> => {
    try {
      if (action.kind === 'create-file' || action.kind === 'create-folder') {
        const target = action.directory === '' ? action.name : `${action.directory}/${action.name}`
        if (action.kind === 'create-file') {
          await call('/file', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionKey: sessionId, path: target, text: '', createOnly: true }),
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
      for (const path of loadedKeys.current) await loadDirectory(path)
      if (query.trim() !== '') await runSearch(query)
    } catch (failure) {
      setError(failureText(failure, t))
    } finally {
      setPending(null)
    }
  }, [sessionId, loadDirectory, query, runSearch, t])

  /**
   * 手动重读已加载的层级。
   *
   * 平台变更流只播报**平台自己观测到的**写入（instrumented filesystem operation），
   * 用户在同一工作区里用别的编辑器改的文件不会推帧过来，故必须留一条显式重读入口。
   */
  const refresh = useCallback(async (): Promise<void> => {
    for (const path of loadedKeys.current) await loadDirectory(path)
    if (query.trim() !== '') await runSearch(query)
  }, [loadDirectory, query, runSearch])

  const renderLevel = useCallback((path: string, depth: number): ReactNode => {
    const level = children.get(path)
    if (level === undefined) return <div className={styles.state}>{t('files.loading')}</div>
    if (level.entries.length === 0) return <div className={styles.state}>{t('files.empty')}</div>
    return (
      <>
        {level.entries.map((entry) => {
          const childPath = path === '' ? entry.name : `${path}/${entry.name}`
          const isDirectory = entry.type === 'directory'
          const current = isCurrent(childPath)
          const label = relativizeToCwd(childPath, root)
          return (
            <div key={childPath}>
              {/* 缩进按层级步进：步长与左基线都取间距令牌，不写死像素 */}
              <div
                className={current ? `${styles.row} ${styles.rowCurrent}` : styles.row}
                style={{ paddingLeft: `calc(var(--se-space-1) + ${String(depth)} * var(--se-space-3))` }}
              >
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
        })}
        {level.truncated ? <div className={styles.state}>{t('files.list.truncated')}</div> : null}
      </>
    )
  }, [children, isCurrent, expanded, openFile, root, t, toggle])

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
        <Button size="sm" variant="ghost" onClick={() => { void refresh() }}>{t('files.refresh')}</Button>
      </div>
      {error !== null ? <div className={styles.error} role="alert">{`${t('files.error')} — ${error}`}</div> : null}
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
            ? (results.items.length === 0
              ? <div className={styles.state}>{t('files.search.empty')}</div>
              : (
                <>
                  {results.items.map(entry => (
                    <div key={entry.path} className={styles.row}>
                      <span className={styles.disclosure}>{entry.kind === 'directory' ? '▸' : '·'}</span>
                      {entry.kind === 'directory'
                        ? (
                          <button type="button" className={styles.label} title={entry.path} onClick={() => { void revealDirectory(entry.path) }}>
                            {entry.path}
                          </button>
                        )
                        : (
                          <button type="button" className={styles.label} title={entry.path} onClick={() => { openFile(entry.path) }}>
                            {entry.path}
                          </button>
                        )}
                    </div>
                  ))}
                  {results.truncated ? <div className={styles.state}>{t('files.search.truncated')}</div> : null}
                </>
              ))
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
  // 确认条常驻挂载（取消才卸载）：换一个目标点重命名时必须重置输入框，否则残留上一次的名称。
  useEffect(() => {
    setName(action.kind === 'rename' ? action.from.split('/').pop() ?? '' : '')
  }, [action])
  const isCreate = action.kind === 'create-file' || action.kind === 'create-folder'
  const barRef = useRef<HTMLDivElement>(null)
  // 焦点交给确认条：`autoFocus` 属性在这条路径上无效（点击工具栏按钮后挂载，实测焦点仍留在
  // 触发按钮），故下一帧显式聚焦首要控件——有输入框就聚焦输入框，没有则聚焦「取消」
  // （删除这类破坏性动作，默认焦点落在安全一侧）。
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const bar = barRef.current
      if (bar === null) return
      const target = bar.querySelector('input') ?? bar.querySelector('button')
      target?.focus()
    })
    return () => { cancelAnimationFrame(frame) }
  }, [action])
  const parent = action.kind === 'rename' && action.from.includes('/')
    ? action.from.slice(0, action.from.lastIndexOf('/'))
    : ''
  const renamedTo = parent === '' ? name : `${parent}/${name}`
  const message = action.kind === 'delete'
    ? t('files.confirm.delete', { path: action.path })
    : action.kind === 'rename'
      ? t('files.confirm.rename', { from: action.from, to: renamedTo })
      : t('files.confirm.create', { path: action.directory === '' ? name : `${action.directory}/${name}` })
  return (
    <div className={styles.confirm} aria-live="polite" ref={barRef}>
      <div className={styles.confirmText}>{message}</div>
      {isCreate || action.kind === 'rename' ? (
        <Input
          value={name}
          placeholder={t('files.name.prompt')}
          onChange={(event) => { setName(event.target.value) }}
        />
      ) : null}
      <div className={styles.confirmActions}>
        <Button size="sm" variant="ghost" aria-label={t('files.confirm.cancel')} onClick={onCancel}>✕</Button>
        <Button
          size="sm"
          variant="outline"
          aria-label={t('files.confirm.confirm')}
          disabled={isCreate || action.kind === 'rename' ? name.trim() === '' : false}
          onClick={() => {
            if (action.kind === 'delete') { onConfirm(action); return }
            if (action.kind === 'rename') {
              onConfirm({ kind: 'rename', from: action.from, to: renamedTo })
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
