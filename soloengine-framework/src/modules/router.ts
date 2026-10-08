/**
 * 框架层 REST 路由装配：Express 应用 + 路由描述表。
 *
 * 依据《SoloEngine 框架设计》§6.1：框架层形态为 Express REST + 数据库；
 * 路由统一挂 `/api/solo/*`，由 `@soloengine/host` 以前缀路由方式挂进 dsh `ctx.webServer`，
 * 与 harness 共用同一条 HTTP 服务（唯一端口）。
 *
 * @module @soloengine/framework/modules/router
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import type { FrameworkRuntime } from '../runtime.ts'
import { gateWorkspacePath } from '../sandbox/workspace-gate.ts'
import { FrameworkError, toView, type UserRow } from './accounts.ts'
import { NODE_PRESETS } from './canvas.ts'

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
  // 业务路由挂在 `/api/solo` 前缀下：host 侧以同前缀的 webServer 前缀路由转发完整 URL，
  // Express 在此剥离前缀后按短路径匹配。
  const api = express.Router()
  const routes: RouteDescriptor[] = []
  const accounts = runtime.accounts

  /** 业务级处理器（链尾，拥有响应）。 */
  type Handler = (req: AuthedRequest, res: Response) => void | Promise<void>
  /** 中间件（链中，调用 next 放行）。 */
  type Middleware = (req: AuthedRequest, res: Response, next: NextFunction) => void

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
        step(req as AuthedRequest, res, next)
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

  /** 鉴权：Bearer 访问令牌 → 请求级身份。 */
  const authenticate = (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const payload = runtime.tokens.verify(token, 'access')
    if (payload === undefined) {
      res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'a valid access token is required' } })
      return
    }
    const row = accounts.byId(payload.sub)
    if (row === undefined || row.is_active !== 1) {
      res.status(403).json({ ok: false, error: { code: 'USER_DISABLED', message: 'user is missing or disabled' } })
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
   * 追加一条「需请求级身份」的路由（原生注入点：host 插件把 harness 侧能力挂进同一条 REST 前缀）。
   * 走同一条 api 路由器、同样登记进 routes 描述表、同样经过 authenticate 中间件；
   * handler 抛 FrameworkError 时仍走 failure()。
   */
  const mountAuthenticated: RouterBundle['mountAuthenticated'] = (descriptor, handler) => {
    route(descriptor.id, descriptor.method, descriptor.path, descriptor.summary, [authenticate], async (req, res) => {
      try {
        const user = req.soloUser
        if (user === undefined) throw new FrameworkError(401, 'UNAUTHENTICATED', 'a valid access token is required')
        const result = await handler({
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

  route('health', 'get', '/health', '框架层健康检查（含真实数据库环境参数）', [], (_req, res) => {
    const environment = runtime.db.environment()
    res.json({
      ok: environment.missingTables.length === 0,
      service: 'soloengine-framework',
      version: '0.1.0',
      database: {
        path: environment.path,
        journalMode: environment.journalMode,
        synchronous: environment.synchronous,
        busyTimeout: environment.busyTimeout,
        tempStore: environment.tempStore,
        userVersion: environment.userVersion,
        foreignKeys: environment.foreignKeys,
        businessTables: environment.businessTables,
        missingTables: environment.missingTables,
      },
      masterKey: { path: runtime.masterKey.path, createdThisBoot: runtime.masterKey.created },
    })
  })

  route('routes', 'get', '/routes', '框架层已注册路由清单', [], (_req, res) => {
    res.json({ ok: true, routes })
  })

  route('db-tables', 'get', '/db/tables', '业务库表清单与行数', [], (_req, res) => {
    const rows = runtime.db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    const counts: Record<string, number> = {}
    for (const { name } of rows) {
      if (name.startsWith('sqlite_')) continue
      counts[name] = Number((runtime.db.raw.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }).c)
    }
    res.json({ ok: true, tables: rows.map(row => row.name), counts })
  })

  // ── 账号域（PRD-03 承载）────────────────────────────────────────────────────

  route('auth-register', 'post', '/auth/register', '注册新用户', [], (req, res) => {
    try {
      const body = req.body as { username?: string; password?: string; email?: string }
      const user = accounts.register({
        username: String(body.username ?? ''),
        password: String(body.password ?? ''),
        ...(body.email === undefined ? {} : { email: String(body.email) }),
      })
      res.status(201).json({ ok: true, user })
    } catch (error) {
      failure(res, error)
    }
  })

  route('auth-login', 'post', '/auth/login', '登录并签发访问/刷新令牌', [], (req, res) => {
    try {
      const body = req.body as { username?: string; password?: string }
      const result = accounts.login(String(body.username ?? ''), String(body.password ?? ''))
      res.json({ ok: true, ...result })
    } catch (error) {
      failure(res, error)
    }
  })

  route('auth-refresh', 'post', '/auth/refresh', '以刷新令牌换新令牌', [], (req, res) => {
    try {
      const body = req.body as { refreshToken?: string }
      res.json({ ok: true, ...accounts.refresh(String(body.refreshToken ?? '')) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('auth-logout', 'post', '/auth/logout', '登出（幂等：令牌已失效同样成功；带有效令牌时回显用户）', [], (req, res) => {
    // 无服务端会话表：令牌自包含且短期有效；登出是客户端丢弃 + 结构化确认。
    // 故**刻意不挂 authenticate**——令牌已过期的客户端也要能登出（否则用户卡在「退不出去」）。
    // 但 `user` 必须是真信息：这里按需校验请求里带的令牌，而不是读一个永不存在的 `req.soloUser`
    // （该字段只在 authenticate 中间件跑过之后才存在，不挂它时恒为 undefined）。
    const header = req.header('authorization') ?? ''
    const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
    const payload = presented === '' ? undefined : runtime.tokens.verify(presented, 'access')
    const row = payload === undefined ? undefined : accounts.byId(payload.sub)
    res.json({ ok: true, loggedOut: true, user: row === undefined ? null : toView(row) })
  })

  route('auth-me', 'get', '/auth/me', '当前用户资料', [authenticate], (req, res) => {
    res.json({ ok: true, user: toView(req.soloUser as UserRow) })
  })

  route('auth-profile', 'patch', '/auth/me', '更新当前用户资料/口令', [authenticate], (req, res) => {
    try {
      const body = req.body as { email?: string; password?: string }
      res.json({ ok: true, user: accounts.updateProfile((req.soloUser as UserRow).id, body) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('users-list', 'get', '/users', '列全部用户（超管）', [authenticate, requireSuperuser], (_req, res) => {
    res.json({ ok: true, users: accounts.list().map(toView) })
  })

  route('users-active', 'post', '/users/:id/active', '启用/禁用用户（超管）', [authenticate, requireSuperuser], (req, res) => {
    try {
      const body = req.body as { active?: boolean }
      res.json({ ok: true, user: accounts.setActive(String(req.params.id), body.active !== false) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('users-superuser', 'post', '/users/:id/superuser', '设置/取消超管（超管）', [authenticate, requireSuperuser], (req, res) => {
    try {
      const body = req.body as { superuser?: boolean }
      res.json({ ok: true, user: accounts.setSuperuser(String(req.params.id), body.superuser !== false) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 模型配置（PRD-03 FR-LLM-001~008）────────────────────────────────────────

  route('models-list', 'get', '/models', '列当前用户的模型配置（密钥掩码）', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, models: runtime.models.list(user.id).map(row => runtime.models.view(row)) })
  })

  route('models-create', 'post', '/models', '新建模型配置', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(201).json({ ok: true, model: runtime.models.create(user.id, req.body as never) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-get', 'get', '/models/:id', '读取单条模型配置', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const row = runtime.models.byId(user.id, String(req.params.id))
      if (row === undefined) throw new FrameworkError(404, 'CONFIG_NOT_FOUND', `model config ${String(req.params.id)} not found`)
      res.json({ ok: true, model: runtime.models.view(row) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-update', 'patch', '/models/:id', '更新模型配置（乐观锁）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, model: runtime.models.update(user.id, String(req.params.id), req.body as never) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-delete', 'delete', '/models/:id', '删除模型配置（路由即时注销）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      runtime.models.remove(user.id, String(req.params.id))
      res.json({ ok: true, deleted: String(req.params.id) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-active', 'post', '/models/:id/active', '启用/停用模型配置', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { active?: boolean }
      res.json({ ok: true, model: runtime.models.setActive(user.id, String(req.params.id), body.active !== false) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('models-default', 'post', '/models/:id/default', '设为默认（全用户唯一）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, model: runtime.models.setDefault(user.id, String(req.params.id)) })
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

  route('skills-list', 'get', '/skills', '列当前用户技能（含公共）', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, skills: runtime.skills.list(user.id).map(row => runtime.skills.view(row)) })
  })

  route('skills-create', 'post', '/skills', '创建技能包骨架（SKILL.md + 标准目录）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { name?: string; version?: string }
      res.status(201).json({ ok: true, skill: runtime.skills.create(user.id, user.username, String(body.name ?? ''), body.version) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-notes-get', 'get', '/skills/:id/notes', '文件备注读取（PRD-04 FR-SKILL-006：存台账不改包）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, notes: runtime.skills.getNotes(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-notes-put', 'put', '/skills/:id/notes', '文件备注保存（PRD-04 FR-SKILL-006：存台账不改包）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { notes?: Record<string, string> }
      res.json({ ok: true, notes: runtime.skills.setNotes(user.id, String(req.params.id), body.notes ?? {}) })
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

  route('skills-import-confirm', 'post', '/skills/import/confirm', '导入第二阶段：确认后落盘并登记', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { archiveBase64?: string; sourcePath?: string }
      const archive = body.archiveBase64 === undefined ? null : new Uint8Array(Buffer.from(body.archiveBase64, 'base64'))
      res.status(201).json({ ok: true, skill: runtime.skills.importConfirmed(user.id, user.username, archive, body.sourcePath) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-export', 'get', '/skills/:id/export', '导出技能包（zip，保持目录结构）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const bytes = runtime.skills.exportArchive(user.id, String(req.params.id))
      res.setHeader('content-type', 'application/zip')
      res.setHeader('content-disposition', `attachment; filename="${String(req.params.id)}.zip"`)
      res.end(Buffer.from(bytes))
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-active', 'post', '/skills/:id/active', '启用/停用技能（热生效）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { active?: boolean }
      res.json({ ok: true, skill: runtime.skills.setActive(user.id, String(req.params.id), body.active !== false) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-delete', 'delete', '/skills/:id', '删除技能（含目录）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      runtime.skills.remove(user.id, String(req.params.id))
      res.json({ ok: true, deleted: String(req.params.id) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-files', 'get', '/skills/:id/files', '列出技能包内文件树', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, files: runtime.skills.listFiles(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-read', 'get', '/skills/:id/file', '读取技能包内单个文件', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, path: String(req.query.path ?? ''), text: runtime.skills.readFile(user.id, String(req.params.id), String(req.query.path ?? '')) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-write', 'put', '/skills/:id/file', '写入技能包内单个文件（热生效）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { path?: string; text?: string }
      runtime.skills.writeFile(user.id, String(req.params.id), String(body.path ?? ''), String(body.text ?? ''))
      res.json({ ok: true })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-create', 'post', '/skills/:id/file', '新建技能包内文件', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { path?: string; text?: string }
      runtime.skills.createFile(user.id, String(req.params.id), String(body.path ?? ''), String(body.text ?? ''))
      res.status(201).json({ ok: true })
    } catch (error) {
      failure(res, error)
    }
  })

  route('skills-file-delete', 'delete', '/skills/:id/file', '删除技能包内文件/目录', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { path?: string }
      runtime.skills.removeFile(user.id, String(req.params.id), String(body.path ?? ''))
      res.json({ ok: true })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── MCP 服务器（PRD-05 FR-MCP-001~010）────────────────────────────────────

  route('mcp-list', 'get', '/mcp', '列当前用户 MCP 服务器（含公共）', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, servers: runtime.mcp.list(user.id).map(row => runtime.mcp.view(row)) })
  })

  route('mcp-create', 'post', '/mcp', '注册 MCP 服务器（stdio/http 两类传输）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(201).json({ ok: true, server: runtime.mcp.view(runtime.mcp.create(user.id, req.body as never)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-update', 'patch', '/mcp/:id', '更新 MCP 服务器（乐观锁）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, server: runtime.mcp.view(runtime.mcp.update(user.id, String(req.params.id), req.body as never)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-active', 'post', '/mcp/:id/active', '启用/停用 MCP 服务器（热挂载/世代回滚）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { active?: boolean }
      res.json({ ok: true, server: runtime.mcp.view(runtime.mcp.setActive(user.id, String(req.params.id), body.active !== false)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-delete', 'delete', '/mcp/:id', '删除 MCP 服务器（级联传输子表）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      runtime.mcp.remove(user.id, String(req.params.id))
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

  route('mcp-tool-active', 'post', '/mcp/:id/tools/:tool/active', '单工具启停（PRD-05 FR-MCP-008：停用的工具在挂载时从可见集合收紧）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { active?: boolean }
      const row = runtime.mcp.setToolActive(user.id, String(req.params.id), String(req.params.tool), body.active !== false)
      res.json({ ok: true, server: runtime.mcp.view(row) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-upload', 'post', '/mcp/upload', '上传建服务（PRD-05 FR-MCP-007：代码/包落用户隔离目录并物化为可运行 stdio 服务器）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { name?: string; kind?: string; code?: string; archiveBase64?: string; description?: string }
      const row = runtime.mcp.createUploaded(user.id, user.username, {
        name: body.name, kind: body.kind, code: body.code, archiveBase64: body.archiveBase64, description: body.description,
      })
      res.status(201).json({ ok: true, server: runtime.mcp.view(row) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-files-list', 'get', '/mcp/:id/files', '列上传服务器的文件（在线查看）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, files: runtime.mcp.listServerFiles(user.id, user.username, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-file-read', 'get', '/mcp/:id/file', '读上传服务器的单个文件（在线编辑的读取侧）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const path = typeof req.query.path === 'string' ? req.query.path : ''
      res.json({ ok: true, file: runtime.mcp.readServerFile(user.id, user.username, String(req.params.id), path) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('mcp-file-write', 'put', '/mcp/:id/file', '写上传服务器的单个文件（在线编辑落盘）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { path?: string; content?: string }
      res.json({ ok: true, file: runtime.mcp.writeServerFile(user.id, user.username, String(req.params.id), String(body.path ?? ''), String(body.content ?? '')) })
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

  route('canvases-list', 'get', '/canvases', '列当前用户画布（含公共模板）', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, canvases: runtime.canvas.list(user.id).map(row => runtime.canvas.view(row)) })
  })

  // 三类节点预设（预填模板，PRD-02 FR-CANVAS-011「预设即预填」）：唯一真源在本模块的
  // NODE_PRESETS，编辑器新增节点时按类型取用（前端不另立第二份清单）。
  route('canvases-presets', 'get', '/canvases/meta/presets', '三类节点预设（预填模板，FR-CANVAS-011）', [authenticate], (_req, res) => {
    res.json({ ok: true, presets: NODE_PRESETS })
  })

  route('canvases-create', 'post', '/canvases', '新建画布（三类节点预设由前端选择）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { name?: string; description?: string; icon?: string; tags?: string[]; is_template?: boolean }
      res.status(201).json({ ok: true, canvas: runtime.canvas.create(user.id, {
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

  route('canvases-get', 'get', '/canvases/:id', '读取单张画布', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const row = runtime.canvas.byId(user.id, String(req.params.id))
      if (row === undefined) throw new FrameworkError(404, 'CANVAS_NOT_FOUND', `canvas ${String(req.params.id)} not found`)
      res.json({ ok: true, canvas: runtime.canvas.view(row) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-duplicate', 'post', '/canvases/:id/duplicate', '复制画布（副本 ID 重建）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(201).json({ ok: true, canvas: runtime.canvas.duplicate(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-update', 'patch', '/canvases/:id', '更新画布（乐观锁 + 画布 JSON）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, canvas: runtime.canvas.update(user.id, String(req.params.id), req.body as never) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('canvases-delete', 'delete', '/canvases/:id', '删除画布（级联运行项目、其会话与事件归属行）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, ...runtime.canvas.remove(user.id, String(req.params.id)) })
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

  route('projects-list', 'get', '/projects', '列当前用户运行项目', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    res.json({ ok: true, projects: runtime.canvas.listProjects(user.id) })
  })

  route('projects-ensure', 'post', '/projects', '取得或创建运行项目（用户×画布×目录去重）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { canvasId?: string; folderPath?: string; name?: string }
      res.status(201).json({ ok: true, project: runtime.canvas.ensureProject(user.id, String(body.canvasId ?? ''), String(body.folderPath ?? ''), body.name) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('projects-touch', 'post', '/projects/:id/touch', '切换当前项目（更新最后访问）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, project: runtime.canvas.touchProject(user.id, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 项目沙箱根文件门禁（FR-CANVAS-041 越界拒绝）─────────────────────────────

  route('projects-file-guard', 'post', '/projects/:id/file-guard', '项目内文件路径沙箱根校验（realpath+前缀+loopback）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const project = runtime.canvas.projectById(user.id, String(req.params.id))
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

  // ── 工作区文件域（PRD-08 FR-OPS-010 / FR-OPS-012：读写分治 + 沙箱根约束）──────
  // 读（列举/行窗口/stat/搜索）与**人写入**（写入/新建/重命名/删除）全部经
  // gateWorkspacePath 四判据；沙箱根 = 该用户名下的运行项目目录（folder_path）。

  /** 取单个字符串 query（重复/对象形态一律拒绝，不静默取首个）。 */
  const queryString = (req: AuthedRequest, name: string): string => {
    const value = req.query[name]
    if (value === undefined) return ''
    if (typeof value !== 'string') {
      throw new FrameworkError(400, 'QUERY_INVALID', `query parameter ${name} must be a single string`)
    }
    return value
  }

  /** 请求来源（loopback 判定用）。 */
  const remoteOf = (req: AuthedRequest): string | undefined => req.socket.remoteAddress ?? undefined

  route('workspace-list', 'get', '/workspace/list', '列举沙箱根内一层目录（懒加载）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({
        ok: true,
        listing: runtime.workspace.list(user.id, queryString(req, 'projectId'), queryString(req, 'path'), remoteOf(req)),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('workspace-stat', 'get', '/workspace/stat', '沙箱根内单条路径 stat（版本 = mtimeMs）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({
        ok: true,
        stat: runtime.workspace.stat(user.id, queryString(req, 'projectId'), queryString(req, 'path'), remoteOf(req)),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('workspace-read', 'get', '/workspace/read', '沙箱根内文件行窗口读取（分页）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const offset = queryString(req, 'offset')
      const limit = queryString(req, 'limit')
      res.json({
        ok: true,
        file: runtime.workspace.read(user.id, queryString(req, 'projectId'), queryString(req, 'path'), {
          ...offset === '' ? {} : { offset: Number(offset) },
          ...limit === '' ? {} : { limit: Number(limit) },
          ...remoteOf(req) === undefined ? {} : { remoteAddress: remoteOf(req) },
        }),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('workspace-search', 'get', '/workspace/search', '沙箱根内按名称递归搜索（跳过 .git/node_modules）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({
        ok: true,
        ...runtime.workspace.search(user.id, queryString(req, 'projectId'), queryString(req, 'q'), remoteOf(req)),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('workspace-write', 'put', '/workspace/file', '写入沙箱根内文件（mtime 冲突检测；编辑器保存）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { projectId?: string; path?: string; text?: string; expectedMtimeMs?: number }
      res.json({
        ok: true,
        result: runtime.workspace.write(
          user.id,
          String(body.projectId ?? ''),
          String(body.path ?? ''),
          String(body.text ?? ''),
          {
            ...body.expectedMtimeMs === undefined ? {} : { expectedMtimeMs: Number(body.expectedMtimeMs) },
            ...remoteOf(req) === undefined ? {} : { remoteAddress: remoteOf(req) },
          },
        ),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('workspace-mkdir', 'post', '/workspace/directory', '新建沙箱根内目录（双确认）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { projectId?: string; path?: string; confirm?: boolean }
      res.status(201).json({
        ok: true,
        ...runtime.workspace.mkdir(user.id, String(body.projectId ?? ''), String(body.path ?? ''), body.confirm === true, remoteOf(req)),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('workspace-rename', 'post', '/workspace/rename', '重命名/移动沙箱根内条目（双确认 + mtime 冲突）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { projectId?: string; from?: string; to?: string; confirm?: boolean; expectedMtimeMs?: number }
      res.json({
        ok: true,
        ...runtime.workspace.rename(
          user.id,
          String(body.projectId ?? ''),
          String(body.from ?? ''),
          String(body.to ?? ''),
          body.confirm === true,
          {
            ...body.expectedMtimeMs === undefined ? {} : { expectedMtimeMs: Number(body.expectedMtimeMs) },
            ...remoteOf(req) === undefined ? {} : { remoteAddress: remoteOf(req) },
          },
        ),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('workspace-delete', 'delete', '/workspace/entry', '删除沙箱根内文件或目录（双确认）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { projectId?: string; path?: string; confirm?: boolean }
      res.json({
        ok: true,
        ...runtime.workspace.remove(user.id, String(body.projectId ?? ''), String(body.path ?? ''), body.confirm === true, remoteOf(req)),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 文件变更台账（PRD-09 FR-FC-011：按会话/回合/文件过滤 + 统计）──────────────

  route('changes-list', 'get', '/changes', '变更台账查询（按会话/回合/文件过滤；含 hunks）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const sessionKey = queryString(req, 'sessionKey')
      const turn = queryString(req, 'turn')
      const filePath = queryString(req, 'filePath')
      const limit = queryString(req, 'limit')
      const query = {
        ...sessionKey === '' ? {} : { sessionKey },
        ...turn === '' ? {} : { turn: Number(turn) },
        ...filePath === '' ? {} : { filePath },
        ...limit === '' ? {} : { limit: Number(limit) },
      }
      res.json({ ok: true, changes: runtime.changes.list(user.id, query), summary: runtime.changes.summary(user.id, query) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 变更台账：审阅、回合视图与撤回（PRD-09 FR-FC-004~011）───────────────────

  route('changes-turn-view', 'get', '/changes/turn', '回合视图（同文件多次写入聚合为净变更，过程视图可展开）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const turn = queryString(req, 'turn')
      if (turn === '') throw new FrameworkError(400, 'TURN_REQUIRED', 'turn is required for the turn view')
      res.json({
        ok: true,
        sessionKey: queryString(req, 'sessionKey'),
        turn: Number(turn),
        entries: runtime.changes.turnView(user.id, queryString(req, 'sessionKey'), Number(turn)),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('changes-review', 'post', '/changes/review', '审阅：整轮/逐文件/逐 hunk 保留或丢弃（只标记，不动磁盘）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as {
        sessionKey?: string; turn?: number; filePath?: string; changeId?: string
        status?: string; hunkIds?: string[]
      }
      if (body.status !== 'accepted' && body.status !== 'rejected') {
        throw new FrameworkError(400, 'REVIEW_STATUS_INVALID', 'status must be accepted or rejected')
      }
      res.json({
        ok: true,
        ...runtime.changes.review({
          userId: user.id,
          sessionKey: String(body.sessionKey ?? ''),
          ...body.turn === undefined ? {} : { turn: Number(body.turn) },
          ...body.filePath === undefined ? {} : { filePath: String(body.filePath) },
          ...body.changeId === undefined ? {} : { changeId: String(body.changeId) },
          status: body.status,
          ...body.hunkIds === undefined ? {} : { hunkIds: body.hunkIds },
        }),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('changes-revert-plan', 'get', '/changes/revert/plan', '撤回计划（还原项 + 漂移跳过项；执行前确认用）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const turn = queryString(req, 'turn')
      const changeId = queryString(req, 'changeId')
      const plan = runtime.changes.revertPlan(
        user.id,
        queryString(req, 'sessionKey'),
        turn === '' ? null : Number(turn),
        changeId === '' ? undefined : [changeId],
      )
      res.json({ ok: true, plan })
    } catch (error) {
      failure(res, error)
    }
  })

  route('changes-revert', 'post', '/changes/revert', '执行按轮次撤回（最小还原 + 漂移检测；经守卫写回并补发观测）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { sessionKey?: string; turn?: number; changeIds?: string[]; confirm?: boolean }
      if (body.confirm !== true) {
        throw new FrameworkError(400, 'CONFIRMATION_REQUIRED',
          'a revert requires an explicit confirmation (confirm: true) after reviewing the restore list')
      }
      res.json({
        ok: true,
        ...await runtime.changes.revert({
          userId: user.id,
          sessionKey: String(body.sessionKey ?? ''),
          turn: body.turn === undefined ? null : Number(body.turn),
          ...body.changeIds === undefined ? {} : { changeIds: body.changeIds },
          actor: { kind: 'soloengine-revert', userId: user.id, sessionKey: String(body.sessionKey ?? '') },
        }),
      })
    } catch (error) {
      failure(res, error)
    }
  })

  route('changes-mark-reverted', 'post', '/changes/mark-reverted', '把已还原的记录标记为 reverted（撤回记录链的一环）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { changeIds?: string[] }
      const ids = Array.isArray(body.changeIds) ? body.changeIds.map(String) : []
      res.json({ ok: true, updated: runtime.changes.markReverted(user.id, ids) })
    } catch (error) {
      failure(res, error)
    }
  })

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
      const body = req.body as { canvasId?: string; projectId?: string; sessionKey?: string }
      const session = await runtime.runs.createRun(user.id, {
        canvasId: String(body.canvasId ?? ''),
        projectId: String(body.projectId ?? ''),
        ...body.sessionKey === undefined ? {} : { sessionKey: String(body.sessionKey) },
      })
      res.status(201).json({ ok: true, session })
    } catch (error) {
      failure(res, error)
    }
  })

  route('sessions-list', 'get', '/sessions', '列当前用户的运行会话（归属行 + 活状态）', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    const limit = Number(req.query.limit ?? 50)
    res.json({ ok: true, sessions: runtime.runs.listSessions(user.id, Number.isFinite(limit) ? limit : 50) })
  })

  route('sessions-get', 'get', '/sessions/:key', '读取单个会话（归属校验）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, session: runtime.runs.session(user.id, String(req.params.key)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('sessions-events', 'get', '/sessions/:key/events', '读取会话的事件归属行（分页走 (session_id, seq) 主键顺序）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const limit = Number(req.query.limit ?? 200)
      res.json({
        ok: true,
        events: runtime.runs.events(user.id, String(req.params.key), Number.isFinite(limit) ? limit : 200),
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
  // 数据与 /usage 同一派生（事件流折叠），不落第二副本。
  route('usage-export', 'get', '/usage/export', '用量导出（CSV：按模型聚合 + 按会话明细）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const { sessions, byModel } = await runtime.runs.usage(user.id)
      const lines: string[] = ['section,llm_config_id,agentic_flow_id,session_key,requests,input_tokens,output_tokens,total_tokens']
      for (const row of byModel) {
        lines.push(['byModel', row.llm_config_id, '', '', String(row.requests), String(row.inputTokens), String(row.outputTokens), String(row.totalTokens)].join(','))
      }
      for (const row of sessions) {
        lines.push(['bySession', row.llm_config_id ?? '', row.agentic_flow_id, row.sessionKey, String(row.requests), String(row.inputTokens), String(row.outputTokens), String(row.totalTokens)].join(','))
      }
      res.setHeader('content-type', 'text/csv; charset=utf-8')
      res.setHeader('content-disposition', 'attachment; filename="soloengine-usage.csv"')
      res.send(`${lines.join('\n')}\n`)
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 创造模式审计（PRD-06 FR-ENG-030 / PRD-10 FR-SEC-014）────────────────────

  route('audit-creator-list', 'get', '/audit/creator', '创造模式审计清单（按用户过滤）', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    const limit = Number(req.query.limit ?? 100)
    res.json({ ok: true, audit: runtime.runs.listCreatorAudit(user.id, Number.isFinite(limit) ? limit : 100) })
  })

  route('audit-creator-record', 'post', '/audit/creator', '记录一条创造模式审计（动作即落库，含失败）', [authenticate], (req, res) => {
    const user = req.soloUser as UserRow
    const body = req.body as { kind?: string; ok?: boolean; detail?: string }
    const id = runtime.runs.recordCreatorAudit({
      kind: String(body.kind ?? 'unknown'),
      userId: user.id,
      ok: body.ok === true,
      detail: String(body.detail ?? ''),
    })
    res.status(201).json({ ok: true, id })
  })

  // ── 市场（技能/MCP 目录与安装）────────────────────────────────────────────

  route('market-list', 'get', '/market', '市场目录（kind/q/category/sort/featured 过滤与排序）', [authenticate], (req, res) => {
    try {
      const query = {
        kind: marketQueryString(req, 'kind'),
        q: marketQueryString(req, 'q'),
        category: marketQueryString(req, 'category'),
        sort: marketQueryString(req, 'sort'),
        featured: marketQueryString(req, 'featured'),
      }
      res.json({ ok: true, ...runtime.market.list(query) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('market-install', 'post', '/market/:id/install', '安装一条市场条目（复用技能/MCP 既有管线）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.status(201).json({ ok: true, installed: runtime.market.install(user, String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  // ── 打包与部署（编译预览 / 产物落盘与读回 / 部署指引）──────────────────────

  route('packaging-preview', 'get', '/packaging/preview', '打包预览（现场编译 + 真实 bundle 层与组合层）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const preview = await runtime.packaging.preview(
        user.id,
        String(req.query.canvasId ?? ''),
        String(req.query.projectId ?? ''),
      )
      res.json({ ok: true, preview })
    } catch (error) {
      failure(res, error)
    }
  })

  route('packaging-run', 'post', '/packaging/run', '真实执行一次打包（编译 → 落盘产物 → 读回校验）', [authenticate], async (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const body = req.body as { canvasId?: string; projectId?: string; confirm?: unknown }
      const run = await runtime.packaging.run(
        user.id,
        String(body.canvasId ?? ''),
        String(body.projectId ?? ''),
        body.confirm,
      )
      res.status(201).json({ ok: true, run })
    } catch (error) {
      failure(res, error)
    }
  })

  route('packaging-run-get', 'get', '/packaging/runs/:id', '读回一次打包产物（重算文件数与字节数）', [authenticate], (req, res) => {
    try {
      res.json({ ok: true, run: runtime.packaging.readRun(String(req.params.id)) })
    } catch (error) {
      failure(res, error)
    }
  })

  route('deployment-guide', 'get', '/deployment/guide', '本地部署指引（doctor/start/status 三步与就绪地址）', [authenticate], (_req, res) => {
    res.json({ ok: true, guide: runtime.packaging.guide() })
  })

  // ── 会话导出（真实日志文件 + 归属行；ZIP 真实打包）──────────────────────────

  // `.zip` 路由必须先于 `:key` 登记（否则被 `:key` 吞掉）。
  route('export-session-zip', 'get', '/export/sessions/:key.zip', '导出会话 ZIP（日志原始字节 + sessions.json + events.json）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      const key = String(req.params.key)
      const bytes = runtime.sessionExport.archive(user.id, key)
      res.setHeader('content-type', 'application/zip')
      res.setHeader('content-disposition', `attachment; filename="${key}.zip"`)
      res.end(Buffer.from(bytes))
    } catch (error) {
      failure(res, error)
    }
  })

  route('export-session-manifest', 'get', '/export/sessions/:key', '会话导出清单（真实日志文件与归属行行数）', [authenticate], (req, res) => {
    try {
      const user = req.soloUser as UserRow
      res.json({ ok: true, ...runtime.sessionExport.describe(user.id, String(req.params.key)) })
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

  app.use('/api/solo', api)

  // 未处理错误（处理器里逃逸的异常、写响应过程中的异常）：先落一行可定位日志（方法 + 原始 URL +
  // 完整栈）再收尾——失败可见、错误可定位（PRD-13 NFR-REL-006/007），不静默、不降级。
  app.use((error: unknown, req: Request, res: Response, next: NextFunction): void => {
    const detail = error instanceof Error ? error.stack ?? error.message : JSON.stringify(error)
    console.log(`soloengine: ${req.method} ${req.originalUrl} failed: ${String(detail)}`)
    if (res.headersSent) {
      res.destroy()
      return
    }
    next(error)
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
