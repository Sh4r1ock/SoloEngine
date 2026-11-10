/**
 * The file tree's body: the session's workspace root, listed one level at a time.
 *
 * Everything the tree keeps lives in its store, keyed by tab; everything it
 * asks for goes through its injected face. The component itself only decides
 * what to draw for each absolute path and what a click means: a directory
 * toggles, a file opens through the owner's `tabActions` for a `file:` viewer
 * to claim, and anything else is shown but refuses to open.
 *
 * This package is the SoloEngine build of the native tree: besides browsing it
 * creates, renames, and removes entries through the workspace-scoped
 * `workspaceFiles` mutations, searches names under the root, and highlights the
 * entry the Session's tool presentation last pointed at.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  FileTypeIcon, IconCheckOutlineRegular, IconCloseOutlineRegular, IconEditOutlineRegular, IconFolderCloseRegular,
  IconFolderOpenRegular, IconPauseOutlineRegular, IconPlayOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconSearchOutlineRegular, IconTrashOutlineRegular, PathLabel, Tooltip,
  classifyFileType,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import type {} from '@soloengine/types'
import { childPath } from './face.ts'
import type { FilesInjected, FilesSearchMatch } from './face.ts'
import type {} from './locales.ts'
import type { FilesTabState, createFilesStore } from './store.ts'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidebar.right.tab.files.actions'>
  & PropsStore<ReturnType<typeof createFilesStore>>
  & FilesInjected
  & PropsLocale<'sidebarFiles'>

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Pause between the last keystroke and the search it triggers. */
const SEARCH_DEBOUNCE_MS = 200

/** One entry a create, rename, or delete bar is open for. */
interface PendingMutation {
  readonly kind: 'create-file' | 'create-directory' | 'rename' | 'remove'
  /** Absolute path of the entry (rename/remove) or of the parent directory (create). */
  readonly path: string
  /** The entry's name as the row shows it. */
  readonly name: string
  /** Whether a remove takes a directory with it. */
  readonly directory?: boolean
}

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * Say why a directory could not be listed, in terms of the directory.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the directory.
 */
export function failureLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/outside-workspace': return t('error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('error.notDirectory')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}

/**
 * Say why a create, rename, or remove could not be performed.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show above the tree.
 */
export function mutationLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/already-exists': return t('error.exists')
    case 'workspace-file/stale-version': return t('error.stale')
    case 'workspace-file/parent-missing': return t('error.parentMissing')
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/symlink-refused': return t('error.symlink')
    case 'workspace-file/denied': return t('error.forbidden')
    case 'workspace-file/too-large': return t('error.tooLarge')
    default: return t('error.unavailable', { message: failure.message })
  }
}

/** What every level shares: the tab's tree and the row gestures. */
interface TreeContext {
  readonly state: FilesTabState
  readonly onToggle: (parent: string, path: string) => void
  readonly onOpen: (path: string) => void
  readonly onPending: (mutation: PendingMutation) => void
  readonly isCurrent: (path: string) => boolean
  readonly t: TranslateNS<'sidebarFiles'>
}

/** One entry's row, and its children when it is an expanded directory. */
function Entry({ parent, entry, tree }: { parent: string; entry: WorkspaceDirectoryEntry; tree: TreeContext }): ReactNode {
  const path = childPath(parent, entry.name)
  const current = tree.isCurrent(path)
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <li className={css.item} data-files-entry="directory" data-files-path={path} data-files-current={current || undefined}>
        <div className={current ? clsx(css.row, css.rowCurrent) : css.row}>
          <button type="button" className={css.gesture} aria-expanded={expanded} onClick={() => { tree.onToggle(parent, path) }}>
            {expanded ? <IconFolderOpenRegular className={css.icon} /> : <IconFolderCloseRegular className={css.icon} />}
            <span className={css.name}>{entry.name}</span>
          </button>
          <RowActions path={path} name={entry.name} type="directory" tree={tree} />
        </div>
        {expanded && <ul className={css.level}><Level path={path} tree={tree} /></ul>}
      </li>
    )
  }
  if (entry.type === 'file') {
    return (
      <li className={css.item} data-files-entry="file" data-files-path={path} data-files-current={current || undefined}>
        <div className={current ? clsx(css.row, css.rowCurrent) : css.row}>
          <button type="button" className={css.gesture} onClick={() => { tree.onOpen(path) }}>
            <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.fileIcon} />
            <span className={css.name}>{entry.name}</span>
          </button>
          <RowActions path={path} name={entry.name} type="file" tree={tree} />
        </div>
      </li>
    )
  }
  return (
    <li className={css.item} data-files-entry="other" data-files-path={path}>
      <span className={clsx(css.row, css.other)} aria-disabled="true" title={tree.t('entry.other')}>
        <span className={css.name}>{entry.name}</span>
      </span>
    </li>
  )
}

