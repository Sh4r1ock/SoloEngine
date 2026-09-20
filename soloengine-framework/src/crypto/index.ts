/**
 * SoloEngine 密钥加密与主密钥生命周期。
 *
 * 依据 PRD-12 FR-STO-009 与 PRD-03 FR-LLM-002：
 * - 模型密钥以 AES-256-GCM 加密落库、使用时解密；
 * - 主密钥首次生成于 `data/home/keys/master.key`（32 字节随机，权限收紧为属主可读写）；
 * - **缺失 / 非法（非 64 位 hex）/ 长度错** 三类一律阻断启动（fail loud，禁止回退到不加密）；
 * - 密钥只以引用形式在配置面出现，值不进任何配置文档。
 *
 * @module @soloengine/framework/crypto
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 主密钥字节长度（AES-256）。 */
export const MASTER_KEY_BYTES = 32
/** 密文封包版本前缀。 */
const ENVELOPE_PREFIX = 'v1'

/** 主密钥阻断启动的错误（三类：缺失以外的非法/长度错都归此）。 */
export class MasterKeyError extends Error {
  /** 失败类别，供启动自检输出具体项。 */
  readonly kind: 'missing' | 'invalid' | 'length'
  /**
   * @param kind - 失败类别。
   * @param message - 人类可读原因。
   */
  constructor(kind: 'missing' | 'invalid' | 'length', message: string) {
    super(message)
    this.name = 'MasterKeyError'
    this.kind = kind
  }
}

/** 主密钥管理器：加载或首次生成，并在生成时收紧权限。 */
export class MasterKey {
  /** 32 字节主密钥。 */
  readonly key: Buffer
  /** 主密钥文件绝对路径。 */
  readonly path: string
  /** 本次是否为首次生成（自检输出用）。 */
  readonly created: boolean

  /**
   * @param path - 主密钥文件绝对路径。
   */
  constructor(path: string) {
    this.path = path
    if (!existsSync(path)) {
      // 首次生成：目录属主可读写，文件属主可读写（Windows 上 chmod 仅影响只读位）。
      mkdirSync(dirname(path), { recursive: true })
      const generated = randomBytes(MASTER_KEY_BYTES)
      writeFileSync(path, generated.toString('hex'), { encoding: 'utf8', mode: 0o600 })
      try {
        chmodSync(path, 0o600)
      } catch {
        // 权限收紧在部分文件系统不可用；不阻断（密钥仍在属主私有目录）。
      }
      this.key = generated
      this.created = true
      return
    }
    const raw = readFileSync(path, 'utf8').trim()
    if (!/^[0-9a-fA-F]+$/.test(raw)) {
      throw new MasterKeyError('invalid', `master key at ${path} is not hexadecimal`)
    }
    if (raw.length !== MASTER_KEY_BYTES * 2) {
      throw new MasterKeyError('length', `master key at ${path} is ${raw.length / 2} bytes, expected ${MASTER_KEY_BYTES}`)
    }
    this.key = Buffer.from(raw, 'hex')
    this.created = false
  }
}

/** 把明文加密为可入库的单列字符串（`v1.<iv>.<tag>.<ciphertext>`，全 hex）。 */
export function encryptSecret(master: MasterKey, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', master.key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [ENVELOPE_PREFIX, iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join('.')
}

/** 解密入库密文；封包非法或认证失败一律抛错（不回退明文）。 */
export function decryptSecret(master: MasterKey, envelope: string): string {
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) {
    throw new Error('soloengine: encrypted secret is not a v1 envelope')
  }
  const ivHex = parts[1] as string
  const tagHex = parts[2] as string
  const dataHex = parts[3] as string
  const decipher = createDecipheriv('aes-256-gcm', master.key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

/** 密钥掩码：仅回显首尾各 4 字符，中间固定省略号（接口永不回传明文）。 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return '*'.repeat(plaintext.length)
  return `${plaintext.slice(0, 4)}${'*'.repeat(8)}${plaintext.slice(-4)}`
}

/** 常量时间比较（供令牌与哈希校验复用）。 */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
