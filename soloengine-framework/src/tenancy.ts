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
import { isAbsolute, normalize, resolve, sep } from 'node:path'

/** 用户名 → 安全目录名（只保留安全字符，防路径注入）。 */
export function safeDirectoryName(username: string): string {
  const cleaned = username.replace(/[^A-Za-z0-9_.-]/g, '_')
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error(`soloengine: username ${JSON.stringify(username)} does not produce a safe directory name`)
  }
  return cleaned
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
    const prefix = base.endsWith(sep) ? base : `${base}${sep}`
    const inside = resolved === base || resolved.startsWith(prefix)
    if (!inside) {
      throw new Error(`soloengine: ${target} is outside user ${username} ${kind} dir ${base}`)
    }
    return resolved
  }
}