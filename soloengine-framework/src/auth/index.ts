/**
 * 密码哈希与账号令牌。
 *
 * 依据 PRD-03 账号域：密码哈希（scrypt，逐用户随机盐）、令牌签发与刷新、最后登录。
 * 令牌为 HMAC-SHA256 签名的自包含串（`<payload-b64url>.<sig-b64url>`），
 * 签名密钥取自主密钥派生子密钥——与密钥加密同源，不额外落盘明文秘密。
 *
 * @module @soloengine/framework/auth
 */

import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { safeEqual, type MasterKey } from '../crypto/index.ts'

/** scrypt 参数（N=16384, r=8, p=1 → 32 字节派生）。 */
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

/** 口令哈希格式：`scrypt$<salt-hex>$<hash-hex>`。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

/** 校验口令；格式非法一律视为不匹配（不抛错）。 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const saltText = parts[1]
  const expectedText = parts[2]
  if (saltText === undefined || expectedText === undefined) return false
  // 形状先判：32 hex 盐 + 64 hex 哈希（32 字节）。否则 `scrypt$$` 这类空哈希会让
  // 任意口令通过（0 长度缓冲区的 timingSafeEqual 恒等）。
  if (!/^[0-9a-f]{32}$/iu.test(saltText) || !/^[0-9a-f]{64}$/iu.test(expectedText)) return false
  const salt = Buffer.from(saltText, 'hex')
  const expected = Buffer.from(expectedText, 'hex')
  if (salt.length !== 16 || expected.length !== 32) return false
  const derived = scryptSync(password, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/** 令牌载荷。 */
export interface TokenPayload {
  /** 主体（用户 ID）。 */
  sub: string
  /** 类型：access（访问令牌）/ refresh（刷新令牌）。 */
  typ: 'access' | 'refresh'
  /** 签发时的用户令牌版本（`users.token_version`；重置口令后自增，旧令牌即失效）。 */
  tv: number
  /** 签发毫秒。 */
  iat: number
  /** 过期毫秒。 */
  exp: number
}

/** 令牌服务：签发 / 校验 / 刷新。 */
export class TokenService {
  private readonly secret: Buffer

  /**
   * @param master - 主密钥（派生子密钥作为签名密钥）。
   */
  constructor(master: MasterKey) {
    this.secret = createHmac('sha256', master.key).update('soloengine/auth/token/v1').digest()
  }

  /**
   * 签发令牌。
   * @param userId - 用户 ID。
   * @param type - 令牌类型。
   * @param ttlMs - 有效期毫秒。
   * @param tokenVersion - 用户当前令牌版本（重置口令后自增）。
   * @returns 签名后的令牌串。
   */
  sign(userId: string, type: TokenPayload['typ'], ttlMs: number, tokenVersion = 0): string {
    const now = Date.now()
    const payload: TokenPayload = { sub: userId, typ: type, tv: tokenVersion, iat: now, exp: now + ttlMs }
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const signature = createHmac('sha256', this.secret).update(body).digest('base64url')
    return `${body}.${signature}`
  }

  /**
   * 校验令牌（签名 + 类型 + 过期）。
   * @param token - 待校验令牌。
   * @param type - 期望类型。
   * @returns 载荷；非法一律返回 undefined（调用方转结构化拒绝）。
   */
  verify(token: string, type: TokenPayload['typ']): TokenPayload | undefined {
    const parts = token.split('.')
    if (parts.length !== 2) return undefined
    const body = parts[0] as string
    const signature = parts[1] as string
    const expected = createHmac('sha256', this.secret).update(body).digest('base64url')
    if (!safeEqual(signature, expected)) return undefined
    let payload: TokenPayload
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
    } catch {
      return undefined
    }
    if (payload.typ !== type) return undefined
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return undefined
    return payload
  }
}

/** 生成用户 ID（UUID v4）。 */
export function newUserId(): string {
  return randomUUID()
}

/** 生成实体 ID（UUID v4，资产域复用）。 */
export function newId(): string {
  return randomUUID()
}