/** The rename and delete gestures of one row. */
function RowActions({ path, name, type, tree }: {
  path: string
  name: string
  type: 'file' | 'directory'
  tree: TreeContext
}): ReactNode {
  return (
    <span className={css.rowActions}>
      <button
        type="button"
        className={css.rowAction}
        aria-label={tree.t('action.rename', { name })}
        title={tree.t('action.rename', { name })}
        data-files-rename
        onClick={() => { tree.onPending({ kind: 'rename', path, name }) }}
      >
        <IconEditOutlineRegular className={css.actionIcon} />
      </button>
      <button
        type="button"
        className={css.rowAction}
        aria-label={tree.t('action.delete', { name })}
        title={tree.t('action.delete', { name })}
        data-files-delete
        onClick={() => { tree.onPending({ kind: 'remove', path, name, directory: type === 'directory' }) }}
      >
        <IconTrashOutlineRegular className={css.actionIcon} />
      </button>
    </span>
  )
}

/** One directory's rows: its state while listing, its entries once listed. */
function Level({ path, tree }: { path: string; tree: TreeContext }): ReactNode {
  const { state, t } = tree
  const level = state.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <li className={css.note} data-files-row="loading">{t('loading')}</li>
  }
  if (level.kind === 'failed') {
    return (
      <li className={css.note} data-files-row="failed" data-files-code={level.failure.code}>
        {failureLine(t, level.failure)}
      </li>
    )
  }
  const entries = orderEntries(level.level.entries)
  return (
    <>
      {level.failure !== undefined && <li className={css.note} data-files-row="failed">{failureLine(t, level.failure)}</li>}
      {entries.length === 0 && <li className={css.note} data-files-row="empty">{t('empty')}</li>}
      {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} tree={tree} />)}
      {level.level.truncated && <li className={css.note} data-files-row="truncated">{t('truncated')}</li>}
    </>
  )
}

