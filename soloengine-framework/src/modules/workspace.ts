/**
 * 工作区文件域（PRD-08 FR-OPS-010 / FR-OPS-012；《SoloEngine 框架设计》§4.6）。
 *
 * 读写分治：**读**（目录列举 / 行窗口 / stat / 搜索）与 **人写入**（新建 / 写入 / 重命名 / 删除）
 * 都走本模块，全部经 `gateWorkspacePath` 四判据（realpath 规范化 + 沙箱根前缀 + loopback + mtime 冲突）；
 * 沙箱根取**运行项目目录**（用户 × 画布 × 目录去重后的那一条），即「人写入走产品自己的接口」。
 *
 * 纪律：不引入任何回退默认值——根缺失、越界、重名、mtime 冲突一律结构化拒绝并指出具体项。
 *
 * @module @soloengine/framework/modules/workspace
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'
import type { FrameworkRuntime } from '../runtime.ts'
import { gateWorkspacePath } from '../sandbox/workspace-gate.ts'
import { FrameworkError } from './accounts.ts'

/** 目录列举的一条条目。 */
export interface WorkspaceEntry {
  /** 条目名（不含父路径）。 */
  name: string
  /** 相对沙箱根的路径（POSIX 分隔符，便于前端拼接资源地址）。 */
  path: string
  /** 类型。 */
  kind: 'file' | 'directory'
  /** 字节数（文件；目录为 null）。 */
  bytes: number | null
  /** mtime（毫秒，取整；作为乐观锁版本）。 */
  mtimeMs: number | null
}

/** 目录列举结果。 */
export interface WorkspaceListing {
  /** 请求目录（相对沙箱根；根为 `''`）。 */
  path: string
  /** 条目（目录优先，再按名称升序）。 */
  entries: WorkspaceEntry[]
  /** 是否被上限截断。 */
  truncated: boolean
}

/** 行窗口读取结果。 */
export interface WorkspaceText {
  /** 相对沙箱根的路径。 */
  path: string
  /** 文件绝对路径（执行世界）。 */
  absolutePath: string
  /** 本次返回的文本。 */
  text: string
  /** 本次窗口起点行号（0 基）。 */
  offset: number
  /** 本次返回的行数。 */
  lines: number
  /** 是否已到文件尾。 */
  eof: boolean
  /** 文件总行数。 */
  totalLines: number
  /** 文件字节数。 */
  bytes: number
  /** mtime（毫秒，取整；乐观锁版本）。 */
  mtimeMs: number
}

/** 单文件 stat 结果。 */
export interface WorkspaceStat {
  /** 相对沙箱根的路径。 */
  path: string
  /** 文件绝对路径。 */
  absolutePath: string
  /** 是否存在。 */
  exists: boolean
  /** 类型（不存在为 null）。 */
  kind: 'file' | 'directory' | null
  /** 字节数。 */
  bytes: number | null
  /** mtime（毫秒，取整）。 */
  mtimeMs: number | null
}

/** 一次写入的结果。 */
export interface WorkspaceWriteResult {
  /** 相对沙箱根的路径。 */
  path: string
  /** 写入字节数。 */
  bytes: number
  /** 写入后的 mtime（毫秒，取整）。 */
  mtimeMs: number
  /** 是新建还是覆盖。 */
  created: boolean
}

/** 目录列举上限（懒加载：单层条目上限，超出即截断并明示）。 */
const LIST_LIMIT = 2000
/** 行窗口默认行数。 */
const DEFAULT_READ_LIMIT = 2000
/** 行窗口行数上限。 */
const MAX_READ_LIMIT = 20000
/** 单次写入字节上限（编辑器保存；与 express.json 的 32mb 上限一致但更紧）。 */
const MAX_WRITE_BYTES = 8 * 1024 * 1024
/** 搜索条目上限。 */
const SEARCH_LIMIT = 500
/** 搜索跳过的目录（与生态惯例一致：不把 .git/node_modules 拉进结果）。 */
const SEARCH_SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', 'dist', '.next', '__pycache__'])

