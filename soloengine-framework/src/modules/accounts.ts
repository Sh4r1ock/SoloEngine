/**
 * 账号域（PRD-03 承载）：注册 / 登录 / 登出 / 令牌签发与刷新 / 资料 / 启停 / 超管 /
 * 密码哈希 / 最后登录。
 *
 * 隔离纪律（PRD-10 FR-SEC-012）：业务查询一律按 `user_id` 过滤；公共资产 `user_id` 为空可见。
 *
 * @module @soloengine/framework/modules/accounts
 */

import type { BusinessDatabase } from '../db/port.ts'
import { isUniqueViolation } from '../db/port.ts'
import { hashPassword, newId, newUserId, verifyPassword } from '../auth/index.ts'
import type { FrameworkRuntime } from '../runtime.ts'

/** users 表行（真实列）。 */
export interface UserRow {
  id: string
  username: string
  email: string | null
  hashed_password: string
  is_active: number
  is_superuser: number
  created_at: string | null
  updated_at: string | null
  last_login: string | null
  version: number
  /** 令牌版本（重置口令后自增；旧令牌按载荷 `tv` 比对失效）。 */
  token_version: number
}

/** 对外用户视图（永不包含口令哈希）。 */
export interface UserView {
  id: string
  username: string
  email: string | null
  is_active: boolean
  is_superuser: boolean
  created_at: string | null
  updated_at: string | null
  last_login: string | null
  version: number
  /** 实例内置账号（当前规则：`system`），不可停用/降级；当前登录账号由前端按 id 另行判定。 */
  protected: boolean
}

/** 归属资产计数（超管用户列表概览）。 */
export interface UserAssetCounts {
  canvases: number
  projects: number
  models: number
  skills: number
  mcpServers: number
  sessions: number
}

/** 登录名约束：登录名直接成为用户隔离目录名，只允许目录安全字符（与 `safeDirectoryName` 同一集合）。 */
export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u

/** Windows 设备名：同名目录无法创建，注册时直接拒绝。 */
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu

/** 结构化业务错误（fail loud：错误直接报出，不回退默认值）。 */
export class FrameworkError extends Error {
  /** HTTP 状态码。 */
  readonly status: number
  /** 机器可读错误码。 */
  readonly code: string
  /**
   * @param status - HTTP 状态码。
   * @param code - 机器可读错误码。
   * @param message - 人类可读原因。
   */
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'FrameworkError'
    this.status = status
    this.code = code
  }
}

/** 账号域服务。 */
export class AccountService {
  private readonly db: BusinessDatabase
  private readonly tokens: FrameworkRuntime['tokens']

  /**
   * @param runtime - 框架层运行时（业务库与令牌服务）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.db = runtime.db
    this.tokens = runtime.tokens
  }

  /** 按用户名取行。 */
  async byUsername(username: string): Promise<UserRow | undefined> {
    return await this.db.prepare('SELECT * FROM users WHERE username = ?').get<UserRow>(username)
  }

  /**
   * 按大小写折叠的用户名取行（注册唯一性判据）。
   *
   * 用户目录由登录名派生，Windows 上 `Alice` 与 `alice` 是同一个目录；唯一性必须比物理目录更严。
   * @param username - 登录名。
   * @returns 首个同名（忽略大小写）的账号行。
   */
  async byUsernameFolded(username: string): Promise<UserRow | undefined> {
    return await this.db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get<UserRow>(username)
  }

  /** 按 ID 取行。 */
  async byId(id: string): Promise<UserRow | undefined> {
    return await this.db.prepare('SELECT * FROM users WHERE id = ?').get<UserRow>(id)
  }

  /** 按邮箱取行。 */
  async byEmail(email: string): Promise<UserRow | undefined> {
    return await this.db.prepare('SELECT * FROM users WHERE email = ?').get<UserRow>(email)
  }

  /** 列全部用户（超管视图）。 */
  async list(): Promise<UserRow[]> {
    return await this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all<UserRow>()
  }

