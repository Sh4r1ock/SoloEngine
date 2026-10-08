/**
 * 操作区桥（PRD-08 FR-OPS-010 / FR-OPS-012；PRD-09 FR-FC-011）。
 *
 * 运行面板（`/run/:agenticFlowId` 分支启动的原生客户端插件树）**不经框架层 Bearer 令牌**，
 * 它走的是信任门（进程启动令牌换签名 cookie）。故操作区的读写分治在浏览器侧有两条入口：
 *
 * - 产品页面（框架层普通路由）→ `/api/solo/workspace/*`（Bearer 鉴权）；
 * - 运行面板（原生插件树）→ `/soloengine/workspace/*`（**本桥**：信任门鉴权）。
 *
 * 两条入口共用同一份业务实现（`runtime.workspace`）与同一套沙箱根判据，**归属不靠前端上报**：
 * `sessionKey → 归属台账行 → user_id + run_project_id → 运行项目目录（沙箱根）`。
 *
 * @module @soloengine/host/ops-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FrameworkRuntime } from '@soloengine/framework'

/** 工作区桥前缀（运行面板侧；与 /api/solo 与 /soloengine/terminal 互不遮蔽）。 */
const WORKSPACE_PREFIX = '/soloengine/workspace'
/** 变更台账桥前缀。 */
const CHANGES_PREFIX = '/soloengine/changes'

/** 结构化 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 结构化失败（fail loud）。 */
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

/**
 * 挂载操作区桥。
 * @param ctx - 已注入 `webServer` 与 `connection` 的上下文。
 * @param runtime - 框架层运行时（工作区与台账域）。
 */