/**
 * 把绝对路径换算为相对沙箱根的 POSIX 路径。
 * @param root - 沙箱根（绝对）。
 * @param target - 目标绝对路径。
 * @returns 相对路径（根自身为 `''`）。
 */
function toWorkspacePath(root: string, target: string): string {
  const rel = relative(root, target)
  return rel === '' ? '' : rel.split(sep).join('/')
}

/** 一次人写入的观察（供变更台账记 `origin='user'`；PRD-09 FR-FC-001）。 */
export interface WorkspaceWriteObservation {
  /** 请求级用户。 */
  userId: string
  /** 运行项目 id（沙箱根的身份）。 */
  projectId: string
  /**
   * 归属会话键；产品层的写路由没有会话上下文时为 `null`。
   *
   * 台账查询按 `session_id` 过滤（`ChangeLedgerService.list`），所以这里不带会话键的记录
   * **在任何面板里都不可见**——PRD-09 FR-FC-001 要求「台账出现 origin='user' 的记录」，
   * 而排除项只是「不入 agent 回合视图、不参与按轮次撤回」（由 `turn=null` 保证，与会话归属无关）。
   */
  sessionKey: string | null
  /** 文件绝对路径。 */
  filePath: string
  /** 变更前内容（`null` = 变更前不存在）。 */
  before: string | null
  /** 变更后内容（`null` = 变更后不存在）。 */
  after: string | null
}

/** 工作区文件服务：一个运行时一个实例。 */
export class WorkspaceService {
  /** 人写入的观察者（由 host 侧的变更记录模块注入；未注入即不落台账，写入路径不受影响）。 */
  private writeObserver: ((observation: WorkspaceWriteObservation) => void) | undefined

  /**
   * @param runtime - 框架层运行时（运行项目表与门禁）。
   */
  constructor(private readonly runtime: FrameworkRuntime) {}

  /**
   * 注入人写入观察者（只观测，不参与写入决策——记录是观测能力，非门禁）。
   * @param observer - 观察者；其抛错被吞并记录，绝不影响写入结果。
   */
  attachWriteObserver(observer: (observation: WorkspaceWriteObservation) => void): void {
    this.writeObserver = observer
  }

  /** 通知写入观察者（失败只告警，不影响写入路径）。 */
  private observe(observation: WorkspaceWriteObservation): void {
    if (this.writeObserver === undefined) return
    try {
      this.writeObserver(observation)
    } catch (error) {
      console.log(`soloengine: file-change observation for ${observation.filePath} failed (${String(error)}); the write itself stands`)
    }
  }

  /**
   * 解析一次请求的沙箱根：必须是**当前用户**名下的运行项目目录。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @returns 沙箱根与项目行。
   */
  private rootOf(userId: string, projectId: string): { root: string; folder: string } {
    if (projectId.trim() === '') {
      throw new FrameworkError(400, 'PROJECT_REQUIRED', 'projectId is required: the run project folder is the sandbox root')
    }
    const project = this.runtime.canvas.projectById(userId, projectId)
    if (project === undefined) {
      throw new FrameworkError(404, 'PROJECT_NOT_FOUND', `run project ${projectId} not found for this user`)
    }
    if (project.folder_path.trim() === '') {
      throw new FrameworkError(400, 'SANDBOX_ROOT_REQUIRED', `run project ${projectId} has no folder_path (sandbox root)`)
    }
    const root = normalize(resolve(project.folder_path))
    if (!existsDirectory(root)) {
      throw new FrameworkError(404, 'SANDBOX_ROOT_MISSING', `sandbox root ${root} does not exist on disk`)
    }
    return { root, folder: root }
  }

  /**
   * 门禁 + 路径解析（读写共用）。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param target - 目标路径（相对沙箱根或绝对）。
   * @param options - 来源地址、期望 mtime、是否必须存在。
   * @returns 沙箱根、规范化绝对路径与门禁结果。
   */
  private gate(
    userId: string,
    projectId: string,
    target: string,
    options: { remoteAddress?: string | undefined; expectedMtimeMs?: number | undefined; mustExist?: boolean | undefined },
  ): { root: string; path: string; exists: boolean; mtimeMs: number | null } {
    const { root } = this.rootOf(userId, projectId)
    const result = gateWorkspacePath({
      root,
      target,
      ...options.remoteAddress === undefined ? {} : { remoteAddress: options.remoteAddress },
      ...options.expectedMtimeMs === undefined ? {} : { expectedMtimeMs: options.expectedMtimeMs },
      ...options.mustExist === undefined ? {} : { mustExist: options.mustExist },
    })
    return { root, ...result }
  }

