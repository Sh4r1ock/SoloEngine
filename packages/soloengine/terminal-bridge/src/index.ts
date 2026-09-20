/**
 * `@soloengine/terminal-bridge` —— 终端桥（完全自研，Host 面）。
 *
 * 依据 PRD-08 FR-OPS-003/FR-OPS-005、PRD-06 FR-ENG-028、PRD-10 FR-SEC-007
 * 与《SoloEngine Harness插件体系完整介绍》§三 runmode、§四 ui-agentic：
 *
 * - **终端事实源唯一为 `ctx.terminals`**（owner = 确切 Agent 的会话对象），本桥只是它的
 *   Host 侧浏览器通道，**不自建平行 PTY 注册表**；
 * - owner 归属由桥自己解析：`sessionKey → ctx.agents.get(SessionId(key))`，解析不到即结构化
 *   拒绝（`OWNER_NOT_LIVE`），绝不接受前端上报的 owner 标识（PRD-10 FR-SEC-007）；
 * - 官方 shell 后端为**行式契约**：本桥按行呈现（有界 scrollback 分页 + 行式 send），
 *   不假装渲染全屏 TUI；
 * - **跨重启回放**：进程内终端不跨 Host 重启（官方契约），故重启后从**已持久工具结果**回放
 *   有界输出并明确标注代际——哪些工具算终端由工具自己的 `presentCall(...).card === 'terminal'`
 *   判定，不用前端硬编码工具名表。
 *
 * @module @soloengine/terminal-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-tools'
import type {
  TerminalReadResult,
  TerminalSendResult,
  TerminalSessionSnapshot,
  TerminalSignal,
  TerminalSpawnResult,
} from '@deepseek-ai/dsh-terminal'

/** Cordis plugin name. */
export const name = 'soloengine-terminal-bridge'
/** 需要 HTTP 服务座、终端注册表、活 agent 表、会话表、工具表（呈现意图判定）与信任门。 */
export const inject = ['webServer', 'terminals', 'agents', 'sessions', 'tools', 'connection']

/** 桥的挂载前缀（同一 HTTP 服务、同进程；与 /api/solo 与 /plugins 互不遮蔽）。 */
const PREFIX = '/soloengine/terminal'
/** 默认终端后端类型（官方 terminal-bash 注册的 type 默认值）。 */
const DEFAULT_BACKEND = 'shell'
/** scrollback 单页默认行数与上限。 */
const DEFAULT_PAGE = 400
/** 行式 send 的等待上限（毫秒）：到期即回读已产生的增量，不取消用户的命令。 */
const SEND_WAIT_MS = 30_000

/** 一条浏览器可见的终端会话（含 motd 与状态）。 */
interface TerminalView {
  sessionId: string
  name: string | null
  type: string
  pid: number | null
  state: 'running' | 'exited' | 'failed'
  exitCode: number | null
}

/**
 * 把注册表快照投影为浏览器视图。
 * @param snapshot - `ctx.terminals.list(owner)` 的一条。
 * @returns 视图。
 */
function viewOf(snapshot: TerminalSessionSnapshot): TerminalView {
  const status = snapshot.status
  return {
    sessionId: String(snapshot.sessionId),
    name: snapshot.name ?? null,
    type: snapshot.type,
    pid: snapshot.pid ?? null,
    state: status.kind === 'running' ? 'running' : 'exited',
    exitCode: status.kind === 'running' ? null : status.exitCode,
  }
}

/** 结构化 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** 结构化失败（fail loud：错误直接报出并指出具体项）。 */
function sendFailure(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } })
}

/**
 * 读取请求体（JSON；空体即 `{}`）。
 * @param req - 请求。
 * @returns 解析后的对象。
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/** 从 URL 取查询串（单值）。 */
function queryOf(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)
  return value === null ? undefined : value
}

/**
 * 注册终端桥。
 * @param ctx - 插件上下文（须注入 `webServer`/`terminals`/`agents`/`tools`/`connection`）。
 */
