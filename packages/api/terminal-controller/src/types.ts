/** Browser terminal identities, metadata and screen-stream frames. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { RemoteUplinkWindow } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The terminal identity is missing or has begun process cleanup. */
    'terminal/unavailable': Record<string, never>
    /** Input or resize was refused without invalidating the output attachment. */
    'terminal/control-unavailable': { readonly reason: 'read-only' | 'not-running' }
    /** Retained screens and pending allocations consume the Session's terminal quota. */
    'terminal/limit-reached': { readonly limit: number }
    /** The panel named an agent terminal this Session does not own. */
    'terminal/unknown-session': { readonly terminalId: string }
  }
}

/** A terminal identity scoped to one Session and one Host lifetime. */
export type WebTerminalId = Branded<'WebTerminalId'>

/** One agent terminal as the Session's panel reads it. */
export interface AgentTerminalInfo {
  /** Registry-minted identity every operation names. */
  readonly terminalId: string
  /** Owner-local display name, when the creator gave one. */
  readonly name?: string
  /** Backend type that created the session. */
  readonly type: string
  /** Top-level process id when the backend has one. */
  readonly pid?: number
  /** Top-level process state. */
  readonly state: 'running' | 'exited'
  /** Exit code once the top-level process ended, `null` while running or without one. */
  readonly exitCode: number | null
}

/** The agent-terminal backends this composition registered. */
export interface AgentTerminalBackends {
  /** Registered backend types. */
  readonly backends: readonly string[]
  /** The type a new terminal uses when the caller names none. */
  readonly default: string
}

/** Request for one agent terminal owned by the calling Session. */
export interface AgentTerminalSpawnRequest {
  /** Registered backend type; empty selects {@link AgentTerminalBackends.default}. */
  readonly type: string
  /** Optional owner-local display name. */
  readonly name?: string
  /** Optional initial working directory interpreted by the backend. */
  readonly cwd?: string
}

/** A spawned agent terminal plus the backend's initial output. */
export interface AgentTerminalSpawnResult {
  /** The new owner-visible terminal. */
  readonly terminal: AgentTerminalInfo
  /** Bounded initial output the backend produced. */
  readonly motd: string
}

/** One backward page of an agent terminal's retained output. */
export interface AgentTerminalPage {
  /** Retained text in chronological order. */
  readonly text: string
  /** Lines currently retained. */
  readonly totalLines: number
  /** Inclusive newest-relative offset of the first returned line. */
  readonly lineBegin: number
  /** Exclusive newest-relative offset after the returned page. */
  readonly lineEnd: number
  /** Whether older output or the requested page exceeded a bound. */
  readonly truncated: boolean
}

/** One backward page request for an agent terminal's retained output. */
export interface AgentTerminalRange {
  /** Offset from the newest retained line; defaults to the newest page. */
  readonly offset?: number
  /** Requested line count; the controller's own scrollback bound still applies. */
  readonly count?: number
}

/** One line input for an agent terminal. */
export interface AgentTerminalInput {
  /** UTF-8 text to write. */
  readonly text: string
  /** Whether to write the backend's Enter sequence after the text; defaults to true. */
  readonly submit?: boolean
}

/** Signals the panel may deliver to a verified foreground process group. */
export type AgentTerminalSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'

/** Settled result of one line send to an agent terminal. */
export interface AgentTerminalSendResult {
  /** Bounded rendered output remaining at settlement. */
  readonly viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  readonly waitReason: 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
  /** Top-level state observed at settlement. */
  readonly state: 'running' | 'exited'
  /** Exit code when the top-level process ended. */
  readonly exitCode: number | null
  /** Whether output was dropped from the operation or retained scrollback. */
  readonly truncated: boolean
}

/** Acknowledges one physical window hold without taking screen or input control. */
export interface TerminalRetentionFrame {
  readonly type: 'retained'
}

/** An executable shell verified in the subprocess provider's execution environment. */
export interface TerminalShell {
  readonly path: string
  readonly args: readonly string[]
  readonly name: string
}

/** Current Session directory and terminal limits; retained terminals keep their own process directories. */
export interface TerminalEnvironment {
  /** Logged current directory, read without filesystem validation. */
  readonly cwd: string
  readonly maxInputBytes: number
  /** Maximum complete encoded Client input bytes retained until acknowledgement. */
  readonly maxBufferedBytes: number
  readonly maxCols: number
  readonly maxRows: number
  readonly scrollback: number
}

/** Host-owned terminal state; process exit never creates a replacement shell. */
export interface WebTerminalInfo {
  readonly id: WebTerminalId
  readonly title: string
  readonly shell: TerminalShell
  /** Initial working directory; shell directory changes do not update this field. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly state: 'running' | 'exited' | 'failed'
  readonly exitCode: number | null
  readonly error?: string
}

/** Create is idempotent for an open identity; closed identities cannot be recreated. */
export interface TerminalCreateRequest {
  /** A path returned by shell discovery; absent selects the execution default. */
  readonly shellPath?: string
  readonly id: WebTerminalId
  readonly cols: number
  readonly rows: number
}

/** Commands are numbered consecutively from one within each attachment; acknowledgements never authorize replay. */
export type TerminalInput =
  | { readonly type: 'write'; readonly sequence: number; readonly data: string }
  | { readonly type: 'resize'; readonly sequence: number; readonly cols: number; readonly rows: number }

/**
 * Every attachment begins with a complete bounded screen, then ordered output.
 * inputWindow is absent when the carrier has no encoded-frame inbox limit.
 */
export type TerminalFrame =
  | { readonly type: 'snapshot'; readonly sequence: number; readonly screen: string; readonly info: WebTerminalInfo; readonly writable: boolean; readonly inputWindow?: RemoteUplinkWindow }
  | { readonly type: 'output'; readonly sequence: number; readonly data: string }
  | { readonly type: 'state'; readonly info: WebTerminalInfo; readonly writable: boolean }
  | { readonly type: 'ack'; readonly sequence: number; readonly refusal?: 'read-only' | 'not-running' }
