/**
 * Content-level recovery of the terminal a tab was attached to.
 *
 * The right Sidebar persists tab records (kind and content) but not the
 * navigation parameters an opener gave, so "which terminal this tab showed"
 * is content state its provider owns. This store keeps that mapping in the
 * browser profile: after a page reload the restored tab reattaches to the
 * still-running Host terminal instead of creating or grabbing another one.
 */

/** Storage namespace for this feature's recovery records. */
const STORAGE_KEY = 'dsh.sidebar-terminal.v1'

/** Bound on remembered tabs so a long-lived profile cannot grow this map without limit. */
const MAX_RECORDS = 200

type RecoveryRecords = Record<string, string>

function recordKey(sessionId: string, contentId: string): string {
  return `${sessionId}\u0000${contentId}`
}

function readRecords(): RecoveryRecords {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const records: RecoveryRecords = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value !== '') records[key] = value
    }
    return records
  } catch (_unavailableOrInvalid) {
    // Storage can be blocked, and a corrupt record only costs the recovery.
    return {}
  }
}

function writeRecords(records: RecoveryRecords): void {
  if (typeof localStorage === 'undefined') return
  const keys = Object.keys(records)
  const bounded: RecoveryRecords = {}
  for (const key of keys.slice(Math.max(0, keys.length - MAX_RECORDS))) {
    const value = records[key]
    if (value !== undefined) bounded[key] = value
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded)) }
  catch (_storageUnavailable) { /* The live terminal still works; only recovery is lost. */ }
}

/**
 * Remember the terminal one tab is attached to.
 * @param sessionId - Session whose layout owns the tab.
 * @param contentId - the tab record's content identity.
 * @param terminalId - the agent terminal the tab shows.
 */
export function rememberTerminal(sessionId: string, contentId: string, terminalId: string): void {
  const records = readRecords()
  const key = recordKey(sessionId, contentId)
  if (records[key] === terminalId) return
  records[key] = terminalId
  writeRecords(records)
}

/**
 * Read the terminal one tab was attached to.
 * @param sessionId - Session whose layout owns the tab.
 * @param contentId - the tab record's content identity.
 * @returns the terminal identity, or `undefined` when never recorded.
 */
export function recallTerminal(sessionId: string, contentId: string): string | undefined {
  return readRecords()[recordKey(sessionId, contentId)]
}

/**
 * Drop one tab's record when the tab closes.
 * @param sessionId - Session whose layout owned the tab.
 * @param contentId - the tab record's content identity.
 */
export function forgetTerminal(sessionId: string, contentId: string): void {
  const records = readRecords()
  const key = recordKey(sessionId, contentId)
  if (records[key] === undefined) return
  writeRecords(Object.fromEntries(Object.entries(records).filter(([name]) => name !== key)))
}
