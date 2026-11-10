/**
 * 操作区桥（PRD-08 FR-OPS-010 / FR-OPS-012；PRD-09 FR-FC-011）。
 *
 * 运行面板（`/run/:agenticFlowId` 分支启动的原生客户端插件树）**不经框架层 Bearer 令牌**，
 * 它走的是信任门（进程启动令牌换签名 cookie）。故操作区的读写分治在浏览器侧有两条入口：
 *
 * - 产品页面（框架层普通路由）→ `/api/solo/workspace/*`（Bearer 鉴权）；
 * - 运行面板（原生插件树）→ `/soloengine/workspace/*`（**本桥**：信任门鉴权）。
 *
 * 两条入口共用同一份操作表（`@soloengine/framework` 的 `WORKSPACE_OPS`/`CHANGES_OPS`）与
 * 同一套沙箱根判据；本桥只补**信任门**与**归属解析**，**归属不靠前端上报**：
 * `sessionKey → 归属台账行 → user_id + run_project_id → 运行项目目录（沙箱根）`。
 *
 * @module @soloengine/host/ops-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CHANGES_OPS, WORKSPACE_OPS, type FrameworkRuntime, type OpsInput, type OpsRoute } from '@soloengine/framework'
import { resolveSessionOwnership } from './session-ownership.ts'
import { BridgeFailure, readJsonBody, sendFailure, sendJson } from './bridge-json.ts'

/** 工作区桥前缀（运行面板侧；与 /api/solo 与 /soloengine/terminal 互不遮蔽）。 */
const WORKSPACE_PREFIX = '/soloengine/workspace'
/** 变更台账桥前缀。 */
const CHANGES_PREFIX = '/soloengine/changes'

/**
 * 取可选字符串（`undefined`/`null` 即缺省）。
 * @param value - 原始字段值。
 * @returns 字符串或 `undefined`。
 */
function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * 挂载操作区桥。
 * @param ctx - 已注入 `webServer` 与 `connection` 的上下文。
 * @param runtime - 框架层运行时（工作区与台账域）。
 */
export function mountOperationAreaBridge(ctx: Context, runtime: FrameworkRuntime): void {
  /**
   * 解析一次请求的归属：会话键 → 台账行 → 用户与运行项目。
   *
   * 信任门只证明「某个账号已登录」，**不证明**该账号拥有这个会话：会话键由请求体给出，
   * 任何登录用户都可以填别人的键。因此归属行还必须与连接绑定的账号一致；不一致按
   * 「不存在」返回（不泄漏他人会话是否存在）。
   * @param req - 原始请求（取连接绑定的账号）。
   * @param sessionKey - 会话键。
   * @returns 用户 id 与运行项目 id。
   */
  const ownerOf = async (req: IncomingMessage, sessionKey: string): Promise<{ userId: string; projectId: string }> => {
    if (sessionKey.trim() === '') {
      throw new BridgeFailure(400, 'SESSION_KEY_REQUIRED', 'sessionKey is required: ownership is resolved from the run ledger, never reported by the client')
    }
    const admission = ctx.connection.admit(req)
    const accountId = 'peer' in admission ? ctx.connection.accountIdOf(admission.peer) : undefined
    if (accountId === undefined) {
      throw new BridgeFailure(401, 'UNAUTHENTICATED', 'the operation area bridge requires a signed-in account')
    }
    // 分支/子代理子会话没有自己的台账行：按会话树根解析到已登记的运行（与账号作用域同一份）。
    const ownership = await resolveSessionOwnership(ctx, runtime, sessionKey)
    if (ownership === undefined || ownership.row.user_id !== accountId) {
      throw new BridgeFailure(404, 'SESSION_NOT_IN_LEDGER', `session ${sessionKey} has no run ledger row for this account`)
    }
    const row = ownership.row
    if (row.run_project_id.trim() === '') {
      throw new BridgeFailure(409, 'PROJECT_MISSING', `session ${sessionKey} has no run project; the sandbox root is undefined`)
    }
    return { userId: row.user_id, projectId: row.run_project_id }
  }

  /** 信任门的统一前置。 */
  const preflight = (req: IncomingMessage): void => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      throw new BridgeFailure(rejection, 'UNTRUSTED', `operation area bridge rejected the request (${String(rejection)})`)
    }
  }

  /**
   * 一次桥请求：信任门 → 路由匹配 → 归属解析 → 共享操作 → 响应发送。
   * 操作本体在框架层操作表里，本函数只做桥侧的两件事（信任门、归属）。
   */
  const serve = (ops: readonly OpsRoute[], prefix: string, req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      preflight(req)
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const route = url.pathname.slice(prefix.length).replace(/^\/+|\/+$/gu, '')
      const method = req.method ?? 'GET'
      const op = ops.find(candidate => candidate.method.toUpperCase() === method && candidate.path === route)
      if (op === undefined) {
        sendFailure(res, 404, 'BRIDGE_ROUTE_NOT_FOUND', `no operation area bridge route for ${method} ${url.pathname}`)
        return
      }
      const body = method === 'GET' ? {} : await readJsonBody(req)
      const query = (name: string): string | undefined => url.searchParams.get(name) ?? undefined
      const sessionKey = optionalText(body.sessionKey) ?? query('sessionKey')
      const owner = await ownerOf(req, sessionKey ?? '')
      const input: OpsInput = {
        userId: owner.userId,
        projectId: owner.projectId,
        sessionKey: sessionKey ?? null,
        remoteAddress: req.socket.remoteAddress ?? undefined,
        field: name => body[name] === undefined ? query(name) : body[name],
      }
      const outcome = await op.handle(runtime, input)
      sendJson(res, outcome.status, outcome.body)
    })().catch((error: unknown) => {
      if (error instanceof BridgeFailure) {
        sendFailure(res, error.status, error.code, error.message)
        return
      }
      const code = (error as { code?: unknown }).code
      const status = (error as { status?: unknown }).status
      if (typeof code === 'string' && typeof status === 'number') {
        sendFailure(res, status, code, (error as Error).message)
        return
      }
      sendFailure(res, 500, 'BRIDGE_INTERNAL', String(error))
    })
  }

  ctx.effect(() => {
    const disposeWorkspace = ctx.webServer.register({
      kind: 'prefix',
      path: WORKSPACE_PREFIX,
      handler: (req, res) => { serve(WORKSPACE_OPS, WORKSPACE_PREFIX, req, res) },
    })
    const disposeChanges = ctx.webServer.register({
      kind: 'prefix',
      path: CHANGES_PREFIX,
      handler: (req, res) => { serve(CHANGES_OPS, CHANGES_PREFIX, req, res) },
    })

    console.log(`soloengine: operation area bridge mounted (${WORKSPACE_PREFIX}, ${CHANGES_PREFIX}; trust gate + run-ledger ownership)`)
    return () => { disposeWorkspace(); disposeChanges() }
  }, 'soloengine-host.operationAreaBridge')
}