  /**
   * 列举一层目录（懒加载：前端逐层调用，不整树拉取）。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param target - 目录路径（相对沙箱根；空即根）。
   * @param remoteAddress - 请求来源。
   * @returns 目录列举结果。
   */
  list(userId: string, projectId: string, target: string, remoteAddress?: string): WorkspaceListing {
    const gated = this.gate(userId, projectId, target === '' ? '.' : target, { remoteAddress, mustExist: true })
    const stat = statSync(gated.path)
    if (!stat.isDirectory()) {
      throw new FrameworkError(400, 'NOT_A_DIRECTORY', `${target} is not a directory`)
    }
    const names = readdirSync(gated.path)
    const entries: WorkspaceEntry[] = []
    let truncated = false
    for (const name of names) {
      if (entries.length >= LIST_LIMIT) { truncated = true; break }
      const absolute = join(gated.path, name)
      let child: ReturnType<typeof statSync>
      try {
        child = statSync(absolute)
      } catch {
        // 断链符号链接：明确跳过，不伪造条目。
        continue
      }
      const isDirectory = child.isDirectory()
      entries.push({
        name,
        path: toWorkspacePath(gated.root, absolute),
        kind: isDirectory ? 'directory' : 'file',
        bytes: isDirectory ? null : child.size,
        mtimeMs: Math.floor(child.mtimeMs),
      })
    }
    entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    return { path: toWorkspacePath(gated.root, gated.path), entries, truncated }
  }

  /**
   * 单文件/目录 stat（乐观锁版本 = mtimeMs）。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param target - 目标路径。
   * @param remoteAddress - 请求来源。
   * @returns stat 结果。
   */
  stat(userId: string, projectId: string, target: string, remoteAddress?: string): WorkspaceStat {
    const gated = this.gate(userId, projectId, target, { remoteAddress })
    const kind: WorkspaceStat['kind'] = gated.exists ? (statSync(gated.path).isDirectory() ? 'directory' : 'file') : null
    return {
      path: toWorkspacePath(gated.root, gated.path),
      absolutePath: gated.path,
      exists: gated.exists,
      kind,
      bytes: gated.exists && kind === 'file' ? statSync(gated.path).size : null,
      mtimeMs: gated.mtimeMs === null ? null : Math.floor(gated.mtimeMs),
    }
  }

  /**
   * 行窗口读取（大文件分页，不整文件载入编辑器）。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param target - 文件路径。
   * @param options - 起点行与行数、来源地址。
   * @returns 行窗口结果。
   */
  read(
    userId: string,
    projectId: string,
    target: string,
    options: { offset?: number | undefined; limit?: number | undefined; remoteAddress?: string | undefined },
  ): WorkspaceText {
    const gated = this.gate(userId, projectId, target, {
      ...options.remoteAddress === undefined ? {} : { remoteAddress: options.remoteAddress },
      mustExist: true,
    })
    const stat = statSync(gated.path)
    if (stat.isDirectory()) {
      throw new FrameworkError(400, 'IS_A_DIRECTORY', `${target} is a directory`)
    }
    const raw = readFileSync(gated.path, 'utf8')
    const all = raw.split('\n')
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const limit = Math.min(MAX_READ_LIMIT, Math.max(1, Math.floor(options.limit ?? DEFAULT_READ_LIMIT)))
    const window = all.slice(offset, offset + limit)
    return {
      path: toWorkspacePath(gated.root, gated.path),
      absolutePath: gated.path,
      text: window.join('\n'),
      offset,
      lines: window.length,
      eof: offset + window.length >= all.length,
      totalLines: all.length,
      bytes: stat.size,
      mtimeMs: Math.floor(stat.mtimeMs),
    }
  }

