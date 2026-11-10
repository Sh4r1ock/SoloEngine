/**
 * 运行设置桥（PRD-02 FR-CANVAS-017 的「实时跟随」开关）。
 *
 * 运行面板走信任门（进程启动令牌换签名 cookie），不经框架层 Bearer；本桥因此挂在
 * `/soloengine/*` 前缀下，用与操作区桥相同的信任门与归属解析（会话键 → 台账行 → 用户）。
 *
 * 只写一条 `soloengine/run-context` 持久事件（后写覆盖先写，投影随之更新）：运行档位与
 * 实时跟随属于「这一次运行怎么跑」，由面板随时调整，不写回画布。
 *
 * @module @soloengine/host/run-settings-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FrameworkRuntime } from '@soloengine/framework'
import type {} from '@soloengine/types'
import { resolveSessionOwnership } from './session-ownership.ts'
import { sendFailure, sendJson } from './bridge-json.ts'

/** 桥前缀（与 /soloengine/workspace、/soloengine/changes 互不遮蔽）。 */
const RUN_SETTINGS_PREFIX = '/soloengine/run-settings'

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
 * 挂载运行设置桥。
 * @param ctx - 已注入 `webServer`、`connection`、`agents` 与 `sessionProjections` 的上下文。
 * @param runtime - 框架层运行时（会话归属台账）。
 */
export function mountRunSettingsBridge(ctx: Context, runtime: FrameworkRuntime): void {
  const serve = (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        throw new BridgeFailure(rejection, 'UNTRUSTED', `run settings bridge rejected the request (${String(rejection)})`)
      }
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const route = url.pathname.slice(RUN_SETTINGS_PREFIX.length).replace(/^\/+|\/+$/gu, '')
      const method = (req.method ?? 'GET').toUpperCase()
      // 运行入口：无会话的 `/run/:flow` 由面板直接发起一次运行（受管工作根），不跳产品中间页、
      // 也不弹目录选择——目录选择只在面板里由原生「添加工作区」发生。
      if (route === 'start' && method === 'POST') {
        const body = await readJsonBody(req)
        const canvasId = typeof body.canvasId === 'string' ? body.canvasId.trim() : ''
        if (canvasId === '') throw new BridgeFailure(400, 'CANVAS_REQUIRED', 'canvasId is required to start a run')
        const admission = ctx.connection.admit(req)
        const userId = 'peer' in admission ? ctx.connection.accountIdOf(admission.peer) : undefined
        if (userId === undefined) {
          throw new BridgeFailure(401, 'UNAUTHENTICATED', 'starting a run requires a signed-in account')
        }
        const canvas = await runtime.canvas.byId(userId, canvasId)
        if (canvas === undefined) {
          throw new BridgeFailure(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} is not visible to this account`)
        }
        const folderPath = join(process.env.SOLOENGINE_ROOT ?? process.cwd(), 'data', 'runs', canvasId)
        mkdirSync(folderPath, { recursive: true })
        const session = await runtime.runs.createRun(userId, { canvasId, folderPath })
        sendJson(res, 201, { ok: true, session: { panel_path: session.panel_path } })
        return
      }
      if (route !== 'live-follow' || method !== 'POST') {
        throw new BridgeFailure(404, 'BRIDGE_ROUTE_NOT_FOUND', `no run settings route for ${method} ${url.pathname}`)
      }
      const body = await readJsonBody(req)
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : ''
      if (sessionKey.trim() === '') {
        throw new BridgeFailure(400, 'SESSION_KEY_REQUIRED', 'sessionKey is required: ownership is resolved from the run ledger, never reported by the client')
      }
      if (typeof body.liveFollow !== 'boolean') {
        throw new BridgeFailure(400, 'LIVE_FOLLOW_REQUIRED', 'liveFollow must be a boolean')
      }
      const ownership = await resolveSessionOwnership(ctx, runtime, sessionKey)
      if (ownership === undefined) {
        throw new BridgeFailure(404, 'SESSION_NOT_IN_LEDGER', `session ${sessionKey} has no run ledger row; run settings serve runs of this instance only`)
      }
      const agent = ctx.agents.get(sessionKey as SessionId)
      if (agent === undefined) {
        throw new BridgeFailure(409, 'SESSION_NOT_LIVE', `session ${sessionKey} is not live in this host; run settings change a running session only`)
      }
      const current = ctx.sessionProjections.stateOf(agent.session, 'soloengine.runContext')
      if (current === null || current === undefined) {
        throw new BridgeFailure(409, 'RUN_CONTEXT_MISSING', `session ${sessionKey} has no run context; start the run before changing live follow`)
      }
      agent.session.append('soloengine/run-context', {
        canvasId: current.canvasId,
        projectId: current.projectId,
        projectDir: current.projectDir,
        runMode: current.runMode,
        liveFollow: body.liveFollow,
      })
      sendJson(res, 200, { ok: true, liveFollow: body.liveFollow })
    })().catch((error: unknown) => {
      if (error instanceof BridgeFailure) {
        sendFailure(res, error.status, error.code, error.message)
        return
      }
      sendFailure(res, 500, 'BRIDGE_INTERNAL', String(error))
    })
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: RUN_SETTINGS_PREFIX,
      handler: serve,
    })
    console.log(`soloengine: run settings bridge mounted (${RUN_SETTINGS_PREFIX}; trust gate + run-ledger ownership)`)
    return dispose
  }, 'soloengine-host.runSettingsBridge')
}