/** The file tree's body: the workspace root and whatever the reader has opened under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions, useProjection,
  start, refresh, setAutoRefresh, toggle, search, write, createDirectory, move, remove, t, renderSlot,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  useEffect(() => tab.actions.bindCommands({ refresh: () => { refresh(tab.id) } }), [tab.actions, tab.id, refresh])
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  const intent = useProjection('soloengine.followIntent')
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [matches, setMatches] = useState<readonly FilesSearchMatch[] | null>(null)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const [pending, setPending] = useState<PendingMutation | null>(null)
  const [pendingDirectory, setPendingDirectory] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const searchGeneration = useRef(0)
  // Come back where the reader was: loaded levels outlive the body in the
  // store, so a remounted tree lays out at its full height before this runs
  // and the stored offset re-lands exactly. A fresh tree stores 0.
  const seeded = state !== undefined
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (seeded && body !== null) {
      body.scrollTop = state.scrollTop
      scrollTopRef.current = body.scrollTop
    }
  }, [seeded])
  // Scrolling only moves the ref; the store hears about it once, on unmount,
  // so a scroll neither re-renders the tree nor writes after the owner's
  // abort has forgotten the bucket.
  useEffect(() => () => {
    if (seeded && !signal.aborted) actions.scrolled(tab.id, scrollTopRef.current)
  }, [seeded, signal, tab.id, actions])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])

  /** The entry the Session's last tool presentation named, as a `/`-joined path. */
  const pointedPath = useMemo(() => {
    if (intent === undefined || intent === null) return null
    const location = intent.locations[0]
    return location === undefined ? null : location.path.replace(/\\/gu, '/')
  }, [intent])

  /** Whether one absolute row path is the pointed entry (or inside it). */
  const isCurrent = useCallback((absolute: string): boolean => {
    if (pointedPath === null) return false
    const normalized = absolute.replace(/\\/gu, '/')
    return normalized === pointedPath || normalized.endsWith(`/${pointedPath}`)
  }, [pointedPath])

  const root = state?.root

  /** Ask the face for names under the root; only the latest query may publish. */
  const runSearch = useCallback(async (value: string): Promise<void> => {
    const generation = searchGeneration.current + 1
    searchGeneration.current = generation
    if (value.trim() === '' || root === undefined) {
      setMatches(null)
      setSearchTruncated(false)
      setSearching(false)
      return
    }
    setSearching(true)
    setFailure(null)
    try {
      const outcome = await search(root, value, signal)
      if (generation !== searchGeneration.current) return
      setMatches(outcome.entries)
      setSearchTruncated(outcome.truncated)
    } catch (error) {
      if (generation !== searchGeneration.current) return
      setFailure(error instanceof Error && error.message !== '' ? error.message : t('error.network'))
      setMatches([])
    } finally {
      if (generation === searchGeneration.current) setSearching(false)
    }
  }, [root, search, signal, t])

  // Debounce keystrokes: one search per settled query, and the pending one is
  // dropped when the tab record ends.
  useEffect(() => {
    const timer = setTimeout(() => { void runSearch(query) }, SEARCH_DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [query, runSearch])

  /** Leave the result list and expand one directory's ancestors down to it. */
  const reveal = useCallback((path: string): void => {
    if (root === undefined || state === undefined) return
    const ancestors: string[] = []
    let cursor = path
    while (cursor !== root && cursor.includes('/')) {
      ancestors.unshift(cursor)
      cursor = cursor.slice(0, cursor.lastIndexOf('/'))
    }
    searchGeneration.current += 1
    setQuery('')
    setSearchOpen(false)
    setMatches(null)
    const expanded = new Set(state.expanded)
    let parent = root
    for (const ancestor of ancestors) {
      if (!expanded.has(ancestor)) {
        toggle(tab.id, parent, ancestor, [...expanded], signal)
        expanded.add(ancestor)
      }
      parent = ancestor
    }
  }, [root, state, tab.id, toggle, signal])

  const openMutation = useCallback((mutation: PendingMutation | null): void => {
    setPending(mutation)
    setPendingDirectory(mutation?.directory === true)
    setFailure(null)
    setNameDraft(mutation === null || mutation.kind === 'remove' ? '' : mutation.name)
  }, [])

  /** Perform the pending mutation, then reread the levels it could have changed. */
  const perform = useCallback(async (): Promise<void> => {
    if (pending === null || busy) return
    const name = nameDraft.trim()
    if (pending.kind !== 'remove' && name === '') return
    setBusy(true)
    setFailure(null)
    const target = pending.kind === 'rename'
      ? childPath(pending.path.slice(0, Math.max(0, pending.path.lastIndexOf('/'))), name)
      : pending.kind === 'remove'
        ? pending.path
        : childPath(pending.path, name)
    try {
      const result = pending.kind === 'create-file'
        ? await write(target, '', { createOnly: true }, signal)
        : pending.kind === 'create-directory'
          ? await createDirectory(target, signal)
          : pending.kind === 'rename'
            ? await move(pending.path, target, signal)
            : await remove(pending.path, signal)
      if (!result.ok) {
        setFailure(mutationLine(t, result.error))
        return
      }
      setPending(null)
      refresh(tab.id)
      if (query.trim() !== '') void runSearch(query)
    } catch (error) {
      setFailure(error instanceof Error && error.message !== '' ? error.message : t('error.network'))
    } finally {
      setBusy(false)
    }
  }, [pending, busy, nameDraft, write, createDirectory, move, remove, signal, t, refresh, tab.id, query, runSearch])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null
  const tree: TreeContext = {
    state,
    onToggle: (parent, path) => { toggle(tab.id, parent, path, state.expanded, signal) },
    // Every row is under the tree's root, so its address is session-relative.
    onOpen: (path) => { tabActions.openResource(fileAddressFor(sessionId, state.root, path)) },
    onPending: openMutation,
    isCurrent,
    t,
  }
  const reload = (): void => {
    refresh(tab.id)
    if (query.trim() !== '') void runSearch(query)
  }
  const target = pending === null
    ? ''
    : pending.kind === 'rename'
      ? childPath(pending.path.slice(0, Math.max(0, pending.path.lastIndexOf('/'))), nameDraft.trim())
      : pending.kind === 'remove'
        ? pending.path
        : childPath(pending.path, nameDraft.trim())
  return (
    <div className={css.root} data-files-state="tree" data-files-root={state.root}>
      <div className={css.header}>
        <PathLabel path={state.root} className={css.path} data-files-path />
        <span hidden>
          <button type="button" className={css.tool} aria-label={t('autoRefresh')}
            aria-pressed={state.autoRefresh} data-files-auto-refresh
            title={t(state.autoRefresh ? 'autoRefresh.disable' : 'autoRefresh.enable')}
            onClick={() => { setAutoRefresh(tab.id, !state.autoRefresh) }}>
            {state.autoRefresh ? <IconPauseOutlineRegular /> : <IconPlayOutlineRegular />}
          </button>
        </span>
        <Tooltip label={t('search.open')} side="bottom" delayMs={500}>
          <button type="button" className={css.tool} aria-label={t('search.open')} aria-pressed={searchOpen}
            data-files-search-open onClick={() => { setSearchOpen(!searchOpen) }}>
            <IconSearchOutlineRegular />
          </button>
        </Tooltip>
        <Tooltip label={t('new.file')} side="bottom" delayMs={500}>
          <button type="button" className={css.tool} aria-label={t('new.file')} data-files-new-file
            onClick={() => { openMutation({ kind: 'create-file', path: state.root, name: '' }) }}>
            <IconPlusOutlineRegular />
          </button>
        </Tooltip>
        <Tooltip label={t('new.directory')} side="bottom" delayMs={500}>
          <button type="button" className={css.tool} aria-label={t('new.directory')} data-files-new-directory
            onClick={() => { openMutation({ kind: 'create-directory', path: state.root, name: '' }) }}>
            <IconFolderCloseRegular />
          </button>
        </Tooltip>
        <Tooltip label={t('reload')} shortcutKeys={tab.refreshShortcut?.keys} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('reload')}
            aria-keyshortcuts={tab.refreshShortcut?.aria}
            data-files-reload
            onClick={reload}
          >
            <IconRefreshOutlineRegular />
          </button>
        </Tooltip>
        {renderSlot('sidebar.right.tab.files.actions', {
          absolutePath: state.root,
        })}
      </div>
      {searchOpen ? (
        <div className={css.searchRow}>
          <input
            className={css.searchInput}
            type="search"
            value={query}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            data-files-search-input
            onChange={(event) => { setQuery(event.target.value) }}
          />
          <button type="button" className={css.tool} aria-label={t('search.close')}
            onClick={() => { setQuery(''); setSearchOpen(false) }}>
            <IconCloseOutlineRegular />
          </button>
        </div>
      ) : null}
      {pending === null ? null : (
        <div className={css.confirm} data-files-pending={pending.kind} role="alert">
          <span className={css.confirmText}>
            {pending.kind === 'create-file'
              ? t('confirm.createFile', { path: target })
              : pending.kind === 'create-directory'
                ? t('confirm.createDirectory', { path: target })
                : pending.kind === 'rename'
                  ? t('confirm.rename', { name: pending.name, to: target })
                  : pendingDirectory
                    ? t('confirm.removeDirectory', { name: pending.name })
                    : t('confirm.removeFile', { name: pending.name })}
          </span>
          {pending.kind === 'remove' ? null : (
            <input
              className={css.searchInput}
              value={nameDraft}
              placeholder={t('name.placeholder')}
              aria-label={t('name.placeholder')}
              data-files-name
              onChange={(event) => { setNameDraft(event.target.value) }}
            />
          )}
          <span className={css.confirmActions}>
            <button type="button" className={css.tool} aria-label={t('confirm.cancel')}
              onClick={() => { openMutation(null) }}>
              <IconCloseOutlineRegular />
            </button>
            <button type="button" className={css.tool} aria-label={t('confirm.ok')}
              disabled={busy || (pending.kind === 'remove' ? false : nameDraft.trim() === '')}
              data-files-confirm
              onClick={() => { void perform() }}>
              <IconCheckOutlineRegular />
            </button>
          </span>
        </div>
      )}
      {failure === null ? null : <div className={css.failure} role="alert" data-files-failure>{failure}</div>}
      <div
        ref={bodyRef}
        className={css.body}
        data-files-body
        onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
      >
        {matches === null
          ? <ul className={css.level}><Level path={state.root} tree={tree} /></ul>
          : (
            <ul className={css.level}>
              {searching ? <li className={css.note} data-files-row="searching">{t('loading')}</li> : null}
              {!searching && matches.length === 0 ? <li className={css.note} data-files-row="search-empty">{t('search.empty')}</li> : null}
              {matches.map(match => (
                <li key={match.path} className={css.item} data-files-search-result={match.path}>
                  <button
                    type="button"
                    className={css.row}
                    title={match.path}
                    onClick={() => {
                      if (match.type === 'directory') reveal(match.path)
                      else tree.onOpen(match.path)
                    }}
                  >
                    {match.type === 'directory'
                      ? <IconFolderCloseRegular className={css.icon} />
                      : <FileTypeIcon kind={classifyFileType(match.name)} size={16} className={css.fileIcon} />}
                    <span className={css.name}>{match.path.slice(state.root.length).replace(/^[/\\]+/u, '')}</span>
                  </button>
                </li>
              ))}
              {searchTruncated ? <li className={css.note} data-files-row="search-truncated">{t('search.truncated')}</li> : null}
            </ul>
          )}
      </div>
    </div>
  )
}
