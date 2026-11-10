/**
 * The agent terminal face the body receives, and the sidebar parameter shape it
 * reads.
 *
 * Each command is bound to the Session the tab belongs to; the Host resolves
 * that Session into the live owner, so the panel never names an owner itself.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  AgentTerminalInfo, AgentTerminalPage, AgentTerminalSendResult, AgentTerminalSpawnResult,
} from '@deepseek-ai/dsh-api-terminal-controller/types'
import type {} from '@deepseek-ai/dsh-api-terminal-controller/client'

/** Agent terminal commands bound to one Session. */
export interface AgentTerminalInjected {
  /**
   * List this Session's agent terminals.
   * @param signal - the tab record's lifetime.
   */
  readonly list: (signal: AbortSignal) => Promise<RemoteResult<readonly AgentTerminalInfo[]>>
  /**
   * Create one agent terminal owned by this Session.
   * @param request - backend type (empty selects the composition default), optional name and cwd.
   * @param signal - the tab record's lifetime.
   */
  readonly spawn: (request: { readonly type: string }, signal: AbortSignal) => Promise<RemoteResult<AgentTerminalSpawnResult>>
  /**
   * Read one scrollback page of an agent terminal.
   * @param terminalId - registry identity.
   * @param count - requested line count.
   * @param signal - the tab record's lifetime.
   */
  readonly read: (terminalId: string, count: number, signal: AbortSignal) => Promise<RemoteResult<AgentTerminalPage>>
  /**
   * Write one line into an agent terminal.
   * @param terminalId - registry identity.
   * @param text - the line to write; the Host appends Enter.
   * @param signal - the tab record's lifetime.
   */
  readonly send: (terminalId: string, text: string, signal: AbortSignal) => Promise<RemoteResult<AgentTerminalSendResult>>
  /**
   * Deliver SIGINT to an agent terminal's foreground command.
   * @param terminalId - registry identity.
   * @param signal - the tab record's lifetime.
   */
  readonly interrupt: (terminalId: string, signal: AbortSignal) => Promise<RemoteResult<boolean>>
  /**
   * Read the bounded output this Session already persisted for one terminal
   * through its tool results; empty when the loaded history holds none.
   * @param terminalId - registry identity the output belongs to.
   */
  readonly persisted: (terminalId: string) => string
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** An existing agent terminal selected from the Session terminal list. */
    terminal: { terminalId: string }
  }
}