export function apply(ctx: Context): void {
  /**
   * 解析 owner：会话键 → 本进程内的活 Agent（唯一权威归属）。
   * @param sessionKey - 会话键。
   * @returns 活 Agent。
   */
  const ownerOf = (sessionKey: string) => {
    if (sessionKey.trim() === '') {
      throw new BridgeError(400, 'SESSION_KEY_REQUIRED', 'sessionKey is required: the owner is resolved from the live session')
    }
    const agent = ctx.agents.get(SessionId(sessionKey))
    if (agent === undefined) {
      throw new BridgeError(404, 'OWNER_NOT_LIVE', `session ${sessionKey} has no live agent in this process (owner-scoped access only)`)
    }
    return agent
  }

  /** 读取一条终端的行窗口。 */
  const readOf = (sessionKey: string, terminalId: string, offset: number, count: number): TerminalReadResult => {
    const owner = ownerOf(sessionKey)
    return ctx.terminals.read(owner, terminalId as never, { offset, count })
  }

  /**
   * 回放已持久输出（跨重启）：从会话日志里取**终端卡**工具调用的结果文本。
   * 判定依据是工具自己的呈现意图（`presentCall(...).card === 'terminal'`），非硬编码工具名。
   * @param session - 会话。
   * @returns 回放条目（按事件序）。
   */
  const replayOf = (session: Session): { callId: string; toolName: string; seq: number; text: string }[] => {
    const terminalCalls = new Map<string, { toolName: string; seq: number }>()
    const out: { callId: string; toolName: string; seq: number; text: string }[] = []
    for (const event of session.snapshotEvents()) {
      if (event.type === 'tool/call') {
        const definition = ctx.tools.get(event.data.name)
        let parsed: unknown
        try {
          parsed = JSON.parse(event.data.arguments)
        } catch {
          continue
        }
        const view = definition?.presentCall?.(parsed)
        if (view?.card === 'terminal') {
          terminalCalls.set(String(event.data.callId), { toolName: event.data.name, seq: Number(event.seq) })
        }
        continue
      }
      if (event.type !== 'tool/result') continue
      const block = event.data.message.content[0]
      const call = terminalCalls.get(String(block.toolCallId))
      if (call === undefined) continue
      const text = block.content
        .filter(candidate => candidate.type === 'text')
        .map(candidate => (candidate as { text: string }).text)
        .join('\n')
      out.push({ callId: String(block.toolCallId), toolName: call.toolName, seq: Number(event.seq), text })
    }
    return out
  }

  /**
   * 处理一条桥请求。
   * @param req - 请求。
   * @param res - 响应。
   */
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // 信任门：与 /api 路由同一条（Host/Origin 反 DNS-rebinding + 浏览器签名 cookie）。
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      sendFailure(res, rejection, 'UNTRUSTED', `terminal bridge rejected the request (${String(rejection)})`)
      return
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const rest = url.pathname.slice(PREFIX.length).replace(/^\/+|\/+$/gu, '')
    const method = req.method ?? 'GET'
    const segments = rest === '' ? [] : rest.split('/')

    // GET /backends
    if (method === 'GET' && segments.length === 1 && segments[0] === 'backends') {
      sendJson(res, 200, { ok: true, backends: ctx.terminals.listBackends(), default: DEFAULT_BACKEND })
      return
    }

    // GET /sessions?sessionKey=
    if (method === 'GET' && segments.length === 1 && segments[0] === 'sessions') {
      const sessionKey = queryOf(url, 'sessionKey') ?? ''
      const owner = ownerOf(sessionKey)
      sendJson(res, 200, {
        ok: true,
        sessionKey,
        terminals: ctx.terminals.list(owner).map(viewOf),
      })
      return
    }

    // POST /sessions  { sessionKey, name?, cwd? }
    if (method === 'POST' && segments.length === 1 && segments[0] === 'sessions') {
      const body = await readJsonBody(req)
      const owner = ownerOf(String(body.sessionKey ?? ''))
      const backends = ctx.terminals.listBackends()
      if (!backends.includes(DEFAULT_BACKEND)) {
        sendFailure(res, 409, 'NO_BACKEND', `terminal backend "${DEFAULT_BACKEND}" is not registered in this composition (registered: ${backends.join(', ') || 'none'})`)
        return
      }
      const request: { type: string; name?: string; cwd?: string } = { type: DEFAULT_BACKEND }
      if (typeof body.name === 'string' && body.name.trim() !== '') request.name = body.name.trim()
      if (typeof body.cwd === 'string' && body.cwd.trim() !== '') request.cwd = body.cwd
      const spawned: TerminalSpawnResult = await ctx.terminals.spawn(owner, request)
      sendJson(res, 201, { ok: true, terminal: viewOf(spawned), motd: spawned.motd })
      return
    }

    // GET /replay?sessionKey=  （跨重启：已持久输出的回放）
    if (method === 'GET' && segments.length === 1 && segments[0] === 'replay') {
      const sessionKey = queryOf(url, 'sessionKey') ?? ''
      const session = ctx.sessions.get(SessionId(sessionKey))
      if (session === undefined) {
        sendFailure(res, 404, 'SESSION_NOT_FOUND', `session ${sessionKey} is not loaded in this process`)
        return
      }
      const live = ctx.agents.get(SessionId(sessionKey)) !== undefined
      sendJson(res, 200, {
        ok: true,
        sessionKey,
        // 代际标注：进程内终端只在本次 Host 生命周期内存在，持久部分是历史代的回放。
        generation: live ? 'live-and-persisted' : 'persisted-only',
        entries: replayOf(session),
      })
      return
    }

    // /sessions/:id...
    if (segments.length >= 2 && segments[0] === 'sessions') {
      const terminalId = segments[1] ?? ''
      if (segments.length === 2 && method === 'GET') {
        const sessionKey = queryOf(url, 'sessionKey') ?? ''
        const offset = Number(queryOf(url, 'offset') ?? '0')
        const count = Number(queryOf(url, 'count') ?? String(DEFAULT_PAGE))
        const page = readOf(sessionKey, terminalId, Number.isFinite(offset) ? offset : 0, Number.isFinite(count) ? count : DEFAULT_PAGE)
        const owner = ownerOf(sessionKey)
        const snapshot = ctx.terminals.list(owner).find(candidate => String(candidate.sessionId) === terminalId)
        sendJson(res, 200, {
          ok: true,
          sessionId: terminalId,
          scrollback: page,
          terminal: snapshot === undefined ? null : viewOf(snapshot),
        })
        return
      }
      if (segments.length === 3 && segments[2] === 'input' && method === 'POST') {
        const body = await readJsonBody(req)
        const sessionKey = String(body.sessionKey ?? '')
        const owner = ownerOf(sessionKey)
        const operation = ctx.terminals.startSend(owner, terminalId as never, {
          text: String(body.text ?? ''),
          submit: body.submit !== false,
        })
        const settled: TerminalSendResult = await Promise.race([
          operation.done,
          new Promise<TerminalSendResult>(resolve => {
            setTimeout(() => {
              const delta = operation.readOutput()
              resolve({
                viewport: delta.delta,
                waitReason: 'timeout',
                sessionStatus: { kind: 'running' },
                truncated: delta.truncated,
              })
            }, SEND_WAIT_MS).unref?.()
          }),
        ])
        sendJson(res, 200, { ok: true, send: settled })
        return
      }
      if (segments.length === 3 && segments[2] === 'signal' && method === 'POST') {
        const body = await readJsonBody(req)
        const owner = ownerOf(String(body.sessionKey ?? ''))
        const signal = String(body.signal ?? 'SIGINT')
        const allowed: readonly TerminalSignal[] = ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP']
        if (!allowed.includes(signal as TerminalSignal)) {
          sendFailure(res, 400, 'SIGNAL_INVALID', `signal must be one of ${allowed.join('|')}`)
          return
        }
        const result = await ctx.terminals.signal(owner, terminalId as never, signal as TerminalSignal)
        sendJson(res, 200, { ok: true, result })
        return
      }
      if (segments.length === 2 && method === 'DELETE') {
        const sessionKey = queryOf(url, 'sessionKey') ?? ''
        const owner = ownerOf(sessionKey)
        const killed = await ctx.terminals.kill(owner, terminalId as never, 'closed from the operation area')
        sendJson(res, 200, { ok: true, killed })
        return
      }
    }

    sendFailure(res, 404, 'BRIDGE_ROUTE_NOT_FOUND', `no terminal bridge route for ${method} ${url.pathname}`)
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (req, res) => {
        void handle(req, res).catch((error: unknown) => {
          if (error instanceof BridgeError) {
            sendFailure(res, error.status, error.code, error.message)
            return
          }
          // 终端注册表自身的结构化错误（OWNER_NOT_LIVE / FOREIGN_SESSION / SEND_ACTIVE …）原样报出。
          const code = (error as { code?: unknown }).code
          if (typeof code === 'string') {
            sendFailure(res, 409, code, String((error as Error).message))
            return
          }
          sendFailure(res, 500, 'BRIDGE_INTERNAL', String(error))
        })
      },
    })
    console.log(`soloengine: terminal bridge mounted (${PREFIX}, owner-scoped via ctx.terminals, backend=${DEFAULT_BACKEND})`)
    return dispose
  }, 'soloengine-terminal-bridge.mount')
}

/** 桥自身的结构化错误。 */
class BridgeError extends Error {
  /**
   * @param status - HTTP 状态码。
   * @param code - 稳定错误码。
   * @param message - 人类可读原因（指出具体项）。
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'BridgeError'
  }
}
