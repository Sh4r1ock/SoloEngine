/**
 * 运行设置桥（PRD-02 FR-CANVAS-017 的「实时跟随」开关）。
 *
 * 运行面板走信任门（进程启动令牌换签名 cookie），不经框架层 Bearer；本桥因此挂在
 * `/soloengine/*` 前缀下，用与操作区桥相同的信任门与归属解析（会话键 → 台账行 → 用户）。
 *
 * 只写一条 `soloengine/run-context` 持久事件（后写覆盖先写，投影随之更新）：运行档位与
 * 实时跟随属于「这一次运行怎么跑」，由面板随时调整，不写回画布。
 *
 * 另有两条面板专用路由：`start`（无会话时用受管工作根发起运行）与 `workspace`（把面板里
 * 新增的工作区目录登记为本次 flow 的运行项目，需求 §9.5 ⑤）。
 *
 * @module @soloengine/host/run-settings-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FrameworkError, type FrameworkRuntime } from '@soloengine/framework'
import type {} from '@soloengine/types'
import { resolveSessionOwnership } from './session-ownership.ts'
import { BridgeFailure, readJsonBody, sendFailure, sendJson } from './bridge-json.ts'

/** 桥前缀（与 /soloengine/workspace、/soloengine/changes 互不遮蔽）。 */
const RUN_SETTINGS_PREFIX = '/soloengine/run-settings'

/**
 * 面板发起运行时的受管工作根：`<该账号的隔离项目根>/runs/<canvasId>`。
 *
 * 目录必须在账号自己的隔离项目根之内：云形态的沙箱根判据只接受该根下的目录
 * （`canvas.ts` 的 `assertProjectFolderAllowed`），单机形态下也避免两个账号把同一张
 * 公共模板画布跑进同一份工作区。
 * @param projectsRoot - 该账号的隔离项目根（`userDirs.sub(username, 'projects')`）。
 * @param canvasId - 画布 id。
 * @returns 绝对目录。
 */
export function panelRunFolder(projectsRoot: string, canvasId: string): string {
  return join(projectsRoot, 'runs', canvasId)
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
        const user = await runtime.accounts.byId(userId)
        if (user === undefined) {
          throw new BridgeFailure(404, 'USER_NOT_FOUND', `account ${userId} not found`)
        }
        runtime.userDirs.ensure(user.username)
        const folderPath = panelRunFolder(runtime.userDirs.sub(user.username, 'projects'), canvasId)
        mkdirSync(folderPath, { recursive: true })
        try {
          const session = await runtime.runs.createRun(userId, { canvasId, folderPath })
          sendJson(res, 201, { ok: true, session: { panel_path: session.panel_path } })
        } catch (error) {
          // 编译拒绝（缺模型/空画布等）是业务失败，按框架层状态码回 4xx，不能落成 500。
          if (error instanceof FrameworkError) throw new BridgeFailure(error.status, error.code, error.message)
          throw error
        }
        return
      }
      if (route !== 'live-follow' && route !== 'workspace') {
        throw new BridgeFailure(404, 'BRIDGE_ROUTE_NOT_FOUND', `no run settings route for ${method} ${url.pathname}`)
      }
      if (method !== 'POST') {
        throw new BridgeFailure(405, 'BRIDGE_METHOD_NOT_ALLOWED', `${route} requires POST`)
      }
      if (route === 'workspace') {
        // 面板里新增的工作区：登记为本次 flow 的运行项目（需求 §9.5 ⑤）。目录由原生工作区
        // 选择器给出，产品只把「画布 × 目录」记进台账，宿主随后按会话 cwd 补登会话行。
        const body = await readJsonBody(req)
        const canvasId = typeof body.canvasId === 'string' ? body.canvasId.trim() : ''
        const folderPath = typeof body.folderPath === 'string' ? body.folderPath.trim() : ''
        if (canvasId === '') throw new BridgeFailure(400, 'CANVAS_REQUIRED', 'canvasId is required to register a run project')
        if (folderPath === '') throw new BridgeFailure(400, 'FOLDER_REQUIRED', 'folderPath is required to register a run project')
        const admission = ctx.connection.admit(req)
        const userId = 'peer' in admission ? ctx.connection.accountIdOf(admission.peer) : undefined
        if (userId === undefined) {
          throw new BridgeFailure(401, 'UNAUTHENTICATED', 'registering a run project requires a signed-in account')
        }
        const canvas = await runtime.canvas.byId(userId, canvasId)
        if (canvas === undefined) {
          throw new BridgeFailure(404, 'CANVAS_NOT_FOUND', `canvas ${canvasId} is not visible to this account`)
        }
        try {
          const project = await runtime.canvas.ensureProject(userId, canvasId, folderPath)
          sendJson(res, 201, { ok: true, project: { id: project.id } })
        } catch (error) {
          if (error instanceof FrameworkError) throw new BridgeFailure(error.status, error.code, error.message)
          throw error
        }
        return
      }
      const body = await readJsonBody(req)
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : ''
      if (sessionKey.trim() === '') {
        throw new BridgeFailure(400, 'SESSION_KEY_REQUIRED', 'sessionKey is required: ownership is resolved from the run ledger, never reported by the client')
      }
      if (typeof body.liveFollow !== 'boolean') {
        throw new BridgeFailure(400, 'LIVE_FOLLOW_REQUIRED', 'liveFollow must be a boolean')
      }
      // 会话键由请求体给出：信任门只证明「某账号已登录」，归属行还必须与连接绑定的账号一致，
      // 否则任何登录用户都能凭他人的会话键改写其运行设置（不匹配按不存在返回）。
      const admission = ctx.connection.admit(req)
      const accountId = 'peer' in admission ? ctx.connection.accountIdOf(admission.peer) : undefined
      if (accountId === undefined) {
        throw new BridgeFailure(401, 'UNAUTHENTICATED', 'changing run settings requires a signed-in account')
      }
      const ownership = await resolveSessionOwnership(ctx, runtime, sessionKey)
      if (ownership === undefined || ownership.row.user_id !== accountId) {
        throw new BridgeFailure(404, 'SESSION_NOT_IN_LEDGER', `session ${sessionKey} has no run ledger row for this account`)
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
