/** Live Session projection state with reconnect baselines. */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import type {
  Session, SessionId,
} from '@deepseek-ai/dsh-session'
import type {
  SessionControlBaseline,
  SessionControlFrame,
  SessionProjectionBaseline,
  SessionProjectionUpdate,
  SessionProjectionValues,
} from './types.ts'

/** Account-scope admission of one Session inside the live control stream. */
export type SessionAdmission = (sessionId: SessionId) => Promise<boolean>

/** Owns the Host-wide Session control stream. */
export class SessionControlController {
  private readonly streams = new Set<ControlQueue>()

  /** @param ctx - Host context carrying live Agent and projection services. */
  constructor(private readonly ctx: Context) {
    ctx.sessionProjections.onEventChanged((session, changes, seq) => {
      this.broadcast({
        type: 'projection',
        sessionId: session.id,
        seq,
        // Every projection definition validates its value before change publication.
        changes: changes as SessionProjectionUpdate['changes'],
      })
    })
    ctx.effect(() => () => {
      for (const stream of this.streams) stream.end()
      this.streams.clear()
    }, 'session-controller.control')
  }

  /**
   * Open one generation of Host-wide live control state.
   *
   * The opening snapshot is read synchronously when the reader starts, so a
   * change published while the account scope resolves still arrives after it.
   * @param signal - Remote stream cancellation.
   * @param allowed - account-scope admission for one Session; omitted without an account scope.
   * @returns one complete baseline followed by live replacement frames.
   */
  async *control(
    signal: AbortSignal,
    allowed?: Promise<SessionAdmission | undefined>,
  ): AsyncIterable<SessionControlFrame> {
    signal.throwIfAborted()
    const queue = new ControlQueue()
    this.streams.add(queue)
    try {
      const baseline = this.baseline()
      const admission = allowed === undefined ? undefined : await allowed
      yield {
        type: 'baseline',
        value: admission === undefined ? baseline : await filterBaseline(baseline, admission),
      }
      yield* queue.iterate(signal, admission)
    } finally {
      this.streams.delete(queue)
      queue.end()
    }
  }

  private baseline(): SessionControlBaseline {
    const sessions = this.ctx.sessions.list()
    return {
      projections: this.projectionBaseline(sessions),
    }
  }

  private projectionBaseline(
    sessions: readonly Session[],
  ): Readonly<Record<SessionId, SessionProjectionBaseline>> {
    const blocks = Object.create(null) as Record<SessionId, SessionProjectionBaseline>
    for (const session of sessions) {
      const snapshot = this.ctx.sessionProjections.snapshot(session)
      blocks[session.id] = {
        asOfSeq: snapshot.asOfSeq,
        // Every projection definition validates its value before snapshot publication.
        values: snapshot.values as SessionProjectionValues,
      }
    }
    return blocks
  }

  private broadcast(frame: SessionControlFrame): void {
    for (const stream of this.streams) stream.push(frame)
  }
}

class ControlQueue {
  private readonly buffer = new Deque<SessionControlFrame>()
  private wake: (() => void) | undefined
  private done = false

  push(frame: SessionControlFrame): void {
    if (this.done) return
    this.buffer.pushBack(frame)
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  end(): void {
    if (this.done) return
    this.done = true
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  /**
   * Drain frames until the generation ends.
   * @param signal - generation cancellation.
   * @param allowed - account-scope admission for one Session; omitted without an account scope.
   * @returns admitted frames in publication order.
   */
  async *iterate(signal: AbortSignal, allowed?: SessionAdmission): AsyncIterable<SessionControlFrame> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!this.done && !signal.aborted) {
        const frame = this.buffer.popFront()
        if (frame !== undefined) {
          if (await admitted(frame, allowed)) yield frame
          continue
        }
        await new Promise<void>((resolve) => { this.wake = resolve })
      }
      while (this.buffer.size > 0 && !signal.aborted) {
        const frame = this.buffer.popFront() as SessionControlFrame
        if (await admitted(frame, allowed)) yield frame
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.end()
    }
  }
}

/**
 * Account-scope admission of one control frame.
 * @param frame - frame about to be delivered.
 * @param allowed - account-scope admission; omitted without an account scope.
 * @returns whether this frame may reach the reader.
 */
async function admitted(
  frame: SessionControlFrame,
  allowed: SessionAdmission | undefined,
): Promise<boolean> {
  if (allowed === undefined || frame.type !== 'projection') return true
  return await allowed(frame.sessionId)
}

/**
 * Keep only the projection blocks one account owns.
 * @param baseline - complete opening snapshot.
 * @param allowed - account-scope admission per Session.
 * @returns the opening snapshot narrowed to admitted Sessions.
 */
async function filterBaseline(
  baseline: SessionControlBaseline,
  allowed: SessionAdmission,
): Promise<SessionControlBaseline> {
  const projections = Object.create(null) as Record<SessionId, SessionProjectionBaseline>
  for (const [id, block] of Object.entries(baseline.projections)) {
    const sessionId = id as SessionId
    if (await allowed(sessionId)) projections[sessionId] = block
  }
  return { projections }
}
