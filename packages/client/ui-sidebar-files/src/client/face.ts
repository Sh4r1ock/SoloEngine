/**
 * The tree's asynchronous half: listing directories into the store.
 *
 * The component never awaits anything. It calls `start` / `refresh` / `toggle`, and
 * this face performs the listing and writes the outcome through the store's own
 * actions — the Slot-standard `inject` shape, so the session id is resolved by
 * the framework and the write set stays the store's.
 *
 * The listing itself is bound here to the Client Remote face: the tree keys
 * every level by absolute path and hands the endpoint that same absolute path;
 * the endpoint answers with the directory's workspace-relative path as well,
 * which the tree has no use for and drops.
 *
 * One level has one listing in force: asking for a level again — the reload
 * gesture, a directory reopened after a reset — retires the listing still in
 * flight for it, whose settlement then writes nothing. Cleanup rides the owner's
 * `signal`: a request is not made for a record that already ended, and when the
 * record goes away the bucket and the tab's listing bookkeeping are forgotten,
 * so no later settlement writes to it.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DirLevel, createFilesStore } from './store.ts'
import type {
  WorkspaceFileStat, WorkspaceFileWatchFrame, WorkspaceFileWriteOptions, WorkspaceMutationResult,
} from '@deepseek-ai/dsh-api-workspace-files/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { DirectoryNode } from './directory-node.ts'

/**
 * Observe one directory without recursively watching its descendants.
 * @param sessionId - Session owning the directory tree.
 * @param path - absolute directory path.
 * @param signal - node lifetime.
 * @returns readiness and invalidation notifications.
 */
export type WatchWorkspaceDirectory = (sessionId: SessionId, path: string, signal: AbortSignal) => AsyncIterable<'ready' | 'change'>

/**
 * Bind directory observation to the Remote stream supervisor.
 * @param remote - Client Remote with workspace file streams.
 * @returns a watcher that awaits stream disposal when its node ends.
 */
export function createWatch(remote: ClientRemote): WatchWorkspaceDirectory {
  return async function* (sessionId, path, signal) {
    const aborted = (): boolean => signal.aborted
    if (aborted()) return
    const stream = remote.$stream<WorkspaceFileWatchFrame>({
      name: `directory ${path}`,
      open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime),
      ended: () => new Error(`Directory watch ended: ${path}`),
    })
    const abort = (): void => { void stream.dispose() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      for await (const item of stream) {
        if (aborted()) return
        if (item.value.kind === 'ready') item.accept()
        yield item.value.kind
      }
    } finally {
      signal.removeEventListener('abort', abort)
      await stream.dispose()
    }
  }
}

/**
 * One directory listing, bound to a Remote face.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different directories in different sessions.
 * A Remote call does not reject — the result carries the failure.
 */
export type ListWorkspaceDirectory = (
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
) => Promise<RemoteResult<DirLevel>>

/**
 * The slice of the Client Remote face this package calls: the `workspaceFiles`
 * namespace's `list`, exactly as the Host's generated client declares it.
 */
export type WorkspaceFilesListRemote = {
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'list'>
}

/**
 * Bind the listing to one Remote face, keeping only what the tree stores.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @returns the listing the tree's face performs.
 */
export function createList(remote: WorkspaceFilesListRemote): ListWorkspaceDirectory {
  return async (sessionId, path, signal) => {
    const result = await remote.workspaceFiles.list(sessionId, path, signal)
    if (!result.ok) return result
    return { ok: true, value: { entries: result.value.entries, truncated: result.value.truncated } }
  }
}

/**
 * The absolute path of one child entry.
 *
 * Joined with `/` whatever the parent's separators: the Host resolves mixed
 * separators, and the tree only needs a stable key.
 * @param parent - absolute path of the listed directory.
 * @param name - the entry's basename.
 * @returns the child's absolute path.
 */
export function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/** One name-search match, as an absolute path under the workspace root. */
export interface FilesSearchMatch {
  /** Basename of the match. */
  readonly name: string
  /** Absolute path of the match. */
  readonly path: string
  /** What the match is; only a directory expands the tree instead of opening a file. */
  readonly type: 'file' | 'directory'
}

/** One name search's settled outcome. */
export interface FilesSearchOutcome {
  /** Matches in natural path order. */
  readonly entries: readonly FilesSearchMatch[]
  /** Whether a visit or result cap cut the walk short. */
  readonly truncated: boolean
}

/** Directories a name search does not descend into: build output and dependency trees. */
const SEARCH_SKIP = new Set(['.git', 'node_modules', '.cache', '.next', '__pycache__', 'dist', 'build', 'target', 'coverage'])

