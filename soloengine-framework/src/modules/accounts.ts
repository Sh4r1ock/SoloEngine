/**
 * 账号域（PRD-03 承载）：注册 / 登录 / 登出 / 令牌签发与刷新 / 资料 / 启停 / 超管 /
 * 密码哈希 / 最后登录。
 *
 * 隔离纪律（PRD-10 FR-SEC-012）：业务查询一律按 `user_id` 过滤；公共资产 `user_id` 为空可见。
 *
 * @module @soloengine/framework/modules/accounts
 */

import type { DatabaseSync } from 'node:sqlite'
import { hashPassword, newUserId, verifyPassword } from '../auth/index.ts'
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
}

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
  private readonly raw: DatabaseSync
  private readonly tokens: FrameworkRuntime['tokens']

  /**
   * @param runtime - 框架层运行时（业务库与令牌服务）。
   */
  constructor(runtime: FrameworkRuntime) {
    this.raw = runtime.db.raw
    this.tokens = runtime.tokens
  }

  /** users 表访问器（同库同连接）。 */
  private get users(): DatabaseSync {
    return this.raw
  }

  /** 按用户名取行。 */
  byUsername(username: string): UserRow | undefined {
    return this.users.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
  }

  /** 按 ID 取行。 */
  byId(id: string): UserRow | undefined {
    return this.users.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  }

  /** 按邮箱取行。 */
  byEmail(email: string): UserRow | undefined {
    return this.users.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
  }

  /** 列全部用户（超管视图）。 */
  list(): UserRow[] {
    return this.users.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as unknown as UserRow[]
  }

  /**
   * 注册。
   * @param input - 用户名/口令/邮箱。
   * @returns 用户视图。
   */
  register(input: { username: string; password: string; email?: string }): UserView {
    if (input.username.trim() === '') throw new FrameworkError(400, 'USERNAME_REQUIRED', 'username is required')
    if (input.password.length < 4) throw new FrameworkError(400, 'PASSWORD_TOO_SHORT', 'password must be at least 4 characters')
    if (this.byUsername(input.username) !== undefined) {
      throw new FrameworkError(409, 'USERNAME_TAKEN', `username ${input.username} already exists`)
    }
    if (input.email !== undefined && input.email !== '' && this.byEmail(input.email) !== undefined) {
      throw new FrameworkError(409, 'EMAIL_TAKEN', `email ${input.email} already exists`)
    }
    const now = new Date().toISOString()
    const row: UserRow = {
      id: newUserId(),
      username: input.username,
      email: input.email === undefined || input.email === '' ? null : input.email,
      hashed_password: hashPassword(input.password),
      is_active: 1,
      is_superuser: 0,
      created_at: now,
      updated_at: now,
      last_login: null,
      version: 1,
    }
    this.users.prepare(
      `INSERT INTO users (id, username, email, hashed_password, is_active, is_superuser, created_at, updated_at, last_login, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.username, row.email, row.hashed_password, row.is_active, row.is_superuser, row.created_at, row.updated_at, row.last_login, row.version)
    return toView(row)
  }

  /**
   * 登录：校验口令与启用状态，写最后登录，签发访问/刷新令牌。
   * @param username - 登录名。
   * @param password - 口令。
   * @returns 令牌与用户视图。
   */
  login(username: string, password: string): { accessToken: string; refreshToken: string; user: UserView } {
    const row = this.byUsername(username)
    if (row === undefined) throw new FrameworkError(401, 'INVALID_CREDENTIALS', 'username or password is incorrect')
    if (!verifyPassword(password, row.hashed_password)) {
      throw new FrameworkError(401, 'INVALID_CREDENTIALS', 'username or password is incorrect')
    }
    if (row.is_active !== 1) throw new FrameworkError(403, 'USER_DISABLED', `user ${username} is disabled`)
    const now = new Date().toISOString()
    this.users.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(now, now, row.id)
    return {
      accessToken: this.tokens.sign(row.id, 'access', 12 * 60 * 60 * 1000),
      refreshToken: this.tokens.sign(row.id, 'refresh', 30 * 24 * 60 * 60 * 1000),
      user: toView({ ...row, last_login: now, updated_at: now }),
    }
  }

  /**
   * 刷新令牌：以刷新令牌换新的一对令牌（旧访问令牌自然过期）。
   * @param refreshToken - 刷新令牌。
   * @returns 新令牌与用户视图。
   */
  refresh(refreshToken: string): { accessToken: string; refreshToken: string; user: UserView } {
    const payload = this.tokens.verify(refreshToken, 'refresh')
    if (payload === undefined) throw new FrameworkError(401, 'INVALID_REFRESH_TOKEN', 'refresh token is invalid or expired')
    const row = this.byId(payload.sub)
    if (row === undefined) throw new FrameworkError(401, 'UNKNOWN_USER', 'token subject no longer exists')
    if (row.is_active !== 1) throw new FrameworkError(403, 'USER_DISABLED', `user ${row.username} is disabled`)
    return {
      accessToken: this.tokens.sign(row.id, 'access', 12 * 60 * 60 * 1000),
      refreshToken: this.tokens.sign(row.id, 'refresh', 30 * 24 * 60 * 60 * 1000),
      user: toView(row),
    }
  }

  /**
   * 更新资料（用户名 / 邮箱）。
   * @param id - 用户 ID。
   * @param patch - 待更新字段。
   * @returns 用户视图。
   */
  updateProfile(id: string, patch: { email?: string; password?: string }): UserView {
    const row = this.byId(id)
    if (row === undefined) throw new FrameworkError(404, 'USER_NOT_FOUND', `user ${id} not found`)
    const now = new Date().toISOString()
    if (patch.email !== undefined) {
      const existing = this.byEmail(patch.email)
      if (existing !== undefined && existing.id !== id) {
        throw new FrameworkError(409, 'EMAIL_TAKEN', `email ${patch.email} already exists`)
      }
      this.users.prepare('UPDATE users SET email = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(patch.email === '' ? null : patch.email, now, id)
    }
    if (patch.password !== undefined) {
      if (patch.password.length < 4) throw new FrameworkError(400, 'PASSWORD_TOO_SHORT', 'password must be at least 4 characters')
      this.users.prepare('UPDATE users SET hashed_password = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(hashPassword(patch.password), now, id)
    }
    return toView(this.byId(id) as UserRow)
  }

  /**
   * 启用/禁用用户。
   * @param id - 用户 ID。
   * @param active - 目标状态。
   * @returns 用户视图。
   */
  setActive(id: string, active: boolean): UserView {
    const row = this.byId(id)
    if (row === undefined) throw new FrameworkError(404, 'USER_NOT_FOUND', `user ${id} not found`)
    const now = new Date().toISOString()
    this.users.prepare('UPDATE users SET is_active = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(active ? 1 : 0, now, id)
    return toView(this.byId(id) as UserRow)
  }

  /**
   * 设置/取消超管。
   * @param id - 用户 ID。
   * @param superuser - 目标状态。
   * @returns 用户视图。
   */
  setSuperuser(id: string, superuser: boolean): UserView {
    const row = this.byId(id)
    if (row === undefined) throw new FrameworkError(404, 'USER_NOT_FOUND', `user ${id} not found`)
    const now = new Date().toISOString()
    this.users.prepare('UPDATE users SET is_superuser = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(superuser ? 1 : 0, now, id)
    return toView(this.byId(id) as UserRow)
  }

  /**
   * 确保 system 种子账号存在（超管、口令 system）。
   * @returns 种子行与是否本次创建。
   */
  seedSystem(): { user: UserView; created: boolean } {
    const existing = this.byUsername('system')
    if (existing !== undefined) {
      if (existing.is_superuser !== 1) {
        return { user: this.setSuperuser(existing.id, true), created: false }
      }
      return { user: toView(existing), created: false }
    }
    const created = this.register({ username: 'system', password: 'system' })
    return { user: this.setSuperuser(created.id, true), created: true }
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
  }
}
