/**
 * SSRF 防线（PRD-10 FR-SEC-009 / FR-SEC-010；NFR-SEC-003）。
 *
 * 四步判据（任一步失败即拒绝，不静默降级）：
 * 1. **协议白名单**：只放行 http/https（ws/wss 在 upgrade 路径单独判定）；
 * 2. **域名先解析**：`dns.lookup(host, { all: true })` 取全部地址，解析失败即拒绝；
 * 3. **逐地址公网校验**：任一地址落在私网 / 回环 / 链路本地 / 保留段即拒绝（防内网穿透）；
 * 4. **连接钉住已校验地址**：转发层把 `lookup` 覆盖为「只返回已校验地址」，
 *    使实际连接不经过第二次解析（防 DNS 重绑定）。
 *
 * 重定向逐跳复检：每一跳都重走本函数（FR-SEC-010）。
 *
 * @module @soloengine/browser-proxy/ssrf
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** 校验通过的目标。 */
export interface ValidatedTarget {
  /** 规范化 URL。 */
  url: URL
  /** 已校验的地址集合（全部为公网地址）。 */
  addresses: { address: string; family: 4 | 6 }[]
}

/** SSRF 拒绝错误（结构化：拒绝原因直接呈现给用户，不超时假死）。 */
export class SsrfRejection extends Error {
  /**
   * @param code - 稳定错误码。
   * @param message - 人类可读原因（指出具体项）。
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SsrfRejection'
  }
}

/** 解析 IPv4 为四段整数。 */
function ipv4Octets(address: string): number[] {
  return address.split('.').map(part => Number(part))
}

/**
 * IPv4 公网判定（拒绝私网 / 回环 / 链路本地 / 保留段 / 组播）。
 * @param address - 点分十进制地址。
 * @returns 是否可作为代理目标。
 */
function isPublicIpv4(address: string): boolean {
  const parts = ipv4Octets(address)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a = 0, b = 0] = parts
  if (a === 0) return false // 0.0.0.0/8
  if (a === 10) return false // 10/8
  if (a === 127) return false // 127/8 回环
  if (a === 169 && b === 254) return false // 169.254/16 链路本地
  if (a === 172 && b >= 16 && b <= 31) return false // 172.16/12
  if (a === 192 && b === 168) return false // 192.168/16
  if (a === 192 && b === 0) return false // 192.0.0/24 + 192.0.2/24（保留/文档）
  if (a === 192 && b === 88 && parts[2] === 99) return false // 192.88.99/24
  if (a === 198 && (b === 18 || b === 19)) return false // 198.18/15 基准测试
  if (a === 198 && b === 51 && parts[2] === 100) return false // 198.51.100/24
  if (a === 203 && b === 0 && parts[2] === 113) return false // 203.0.113/24
  if (a === 100 && b >= 64 && b <= 127) return false // 100.64/10 CGNAT
  if (a >= 224) return false // 组播 + 保留 240/4
  return true
}

/**
 * IPv6 公网判定（拒绝回环 / 未指定 / 唯一本地 / 链路本地 / 组播 / v4 映射内网）。
 * @param address - 冒号分隔地址（小写）。
 * @returns 是否可作为代理目标。
 */
function isPublicIpv6(address: string): boolean {
  const value = address.toLowerCase()
  if (value === '::1' || value === '::') return false
  if (value.startsWith('fe80:') || value.startsWith('fe80::')) return false // 链路本地 fe80::/10
  if (value.startsWith('fc') || value.startsWith('fd')) return false // 唯一本地 fc00::/7
  if (value.startsWith('ff')) return false // 组播 ff00::/8
  if (value.startsWith('::ffff:')) {
    // v4 映射：按 IPv4 判据复检（防 ::ffff:127.0.0.1 绕过）。
    const mapped = value.slice('::ffff:'.length)
    if (isIP(mapped) === 4) return isPublicIpv4(mapped)
    return false
  }
  if (value.startsWith('64:ff9b:')) return false // NAT64 翻译段
  if (value.startsWith('2002:')) return false // 6to4 可夹带内网 v4
  return true
}

/**
 * 判断一个 IP 字面量是否公网可达。
 * @param address - IP 字面量。
 * @returns 是否公网。
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

/**
 * 校验一个代理目标（协议 + 解析 + 逐地址公网校验）。
 * @param raw - 目标 URL 文本。
 * @returns 校验通过的目标。
 * @throws SsrfRejection - 任一步失败。
 */
export async function validateTarget(raw: string): Promise<ValidatedTarget> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SsrfRejection('TARGET_INVALID', `target "${raw}" is not an absolute URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfRejection('SCHEME_REJECTED', `target scheme "${url.protocol}" is not allowed (http/https only)`)
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, '')
  // IP 字面量：直接判据，不做解析。
  if (isIP(hostname) !== 0) {
    if (!isPublicAddress(hostname)) {
      throw new SsrfRejection('ADDRESS_REJECTED', `target address ${hostname} is private, loopback, link-local or reserved`)
    }
    return { url, addresses: [{ address: hostname, family: isIP(hostname) === 6 ? 6 : 4 }] }
  }
  let resolved: { address: string; family: number }[]
  try {
    resolved = await lookup(hostname, { all: true })
  } catch (error) {
    throw new SsrfRejection('DNS_FAILED', `cannot resolve ${hostname}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (resolved.length === 0) {
    throw new SsrfRejection('DNS_FAILED', `cannot resolve ${hostname}: no address returned`)
  }
  const rejected = resolved.filter(entry => !isPublicAddress(entry.address))
  if (rejected.length > 0) {
    throw new SsrfRejection(
      'ADDRESS_REJECTED',
      `${hostname} resolves to ${rejected.map(entry => entry.address).join(', ')}, which is private, loopback, link-local or reserved`,
    )
  }
  return {
    url,
    addresses: resolved.map(entry => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 })),
  }
}