/** Largest number of directories one name search visits. */
const SEARCH_MAX_DIRECTORIES = 400

/** Largest number of entries one name search returns. */
const SEARCH_MAX_RESULTS = 500

/** Directory listings one search round asks for at once. */
const SEARCH_CONCURRENCY = 8

/**
 * Search entry names under one workspace root, breadth first.
 *
 * A failed listing is skipped rather than failing the search: one unreadable
 * directory must not hide the matches found elsewhere. The walk is bounded by
 * a directory-visit cap as well as a result cap, so a workspace with a large
 * dependency tree cannot keep it running indefinitely.
 */
export type SearchWorkspace = (
  sessionId: SessionId,
  root: string,
  query: string,
  signal: AbortSignal,
) => Promise<FilesSearchOutcome>

/**
 * Bind the name search to one directory listing.
 * @param list - the bound `workspaceFiles.list` call.
 * @returns the search the tree's face performs.
 */
export function createSearch(list: ListWorkspaceDirectory): SearchWorkspace {
  return async (sessionId, root, query, signal) => {
    const needle = query.trim().toLowerCase()
    const found: FilesSearchMatch[] = []
    if (needle === '') return { entries: found, truncated: false }
    let visited = 0
    let truncated = false
    const queue: string[] = [root]
    while (queue.length > 0 && !truncated && !signal.aborted) {
      const batch = queue.splice(0, SEARCH_CONCURRENCY)
      if (visited + batch.length > SEARCH_MAX_DIRECTORIES) {
        truncated = true
        break
      }
      visited += batch.length
      const settled = await Promise.all(batch.map(async path => ({ path, result: await list(sessionId, path, signal) })))
      for (const listed of settled) {
        if (!listed.result.ok) continue
        for (const entry of listed.result.value.entries) {
          const path = childPath(listed.path, entry.name)
          if (entry.name.toLowerCase().includes(needle)) {
            if (found.length >= SEARCH_MAX_RESULTS) {
              truncated = true
              break
            }
            found.push({ name: entry.name, path, type: entry.type === 'directory' ? 'directory' : 'file' })
          }
          if (entry.type === 'directory' && !SEARCH_SKIP.has(entry.name)) queue.push(path)
        }
      }
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    found.sort((left, right) => collator.compare(left.path, right.path))
    return { entries: found, truncated }
  }
}

/**
 * The `workspaceFiles` namespace methods the tree's human mutations call.
 * They are workspace-scoped on the Host, so the tree never resolves a path
 * itself; it names one and reports the failure the Host settled.
 */
export type WorkspaceFilesMutationRemote = {
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'write' | 'mkdir' | 'rename' | 'removeEntry'>
}

/** The mutations the body performs, bound to one Remote face and Session. */
export interface FilesMutations {
  /** Create or replace one file; `createOnly` refuses an existing target. @param signal - the tab record's lifetime. */
  readonly write: (
    path: string,
    text: string,
    options: WorkspaceFileWriteOptions,
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileStat>>
  /** Create one directory. @param signal - the tab record's lifetime. */
  readonly createDirectory: (path: string, signal: AbortSignal) => Promise<RemoteResult<WorkspaceMutationResult>>
  /** Move one entry to a destination that must not exist. @param signal - the tab record's lifetime. */
  readonly move: (from: string, to: string, signal: AbortSignal) => Promise<RemoteResult<WorkspaceMutationResult>>
  /** Remove one entry; a directory takes its contents. @param signal - the tab record's lifetime. */
  readonly remove: (path: string, signal: AbortSignal) => Promise<RemoteResult<WorkspaceMutationResult>>
}

/**
 * Bind the tree's mutations to one Session and Remote face.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @param sessionId - the Session whose workspace the mutations act on.
 * @returns the mutations the body receives through `inject`.
 */
export function createMutations(remote: WorkspaceFilesMutationRemote, sessionId: SessionId): FilesMutations {
  return {
    write: (path, text, options, signal) => remote.workspaceFiles.write(sessionId, path, text, options, signal),
    createDirectory: (path, signal) => remote.workspaceFiles.mkdir(sessionId, path, signal),
    move: (from, to, signal) => remote.workspaceFiles.rename(sessionId, from, to, signal),
    remove: (path, signal) => remote.workspaceFiles.removeEntry(sessionId, path, signal),
  }
}

/** The tree's injected business face, as the body receives it. */
export interface FilesInjected extends FilesMutations {
  /**
   * Search entry names under the workspace root.
   * @param root - absolute path of the workspace root the tab draws.
   * @param query - the reader's search text.
   * @param signal - the tab record's lifetime.
   */
  readonly search: (root: string, query: string, signal: AbortSignal) => Promise<FilesSearchOutcome>
  /** Refresh the open directory tree. @param tabId - owning tab. */
  readonly refresh: (tabId: TabId) => void
  /** Control automatic rereads without closing watches. @param tabId - owning tab. @param enabled - automatic-refresh setting. */
  readonly setAutoRefresh: (tabId: TabId, enabled: boolean) => void
  /**
   * Seed this tab's tree and list its root.
   * @param tabId - the tab being drawn.
   * @param root - absolute path of the workspace root.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, root: string, signal: AbortSignal) => void
  /**
   * List one directory into the store.
   * @param tabId - the tab being drawn.
   * @param path - absolute directory path.
   * @param signal - the tab record's lifetime.
   */
  readonly load: (tabId: TabId, path: string, signal: AbortSignal) => void
  /**
   * Open or collapse one directory, retaining intent during ancestor restoration.
   * @param tabId - the tab being drawn.
   * @param parentPath - the listed parent directory's exact tree key.
   * @param path - absolute directory path.
   * @param expanded - current expansion preferences, including descendants to restore.
   * @param signal - the tab record's lifetime.
   */
  readonly toggle: (tabId: TabId, parentPath: string, path: string, expanded: readonly string[], signal: AbortSignal) => void
}

/**
 * Bind the tree's face to one directory listing.
 * @param list - the bound `workspaceFiles.list` call.
 * @param watch - target-scoped directory observation.
 * @param search - the name search over the same listing.
 * @param mutations - the human mutations bound to the Session the face serves.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function filesFace(
  list: ListWorkspaceDirectory,
  watch: WatchWorkspaceDirectory,
  search: SearchWorkspace,
  mutations: (sessionId: SessionId) => FilesMutations,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createFilesStore>>) => FilesInjected {
  return (
    sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createFilesStore>>,
  ): FilesInjected => {
    /** Per tab, per absolute path: the listing generation a settlement must match; the latest request wins. */
    const generations = new Map<TabId, Map<string, number>>()
    const roots = new Map<TabId, DirectoryNode>()
    const nextGeneration = (tabId: TabId, path: string): number => {
      const byPath = generations.get(tabId) ?? new Map<string, number>()
      generations.set(tabId, byPath)
      const generation = (byPath.get(path) ?? 0) + 1
      byPath.set(path, generation)
      return generation
    }
    const load = async (tabId: TabId, path: string, signal: AbortSignal): Promise<DirLevel | undefined> => {
      if (signal.aborted) return
      const generation = nextGeneration(tabId, path)
      actions.loading(tabId, path)
      return list(sessionId, path, signal).then((result) => {
        // A newer listing of this level was asked for since, or the record is
        // gone and its bookkeeping with it: nothing left for this one to write.
        if (signal.aborted || generations.get(tabId)?.get(path) !== generation) return
        if (result.ok) actions.loaded(tabId, path, result.value)
        else actions.failed(tabId, path, result.error)
        return result.ok ? result.value : undefined
      })
    }
    return {
      ...mutations(sessionId),
      search: (root, query, signal) => search(sessionId, root, query, signal),
      refresh: (tabId) => { void roots.get(tabId)?.refreshTree() },
      setAutoRefresh: (tabId, enabled) => {
        actions.autoRefresh(tabId, enabled)
        roots.get(tabId)?.setAutomatic(enabled)
      },
      start(tabId, root, signal) {
        actions.start(tabId, root)
        signal.addEventListener('abort', () => {
          void roots.get(tabId)?.close()
          roots.delete(tabId)
          generations.delete(tabId)
          actions.forget(tabId)
        }, { once: true })
        roots.set(tabId, new DirectoryNode(root,
          (path, lifetime) => load(tabId, path, lifetime),
          (path, lifetime) => watch(sessionId, path, lifetime),
          (path, error) => {
            if (!signal.aborted) actions.failed(tabId, path, new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {}))
          }, signal,
        ).open())
      },
      load: (tabId, path, signal) => { void load(tabId, path, signal) },
      toggle(tabId, parentPath, path, expanded, signal) {
        if (signal.aborted) return
        const root = roots.get(tabId)
        if (root === undefined) return
        const parent = root.find(parentPath)
        if (parent === undefined && !expanded.includes(parentPath)) return
        const collapsing = expanded.includes(path)
        const next = collapsing ? expanded.filter(value => value !== path) : [...expanded, path]
        root.setExpanded(next)
        if (collapsing) void parent?.collapse(path)
        else parent?.expand(path, next)
        actions.toggled(tabId, path)
      },
    }
  }
}
