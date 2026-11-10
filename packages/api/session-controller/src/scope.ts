/**
 * The account scope of the Connection carrier, read from one Remote call.
 *
 * Session readers (list, search, live control) and the model catalog narrow to
 * the browser account bound to the calling connection. The scope's Session and
 * model-route facts live in the mounting product (`ctx.connection`), so this
 * module only reads that service's read-only view; a deployment without it
 * keeps the native behavior.
 *
 * @module @deepseek-ai/dsh-api-session-controller/scope
 */

import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

/** Read-only members of `ctx.connection` this controller consumes. */
type ConnectionAccountScopeView = Pick<
  HostConnectionHandle,
  'ownedSessionIdsOf' | 'authorizeSessionIds' | 'ownedModelRouteNamesOf'
>

/** Account scope facts of one Remote call. */
export interface SessionScope {
  /** Session identities the account owns; undefined when the deployment binds no account scope. */
  readonly owned: ReadonlySet<string> | undefined
  /** Model route names the account may use; undefined when the deployment binds no account scope. */
  readonly modelRoutes: ReadonlySet<string> | undefined
  /**
   * Whether one Session belongs to the account.
   * @param sessionId - Session identity to test.
   * @returns true only when the account owns it; false without an account scope.
   */
  owns(sessionId: string): Promise<boolean>
}

const NO_SCOPE: SessionScope = Object.freeze({
  owned: undefined,
  modelRoutes: undefined,
  owns: () => Promise.resolve(false),
})

/**
 * Read the calling connection's account scope.
 * @param ctx - the Context the Remote method reads, carrying `invocation` and `connection`.
 * @returns the scope facts; every member is undefined outside a bound account.
 */
export async function sessionScopeOf(ctx: Context): Promise<SessionScope> {
  const peer = ctx.invocation?.peer
  const connection: ConnectionAccountScopeView | undefined = ctx.get('connection')
  if (peer === undefined || connection === undefined
    || typeof connection.ownedSessionIdsOf !== 'function') return NO_SCOPE
  const [sessionIds, modelRoutes] = await Promise.all([
    connection.ownedSessionIdsOf(peer),
    connection.ownedModelRouteNamesOf(peer),
  ])
  const owned = sessionIds === undefined ? undefined : new Set(sessionIds)
  return {
    owned,
    modelRoutes: modelRoutes === undefined ? undefined : new Set(modelRoutes),
    owns: async (sessionId: string) => {
      // New Sessions appear after the opening snapshot, so membership that the
      // snapshot lacks still asks the product once.
      if (owned !== undefined && owned.has(sessionId)) return true
      return (await connection.authorizeSessionIds(peer, [sessionId])) === true
    },
  }
}
