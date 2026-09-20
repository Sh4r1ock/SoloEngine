/**
 * 项目沙箱根门禁（PRD-02 FR-CANVAS-041、PRD-08 FR-OPS-012、PRD-10 FR-SEC-009）。
 *
 * 四条判据（全部通过才放行）：
 * 1. **realpath 规范化**：目标路径先规范化（解析 `..`、`.`,），再与实际落盘路径比对（防符号链接越界）；
 * 2. **前缀校验**：规范化路径必须落在沙箱根之内（根自身或根的子孙）；
 * 3. **loopback**：写入路由只接受本机来源（远程请求一律拒绝）；
 * 4. **mtime 冲突**：调用方可提供期望 mtime，不一致即拒绝后写者。
 *
 * @module @soloengine/framework/sandbox/workspace-gate
 */

import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { FrameworkError } from '../modules/accounts.ts'

/** 门禁入参。 */
export interface WorkspaceGateOptions {
  /** 沙箱根（运行项目目录，绝对路径）。 */
  root: string
  /** 待校验目标（绝对或相对根）。 */
  target: string
  /** 请求来源地址（loopback 判定）。 */
  remoteAddress?: string
  /** 期望的 mtime（毫秒）；不一致即拒绝。 */
  expectedMtimeMs?: number
  /** 目标是否必须已存在（读/写已有文件时 true）。 */
  mustExist?: boolean
}

/** 门禁结果。 */
export interface WorkspaceGateResult {
  /** 规范化后的绝对路径。 */
  path: string
  /** 目标是否已存在。 */
  exists: boolean
  /** 实际 mtime（毫秒）；不存在为 null。 */
  mtimeMs: number | null
}

/** 判定来源是否为本机回环地址。 */
export function isLoopback(address: string | undefined): boolean {
  if (address === undefined || address === '') return false
  const bare = address.replace(/^::ffff:/, '')
  return bare === '127.0.0.1' || bare === '::1' || bare === 'localhost' || bare.startsWith('127.')
}

/**
 * 校验目标路径是否可安全访问（读/写共用）。
 * @param options - 门禁入参。
 * @returns 校验结果；任一判据失败抛结构化错误。
 */
export function gateWorkspacePath(options: WorkspaceGateOptions): WorkspaceGateResult {
  if (String(options.root ?? '').trim() === '') {
    throw new FrameworkError(400, 'SANDBOX_ROOT_REQUIRED', 'workspace root is required')
  }
  const root = normalize(resolve(options.root))
  const candidate = isAbsolute(options.target) ? normalize(options.target) : normalize(resolve(root, options.target))

  // 判据 2：前缀校验（先按规范化路径判，避免不存在的目标无法 realpath）。
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (candidate !== root && !candidate.startsWith(prefix)) {
    throw new FrameworkError(403, 'OUT_OF_SANDBOX_ROOT', `path ${options.target} is outside the workspace root ${root}`)
  }

  const exists = existsSync(candidate)
  if (options.mustExist === true && !exists) {
    throw new FrameworkError(404, 'FILE_NOT_FOUND', `${options.target} does not exist`)
  }

  // 判据 1：realpath 校验（存在时解析符号链接，再复核前缀）。
  if (exists) {
    let real: string
    try {
      real = normalize(realpathSync(candidate))
    } catch (error) {
      throw new FrameworkError(400, 'PATH_UNRESOLVABLE', `cannot resolve ${options.target}: ${String(error)}`)
    }
    const realRoot = normalize(realpathSync(root))
    const realPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`
    if (real !== realRoot && !real.startsWith(realPrefix)) {
      throw new FrameworkError(403, 'OUT_OF_SANDBOX_ROOT',
        `path ${options.target} resolves to ${real}, outside the workspace root ${realRoot}`)
    }
  }

  // 判据 3：loopback（仅当调用方声明了来源时校验）。
  if (options.remoteAddress !== undefined && !isLoopback(options.remoteAddress)) {
    throw new FrameworkError(403, 'LOOPBACK_ONLY', `write routing accepts loopback callers only, got ${options.remoteAddress}`)
  }

  // 判据 4：mtime 冲突（仅当目标存在且调用方给出期望值时校验）。
  let mtimeMs: number | null = null
  if (exists) {
    mtimeMs = statSync(candidate).mtimeMs
    if (options.expectedMtimeMs !== undefined && Number(options.expectedMtimeMs) !== Math.floor(mtimeMs)) {
      throw new FrameworkError(409, 'MTIME_CONFLICT',
        `${options.target} changed on disk (expected mtime ${String(options.expectedMtimeMs)}, found ${String(Math.floor(mtimeMs))}); re-read and retry`)
    }
  }

  return { path: candidate, exists, mtimeMs }
}
