/**
 * 框架层 REST 路由装配：Express 应用 + 路由描述表。
 *
 * 依据《SoloEngine 框架设计》§6.1：框架层形态为 Express REST + 数据库；
 * 路由统一挂 `/api/solo/*`，由 `@soloengine/host` 以前缀路由方式挂进 dsh `ctx.webServer`，
 * 与 harness 共用同一条 HTTP 服务（唯一端口）。
 *
 * 业务库经异步端口访问（`BusinessDatabase`）：处理器与鉴权中间件全部异步，错误经
 * `next` 收敛到统一失败面。
 *
 * @module @soloengine/framework/modules/router
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { FrameworkRuntime } from '../runtime.ts'
import { gateWorkspacePath } from '../sandbox/workspace-gate.ts'
import { FrameworkError, toView, type UserRow } from './accounts.ts'
import { FRAMEWORK_VERSION } from '../version.ts'
import { BUILTIN_ROLE_PRESETS } from '@soloengine/types'
import type { InstancePluginDiff } from './canvas.ts'
import { CHANGES_OPS, WORKSPACE_OPS, type OpsInput, type OpsRoute } from './ops.ts'

/** 一条路由的描述（供 `/api/solo/routes` 取证与文档四向映射）。 */
export interface RouteDescriptor {
  id: string
  method: string
  path: string
  summary: string
}

/** 请求级身份（由鉴权中间件注入）。 */
interface AuthedRequest extends Request {
  soloUser?: UserRow
}

/** 路由装配结果。 */
export interface RouterBundle {
  app: Express
  routes: RouteDescriptor[]
  /** 追加一条「需请求级身份」的路由（原生注入点：host 插件把 harness 侧能力挂进同一条 REST 前缀）。 */
  mountAuthenticated(
    descriptor: { id: string; method: 'get' | 'post' | 'patch' | 'put' | 'delete'; path: string; summary: string },
    handler: (req: {
      params: Record<string, string>
      query: Record<string, string>
      body: unknown
      user: UserRow
    }) => Promise<{ status?: number; body: unknown }>,
  ): void
}

/**
 * 建立框架层 Express 应用。
 * @param runtime - 框架层运行时。
 * @returns 应用与路由描述表。
 */
