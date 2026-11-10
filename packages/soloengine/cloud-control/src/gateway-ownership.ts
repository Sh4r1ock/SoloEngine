/**
 * 云网关的用户归属装配（W10.6 / 需求 §0.1.4 的云形态）。
 *
 * 网关的 `sessionOwnership` 需要两个事实：请求已验证的账号、会话在共享业务台账里的归属。
 * 账号令牌的签名与过期判定完全复用框架层 `TokenService`（同一份主密钥、同一套载荷），
 * 不复制令牌格式；会话归属读共享业务库的 `sessions.user_id`，与节点判定同一份真源。
 *
 * 只校验令牌签名、类型与过期：令牌版本（超管重置口令后的撤销）仍由节点在业务请求上判定，
 * 网关只做路由期的归属闸门，不代替节点的账号校验。
 *
 * @module @soloengine/cloud-control/gateway-ownership
 */

import { existsSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { TokenService } from '@soloengine/framework/auth'
import { MasterKey } from '@soloengine/framework/crypto'
import { headerValue, type GatewaySessionOwnership } from './gateway.ts'

/** 账号访问令牌的请求头前缀（与框架层 REST 的 Bearer 形态同一份凭据）。 */
const BEARER_PREFIX = 'bearer '

/** 共享业务台账里会话归属的读取面。 */
export interface SessionOwnerLookup {
  /**
   * 读会话的归属用户。
   * @param sessionKey - 会话键（`sessions.session_key`）。
   * @returns 归属用户 id；会话尚未登记时为 undefined。
   */
  ownerOf(sessionKey: string): Promise<string | undefined>
}

/** 网关归属装配参数。 */
export interface GatewayOwnershipOptions {
  /** 账号令牌服务（与节点同一份主密钥派生）。 */
  tokens: TokenService
  /** 共享业务台账的会话归属读取面。 */
  sessions: SessionOwnerLookup
}

/**
 * 用真实账号令牌组装网关的会话归属校验。
 *
 * `Authorization: Bearer <access token>` 是网关唯一接受的账号凭据；缺失、格式非法、
 * 签名不符或已过期的令牌一律视为「没有已验证账号」，由网关按 fail closed 拒绝。
 * @param options - 令牌服务与共享台账读取面。
 * @returns 可直接传给 `CloudGateway` 的 `sessionOwnership`。
 */
export function bearerSessionOwnership(options: GatewayOwnershipOptions): GatewaySessionOwnership {
  return {
    userIdOf: (request: IncomingMessage) => {
      const value = headerValue(request, 'authorization')
      if (value === '' || !value.toLowerCase().startsWith(BEARER_PREFIX)) return undefined
      const token = value.slice(BEARER_PREFIX.length).trim()
      if (token === '') return undefined
      return options.tokens.verify(token, 'access')?.sub
    },
    ownerOf: sessionKey => options.sessions.ownerOf(sessionKey),
  }
}

/** 共享业务库后端的最小契约（在模块边界校验，避免控制面核心在编译期依赖 `pg`）。 */
interface BusinessBackend {
  PgBusinessDatabase: {
    open(url: string): Promise<{
      prepare(sql: string): { get<T>(...params: string[]): Promise<T | undefined> }
      close(): Promise<void>
    }>
  }
}

/**
 * 判定动态加载的模块是否提供 `PgBusinessDatabase.open`。
 * @param value - 动态 import 的结果。
 * @returns 是否满足可选后端契约。
 */
function isBusinessBackend(value: unknown): value is BusinessBackend {
  if (typeof value !== 'object' || value === null) return false
  const database: unknown = Reflect.get(value, 'PgBusinessDatabase')
  if (typeof database !== 'function') return false
  return typeof Reflect.get(database, 'open') === 'function'
}

/**
 * 按需加载共享业务库（`sessions.user_id` 真源）。
 *
 * 业务库后端包自带 `pg` 依赖；未安装时给出安装指引而不是笼统的模块解析错误。
 * @param databaseUrl - 共享业务库连接串（与节点同一个库）。
 * @returns 会话归属读取面与关闭钩子。
 */
export async function openSessionOwners(
  databaseUrl: string,
): Promise<SessionOwnerLookup & { close(): Promise<void> }> {
  const specifier = '@soloengine/business-db-postgres'
  let loaded: unknown
  try {
    loaded = await import(specifier)
  } catch (error) {
    throw new Error(
      'SOLOENGINE_DATABASE_URL is set but @soloengine/business-db-postgres is not installed; '
      + 'install that optional package (it owns the `pg` dependency) so the gateway can read session owners',
      { cause: error },
    )
  }
  if (!isBusinessBackend(loaded)) {
    throw new Error(`${specifier} does not export PgBusinessDatabase.open`)
  }
  const database = await loaded.PgBusinessDatabase.open(databaseUrl)
  return {
    ownerOf: async (sessionKey) => {
      const row = await database
        .prepare('SELECT user_id FROM sessions WHERE session_key = ?')
        .get<{ user_id: string }>(sessionKey)
      return row?.user_id
    },
    close: () => database.close(),
  }
}

/**
 * 打开网关的用户归属校验：共享主密钥 + 共享业务库。
 *
 * 主密钥必须已存在于部署的密钥目录：网关只校验节点签发的令牌，自己新建一份会让所有
 * 既有令牌失效，因此缺失即阻断启动（fail loud），不回退到「不校验」。
 * @param options - 密钥目录（与节点同一份 `SOLOENGINE_KEYS_DIR`）与共享业务库连接串。
 * @returns 归属校验与关闭钩子。
 */
export async function openGatewaySessionOwnership(options: {
  keysDir: string
  databaseUrl: string
}): Promise<{ ownership: GatewaySessionOwnership; close: () => Promise<void> }> {
  const keyPath = join(options.keysDir, 'master.key')
  if (!existsSync(keyPath)) {
    throw new Error(
      `the gateway must share the deployment master key with the nodes, but ${keyPath} does not exist; `
      + 'point SOLOENGINE_KEYS_DIR at the deployed key directory',
    )
  }
  const master = new MasterKey(keyPath)
  if (master.created) {
    throw new Error(`the gateway created ${keyPath} instead of reusing the deployment key; refusing to start`)
  }
  const sessions = await openSessionOwners(options.databaseUrl)
  return {
    ownership: bearerSessionOwnership({ tokens: new TokenService(master), sessions }),
    close: () => sessions.close(),
  }
}
