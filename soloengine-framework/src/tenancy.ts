/**
 * 多用户隔离原语（PRD-10 FR-SEC-012 / PRD-01 FR-ARCH-015）。
 *
 * 三层隔离：
 * 1. **数据行**：业务查询一律按 `user_id` 过滤（各资产 service 担保）；
 * 2. **用户目录**：每个用户有专属目录 `data/home/users/<username>/{skills,mcp,projects}`，
 *    技能/MCP/项目等文件资产物理隔离；
 * 3. **作用域**：执行时按 agent 作用域限定可见集合（编译期固定，PRD-02/04/05/06）。
 *
 * 本模块落地第 2 层的目录分配与名校验（跨用户不能越界读写他人目录）。
 *
 * @module @soloengine/framework/tenancy
 */

import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, normalize, resolve, sep } from 'node:path'

/**
 * 用户名 → 安全目录名（只保留安全字符，防路径注入）。
 *
 * 不同登录名清洗后可能同名（`a b` 与 `a_b` 都得到 `a_b`），共用目录等于跨用户读写。
 * 名称未被清洗时原样使用；被清洗过则追加登录名的稳定摘要，保证一对一。
 * @param username - 登录名。
 * @returns 目录名。
 */
export function safeDirectoryName(username: string): string {
  const cleaned = username.replace(/[^A-Za-z0-9_.-]/g, '_')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error(`soloengine: username ${JSON.stringify(username)} does not produce a safe directory name`)
  }
  if (cleaned === username) return cleaned
  return `${cleaned}-${createHash('sha256').update(username).digest('hex').slice(0, 8)}`
}

/** 用户目录分配器：在数据根下为每个用户建立隔离目录。 */
export class UserDirectoryService {
  private readonly root: string

  /**
   * @param dataRoot - 数据根（data/）。
   */
  constructor(dataRoot: string) {
    this.root = resolve(dataRoot, 'home', 'users')
  }

  /** 用户目录根（所有子目录的父级）。 */
  get dir(): string {
    return this.root
  }

  /**
   * 确保某用户的隔离子目录存在并返回其绝对路径。
   * @param username - 目录名安全的登录名。
   * @returns 用户目录绝对路径。
   */
  ensure(username: string): string {
    const name = safeDirectoryName(username)
    const base = resolve(this.root, name)
    for (const sub of ['skills', 'mcp', 'projects']) {
      mkdirSync(resolve(base, sub), { recursive: true })
    }
    return base
  }

  /**
   * 子目录绝对路径（不创建）。
   * @param username - 登录名。
   * @param kind - 资产子目录。
   * @returns 子目录绝对路径。
   */
  sub(username: string, kind: 'skills' | 'mcp' | 'projects'): string {
    return resolve(this.root, safeDirectoryName(username), kind)
  }

  /**
   * 判定目标路径是否落在指定用户的指定子目录内（越界即拒绝）。
   * @param username - 登录名。
   * @param kind - 资产子目录。
   * @param target - 待校验的业务路径（绝对或相对该子目录）。
   * @returns 规范化后的绝对路径；越界抛错。
   */
  within(username: string, kind: 'skills' | 'mcp' | 'projects', target: string): string {
    const base = normalize(this.sub(username, kind))
    const resolved = isAbsolute(target) ? normalize(target) : normalize(resolve(base, target))
    // Windows 盘符大小写不参与路径含义：上传目录可能记成 `d:\`，用户根目录是 `D:\`，
    // 直接 startsWith 会把合法目录判成越界（实测 MCP 上传服务器的文件页因此打不开）。
    // 只在比较键上折叠大小写，返回值仍是规范化后的真实路径；POSIX 保持大小写敏感。
    const fold = process.platform === 'win32'
      ? (value: string): string => value.toLowerCase()
      : (value: string): string => value
    const baseKey = fold(base)
    const resolvedKey = fold(resolved)
    const prefix = baseKey.endsWith(sep) ? baseKey : `${baseKey}${sep}`
    const inside = resolvedKey === baseKey || resolvedKey.startsWith(prefix)
    if (!inside) {
      throw new Error(`soloengine: ${target} is outside user ${username} ${kind} dir ${base}`)
    }
    return resolved
  }
}