export function createRouter(runtime: FrameworkRuntime): RouterBundle {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '32mb' }))
  // 空请求体（`POST /canvases/:id/compile` 这类无参数动作）在 `express.json` 之后是 undefined；
  // 路由处理器一律按「字段可选的对象」读取请求体，因此在这里统一补成空对象，避免无体请求
  // 走到 `body.xxx` 时抛 TypeError 被判成 500 INTERNAL（真实缺陷：编译动作全部 500）。
  app.use((req, _res, next) => {
    if (req.body === undefined || req.body === null) req.body = {}
    next()
  })
  // 业务路由挂在 `/api/solo` 前缀下：host 侧以同前缀的 webServer 前缀路由转发完整 URL，
  // Express 在此剥离前缀后按短路径匹配。
  const api = express.Router()
  const routes: RouteDescriptor[] = []
  const accounts = runtime.accounts

  /** 业务级处理器（链尾，拥有响应）。 */
  type Handler = (req: AuthedRequest, res: Response) => void | Promise<void>
  /** 中间件（链中，调用 next 放行）。 */
  type Middleware = (req: AuthedRequest, res: Response, next: NextFunction) => void | Promise<void>

  /** 声明一条路由（前置中间件数组 + 链尾处理器），同时登记描述。 */
  const route = (
    id: string,
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    summary: string,
    middlewares: Middleware[],
    handler: Handler,
  ): void => {
    routes.push({ id, method: method.toUpperCase(), path, summary })
    const wrapped = [
      ...middlewares.map(step => (req: Request, res: Response, next: NextFunction): void => {
        void Promise.resolve(step(req as AuthedRequest, res, next)).catch(next)
      }),
      (req: Request, res: Response, next: NextFunction): void => {
        void Promise.resolve(handler(req as AuthedRequest, res)).catch(next)
      },
    ]
    api[method](path, ...wrapped)
  }

  /** 业务错误 → 结构化响应（fail loud：错误直接报出，不吞不降级；5xx 另落一行实例日志）。 */
  const failure = (res: Response, error: unknown): void => {
    if (error instanceof FrameworkError) {
      if (error.status >= 500) console.log(`soloengine: framework error ${error.code}: ${error.message}`)
      res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message } })
      return
    }
    console.log(`soloengine: framework error INTERNAL: ${String(error)}`)
    res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: String(error) } })
  }

  /**
   * 查询参数里的分页上限：只接受正安全整数，越界/非法按缺省值处理。
   *
   * SQLite 的 `LIMIT -1` 表示不限量，直接透传负值等于让调用方绕过分页上限。
   * @param req - 请求（读 `limit` 查询参数）。
   * @param fallback - 缺省值。
   * @param max - 允许的最大值。
   * @returns 生效的分页上限。
   */
  const pageLimit = (req: Request, fallback: number, max: number): number => {
    const raw = Number(req.query.limit ?? fallback)
    if (!Number.isSafeInteger(raw) || raw < 1) return fallback
    return Math.min(raw, max)
  }

  /** 鉴权：Bearer 访问令牌 → 请求级身份。 */
  const authenticate = async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const payload = runtime.tokens.verify(token, 'access')
    if (payload === undefined) {
      res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'a valid access token is required' } })
      return
    }
    const row = await accounts.byId(payload.sub)
    if (row === undefined || row.is_active !== 1) {
      res.status(403).json({ ok: false, error: { code: 'USER_DISABLED', message: 'user is missing or disabled' } })
      return
    }
    // 超管重置口令后令牌版本自增：旧访问令牌立即失效（R007），客户端按 401 走刷新/重新登录。
    if ((payload.tv ?? 0) !== (row.token_version ?? 0)) {
      res.status(401).json({ ok: false, error: { code: 'TOKEN_REVOKED', message: 'the access token was revoked; sign in again' } })
      return
    }
    req.soloUser = row
    next()
  }

  /** 超管限定。 */
  const requireSuperuser = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (req.soloUser?.is_superuser !== 1) {
      res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'superuser privilege is required' } })
      return
    }
    next()
  }

  /** 取单个市场 query 字符串（重复/对象形态一律拒绝，不静默取首个）。 */
  const marketQueryString = (req: AuthedRequest, name: string): string | undefined => {
    const value = req.query[name]
    if (value === undefined) return undefined
    if (typeof value !== 'string') {
      throw new FrameworkError(400, 'MARKET_QUERY_INVALID', `query parameter ${name} must be a single string`)
    }
    return value
  }

  /**
   * 已挂载的原生注入路由：id → 当前处理器。
   *
   * host 侧的 `ctx.inject` 在依赖服务重启时会重跑挂载：同一 id 必须复用同一条 Express
   * 路由，只把处理器换成最新一份——否则先注册的旧处理器（持有已拆除的上下文）会继续应答。
   */
  const mountedHandlers = new Map<string, Parameters<RouterBundle['mountAuthenticated']>[1]>()

  /**
   * 追加一条「需请求级身份」的路由（原生注入点：host 插件把 harness 侧能力挂进同一条 REST 前缀）。
   * 走同一条 api 路由器、同样登记进 routes 描述表、同样经过 authenticate 中间件；
   * handler 抛 FrameworkError 时仍走 failure()。
   */
  const mountAuthenticated: RouterBundle['mountAuthenticated'] = (descriptor, handler) => {
    const existing = mountedHandlers.get(descriptor.id)
    if (existing !== undefined) {
      // 同一 id 的重复挂载只替换处理器：Express 栈与描述表都不再增长。
      mountedHandlers.set(descriptor.id, handler)
      return
    }
    mountedHandlers.set(descriptor.id, handler)
    route(descriptor.id, descriptor.method, descriptor.path, descriptor.summary, [authenticate], async (req, res) => {
      try {
        const user = req.soloUser
        if (user === undefined) throw new FrameworkError(401, 'UNAUTHENTICATED', 'a valid access token is required')
        const current = mountedHandlers.get(descriptor.id)
        if (current === undefined) {
          throw new FrameworkError(503, 'ROUTE_NOT_MOUNTED',
            `the harness route ${descriptor.id} has no mounted handler in this composition`)
        }
        const result = await current({
          params: req.params as Record<string, string>,
          query: req.query as unknown as Record<string, string>,
          body: req.body,
          user,
        })
        if (result.status !== undefined) res.status(result.status)
        res.json(result.body)
      } catch (error) {
        failure(res, error)
      }
    })
  }

  // ── 健康与自检 ─────────────────────────────────────────────────────────────

  route('health', 'get', '/health', '框架层健康检查（含真实数据库环境参数）', [], async (_req, res) => {
    const environment = await runtime.db.environment()
    res.json({
      ok: environment.missingTables.length === 0,
      service: 'soloengine-framework',
      version: FRAMEWORK_VERSION,
      database: {
        engine: environment.engine,
        journalMode: environment.journalMode,
        synchronous: environment.synchronous,
        busyTimeout: environment.busyTimeout,
        tempStore: environment.tempStore,
        userVersion: environment.userVersion,
        foreignKeys: environment.foreignKeys,
        businessTables: environment.businessTables,
        missingTables: environment.missingTables,
      },
      // 部署探活只需要「主密钥是否本次启动新建」；绝对路径不属公开面（PRD-03 §安全）。
      masterKey: { createdThisBoot: runtime.masterKey.created },
    })
  })

  route('routes', 'get', '/routes', '框架层已注册路由清单', [], (_req, res) => {
    res.json({ ok: true, routes })
  })

  route('db-tables', 'get', '/db/tables', '业务库表清单与行数', [], async (_req, res) => {
    const tables = await runtime.db.tables()
    res.json({
      ok: true,
      tables: tables.map(row => row.name),
      counts: Object.fromEntries(tables.map(row => [row.name, row.count])),
    })
  })

  // ── 账号域（PRD-03 承载）────────────────────────────────────────────────────

  route('auth-register', 'post', '/auth/register', '注册新用户', [], async (req, res) => {
    try {
      const body = req.body as { username?: string; password?: string; email?: string }
      const user = await accounts.register({
        username: String(body.username ?? ''),
        password: String(body.password ?? ''),
        ...(body.email === undefined ? {} : { email: String(body.email) }),
      })
      res.status(201).json({ ok: true, user })
    } catch (error) {
      failure(res, error)
    }
  })

  route('auth-login', 'post', '/auth/login', '登录并签发访问/刷新令牌', [], async (req, res) => {
    try {
      const body = req.body as { username?: string; password?: string }
      const result = await accounts.login(String(body.username ?? ''), String(body.password ?? ''))
      // 原生 RPC 的会话归属判定读的是浏览器 cookie：登录成功即把本账号写进同一 authority 的
      // 签名 cookie（与 `dsh web` 的进程令牌换 cookie 是同一条形态，不新造第二套认证）。
      runtime.bindBrowserUser?.(req, res, result.user.id)
      res.json({ ok: true, ...result })
    } catch (error) {
      failure(res, error)
    }
  })

  route('auth-refresh', 'post', '/auth/refresh', '以刷新令牌换新令牌', [], async (req, res) => {
    try {
      const body = req.body as { refreshToken?: string }
      res.json({ ok: true, ...await accounts.refresh(String(body.refreshToken ?? '')) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('auth-logout', 'post', '/auth/logout', '登出（幂等：令牌已失效同样成功；带有效令牌时回显用户）', [], async (req, res) => {
    // 无服务端会话表：令牌自包含且短期有效；登出是客户端丢弃 + 结构化确认。
    // 故**刻意不挂 authenticate**——令牌已过期的客户端也要能登出（否则用户卡在「退不出去」）。
    // 但 `user` 必须是真信息：这里按需校验请求里带的令牌，而不是读一个永不存在的 `req.soloUser`
    // （该字段只在 authenticate 中间件跑过之后才存在，不挂它时恒为 undefined）。
    const header = req.header('authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
    const payload = presented === '' ? undefined : runtime.tokens.verify(presented, 'access')
    const row = payload === undefined ? undefined : await accounts.byId(payload.sub)
    res.json({ ok: true, loggedOut: true, user: row === undefined ? null : toView(row) })
  })

  route('auth-me', 'get', '/auth/me', '当前用户资料', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    // 产品登录态可能比连接 cookie 活得更久（重启或重新打开启动令牌 URL 都换过 cookie）：
    // 每次按 Bearer 证明身份时重签账号绑定，让原生 RPC 的会话归属始终跟随当前登录账号。
    runtime.bindBrowserUser?.(req, res, user.id)
    res.json({ ok: true, user: toView(user) })
  })

  route('auth-profile', 'patch', '/auth/me', '更新当前用户资料/口令', [authenticate], async (req, res) => {
    try {
      const body = req.body as { email?: string; password?: string; currentPassword?: string }
      res.json({ ok: true, user: await accounts.updateProfile((req.soloUser as UserRow).id, body) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('users-list', 'get', '/users', '列全部用户与归属资产计数（超管）', [authenticate, requireSuperuser], async (_req, res) => {
    res.json({ ok: true, users: await accounts.listWithAssets() })
  })

  route('users-active', 'post', '/users/:id/active', '启用/禁用用户（超管；system/自己/最后超管受保护）', [authenticate, requireSuperuser], async (req, res) => {
    try {
      const actor = req.soloUser as UserRow
      const body = req.body as { active?: boolean }
      if (typeof body.active !== 'boolean') throw new FrameworkError(400, 'INVALID_ACTIVE', 'active must be a boolean')
      res.json({ ok: true, user: await accounts.setActive(actor.id, String(req.params.id), body.active) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('users-password', 'post', '/users/:id/password', '重置用户口令（超管；撤销该用户全部令牌）', [authenticate, requireSuperuser], async (req, res) => {
    try {
      const actor = req.soloUser as UserRow
      const body = req.body as { password?: string }
      res.json({ ok: true, user: await accounts.resetPassword(actor.id, String(req.params.id), String(body.password ?? '')) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('users-superuser', 'post', '/users/:id/superuser', '设置/取消超管（system/自己/最后超管受保护）', [authenticate, requireSuperuser], async (req, res) => {
    try {
      const actor = req.soloUser as UserRow
      const body = req.body as { superuser?: boolean }
      if (typeof body.superuser !== 'boolean') {
        throw new FrameworkError(400, 'INVALID_SUPERUSER', 'superuser must be a boolean')
      }
      res.json({ ok: true, user: await accounts.setSuperuser(actor.id, String(req.params.id), body.superuser) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 模型配置（PRD-03 FR-LLM-001~008）────────────────────────────────────────

  route('models-list', 'get', '/models', '列当前用户的模型配置（密钥掩码）', [authenticate], async (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, models: (await runtime.models.list(user.id)).map(row => runtime.models.view(row)) })
  })

  // 模型配置导出：列与用量口径同模型页（`/usage` 的 byModel 聚合），不落第二份统计。
  // 必须先于 `/:id` 登记，否则 `export` 会被当作配置 ID 吞掉。
  route('models-export', 'get', '/models/export', '模型配置导出（CSV：含用量聚合）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const models = (await runtime.models.list(user.id)).map(row => runtime.models.view(row))
      const { byModel } = await runtime.runs.usage(user.id)
      const usage = new Map(byModel.map(row => [row.llm_config_id, row]))
      const lines = ['name,provider,model,base_url,default,active,requests,tokens']
      for (const model of models) {
        const used = usage.get(model.id)
        lines.push([
          model.name,
          model.provider,
          model.model_name,
          model.base_url ?? '',
          model.is_default ? 'true' : 'false',
          model.is_active ? 'true' : 'false',
          String(used?.requests ?? 0),
          String(used?.totalTokens ?? 0),
        ].map(csvField).join(','))
      }
      res.setHeader('content-type', 'text/csv; charset=utf-8')
      res.setHeader('content-disposition', 'attachment; filename="soloengine-models.csv"')
      res.send(`${lines.join('\n')}\n`)
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-create', 'post', '/models', '新建模型配置', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(201).json({ ok: true, model: await runtime.models.create(user.id, req.body as never) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-get', 'get', '/models/:id', '读取单条模型配置', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const row = await runtime.models.byId(user.id, String(req.params.id))
      if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${String(req.params.id)} not found`)
      res.json({ ok: true, model: runtime.models.view(row) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-update', 'patch', '/models/:id', '更新模型配置（乐观锁）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, model: await runtime.models.update(user.id, String(req.params.id), req.body as never) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-delete', 'delete', '/models/:id', '删除模型配置（路由即时注销）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      await runtime.models.remove(user.id, String(req.params.id))
      res.json({ ok: true, deleted: String(req.params.id) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-active', 'post', '/models/:id/active', '启用/停用模型配置', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { active?: unknown }
      if (typeof body.active !== 'boolean') throw new FrameworkError(400, 'INVALID_ACTIVE', 'active must be a boolean')
      res.json({ ok: true, model: await runtime.models.setActive(user.id, String(req.params.id), body.active) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-default', 'post', '/models/:id/default', '设为默认（全用户唯一）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, model: await runtime.models.setDefault(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-test', 'post', '/models/:id/test', '连通性测试（真发一次最小请求，失败六类归因）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, result: await runtime.models.testConnectivity(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 技能（PRD-04 FR-SKILL-001~009）─────────────────────────────────────────

  route('skills-list', 'get', '/skills', '列当前用户技能（含公共）', [authenticate], async (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, skills: (await runtime.skills.list(user.id)).map(row => runtime.skills.view(row, user.id)) })
  })

  route('skills-create', 'post', '/skills', '创建技能包骨架（SKILL.md + 标准目录）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { name?: string; version?: string; description?: string; tags?: string }
      res.status(201).json({
        ok: true,
        skill: await runtime.skills.create(user.id, user.username, String(body.name ?? ''), {
          version: body.version,
          description: body.description,
          tags: body.tags,
        }),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-notes-get', 'get', '/skills/:id/notes', '文件备注读取（PRD-04 FR-SKILL-006：存台账不改包）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, notes: await runtime.skills.getNotes(user.id, String(req.params.id), { isSuperuser: user.is_superuser === 1 }) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-notes-put', 'put', '/skills/:id/notes', '文件备注保存（版本栅栏 + 存台账不改包）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { notes?: Record<string, string>; version?: number }
      const updated = await runtime.skills.setNotes(user.id, String(req.params.id), body.notes ?? {}, {
        isSuperuser: user.is_superuser === 1,
      }, body.version)
      res.json({ ok: true, ...updated })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-import-preview', 'post', '/skills/import/preview', '导入第一阶段：解析元数据与目录树预览', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { archiveBase64?: string; sourcePath?: string }
      const archive = body.archiveBase64 === undefined ? null : new Uint8Array(Buffer.from(body.archiveBase64, 'base64'))
      res.json({ ok: true, preview: runtime.skills.previewImport(user.username, archive, body.sourcePath) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-import-confirm', 'post', '/skills/import/confirm', '导入第二阶段：确认后落盘并登记', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { archiveBase64?: string; sourcePath?: string; fingerprint?: string }
      const archive = body.archiveBase64 === undefined ? null : new Uint8Array(Buffer.from(body.archiveBase64, 'base64'))
      res.status(201).json({
        ok: true,
        skill: await runtime.skills.importConfirmed(user.id, user.username, archive, body.sourcePath, body.fingerprint),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-export', 'get', '/skills/:id/export', '导出技能包（zip，保持目录结构）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const bytes = await runtime.skills.exportArchive(user.id, String(req.params.id))
      res.setHeader('content-type', 'application/zip')
      res.setHeader('content-disposition', `attachment; filename="${String(req.params.id)}.zip"`)
      res.end(Buffer.from(bytes))
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-active', 'post', '/skills/:id/active', '启用/停用技能（热生效；系统技能仅超管）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { active?: unknown }
      if (typeof body.active !== 'boolean') throw new FrameworkError(400, 'INVALID_ACTIVE', 'active must be a boolean')
      res.json({
        ok: true,
        skill: await runtime.skills.setActive(user.id, String(req.params.id), body.active, {
          isSuperuser: user.is_superuser === 1,
        }),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-public', 'post', '/skills/:id/public', '发布/取消发布技能（公共技能对其他用户只读可见）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { public?: boolean }
      res.json({ ok: true, skill: await runtime.skills.setPublic(user.id, String(req.params.id), body.public === true) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-delete', 'delete', '/skills/:id', '删除技能（含目录；系统技能仅超管）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      await runtime.skills.remove(user.id, String(req.params.id), { isSuperuser: user.is_superuser === 1 })
      res.json({ ok: true, deleted: String(req.params.id) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-files', 'get', '/skills/:id/files', '列出技能包内文件树与目录（含空目录）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const id = String(req.params.id)
      const [files, directories] = await Promise.all([
        runtime.skills.listFiles(user.id, id),
        runtime.skills.listDirectories(user.id, id),
      ])
      res.json({ ok: true, files, directories })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-read', 'get', '/skills/:id/file', '读取技能包内单个文件', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, path: String(req.query.path ?? ''), text: await runtime.skills.readFile(user.id, String(req.params.id), String(req.query.path ?? '')) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-write', 'put', '/skills/:id/file', '写入技能包内单个文件（热生效）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { path?: string; text?: string }
      await runtime.skills.writeFile(user.id, String(req.params.id), String(body.path ?? ''), String(body.text ?? ''), {
        isSuperuser: user.is_superuser === 1,
      })
      res.json({ ok: true })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-create', 'post', '/skills/:id/file', '新建技能包内文件', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { path?: string; text?: string }
      await runtime.skills.createFile(user.id, String(req.params.id), String(body.path ?? ''), String(body.text ?? ''), {
        isSuperuser: user.is_superuser === 1,
      })
      res.status(201).json({ ok: true })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-delete', 'delete', '/skills/:id/file', '删除技能包内文件/目录', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { path?: string }
      await runtime.skills.removeFile(user.id, String(req.params.id), String(body.path ?? ''), {
        isSuperuser: user.is_superuser === 1,
      })
      res.json({ ok: true })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-rename', 'post', '/skills/:id/file/rename', '重命名/移动技能包内文件（单次 rename 原子完成）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { from?: string; to?: string }
      await runtime.skills.renameFile(
        user.id,
        String(req.params.id),
        String(body.from ?? ''),
        String(body.to ?? ''),
        { isSuperuser: user.is_superuser === 1 },
      )
      res.json({ ok: true })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── MCP 服务器（PRD-05 FR-MCP-001~010）────────────────────────────────────

  route('mcp-list', 'get', '/mcp', '列当前用户 MCP 服务器（含公共）', [authenticate], async (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, servers: await Promise.all((await runtime.mcp.list(user.id)).map(row => runtime.mcp.view(row))) })
  })

  route('mcp-create', 'post', '/mcp', '注册 MCP 服务器（stdio/http 两类传输）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(201).json({ ok: true, server: await runtime.mcp.view(await runtime.mcp.create(user.id, req.body as never)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-update', 'patch', '/mcp/:id', '更新 MCP 服务器（乐观锁）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, server: await runtime.mcp.view(await runtime.mcp.update(user.id, String(req.params.id), req.body as never, { isSuperuser: user.is_superuser === 1 })) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-active', 'post', '/mcp/:id/active', '启用/停用 MCP 服务器（热挂载/世代回滚）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { active?: unknown }
      if (typeof body.active !== 'boolean') throw new FrameworkError(400, 'INVALID_ACTIVE', 'active must be a boolean')
      res.json({ ok: true, server: await runtime.mcp.view(await runtime.mcp.setActive(user.id, String(req.params.id), body.active, { isSuperuser: user.is_superuser === 1 })) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-delete', 'delete', '/mcp/:id', '删除 MCP 服务器（级联传输子表）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      await runtime.mcp.remove(user.id, user.username, String(req.params.id), { isSuperuser: user.is_superuser === 1 })
      res.json({ ok: true, deleted: String(req.params.id) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-test', 'post', '/mcp/:id/test', 'MCP 连接测试（六类归因）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, result: await runtime.mcp.testConnectivity(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-enumerate', 'post', '/mcp/:id/enumerate', '能力枚举（工具/资源/提示词，结果缓存）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, result: await runtime.mcp.enumerate(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-tool-active', 'post', '/mcp/:id/tools/:tool/active', '单工具启停（PRD-05 FR-MCP-008：停用的工具在挂载时从可见集合收紧）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { active?: unknown }
      if (typeof body.active !== 'boolean') throw new FrameworkError(400, 'INVALID_ACTIVE', 'active must be a boolean')
      const row = await runtime.mcp.setToolActive(user.id, String(req.params.id), String(req.params.tool), body.active, { isSuperuser: user.is_superuser === 1 })
      res.json({ ok: true, server: await runtime.mcp.view(row) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-upload', 'post', '/mcp/upload', '上传建服务（PRD-05 FR-MCP-007：代码/包落用户隔离目录并物化为可运行 stdio 服务器）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { name?: string; kind?: string; code?: string; archiveBase64?: string; description?: string; runtime?: string; timeout?: number }
      const row = await runtime.mcp.createUploaded(user.id, user.username, {
        name: body.name, kind: body.kind, code: body.code, archiveBase64: body.archiveBase64, description: body.description,
        runtime: body.runtime, timeout: body.timeout,
      })
      res.status(201).json({ ok: true, server: await runtime.mcp.view(row) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-files-list', 'get', '/mcp/:id/files', '列服务器文件（上传目录可编辑 / 本机工作目录只读 / HTTP 无本地文件）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, listing: await runtime.mcp.serverFiles(user.id, user.username, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-file-read', 'get', '/mcp/:id/file', '读上传服务器的单个文件（在线编辑的读取侧）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const path = typeof req.query.path === 'string' ? req.query.path : ''
      res.json({ ok: true, file: await runtime.mcp.readServerFile(user.id, user.username, String(req.params.id), path) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-file-write', 'put', '/mcp/:id/file', '写上传服务器的单个文件（在线编辑落盘）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { path?: string; content?: string }
      res.json({ ok: true, file: await runtime.mcp.writeServerFile(user.id, user.username, String(req.params.id), String(body.path ?? ''), String(body.content ?? ''), { isSuperuser: user.is_superuser === 1 }) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-call-tool', 'post', '/mcp/:id/call', '单工具试运行（真实结果或结构化错误）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { tool?: string; args?: Record<string, unknown> }
      res.json({ ok: true, result: await runtime.mcp.callTool(user.id, String(req.params.id), String(body.tool ?? ''), body.args ?? {}) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 画布（agenticflow）与运行项目（PRD-02 FR-CANVAS-001~004/040~041）────────

  route('canvases-list', 'get', '/canvases', '列当前用户画布（含公共模板）', [authenticate], async (req, res) => {
    const user = req.soloUser as UserRow
    // 单行 canvas_data 损坏不拖垮整页：该行以空画布占位并带 `canvas_error`，单张读取仍明确 422。
    res.json({ ok: true, canvases: (await runtime.canvas.list(user.id)).map(row => runtime.canvas.view(row, { tolerant: true })) })
  })

  // 内置角色模板（预填模板，PRD-02 FR-CANVAS-011「预设即预填」）：唯一真源在
  // `@soloengine/types`；节点种类只有 agent/note，模板不改变节点语义。画布内新增的模板
  // 存在画布 `settings.role_presets`，与内置模板合并后使用。
  route('canvases-presets', 'get', '/canvases/meta/presets', '内置角色模板（预填模板，FR-CANVAS-011）', [authenticate], (_req, res) => {
    res.json({ ok: true, presets: BUILTIN_ROLE_PRESETS })
  })

  route('canvases-create', 'post', '/canvases', '新建画布（角色模板由前端选择）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { name?: string; description?: string; icon?: string; tags?: string[]; is_template?: boolean }
      res.status(201).json({ ok: true, canvas: await runtime.canvas.create(user.id, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.icon === undefined ? {} : { icon: body.icon }),
        ...(body.tags === undefined ? {} : { tags: body.tags }),
        ...(body.is_template === undefined ? {} : { is_template: body.is_template }),
      }) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-get', 'get', '/canvases/:id', '读取单张画布', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const row = await runtime.canvas.byId(user.id, String(req.params.id))
      if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${String(req.params.id)} not found`)
      res.json({ ok: true, canvas: runtime.canvas.view(row) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-availability', 'get', '/canvases/:id/availability', '画布引用的技能/MCP 可用性（被删或停用的引用标记）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, ...(await runtime.canvas.availability(user.id, String(req.params.id))) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-duplicate', 'post', '/canvases/:id/duplicate', '复制画布（副本 ID 重建）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(201).json({ ok: true, canvas: await runtime.canvas.duplicate(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-update', 'patch', '/canvases/:id', '更新画布（乐观锁 + 画布 JSON；实例插件差异先校验净组合）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { canvas?: { settings?: { plugins?: unknown } } }
      const plugins = body.canvas?.settings?.plugins
      if (plugins !== undefined) {
        if (plugins === null || typeof plugins !== 'object' || Array.isArray(plugins)) {
          throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID', 'canvas settings.plugins must be an object')
        }
        // 画布保存是实例差异的加载期：组合错误在这里拒绝，不等到运行面板装载。
        runtime.plugins.validateInstanceDiff(String(req.params.id), plugins as InstancePluginDiff)
      }
      res.json({ ok: true, canvas: await runtime.canvas.update(user.id, String(req.params.id), req.body as never) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-plugins-get', 'get', '/canvases/:id/plugins', '实例组合（profile 基线 + 画布插件差异的净结果）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, ...await runtime.plugins.instanceComposition(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-plugins-put', 'put', '/canvases/:id/plugins', '保存画布实例插件差异（先校验净组合，乐观锁）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { diff?: unknown; version?: unknown }
      if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version)) {
        throw new FrameworkError(400, 'VERSION_REQUIRED', 'version is required to save the instance plugin diff')
      }
      if (body.diff === null || typeof body.diff !== 'object' || Array.isArray(body.diff)) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID', 'diff must be an object with disable/replace/add/configure arrays')
      }
      res.json({ ok: true, ...await runtime.plugins.saveInstanceDiff(user.id, String(req.params.id), body.diff, body.version) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-delete', 'delete', '/canvases/:id', '删除画布（级联运行项目、其会话与事件归属行）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, ...await runtime.canvas.remove(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-compile', 'post', '/canvases/:id/compile', '现场编译画布为 Agent 团队（fail loud）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { projectId?: string }
      res.json({ ok: true, result: await runtime.canvas.compile(user.id, String(req.params.id), String(body.projectId ?? '')) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('projects-list', 'get', '/projects', '列当前用户运行项目', [authenticate], async (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, projects: await runtime.canvas.listProjects(user.id) })
  })

  route('projects-ensure', 'post', '/projects', '取得或创建运行项目（用户×画布×目录去重）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { canvasId?: string; folderPath?: string; name?: string }
      res.status(201).json({ ok: true, project: await runtime.canvas.ensureProject(user.id, String(body.canvasId ?? ''), String(body.folderPath ?? ''), body.name) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('projects-touch', 'post', '/projects/:id/touch', '切换当前项目（更新最后访问）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, project: await runtime.canvas.touchProject(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('projects-delete', 'delete', '/projects/:id', '删除运行项目（仍有会话时结构化拒绝）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      await runtime.canvas.removeProject(user.id, String(req.params.id))
      res.json({ ok: true, deleted: String(req.params.id) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 项目沙箱根文件门禁（FR-CANVAS-041 越界拒绝）─────────────────────────────

  route('projects-file-guard', 'post', '/projects/:id/file-guard', '项目内文件路径沙箱根校验（realpath+前缀+loopback）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const project = await runtime.canvas.projectById(user.id, String(req.params.id))
      if (project === undefined) throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${String(req.params.id)} not found`)
      const body = req.body as { path?: string; expectedMtimeMs?: number; mustExist?: boolean }
      const result = gateWorkspacePath({
        root: project.folder_path,
        target: String(body.path ?? ''),
        ...(req.socket.remoteAddress === undefined ? {} : { remoteAddress: req.socket.remoteAddress }),
        ...(body.expectedMtimeMs === undefined ? {} : { expectedMtimeMs: Number(body.expectedMtimeMs) }),
        ...(body.mustExist === true ? {} : { mustExist: false }),
      })
      res.json({ ok: true, ...result })
    } catch (error) {
      if (error instanceof FrameworkError) {
        res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message } })
      } else {
        failure(res, error)
      }
    }
  })

  // ── 工作区文件域与变更台账（PRD-08 FR-OPS-010/012；PRD-09 FR-FC-004~011）──────────
  // 同一组操作与运行面板桥（host 侧 ops-bridge.ts）共用一份处理器表（modules/ops.ts）；
  // 这里只做令牌鉴权与请求归一，操作本体不在本文件重复实现。

  /** 把请求归一成共享操作入参（body 优先、query 次之）。 */
  const opsInput = (req: AuthedRequest, sessionKey: string | null): OpsInput => {
    const body: Record<string, unknown> =
      req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown>
        : {}
    const field = (name: string): unknown => {
      if (body[name] !== undefined) return body[name]
      const value = req.query[name]
      if (value !== undefined && typeof value !== 'string') {
        throw new FrameworkError(400, 'QUERY_INVALID', `query parameter ${name} must be a single string`)
      }
      return value
    }
    const projectId = field('projectId')
    return {
      userId: (req.soloUser as UserRow).id,
      projectId: projectId === undefined ? '' : String(projectId),
      sessionKey,
      remoteAddress: req.socket.remoteAddress ?? undefined,
      field,
    }
  }

  /** 装配一组共享操作：路由描述与处理器同源，不再手写第二份。 */
  const mountOps = (
    prefix: string,
    ops: readonly OpsRoute[],
    sessionKeyOf: (req: AuthedRequest) => string | null,
  ): void => {
    for (const op of ops) {
      route(op.id, op.method, `${prefix}${op.path === '' ? '' : `/${op.path}`}`, op.summary, [authenticate], async (req, res) => {
        try {
          const outcome = await op.handle(runtime, opsInput(req, sessionKeyOf(req)))
          res.status(outcome.status).json(outcome.body)
        } catch (error) {
          failure(res, error)
        }
      })
    }
  }

  // 工作区人写入无会话上下文（归属只到用户与运行项目）；台账接口按请求字段取会话键。
  mountOps('/workspace', WORKSPACE_OPS, () => null)
  mountOps('/changes', CHANGES_OPS, (req) => {
    const body: Record<string, unknown> =
      req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown>
        : {}
    const value = body.sessionKey === undefined ? req.query.sessionKey : body.sessionKey
    return value === undefined || value === null ? null : String(value)
  })

  // ── 变更台账：撤回记录链的标记只由撤回执行器内部调用（`file-changes.ts`）──────
  // 不提供公开的「标记已撤回」路由：没有写回的翻转会让台账与实际磁盘状态脱节。

  // ── 多用户隔离（三层隔离的第 2 层：用户目录物理隔离）────────────────────────
  route('tenancy-me', 'get', '/tenancy/me', '当前用户的隔离目录（技能/MCP/项目）', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    const base = runtime.userDirs.ensure(user.username)
    res.json({
      ok: true,
      username: user.username,
      base,
      dirs: {
        skills: runtime.userDirs.sub(user.username, 'skills'),
        mcp: runtime.userDirs.sub(user.username, 'mcp'),
        projects: runtime.userDirs.sub(user.username, 'projects'),
      },
    })
  })

  route('tenancy-guard', 'post', '/tenancy/guard', '越界校验：路径必须落在当前用户指定子目录内', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    const body = req.body as { kind?: string; path?: string }
    const kind = body.kind === 'mcp' || body.kind === 'projects' ? body.kind : 'skills'
    try {
      const resolved = runtime.userDirs.within(user.username, kind, String(body.path ?? ''))
      res.json({ ok: true, resolved, kind })
    } catch (error) {
      res.status(403).json({ ok: false, error: { code: 'OUT_OF_SANDBOX_ROOT', message: String(error instanceof Error ? error.message : error) } })
    }
  })

  // ── 运行域（PRD-06：现场编译 → mainagent 就位 → 会话归属台账）──────────────────

  route('runs-create', 'post', '/runs', '发起一次运行：现场编译画布 + 建 mainagent + 写归属行', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { canvasId?: string; projectId?: string; folderPath?: string; sessionKey?: string }
      const session = await runtime.runs.createRun(user.id, {
        canvasId: String(body.canvasId ?? ''),
        ...body.projectId === undefined ? {} : { projectId: String(body.projectId) },
        ...body.folderPath === undefined ? {} : { folderPath: String(body.folderPath) },
        ...body.sessionKey === undefined ? {} : { sessionKey: String(body.sessionKey) },
      })
      res.status(201).json({ ok: true, session })
    } catch (error) {
      failure(res, error)
    }
  })

  route('sessions-list', 'get', '/sessions', '列当前用户的运行会话（归属行 + 活状态）', [authenticate], async (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, sessions: await runtime.runs.listSessions(user.id, pageLimit(req, 50, 1000)) })
  })

  route('sessions-get', 'get', '/sessions/:key', '读取单个会话（归属校验）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, session: await runtime.runs.session(user.id, String(req.params.key)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('sessions-events', 'get', '/sessions/:key/events', '读取会话的事件归属行（分页走 (session_id, seq) 主键顺序）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({
        ok: true,
        events: await runtime.runs.events(user.id, String(req.params.key), pageLimit(req, 200, 2000)),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('sessions-prompt', 'post', '/sessions/:key/prompt', '以用户消息推进循环（运行中即排队进入下一 turn）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { text?: string }
      res.json({
        ok: true,
        ...await runtime.runs.prompt(user.id, String(req.params.key), String(body.text ?? '')),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('sessions-cancel', 'post', '/sessions/:key/cancel', '取消当前运行（停止原因落日志）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { reason?: string }
      res.json({ ok: true, session: await runtime.runs.cancel(user.id, String(req.params.key), String(body.reason ?? 'user request')) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('usage', 'get', '/usage', '用量派生（从事件流折叠，按会话与按模型聚合）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, ...await runtime.runs.usage(user.id) })
    } catch (error) {
      failure(res, error)
    }
  })

  // 用量导出（NFR-OBS-002：聚合输出导出可用）。CSV 两节：按模型聚合 + 按会话明细；
  // 数据与 /usage 同一派生（事件流折叠），不落第二副本。首行注释如实标注统计窗口与口径。
  route('usage-export', 'get', '/usage/export', '用量导出（CSV：按模型聚合 + 按会话明细）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const { sessions, byModel, window } = await runtime.runs.usage(user.id)
      const lines: string[] = [
        `# usage window: newest ${String(window.limit)} of ${String(window.total)} sessions; `
        + 'requests = assistant/message with provider usage (failed attempts excluded); '
        + 'duration = step/start -> assistant/message (ms)',
        'section,llm_config_id,agentic_flow_id,session_key,requests,input_tokens,output_tokens,total_tokens,duration_ms,avg_ms,p50_ms,p95_ms',
      ]
      for (const row of byModel) {
        lines.push([
          'byModel', row.llm_config_id, '', '', String(row.requests), String(row.inputTokens),
          String(row.outputTokens), String(row.totalTokens), String(row.durationMs),
          String(row.avgMs), String(row.p50Ms), String(row.p95Ms),
        ].map(csvField).join(','))
      }
      for (const row of sessions) {
        lines.push([
          'bySession', row.llm_config_id ?? '', row.agentic_flow_id, row.sessionKey, String(row.requests),
          String(row.inputTokens), String(row.outputTokens), String(row.totalTokens), String(row.durationMs),
          String(row.requests === 0 ? 0 : Math.round(row.durationMs / row.requests)), '', '',
        ].map(csvField).join(','))
      }
      res.setHeader('content-type', 'text/csv; charset=utf-8')
      res.setHeader('content-disposition', 'attachment; filename="soloengine-usage.csv"')
      res.send(`${lines.join('\n')}\n`)
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 创造模式审计（PRD-06 FR-ENG-030 / PRD-10 FR-SEC-014）────────────────────

  route('audit-creator-list', 'get', '/audit/creator', '创造模式审计清单（按用户过滤）', [authenticate], async (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, audit: await runtime.runs.listCreatorAudit(user.id, pageLimit(req, 100, 1000)) })
  })

  // 审计只由宿主监听官方 `cordis/*` 事件写入（`attachCreatorAudit`）：不接受客户端自报事实。

  // ── 市场（技能/MCP 目录与安装）────────────────────────────────────────────

  route('market-list', 'get', '/market', '市场目录（kind/q/category/sort/featured 过滤与排序）', [authenticate], async (req, res) => {
    try {
      const query = {
        kind: marketQueryString(req, 'kind'),
        q: marketQueryString(req, 'q'),
        category: marketQueryString(req, 'category'),
        sort: marketQueryString(req, 'sort'),
        featured: marketQueryString(req, 'featured'),
      }
      res.json({ ok: true, ...await runtime.market.list(query, (req.soloUser as UserRow).id) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('market-install', 'post', '/market/:id/install', '安装一条市场条目（复用技能/MCP 既有管线）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(201).json({ ok: true, installed: await runtime.market.install(user, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 打包与部署（编译预览 / 产物落盘与读回 / 部署指引）──────────────────────

  route('packaging-preview', 'get', '/packaging/preview', '打包预览（现场编译 + 真实 bundle 层与组合层）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const canvasId = String(req.query.canvasId ?? '')
      const projectId = String(req.query.projectId ?? '')
      // 缺字段是请求问题（400），不是「找不到」：把两者混成 404 会让调用方去查不存在的资源。
      if (canvasId === '') {
        throw new FrameworkError(400, 'CANVAS_REQUIRED', 'canvasId is required: the preview compiles one canvas')
      }
      if (projectId === '') {
        throw new FrameworkError(400, 'PROJECT_REQUIRED',
          'projectId is required: the run project folder becomes the packaged workspace root')
      }
      const preview = await runtime.packaging.preview(user.id, canvasId, projectId)
      res.json({ ok: true, preview })
    } catch (error) {
      failure(res, error)
    }
  })

  route('packaging-run', 'post', '/packaging/run', '真实执行一次打包（编译 → 落盘产物 → 读回校验；可选桌面发行暂存）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as {
        canvasId?: string
        projectId?: string
        confirm?: unknown
        form?: unknown
        desktopProfile?: unknown
        appId?: unknown
      }
      const canvasId = String(body.canvasId ?? '')
      const projectId = String(body.projectId ?? '')
      if (canvasId === '') {
        throw new FrameworkError(400, 'CANVAS_REQUIRED', 'canvasId is required: one packaging run builds one canvas')
      }
      if (projectId === '') {
        throw new FrameworkError(400, 'PROJECT_REQUIRED',
          'projectId is required: the run project folder becomes the packaged workspace root')
      }
      const run = await runtime.packaging.run(
        user.id,
        canvasId,
        projectId,
        body.confirm,
        body.form,
        { profile: body.desktopProfile, appId: body.appId },
      )
      res.status(201).json({ ok: true, run })
    } catch (error) {
      failure(res, error)
    }
  })

  route('packaging-run-get', 'get', '/packaging/runs/:id', '读回一次打包产物（重算文件数与字节数）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, run: runtime.packaging.readRun(String(req.params.id), { userId: user.id, isSuperuser: user.is_superuser === 1 }) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('packaging-desktop-build', 'post', '/packaging/runs/:id/desktop-build', '触发桌面发行封装（安装包 + 免安装目录）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(202).json({ ok: true, run: await runtime.packaging.startDesktopBuild(String(req.params.id), { userId: user.id, isSuperuser: user.is_superuser === 1 }) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('deployment-guide', 'get', '/deployment/guide', '本地部署指引（doctor/start/status 三步与就绪地址）', [authenticate], (_req, res) => {
    res.json({ ok: true, guide: runtime.packaging.guide() })
  })

  // ── 会话导出（真实日志文件 + 归属行；ZIP 真实打包）──────────────────────────

  // `.zip` 路由必须先于 `:key` 登记（否则被 `:key` 吞掉）。
  route('export-session-zip', 'get', '/export/sessions/:key.zip', '导出会话 ZIP（日志原始字节 + sessions.json + events.json）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const key = String(req.params.key)
      const bytes = await runtime.sessionExport.archive(user.id, key)
      res.setHeader('content-type', 'application/zip')
      res.setHeader('content-disposition', `attachment; filename="${key}.zip"`)
      res.end(Buffer.from(bytes))
    } catch (error) {
      failure(res, error)
    }
  })

  route('export-session-manifest', 'get', '/export/sessions/:key', '会话导出清单（真实日志文件与归属行行数）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, ...await runtime.sessionExport.describe(user.id, String(req.params.key)) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 组合与插件清单 ─────────────────────────────────────────────────────────

  route('plugins-list', 'get', '/plugins', '组合与插件清单（profile + 三层 patch 合并后的行）', [authenticate], (_req, res) => {
    try {
      res.json({ ok: true, ...runtime.plugins.list() })
    } catch (error) {
      failure(res, error)
    }
  })

  // 用户级默认插件表（需求 §0.1.4）：新建 agent 节点按它初始化节点插件行；节点未声明插件时
  // 编译/打包回落到它。数据是管理层业务行（`user_default_plugins`），不进入 profile 组合树。
  route('plugins-defaults-get', 'get', '/plugins/defaults', '用户级默认插件表（差异、乐观锁版本与新建节点的插件行）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, ...await runtime.plugins.userDefaults(user.id) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('plugins-defaults-put', 'put', '/plugins/defaults', '保存用户级默认插件表（先校验净组合，乐观锁）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { diff?: unknown; version?: unknown }
      if (typeof body.version !== 'number' || !Number.isSafeInteger(body.version)) {
        throw new FrameworkError(400, 'VERSION_REQUIRED', 'version is required to save the default plugin table')
      }
      if (body.diff === null || typeof body.diff !== 'object' || Array.isArray(body.diff)) {
        throw new FrameworkError(422, 'PLUGIN_DIFF_INVALID', 'diff must be an object with an add array of plugin rows')
      }
      res.json({ ok: true, ...await runtime.plugins.saveUserDefaults(user.id, body.diff as InstancePluginDiff, body.version) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── profile 级插件管理（复用原生 pluginManager；实例运维，仅超管）──────────────
  // 组合包启停/安装/移除都经 host 绑定的原生服务；框架层不写第二套安装器、不碰 profile 文件。

  route('plugins-bundles-get', 'get', '/plugins/bundles', 'profile 组合包清单（启用态、可移除性、坏包原因）', [authenticate, requireSuperuser], async (_req, res) => {
    try {
      res.json({ ok: true, ...await runtime.plugins.managedBundles() })
    } catch (error) {
      failure(res, error)
    }
  })

  route('plugins-bundles-enabled', 'post', '/plugins/bundles/enabled', '启用/停用一个 profile 组合包（热重组语义由原生决定）', [authenticate, requireSuperuser], async (req, res) => {
    try {
      const body = req.body as { name?: unknown; enabled?: unknown }
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw new FrameworkError(422, 'PLUGIN_TARGET_REQUIRED', 'name must be a non-empty bundle package name')
      }
      if (typeof body.enabled !== 'boolean') {
        throw new FrameworkError(422, 'ENABLED_REQUIRED', 'enabled must be a boolean')
      }
      res.json({ ok: true, result: await runtime.plugins.setBundleEnabled(body.name, body.enabled) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('plugins-bundles-remove', 'post', '/plugins/bundles/remove', '移除一个 profile 组合包（原生移除检查与回滚）', [authenticate, requireSuperuser], async (req, res) => {
    try {
      const body = req.body as { name?: unknown }
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw new FrameworkError(422, 'PLUGIN_TARGET_REQUIRED', 'name must be a non-empty bundle package name')
      }
      res.json({ ok: true, result: await runtime.plugins.removeBundle(body.name) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('plugins-inspect', 'post', '/plugins/inspect', '安装前读取规格（包名、路径、Git、tarball）', [authenticate, requireSuperuser], async (req, res) => {
    try {
      const body = req.body as { spec?: unknown }
      if (typeof body.spec !== 'string') {
        throw new FrameworkError(422, 'PLUGIN_SPEC_REQUIRED', 'spec must be a string')
      }
      res.json({ ok: true, inspection: await runtime.plugins.inspectSpec(body.spec) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('plugins-install', 'post', '/plugins/install', '安装并选中一个组合包（原生 pnpm + 组合层写入）', [authenticate, requireSuperuser], async (req, res) => {
    try {
      const body = req.body as { spec?: unknown; requestId?: unknown; enabled?: unknown; approvedBuilds?: unknown }
      if (typeof body.spec !== 'string' || typeof body.requestId !== 'string') {
        throw new FrameworkError(422, 'PLUGIN_SPEC_REQUIRED', 'spec and requestId must be strings')
      }
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        throw new FrameworkError(422, 'ENABLED_REQUIRED', 'enabled must be a boolean when present')
      }
      const approvedBuilds: string[] = []
      if (body.approvedBuilds !== undefined) {
        if (!Array.isArray(body.approvedBuilds) || body.approvedBuilds.some(item => typeof item !== 'string' || item.trim() === '')) {
          throw new FrameworkError(422, 'APPROVED_BUILDS_INVALID', 'approvedBuilds must be an array of package names')
        }
        approvedBuilds.push(...body.approvedBuilds as string[])
      }
      res.json({ ok: true, result: await runtime.plugins.installBundle(body.spec, body.requestId, body.enabled ?? true, approvedBuilds) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('plugins-install-wait', 'get', '/plugins/install/:requestId', '恢复一次丢失响应的安装结果', [authenticate, requireSuperuser], async (req, res) => {
    try {
      res.json({ ok: true, result: await runtime.plugins.waitInstall(String(req.params.requestId)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('plugins-install-cancel', 'post', '/plugins/install/:requestId/cancel', '停止一次安装（文件回滚完成后才返回）', [authenticate, requireSuperuser], async (req, res) => {
    try {
      res.json({ ok: true, cancellation: await runtime.plugins.cancelInstall(String(req.params.requestId)) })
    } catch (error) {
      failure(res, error)
    }
  })

  app.use('/api/solo', api)

  // 未处理错误（处理器里逃逸的异常、写响应过程中的异常）：先落一行可定位日志（方法 + 原始 URL +
  // 完整栈）再按业务错误格式收尾——失败可见、错误可定位（PRD-13 NFR-REL-006/007），不静默、不降级。
  // 不能交给 Express 默认处理器：它按 `Accept` 协商返回 HTML，客户端 `request()` 解析 JSON 时会
  // 退化成「网络错误」，把 4xx 语义与错误码全部丢掉。
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const detail = error instanceof Error ? error.stack ?? error.message : JSON.stringify(error)
    console.log(`soloengine: ${req.method} ${req.originalUrl} failed: ${String(detail)}`)
    if (res.headersSent) {
      res.destroy()
      return
    }
    // 请求体解析等中间件错误带 `status`（如非法 JSON = 400）：保留 4xx 语义。
    const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(status).json({ ok: false, error: { code: 'INVALID_REQUEST', message } })
      return
    }
    failure(res, error)
  })

  // 兜底收敛在 **app 级**（api 内不设终结中间件）：`mountAuthenticated` 在 createRouter
  // 返回之后才追加路由，若在 api 内放终结 404，后追加的路由永远不参与匹配。
  // 未命中的 /api/solo/* 保持结构化 NOT_FOUND；非 /api/solo 路径给出 OUTSIDE_FRAMEWORK_PREFIX。
  app.use((req, res) => {
    const pathname = req.originalUrl.split('?')[0] ?? req.originalUrl
    if (pathname === '/api/solo' || pathname.startsWith('/api/solo/')) {
      res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `no soloengine route for ${req.method} ${req.originalUrl}` } })
      return
    }
    res.status(404).json({ ok: false, error: { code: 'OUTSIDE_FRAMEWORK_PREFIX', message: `soloengine framework serves /api/solo only, got ${req.originalUrl}` } })
  })

  return { app, routes, mountAuthenticated }
}

/**
 * CSV 字段编码：含逗号、引号或换行的值加双引号（引号自身成对转义）。
 *
 * 以 `= + - @` 或制表符/回车开头的单元格会被表格软件当公式执行（CSV 公式注入），
 * 前置单引号使其按文本处理。
 * @param value - 原始字段值。
 * @returns 可直接参与 `join(',')` 的字段文本。
 */
function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value
  return /[",\r\n]/u.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded
}