export function mountOperationAreaBridge(ctx: Context, runtime: FrameworkRuntime): void {
  /**
   * 解析一次请求的归属：会话键 → 台账行 → 用户与运行项目。
   * @param sessionKey - 会话键。
   * @returns 用户 id 与运行项目 id。
   */
  const ownerOf = (sessionKey: string): { userId: string; projectId: string } => {
    if (sessionKey.trim() === '') {
      throw new BridgeFailure(400, 'SESSION_KEY_REQUIRED', 'sessionKey is required: ownership is resolved from the run ledger, never reported by the client')
    }
    const row = runtime.runs.ledger.byKey(sessionKey)
    if (row === undefined) {
      throw new BridgeFailure(404, 'SESSION_NOT_IN_LEDGER', `session ${sessionKey} has no run ledger row; the operation area serves runs of this instance only`)
    }
    if (row.run_project_id.trim() === '') {
      throw new BridgeFailure(409, 'PROJECT_MISSING', `session ${sessionKey} has no run project; the sandbox root is undefined`)
    }
    return { userId: row.user_id, projectId: row.run_project_id }
  }

  /** 信任门 + 归属解析的统一前置。 */
  const preflight = (req: IncomingMessage): void => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      throw new BridgeFailure(rejection, 'UNTRUSTED', `operation area bridge rejected the request (${String(rejection)})`)
    }
  }

  ctx.effect(() => {
    const disposeWorkspace = ctx.webServer.register({
      kind: 'prefix',
      path: WORKSPACE_PREFIX,
      handler: (req, res) => {
        void (async () => {
          preflight(req)
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
          const route = url.pathname.slice(WORKSPACE_PREFIX.length).replace(/^\/+|\/+$/gu, '')
          const method = req.method ?? 'GET'
          const remote = req.socket.remoteAddress ?? undefined
          const q = (key: string): string => url.searchParams.get(key) ?? ''

          if (method === 'GET' && route === 'list') {
            const owner = ownerOf(q('sessionKey'))
            sendJson(res, 200, { ok: true, listing: runtime.workspace.list(owner.userId, owner.projectId, q('path'), remote) })
            return
          }
          if (method === 'GET' && route === 'stat') {
            const owner = ownerOf(q('sessionKey'))
            sendJson(res, 200, { ok: true, stat: runtime.workspace.stat(owner.userId, owner.projectId, q('path'), remote) })
            return
          }
          if (method === 'GET' && route === 'read') {
            const owner = ownerOf(q('sessionKey'))
            const offset = q('offset')
            const limit = q('limit')
            sendJson(res, 200, {
              ok: true,
              file: runtime.workspace.read(owner.userId, owner.projectId, q('path'), {
                ...offset === '' ? {} : { offset: Number(offset) },
                ...limit === '' ? {} : { limit: Number(limit) },
                ...remote === undefined ? {} : { remoteAddress: remote },
              }),
            })
            return
          }
          if (method === 'GET' && route === 'search') {
            const owner = ownerOf(q('sessionKey'))
            sendJson(res, 200, { ok: true, ...runtime.workspace.search(owner.userId, owner.projectId, q('q'), remote) })
            return
          }
          const body = method === 'GET' ? {} : await readJsonBody(req)
          const sessionKey = String(body.sessionKey ?? q('sessionKey'))
          if (method === 'PUT' && route === 'file') {
            const owner = ownerOf(sessionKey)
            sendJson(res, 200, {
              ok: true,
              result: runtime.workspace.write(owner.userId, owner.projectId, String(body.path ?? ''), String(body.text ?? ''), {
                ...body.expectedMtimeMs === undefined ? {} : { expectedMtimeMs: Number(body.expectedMtimeMs) },
                ...body.createOnly === undefined ? {} : { createOnly: body.createOnly === true },
                sessionKey,
                ...remote === undefined ? {} : { remoteAddress: remote },
              }),
            })
            return
          }
          if (method === 'POST' && route === 'directory') {
            const owner = ownerOf(sessionKey)
            sendJson(res, 201, {
              ok: true,
              ...runtime.workspace.mkdir(owner.userId, owner.projectId, String(body.path ?? ''), body.confirm === true, remote),
            })
            return
          }
          if (method === 'POST' && route === 'rename') {
            const owner = ownerOf(sessionKey)
            sendJson(res, 200, {
              ok: true,
              ...runtime.workspace.rename(
                owner.userId, owner.projectId, String(body.from ?? ''), String(body.to ?? ''), body.confirm === true,
                {
                  ...body.expectedMtimeMs === undefined ? {} : { expectedMtimeMs: Number(body.expectedMtimeMs) },
                  ...remote === undefined ? {} : { remoteAddress: remote },
                },
              ),
            })
            return
          }
          if (method === 'DELETE' && route === 'entry') {
            const owner = ownerOf(sessionKey)
            sendJson(res, 200, {
              ok: true,
              ...runtime.workspace.remove(owner.userId, owner.projectId, String(body.path ?? ''), body.confirm === true, remote, sessionKey),
            })
            return
          }
          sendFailure(res, 404, 'BRIDGE_ROUTE_NOT_FOUND', `no operation area bridge route for ${method} ${url.pathname}`)
        })().catch((error: unknown) => {
          if (error instanceof BridgeFailure) {
            sendFailure(res, error.status, error.code, error.message)
            return
          }
          const code = (error as { code?: unknown }).code
          const status = (error as { status?: unknown }).status
          if (typeof code === 'string' && typeof status === 'number') {
            sendFailure(res, status, code, String((error as Error).message))
            return
          }
          sendFailure(res, 500, 'BRIDGE_INTERNAL', String(error))
        })
      },
    })

    const disposeChanges = ctx.webServer.register({
      kind: 'prefix',
      path: CHANGES_PREFIX,
      handler: (req, res) => {
        void (async () => {
          preflight(req)
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
          const route = url.pathname.slice(CHANGES_PREFIX.length).replace(/^\/+|\/+$/gu, '')
          const method = req.method ?? 'GET'
          const q = (key: string): string => url.searchParams.get(key) ?? ''
          const body = method === 'GET' ? {} : await readJsonBody(req)
          const sessionKey = String(body.sessionKey ?? q('sessionKey'))
          const owner = ownerOf(sessionKey)
          const turnRaw = body.turn ?? (q('turn') === '' ? undefined : Number(q('turn')))
          const turn = turnRaw === undefined ? null : Number(turnRaw)
          const filePath = body.filePath ?? (q('filePath') === '' ? undefined : q('filePath'))
          const changeId = body.changeId ?? (q('changeId') === '' ? undefined : q('changeId'))

          // 台账列表（默认路径，保持阶段 6b 的契约不变）。
          if (method === 'GET' && route === '') {
            const query = {
              sessionKey,
              ...turn === null ? {} : { turn },
              ...filePath === undefined ? {} : { filePath: String(filePath) },
            }
            sendJson(res, 200, {
              ok: true,
              changes: runtime.changes.list(owner.userId, query),
              summary: runtime.changes.summary(owner.userId, query),
            })
            return
          }
          // 回合视图（FR-FC-004：同文件多次写入聚合为一处净变更，过程可展开）。
          if (method === 'GET' && route === 'turn') {
            if (turn === null || !Number.isFinite(turn)) {
              throw new BridgeFailure(400, 'TURN_REQUIRED', 'the turn view requires a turn number')
            }
            sendJson(res, 200, { ok: true, entries: runtime.changes.turnView(owner.userId, sessionKey, Math.floor(turn)) })
            return
          }
          // 审阅（FR-FC-005）：整轮 / 逐文件 / 逐 hunk 保留或丢弃——只标记，不动磁盘。
          if (method === 'POST' && route === 'review') {
            const status = String(body.status ?? '')
            if (status !== 'accepted' && status !== 'rejected') {
              throw new BridgeFailure(400, 'REVIEW_STATUS_INVALID', 'status must be accepted or rejected')
            }
            sendJson(res, 200, {
              ok: true,
              ...runtime.changes.review({
                userId: owner.userId,
                sessionKey,
                ...turn === null ? {} : { turn },
                ...filePath === undefined ? {} : { filePath: String(filePath) },
                ...changeId === undefined ? {} : { changeId: String(changeId) },
                status,
                ...Array.isArray(body.hunkIds) ? { hunkIds: body.hunkIds.map(String) } : {},
              }),
            })
            return
          }
          // 撤回计划（FR-FC-007 的执行前确认清单：将恢复的文件 + 将跳过的文件与原因）。
          if (method === 'GET' && route === 'revert/plan') {
            sendJson(res, 200, {
              ok: true,
              plan: runtime.changes.revertPlan(
                owner.userId,
                sessionKey,
                turn,
                changeId === undefined ? undefined : [String(changeId)],
              ),
            })
            return
          }
          // 执行撤回（最小还原 + 漂移跳过 + 逐文件提交；确认由前端显式提交）。
          if (method === 'POST' && route === 'revert') {
            if (body.confirm !== true) {
              throw new BridgeFailure(400, 'CONFIRMATION_REQUIRED',
                'a revert requires an explicit confirmation (confirm: true) after reviewing the restore list')
            }
            sendJson(res, 200, {
              ok: true,
              ...await runtime.changes.revert({
                userId: owner.userId,
                sessionKey,
                turn,
                ...Array.isArray(body.changeIds) ? { changeIds: body.changeIds.map(String) } : {},
                actor: { kind: 'soloengine-revert', userId: owner.userId, sessionKey },
              }),
            })
            return
          }
          sendFailure(res, 404, 'BRIDGE_ROUTE_NOT_FOUND', `no operation area bridge route for ${method} ${url.pathname}`)
        })().catch((error: unknown) => {
          if (error instanceof BridgeFailure) {
            sendFailure(res, error.status, error.code, error.message)
            return
          }
          const code = (error as { code?: unknown }).code
          const status = (error as { status?: unknown }).status
          if (typeof code === 'string' && typeof status === 'number') {
            sendFailure(res, status, code, String((error as Error).message))
            return
          }
          sendFailure(res, 500, 'BRIDGE_INTERNAL', String(error))
        })
      },
    })

    console.log(`soloengine: operation area bridge mounted (${WORKSPACE_PREFIX}, ${CHANGES_PREFIX}; trust gate + run-ledger ownership)`)
    return () => { disposeWorkspace(); disposeChanges() }
  }, 'soloengine-host.operationAreaBridge')
}

/** 桥自身的结构化错误。 */
class BridgeFailure extends Error {
  /**
   * @param status - HTTP 状态码。
   * @param code - 稳定错误码。
   * @param message - 人类可读原因（指出具体项）。
   */
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'BridgeFailure'
  }
}
