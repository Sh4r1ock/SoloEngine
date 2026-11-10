/**
 * Rebuild the bounded output a terminal already persisted through its tool
 * results.
 *
 * `terminal_send` publishes the foreground viewport it returned as tool-result
 * presentation metadata, and the Session log keeps that metadata verbatim.
 * After a Host restart the PTY is gone, but that persisted portion is still in
 * the loaded Session history, so the panel can replay it instead of showing an
 * empty screen. This is incremental by design: only the bounded sends that the
 * window still holds are replayed, and a new terminal is a new generation.
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

/** Tool whose foreground results carry persisted terminal output. */
const SEND_TOOL = 'terminal_send'

/** Most recent replayed characters; the replay is a bounded portion, not full history. */
const MAX_REPLAY_CHARS = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the terminal a `terminal_send` call targeted.
 * @param rawArguments - the model-authored arguments JSON exactly as logged.
 * @returns the terminal identity, or `undefined` when the call names another tool or invalid JSON.
 */
function sentTerminal(rawArguments: string): string | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(rawArguments) } catch (_malformedArguments) { return undefined }
  if (!isRecord(parsed)) return undefined
  const sessionId = parsed['sessionId']
  return typeof sessionId === 'string' ? sessionId : undefined
}

/**
 * Read the persisted viewport from one tool result's presentation metadata.
 * @param meta - the result event's opaque tool metadata.
 * @returns the viewport text, or `undefined` when the result published none.
 */
function viewportOf(meta: unknown): string | undefined {
  if (!isRecord(meta)) return undefined
  const viewport = meta['viewport']
  return typeof viewport === 'string' ? viewport : undefined
}

/**
 * Keep the newest bounded portion, starting at a line boundary.
 * @param text - complete replayed text.
 * @param maxChars - positive character cap.
 * @returns text within the cap.
 */
function bound(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const tail = text.slice(text.length - maxChars)
  const lineBreak = tail.indexOf('\n')
  return lineBreak === -1 ? tail : tail.slice(lineBreak + 1)
}

/**
 * Collect the output one terminal persisted through this Session's tool results.
 * @param entries - the Session's loaded event window, in order.
 * @param terminalId - registry identity the output belongs to.
 * @returns bounded persisted output; empty when the window holds none.
 */
export function persistedOutput(entries: readonly SessionEventLikeEntry[], terminalId: string): string {
  const sendCalls = new Map<string, string>()
  const chunks: string[] = []
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type === 'tool/call') {
      if (event.data.name !== SEND_TOOL) continue
      const target = sentTerminal(event.data.arguments)
      if (target !== undefined) sendCalls.set(event.data.callId, target)
      continue
    }
    if (event.type !== 'tool/result') continue
    if (sendCalls.get(event.data.message.toolCallId) !== terminalId) continue
    const viewport = viewportOf(event.data.meta)
    if (viewport !== undefined && viewport !== '') chunks.push(viewport)
  }
  return bound(chunks.join(''), MAX_REPLAY_CHARS)
}