  /**
   * 写入文件（新建或覆盖）；提供 expectedMtimeMs 时执行 mtime 冲突检测。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param target - 文件路径。
   * @param text - 全文内容。
   * @param options - 期望 mtime、是否仅允许新建、来源地址。
   * @returns 写入结果。
   */
  write(
    userId: string,
    projectId: string,
    target: string,
    text: string,
    options: { expectedMtimeMs?: number | undefined; createOnly?: boolean | undefined; sessionKey?: string | undefined; remoteAddress?: string | undefined },
  ): WorkspaceWriteResult {
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > MAX_WRITE_BYTES) {
      throw new FrameworkError(413, 'WRITE_TOO_LARGE', `write of ${String(bytes)} bytes exceeds the ${String(MAX_WRITE_BYTES)} byte limit`)
    }
    const gated = this.gate(userId, projectId, target, {
      ...options.remoteAddress === undefined ? {} : { remoteAddress: options.remoteAddress },
      ...options.expectedMtimeMs === undefined ? {} : { expectedMtimeMs: options.expectedMtimeMs },
    })
    const parent = dirname(gated.path)
    if (!existsDirectory(parent)) {
      throw new FrameworkError(400, 'PARENT_MISSING', `parent directory ${parent} does not exist; create it first`)
    }
    // 新建语义（文件树「新建文件」）：已存在即拒绝，绝不静默清空既有内容。
    // mtime 乐观锁表达不了「必须不存在」（判据 4 只在目标存在时校验），故单列判据。
    if (options.createOnly === true && gated.exists) {
      throw new FrameworkError(409, 'PATH_EXISTS', `${target} already exists; a create refuses to overwrite it`)
    }
    // 变更前内容（供变更台账记 origin='user' 的抓拍；读失败按不存在处理）。
    const before = gated.exists ? readFileSync(gated.path, 'utf8') : null
    writeFileSync(gated.path, text, 'utf8')
    const stat = statSync(gated.path)
    this.observe({ userId, projectId, sessionKey: options.sessionKey ?? null, filePath: gated.path, before, after: text })
    return {
      path: toWorkspacePath(gated.root, gated.path),
      bytes: stat.size,
      mtimeMs: Math.floor(stat.mtimeMs),
      created: !gated.exists,
    }
  }

  /**
   * 新建目录（双确认：调用方必须显式 `confirm: true`）。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param target - 目录路径。
   * @param confirm - 双确认标志。
   * @param remoteAddress - 请求来源。
   * @returns 新建目录的相对路径。
   */
  mkdir(userId: string, projectId: string, target: string, confirm: boolean, remoteAddress?: string): { path: string } {
    requireConfirm(confirm, 'mkdir', target)
    const gated = this.gate(userId, projectId, target, { remoteAddress })
    if (gated.exists) {
      throw new FrameworkError(409, 'PATH_EXISTS', `${target} already exists; refusing to merge into it`)
    }
    mkdirSync(gated.path)
    return { path: toWorkspacePath(gated.root, gated.path) }
  }

  /**
   * 重命名 / 移动（双确认；提供 expectedMtimeMs 时对源执行 mtime 冲突检测）。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param from - 源路径。
   * @param to - 目标路径。
   * @param confirm - 双确认标志。
   * @param options - 期望 mtime 与来源地址。
   * @returns 源与目标相对路径。
   */
  rename(
    userId: string,
    projectId: string,
    from: string,
    to: string,
    confirm: boolean,
    options: { expectedMtimeMs?: number | undefined; remoteAddress?: string | undefined },
  ): { from: string; to: string } {
    requireConfirm(confirm, 'rename', `${from} -> ${to}`)
    const source = this.gate(userId, projectId, from, {
      ...options.remoteAddress === undefined ? {} : { remoteAddress: options.remoteAddress },
      ...options.expectedMtimeMs === undefined ? {} : { expectedMtimeMs: options.expectedMtimeMs },
      mustExist: true,
    })
    const destination = this.gate(userId, projectId, to, { remoteAddress: options.remoteAddress })
    if (destination.exists) {
      throw new FrameworkError(409, 'PATH_EXISTS', `${to} already exists; refusing to overwrite it`)
    }
    renameSync(source.path, destination.path)
    return { from: toWorkspacePath(source.root, source.path), to: toWorkspacePath(destination.root, destination.path) }
  }

  /**
   * 删除文件或目录（双确认；目录递归删除）。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param target - 目标路径。
   * @param confirm - 双确认标志。
   * @param remoteAddress - 请求来源。
   * @param sessionKey - 归属会话键（供台账按会话可查；产品层无会话上下文时省略）。
   * @returns 被删除的相对路径与类型。
   */
  remove(
    userId: string,
    projectId: string,
    target: string,
    confirm: boolean,
    remoteAddress?: string,
    sessionKey?: string,
  ): { path: string; kind: 'file' | 'directory' } {
    requireConfirm(confirm, 'delete', target)
    const gated = this.gate(userId, projectId, target, { remoteAddress, mustExist: true })
    const kind: 'file' | 'directory' = statSync(gated.path).isDirectory() ? 'directory' : 'file'
    const before = kind === 'file' ? readFileSync(gated.path, 'utf8') : null
    rmSync(gated.path, { recursive: kind === 'directory', force: false })
    if (kind === 'file') this.observe({ userId, projectId, sessionKey: sessionKey ?? null, filePath: gated.path, before, after: null })
    return { path: toWorkspacePath(gated.root, gated.path), kind }
  }

  /**
   * 按名称递归搜索（跳过 .git/node_modules 等；结果上限明确截断）。
   * @param userId - 请求级用户。
   * @param projectId - 运行项目 id。
   * @param query - 关键词（大小写不敏感的子串匹配）。
   * @param remoteAddress - 请求来源。
   * @returns 命中的条目（含目录优先排序）与截断标志。
   */
  search(
    userId: string,
    projectId: string,
    query: string,
    remoteAddress?: string,
  ): { query: string; entries: WorkspaceEntry[]; truncated: boolean } {
    if (query.trim() === '') {
      throw new FrameworkError(400, 'QUERY_REQUIRED', 'q is required for a workspace search')
    }
    const gated = this.gate(userId, projectId, '.', { remoteAddress, mustExist: true })
    const needle = query.toLowerCase()
    const entries: WorkspaceEntry[] = []
    let truncated = false
    const walk = (directory: string): void => {
      if (truncated) return
      let names: string[]
      try {
        names = readdirSync(directory)
      } catch {
        return
      }
      for (const name of names) {
        if (truncated) return
        const absolute = join(directory, name)
        let child: ReturnType<typeof statSync>
        try {
          child = statSync(absolute)
        } catch {
          continue
        }
        const isDirectory = child.isDirectory()
        if (isDirectory && SEARCH_SKIP_DIRS.has(name)) continue
        if (name.toLowerCase().includes(needle)) {
          if (entries.length >= SEARCH_LIMIT) { truncated = true; return }
          entries.push({
            name,
            path: toWorkspacePath(gated.root, absolute),
            kind: isDirectory ? 'directory' : 'file',
            bytes: isDirectory ? null : child.size,
            mtimeMs: Math.floor(child.mtimeMs),
          })
        }
        if (isDirectory) walk(absolute)
      }
    }
    walk(gated.path)
    entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
      return left.path.localeCompare(right.path)
    })
    return { query, entries, truncated }
  }
}

/**
 * 双确认判定：新建/重命名/删除一律要求调用方显式确认（FR-OPS-010 边界）。
 * @param confirm - 请求携带的确认标志。
 * @param action - 动作名（错误信息里指出具体项）。
 * @param target - 目标路径。
 */
function requireConfirm(confirm: boolean, action: string, target: string): void {
  if (confirm !== true) {
    throw new FrameworkError(400, 'CONFIRMATION_REQUIRED', `${action} of ${target} requires an explicit confirmation (confirm: true)`)
  }
}

/**
 * 判断路径是否为已存在目录。
 * @param path - 绝对路径。
 * @returns 是否为目录。
 */
function existsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
