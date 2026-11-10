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

import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
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
 * 前缀比较用的路径折叠。
 *
 * Windows 路径大小写不敏感：同一文件可以写成 `D:\work\x` 或 `d:\WORK\x`，而
 * `normalize`/`resolve` 不会改写大小写。按字面比较会把根内路径误判为越界
 * （绝对路径经对话框或外部调用传入时常见），因此只在 win32 上折叠大小写；
 * 其他平台按字面比较。
 * @param value - 规范化后的路径。
 * @returns 用于前缀比较的键。
 */
function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/**
 * 解析一个可能不存在的目标：先找到最近的存在祖先做 realpath，再拼回缺失的后缀。
 *
 * 只对"目标本身"做 realpath 不足以防住符号链接：`root/link/new.txt` 在 `new.txt`
 * 尚未创建时不存在，但 `link` 已经指向根外；必须先解析最近的已存在祖先。
 * @param target - 规范化后的绝对目标。
 * @returns 真实落盘路径（缺失部分按字面拼接）。
 */
function realpathThroughExistingAncestor(target: string): string {
  let ancestor = target
  const suffix: string[] = []
  // 用 lstat 判「这一层在目录树里有没有条目」：悬空符号链接本身存在但 realpath 解析不到，
  // 若按 existsSync 跳过它，就会把「穿不过去的链接」当成普通缺失段放行。
  const present = (path: string): boolean => {
    try {
      lstatSync(path)
      return true
    } catch {
      // 只把「不存在/不可 stat」当作缺失段；链接存在但悬空时下面 realpathSync 会明确报错。
      return false
    }
  }
  while (!present(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    suffix.unshift(basename(ancestor))
    ancestor = parent
  }
  const real = realpathSync(ancestor)
  return normalize(suffix.length === 0 ? real : join(real, ...suffix))
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
  const candidateKey = pathKey(candidate)
  const rootKey = pathKey(root)
  if (candidateKey !== rootKey && !candidateKey.startsWith(pathKey(prefix))) {
    throw new FrameworkError(403, 'OUT_OF_SANDBOX_ROOT', `path ${options.target} is outside the workspace root ${root}`)
  }

  const exists = existsSync(candidate)
  if (options.mustExist === true && !exists) {
    throw new FrameworkError(404, 'FILE_NOT_FOUND', `${options.target} does not exist`)
  }

  // 判据 1：realpath 校验。目标不存在时解析最近的已存在祖先，缺失后缀按字面拼回，
  // 再把**真实路径**作为后续读写落点——否则根内符号链接目录下的新文件会绕过前缀判据。
  let real: string
  try {
    real = exists ? normalize(realpathSync(candidate)) : realpathThroughExistingAncestor(candidate)
  } catch (error) {
    throw new FrameworkError(400, 'PATH_UNRESOLVABLE', `cannot resolve ${options.target}: ${String(error)}`)
  }
  let realRoot: string
  try {
    realRoot = normalize(realpathSync(root))
  } catch (error) {
    // 根目录不存在/不可解析是配置或项目目录问题，不是 500：给出可处置的业务错误。
    throw new FrameworkError(400, 'SANDBOX_ROOT_UNRESOLVABLE',
      `cannot resolve the workspace root ${root}: ${String(error)}`)
  }
  const realPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`
  if (pathKey(real) !== pathKey(realRoot) && !pathKey(real).startsWith(pathKey(realPrefix))) {
    throw new FrameworkError(403, 'OUT_OF_SANDBOX_ROOT',
      `path ${options.target} resolves to ${real}, outside the workspace root ${realRoot}`)
  }

  // 判据 3：loopback（仅当调用方声明了来源时校验）。
  if (options.remoteAddress !== undefined && !isLoopback(options.remoteAddress)) {
    throw new FrameworkError(403, 'LOOPBACK_ONLY', `write routing accepts loopback callers only, got ${options.remoteAddress}`)
  }

  // 判据 4：mtime 冲突（仅当目标存在且调用方给出期望值时校验）。
  let mtimeMs: number | null = null
  if (exists) {
    try {
      mtimeMs = statSync(real).mtimeMs
    } catch (error) {
      // 判据 1 与这里之间目标被删除：按「不存在」报出，不让 ENOENT 变成裸 500。
      throw new FrameworkError(404, 'FILE_NOT_FOUND', `${options.target} disappeared while it was being checked: ${String(error)}`)
    }
    if (options.expectedMtimeMs !== undefined && Number(options.expectedMtimeMs) !== Math.floor(mtimeMs)) {
      throw new FrameworkError(409, 'MTIME_CONFLICT',
        `${options.target} changed on disk (expected mtime ${String(options.expectedMtimeMs)}, found ${String(Math.floor(mtimeMs))}); re-read and retry`)
    }
  }

  return { path: real, exists, mtimeMs }
}