  /**
   * 注册。
   * @param input - 用户名/口令/邮箱。
   * @returns 用户视图。
   */
  async register(input: { username: string; password: string; email?: string }): Promise<UserView> {
    const username = input.username.trim()
    if (username === '') throw new FrameworkError(400, 'USERNAME_REQUIRED', 'username is required')
    if (!USERNAME_PATTERN.test(username)) {
      throw new FrameworkError(400, 'USERNAME_INVALID',
        'username must be 1-64 characters of letters, digits, dot, dash or underscore, starting with a letter or digit')
    }
    if (WINDOWS_RESERVED_NAMES.test(username)) {
      throw new FrameworkError(400, 'USERNAME_INVALID', `username ${username} is a reserved device name`)
    }
    if (input.password.length < 4) throw new FrameworkError(400, 'PASSWORD_TOO_SHORT', 'password must be at least 4 characters')
    // 登录名大小写折叠唯一：登录名直接成为用户隔离目录名，而 Windows 文件系统大小写不敏感，
    // `Alice` 与 `alice` 会落进同一个目录（跨用户共享技能/MCP/项目）。同一物理目录只允许一个账号。
    const folded = await this.byUsernameFolded(username)
    if (folded !== undefined) {
      throw new FrameworkError(409, 'USERNAME_TAKEN', `username ${username} already exists`)
    }
    if (input.email !== undefined && input.email !== '' && await this.byEmail(input.email) !== undefined) {
      throw new FrameworkError(409, 'EMAIL_TAKEN', `email ${input.email} already exists`)
    }
    const now = new Date().toISOString()
    const row: UserRow = {
      id: newUserId(),
      username,
      email: input.email === undefined || input.email === '' ? null : input.email,
      hashed_password: hashPassword(input.password),
      is_active: 1,
      is_superuser: 0,
      created_at: now,
      updated_at: now,
      last_login: null,
      version: 1,
      token_version: 0,
    }
    try {
      await this.db.prepare(
        `INSERT INTO users (id, username, email, hashed_password, is_active, is_superuser, created_at, updated_at, last_login, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.username, row.email, row.hashed_password, row.is_active, row.is_superuser, row.created_at, row.updated_at, row.last_login, row.version)
    } catch (error) {
      // 先查后插的竞态：并发同名/同邮箱由唯一约束兜底，转成可区分的 409（不把约束串回前端）。
      // 唯一约束本身区分大小写，故折叠判定仍要重查一次。
      if (isUniqueViolation(error)) {
        if (await this.byUsernameFolded(username) !== undefined) {
          throw new FrameworkError(409, 'USERNAME_TAKEN', `username ${username} already exists`)
        }
        if (input.email !== undefined && input.email !== '' && await this.byEmail(input.email) !== undefined) {
          throw new FrameworkError(409, 'EMAIL_TAKEN', `email ${input.email} already exists`)
        }
      }
      throw error
    }
    return toView(row)
  }

  /**
   * 登录：校验口令与启用状态，写最后登录，签发访问/刷新令牌。
   * @param username - 登录名。
   * @param password - 口令。
   * @returns 令牌与用户视图。
   */
  async login(username: string, password: string): Promise<{ accessToken: string; refreshToken: string; user: UserView }> {
    // 登录名按大小写折叠匹配：注册的唯一性判据就是折叠后的名字（同一物理目录只允许一个账号），
    // 精确匹配会让 `Alice` 注册后无法用 `alice` 登录（两处判据必须同一套）。
    const row = await this.byUsernameFolded(username.trim())
    if (row === undefined) throw new FrameworkError(401, 'INVALID_CREDENTIALS', 'username or password is incorrect')
    if (!verifyPassword(password, row.hashed_password)) {
      throw new FrameworkError(401, 'INVALID_CREDENTIALS', 'username or password is incorrect')
    }
    if (row.is_active !== 1) throw new FrameworkError(403, 'USER_DISABLED', `user ${username} is disabled`)
    const now = new Date().toISOString()
    await this.db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(now, now, row.id)
    return {
      accessToken: this.tokens.sign(row.id, 'access', 12 * 60 * 60 * 1000, row.token_version),
      refreshToken: this.tokens.sign(row.id, 'refresh', 30 * 24 * 60 * 60 * 1000, row.token_version),
      user: toView({ ...row, last_login: now, updated_at: now }),
    }
  }

  /**
   * 刷新令牌：以刷新令牌换新的一对令牌（旧访问令牌自然过期）。
   * @param refreshToken - 刷新令牌。
   * @returns 新令牌与用户视图。
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; user: UserView }> {
    const payload = this.tokens.verify(refreshToken, 'refresh')
    if (payload === undefined) throw new FrameworkError(401, 'INVALID_REFRESH_TOKEN', 'refresh token is invalid or expired')
    const row = await this.byId(payload.sub)
    if (row === undefined) throw new FrameworkError(401, 'UNKNOWN_USER', 'token subject no longer exists')
    if (row.is_active !== 1) throw new FrameworkError(403, 'USER_DISABLED', `user ${row.username} is disabled`)
    // 超管重置口令后令牌版本自增：旧刷新令牌不得换出新令牌（R007）。
    if ((payload.tv ?? 0) !== (row.token_version ?? 0)) {
      throw new FrameworkError(401, 'INVALID_REFRESH_TOKEN', 'refresh token was revoked')
    }
    return {
      accessToken: this.tokens.sign(row.id, 'access', 12 * 60 * 60 * 1000, row.token_version),
      refreshToken: this.tokens.sign(row.id, 'refresh', 30 * 24 * 60 * 60 * 1000, row.token_version),
      user: toView(row),
    }
  }

  /**
   * 更新资料（用户名 / 邮箱）。
   * @param id - 用户 ID。
   * @param patch - 待更新字段。
   * @returns 用户视图。
   */
  async updateProfile(id: string, patch: { email?: string; password?: string; currentPassword?: string }): Promise<UserView> {
    const row = await this.byId(id)
    if (row === undefined) throw new FrameworkError(404, 'USER_NOT_FOUND', `user ${id} not found`)
    // 先跑完全部前置校验再写：邮箱先落库、口令校验随后失败会留下半更新（用户以为整次修改失败）。
    if (patch.password !== undefined) {
      // 改密必须证明持有当前口令：仅凭被盗的 access token 不能改密（R006）。
      if (patch.currentPassword === undefined || patch.currentPassword === '') {
        throw new FrameworkError(400, 'CURRENT_PASSWORD_REQUIRED', 'currentPassword is required to change the password')
      }
      if (!verifyPassword(patch.currentPassword, row.hashed_password)) {
        throw new FrameworkError(403, 'CURRENT_PASSWORD_INVALID', 'currentPassword is incorrect')
      }
      if (patch.password.length < 4) throw new FrameworkError(400, 'PASSWORD_TOO_SHORT', 'password must be at least 4 characters')
    }
    if (patch.email !== undefined) {
      const existing = await this.byEmail(patch.email)
      if (existing !== undefined && existing.id !== id) {
        throw new FrameworkError(409, 'EMAIL_TAKEN', `email ${patch.email} already exists`)
      }
    }
    const now = new Date().toISOString()
    await this.db.transaction(async tx => {
      if (patch.email !== undefined) {
        await tx.prepare('UPDATE users SET email = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(patch.email === '' ? null : patch.email, now, id)
      }
      if (patch.password !== undefined) {
        // 自助改密同样撤销已签发令牌（与超管重置同一语义 R007）：旧访问/刷新令牌不得在
        // 口令已变之后继续代表该账号。改密成功后调用方需要重新登录。
        await tx.prepare(
          'UPDATE users SET hashed_password = ?, token_version = token_version + 1, updated_at = ?, version = version + 1 WHERE id = ?',
        ).run(hashPassword(patch.password), now, id)
      }
    })
    return toView(await this.byId(id) as UserRow)
  }

  /**
   * 超管重置某用户口令（W11.1；不要求当前口令，权限由超管守卫承担）。
   *
   * 令牌版本自增：该用户已签发的访问/刷新令牌立即失效（R007），旧口令同时失效。
   *
   * @param actorId - 执行操作的超管 ID（审计归属）。
   * @param id - 目标用户 ID。
   * @param password - 新口令（至少 4 位）。
   * @returns 用户视图。
   */
  async resetPassword(actorId: string, id: string, password: string): Promise<UserView> {
    const row = await this.byId(id)
    if (row === undefined) throw new FrameworkError(404, 'USER_NOT_FOUND', `user ${id} not found`)
    if (password.length < 4) throw new FrameworkError(400, 'PASSWORD_TOO_SHORT', 'password must be at least 4 characters')
    const now = new Date().toISOString()
    await this.db.prepare(
      'UPDATE users SET hashed_password = ?, token_version = token_version + 1, updated_at = ?, version = version + 1 WHERE id = ?',
    ).run(hashPassword(password), now, id)
    await this.audit(actorId, 'admin.user.password', { target: id, username: row.username })
    return toView(await this.byId(id) as UserRow)
  }

  /**
   * 启用/禁用用户。
   *
   * 禁用受三道守卫（条件 UPDATE 防并发）：system 账号、操作者自己、最后一个启用中的超管。
   *
   * @param actorId - 执行操作的超管 ID。
   * @param id - 用户 ID。
   * @param active - 目标状态。
   * @returns 用户视图。
   */
  async setActive(actorId: string, id: string, active: boolean): Promise<UserView> {
    const row = await this.byId(id)
    if (row === undefined) throw new FrameworkError(404, 'USER_NOT_FOUND', `user ${id} not found`)
    const now = new Date().toISOString()
    if (active) {
      await this.db.prepare('UPDATE users SET is_active = 1, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(now, id)
    } else {
      this.assertNotProtected(actorId, row, 'disable')
      // 条件 UPDATE：两个超管并发互停时，只有「仍剩至少一个启用超管」的那次能落地。
      const result = await this.db.prepare(
        `UPDATE users SET is_active = 0, updated_at = ?, version = version + 1
         WHERE id = ?
           AND (is_superuser = 0 OR (SELECT COUNT(*) FROM users WHERE is_superuser = 1 AND is_active = 1) > 1)`,
      ).run(now, id)
      if (result.changes === 0) {
        throw new FrameworkError(409, 'LAST_SUPERUSER', 'at least one active superuser must remain')
      }
    }
    await this.audit(actorId, 'admin.user.active', { target: id, username: row.username, active })
    return toView(await this.byId(id) as UserRow)
  }

  /**
   * 设置/取消超管。
   *
   * 降级受两道守卫（条件 UPDATE 防并发）：system 账号、操作者自己、最后一个超管。
   *
   * @param actorId - 执行操作的超管 ID。
   * @param id - 用户 ID。
   * @param superuser - 目标状态。
   * @returns 用户视图。
   */
  async setSuperuser(actorId: string, id: string, superuser: boolean): Promise<UserView> {
    const row = await this.byId(id)
    if (row === undefined) throw new FrameworkError(404, 'USER_NOT_FOUND', `user ${id} not found`)
    const now = new Date().toISOString()
    if (superuser) {
      await this.db.prepare('UPDATE users SET is_superuser = 1, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(now, id)
    } else {
      this.assertNotProtected(actorId, row, 'demote')
      const result = await this.db.prepare(
        `UPDATE users SET is_superuser = 0, updated_at = ?, version = version + 1
         WHERE id = ? AND (SELECT COUNT(*) FROM users WHERE is_superuser = 1) > 1`,
      ).run(now, id)
      if (result.changes === 0) {
        throw new FrameworkError(409, 'LAST_SUPERUSER', 'at least one superuser must remain')
      }
    }
    await this.audit(actorId, 'admin.user.superuser', { target: id, username: row.username, superuser })
    return toView(await this.byId(id) as UserRow)
  }

  /**
   * 列全部用户 + 归属资产计数（超管列表页概览；一次查询，不逐用户发 N+1）。
   *
   * 返回扁平的用户视图并附 `assets`：老调用方仍能按 `users[].username` 读取（向后兼容）。
   *
   * @returns 用户视图与各资产表按 `user_id` 的计数。
   */
  async listWithAssets(): Promise<(UserView & { assets: UserAssetCounts })[]> {
    const rows = await this.db.prepare(
      `SELECT u.*,
         (SELECT COUNT(*) FROM agentic_flows WHERE user_id = u.id) AS canvases,
         (SELECT COUNT(*) FROM run_projects WHERE user_id = u.id) AS projects,
         (SELECT COUNT(*) FROM llm_configs WHERE user_id = u.id) AS models,
         (SELECT COUNT(*) FROM skills_packages WHERE user_id = u.id) AS skills,
         (SELECT COUNT(*) FROM mcp_servers WHERE user_id = u.id) AS mcp_servers,
         (SELECT COUNT(*) FROM sessions WHERE user_id = u.id) AS sessions
       FROM users u ORDER BY u.created_at ASC`,
    ).all<UserRow & Record<'canvases' | 'projects' | 'models' | 'skills' | 'mcp_servers' | 'sessions', number>>()
    return rows.map(row => ({
      ...toView(row),
      assets: {
        canvases: Number(row.canvases),
        projects: Number(row.projects),
        models: Number(row.models),
        skills: Number(row.skills),
        mcpServers: Number(row.mcp_servers),
        sessions: Number(row.sessions),
      },
    }))
  }

  /**
   * 受保护账号守卫：system 与操作者自己不可停用/降级。
   * @param actorId - 执行操作的超管 ID。
   * @param row - 目标用户行。
   * @param action - 动作（决定报错措辞）。
   */
  private assertNotProtected(actorId: string, row: UserRow, action: 'disable' | 'demote'): void {
    if (row.username === 'system') {
      throw new FrameworkError(409, 'USER_PROTECTED', `the system account cannot be ${action === 'disable' ? 'disabled' : 'demoted'}`)
    }
    if (row.id === actorId) {
      throw new FrameworkError(409, 'USER_PROTECTED', `you cannot ${action === 'disable' ? 'disable' : 'demote'} your own account`)
    }
  }

  /**
   * 超管操作审计（复用 `creator_audit` 表，kind 以 `admin.` 前缀区分；不新增表）。
   * @param actorId - 执行操作的用户 ID。
   * @param kind - 操作种类。
   * @param detail - 结构化详情（目标用户与动作参数）。
   */
  private async audit(actorId: string, kind: string, detail: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString()
    await this.db.prepare(
      'INSERT INTO creator_audit (id, kind, at, user_id, ok, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), kind, now, actorId, 1, JSON.stringify(detail), now)
  }

  /**
   * 确保 system 种子账号存在（超管、口令 system）。
   * @returns 种子行与是否本次创建。
   */
  async seedSystem(): Promise<{ user: UserView; created: boolean }> {
    const existing = await this.byUsername('system')
    if (existing !== undefined) {
      if (existing.is_superuser !== 1) {
        // 种子账号在本次启动前就已存在、却不是超管：注册是开放的，同名行可能来自第三方
        // 抢注。静默提权会把别人的账号变成超管；这里 fail loud，由部署者显式处理该行。
        throw new FrameworkError(409, 'SEED_ACCOUNT_CONFLICT',
          'a non-superuser account named "system" already exists; refusing to elevate an account this seed did not create')
      }
      return { user: toView(existing), created: false }
    }
    let created: UserView
    try {
      created = await this.register({ username: 'system', password: 'system' })
    } catch (error) {
      // 多节点并发首启：另一节点已插入同名行时，重读并补设超管（不覆盖口令）。
      if (error instanceof FrameworkError && error.code === 'USERNAME_TAKEN') {
        const raced = await this.byUsername('system')
        if (raced !== undefined) {
          const user = raced.is_superuser === 1 ? toView(raced) : await this.setSuperuser(raced.id, raced.id, true)
          return { user, created: false }
        }
      }
      throw error
    }
    return { user: await this.setSuperuser(created.id, created.id, true), created: true }
  }

  /**
   * 确保演示账号存在（普通用户、登录名 solo / 口令 soloengine）。
   *
   * 登录页的「演示账号」提示直接使用这组凭据（原型 `login.html`），账号缺失时提示即为死链。
   * 已存在同名账号时不动其口令与权限。
   * @returns 账号视图与是否本次创建。
   */
  async seedDemo(): Promise<{ user: UserView; created: boolean }> {
    const existing = await this.byUsername('solo')
    if (existing !== undefined) return { user: toView(existing), created: false }
    try {
      return { user: await this.register({ username: 'solo', password: 'soloengine' }), created: true }
    } catch (error) {
      // 多节点并发首启：另一节点已插入同名行时重读，视为已存在（不覆盖口令）。
      if (error instanceof FrameworkError && error.code === 'USERNAME_TAKEN') {
        const raced = await this.byUsername('solo')
        if (raced !== undefined) return { user: toView(raced), created: false }
      }
      throw error
    }
  }
}

/** 行 → 对外视图。 */
export function toView(row: UserRow): UserView {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    is_active: row.is_active === 1,
    is_superuser: row.is_superuser === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login: row.last_login,
    version: row.version,
    // 受保护判据与 assertNotProtected 的 system 守卫同一条规则，页面不再自行硬编码账号名。
    protected: row.username === 'system',
  }
}
